/**
 * Phase 293 — HISTORICAL OUTCOME VALIDATION & CALIBRATION (pure evaluator).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Phases 290-292 made the engine structurally coherent: a plan's entry, stop,
 * target and R:R are one market-derived set. That says nothing about what
 * happens AFTER a setup is declared. This module is the auditable empirical
 * layer that answers that question without turning a small sample into a
 * probability claim.
 *
 * THE ONE RULE
 * ------------
 * PAST → DECISION. FUTURE → OUTCOME ONLY.
 *
 * The walk-forward driver runs the PRODUCTION engine on the candle prefix that
 * existed at the evaluation instant, so the decision, setup state, levels and
 * confidence are exactly what production would have produced. Future candles
 * are then read ONLY to classify what happened. Nothing in this module feeds
 * back into the engine: no score, no confidence, no weight changes.
 *
 * HONESTY RULES
 * -------------
 * · Ambiguous paths are NOT collapsed into wins or losses: when a single candle
 *   could have touched both the stop and the target, intrabar ordering is
 *   unknown and the outcome is AMBIGUOUS_PATH.
 * · Realized R is reported only for genuinely closed outcomes. An unresolved
 *   horizon is a MARK-TO-MARKET multiple, labelled as such.
 * · No fills, slippage, commissions, spreads or financing are invented: the
 *   source dataset contains OHLCV only, and that limitation is stated in the
 *   report instead of being priced in.
 * · Aggregates are marked insufficient below an explicit sample floor; the
 *   engine's `confidence` keeps its existing semantic meaning (evidence
 *   strength) and is never re-labelled as a probability or win rate.
 *
 * COMPUTATION SAFETY
 * ------------------
 * Callers choose a bounded set of evaluation indices (`maxEvaluations`) and a
 * bounded outcome horizon (`maxFutureCandles`); prefixes are sliced per
 * evaluation rather than cached in an unbounded table, so a long series costs
 * O(maxEvaluations × prefix) — never O(N²) over the whole history.
 */
import { runAnalysis } from "./analysis-engine";
import type { AnalysisResult, AnalysisInput } from "@/types/analysis";
import { classifyOutcome, computePnl } from "./journal";
import type { TradeOutcome } from "@/types/journal";

/** Bump when the outcome vocabulary or the classification order changes. */
export const OUTCOME_MODEL_VERSION = "phase293.1";

/** Bounded defaults — documented limits, so the evaluator cannot blow up. */
export const DEFAULT_MAX_EVALUATIONS = 40;
export const DEFAULT_MAX_FUTURE_CANDLES = 60;
/** Below this many RESOLVED outcomes an aggregate is reported as insufficient. */
export const MIN_RESOLVED_FOR_AGGREGATE = 20;
/** Below this many resolved outcomes in a confidence bucket, calibration is unavailable. */
export const CALIBRATION_MIN_RESOLVED = 30;

// ════════ 1. OUTCOME MODEL ════════

export type OutcomeType =
  | "TARGET_HIT"
  | "STOP_HIT"
  | "INVALIDATION_HIT"
  | "TIME_EXPIRED"
  | "NO_TRADE"
  | "AMBIGUOUS_PATH"
  | "INSUFFICIENT_FUTURE_DATA";

/** The facts captured from the engine at the evaluation instant. */
export interface WalkForwardDecision {
  evaluationIndex: number;
  /** The instant the decision was taken on (aligned to the observation clock when the run is aligned). */
  evaluationTime: number;
  /**
   * The evaluation candle's ORIGINAL provider timestamp, when the run aligned
   * the timeline to the observation instant. Provenance is never rewritten —
   * the alignment is recorded here and in the report.
   */
  providerEvaluationTime?: number;
  recommendation: string;
  bias: string;
  confidence: number;
  conviction: string;
  /** Phase 291 setup state — or "NO_LOCATION" when no location was produced. */
  setupState: string;
  location: string;
  timeframe: string;
  provider: string;
  instrument: string;
  direction?: "long" | "short";
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  structuralInvalidationLevel?: number;
  /** |entry − published stop| — the R unit of every R-multiple below. */
  riskDistance?: number;
  plannedRR?: number;
  stopSource?: string;
  targetSource?: string;
  triggerConfirmed?: boolean;
  htfAlignment?: string;
  sweepPresent: boolean;
  fvgEngaged: boolean;
  obEngaged: boolean;
  structuralEventPresent: boolean;
  noTradeReasons: string[];
}

export interface OutcomeEvaluation {
  decision: WalkForwardDecision;
  outcome: OutcomeType;
  /** Index (in the caller's series) of the candle that resolved the outcome. */
  outcomeIndex?: number;
  outcomeTime?: number;
  elapsedCandles?: number;
  elapsedMs?: number;
  /** Multiple of the plan's risk distance — only for closed outcomes. */
  realizedR?: number;
  /** Horizon mark for TIME_EXPIRED only (never presented as a closed trade). */
  markToMarketR?: number;
  /** Maximum favourable / adverse excursion over the observed window, in R. */
  mfeR?: number;
  maeR?: number;
  mfePrice?: number;
  maePrice?: number;
  /** True when the published stop was hit at or beyond the structural invalidation. */
  invalidationBreached?: boolean;
  futureCandlesConsidered: number;
  notes: string[];
}

export interface OutcomeCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// ════════ 2. DECISION EXTRACTION (no future data involved) ════════

/** Build the decision record from an engine result. Reads the result only. */
export function decisionFromResult(
  result: AnalysisResult,
  evaluationIndex: number,
  evaluationTime: number,
  providerEvaluationTime?: number,
): WalkForwardDecision {
  const plan = result.tradePlan;
  const loc = result.tradeLocation;
  const entry = plan ? parseFloat(plan.entry) : undefined;
  const stopLoss = plan ? parseFloat(plan.stopLoss) : undefined;
  const takeProfit = plan ? parseFloat(plan.takeProfit) : undefined;
  const invalidation = plan?.structuralInvalidation?.level;
  const riskDistance =
    entry !== undefined && stopLoss !== undefined && Number.isFinite(entry) && Number.isFinite(stopLoss)
      ? Math.abs(entry - stopLoss)
      : undefined;

  return {
    evaluationIndex,
    evaluationTime,
    ...(providerEvaluationTime !== undefined ? { providerEvaluationTime } : {}),
    recommendation: result.recommendation,
    bias: result.bias,
    confidence: result.confidence,
    conviction: result.conviction ?? "undetermined",
    setupState: loc?.context.state ?? "NO_LOCATION",
    location: loc?.location ?? "no_location",
    timeframe: result.timeframe ?? "unknown",
    instrument: result.instrument ?? "unknown",
    provider: result.provider ?? "unknown",
    ...(plan?.direction ? { direction: plan.direction } : {}),
    ...(entry !== undefined ? { entry } : {}),
    ...(stopLoss !== undefined ? { stopLoss } : {}),
    ...(takeProfit !== undefined ? { takeProfit } : {}),
    ...(invalidation !== undefined ? { structuralInvalidationLevel: invalidation } : {}),
    ...(riskDistance !== undefined && riskDistance > 0 ? { riskDistance } : {}),
    ...(plan ? { plannedRR: plan.riskReward } : {}),
    ...(plan?.stopProvenance ? { stopSource: plan.stopProvenance.source } : {}),
    ...(plan?.targetProvenance ? { targetSource: plan.targetProvenance.source } : {}),
    ...(plan?.entryContext ? { triggerConfirmed: plan.entryContext.triggerConfirmed } : {}),
    ...(result.technicalData?.mtf?.alignment ? { htfAlignment: result.technicalData.mtf.alignment } : {}),
    sweepPresent: loc?.liquidity.sweep !== undefined,
    fvgEngaged: !!(loc?.flags.insideFvg || loc?.flags.atFvgBoundary),
    obEngaged: !!(loc?.flags.insideOb || loc?.flags.atObBoundary),
    structuralEventPresent: !!result.structuralEvidence?.timeframes.some((t) => t.event !== undefined),
    noTradeReasons: result.noTradeReasons ?? [],
  };
}

// ════════ 3. OUTCOME CLASSIFICATION (future candles only) ════════

export interface OutcomeOptions {
  /** Maximum number of future candles to observe. */
  maxFutureCandles?: number;
  /** Fewer future candles than this ⇒ INSUFFICIENT_FUTURE_DATA (default 1). */
  minFutureCandles?: number;
}

/**
 * Classify the outcome of an ALREADY-ESTABLISHED decision using only candles
 * that came after it. The decision record is never modified.
 */
export function evaluateOutcome(
  decision: WalkForwardDecision,
  futureCandles: readonly OutcomeCandle[],
  opts: OutcomeOptions = {},
): OutcomeEvaluation {
  const maxFutureCandles = opts.maxFutureCandles ?? DEFAULT_MAX_FUTURE_CANDLES;
  const minFutureCandles = opts.minFutureCandles ?? 1;
  const notes: string[] = [];

  const base = (outcome: OutcomeType, extra: Partial<OutcomeEvaluation> = {}): OutcomeEvaluation => ({
    decision,
    outcome,
    futureCandlesConsidered: 0,
    notes,
    ...extra,
  });

  // A non-thesis has no plan to resolve. This is an outcome in its own right.
  if (decision.direction === undefined || decision.entry === undefined || decision.stopLoss === undefined ||
      decision.takeProfit === undefined) {
    notes.push("No executable plan was published at the evaluation instant — the decision itself is the outcome.");
    return base("NO_TRADE");
  }

  const window = futureCandles.slice(0, Math.max(0, maxFutureCandles));
  if (window.length < minFutureCandles) {
    notes.push(
      `Only ${window.length} future candle(s) available — the plan is unresolved and no outcome is inferred.`,
    );
    return base("INSUFFICIENT_FUTURE_DATA", { futureCandlesConsidered: window.length });
  }

  const { entry, stopLoss, takeProfit, direction } = decision;
  const invalidation = decision.structuralInvalidationLevel;
  const risk = Math.abs(entry - stopLoss);
  if (!(risk > 0)) {
    notes.push("The plan carries no risk distance — an R-multiple cannot be formed.");
    return base("INSUFFICIENT_FUTURE_DATA", { futureCandlesConsidered: 0 });
  }

  const long = direction === "long";
  const favourable = (c: OutcomeCandle) => (long ? c.high : c.low);
  const adverse = (c: OutcomeCandle) => (long ? c.low : c.high);
  const money = (price: number) => (long ? price - entry : entry - price); // in price units

  let mfePrice = favourable(window[0]);
  let maePrice = adverse(window[0]);

  for (let i = 0; i < window.length; i++) {
    const candle = window[i];
    mfePrice = long ? Math.max(mfePrice, candle.high) : Math.min(mfePrice, candle.low);
    maePrice = long ? Math.min(maePrice, candle.low) : Math.max(maePrice, candle.high);

    // A level is touched only on the side that would actually reach it:
    // a long is stopped by a LOW at its stop and paid by a HIGH at its target.
    const stopTouched = long ? candle.low <= stopLoss : candle.high >= stopLoss;
    const targetTouched = long ? candle.high >= takeProfit : candle.low <= takeProfit;
    const invalidationTouched =
      invalidation !== undefined && (long ? candle.low <= invalidation : candle.high >= invalidation);

    const resolved = (outcome: OutcomeType): OutcomeEvaluation => {
      const elapsedCandles = i + 1;
      const excursions = {
        mfePrice,
        maePrice,
        mfeR: money(mfePrice) / risk,
        maeR: money(maePrice) / risk,
      };
      if (outcome === "AMBIGUOUS_PATH") {
        notes.push(
          "One candle touched both the stop and the target — intrabar ordering is unknown, so the outcome is not scored as a win or a loss.",
        );
        return base("AMBIGUOUS_PATH", {
          outcomeIndex: decision.evaluationIndex + elapsedCandles,
          outcomeTime: candle.timestamp,
          elapsedCandles,
          elapsedMs: candle.timestamp - decision.evaluationTime,
          futureCandlesConsidered: elapsedCandles,
          ...excursions,
        });
      }
      if (outcome === "TARGET_HIT") {
        return base("TARGET_HIT", {
          outcomeIndex: decision.evaluationIndex + elapsedCandles,
          outcomeTime: candle.timestamp,
          elapsedCandles,
          elapsedMs: candle.timestamp - decision.evaluationTime,
          realizedR: money(takeProfit) / risk,
          futureCandlesConsidered: elapsedCandles,
          ...excursions,
        });
      }
      if (outcome === "STOP_HIT") {
        return base("STOP_HIT", {
          outcomeIndex: decision.evaluationIndex + elapsedCandles,
          outcomeTime: candle.timestamp,
          elapsedCandles,
          elapsedMs: candle.timestamp - decision.evaluationTime,
          realizedR: money(stopLoss) / risk,
          invalidationBreached:
            invalidation !== undefined &&
            (long ? candle.low <= invalidation : candle.high >= invalidation),
          futureCandlesConsidered: elapsedCandles,
          ...excursions,
        });
      }
      // INVALIDATION_HIT — the thesis is void while the protective stop survived.
      notes.push(
        "The structural invalidation level was breached while the published protective stop was not reached — the thesis is void, so the evaluation ends here. The multiple below is measured at that level; no stop fill is assumed.",
      );
      return base("INVALIDATION_HIT", {
        outcomeIndex: decision.evaluationIndex + elapsedCandles,
        outcomeTime: candle.timestamp,
        elapsedCandles,
        elapsedMs: candle.timestamp - decision.evaluationTime,
        realizedR: money(invalidation!) / risk,
        invalidationBreached: true,
        futureCandlesConsidered: elapsedCandles,
        ...excursions,
      });
    };

    // Ambiguity first: a single candle that could have paid the target AND
    // stopped/voided the thesis is never collapsed into a win or a loss —
    // intrabar ordering is unknowable from OHLC.
    const adverseTouched = stopTouched || invalidationTouched;
    if (targetTouched && adverseTouched) return resolved("AMBIGUOUS_PATH");
    if (targetTouched) return resolved("TARGET_HIT");
    if (stopTouched) return resolved("STOP_HIT");
    if (invalidationTouched && invalidation !== undefined &&
        Math.abs(invalidation - stopLoss) > 1e-12) {
      return resolved("INVALIDATION_HIT");
    }
  }

  // The horizon ended without a touch: report the MARK, never a closed trade.
  const last = window[window.length - 1];
  notes.push(
    "The observation window ended before the plan resolved — the multiple below is the horizon mark-to-market, not a closed trade.",
  );
  return base("TIME_EXPIRED", {
    outcomeIndex: decision.evaluationIndex + window.length,
    outcomeTime: last.timestamp,
    elapsedCandles: window.length,
    elapsedMs: last.timestamp - decision.evaluationTime,
    markToMarketR: money(last.close) / risk,
    mfePrice,
    maePrice,
    mfeR: money(mfePrice) / risk,
    maeR: money(maePrice) / risk,
    futureCandlesConsidered: window.length,
  });
}

// ════════ 4. WALK-FORWARD DRIVER ════════

export type WalkForwardAlignment =
  | {
      /**
       * The engine's freshness gate is a live-transport safety rule evaluated
       * against the wall clock. A historical replay therefore presents each
       * evaluation window AS OF the observation instant: every timestamp in the
       * window is shifted by one constant, so bar spacing and order are exactly
       * the recorded ones and the decision candle reads "now". The shift is
       * recorded here, and each decision keeps the bar's own provider instant.
       */
      mode: "WALL_CLOCK_ALIGNED";
      nowMs: number;
      note: string;
    }
  | {
      mode: "PROVIDER_TIMESTAMPS";
      note: string;
    };

export interface WalkForwardOptions extends OutcomeOptions {
  /** Maximum number of evaluation points (bounded by design). */
  maxEvaluations?: number;
  /**
   * Exact evaluation indices to walk. Indices below `minPrefixCandles - 1` or
   * past the end are dropped; the list is de-duplicated, sorted and capped at
   * `maxEvaluations`. Use it to pin a specific chronology (or the
   * zero-lookahead horizon case) instead of relying on even spacing.
   */
  evaluationIndices?: readonly number[];
  /** First prefix length able to carry a decision (default 60 candles). */
  minPrefixCandles?: number;
  /** Index stride between evaluations (default: an even spread). */
  step?: number;
  alignment: WalkForwardAlignment;
}

export interface OutcomeValidationReport {
  modelVersion: string;
  /** Decision facts are indexed by the evaluation candle; future candles resolved them. */
  evaluations: OutcomeEvaluation[];
  sample: {
    evaluations: number;
    plannedTrades: number;
    noTrade: number;
    resolved: number;
    targetHits: number;
    stopHits: number;
    invalidationHits: number;
    timeExpired: number;
    ambiguous: number;
    insufficientFutureData: number;
  };
  bySetupState: BucketStats[];
  byDirection: BucketStats[];
  byTimeframe: BucketStats[];
  byHtfAlignment: BucketStats[];
  byFlags: BucketStats[];
  calibration: CalibrationReport;
  expectancy: ExpectancyReport;
  limits: { maxEvaluations: number; maxFutureCandles: number };
  alignment: WalkForwardAlignment;
  provenance: {
    provider: string;
    timeframe: string;
    instrument: string;
    /** Aligned instants of the first and last evaluated decision candles. */
    firstDecisionTime?: number;
    lastDecisionTime?: number;
    /** The same candles' ORIGINAL provider instants (unaltered by alignment). */
    firstProviderTime?: number;
    lastProviderTime?: number;
    /** Constant shift applied to align each evaluation window (0 = none). */
    alignmentShiftMs?: number;
    /** Explicit data limitation of this dataset. */
    executionData: string;
  };
}

/**
 * Run the production engine at bounded, deterministic prefixes and classify the
 * outcome of each decision against the candles that followed it.
 *
 * `buildInput` receives ONLY the prefix — the caller cannot accidentally hand
 * the engine future candles, and the engine cannot see them.
 */
export function runWalkForward(
  candles: readonly OutcomeCandle[],
  buildInput: (prefix: readonly OutcomeCandle[], index: number) => AnalysisInput,
  opts: WalkForwardOptions,
): OutcomeValidationReport {
  const maxEvaluations = opts.maxEvaluations ?? DEFAULT_MAX_EVALUATIONS;
  const maxFutureCandles = opts.maxFutureCandles ?? DEFAULT_MAX_FUTURE_CANDLES;
  const minPrefixCandles = opts.minPrefixCandles ?? 60;
  const minFutureCandles = opts.minFutureCandles ?? 1;

  const first = Math.max(minPrefixCandles, 1) - 1;
  const last = candles.length - 1;
  const step = opts.step ?? Math.max(1, Math.floor((last - first) / Math.max(1, maxEvaluations - 1)) || 1);

  // Bounded by construction: at most `maxEvaluations` prefixes, evenly spaced
  // when no exact windows are pinned — never a second pass over the candles.
  const indices: number[] = [];
  if (opts.evaluationIndices && opts.evaluationIndices.length > 0) {
    for (const raw of opts.evaluationIndices) {
      const index = Math.floor(raw);
      if (!Number.isFinite(index) || index < first || index > last || indices.includes(index)) continue;
      indices.push(index);
      if (indices.length >= maxEvaluations) break;
    }
    indices.sort((a, b) => a - b);
  } else {
    for (let i = first; i <= last && indices.length < maxEvaluations; i += step) indices.push(i);
  }

  const evaluations: OutcomeEvaluation[] = [];
  for (const index of indices) {
    const rawPrefix = candles.slice(0, index + 1);
    const rawFuture = candles.slice(index + 1);
    const providerTime = rawPrefix[rawPrefix.length - 1].timestamp;

    // Alignment shifts the WHOLE window by one constant, so every bar keeps its
    // exact distance from the decision candle — only the clock reading moves.
    const shift = opts.alignment.mode === "WALL_CLOCK_ALIGNED" ? opts.alignment.nowMs - providerTime : 0;
    const prefix = shift === 0 ? rawPrefix : rawPrefix.map((c) => ({ ...c, timestamp: c.timestamp + shift }));
    const future = shift === 0 ? rawFuture : rawFuture.map((c) => ({ ...c, timestamp: c.timestamp + shift }));

    const result = runAnalysisSafely(buildInput(prefix, index));
    const decision = decisionFromResult(
      result,
      index,
      prefix[prefix.length - 1].timestamp,
      shift === 0 ? undefined : providerTime,
    );
    evaluations.push(evaluateOutcome(decision, future, { maxFutureCandles, minFutureCandles }));
  }

  const firstDecisionTime = evaluations[0]?.decision.evaluationTime;
  const lastDecisionTime = evaluations[evaluations.length - 1]?.decision.evaluationTime;
  const firstProviderTime = evaluations[0]?.decision.providerEvaluationTime;
  const lastProviderTime = evaluations[evaluations.length - 1]?.decision.providerEvaluationTime;

  return {
    modelVersion: OUTCOME_MODEL_VERSION,
    evaluations,
    sample: sampleCounts(evaluations),
    bySetupState: aggregateBy(evaluations, (e) => e.decision.setupState),
    byDirection: aggregateBy(evaluations, (e) => e.decision.direction ?? "no_plan"),
    byTimeframe: aggregateBy(evaluations, (e) => e.decision.timeframe),
    byHtfAlignment: aggregateBy(evaluations, (e) => e.decision.htfAlignment ?? "unavailable"),
    byFlags: aggregateBy(evaluations, flagLabel),
    calibration: calibrateConfidence(evaluations),
    expectancy: computeRealizedExpectancy(evaluations),
    limits: { maxEvaluations, maxFutureCandles },
    alignment: opts.alignment,
    provenance: {
      provider: evaluations[0]?.decision.provider ?? "unknown",
      timeframe: evaluations[0]?.decision.timeframe ?? "unknown",
      instrument: evaluations[0]?.decision.instrument ?? "unknown",
      ...(firstDecisionTime !== undefined ? { firstDecisionTime } : {}),
      ...(lastDecisionTime !== undefined ? { lastDecisionTime } : {}),
      ...(firstProviderTime !== undefined ? { firstProviderTime } : {}),
      ...(lastProviderTime !== undefined ? { lastProviderTime } : {}),
      ...(opts.alignment.mode === "WALL_CLOCK_ALIGNED"
        ? {
            alignmentShiftMs:
              opts.alignment.nowMs - (firstProviderTime ?? opts.alignment.nowMs),
          }
        : {}),
      executionData:
        "OHLCV only — no fills, slippage, spread, commission or financing data was supplied, so none is modelled.",
    },
  };
}

/** The engine is deterministic; a thrown error is surfaced as a NO_TRADE decision. */
function runAnalysisSafely(input: AnalysisInput): AnalysisResult {
  try {
    return runAnalysis(input);
  } catch {
    return {
      recommendation: "NO_TRADE",
      bias: "Neutral",
      confidence: 0,
      conviction: "Low",
      timeframe: input.timeframe,
      provider: input.provider,
      tradeLocation: undefined,
      tradePlan: undefined,
      technicalData: input.technicalData,
      noTradeReasons: ["The engine could not evaluate this prefix — reported verbatim as NO_TRADE."],
    } as unknown as AnalysisResult;
  }
}


function flagLabel(e: OutcomeEvaluation): string {
  const d = e.decision;
  const parts: string[] = [];
  parts.push(d.triggerConfirmed ? "confirmed_setup_context" : "not_confirmed");
  parts.push(d.sweepPresent ? "sweep" : "no_sweep");
  parts.push(d.fvgEngaged ? "fvg" : "no_fvg");
  parts.push(d.obEngaged ? "ob" : "no_ob");
  parts.push(d.structuralEventPresent ? "structural_event" : "no_structural_event");
  return parts.join(" + ");
}

// ════════ 5. AGGREGATION ════════

export interface BucketStats {
  label: string;
  occurrences: number;
  planned: number;
  resolved: number;
  targetHits: number;
  stopHits: number;
  invalidationHits: number;
  timeExpired: number;
  ambiguous: number;
  insufficientFutureData: number;
  noTrade: number;
  realizedR?: { n: number; mean: number; median: number };
  mfeR?: { n: number; mean: number; median: number };
  maeR?: { n: number; mean: number; median: number };
  resolutionCandles?: { n: number; mean: number; median: number };
  sampleSufficient: boolean;
  insufficientReason?: string;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};

function summarize(xs: number[]): { n: number; mean: number; median: number } | undefined {
  return xs.length > 0 ? { n: xs.length, mean: mean(xs), median: median(xs) } : undefined;
}

export function aggregateBy(
  evaluations: readonly OutcomeEvaluation[],
  keyOf: (e: OutcomeEvaluation) => string,
): BucketStats[] {
  const groups = new Map<string, OutcomeEvaluation[]>();
  for (const e of evaluations) {
    const key = keyOf(e);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  return [...groups.entries()]
    .map(([label, evals]) => buildBucketStats(label, evals))
    .sort((a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label));
}

export function buildBucketStats(label: string, evals: readonly OutcomeEvaluation[]): BucketStats {
  const count = (t: OutcomeType) => evals.filter((e) => e.outcome === t).length;
  const realized = evals.filter((e) => e.outcome === "TARGET_HIT" || e.outcome === "STOP_HIT" || e.outcome === "INVALIDATION_HIT");
  const resolvedSet = [...realized, ...evals.filter((e) => e.outcome === "TIME_EXPIRED")];
  const realizedR = summarize(realized.map((e) => e.realizedR!).filter(Number.isFinite));
  const mfeR = summarize(evals.map((e) => e.mfeR!).filter(Number.isFinite));
  const maeR = summarize(evals.map((e) => e.maeR!).filter(Number.isFinite));
  const resolutionCandles = summarize(resolvedSet.map((e) => e.elapsedCandles!).filter(Number.isFinite));
  const sufficient = realized.length >= MIN_RESOLVED_FOR_AGGREGATE;

  return {
    label,
    occurrences: evals.length,
    planned: evals.filter((e) => e.decision.direction !== undefined).length,
    resolved: resolvedSet.length,
    targetHits: count("TARGET_HIT"),
    stopHits: count("STOP_HIT"),
    invalidationHits: count("INVALIDATION_HIT"),
    timeExpired: count("TIME_EXPIRED"),
    ambiguous: count("AMBIGUOUS_PATH"),
    insufficientFutureData: count("INSUFFICIENT_FUTURE_DATA"),
    noTrade: count("NO_TRADE"),
    ...(realizedR ? { realizedR } : {}),
    ...(mfeR ? { mfeR } : {}),
    ...(maeR ? { maeR } : {}),
    ...(resolutionCandles ? { resolutionCandles } : {}),
    sampleSufficient: sufficient,
    ...(sufficient
      ? {}
      : {
          insufficientReason: `${realized.length} closed outcome(s) — below the ${MIN_RESOLVED_FOR_AGGREGATE}-sample floor for aggregate statistics`,
        }),
  };
}

export function sampleCounts(evaluations: readonly OutcomeEvaluation[]): OutcomeValidationReport["sample"] {
  const count = (t: OutcomeType) => evaluations.filter((e) => e.outcome === t).length;
  return {
    evaluations: evaluations.length,
    plannedTrades: evaluations.filter((e) => e.decision.direction !== undefined).length,
    noTrade: count("NO_TRADE"),
    resolved: count("TARGET_HIT") + count("STOP_HIT") + count("INVALIDATION_HIT") + count("TIME_EXPIRED"),
    targetHits: count("TARGET_HIT"),
    stopHits: count("STOP_HIT"),
    invalidationHits: count("INVALIDATION_HIT"),
    timeExpired: count("TIME_EXPIRED"),
    ambiguous: count("AMBIGUOUS_PATH"),
    insufficientFutureData: count("INSUFFICIENT_FUTURE_DATA"),
  };
}

// ════════ 6. CONFIDENCE CALIBRATION ════════

export interface CalibrationBucket {
  label: string;
  lower: number;
  upper: number;
  occurrences: number;
  resolved: number;
  targetHits: number;
  /** Descriptive share of resolved outcomes that reached target — not a probability. */
  targetResolutionShare?: number;
  /** |observed share − bucket midpoint| — only where a sample exists. */
  calibrationError?: number;
  sampleSufficient: boolean;
}

export interface CalibrationReport {
  semantics: string;
  productionConfidenceUnchanged: true;
  minResolvedSample: number;
  status: "INSUFFICIENT_SAMPLE" | "DESCRIPTIVE_ONLY";
  note: string;
  buckets: CalibrationBucket[];
}

export const CONFIDENCE_BUCKET_EDGES = [20, 40, 60, 80, 90] as const;

/**
 * Descriptive calibration ONLY. Nothing here is written back into the engine,
 * and no bucket is ever presented as a probability of profit.
 */
export function calibrateConfidence(
  evaluations: readonly OutcomeEvaluation[],
  edges: readonly number[] = CONFIDENCE_BUCKET_EDGES,
): CalibrationReport {
  const sorted = [...edges].sort((a, b) => a - b);
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const lower = sorted[i];
    const upper = sorted[i + 1];
    const inBucket = evaluations.filter(
      (e) => e.decision.confidence >= lower && (i === sorted.length - 2 ? e.decision.confidence <= upper : e.decision.confidence < upper),
    );
    const resolved = inBucket.filter((e) =>
      e.outcome === "TARGET_HIT" || e.outcome === "STOP_HIT" || e.outcome === "INVALIDATION_HIT",
    );
    const targetHits = resolved.filter((e) => e.outcome === "TARGET_HIT").length;
    const sufficient = resolved.length >= CALIBRATION_MIN_RESOLVED;
    const share = sufficient ? targetHits / resolved.length : undefined;
    const midpoint = (lower + upper) / 2 / 100;
    buckets.push({
      label: `${lower}–${upper}`,
      lower,
      upper,
      occurrences: inBucket.length,
      resolved: resolved.length,
      targetHits,
      ...(share !== undefined ? { targetResolutionShare: share } : {}),
      ...(share !== undefined ? { calibrationError: Math.abs(share - midpoint) } : {}),
      sampleSufficient: sufficient,
    });
  }
  const anySufficient = buckets.some((b) => b.sampleSufficient);

  return {
    semantics:
      "The engine's confidence keeps its existing meaning (evidence strength, not a probability of profit). The buckets below are descriptive empirical observations and are never fed back into production confidence.",
    productionConfidenceUnchanged: true,
    minResolvedSample: CALIBRATION_MIN_RESOLVED,
    status: anySufficient ? "DESCRIPTIVE_ONLY" : "INSUFFICIENT_SAMPLE",
    note: anySufficient
      ? "At least one bucket met the resolved-sample floor; the share is descriptive only."
      : `No confidence bucket reached the ${CALIBRATION_MIN_RESOLVED}-resolved-outcome floor — empirical calibration is unavailable for this sample.`,
    buckets,
  };
}

// ════════ 7. REALIZED EXPECTANCY (journal-compatible) ════════

export interface ExpectancyReport {
  method: string;
  sampleSize: number;
  meanRealizedR?: number;
  medianRealizedR?: number;
  excluded: { ambiguous: number; timeExpired: number; unresolved: number; noTrade: number };
  sampleSufficient: boolean;
}

/**
 * EV = mean realized R over CLOSED outcomes. Ambiguous and horizon-marked cases
 * are excluded by construction and the exclusion counts are reported.
 */
export function computeRealizedExpectancy(evaluations: readonly OutcomeEvaluation[]): ExpectancyReport {
  const closed = evaluations.filter(
    (e) => e.outcome === "TARGET_HIT" || e.outcome === "STOP_HIT" || e.outcome === "INVALIDATION_HIT",
  );
  const rs = closed.map((e) => e.realizedR!).filter(Number.isFinite);
  const sufficient = rs.length >= MIN_RESOLVED_FOR_AGGREGATE;
  return {
    method: "mean realized R over closed outcomes (target hit / stop hit / invalidation breach)",
    sampleSize: rs.length,
    ...(rs.length > 0 ? { meanRealizedR: mean(rs), medianRealizedR: median(rs) } : {}),
    excluded: {
      ambiguous: evaluations.filter((e) => e.outcome === "AMBIGUOUS_PATH").length,
      timeExpired: evaluations.filter((e) => e.outcome === "TIME_EXPIRED").length,
      unresolved: evaluations.filter((e) => e.outcome === "INSUFFICIENT_FUTURE_DATA").length,
      noTrade: evaluations.filter((e) => e.outcome === "NO_TRADE").length,
    },
    sampleSufficient: sufficient,
  };
}

// ════════ 8. JOURNAL BRIDGE (reuse, never duplicate, accounting) ════════

export interface JournalOutcomeBridge {
  outcome: TradeOutcome;
  /** P/L in price units for unit size, or scaled when a position size is given. */
  pnl?: number;
  pnlPercent?: number;
  realizedR?: number;
}

/**
 * Map an evaluation onto the EXISTING journal vocabulary using the journal's own
 * `computePnl` / `classifyOutcome`, so there is one accounting model.
 */
export function toJournalOutcome(
  evaluation: OutcomeEvaluation,
  opts: { positionSize?: number } = {},
): JournalOutcomeBridge {
  const d = evaluation.decision;
  if (evaluation.outcome === "TARGET_HIT" && d.entry !== undefined && d.takeProfit !== undefined && d.direction) {
    const { pnl, pnlPercent } = computePnl(d.entry, d.takeProfit, d.direction, opts.positionSize);
    return {
      outcome: classifyOutcome(pnl),
      ...(pnl !== undefined ? { pnl } : {}),
      ...(pnlPercent !== undefined ? { pnlPercent } : {}),
      ...(evaluation.realizedR !== undefined ? { realizedR: evaluation.realizedR } : {}),
    };
  }
  if (evaluation.outcome === "STOP_HIT" && d.entry !== undefined && d.stopLoss !== undefined && d.direction) {
    const { pnl, pnlPercent } = computePnl(d.entry, d.stopLoss, d.direction, opts.positionSize);
    return {
      outcome: classifyOutcome(pnl),
      ...(pnl !== undefined ? { pnl } : {}),
      ...(pnlPercent !== undefined ? { pnlPercent } : {}),
      ...(evaluation.realizedR !== undefined ? { realizedR: evaluation.realizedR } : {}),
    };
  }
  if (
    evaluation.outcome === "INVALIDATION_HIT" &&
    d.entry !== undefined &&
    d.structuralInvalidationLevel !== undefined &&
    d.direction
  ) {
    const { pnl, pnlPercent } = computePnl(d.entry, d.structuralInvalidationLevel, d.direction, opts.positionSize);
    return {
      outcome: classifyOutcome(pnl),
      ...(pnl !== undefined ? { pnl } : {}),
      ...(pnlPercent !== undefined ? { pnlPercent } : {}),
      ...(evaluation.realizedR !== undefined ? { realizedR: evaluation.realizedR } : {}),
    };
  }
  // Ambiguous, expired or unresolved outcomes keep the journal's UNKNOWN state:
  // the journal vocabulary has no place for a loss that may not have happened.
  return { outcome: "UNKNOWN" };
}

// ════════ 8b. OBSERVATIONAL FIELDS FOR THE RECOMMENDATION LAYER ════════

export interface EmpiricalValidationFields {
  modelVersion: string;
  historicalSampleSize: number;
  resolvedSampleSize: number;
  outcomeCoverage: number;
  empiricalRealizedR?: { sampleSize: number; mean: number; median: number; sampleSufficient: boolean };
  calibrationStatus: CalibrationReport["status"];
  evidenceSufficiency:
    | { status: "INSUFFICIENT_SAMPLE"; reason: string }
    | { status: "DESCRIPTIVE_ONLY"; note: string };
  /** Explicit: these fields never alter ranking, weights, confidence or bias. */
  affectsProductionDecision: false;
}

/**
 * Read-only empirical fields a reporting surface MAY display next to a
 * candidate. Nothing here is an input to scoring — the returned flag says so,
 * and no ranking code consumes this object.
 */
export function toEmpiricalValidationFields(report: OutcomeValidationReport): EmpiricalValidationFields {
  const s = report.sample;
  const exp = report.expectancy;
  return {
    modelVersion: report.modelVersion,
    historicalSampleSize: s.evaluations,
    resolvedSampleSize: s.resolved - s.timeExpired,
    outcomeCoverage: s.evaluations > 0 ? s.resolved / s.evaluations : 0,
    ...(exp.meanRealizedR !== undefined
      ? {
          empiricalRealizedR: {
            sampleSize: exp.sampleSize,
            mean: exp.meanRealizedR,
            median: exp.medianRealizedR!,
            sampleSufficient: exp.sampleSufficient,
          },
        }
      : {}),
    calibrationStatus: report.calibration.status,
    evidenceSufficiency: exp.sampleSufficient
      ? { status: "DESCRIPTIVE_ONLY", note: report.calibration.note }
      : {
          status: "INSUFFICIENT_SAMPLE",
          reason: `${exp.sampleSize} closed outcome(s) — below the ${MIN_RESOLVED_FOR_AGGREGATE}-sample floor`,
        },
    affectsProductionDecision: false,
  };
}

// ════════ 9. FACTUAL DIAGNOSTICS (reporting only) ════════

/**
 * Render the report as factual diagnostic lines. Deliberately free of
 * "accuracy", "probability", "guarantee" or predictive language.
 */
export function formatValidationDiagnostics(report: OutcomeValidationReport): string[] {
  const lines: string[] = [];
  const s = report.sample;
  lines.push(`Historical sample: ${s.evaluations}`);
  lines.push(`Planned trades: ${s.plannedTrades}`);
  lines.push(`Resolved: ${s.resolved}`);
  lines.push(`Target hits: ${s.targetHits}`);
  lines.push(`Stop hits: ${s.stopHits}`);
  lines.push(`Invalidation breaches: ${s.invalidationHits}`);
  lines.push(`Time expired (horizon reached): ${s.timeExpired}`);
  lines.push(`Ambiguous (same-candle stop and target): ${s.ambiguous}`);
  lines.push(`Insufficient future data: ${s.insufficientFutureData}`);
  const exp = report.expectancy;
  lines.push(
    exp.meanRealizedR === undefined
      ? `Realized R: no closed outcomes in this sample`
      : exp.sampleSufficient
        ? `Realized R — mean ${exp.meanRealizedR.toFixed(2)} R, median ${exp.medianRealizedR!.toFixed(2)} R over ${exp.sampleSize} closed outcome(s)`
        : `Realized R — mean ${exp.meanRealizedR.toFixed(2)} R over ${exp.sampleSize} closed outcome(s): INSUFFICIENT SAMPLE`,
  );
  const withExcursions = report.bySetupState.find((b) => b.mfeR !== undefined);
  if (withExcursions?.mfeR) lines.push(`MFE (mean): ${withExcursions.mfeR.mean.toFixed(2)} R`);
  if (withExcursions?.maeR) lines.push(`MAE (mean): ${withExcursions.maeR.mean.toFixed(2)} R`);
  lines.push(
    report.calibration.status === "INSUFFICIENT_SAMPLE"
      ? `Calibration: insufficient sample (${report.calibration.minResolvedSample} closed outcomes per bucket required)`
      : `Calibration: descriptive only — ${report.calibration.note}`,
  );
  const p = report.provenance;
  lines.push(`Data: provider ${p.provider}, instrument ${p.instrument}, timeframe ${p.timeframe}`);
  lines.push(
    report.alignment.mode === "WALL_CLOCK_ALIGNED"
      ? `Chronology: RECORDED / HISTORICAL payload presented at an aligned observation instant — never a live feed. ${report.alignment.note}`
      : `Chronology: provider timestamps used verbatim (no alignment). ${report.alignment.note}`,
  );
  if (p.firstDecisionTime !== undefined && p.lastDecisionTime !== undefined) {
    lines.push(
      `Decision window: ${new Date(p.firstDecisionTime).toISOString()} → ${new Date(p.lastDecisionTime).toISOString()}`,
    );
  }
  lines.push(`Execution costs: ${p.executionData}`);
  return lines;
}
