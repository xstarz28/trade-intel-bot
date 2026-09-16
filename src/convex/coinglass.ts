/**
 * Convex server-side action for CoinGlass V4 crypto derivatives data.
 * Handles open interest, funding rate, long/short ratio, and liquidations.
 * All API keys are read from environment variables — never exposed to client.
 */
"use node";

import { action } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";
import { v } from "convex/values";
import {
  asFiniteNumber,
  asRecordArray,
  asString,
  errorMessage,
  field,
  isRecord,
  type JsonRecord,
} from "./lib/json";
import type {
  CryptoDerivativesData,
  DerivativesResult,
  OpenInterestData,
  FundingRateData,
  LongShortData,
  LiquidationData,
} from "../lib/data/derivatives-types";

// ── Phase 178b — authoritative provider cache ───────────────────
// Replaces this module's private Map cache. Derivatives are keyed on the FULL
// provider-native instrument (not the truncated base symbol), so BTC/USDT,
// BTC/USD and BTC-USDT-SWAP can never share an entry.
import { getProviderCache } from "../lib/data/provider-cache-registry";

// ── CoinGlass API ───────────────────────────────────────────────

const CG_BASE = "https://open-api-v3.coinglass.com/api";

// ── Phase 228 — per-leg outcome taxonomy ────────────────────────
//
// Every leg call ends in exactly one of these classes. The FATAL classes
// (rate_limit, auth) are thrown out of the leg so the Phase 178b check in the
// cache fetcher can fail the whole acquisition uncached — before this phase
// each leg swallowed them (`catch { return undefined }`), so a 429 on all
// four legs was stored and served as `success: true, confidence: unavailable`.
// The remaining classes are NON-FATAL: the leg is reported as unavailable in
// `availability`, and the class + reason is carried on the payload's
// existing `error` field so nothing downstream can mistake a transport or
// provider failure for "the market simply has no open interest".
export type LegFailureKind =
  | "unavailable" // provider answered, but sent no usable reading
  | "malformed" // provider answered with a body we cannot parse
  | "timeout" // Phase 177 HTTP deadline hit
  | "network" // DNS / TLS / connection failure
  | "provider_error"; // non-2xx HTTP or non-zero CoinGlass code (not 429/401/403)

export type LegOutcome<T> =
  | { status: "ok"; value: T }
  | { status: LegFailureKind; reason: string };

const FATAL_PREFIXES = ["RATE_LIMIT", "AUTH_ERROR"] as const;
export function isFatalLegError(err: unknown): boolean {
  const msg = errorMessage(err);
  return FATAL_PREFIXES.some((p) => msg.startsWith(p));
}

class CgHttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`CoinGlass HTTP ${status}: ${statusText}`);
    this.status = status;
  }
}
class CgProviderError extends Error {}
class CgMalformedError extends Error {}

/** Classify a NON-fatal leg error. Fatal ones must be rethrown before this. */
export function classifyLegError(err: unknown): { status: LegFailureKind; reason: string } {
  const reason = errorMessage(err) || "unknown error";
  if (err instanceof CgHttpError || err instanceof CgProviderError) return { status: "provider_error", reason };
  if (err instanceof CgMalformedError) return { status: "malformed", reason };
  const name = isRecord(err) ? asString(err.name) : undefined;
  if (name === "TimeoutError" || name === "AbortError") return { status: "timeout", reason };
  if (err instanceof SyntaxError) return { status: "malformed", reason };
  // undici surfaces connection failures as TypeError("fetch failed").
  if (err instanceof TypeError) return { status: "network", reason };
  return { status: "provider_error", reason };
}

async function cgFetch(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${CG_BASE}${path}`, {
    // Phase 177 — HTTP deadline below the 8s coinglass leg budget.
    signal: AbortSignal.timeout(7_000),
    headers: {
      accept: "application/json",
      cg_api_key: apiKey,
    },
  });
  if (!res.ok) {
    // Phase 228 — HTTP-level quota/credential rejections were previously a
    // generic error, so only the JSON `code` path ever reached RATE_LIMIT /
    // AUTH_ERROR. Both transports must classify identically.
    if (res.status === 429) throw new Error(`RATE_LIMIT: HTTP 429 ${res.statusText}`);
    if (res.status === 401 || res.status === 403) throw new Error(`AUTH_ERROR: HTTP ${res.status} ${res.statusText}`);
    throw new CgHttpError(res.status, res.statusText);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err: unknown) {
    throw new CgMalformedError(`CoinGlass body is not JSON: ${errorMessage(err)}`);
  }
  // CoinGlass V3/V4 wraps in { code, msg, data }
  const code = field(json, "code");
  if (code !== undefined && code !== null && code !== "" && code !== "0" && code !== 0) {
    const msg = asString(field(json, "msg")) || "Unknown CoinGlass error";
    if (String(code) === "429" || msg.toLowerCase().includes("rate")) {
      throw new Error("RATE_LIMIT:" + msg);
    }
    if (String(code) === "401" || String(code) === "403") {
      throw new Error("AUTH_ERROR:" + msg);
    }
    throw new CgProviderError(`CoinGlass error ${String(code)}: ${msg}`);
  }
  const data = field(json, "data");
  return data ?? json;
}

/**
 * Run one leg: fatal errors propagate (rejecting the leg promise), every other
 * failure becomes a classified outcome; a parser returning undefined is the
 * "provider answered, nothing usable" class.
 */
async function runLeg<T>(parse: () => Promise<T | undefined>): Promise<LegOutcome<T>> {
  try {
    const value = await parse();
    return value === undefined
      ? { status: "unavailable", reason: "no usable reading in provider response" }
      : { status: "ok", value };
  } catch (err: unknown) {
    if (isFatalLegError(err)) throw err;
    return classifyLegError(err);
  }
}

// ── Symbol mapping ──────────────────────────────────────────────

function mapSymbolForCG(instrument: string): string {
  // BTC/USD → BTC, ETH/USD → ETH
  const sym = instrument.toUpperCase().trim();
  return sym.split("/")[0];
}

// ── Main Action ─────────────────────────────────────────────────

export const fetchDerivatives = action({
  args: {
    instrument: v.string(),
  },
  handler: async (ctx, args): Promise<DerivativesResult> => {
    // Requires a signed-in identity: this action spends a server-side API key.
    await requireIdentity(ctx);

    const apiKey = process.env.COINGLASS_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "CoinGlass not configured: COINGLASS_API_KEY is missing. Add it via: bunx convex env set COINGLASS_API_KEY <your-key>",
        errorCode: "AUTH_ERROR",
      };
    }

    const symbol = mapSymbolForCG(args.instrument);

    try {
      // Phase 178b — the ENTIRE acquisition runs inside the cache fetcher, so
      // a hit skips all four upstream calls and 20 concurrent callers collapse
      // to one acquisition instead of four-per-caller.
      const evidence = await getProviderCache().fetch<CryptoDerivativesData>(
        {
          provider: "coinglass",
          dataset: "derivatives",
          instrument: args.instrument,
          instrumentType: "crypto",
          qualifier: symbol,
        },
        async () => {
      // Fetch all datasets in parallel. Phase 228 — each leg settles to a
      // classified LegOutcome; only the FATAL classes reject the promise.
      const settled = await Promise.allSettled([
        runLeg(() => fetchOpenInterest(symbol, apiKey)),
        runLeg(() => fetchFundingRate(symbol, apiKey)),
        runLeg(() => fetchLongShort(symbol, apiKey)),
        runLeg(() => fetchLiquidations(symbol, apiKey)),
      ]);
      const [oiResult, fundingResult, lsResult, liqResult] = settled;

      // Phase 178b — a provider failure must THROW out of the cache fetcher.
      // Returning an error envelope here would let `ProviderCache` store a
      // 429 as if it were evidence. Throwing leaves the cache untouched; the
      // catch below turns it back into the action's error envelope.
      for (const result of settled) {
        if (result.status !== "rejected") continue;
        const msg = errorMessage(result.reason);
        if (msg.startsWith("RATE_LIMIT")) throw new Error("RATE_LIMIT: CoinGlass rate limit exceeded.");
        if (msg.startsWith("AUTH_ERROR")) throw new Error("AUTH_ERROR: CoinGlass authentication failed.");
        // A rejection that is neither fatal class cannot come from runLeg;
        // treat it as a provider error rather than silently dropping it.
        throw new Error(`Derivatives fetch failed: ${msg || "unknown error"}`);
      }
      const legs = {
        openInterest: (oiResult as PromiseFulfilledResult<LegOutcome<OpenInterestData>>).value,
        fundingRate: (fundingResult as PromiseFulfilledResult<LegOutcome<FundingRateData>>).value,
        longShort: (lsResult as PromiseFulfilledResult<LegOutcome<LongShortData>>).value,
        liquidations: (liqResult as PromiseFulfilledResult<LegOutcome<LiquidationData>>).value,
      };
      const openInterest = legs.openInterest.status === "ok" ? legs.openInterest.value : undefined;
      const fundingRate = legs.fundingRate.status === "ok" ? legs.fundingRate.value : undefined;
      const longShort = legs.longShort.status === "ok" ? legs.longShort.value : undefined;
      const liquidations = legs.liquidations.status === "ok" ? legs.liquidations.value : undefined;

      // Phase 228 — non-fatal leg failures are carried, per leg, on the
      // payload's existing `error` field. If EVERY leg failed for a transport
      // or provider reason (nothing was even parsed), that is a provider
      // outage, not "no market condition": throw so the action reports
      // API_UNAVAILABLE and nothing is cached as evidence.
      const legFailures = summarizeLegFailures(legs);
      const answered = Object.values(legs).some((l) => l.status === "ok" || l.status === "unavailable");
      if (!answered) {
        throw new Error(`Derivatives fetch failed: every leg failed (${legFailures})`);
      }

      // Determine availability
      const availability = {
        openInterest: !!openInterest,
        fundingRate: !!fundingRate,
        longShort: !!longShort,
        liquidations: !!liquidations,
      };

      const availableCount = Object.values(availability).filter(Boolean).length;
      let confidence: CryptoDerivativesData["confidence"] = "unavailable";
      if (availableCount >= 3) confidence = "high";
      else if (availableCount >= 2) confidence = "medium";
      else if (availableCount >= 1) confidence = "low";

      // Generate interpretation
      const interpretation = generateInterpretation(openInterest, fundingRate, longShort, liquidations);

      const data: CryptoDerivativesData = {
        provider: "coinglass",
        symbol,
        timestamp: Date.now(),
        freshness: "delayed", // CoinGlass free tier is not realtime
        openInterest,
        fundingRate,
        longShort,
        liquidations,
        availability,
        confidence,
        interpretation,
        ...(legFailures ? { error: legFailures } : {}),
      };

          return { data, observedAt: data.timestamp };
        },
      );
      if (!evidence) {
        return {
          success: false,
          error: "CoinGlass returned no derivatives data.",
          errorCode: "NO_DATA",
        };
      }
      // The payload is returned verbatim on a hit, so `data.timestamp` stays
      // the ORIGINAL provider observation time — never reset to now.
      return {
        success: true,
        data: evidence.data,
        // Phase 178d — reported by the cache, not inferred from timing.
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
      };
    } catch (err: unknown) {
      // Phase 178b — preserve the original classification that the fetcher
      // threw. Collapsing a 429 into API_UNAVAILABLE would lose the
      // rate-limit signal Phase 177 depends on.
      const msg = errorMessage(err) || "unknown error";
      if (msg.startsWith("RATE_LIMIT")) {
        return {
          success: false,
          error: "CoinGlass rate limit exceeded.",
          errorCode: "RATE_LIMIT",
        };
      }
      if (msg.startsWith("AUTH_ERROR")) {
        return {
          success: false,
          error: "CoinGlass authentication failed.",
          errorCode: "AUTH_ERROR",
        };
      }
      return {
        success: false,
        error: `Derivatives fetch failed: ${msg}`,
        errorCode: "API_UNAVAILABLE",
      };
    }
  },
});

// ── Individual Fetchers ─────────────────────────────────────────
//
// Phase 227 — every payload is `unknown`. `points()` coerces the two shapes
// CoinGlass emits (array of points, or a single object) into records, and
// `num()` reads a numeric field from the point itself or its nested `data`.
// A field that is absent or non-numeric yields undefined, never 0: the old
// `parseFloat(x || "0")` chain reported a *zero* funding rate / ratio as an
// available reading when the provider had simply not sent one.

/** "openInterest: timeout (…); fundingRate: provider_error (…)" — or "" when none. */
export function summarizeLegFailures(legs: Record<string, LegOutcome<unknown>>): string {
  return Object.entries(legs)
    .filter(([, l]) => l.status !== "ok" && l.status !== "unavailable")
    .map(([name, l]) => `${name}: ${l.status}${"reason" in l && l.reason ? ` (${l.reason})` : ""}`)
    .join("; ");
}

function points(data: unknown): JsonRecord[] {
  if (Array.isArray(data)) return asRecordArray(data);
  return isRecord(data) ? [data] : [];
}

/** First finite number among `point[key]` and `point.data[key]`. */
function num(point: JsonRecord, ...keys: string[]): number | undefined {
  const nested = field(point, "data");
  for (const key of keys) {
    const direct = asFiniteNumber(point[key]);
    if (direct !== undefined) return direct;
    const inner = asFiniteNumber(field(nested, key));
    if (inner !== undefined) return inner;
  }
  return undefined;
}

async function fetchOpenInterest(symbol: string, apiKey: string): Promise<OpenInterestData | undefined> {
  const pts = points(await cgFetch(`/futures/openInterest/chart?symbol=${symbol}&interval=1h&limit=2`, apiKey));
  if (pts.length === 0) return undefined;

  const latest = pts[pts.length - 1];
  const previous = pts.length > 1 ? pts[pts.length - 2] : null;

  const current = num(latest, "openInterest", "value");
  if (current === undefined || current === 0) return undefined;

  const result: OpenInterestData = { current };

  if (previous) {
    const prev = num(previous, "openInterest", "value");
    if (prev !== undefined && prev > 0) {
      result.change1h = Math.round(((current - prev) / prev) * 10000) / 100;
    }
  }

  return result;
}

async function fetchFundingRate(symbol: string, apiKey: string): Promise<FundingRateData | undefined> {
  const items = points(await cgFetch(`/futures/fundingRate/current?symbol=${symbol}`, apiKey));
  if (items.length === 0) return undefined;

  // Find the entry for our symbol
  const entry =
    items.find((item) => {
      const s = asString(item.symbol);
      return s === symbol || (s !== undefined && s.includes(symbol));
    }) ?? items[0];

  // `data` may itself be the bare rate on some endpoints.
  const rate = num(entry, "currentRate") ?? asFiniteNumber(entry.data);
  if (rate === undefined) return undefined;

  const result: FundingRateData = {
    currentRate: rate,
    annualizedRate: rate * 3 * 365, // 3 funding periods per day * 365 days
  };

  // OI-weighted rate if available
  const predicted = asFiniteNumber(field(entry.data, "predictedRate"));
  if (predicted !== undefined) result.weightedRate = predicted;

  // Exchange-level rates
  const exchangeList = field(entry.data, "exchangeList");
  if (Array.isArray(exchangeList)) {
    const exchanges: { name: string; rate: number }[] = [];
    for (const ex of asRecordArray(exchangeList)) {
      const exRate = num(ex, "currentRate", "rate");
      if (exRate === undefined) continue;
      exchanges.push({
        name: asString(ex.exchange) || asString(ex.name) || "unknown",
        rate: exRate,
      });
    }
    result.exchanges = exchanges;
  }

  return result;
}

async function fetchLongShort(symbol: string, apiKey: string): Promise<LongShortData | undefined> {
  const pts = points(await cgFetch(`/futures/longShort/chart?symbol=${symbol}&interval=1h&limit=1`, apiKey));
  if (pts.length === 0) return undefined;

  const latest = pts[pts.length - 1];
  const result: LongShortData = {};

  const account = num(latest, "longShortRatio");
  if (account !== undefined) result.accountRatio = account;

  const top = num(latest, "topTraderLongShortRatio");
  if (top !== undefined) result.topTraderRatio = top;

  const taker = num(latest, "takerBuySellRatio");
  if (taker !== undefined) result.takerRatio = taker;

  if (result.accountRatio === undefined && result.topTraderRatio === undefined && result.takerRatio === undefined) {
    return undefined;
  }

  return result;
}

async function fetchLiquidations(symbol: string, apiKey: string): Promise<LiquidationData | undefined> {
  const pts = points(await cgFetch(`/futures/liquidation/v2/history?symbol=${symbol}&interval=1h&limit=1`, apiKey));
  if (pts.length === 0) return undefined;

  const latest = pts[pts.length - 1];
  const result: LiquidationData = {};

  // One side genuinely reported as absent while the other is present is
  // treated as 0 for the total (unchanged); both absent → unavailable.
  const longRaw = num(latest, "longLiquidation");
  const shortRaw = num(latest, "shortLiquidation");
  if (longRaw === undefined && shortRaw === undefined) return undefined;
  const longVol = longRaw ?? 0;
  const shortVol = shortRaw ?? 0;

  if (longVol > 0 || shortVol > 0) {
    result.longVolume = longVol;
    result.shortVolume = shortVol;
    result.totalVolume = longVol + shortVol;
    if (longVol > shortVol * 1.5) result.dominantSide = "longs";
    else if (shortVol > longVol * 1.5) result.dominantSide = "shorts";
    else result.dominantSide = "balanced";
  }

  if (result.totalVolume === undefined || result.totalVolume === 0) {
    return undefined;
  }

  return result;
}

// ── Interpretation Generator ────────────────────────────────────

function generateInterpretation(
  oi: OpenInterestData | undefined,
  fr: FundingRateData | undefined,
  ls: LongShortData | undefined,
  liq: LiquidationData | undefined,
): string {
  const parts: string[] = [];

  // Funding rate interpretation
  if (fr) {
    const rate = fr.currentRate;
    if (rate > 0.001) {
      parts.push(`Highly positive funding (${(rate * 100).toFixed(3)}%) indicates crowded longs — elevated reversal/liquidation risk.`);
    } else if (rate > 0.0005) {
      parts.push(`Moderately positive funding (${(rate * 100).toFixed(3)}%) — longs paying shorts, market leans bullish but watch for overcrowding.`);
    } else if (rate < -0.001) {
      parts.push(`Highly negative funding (${(rate * 100).toFixed(3)}%) indicates crowded shorts — potential squeeze risk.`);
    } else if (rate < -0.0005) {
      parts.push(`Moderately negative funding (${(rate * 100).toFixed(3)}%) — shorts paying longs, market leans bearish but watch for squeeze.`);
    } else {
      parts.push(`Neutral funding rate (${(rate * 100).toFixed(4)}%) — balanced positioning.`);
    }
  }

  // OI interpretation (in context)
  if (oi) {
    if (oi.change1h !== undefined) {
      if (oi.change1h > 2) {
        parts.push(`OI rising +${oi.change1h.toFixed(1)}% (1h) — new positions opening, conviction increasing.`);
      } else if (oi.change1h < -2) {
        parts.push(`OI declining ${oi.change1h.toFixed(1)}% (1h) — positions closing, conviction fading.`);
      }
    }
  }

  // Long/short interpretation
  if (ls) {
    if (ls.accountRatio !== undefined) {
      if (ls.accountRatio > 1.5) {
        parts.push(`Long/short ratio ${ls.accountRatio.toFixed(2)} — retail heavily long, contrarian bearish risk.`);
      } else if (ls.accountRatio < 0.67) {
        parts.push(`Long/short ratio ${ls.accountRatio.toFixed(2)} — retail heavily short, contrarian bullish risk.`);
      }
    }
    if (ls.topTraderRatio !== undefined) {
      if (ls.topTraderRatio > 1.2) {
        parts.push(`Top traders lean long (${ls.topTraderRatio.toFixed(2)}).`);
      } else if (ls.topTraderRatio < 0.83) {
        parts.push(`Top traders lean short (${ls.topTraderRatio.toFixed(2)}).`);
      }
    }
  }

  // Liquidation interpretation
  if (liq && liq.dominantSide) {
    if (liq.dominantSide === "longs") {
      parts.push(`Long liquidations dominating — downside pressure, but may signal near-term capitulation.`);
    } else if (liq.dominantSide === "shorts") {
      parts.push(`Short liquidations dominating — upside pressure, potential short squeeze in progress.`);
    }
  }

  return parts.join(" ");
}
