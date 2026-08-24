/**
 * Convex server-side market data proxy.
 * API keys are read from environment variables, never exposed to the client.
 *
 * Phase 3A: technical calculations use the SHARED pure layer
 * (lib/data/technical.ts + lib/data/smc.ts + lib/data/mtf.ts) — the same
 * code the client would run — eliminating the previous duplicated inline
 * implementations that could drift out of sync.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { computeSmcContext } from "../lib/data/smc";
import { calculateTechnical } from "../lib/data/technical";
import { buildChain, buildMtfContext } from "../lib/data/mtf";
import { crossAssetComparator, pearsonCorrelation } from "../lib/market-context";
import type { OhlcvCandle, TechnicalData, TimeframeStructureContext } from "../lib/data/market-types";

interface TdCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

function mapTimeframe(tf: string): string {
  const map: Record<string, string> = {
    M1: "1min", M5: "5min", M15: "15min",
    H1: "1h", H4: "4h", D1: "1day", W1: "1week",
  };
  return map[tf] ?? tf.toLowerCase();
}

/** Fetch + normalize candles for one timeframe. Throws on failure. */
async function fetchCandles(
  symbol: string,
  tf: string,
  outputsize: number,
  apiKey: string,
): Promise<OhlcvCandle[]> {
  const res = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${mapTimeframe(tf)}&outputsize=${outputsize}&apikey=${apiKey}`,
  );
  const json = await res.json();
  if (json.code) {
    throw new Error(`[${json.code}] ${json.message || "provider error"}`);
  }
  const values: TdCandle[] = json.values ?? [];
  if (values.length === 0) throw new Error("no candle data returned");
  return values
    .reverse()
    .map((c) => ({
      timestamp: new Date(c.datetime).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume) || 0,
    }));
}

export const fetchMarketData = action({
  args: {
    instrument: v.string(),
    instrumentType: v.union(
      v.literal("forex"),
      v.literal("crypto"),
      v.literal("stock"),
      v.literal("commodity"),
      v.literal("indices"),
    ),
    timeframe: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return {
        success: false as const,
        error: "Market data provider not configured: TWELVE_DATA_API_KEY is missing. Add it in the Keys/API keys tab.",
        errorCode: "AUTH_ERROR" as const,
      };
    }

    const symbol = args.instrument.toUpperCase().trim();

    try {
      // Primary (setup) timeframe — errors classified precisely (429, auth…)
      let candles: OhlcvCandle[];
      try {
        candles = await fetchCandles(symbol, args.timeframe, 210, apiKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        if (msg.startsWith("[429]")) {
          return { success: false as const, error: `Rate limited: ${msg}`, errorCode: "RATE_LIMIT" as const };
        }
        if (msg.startsWith("[401]") || msg.startsWith("[403]")) {
          return { success: false as const, error: `Auth error: ${msg}`, errorCode: "AUTH_ERROR" as const };
        }
        return { success: false as const, error: `API error: ${msg}`, errorCode: "API_UNAVAILABLE" as const };
      }

      // Live quote — NON-fatal: never discard successful candle data
      const quoteRes = await fetch(
        `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
      )
        .then((r) => r.json())
        .catch(() => ({}));

      const price = quoteRes.close ? parseFloat(quoteRes.close) : candles[candles.length - 1].close;

      // ── Shared calculation layer (identical to client-side path) ──
      const technical = calculateTechnical(candles);
      technical.smc = computeSmcContext(candles, args.timeframe);

      // ── Adaptive MTF chain ─────────────────────────────────────
      // Only timeframes that actually fetch successfully enter the chain.
      // Failures (rate limits included) preserve all successful data and
      // mark the slot unavailable — nothing is ever synthesized.
      const slots = buildChain(args.timeframe);
      const settled = await Promise.allSettled(
        slots.map((s) =>
          s.role === "trigger"
            ? fetchCandles(symbol, s.timeframe, 100, apiKey)
            : fetchCandles(symbol, s.timeframe, 120, apiKey),
        ),
      );

      const mtfInputs = slots.map((s, i) => {
        const r = settled[i];
        return r.status === "fulfilled"
          ? { timeframe: s.timeframe, role: s.role, candles: r.value as OhlcvCandle[] }
          : {
              timeframe: s.timeframe,
              role: s.role,
              candles: null,
              error:
                r.reason instanceof Error
                  ? r.reason.message
                  : "timeframe fetch failed",
            };
      });

      // The setup slot uses the primary candles already fetched.
      mtfInputs.unshift({
        timeframe: args.timeframe,
        role: "setup" as const,
        candles,
      });

      const mtf = buildMtfContext(args.timeframe, mtfInputs);
      technical.mtf = mtf;

      // Legacy single-slot fields stay populated for backward compatibility
      // (old UI records / engine fallback paths), derived from the same MTF
      // computation — no second algorithm.
      const structureEntry = mtf.timeframes.find((t) => t.role === "structure");
      const triggerEntry = mtf.timeframes.find((t) => t.role === "trigger");
      const legacyCtx = (
        e: NonNullable<typeof structureEntry>,
      ): TimeframeStructureContext => ({
        timeframe: e.timeframe,
        structure: e.smc!.internalExternal.external.structure,
        bosDirection: e.smc!.internalExternal.external.bosDirection,
        chochDirection: e.smc!.internalExternal.external.chochDirection,
        lastSwingHigh: e.smc!.internalExternal.external.lastSwingHigh,
        lastSwingLow: e.smc!.internalExternal.external.lastSwingLow,
        dataPoints: e.smc!.internalExternal.external.dataPoints,
      });
      if (structureEntry) technical.htfContext = legacyCtx(structureEntry);
      else delete technical.htfContext;
      if (triggerEntry) technical.ltfTrigger = legacyCtx(triggerEntry);
      else delete technical.ltfTrigger;
      if (mtf.unavailable.length > 0) {
        technical.chainUnavailable = mtf.unavailable.map((u) => u.timeframe);
      } else {
        delete technical.chainUnavailable;
      }

      // ── Phase 5: cross-asset context (rate-limit safe) ──
      // ONE extra conditional fetch, only for a RELEVANT comparator
      // (forex/commodity→DXY, BTC-like crypto→NDX). Failure is non-fatal:
      // the primary analysis is never sacrificed for secondary context,
      // and unavailability is flagged explicitly instead of guessed.
      const comparator = crossAssetComparator(args.instrumentType, symbol);
      let crossAsset: TechnicalData["crossAsset"] | undefined;
      if (comparator && comparator !== symbol.toUpperCase()) {
        try {
          const compCandles = await fetchCandles(comparator, args.timeframe, 120, apiKey).catch(() => null);
          if (compCandles && compCandles.length >= 25) {
            const corr = pearsonCorrelation(
              candles.map((c) => c.close),
              compCandles.map((c) => c.close),
            );
            if (corr) {
              const last = compCandles[compCandles.length - 1].close;
              const back = compCandles[Math.max(0, compCandles.length - 21)].close;
              const momentum =
                back > 0 && Number.isFinite(last / back)
                  ? last > back * 1.001
                    ? ("up" as const)
                    : last < back * 0.999
                      ? ("down" as const)
                      : ("flat" as const)
                  : undefined;
              crossAsset = {
                comparatorSymbol: comparator,
                timeframe: args.timeframe,
                available: true,
                correlation: Math.round(corr.correlation * 1000) / 1000,
                sampleSize: corr.n,
                directionalContext:
                  Math.abs(corr.correlation) >= 0.6
                    ? corr.correlation > 0
                      ? ("direct" as const)
                      : ("inverse" as const)
                    : ("weak" as const),
                comparatorMomentum: momentum,
              };
            } else {
              crossAsset = {
                comparatorSymbol: comparator,
                timeframe: args.timeframe,
                available: false,
                unavailableReason: "insufficient overlapping candle history for an honest correlation",
              };
            }
          } else {
            crossAsset = {
              comparatorSymbol: comparator,
              timeframe: args.timeframe,
              available: false,
              unavailableReason: `no comparable series returned by the provider for ${comparator}`,
            };
          }
        } catch {
          crossAsset = {
            comparatorSymbol: comparator,
            timeframe: args.timeframe,
            available: false,
            unavailableReason: "cross-asset fetch failed — primary data unaffected",
          };
        }
      }
      if (crossAsset) technical.crossAsset = crossAsset;

      return {
        success: true as const,
        data: {
          instrument: symbol,
          instrumentType: args.instrumentType,
          provider: "twelve-data",
          fetchTimestamp: Date.now(),
          price: { price, timestamp: Date.now(), source: "twelve-data" },
          candles,
          timeframe: args.timeframe,
          higherTimeframe: mtf.htfTimeframe,
          dataFreshness: "delayed" as const,
        },
        technical,
      };
    } catch (err: any) {
      return {
        success: false as const,
        error: `Market data fetch failed: ${err?.message ?? "unknown error"}`,
        errorCode: "API_UNAVAILABLE" as const,
      };
    }
  },
});

/**
 * Phase 4 — live FX rate snapshots for quote→account position sizing.
 * Fetches BOTH the direct pair (FROM/TO) and the inverse pair (TO/FROM).
 * Either may fail independently; the pure resolver in lib/risk/fx.ts
 * decides which usable snapshot to apply. No rates are ever invented here.
 */
export const fetchFxRate = action({
  args: { from: v.string(), to: v.string() },
  handler: async (_ctx, args) => {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return { success: false as const, error: "TWELVE_DATA_API_KEY missing" };
    }
    const from = args.from.toUpperCase();
    const to = args.to.toUpperCase();
    if (from === to) return { success: false as const, error: "same currency — no conversion needed" };

    const fetchPair = async (
      pair: string,
    ): Promise<{ rate: number; timestamp: number; source: string; pair: string } | null> => {
      try {
        const res = await fetch(
          `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(pair)}&apikey=${apiKey}`,
        ).then((r) => r.json());
        if (!res || res.code || res.close === undefined) return null;
        const rate = parseFloat(res.close);
        if (!Number.isFinite(rate) || rate <= 0) return null;
        return { rate, timestamp: Date.now(), source: "twelve-data", pair };
      } catch {
        return null;
      }
    };

    // Parallel — a failing leg never blocks or corrupts the other.
    const [direct, inverse] = await Promise.all([
      fetchPair(`${from}/${to}`),
      fetchPair(`${to}/${from}`),
    ]);

    if (!direct && !inverse) {
      return {
        success: false as const,
        error: `no FX quote available for ${from}/${to} from the provider`,
      };
    }
    return { success: true as const, direct, inverse };
  },
});
