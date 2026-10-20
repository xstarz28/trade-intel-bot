/**
 * Phase 84 — Multi-Dimensional Trading Intelligence
 *
 * Combines multiple intelligence dimensions into a unified synthesis:
 * - Technical (MTF confluence)
 * - Macro context (VIX-based risk regime)
 * - Cross-asset context (BTC/ETH, DXY, gold relationships)
 * - Derivatives context (placeholder for CoinGlass)
 * - Evidence hierarchy (primary > secondary > context)
 * - Scenario synthesis (base/alternative/invalidation)
 *
 * Pure functions — no side effects, no network calls.
 */

import type { PositionSide } from "./types";
import type { MTFConfluence, MarketRegime } from "./multi-timeframe-engine";
import type { NewsSynthesis } from "./news-intelligence";
import type { FundamentalSynthesis } from "./fundamental-intelligence";

// ═══════════════════════════════════════════════════════════════
// DATA AVAILABILITY
// ═══════════════════════════════════════════════════════════════

export type DataAvailability = "AVAILABLE" | "LIMITED" | "INSUFFICIENT" | "STALE" | "UNAVAILABLE";

export interface DimensionStatus {
  dimension: string;
  availability: DataAvailability;
  description: string;
}

// ═══════════════════════════════════════════════════════════════
// MACRO CONTEXT
// ═══════════════════════════════════════════════════════════════

export type RiskRegime = "RISK_ON" | "RISK_OFF" | "MIXED" | "UNKNOWN";

export interface MacroContext {
  /** Risk regime classification. */
  riskRegime: RiskRegime;
  /** VIX level if available. */
  vixLevel: number | null;
  /** VIX description. */
  vixDescription: string;
  /** How macro context relates to a given position. */
  positionImpact: "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "UNAVAILABLE";
  /** Narrative. */
  narrative: string;
  /** Data availability. */
  availability: DataAvailability;
}

export function classifyMacroContext(
  vixPrice: number | null,
  positionSide: PositionSide,
  instrumentAssetClass: string,
): MacroContext {
  if (vixPrice === null || vixPrice <= 0) {
    return {
      riskRegime: "UNKNOWN",
      vixLevel: null,
      vixDescription: "VIX data unavailable",
      positionImpact: "UNAVAILABLE",
      narrative: "Macro context unavailable — VIX data not provided.",
      availability: "UNAVAILABLE",
    };
  }

  let riskRegime: RiskRegime;
  let vixDescription: string;

  if (vixPrice > 30) {
    riskRegime = "RISK_OFF";
    vixDescription = `VIX at ${vixPrice.toFixed(1)} — elevated fear, risk-off environment`;
  } else if (vixPrice > 25) {
    riskRegime = "RISK_OFF";
    vixDescription = `VIX at ${vixPrice.toFixed(1)} — above-average fear`;
  } else if (vixPrice > 15) {
    riskRegime = "MIXED";
    vixDescription = `VIX at ${vixPrice.toFixed(1)} — moderate, neutral risk environment`;
  } else if (vixPrice > 12) {
    riskRegime = "RISK_ON";
    vixDescription = `VIX at ${vixPrice.toFixed(1)} — low fear, risk appetite healthy`;
  } else {
    riskRegime = "RISK_ON";
    vixDescription = `VIX at ${vixPrice.toFixed(1)} — very low fear, complacency possible`;
  }

  // Position impact based on asset class
  let positionImpact: MacroContext["positionImpact"] = "NEUTRAL";
  let narrative: string;

  const isCrypto = instrumentAssetClass === "crypto";
  const isEquity = instrumentAssetClass === "equity";

  if (riskRegime === "RISK_OFF") {
    if (isCrypto || isEquity) {
      positionImpact = positionSide === "LONG" ? "CONFLICTING" : "SUPPORTING";
      narrative = `Risk-off environment (VIX ${vixPrice.toFixed(1)}) is generally ${positionSide === "LONG" ? "negative" : "supportive"} for ${instrumentAssetClass} positions.`;
    } else if (instrumentAssetClass === "commodity" || instrumentAssetClass === "forex") {
      positionImpact = "NEUTRAL";
      narrative = `Risk-off environment has limited direct impact on ${instrumentAssetClass} — depends on specific instrument dynamics.`;
    } else {
      narrative = `Risk-off environment detected. Impact on ${instrumentAssetClass} depends on specific instrument relationships.`;
    }
  } else if (riskRegime === "RISK_ON") {
    if (isCrypto || isEquity) {
      positionImpact = positionSide === "LONG" ? "SUPPORTING" : "CONFLICTING";
      narrative = `Risk-on environment (VIX ${vixPrice.toFixed(1)}) is generally ${positionSide === "LONG" ? "supportive" : "negative"} for ${instrumentAssetClass} positions.`;
    } else {
      positionImpact = "NEUTRAL";
      narrative = `Risk-on environment detected. Limited direct impact on ${instrumentAssetClass}.`;
    }
  } else {
    narrative = `Mixed risk environment (VIX ${vixPrice.toFixed(1)}) — no strong directional macro signal.`;
  }

  return {
    riskRegime,
    vixLevel: vixPrice,
    vixDescription,
    positionImpact,
    narrative,
    availability: "AVAILABLE",
  };
}

// ═══════════════════════════════════════════════════════════════
// CROSS-ASSET CONTEXT
// ═══════════════════════════════════════════════════════════════

export type CorrelationState = "ALIGNED" | "DIVERGING" | "MIXED" | "INSUFFICIENT_DATA";

export interface CrossAssetPair {
  instrument: string;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
}

export interface CrossAssetContext {
  /** Pairs analyzed. */
  pairs: CrossAssetPair[];
  /** Overall correlation state. */
  correlationState: CorrelationState;
  /** Impact on current position. */
  positionImpact: "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "UNAVAILABLE";
  /** Narrative. */
  narrative: string;
  /** Data availability. */
  availability: DataAvailability;
}

export function analyzeCrossAssetContext(
  currentInstrument: string,
  currentPositionSide: PositionSide,
  otherPrices: Map<string, { trend: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN"; assetClass: string }>,
): CrossAssetContext {
  if (otherPrices.size === 0) {
    return {
      pairs: [],
      correlationState: "INSUFFICIENT_DATA",
      positionImpact: "UNAVAILABLE",
      narrative: "Cross-asset context unavailable — no comparison data.",
      availability: "UNAVAILABLE",
    };
  }

  const pairs: CrossAssetPair[] = [];
  for (const [instrument, data] of otherPrices) {
    pairs.push({ instrument, trend: data.trend });
  }

  // Determine correlation state
  const bullish = pairs.filter((p) => p.trend === "BULLISH").length;
  const bearish = pairs.filter((p) => p.trend === "BEARISH").length;
  const total = pairs.length;

  let correlationState: CorrelationState;
  if (bullish === total || bearish === total) {
    correlationState = "ALIGNED";
  } else if (bullish > 0 && bearish > 0) {
    correlationState = "DIVERGING";
  } else {
    correlationState = "MIXED";
  }

  // Position impact
  let positionImpact: CrossAssetContext["positionImpact"] = "NEUTRAL";
  let narrative: string;

  if (correlationState === "ALIGNED") {
    const direction = bullish > 0 ? "bullish" : "bearish";
    const supportsLong = direction === "bullish" && currentPositionSide === "LONG";
    const supportsShort = direction === "bearish" && currentPositionSide === "SHORT";
    positionImpact = (supportsLong || supportsShort) ? "SUPPORTING" : "CONFLICTING";
    narrative = `Related instruments are aligned ${direction} — ${positionImpact === "SUPPORTING" ? "supportive" : "conflicting"} for ${currentPositionSide} position.`;
  } else if (correlationState === "DIVERGING") {
    positionImpact = "CONFLICTING";
    narrative = `Related instruments are diverging — mixed signals for ${currentPositionSide} position. No clear cross-asset confirmation.`;
  } else {
    narrative = "Limited cross-asset data — no clear directional signal from related instruments.";
  }

  return {
    pairs,
    correlationState,
    positionImpact,
    narrative,
    availability: "AVAILABLE",
  };
}

// ═══════════════════════════════════════════════════════════════
// DERIVATIVES CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface DerivativesContext {
  /** Funding rate if available. */
  fundingRate: number | null;
  /** Open interest change if available. */
  oiChange: number | null;
  /** Liquidation pressure if available. */
  liquidationPressure: "ELEVATED" | "NORMAL" | "UNKNOWN";
  /** Position impact. */
  positionImpact: "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "UNAVAILABLE";
  /** Narrative. */
  narrative: string;
  /** Data availability. */
  availability: DataAvailability;
}

export function analyzeDerivativesContext(
  fundingRate: number | null,
  oiChange: number | null,
  liquidationSpike: boolean,
  positionSide: PositionSide,
): DerivativesContext {
  if (fundingRate === null && oiChange === null && !liquidationSpike) {
    return {
      fundingRate: null,
      oiChange: null,
      liquidationPressure: "UNKNOWN",
      positionImpact: "UNAVAILABLE",
      narrative: "Derivatives data unavailable — CoinGlass API key not configured.",
      availability: "UNAVAILABLE",
    };
  }

  let positionImpact: DerivativesContext["positionImpact"] = "NEUTRAL";
  const narratives: string[] = [];

  // Funding rate interpretation
  if (fundingRate !== null) {
    const extremePositive = fundingRate > 0.001; // shorts paying longs = crowded long
    const extremeNegative = fundingRate < -0.001; // longs paying shorts = crowded short

    if (positionSide === "LONG") {
      if (extremePositive) {
        positionImpact = "CONFLICTING";
        narratives.push(`Funding rate ${(fundingRate * 100).toFixed(3)}% — crowded long positioning`);
      } else if (extremeNegative) {
        positionImpact = "SUPPORTING";
        narratives.push(`Funding rate ${(fundingRate * 100).toFixed(3)}% — shorts paying longs`);
      } else {
        narratives.push(`Funding rate ${(fundingRate * 100).toFixed(3)}% — neutral`);
      }
    } else {
      if (extremeNegative) {
        positionImpact = "CONFLICTING";
        narratives.push(`Funding rate ${(fundingRate * 100).toFixed(3)}% — crowded short positioning`);
      } else if (extremePositive) {
        positionImpact = "SUPPORTING";
        narratives.push(`Funding rate ${(fundingRate * 100).toFixed(3)}% — longs paying shorts`);
      } else {
        narratives.push(`Funding rate ${(fundingRate * 100).toFixed(3)}% — neutral`);
      }
    }
  }

  // OI interpretation
  if (oiChange !== null) {
    if (Math.abs(oiChange) > 15) {
      narratives.push(`Open interest changed ${oiChange > 0 ? "+" : ""}${oiChange.toFixed(1)}% — significant positioning shift`);
    }
  }

  // Liquidation
  if (liquidationSpike) {
    positionImpact = "CONFLICTING";
    narratives.push("Liquidation pressure detected — elevated volatility expected");
  }

  return {
    fundingRate,
    oiChange,
    liquidationPressure: liquidationSpike ? "ELEVATED" : "NORMAL",
    positionImpact,
    narrative: narratives.length > 0 ? narratives.join(". ") : "Derivatives context neutral.",
    availability: "AVAILABLE",
  };
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE HIERARCHY
// ═══════════════════════════════════════════════════════════════

export type EvidenceTier = "PRIMARY" | "SECONDARY" | "CONTEXT";

export interface HierarchicalEvidence {
  tier: EvidenceTier;
  category: string;
  description: string;
  direction: "SUPPORTING" | "CONFLICTING" | "NEUTRAL";
  strength: "STRONG" | "MODERATE" | "WEAK";
  source: string;
}

export function buildHierarchicalEvidence(
  confluence: MTFConfluence,
  macroCtx: MacroContext,
  crossAssetCtx: CrossAssetContext,
  derivativesCtx: DerivativesContext,
  positionSide: PositionSide,
  newsCtx?: NewsSynthesis | null,
  fundamentalCtx?: FundamentalSynthesis | null,
): HierarchicalEvidence[] {
  const evidence: HierarchicalEvidence[] = [];
  const isLong = positionSide === "LONG";

  const h1 = confluence.timeframes.find((a) => a.timeframe === "H1");
  const m15 = confluence.timeframes.find((a) => a.timeframe === "M15");
  const m5 = confluence.timeframes.find((a) => a.timeframe === "M5");

  // ─── PRIMARY TIER (H1 structure + trend) ───
  if (h1 && h1.trend !== "UNKNOWN") {
    const aligned = (isLong && h1.trend === "BULLISH") || (!isLong && h1.trend === "BEARISH");
    evidence.push({
      tier: "PRIMARY",
      category: "TECHNICAL",
      description: `H1 trend: ${h1.trend}`,
      direction: aligned ? "SUPPORTING" : "CONFLICTING",
      strength: "STRONG",
      source: "MTF",
    });
  }

  if (h1 && h1.structureBroken) {
    evidence.push({
      tier: "PRIMARY",
      category: "STRUCTURE",
      description: "H1 structure broken against position",
      direction: "CONFLICTING",
      strength: "STRONG",
      source: "MTF",
    });
  }

  if (h1 && h1.volatility === "EXPANDED") {
    evidence.push({
      tier: "PRIMARY",
      category: "VOLATILITY",
      description: "H1 volatility elevated — wider price swings expected",
      direction: "CONFLICTING",
      strength: "MODERATE",
      source: "MTF",
    });
  }

  // ─── SECONDARY TIER (M15/M5) ───
  if (m15 && m15.trend !== "UNKNOWN") {
    const aligned = (isLong && m15.trend === "BULLISH") || (!isLong && m15.trend === "BEARISH");
    evidence.push({
      tier: "SECONDARY",
      category: "TECHNICAL",
      description: `M15 trend: ${m15.trend}`,
      direction: aligned ? "SUPPORTING" : "CONFLICTING",
      strength: "MODERATE",
      source: "MTF",
    });
  }

  if (m5 && m5.rsiValue !== undefined) {
    const overbought = m5.rsiValue > 70;
    const oversold = m5.rsiValue < 30;
    if ((isLong && overbought) || (!isLong && oversold)) {
      evidence.push({
        tier: "SECONDARY",
        category: "MOMENTUM",
        description: `M5 RSI at ${m5.rsiValue.toFixed(0)} — ${overbought ? "overbought" : "oversold"}`,
        direction: "CONFLICTING",
        strength: "MODERATE",
        source: "MTF",
      });
    } else if ((isLong && oversold) || (!isLong && overbought)) {
      evidence.push({
        tier: "SECONDARY",
        category: "MOMENTUM",
        description: `M5 RSI at ${m5.rsiValue.toFixed(0)} — ${oversold ? "oversold bounce potential" : "overbought pullback potential"}`,
        direction: "SUPPORTING",
        strength: "WEAK",
        source: "MTF",
      });
    }
  }

  // ─── CONTEXT TIER (macro, cross-asset, derivatives) ───
  if (macroCtx.availability === "AVAILABLE" && macroCtx.positionImpact !== "NEUTRAL") {
    evidence.push({
      tier: "CONTEXT",
      category: "MACRO",
      description: macroCtx.narrative,
      direction: macroCtx.positionImpact as "SUPPORTING" | "CONFLICTING",
      strength: "WEAK",
      source: "Macro",
    });
  }

  if (crossAssetCtx.availability === "AVAILABLE" && crossAssetCtx.positionImpact !== "NEUTRAL") {
    evidence.push({
      tier: "CONTEXT",
      category: "CROSS_ASSET",
      description: crossAssetCtx.narrative,
      direction: crossAssetCtx.positionImpact as "SUPPORTING" | "CONFLICTING",
      strength: "WEAK",
      source: "CrossAsset",
    });
  }

  if (derivativesCtx.availability === "AVAILABLE" && derivativesCtx.positionImpact !== "NEUTRAL") {
    evidence.push({
      tier: "CONTEXT",
      category: "DERIVATIVES",
      description: derivativesCtx.narrative,
      direction: derivativesCtx.positionImpact as "SUPPORTING" | "CONFLICTING",
      strength: "WEAK",
      source: "Derivatives",
    });
  }

  // ─── NEWS CONTEXT ───
  if (newsCtx && newsCtx.availability === "AVAILABLE" && newsCtx.newsStance !== "INSUFFICIENT" && newsCtx.newsStance !== "NEUTRAL") {
    evidence.push({
      tier: "CONTEXT",
      category: "NEWS",
      description: newsCtx.description,
      direction: (newsCtx.newsStance === "SUPPORTING" ? "SUPPORTING" : newsCtx.newsStance === "CONFLICTING" ? "CONFLICTING" : "NEUTRAL") as "SUPPORTING" | "CONFLICTING",
      strength: "WEAK",
      source: "News",
    });
  }

  // ─── FUNDAMENTAL CONTEXT ───
  if (fundamentalCtx && fundamentalCtx.availability === "AVAILABLE" && fundamentalCtx.fundamentalStance !== "INSUFFICIENT" && fundamentalCtx.fundamentalStance !== "NEUTRAL") {
    evidence.push({
      tier: "CONTEXT",
      category: "FUNDAMENTAL",
      description: fundamentalCtx.description,
      direction: (fundamentalCtx.fundamentalStance === "SUPPORTING" ? "SUPPORTING" : fundamentalCtx.fundamentalStance === "CONFLICTING" ? "CONFLICTING" : "NEUTRAL") as "SUPPORTING" | "CONFLICTING",
      strength: "WEAK",
      source: "Fundamentals",
    });
  }

  // ─── CATALYST CONTEXT ───
  if (fundamentalCtx?.catalyst && (fundamentalCtx.catalyst.status === "HIGH_IMPACT_EVENT_APPROACHING" || fundamentalCtx.catalyst.status === "ACTIVE_CATALYST")) {
    evidence.push({
      tier: "CONTEXT",
      category: "CATALYST",
      description: fundamentalCtx.catalyst.description,
      direction: "NEUTRAL",
      strength: "MODERATE",
      source: "EconomicCalendar",
    });
  }

  return evidence;
}

// ═══════════════════════════════════════════════════════════════
// SCENARIO SYNTHESIS
// ═══════════════════════════════════════════════════════════════

export interface ScenarioCase {
  label: string;
  description: string;
  conditions: string[];
}

export interface ScenarioSynthesis {
  baseCase: ScenarioCase;
  alternativeCase: ScenarioCase;
  invalidationCase: ScenarioCase;
}

export function generateScenarios(
  side: PositionSide,
  confluence: MTFConfluence,
  evidence: HierarchicalEvidence[],
): ScenarioSynthesis {
  const h1 = confluence.timeframes.find((a) => a.timeframe === "H1");
  const m15 = confluence.timeframes.find((a) => a.timeframe === "M15");
  const m5 = confluence.timeframes.find((a) => a.timeframe === "M5");

  const isLong = side === "LONG";
  const supportingCount = evidence.filter((e) => e.direction === "SUPPORTING").length;
  const conflictingCount = evidence.filter((e) => e.direction === "CONFLICTING").length;

  // Base case: what supports the current thesis
  const baseConditions: string[] = [];
  if (h1?.trend !== "UNKNOWN") {
    baseConditions.push(`H1 trend remains ${isLong ? "bullish" : "bearish"}`);
  }
  if (m15?.trend !== "UNKNOWN") {
    baseConditions.push(`M15 confirms ${isLong ? "upward" : "downward"} momentum`);
  }
  if (supportingCount >= 2) {
    baseConditions.push("Multiple independent evidence dimensions supporting");
  }

  const baseCase: ScenarioCase = {
    label: "BASE CASE",
    description: `${side} remains supported while higher-timeframe structure and trend hold.`,
    conditions: baseConditions.length > 0 ? baseConditions : ["Current market structure continues"],
  };

  // Alternative: what could develop against the thesis
  const altConditions: string[] = [];
  if (m5 && m5.trend !== "UNKNOWN") {
    const m5Opposing = (isLong && m5.trend === "BEARISH") || (!isLong && m5.trend === "BULLISH");
    if (m5Opposing) {
      altConditions.push(`Short-term weakness on M5 could develop into deeper pullback`);
    }
  }
  if (conflictingCount >= 2) {
    altConditions.push(`${conflictingCount} conflicting signals suggest caution`);
  }
  if (m15 && m15.volatility === "EXPANDED") {
    altConditions.push("Elevated volatility could accelerate moves in either direction");
  }

  const alternativeCase: ScenarioCase = {
    label: "ALTERNATIVE",
    description: conflictingCount > 0
      ? "Counter-trend signals exist — monitor for potential shift in higher-timeframe structure."
      : "Limited counter-signal — watch for new emerging evidence.",
    conditions: altConditions.length > 0 ? altConditions : ["Monitor for new evidence that could shift the thesis"],
  };

  // Invalidation: what kills the thesis
  const invalidConditions: string[] = [];
  if (h1) {
    if (isLong) {
      invalidConditions.push("H1 structure breaks below key support");
      invalidConditions.push("H1 trend shifts to bearish");
    } else {
      invalidConditions.push("H1 structure breaks above key resistance");
      invalidConditions.push("H1 trend shifts to bullish");
    }
  }
  if (m15?.structureBroken) {
    invalidConditions.push("M15 structure break confirmed on close");
  }

  const invalidationCase: ScenarioCase = {
    label: "INVALIDATION",
    description: "Thesis becomes invalid when higher-timeframe structure and trend reverse against position.",
    conditions: invalidConditions.length > 0 ? invalidConditions : ["Key structural level breaks against position direction"],
  };

  return { baseCase, alternativeCase, invalidationCase };
}

// ═══════════════════════════════════════════════════════════════
// MULTI-DIMENSIONAL SYNTHESIS
// ═══════════════════════════════════════════════════════════════

export interface MultiDimensionalSynthesis {
  /** Instrument. */
  instrument: string;
  /** Position side. */
  side: PositionSide;
  /** Market regime. */
  regime: MarketRegime;
  /** MTF confluence. */
  confluence: MTFConfluence;
  /** Macro context. */
  macro: MacroContext;
  /** Cross-asset context. */
  crossAsset: CrossAssetContext;
  /** Derivatives context. */
  derivatives: DerivativesContext;
  /** News context. */
  news: NewsSynthesis | null;
  /** Fundamental context. */
  fundamentals: FundamentalSynthesis | null;
  /** Hierarchical evidence (primary > secondary > context). */
  evidence: HierarchicalEvidence[];
  /** Scenario synthesis. */
  scenarios: ScenarioSynthesis;
  /** Dimension statuses. */
  dimensions: DimensionStatus[];
  /** Overall evidence quality. */
  evidenceQuality: "STRONG_EVIDENCE" | "MODERATE_EVIDENCE" | "WEAK_EVIDENCE" | "INSUFFICIENT_EVIDENCE";
  /** Number of supporting / conflicting dimensions. */
  supportingDimensions: number;
  conflictingDimensions: number;
}

export function synthesizeMultiDimensionalIntelligence(input: {
  instrument: string;
  side: PositionSide;
  confluence: MTFConfluence;
  vixPrice: number | null;
  otherPrices?: Map<string, { trend: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN"; assetClass: string }>;
  fundingRate?: number | null;
  oiChange?: number | null;
  liquidationSpike?: boolean;
  news?: NewsSynthesis | null;
  fundamentals?: FundamentalSynthesis | null;
}): MultiDimensionalSynthesis {
  const { instrument, side, confluence, vixPrice, otherPrices, fundingRate, oiChange, liquidationSpike } = input;

  // Macro
  const instrumentClass = instrument.includes("/") ? "forex" : "crypto";
  const macro = classifyMacroContext(vixPrice, side, instrumentClass);

  // Cross-asset
  const crossAsset = analyzeCrossAssetContext(instrument, side, otherPrices ?? new Map());

  // Derivatives
  const derivatives = analyzeDerivativesContext(
    fundingRate ?? null,
    oiChange ?? null,
    liquidationSpike ?? false,
    side,
  );

  // News & fundamentals (optional — passed in if available)
  const news = input.news ?? null;
  const fundamentals = input.fundamentals ?? null;

  // Evidence hierarchy
  const evidence = buildHierarchicalEvidence(confluence, macro, crossAsset, derivatives, side, news, fundamentals);

  // Scenarios
  const scenarios = generateScenarios(side, confluence, evidence);

  // Dimension statuses
  const dimensions: DimensionStatus[] = [
    { dimension: "TECHNICAL", availability: confluence.overallQuality === "SUFFICIENT" ? "AVAILABLE" : confluence.overallQuality === "LIMITED" ? "LIMITED" : "INSUFFICIENT", description: "MTF technical analysis" },
    { dimension: "MACRO", availability: macro.availability, description: "Macro/risk regime" },
    { dimension: "CROSS_ASSET", availability: crossAsset.availability, description: "Cross-asset relationships" },
    { dimension: "DERIVATIVES", availability: derivatives.availability, description: "Crypto derivatives data" },
    { dimension: "NEWS", availability: news?.availability === "AVAILABLE" ? "AVAILABLE" : news?.availability === "LIMITED" ? "LIMITED" : "UNAVAILABLE", description: "News intelligence" },
    { dimension: "FUNDAMENTALS", availability: fundamentals?.availability === "AVAILABLE" ? "AVAILABLE" : fundamentals?.availability === "LIMITED" ? "LIMITED" : "UNAVAILABLE", description: "Fundamental/macro data" },
  ];

  // Evidence quality
  const primarySupport = evidence.filter((e) => e.tier === "PRIMARY" && e.direction === "SUPPORTING").length;
  const totalSupport = evidence.filter((e) => e.direction === "SUPPORTING").length;
  const totalConflict = evidence.filter((e) => e.direction === "CONFLICTING").length;

  let evidenceQuality: MultiDimensionalSynthesis["evidenceQuality"];
  if (primarySupport >= 2 && totalSupport >= 3) evidenceQuality = "STRONG_EVIDENCE";
  else if (primarySupport >= 1 || totalSupport >= 2) evidenceQuality = "MODERATE_EVIDENCE";
  else if (totalSupport >= 1) evidenceQuality = "WEAK_EVIDENCE";
  else evidenceQuality = "INSUFFICIENT_EVIDENCE";

  return {
    instrument,
    side,
    regime: confluence.regime,
    confluence,
    macro,
    crossAsset,
    derivatives,
    news,
    fundamentals,
    evidence,
    scenarios,
    dimensions,
    evidenceQuality,
    supportingDimensions: totalSupport,
    conflictingDimensions: totalConflict,
  };
}
