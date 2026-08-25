/**
 * Phase 29 — FORWARD MARKET PATH.
 *
 * Professional forward-looking scenario planning that reasons about what
 * the market can reasonably do NEXT based on existing engine outputs.
 *
 * This module does NOT:
 * - recalculate bias / conviction / gates
 * - modify recommendation or trade plan
 * - fabricate price targets or probabilities
 * - create synthetic levels
 * - inject evidence into the decision engine
 *
 * The existing engine remains authoritative.
 * Forward path is a professional interpretation layer.
 *
 * Core principle:
 *   CURRENT STATE → FORWARD PATH → CONDITIONS → INVALIDATION → ALTERNATE → ACTIONABILITY
 */

import type { AnalysisResult } from "@/types/analysis";
import type { MarketRegimeContext } from "@/lib/market-regime";
import type { FundamentalThesis } from "@/lib/fundamental-thesis";
import type { MarketScenarioContext } from "@/lib/market-scenario";

// ── Types ────────────────────────────────────────────────────────

export type PathStatus =
  | "CONTINUATION_FAVORED"
  | "CONTINUATION_POSSIBLE"
  | "CORRECTION_FAVORED"
  | "REVERSAL_ATTEMPT"
  | "REVERSAL_FAVORED"
  | "RANGE_CONTINUATION"
  | "BREAKOUT_ATTEMPT"
  | "BREAKOUT_CONFIRMED"
  | "BREAKOUT_FAILURE"
  | "UNCONFIRMED";

export type TimeHorizon = "SHORT_TERM" | "INTRADAY" | "SWING";
export type RiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH";

export interface PathEvidence {
  source: string;
  direction: "supportive" | "conflicting" | "neutral";
  explanation: string;
  timeframe?: string;
  weight: "high" | "moderate" | "low";
}

export interface TriggerLevel {
  level: string;
  type: "support" | "resistance" | "invalidation" | "entry" | "fvg" | "ob" | "liquidity";
  source: string;
  description: string;
}

export interface ScenarioNode {
  label: string;
  condition: string;
  outcome: string;
}

export interface ForwardMarketPathContext {
  /** Current market state summary. */
  currentState: string;
  /** Primary forward-looking path classification. */
  primaryPath: PathStatus;
  /** Alternate path if primary fails. */
  alternatePath: PathStatus;
  /** Overall path status description. */
  pathStatus: string;
  /** Directional bias underlying the forward path. */
  directionalBias: "bullish" | "bearish" | "neutral";
  /** Time horizon for this assessment. */
  horizon: TimeHorizon;
  /** Evidence supporting the primary path. */
  pathEvidence: PathEvidence[];
  /** Evidence opposing the primary path. */
  opposingEvidence: PathEvidence[];
  /** Conditions required for primary path to confirm. */
  confirmationConditions: string[];
  /** Conditions that would invalidate the primary path. */
  invalidationConditions: string[];
  /** Key trigger levels. */
  triggerLevels: TriggerLevel[];
  /** Levels to watch for future context. */
  watchLevels: TriggerLevel[];
  /** What the market should do if the primary path is correct. */
  expectedMarketBehavior: string;
  /** What the market should do if the primary path is wrong. */
  failureBehavior: string;
  /** Risks to the primary path. */
  pathRisks: string[];
  /** Structural confidence level. */
  structuralConfidence: "high" | "moderate" | "low" | "insufficient_data";
  /** Data reliability assessment. */
  dataReliability: "good" | "degraded" | "insufficient" | "unavailable";
  /** Best next action recommendation. */
  nextBestAction: string;
  /** Concise rationale for the entire forward path. */
  rationale: string;
  /** Compact conditional scenario tree. */
  scenarioTree: ScenarioNode[];
  /** Trader-focused view. */
  traderView: string;
  /** Investor/swing-focused view. */
  investorView: string;
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

function hasMaterialContradictions(result: AnalysisResult): boolean {
  return (result.keyContradictions?.length ?? 0) > 0;
}

function dataQualityOk(result: AnalysisResult): boolean {
  if (!result.dataQualityContext) return true;
  return result.dataQualityContext.primaryData.status === "GOOD";
}

function getDataReliability(result: AnalysisResult): "good" | "degraded" | "insufficient" | "unavailable" {
  if (!result.dataQualityContext) return "good";
  const s = result.dataQualityContext.primaryData.status;
  if (s === "GOOD") return "good";
  if (s === "DEGRADED") return "degraded";
  if (s === "INSUFFICIENT") return "insufficient";
  if (s === "UNAVAILABLE" || s === "INVALID") return "unavailable";
  return "good";
}

function getHorizon(result: AnalysisResult): TimeHorizon {
  if (result.tradingStyle === "scalping") return "SHORT_TERM";
  if (result.tradingStyle === "swing") return "SWING";
  return "INTRADAY";
}

function isExtended(result: AnalysisResult, dir: "bullish" | "bearish"): RiskLevel {
  if (result.marketRegimeContext?.marketPhase === "LATE_TREND") return "ELEVATED";
  if (result.marketRegimeContext?.marketPhase === "TREND_MATURE") return "MODERATE";
  if (result.marketRegimeContext?.continuationQuality === "EXHAUSTED") return "HIGH";
  if (result.marketRegimeContext?.continuationQuality === "WEAK") return "ELEVATED";
  return "LOW";
}

function computeExtensionRisk(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  regime?: MarketRegimeContext,
): RiskLevel {
  let risk: RiskLevel = "LOW";

  if (regime?.marketPhase === "LATE_TREND") risk = "ELEVATED";
  if (regime?.marketPhase === "TREND_MATURE" && risk === "LOW") risk = "MODERATE";
  if (regime?.continuationQuality === "EXHAUSTED") risk = "HIGH";
  if (String(regime?.continuationQuality) === "WEAK" && risk === "LOW") risk = "ELEVATED";

  // Exhaustion signals increase risk
  if (regime && regime.exhaustionSignals.length >= 2) {
    if (risk === "LOW") risk = "MODERATE";
    else if (risk === "MODERATE") risk = "ELEVATED";
  }

  return risk;
}

// ── Path Classification ──────────────────────────────────────────

function classifyPrimaryPath(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  regime?: MarketRegimeContext,
  fundamental?: FundamentalThesis,
  scenario?: MarketScenarioContext,
): PathStatus {
  if (dir === "neutral") {
    if (regime?.regime === "RANGE") return "RANGE_CONTINUATION";
    return "UNCONFIRMED";
  }

  const htf = htfDir(result);
  const mtfA = mtfAligned(result, dir);
  const contraMtf = hasContraMtf(result, dir);
  const extRisk = computeExtensionRisk(result, dir, regime);

  // Reversal favored — HTF broken + contra MTF + structural evidence
  if (regime?.trendTransition.transitionType === "REVERSAL_CONFIRMED") return "REVERSAL_FAVORED";
  if (regime?.trendTransition.transitionType === "REVERSAL_ATTEMPT" && contraMtf) return "REVERSAL_ATTEMPT";

  // Correction favored
  if ((regime?.continuationQuality as string) === "WEAK" || regime?.continuationQuality === "EXHAUSTED") {
    if (contraMtf) return "CORRECTION_FAVORED";
    return "CORRECTION_FAVORED";
  }

  // Breakout
  if (regime?.regime === "BREAKOUT_DEVELOPING") return "BREAKOUT_ATTEMPT";
  if (regime?.regime === "BREAKDOWN_DEVELOPING") return "BREAKOUT_ATTEMPT";

  // Continuation
  if (htf === dir && mtfA && regime?.continuationQuality !== "WEAK") {
    return "CONTINUATION_FAVORED";
  }
  if (htf === dir || mtfA) {
    return "CONTINUATION_POSSIBLE";
  }

  return "UNCONFIRMED";
}

function classifyAlternatePath(
  primary: PathStatus,
  dir: "bullish" | "bearish" | "neutral",
  regime?: MarketRegimeContext,
): PathStatus {
  if (dir === "neutral") {
    return "UNCONFIRMED";
  }

  switch (primary) {
    case "CONTINUATION_FAVORED":
    case "CONTINUATION_POSSIBLE":
      return "CORRECTION_FAVORED";
    case "CORRECTION_FAVORED":
      return dir === "bullish" ? "CONTINUATION_POSSIBLE" : "CONTINUATION_POSSIBLE";
    case "REVERSAL_ATTEMPT":
      return dir === "bullish" ? "CONTINUATION_POSSIBLE" : "CONTINUATION_POSSIBLE";
    case "REVERSAL_FAVORED":
      return dir === "bullish" ? "CORRECTION_FAVORED" : "CORRECTION_FAVORED";
    case "BREAKOUT_ATTEMPT":
      return "BREAKOUT_FAILURE";
    case "RANGE_CONTINUATION":
      return "UNCONFIRMED";
    default:
      return "UNCONFIRMED";
  }
}

// ── Evidence Assembly ─────────────────────────────────────────────

function buildPathEvidence(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
  primary: PathStatus,
): PathEvidence[] {
  const evidence: PathEvidence[] = [];

  if (dir === "neutral") return evidence;

  // HTF structure
  if (htfDir(result) === dir) {
    evidence.push({
      source: "HTF structure",
      direction: "supportive",
      explanation: `Higher-timeframe structure is ${dir}`,
      weight: "high",
    });
  } else if (htfDir(result) !== "neutral") {
    evidence.push({
      source: "HTF structure",
      direction: "conflicting",
      explanation: `Higher-timeframe structure conflicts: ${htfDir(result)} vs current ${dir}`,
      weight: "high",
    });
  }

  // MTF alignment
  if (mtfAligned(result, dir)) {
    evidence.push({
      source: "MTF alignment",
      direction: "supportive",
      explanation: "Multi-timeframe structure aligns with directional bias",
      weight: "high",
    });
  } else if (hasContraMtf(result, dir)) {
    evidence.push({
      source: "MTF alignment",
      direction: "conflicting",
      explanation: "Multi-timeframe structure conflicts with directional bias",
      weight: "high",
    });
  }

  // Regime / continuation quality
  if (result.marketRegimeContext) {
    const rc = result.marketRegimeContext.continuationQuality;
    if (rc === "STRONG" || rc === "HEALTHY") {
      evidence.push({
        source: "Continuation quality",
        direction: "supportive",
        explanation: `Continuation quality is ${rc.toLowerCase()}`,
        weight: "moderate",
      });
    } else if (rc === "WEAK" || rc === "EXHAUSTED") {
      evidence.push({
        source: "Continuation quality",
        direction: "conflicting",
        explanation: `Continuation quality is ${rc.toLowerCase()}`,
        weight: "moderate",
      });
    }
  }

  // Contradictions
  if (hasMaterialContradictions(result)) {
    evidence.push({
      source: "Cross-layer contradictions",
      direction: "conflicting",
      explanation: "Material contradictions detected between evidence layers",
      weight: "moderate",
    });
  }

  return evidence;
}

function buildOpposingEvidence(
  result: AnalysisResult,
  dir: "bullish" | "bearish" | "neutral",
): PathEvidence[] {
  const evidence: PathEvidence[] = [];
  if (dir === "neutral") return evidence;

  // Opposing HTF
  const htfD = htfDir(result);
  if (htfD !== dir && htfD !== "neutral") {
    evidence.push({
      source: "HTF structure",
      direction: "conflicting",
      explanation: `Higher-timeframe structure opposes: ${htfD}`,
      weight: "high",
    });
  }

  // Counter MTF
  if (hasContraMtf(result, dir)) {
    evidence.push({
      source: "MTF conflict",
      direction: "conflicting",
      explanation: "Counter-trend multi-timeframe evidence",
      weight: "high",
    });
  }

  // Exhaustion
  if (result.marketRegimeContext?.exhaustionSignals && result.marketRegimeContext.exhaustionSignals.length > 0) {
    evidence.push({
      source: "Exhaustion signals",
      direction: "conflicting",
      explanation: `${result.marketRegimeContext.exhaustionSignals.length} exhaustion signal(s) detected`,
      weight: "moderate",
    });
  }

  // Fundamental conflict
  if (result.fundamentalThesis?.alignment === "CONFLICTING") {
    evidence.push({
      source: "Fundamental alignment",
      direction: "conflicting",
      explanation: "Fundamental evidence conflicts with technical structure",
      weight: "moderate",
    });
  }

  return evidence;
}

// ── Trigger Levels ───────────────────────────────────────────────

function buildTriggerLevels(result: AnalysisResult): { triggers: TriggerLevel[]; watches: TriggerLevel[] } {
  const triggers: TriggerLevel[] = [];
  const watches: TriggerLevel[] = [];

  if (result.keyLevels) {
    if (result.keyLevels.support && result.keyLevels.support !== "N/A") {
      triggers.push({
        level: result.keyLevels.support,
        type: "support",
        source: "keyLevels",
        description: "Nearest structural support",
      });
    }
    if (result.keyLevels.resistance && result.keyLevels.resistance !== "N/A") {
      triggers.push({
        level: result.keyLevels.resistance,
        type: "resistance",
        source: "keyLevels",
        description: "Nearest structural resistance",
      });
    }
    if (result.keyLevels.invalidation && result.keyLevels.invalidation !== "N/A") {
      triggers.push({
        level: result.keyLevels.invalidation,
        type: "invalidation",
        source: "keyLevels",
        description: "Structural invalidation level",
      });
    }
  }

  // Trade plan levels as watch levels
  if (result.tradePlan) {
    watches.push({
      level: result.tradePlan.entry,
      type: "entry",
      source: "tradePlan",
      description: "Trade plan entry level",
    });
  }

  return { triggers, watches };
}

// ── Scenario Tree ────────────────────────────────────────────────

function buildScenarioTree(
  dir: "bullish" | "bearish" | "neutral",
  primary: PathStatus,
  invalidation: string,
): ScenarioNode[] {
  const tree: ScenarioNode[] = [];

  if (dir === "neutral") {
    tree.push({
      label: "PRIMARY: Range / unconfirmed",
      condition: "Price remains within current range",
      outcome: "No directional trade — wait for breakout/breakdown confirmation",
    });
    tree.push({
      label: "ALTERNATE: Breakout / breakdown",
      condition: "Price breaks above resistance or below support with displacement",
      outcome: "New directional path develops — await confirmation",
    });
    return tree;
  }

  const dirLabel = dir === "bullish" ? "bullish" : "bearish";

  if (primary === "CONTINUATION_FAVORED" || primary === "CONTINUATION_POSSIBLE") {
    tree.push({
      label: `PRIMARY: ${dirLabel} continuation`,
      condition: `Support holds, ${dir} displacement appears, MTF re-alignment`,
      outcome: `${dirLabel} continuation becomes confirmed`,
    });
    tree.push({
      label: "ALTERNATE: Correction / reversal attempt",
      condition: `Support fails, bearish BOS develops, MTF aligns against trend`,
      outcome: `${dirLabel} continuation thesis invalidated`,
    });
  } else if (primary === "CORRECTION_FAVORED") {
    tree.push({
      label: `PRIMARY: ${dirLabel} correction`,
      condition: "Momentum fades, price retraces to meaningful support/resistance",
      outcome: "Correction within existing trend structure",
    });
    tree.push({
      label: "ALTERNATE: Trend continuation",
      condition: "Support holds, fresh bullish displacement",
      outcome: "Correction ends and primary trend resumes",
    });
  } else if (primary === "REVERSAL_ATTEMPT" || primary === "REVERSAL_FAVORED") {
    tree.push({
      label: "PRIMARY: Reversal developing",
      condition: "HTF structure break, MTF alignment opposite, displacement",
      outcome: "Reversal confirmed — new directional path",
    });
    tree.push({
      label: "ALTERNATE: Correction only",
      condition: "HTF structure holds, support recovered",
      outcome: "Reversal attempt fails — trend continues",
    });
  } else {
    tree.push({
      label: "PRIMARY: Awaiting confirmation",
      condition: "Insufficient evidence for clear path",
      outcome: "WAIT until structural clarity develops",
    });
  }

  // Invalidation node
  if (invalidation && invalidation !== "N/A") {
    tree.push({
      label: "INVALIDATION",
      condition: `Price reaches ${invalidation}`,
      outcome: "Thesis invalidated — reassess from new structural state",
    });
  }

  return tree;
}

// ── Main Builder ─────────────────────────────────────────────────

export function buildForwardMarketPath(result: AnalysisResult): ForwardMarketPathContext {
  const dir = dirBias(result);
  const regime = result.marketRegimeContext;
  const fundamental = result.fundamentalThesis;
  const scenario = result.marketScenario;
  const horizon = getHorizon(result);
  const dataReliability = getDataReliability(result);

  // ── Current state ──
  const dirLabel = dir === "neutral" ? "Neutral" : dir.charAt(0).toUpperCase() + dir.slice(1);
  const phaseLabel = regime?.marketPhase?.replace(/_/g, " ").toLowerCase() ?? "unknown phase";
  const regimeLabel = regime?.regime?.replace(/_/g, " ").toLowerCase() ?? "unknown regime";
  const qualityLabel = regime?.continuationQuality?.toLowerCase() ?? "unknown";

  const currentState = `${dirLabel} HTF structure · ${phaseLabel} · ${regimeLabel} · continuation ${qualityLabel}`;

  // ── Path classification ──
  const primaryPath = classifyPrimaryPath(result, dir, regime, fundamental, scenario);
  const alternatePath = classifyAlternatePath(primaryPath, dir, regime);

  // ── Path status text ──
  const pathStatus = primaryPath.replace(/_/g, " ").toLowerCase();

  // ── Evidence ──
  const pathEvidence = buildPathEvidence(result, dir, primaryPath);
  const opposingEvidence = buildOpposingEvidence(result, dir as "bullish" | "bearish" | "neutral");

  // ── Trigger levels ──
  const { triggers: triggerLevels, watches: watchLevels } = buildTriggerLevels(result);

  // ── Confirmation conditions ──
  const confirmationConditions: string[] = [];
  const invalidationConditions: string[] = [];

  if (dir === "neutral") {
    confirmationConditions.push("Clear directional breakout with displacement");
    confirmationConditions.push("MTF alignment toward breakout direction");
  } else {
    if (primaryPath === "CONTINUATION_FAVORED" || primaryPath === "CONTINUATION_POSSIBLE") {
      confirmationConditions.push("Continuation of current trend structure");
      confirmationConditions.push("MTF alignment maintained");
      if (primaryPath === "CONTINUATION_POSSIBLE") {
        confirmationConditions.push("Fresh directional displacement for confirmation");
      }
    } else if (primaryPath === "CORRECTION_FAVORED") {
      confirmationConditions.push("Successful retest of structural support/resistance");
      confirmationConditions.push("Fresh directional displacement from key level");
    } else if (primaryPath === "REVERSAL_ATTEMPT" || primaryPath === "REVERSAL_FAVORED") {
      confirmationConditions.push("HTF structural break in opposite direction");
      confirmationConditions.push("MTF alignment toward new direction");
      confirmationConditions.push("Sustained displacement — not just a wick");
    }
  }

  // Invalidation
  if (result.keyLevels?.invalidation && result.keyLevels.invalidation !== "N/A") {
    invalidationConditions.push(`Structural invalidation at ${result.keyLevels.invalidation}`);
  }
  if (dir !== "neutral") {
    const opposite = dir === "bullish" ? "bearish" : "bullish";
    invalidationConditions.push(`HTF structure shifts ${opposite}`);
    invalidationConditions.push(`Confirmed BOS against current direction`);
  }

  // ── Expected behavior ──
  let expectedMarketBehavior = "";
  let failureBehavior = "";

  if (primaryPath === "CONTINUATION_FAVORED" || primaryPath === "CONTINUATION_POSSIBLE") {
    expectedMarketBehavior = `Price should continue ${dir} with structural higher-${dir === "bullish" ? "lows" : "lows"}. Pullbacks should find support.`;
    failureBehavior = `Price fails to hold structural support, breaks lower with displacement, MTF turns against`;
  } else if (primaryPath === "CORRECTION_FAVORED") {
    expectedMarketBehavior = "Price retraces toward key support/resistance. Momentum fades against primary trend.";
    failureBehavior = "Correction deepens beyond structural support — may develop into reversal attempt";
  } else if (primaryPath === "REVERSAL_ATTEMPT" || primaryPath === "REVERSAL_FAVORED") {
    expectedMarketBehavior = "Price breaks HTF structural level with displacement. MTF alignment shifts.";
    failureBehavior = "Reversal fails — price recovers structural level and resumes original trend";
  } else if (primaryPath === "RANGE_CONTINUATION") {
    expectedMarketBehavior = "Price oscillates within range boundaries. No directional breakout.";
    failureBehavior = "Price breaks range with displacement";
  } else {
    expectedMarketBehavior = "Insufficient clarity — market awaits structural catalyst.";
    failureBehavior = "Continued uncertainty until structural clarity develops";
  }

  // ── Path risks ──
  const pathRisks: string[] = [];
  const extRisk = computeExtensionRisk(result, dir, regime);
  if (extRisk === "ELEVATED" || extRisk === "HIGH") {
    pathRisks.push(`Extension/chasing risk is ${extRisk.toLowerCase()}`);
  }
  if (hasMaterialContradictions(result)) {
    pathRisks.push("Material cross-layer contradictions present");
  }
  if (fundamental?.alignment === "CONFLICTING") {
    pathRisks.push("Fundamental evidence conflicts with technical path");
  }
  if (fundamental?.eventRisk === "HIGH" || fundamental?.eventRisk === "ELEVATED") {
    pathRisks.push("Elevated event/catalyst risk");
  }
  if (dataReliability !== "good") {
    pathRisks.push(`Data quality is ${dataReliability}`);
  }

  // ── Structural confidence ──
  let structuralConfidence: ForwardMarketPathContext["structuralConfidence"] = "moderate";
  if (dataReliability === "insufficient" || dataReliability === "unavailable") {
    structuralConfidence = "insufficient_data";
  } else if (
    (primaryPath === "CONTINUATION_FAVORED" || primaryPath === "REVERSAL_FAVORED") &&
    opposingEvidence.length <= 1 &&
    dataReliability === "good"
  ) {
    structuralConfidence = "high";
  } else if (opposingEvidence.length >= 3 || dataReliability === "degraded") {
    structuralConfidence = "low";
  }

  // ── Next best action ──
  let nextBestAction = "";
  if (primaryPath === "CONTINUATION_FAVORED" && extRisk !== "HIGH") {
    nextBestAction = dir === "bullish" ? "Look for long continuation entries with structural confirmation" : "Look for short continuation entries with structural confirmation";
  } else if (primaryPath === "CONTINUATION_POSSIBLE") {
    nextBestAction = "Wait for confirmation before entering — continuation possible but unconfirmed";
  } else if (primaryPath === "CORRECTION_FAVORED") {
    nextBestAction = "Wait for correction to complete and fresh directional displacement before acting";
  } else if (primaryPath === "REVERSAL_ATTEMPT" || primaryPath === "REVERSAL_FAVORED") {
    nextBestAction = "Do not chase — wait for structural confirmation of reversal";
  } else if (extRisk === "HIGH") {
    nextBestAction = "Avoid chasing extension — wait for pullback or continuation confirmation";
  } else if (dir === "neutral") {
    nextBestAction = "Wait for directional clarity";
  } else {
    nextBestAction = "Wait for clearer structural setup";
  }

  // ── Rationale ──
  let rationale = `Market is ${dirLabel.toLowerCase()} with ${regimeLabel} regime. `;
  rationale += `Continuation quality: ${qualityLabel}. `;
  rationale += `Forward path: ${pathStatus}. `;
  if (opposingEvidence.length > 0) {
    rationale += `${opposingEvidence.length} opposing evidence item(s). `;
  }
  rationale += nextBestAction;

  // ── Scenario tree ──
  const scenarioTree = buildScenarioTree(dir, primaryPath, result.keyLevels?.invalidation ?? "");

  // ── Trader / Investor views ──
  let traderView = "";
  let investorView = "";

  if (horizon === "SHORT_TERM") {
    if (extRisk === "HIGH") {
      traderView = "AVOID chasing extension — wait for pullback + fresh displacement";
    } else if (primaryPath === "CONTINUATION_FAVORED") {
      traderView = `${dirLabel} continuation — look for LTF entry confirmation`;
    } else if (primaryPath === "CORRECTION_FAVORED") {
      traderView = "Correction in progress — wait for completion + fresh displacement";
    } else {
      traderView = "Insufficient clarity for short-term entry";
    }
  } else if (horizon === "INTRADAY") {
    if (primaryPath === "CONTINUATION_FAVORED") {
      traderView = `${dirLabel} structure — look for intraday continuation entries`;
    } else if (primaryPath === "CORRECTION_FAVORED") {
      traderView = "Correction developing — wait for intraday structural resolution";
    } else {
      traderView = "Wait for intraday structural clarity";
    }
  } else {
    // SWING
    if (primaryPath === "CONTINUATION_FAVORED") {
      traderView = "Swing structure supports continuation — monitor HTF invalidation";
    } else if (primaryPath === "CORRECTION_FAVORED") {
      traderView = "Correction within swing trend — hold or wait for re-entry";
    } else if (primaryPath === "REVERSAL_ATTEMPT" || primaryPath === "REVERSAL_FAVORED") {
      traderView = "Reversal developing at HTF — reassess swing positioning";
    } else {
      traderView = "Swing outlook unclear — monitor structural development";
    }
  }

  // Investor view always focuses on HTF
  if (htfDir(result) === "bullish") {
    investorView = "HTF bullish structure intact — continuation preferred unless invalidation occurs";
    if (regime?.marketPhase === "LATE_TREND") {
      investorView += " Late trend phase — increasing exhaustion awareness";
    }
  } else if (htfDir(result) === "bearish") {
    investorView = "HTF bearish structure intact — continuation preferred unless invalidation occurs";
    if (regime?.marketPhase === "LATE_TREND") {
      investorView += " Late trend phase — increasing exhaustion awareness";
    }
  } else {
    investorView = "No clear HTF structural direction — range/unconfirmed";
  }

  return {
    currentState,
    primaryPath,
    alternatePath,
    pathStatus,
    directionalBias: dir,
    horizon,
    pathEvidence,
    opposingEvidence,
    confirmationConditions,
    invalidationConditions,
    triggerLevels,
    watchLevels,
    expectedMarketBehavior,
    failureBehavior,
    pathRisks,
    structuralConfidence,
    dataReliability,
    nextBestAction,
    rationale,
    scenarioTree,
    traderView,
    investorView,
  };
}
