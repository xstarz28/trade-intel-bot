/**
 * Phase 4 — Currency-aware conversion (pure functions).
 *
 * Rates come ONLY from live provider snapshots passed in by the caller.
 * No hardcoded exchange rates, no 1:1 assumptions for different currencies,
 * no silent inversion without disclosure.
 */
import type { FxRateSnapshot } from "../risk";

/** Default maximum age for an FX snapshot before it is considered stale. */
export const DEFAULT_FX_MAX_AGE_MS = 10 * 60 * 1000;

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
  const isFresh = (s: FxRateSnapshot) => opts.now - s.timestamp <= maxAgeMs;

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
