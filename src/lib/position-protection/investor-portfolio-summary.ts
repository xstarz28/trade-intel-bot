/**
 * Phase 143 — Investor Portfolio-Level Aggregation (pure, deterministic)
 *
 * PRESENTATION/AGGREGATION layer ONLY. It NEVER:
 * - invokes an analyzer, engine, provider or fetch
 * - recalculates thesis health, protection severity, evidence, macro context
 *   or any market metric
 * - fabricates portfolio returns, probabilities, alpha, Sharpe, expected
 *   return, risk/reward or numerical conviction scores
 * - executes trades or mutates portfolio state
 *
 * It consumes the ALREADY-CREATED per-position synthesis objects
 * (Phase 141 — buildInvestorDecisionSynthesis) and reduces them to ONE
 * categorical portfolio state + structural counts.
 *
 * Counts are allowed because they are direct aggregation of existing
 * positions. Counts are NEVER converted into percentages: no authoritative
 * portfolio metric exists in this repository, so no percentage is produced.
 *
 * ─────────────────────────────────────────────────────────────────────
 * PORTFOLIO STATE DECISION TABLE (deterministic, categorical)
 *
 * Applied in order; the FIRST matching rule decides the portfolio state.
 *
 * P1  No monitored positions (empty synthesis list)
 *     → UNAVAILABLE (empty portfolio — nothing to aggregate).
 *
 * P2  Any per-position INVALIDATED thesis/protection
 *     → CONFLICT. Invalidation is portfolio-relevant: the per-position
 *     synthesis already maps INVALIDATED → CONFLICT (Phase 141 rule R2),
 *     and the repository's existing portfolio engine treats INVALIDATED
 *     as the most severe thesis state. Invalidated positions are also
 *     counted explicitly (invalidatedCount).
 *
 * P3  Any per-position CONFLICT state
 *     → CONFLICT, with the explicit conflict count. (P2 is a strict subset
 *     of P3 because R2 forces INVALIDATED → CONFLICT; both are documented
 *     so the intent stays explicit.)
 *
 * P4  Any per-position CAUTION state
 *     → CAUTION. A single position needing caution prevents the portfolio
 *     from being called aligned.
 *
 * P5  EVERY monitored position is ALIGNED (usable intelligence exists for
 *     all of them and none diverges) AND there is no calendar-derived
 *     global macro caution
 *     → ALIGNED. Requires full coverage: one UNAVAILABLE or
 *     INSUFFICIENT_DATA position breaks the "all aligned" claim, and a
 *     HIGH global macro risk downgrades the portfolio to CAUTION — the
 *     portfolio-level mirror of per-position rule R7 (Phase 141).
 *
 * P6  No position has usable intelligence (every position is
 *     INSUFFICIENT_DATA or UNAVAILABLE)
 *     → INSUFFICIENT_DATA. The portfolio picture exists but cannot be
 *     judged from the available evidence.
 *
 * P7  anything else (e.g. ALIGNED + UNAVAILABLE mix — partial coverage)
 *     → CAUTION (conservative default; never false certainty).
 * ─────────────────────────────────────────────────────────────────────
 */

import type { InvestorDecisionSynthesis } from "./investor-decision-synthesis";
import type { InvestorMacroContext } from "./investor-macro-context";

/** The categorical overall state for the whole monitored portfolio. */
export type PortfolioState =
  | "ALIGNED"
  | "CONFLICT"
  | "CAUTION"
  | "INSUFFICIENT_DATA"
  | "UNAVAILABLE";

/** Data-coverage of the monitored portfolio (usable intelligence share). */
export type PortfolioCoverage = "FULL" | "PARTIAL" | "EMPTY";

/** Deterministic reason codes — every flag traces to aggregated states. */
export type PortfolioFlag =
  | "EMPTY"
  | "HAS_CONFLICT"
  | "HAS_CAUTION"
  | "HAS_ALIGNED"
  | "HAS_INSUFFICIENT"
  | "HAS_UNAVAILABLE"
  | "COVERAGE_FULL"
  | "COVERAGE_PARTIAL"
  | "COVERAGE_EMPTY"
  | "GLOBAL_MACRO_CAUTION";

export interface ConcentrationEntry {
  /** Instrument symbol appearing in 2+ monitored positions. */
  instrument: string;
  /** Number of monitored positions on this instrument. */
  positionCount: number;
}

export interface InvestorPortfolioSummary {
  /** Total monitored positions (syntheses consumed). */
  totalMonitored: number;
  /** Counts per per-position decision state (direct aggregation). */
  stateCounts: {
    aligned: number;
    conflict: number;
    caution: number;
    insufficientData: number;
    unavailable: number;
  };
  /** Positions with usable intelligence (ALIGNED/CAUTION/CONFLICT). */
  usableIntelCount: number;
  /** Positions whose evidence is insufficient (INSUFFICIENT_DATA). */
  insufficientIntelCount: number;
  /** Positions with no intelligence to aggregate (UNAVAILABLE). */
  unavailableCount: number;
  /** Counts per existing protection severity (verbatim severities). */
  protectionCounts: {
    none: number;
    watch: number;
    caution: number;
    highRisk: number;
    invalidated: number;
  };
  /** Positions with INVALIDATED thesis or INVALIDATED protection. */
  invalidatedCount: number;
  /**
   * Portfolio-GLOBAL macro caution (calendar-derived macro risk HIGH).
   * Shared across all positions by construction; the fallback macro
   * argument covers the empty-portfolio edge case.
   */
  globalMacroCaution: boolean;
  /** Coverage of usable intelligence across the monitored portfolio. */
  coverage: PortfolioCoverage;
  /** Instrument concentration: only instruments with 2+ positions. */
  concentration: {
    entries: ConcentrationEntry[];
    distinctInstruments: number;
  };
  /** Categorical overall state of the monitored portfolio. */
  state: PortfolioState;
  /** Deterministic reason codes, each grounded in aggregated states. */
  flags: PortfolioFlag[];
}

function isUsable(state: InvestorDecisionSynthesis["state"]): boolean {
  return state === "ALIGNED" || state === "CAUTION" || state === "CONFLICT";
}

/**
 * Aggregates per-position decision syntheses into one deterministic
 * portfolio-level summary. Pure: identical inputs → identical output;
 * never mutates inputs; no side effects.
 *
 * @param syntheses per-position InvestorDecisionSynthesis objects already
 *                  produced by buildInvestorDecisionSynthesis (Phase 141).
 * @param macro     optional shared global macro context, used ONLY for the
 *                  empty-portfolio edge case where no synthesis exists to
 *                  carry the global macro-caution flag.
 */
export function buildInvestorPortfolioSummary(
  syntheses: readonly InvestorDecisionSynthesis[],
  macro: InvestorMacroContext | null = null,
): InvestorPortfolioSummary {
  const flags: PortfolioFlag[] = [];

  // ─── Structural counts (direct aggregation of existing states) ──
  const stateCounts = {
    aligned: 0,
    conflict: 0,
    caution: 0,
    insufficientData: 0,
    unavailable: 0,
  };
  const protectionCounts = {
    none: 0,
    watch: 0,
    caution: 0,
    highRisk: 0,
    invalidated: 0,
  };
  let invalidatedCount = 0;
  let globalMacroCaution = macro?.macroRisk === "high";

  const byInstrument = new Map<string, number>();

  for (const s of syntheses) {
    switch (s.state) {
      case "ALIGNED": stateCounts.aligned++; break;
      case "CONFLICT": stateCounts.conflict++; break;
      case "CAUTION": stateCounts.caution++; break;
      case "INSUFFICIENT_DATA": stateCounts.insufficientData++; break;
      default: stateCounts.unavailable++; break;
    }

    switch (s.protection.severity) {
      case "NONE": protectionCounts.none++; break;
      case "WATCH": protectionCounts.watch++; break;
      case "CAUTION": protectionCounts.caution++; break;
      case "HIGH_RISK": protectionCounts.highRisk++; break;
      case "INVALIDATED": protectionCounts.invalidated++; break;
      default: protectionCounts.none++; break;
    }

    if (
      s.thesis.health === "INVALIDATED" ||
      s.protection.severity === "INVALIDATED"
    ) {
      invalidatedCount++;
    }

    // Macro caution is portfolio-GLOBAL: any synthesis carrying it marks the
    // whole portfolio (they all share the same global macro context).
    if (s.macro.globalCaution) globalMacroCaution = true;

    byInstrument.set(s.instrument, (byInstrument.get(s.instrument) ?? 0) + 1);
  }

  const totalMonitored = syntheses.length;
  const usableIntelCount =
    stateCounts.aligned + stateCounts.conflict + stateCounts.caution;
  const insufficientIntelCount = stateCounts.insufficientData;
  const unavailableCount = stateCounts.unavailable;

  const coverage: PortfolioCoverage =
    totalMonitored === 0
      ? "EMPTY"
      : usableIntelCount === totalMonitored
        ? "FULL"
        : usableIntelCount === 0
          ? "EMPTY"
          : "PARTIAL";

  const concentrationEntries: ConcentrationEntry[] = [...byInstrument.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([instrument, count]) => ({ instrument, positionCount: count }));

  // ─── Flags (each grounded in an aggregated state) ──
  if (totalMonitored === 0) flags.push("EMPTY");
  if (stateCounts.conflict > 0) flags.push("HAS_CONFLICT");
  if (stateCounts.caution > 0) flags.push("HAS_CAUTION");
  if (stateCounts.aligned > 0) flags.push("HAS_ALIGNED");
  if (insufficientIntelCount > 0) flags.push("HAS_INSUFFICIENT");
  if (unavailableCount > 0) flags.push("HAS_UNAVAILABLE");
  switch (coverage) {
    case "FULL": flags.push("COVERAGE_FULL"); break;
    case "PARTIAL": flags.push("COVERAGE_PARTIAL"); break;
    default: flags.push("COVERAGE_EMPTY"); break;
  }
  if (globalMacroCaution) flags.push("GLOBAL_MACRO_CAUTION");

  // ─── Portfolio state precedence (P1–P7, first match wins) ──
  let state: PortfolioState;

  if (totalMonitored === 0) {
    // P1 — empty portfolio.
    state = "UNAVAILABLE";
  } else if (stateCounts.conflict > 0) {
    // P2/P3 — invalidation always synthesizes to CONFLICT (Phase 141 R2),
    // so any CONFLICT position (invalidated or healthy-vs-HIGH_RISK) puts
    // the portfolio in CONFLICT with an explicit count.
    state = "CONFLICT";
  } else if (stateCounts.caution > 0) {
    // P4 — any caution position keeps the portfolio cautious.
    state = "CAUTION";
  } else if (
    usableIntelCount === totalMonitored &&
    stateCounts.aligned === totalMonitored &&
    !globalMacroCaution
  ) {
    // P5 — every monitored position aligned AND full coverage AND no
    // global macro caution (per-position R7 mirror).
    state = "ALIGNED";
  } else if (usableIntelCount === 0) {
    // P6 — no usable intelligence anywhere (all INSUFFICIENT_DATA /
    // UNAVAILABLE). Macro context never manufactures portfolio conviction.
    state = "INSUFFICIENT_DATA";
  } else {
    // P7 — conservative default (e.g. partial coverage ALIGNED+UNAVAILABLE).
    state = "CAUTION";
  }

  return {
    totalMonitored,
    stateCounts,
    usableIntelCount,
    insufficientIntelCount,
    unavailableCount,
    protectionCounts,
    invalidatedCount,
    globalMacroCaution,
    coverage,
    concentration: {
      entries: concentrationEntries,
      distinctInstruments: byInstrument.size,
    },
    state,
    flags,
  };
}