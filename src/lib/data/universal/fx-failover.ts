/**
 * Phase 317 — catalog-driven FX OHLCV failover (pure, deterministic).
 *
 * WHY THIS EXISTS
 * ---------------
 * The non-provider-native analysis leg (forex majors, gold) acquires OHLCV
 * from exactly one provider (twelve-data). When that provider refuses or
 * fails, the whole analysis dies with it even though the registry ALREADY
 * declares a second credentials-available FX OHLCV provider (alpha-vantage,
 * Phase 44 mapping + the universal live client's FX endpoint). This module
 * turns that dormant declaration into a bounded, honest failover:
 *
 *   - TRIGGERED only by provider-side primary failures (symbol refused,
 *     provider unavailable, network, malformed response, timeframe
 *     unavailable). A primary RATE_LIMIT or AUTH_ERROR is a credential
 *     state of the primary and MUST surface — failing over there would
 *     mask the real state and silently burn the fallback's tiny budget.
 *   - SCOPE is the catalog's own declaration: an instrument fails over
 *     only if `getProviderSymbol(instrument, "alpha-vantage")` returns a
 *     declared native id. Nothing is ever guessed from string surgery.
 *   - TIMEFRAME is preserved exactly: the fallback serves M1/M5/M15/M30/H1
 *     (FX_INTRADAY 1min..60min), D1 (FX_DAILY) and W1 (FX_WEEKLY). H4 has
 *     NO alpha-vantage FX series — it is refused deterministically here,
 *     never aggregated, never relabelled.
 *   - ROUTING POLICY (§317 6G) is sticky WITHIN one analysis run: the
 *     primary is probed exactly once per run; once a failover engages,
 *     every later candle leg of the same run goes straight to the fallback
 *     (no oscillation, no per-leg retries of a provider that just failed).
 *     A NEW run starts on the primary again — there is no cross-run
 *     memory, so recovery needs no timing heuristic.
 *   - PROVENANCE: the controller exposes exactly what the final envelope
 *     must report — the actual fallback provider, the actual provider-native
 *     id it served, and the primary failure that made it happen. Nothing
 *     pretends to be twelve-data.
 *
 * This module never touches the network. The caller injects the two fetch
 * legs; tests drive it with deterministic fakes.
 */

import type { OhlcvCandle } from "../market-types";

// ═══════════════════════════════════════════════════════════════
// TRIGGER CLASSES (§317 6A/6B)
// ═══════════════════════════════════════════════════════════════

/**
 * Primary-failure classes that MAY engage the fallback. Deliberately NOT
 * included: RATE_LIMIT and AUTH_ERROR (the primary's own credential state —
 * surfaced verbatim), NO_LIVE_DATA (a definitive answered-empty series is a
 * data state, not an outage — §227 semantics).
 */
export const FX_FAILOVER_TRIGGER_CLASSES: readonly string[] = [
  "SYMBOL_UNSUPPORTED",
  "API_UNAVAILABLE",
  "NETWORK_ERROR",
  "MALFORMED_RESPONSE",
  "TIMEFRAME_UNAVAILABLE",
];

export function isFxFailoverTrigger(errorCode: string): boolean {
  return FX_FAILOVER_TRIGGER_CLASSES.includes(errorCode);
}

// ═══════════════════════════════════════════════════════════════
// REQUEST MAPPING (catalog-declared native id → AV FX endpoint)
// ═══════════════════════════════════════════════════════════════

export type AlphaVantageFxRequest =
  | {
      ok: true;
      fn: "FX_INTRADAY" | "FX_DAILY" | "FX_WEEKLY";
      interval?: "1min" | "5min" | "15min" | "30min" | "60min";
      fromSymbol: string;
      toSymbol: string;
      /** Delivered-cadence expectation, ms — used to reject a wrong series. */
      expectedCadenceMs: number;
    }
  | { ok: false; reason: string };

const INTRADAY_INTERVAL: Record<string, "1min" | "5min" | "15min" | "30min" | "60min"> = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "60min",
};

const CADENCE_MS: Record<string, number> = {
  M1: 60e3,
  M5: 5 * 60e3,
  M15: 15 * 60e3,
  M30: 30 * 60e3,
  H1: 60 * 60e3,
  H4: 4 * 60 * 60e3,
  D1: 24 * 60 * 60e3,
  W1: 7 * 24 * 60 * 60e3,
};

/**
 * Map an internal timeframe + the CATALOG's alpha-vantage native id to the
 * exact AV FX request. The native id must be the declared 6-letter form
 * (e.g. "EURUSD"); from/to are split ONLY from that declaration — never
 * inferred from the canonical display symbol, never guessed.
 */
export function mapAlphaVantageFxRequest(
  tf: string,
  catalogAvSymbol: string,
): AlphaVantageFxRequest {
  if (!/^[A-Z]{6}$/.test(catalogAvSymbol)) {
    return {
      ok: false,
      reason: `catalog alpha-vantage native id "${catalogAvSymbol}" is not a 6-letter FX pair — failover refused`,
    };
  }
  const fromSymbol = catalogAvSymbol.slice(0, 3);
  const toSymbol = catalogAvSymbol.slice(3, 6);
  const upper = tf.toUpperCase();
  if (upper === "D1") {
    return { ok: true, fn: "FX_DAILY", fromSymbol, toSymbol, expectedCadenceMs: CADENCE_MS.D1 };
  }
  if (upper === "W1") {
    return { ok: true, fn: "FX_WEEKLY", fromSymbol, toSymbol, expectedCadenceMs: CADENCE_MS.W1 };
  }
  const interval = INTRADAY_INTERVAL[upper];
  if (interval === undefined) {
    return {
      ok: false,
      reason: `timeframe "${tf}" has no alpha-vantage FX series (intraday serves M1/M5/M15/M30/H1 only; no H4) — failover refused, no aggregation`,
    };
  }
  return {
    ok: true,
    fn: "FX_INTRADAY",
    interval,
    fromSymbol,
    toSymbol,
    expectedCadenceMs: CADENCE_MS[upper],
  };
}

/** Build the AV query URL from a mapped request. `timezone=UTC` makes the returned datetimes unambiguous. */
export function buildAlphaVantageFxUrl(req: Extract<AlphaVantageFxRequest, { ok: true }>): string {
  const params = new URLSearchParams({
    function: req.fn,
    from_symbol: req.fromSymbol,
    to_symbol: req.toSymbol,
    timezone: "UTC",
  });
  if (req.interval !== undefined) params.set("interval", req.interval);
  return `https://www.alphavantage.co/query?${params.toString()}`;
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE PARSING (strict; provider classes preserved)
// ═══════════════════════════════════════════════════════════════

export type AlphaVantageFxParseResult =
  | { ok: true; candles: OhlcvCandle[] }
  | {
      ok: false;
      failureClass:
        | "QUOTA_EXHAUSTED"
        | "PLAN_RESTRICTED"
        | "NO_DATA"
        | "MALFORMED_RESPONSE"
        | "PROVIDER_FAILURE";
      reason: string;
    };

/**
 * AV FX series timestamp → Unix ms. Intraday datetimes are
 * "YYYY-MM-DD HH:MM:SS" in the requested timezone (the URL pins UTC); daily
 * and weekly are bare dates. Both parse as UTC — never the local clock.
 */
function avTimestampMs(datetime: string): number {
  const d = datetime.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return Date.parse(`${d}T00:00:00Z`);
  return Date.parse(`${d.replace(" ", "T")}Z`);
}

export function parseAlphaVantageFxSeries(json: unknown): AlphaVantageFxParseResult {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, failureClass: "MALFORMED_RESPONSE", reason: "response is not a JSON object" };
  }
  const j = json as Record<string, unknown>;
  const note = typeof j.Note === "string" ? j.Note : undefined;
  if (note !== undefined) {
    return { ok: false, failureClass: "QUOTA_EXHAUSTED", reason: `alpha-vantage note: ${note}` };
  }
  const information = typeof j.Information === "string" ? j.Information : undefined;
  if (information !== undefined) {
    return { ok: false, failureClass: "PLAN_RESTRICTED", reason: `alpha-vantage information: ${information}` };
  }
  const errorMessage = typeof j["Error Message"] === "string" ? j["Error Message"] : undefined;
  if (errorMessage !== undefined) {
    return { ok: false, failureClass: "PROVIDER_FAILURE", reason: `alpha-vantage error: ${errorMessage}` };
  }
  const seriesKey = Object.keys(j).find((k) => k.includes("Time Series"));
  if (seriesKey === undefined) {
    return { ok: false, failureClass: "NO_DATA", reason: "no alpha-vantage time series in the response" };
  }
  const raw = j[seriesKey];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, failureClass: "MALFORMED_RESPONSE", reason: "time series is not an object" };
  }
  const candles: OhlcvCandle[] = Object.entries(raw as Record<string, Record<string, unknown>>)
    .map(([datetime, ohlc]) => {
      const pick = (key: string): number => {
        const v = ohlc[key];
        const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
        return Number.isFinite(n) ? n : NaN;
      };
      const timestamp = avTimestampMs(datetime);
      return {
        timestamp,
        open: pick("1. open"),
        high: pick("2. high"),
        low: pick("3. low"),
        close: pick("4. close"),
        // AV FX series carry no volume; 0 is the established FX convention
        // in this runtime (Twelve Data FX legs report 0 the same way).
        volume: 0,
      };
    })
    .filter((c) => Number.isFinite(c.timestamp) && c.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (candles.length === 0) {
    return { ok: false, failureClass: "NO_DATA", reason: "alpha-vantage time series is empty" };
  }
  return { ok: true, candles };
}

// ═══════════════════════════════════════════════════════════════
// DELIVERED-CADENCE CHECK (§317 6C — wrong timeframe is REJECTED)
// ═══════════════════════════════════════════════════════════════

/**
 * The delivered series' median bar spacing must plausibly BE the requested
 * timeframe (0.5×–2× tolerance absorbs FX session gaps and holidays — the
 * weekend gap is a minority of bars in a long series, so the median holds).
 * A series that does not match is a wrong-timeframe delivery: rejected,
 * never resampled, never relabelled.
 */
export function deliveredCadenceMatchesTimeframe(
  candles: readonly { timestamp: number }[],
  expectedCadenceMs: number,
): boolean {
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const gap = candles[i].timestamp - candles[i - 1].timestamp;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  if (gaps.length < 2) return false;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median >= expectedCadenceMs * 0.5 && median <= expectedCadenceMs * 2;
}

// ═══════════════════════════════════════════════════════════════
// CONTROLLER (§317 6A–6G semantics, injectable, deterministic)
// ═══════════════════════════════════════════════════════════════

export interface FxFailoverState {
  fallbackProvider: "alpha-vantage";
  /** The CATALOG-declared alpha-vantage native id actually served. */
  fallbackNativeId: string;
  primaryProvider: "twelve-data";
  primaryErrorCode: string;
  primaryReason: string;
  /** The internal timeframe that first engaged the failover. */
  engagedTimeframe: string;
}

export interface FxFailoverConfig {
  /** `getProviderSymbol(canonical, "alpha-vantage")` — null means the catalog declares no fallback native id. */
  catalogAvSymbol: string | null;
  /** Whether the fallback credential exists (never a value). */
  fallbackConfigured: boolean;
  classifyPrimary: (err: unknown) => { errorCode: string; error: string };
}

export interface FxFailoverController {
  /**
   * Load `bars` candles of `tf`. Routing policy: the primary serves every
   * leg until it fails ONCE with a trigger-class error — the failover DECISION
   * is made only on that first failure (deterministic: no per-leg re-probing
   * and no timing heuristic, §6G). After a failover engages, the fallback
   * serves the rest of the run (sticky). Throws the ORIGINAL primary error
   * (possibly annotated with the fallback's own failure) when no usable
   * source exists — a mid-run primary failure after an initial success stays
   * that leg's own failure (MTF slots report it as unavailable, unchanged).
   */
  load(tf: string, bars: number): Promise<OhlcvCandle[]>;
  /** The engaged failover provenance, or null while the primary is serving. */
  state(): FxFailoverState | null;
}

export function createFxFailoverController(params: {
  config: FxFailoverConfig;
  primary: (tf: string, bars: number) => Promise<OhlcvCandle[]>;
  fallback: (tf: string, bars: number, catalogAvSymbol: string) => Promise<OhlcvCandle[]>;
}): FxFailoverController {
  const { config, primary, fallback } = params;
  let engaged: FxFailoverState | null = null;
  let primaryProbed = false;

  const refuseWithPrimary = (primaryClass: { errorCode: string; error: string }, note: string): Error => {
    const suffix = note === "" ? "" : ` — FX failover not attempted: ${note}`;
    return new Error(`${primaryClass.error}${suffix}`);
  };

  return {
    state: () => engaged,
    async load(tf, bars) {
      // Sticky: once the fallback serves this run, it keeps serving.
      if (engaged !== null) return fallback(tf, bars, engaged.fallbackNativeId);

      if (!primaryProbed) {
        primaryProbed = true;
        try {
          return await primary(tf, bars);
        } catch (err) {
          const classified = config.classifyPrimary(err);
          if (!isFxFailoverTrigger(classified.errorCode)) {
            // The primary's own credential/quota state must surface verbatim.
            throw err;
          }
          if (!config.fallbackConfigured) {
            throw refuseWithPrimary(classified, "no alpha-vantage credential is configured");
          }
          if (config.catalogAvSymbol === null) {
            throw refuseWithPrimary(
              classified,
              `the catalog declares no alpha-vantage native id for this instrument`,
            );
          }
          const mapped = mapAlphaVantageFxRequest(tf, config.catalogAvSymbol);
          if (!mapped.ok) {
            throw refuseWithPrimary(classified, mapped.reason);
          }
          // Attempt the fallback exactly once for this engagement.
          let candles: OhlcvCandle[];
          try {
            candles = await fallback(tf, bars, config.catalogAvSymbol);
          } catch (fallbackErr) {
            const reason =
              fallbackErr instanceof Error ? fallbackErr.message : "unknown fallback error";
            throw refuseWithPrimary(classified, `alpha-vantage fallback failed (${reason})`);
          }
          if (candles.length === 0) {
            throw refuseWithPrimary(classified, "alpha-vantage fallback returned no usable bars");
          }
          if (!deliveredCadenceMatchesTimeframe(candles, mapped.expectedCadenceMs)) {
            // §317 6C — a wrong-timeframe delivery is rejected outright.
            throw refuseWithPrimary(
              classified,
              `alpha-vantage fallback delivered a series whose cadence does not match ${tf} — rejected, no resampling`,
            );
          }
          engaged = {
            fallbackProvider: "alpha-vantage",
            fallbackNativeId: config.catalogAvSymbol,
            primaryProvider: "twelve-data",
            primaryErrorCode: classified.errorCode,
            primaryReason: classified.error,
            engagedTimeframe: tf,
          };
          return candles;
        }
      }
      // The primary was already probed and returned successfully earlier —
      // keep serving from it (no arbitrary re-probing inside one run).
      return primary(tf, bars);
    },
  };
}
