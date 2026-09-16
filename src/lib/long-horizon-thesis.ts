/**
 * Phase 35 — LONG-HORIZON MARKET & INVESTMENT THESIS.
 *
 * Pure derivation from existing engine outputs. This module reasons about
 * the larger market structure, cycle context, thesis vs counter-thesis,
 * and produces investor-vs-trader interpretations from the SAME evidence.
 *
 * CRITICAL DESIGN PRINCIPLES:
 *   1. CURRENT DIRECTION ≠ FUTURE CONFIRMATION
 *   2. This is NOT a prediction engine
 *   3. This is NOT a second decision engine
 *   4. All fields are derived from existing engine outputs
 *   5. Cannot modify bias, conviction, gates, trade plan, or recommendation
 *   6. No probability / win-rate / guarantee language
 *   7. No fabricated valuation
 *   8. No synthetic price targets
 *   9. Mature trend ≠ automatic reversal
 *  10. Correction ≠ confirmed reversal
 *  11. Missing data remains neutral
 */

import type { AnalysisResult } from "@/types/analysis";
import type { MarketRegimeContext } from "@/lib/market-regime";
import type { FundamentalThesis } from "@/lib/fundamental-thesis";
import type { ForwardMarketPathContext } from "@/lib/forward-market-path";

// ── Types ────────────────────────────────────────────────────────

export type MarketCycle =
  | "ACCUMULATION_CONTEXT"
  | "EARLY_EXPANSION"
  | "TREND_EXPANSION"
  | "MATURE_TREND"
  | "LATE_TREND"
  | "DISTRIBUTION_CONTEXT"
  | "CORRECTION"
  | "RANGE"
  | "TRANSITION"
  | "UNCONFIRMED";

export type ThesisStatus =
  | "STRONGLY_SUPPORTED"
  | "SUPPORTED"
  | "MIXED"
  | "CONFLICTED"
  | "VALUATION_UNAVAILABLE"
  | "INSUFFICIENT_DATA";

export type StructuralContextLevel =
  | "STRONG_UPTREND"
  | "HEALTHY_UPTREND"
  | "WEAKENING_UPTREND"
  | "STRONG_DOWNTREND"
  | "HEALTHY_DOWNTREND"
  | "WEAKENING_DOWNTREND"
  | "RANGE"
  | "TRANSITION"
  | "UNCONFIRMED";

export interface LongHorizonEvidence {
  source: string;
  category: "structural" | "fundamental" | "macro" | "valuation" | "regime" | "liquidity";
  explanation: string;
  direction: "supportive" | "conflicting" | "neutral" | "unavailable";
  weight: "high" | "moderate" | "low";
}

export interface LongHorizonThesis {
  // Context
  marketCycle: MarketCycle;
  structuralContext: StructuralContextLevel;
  thesisStatus: ThesisStatus;

  // Market context summary
  marketCycleContext: string;
  structuralSummary: string;
  valuationContext: string;
  macroContext: string;
  fundamentalContext: string;

  // Thesis
  primaryThesis: string;
  counterThesis: string;

  // Evidence
  supportingEvidence: LongHorizonEvidence[];
  conflictingEvidence: LongHorizonEvidence[];

  // Scenarios
  primaryScenario: string;
  alternateScenario: string;

  // Conditions
  confirmationConditions: string[];
  invalidationConditions: string[];

  // Risks & missing
  thesisRisks: string[];
  missingInformation: string[];

  // Views
  investorImplication: string;
  traderImplication: string;

  // Summary
  rationale: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function dirBias(result: AnalysisResult): "bullish" | "bearish" | "neutral" {
  if (result.bias === "Bullish") return "bullish";
  if (result.bias === "Bearish") return "bearish";
  return "neutral";
}

function htfDir(result: AnalysisResult): "bullish" | "bearish" | "neutral" {
  if (!result.htfAlignment) return "neutral";
  if (result.htfAlignment.htfStructure === "HH/HL") return "bullish";
  if (result.htfAlignment.htfStructure === "LH/LL") return "bearish";
  return "neutral";
}

function mtfAligned(result: AnalysisResult, dir: "bullish" | "bearish"): boolean {
  if (!result.mtfSummary) return false;
  if (dir === "bullish") return result.mtfSummary.alignment === "ALIGNED_BULLISH";
  if (dir === "bearish") return result.mtfSummary.alignment === "ALIGNED_BEARISH";
  return false;
}

function hasContraMtf(result: AnalysisResult, dir: "bullish" | "bearish"): boolean {
  if (!result.mtfSummary) return false;
  if (dir === "bullish") return result.mtfSummary.alignment === "ALIGNED_BEARISH" || result.mtfSummary.alignment === "COUNTER_TREND";
  if (dir === "bearish") return result.mtfSummary.alignment === "ALIGNED_BULLISH" || result.mtfSummary.alignment === "COUNTER_TREND";
  return false;
}

function dataQualityOk(result: AnalysisResult): boolean {
  if (!result.dataQualityContext) return true;
  return result.dataQualityContext.primaryData.status === "GOOD";
}

// ── Market Cycle ─────────────────────────────────────────────────

function classifyMarketCycle(
  result: AnalysisResult,
  regime?: MarketRegimeContext,
): MarketCycle {
  const dir = dirBias(result);
  const htf = htfDir(result);
  const phase = regime?.marketPhase;
  const quality = regime?.continuationQuality;

  if (dir === "neutral" || (htf === "neutral" && !phase)) {
    return regime?.regime === "RANGE" ? "RANGE" : "UNCONFIRMED";
  }

  // Phase-based classification
  // Quality-based overrides first (before TypeScript narrows through phase checks)
  if (quality === "EXHAUSTED") return "LATE_TREND";
  if (quality === "DEVELOPING" && phase === "TREND_MATURE") return "MATURE_TREND";

  // Phase-based classification
  if (phase === "CORRECTION") return "CORRECTION";
  if (phase === "REVERSAL_ATTEMPT") return "TRANSITION";
  if (phase === "RANGE_BALANCE") return "RANGE";
  if (phase === "EARLY_TREND") return "EARLY_EXPANSION";
  if (phase === "LATE_TREND") return "LATE_TREND";
  if (phase === "BREAKOUT_ATTEMPT" || phase === "BREAKDOWN_ATTEMPT") return "EARLY_EXPANSION";

  // Breakout regime
  if (regime?.regime === "BREAKOUT_DEVELOPING" || regime?.regime === "BREAKDOWN_DEVELOPING") {
    return "EARLY_EXPANSION";
  }

  // Default trend-based
  if (htf === dir && quality === "STRONG") return "TREND_EXPANSION";
  if (htf === dir) return "TREND_EXPANSION";

  // Accumulation (range transitioning)
  if (regime?.regime === "ACCUMULATION") return "ACCUMULATION_CONTEXT";
  if (regime?.regime === "DISTRIBUTION") return "DISTRIBUTION_CONTEXT";

  return "UNCONFIRMED";
}

// ── Structural Context ───────────────────────────────────────────

function classifyStructuralContext(
  result: AnalysisResult,
  regime?: MarketRegimeContext,
): StructuralContextLevel {
  const dir = dirBias(result);
  const htf = htfDir(result);
  const quality = regime?.continuationQuality;
  const contra = hasContraMtf(result, dir === "neutral" ? "bullish" : dir);

  if (dir === "neutral" && htf === "neutral") {
    return regime?.regime === "RANGE" ? "RANGE" : "UNCONFIRMED";
  }

  const effectiveDir = htf !== "neutral" ? htf : dir;

  if (effectiveDir === "bullish") {
    if (contra || quality === "EXHAUSTED") return "WEAKENING_UPTREND";
    if (quality === "STRONG" || quality === "HEALTHY") return "HEALTHY_UPTREND";
    if (quality === "DEVELOPING") return "STRONG_UPTREND";
    return "HEALTHY_UPTREND";
  }

  if (effectiveDir === "bearish") {
    if (contra || quality === "EXHAUSTED") return "WEAKENING_DOWNTREND";
    if (quality === "STRONG" || quality === "HEALTHY") return "HEALTHY_DOWNTREND";
    if (quality === "DEVELOPING") return "STRONG_DOWNTREND";
    return "HEALTHY_DOWNTREND";
  }

  if (regime?.regime === "RANGE") return "RANGE";
  return "UNCONFIRMED";
}

// ── Evidence Assembly ─────────────────────────────────────────────

function buildSupportingEvidence(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  regime?: MarketRegimeContext,
  fundamental?: FundamentalThesis,
): LongHorizonEvidence[] {
  const evidence: LongHorizonEvidence[] = [];

  if (dir === "neutral") return evidence;

  // HTF structure
  if (htfDir(result) === dir) {
    evidence.push({
      source: "HTF structure",
      category: "structural",
      explanation: `Higher-timeframe structure is ${dir === "bullish" ? "bullish (HH/HL)" : "bearish (LH/LL)"}`,
      direction: "supportive",
      weight: "high",
    });
  }

  // MTF alignment
  if (mtfAligned(result, dir)) {
    evidence.push({
      source: "MTF alignment",
      category: "structural",
      explanation: "Multi-timeframe structure aligns with directional bias",
      direction: "supportive",
      weight: "high",
    });
  }

  // Regime
  if (regime) {
    if (regime.continuationQuality === "STRONG" || regime.continuationQuality === "HEALTHY") {
      evidence.push({
        source: "Market regime",
        category: "regime",
        explanation: `Continuation quality is ${regime.continuationQuality.toLowerCase()} — trend has structural support`,
        direction: "supportive",
        weight: "moderate",
      });
    }
    if (regime.marketPhase === "TREND_MATURE" || regime.marketPhase === "EARLY_TREND") {
      evidence.push({
        source: "Trend phase",
        category: "regime",
        explanation: `Market phase: ${regime.marketPhase.replace(/_/g, " ").toLowerCase()}`,
        direction: "supportive",
        weight: "moderate",
      });
    }
  }

  // Fundamental
  if (fundamental && (fundamental.alignment === "STRONGLY_ALIGNED" || fundamental.alignment === "ALIGNED")) {
    evidence.push({
      source: "Fundamental context",
      category: "fundamental",
      explanation: fundamental.analystSummary,
      direction: "supportive",
      weight: "moderate",
    });
  }

  // Phase 42 — Crypto intelligence supporting evidence
  const ci = result.cryptoIntelligenceContext;
  if (ci) {
    if (ci.defi?.tvl && ci.defi.tvl.reliable && ci.defi.tvl.change7d !== undefined && ci.defi.tvl.change7d > 5) {
      evidence.push({
        source: "DeFi TVL",
        category: "liquidity",
        explanation: `TVL expanding (+${ci.defi.tvl.change7d.toFixed(1)}% 7d) — protocol activity is growing. This provides supportive fundamental context for long-horizon assessment, but does not independently establish future price direction.`,
        direction: "supportive",
        weight: "moderate",
      });
    }
    if (ci.defi?.fees && ci.defi.fees.reliable) {
      evidence.push({
        source: "Protocol fees",
        category: "liquidity",
        explanation: `Fee activity observable — protocol usage is generating revenue. This is a fundamental health indicator, not a directional price signal.`,
        direction: "supportive",
        weight: "low",
      });
    }
    if (ci.tokenomics && !ci.tokenomics.unlocks?.upcomingCount30d) {
      evidence.push({
        source: "Tokenomics",
        category: "liquidity",
        explanation: "No significant token unlock events within 30 days — no immediate supply-side pressure from vesting. This is informational, not automatically bullish.",
        direction: "supportive",
        weight: "low",
      });
    }
    if (ci.derivatives?.fundingRate && !ci.derivatives.fundingRate.isExtreme && ci.derivatives.fundingRate.reliable) {
      evidence.push({
        source: "Derivatives funding",
        category: "liquidity",
        explanation: `Funding rate is moderate (${(ci.derivatives.fundingRate.currentRate * 100).toFixed(4)}%) — derivatives positioning is not stretched. This provides constructive context.`,
        direction: "supportive",
        weight: "low",
      });
    }
  }

  return evidence;
}

function buildConflictingEvidence(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  regime?: MarketRegimeContext,
  fundamental?: FundamentalThesis,
): LongHorizonEvidence[] {
  const evidence: LongHorizonEvidence[] = [];

  if (dir === "neutral") return evidence;

  // Opposing HTF
  const htf = htfDir(result);
  if (htf !== dir && htf !== "neutral") {
    evidence.push({
      source: "HTF structure",
      category: "structural",
      explanation: `Higher-timeframe structure conflicts: ${htf} vs current ${dir}`,
      direction: "conflicting",
      weight: "high",
    });
  }

  // Counter MTF
  if (hasContraMtf(result, dir)) {
    evidence.push({
      source: "MTF conflict",
      category: "structural",
      explanation: "Counter-trend multi-timeframe evidence detected",
      direction: "conflicting",
      weight: "high",
    });
  }

  // Exhaustion
  if (regime?.exhaustionSignals && regime.exhaustionSignals.length > 0) {
    evidence.push({
      source: "Exhaustion signals",
      category: "regime",
      explanation: `${regime.exhaustionSignals.length} exhaustion signal(s) — continuation may be weakening`,
      direction: "conflicting",
      weight: "moderate",
    });
  }

  // Weak/exhausted continuation
  if (regime?.continuationQuality === "WEAK" || regime?.continuationQuality === "EXHAUSTED") {
    evidence.push({
      source: "Continuation quality",
      category: "regime",
      explanation: `Continuation quality: ${regime.continuationQuality.toLowerCase()} — trend durability is questionable`,
      direction: "conflicting",
      weight: "moderate",
    });
  }

  // Fundamental conflict
  if (fundamental?.alignment === "CONFLICTING") {
    evidence.push({
      source: "Fundamental conflict",
      category: "fundamental",
      explanation: fundamental.analystSummary,
      direction: "conflicting",
      weight: "moderate",
    });
  }

  // Fundamental unavailable
  if (fundamental?.alignment === "FUNDAMENTAL_UNAVAILABLE") {
    evidence.push({
      source: "Fundamental data",
      category: "fundamental",
      explanation: "Fundamental/macro context unavailable — thesis is technical-led only",
      direction: "unavailable",
      weight: "low",
    });
  }

  // Phase 42 — Crypto intelligence conflicting evidence
  const ci = result.cryptoIntelligenceContext;
  if (ci) {
    if (ci.derivatives?.fundingRate?.isExtreme && ci.derivatives.fundingRate.reliable) {
      evidence.push({
        source: "Extreme funding",
        category: "liquidity",
        explanation: `Funding rate is extreme (${(ci.derivatives.fundingRate.currentRate * 100).toFixed(4)}%) — derivatives positioning is stretched and may contribute to volatility or reversal.`,
        direction: "conflicting",
        weight: "moderate",
      });
    }
    if (ci.defi?.tvl && ci.defi.tvl.reliable && ci.defi.tvl.change7d !== undefined && ci.defi.tvl.change7d < -10) {
      evidence.push({
        source: "TVL decline",
        category: "liquidity",
        explanation: `TVL contracting (${ci.defi.tvl.change7d.toFixed(1)}% 7d) — protocol activity declining. This is concerning context, not a guaranteed price direction.`,
        direction: "conflicting",
        weight: "moderate",
      });
    }
    if (ci.tokenomics?.unlocks?.upcomingCount30d !== undefined && ci.tokenomics.unlocks.upcomingCount30d > 0) {
      evidence.push({
        source: "Token unlock",
        category: "liquidity",
        explanation: `${ci.tokenomics.unlocks.upcomingCount30d} unlock event(s) within 30 days — potential supply expansion. Directional impact depends on unlock size, recipient behavior, and market absorption.`,
        direction: "neutral",
        weight: "low",
      });
    }
    if (ci.derivatives?.liquidation?.dominantSide === "longs" && ci.derivatives.liquidation.reliable) {
      evidence.push({
        source: "Liquidation imbalance",
        category: "liquidity",
        explanation: "Long-side liquidations dominant — potential cascade risk. This is a derivatives-layer consideration, not a structural direction change.",
        direction: "conflicting",
        weight: "low",
      });
    }
  }

  return evidence;
}

// ── Thesis vs Counter-Thesis ─────────────────────────────────────

function buildThesisPair(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  cycle: MarketCycle,
  structural: StructuralContextLevel,
  supporting: LongHorizonEvidence[],
  conflicting: LongHorizonEvidence[],
  regime?: MarketRegimeContext,
  fundamental?: FundamentalThesis,
): { primaryThesis: string; counterThesis: string; thesisStatus: ThesisStatus } {
  const dirLabel = dir === "bullish" ? "bullish" : dir === "bearish" ? "bearish" : "neutral";
  const cycleLabel = cycle.replace(/_/g, " ").toLowerCase();
  const structuralLabel = structural.replace(/_/g, " ").toLowerCase();

  // Thesis status
  let thesisStatus: ThesisStatus;
  const hasHighSupport = supporting.some((e) => e.weight === "high" && e.direction === "supportive");
  const hasHighConflict = conflicting.some((e) => e.weight === "high" && e.direction === "conflicting");

  if (fundamental?.alignment === "FUNDAMENTAL_UNAVAILABLE") {
    thesisStatus = "VALUATION_UNAVAILABLE";
  } else if (hasHighSupport && !hasHighConflict && conflicting.length === 0) {
    thesisStatus = "STRONGLY_SUPPORTED";
  } else if (hasHighSupport && conflicting.length <= 1) {
    thesisStatus = "SUPPORTED";
  } else if (hasHighConflict && hasHighSupport) {
    thesisStatus = "MIXED";
  } else if (hasHighConflict && !hasHighSupport) {
    thesisStatus = "CONFLICTED";
  } else if (!dataQualityOk(result)) {
    thesisStatus = "INSUFFICIENT_DATA";
  } else {
    thesisStatus = "SUPPORTED";
  }

  // Primary thesis
  let primaryThesis = "";
  if (dir === "neutral") {
    primaryThesis = `No clear directional structure. Market is in ${cycleLabel} context. Awaiting structural catalyst for directional thesis development.`;
  } else {
    primaryThesis = `${dirLabel.charAt(0).toUpperCase() + dirLabel.slice(1)} ${structuralLabel} in ${cycleLabel} context. `;
    if (hasHighSupport) {
      primaryThesis += "Key structural and timeframe evidence supports the directional bias. ";
    }
    if (fundamental?.alignment === "STRONGLY_ALIGNED" || fundamental?.alignment === "ALIGNED") {
      primaryThesis += "Fundamental context is supportive. ";
    }
    if (regime?.continuationQuality) {
      primaryThesis += `Continuation quality: ${regime.continuationQuality.toLowerCase()}.`;
    }
  }

  // Counter-thesis
  let counterThesis = "";
  if (dir === "neutral") {
    counterThesis = "Directional structure may develop in either direction. No counter-thesis without an active primary thesis.";
  } else {
    const opposite = dir === "bullish" ? "bearish" : "bullish";
    counterThesis = `${opposite.charAt(0).toUpperCase() + opposite.slice(1)} structural development would invalidate the ${dirLabel} thesis. `;
    if (conflicting.length > 0) {
      counterThesis += `Currently ${conflicting.length} conflicting evidence item(s) present. `;
    }
    if (regime?.continuationQuality === "EXHAUSTED" || regime?.continuationQuality === "WEAK") {
      counterThesis += "Continuation is weakened — correction or reversal risk exists. ";
    }
    if (fundamental?.alignment === "CONFLICTING") {
      counterThesis += "Fundamental evidence conflicts with the structural thesis. ";
    }
    if (result.keyLevels?.invalidation && result.keyLevels.invalidation !== "N/A") {
      counterThesis += `Primary invalidation at ${result.keyLevels.invalidation}.`;
    }
  }

  return { primaryThesis, counterThesis, thesisStatus };
}

// ── Valuation Context ────────────────────────────────────────────

function assessValuationContext(
  result: AnalysisResult,
  fundamental?: FundamentalThesis,
): string {
  // The engine does NOT have reliable valuation data for most instruments.
  // Do NOT fabricate valuation claims.
  if (fundamental?.alignment === "FUNDAMENTAL_UNAVAILABLE") {
    return "Valuation data unavailable — cannot assess relative value. This is a technical-led thesis only.";
  }

  // For equities with fundamental data
  if (result.instrumentType === "stock" && result.fundamentalData) {
    return "Fundamental intelligence available — additional context for equity assessment. Use with structural context.";
  }

  // For crypto
  if (result.instrumentType === "crypto") {
    return "Traditional valuation metrics are not applicable. Assessment is structural and contextual.";
  }

  // For forex/commodity
  return "Relative value assessment requires macro context not currently available. Thesis is structural.";
}

// ── Macro Context ────────────────────────────────────────────────

function assessMacroContext(
  result: AnalysisResult,
  fundamental?: FundamentalThesis,
): string {
  const parts: string[] = [];

  if (fundamental?.eventRisk === "HIGH" || fundamental?.eventRisk === "ELEVATED") {
    parts.push(`Event risk: ${fundamental.eventRisk.toLowerCase()} — elevated uncertainty from economic catalysts.`);
  }

  if (fundamental?.alignment === "CONFLICTING") {
    parts.push("Macro context conflicts with technical structure.");
  } else if (fundamental?.alignment === "FUNDAMENTAL_UNAVAILABLE") {
    parts.push("Macro context unavailable — thesis is technical-led.");
  } else if (fundamental?.alignment === "STRONGLY_ALIGNED" || fundamental?.alignment === "ALIGNED") {
    parts.push("Macro context supports the technical thesis.");
  }

  // Treasury
  if (result.treasuryContext?.available) {
    parts.push("Treasury yield context available — interest-rate environment is contextual.");
  }

  // COT
  if (result.cotContext?.available) {
    parts.push("Positioning data available — institutional context is informational.");
  }

  // Phase 42 — Crypto intelligence context
  const ci = result.cryptoIntelligenceContext;
  if (ci) {
    if (ci.derivatives) {
      parts.push(`Crypto derivatives context available (${ci.derivatives.quality}) — funding/OI/liquidation context is informational.`);
    }
    if (ci.defi) {
      parts.push(`DeFi fundamentals available (${ci.defi.quality}) — TVL and fee context is informational.`);
    }
    if (ci.tokenomics) {
      parts.push(`Tokenomics context available (${ci.tokenomics.quality}) — supply and unlock context is informational.`);
    }
  }

  if (parts.length === 0) {
    return "Macro context limited — thesis relies primarily on technical structure.";
  }

  return parts.join(" ");
}

// ── Fundamental Context ──────────────────────────────────────────

function assessFundamentalContext(
  result: AnalysisResult,
  fundamental?: FundamentalThesis,
): string {
  if (!fundamental) return "Fundamental thesis not available.";

  switch (fundamental.alignment) {
    case "STRONGLY_ALIGNED":
      return "Fundamental evidence strongly supports the technical thesis — multi-factor confluence.";
    case "ALIGNED":
      return "Fundamental evidence partially supports the technical thesis.";
    case "MIXED":
      return "Fundamental signals are mixed — technical thesis requires structural confirmation.";
    case "CONFLICTING":
      return "Fundamental evidence conflicts with technical structure — thesis requires careful monitoring.";
    case "FUNDAMENTAL_UNAVAILABLE":
      return "Fundamental data unavailable — thesis is technical-led. Missing context may affect long-horizon confidence.";
    case "TECHNICAL_UNAVAILABLE":
      return "No directional technical thesis to align with.";
    default:
      return "Fundamental alignment undetermined.";
  }
}

// ── Investor vs Trader ───────────────────────────────────────────

function buildInvestorView(
  result: AnalysisResult,
  cycle: MarketCycle,
  structural: StructuralContextLevel,
  primaryThesis: string,
  regime?: MarketRegimeContext,
  fundamental?: FundamentalThesis,
): string {
  const parts: string[] = [];

  parts.push(`Larger market cycle: ${cycle.replace(/_/g, " ").toLowerCase()}.`);
  parts.push(`Structural context: ${structural.replace(/_/g, " ").toLowerCase()}.`);

  if (regime?.marketPhase === "LATE_TREND") {
    parts.push("Late trend phase — increasing awareness of potential exhaustion and cycle transition.");
  }
  if (regime?.marketPhase === "EARLY_TREND") {
    parts.push("Early trend phase — structural confirmation is still developing.");
  }

  if (fundamental?.alignment === "CONFLICTING") {
    parts.push("Fundamental conflict creates long-horizon uncertainty — structural invalidation is the primary risk.");
  } else if (fundamental?.alignment === "FUNDAMENTAL_UNAVAILABLE") {
    parts.push("Fundamental context unavailable — investment thesis is structural-led.");
  }

  if (result.keyLevels?.invalidation && result.keyLevels.invalidation !== "N/A") {
    parts.push(`Structural invalidation level: ${result.keyLevels.invalidation}.`);
  }

  // Phase 42 — Crypto intelligence for investor view
  const ci = result.cryptoIntelligenceContext;
  if (ci) {
    if (ci.defi?.tvl && ci.defi.tvl.reliable) {
      const tvlChange = ci.defi.tvl.change7d;
      if (tvlChange !== undefined && tvlChange > 5) {
        parts.push(`DeFi TVL expanding (+${tvlChange.toFixed(1)}% 7d) — ecosystem activity is growing. This is supportive context for long-horizon conviction, but does not independently establish price direction.`);
      } else if (tvlChange !== undefined && tvlChange < -5) {
        parts.push(`DeFi TVL contracting (${tvlChange.toFixed(1)}% 7d) — ecosystem activity declining. This is concerning context for long-horizon thesis.`);
      } else {
        parts.push(`DeFi TVL is stable — ecosystem activity is steady.`);
      }
    }
    if (ci.tokenomics?.unlocks?.upcomingCount30d !== undefined && ci.tokenomics.unlocks.upcomingCount30d > 0) {
      parts.push(`${ci.tokenomics.unlocks.upcomingCount30d} token unlock(s) within 30 days — potential supply-side consideration. Directional impact depends on unlock size and market absorption.`);
    }
    if (ci.tokenomics?.supply?.circulatingPercent !== undefined && ci.tokenomics.supply.circulatingPercent < 30) {
      parts.push(`Only ${ci.tokenomics.supply.circulatingPercent.toFixed(1)}% of supply unlocked — significant future supply expansion is structurally possible.`);
    }
    if (ci.derivatives?.fundingRate?.isExtreme) {
      parts.push(`Derivatives funding is extreme — market positioning is stretched. This is a risk factor for any long-horizon thesis.`);
    }
  }

  parts.push(primaryThesis);

  return parts.join(" ");
}

function buildTraderView(
  result: AnalysisResult,
  cycle: MarketCycle,
  structural: StructuralContextLevel,
  regime?: MarketRegimeContext,
  forwardPath?: ForwardMarketPathContext,
): string {
  const parts: string[] = [];

  const horizon = result.tradingStyle === "scalping" ? "SHORT_TERM" : result.tradingStyle === "swing" ? "SWING" : "INTRADAY";
  parts.push(`Trading horizon: ${horizon.toLowerCase().replace(/_/g, " ")}.`);

  if (forwardPath) {
    parts.push(`Forward path: ${forwardPath.pathStatus.replace(/_/g, " ").toLowerCase()}.`);
    if (forwardPath.structuralConfidence === "low") {
      parts.push("Structural confidence is low — wait for confirmation.");
    }
  }

  if (regime?.continuationQuality === "EXHAUSTED") {
    parts.push("Continuation exhausted — avoid chasing. Wait for fresh displacement or pullback.");
  } else if (regime?.continuationQuality === "WEAK") {
    parts.push("Continuation weakening — entry requires structural confirmation.");
  }

  if (cycle === "LATE_TREND" || cycle === "DISTRIBUTION_CONTEXT") {
    parts.push("Late/distribution cycle — reduce exposure or wait for structural clarity.");
  }

  // Phase 42 — Crypto intelligence for trader view
  const ci = result.cryptoIntelligenceContext;
  if (ci?.derivatives) {
    if (ci.derivatives.fundingRate?.isExtreme) {
      parts.push(`Extreme funding (${(ci.derivatives.fundingRate.currentRate * 100).toFixed(4)}%) — derivatives positioning is stretched. Potential for volatility or forced deleveraging.`);
    }
    if (ci.derivatives.openInterest?.change24h !== undefined && Math.abs(ci.derivatives.openInterest.change24h) > 10) {
      parts.push(`Significant OI change (${ci.derivatives.openInterest.change24h > 0 ? "+" : ""}${ci.derivatives.openInterest.change24h.toFixed(1)}% in 24h) — market positioning shifting rapidly.`);
    }
    if (ci.derivatives.liquidation?.dominantSide === "longs") {
      parts.push("Long-side liquidations dominant — potential cascade risk.");
    }
    if (ci.derivatives.liquidation?.dominantSide === "shorts") {
      parts.push("Short-side liquidations dominant — potential squeeze risk.");
    }
  }

  const dirLabel = structural.includes("UPTREND") ? "bullish" : structural.includes("DOWNTREND") ? "bearish" : "neutral";
  if (dirLabel !== "neutral" && regime?.continuationQuality !== "EXHAUSTED") {
    parts.push(`${structural.replace(/_/g, " ").toLowerCase()} — monitor MTF for continuation confirmation.`);
  }

  return parts.join(" ");
}

// ── Scenario Building ────────────────────────────────────────────

function buildScenarios(
  dir: "bullish" | "bearish" | "neutral",
  cycle: MarketCycle,
  regime?: MarketRegimeContext,
  fundamental?: FundamentalThesis,
  result?: AnalysisResult,
): { primaryScenario: string; alternateScenario: string } {
  if (dir === "neutral") {
    return {
      primaryScenario: "No clear directional thesis. Market awaiting structural catalyst.",
      alternateScenario: "Breakout or breakdown in either direction once structural clarity develops.",
    };
  }

  const dirLabel = dir === "bullish" ? "Bullish" : "Bearish";
  const opposite = dir === "bullish" ? "bearish" : "bullish";

  // Primary scenario based on cycle and quality
  let primaryScenario = "";
  let alternateScenario = "";

  if (cycle === "TREND_EXPANSION" || cycle === "EARLY_EXPANSION") {
    primaryScenario = `${dirLabel} continuation — structural trend remains intact with cycle support. Continuation preferred if MTF alignment holds and structural level is defended.`;
    alternateScenario = `${dirLabel.charAt(0).toUpperCase() + dirLabel.slice(1)} correction within the larger trend — healthy retracement before potential continuation.`;
  } else if (cycle === "MATURE_TREND") {
    primaryScenario = `${dirLabel} trend continuation — but maturity increases the risk of consolidation or correction. Continuation requires stronger structural confirmation.`;
    alternateScenario = `Correction or range transition — mature trends often consolidate before next directional move. ${opposite} structural break would shift the assessment.`;
  } else if (cycle === "LATE_TREND") {
    primaryScenario = `${dirLabel} continuation is possible but late in the cycle. Extension risk is elevated. Fresh confirmation required before new entries.`;
    alternateScenario = `Correction or reversal attempt — late trend characteristics increase ${opposite} risk. Structural invalidation would confirm transition.`;
  } else if (cycle === "CORRECTION") {
    primaryScenario = `${dirLabel} correction within existing trend — continuation of the larger trend remains possible if structural support holds.`;
    alternateScenario = `Deeper correction or reversal attempt — if structural support fails, the correction may develop into a structural shift.`;
  } else if (cycle === "DISTRIBUTION_CONTEXT") {
    primaryScenario = `Distribution phase — ${dirLabel} trend showing signs of exhaustion. Caution warranted for continuation.`;
    alternateScenario = `${opposite} structural development — distribution often precedes trend transition.`;
  } else if (cycle === "TRANSITION") {
    primaryScenario = `Market in transition — ${dirLabel} bias exists but structural confirmation is developing. Wait for clarity.`;
    alternateScenario = `Opposite directional development — transition creates opportunity for structural shift.`;
  } else if (cycle === "RANGE") {
    primaryScenario = "Range-bound market — no clear directional thesis. Awaiting breakout/breakdown.";
    alternateScenario = "Breakout or breakdown from range — structural levels define the breakout direction.";
  } else {
    primaryScenario = `${dirLabel} structural bias exists in ${cycle.replace(/_/g, " ").toLowerCase()} context. Continuation or reversal requires additional confirmation.`;
    alternateScenario = `${opposite} structural development would challenge the current bias.`;
  }

  // Fundamental overlay
  if (fundamental?.alignment === "CONFLICTING") {
    primaryScenario += " Fundamental conflict adds uncertainty to the primary scenario.";
  }
  if (fundamental?.eventRisk === "HIGH") {
    primaryScenario += " Elevated event risk may alter the structural path.";
  }

  return { primaryScenario, alternateScenario };
}

// ── Confirmation / Invalidation ──────────────────────────────────

function buildConditions(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  cycle: MarketCycle,
): { confirmationConditions: string[]; invalidationConditions: string[] } {
  const confirmation: string[] = [];
  const invalidation: string[] = [];

  if (dir === "neutral") {
    confirmation.push("Valid directional structure must develop (HH/HL or LH/LL)");
    confirmation.push("At least 2 core factors must agree on direction");
    invalidation.push("No active thesis — no invalidation applicable");
    return { confirmationConditions: confirmation, invalidationConditions: invalidation };
  }

  const dirLabel = dir === "bullish" ? "bullish" : "bearish";

  // Confirmation
  if (cycle === "TREND_EXPANSION" || cycle === "EARLY_EXPANSION") {
    confirmation.push(`Maintained ${dirLabel} HTF structure`);
    confirmation.push("Continued MTF alignment");
    confirmation.push("Structural level defense on pullbacks");
  } else if (cycle === "MATURE_TREND") {
    confirmation.push("Fresh ${dirLabel} BOS or displacement");
    confirmation.push("MTF re-alignment confirming trend durability");
    confirmation.push("Successful hold of structural support/resistance");
  } else if (cycle === "LATE_TREND") {
    confirmation.push("Strong structural confirmation — fresh displacement, MTF alignment");
    confirmation.push("Successful breakout above/below key level with acceptance");
    confirmation.push("Exhaustion signals clearing");
  } else if (cycle === "CORRECTION") {
    confirmation.push("Correction completing with fresh displacement in trend direction");
    confirmation.push("Structural support/resistance holding");
    confirmation.push("MTF re-alignment with primary trend");
  } else {
    confirmation.push(`${dirLabel} structural confirmation across HTF and MTF`);
    confirmation.push("Fresh displacement in trend direction");
  }

  // Invalidation
  if (result.keyLevels?.invalidation && result.keyLevels.invalidation !== "N/A") {
    invalidation.push(`Structural invalidation at ${result.keyLevels.invalidation}`);
  }
  invalidation.push(`HTF structure shifts ${dir === "bullish" ? "bearish" : "bullish"}`);
  invalidation.push("Confirmed BOS against current direction");
  if (result.tradePlan) {
    invalidation.push(`Trade invalid if price trades through ${result.tradePlan.stopLoss}`);
  }

  return { confirmationConditions: confirmation, invalidationConditions: invalidation };
}

// ── Risks ────────────────────────────────────────────────────────

function assessRisks(
  result: AnalysisResult,
  cycle: MarketCycle,
  regime?: MarketRegimeContext,
  fundamental?: FundamentalThesis,
  forwardPath?: ForwardMarketPathContext,
): string[] {
  const risks: string[] = [];

  if (cycle === "LATE_TREND") {
    risks.push("Late trend phase — exhaustion risk elevated");
  }
  if (cycle === "DISTRIBUTION_CONTEXT") {
    risks.push("Distribution phase — trend transition risk");
  }
  if (regime?.continuationQuality === "EXHAUSTED") {
    risks.push("Continuation quality exhausted — structural risk is elevated");
  }
  if (regime?.exhaustionSignals && regime.exhaustionSignals.length > 1) {
    risks.push(`Multiple exhaustion signals detected (${regime.exhaustionSignals.length})`);
  }
  if (fundamental?.alignment === "CONFLICTING") {
    risks.push("Fundamental conflict with technical structure");
  }
  if (fundamental?.eventRisk === "HIGH") {
    risks.push("Elevated macro event risk — path uncertainty increased");
  }
  if (forwardPath?.structuralConfidence === "low") {
    risks.push("Forward path structural confidence is low");
  }
  if (!dataQualityOk(result)) {
    risks.push("Data quality degraded — assessment may be incomplete");
  }

  // Phase 42 — Crypto-specific risks
  const ci = result.cryptoIntelligenceContext;
  if (ci) {
    if (ci.derivatives?.fundingRate?.isExtreme) {
      risks.push("Extreme derivatives funding — market positioning is stretched, increased volatility risk");
    }
    if (ci.tokenomics?.unlocks?.upcomingCount30d !== undefined && ci.tokenomics.unlocks.upcomingCount30d > 0) {
      risks.push(`${ci.tokenomics.unlocks.upcomingCount30d} upcoming token unlock(s) — potential supply-side pressure`);
    }
    if (ci.defi?.tvl && ci.defi.tvl.reliable && ci.defi.tvl.change7d !== undefined && ci.defi.tvl.change7d < -15) {
      risks.push("Significant TVL decline — ecosystem activity deteriorating");
    }
  }

  return risks;
}

// ── Missing Information ──────────────────────────────────────────

function assessMissing(result: AnalysisResult): string[] {
  const missing: string[] = [];
  if (!result.htfAlignment) missing.push("HTF alignment data");
  if (!result.mtfSummary) missing.push("MTF summary data");
  if (!result.marketRegimeContext) missing.push("Market regime classification");
  if (!result.fundamentalThesis) missing.push("Fundamental thesis");
  if (!result.forwardMarketPath) missing.push("Forward market path");
  if (!dataQualityOk(result)) missing.push("Market data quality is degraded");
  if (result.instrumentType === "crypto") {
    if (!result.derivativesData) missing.push("Crypto derivatives context (CoinGlass)");
    if (!result.cryptoIntelligenceContext?.defi) missing.push("DeFi fundamentals (TVL, fees, revenue)");
    if (!result.cryptoIntelligenceContext?.tokenomics) missing.push("Tokenomics data (supply, unlocks)");
  }
  if (result.instrumentType === "forex" && !result.cotContext) {
    missing.push("COT positioning data");
  }
  if (result.instrumentType === "commodity" && !result.eiaContext) {
    missing.push("EIA inventory data");
  }
  return missing;
}

// ── Main Builder ─────────────────────────────────────────────────

export function buildLongHorizonThesis(result: AnalysisResult): LongHorizonThesis {
  const dir = dirBias(result);
  const regime = result.marketRegimeContext;
  const fundamental = result.fundamentalThesis;
  const forwardPath = result.forwardMarketPath;

  // Context
  const marketCycle = classifyMarketCycle(result, regime);
  const structuralContext = classifyStructuralContext(result, regime);
  const valuationContext = assessValuationContext(result, fundamental);
  const macroContext = assessMacroContext(result, fundamental);
  const fundamentalContext = assessFundamentalContext(result, fundamental);

  // Context summaries
  const cycleLabel = marketCycle.replace(/_/g, " ").toLowerCase();
  const structLabel = structuralContext.replace(/_/g, " ").toLowerCase();

  const marketCycleContext = `Market is in ${cycleLabel} phase. ${dir === "neutral" ? "No clear directional structure." : `${dir.charAt(0).toUpperCase() + dir.slice(1)} structural bias with ${structLabel} context.`}`;
  const structuralSummary = `HTF: ${htfDir(result)}, MTF: ${result.mtfSummary?.alignment ?? "unavailable"}, Structure: ${structLabel}.`;

  // Evidence
  const supportingEvidence = buildSupportingEvidence(result, dir, regime, fundamental);
  const conflictingEvidence = buildConflictingEvidence(result, dir, regime, fundamental);

  // Thesis pair
  const { primaryThesis, counterThesis, thesisStatus } = buildThesisPair(
    result, dir, marketCycle, structuralContext, supportingEvidence, conflictingEvidence, regime, fundamental,
  );

  // Scenarios
  const { primaryScenario, alternateScenario } = buildScenarios(dir, marketCycle, regime, fundamental, result);

  // Conditions
  const { confirmationConditions, invalidationConditions } = buildConditions(result, dir, marketCycle);

  // Risks
  const thesisRisks = assessRisks(result, marketCycle, regime, fundamental, forwardPath);

  // Missing
  const missingInformation = assessMissing(result);

  // Views
  const investorImplication = buildInvestorView(result, marketCycle, structuralContext, primaryThesis, regime, fundamental);
  const traderImplication = buildTraderView(result, marketCycle, structuralContext, regime, forwardPath);

  // Rationale
  const dirLabel = dir === "neutral" ? "Neutral" : dir.charAt(0).toUpperCase() + dir.slice(1);
  let rationale = `${dirLabel} in ${cycleLabel} cycle with ${structLabel} structure. `;
  rationale += `Thesis: ${thesisStatus.replace(/_/g, " ").toLowerCase()}. `;
  rationale += `Supporting: ${supportingEvidence.length}, conflicting: ${conflictingEvidence.length}. `;
  if (thesisRisks.length > 0) {
    rationale += `Risks: ${thesisRisks.length}. `;
  }
  rationale += primaryScenario;

  return {
    marketCycle,
    structuralContext,
    thesisStatus,
    marketCycleContext,
    structuralSummary,
    valuationContext,
    macroContext,
    fundamentalContext,
    primaryThesis,
    counterThesis,
    supportingEvidence,
    conflictingEvidence,
    primaryScenario,
    alternateScenario,
    confirmationConditions,
    invalidationConditions,
    thesisRisks,
    missingInformation,
    investorImplication,
    traderImplication,
    rationale,
  };
}
