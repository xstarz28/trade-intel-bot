/**
 * Phase 144 — Investor Portfolio Monitoring Summary (pure, deterministic)
 *
 * PRESENTATION/MONITORING layer ONLY. It NEVER:
 * - invokes an analyzer, engine, provider or fetch
 * - recalculates thesis health, protection severity, evidence, macro
 *   context or any market metric
 * - fabricates probabilities, scores, forecasts, price targets or expected
 *   returns
 * - recommends, schedules or executes any action
 * - touches the alert/notification pipeline (the Phase 92/93 rule engine
 *   keeps its own PORTFOLIO conditions and its own data flow)
 *
 * It consumes TWO already-derived inputs:
 *   1. InvestorPortfolioSummary  — Phase 143 aggregation (counts + state)
 *   2. InvestorDecisionSynthesis[] — Phase 141 per-position syntheses
 *                                    (source of positionIds/instruments)
 *
 * and answers one question: "given the CURRENTLY aggregated evidence, what
 * categorical watch state should the investor see, and which existing
 * conditions justify it?"
 *
 * It is a READ of existing states — it adds no new analysis and no new
 * numbers. Every reason code traces to a field that already exists in the
 * summary or the syntheses.
 *
 * ─────────────────────────────────────────────────────────────────────
 * MONITOR STATE DECISION TABLE (deterministic, categorical)
 *
 * Applied in order; the FIRST matching rule decides the monitor state.
 *
 * M1  No monitored positions (empty synthesis list)
 *     → IDLE (nothing monitored — not an error, not an alarm).
 *
 * M2  Any INVALIDATED thesis/protection (summary.invalidatedCount > 0)
 *     → SEVERE. Invalidation is the strongest per-position condition and
 *     must survive at the monitor level (mirror of Phase 141 R2).
 *
 * M3  Portfolio state CONFLICT, OR any per-position CONFLICT, OR any
 *     HIGH_RISK protection
 *     → ELEVATED. Conflict and high-risk protection are the portfolio-level
 *     attention triggers. HIGH_RISK protection is checked on its own count
 *     so it cannot be hidden by a CAUTION-only synthesis state (Phase 142
 *     principle: protection risk must never disappear because another
 *     pillar looks milder).
 *
 * M4  Portfolio state CAUTION, OR any per-position CAUTION, OR protection
 *     CAUTION count > 0, OR coverage PARTIAL, OR global macro caution,
 *     OR macro status not AVAILABLE (STALE/LIMITED/UNAVAILABLE)
 *     → WATCH. Any incomplete, stale or cautionary condition prevents the
 *     portfolio from being called stable.
 *
 * M5  Portfolio state ALIGNED AND coverage FULL AND macro AVAILABLE
 *     → STABLE. STABLE requires current global context — a stale or
 *     partial macro picture never yields STABLE (mirror of Phase 141 R8).
 *
 * M6  anything else (e.g. portfolio INSUFFICIENT_DATA, ALIGNED+EMPTY
 *     mixes that fell through M4)
 *     → WATCH (conservative default; never false certainty).
 * ─────────────────────────────────────────────────────────────────────
 */

import type { InvestorDecisionSynthesis } from "./investor-decision-synthesis";
import type {
  InvestorPortfolioSummary,
  PortfolioCoverage,
} from "./investor-portfolio-summary";

/** The categorical watch state for the monitored portfolio. */
export type MonitorState = "IDLE" | "STABLE" | "WATCH" | "ELEVATED" | "SEVERE";

/** Deterministic reason codes — every code traces to an aggregated field. */
export type MonitorReasonCode =
  | "NO_POSITIONS"
  | "INVALIDATED"
  | "PORTFOLIO_CONFLICT"
  | "HIGH_RISK_PROTECTION"
  | "CAUTION_POSITIONS"
  | "INSUFFICIENT_DATA"
  | "UNAVAILABLE_INTEL"
  | "PARTIAL_COVERAGE"
  | "GLOBAL_MACRO_CAUTION"
  | "MACRO_STALE"
  | "MACRO_LIMITED"
  | "MACRO_UNAVAILABLE"
  | "CONCENTRATION";

export interface MonitorReason {
  /** Stable code consumed by the i18n label switch (never raw enum text). */
  code: MonitorReasonCode;
  /**
   * Aggregated position count for position-scoped reasons (verbatim from
   * the summary), 0 for structural/global reasons. Never a percentage.
   */
  count: number;
  /** Position IDs contributing (position-scoped reasons only). */
  positionIds: string[];
  /** Instruments contributing (CONCENTRATION only). */
  instruments: string[];
}

export interface InvestorMonitorState {
  /** Categorical watch state (M1–M6, first match wins). */
  state: MonitorState;
  /** Deterministic, sorted reasons — each grounded in existing fields. */
  reasons: MonitorReason[];
  /**
   * Global macro availability carried from the shared macro context via the
   * syntheses (all syntheses share the same global context by construction;
   * the worst observed value is used so inconsistent inputs fail safely).
   */
  macroStatus: "AVAILABLE" | "LIMITED" | "STALE" | "UNAVAILABLE";
  /**
   * Deterministic change fingerprint: state + sorted "code:count" pairs.
   * Stable for identical inputs; changes when any aggregated condition
   * changes. For UI change-detection only — nothing is persisted here.
   */
  fingerprint: string;
}

const MACRO_RANK: Record<InvestorMonitorState["macroStatus"], number> = {
  AVAILABLE: 0,
  LIMITED: 1,
  STALE: 2,
  UNAVAILABLE: 3,
};

/**
 * Derives the global macro availability from the syntheses. Every synthesis
 * carries the SAME shared global macro context (Phase 140 boundary), so any
 * single value would do; the worst observed value is used so adversarial
 * inconsistent inputs cannot understate a degraded macro picture.
 */
function deriveMacroStatus(
  syntheses: readonly InvestorDecisionSynthesis[],
): InvestorMonitorState["macroStatus"] {
  if (syntheses.length === 0) return "UNAVAILABLE"; // nothing carries macro evidence
  let worst: InvestorMonitorState["macroStatus"] = "AVAILABLE";
  for (const s of syntheses) {
    const status = s.macro.status;
    if (MACRO_RANK[status] > MACRO_RANK[worst]) worst = status;
  }
  return worst;
}

function coverageReason(coverage: PortfolioCoverage): MonitorReasonCode | null {
  return coverage === "PARTIAL" ? "PARTIAL_COVERAGE" : null;
}

function macroReason(
  status: InvestorMonitorState["macroStatus"],
): MonitorReasonCode | null {
  switch (status) {
    case "STALE": return "MACRO_STALE";
    case "LIMITED": return "MACRO_LIMITED";
    case "UNAVAILABLE": return "MACRO_UNAVAILABLE";
    default: return null;
  }
}

/**
 * Builds the deterministic portfolio monitor state from the ALREADY-EXISTING
 * Phase 143 summary and Phase 141 syntheses. Pure: identical inputs →
 * identical output; never mutates inputs; no side effects.
 */
export function buildInvestorMonitorState(
  summary: InvestorPortfolioSummary,
  syntheses: readonly InvestorDecisionSynthesis[],
): InvestorMonitorState {
  const reasons: MonitorReason[] = [];
  const macroStatus = deriveMacroStatus(syntheses);

  // ─── Reason assembly (each grounded in an existing aggregated field) ──
  if (summary.totalMonitored === 0) {
    reasons.push({ code: "NO_POSITIONS", count: 0, positionIds: [], instruments: [] });
  } else {
    if (summary.invalidatedCount > 0) {
      reasons.push({
        code: "INVALIDATED",
        count: summary.invalidatedCount,
        positionIds: syntheses
          .filter(
            (s) =>
              s.thesis.health === "INVALIDATED" ||
              s.protection.severity === "INVALIDATED",
          )
          .map((s) => s.positionId),
        instruments: [],
      });
    }

    if (summary.stateCounts.conflict > 0) {
      reasons.push({
        code: "PORTFOLIO_CONFLICT",
        count: summary.stateCounts.conflict,
        positionIds: syntheses
          .filter((s) => s.state === "CONFLICT")
          .map((s) => s.positionId),
        instruments: [],
      });
    }

    if (summary.protectionCounts.highRisk > 0) {
      reasons.push({
        code: "HIGH_RISK_PROTECTION",
        count: summary.protectionCounts.highRisk,
        positionIds: syntheses
          .filter((s) => s.protection.severity === "HIGH_RISK")
          .map((s) => s.positionId),
        instruments: [],
      });
    }

    if (summary.stateCounts.caution > 0) {
      reasons.push({
        code: "CAUTION_POSITIONS",
        count: summary.stateCounts.caution,
        positionIds: [],
        instruments: [],
      });
    }

    if (summary.insufficientIntelCount > 0) {
      reasons.push({
        code: "INSUFFICIENT_DATA",
        count: summary.insufficientIntelCount,
        positionIds: [],
        instruments: [],
      });
    }

    if (summary.unavailableCount > 0) {
      reasons.push({
        code: "UNAVAILABLE_INTEL",
        count: summary.unavailableCount,
        positionIds: [],
        instruments: [],
      });
    }

    const covReason = coverageReason(summary.coverage);
    if (covReason) {
      reasons.push({ code: covReason, count: 0, positionIds: [], instruments: [] });
    }

    if (summary.globalMacroCaution) {
      reasons.push({
        code: "GLOBAL_MACRO_CAUTION",
        count: 0,
        positionIds: [],
        instruments: [],
      });
    }

    const macReason = macroReason(macroStatus);
    if (macReason) {
      reasons.push({ code: macReason, count: 0, positionIds: [], instruments: [] });
    }

    if (summary.concentration.entries.length > 0) {
      reasons.push({
        code: "CONCENTRATION",
        count: summary.concentration.entries.length,
        positionIds: [],
        instruments: summary.concentration.entries.map((e) => e.instrument),
      });
    }
  }

  // ─── Monitor state precedence (M1–M6, first match wins) ──
  let state: MonitorState;

  if (summary.totalMonitored === 0) {
    // M1
    state = "IDLE";
  } else if (summary.invalidatedCount > 0) {
    // M2 — invalidation is never hidden by any other condition.
    state = "SEVERE";
  } else if (
    summary.state === "CONFLICT" ||
    summary.stateCounts.conflict > 0 ||
    summary.protectionCounts.highRisk > 0
  ) {
    // M3
    state = "ELEVATED";
  } else if (
    summary.state === "CAUTION" ||
    summary.stateCounts.caution > 0 ||
    summary.protectionCounts.caution > 0 ||
    summary.coverage === "PARTIAL" ||
    summary.globalMacroCaution ||
    macroStatus !== "AVAILABLE"
  ) {
    // M4
    state = "WATCH";
  } else if (
    summary.state === "ALIGNED" &&
    summary.coverage === "FULL" &&
    macroStatus === "AVAILABLE"
  ) {
    // M5 — STABLE requires current global context.
    state = "STABLE";
  } else {
    // M6 — conservative default (e.g. portfolio INSUFFICIENT_DATA).
    state = "WATCH";
  }

  // ─── Deterministic fingerprint (change detection only) ──
  const fingerprint = [
    state,
    ...reasons.map((r) => `${r.code}:${r.count}`).sort(),
    macroStatus,
  ].join("|");

  return { state, reasons, macroStatus, fingerprint };
}