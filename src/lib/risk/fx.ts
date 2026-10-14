/**
 * Phase 4 — Currency-aware conversion (pure functions).
 *
 * Rates come only from observed provider snapshots passed by the caller.
 * Real-time quotes use a short age ceiling; dated reference rates must carry
 * their own explicit ceiling and disclose their observation date in the source.
 * No hardcoded exchange rates, no 1:1 assumptions for different currencies,
 * no silent inversion without disclosure.
 */
import type { FxRateSnapshot } from "../risk";

/** Default maximum age for a live FX snapshot before it is considered stale. */
export const DEFAULT_FX_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Frankfurter reference rates are dated daily observations, not live quotes.
 * Four days allows a Friday observation to remain usable over a normal weekend,
 * but rejects rates that remain unpublished/stale through an extended closure.
 */
export const DAILY_REFERENCE_FX_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

export type DailyFxReferenceParseResult =
  | { snapshot: FxRateSnapshot }
  | { error: string };

/** Validate a no-key Frankfurter v2 pair response without inventing a timestamp or rate. */
export function parseDailyFxReferenceSnapshot(
  payload: unknown,
  from: string,
  to: string,
  now: number,
): DailyFxReferenceParseResult {
  if (!payload || typeof payload !== "object") {
    return { error: "daily FX reference returned an invalid response" };
  }
  const row = payload as Record<string, unknown>;
  const expectedFrom = from.trim().toUpperCase();
  const expectedTo = to.trim().toUpperCase();
  const base = typeof row.base === "string" ? row.base.toUpperCase() : "";
  const quote = typeof row.quote === "string" ? row.quote.toUpperCase() : "";
  const date = typeof row.date === "string" ? row.date : "";
  const rate = typeof row.rate === "number" ? row.rate : Number(row.rate);

  if (
    base !== expectedFrom ||
    quote !== expectedTo ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)
  ) {
    return { error: `daily FX reference returned invalid pair/rate metadata for ${expectedFrom}/${expectedTo}` };
  }

  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    return { error: `daily FX reference returned an invalid observation date for ${expectedFrom}/${expectedTo}` };
  }
  const ageMs = now - timestamp;
  if (ageMs < 0 || ageMs > DAILY_REFERENCE_FX_MAX_AGE_MS) {
    return {
      error: `FX_RATE_STALE — Frankfurter reference for ${expectedFrom}/${expectedTo} dated ${date} exceeds the accepted four-day window`,
    };
  }

  return {
    snapshot: {
      pair: `${expectedFrom}/${expectedTo}`,
      rate,
      timestamp,
      source: `Frankfurter daily reference (${date})`,
      maxAgeMs: DAILY_REFERENCE_FX_MAX_AGE_MS,
    },
  };
}

export type ConversionResolution =
  | {
      available: true;
      rate: number;
      direction: "same" | "direct" | "inverse";
      source: string;
    }
  | { available: false; reason: string };

function isValidSnapshot(s: FxRateSnapshot | undefined): s is FxRateSnapshot {
  return (
    !!s &&
    Number.isFinite(s.rate) &&
    s.rate > 0 &&
    Number.isFinite(s.timestamp) &&
    typeof s.pair === "string" &&
    s.pair.includes("/")
  );
}

/**
 * Resolve a quote→account currency conversion factor.
 *
 * Priority:
 *   1. same currency            → rate 1 (no conversion)
 *   2. direct pair snapshot     → used as-is
 *   3. inverse pair snapshot    → 1 / rate, direction disclosed as "inverse"
 *   4. otherwise                → explicit unavailable
 *
 * Stale or invalid snapshots are rejected with a precise reason.
 */
export function resolveConversionRate(
  from: string,
  to: string,
  opts: {
    now: number;
    maxAgeMs?: number;
    direct?: FxRateSnapshot;
    inverse?: FxRateSnapshot;
  },
): ConversionResolution {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (!f || !t) {
    return { available: false, reason: "ACCOUNT_CURRENCY_CONVERSION_UNAVAILABLE" };
  }
  if (f === t) {
    return { available: true, rate: 1, direction: "same", source: "identical-currency" };
  }

  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_FX_MAX_AGE_MS;
  const isFresh = (s: FxRateSnapshot) => {
    const ageMs = opts.now - s.timestamp;
    return ageMs >= 0 && ageMs <= (s.maxAgeMs ?? maxAgeMs);
  };

  // Direct pair: e.g. from=EUR to=USD needs pair EUR/USD.
  if (isValidSnapshot(opts.direct)) {
    const expected = `${f}/${t}`;
    const snap = opts.direct;
    if (snap.pair.toUpperCase() !== expected) {
      // Wrong pair supplied — treat as not usable rather than guessing.
    } else if (!isFresh(snap)) {
      return {
        available: false,
        reason: `FX_RATE_STALE — ${snap.pair} snapshot older than the accepted freshness window`,
      };
    } else {
      return { available: true, rate: snap.rate, direction: "direct", source: snap.source };
    }
  }

  // Inverse pair: e.g. only USD/EUR available → EUR→USD = 1 / (USD/EUR).
  if (isValidSnapshot(opts.inverse)) {
    const expected = `${t}/${f}`;
    const snap = opts.inverse;
    if (snap.pair.toUpperCase() === expected) {
      if (!isFresh(snap)) {
        return {
          available: false,
          reason: `FX_RATE_STALE — inverse ${snap.pair} snapshot older than the accepted freshness window`,
        };
      }
      return {
        available: true,
        rate: 1 / snap.rate,
        direction: "inverse",
        source: `${snap.source} (inverse of ${snap.pair})`,
      };
    }
  }

  return { available: false, reason: "ACCOUNT_CURRENCY_CONVERSION_UNAVAILABLE" };
}
