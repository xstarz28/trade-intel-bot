/**
 * Phase 235 — CCXT Live Acquisition
 *
 * Uses CCXT native provider through CCXT.
 * Ticker/OHLCV when capability available.
 * Preserve provider timestamp, exact provider-native symbol.
 * Failure classification uses existing live failure architecture.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { LiveAcquisitionResult } from "@/lib/market-radar/provider-registry";
import { assessFreshness } from "@/lib/market-radar/freshness";
import { classifyLiveFailure } from "@/lib/data/universal/live/failure-class";
import type { Transport } from "@/lib/data/universal/live/client";

type CcxtTicker = {
  symbol: string;
  last?: number;
  timestamp?: number;
  datetime?: string;
};

type CcxtCandle = [number, number, number, number, number, number]; // [ts, open, high, low, close, vol]

type CcxtExchange = {
  id: string;
  fetchTicker: (symbol: string) => Promise<CcxtTicker>;
  fetchOHLCV: (symbol: string, timeframe?: string, since?: number, limit?: number) => Promise<CcxtCandle[]>;
  has?: Record<string, boolean>;
  /**
   * Phase 300 — the exchange's OWN supported OHLCV timeframe map (native
   * token → provider interval), as published by the ccxt class description.
   * Undefined/empty = the capability cannot be established from the class
   * alone, in which case only the actual fetch attempt can verify support.
   */
  timeframes?: Record<string, string>;
};

/**
 * Phase 272 — injectable exchange factory, mirroring `CcxtDiscoveryDeps` on
 * the sibling discovery adapter. Production passes nothing and the real
 * CCXT registry is required; probes hand a deterministic exchange so the
 * acquisition contract (identity passthrough, provider timestamp
 * preservation, failure classification) is verifiable without network.
 */
export interface CcxtLiveDeps {
  createExchange?: (id: string) => CcxtExchange;
}

function getCcxtExchange(id: string): CcxtExchange {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ccxt = require("ccxt") as Record<string, new () => CcxtExchange>;
  const Cls = ccxt[id] as unknown as new () => CcxtExchange;
  if (!Cls) throw new Error(`CCXT exchange ${id} not found`);
  const ex = new Cls();
  return ex;
}

/**
 * Phase 272 — CCXT timeframe tokens. CCXT's OHLCV contract takes native
 * strings ("15m", "1h", "4h"); the analysis engine requests internal tokens
 * ("M15", "H1", ...). Unmapped timeframes stay undefined — never defaulted,
 * so an unsupported request is a refusal, not a silent re-timed series.
 */
const CCXT_TIMEFRAME: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H2: "2h",
  H4: "4h",
  D1: "1d",
  W1: "1w",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "2h": "2h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

export function mapCcxtTimeframe(tf: string): string | undefined {
  return CCXT_TIMEFRAME[tf] ?? CCXT_TIMEFRAME[tf.toUpperCase()];
}

/** Native ccxt token → internal timeframe token, for honest capability reporting. */
const CCXT_TIMEFRAME_REVERSE: Record<string, string> = Object.entries(
  CCXT_TIMEFRAME,
).reduce<Record<string, string>>((acc, [internal, native]) => {
  // First writer wins so the canonical internal token ("1m" → "M1") is kept.
  if (acc[native] === undefined) acc[native] = internal;
  return acc;
}, {});

export function mapCcxtTimeframeInternal(native: string): string {
  // Unmapped native tokens stay provider-native — never relabelled.
  return CCXT_TIMEFRAME_REVERSE[native] ?? native;
}

export async function acquireCcxtLive(
  input: {
    instrument: string;
    provider: string;
    providerInstrumentId: string;
    assetClass: AssetClass;
    timeframe?: string;
    count?: number;
  },
  _readEnv?: (name: string) => string | undefined,
  _transport: Transport = async () => ({ ok: false, status: 500 }),
  deps?: CcxtLiveDeps,
): Promise<LiveAcquisitionResult> {
  const start = Date.now();
  const exchangeId = input.provider.startsWith("ccxt:") ? input.provider.slice(5) : input.provider;

  // Phase 300 runtime-integration fix — map the REQUESTED timeframe to the
  // exchange's native token FIRST and refuse an unmappable request
  // explicitly. An explicit request is never defaulted to another timeframe.
  const requestedInternal = input.timeframe;
  const requestedNative = requestedInternal ? mapCcxtTimeframe(requestedInternal) : undefined;
  if (requestedInternal !== undefined && requestedNative === undefined) {
    const completedAt = Date.now();
    return {
      instrument: input.instrument,
      assetClass: input.assetClass,
      providerInstrumentId: input.providerInstrumentId,
      snapshot: null,
      provider: input.provider,
      fetchedAt: completedAt,
      success: false,
      error: `timeframe "${requestedInternal}" is not supported by provider "${input.provider}" — no silent fallback was performed`,
      latencyMs: completedAt - start,
      liveStatus: "PROVIDER_ERROR",
      failureClass: "TIMEFRAME_UNAVAILABLE",
      quality: "UNAVAILABLE",
    };
  }

  try {
    const ex = (deps?.createExchange ?? getCcxtExchange)(exchangeId);
    const symbol = input.providerInstrumentId;

    // Phase 300 runtime-integration fix — TIMEFRAME-AWARE CAPABILITY MODEL.
    // A generic scanner snapshot must never imply M1/M5/M15/H1 support merely
    // because one default timeframe (or a quote) succeeded. Before any fetch:
    //   - `has.fetchOHLCV === false` (a definitive ccxt capability statement)
    //     refuses an OHLCV request outright; and
    //   - when the exchange TRUTHFULLY reports its supported OHLCV timeframe
    //     map (`ex.timeframes`), a requested timeframe outside that map is
    //     refused BEFORE the wire — an explicit TIMEFRAME_UNAVAILABLE, never
    //     a silent re-timed or defaulted series.
    // When the capability cannot be established (no map published), the
    // actual fetch attempt is the only honest verification there is.
    const hasOhlcv = ex.has?.fetchOHLCV;
    const supportedTimeframes =
      ex.timeframes && typeof ex.timeframes === "object"
        ? (ex.timeframes as Record<string, string>)
        : undefined;
    if (requestedNative !== undefined) {
      if (hasOhlcv === false) {
        const completedAt = Date.now();
        return {
          instrument: input.instrument,
          assetClass: input.assetClass,
          providerInstrumentId: input.providerInstrumentId,
          snapshot: null,
          provider: input.provider,
          fetchedAt: completedAt,
          success: false,
          error: `exchange "${exchangeId}" does not support fetchOHLCV (requested timeframe "${requestedInternal}") — no fallback was performed`,
          latencyMs: completedAt - start,
          liveStatus: "PROVIDER_ERROR",
          failureClass: "TIMEFRAME_UNAVAILABLE",
          quality: "UNAVAILABLE",
        };
      }
      if (
        supportedTimeframes &&
        Object.keys(supportedTimeframes).length > 0 &&
        !(requestedNative in supportedTimeframes)
      ) {
        const completedAt = Date.now();
        return {
          instrument: input.instrument,
          assetClass: input.assetClass,
          providerInstrumentId: input.providerInstrumentId,
          snapshot: null,
          provider: input.provider,
          fetchedAt: completedAt,
          success: false,
          error: `timeframe "${requestedInternal}" (native "${requestedNative}") is not in exchange "${exchangeId}" supported OHLCV timeframes (${Object.keys(supportedTimeframes).join(", ")}) — no silent fallback was performed`,
          latencyMs: completedAt - start,
          liveStatus: "PROVIDER_ERROR",
          failureClass: "TIMEFRAME_UNAVAILABLE",
          quality: "UNAVAILABLE",
        };
      }
    }

    // Try OHLCV. A quote is NOT a substitute for the requested OHLCV series:
    // when the caller named a timeframe, failure stays failure (classified,
    // with the provider's own reason preserved). Only the timeframe-agnostic
    // scanner snapshot may degrade to a quote-only ticker — and it then
    // claims NO timeframe support at all (availableTimeframes: []).
    let candles: CcxtCandle[] = [];
    let ohlcvError: string | undefined;
    if (requestedNative !== undefined || hasOhlcv !== false) {
      try {
        candles = await ex.fetchOHLCV(
          symbol,
          requestedNative ?? "1h",
          undefined,
          input.count ?? 100,
        );
      } catch (err) {
        ohlcvError = err instanceof Error ? err.message : "unknown error";
        candles = [];
      }
    }

    if (candles.length > 0) {
      const latest = candles[candles.length - 1];
      const ts = latest[0];
      const close = latest[4];
      if (!Number.isFinite(close) || close <= 0) {
        throw new Error("invalid close");
      }
      // Provider timestamp must be preserved separately from fetch time.
      // When provider gives no timestamp, we do NOT fabricate observedAt from Date.now()
      // — freshness becomes UNAVAILABLE and price timestamp sentinel 0 is used downstream.
      const observedAt = Number.isFinite(ts) ? ts : undefined;
      const hasProviderTs = Number.isFinite(ts) && (ts as number) > 0;
      const fetchedAt = Date.now();
      return {
        instrument: input.instrument,
        assetClass: input.assetClass,
        providerInstrumentId: input.providerInstrumentId,
        snapshot: {
          instrument: input.instrument,
          assetClass: input.assetClass,
          price: close,
          ohlcvAvailable: true,
          // The timeframe ACTUALLY fetched — reverse-mapped to the internal
          // token when it is one of ours, provider-native otherwise. Never a
          // hardcoded claim about timeframes that were not delivered.
          availableTimeframes: [
            requestedNative ? mapCcxtTimeframeInternal(requestedNative) : "H1",
          ],
          provider: input.provider,
          ...(observedAt !== undefined ? { observedAt } : {}),
          freshness: assessFreshness(observedAt, fetchedAt),
          quality: "VERIFIED",
          timestampProvenance: hasProviderTs ? "PROVIDER_OBSERVED" : "UNKNOWN",
        },
        candles: candles.map((c) => ({
          timestamp: c[0],
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5] ?? 0,
        })),
        provider: input.provider,
        fetchedAt,
        success: true,
        latencyMs: fetchedAt - start,
        liveStatus: "LIVE_VERIFIED",
        quality: "VERIFIED",
      };
    }

    if (requestedNative !== undefined) {
      // Phase 300 — the requested OHLCV series did not materialize. Never
      // dress a quote-only result up as the requested timeframe's data: the
      // provider's own reason travels (sanitized downstream) with its class.
      // Wording note: this reason must NOT contain the words "timeframe" or
      // "interval" — the failure classifier maps those to
      // TIMEFRAME_UNAVAILABLE, but an answered-but-empty series is an
      // absence of data, not a capability refusal.
      const msg =
        ohlcvError ??
        `no candle data returned for ${requestedNative} by exchange "${exchangeId}"`;
      const completedAt = Date.now();
      return {
        instrument: input.instrument,
        assetClass: input.assetClass,
        providerInstrumentId: input.providerInstrumentId,
        snapshot: null,
        provider: input.provider,
        fetchedAt: completedAt,
        success: false,
        error: msg,
        latencyMs: completedAt - start,
        liveStatus: "PROVIDER_ERROR",
        failureClass: classifyLiveFailure({ message: msg }),
        quality: "UNAVAILABLE",
      };
    }

    // Fallback to ticker — timeframe-agnostic scanner snapshots only.
    const ticker = await ex.fetchTicker(symbol);
    const price = ticker.last;
    if (!Number.isFinite(price) || (price as number) <= 0) {
      throw new Error("no price");
    }
    // Preserve provider timestamp; do not fabricate from Date.now()
    const hasTickerTs = Number.isFinite(ticker.timestamp) && (ticker.timestamp as number) > 0;
    const observedAt = hasTickerTs ? ticker.timestamp : undefined;
    const fetchedAt = Date.now();
    return {
      instrument: input.instrument,
      assetClass: input.assetClass,
      providerInstrumentId: input.providerInstrumentId,
      snapshot: {
        instrument: input.instrument,
        assetClass: input.assetClass,
        price: price as number,
        ohlcvAvailable: false,
        availableTimeframes: [],
        provider: input.provider,
        ...(observedAt !== undefined ? { observedAt } : {}),
        freshness: assessFreshness(observedAt, fetchedAt),
        quality: "VERIFIED",
        timestampProvenance: hasTickerTs ? "PROVIDER_OBSERVED" : "UNKNOWN",
      },
      provider: input.provider,
      fetchedAt,
      success: true,
      latencyMs: fetchedAt - start,
      liveStatus: "LIVE_VERIFIED",
      quality: "VERIFIED",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    const failureClass = classifyLiveFailure({ message: msg });
    const completedAt = Date.now();
    return {
      instrument: input.instrument,
      assetClass: input.assetClass,
      providerInstrumentId: input.providerInstrumentId,
      snapshot: null,
      provider: input.provider,
      fetchedAt: completedAt,
      success: false,
      error: msg,
      latencyMs: completedAt - start,
      liveStatus: "PROVIDER_ERROR",
      failureClass,
      quality: "UNAVAILABLE",
    };
  }
}
