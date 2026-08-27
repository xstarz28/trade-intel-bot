/**
 * Phase 57 — Shock Detector
 *
 * Detects abnormal market behavior that may require immediate
 * thesis re-evaluation. Pure functions — no side effects.
 */

import type { ShockAssessment, ShockState } from "./types";
import type { MarketEvidence } from "./thesis-health";

export function detectShock(evidence: MarketEvidence): ShockAssessment {
  const indicators: ShockAssessment["indicators"] = {};
  let shockCount = 0;
  let elevatedCount = 0;

  // Volatility expansion
  if (evidence.volatility !== undefined && evidence.avgVolatility !== undefined && evidence.avgVolatility > 0) {
    const ratio = evidence.volatility / evidence.avgVolatility;
    if (ratio > 3.0) { indicators.volatilityExpansion = true; shockCount++; }
    else if (ratio > 2.0) { indicators.volatilityExpansion = true; elevatedCount++; }
  }

  // Rapid displacement (>5% in 24h for crypto, >2% for others)
  if (evidence.change24h !== undefined) {
    const threshold = 3;
    if (Math.abs(evidence.change24h) > threshold) {
      indicators.rapidDisplacement = true;
      shockCount++;
    } else if (Math.abs(evidence.change24h) > threshold * 0.6) {
      indicators.rapidDisplacement = true;
      elevatedCount++;
    }
  }

  // VIX shock
  if (evidence.vix !== undefined && evidence.vix > 35) {
    indicators.regimeTransition = true;
    shockCount++;
  } else if (evidence.vix !== undefined && evidence.vix > 25) {
    indicators.regimeTransition = true;
    elevatedCount++;
  }

  // OI shock (crypto)
  if (evidence.oiChange !== undefined && Math.abs(evidence.oiChange) > 20) {
    indicators.oiShock = true;
    shockCount++;
  }

  // Funding shock (crypto)
  if (evidence.fundingRate !== undefined && Math.abs(evidence.fundingRate) > 0.003) {
    indicators.fundingShock = true;
    shockCount++;
  }

  // Liquidation spike
  if (evidence.liquidationSpike === true) {
    indicators.volumeSpike = true;
    shockCount++;
  }

  // Cross-asset divergence
  if (evidence.correlatedDivergence === true) {
    indicators.crossAssetDivergence = true;
    elevatedCount++;
  }

  // Risk regime transition
  if (evidence.riskRegimeChanged === true) {
    indicators.regimeTransition = true;
    shockCount++;
  }

  // Classify
  let state: ShockState;
  let description: string;
  let confidence: number;

  if (shockCount >= 2) {
    state = "SHOCK";
    description = `${shockCount} shock indicators detected simultaneously.`;
    confidence = Math.min(100, 50 + shockCount * 10);
  } else if (shockCount === 1 || elevatedCount >= 1) {
    state = "ELEVATED";
    description = "Elevated market stress detected.";
    confidence = Math.min(100, 40 + elevatedCount * 10);
  } else {
    state = "NORMAL";
    description = "No abnormal market behavior detected.";
    confidence = 60;
  }

  return { state, description, indicators, confidence };
}
