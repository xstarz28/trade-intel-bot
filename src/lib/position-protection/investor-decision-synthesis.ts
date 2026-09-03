/**
 * Phase 141 — Investor Decision Synthesis (pure, deterministic)
 *
 * PRESENTATION/DECISION-CONTEXT layer only. It NEVER:
 * - invokes an analyzer, engine, provider or fetch
 * - recalculates thesis health, protection severity, evidence, confidence,
 *   macro context or any market metric
 * - fabricates probabilities, scores, forecasts, price targets or expected
 *   returns
 *
 * It consumes two already-derived inputs per position:
 *   1. InvestorIntelRow  — position-specific thesis + protection state
 *                          (Phase 139; itself a positionId-keyed join)
 *   2. InvestorMacroContext — portfolio-GLOBAL macro context (Phase 140)
 *
 * and reduces them to ONE categorical state + deterministic flags.
 *
 * ─────────────────────────────────────────────────────────────────────
 * DECISION TABLE (deterministic, categorical — no numerical weighting)
 *
 * Applied in order; the FIRST matching rule decides the overall state.
 *
 * R1  No PositionIntelligence record for this positionId
 *     → UNAVAILABLE (nothing to synthesize; protection is still shown
 *       separately and never invented from macro).
 *
 * R2  Thesis INVALIDATED or protection severity INVALIDATED
 *     → CONFLICT (invalidation directly contradicts any surviving thesis).
 *
 * R3  Thesis INSUFFICIENT_DATA / UNKNOWN
 *     → INSUFFICIENT_DATA. Macro context NEVER manufactures conviction for
 *       an insufficient thesis (rule R3 outranks macro rules).
 *
 * R4  Protection HIGH_RISK
 *     → if thesis HEALTHY/STABLE and macro status is AVAILABLE or LIMITED:
 *       CONFLICT (healthy thesis vs high protection risk = explicit domain
 *       disagreement — never collapsed into "healthy").
 *     → otherwise: CAUTION (protection risk preserved; context incomplete,
 *       so the full conflict claim is not made).
 *
 * R5  Protection CAUTION or thesis DETERIORATING / SEVERELY_DETERIORATING
 *     → CAUTION.
 *
 * R6  Macro status STALE or UNAVAILABLE
 *     → CAUTION. Position picture may look fine, but the global context is
 *       not current — the overall picture is NOT called "fully confirmed".
 *
 * R7  Global macro risk derived by the calendar module is HIGH
 *     → CAUTION with GLOBAL_MACRO_CAUTION flag (macro context remains
 *       global context; it is never stored as position-specific).
 *
 * R8  Thesis HEALTHY/STABLE AND protection NONE/WATCH
 *     AND macro status AVAILABLE or LIMITED
 *     → ALIGNED.
 *
 * R9  anything else → CAUTION (conservative default; never false certainty).
 * ─────────────────────────────────────────────────────────────────────
 */

import type { InvestorIntelRow } from "./investor-intelligence-view";
import type { InvestorMacroContext } from "./investor-macro-context";

/** The categorical overall state for one position's evidence picture. */
export type DecisionState =
  | "ALIGNED"
  | "CONFLICT"
  | "CAUTION"
  | "INSUFFICIENT_DATA"
  | "UNAVAILABLE";

/** Macro availability for the synthesis (same tokens mapAvailability knows). */
export type MacroAvailability =
  | "AVAILABLE"
  | "LIMITED"
  | "STALE"
  | "UNAVAILABLE";

/** Deterministic reason codes — every flag traces to a real evidence state. */
export type SynthesisFlag =
  | "INTEL_UNAVAILABLE"
  | "THESIS_HEALTHY"
  | "THESIS_STABLE"
  | "THESIS_CAUTION"
  | "THESIS_DETERIORATING"
  | "THESIS_INVALIDATED"
  | "THESIS_INSUFFICIENT"
  | "THESIS_UNKNOWN"
  | "PROTECTION_NONE"
  | "PROTECTION_WATCH"
  | "PROTECTION_CAUTION"
  | "PROTECTION_HIGH_RISK"
  | "PROTECTION_INVALIDATED"
  | "MACRO_AVAILABLE"
  | "MACRO_LIMITED"
  | "MACRO_STALE"
  | "MACRO_UNAVAILABLE"
  | "GLOBAL_MACRO_CAUTION";

export interface InvestorDecisionSynthesis {
  /** Authoritative position identity — positionId only. */
  positionId: string;
  instrument: string;
  /** Categorical overall state for THIS position's evidence picture. */
  state: DecisionState;
  /** Thesis pillar (existing engine values echoed — never recomputed). */
  thesis: {
    health: string;
    score: number;
    /** Thesis read is insufficient/unavailable by the engine's own state. */
    limited: boolean;
  };
  /** Protection pillar (existing protection state — verbatim severity). */
  protection: {
    severity: string;
  };
  /** GLOBAL macro pillar — applies to the whole portfolio, not this position. */
  macro: {
    status: MacroAvailability;
    /** Calendar-derived global macro risk is HIGH. */
    globalCaution: boolean;
    liveQuoteCount: number;
    ratesAvailable: boolean;
    eventCount: number;
  };
  /** Data-quality pillar — existing semantics only. */
  dataQuality: {
    /** intel.dataQuality verbatim, or null when no intelligence record. */
    intelQuality: string | null;
  };
  /** Deterministic reason codes, each grounded in existing evidence. */
  flags: SynthesisFlag[];
}

// ─── Macro status rules (documented, deterministic) ───────────────────
//
// M1 no macro evidence at all                       → UNAVAILABLE
// M2 any LIVE quote or FRESH official Treasury rows → AVAILABLE
// M3 any STALE quote or STALE Treasury rows         → STALE
// M4 remaining partial evidence (events / DELAYED
//    Treasury rows / mixed non-live quotes)         → LIMITED
function classifyMacroStatus(macro: InvestorMacroContext): MacroAvailability {
  if (!macro.hasAnyData) return "UNAVAILABLE";

  const hasFreshTreasury =
    macro.rates.rows.length > 0 && macro.rates.freshness === "FRESH";
  const hasLive = macro.liveQuoteCount > 0;

  if (hasLive || hasFreshTreasury) return "AVAILABLE";

  const hasStaleQuote = macro.quotes.some((q) => q.status === "STALE");
  const hasStaleTreasury = macro.rates.rows.length > 0 && macro.rates.freshness === "STALE";

  if (hasStaleQuote || hasStaleTreasury) return "STALE";

  // Events alone, DELAYED official treasury rows, or mixed non-live quotes.
  return "LIMITED";
}

function thesisFlag(health: string): SynthesisFlag {
  switch (health) {
    case "HEALTHY": return "THESIS_HEALTHY";
    case "STABLE": return "THESIS_STABLE";
    case "CAUTION": return "THESIS_CAUTION";
    case "DETERIORATING":
    case "SEVERELY_DETERIORATING": return "THESIS_DETERIORATING";
    case "INVALIDATED": return "THESIS_INVALIDATED";
    case "INSUFFICIENT_DATA": return "THESIS_INSUFFICIENT";
    default: return "THESIS_UNKNOWN";
  }
}

function protectionFlag(severity: string): SynthesisFlag {
  switch (severity) {
    case "NONE": return "PROTECTION_NONE";
    case "WATCH": return "PROTECTION_WATCH";
    case "CAUTION": return "PROTECTION_CAUTION";
    case "HIGH_RISK": return "PROTECTION_HIGH_RISK";
    case "INVALIDATED": return "PROTECTION_INVALIDATED";
    default: return "PROTECTION_NONE";
  }
}

function macroFlag(status: MacroAvailability): SynthesisFlag {
  switch (status) {
    case "AVAILABLE": return "MACRO_AVAILABLE";
    case "LIMITED": return "MACRO_LIMITED";
    case "STALE": return "MACRO_STALE";
    default: return "MACRO_UNAVAILABLE";
  }
}

/**
 * Synthesizes one position's decision context from its OWN intelligence row
 * plus the shared GLOBAL macro context. Pure and deterministic.
 *
 * Position isolation: `row` already carries only this positionId's data
 * (Phase 139 join). The macro context is deliberately global — it is never
 * attached to a position as if it were generated for that position; the
 * output marks every macro field as macro.* (global) explicitly.
 */
export function buildInvestorDecisionSynthesis(
  row: InvestorIntelRow,
  macro: InvestorMacroContext,
): InvestorDecisionSynthesis {
  const flags: SynthesisFlag[] = [];

  // ─── Pillar decomposition (existing values echoed verbatim) ──
  const thesisHealth = row.thesisHealth;
  const severity = row.severity;
  const macroStatus = classifyMacroStatus(macro);
  const globalCaution = macro.macroRisk === "high";

  flags.push(thesisFlag(thesisHealth));
  flags.push(protectionFlag(severity));
  flags.push(macroFlag(macroStatus));
  if (globalCaution) flags.push("GLOBAL_MACRO_CAUTION");

  let state: DecisionState;

  if (!row.intel) {
    // R1 — nothing authoritative to synthesize for THIS position.
    flags.push("INTEL_UNAVAILABLE");
    state = "UNAVAILABLE";
  } else if (thesisHealth === "INVALIDATED" || severity === "INVALIDATED") {
    // R2
    state = "CONFLICT";
  } else if (thesisHealth === "INSUFFICIENT_DATA" || thesisHealth === "UNKNOWN") {
    // R3 — insufficient thesis dominates; macro never manufactures conviction.
    state = "INSUFFICIENT_DATA";
  } else if (severity === "HIGH_RISK") {
    // R4
    state =
      (thesisHealth === "HEALTHY" || thesisHealth === "STABLE") &&
      (macroStatus === "AVAILABLE" || macroStatus === "LIMITED")
        ? "CONFLICT"
        : "CAUTION";
  } else if (
    severity === "CAUTION" ||
    thesisHealth === "DETERIORATING" ||
    thesisHealth === "SEVERELY_DETERIORATING"
  ) {
    // R5
    state = "CAUTION";
  } else if (macroStatus === "STALE" || macroStatus === "UNAVAILABLE") {
    // R6 — not "fully confirmed" without current global context.
    state = "CAUTION";
  } else if (globalCaution) {
    // R7 — calendar-derived global macro caution.
    state = "CAUTION";
  } else if (
    (thesisHealth === "HEALTHY" || thesisHealth === "STABLE") &&
    (severity === "NONE" || severity === "WATCH") &&
    (macroStatus === "AVAILABLE" || macroStatus === "LIMITED")
  ) {
    // R8
    state = "ALIGNED";
  } else {
    // R9 — conservative default.
    state = "CAUTION";
  }

  const thesisLimited =
    thesisHealth === "INSUFFICIENT_DATA" ||
    thesisHealth === "UNKNOWN" ||
    !row.intel;

  return {
    positionId: row.positionId,
    instrument: row.instrument,
    state,
    thesis: {
      health: thesisHealth,
      score: row.thesisHealthScore,
      limited: thesisLimited,
    },
    protection: { severity },
    macro: {
      status: macroStatus,
      globalCaution,
      liveQuoteCount: macro.liveQuoteCount,
      ratesAvailable: macro.rates.rows.length > 0,
      eventCount: macro.events.length,
    },
    dataQuality: {
      intelQuality: row.intel?.dataQuality ?? null,
    },
    flags,
  };
}
