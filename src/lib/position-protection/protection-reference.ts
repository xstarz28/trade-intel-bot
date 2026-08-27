/**
 * Phase 57 — Protection Reference
 *
 * Computes an analytical reference level where the thesis would become
 * materially weaker. NOT an actual broker trailing stop.
 *
 * Pure functions — no side effects.
 */

import type { PositionContext, ProtectionReference } from "./types";
import type { MarketEvidence } from "./thesis-health";

export function computeProtectionReference(
  position: PositionContext,
  evidence: MarketEvidence,
): ProtectionReference {
  const { side, entryPrice, currentPrice, stopLoss } = position;

  // Method 1: Structural — use recent structure if available
  // We use a simple volatility-based reference when structural data is limited
  if (evidence.volatility !== undefined && evidence.volatility > 0) {
    const atrMultiple = position.horizon === "SCALPING" ? 1.0
      : position.horizon === "INTRADAY" ? 1.5
      : position.horizon === "SWING" ? 2.0
      : 2.5;

    const volDistance = evidence.volatility * atrMultiple;
    const level = side === "LONG"
      ? currentPrice - volDistance
      : currentPrice + volDistance;

    // Ensure reference is between entry and current (for profitable positions)
    const isProfit = side === "LONG" ? currentPrice > entryPrice : currentPrice < entryPrice;
    if (isProfit) {
      const clampedLevel = side === "LONG"
        ? Math.max(level, entryPrice)
        : Math.min(level, entryPrice);

      return {
        level: clampedLevel,
        method: "VOLATILITY",
        description: `Volatility-adjusted protection reference: ${clampedLevel.toFixed(2)} (${atrMultiple}x ATR).`,
        available: true,
      };
    }
  }

  // Method 2: Use stop-loss as reference if available
  if (stopLoss !== undefined) {
    const isProfit = side === "LONG" ? currentPrice > entryPrice : currentPrice < entryPrice;
    if (isProfit) {
      // Move SL toward entry as partial protection reference
      const midpoint = (entryPrice + stopLoss) / 2;
      return {
        level: midpoint,
        method: "STRUCTURAL",
        description: `Partial protection reference at midpoint between entry and stop: ${midpoint.toFixed(2)}.`,
        available: true,
      };
    }
  }

  // Method 3: Break-even reference for profitable positions
  const isProfit = side === "LONG" ? currentPrice > entryPrice : currentPrice < entryPrice;
  if (isProfit) {
    return {
      level: entryPrice,
      method: "STRUCTURAL",
      description: `Break-even reference at entry price: ${entryPrice.toFixed(2)}.`,
      available: true,
    };
  }

  return {
    method: "UNAVAILABLE",
    description: "Protection reference unavailable — insufficient data.",
    available: false,
  };
}
