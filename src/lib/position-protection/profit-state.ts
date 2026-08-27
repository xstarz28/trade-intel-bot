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
  const priceChange = isLong
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;
  const unrealizedPnL = priceChange;

  // Distance from entry as percentage
  const distanceFromEntryPct = entryPrice > 0
    ? ((currentPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1)
    : 0;

  // R-multiple (only when SL is available)
  let rMultiple: number | undefined;
  let distanceToSLPct: number | undefined;
  if (stopLoss !== undefined && stopLoss !== entryPrice) {
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    if (riskPerUnit > 0) {
      rMultiple = priceChange / (isLong ? -riskPerUnit : riskPerUnit);
      // R uses the sign: positive R = profit, negative R = loss
      rMultiple = Math.abs(currentPrice - entryPrice) / riskPerUnit *
        (isLong ? (currentPrice > entryPrice ? 1 : -1) : (currentPrice < entryPrice ? 1 : -1));

      distanceToSLPct = Math.abs(currentPrice - stopLoss) / entryPrice * 100;
    }
  }

  // Distance to TP
  let distanceToTPPct: number | undefined;
  if (takeProfit !== undefined) {
    distanceToTPPct = Math.abs(takeProfit - currentPrice) / entryPrice * 100;
  }

  // Leverage-adjusted P/L
  let leveragedPnL: number | undefined;
  if (leverage !== undefined && leverage > 0) {
    leveragedPnL = unrealizedPnL * leverage;
  }

  // Profit giveback
  let peakProfit: number | undefined;
  let givebackPct: number | undefined;

  if (peakPrice !== undefined) {
    peakProfit = isLong ? peakPrice - entryPrice : entryPrice - peakPrice;
    if (peakProfit > 0 && unrealizedPnL < peakProfit) {
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
