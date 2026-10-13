import type { TradePlan } from "@/types/analysis";

export interface PlanValidationCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

export type TradePlanValidation =
  | { valid: true }
  | { valid: false; reason: "invalid_geometry" | "entry_detached_from_latest_price" | "missing_market_candles" | "target_or_stop_already_crossed" };

/**
 * Refuse to present a market-derived plan as current when its levels have
 * invalid directional geometry or its entry has drifted away from the latest
 * observed candle. This is deliberately conservative: no synthetic re-entry
 * price is created to make a stale setup look executable.
 */
export function validateTradePlanAgainstMarket(
  plan: Pick<TradePlan, "direction" | "entry" | "stopLoss" | "takeProfit">,
  candles: readonly PlanValidationCandle[],
  atr14?: number,
): TradePlanValidation {
  const entry = Number(plan.entry);
  const stop = Number(plan.stopLoss);
  const target = Number(plan.takeProfit);

  if (![entry, stop, target].every((value) => Number.isFinite(value) && value > 0)) {
    return { valid: false, reason: "invalid_geometry" };
  }

  const geometryValid = plan.direction === "long"
    ? stop < entry && entry < target
    : target < entry && entry < stop;
  if (!geometryValid) return { valid: false, reason: "invalid_geometry" };

  const latest = [...candles]
    .filter((c) =>
      [c.open, c.high, c.low, c.close, c.timestamp].every(Number.isFinite) &&
      c.timestamp > 0 && c.high >= Math.max(c.open, c.close, c.low) &&
      c.low <= Math.min(c.open, c.close, c.high),
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (!latest) return { valid: false, reason: "missing_market_candles" };

  const candleRange = Math.max(0, latest.high - latest.low);
  const atrTolerance = Number.isFinite(atr14) && (atr14 ?? 0) > 0 ? (atr14 as number) * 0.75 : 0;
  // A small price-relative floor handles instruments whose ATR feed is
  // missing/rounded, while the ATR and candle range scale the test by market.
  const tolerance = Math.max(atrTolerance, candleRange * 1.5, entry * 0.0002);
  if (Math.abs(entry - latest.close) > tolerance) {
    return { valid: false, reason: "entry_detached_from_latest_price" };
  }

  // Never show a fresh entry after the current market has already passed its
  // target or invalidation. The candle close is the latest confirmed price;
  // this avoids treating an intrabar wick as a confirmed exit by itself.
  const targetOrStopAlreadyCrossed = plan.direction === "long"
    ? latest.close >= target || latest.close <= stop
    : latest.close <= target || latest.close >= stop;
  if (targetOrStopAlreadyCrossed) {
    return { valid: false, reason: "target_or_stop_already_crossed" };
  }

  return { valid: true };
}
