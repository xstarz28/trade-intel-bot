/**
 * Phase 36 — EVIDENCE & THESIS CHALLENGE ENGINE.
 *
 * Pure informational audit that challenges the system's own conclusions.
 * Reads only from existing AnalysisResult fields.
 *
 * CRITICAL DESIGN:
 *   1. This module MUST NOT recalculate bias, conviction, gates, trade plan,
 *      recommendation, or actionability.
 *   2. This module MUST NOT fabricate evidence.
 *   3. Provider availability is NEVER directional evidence.
 *   4. Missing data remains neutral — never bearish or bullish.
 *   5. A single technical signal is never treated as sufficient proof.
 *   6. HTF > MTF > LTF hierarchy is preserved.
 *   7. Evidence conflict is reported, never silently repaired.
 *   8. Double-counting is detected and exposed.
 *   9. No probability / win-rate / guarantee language.
 *  10. No synthetic price targets.
 */

import type { AnalysisResult } from "@/types/analysis";

// ── Evidence Quality Model ────────────────────────────────────────

export type EvidenceCategory =
  | "STRUCTURE"
  | "MTF"
  | "MOMENTUM"
  | "LIQUIDITY"
  | "MARKET_REGIME"
  | "FUNDAMENTAL"
  | "MACRO"
  | "DERIVATIVES"
  | "SCENARIO"
  | "DATA_QUALITY";

export type EvidenceStrength = "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN";

export type EvidenceQuality =
  | "VERIFIED"
  | "DEGRADED"
  | "STALE"
  | "INSUFFICIENT"
  | "UNAVAILABLE";

export type EvidenceDirection =
  | "supporting"
  | "conflicting"
  | "neutral"
  | "unavailable";

export type DependencyGroup =
  | "STRUCTURE_HTF"
  | "MTF_ALIGNMENT"
  | "REGIME"
  | "FUNDAMENTAL"
  | "MACRO"
  | "LIQUIDITY"
  | "MOMENTUM"
  | "DERIVATIVES"
  | "DATA_QUALITY";

export interface EvidenceItem {
  source: string;
  category: EvidenceCategory;
  direction: EvidenceDirection;
  explanation: string;
  strength: EvidenceStrength;
  quality: EvidenceQuality;
  relevance: "high" | "moderate" | "low";
  dependencyGroup: DependencyGroup;
}

export type ThesisSupportStatus =
  | "WELL_SUPPORTED"
  | "SUPPORTED"
  | "MIXED_SUPPORT"
  | "WEAK_SUPPORT"
  | "INSUFFICIENT_SUPPORT"
  | "CONFLICTED"
  | "NO_ACTIVE_THESIS";

export type FragilityLevel =
  | "LOW"
  | "MODERATE"
  | "ELEVATED"
  | "HIGH"
  | "UNKNOWN";

export interface DoubleCountingWarning {
  dependencyGroup: DependencyGroup;
  relatedEvidenceCount: number;
  description: string;
}

export interface EvidenceChallengeContext {
  // Evidence inventory
  supportingEvidence: EvidenceItem[];
  conflictingEvidence: EvidenceItem[];
  neutralEvidence: EvidenceItem[];

  // Thesis support audit
  thesisSupportStatus: ThesisSupportStatus;
  thesisSupportExplanation: string;
  strongestSupportingEvidence: EvidenceItem | null;
  strongestConflictingEvidence: EvidenceItem | null;

  // Counter-thesis
  counterThesis: string;
  counterThesisSource: string;

  // Double-counting
  doubleCountingWarnings: DoubleCountingWarning[];

  // Fragility
  thesisFragility: FragilityLevel;
  fragilityExplanation: string;

  // Missing evidence
  missingEvidence: string[];

  // What would change the thesis
  thesisStrengtheners: string[];
  thesisWeaknesseners: string[];
  thesisInvalidators: string[];

  // Audit summary
  auditSummary: string;

  // Non-authoritative confirmation
  evidenceImpact: "INFORMATIONAL_ONLY";
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

function dataQualityOk(result: AnalysisResult): boolean {
  if (!result.dataQualityContext) return true;
  return result.dataQualityContext.primaryData.status === "GOOD";
}

// ── Evidence Collection ──────────────────────────────────────────

function collectStructureEvidence(result: AnalysisResult, dir: "bullish" | "bearish" | "neutral"): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];

  if (dir === "neutral") return evidence;

  // HTF structure
  const htf = htfDir(result);
  if (htf !== "neutral") {
    const matchesDir = htf === dir;
    evidence.push({
      source: "HTF structure",
      category: "STRUCTURE",
      direction: matchesDir ? "supporting" : "conflicting",
      explanation: `Higher-timeframe structure is ${htf === "bullish" ? "bullish (HH/HL)" : "bearish (LH/LL)"}`,
      strength: matchesDir ? "STRONG" : "WEAK",
      quality: "VERIFIED",
      relevance: "high",
      dependencyGroup: "STRUCTURE_HTF",
    });
  }

  // Key levels
  if (result.keyLevels) {
    const { support, resistance, invalidation } = result.keyLevels;
    if (support && support !== "N/A") {
      evidence.push({
        source: "Key support level",
        category: "STRUCTURE",
        direction: dir === "bullish" ? "supporting" : "neutral",
        explanation: `Support at ${support}`,
        strength: "MODERATE",
        quality: "VERIFIED",
        relevance: "high",
        dependencyGroup: "STRUCTURE_HTF",
      });
    }
    if (resistance && resistance !== "N/A") {
      evidence.push({
        source: "Key resistance level",
        category: "STRUCTURE",
        direction: dir === "bearish" ? "supporting" : "neutral",
        explanation: `Resistance at ${resistance}`,
        strength: "MODERATE",
        quality: "VERIFIED",
        relevance: "high",
        dependencyGroup: "STRUCTURE_HTF",
      });
    }
  }

  return evidence;
}

function collectMtfEvidence(result: AnalysisResult, dir: "bullish" | "bearish" | "neutral"): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const mtf = result.mtfSummary;
  if (!mtf) return evidence;

  const isAligned =
    (dir === "bullish" && mtf.alignment === "ALIGNED_BULLISH") ||
    (dir === "bearish" && mtf.alignment === "ALIGNED_BEARISH");

  const isCounter =
    (dir === "bullish" && (mtf.alignment === "ALIGNED_BEARISH" || mtf.alignment === "COUNTER_TREND")) ||
    (dir === "bearish" && (mtf.alignment === "ALIGNED_BULLISH" || mtf.alignment === "COUNTER_TREND"));

  if (isAligned) {
    evidence.push({
      source: "MTF alignment",
      category: "MTF",
      direction: "supporting",
      explanation: `Multi-timeframe structure aligned with ${dir} bias across ${mtf.chainUsed.join(", ")}`,
      strength: "STRONG",
      quality: "VERIFIED",
      relevance: "high",
      dependencyGroup: "MTF_ALIGNMENT",
    });
  } else if (isCounter) {
    evidence.push({
      source: "MTF conflict",
      category: "MTF",
      direction: "conflicting",
      explanation: `Counter-trend multi-timeframe evidence — alignment: ${mtf.alignment}`,
      strength: "MODERATE",
      quality: "VERIFIED",
      relevance: "high",
      dependencyGroup: "MTF_ALIGNMENT",
    });
  } else if (mtf.alignment === "MIXED") {
    evidence.push({
      source: "MTF mixed",
      category: "MTF",
      direction: "neutral",
      explanation: "Multi-timeframe structure is mixed — no clear alignment",
      strength: "WEAK",
      quality: "VERIFIED",
      relevance: "moderate",
      dependencyGroup: "MTF_ALIGNMENT",
    });
  } else if (mtf.alignment === "INSUFFICIENT_DATA") {
    evidence.push({
      source: "MTF data",
      category: "MTF",
      direction: "unavailable",
      explanation: "Multi-timeframe data insufficient",
      strength: "UNKNOWN",
      quality: "INSUFFICIENT",
      relevance: "moderate",
      dependencyGroup: "MTF_ALIGNMENT",
    });
  }

  // Unavailable timeframes
  if (mtf.unavailable && mtf.unavailable.length > 0) {
    evidence.push({
      source: "MTF coverage",
      category: "MTF",
      direction: "neutral",
      explanation: `${mtf.unavailable.length} timeframe(s) unavailable: ${mtf.unavailable.map((u) => u.timeframe).join(", ")}`,
      strength: "WEAK",
      quality: "DEGRADED",
      relevance: "moderate",
      dependencyGroup: "MTF_ALIGNMENT",
    });
  }

  return evidence;
}

function collectRegimeEvidence(result: AnalysisResult, dir: "bullish" | "bearish" | "neutral"): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const regime = result.marketRegimeContext;
  if (!regime) return evidence;

  // Continuation quality
  const qualityMap: Record<string, EvidenceDirection> = {
    STRONG: "supporting",
    HEALTHY: "supporting",
    DEVELOPING: "supporting",
    WEAK: "conflicting",
    EXHAUSTED: "conflicting",
  };

  if (regime.continuationQuality && dir !== "neutral") {
    const qualityDir = qualityMap[regime.continuationQuality];
    if (qualityDir) {
      evidence.push({
        source: "Continuation quality",
        category: "MARKET_REGIME",
        direction: qualityDir,
        explanation: `Continuation quality is ${regime.continuationQuality.toLowerCase()} — ${qualityDir === "conflicting" ? "trend durability is questionable" : "trend has structural support"}`,
        strength: regime.continuationQuality === "STRONG" ? "STRONG" : regime.continuationQuality === "EXHAUSTED" ? "MODERATE" : "MODERATE",
        quality: "VERIFIED",
        relevance: "high",
        dependencyGroup: "REGIME",
      });
    }
  }

  // Exhaustion signals
  if (regime.exhaustionSignals && regime.exhaustionSignals.length > 0) {
    evidence.push({
      source: "Exhaustion signals",
      category: "MARKET_REGIME",
      direction: "conflicting",
      explanation: `${regime.exhaustionSignals.length} exhaustion signal(s) detected — continuation risk elevated`,
      strength: regime.exhaustionSignals.length >= 3 ? "STRONG" : "MODERATE",
      quality: "VERIFIED",
      relevance: "high",
      dependencyGroup: "REGIME",
    });
  }

  // Market phase
  if (regime.marketPhase) {
    const phaseLabel = regime.marketPhase.replace(/_/g, " ").toLowerCase();
    let phaseDir: EvidenceDirection = "neutral";
    if (regime.marketPhase === "TREND_MATURE" || regime.marketPhase === "LATE_TREND") {
      phaseDir = dir !== "neutral" ? "conflicting" : "neutral";
    } else if (regime.marketPhase === "EARLY_TREND") {
      phaseDir = dir !== "neutral" ? "supporting" : "neutral";
    }
    evidence.push({
      source: "Market phase",
      category: "MARKET_REGIME",
      direction: phaseDir,
      explanation: `Market phase: ${phaseLabel}`,
      strength: "MODERATE",
      quality: "VERIFIED",
      relevance: "moderate",
      dependencyGroup: "REGIME",
    });
  }

  return evidence;
}

function collectFundamentalEvidence(result: AnalysisResult, dir: "bullish" | "bearish" | "neutral"): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const fund = result.fundamentalThesis;
  if (!fund) {
    evidence.push({
      source: "Fundamental data",
      category: "FUNDAMENTAL",
      direction: "unavailable",
      explanation: "Fundamental thesis not available",
      strength: "UNKNOWN",
      quality: "UNAVAILABLE",
      relevance: "moderate",
      dependencyGroup: "FUNDAMENTAL",
    });
    return evidence;
  }

  if (fund.alignment === "FUNDAMENTAL_UNAVAILABLE") {
    evidence.push({
      source: "Fundamental data",
      category: "FUNDAMENTAL",
      direction: "unavailable",
      explanation: "Fundamental/macro data unavailable — thesis is technical-led",
      strength: "UNKNOWN",
      quality: "UNAVAILABLE",
      relevance: "moderate",
      dependencyGroup: "FUNDAMENTAL",
    });
    return evidence;
  }

  if (dir !== "neutral") {
    if (fund.alignment === "STRONGLY_ALIGNED" || fund.alignment === "ALIGNED") {
      evidence.push({
        source: "Fundamental alignment",
        category: "FUNDAMENTAL",
        direction: "supporting",
        explanation: fund.analystSummary,
        strength: fund.alignment === "STRONGLY_ALIGNED" ? "STRONG" : "MODERATE",
        quality: "VERIFIED",
        relevance: "moderate",
        dependencyGroup: "FUNDAMENTAL",
      });
    } else if (fund.alignment === "CONFLICTING") {
      evidence.push({
        source: "Fundamental conflict",
        category: "FUNDAMENTAL",
        direction: "conflicting",
        explanation: fund.analystSummary,
        strength: "MODERATE",
        quality: "VERIFIED",
        relevance: "high",
        dependencyGroup: "FUNDAMENTAL",
      });
    } else if (fund.alignment === "MIXED") {
      evidence.push({
        source: "Fundamental mixed",
        category: "FUNDAMENTAL",
        direction: "neutral",
        explanation: fund.analystSummary,
        strength: "WEAK",
        quality: "VERIFIED",
        relevance: "moderate",
        dependencyGroup: "FUNDAMENTAL",
      });
    }
  }

  // Event risk
  if (fund.eventRisk === "HIGH" || fund.eventRisk === "ELEVATED") {
    evidence.push({
      source: "Event risk",
      category: "MACRO",
      direction: "neutral",
      explanation: `Event risk: ${fund.eventRisk.toLowerCase()} — elevated uncertainty from economic catalysts`,
      strength: "UNKNOWN",
      quality: "VERIFIED",
      relevance: "moderate",
      dependencyGroup: "MACRO",
    });
  }

  return evidence;
}

function collectMacroEvidence(result: AnalysisResult): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];

  // Treasury
  if (result.treasuryContext?.available) {
    evidence.push({
      source: "Treasury yields",
      category: "MACRO",
      direction: "neutral",
      explanation: "Treasury yield context available — interest-rate environment is contextual",
      strength: "WEAK",
      quality: "VERIFIED",
      relevance: "low",
      dependencyGroup: "MACRO",
    });
  } else if (result.instrumentType === "forex" || result.instrumentType === "commodity") {
    evidence.push({
      source: "Treasury yields",
      category: "MACRO",
      direction: "unavailable",
      explanation: "Treasury yield data unavailable",
      strength: "UNKNOWN",
      quality: "UNAVAILABLE",
      relevance: "moderate",
      dependencyGroup: "MACRO",
    });
  }

  // COT
  if (result.cotContext?.available) {
    evidence.push({
      source: "COT positioning",
      category: "MACRO",
      direction: "neutral",
      explanation: "Institutional positioning data available — informational",
      strength: "WEAK",
      quality: "VERIFIED",
      relevance: "low",
      dependencyGroup: "MACRO",
    });
  }

  // Derivatives (legacy CoinGlass path)
  if (result.derivativesData && !result.cryptoIntelligenceContext) {
    evidence.push({
      source: "Crypto derivatives",
      category: "DERIVATIVES",
      direction: "neutral",
      explanation: "Derivatives data available — funding/OI context is informational",
      strength: "WEAK",
      quality: "VERIFIED",
      relevance: "low",
      dependencyGroup: "DERIVATIVES",
    });
  }

  // Phase 42 — Crypto intelligence evidence (detailed)
  const ci = result.cryptoIntelligenceContext;
  if (ci?.derivatives) {
    if (ci.derivatives.fundingRate?.reliable) {
      evidence.push({
        source: "Funding rate",
        category: "DERIVATIVES",
        direction: ci.derivatives.fundingRate.isExtreme ? "conflicting" : "neutral",
        explanation: ci.derivatives.fundingRate.isExtreme
          ? `Funding rate extreme (${(ci.derivatives.fundingRate.currentRate * 100).toFixed(4)}%) — derivatives positioning stretched. This is a risk factor, not a directional signal.`
          : `Funding rate moderate (${(ci.derivatives.fundingRate.currentRate * 100).toFixed(4)}%) — derivatives positioning is balanced.`,
        strength: ci.derivatives.fundingRate.isExtreme ? "MODERATE" : "WEAK",
        quality: ci.derivatives.freshness === "FRESH" ? "VERIFIED" : "DEGRADED",
        relevance: ci.derivatives.fundingRate.isExtreme ? "moderate" : "low",
        dependencyGroup: "DERIVATIVES",
      });
    }
    if (ci.derivatives.openInterest?.reliable && ci.derivatives.openInterest.change24h !== undefined) {
      const absChange = Math.abs(ci.derivatives.openInterest.change24h);
      evidence.push({
        source: "Open interest",
        category: "DERIVATIVES",
        direction: "neutral",
        explanation: `OI ${ci.derivatives.openInterest.change24h > 0 ? "increasing" : "decreasing"} ${absChange.toFixed(1)}% in 24h — market positioning is ${absChange > 10 ? "shifting rapidly" : "relatively stable"}. Informational, not directional.`,
        strength: absChange > 15 ? "MODERATE" : "WEAK",
        quality: ci.derivatives.freshness === "FRESH" ? "VERIFIED" : "DEGRADED",
        relevance: "low",
        dependencyGroup: "DERIVATIVES",
      });
    }
    if (ci.derivatives.liquidation?.dominantSide === "longs" || ci.derivatives.liquidation?.dominantSide === "shorts") {
      evidence.push({
        source: "Liquidation imbalance",
        category: "DERIVATIVES",
        direction: "neutral",
        explanation: `${ci.derivatives.liquidation.dominantSide === "longs" ? "Long" : "Short"}-side liquidations dominant — potential ${ci.derivatives.liquidation.dominantSide === "longs" ? "cascade" : "squeeze"} risk. Contextual, not a structural signal.`,
        strength: "WEAK",
        quality: "VERIFIED",
        relevance: "low",
        dependencyGroup: "DERIVATIVES",
      });
    }
  }
  if (ci?.defi) {
    if (ci.defi.tvl?.reliable) {
      const tvlDir = (ci.defi.tvl.change7d ?? 0) > 5 ? "supporting" : (ci.defi.tvl.change7d ?? 0) < -5 ? "conflicting" : "neutral";
      evidence.push({
        source: "DeFi TVL",
        category: "FUNDAMENTAL",
        direction: tvlDir,
        explanation: ci.defi.tvl.change7d !== undefined
          ? `TVL ${ci.defi.tvl.change7d > 0 ? "expanding" : "contracting"} (${ci.defi.tvl.change7d > 0 ? "+" : ""}${ci.defi.tvl.change7d.toFixed(1)}% 7d) — protocol activity context. Not a price prediction.`
          : `TVL: $${(ci.defi.tvl.current / 1e9).toFixed(2)}B — fundamental health indicator, not directional.`,
        strength: tvlDir === "neutral" ? "WEAK" : "MODERATE",
        quality: "VERIFIED",
        relevance: tvlDir === "neutral" ? "low" : "moderate",
        dependencyGroup: "FUNDAMENTAL",
      });
    }
    if (ci.defi.fees?.reliable) {
      evidence.push({
        source: "Protocol fees",
        category: "FUNDAMENTAL",
        direction: "neutral",
        explanation: `Fee activity observable — protocol revenue context. Not a directional price signal.`,
        strength: "WEAK",
        quality: "VERIFIED",
        relevance: "low",
        dependencyGroup: "FUNDAMENTAL",
      });
    }
  }
  if (ci?.tokenomics) {
    if (ci.tokenomics.unlocks?.upcomingCount30d !== undefined && ci.tokenomics.unlocks.upcomingCount30d > 0) {
      evidence.push({
        source: "Token unlocks",
        category: "FUNDAMENTAL",
        direction: "neutral",
        explanation: `${ci.tokenomics.unlocks.upcomingCount30d} unlock event(s) within 30 days — potential supply expansion. Directional impact depends on size, recipient behavior, and market absorption. This is informational, not automatically bearish.`,
        strength: "WEAK",
        quality: ci.tokenomics.freshness === "FRESH" ? "VERIFIED" : "DEGRADED",
        relevance: "low",
        dependencyGroup: "FUNDAMENTAL",
      });
    }
  }

  return evidence;
}

function collectDataQualityEvidence(result: AnalysisResult): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const dq = result.dataQualityContext;
  if (!dq) return evidence;

  if (dq.primaryData.status !== "GOOD") {
    evidence.push({
      source: "Primary data quality",
      category: "DATA_QUALITY",
      direction: "neutral",
      explanation: `Primary data status: ${dq.primaryData.status.toLowerCase()} — assessment may be incomplete`,
      strength: "WEAK",
      quality: dq.primaryData.status === "STALE" ? "STALE" : "DEGRADED",
      relevance: "moderate",
      dependencyGroup: "DATA_QUALITY",
    });
  }

  return evidence;
}

function collectScenarioEvidence(result: AnalysisResult, dir: "bullish" | "bearish" | "neutral"): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const scenario = result.marketScenario;
  if (!scenario) return evidence;

  if (dir !== "neutral") {
    const isConfirmed =
      (dir === "bullish" && scenario.scenario === "CONFIRMED_CONTINUATION") ||
      (dir === "bearish" && scenario.scenario === "CONFIRMED_CONTINUATION");

    if (isConfirmed) {
      evidence.push({
        source: "Market scenario",
        category: "SCENARIO",
        direction: "supporting",
        explanation: `Scenario: ${scenario.scenario.replace(/_/g, " ").toLowerCase()} — continuation is structurally developing`,
        strength: "MODERATE",
        quality: "VERIFIED",
        relevance: "high",
        dependencyGroup: "REGIME",
      });
    } else if (scenario.scenario === "REVERSAL_DEVELOPING" || scenario.scenario === "REVERSAL_CONFIRMED") {
      evidence.push({
        source: "Market scenario",
        category: "SCENARIO",
        direction: "conflicting",
        explanation: `Scenario: ${scenario.scenario.replace(/_/g, " ").toLowerCase()} — counter-trend development visible`,
        strength: "MODERATE",
        quality: "VERIFIED",
        relevance: "high",
        dependencyGroup: "REGIME",
      });
    }
  }

  return evidence;
}

// ── Thesis Support Audit ──────────────────────────────────────────

function auditThesisSupport(
  result: AnalysisResult,
  supporting: EvidenceItem[],
  conflicting: EvidenceItem[],
  dir: "bullish" | "bearish" | "neutral",
): { status: ThesisSupportStatus; explanation: string } {
  if (dir === "neutral" || result.recommendation === "NO_TRADE") {
    return {
      status: "NO_ACTIVE_THESIS",
      explanation: "No active directional thesis — system is neutral or no-trade.",
    };
  }

  const strongSupport = supporting.filter((e) => e.strength === "STRONG" && e.direction === "supporting");
  const moderateSupport = supporting.filter((e) => e.strength === "MODERATE" && e.direction === "supporting");
  const strongConflict = conflicting.filter((e) => e.strength === "STRONG" && e.direction === "conflicting");
  const moderateConflict = conflicting.filter((e) => e.strength === "MODERATE" && e.direction === "conflicting");

  let status: ThesisSupportStatus;
  let explanation: string;

  if (strongSupport.length >= 2 && conflicting.length === 0) {
    status = "WELL_SUPPORTED";
    explanation = `${strongSupport.length} strong supporting evidence items with no material contradictions.`;
  } else if (strongSupport.length >= 1 && moderateConflict.length <= 1 && conflicting.length <= 2) {
    status = "SUPPORTED";
    explanation = `Strong structural support with limited conflicting evidence (${conflicting.length} item(s)).`;
  } else if (strongSupport.length >= 1 && strongConflict.length >= 1) {
    status = "MIXED_SUPPORT";
    explanation = `Both strong supporting (${strongSupport.length}) and strong conflicting (${strongConflict.length}) evidence present.`;
  } else if (moderateSupport.length >= 1 && conflicting.length <= 1) {
    status = "SUPPORTED";
    explanation = `Moderate support with minimal conflict.`;
  } else if (strongConflict.length >= 1 && strongSupport.length === 0) {
    status = "WEAK_SUPPORT";
    explanation = `Strong conflicting evidence without strong supporting evidence.`;
  } else if (supporting.length === 0 && conflicting.length > 0) {
    status = "INSUFFICIENT_SUPPORT";
    explanation = `No supporting evidence available — only conflicting evidence present.`;
  } else if (conflicting.length >= 3) {
    status = "CONFLICTED";
    explanation = `${conflicting.length} conflicting evidence items exceed supporting evidence.`;
  } else {
    status = "SUPPORTED";
    explanation = `Limited evidence available — ${supporting.length} supporting, ${conflicting.length} conflicting.`;
  }

  return { status, explanation };
}

// ── Counter-Thesis ───────────────────────────────────────────────

function buildCounterThesis(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  conflicting: EvidenceItem[],
  regime?: AnalysisResult["marketRegimeContext"],
  fundamental?: AnalysisResult["fundamentalThesis"],
): { text: string; source: string } {
  if (dir === "neutral") {
    return {
      text: "No active directional thesis — no counter-thesis needed. Directional structure may develop in either direction.",
      source: "structural",
    };
  }

  const opposite = dir === "bullish" ? "bearish" : "bullish";
  const parts: string[] = [];
  const sources: string[] = [];

  // Structural counter-evidence
  const htfConflict = conflicting.find((e) => e.category === "STRUCTURE");
  if (htfConflict) {
    parts.push(htfConflict.explanation);
    sources.push("HTF structure");
  }

  // MTF counter-evidence
  const mtfConflict = conflicting.find((e) => e.category === "MTF");
  if (mtfConflict) {
    parts.push(mtfConflict.explanation);
    sources.push("MTF alignment");
  }

  // Regime counter-evidence
  if (regime?.continuationQuality === "EXHAUSTED" || regime?.continuationQuality === "WEAK") {
    parts.push(`Continuation quality: ${regime.continuationQuality.toLowerCase()} — structural durability is questionable`);
    sources.push("regime");
  }

  // Exhaustion
  if (regime?.exhaustionSignals && regime.exhaustionSignals.length > 0) {
    parts.push(`${regime.exhaustionSignals.length} exhaustion signal(s) present`);
    sources.push("exhaustion");
  }

  // Fundamental conflict
  if (fundamental?.alignment === "CONFLICTING") {
    parts.push(fundamental.analystSummary);
    sources.push("fundamentals");
  }

  // Invalidation level
  if (result.keyLevels?.invalidation && result.keyLevels.invalidation !== "N/A") {
    parts.push(`If structural support/resistance at ${result.keyLevels.invalidation} fails, the thesis is invalidated`);
    sources.push("invalidation");
  }

  if (parts.length === 0) {
    return {
      text: `No material ${opposite} evidence currently available. The counter-thesis is conditional: ${opposite} structural development would challenge the thesis.`,
      source: "conditional",
    };
  }

  return {
    text: `${opposite.charAt(0).toUpperCase() + opposite.slice(1)} counter-evidence: ${parts.join("; ")}.`,
    source: sources.join(", "),
  };
}

// ── Double-Counting Detection ────────────────────────────────────

function detectDoubleCounting(
  supporting: EvidenceItem[],
  conflicting: EvidenceItem[],
): DoubleCountingWarning[] {
  const warnings: DoubleCountingWarning[] = [];
  const all = [...supporting, ...conflicting];

  // Group by dependency group
  const groups = new Map<DependencyGroup, EvidenceItem[]>();
  for (const item of all) {
    const existing = groups.get(item.dependencyGroup) ?? [];
    existing.push(item);
    groups.set(item.dependencyGroup, existing);
  }

  for (const [group, items] of groups) {
    const supportingItems = items.filter((i) => i.direction === "supporting");
    const conflictingItems = items.filter((i) => i.direction === "conflicting");

    // If multiple supporting items share a dependency group, they may be
    // different representations of the same underlying signal
    if (supportingItems.length >= 2) {
      warnings.push({
        dependencyGroup: group,
        relatedEvidenceCount: supportingItems.length,
        description: `${supportingItems.length} supporting evidence items share dependency group "${group}" — may represent the same underlying signal rather than independent evidence`,
      });
    }
    if (conflictingItems.length >= 2) {
      warnings.push({
        dependencyGroup: group,
        relatedEvidenceCount: conflictingItems.length,
        description: `${conflictingItems.length} conflicting evidence items share dependency group "${group}" — may represent the same underlying signal`,
      });
    }
  }

  return warnings;
}

// ── Thesis Fragility ─────────────────────────────────────────────

function assessFragility(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  supporting: EvidenceItem[],
  conflicting: EvidenceItem[],
  regime?: AnalysisResult["marketRegimeContext"],
  fundamental?: AnalysisResult["fundamentalThesis"],
): { level: FragilityLevel; explanation: string } {
  if (dir === "neutral") {
    return { level: "UNKNOWN", explanation: "No active directional thesis to assess fragility." };
  }

  const strongSupport = supporting.filter((e) => e.strength === "STRONG").length;
  const strongConflict = conflicting.filter((e) => e.strength === "STRONG").length;
  const hasExhaustion = regime?.exhaustionSignals && regime.exhaustionSignals.length > 0;
  const hasFundamentalConflict = fundamental?.alignment === "CONFLICTING";
  const isDataDegraded = !dataQualityOk(result);
  const hasMtfConflict = conflicting.some((e) => e.category === "MTF");
  const hasStructureConflict = conflicting.some((e) => e.category === "STRUCTURE");

  // Count fragility factors
  let fragilityScore = 0;
  if (strongConflict >= 2) fragilityScore += 3;
  else if (strongConflict >= 1) fragilityScore += 2;
  if (conflicting.length >= 3) fragilityScore += 2;
  if (hasExhaustion) fragilityScore += 1;
  if (hasFundamentalConflict) fragilityScore += 2;
  if (isDataDegraded) fragilityScore += 1;
  if (hasMtfConflict) fragilityScore += 1;
  if (hasStructureConflict) fragilityScore += 2;
  if (strongSupport === 0 && conflicting.length > 0) fragilityScore += 2;

  let level: FragilityLevel;
  let explanation: string;

  if (fragilityScore <= 1) {
    level = "LOW";
    explanation = "Thesis has strong supporting evidence with minimal contradictions.";
  } else if (fragilityScore <= 3) {
    level = "MODERATE";
    explanation = "Thesis has some supporting evidence but a few areas of concern exist.";
  } else if (fragilityScore <= 5) {
    level = "ELEVATED";
    explanation = "Multiple contradicting factors present — thesis is vulnerable to invalidation.";
  } else {
    level = "HIGH";
    explanation = "Significant structural, fundamental, or regime conflicts — thesis may not survive adverse conditions.";
  }

  return { level, explanation };
}

// ── Strengtheners / Weaknesseners / Invalidators ─────────────────

function buildThesisModifiers(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  regime?: AnalysisResult["marketRegimeContext"],
  fundamental?: AnalysisResult["fundamentalThesis"],
  forwardPath?: AnalysisResult["forwardMarketPath"],
): { strengtheners: string[]; weaknesseners: string[]; invalidators: string[] } {
  const strengtheners: string[] = [];
  const weaknesseners: string[] = [];
  const invalidators: string[] = [];

  if (dir === "neutral") {
    strengtheners.push("Valid directional structure must develop (HH/HL or LH/LL)");
    strengtheners.push("At least two core factors must agree on direction");
    return { strengtheners, weaknesseners, invalidators };
  }

  // Strengtheners
  if (regime?.continuationQuality === "STRONG" || regime?.continuationQuality === "HEALTHY") {
    strengtheners.push("Maintain continuation quality — fresh directional displacement");
  }
  if (regime?.continuationQuality === "DEVELOPING") {
    strengtheners.push("Continuation developing — needs MTF re-alignment or fresh displacement");
  }
  strengtheners.push("MTF re-alignment with primary trend direction");
  strengtheners.push("Fresh structural BOS or displacement in thesis direction");
  if (fundamental?.alignment === "ALIGNED" || fundamental?.alignment === "STRONGLY_ALIGNED") {
    strengtheners.push("Fundamental context resolving in thesis direction");
  }

  // Weaknesseners
  if (regime?.continuationQuality === "WEAK") {
    weaknesseners.push("Continuation quality weakening — structural durability declining");
  }
  if (regime?.continuationQuality === "EXHAUSTED") {
    weaknesseners.push("Continuation exhausted — new entries carry elevated risk");
  }
  if (regime?.exhaustionSignals && regime.exhaustionSignals.length > 0) {
    weaknesseners.push(`${regime.exhaustionSignals.length} exhaustion signal(s) — reversal/correction risk elevated`);
  }
  if (fundamental?.alignment === "CONFLICTING") {
    weaknesseners.push("Fundamental conflict with technical thesis");
  }
  weaknesseners.push("Repeated failure at key structural level");
  weaknesseners.push("Increasing counter-trend MTF evidence");

  // Invalidators
  if (result.keyLevels?.invalidation && result.keyLevels.invalidation !== "N/A") {
    invalidators.push(`Breach of structural invalidation at ${result.keyLevels.invalidation}`);
  }
  invalidators.push(`HTF structure shifts ${dir === "bullish" ? "bearish" : "bullish"}`);
  invalidators.push("Confirmed BOS/changing of character against current direction");
  if (forwardPath?.invalidationConditions) {
    for (const cond of forwardPath.invalidationConditions) {
      if (!invalidators.includes(cond)) {
        invalidators.push(cond);
      }
    }
  }

  return { strengtheners, weaknesseners, invalidators };
}

// ── Missing Evidence ─────────────────────────────────────────────

function collectMissingEvidence(result: AnalysisResult): string[] {
  const missing: string[] = [];

  if (!result.htfAlignment) missing.push("HTF alignment — cannot assess higher-timeframe structure");
  if (!result.mtfSummary) missing.push("MTF summary — cannot assess multi-timeframe alignment");
  if (!result.marketRegimeContext) missing.push("Market regime — cannot classify continuation quality or phase");
  if (!result.fundamentalThesis) missing.push("Fundamental thesis — cannot assess fundamental alignment");
  if (!result.marketScenario) missing.push("Market scenario — cannot assess continuation vs reversal context");
  if (!result.forwardMarketPath) missing.push("Forward market path — cannot assess forward scenario planning");
  if (!result.decisionTrace) missing.push("Decision trace — cannot verify full evidence chain");
  if (!result.dataQualityContext) missing.push("Data quality context — cannot assess market data health");

  // Provider-specific
  if (result.instrumentType === "crypto" && !result.derivativesData) {
    missing.push("Crypto derivatives — no funding/OI/open-interest context");
  }
  if (result.instrumentType === "forex" && !result.cotContext) {
    missing.push("COT positioning — no institutional positioning data");
  }
  if (result.instrumentType === "commodity" && !result.eiaContext) {
    missing.push("EIA inventory — no energy inventory data");
  }
  if (!result.treasuryContext) {
    missing.push("Treasury yields — no interest-rate macro context");
  }

  return missing;
}

// ── Audit Summary ────────────────────────────────────────────────

function buildAuditSummary(
  dir: "bullish" | "bearish" | "neutral",
  rec: string,
  supportStatus: ThesisSupportStatus,
  fragility: FragilityLevel,
  supporting: EvidenceItem[],
  conflicting: EvidenceItem[],
  missing: string[],
  strengtheners: string[],
  invalidators: string[],
): string {
  const parts: string[] = [];

  const dirLabel = dir === "neutral" ? "Neutral" : dir.charAt(0).toUpperCase() + dir.slice(1);
  parts.push(`Decision: ${rec} · Bias: ${dirLabel} · Thesis support: ${supportStatus.replace(/_/g, " ").toLowerCase()} · Fragility: ${fragility.toLowerCase()}.`);

  // What supports
  const strongSupport = supporting.filter((e) => e.strength === "STRONG");
  if (strongSupport.length > 0) {
    parts.push(`Strongest support: ${strongSupport.map((e) => e.source).join(", ")}.`);
  } else if (supporting.length > 0) {
    parts.push(`Supporting: ${supporting.map((e) => e.source).join(", ")}.`);
  } else {
    parts.push("No material supporting evidence beyond base structural direction.");
  }

  // What challenges
  if (conflicting.length > 0) {
    parts.push(`Challenges: ${conflicting.map((e) => e.source).join(", ")}.`);
  } else {
    parts.push("No material conflicting evidence detected.");
  }

  // Missing
  if (missing.length > 0) {
    parts.push(`Missing: ${missing.length} evidence item(s) — ${missing.slice(0, 3).join("; ")}${missing.length > 3 ? "..." : ""}`);
  }

  // What would strengthen
  if (strengtheners.length > 0) {
    parts.push(`Would strengthen: ${strengtheners[0]}.`);
  }

  // What would invalidate
  if (invalidators.length > 0) {
    parts.push(`Would invalidate: ${invalidators[0]}.`);
  }

  return parts.join(" ");
}

// ── Main Builder ─────────────────────────────────────────────────

export function buildEvidenceChallenge(result: AnalysisResult): EvidenceChallengeContext {
  const dir = dirBias(result);
  const regime = result.marketRegimeContext;
  const fundamental = result.fundamentalThesis;
  const forwardPath = result.forwardMarketPath;

  // Collect all evidence
  const structureEvidence = collectStructureEvidence(result, dir);
  const mtfEvidence = collectMtfEvidence(result, dir);
  const regimeEvidence = collectRegimeEvidence(result, dir);
  const fundamentalEvidence = collectFundamentalEvidence(result, dir);
  const macroEvidence = collectMacroEvidence(result);
  const dataQualityEvidence = collectDataQualityEvidence(result);
  const scenarioEvidence = collectScenarioEvidence(result, dir);

  const allEvidence = [
    ...structureEvidence,
    ...mtfEvidence,
    ...regimeEvidence,
    ...fundamentalEvidence,
    ...macroEvidence,
    ...dataQualityEvidence,
    ...scenarioEvidence,
  ];

  // Separate by direction
  const supportingEvidence = allEvidence.filter((e) => e.direction === "supporting");
  const conflictingEvidence = allEvidence.filter((e) => e.direction === "conflicting");
  const neutralEvidence = allEvidence.filter((e) => e.direction === "neutral" || e.direction === "unavailable");

  // Thesis support audit
  const { status: thesisSupportStatus, explanation: thesisSupportExplanation } = auditThesisSupport(
    result, supportingEvidence, conflictingEvidence, dir,
  );

  // Strongest evidence
  const strengthOrder: Record<string, number> = { STRONG: 3, MODERATE: 2, WEAK: 1, UNKNOWN: 0 };
  const sortedSupport = [...supportingEvidence].sort((a, b) => (strengthOrder[b.strength] ?? 0) - (strengthOrder[a.strength] ?? 0));
  const sortedConflict = [...conflictingEvidence].sort((a, b) => (strengthOrder[b.strength] ?? 0) - (strengthOrder[a.strength] ?? 0));
  const strongestSupporting = sortedSupport[0] ?? null;
  const strongestConflicting = sortedConflict[0] ?? null;

  // Counter-thesis
  const counterThesis = buildCounterThesis(result, dir, conflictingEvidence, regime, fundamental);

  // Double-counting
  const doubleCountingWarnings = detectDoubleCounting(supportingEvidence, conflictingEvidence);

  // Fragility
  const { level: thesisFragility, explanation: fragilityExplanation } = assessFragility(
    result, dir, supportingEvidence, conflictingEvidence, regime, fundamental,
  );

  // Missing evidence
  const missingEvidence = collectMissingEvidence(result);

  // Thesis modifiers
  const { strengtheners, weaknesseners, invalidators } = buildThesisModifiers(
    result, dir, regime, fundamental, forwardPath,
  );

  // Audit summary
  const auditSummary = buildAuditSummary(
    dir, result.recommendation, thesisSupportStatus, thesisFragility,
    supportingEvidence, conflictingEvidence, missingEvidence, strengtheners, invalidators,
  );

  return {
    supportingEvidence,
    conflictingEvidence,
    neutralEvidence,
    thesisSupportStatus,
    thesisSupportExplanation,
    strongestSupportingEvidence: strongestSupporting,
    strongestConflictingEvidence: strongestConflicting,
    counterThesis: counterThesis.text,
    counterThesisSource: counterThesis.source,
    doubleCountingWarnings,
    thesisFragility,
    fragilityExplanation,
    missingEvidence,
    thesisStrengtheners: strengtheners,
    thesisWeaknesseners: weaknesseners,
    thesisInvalidators: invalidators,
    auditSummary,
    evidenceImpact: "INFORMATIONAL_ONLY",
  };
}
