/**
 * Phase 58 — Giveback Monitor
 *
 * Tracks peak favorable excursion and giveback with
 * horizon-sensitive thresholds. Pure functions — no side effects.
 */

import type { PositionSnapshot } from "./realtime-types";

// ═══════════════════════════════════════════════════════════════
// GIVEBACK STATE
// ═══════════════════════════════════════════════════════════════

export type PullbackType = "NORMAL_PULLBACK" | "PROTECTION_EVENT";

export interface GivebackState {
  /** Peak favorable price. */
  peakPrice: number;
  /** Current price. */
  currentPrice: number;
  /** Peak profit (same units as unrealized). */
  peakProfit: number;
  /** Current profit. */
  currentProfit: number;
  /** Absolute giveback amount. */
  givebackAbsolute: number;
  /** Percentage giveback (0 = at peak, 100 = all gone). */
  givebackPct: number;
  /** R giveback if SL available. */
  rGiveback?: number;
  /** Pullback classification. */
  pullbackType: PullbackType;
  /** Giveback rate per minute (for acceleration detection). */
  givebackRate?: number;
  /** Whether giveback is accelerating. */
  accelerating: boolean;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON-SENSITIVE THRESHOLDS
// ═══════════════════════════════════════════════════════════════

interface Thresholds {
  /** Giveback % that triggers WATCH. */
  watchPct: number;
  /** Giveback % that triggers CONSIDER_PARTIAL_TP. */
  partialTpPct: number;
  /** Giveback % that triggers CONSIDER_MANUAL_TP. */
  manualTpPct: number;
  /** Giveback % that triggers PROTECT_PROFIT_NOW. */
  protectNowPct: number;
  /** Max acceptable giveback before protection event. */
  maxAcceptablePct: number;
}

const HORIZON_THRESHOLDS: Record<string, Thresholds> = {
  SCALPING: { watchPct: 15, partialTpPct: 25, manualTpPct: 40, protectNowPct: 60, maxAcceptablePct: 30 },
  INTRADAY: { watchPct: 20, partialTpPct: 35, manualTpPct: 50, protectNowPct: 70, maxAcceptablePct: 40 },
  SWING: { watchPct: 30, partialTpPct: 45, manualTpPct: 60, protectNowPct: 80, maxAcceptablePct: 55 },
  INVESTING: { watchPct: 40, partialTpPct: 55, manualTpPct: 70, protectNowPct: 90, maxAcceptablePct: 70 },
};

function getThresholds(horizon: string): Thresholds {
  return HORIZON_THRESHOLDS[horizon] ?? HORIZON_THRESHOLDS.SWING;
}

// ═══════════════════════════════════════════════════════════════
// GIVEBACK CALCULATOR
// ═══════════════════════════════════════════════════════════════

export function calculateGiveback(
  position: PositionSnapshot,
  previousPeakPrice?: number,
  previousPeakTimestamp?: number,
): GivebackState {
  const isLong = position.side === "LONG";
  const { entryPrice, currentPrice, stopLoss } = position;

  // Update peak
  let peakPrice = previousPeakPrice ?? entryPrice;
  if (isLong && currentPrice > peakPrice) peakPrice = currentPrice;
  if (!isLong && currentPrice < peakPrice) peakPrice = currentPrice;

  // Profits
  const peakProfit = isLong ? peakPrice - entryPrice : entryPrice - peakPrice;
  const currentProfit = isLong ? currentPrice - entryPrice : entryPrice - currentPrice;
  const givebackAbsolute = peakProfit > currentProfit ? peakProfit - currentProfit : 0;
  const givebackPct = peakProfit > 0 ? (givebackAbsolute / peakProfit) * 100 : 0;

  // R giveback
  let rGiveback: number | undefined;
  if (stopLoss !== undefined && stopLoss !== entryPrice) {
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    if (riskPerUnit > 0) {
      rGiveback = givebackAbsolute / riskPerUnit;
    }
  }

  // Acceleration detection
  let givebackRate: number | undefined;
  let accelerating = false;
  if (previousPeakTimestamp !== undefined && previousPeakTimestamp > 0) {
    const elapsed = (Date.now() - previousPeakTimestamp) / 60_000; // minutes
    if (elapsed > 0 && elapsed < 60) {
      givebackRate = givebackAbsolute / elapsed;
    }
  }

  // Classification
  const thresholds = getThresholds(position.horizon);
  const pullbackType: PullbackType = givebackPct > thresholds.maxAcceptablePct
    ? "PROTECTION_EVENT"
    : "NORMAL_PULLBACK";

  return {
    peakPrice,
    currentPrice,
    peakProfit,
    currentProfit,
    givebackAbsolute,
    givebackPct,
    rGiveback,
    pullbackType,
    givebackRate,
    accelerating,
  };
}

// ═══════════════════════════════════════════════════════════════
// GIVEBACK ALERT SEVERITY
// ═══════════════════════════════════════════════════════════════

export function classifyGivebackSeverity(
  giveback: GivebackState,
  horizon: string,
): "NONE" | "WATCH" | "PARTIAL_TP" | "MANUAL_TP" | "PROTECT_NOW" {
  const t = getThresholds(horizon);
  if (giveback.givebackPct >= t.protectNowPct) return "PROTECT_NOW";
  if (giveback.givebackPct >= t.manualTpPct) return "MANUAL_TP";
  if (giveback.givebackPct >= t.partialTpPct) return "PARTIAL_TP";
  if (giveback.givebackPct >= t.watchPct) return "WATCH";
  return "NONE";
}
