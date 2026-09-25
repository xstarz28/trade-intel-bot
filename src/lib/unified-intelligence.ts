/**
 * Phase 276 — Unified technical + fundamental intelligence.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Phases 271–273 made technical evidence real and deterministic; Phases
 * 274–275 did the same for fundamental evidence. They were, however, two
 * *separate* answers. Nothing in the product stated whether they agreed,
 * disagreed, or whether a combined conclusion was even possible — and the
 * only place the two met was a scoring weight, which hides the relationship
 * instead of explaining it.
 *
 * This module adds ONE deterministic layer ABOVE both engines. It is a PURE
 * DERIVATION from the finished `AnalysisResult`:
 *
 *   · it computes no indicator, no ratio and no metric of its own;
 *   · it reads the technical engine's own outputs (factor scores, structure,
 *     computed indicators, volatility regime, candle count, decision levels)
 *     and the fundamental engine's own assessment (state, dimensions,
 *     confidence, reporting period);
 *   · it never rewrites them, never re-derives them, and never falls back to
 *     a default when one is missing.
 *
 * THE CORE RULE
 * -------------
 * A combined conclusion is produced ONLY when the evidence required for it is
 * actually present:
 *
 *   A. technical + usable fundamental  → aligned_* / conflicting / mixed
 *   B. technical only                  → technical_only, no combined claim
 *   C. fundamental only                → fundamental_only, no combined claim
 *   D. neither                         → insufficient, analysis unavailable
 *
 * A single evidence class is never converted into a combined one, and an
 * absent class is never treated as neutral evidence: absence is stated.
 *
 * CONFIDENCE
 * ----------
 * The unified confidence is the WEAKER of the two class confidences and can
 * only be reduced further (by conflict, or by a non-directional pairing). It
 * is never raised merely because two sources were consulted, conflicting
 * evidence caps it, and weak fundamental evidence cannot upgrade a strong
 * technical read into a combined decision.
 *
 * ACTIONABILITY
 * -------------
 * `actionable` is this layer's own statement — it never mutates the engine's
 * recommendation, conviction, gates or trade plan. It is true only when both
 * classes are present and directional, they agree, and the engine already
 * supplied a real invalidation. Everything else is informational.
 *
 * PROVENANCE
 * ----------
 * Both identities and both observation instants travel with the result. A
 * fundamental reporting period is never relabelled as a live market time, and
 * this module never consults a clock: identical evidence yields an identical
 * unified object.
 */

import type { AnalysisResult } from "@/types/analysis";
import type { FundamentalAssessment, FundamentalState } from "@/lib/fundamental-engine";

// ── Public types ────────────────────────────────────────────────

/**
 * Unified state. `mixed` is the case where both classes are present but at
 * least one is not directional (the mission's neutral/mixed pairing);
 * `insufficient` is the case where no combined read is possible at all.
 */
export type UnifiedState =
  | "aligned_bullish"
  | "aligned_bearish"
  | "conflicting"
  | "mixed"
  | "technical_only"
  | "fundamental_only"
  | "insufficient";

export type UnifiedConfidence = "high" | "medium" | "low" | "insufficient";

/** Direction read from one evidence class. */
export type EvidenceBias = "bullish" | "bearish" | "neutral" | "unavailable";

export interface UnifiedTechnicalEvidence {
  /** A usable technical read exists (real candles + engine outputs). */
  available: boolean;
  bias: EvidenceBias;
  /** Engine outputs that produced the bias — cited, never recomputed. */
  evidence: string;
  confidence: UnifiedConfidence;
  /** Provider of the technical evidence (as recorded on the result). */
  provider?: string;
  /** Exact provider/native identity the technical evidence belongs to. */
  instrumentId?: string;
  /** Observation instant recorded by the technical acquisition. */
  observedAt?: number;
  dataPoints?: number;
  /** Verbatim from the existing engine decision — never fabricated here. */
  invalidation?: string;
}

export interface UnifiedFundamentalEvidence {
  /** Usable for a combined conclusion (available AND has usable dimensions). */
  available: boolean;
  /** The provider returned an assessment, even if it is not usable. */
  present: boolean;
  state: FundamentalState | "unavailable";
  /** Fundamental engine's own derived evidence, cited. */
  evidence: string;
  confidence: UnifiedConfidence;
  provider?: string;
  instrumentId?: string;
  /** Fiscal reporting period the evidence describes. */
  reportingPeriod?: string;
  /** Provider observation instant of the fundamentals (NOT a market time). */
  observedAt?: number;
}

export interface UnifiedIntelligence {
  /** Any usable evidence exists at all. */
  available: boolean;
  /** Runtime-independent: identical evidence → identical object. */
  state: UnifiedState;
  technical: UnifiedTechnicalEvidence;
  fundamental: UnifiedFundamentalEvidence;
  confluence: {
    agreement: "aligned" | "conflicting" | "not-assessable";
    reason: string;
  };
  confidence: UnifiedConfidence;
  /** Why the confidence is what it is — including any downgrade. */
  confidenceEvidence: string;
  actionable: boolean;
  actionabilityReason: string;
  /** Present ONLY for an actionable combined conclusion. */
  directionalConclusion?: "long" | "short";
  /** Explicit missing-evidence / provenance limitations. */
  limitations: string[];
  /** Multi-sentence explanation that keeps both evidence sets separate. */
  explanation: string;
}

// ── Level helpers (pure) ────────────────────────────────────────

const LEVELS = ["low", "medium", "high"] as const;

type Level = 0 | 1 | 2;

function toLevel(confidence: UnifiedConfidence): Level {
  if (confidence === "insufficient") return 0;
  return LEVELS.indexOf(confidence) as Level;
}

function fromLevel(level: Level): UnifiedConfidence {
  return LEVELS[Math.max(0, Math.min(2, level))];
}

function capLevel(level: Level, cap: Level): Level {
  return Math.min(level, cap) as Level;
}

/**
 * A provider instant is usable only when it is a real positive finite number.
 * Malformed payloads (NaN/Infinity/string/null) must never reach date
 * formatting — `new Date(NaN).toISOString()` throws — and must never be
 * reported as an observation that did not happen.
 */
function safeInstant(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A decision level string counts as supplied only when it says something. */
function isUsableLevel(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0) return false;
  return !/unavailable|n\/a|unknown|^[-—]+$/i.test(v);
}

// ── Technical evidence ──────────────────────────────────────────

function deriveTechnical(result: AnalysisResult): UnifiedTechnicalEvidence {
  const td = result.technicalData;
  const provider = result.dataSource ?? result.provider;
  const instrumentId = result.providerInstrumentId;
  const observedAt = safeInstant(result.priceSnapshot?.timestamp);
  const invalidation = isUsableLevel(result.keyLevels?.invalidation)
    ? result.keyLevels.invalidation
    : undefined;
  const dataPoints = td?.dataPoints;

  // Availability is judged from the ENGINE's own outputs: candles were read
  // AND at least one engine-computed read (indicator or structural state)
  // exists. A candle count alone is not a technical read.
  const structureKnown =
    !!td && typeof td.structure === "string" && td.structure.length > 0 && td.structure !== "unknown";
  const indicatorsPresent =
    !!td &&
    (td.rsi14 !== undefined ||
      (td.macdLine !== undefined && td.macdSignal !== undefined) ||
      td.atr14 !== undefined);
  const available = !!td && td.dataPoints > 0 && (indicatorsPresent || structureKnown);

  if (!available) {
    return {
      available: false,
      bias: "unavailable",
      evidence: "No technical evidence — no usable candles or engine-computed readings were available for this instrument.",
      confidence: "insufficient",
      provider,
      instrumentId,
      observedAt,
      dataPoints,
      invalidation,
    };
  }

  // Bias comes from the engine's OWN factor scores. No indicator is computed
  // here; the role of this module is to read what the engine concluded.
  const trendScore = result.breakdown.trend;
  let bias: EvidenceBias =
    trendScore > 0 ? "bullish" : trendScore < 0 ? "bearish" : "neutral";

  // Defensive coherence check against the engine's own structure read: if the
  // two disagree the layer reports NEUTRAL rather than picking a favourite.
  const structure = td!.structure;
  let coherenceNote = "";
  if (bias === "bullish" && structure === "LH/LL") {
    bias = "neutral";
    coherenceNote = " (trend factor reads bullish while structure reads LH/LL — reported neutral rather than resolved by preference)";
  } else if (bias === "bearish" && structure === "HH/HL") {
    bias = "neutral";
    coherenceNote = " (trend factor reads bearish while structure reads HH/HL — reported neutral rather than resolved by preference)";
  } else if (bias !== "neutral" && (structure === "range" || structure === "unknown")) {
    coherenceNote = ` (structure reads ${structure} — direction rests on the engine's trend factor, not on a structural break)`;
  }

  // Confidence is an evidence tally over the engine's own outputs, then capped
  // by the engine's own data-quality assessment. Nothing is invented here.
  let tally = 0;
  if (structureKnown) tally++;
  if (td!.rsi14 !== undefined) tally++;
  if (td!.macdLine !== undefined && td!.macdSignal !== undefined) tally++;
  if (td!.atr14 !== undefined) tally++;
  if (td!.volatilityState !== undefined && td!.volatilityState !== "insufficient") tally++;

  let level: Level = tally >= 4 ? 2 : tally >= 2 ? 1 : 0;
  const caps: string[] = [];

  const quality = result.dataQualityContext?.primaryData.status;
  if (quality === "INSUFFICIENT" || quality === "UNAVAILABLE" || quality === "INVALID" || quality === "STALE") {
    level = capLevel(level, 0);
    caps.push(`primary data quality ${quality}`);
  } else if (quality === "DEGRADED") {
    level = capLevel(level, 1);
    caps.push("primary data quality DEGRADED");
  }
  if (dataPoints !== undefined && dataPoints < 50) {
    level = capLevel(level, 1);
    caps.push(`only ${dataPoints} candles (engine flags indicator reliability under 50)`);
  }
  if (result.dataCompleteness === "limited") {
    level = capLevel(level, 0);
    caps.push("run completeness limited");
  } else if (result.dataCompleteness === "partial") {
    level = capLevel(level, 1);
    caps.push("run completeness partial");
  }

  const readings: string[] = [
    `structure ${typeof structure === "string" && structure.length > 0 ? structure : "unknown"}`,
  ];
  if (td!.rsi14 !== undefined) readings.push(`RSI(14) ${td!.rsi14.toFixed(1)}`);
  if (td!.macdHistogram !== undefined) {
    readings.push(`MACD histogram ${td!.macdHistogram >= 0 ? "+" : ""}${td!.macdHistogram.toFixed(2)}`);
  }
  if (td!.atr14 !== undefined) {
    const vol =
      td!.volatilityState !== undefined && td!.volatilityState !== "insufficient"
        ? ` (volatility ${td!.volatilityState}${td!.atrRatio !== undefined ? ` ${td!.atrRatio.toFixed(2)}×` : ""})`
        : "";
    readings.push(`ATR(14) ${td!.atr14.toFixed(2)}${vol}`);
  }
  if (td!.ema20 !== undefined && td!.ema50 !== undefined) {
    readings.push(`EMA20 ${td!.ema20 > td!.ema50 ? "above" : "below"} EMA50`);
  }
  if (dataPoints !== undefined) readings.push(`${dataPoints} candles`);

  const evidence =
    `${bias.toUpperCase()} — engine trend factor ${trendScore >= 0 ? "+" : ""}${trendScore}, ` +
    `momentum factor ${result.breakdown.indicator >= 0 ? "+" : ""}${result.breakdown.indicator}; ` +
    `${readings.join("; ")}${coherenceNote}.`;

  return {
    available: true,
    bias,
    evidence,
    confidence: fromLevel(level),
    provider,
    instrumentId,
    observedAt,
    dataPoints,
    invalidation,
  };
}

// ── Fundamental evidence ────────────────────────────────────────

function deriveFundamental(result: AnalysisResult): UnifiedFundamentalEvidence {
  const assessment: FundamentalAssessment | undefined = result.fundamentalAssessment;
  // Provider instants are narrowed before use; a malformed payload value never
  // becomes a reported observation and never reaches date formatting.
  const observedAt = safeInstant(assessment?.observedAt);

  if (!assessment || !assessment.available) {
    return {
      available: false,
      present: false,
      state: "unavailable",
      evidence:
        assessment?.limitations?.[0] ??
        "No fundamental evidence — the provider returned no verified fundamentals for this instrument.",
      confidence: "insufficient",
      provider: assessment?.provider,
      instrumentId: assessment?.instrumentId,
    };
  }

  // Dimensions the engine actually scored, cited verbatim. The engine's own
  // state is used as-is; this layer does not re-interpret it.
  const scored = assessment.dimensions.filter((d) => d.status !== "unavailable" && d.evidence);
  const evidence =
    `FUNDAMENTAL STATE ${assessment.state.toUpperCase()} (${assessment.confidence} confidence) — ` +
    (scored.length > 0
      ? scored.map((d) => d.evidence).join(" ")
      : "no dimension produced usable evidence.");

  // Usable for a combined conclusion only when the engine's own state is one
  // of the directional states. A present-but-insufficient assessment is NOT
  // silently treated as neutral evidence: it cannot produce a combined read.
  const usable = assessment.state === "improving" || assessment.state === "weakening";

  return {
    available: usable,
    present: true,
    state: assessment.state,
    evidence,
    confidence: assessment.confidence,
    provider: assessment.provider,
    instrumentId: assessment.instrumentId,
    reportingPeriod: assessment.reportingPeriod,
    observedAt,
  };
}

// ── Main entry ──────────────────────────────────────────────────

/**
 * Build the unified intelligence layer from a finished analysis result.
 * Pure and clock-free: the same result always yields the same object.
 */
export function buildUnifiedIntelligence(result: AnalysisResult): UnifiedIntelligence {
  const technical = deriveTechnical(result);
  const fundamental = deriveFundamental(result);

  const limitations: string[] = [];

  // ── Cases A–D ────────────────────────────────────────────────
  let state: UnifiedState;
  let agreement: UnifiedIntelligence["confluence"]["agreement"];
  let reason: string;

  if (technical.available && fundamental.available) {
    const tBull = technical.bias === "bullish";
    const tBear = technical.bias === "bearish";
    const fUp = fundamental.state === "improving";
    const fDown = fundamental.state === "weakening";

    if (tBull && fUp) {
      state = "aligned_bullish";
      agreement = "aligned";
      reason = "Technical bias is bullish and fundamentals are improving — the two evidence classes point the same way.";
    } else if (tBear && fDown) {
      state = "aligned_bearish";
      agreement = "aligned";
      reason = "Technical bias is bearish and fundamentals are weakening — the two evidence classes point the same way.";
    } else if (tBull && fDown) {
      state = "conflicting";
      agreement = "conflicting";
      reason = "Technical bias is bullish while fundamentals are weakening — the evidence classes contradict each other.";
    } else if (tBear && fUp) {
      state = "conflicting";
      agreement = "conflicting";
      reason = "Technical bias is bearish while fundamentals are improving — the evidence classes contradict each other.";
    } else {
      state = "mixed";
      agreement = "not-assessable";
      reason = `Technical bias is ${technical.bias} and fundamentals are ${fundamental.state} — one or both classes are non-directional, so no alignment can be claimed.`;
    }
  } else if (technical.available) {
    state = "technical_only";
    agreement = "not-assessable";
    reason = fundamental.present
      ? `Fundamental evidence was supplied but the fundamental engine did not reach a directional state (${fundamental.state}) — no combined conclusion is produced.`
      : "Fundamental evidence is UNAVAILABLE for this instrument — no combined conclusion is produced.";
    limitations.push(
      fundamental.present
        ? `Fundamental assessment present but non-directional (${fundamental.state}) — a combined conclusion is not possible and is not implied.`
        : "Fundamental evidence unavailable — the analysis is a technical-only read and makes no combined claim.",
    );
  } else if (fundamental.available || fundamental.present) {
    state = "fundamental_only";
    agreement = "not-assessable";
    reason = "Technical evidence is UNAVAILABLE for this instrument — no combined conclusion is produced.";
    limitations.push(
      "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
    );
  } else {
    state = "insufficient";
    agreement = "not-assessable";
    reason = "Neither technical nor fundamental evidence is available — no assessment can be produced.";
    limitations.push(
      "No usable technical evidence and no usable fundamental evidence — analysis unavailable.",
    );
  }

  // ── Confidence: weaker class, only ever reduced ──────────────
  const capNotes: string[] = [];
  let level: Level;
  if (technical.available && fundamental.available) {
    level = capLevel(toLevel(technical.confidence), toLevel(fundamental.confidence));
    capNotes.push(
      `unified confidence is the weaker of technical ${technical.confidence} and fundamental ${fundamental.confidence} — it is never raised merely because two sources exist`,
    );
    if (state === "conflicting") {
      level = capLevel((level - 1) as Level, 1);
      capNotes.push("the two classes conflict, which lowers confidence one level");
    } else if (state === "mixed") {
      level = capLevel(level, 1);
      capNotes.push("a non-directional evidence class caps confidence at medium");
    }
  } else if (technical.available) {
    level = toLevel(technical.confidence);
    capNotes.push("single-class evidence — confidence reflects the technical read alone");
  } else if (fundamental.available) {
    level = toLevel(fundamental.confidence);
    capNotes.push("single-class evidence — confidence reflects the fundamental read alone");
  } else {
    level = 0;
    capNotes.push("no usable evidence in either class");
  }

  const confidence: UnifiedConfidence =
    !technical.available && !fundamental.available ? "insufficient" : fromLevel(level);

  // ── Actionability ────────────────────────────────────────────
  let actionable = false;
  let actionabilityReason: string;
  let directionalConclusion: "long" | "short" | undefined;

  if (state === "insufficient") {
    actionabilityReason =
      "Not actionable: no technical and no fundamental evidence — there is nothing to act on.";
  } else if (state === "technical_only" || state === "fundamental_only") {
    actionabilityReason =
      "Not actionable as a combined decision: one evidence class is absent, so only that class's own analysis applies. No combined conclusion is produced.";
  } else if (state === "conflicting") {
    actionabilityReason =
      "Not actionable: the technical and fundamental evidence conflict, so neither can justify a directional conclusion.";
  } else if (state === "mixed") {
    actionabilityReason =
      "Not actionable: one or both evidence classes are non-directional, so alignment cannot be established.";
  } else if (technical.bias === "neutral") {
    actionabilityReason = "Not actionable: the technical read itself is neutral.";
  } else if (!technical.invalidation) {
    actionabilityReason =
      "Not actionable: the technical engine supplied no valid invalidation level, so the idea has no defined failure condition.";
  } else {
    actionable = true;
    directionalConclusion = state === "aligned_bullish" ? "long" : "short";
    actionabilityReason =
      `Actionable: technical and fundamental evidence align (${state}), and the technical engine supplied an invalidation at ${technical.invalidation}. ` +
      "Actionability here is informational and does not alter the engine's own recommendation or gates.";
  }

  // ── Provenance additions ─────────────────────────────────────
  if (technical.available) {
    // Provenance is stated structurally: the instant itself travels in
    // `technical.observedAt` (a machine-readable field, exactly as observed),
    // never as a formatted string that would re-date the evidence.
    limitations.push(
      `Technical evidence: ${technical.provider ?? "provider not recorded"}${technical.instrumentId ? ` · ${technical.instrumentId}` : ""}` +
        (technical.dataPoints !== undefined ? `, ${technical.dataPoints} candles` : "") +
        (technical.observedAt !== undefined
          ? "; provider observation instant preserved on technical.observedAt."
          : "; no provider observation instant was recorded."),
    );
  }
  if (fundamental.present) {
    limitations.push(
      `Fundamental evidence: ${fundamental.provider ?? "provider not recorded"}${fundamental.instrumentId ? ` · ${fundamental.instrumentId}` : ""}` +
        (fundamental.reportingPeriod ? `, fiscal period ending ${fundamental.reportingPeriod}` : ", reporting period not supplied") +
        " — reported statements, never live market data.",
    );
  }
  for (const note of capNotes) limitations.push(`Confidence: ${note}.`);

  // ── Explanation: both classes kept separate ─────────────────
  const explanation = [
    technical.available
      ? `Technical: ${technical.evidence}`
      : "Technical: no technical evidence was available for this instrument.",
    fundamental.present
      ? `Fundamental: ${fundamental.evidence}`
      : "Fundamental: no fundamental evidence was available for this instrument.",
    `Agreement: ${reason}`,
    `Confidence: ${confidence.toUpperCase()} — ${capNotes.join("; ")}.`,
    actionable && directionalConclusion
      ? `Invalidation: ${technical.invalidation} (technical). Fundamental reporting period ${fundamental.reportingPeriod ?? "not supplied"} is context only and does not define a price invalidation.`
      : technical.invalidation
        ? `Invalidation (technical, preserved): ${technical.invalidation}${fundamental.reportingPeriod ? `; fundamental reporting period ${fundamental.reportingPeriod} is context only and supplies no price invalidation` : ""}.`
        : "Invalidation: no technical invalidation was supplied, so no failure condition is defined.",
  ].join(" ");

  return {
    available: technical.available || fundamental.present,
    state,
    technical,
    fundamental,
    confluence: { agreement, reason },
    confidence,
    confidenceEvidence: capNotes.join("; ") + ".",
    actionable,
    actionabilityReason,
    ...(actionable && directionalConclusion ? { directionalConclusion } : {}),
    limitations,
    explanation,
  };
}
