/**
 * Phase 28 — PROFESSIONAL THESIS.
 *
 * Top-level composition of:
 *   - MarketRegimeContext (regime, phase, continuation quality, exhaustion, transition)
 *   - FundamentalThesis (fundamental, macro, catalyst alignment)
 *   - MarketScenarioContext (continuation vs reversal)
 *   - AnalysisResult fields (structure, MTF, liquidity, key levels, conviction, etc.)
 *
 * into a unified, professional-grade analyst reading.
 *
 * CRITICAL DESIGN PRINCIPLES:
 *   1. CURRENT DIRECTION ≠ FUTURE CONFIRMATION
 *   2. This is NOT a prediction engine
 *   3. This is NOT a second decision engine
 *   4. All fields are derived from existing engine outputs
 *   5. Professional thesis cannot modify bias, conviction, gates, or trade plan
 *   6. No probability / win-rate / guarantee language
 *   7. WAIT must remain distinct from NO_TRADE
 */

import type { AnalysisResult } from "@/types/analysis";
import type { EvidenceItem } from "@/lib/analyst-thesis";
import { buildMarketRegime, type MarketRegimeContext } from "@/lib/market-regime";
import { buildFundamentalThesis, type FundamentalThesis } from "@/lib/fundamental-thesis";
import type { MarketScenarioContext } from "@/lib/market-scenario";

// ── Types ────────────────────────────────────────────────────────

export type Actionability = "LONG" | "SHORT" | "WAIT" | "NO_TRADE";

export interface ProfessionalThesis {
  /** Current market state summary. */
  marketState: string;
  /** Detailed market regime. */
  marketRegime: MarketRegimeContext;
  /** Fundamental/macro alignment. */
  fundamentalThesis: FundamentalThesis;
  /** Current structural direction. */
  currentDirection: "bullish" | "bearish" | "neutral";
  /** Continuation scenario from Phase 27. */
  continuationScenario?: string;
  /** Reversal scenario from Phase 27. */
  reversalScenario?: string;
  /** Primary supported scenario. */
  primaryScenario: string;
  /** Alternate scenario if primary fails. */
  alternateScenario: string;
  /** Confirmation conditions for the primary scenario. */
  confirmationConditions: string[];
  /** Invalidation conditions for the primary scenario. */
  invalidationConditions: string[];
  /** Critical information currently missing. */
  missingInformation: string[];
  /** Actionability interpretation: LONG / SHORT / WAIT / NO_TRADE. */
  actionability: Actionability;
  /** Why this actionability. */
  actionabilityReason: string;
  /** Concise analyst summary. */
  analystSummary: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function dirBias(result: AnalysisResult): "bullish" | "bearish" | "neutral" {
  if (result.bias === "Bullish") return "bullish";
  if (result.bias === "Bearish") return "bearish";
  return "neutral";
}

function computeActionability(
  result: AnalysisResult,
  regime: MarketRegimeContext,
  fundamental: FundamentalThesis,
  scenario?: MarketScenarioContext,
): { actionability: Actionability; reason: string } {
  // NO_TRADE is terminal — no override
  if (result.recommendation === "NO_TRADE") {
    return {
      actionability: "NO_TRADE",
      // Do not echo noTradeReasons here — they are already surfaced by
      // the analyst thesis "why-this-decision" panel. Use a concise label.
      reason: "Structural/gate conditions not met — see blocking reasons below",
    };
  }

  const dir = dirBias(result);

  // If no trade recommendation at all → WAIT
  if (!result.tradePlan) {
    return { actionability: "WAIT", reason: "No trade plan generated — waiting for clearer setup" };
  }

  // Scenario-based WAIT: if scenario says WAIT, defer
  if (scenario?.scenario === "WAIT" || scenario?.scenario === "UNCONFIRMED") {
    return { actionability: "WAIT", reason: scenario.waitReason ?? "Scenario unconfirmed — continuation or reversal unclear" };
  }

  // Exhaustion/reversal developing → WAIT
  if (regime.continuationQuality === "EXHAUSTED" && regime.trendTransition.transitionType !== "CONTINUATION") {
    return {
      actionability: "WAIT",
      reason: "Continuation exhausted — reversal risk elevated, waiting for structural confirmation",
    };
  }

  if (regime.trendTransition.transitionType === "REVERSAL_ATTEMPT" || regime.trendTransition.transitionType === "REVERSAL_CONFIRMED") {
    if (result.recommendation === "LONG" || result.recommendation === "SHORT") {
      // Reversal developing — check if it's against the current recommendation
      const recDir = result.recommendation === "LONG" ? "bullish" : "bearish";
      if (regime.currentDirection !== recDir) {
        return { actionability: "WAIT", reason: "Trend transition in progress — waiting for structural resolution" };
      }
    }
  }

  // Event risk HIGH → WAIT
  if (fundamental.eventRisk === "HIGH") {
    return { actionability: "WAIT", reason: "High event risk — waiting for catalyst resolution" };
  }

  // Fundamental conflicting + weak continuation → WAIT
  if (fundamental.alignment === "CONFLICTING" && (regime.continuationQuality === "WEAK" || regime.continuationQuality === "EXHAUSTED")) {
    return { actionability: "WAIT", reason: "Fundamental conflict with weak continuation — no clear actionability" };
  }

  // Default: engine's recommendation is actionable
  if (dir === "bullish" && result.tradePlan.direction === "long") {
    return { actionability: "LONG", reason: "Engine recommendation is LONG with valid trade plan" };
  }
  if (dir === "bearish" && result.tradePlan.direction === "short") {
    return { actionability: "SHORT", reason: "Engine recommendation is SHORT with valid trade plan" };
  }

  // Fallback: respect engine recommendation
  if (result.recommendation === "LONG") {
    return { actionability: "LONG", reason: "Engine recommendation is LONG" };
  }
  if (result.recommendation === "SHORT") {
    return { actionability: "SHORT", reason: "Engine recommendation is SHORT" };
  }

  return { actionability: "WAIT", reason: "Insufficient clarity for actionable decision" };
}

// ── Main builder ─────────────────────────────────────────────────

export function buildProfessionalThesis(
  result: AnalysisResult,
  scenario?: MarketScenarioContext,
): ProfessionalThesis {
  const regime = buildMarketRegime(result);
  const fundamental = buildFundamentalThesis(result);
  const dir = dirBias(result);

  // Market state
  const marketState = dir === "neutral"
    ? "Neutral structure — no clear directional bias"
    : dir === "bullish"
    ? "Bullish structure with varying degrees of confirmation"
    : "Bearish structure with varying degrees of confirmation";

  // Confirmation / invalidation
  const confirmationConditions = [...regime.confirmationConditions];
  const invalidationConditions = [...regime.invalidationConditions];

  if (result.keyLevels?.invalidation) {
    invalidationConditions.push(`Structural invalidation at ${result.keyLevels.invalidation}`);
  }

  // Missing information
  const missingInformation = [...new Set([
    ...regime.missingInformation,
    ...fundamental.missingInformation,
  ])];

  // Continuation / reversal from scenario
  const continuationScenario = scenario?.scenario
    ? `${scenario.continuationStatus}: ${scenario.scenario}`
    : undefined;
  const reversalScenario = scenario?.scenario
    ? `Reversal status: ${scenario.reversalStatus}`
    : undefined;

  // Primary / alternate
  const primaryScenario = regime.primaryScenario;
  const alternateScenario = regime.alternateScenario;

  // Actionability
  const { actionability, reason: actionabilityReason } = computeActionability(result, regime, fundamental, scenario);

  // Analyst summary
  const regimeLabel = regime.regime.replace(/_/g, " ").toLowerCase();
  const phaseLabel = regime.marketPhase.replace(/_/g, " ").toLowerCase();
  const qualityLabel = regime.continuationQuality.toLowerCase();
  const alignmentLabel = fundamental.alignment.replace(/_/g, " ").toLowerCase();

  let analystSummary = `Market regime: ${regimeLabel} (${phaseLabel}). `;
  analystSummary += `Continuation quality: ${qualityLabel}. `;
  analystSummary += `Fundamental alignment: ${alignmentLabel}. `;
  analystSummary += `Actionability: ${actionability}. `;
  if (actionability === "WAIT") {
    analystSummary += `Reason: ${actionabilityReason}`;
  }

  return {
    marketState,
    marketRegime: regime,
    fundamentalThesis: fundamental,
    currentDirection: dir,
    continuationScenario,
    reversalScenario,
    primaryScenario,
    alternateScenario,
    confirmationConditions,
    invalidationConditions,
    missingInformation,
    actionability,
    actionabilityReason,
    analystSummary,
  };
}
