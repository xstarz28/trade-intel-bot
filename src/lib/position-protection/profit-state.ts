/**
 * Phase 57 — Profit State Calculator
 *
 * Pure functions that compute normalized profit state and metrics
 * from a PositionContext. No side effects, no network calls.
 */

import type { PositionContext, ProfitMetrics, ProfitState } from "./types";

// ═══════════════════════════════════════════════════════════════
// PROFIT STATE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyProfitState(rMultiple?: number, distancePct?: number): ProfitState {
  if (rMultiple !== undefined) {
    if (rMultiple >= 2.0) return "STRONGLY_PROFITABLE";
    if (rMultiple >= 0.5) return "PROFITABLE";
    if (rMultiple >= -0.2) return "BREAK_EVEN_ZONE";
    return "LOSING";
  }
  if (distancePct !== undefined) {
    if (distancePct >= 5.0) return "STRONGLY_PROFITABLE";
    if (distancePct >= 1.0) return "PROFITABLE";
    if (distancePct >= -0.5) return "BREAK_EVEN_ZONE";
    return "LOSING";
  }
  return "BREAK_EVEN_ZONE";
}

// ═══════════════════════════════════════════════════════════════
// MAIN CALCULATOR
// ═══════════════════════════════════════════════════════════════

export function calculateProfitMetrics(position: PositionContext): ProfitMetrics {
  const { side, entryPrice, currentPrice, stopLoss, takeProfit, leverage, peakPrice } = position;

  // Raw P/L direction
  const isLong = side === "LONG";

  const usableEntry = Number.isFinite(entryPrice) && entryPrice > 0;
  const usableCurrent = Number.isFinite(currentPrice) && currentPrice > 0;

  // P/L needs BOTH prices. Without them the result is NaN, which compares
  // false against everything and silently disables the giveback logic
  // downstream instead of reporting that the value is unknown.
  const priceChange =
    usableEntry && usableCurrent
      ? isLong
        ? currentPrice - entryPrice
        : entryPrice - currentPrice
      : undefined;
  const unrealizedPnL = priceChange;

  // Distance from entry as percentage
  const distanceFromEntryPct = usableEntry
    ? ((currentPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1)
    : 0;

  // R-multiple (only when SL is available)
  let rMultiple: number | undefined;
  let distanceToSLPct: number | undefined;
  if (stopLoss !== undefined && stopLoss !== entryPrice) {
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    if (riskPerUnit > 0) {
      // R uses the sign: positive R = profit, negative R = loss.
      // (A first assignment from priceChange used to sit here and was
      // immediately overwritten by this one — dead code, now removed.)
      if (usableEntry && usableCurrent) {
        rMultiple =
          (Math.abs(currentPrice - entryPrice) / riskPerUnit) *
          (isLong
            ? currentPrice > entryPrice
              ? 1
              : -1
            : currentPrice < entryPrice
              ? 1
              : -1);
      }

      // Percentages are expressed against entryPrice, so a zero or
      // non-finite entry makes them Infinity/NaN rather than a distance.
      if (usableEntry) {
        distanceToSLPct = Math.abs(currentPrice - stopLoss) / entryPrice * 100;
      }
    }
  }

  // Distance to TP
  let distanceToTPPct: number | undefined;
  if (takeProfit !== undefined && usableEntry) {
    distanceToTPPct = Math.abs(takeProfit - currentPrice) / entryPrice * 100;
  }

  // Leverage-adjusted P/L
  let leveragedPnL: number | undefined;
  if (leverage !== undefined && leverage > 0 && unrealizedPnL !== undefined) {
    leveragedPnL = unrealizedPnL * leverage;
  }

  // Profit giveback
  let peakProfit: number | undefined;
  let givebackPct: number | undefined;

  if (peakPrice !== undefined && usableEntry && Number.isFinite(peakPrice)) {
    peakProfit = isLong ? peakPrice - entryPrice : entryPrice - peakPrice;
    if (unrealizedPnL === undefined) {
      // Peak is known but the live P/L is not, so giveback is unknown too.
      givebackPct = undefined;
    } else if (peakProfit > 0 && unrealizedPnL < peakProfit) {
      givebackPct = ((peakProfit - unrealizedPnL) / peakProfit) * 100;
    } else {
      givebackPct = 0;
    }
  }

  // Classify state
  const profitState = classifyProfitState(rMultiple, distanceFromEntryPct);

  return {
    profitState,
    unrealizedPnL,
    rMultiple,
    distanceFromEntryPct,
    distanceToSLPct,
    distanceToTPPct,
    peakProfit,
    givebackPct,
    leveragedPnL,
  };
}
