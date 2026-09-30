/**
 * Phase 297 — EVIDENCE CONSUMPTION AUDIT, FACTOR DECOMPOSITION & ABLATION (§1–§9, §15).
 *
 * WHAT THIS MODULE IS
 * -------------------
 * A READ-ONLY audit layer. It answers one question with facts:
 *
 *   "Is the zero-actionable recorded result caused by insufficient evidence, or
 *    by valid evidence being attached but never consumed by the analytical layer
 *    it was designed for?"
 *
 * It therefore:
 *   · maps every evidence path (source → input field → scoring function → gate →
 *     conviction → output) as data, not prose (§1);
 *   · restates the EXISTING rule thresholds with their provenance, so a reader can
 *     see which are documented project rules and which are legacy values (§9);
 *   · diagnoses the recorded observations against those rules: observed value,
 *     threshold, margin, effect, fires-or-not (§3, §4, §5);
 *   · decomposes a real decision trace into the factor scores the engine already
 *     computed (exposed by `DecisionTrace.biasCalculation.factorScores`) (§6);
 *   · provides a pure ablation filter over an evidence attachment (§7).
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It does NOT score, rank, predict or re-implement the engine. Every rule table
 * entry is verified against the engine's own behaviour by the Phase 297 test
 * suite (`evidence-sensitivity.phase297.test.ts`): if a table entry ever stopped
 * matching what the engine does, that parity test fails. Nothing here changes a
 * threshold, a gate, a weight or a decision.
 */

import type { DecisionTrace } from "@/lib/decision-trace";
import { mapInstrumentToCot } from "@/lib/data/cot";
import { deriveCotEvidence } from "@/lib/data/cot";
import type { CotData } from "@/lib/data/cot";
import { deriveMacroYieldEvidence, MACRO_YIELD_SIGNAL_THRESHOLD_PTS, MACRO_YIELD_FULL_EFFECT_PTS } from "@/lib/data/treasury";
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import type { HistoricalEvidenceAttachment } from "@/lib/historical/evidence";

export const EVIDENCE_AUDIT_VERSION = "phase297.1";

/** Core weights the engine weights the three core factors with. */
export const CORE_WEIGHTS_AUDIT = { trend: 0.45, fundamental: 0.3, sentiment: 0.25 } as const;

/** |coreWeightedAvg| at or below this leaves the bias Neutral (Gate 3). */
export const GATE3_NEUTRAL_BAND = 0.25;

// ────────────────────────────────────────────────────────────────
// §1 evidence flow map
// ────────────────────────────────────────────────────────────────

export interface EvidenceFlowEntry {
  layer: string;
  source: string;
  inputField: string;
  scoring: string;
  gateDependency: string;
  convictionDependency: string;
  output: string;
}

/**
 * The complete path of every core evidence class. `scoring` names the function
 * that consumes the field; `gateDependency` names the gate whose verdict it can
 * change; `convictionDependency` names the conviction layer it reaches.
 */
export const EVIDENCE_FLOW_MAP: readonly EvidenceFlowEntry[] = [
  {
    layer: "structure",
    source: "recorded provider candles (OKX / Twelve Data)",
    inputField: "technicalData.smc + technicalData.structure/bosDirection",
    scoring: "scoreTrend() → breakdown.trend",
    gateDependency: "GATE3_DIRECTIONAL_BIAS (core weight 0.45), GATE4_CONFLUENCE (factor 1 of 3)",
    convictionDependency: "none directly (structure is the thesis authority via applyStructuralVeto)",
    output: "decisionTrace.biasCalculation.factorScores.trend",
  },
  {
    layer: "fundamentals (macro indicators)",
    source: "market intelligence macro block",
    inputField: "macroData.indicators[].sentiment",
    scoring: "scoreFundamentals() → breakdown.fundamental (ratio of explicit positive/negative sentiments)",
    gateDependency: "GATE3 (weight 0.30), GATE4 (factor 2 of 3)",
    convictionDependency: "conviction layer \"Fundamental\" (cap from style profile)",
    output: "factorScores.fundamental; evidenceLayers[Fundamental]",
  },
  {
    layer: "fundamentals (equity)",
    source: "point-in-time equity fundamentals provider",
    inputField: "fundamentalData (peRatio / profitMargin / earningsPerShare)",
    scoring: "scoreFundamentals() (stock branch, only when no macro indicators exist)",
    gateDependency: "GATE3, GATE4",
    convictionDependency: "conviction layer \"Fundamental\"",
    output: "factorScores.fundamental",
  },
  {
    layer: "fundamentals (economic calendar)",
    source: "economic calendar provider",
    inputField: "calendarData.events[].actual/forecast/importance=3/status=released",
    scoring: "scoreFundamentals() (released surprise classes: rate / employment / inflation)",
    gateDependency: "GATE3, GATE4",
    convictionDependency: "conviction layer \"Fundamental\"",
    output: "factorScores.fundamental",
  },
  {
    layer: "positioning (crypto derivatives)",
    source: "OKX funding / open interest / account ratio",
    inputField: "derivativesData.fundingRate | openInterest.change1h | longShort.accountRatio | liquidations.dominantSide",
    scoring: "scoreSentiment() crypto branch → breakdown.sentiment",
    gateDependency: "GATE3 (weight 0.25), GATE4 (factor 3 of 3)",
    convictionDependency: "none separate (one positioning source for crypto by design)",
    output: "factorScores.sentiment",
  },
  {
    layer: "positioning (news sentiment)",
    source: "news/sentiment provider",
    inputField: "sentimentData.averageScore/breakdown (used only when derivativesData is absent)",
    scoring: "scoreSentiment() news branch → breakdown.sentiment",
    gateDependency: "GATE3, GATE4",
    convictionDependency: "none separate",
    output: "factorScores.sentiment",
  },
  {
    layer: "sentiment confirmation (volume)",
    source: "recorded provider candles (volume column)",
    inputField: "technicalData.volumeTrend",
    scoring: "scoreSentiment() volume block — DOCUMENTED as a confirmation of an already-determined direction, never independent evidence",
    gateDependency: "GATE3, GATE4 (through breakdown.sentiment)",
    convictionDependency: "none",
    output: "factorScores.sentiment",
  },
  {
    layer: "macro yield (Treasury)",
    source: "US Treasury par-yield XML feed",
    inputField: "treasuryData (nominal ± real curve, two consecutive observations)",
    scoring: "deriveMacroYieldEvidence() → conviction layer \"Macro Yield\"",
    gateDependency: "NONE — not a Gate 3/4 factor",
    convictionDependency:
      "conviction layer \"Macro Yield\" (cap from style profile) + contradictions; the layer set is assembled only when recommendation !== NO_TRADE, and the layer is excluded for crypto/oil/indices by design",
    output: "decisionTrace.convictionBreakdown.layers[Macro Yield]; result.treasuryContext",
  },
  {
    layer: "positioning (CFTC COT)",
    source: "CFTC Commitments of Traders (weekly futures only)",
    inputField: "cotData (latest + previous report, change, open interest)",
    scoring: "deriveCotEvidence() → conviction layer \"COT Positioning\"",
    gateDependency: "NONE — not a Gate 3/4 factor; explicitly documented as never decisive",
    convictionDependency:
      "conviction layer \"COT Positioning\" + contradictions; assembled only when recommendation !== NO_TRADE, and only for instruments with a verified CFTC mapping (no crypto spot mapping by design)",
    output: "decisionTrace.convictionBreakdown.layers[COT Positioning]; result.cotContext",
  },
  {
    layer: "cross-asset",
    source: "provider comparator series",
    inputField: "technicalData.crossAsset",
    scoring: "measured correlation + momentum → conviction layer \"Cross Asset\"",
    gateDependency: "NONE — context layer",
    convictionDependency: "conviction layer \"Cross Asset\"; also suppresses the news-derived DXY proxy",
    output: "decisionTrace.evidenceLayers[Cross Asset]",
  },
  {
    layer: "execution quality",
    source: "crypto order-book/execution provider",
    inputField: "executionData",
    scoring: "conviction layer \"Execution\" (crypto-only)",
    gateDependency: "GATE6D_EXECUTION_VETO (veto only, never a positive factor)",
    convictionDependency: "conviction layer \"Execution\"",
    output: "decisionTrace.evidenceLayers[Execution]",
  },
  {
    layer: "liquidity / location (Phase 291)",
    source: "recorded provider candles",
    inputField: "technicalData.smc (displacement / FVG / OB / sweeps) + session liquidity",
    scoring: "Phase 291 location read → conviction layers \"Liquidity\", \"Location\"; setup state",
    gateDependency: "GATE7_STRUCTURAL_LEVELS; setup-state classification",
    convictionDependency: "conviction layers \"Liquidity\", \"Location\"",
    output: "decisionTrace.evidenceLayers[Liquidity|Location]; setupState",
  },
  {
    layer: "MTF hierarchy",
    source: "recorded provider candles across the timeframe ladder",
    inputField: "technicalData.mtf",
    scoring: "HTF/LTF agreement → GATE6 / GATE6B / GATE6C",
    gateDependency: "GATE6_HTF_LTF, GATE6B_MTF_HIERARCHY, GATE6C_STYLE_REQUIREMENTS",
    convictionDependency: "alignment context",
    output: "gates; result.mtfSummary",
  },
];

// ────────────────────────────────────────────────────────────────
// §9 threshold audit — value, location, scope, provenance
// ────────────────────────────────────────────────────────────────

export type ThresholdProvenance =
  | "documented project rule"
  | "documented rule, value not derived in-repo"
  | "legacy implementation value (no documented derivation found)";

export interface ThresholdEntry {
  id: string;
  value: string;
  location: string;
  assetClass: string;
  scope: string;
  provenance: ThresholdProvenance;
  note: string;
}

export const THRESHOLD_AUDIT: readonly ThresholdEntry[] = [
  {
    id: "CORE_WEIGHTS",
    value: "trend 0.45 / fundamental 0.30 / sentiment 0.25",
    location: "src/lib/analysis-engine.ts CORE_WEIGHTS",
    assetClass: "all",
    scope: "all timeframes and styles",
    provenance: "documented project rule",
    note: "Structure carries the largest core weight; the RSI/MACD indicator term is deliberately excluded from the core average.",
  },
  {
    id: "GATE3_NEUTRAL_BAND",
    value: "|coreWeightedAvg| ≤ 0.25 ⇒ Neutral",
    location: "src/lib/analysis-engine.ts calculateBias()",
    assetClass: "all",
    scope: "all timeframes and styles",
    provenance: "documented project rule",
    note: "A single factor scoring ±1 contributes 0.45 / 0.30 / 0.25 depending on its class, so one factor alone can clear the band only if it is structure.",
  },
  {
    id: "GATE4_CONFLUENCE",
    value: "≥ 2 of 3 core factors non-zero and agreeing with the signed bias",
    location: "src/lib/analysis-engine.ts decideTrade()",
    assetClass: "all",
    scope: "all timeframes and styles",
    provenance: "documented project rule",
    note: "Implemented literally in the engine and re-derived in this audit; Phase 297 parity tests assert the two agree on every recorded evaluation.",
  },
  {
    id: "funding_rate_extreme",
    value: "|rate| > 0.001 (0.1 % per settlement) ⇒ ±1",
    location: "src/lib/analysis-engine.ts scoreSentiment()",
    assetClass: "crypto",
    scope: "all crypto timeframes",
    provenance: "legacy implementation value (no documented derivation found)",
    note: "Typical perpetual funding is ±0.0001 per 8 h, so this band sits an order of magnitude above the neutral rate. It does not fire on any recorded observation and no in-repo document derives the value. NOT changed in Phase 297.",
  },
  {
    id: "funding_rate_structured",
    value: "rate > 0.0005 with structure HH/HL ⇒ +1 (and mirror for LH/LL)",
    location: "src/lib/analysis-engine.ts scoreSentiment()",
    assetClass: "crypto",
    scope: "all crypto timeframes",
    provenance: "legacy implementation value (no documented derivation found)",
    note: "Five times the neutral rate. The recorded series is capped at 0.0001, so this band cannot fire either. NOT changed in Phase 297.",
  },
  {
    id: "open_interest_change",
    value: "|change1h| > 2 % with matching structure ⇒ ±1",
    location: "src/lib/analysis-engine.ts scoreSentiment()",
    assetClass: "crypto",
    scope: "hourly open-interest change at every timeframe",
    provenance: "legacy implementation value (no documented derivation found)",
    note: "The largest recorded hourly change in the captured window is 1.94 % — inside the band by 0.06 percentage points. NOT changed in Phase 297.",
  },
  {
    id: "account_ratio_extremes",
    value: "accountRatio > 2.0 ⇒ −1 ; < 0.5 ⇒ +1",
    location: "src/lib/analysis-engine.ts scoreSentiment()",
    assetClass: "crypto",
    scope: "all crypto timeframes",
    provenance: "legacy implementation value (no documented derivation found)",
    note: "Recorded OKX account ratios span 1.20–1.45 (accounts are structurally long-biased), so the band is unreachable in this corpus. NOT changed in Phase 297.",
  },
  {
    id: "COT_SIGNAL_CHANGE_OI_RATIO",
    value: "0.005 (0.5 % of open interest)",
    location: "src/lib/data/cot.ts",
    assetClass: "mapped futures contracts (forex + metals + WTI)",
    scope: "weekly report-to-report change",
    provenance: "documented project rule",
    note: "Paired with COT_FULL_EFFECT_OI_RATIO = 0.05; the recorded EUR report-to-report change is 3.08 % of OI, so this rule DOES produce non-zero evidence.",
  },
  {
    id: "COT_CROWDING_OI_RATIO",
    value: "0.4 (40 % of open interest)",
    location: "src/lib/data/cot.ts",
    assetClass: "mapped futures contracts",
    scope: "latest report level vs open interest",
    provenance: "documented project rule",
    note: "Crowding is context/contradiction only, never a directional score. Recorded EUR net is 6.4 % of OI — not crowded.",
  },
  {
    id: "MACRO_YIELD_SIGNAL_THRESHOLD_PTS",
    value: "0.03 pp ; full effect at 0.15 pp",
    location: "src/lib/data/treasury.ts",
    assetClass: "forex (USD legs) and gold",
    scope: "change between two consecutive Treasury observations",
    provenance: "documented project rule",
    note: "Crypto, oil and indices are explicitly excluded from yield scoring by the engine (\"no honest, verified mapping\").",
  },
  {
    id: "MIN_RR_THRESHOLD",
    value: "style-profile minimum reward:risk (see resolveStyle)",
    location: "src/lib/analysis-engine.ts (min R:R gate, GATE8_RR)",
    assetClass: "all",
    scope: "per trading style",
    provenance: "documented project rule",
    note: "Unchanged in Phase 297; the recorded corpus fails GATE8 in 25 evaluations for other reasons (no publishable plan reaches it).",
  },
] as const;

// ────────────────────────────────────────────────────────────────
// §3 / §5 rule diagnostics
// ────────────────────────────────────────────────────────────────

export interface RuleDiagnostic {
  ruleId: string;
  factor: "sentiment" | "fundamental";
  condition: string;
  threshold: number;
  /** Signed effect the engine applies when the condition holds. */
  effect: number;
  /** Observed value evaluated against the condition (defined when applicable). */
  observed?: number;
  /** |observed − threshold| in the rule's own units; negative ⇒ condition holds. */
  margin?: number;
  fires: boolean;
  note: string;
}

function diag(
  ruleId: string,
  factor: RuleDiagnostic["factor"],
  condition: string,
  threshold: number,
  effect: number,
  observed: number | undefined,
  note: string,
  firesWhen?: (observed: number) => boolean,
): RuleDiagnostic {
  const predicate = firesWhen ?? ((v: number) => Math.abs(v) > threshold);
  const fires = observed !== undefined && predicate(observed);
  return {
    ruleId,
    factor,
    condition,
    threshold,
    effect,
    ...(observed !== undefined ? { observed } : {}),
    ...(observed !== undefined ? { margin: Math.abs(observed) - threshold } : {}),
    fires,
    note,
  };
}

/**
 * Diagnose the crypto positioning evidence against the EXISTING rules of
 * `scoreSentiment()`. `structure` is the same top-level structure string the
 * engine reads (`tech.structure`).
 */
export function diagnoseDerivatives(
  derivatives: CryptoDerivativesData | undefined,
  structure: string | undefined,
): RuleDiagnostic[] {
  const funding = derivatives?.fundingRate?.currentRate;
  const oiChange = derivatives?.openInterest?.change1h;
  const ratio = derivatives?.longShort?.accountRatio;
  const dominant = derivatives?.liquidations?.dominantSide;
  const bullishStructure = structure === "HH/HL";
  const bearishStructure = structure === "LH/LL";

  const rules: RuleDiagnostic[] = [
    diag(
      "funding_extreme_high",
      "sentiment",
      "fundingRate.currentRate > 0.001",
      0.001,
      -1,
      funding,
      "Crowded longs pay to hold — treated as a bearish positioning read.",
      (v) => v > 0.001,
    ),
    diag(
      "funding_extreme_low",
      "sentiment",
      "fundingRate.currentRate < -0.001",
      0.001,
      +1,
      funding,
      "Shorts pay longs — treated as a bullish positioning read.",
      (v) => v < -0.001,
    ),
    diag(
      "funding_structured_bull",
      "sentiment",
      "fundingRate.currentRate > 0.0005 AND structure === HH/HL",
      0.0005,
      +1,
      funding,
      bullishStructure ? "Structure is bullish; the structured funding rule is live." : "Structure is not HH/HL, so this rule cannot fire.",
      (v) => v > 0.0005 && bullishStructure,
    ),
    diag(
      "funding_structured_bear",
      "sentiment",
      "fundingRate.currentRate > 0.0005 AND structure === LH/LL",
      0.0005,
      -1,
      funding,
      bearishStructure ? "Structure is bearish; the structured funding rule is live." : "Structure is not LH/LL, so this rule cannot fire.",
      (v) => v > 0.0005 && bearishStructure,
    ),
    diag(
      "oi_change_up_bull",
      "sentiment",
      "openInterest.change1h > 2 AND structure === HH/HL",
      2,
      +1,
      oiChange,
      bullishStructure ? "OI expansion with bullish structure." : "Structure is not HH/HL.",
      (v) => v > 2 && bullishStructure,
    ),
    diag(
      "oi_change_up_bear",
      "sentiment",
      "openInterest.change1h > 2 AND structure === LH/LL",
      2,
      -1,
      oiChange,
      bearishStructure ? "OI expansion with bearish structure." : "Structure is not LH/LL.",
      (v) => v > 2 && bearishStructure,
    ),
    diag(
      "oi_change_down_bear",
      "sentiment",
      "openInterest.change1h < -2 AND structure === LH/LL",
      2,
      +1,
      oiChange,
      bearishStructure ? "Short covering inside a downtrend." : "Structure is not LH/LL.",
      (v) => v < -2 && bearishStructure,
    ),
    diag(
      "account_ratio_high",
      "sentiment",
      "longShort.accountRatio > 2.0",
      2.0,
      -1,
      ratio,
      "Account crowding above 2.0 longs per short.",
      (v) => v > 2.0,
    ),
    diag(
      "account_ratio_low",
      "sentiment",
      "longShort.accountRatio < 0.5",
      0.5,
      +1,
      ratio,
      "Account crowding below 0.5.",
      (v) => v < 0.5,
    ),
  ];

  if (dominant !== undefined) {
    rules.push({
      ruleId: "liquidations_dominant",
      factor: "sentiment",
      condition: "liquidations.dominantSide === longs | shorts",
      threshold: 0,
      effect: dominant === "longs" ? +1 : dominant === "shorts" ? -1 : 0,
      fires: dominant === "longs" || dominant === "shorts",
      note: "Liquidation dominance is not captured in the recorded evidence, so this rule is reported as not evaluable.",
    });
  } else {
    rules.push({
      ruleId: "liquidations_dominant",
      factor: "sentiment",
      condition: "liquidations.dominantSide === longs | shorts",
      threshold: 0,
      effect: 0,
      fires: false,
      note: "No liquidation dataset is recorded — the engine field stays undefined rather than being fabricated.",
    });
  }
  return rules;
}

/** Series-level dead-band reach: can the recorded values EVER cross a threshold? */
export interface SeriesThreshold {
  ruleId: string;
  threshold: number;
  /** Which side of the band the rule watches. */
  direction: "above" | "below";
}

export interface SeriesReach {
  metric: string;
  observations: number;
  min: number;
  max: number;
  maxAbs: number;
  thresholds: (SeriesThreshold & { reachable: boolean; extreme: number })[];
}

export function seriesReach(
  metric: string,
  values: readonly number[],
  thresholds: readonly SeriesThreshold[],
): SeriesReach {
  if (values.length === 0) throw new Error(`${metric}: no observations`);
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)));
  const max = Math.max(...values);
  const min = Math.min(...values);
  return {
    metric,
    observations: values.length,
    min,
    max,
    maxAbs,
    thresholds: thresholds.map((t) => {
      const extreme = t.direction === "above" ? max : min;
      const reachable = t.direction === "above" ? max > t.threshold : min < t.threshold;
      return { ...t, reachable, extreme };
    }),
  };
}

// ────────────────────────────────────────────────────────────────
// §2 FRED / ALFRED → treasury wiring audit
// ────────────────────────────────────────────────────────────────

export interface TreasuryWiringVerdict {
  wired: boolean;
  verdict: string;
  reasons: string[];
  /** What the layer WOULD report if a source-consistent capture existed. */
  wouldBeEffect?: {
    contextLabel: string;
    nominalMeanChangePts: number;
    usdStrengthEffect: number;
    goldLongEffect: number;
    notes: string[];
  };
}

/**
 * Decide, from the contracts alone, whether the recorded FRED/ALFRED series can
 * legitimately populate `TreasuryData`.
 *
 * The answer is NO, and the reason is provenance identity, not data quality:
 * `TreasuryContext.source` is a LITERAL type naming the treasury.gov XML feed.
 * Attaching FRED rows under that label would misreport the provider that was
 * actually read, and the engine surfaces that label to the UI
 * (`treasuryContext.provider: "US Treasury XML feed"`). A wiring fix may not be
 * bought with a false provenance claim.
 */
export function auditTreasuryWiring(params: {
  /** Latest/previous nominal 2Y and 10Y values from the recorded series, if any. */
  latest?: { tenors: Record<string, number>; observationDate: string };
  previous?: { tenors: Record<string, number>; observationDate: string };
}): TreasuryWiringVerdict {
  const reasons = [
    'TreasuryContext.source is the literal "US Treasury (home.treasury.gov XML feed)". The recorded FRED/ALFRED datasets carry their own provider identity (fred / alfred), so writing them into this contract would mislabel the source that produced the numbers.',
    "deriveMacroYieldEvidence() consumes the nominal 2Y/10Y pair and the SEPARATE real-yield curve; the recorded macro material is nominal-only, so the gold real-yield leg would stay absent (the engine already refuses to substitute nominal for real).",
    "Even when wired, the yield layer is a CONVICTION layer with a style-scaled cap and is explicitly excluded for crypto, oil and indices — it is not a Gate 3/4 factor and cannot change Gate 4 confluence.",
  ];

  let wouldBeEffect: TreasuryWiringVerdict["wouldBeEffect"];
  if (params.latest && params.previous) {
    const tenors = ["2Y", "10Y"];
    const changes = tenors
      .map((t) => {
        const a = params.latest!.tenors[t];
        const b = params.previous!.tenors[t];
        return a !== undefined && b !== undefined ? a - b : undefined;
      })
      .filter((v): v is number => v !== undefined);
    if (changes.length > 0) {
      const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
      // Same arithmetic the engine's deriveMacroYieldEvidence performs: the
      // change is clamped to ±1 after dividing by the full-effect constant.
      const usd = Math.max(-1, Math.min(1, mean / MACRO_YIELD_FULL_EFFECT_PTS));
      const contextLabel = `${params.previous.observationDate} → ${params.latest.observationDate}`;
      wouldBeEffect = {
        contextLabel,
        nominalMeanChangePts: mean,
        usdStrengthEffect: Math.abs(mean) >= MACRO_YIELD_SIGNAL_THRESHOLD_PTS ? usd : 0,
        goldLongEffect: 0,
        notes: [
          `Recorded nominal 2Y/10Y mean change ${mean.toFixed(3)} pp ${Math.abs(mean) >= MACRO_YIELD_SIGNAL_THRESHOLD_PTS ? "clears" : "stays below"} the ${MACRO_YIELD_SIGNAL_THRESHOLD_PTS} pp signal threshold.`,
          "Real-yield leg unavailable in the recorded material — gold context would stay absent.",
        ],
      };
    }
  }

  return {
    wired: false,
    verdict:
      "Recorded FRED/ALFRED observations are NOT wired into treasuryData. They stay attached as macroData context (no sentiment) with their own provider identity. The blocked path is provider identity, not evidence quality.",
    reasons,
    ...(wouldBeEffect ? { wouldBeEffect } : {}),
  };
}

// ────────────────────────────────────────────────────────────────
// §4 COT consumption audit (uses the engine's own deriveCotEvidence)
// ────────────────────────────────────────────────────────────────

export interface CotConsumptionReport {
  available: boolean;
  requestedInstrument?: string;
  sourceInstrument?: string;
  mappedAsset?: string;
  contractSide?: string;
  latestReportDate?: string;
  previousReportDate?: string;
  changeFromPreviousReport?: number;
  openInterest?: number;
  changeRatioOfOi?: number;
  crowded?: boolean;
  effectOnContractCurrency?: number;
  /** Effect expressed on the traded instrument's long side. */
  effectOnLong?: number;
  fires: boolean;
  notes: string[];
}

export function auditCotConsumption(cot: CotData | undefined): CotConsumptionReport {
  if (!cot || !cot.available) {
    return { available: false, fires: false, notes: ["No COT context attached for this decision."] };
  }
  const evidence = deriveCotEvidence(cot);
  const mapping = mapInstrumentToCot(cot.requestedInstrument);
  const side = mapping?.contractSide ?? "base";
  const effectOnLong = side === "quote" ? -evidence.effectOnContractCurrency : evidence.effectOnContractCurrency;
  const oi = cot.latest.openInterest;
  return {
    available: true,
    requestedInstrument: cot.requestedInstrument,
    sourceInstrument: cot.sourceInstrument,
    mappedAsset: cot.mappedAsset,
    contractSide: side,
    latestReportDate: cot.latest.reportDate,
    previousReportDate: cot.previous?.reportDate,
    changeFromPreviousReport: cot.changeFromPreviousReport,
    openInterest: oi,
    changeRatioOfOi:
      oi && oi > 0 && cot.changeFromPreviousReport !== undefined
        ? Math.abs(cot.changeFromPreviousReport) / oi
        : undefined,
    crowded: evidence.crowded,
    effectOnContractCurrency: evidence.effectOnContractCurrency,
    effectOnLong,
    fires: evidence.effectOnContractCurrency !== 0,
    notes: evidence.notes,
  };
}


// ────────────────────────────────────────────────────────────────
// §8 double-counting audit
// ────────────────────────────────────────────────────────────────

export type DoubleCountStatus =
  | "single_consumer"
  | "distinct_evidence_same_layer"
  | "duplicate_prevented_by_existing_rule"
  | "duplicate_identified";

export interface DoubleCountEntry {
  id: string;
  pair: [string, string];
  /** Where each side is consumed, with the code location that decides it. */
  consumerA: string;
  consumerB: string;
  status: DoubleCountStatus;
  finding: string;
  /** §8: change only when the existing source-of-truth contract identifies the duplicate. */
  action: "unchanged" | "documented_gap";
}

/**
 * The seven pairs §8 names, resolved against the engine as it actually is.
 * Nothing here changes scoring: five pairs are already separated by an existing
 * rule, one is a single consumer by construction, and one is a real overlap whose
 * fix is barred by the project's own provenance contract (recorded in the gap).
 */
export const DOUBLE_COUNT_AUDIT: readonly DoubleCountEntry[] = [
  {
    id: "fred_macro_vs_treasury",
    pair: ["FRED/ALFRED macro series (macroData)", "treasuryData (Treasury XML)"],
    consumerA: "scoreFundamentals() macro-indicator ratio; macroData carries no sentiment in the recorded corpus",
    consumerB: "macro-yield conviction layer (analysis-engine.ts deriveMacroYieldEvidence, layer cap ±2/±8/±12) and assessFundamentals()",
    status: "duplicate_prevented_by_existing_rule",
    finding:
      "Both would describe the same underlying fact (US Treasury yields). The recorded FRED/ALFRED rows are NOT written into treasuryData: TreasuryContext.source is the literal treasury.gov XML label, so re-labelling FRED rows would misreport the provider that was read (auditTreasuryWiring). The macroData leg additionally requires indicator sentiment, which the recorded FRED rows do not carry, so it contributes nothing while the yield layer is the only consumer of yields.",
    action: "unchanged",
  },
  {
    id: "funding_vs_derivatives_sentiment",
    pair: ["funding rate", "derivatives sentiment"],
    consumerA: "scoreSentiment() funding rules (thresholds 0.001 / 0.0005)",
    consumerB: "scoreSentiment() — the same factor; there is no second derivatives-sentiment consumer",
    status: "single_consumer",
    finding:
      "The positioning factor IS the derivatives sentiment path: derivativesData is read once by scoreSentiment(). No other layer scores funding.",
    action: "unchanged",
  },
  {
    id: "open_interest_vs_positioning",
    pair: ["open-interest change", "long/short positioning"],
    consumerA: "scoreSentiment() OI rule (|change| > 2% with structural agreement)",
    consumerB: "scoreSentiment() long/short account-ratio rules (> 2.0 / < 0.5)",
    status: "distinct_evidence_same_layer",
    finding:
      "Different measurements of the same market, deliberately scored by separate rules inside one factor. They are not the same evidence twice: each carries its own threshold and can fire alone. The factor is capped as a whole, so the layer cannot double its influence.",
    action: "unchanged",
  },
  {
    id: "cot_vs_general_sentiment",
    pair: ["COT positioning", "news/market sentiment (SentimentData)"],
    consumerA: "COT conviction layer (analysis-engine.ts @1820, cap ±1/±5/±12)",
    consumerB: "scoreSentiment() news path (SentimentData)",
    status: "single_consumer",
    finding:
      "scoreSentiment() never reads cotData, and the COT layer never reads SentimentData. Verified by construction in the recorded corpus: EUR/USD COT fires its rule while the positioning factor stays 0.",
    action: "unchanged",
  },
  {
    id: "macro_news_vs_calendar",
    pair: ["macro/news intelligence", "economic calendar surprises"],
    consumerA: "scoreFundamentals() macro-indicator ratio (sentiment tags) — or the stock branch, never both",
    consumerB: "scoreFundamentals() calendar leg (released, importance 3, surprise beyond the dead band)",
    status: "duplicate_prevented_by_existing_rule",
    finding:
      "The macro and stock branches are mutually exclusive (`if macro … else if fund && stock`), and the calendar leg reads `calendarData`, which the news path never touches. A news article can therefore never be scored twice as a released event.",
    action: "unchanged",
  },
  {
    id: "volume_vs_structure",
    pair: ["volume", "market structure"],
    consumerA: "scoreSentiment() — volume is a CONFIRMATION input only; it adds no score of its own",
    consumerB: "scoreTrend() — structure/BOS/CHoCH from price",
    status: "single_consumer",
    finding:
      "Volume cannot raise the positioning factor on its own, so a volume-confirmed structure is one score (from structure) plus a confirmation flag, never two votes.",
    action: "unchanged",
  },
  {
    id: "price_proxy_vs_cross_asset",
    pair: ["news-derived DXY proxy", "cross-asset DXY measurement"],
    consumerA: "scoreFundamentals() dxyTrend proxy (forex/commodity)",
    consumerB: "Cross Asset conviction layer (analysis-engine.ts @1765, measured comparator correlation + momentum)",
    status: "duplicate_prevented_by_existing_rule",
    finding:
      "The engine already suppresses the proxy whenever an actual DXY comparator price exists (`actualDxyAvailable`), so the same dollar strength can never score in both places.",
    action: "unchanged",
  },
] as const;

// ────────────────────────────────────────────────────────────────
// §15 trader-facing diagnostics (facts only, no audit vocabulary)
// ────────────────────────────────────────────────────────────────

export interface EvidenceDiagnosticsFacts {
  positioning?: { recorded: boolean; providers?: string[] };
  derivativesRules?: readonly RuleDiagnostic[];
  macro?: { recorded: boolean; observationCount: number; asOf?: string; directionallyScored: boolean };
  cot?: { recorded: boolean; reportDate?: string; fires?: boolean };
  treasury?: { wired: boolean };
  decomposition?: DecisionDecomposition;
  gateFailures?: readonly { gateId: string; occurrences: number }[];
  firstBlockers?: readonly { gateId: string; occurrences: number }[];
}

/** Which core factor a rule belongs to, in trader-facing words. */
const FACTOR_LABEL: Record<RuleDiagnostic["factor"], string> = {
  sentiment: "Positioning",
  fundamental: "Fundamental",
};

/**
 * Facts a trader can read. The strings say what was recorded, what the rule
 * observes and what the outcome is — never why an audit was run, never a score
 * the engine does not produce, never a claim that a value "would have" traded.
 */
export function formatEvidenceAuditDiagnostics(facts: EvidenceDiagnosticsFacts): string[] {
  const lines: string[] = [];

  if (facts.positioning) {
    const providers = facts.positioning.providers?.length ? ` (${facts.positioning.providers.join(", ")})` : "";
    lines.push(
      facts.positioning.recorded
        ? `Historical positioning: recorded${providers}`
        : "Historical positioning: unavailable for this date",
    );
  }

  for (const rule of facts.derivativesRules ?? []) {
    const label = FACTOR_LABEL[rule.factor];
    if (rule.fires) {
      lines.push(`${label} contribution: observed value outside the existing threshold (${rule.ruleId})`);
    } else if (rule.observed !== undefined) {
      lines.push(
        `${label} contribution: 0 — observed value inside existing threshold (${rule.observed.toFixed(6)} vs ${rule.threshold})`,
      );
    } else {
      lines.push(`${label} contribution: 0 — no observation for this date (${rule.ruleId})`);
    }
  }

  if (facts.macro) {
    if (!facts.macro.recorded) {
      lines.push("Macro evidence: unavailable for this date");
    } else if (facts.macro.directionallyScored) {
      lines.push(`Macro evidence: recorded (${facts.macro.observationCount} observations)`);
    } else {
      lines.push(
        `Macro evidence: recorded, context-only (${facts.macro.observationCount} observations${facts.macro.asOf ? ` as-of ${facts.macro.asOf}` : ""})`,
      );
    }
  }

  if (facts.cot) {
    lines.push(
      facts.cot.recorded
        ? `COT positioning: recorded (report ${facts.cot.reportDate ?? "unknown"})`
        : "COT positioning: unavailable for this date",
    );
  }

  if (facts.treasury) {
    lines.push(
      facts.treasury.wired
        ? "Treasury curve: connected to the yield layer"
        : "Treasury curve: recorded samples only — the yield layer stays disconnected",
    );
  }

  for (const gate of facts.gateFailures ?? []) {
    if (gate.occurrences > 0) lines.push(`${gate.gateId.replace(/_/g, " ")}: ${gate.occurrences} evaluations failed`);
  }

  if (facts.firstBlockers?.length) {
    const top = [...facts.firstBlockers].sort((a, b) => b.occurrences - a.occurrences)[0];
    lines.push(`First blocker: ${top.gateId}`);
  }

  const d = facts.decomposition;
  if (d) {
    lines.push(
      `Structure ${d.factorScores.trend} · fundamentals ${d.factorScores.fundamental} · positioning ${d.factorScores.sentiment} → bias ${d.finalBias}`,
    );
    lines.push(`Recommendation: ${d.recommendation}${d.firstBlockingGate ? ` (blocked by ${d.firstBlockingGate})` : ""}`);
  }

  return lines;
}

// ────────────────────────────────────────────────────────────────
// §6 decision decomposition (from the real trace)
// ────────────────────────────────────────────────────────────────

export interface DecisionDecomposition {
  structuralDirection: string;
  rawBias: string;
  finalBias: string;
  vetoApplied: boolean;
  vetoReason?: string;
  coreWeightedAvg: number;
  factorScores: { trend: number; fundamental: number; sentiment: number; indicator: number };
  factorContributions: { trend: number; fundamental: number; sentiment: number };
  /**
   * Gate 4 as the engine computes it: signed agreement of non-zero factors.
   * `evaluated` mirrors the engine's own guard — a Neutral bias never reaches the
   * confluence test (Gate 3 has already rejected it), so Gate 4 passes trivially
   * there. `satisfied` is therefore exactly the engine's pass condition.
   */
  gate4: { agreeing: string[]; opposing: string[]; evaluated: boolean; satisfied: boolean; rule: string };
  gate3: { status: string; reason?: string };
  gate4Status: { status: string; reason?: string };
  firstBlockingGate?: string;
  recommendation: string;
}

export function decomposeDecision(trace: DecisionTrace): DecisionDecomposition {
  const scores = trace.biasCalculation.factorScores ?? { trend: 0, fundamental: 0, sentiment: 0, indicator: 0 };
  const dirSign =
    trace.biasCalculation.finalBias === "Bullish" ? 1 : trace.biasCalculation.finalBias === "Bearish" ? -1 : 0;
  const factors = [
    { name: "structure", score: scores.trend },
    { name: "fundamental", score: scores.fundamental },
    { name: "positioning", score: scores.sentiment },
  ];
  const agreeing = factors.filter((f) => f.score !== 0 && Math.sign(f.score) === dirSign).map((f) => f.name);
  const opposing = factors.filter((f) => f.score !== 0 && Math.sign(f.score) === -dirSign).map((f) => f.name);
  const gateOf = (gateId: string) => trace.gates.find((g) => g.gateId === gateId);
  const firstFail = trace.gates.find((g) => g.status === "FAIL");

  return {
    structuralDirection: trace.structuralDirection,
    rawBias: trace.biasCalculation.rawBias,
    finalBias: trace.biasCalculation.finalBias,
    vetoApplied: trace.biasCalculation.vetoApplied,
    ...(trace.biasCalculation.vetoReason ? { vetoReason: trace.biasCalculation.vetoReason } : {}),
    coreWeightedAvg: trace.biasCalculation.coreWeightedAvg,
    factorScores: {
      trend: scores.trend,
      fundamental: scores.fundamental,
      sentiment: scores.sentiment,
      indicator: scores.indicator,
    },
    factorContributions: {
      trend: Math.round(scores.trend * CORE_WEIGHTS_AUDIT.trend * 100) / 100,
      fundamental: Math.round(scores.fundamental * CORE_WEIGHTS_AUDIT.fundamental * 100) / 100,
      sentiment: Math.round(scores.sentiment * CORE_WEIGHTS_AUDIT.sentiment * 100) / 100,
    },
    gate4: {
      agreeing,
      opposing,
      evaluated: dirSign !== 0,
      satisfied: !(dirSign !== 0 && agreeing.length < 2),
      rule: "with a directional bias: >= 2 of {structure, fundamental, positioning} non-zero AND agreeing with it; a Neutral bias passes trivially because Gate 3 already blocks it",
    },
    gate3: {
      status: gateOf("GATE3_DIRECTIONAL_BIAS")?.status ?? "UNKNOWN",
      ...(gateOf("GATE3_DIRECTIONAL_BIAS")?.reason ? { reason: gateOf("GATE3_DIRECTIONAL_BIAS")!.reason } : {}),
    },
    gate4Status: {
      status: gateOf("GATE4_CONFLUENCE")?.status ?? "UNKNOWN",
      ...(gateOf("GATE4_CONFLUENCE")?.reason ? { reason: gateOf("GATE4_CONFLUENCE")!.reason } : {}),
    },
    ...(firstFail ? { firstBlockingGate: firstFail.gateId } : {}),
    recommendation: trace.recommendation,
  };
}

export function formatDecisionDecomposition(d: DecisionDecomposition): string[] {
  const lines = [
    `structure=${d.factorScores.trend} fundamental=${d.factorScores.fundamental} positioning=${d.factorScores.sentiment} (indicator ${d.factorScores.indicator} — excluded from the core average)`,
    `core weighted avg = ${d.coreWeightedAvg} (0.45·trend + 0.30·fundamental + 0.25·sentiment) → raw bias ${d.rawBias}` +
      (d.vetoApplied ? ` → structural veto applied${d.vetoReason ? ` (${d.vetoReason})` : ""}` : "") +
      ` → final bias ${d.finalBias}`,
    `Gate 3 ${d.gate3.status}${d.gate3.reason ? `: ${d.gate3.reason}` : ""}`,
    `Gate 4 ${d.gate4Status.status}: agreeing [${d.gate4.agreeing.join(", ") || "none"}] opposing [${d.gate4.opposing.join(", ") || "none"}] — needs 2 agreeing`,
    `recommendation ${d.recommendation}${d.firstBlockingGate ? ` (first blocking gate ${d.firstBlockingGate})` : ""}`,
  ];
  return lines;
}

// ────────────────────────────────────────────────────────────────
// §7 ablation (pure filter — an audit tool, never a production mode)
// ────────────────────────────────────────────────────────────────

export type AblationMode = "BASE" | "PRICE_ONLY" | "DERIVATIVES_ONLY" | "COT_ONLY" | "MACRO_ONLY";

export const ABLATION_MODES: readonly AblationMode[] = [
  "BASE",
  "PRICE_ONLY",
  "DERIVATIVES_ONLY",
  "COT_ONLY",
  "MACRO_ONLY",
];

/**
 * Filter an evidence attachment down to one class. Price candles are never
 * touched: the ablation changes evidence availability only, so any difference in
 * a decision is attributable to that evidence class.
 */
export function ablationAttachment(
  attachment: HistoricalEvidenceAttachment,
  mode: AblationMode,
): HistoricalEvidenceAttachment {
  const keep = {
    DERIVATIVES_ONLY: (domain: string) => domain === "crypto_derivatives",
    COT_ONLY: (domain: string) => domain === "cot_positioning",
    MACRO_ONLY: (domain: string) => domain === "macro_rates",
    PRICE_ONLY: () => false,
    BASE: () => true,
  }[mode];

  const provenance = attachment.provenance.filter((p) => keep(p.domain));
  return {
    ...(mode === "BASE" || mode === "DERIVATIVES_ONLY" ? { derivativesData: attachment.derivativesData } : {}),
    ...(mode === "BASE" || mode === "COT_ONLY" ? { cotData: attachment.cotData } : {}),
    ...(mode === "BASE" || mode === "MACRO_ONLY" ? { macroData: attachment.macroData } : {}),
    provenance,
    coverage: attachment.coverage,
  };
}

/** Which engine-visible fields an ablation mode keeps. */
export function ablationFields(mode: AblationMode): string[] {
  switch (mode) {
    case "BASE":
      return ["derivativesData", "cotData", "macroData"];
    case "DERIVATIVES_ONLY":
      return ["derivativesData"];
    case "COT_ONLY":
      return ["cotData"];
    case "MACRO_ONLY":
      return ["macroData"];
    case "PRICE_ONLY":
      return [];
  }
}
