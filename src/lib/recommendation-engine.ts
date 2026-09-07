/**
 * Phase 49 — Universal Asset Discovery & Recommendation Engine
 *
 * A discovery/recommendation layer that consumes already-produced analysis
 * and intelligence to rank instruments across all asset classes.
 *
 * CRITICAL INVARIANTS:
 *   - This engine does NOT modify any existing decision hierarchy.
 *   - This engine does NOT create fake probabilities or win rates.
 *   - "confidence" means confidence in analytical quality, NOT probability of profit.
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing data REDUCES suitability; it never inflates it.
 *   - Same input + same timestamp = same output (deterministic).
 *   - No fabricated evidence, prices, fundamentals, or provider data.
 */

import type { AssetClass } from "./data/universal/types";
import { getAllInstruments, getProviderSymbol, type ResolutionStatus } from "./data/universal/instruments";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type TradingMode = "SCALPING" | "INTRADAY" | "SWING";

export type InvestorHorizon =
  | "1-4_WEEKS"
  | "1-3_MONTHS"
  | "3-6_MONTHS"
  | "6-12_MONTHS"
  | "1-3_YEARS"
  | "3+_YEARS";

export type RecommendationSuitability =
  | "TOP_OPPORTUNITY"
  | "WATCHLIST"
  | "NEUTRAL"
  | "EXCLUDED"
  | "INSUFFICIENT_DATA";

export type DataCompletenessLevel = "FULL" | "PARTIAL" | "MINIMAL" | "NONE";

export interface CandidateInput {
  /** Canonical instrument ID (e.g. "BTC/USD", "EUR/USD", "AAPL"). */
  instrument: string;
  /** Detected asset class. */
  assetClass: AssetClass;
  /** Current price (from last known data, 0 if unavailable). */
  currentPrice: number;
  /** Data completeness level. */
  dataCompleteness: DataCompletenessLevel;
  /** Number of data points available (e.g. candles). */
  dataPoints: number;
  /** Whether live market data is available. */
  hasLiveData: boolean;
  /** Data freshness: FRESH, DELAYED, STALE, UNAVAILABLE. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Provider coverage level from Phase 48. */
  providerCoverage: "FULL" | "PARTIAL" | "MINIMAL" | "NONE";

  // ── Market structure ──
  /** Higher-timeframe bias: "long", "short", "neutral", "unknown". */
  htfBias?: "long" | "short" | "neutral" | "unknown";
  /** Market regime: "TRENDING", "RANGING", "VOLATILE", "UNKNOWN". */
  marketRegime?: string;
  /** MTF alignment: "ALIGNED_BULLISH", "ALIGNED_BEARISH", "MIXED", "COUNTER_TREND", "INSUFFICIENT_DATA". */
  mtfAlignment?: string;
  /** Key support level (as number for comparison). */
  keySupport?: number;
  /** Key resistance level (as number for comparison). */
  keyResistance?: number;
  /** R:R ratio if trade plan available. */
  riskReward?: number;
  /** Spread in bps (execution quality). */
  spreadBps?: number;
  /** ATR or volatility measure. */
  atr?: number;

  // ── Asset-specific data (optional, populated per class) ──
  /** Open interest (crypto). */
  openInterest?: number;
  /** Funding rate (crypto). */
  fundingRate?: number;
  /** TVL (DeFi crypto). */
  tvl?: number;
  /** P/E ratio (equity). */
  peRatio?: number;
  /** Revenue growth (equity). */
  revenueGrowth?: number;
  /** Profit margin (equity). */
  profitMargin?: number;
  /** Market cap (equity). */
  marketCap?: number;
  /** Rate differential (forex). */
  rateDifferential?: number;
  /** Yield differential (forex). */
  yieldDifferential?: number;
  /** COT net non-commercial (forex/commodity). */
  cotNet?: number;
  /** Inventory (commodity). */
  inventory?: number;
  /** Inventory change weekly (commodity). */
  inventoryChange?: number;
  /** Futures structure (commodity): "contango", "backwardation", "flat", "unknown". */
  futuresStructure?: string;
  /** Seasonality pattern (commodity). */
  seasonality?: string;

  // ── DXY / cross-asset ──
  /** DXY trend (for forex/commodity). */
  dxyTrend?: "rising" | "falling" | "stable";
  /** Risk regime (cross-asset). */
  riskRegime?: string;

  // ── Dedup / scoring ──
  /** Dependency groups already counted (to avoid double-counting). */
  dependencyGroupsUsed?: string[];

  // ── Evaluation metadata ──
  /** Analysis result confidence (0-100) if analysis was run. */
  analysisConfidence?: number;
  /** Whether analysis result was available. */
  hasAnalysis?: boolean;
  /** Whether long-horizon thesis is available. */
  hasLongHorizonThesis?: boolean;
  /** Whether derivatives data is available. */
  hasDerivatives?: boolean;
  /** Whether fundamental data is available. */
  hasFundamentals?: boolean;
  /** Whether treasury/macro data is available. */
  hasMacro?: boolean;
  /** Whether COT data is available. */
  hasCOT?: boolean;
  /** Whether execution quality data is available. */
  hasExecutionQuality?: boolean;
}

export interface RankedInstrument {
  /** Canonical instrument ID. */
  instrument: string;
  /** Asset class. */
  assetClass: AssetClass;
  /** Rank position (1 = highest). */
  rank: number;
  /** Analytical score (0-100). Higher = stronger evidence for this horizon. */
  analyticalScore: number;
  /** Confidence in the analytical assessment (0-100). NOT probability of profit. */
  confidence: number;
  /** Suitability classification. */
  suitability: RecommendationSuitability;
  /** Primary reasons for this ranking. */
  primaryReasons: string[];
  /** Supporting evidence summary. */
  supportingEvidence: string[];
  /** Conflicting evidence summary. */
  conflictingEvidence: string[];
  /** Key risks for this instrument. */
  risks: string[];
  /** Conditions that would invalidate the thesis. */
  invalidationConditions: string[];
  /** Data completeness level. */
  dataCompleteness: DataCompletenessLevel;
  /** Data freshness. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Spread/execution quality (bps) if available. */
  executionQuality?: number;
  /** Recommended analysis type for deeper study. */
  recommendedAnalysisType: string;
  /** Provider coverage level. */
  providerCoverage: string;
}

export interface HorizonWeights {
  /** Weight for HTF structure. */
  htfStructure: number;
  /** Weight for MTF alignment. */
  mtfAlignment: number;
  /** Weight for market regime. */
  marketRegime: number;
  /** Weight for volatility/ATR. */
  volatility: number;
  /** Weight for liquidity/execution. */
  liquidity: number;
  /** Weight for fundamentals. */
  fundamentals: number;
  /** Weight for macro context. */
  macro: number;
  /** Weight for derivatives/positioning. */
  derivatives: number;
  /** Weight for data quality. */
  dataQuality: number;
  /** Weight for risk/reward structure. */
  riskReward: number;
}

export interface UniversalRecommendationResult {
  /** Requested trading mode or investment horizon. */
  horizon: TradingMode | InvestorHorizon;
  /** Mode type: "TRADING" or "INVESTING". */
  mode: "TRADING" | "INVESTING";
  /** Ranked instruments (highest score first). */
  rankedInstruments: RankedInstrument[];
  /** Instruments excluded from ranking with reasons. */
  excludedInstruments: { instrument: string; reason: string }[];
  /** Market overview summary. */
  marketOverview: string;
  /** Methodology description. */
  methodology: string;
  /** Data quality summary. */
  dataQualitySummary: string;
  /** Timestamp of this result. */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON PROFILES
// ═══════════════════════════════════════════════════════════════

const ZERO_WEIGHTS: HorizonWeights = {
  htfStructure: 0, mtfAlignment: 0, marketRegime: 0, volatility: 0,
  liquidity: 0, fundamentals: 0, macro: 0, derivatives: 0,
  dataQuality: 0, riskReward: 0,
};

function normalizeWeights(w: HorizonWeights): HorizonWeights {
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  if (total === 0) return w;
  const factor = 1 / total;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v * factor])) as unknown as HorizonWeights;
}

export const HORIZON_PROFILES: Record<TradingMode | InvestorHorizon, HorizonWeights> = {
  // ── Trading modes ──
  SCALPING: normalizeWeights({
    htfStructure: 5, mtfAlignment: 8, marketRegime: 4, volatility: 7,
    liquidity: 10, fundamentals: 0, macro: 2, derivatives: 3,
    dataQuality: 8, riskReward: 3,
  }),
  INTRADAY: normalizeWeights({
    htfStructure: 8, mtfAlignment: 9, marketRegime: 6, volatility: 5,
    liquidity: 7, fundamentals: 1, macro: 3, derivatives: 3,
    dataQuality: 6, riskReward: 5,
  }),
  SWING: normalizeWeights({
    htfStructure: 10, mtfAlignment: 7, marketRegime: 8, volatility: 4,
    liquidity: 5, fundamentals: 5, macro: 6, derivatives: 5,
    dataQuality: 5, riskReward: 7,
  }),

  // ── Investment horizons ──
  "1-4_WEEKS": normalizeWeights({
    htfStructure: 8, mtfAlignment: 6, marketRegime: 7, volatility: 4,
    liquidity: 5, fundamentals: 4, macro: 5, derivatives: 4,
    dataQuality: 5, riskReward: 6,
  }),
  "1-3_MONTHS": normalizeWeights({
    htfStructure: 9, mtfAlignment: 5, marketRegime: 8, volatility: 3,
    liquidity: 4, fundamentals: 7, macro: 7, derivatives: 4,
    dataQuality: 5, riskReward: 6,
  }),
  "3-6_MONTHS": normalizeWeights({
    htfStructure: 9, mtfAlignment: 3, marketRegime: 8, volatility: 2,
    liquidity: 3, fundamentals: 9, macro: 8, derivatives: 3,
    dataQuality: 6, riskReward: 5,
  }),
  "6-12_MONTHS": normalizeWeights({
    htfStructure: 8, mtfAlignment: 2, marketRegime: 7, volatility: 1,
    liquidity: 2, fundamentals: 10, macro: 9, derivatives: 2,
    dataQuality: 7, riskReward: 4,
  }),
  "1-3_YEARS": normalizeWeights({
    htfStructure: 7, mtfAlignment: 1, marketRegime: 6, volatility: 1,
    liquidity: 1, fundamentals: 10, macro: 8, derivatives: 1,
    dataQuality: 8, riskReward: 3,
  }),
  "3+_YEARS": normalizeWeights({
    htfStructure: 6, mtfAlignment: 1, marketRegime: 5, volatility: 1,
    liquidity: 1, fundamentals: 10, macro: 7, derivatives: 1,
    dataQuality: 9, riskReward: 2,
  }),
};

// ═══════════════════════════════════════════════════════════════
// DATA QUALITY GATE
// ═══════════════════════════════════════════════════════════════

function evaluateDataQuality(c: CandidateInput): { score: number; issues: string[] } {
  let score = 0;
  const issues: string[] = [];

  // Data completeness
  if (c.dataCompleteness === "FULL") score += 25;
  else if (c.dataCompleteness === "PARTIAL") score += 15;
  else if (c.dataCompleteness === "MINIMAL") { score += 5; issues.push("minimal data completeness"); }
  else { issues.push("no data available"); }

  // Freshness
  if (c.freshness === "FRESH") score += 25;
  else if (c.freshness === "DELAYED") score += 15;
  else if (c.freshness === "STALE") { score += 5; issues.push("stale data"); }
  else { issues.push("data freshness unavailable"); }

  // Live data
  if (c.hasLiveData) score += 15;
  else issues.push("no live market data");

  // Provider coverage
  if (c.providerCoverage === "FULL") score += 15;
  else if (c.providerCoverage === "PARTIAL") score += 10;
  else if (c.providerCoverage === "MINIMAL") { score += 5; issues.push("minimal provider coverage"); }
  else { issues.push("no provider coverage"); }

  // Data points
  if (c.dataPoints >= 100) score += 10;
  else if (c.dataPoints >= 20) score += 5;
  else if (c.dataPoints > 0) score += 2;
  else issues.push("insufficient data points");

  // Current price validity
  if (c.currentPrice > 0) score += 10;
  else issues.push("price unavailable");

  return { score: Math.min(100, score), issues };
}

// ═══════════════════════════════════════════════════════════════
// ASSET-CLASS-SPECIFIC SCORING
// ═══════════════════════════════════════════════════════════════

interface ScoreComponent {
  weight: number;
  score: number;
  reason: string;
}

function scoreCrypto(c: CandidateInput): ScoreComponent[] {
  const components: ScoreComponent[] = [];

  // HTF structure
  if (c.htfBias === "long" || c.htfBias === "short") {
    components.push({ weight: 10, score: 80, reason: `HTF ${c.htfBias} structure` });
  } else if (c.htfBias === "neutral") {
    components.push({ weight: 10, score: 40, reason: "HTF neutral/ranging" });
  }

  // MTF alignment
  if (c.mtfAlignment === "ALIGNED_BULLISH" || c.mtfAlignment === "ALIGNED_BEARISH") {
    components.push({ weight: 9, score: 85, reason: "MTF aligned" });
  } else if (c.mtfAlignment === "MIXED") {
    components.push({ weight: 9, score: 35, reason: "MTF mixed signals" });
  }

  // Market regime
  if (c.marketRegime === "TRENDING") {
    components.push({ weight: 7, score: 75, reason: "trending regime" });
  } else if (c.marketRegime === "RANGING") {
    components.push({ weight: 7, score: 40, reason: "ranging regime" });
  }

  // Volatility (ATR context)
  if (c.atr && c.atr > 0) {
    components.push({ weight: 5, score: 60, reason: "volatility data available" });
  }

  // Derivatives
  if (c.hasDerivatives) {
    components.push({ weight: 6, score: 55, reason: "derivatives data available" });
  }

  // Funding rate as positioning context (not directional)
  if (c.fundingRate !== undefined) {
    components.push({ weight: 3, score: 50, reason: "funding rate context available" });
  }

  // Liquidity / execution
  if (c.hasExecutionQuality) {
    components.push({ weight: 6, score: 60, reason: "execution quality data" });
  }

  // R:R
  if (c.riskReward && c.riskReward > 0) {
    const rrScore = Math.min(90, 30 + c.riskReward * 20);
    components.push({ weight: 4, score: rrScore, reason: `R:R ${c.riskReward.toFixed(1)}` });
  }

  // Analysis confidence
  if (c.hasAnalysis && c.analysisConfidence) {
    components.push({ weight: 5, score: c.analysisConfidence, reason: "analysis available" });
  }

  return components;
}

function scoreForex(c: CandidateInput): ScoreComponent[] {
  const components: ScoreComponent[] = [];

  // HTF structure
  if (c.htfBias === "long" || c.htfBias === "short") {
    components.push({ weight: 10, score: 80, reason: `HTF ${c.htfBias} structure` });
  } else if (c.htfBias === "neutral") {
    components.push({ weight: 10, score: 40, reason: "HTF neutral" });
  }

  // MTF alignment
  if (c.mtfAlignment === "ALIGNED_BULLISH" || c.mtfAlignment === "ALIGNED_BEARISH") {
    components.push({ weight: 9, score: 85, reason: "MTF aligned" });
  } else if (c.mtfAlignment === "MIXED") {
    components.push({ weight: 9, score: 35, reason: "MTF mixed" });
  }

  // Rate differential
  if (c.rateDifferential !== undefined && c.rateDifferential !== 0) {
    components.push({ weight: 8, score: 65, reason: `rate diff ${c.rateDifferential}bp` });
  }

  // Yield differential
  if (c.yieldDifferential !== undefined && c.yieldDifferential !== 0) {
    components.push({ weight: 7, score: 60, reason: `yield diff ${c.yieldDifferential}bp` });
  }

  // COT positioning
  if (c.hasCOT && c.cotNet !== undefined) {
    components.push({ weight: 5, score: 55, reason: "COT positioning data" });
  }

  // DXY context
  if (c.dxyTrend) {
    components.push({ weight: 6, score: 55, reason: `DXY ${c.dxyTrend}` });
  }

  // Risk regime
  if (c.riskRegime) {
    components.push({ weight: 5, score: 50, reason: "cross-asset risk context" });
  }

  // Market regime
  if (c.marketRegime === "TRENDING") {
    components.push({ weight: 7, score: 75, reason: "trending regime" });
  } else if (c.marketRegime === "RANGING") {
    components.push({ weight: 7, score: 40, reason: "ranging regime" });
  }

  // Analysis
  if (c.hasAnalysis && c.analysisConfidence) {
    components.push({ weight: 5, score: c.analysisConfidence, reason: "analysis available" });
  }

  return components;
}

function scoreEquity(c: CandidateInput): ScoreComponent[] {
  const components: ScoreComponent[] = [];

  // HTF structure
  if (c.htfBias === "long" || c.htfBias === "short") {
    components.push({ weight: 8, score: 75, reason: `HTF ${c.htfBias} structure` });
  }

  // Fundamentals
  if (c.hasFundamentals) {
    components.push({ weight: 9, score: 65, reason: "fundamental data available" });
  }
  if (c.peRatio !== undefined && c.peRatio > 0) {
    const peScore = c.peRatio < 15 ? 80 : c.peRatio < 25 ? 65 : c.peRatio < 40 ? 50 : 35;
    components.push({ weight: 5, score: peScore, reason: `P/E ${c.peRatio.toFixed(1)}` });
  }
  if (c.revenueGrowth !== undefined) {
    const rgScore = c.revenueGrowth > 0.2 ? 85 : c.revenueGrowth > 0.1 ? 70 : c.revenueGrowth > 0 ? 55 : 30;
    components.push({ weight: 5, score: rgScore, reason: `revenue growth ${(c.revenueGrowth * 100).toFixed(1)}%` });
  }
  if (c.profitMargin !== undefined) {
    const pmScore = c.profitMargin > 0.2 ? 80 : c.profitMargin > 0.1 ? 65 : 45;
    components.push({ weight: 4, score: pmScore, reason: `margin ${(c.profitMargin * 100).toFixed(1)}%` });
  }

  // Market regime
  if (c.marketRegime === "TRENDING") {
    components.push({ weight: 6, score: 70, reason: "trending regime" });
  }

  // Macro
  if (c.hasMacro) {
    components.push({ weight: 5, score: 50, reason: "macro context available" });
  }

  // Analysis
  if (c.hasAnalysis && c.analysisConfidence) {
    components.push({ weight: 5, score: c.analysisConfidence, reason: "analysis available" });
  }

  return components;
}

function scoreCommodity(c: CandidateInput): ScoreComponent[] {
  const components: ScoreComponent[] = [];

  // HTF structure
  if (c.htfBias === "long" || c.htfBias === "short") {
    components.push({ weight: 9, score: 75, reason: `HTF ${c.htfBias} structure` });
  }

  // Inventory
  if (c.inventory !== undefined) {
    components.push({ weight: 7, score: 60, reason: "inventory data available" });
  }
  if (c.inventoryChange !== undefined) {
    components.push({ weight: 5, score: 55, reason: `inventory change ${c.inventoryChange}` });
  }

  // Futures structure
  if (c.futuresStructure && c.futuresStructure !== "unknown") {
    components.push({ weight: 6, score: 60, reason: `futures ${c.futuresStructure}` });
  }

  // COT
  if (c.hasCOT && c.cotNet !== undefined) {
    components.push({ weight: 5, score: 55, reason: "COT data" });
  }

  // DXY
  if (c.dxyTrend) {
    components.push({ weight: 6, score: 55, reason: `DXY ${c.dxyTrend}` });
  }

  // Seasonality
  if (c.seasonality) {
    components.push({ weight: 4, score: 50, reason: "seasonality context" });
  }

  // Market regime
  if (c.marketRegime === "TRENDING") {
    components.push({ weight: 6, score: 70, reason: "trending regime" });
  }

  // Analysis
  if (c.hasAnalysis && c.analysisConfidence) {
    components.push({ weight: 5, score: c.analysisConfidence, reason: "analysis available" });
  }

  return components;
}

function scoreIndex(c: CandidateInput): ScoreComponent[] {
  const components: ScoreComponent[] = [];

  // HTF structure
  if (c.htfBias === "long" || c.htfBias === "short") {
    components.push({ weight: 10, score: 75, reason: `HTF ${c.htfBias} structure` });
  }

  // Market regime
  if (c.marketRegime === "TRENDING") {
    components.push({ weight: 8, score: 75, reason: "trending regime" });
  } else if (c.marketRegime === "RANGING") {
    components.push({ weight: 8, score: 40, reason: "ranging regime" });
  }

  // Macro
  if (c.hasMacro) {
    components.push({ weight: 7, score: 55, reason: "macro context" });
  }

  // DXY
  if (c.dxyTrend) {
    components.push({ weight: 5, score: 50, reason: `DXY ${c.dxyTrend}` });
  }

  // Analysis
  if (c.hasAnalysis && c.analysisConfidence) {
    components.push({ weight: 5, score: c.analysisConfidence, reason: "analysis available" });
  }

  return components;
}

function scoreMacro(c: CandidateInput): ScoreComponent[] {
  const components: ScoreComponent[] = [];

  if (c.hasMacro) {
    components.push({ weight: 10, score: 60, reason: "macro data available" });
  }
  if (c.dxyTrend) {
    components.push({ weight: 8, score: 55, reason: `DXY ${c.dxyTrend}` });
  }
  if (c.riskRegime) {
    components.push({ weight: 7, score: 50, reason: "risk regime context" });
  }

  return components;
}

function getAssetClassScore(c: CandidateInput): ScoreComponent[] {
  switch (c.assetClass) {
    case "crypto": return scoreCrypto(c);
    case "forex": return scoreForex(c);
    case "equity": return scoreEquity(c);
    case "commodity": return scoreCommodity(c);
    case "indices": return scoreIndex(c);
    case "macro": return scoreMacro(c);
    default: return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// SCORING ENGINE
// ═══════════════════════════════════════════════════════════════

export function scoreCandidate(
  c: CandidateInput,
  horizon: TradingMode | InvestorHorizon,
): { analyticalScore: number; confidence: number; reasons: string[]; conflicts: string[] } {
  const weights = HORIZON_PROFILES[horizon];
  const assetComponents = getAssetClassScore(c);

  // Compute data quality component
  const dq = evaluateDataQuality(c);

  const reasons: string[] = [];
  const conflicts: string[] = [];

  for (const comp of assetComponents) {
    if (comp.score >= 60) reasons.push(comp.reason);
    else if (comp.score < 40) conflicts.push(comp.reason);
  }

  // Apply horizon weights to asset-class evidence.
  // Every matching evidence item contributes independently according to
  // its declared component weight and the horizon weight for its category.
  let horizonAdjusted = 0;
  let horizonWeightSum = 0;

  // Data quality component
  horizonAdjusted += dq.score * weights.dataQuality;
  horizonWeightSum += weights.dataQuality;

  const addEvidence = (
    components: ScoreComponent[],
    categoryWeight: number,
    matcher: (reason: string) => boolean,
  ) => {
    if (categoryWeight <= 0) return;

    for (const comp of components) {
      if (!matcher(comp.reason)) continue;

      const effectiveWeight = (comp.weight / 10) * categoryWeight;
      horizonAdjusted += comp.score * effectiveWeight;
      horizonWeightSum += effectiveWeight;
    }
  };

  // HTF structure
  addEvidence(assetComponents, weights.htfStructure, (reason) =>
    reason.includes("HTF"),
  );

  // MTF alignment
  addEvidence(assetComponents, weights.mtfAlignment, (reason) =>
    reason.includes("MTF"),
  );

  // Market regime
  addEvidence(assetComponents, weights.marketRegime, (reason) =>
    reason.includes("regime"),
  );

  // Volatility
  if (c.atr && c.atr > 0) {
    horizonAdjusted += 60 * weights.volatility;
    horizonWeightSum += weights.volatility;
  }

  // Liquidity
  if (c.hasExecutionQuality || c.spreadBps !== undefined) {
    const liqScore = c.spreadBps !== undefined && c.spreadBps < 5 ? 85 : c.spreadBps !== undefined && c.spreadBps < 15 ? 65 : 50;
    horizonAdjusted += liqScore * weights.liquidity;
    horizonWeightSum += weights.liquidity;
  }

  // Fundamentals
  addEvidence(
    assetComponents,
    weights.fundamentals,
    (reason) =>
      reason.includes("fundamental") ||
      reason.includes("P/E") ||
      reason.includes("revenue") ||
      reason.includes("margin"),
  );

  // Macro
  addEvidence(
    assetComponents,
    weights.macro,
    (reason) =>
      reason.includes("macro") ||
      reason.includes("DXY") ||
      reason.includes("risk") ||
      reason.includes("rate diff") ||
      reason.includes("yield diff"),
  );

  // Derivatives
  addEvidence(
    assetComponents,
    weights.derivatives,
    (reason) =>
      reason.includes("derivatives") ||
      reason.includes("funding") ||
      reason.includes("COT"),
  );

  // R:R
  if (c.riskReward && c.riskReward > 0) {
    const rrScore = Math.min(90, 30 + c.riskReward * 20);
    horizonAdjusted += rrScore * weights.riskReward;
    horizonWeightSum += weights.riskReward;
  }

  // Analysis confidence
  if (c.hasAnalysis && c.analysisConfidence) {
    horizonAdjusted += c.analysisConfidence * 5;
    horizonWeightSum += 5;
  }

  const analyticalScore = horizonWeightSum > 0
    ? Math.round(Math.min(100, horizonAdjusted / horizonWeightSum))
    : 0;

  // Confidence: based on data quality + evidence coherence
  const dqConfidence = dq.score;
  const evidenceCoherence = assetComponents.length > 0
    ? Math.min(100, (reasons.length / Math.max(1, assetComponents.length)) * 100)
    : 0;
  const confidence = Math.round((dqConfidence * 0.5 + evidenceCoherence * 0.3 + (analyticalScore > 0 ? 20 : 0)));

  if (dq.issues.length > 0) {
    conflicts.push(...dq.issues);
  }

  return {
    analyticalScore,
    confidence: Math.min(100, confidence),
    reasons,
    conflicts,
  };
}

// ═══════════════════════════════════════════════════════════════
// ELIGIBILITY FILTERING
// ═══════════════════════════════════════════════════════════════

export function isEligible(c: CandidateInput, horizon: TradingMode | InvestorHorizon): { eligible: boolean; reason?: string } {
  // Must have a valid instrument
  if (!c.instrument) return { eligible: false, reason: "no instrument" };

  // Must have some data
  if (c.dataCompleteness === "NONE") return { eligible: false, reason: "no data available" };

  // Price must be valid (positive finite number)
  if (!Number.isFinite(c.currentPrice) || c.currentPrice <= 0) return { eligible: false, reason: "price unavailable" };

  // Freshness gate
  if (c.freshness === "UNAVAILABLE") return { eligible: false, reason: "data freshness unavailable" };

  // For scalping: require live data and reasonable execution quality
  if (horizon === "SCALPING") {
    if (!c.hasLiveData) return { eligible: false, reason: "scalping requires live data" };
    if (c.spreadBps !== undefined && c.spreadBps > 50) return { eligible: false, reason: "spread too wide for scalping" };
  }

  // For intraday: require at least delayed data
  if (horizon === "INTRADAY") {
    if (c.freshness === "STALE") return { eligible: false, reason: "stale data insufficient for intraday" };
  }

  // Provider coverage gate
  if (c.providerCoverage === "NONE") return { eligible: false, reason: "no provider coverage" };

  return { eligible: true };
}

// ═══════════════════════════════════════════════════════════════
// SUITABILITY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifySuitability(
  analyticalScore: number,
  confidence: number,
  dataCompleteness: DataCompletenessLevel,
): RecommendationSuitability {
  if (dataCompleteness === "NONE") return "INSUFFICIENT_DATA";
  if (dataCompleteness === "MINIMAL" && analyticalScore < 50) return "INSUFFICIENT_DATA";

  if (analyticalScore >= 70 && confidence >= 50) return "TOP_OPPORTUNITY";
  if (analyticalScore >= 50 && confidence >= 35) return "WATCHLIST";
  if (analyticalScore >= 30) return "NEUTRAL";
  return "NEUTRAL";
}

// ═══════════════════════════════════════════════════════════════
// CANDIDATE DISCOVERY
// ═══════════════════════════════════════════════════════════════

export function discoverCandidates(
  instrumentTypes?: AssetClass[],
): { instrument: string; assetClass: AssetClass }[] {
  const allIds = getAllInstruments().map(i => i.canonical);
  const candidates: { instrument: string; assetClass: AssetClass }[] = [];

  for (const id of allIds) {
    const resolved = resolveInstrument(id) ?? undefined;
    if (!resolved) continue;
    if (instrumentTypes && !instrumentTypes.includes(resolved.assetClass)) continue;
    candidates.push({ instrument: id, assetClass: resolved.assetClass });
  }

  return candidates;
}

// Re-export resolveInstrument for convenience
import { resolveInstrument } from "./data/universal/instruments";

// ═══════════════════════════════════════════════════════════════
// MAIN RECOMMENDATION ENGINE
// ═══════════════════════════════════════════════════════════════

export function generateRecommendation(
  candidates: CandidateInput[],
  horizon: TradingMode | InvestorHorizon,
  options?: { maxResults?: number },
): UniversalRecommendationResult {
  const now = Date.now();
  const maxResults = options?.maxResults ?? 20;
  const isTradingMode = horizon === "SCALPING" || horizon === "INTRADAY" || horizon === "SWING";

  const rankedInstruments: RankedInstrument[] = [];
  const excludedInstruments: { instrument: string; reason: string }[] = [];

  // Score and filter each candidate
  const scored: { input: CandidateInput; result: ReturnType<typeof scoreCandidate> }[] = [];

  for (const c of candidates) {
    const eligibility = isEligible(c, horizon);
    if (!eligibility.eligible) {
      excludedInstruments.push({ instrument: c.instrument, reason: eligibility.reason! });
      continue;
    }

    const result = scoreCandidate(c, horizon);
    scored.push({ input: c, result });
  }

  // Sort by analyticalScore (descending), then confidence, then instrument name (deterministic tiebreak)
  scored.sort((a, b) => {
    if (b.result.analyticalScore !== a.result.analyticalScore) return b.result.analyticalScore - a.result.analyticalScore;
    if (b.result.confidence !== a.result.confidence) return b.result.confidence - a.result.confidence;
    return a.input.instrument.localeCompare(b.input.instrument);
  });

  // Take top N and format
  for (let i = 0; i < Math.min(scored.length, maxResults); i++) {
    const { input: c, result } = scored[i];
    const suitability = classifySuitability(result.analyticalScore, result.confidence, c.dataCompleteness);

    const recommendedType = isTradingMode
      ? horizon === "SCALPING" ? "M5/M15 analysis" : horizon === "INTRADAY" ? "H1/H4 analysis" : "D1/W1 analysis"
      : horizon.includes("YEARS") ? "D1/W1 long-horizon thesis" : "D1/H4 analysis";

    rankedInstruments.push({
      instrument: c.instrument,
      assetClass: c.assetClass,
      rank: i + 1,
      analyticalScore: result.analyticalScore,
      confidence: result.confidence,
      suitability,
      primaryReasons: result.reasons.slice(0, 5),
      supportingEvidence: result.reasons,
      conflictingEvidence: result.conflicts,
      risks: result.conflicts.filter(c => c.includes("stale") || c.includes("unavailable") || c.includes("minimal")),
      invalidationConditions: [
        ...result.conflicts.filter(c => c.includes("unavailable")),
        "structural reversal on HTF",
      ],
      dataCompleteness: c.dataCompleteness,
      freshness: c.freshness,
      executionQuality: c.spreadBps,
      recommendedAnalysisType: recommendedType,
      providerCoverage: c.providerCoverage,
    });
  }

  // Build summaries
  const topCount = rankedInstruments.filter(r => r.suitability === "TOP_OPPORTUNITY").length;
  const watchCount = rankedInstruments.filter(r => r.suitability === "WATCHLIST").length;
  const avgScore = rankedInstruments.length > 0
    ? Math.round(rankedInstruments.reduce((s, r) => s + r.analyticalScore, 0) / rankedInstruments.length)
    : 0;

  const marketOverview = rankedInstruments.length === 0
    ? "No suitable instruments found for the requested horizon. Consider broadening data sources or adjusting the horizon."
    : `${rankedInstruments.length} instruments evaluated. ${topCount} top opportunities, ${watchCount} watchlist candidates. Average analytical score: ${avgScore}/100.`;

  const methodology = `Analytical scoring based on ${isTradingMode ? "trading" : "investment"} horizon profile weights applied to asset-class-specific evidence (structure, regime, fundamentals, macro, derivatives, data quality). Confidence reflects analytical coherence, NOT probability of profit.`;

  const dataQualitySummary = (() => {
    const full = candidates.filter(c => c.dataCompleteness === "FULL").length;
    const partial = candidates.filter(c => c.dataCompleteness === "PARTIAL").length;
    const minimal = candidates.filter(c => c.dataCompleteness === "MINIMAL").length;
    const none = candidates.filter(c => c.dataCompleteness === "NONE").length;
    return `${candidates.length} candidates: ${full} full, ${partial} partial, ${minimal} minimal, ${none} none data quality.`;
  })();

  return {
    horizon,
    mode: isTradingMode ? "TRADING" : "INVESTING",
    rankedInstruments,
    excludedInstruments,
    marketOverview,
    methodology,
    dataQualitySummary,
    timestamp: now,
  };
}
