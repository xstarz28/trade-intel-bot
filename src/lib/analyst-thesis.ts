/**
 * Phase 26 — STRUCTURED ANALYST THESIS.
 *
 * Pure derivation from existing engine outputs. This is NOT a second decision
 * engine. Every field is assembled from already-computed result data:
 *   - decisionTrace
 *   - convictionBreakdown
 *   - keyContradictions
 *   - keyLevels
 *   - tradePlan
 *   - noTradeReasons
 *   - technicalData / mtfSummary
 *   - treasuryContext / cotContext / eiaContext
 *   - executionContext
 *   - dataQualityContext
 *
 * The thesis cannot modify recommendation, conviction, gates, trade plan,
 * or sizing. It is purely analyst-facing presentation metadata.
 */

import type { AnalysisResult } from "@/types/analysis";
import type { DecisionTrace, ConvictionLayerContribution } from "@/lib/decision-trace";

// ── Types ────────────────────────────────────────────────────────

export interface EvidenceItem {
  category: string;
  explanation: string;
  timeframe?: string;
  contribution?: number;
  quality?: "verified" | "degraded" | "insufficient" | "stale" | "unavailable";
}

export interface AnalystThesis {
  /** Primary decision summary line. */
  decisionSnapshot: string;
  /** One-line structural thesis. */
  structuralThesis: string;
  /** Evidence supporting the current recommendation. */
  supportingEvidence: EvidenceItem[];
  /** Evidence conflicting with the current recommendation. */
  conflictingEvidence: EvidenceItem[];
  /** What would confirm / strengthen this thesis. */
  confirmationCondition: string;
  /** What would invalidate this thesis (aligned with keyLevels.invalidation). */
  invalidationCondition: string;
  /** Critical information currently missing. */
  missingInformation: string[];
  /** NO_TRADE-specific: what would change the decision. */
  noTradePath?: string;
}

// ── Builder ──────────────────────────────────────────────────────

function qualityLabel(
  q: AnalysisResult["dataQualityContext"],
  category: string,
): EvidenceItem["quality"] | undefined {
  if (!q) return undefined;
  const lc = category.toLowerCase();
  if (lc === "treasury" || lc === "macro yield") {
    const s = q.providers.treasury?.status;
    if (s === "GOOD") return "verified";
    if (s === "STALE") return "stale";
    if (s === "UNAVAILABLE") return "unavailable";
  }
  if (lc === "cot" || lc === "cot positioning") {
    const s = q.providers.cot?.status;
    if (s === "GOOD") return "verified";
    if (s === "STALE") return "stale";
    if (s === "UNAVAILABLE") return "unavailable";
  }
  if (lc === "eia" || lc === "eia inventory") {
    const s = q.providers.eia?.status;
    if (s === "GOOD") return "verified";
    if (s === "STALE") return "stale";
    if (s === "UNAVAILABLE") return "unavailable";
  }
  if (lc === "execution") {
    const s = q.providers.execution?.status;
    if (s === "GOOD") return "verified";
    if (s === "STALE") return "stale";
    if (s === "UNAVAILABLE") return "unavailable";
  }
  if (lc.includes("mtf")) {
    const s = q.mtf.status;
    if (s === "GOOD") return "verified";
    if (s === "DEGRADED") return "degraded";
    if (s === "INSUFFICIENT") return "insufficient";
    if (s === "UNAVAILABLE") return "unavailable";
  }
  return undefined;
}

function layerQuality(
  trace: DecisionTrace,
  layerName: string,
): "verified" | "degraded" | "insufficient" | "stale" | "unavailable" | undefined {
  const entry = trace.evidenceLayers.find((l) => l.layer === layerName);
  if (!entry) return undefined;
  if (entry.contribution === 0 && entry.reason.includes("unavailable")) return "unavailable";
  if (entry.contribution === 0 && entry.reason.includes("stale")) return "stale";
  return undefined;
}

export function buildAnalystThesis(result: AnalysisResult): AnalystThesis {
  const trace = result.decisionTrace;
  const rec = result.recommendation;
  const bias = result.bias;
  const structDir = trace?.structuralDirection ?? "none";
  const vetoApplied = trace?.biasCalculation?.vetoApplied ?? false;
  const failedGates = trace?.failedGates ?? [];
  const layers = trace?.convictionBreakdown?.layers ?? [];
  const contradictions = result.keyContradictions ?? [];
  const noTradeReasons = result.noTradeReasons ?? [];
  const keyLevels = result.keyLevels;
  const mtf = result.mtfSummary;
  const dq = result.dataQualityContext;

  // ── Structural thesis ──
  let structuralThesis = "";
  if (structDir === "long") {
    structuralThesis = "Bullish external market structure (HH/HL) with structural agreement";
  } else if (structDir === "short") {
    structuralThesis = "Bearish external market structure (LH/LL) with structural agreement";
  } else if (vetoApplied) {
    structuralThesis = `Structural veto: core bias was ${bias.toLowerCase()} but external structure does not agree — vetoed to Neutral`;
  } else {
    structuralThesis = "No clear directional structure — structure is neutral or range-bound";
  }

  // ── Supporting evidence ──
  const supporting: EvidenceItem[] = [];
  const opposing: EvidenceItem[] = [];

  if (rec !== "NO_TRADE") {
    const biasSign = bias === "Bullish" ? 1 : bias === "Bearish" ? -1 : 0;

    for (const l of layers) {
      if (l.contribution === 0 || l.layer.startsWith("_")) continue;
      const item: EvidenceItem = {
        category: l.layer,
        explanation: l.reason,
        contribution: l.contribution,
        quality: qualityLabel(dq, l.layer) ?? layerQuality(trace!, l.layer),
      };
      if (mtf && (l.layer === "MTF" || l.layer.toLowerCase().includes("mtf"))) {
        item.timeframe = mtf.setupTimeframe;
      }
      if (l.contribution > 0 && Math.sign(l.contribution) === biasSign) {
        supporting.push(item);
      } else if (l.contribution < 0) {
        opposing.push(item);
      }
    }

    // Sort by absolute contribution (strongest first)
    supporting.sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0));
    opposing.sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0));
  }

  // ── Conflicting evidence from contradictions ──
  const conflicting: EvidenceItem[] = [];
  for (const c of contradictions) {
    if (c.severity === "MINOR") continue; // Only material+ conflicts
    conflicting.push({
      category: c.severity === "DECISIVE" ? "structural conflict" : "evidence conflict",
      explanation: c.description,
    });
  }
  // Merge opposing conviction layers as conflicting evidence
  for (const o of opposing.slice(0, 3)) {
    conflicting.push(o);
  }

  // ── Confirmation condition ──
  let confirmationCondition = "";
  if (rec === "LONG") {
    confirmationCondition = "Bullish BOS confirmation, fresh bullish FVG or displacement, or renewed MTF alignment would strengthen this thesis";
  } else if (rec === "SHORT") {
    confirmationCondition = "Bearish BOS confirmation, fresh bearish FVG or displacement, or renewed MTF alignment would strengthen this thesis";
  } else {
    confirmationCondition = "Wait for valid directional structure with at least 2 agreeing core factors, market-derived structural levels, and R:R ≥ 1.5";
  }

  // ── Invalidation condition ──
  let invalidationCondition = "";
  if (result.tradePlan) {
    const sl = result.tradePlan.stopLoss;
    const dir = result.tradePlan.direction;
    if (dir === "long") {
      invalidationCondition = `Bullish thesis invalid if price trades below structural stop at ${sl} — structure/HTF context changes against the position`;
    } else {
      invalidationCondition = `Bearish thesis invalid if price trades above structural stop at ${sl} — structure/HTF context changes against the position`;
    }
    if (keyLevels.invalidation) {
      invalidationCondition += `. Primary invalidation level: ${keyLevels.invalidation}`;
    }
  } else if (rec === "NO_TRADE") {
    invalidationCondition = "No active thesis — the setup does not meet the execution standard. Review when structural conditions change.";
  } else {
    invalidationCondition = "No trade plan available — thesis cannot be evaluated for invalidation";
  }

  // ── Missing information ──
  const missing: string[] = [];
  if (dq) {
    const primary = dq.primaryData.status;
    if (primary === "INSUFFICIENT") missing.push(`Primary market data: ${dq.primaryData.reason}`);
    if (primary === "STALE") missing.push("Primary market data is stale");
    if (primary === "UNAVAILABLE") missing.push("Primary market data is unavailable");
    if (dq.mtf.status === "UNAVAILABLE") missing.push("Higher-timeframe context unavailable");
    if (dq.mtf.status === "INSUFFICIENT") missing.push(`MTF: ${dq.mtf.reason}`);
    if (dq.providers.treasury?.status === "UNAVAILABLE" && (result.instrumentType === "forex" || result.instrumentType === "commodity")) {
      missing.push("Treasury yield context unavailable — macro-yield evidence missing");
    }
    if (dq.providers.cot?.status === "UNAVAILABLE" && (result.instrumentType === "forex" || result.instrumentType === "commodity")) {
      missing.push("CFTC positioning data unavailable — positioning evidence missing");
    }
    if (result.instrumentType === "crypto" && dq.providers.execution?.status === "UNAVAILABLE") {
      missing.push("OKX execution data unavailable — microstructure context missing");
    }
  }
  if (!trace) missing.push("Decision trace unavailable — explainability limited");

  // ── NO_TRADE path ──
  let noTradePath: string | undefined;
  if (rec === "NO_TRADE") {
    const primaryReason = noTradeReasons[0] ?? "Setup does not meet execution standard";
    const parts: string[] = [];
    if (structDir === "none" && !vetoApplied) {
      parts.push("Wait for valid directional structure (HH/HL or LH/LL)");
    } else if (vetoApplied) {
      parts.push("Wait for structural agreement — HTF reversal or genuine external BOS/CHoCH that authorizes the direction");
    } else {
      parts.push("Wait for stronger confluence across core factors");
    }
    if (failedGates.includes("GATE8_RR")) {
      parts.push("R:R must reach at least 1.5 from market-derived levels");
    }
    if (failedGates.includes("GATE6B_MTF_HIERARCHY") || failedGates.includes("GATE6_HTF_LTF")) {
      parts.push("HTF/LTF context must align or provide valid counter-trend confirmation");
    }
    noTradePath = parts.join(". ") + `. Current primary blocker: ${primaryReason}`;
  }

  // ── Decision snapshot ──
  const convLabel = result.conviction ?? (rec === "NO_TRADE" ? "informational" : "unknown");
  const rr = result.tradePlan?.riskReward;
  const qualityStatus = dq?.primaryData.status ?? "UNKNOWN";
  let snapshot = `${rec}`;
  if (structDir !== "none") snapshot += ` · Structure: ${structDir === "long" ? "Bullish" : "Bearish"}`;
  if (mtf) snapshot += ` · MTF: ${mtf.alignment}`;
  snapshot += ` · Conviction: ${result.confidence}% (${convLabel})`;
  if (rr) snapshot += ` · R:R ${rr.toFixed(2)}`;
  if (keyLevels.invalidation) snapshot += ` · Invalidation: ${keyLevels.invalidation}`;
  snapshot += ` · Quality: ${qualityStatus}`;

  return {
    decisionSnapshot: snapshot,
    structuralThesis,
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    confirmationCondition,
    invalidationCondition,
    missingInformation: missing,
    noTradePath,
  };
}
