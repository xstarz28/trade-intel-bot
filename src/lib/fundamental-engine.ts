/**
 * Phase 276 — Deterministic fundamental engine.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Until now the analysis pipeline attached raw Alpha Vantage fundamen-
 * tals (one P/E, one margin figure, the single latest quarter) and the
 * engine compared three numbers to static thresholds. No derived
 * metrics existed: trends, consistency and growth-vs-valuation context
 * were never computed, so the UI card showed raw fields with no inter-
 * pretation, no confidence behind it, and no stated limitations.
 *
 * This module is a PURE deterministic calculator. It takes exactly the
 * evidence the provider supplied (FundamentalData) — nothing else, not
 * even the analysis-run clock — and derives:
 *
 *   - growth metrics    (revenue trend, EPS trend, YoY growth when the
 *                        provider reports it or 5 comparable quarters exist)
 *   - profitability     (margins, ROE/ROA — cited as reported, not faked)
 *   - earnings quality  (per-quarter consistency, estimate beats/misses)
 *   - valuation context (P/E, forward P/E, P/B, P/S, EV ratios as reported
 *                        plus growth-vs-valuation context from real growth)
 *   - balance-sheet / debt / FCF — Alpha Vantage OVERVIEW+EARNINGS does
 *                        NOT supply balance-sheet or cash-flow line items,
 *                        so these dimensions are reported as UNAVAILABLE.
 *                        They are NEVER fabricated to complete a card.
 *
 * INTEGRITY RULES
 * ---------------
 *   1. Every number in the output is traced from a provider-supplied
 *      number. No defaults, no sector averages, no synthetic peers.
 *   2. Fiscal/reporting period and provider identity are preserved on
 *      every derived series (periodEnd stored with each metric).
 *   3. `Date.now()` is NEVER used — not as an observation/report
 *      timestamp, not as a classification input, and not by the caller
 *      either. Every time comparison uses instants already contained in
 *      the evidence payload: the provider observation stamp (`timestamp`)
 *      and the fiscal period ends. Same evidence in → byte-identical
 *      assessment out, regardless of when it is computed.
 *   4. Missing metric → the dimension is UNAVAILABLE with a limitation
 *      line; it never becomes a neutral value, never blocks the rest.
 *   5. The caller cannot influence the assessment — with no clock and no
 *      options argument, the payload is the single source of truth.
 */

import type { FundamentalData } from "./data/intelligence-types";

// ── Public result types ─────────────────────────────────────────

/** Interpretation states. Only ever derived from actual metrics. */
export type FundamentalState =
  | "improving"
  | "weakening"
  | "mixed"
  | "insufficient";

export type DimensionStatus =
  | "positive" // evidence points to strengthening
  | "negative" // evidence points to weakening
  | "neutral"  // evidence present but directionally balanced/none
  | "unavailable"; // provider did not supply usable evidence

export interface FundamentalDimension {
  name:
    | "revenue-growth"
    | "eps-trend"
    | "profitability"
    | "earnings-quality"
    | "valuation"
    | "balance-sheet"
    | "cash-flow";
  status: DimensionStatus;
  /**
   * Human-readable evidence derived ONLY from provider numbers, e.g.
   * "Revenue rose in 4 of the last 4 quarters (periods 2024-12-31→2024-09-30)".
   * Undefined when unavailable (a limitation line explains instead).
   */
  evidence?: string;
}

export interface FundamentalAssessment {
  /** Whether ANY usable evidence existed at all. */
  available: boolean;
  /** Provider that supplied the evidence (verbatim from FundamentalData). */
  provider: string;
  /** Observation timestamp stamped at provider acquisition (NOT re-dated). */
  observedAt: number;
  /** Latest fiscal period-end present in the evidence, if any ("2025-06-30"). */
  reportingPeriod?: string;
  /**
   * Payload-only freshness: days between the latest fiscal period end and
   * the provider observation stamp. Both come from the evidence itself, so
   * this number is stable for identical evidence. Undefined when either
   * instant is absent (a limitation line says so).
   */
  reportAgeDaysAtObservation?: number;
  /** Quarter-level evidence from `reportingPeriod` to older periods. */
  periodsCount: number;
  /** Interpretation + dimensions. */
  state: FundamentalState;
  /** Evidence-based confidence: number of usable dimensions + agreement. */
  confidence: "high" | "medium" | "low" | "insufficient";
  confidenceEvidence: string;
  dimensions: FundamentalDimension[];
  /** Derived metrics (undefined where not computable — never fabricated). */
  metrics: {
    /** Sequential EPS moves across quarterly history, newest→oldest pairs. */
    epsRises?: number;
    epsFalls?: number;
    /** Sequential revenue moves across quarterly history. */
    revenueRises?: number;
    revenueFalls?: number;
    /** EPS of latest quarter vs 4 quarters back, when both are real numbers. */
    epsYoY?: number;
    /** Revenue of latest quarter vs 4 quarters back, when both are real numbers. */
    revenueYoY?: number;
    /** Provider-reported YoY growth figures when present (as-reported). */
    revenueGrowthReported?: number;
    epsGrowthReported?: number;
    /** Estimate beat/miss across quarters that carry BOTH eps values. */
    estimateBeats?: number;
    estimateMisses?: number;
  };
  /** Explicit missing-data / provenance limitations — always disclosed. */
  limitations: string[];
}

// ── Helpers (pure) ──────────────────────────────────────────────

const DAYS_MS = 86_400_000;
/** Fiscal period ends older than this at observation time are called stale. */
const STALE_PERIOD_DAYS = 210;

function periodEndValid(iso: string | undefined): iso is string {
  return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

/** Sequential move counts across a newest-first series of numbers. */
function countMoves(valuesNewestFirst: number[]): { rises: number; falls: number } {
  let rises = 0;
  let falls = 0;
  for (let i = 0; i < valuesNewestFirst.length - 1; i++) {
    if (valuesNewestFirst[i] > valuesNewestFirst[i + 1]) rises++;
    else if (valuesNewestFirst[i] < valuesNewestFirst[i + 1]) falls++;
  }
  return { rises, falls };
}

// ── Main entry ──────────────────────────────────────────────────

/**
 * Deterministically assess stock fundamentals from provider evidence.
 * There is no clock parameter by design: freshness is measured between
 * instants the payload already carries (fiscal period end vs the
 * acquisition stamp), so identical evidence always yields an identical
 * assessment no matter when the analysis runs.
 */
export function assessFundamentals(
  data: FundamentalData | undefined,
): FundamentalAssessment {
  const provider = data?.provider ?? "none";
  const observedAt = data?.timestamp ?? 0;
  const limitations: string[] = [];

  // ── Unavailable fast path ────────────────────────────────────
  if (!data || !data.available || data.instrumentType !== "stock") {
    return {
      available: false,
      provider,
      observedAt,
      periodsCount: 0,
      state: "insufficient",
      confidence: "insufficient",
      confidenceEvidence: "No real fundamental evidence was supplied.",
      dimensions: [
        { name: "revenue-growth", status: "unavailable" },
        { name: "eps-trend", status: "unavailable" },
        { name: "profitability", status: "unavailable" },
        { name: "earnings-quality", status: "unavailable" },
        { name: "valuation", status: "unavailable" },
        { name: "balance-sheet", status: "unavailable" },
        { name: "cash-flow", status: "unavailable" },
      ],
      metrics: {},
      limitations: [
        data?.unavailableReason ?? "Fundamental evidence unavailable for this instrument.",
        "No assessment produced — absent evidence is never fabricated.",
      ],
    };
  }

  const metrics: FundamentalAssessment["metrics"] = {};
  const dimensions: FundamentalDimension[] = [];

  const hist = data.quarterlyEarningsHistory ?? [];
  const fiscalEnds = hist.map((q) => q.fiscalDateEnding).filter(periodEndValid);
  const reportingPeriod = fiscalEnds.length > 0 ? fiscalEnds[0] : undefined;

  // ── Payload-only freshness (no clock, by construction) ───────
  // The acquisition stamp is the payload's own observation instant
  // (Phase 238 guarantees it is never re-dated). Age is therefore a
  // property of the evidence, not of when the analysis happens to run.
  let reportAgeDaysAtObservation: number | undefined;
  if (reportingPeriod && observedAt > 0) {
    const ageDays = Math.floor(
      (observedAt - Date.parse(reportingPeriod + "T00:00:00Z")) / DAYS_MS,
    );
    reportAgeDaysAtObservation = ageDays;
    if (ageDays > STALE_PERIOD_DAYS) {
      limitations.push(
        `Latest fiscal period ended ${reportingPeriod} — ${ageDays} days before the provider observation (${new Date(observedAt).toISOString()}); stale reporting data, never presented as live market data.`,
      );
    }
  } else if (reportingPeriod && observedAt === 0) {
    limitations.push(
      `Latest fiscal period ended ${reportingPeriod}; no provider observation instant is recorded for this payload, so report age cannot be stated.`,
    );
  }
  if (reportingPeriod) {
    limitations.push(
      `Fundamental figures are reported financial statements for fiscal periods up to ${reportingPeriod} — a reported disclosure, distinct from any live market price.`,
    );
  }

  // ── 1. Revenue growth ────────────────────────────────────────
  {
    const revenueSeries = hist
      .map((q) => q.revenue)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const reported = data.quarterlyRevenueGrowthYoY;
    if (reported !== undefined) metrics.revenueGrowthReported = reported;

    if (revenueSeries.length >= 2) {
      const { rises, falls } = countMoves(revenueSeries);
      metrics.revenueRises = rises;
      metrics.revenueFalls = falls;
      if (revenueSeries.length >= 5 && revenueSeries[4] !== 0) {
        metrics.revenueYoY = revenueSeries[0] / revenueSeries[4] - 1;
      }
      const status: DimensionStatus =
        falls === 0 && rises > 0 ? "positive" : rises === 0 && falls > 0 ? "negative" : "neutral";
      const yoyTxt =
        metrics.revenueYoY !== undefined
          ? `; q/q-4 change ${((metrics.revenueYoY) * 100).toFixed(1)}% (periods ${hist[4]?.fiscalDateEnding ?? "?"}→${hist[0]?.fiscalDateEnding ?? "?"})`
          : "";
      const repTxt =
        reported !== undefined ? `; provider-reported YoY ${(reported * 100).toFixed(1)}%` : "";
      dimensions.push({
        name: "revenue-growth",
        status,
        evidence: `Revenue ${rises > falls ? (falls === 0 ? "rose" : "mostly rose") : rises === falls ? "moved sideways" : "fell"} across ${revenueSeries.length} reported quarters (${rises} up / ${falls} down)${yoyTxt}${repTxt}.`,
      });
    } else if (reported !== undefined) {
      const status: DimensionStatus = reported > 0 ? "positive" : reported < 0 ? "negative" : "neutral";
      dimensions.push({
        name: "revenue-growth",
        status,
        evidence: `Provider-reported quarterly revenue growth YoY: ${(reported * 100).toFixed(1)}% (per-quarter revenue history not supplied — no independent trend).`,
      });
      limitations.push("Per-quarter revenue history not supplied by provider; revenue trend relies on the provider's own YoY figure.");
    } else {
      dimensions.push({ name: "revenue-growth", status: "unavailable" });
      limitations.push("Revenue growth UNAVAILABLE — provider supplied neither per-quarter revenue nor a YoY growth figure.");
    }
  }

  // ── 2. EPS trend ─────────────────────────────────────────────
  {
    const epsSeries = hist
      .map((q) => q.reportedEps)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const reported = data.quarterlyEarningsGrowthYoY;
    if (reported !== undefined) metrics.epsGrowthReported = reported;

    if (epsSeries.length >= 2) {
      const { rises, falls } = countMoves(epsSeries);
      metrics.epsRises = rises;
      metrics.epsFalls = falls;
      if (epsSeries.length >= 5 && epsSeries[4] !== 0) {
        metrics.epsYoY = epsSeries[0] / epsSeries[4] - 1;
      }
      const allPositive = epsSeries.every((e) => e > 0);
      const status: DimensionStatus =
        falls === 0 && rises > 0 ? "positive" : rises === 0 && falls > 0 ? "negative" : "neutral";
      const yoyTxt =
        metrics.epsYoY !== undefined
          ? `; q/q-4 change ${(metrics.epsYoY * 100).toFixed(1)}% (periods ${hist[4]?.fiscalDateEnding ?? "?"}→${hist[0]?.fiscalDateEnding ?? "?"})`
          : "";
      dimensions.push({
        name: "eps-trend",
        status,
        evidence: `EPS ${rises > falls ? (falls === 0 ? "rose" : "mostly rose") : rises === falls ? "moved sideways" : "fell"} across ${epsSeries.length} reported quarters (${rises} up / ${falls} down${allPositive ? ", all positive" : ""})${yoyTxt}.`,
      });
    } else if (data.earningsPerShare !== undefined) {
      const status: DimensionStatus = data.earningsPerShare > 0 ? "positive" : data.earningsPerShare < 0 ? "negative" : "neutral";
      dimensions.push({
        name: "eps-trend",
        status,
        evidence: `TTM EPS $${data.earningsPerShare.toFixed(2)} — single point only; no quarterly history supplied, so no trend can be assessed.`,
      });
      limitations.push("Quarterly EPS history not supplied; EPS trend assessed from the single reported EPS only.");
    } else {
      dimensions.push({ name: "eps-trend", status: "unavailable" });
      limitations.push("EPS trend UNAVAILABLE — provider supplied no EPS values.");
    }
  }

  // ── 3. Profitability (cited as reported — never synthesized) ──
  {
    const m = data.profitMargin;
    const roe = data.returnOnEquity;
    const roa = data.returnOnAssets;
    if (m !== undefined || roe !== undefined || roa !== undefined) {
      let positives = 0;
      let negatives = 0;
      const bits: string[] = [];
      if (m !== undefined) {
        bits.push(`net margin ${(m * 100).toFixed(1)}%`);
        if (m > 0) positives++; else if (m < 0) negatives++;
      }
      if (roe !== undefined) {
        bits.push(`ROE ${(roe * 100).toFixed(1)}%`);
        if (roe > 0) positives++; else if (roe < 0) negatives++;
      }
      if (roa !== undefined) {
        bits.push(`ROA ${(roa * 100).toFixed(1)}%`);
        if (roa > 0) positives++; else if (roa < 0) negatives++;
      }
      // Levels are scored by sign only (real reported evidence). Whether
      // profitability is IMPROVING would require a series, which this
      // provider does not supply — that limitation is disclosed.
      const status: DimensionStatus =
        negatives > 0 && positives === 0
          ? "negative"
          : positives > 0 && negatives > 0
            ? "neutral"
            : positives > 0
              ? "positive"
              : "neutral";
      limitations.push("Profitability metrics are reported TTM levels (single period) — level evidence only, not a trend across periods.");
      dimensions.push({
        name: "profitability",
        status,
        evidence: `Reported: ${bits.join(", ")}.`,
      });
    } else {
      dimensions.push({ name: "profitability", status: "unavailable" });
      limitations.push("Profitability metrics (margin / ROE / ROA) UNAVAILABLE — not in provider response.");
    }
  }

  // ── 4. Earnings quality (estimate beat/miss consistency) ─────
  {
    const both = hist.filter(
      (q) => typeof q.reportedEps === "number" && typeof q.estimatedEps === "number",
    );
    if (both.length >= 2) {
      const beats = both.filter((q) => (q.reportedEps as number) > (q.estimatedEps as number)).length;
      const misses = both.filter((q) => (q.reportedEps as number) < (q.estimatedEps as number)).length;
      metrics.estimateBeats = beats;
      metrics.estimateMisses = misses;
      const status: DimensionStatus =
        misses === 0 && beats > 0 ? "positive" : beats === 0 && misses > 0 ? "negative" : "neutral";
      dimensions.push({
        name: "earnings-quality",
        status,
        evidence: `Beat estimate in ${beats} of ${both.length} reported quarters${misses ? `, missed ${misses}` : ""} (periods ${both[both.length - 1]?.fiscalDateEnding ?? "?"}→${both[0]?.fiscalDateEnding ?? "?"}).`,
      });
    } else {
      dimensions.push({ name: "earnings-quality", status: "unavailable" });
      limitations.push("Earnings quality UNAVAILABLE — fewer than 2 quarters carry both reported and estimated EPS; consistency cannot be assessed.");
    }
  }

  // ── 5. Valuation context (growth-vs-valuation from REAL growth) ─
  {
    const pe = data.peRatio;
    const fpe = data.forwardPe;
    const bits: string[] = [];
    if (pe !== undefined) bits.push(`P/E ${pe.toFixed(1)}`);
    if (fpe !== undefined) bits.push(`forward P/E ${fpe.toFixed(1)}`);
    if (data.priceToBook !== undefined) bits.push(`P/B ${data.priceToBook.toFixed(2)}`);
    if (data.priceToSales !== undefined) bits.push(`P/S ${data.priceToSales.toFixed(2)}`);
    if (data.evToEbitda !== undefined) bits.push(`EV/EBITDA ${data.evToEbitda.toFixed(1)}`);
    if (data.priceToBook === undefined && data.priceToSales === undefined && data.evToEbitda === undefined) {
      limitations.push("Valuation multiples beyond P/E UNAVAILABLE (no P/B, P/S, EV ratios supplied).");
    }

    if (pe !== undefined && metrics.epsYoY !== undefined && metrics.epsYoY > 0) {
      // Growth-vs-valuation context from REAL derived growth: cheap only
      // when the measured earnings growth keeps pace with the multiple.
      const growthPct = metrics.epsYoY * 100;
      const ratio = pe / growthPct;
      dimensions.push({
        name: "valuation",
        status: ratio < 1 ? "positive" : ratio > 2.5 ? "negative" : "neutral",
        evidence: `${bits.join(", ")}; implied growth-vs-valuation: P/E ${pe.toFixed(1)} vs measured q/q-4 EPS growth ${growthPct.toFixed(1)}% (ratio ${ratio.toFixed(2)} — derived entirely from reported evidence).`,
      });
    } else if (bits.length > 0) {
      dimensions.push({
        name: "valuation",
        status: "neutral",
        evidence: `${bits.join(", ")} — reported multiples only; no measured earnings growth available for growth-vs-valuation context, so multiples are not interpreted directionally.`,
      });
    } else {
      dimensions.push({ name: "valuation", status: "unavailable" });
      limitations.push("Valuation UNAVAILABLE — no multiples supplied by the provider.");
    }
  }

  // ── 6. Balance sheet — NOT AVAILABLE from OVERVIEW+EARNINGS ──
  {
    dimensions.push({ name: "balance-sheet", status: "unavailable" });
    limitations.push(
      "Balance-sheet quality (debt / leverage / liquidity) UNAVAILABLE — the integrated fundamental provider exposes no balance-sheet line items; this dimension is never fabricated.",
    );
  }

  // ── 7. Cash flow — NOT AVAILABLE ─────────────────────────────
  {
    dimensions.push({ name: "cash-flow", status: "unavailable" });
    limitations.push(
      "Free cash flow UNAVAILABLE — the integrated fundamental provider exposes no cash-flow line items; this dimension is never fabricated.",
    );
  }

  // ── Aggregate state + evidence-based confidence ──────────────
  const usable = dimensions.filter((d) => d.status !== "unavailable");
  const positives = usable.filter((d) => d.status === "positive").length;
  const negatives = usable.filter((d) => d.status === "negative").length;

  let state: FundamentalState;
  if (usable.length === 0) {
    state = "insufficient";
  } else if (positives > 0 && negatives === 0 && positives >= negatives + 1 && positives * 2 > usable.length) {
    state = "improving";
  } else if (negatives > 0 && positives === 0 && negatives * 2 > usable.length) {
    state = "weakening";
  } else if (positives > 0 && negatives > 0) {
    state = "mixed";
  } else {
    state = "mixed"; // all-neutral evidence cannot justify a direction
  }

  // Confidence is a LEVEL derived from how much evidence exists, then CAPPED
  // by (a) disagreement between dimensions and (b) staleness of the
  // reporting period measured inside the payload itself. No arbitrary
  // certainty: every cap is disclosed in `confidenceEvidence`.
  const LEVELS = ["low", "medium", "high"] as const;
  const caps: string[] = [];
  let level: number;
  if (usable.length >= 5) level = 2;
  else if (usable.length >= 3) level = 1;
  else level = 0;

  if (usable.length > 0 && positives > 0 && negatives > 0) {
    level = Math.min(level, 1);
    caps.push("conflicting dimension evidence caps confidence at medium");
  }
  if (reportAgeDaysAtObservation !== undefined && reportAgeDaysAtObservation > STALE_PERIOD_DAYS) {
    level = Math.min(level, 1);
    caps.push(
      `stale reporting period (${reportAgeDaysAtObservation} days between period end and observation) caps confidence at medium`,
    );
  }
  if (reportAgeDaysAtObservation !== undefined && reportAgeDaysAtObservation > 400) {
    level = Math.min(level, 0);
    caps.push(`very old reporting period (${reportAgeDaysAtObservation} days) caps confidence at low`);
  }

  const confidence: FundamentalAssessment["confidence"] =
    usable.length === 0 ? "insufficient" : LEVELS[level];

  const directionTxt = usable.length === 0
    ? "no usable dimensions"
    : `${positives} strengthening / ${negatives} weakening of ${usable.length} usable dimensions`;

  limitations.push(
    "Assessment covers only dimensions the provider actually supplies; unavailable dimensions are disclosed, never estimated.",
  );

  return {
    available: true,
    provider,
    observedAt,
    reportingPeriod,
    reportAgeDaysAtObservation,
    periodsCount: fiscalEnds.length,
    state,
    confidence,
    confidenceEvidence:
      usable.length === 0
        ? "No usable fundamental dimensions — insufficient evidence, no confidence."
        : `Confidence from ${usable.length} usable dimensions (${directionTxt}), ${fiscalEnds.length} fiscal periods of history${reportingPeriod ? `, latest period ${reportingPeriod}` : ""}${caps.length > 0 ? ` — ${caps.join("; ")}` : ""}.`,
    dimensions,
    metrics,
    limitations,
  };
}
