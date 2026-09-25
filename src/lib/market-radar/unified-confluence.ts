/**
 * Phase 277 — Unified Intelligence × Opportunity Radar.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Phase 276 built the unified technical+fundamental layer, but the opportunity
 * scanner never saw it: the radar scored a candidate from its own snapshot
 * fields and a separate, older `fundamentals` block. Confluence — whether the
 * two evidence classes agree or contradict each other — had no effect on
 * whether an instrument was presented as an opportunity.
 *
 * This module is the ONE place where a unified assessment becomes opportunity
 * policy. It is a PURE function of the unified object the engine produced: it
 * computes no indicator, no ratio, no confidence of its own, and it never
 * consults a clock.
 *
 * WHAT IT CONTRIBUTES (deterministic, traceable)
 * ----------------------------------------------
 * The score delta is a fixed, disclosed table keyed on the unified STATE —
 * never on an instrument, never on an ad-hoc weight tuned to make a card look
 * better:
 *
 *   aligned_bullish / aligned_bearish  +8   both classes present, directional
 *                                           and AGREEING
 *   technical_only                      0   the technical evidence is ALREADY
 *                                           scored by the existing technical
 *                                           components; adding points here
 *                                           would double-count one class
 *   fundamental_only                    0   no technical evidence — cannot be
 *                                           promoted into a directional call
 *   mixed                              -4   a present class is non-directional
 *   conflicting                       -12   the classes contradict each other
 *   insufficient                      -20   neither class produced evidence
 *
 * CONFIDENCE
 * ----------
 * Confluence can only ever CAP the opportunity's confidence, never raise it —
 * two evidence classes never double confidence, because the unified confidence
 * is already the weaker of the two. Caps are disclosed per state.
 *
 * ACTIONABILITY
 * -------------
 * A "clean" actionable opportunity (ACTIVE lifecycle / high quality tier) is
 * withheld whenever the unified layer did not justify a combined directional
 * conclusion: conflict, mixed, insufficient, fundamental-only, or a directional
 * pair whose invalidation is missing. `technical_only` is deliberately NOT
 * blocked — the mission requires the existing technical opportunity path to
 * keep working for crypto and every instrument without fundamental coverage,
 * with the absence stated rather than fabricated as neutrality.
 *
 * NO SUBSTITUTION
 * ---------------
 * Nothing here fetches, defaults or invents: an absent unified object leaves
 * the scanner exactly as it was, a missing fundamental is reported as missing,
 * and provenance (both providers, both native ids, both instants, the fiscal
 * reporting period) travels through untouched.
 */

import type { UnifiedIntelligence, UnifiedState } from "@/lib/unified-intelligence";

// ── Policy table ────────────────────────────────────────────────

export interface UnifiedConfluencePolicy {
  /** Ranking-score delta for this state. */
  scoreDelta: number;
  /** Upper bound applied to opportunity confidence (never a raise). */
  confidenceCap?: number;
  /** Both classes present, directional and agreeing. */
  combinedDirectional: boolean;
}

export const UNIFIED_CONFLUENCE_POLICY: Record<UnifiedState, UnifiedConfluencePolicy> = {
  aligned_bullish: { scoreDelta: 8, combinedDirectional: true },
  aligned_bearish: { scoreDelta: 8, combinedDirectional: true },
  technical_only: { scoreDelta: 0, combinedDirectional: false },
  fundamental_only: { scoreDelta: 0, confidenceCap: 50, combinedDirectional: false },
  mixed: { scoreDelta: -4, confidenceCap: 50, combinedDirectional: false },
  conflicting: { scoreDelta: -12, confidenceCap: 35, combinedDirectional: false },
  insufficient: { scoreDelta: -20, confidenceCap: 20, combinedDirectional: false },
};

export interface UnifiedConfluenceProvenance {
  technicalProvider?: string;
  technicalInstrumentId?: string;
  technicalObservedAt?: number;
  fundamentalProvider?: string;
  fundamentalInstrumentId?: string;
  fundamentalObservedAt?: number;
  /** Fiscal period the fundamental evidence describes — never a market time. */
  reportingPeriod?: string;
}

export interface UnifiedConfluenceEvaluation {
  /** A unified assessment was actually supplied to the scanner. */
  present: boolean;
  state: UnifiedState;
  policy: UnifiedConfluencePolicy;
  supporting: string[];
  conflicting: string[];
  missing: string[];
  /**
   * A documented ABSENCE that is not a critical gap: it must be visible in the
   * opportunity's missing-information list but must not, by itself, lower the
   * evidence confidence — an instrument without fundamental coverage keeps the
   * exact opportunity quality it had before the unified layer existed.
   */
  informationalMissing: string[];
  /** The unified layer's own actionability verdict (verbatim). */
  actionable: boolean;
  /** Why it is or is not actionable (verbatim from the unified layer). */
  actionabilityReason: string;
  /**
   * True when a combined directional conclusion is NOT justified, so the
   * opportunity must not be presented as a clean actionable call.
   * `technical_only` is never blocked — the technical path stays usable.
   */
  blocksCleanActionability: boolean;
  /** Invitation to display the technical invalidation the engine supplied. */
  invalidation?: string;
  provenance: UnifiedConfluenceProvenance;
  /** One deterministic sentence for the opportunity result. */
  explanation: string;
}

/**
 * Evaluate the unified assessment for opportunity policy.
 * Absent evidence yields a no-op evaluation: the scanner behaves exactly as it
 * did before, and nothing is assumed about the missing class.
 */
export function evaluateUnifiedConfluence(
  unified: UnifiedIntelligence | undefined,
): UnifiedConfluenceEvaluation {
  if (!unified) {
    return {
      present: false,
      state: "insufficient",
      policy: { scoreDelta: 0, combinedDirectional: false },
      supporting: [],
      conflicting: [],
      missing: [],
      informationalMissing: [],
      actionable: false,
      actionabilityReason: "",
      blocksCleanActionability: false,
      provenance: {},
      explanation: "",
    };
  }

  const policy = UNIFIED_CONFLUENCE_POLICY[unified.state];
  const supporting: string[] = [];
  const conflicting: string[] = [];
  const missing: string[] = [];
  const informationalMissing: string[] = [];
  const fundamentalPresent = unified.fundamental.present === true;

  // The unified layer's own sentence explains the relationship between the two
  // evidence classes; it is quoted, never paraphrased into a score.
  const base = `${unified.state}: ${unified.confluence.reason}`;

  switch (unified.state) {
    case "aligned_bullish":
    case "aligned_bearish":
      supporting.push(base);
      break;
    case "conflicting":
      conflicting.push(base);
      break;
    case "mixed":
      conflicting.push(base);
      break;
    case "technical_only":
      // Absence is STATED, never converted into neutral evidence and never
      // penalised: the technical opportunity path remains fully usable.
      missing.push(base);
      informationalMissing.push(base);
      break;
    case "fundamental_only":
      // Not a conflict — an ABSENCE. It is a critical gap (no technical
      // evidence exists to act on), so it is reported as missing and the
      // opportunity cannot be presented as a clean directional call.
      missing.push(base);
      missing.push(
        "technical evidence unavailable — no directional opportunity can be derived from fundamentals alone",
      );
      break;
    case "insufficient":
      missing.push(base);
      break;
  }

  // Confidence cap disclosure is added by the caller as a limitation; here the
  // policy is returned so the radar and UI can both state it.
  const blocksCleanActionability =
    unified.state !== "technical_only" && !unified.actionable;

  const provenance: UnifiedConfluenceProvenance = {
    ...(unified.technical.provider ? { technicalProvider: unified.technical.provider } : {}),
    ...(unified.technical.instrumentId
      ? { technicalInstrumentId: unified.technical.instrumentId }
      : {}),
    ...(unified.technical.observedAt !== undefined
      ? { technicalObservedAt: unified.technical.observedAt }
      : {}),
    // Fundamental provenance is copied ONLY when the provider actually returned
    // an assessment for this instrument. An "unavailable" placeholder is
    // absence, not provenance, and must never look like a source.
    ...(fundamentalPresent && unified.fundamental.provider
      ? { fundamentalProvider: unified.fundamental.provider }
      : {}),
    ...(fundamentalPresent && unified.fundamental.instrumentId
      ? { fundamentalInstrumentId: unified.fundamental.instrumentId }
      : {}),
    ...(fundamentalPresent && unified.fundamental.observedAt !== undefined
      ? { fundamentalObservedAt: unified.fundamental.observedAt }
      : {}),
    ...(fundamentalPresent && unified.fundamental.reportingPeriod
      ? { reportingPeriod: unified.fundamental.reportingPeriod }
      : {}),
  };

  const explanation = [
    `unified ${unified.state}`,
    `technical ${unified.technical.bias}`,
    `fundamentals ${unified.fundamental.state}`,
    policy.combinedDirectional
      ? "evidence classes aligned"
      : unified.state === "technical_only"
        ? "fundamental evidence unavailable — technical path only, no combined claim"
        : "no combined directional conclusion justified",
    policy.confidenceCap !== undefined
      ? `confidence capped at ${policy.confidenceCap}`
      : `confidence ${unified.confidence}`,
  ].join(" · ");

  return {
    present: true,
    state: unified.state,
    policy,
    supporting,
    conflicting,
    missing,
    informationalMissing,
    actionable: unified.actionable,
    actionabilityReason: unified.actionabilityReason,
    blocksCleanActionability,
    ...(unified.technical.invalidation ? { invalidation: unified.technical.invalidation } : {}),
    provenance,
    explanation,
  };
}
