/**
 * Phase 55 — Relative Value Context Engine
 *
 * Generic relative-value context layer that produces contextual
 * comparisons between related instruments.
 *
 * CRITICAL:
 *   - Pure functions — no side effects, no network calls.
 *   - Relative value is contextual evidence only.
 *   - It MUST NOT directly alter the existing decision.
 *   - Missing data remains missing — never fabricated.
 *   - Correlation alone does NOT imply causality.
 */

import type { RelativeValueContext, RelativeValueComparison } from "./analytical-context";
import type { AssetClass } from "./types";

// ═══════════════════════════════════════════════════════════════
// FOREX RELATIVE VALUE
// ═══════════════════════════════════════════════════════════════

export interface ForexRelativeValueInputs {
  instrument: string;
  rateDifferential?: number;
  yieldDifferential?: number;
  dxyTrend?: string;
  cotNet?: number;
}

export function buildForexRelativeValue(inputs: ForexRelativeValueInputs): RelativeValueComparison[] {
  const comparisons: RelativeValueComparison[] = [];

  // Rate differential vs yield differential consistency
  if (inputs.rateDifferential !== undefined && inputs.yieldDifferential !== undefined) {
    const consistent = (inputs.rateDifferential > 0) === (inputs.yieldDifferential > 0);
    comparisons.push({
      targetInstrument: "US10Y",
      relationship: `Rate differential (${inputs.rateDifferential.toFixed(1)}bp) and yield differential (${inputs.yieldDifferential.toFixed(1)}bp) ${consistent ? "are consistent" : "diverge"}.`,
      strength: "MODERATE",
      direction: consistent ? "SUPPORTING" : "CONFLICTING",
      explanation: consistent
        ? "Rate and yield differentials point the same direction — consistent relative value context."
        : "Rate and yield differentials diverge — conflicting relative value context.",
      available: true,
      dependencyGroup: "MACRO_RATES",
    });
  }

  // DXY vs rate differential
  if (inputs.dxyTrend && inputs.rateDifferential !== undefined) {
    const dxyRising = inputs.dxyTrend.toLowerCase() === "up" || inputs.dxyTrend.toLowerCase() === "rising";
    const ratePositive = inputs.rateDifferential > 0;
    const consistent = dxyRising === ratePositive;
    comparisons.push({
      targetInstrument: "DXY",
      relationship: `DXY trend (${inputs.dxyTrend}) and rate differential (${inputs.rateDifferential.toFixed(1)}bp) ${consistent ? "consistent" : "divergent"}.`,
      strength: "WEAK",
      direction: consistent ? "SUPPORTING" : "CONFLICTING",
      explanation: `DXY trend and rate differential ${consistent ? "support the same USD view" : "show divergent USD signals"}.`,
      available: true,
      dependencyGroup: "MACRO_RATES",
    });
  }

  return comparisons;
}

// ═══════════════════════════════════════════════════════════════
// CRYPTO RELATIVE VALUE
// ═══════════════════════════════════════════════════════════════

export interface CryptoRelativeValueInputs {
  instrument: string;
  btcCorrelation?: number;
  btcDominance?: number;
  fundingRate?: number;
}

export function buildCryptoRelativeValue(inputs: CryptoRelativeValueInputs): RelativeValueComparison[] {
  const comparisons: RelativeValueComparison[] = [];

  // BTC correlation
  if (inputs.btcCorrelation !== undefined && inputs.instrument !== "BTC/USD") {
    comparisons.push({
      targetInstrument: "BTC/USD",
      relationship: `Correlation with BTC: ${inputs.btcCorrelation.toFixed(2)}`,
      strength: Math.abs(inputs.btcCorrelation) > 0.7 ? "STRONG" : "WEAK",
      direction: "NEUTRAL",
      explanation: `BTC correlation ${Math.abs(inputs.btcCorrelation) > 0.7 ? "is high — expect BTC-driven moves to transmit" : "is low — relatively independent from BTC"}.`,
      available: true,
      dependencyGroup: "MACRO_RATES",
    });
  }

  // BTC dominance
  if (inputs.btcDominance !== undefined) {
    comparisons.push({
      targetInstrument: "BTC/USD",
      relationship: `BTC dominance: ${inputs.btcDominance.toFixed(1)}%`,
      strength: "WEAK",
      direction: "NEUTRAL",
      explanation: `BTC dominance at ${inputs.btcDominance.toFixed(1)}% provides altcoin rotation context.`,
      available: true,
      dependencyGroup: "MACRO_RATES",
    });
  }

  return comparisons;
}

// ═══════════════════════════════════════════════════════════════
// COMMODITY RELATIVE VALUE
// ═══════════════════════════════════════════════════════════════

export interface CommodityRelativeValueInputs {
  instrument: string;
  dxyTrend?: string;
  inventoryChange?: number;
}

export function buildCommodityRelativeValue(inputs: CommodityRelativeValueInputs): RelativeValueComparison[] {
  const comparisons: RelativeValueComparison[] = [];

  // DXY vs commodity
  if (inputs.dxyTrend) {
    comparisons.push({
      targetInstrument: "DXY",
      relationship: `DXY trend: ${inputs.dxyTrend}`,
      strength: "WEAK",
      direction: "NEUTRAL",
      explanation: `USD trend provides relative value context for USD-denominated commodity.`,
      available: true,
      dependencyGroup: "MACRO_RATES",
    });
  }

  // Inventory vs price direction
  if (inputs.inventoryChange !== undefined) {
    comparisons.push({
      targetInstrument: inputs.instrument,
      relationship: `Inventory change: ${inputs.inventoryChange > 0 ? "+" : ""}${inputs.inventoryChange.toFixed(1)}M bbl`,
      strength: "MODERATE",
      direction: inputs.inventoryChange > 0 ? "CONFLICTING" : "SUPPORTING",
      explanation: `Inventory ${inputs.inventoryChange > 0 ? "build" : "draw"} is ${inputs.inventoryChange > 0 ? "typically bearish" : "typically bullish"} for price — but this is contextual, not deterministic.`,
      available: true,
      dependencyGroup: "COMMODITY_INVENTORY",
    });
  }

  return comparisons;
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSAL RELATIVE VALUE ASSEMBLER
// ═══════════════════════════════════════════════════════════════

export function assembleRelativeValue(params: {
  instrument: string;
  assetClass: AssetClass;
  comparisons: RelativeValueComparison[];
}): RelativeValueContext {
  const available = params.comparisons.filter(c => c.available);
  const description = available.length > 0
    ? `${available.length} relative value comparison${available.length > 1 ? "s" : ""} available.`
    : "Relative value comparisons unavailable.";

  return {
    instrument: params.instrument,
    assetClass: params.assetClass,
    assembledAt: Date.now(),
    comparisons: params.comparisons,
    overallDescription: description,
    available: available.length > 0,
  };
}
