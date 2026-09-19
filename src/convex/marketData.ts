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
import { requireIdentity } from "./lib/requireIdentity";
import { v } from "convex/values";
import { computeSmcContext } from "../lib/data/smc";
import { calculateTechnical } from "../lib/data/technical";
import { buildChain, buildMtfContext } from "../lib/data/mtf";
import {
  crossAssetComparator,
  DXY_CANDIDATE_SYMBOLS,
  pearsonCorrelation,
  resolveWorkingSymbol,
} from "../lib/market-context";
import type { OhlcvCandle, TechnicalData, TimeframeStructureContext } from "../lib/data/market-types";

/**
 * Phase 7C — in-memory memo of the working actual-DXY symbol (per server
 * instance). Failure caching protects the Twelve Data rate budget: when no
 * candidate resolves, probing is skipped for 24h instead of every analysis.
 */
import { getProviderCache } from "../lib/data/provider-cache-registry";
import { errorMessage, isRecord } from "./lib/json";
import { classifyLegError } from "./lib/legOutcome";
import { envelopeAcquisition, oldestObservation } from "../lib/data/provenance-diagnostics";

let dxyResolvedSymbol: string | null = null;
let dxyAllCandidatesFailedAt: number | null = null;

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
/**
 * Phase 178b — every OHLCV request in this module funnels through here, so
 * this is the single place to enforce cache identity for candle data.
 *
 * The key carries the provider-native symbol, the timeframe AND the requested
 * bar count: a 210-bar setup series and a 100-bar HTF series are different
 * responses and must not share an entry. Concurrent identical requests
 * collapse to one acquisition, which matters because a single analysis asks
 * for the setup timeframe, higher-timeframe context and a comparator series.
 *
 * A throw propagates out of the fetcher, so a 429 or auth failure is never
 * stored — the existing error classification below is unchanged.
 */
/**
 * Phase 178d — per-request acquisition trace.
 *
 * `fetchCandles` is called several times per analysis (setup timeframe, HTF
 * context, comparator). Each read records how it was obtained so the action
 * can report ONE honest mode instead of assuming a fresh observation.
 */
type AcqMode = "observed-now" | "observed-shared" | "cache-reused";
let candleAcquisitions: AcqMode[] = [];
let candleObservations: number[] = [];

function resetCandleTrace(): void {
  candleAcquisitions = [];
  candleObservations = [];
}

async function fetchCandles(
  symbol: string,
  tf: string,
  outputsize: number,
  apiKey: string,
): Promise<OhlcvCandle[]> {
  const evidence = await getProviderCache().fetch<OhlcvCandle[]>(
    {
      provider: "twelve-data",
      dataset: "ohlcv",
      instrument: symbol,
      timeframe: tf,
      qualifier: `bars=${outputsize}`,
    },
    async () => ({
      data: await fetchCandlesUncached(symbol, tf, outputsize, apiKey),
      observedAt: Date.now(),
    }),
  );
  if (evidence) {
    candleAcquisitions.push(evidence.acquisition);
    candleObservations.push(evidence.observedAt);
  }
  return evidence?.data ?? [];
}

async function fetchCandlesUncached(
  symbol: string,
  tf: string,
  outputsize: number,
  apiKey: string,
): Promise<OhlcvCandle[]> {
  const res = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${mapTimeframe(tf)}&outputsize=${outputsize}&apikey=${apiKey}`,
    // Phase 177 — per-request deadline. market-data issues several of these
    // (multi-timeframe batch + bounded DXY probe), so each must be short
    // enough that the whole leg stays inside its 12s budget.
    { signal: AbortSignal.timeout(6_000) },
  );
  const json = await res.json();
  if (json.code) {
    throw new Error(`[${json.code}] ${json.message || "provider error"}`);
  }
  const values: TdCandle[] = json.values ?? [];
  if (values.length === 0) throw new Error("no candle data returned");

  // Phase 178e — a malformed OHLC field parses to NaN. Passing that through
  // would hand the engine an invalid market structure that still LOOKS like
  // evidence: indicators silently propagate NaN, and a NaN high/low is not a
  // price anyone can act on. Such rows are DROPPED rather than defaulted,
  // because there is no honest substitute for a missing price.
  //
  // `volume` is treated differently on purpose: it is genuinely absent from
  // many spot-forex feeds, and the downstream consumers already handle a zero
  // total explicitly (`computeVolumeProfile` refuses to build a profile and
  // reports why). A zero volume therefore cannot fabricate evidence, while a
  // zero PRICE could.
  const parsed = values.reverse().map((c) => ({
    timestamp: new Date(c.datetime).getTime(),
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume) || 0,
  }));

  const usable = parsed.filter(
    (c) =>
      Number.isFinite(c.timestamp) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close),
  );

  // Every row was malformed: the provider returned no usable prices at all.
  // Fail explicitly instead of returning a plausible-looking empty series.
  if (usable.length === 0) {
    throw new Error("provider returned no numerically valid candles");
  }

  return usable;
}

/**
 * Phase 220 — provider-observed price time.
 * `quoteTs` is Twelve Data's `/quote` `timestamp` (UNIX seconds, may be a
 * number or numeric string, may be absent). Only a finite, positive value
 * within a plausible epoch range is accepted and scaled to ms; anything
 * else falls back to the most recent candle's own datetime, which is also
 * provider-observed. Never returns the request clock.
 */
export function resolveProviderPriceTimestamp(quoteTs: unknown, lastCandleMs: number): number {
  const n = typeof quoteTs === "number" ? quoteTs : typeof quoteTs === "string" ? Number(quoteTs) : NaN;
  // 1e9 s = 2001-09-09, 1e11 s = year 5138 — anything outside is not seconds.
  if (Number.isFinite(n) && n >= 1e9 && n < 1e11) return n * 1000;
  return Number.isFinite(lastCandleMs) && lastCandleMs > 0 ? lastCandleMs : 0;
}

/**
 * Phase 230 — classification for the SECONDARY fetch legs in this module
 * (DXY candidate probes, the comparator series, the live quote, the MTF
 * chain, the FX pair legs). The primary candle leg already carries the
 * §217 classification; a secondary leg failure must never be laundered into
 * "the provider has no such data", so its class travels in the reason text.
 *
 * `isDefinitiveProbeRejection` answers the ONLY question the DXY negative
 * cache may ask: did the provider DEFINITIVELY reject this candidate symbol?
 * That is true only for an answered 4xx symbol/plan rejection and for an
 * answered-but-empty series. A quota/credential rejection (429/401/403) or
 * any transport/5xx/malformed failure teaches nothing about the symbol
 * itself, so it must never arm the 24h negative cache — before this phase a
 * `.catch(() => null)` made a 429 look exactly like a verified-invalid
 * symbol and could poison DXY discovery for 24h.
 */
export function isDefinitiveProbeRejection(err: unknown): boolean {
  const msg = errorMessage(err) || "unknown error";
  if (msg.startsWith("[429]") || msg.startsWith("[401]") || msg.startsWith("[403]")) return false;
  if (/^\[4\d\d\]/.test(msg)) return true; // e.g. [404] — symbol unavailable on this plan
  if (msg.startsWith("no candle data returned")) return true;
  if (msg.startsWith("provider returned no numerically valid candles")) return true;
  return false; // timeout / network / 5xx / malformed — nothing learned about the symbol
}

/** Class text for a failed secondary leg — "RATE_LIMIT ([429] …)", "timeout (…)", … */
export function secondaryLegFailureText(err: unknown): string {
  const msg = errorMessage(err) || "unknown error";
  if (msg.startsWith("RATE_LIMIT") || msg.startsWith("[429]")) return `RATE_LIMIT (${msg})`;
  if (msg.startsWith("AUTH_ERROR") || msg.startsWith("[401]") || msg.startsWith("[403]")) {
    return `AUTH_ERROR (${msg})`;
  }
  const cls = classifyLegError(err);
  return `${cls.status} (${cls.reason})`;
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
  handler: async (ctx, args) => {
    // Requires a signed-in identity: this action spends a server-side API key.
    await requireIdentity(ctx);

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return {
        success: false as const,
        error: "Market data provider not configured: TWELVE_DATA_API_KEY is missing. Add it in the Keys/API keys tab.",
        errorCode: "AUTH_ERROR" as const,
      };
    }

    const symbol = args.instrument.toUpperCase().trim();
    resetCandleTrace();

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

      // Live quote — NON-fatal: never discard successful candle data.
      //
      // Phase 178d — cached under the `quote` dataset (20s TTL), the shortest
      // TTL of any cached dataset here. This is the most freshness-sensitive
      // value in the analysis, so the window is deliberately tight: it
      // collapses the duplicate quote calls two back-to-back analyses would
      // make, without letting a price outlive its meaning. The engine
      // independently rejects prices older than its style budget, and the
      // cached payload carries its original observation time, so a reused
      // quote ages honestly rather than appearing newly observed.
      const quoteEvidence = await getProviderCache()
        .fetch<Record<string, unknown>>(
          {
            provider: "twelve-data",
            dataset: "quote",
            instrument: symbol,
            instrumentType: args.instrumentType,
          },
          async () => {
            const fetched = await fetch(
              `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
              // Phase 177 — non-fatal leg; a hung quote must not hold the analysis.
              { signal: AbortSignal.timeout(5_000) },
            ).then((r) => r.json());
            // No usable quote: cache nothing, fall back to the last candle.
            if (!fetched || fetched.close === undefined) return null;
            return { data: fetched as Record<string, unknown>, observedAt: Date.now() };
          },
        )
        .catch(() => null);
      const quoteRes: Record<string, unknown> = quoteEvidence?.data ?? {};
      if (quoteEvidence) {
        candleAcquisitions.push(quoteEvidence.acquisition);
        candleObservations.push(quoteEvidence.observedAt);
      }

      const price =
        quoteRes.close !== undefined
          ? parseFloat(String(quoteRes.close))
          : candles[candles.length - 1].close;

      // Phase 220 — `PriceSnapshot.timestamp` is documented as "when the
      // price was last updated" by the PROVIDER. It was stamped with the
      // request clock, so a quote the provider itself dated hours earlier
      // graded FRESH in the radar and passed the engine's staleness gate.
      // Use the provider's own time when it gave one (Twelve Data /quote
      // `timestamp` is UNIX seconds); otherwise fall back to the last
      // candle's own datetime. Both are provider-observed. The request
      // clock is never used as an observation time.
      const priceTimestamp = resolveProviderPriceTimestamp(
        quoteRes.timestamp,
        candles[candles.length - 1].timestamp,
      );

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
        // Phase 230 — secondary-leg failure state. These legs share the
        // primary Twelve Data quota; when one of them fails the failure
        // CLASS stays attached instead of folding into the generic "no
        // comparable series" wording.
        let dxyProbeInconclusive: string | undefined;
        let compFetchFailure: string | undefined;
        try {
          // Phase 7C — defensive actual-DXY discovery. The literal "DXY"
          // symbol is NOT valid on the current Twelve Data plan (verified:
          // all candidates return 404 while control EUR/USD succeeds), so we
          // try candidates in order and CACHE failures for 24h to protect
          // the rate budget. When a candidate works, this becomes ACTUAL
          // price data with full provenance; otherwise the explicit
          // unavailable state below stands — never a fabricated series.
          let compSymbol: string | null = comparator;
          if (comparator.toUpperCase() === "DXY") {
            const DAY = 24 * 3600e3;
            if (dxyAllCandidatesFailedAt !== null && Date.now() - dxyAllCandidatesFailedAt < DAY) {
              compSymbol = null;
            } else if (dxyResolvedSymbol) {
              compSymbol = dxyResolvedSymbol;
            } else {
              const probes: Record<string, boolean> = {};
              for (const cand of DXY_CANDIDATE_SYMBOLS) {
                const test = await fetchCandles(cand, "D1", 5, apiKey).catch((err: unknown) => {
                  // Phase 230 — only a DEFINITIVE provider answer may mark a
                  // candidate invalid. A quota/credential rejection or any
                  // transport/5xx/malformed failure is inconclusive: nothing
                  // was learned about the symbol itself, so it must NOT arm
                  // the 24h negative cache during a quota outage.
                  if (!isDefinitiveProbeRejection(err)) {
                    dxyProbeInconclusive ??= secondaryLegFailureText(err);
                  }
                  return null;
                });
                probes[cand] = !!test && test.length > 0;
                if (probes[cand]) break; // stop at first success — minimal requests
              }
              // Phase 230 — an INCONCLUSIVE wave resolves nothing and arms
              // nothing: the 24h negative cache is reserved for verified
              // invalidity, never for "our quota died during probing".
              if (dxyProbeInconclusive !== undefined) {
                compSymbol = null;
              } else {
                compSymbol = resolveWorkingSymbol(DXY_CANDIDATE_SYMBOLS, (c) => probes[c] ?? false);
                if (compSymbol) dxyResolvedSymbol = compSymbol;
                else dxyAllCandidatesFailedAt = Date.now();
              }
            }
          }
          const compCandles = compSymbol
            ? await fetchCandles(compSymbol, args.timeframe, 120, apiKey).catch((err: unknown) => {
                // Phase 230 — was `.catch(() => null)`: keep the failure
                // class so a comparator outage is not misreported as "the
                // provider returned no series". A DEFINITIVE answer (4xx
                // symbol/plan rejection, answered-but-empty series) is not a
                // failure — it keeps the original "no comparable series"
                // wording (§227: answered ≠ outage).
                compFetchFailure = isDefinitiveProbeRejection(err)
                  ? undefined
                  : secondaryLegFailureText(err);
                return null;
              })
            : null;
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
                comparatorSymbol: compSymbol ?? comparator,
                timeframe: args.timeframe,
                available: true,
                dataKind: "actual_price" as const,
                provider: "Twelve Data",
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
              unavailableReason:
                compFetchFailure !== undefined
                  ? `comparator series for ${comparator} could not be fetched: ${compFetchFailure} — primary data unaffected`
                  : comparator.toUpperCase() === "DXY" && dxyProbeInconclusive !== undefined
                    ? `actual DXY discovery is inconclusive: all documented index symbol probes failed for transport/quota reasons (${dxyProbeInconclusive}) without a verified-invalid answer — probing resumes on the next analysis; NEWS-derived USD proxy remains labeled fallback`
                    : comparator.toUpperCase() === "DXY"
                      ? "actual DXY price series is not available on the current Twelve Data plan (all documented index symbols verified invalid live) — NEWS-derived USD proxy remains labeled fallback"
                      : `no comparable series returned by the provider for ${comparator}`,
            };
          }
        } catch (err: unknown) {
          // Phase 230 — was `catch {}`: an unexpected secondary-leg error
          // stays non-fatal, but its class remains visible in the reason
          // instead of disappearing into an unattributed failure.
          crossAsset = {
            comparatorSymbol: comparator,
            timeframe: args.timeframe,
            available: false,
            unavailableReason: `cross-asset fetch failed: ${secondaryLegFailureText(err)} — primary data unaffected`,
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
          price: { price, timestamp: priceTimestamp, source: "twelve-data" },
          candles,
          timeframe: args.timeframe,
          higherTimeframe: mtf.htfTimeframe,
          dataFreshness: "delayed" as const,
        },
        technical,
        // Phase 178d — one honest mode for the whole action: `cache-reused`
        // only if EVERY candle read was reused. The oldest observation
        // governs the age, so a single fresh read cannot mask older data.
        acquisition: envelopeAcquisition(candleAcquisitions),
        observedAt: oldestObservation(candleObservations),
      };
    } catch (err: unknown) {
      // Phase 230 — defensive pass-through of the fatal classes: every
      // fetch path above already classifies, but an unanticipated fatal
      // throw must never collapse into a generic outage (§229 AV fix).
      const msg = errorMessage(err) || "unknown error";
      if (msg.startsWith("RATE_LIMIT") || msg.startsWith("[429]")) {
        return {
          success: false as const,
          error: `Rate limited: ${msg}`,
          errorCode: "RATE_LIMIT" as const,
        };
      }
      if (msg.startsWith("AUTH_ERROR") || msg.startsWith("[401]") || msg.startsWith("[403]")) {
        return {
          success: false as const,
          error: `Auth error: ${msg}`,
          errorCode: "AUTH_ERROR" as const,
        };
      }
      return {
        success: false as const,
        error: `Market data fetch failed: ${msg}`,
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
  handler: async (ctx, args) => {
    // Requires a signed-in identity: this action spends a server-side API key.
    await requireIdentity(ctx);

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return { success: false as const, error: "TWELVE_DATA_API_KEY missing" };
    }
    const from = args.from.toUpperCase();
    const to = args.to.toUpperCase();
    if (from === to) return { success: false as const, error: "same currency — no conversion needed" };

    type FxRate = { rate: number; timestamp: number; source: string; pair: string };
    /**
     * Phase 230 — one FX leg as an explicit tri-state (was `catch { return
     * null }`, which made a 429 indistinguishable from "no such conversion").
     *
     *  - FATAL quota/credential answers THROW. Both legs share the same API
     *    key, so a 429/401/403 on either leg is a fatal class for the whole
     *    conversion: nothing is cached and the envelope names the class.
     *  - `empty` is a legitimate "the provider answered, but has no usable
     *    quote for this pair" — the existing no-quote contract, uncached.
     *  - `failed` is a transport/provider fault with its class attached; it
     *    is never laundered into "no quote".
     */
    const fetchPair = async (
      pair: string,
    ): Promise<{ kind: "ok"; value: FxRate } | { kind: "empty" } | { kind: "failed"; failure: string }> => {
      let res: Response;
      try {
        res = await fetch(
          `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(pair)}&apikey=${apiKey}`,
          // Phase 177 — HTTP deadline below the 6s fx-rate leg budget.
          { signal: AbortSignal.timeout(5_000) },
        );
      } catch (err: unknown) {
        const cls = classifyLegError(err);
        return { kind: "failed", failure: `${cls.status} (${cls.reason})` };
      }
      if (res.status === 429) throw new Error(`RATE_LIMIT: HTTP 429 ${res.statusText}`);
      if (res.status === 401 || res.status === 403) {
        throw new Error(`AUTH_ERROR: HTTP ${res.status} ${res.statusText}`);
      }
      if (!res.ok) return { kind: "failed", failure: `provider_error (HTTP ${res.status})` };
      const json: unknown = await res.json().catch(() => undefined);
      if (!isRecord(json)) return { kind: "failed", failure: "malformed (non-JSON body)" };
      // Twelve Data also answers quota/credential problems in the JSON body
      // (HTTP 200 with a `code`); classify them identically to HTTP status.
      const rawCode = json.code;
      const codeNum =
        typeof rawCode === "number" ? rawCode : typeof rawCode === "string" ? Number(rawCode) : NaN;
      if (codeNum === 429) throw new Error(`RATE_LIMIT: ${String(json.message ?? "HTTP 429")}`);
      if (codeNum === 401 || codeNum === 403) {
        throw new Error(`AUTH_ERROR: ${String(json.message ?? `HTTP ${codeNum}`)}`);
      }
      if (rawCode) return { kind: "empty" };
      if (json.close === undefined) return { kind: "empty" };
      const rate = parseFloat(String(json.close));
      if (!Number.isFinite(rate) || rate <= 0) return { kind: "empty" };
      return { kind: "ok", value: { rate, timestamp: Date.now(), source: "twelve-data", pair } };
    };

    // Phase 178b — routed through the authoritative provider cache. The key
    // carries the conversion DIRECTION, so USD>EUR and EUR>USD are distinct
    // entries. A hit performs no HTTP call and consumes no Twelve Data quota;
    // concurrent identical conversions collapse to one acquisition.
    type FxLeg = FxRate | null;
    try {
      const evidence = await getProviderCache().fetch<{ direct: FxLeg; inverse: FxLeg }>(
        {
          provider: "twelve-data",
          dataset: "fx-rate",
          qualifier: `${from}>${to}`,
        },
        async () => {
          // Parallel — a failing leg never blocks or corrupts the other.
          const [direct, inverse] = await Promise.all([
            fetchPair(`${from}/${to}`),
            fetchPair(`${to}/${from}`),
          ]);
          const directLeg = direct.kind === "ok" ? direct.value : null;
          const inverseLeg = inverse.kind === "ok" ? inverse.value : null;
          // Nothing usable: return null so no entry is stored. An absent FX
          // quote must never be cached as if it were a rate.
          if (!directLeg && !inverseLeg) {
            // Phase 230 — when BOTH legs failed for transport/provider
            // reasons that is an outage, not "no quote exists": throw so the
            // action reports API_UNAVAILABLE with the classes, uncached.
            if (direct.kind === "failed" && inverse.kind === "failed") {
              throw new Error(
                `every leg failed (direct: ${direct.failure}; inverse: ${inverse.failure})`,
              );
            }
            return null;
          }
          return {
            data: { direct: directLeg, inverse: inverseLeg },
            // Observation time of the real quote, preserved across later hits.
            observedAt: directLeg?.timestamp ?? inverseLeg?.timestamp ?? Date.now(),
          };
        },
      );

      if (!evidence) {
        return {
          success: false as const,
          error: `no FX quote available for ${from}/${to} from the provider`,
        };
      }
      return {
        success: true as const,
        direct: evidence.data.direct,
        inverse: evidence.data.inverse,
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
      };
    } catch (err: unknown) {
      // Phase 230 — Convex re-wraps thrown errors, so the classification can
      // only survive to the caller as an explicitly returned envelope.
      const msg = errorMessage(err) || "unknown error";
      if (msg.startsWith("RATE_LIMIT")) {
        return {
          success: false as const,
          error: "Twelve Data rate limit exceeded (FX quote leg).",
          errorCode: "RATE_LIMIT" as const,
        };
      }
      if (msg.startsWith("AUTH_ERROR")) {
        return {
          success: false as const,
          error: "Twelve Data access rejected (FX quote leg).",
          errorCode: "AUTH_ERROR" as const,
        };
      }
      return {
        success: false as const,
        error: `FX request failed: ${msg}`,
        errorCode: "API_UNAVAILABLE" as const,
      };
    }
  },
});

