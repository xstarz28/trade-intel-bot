/**
 * Phase 279 — Deterministic fundamental engine (shared framework + dispatch).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Phase 276 replaced "compare three raw numbers to static thresholds" with a
 * deterministic calculator over the Alpha Vantage equity payload. Phase 279
 * generalises it: the SAME contract, the SAME state/confidence framework and
 * the SAME analysis pipeline now serve all three core domains, because stock
 * fundamentals are NOT universal fundamentals:
 *
 *   instrumentType "stock"  → equity adapter  (revenue/EPS/margins/valuation)
 *   instrumentType "crypto" → crypto adapter  (supply, unlocks, TVL/fees,
 *                             derivatived positioning as context only)
 *   instrumentType "forex"  → forex adapter   (two-sided macro: policy,
 *                             inflation, labour, growth, yields, positioning)
 *
 *   instrumentType "commodity" → commodity adapter (EIA petroleum stocks,
 *                             CFTC futures positioning, Treasury curve — each
 *                             reported as information the engine already scores)
 *
 * The domain adapters live in `lib/fundamental/{crypto,forex,commodity}.ts`; the equity
 * adapter (the Phase 276 body, deepened with the remaining as-reported OVERVIEW
 * fields) lives below. The shared deterministic machinery — dimensions → state,
 * evidence-coverage confidence, staleness caps — lives in
 * `lib/fundamental/framework.ts` and is used by every domain.
 *
 * INTEGRITY RULES (unchanged since Phase 276, extended in Phase 279)
 * -----------------------------------------------------------------
 *   1. Every number in the output is traced from provider-supplied evidence.
 *      No defaults, no sector averages, no synthetic peers.
 *   2. Fiscal/reporting/measurement period and provider identity are preserved
 *      on every derived series and on every evidence item.
 *   3. The local clock is NEVER read — neither as an observation/report
 *      timestamp nor as a classification input. Every time comparison uses
 *      instants the evidence already carries, so identical evidence yields a
 *      byte-identical assessment regardless of when it is computed.
 *   4. Missing metric → the dimension is UNAVAILABLE with a limitation line; it
 *      never becomes a neutral value, never a zero, and never blocks the rest.
 *   5. Evidence another engine layer already scores is reported as traceable
 *      context but marked `informational`, so one provider field can never be
 *      counted twice.
 *   6. A domain card never shows another domain's metrics: crypto has no EPS
 *      or P/E, forex has no revenue or profit, equities have no supply/TVL and
 *      commodities have no EPS/P/E/revenue at all.
 */

import type { FundamentalData, MacroData } from "./data/intelligence-types";
import type { CryptoIntelligenceContext } from "./data/crypto/types";
import type { CryptoDerivativesData } from "./data/derivatives-types";
import type { EconomicCalendarData } from "./data/calendar-types";
import type { TreasuryData } from "./data/treasury";
import type { CotData } from "./data/cot";
import type { EiaData } from "./data/eia";
import type {
  DimensionStatus,
  FundamentalAssessment,
  FundamentalDimension,
  FundamentalDirection,
  FundamentalEvidenceItem,
} from "./data/fundamental-contract";
import {
  aggregateConfidence,
  STALE_PERIOD_DAYS,
  countMoves,
  coverageOf,
  daysBetween,
  percentChange,
  periodEndValid,
  unassessedDomain,
} from "./fundamental/framework";
import { assessCryptoFundamentals, CRYPTO_PARAMETERS } from "./fundamental/crypto";
import { assessForexFundamentals } from "./fundamental/forex";
import { assessCommodityFundamentals, type CommodityFuturesCurve } from "./fundamental/commodity";

// Phase 276 public names stay importable from this module (unified-intelligence
// and the UI import them here), so the contract types are re-exported verbatim.
export type { FundamentalAssessment, FundamentalState, DimensionStatus } from "./data/fundamental-contract";
export type { FundamentalDimension, FundamentalEvidenceItem } from "./data/fundamental-contract";

/**
 * Phase 279 — the domain evidence available to the engine besides the raw
 * `FundamentalData` payload. One context, fed by the live pipeline, from which
 * each domain adapter reads only what belongs to its own asset class.
 *
 * The commodity route reads exactly three provider contexts — the U.S. EIA
 * petroleum stock series, the CFTC COT reports and the US Treasury curve — and
 * nothing else; every other commodity evidence category is reported
 * unavailable rather than inferred.
 */
export interface FundamentalDomainContext {
  instrument: string;
  instrumentType: "forex" | "crypto" | "stock" | "commodity" | "indices";
  /** Routing provider identity (discovery), verbatim. */
  provider?: string;
  /** Exact provider/native instrument id, verbatim. */
  providerInstrumentId?: string;
  // ── crypto evidence ──
  crypto?: CryptoIntelligenceContext;
  derivatives?: CryptoDerivativesData;
  /** REAL market price — used only for the DERIVED market-cap context. */
  price?: number;
  priceObservedAt?: number;
  priceProvider?: string;
  // ── forex evidence ──
  calendar?: EconomicCalendarData;
  // ── forex + commodity evidence (the Treasury curve drives both) ──
  treasury?: TreasuryData;
  cot?: CotData;
  // ── commodity evidence (petroleum inventories; absent otherwise) ──
  eia?: EiaData;
  /**
   * Phase 280 — a REAL multi-expiry futures curve, when a provider supplies
   * one. No configured provider does today; the slot exists so wiring one is a
   * data change, never a re-derivation inside the domain adapter.
   */
  commodityCurve?: CommodityFuturesCurve;
  macro?: MacroData;
}

// The shared helpers (period validation, sequential-move counts, calendar
// arithmetic) now live in ./fundamental/framework so every domain uses exactly
// the same definitions.

// ── Main entry ──────────────────────────────────────────────────

/**
 * Deterministically assess EQUITY fundamentals from provider evidence.
 * There is no clock parameter by design: freshness is measured between
 * instants the payload already carries (fiscal period end vs the
 * acquisition stamp), so identical evidence always yields an identical
 * assessment no matter when the analysis runs.
 */
function assessEquityFundamentals(
  data: FundamentalData | undefined,
): FundamentalAssessment {
  const provider = data?.provider ?? "none";
  const observedAt = data?.timestamp ?? 0;
  const instrumentId = data?.providerInstrumentId ?? data?.symbol;
  const limitations: string[] = [];

  // ── Unavailable fast path ────────────────────────────────────
  if (!data || !data.available || data.instrumentType !== "stock") {
    const emptyDimensions: FundamentalDimension[] = [
      { name: "revenue-growth", status: "unavailable" },
      { name: "eps-trend", status: "unavailable" },
      { name: "profitability", status: "unavailable" },
      { name: "earnings-quality", status: "unavailable" },
      { name: "valuation", status: "unavailable" },
      { name: "balance-sheet", status: "unavailable" },
      { name: "cash-flow", status: "unavailable" },
    ];
    return {
      available: false,
      domain: "equity",
      provider,
      instrumentId,
      observedAt,
      periodsCount: 0,
      state: "insufficient",
      confidence: "insufficient",
      confidenceEvidence: "No real fundamental evidence was supplied.",
      directionalBias: "none",
      dimensions: emptyDimensions,
      contradictions: [],
      unavailableDimensions: emptyDimensions.map((d) => d.name),
      evidenceCoverage: coverageOf(emptyDimensions, [provider]),
      evidence: [],
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
    const ageDays = daysBetween(reportingPeriod, observedAt) ?? 0;
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

  // ═══════════════════════════════════════════════════════════════
  // Phase 279 — equity depth from the SAME as-reported payload.
  // Only provider-supplied fields are used; every addition below is
  // appended to an EXISTING dimension, so the Phase 276 dimension set,
  // its statuses and its confidence counts are unchanged.
  // ═══════════════════════════════════════════════════════════════
  const extraEvidence: FundamentalEvidenceItem[] = [];
  const contradictions: string[] = [];
  const nativeEquityId = data.providerInstrumentId ?? data.symbol;

  const appendTo = (name: FundamentalDimension["name"], suffix: string) => {
    const target = dimensions.find((d) => d.name === name);
    if (target?.evidence) target.evidence = target.evidence + suffix;
  };

  // ── Profitability depth: operating margin and revenue per share ──
  {
    const bits: string[] = [];
    if (data.operatingMargin !== undefined) {
      bits.push(`operating margin ${(data.operatingMargin * 100).toFixed(1)}%`);
      extraEvidence.push({
        metric: "operating_margin",
        label: "Operating margin",
        value: data.operatingMargin,
        unit: "fraction",
        provider: data.provider,
        providerInstrumentId: nativeEquityId,
        source: "OVERVIEW (OperatingMarginTTM)",
        observedAt: data.timestamp,
        period: reportingPeriod ?? "TTM as reported",
      });
    }
    if (data.revenuePerShare !== undefined) {
      bits.push(`revenue per share $${data.revenuePerShare.toFixed(2)}`);
      extraEvidence.push({
        metric: "revenue_per_share",
        label: "Revenue per share (TTM)",
        value: data.revenuePerShare,
        unit: "USD",
        provider: data.provider,
        providerInstrumentId: nativeEquityId,
        source: "OVERVIEW (RevenuePerShareTTM)",
        observedAt: data.timestamp,
        period: "TTM as reported",
      });
    }
    if (bits.length > 0) appendTo("profitability", ` Reported operating evidence: ${bits.join(", ")}.`);
  }

  // ── Earnings-quality depth: the latest quarter's own surprise ──
  {
    const latestPair = hist.find(
      (q) => typeof q.reportedEps === "number" && typeof q.estimatedEps === "number" && q.estimatedEps !== 0,
    );
    if (latestPair) {
      const surprisePercent =
        ((latestPair.reportedEps as number) - (latestPair.estimatedEps as number)) /
        Math.abs(latestPair.estimatedEps as number) * 100;
      metrics.latestEpsSurprisePercent = surprisePercent;
      appendTo(
        "earnings-quality",
        ` Latest reported quarter (${latestPair.fiscalDateEnding ?? "period not supplied"}) ${surprisePercent >= 0 ? "beat" : "missed"} its own consensus by ${Math.abs(surprisePercent).toFixed(1)}% (reported ${(latestPair.reportedEps as number).toFixed(2)} vs estimated ${(latestPair.estimatedEps as number).toFixed(2)}).`,
      );
      extraEvidence.push({
        metric: "latest_eps_surprise",
        label: "Latest reported EPS surprise",
        value: surprisePercent,
        unit: "%",
        provider: data.provider,
        providerInstrumentId: nativeEquityId,
        source: "EARNINGS (reportedEPS vs estimatedEPS)",
        observedAt: data.timestamp,
        period: latestPair.fiscalDateEnding,
      });
    }
  }

  // ── Trend depth: annual-vs-annual EPS and growth acceleration ──
  {
    const annual = (data.annualEarningsHistory ?? []).filter(
      (a) => typeof a.reportedEps === "number" && Number.isFinite(a.reportedEps),
    );
    if (annual.length >= 2) {
      const change = percentChange(annual[0].reportedEps, annual[1].reportedEps);
      if (change !== undefined) {
        metrics.annualEpsYoY = change;
        appendTo(
          "eps-trend",
          ` Annual reported EPS ${annual[0].fiscalDateEnding ?? "?"} $${(annual[0].reportedEps as number).toFixed(2)} vs ${annual[1].fiscalDateEnding ?? "?"} $${(annual[1].reportedEps as number).toFixed(2)} (${change >= 0 ? "+" : ""}${change.toFixed(1)}%).`,
        );
        extraEvidence.push({
          metric: "annual_eps_change",
          label: "Annual reported EPS change",
          value: change,
          unit: "%",
          provider: data.provider,
          providerInstrumentId: nativeEquityId,
          source: "EARNINGS (annualEarnings)",
          observedAt: data.timestamp,
          period: `${annual[1].fiscalDateEnding}→${annual[0].fiscalDateEnding}`,
          derived: true,
          basis: `annual reported EPS ${annual[0].fiscalDateEnding} ÷ ${annual[1].fiscalDateEnding} − 1`,
        });
      }
    }

    const revenueSeries = hist
      .map((q) => q.revenue)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (revenueSeries.length >= 6 && revenueSeries[4] !== 0 && revenueSeries[5] !== 0) {
      const latestYoY = revenueSeries[0] / revenueSeries[4] - 1;
      const priorYoY = revenueSeries[1] / revenueSeries[5] - 1;
      metrics.revenueYoYAcceleration = (latestYoY - priorYoY) * 100;
      appendTo(
        "revenue-growth",
        ` Growth ${metrics.revenueYoYAcceleration >= 0 ? "accelerating" : "decelerating"}: latest q/q-4 ${(latestYoY * 100).toFixed(1)}% vs the prior quarter's ${(priorYoY * 100).toFixed(1)}% (periods ${hist[5]?.fiscalDateEnding ?? "?"}→${hist[0]?.fiscalDateEnding ?? "?"}).`,
      );
    }
    const epsSeriesAll = hist
      .map((q) => q.reportedEps)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (epsSeriesAll.length >= 6 && epsSeriesAll[4] !== 0 && epsSeriesAll[5] !== 0) {
      const latestYoY = epsSeriesAll[0] / epsSeriesAll[4] - 1;
      const priorYoY = epsSeriesAll[1] / epsSeriesAll[5] - 1;
      metrics.epsYoYAcceleration = (latestYoY - priorYoY) * 100;
      appendTo(
        "eps-trend",
        ` Earnings ${metrics.epsYoYAcceleration >= 0 ? "accelerating" : "decelerating"}: latest q/q-4 ${(latestYoY * 100).toFixed(1)}% vs the prior quarter's ${(priorYoY * 100).toFixed(1)}%.`,
      );
    }
  }

  // ── Valuation depth: the remaining as-reported multiples ───────
  {
    const bits: string[] = [];
    const pushReported = (
      metric: string,
      label: string,
      value: number | undefined,
      unit: string,
      format: (v: number) => string,
    ) => {
      if (value === undefined || !Number.isFinite(value)) return;
      bits.push(`${label} ${format(value)}`);
      extraEvidence.push({
        metric,
        label,
        value,
        unit,
        provider: data.provider,
        providerInstrumentId: nativeEquityId,
        source: "OVERVIEW (as reported)",
        observedAt: data.timestamp,
        period: "latest reported TTM/level",
      });
    };
    pushReported("peg_ratio", "PEG", data.pegRatio, "ratio", (v) => v.toFixed(2));
    if (data.pegRatio !== undefined) metrics.pegReported = data.pegRatio;
    pushReported("price_to_book", "P/B", data.priceToBook, "ratio", (v) => v.toFixed(2));
    pushReported("price_to_sales", "P/S", data.priceToSales, "ratio", (v) => v.toFixed(2));
    pushReported("ev_to_revenue", "EV/Revenue", data.evToRevenue, "ratio", (v) => v.toFixed(2));
    pushReported("ev_to_ebitda", "EV/EBITDA", data.evToEbitda, "ratio", (v) => v.toFixed(2));
    if (data.dividendYield !== undefined) {
      metrics.dividendYield = data.dividendYield;
      pushReported("dividend_yield", "dividend yield", data.dividendYield, "fraction", (v) => `${(v * 100).toFixed(2)}%`);
    }
    if (data.marketCap !== undefined) {
      metrics.marketCapReported = data.marketCap;
      bits.push(`market cap $${(data.marketCap / 1e9).toFixed(1)}B`);
      extraEvidence.push({
        metric: "market_cap",
        label: "Market capitalisation",
        value: data.marketCap,
        unit: "USD",
        provider: data.provider,
        providerInstrumentId: nativeEquityId,
        source: "OVERVIEW (MarketCapitalization)",
        observedAt: data.timestamp,
        period: "as reported at the provider observation",
      });
    }
    if (bits.length > 0) appendTo("valuation", ` Additional as-reported valuation evidence: ${bits.join(", ")}.`);

    if (bits.length === 0) {
      limitations.push(
        "Additional multiples (PEG, P/B, P/S, EV/Revenue, EV/EBITDA, dividend yield, market cap) UNAVAILABLE — none were supplied in this payload.",
      );
    }
    limitations.push(
      "Peer/sector-relative valuation UNAVAILABLE — no peer or sector benchmark data exists in this repository, so no relative multiple is computed or implied. The supplied sector/industry labels are descriptive only.",
    );
    limitations.push(
      "Historical valuation context (multiple ranges, percentiles or a multi-year band) UNAVAILABLE — the provider payload carries point-in-time levels only, and no historical multiple series exists to compare against.",
    );
  }

  // ── Growth vs valuation: the four documented combinations ──────
  {
    const pe = data.peRatio;
    const growth = metrics.epsYoY;
    const growthPct = growth !== undefined ? growth * 100 : undefined;
    if (pe !== undefined && growthPct !== undefined) {
      const ratio = growthPct > 0 ? pe / growthPct : undefined;
      if (growthPct > 0 && ratio !== undefined && ratio > 2.5) {
        contradictions.push(
          `Measured earnings growth (${growthPct.toFixed(1)}% q/q-4) does not keep pace with the reported P/E ${pe.toFixed(1)} (ratio ${ratio.toFixed(2)} > 2.5) — high growth, stretched valuation.`,
        );
      }
      if (growthPct > 0 && ratio !== undefined && ratio <= 1) {
        contradictions.push("");
        contradictions.pop();
        appendTo(
          "valuation",
          " Growth is positive and the reported multiple is supported by the measured growth rate (documented ratio ≤ 1).",
        );
      }
      if (growthPct < 0) {
        contradictions.push(
          `Reported earnings are shrinking (${growthPct.toFixed(1)}% q/q-4) while a valuation multiple of ${pe.toFixed(1)} is still reported — the multiple is not supported by growth and the apparent level is not a "cheap" reading on its own.`,
        );
      }
    }
    if (metrics.revenueYoY !== undefined && metrics.revenueYoY > 0 && data.profitMargin !== undefined && data.profitMargin < 0) {
      contradictions.push(
        `Revenue is still growing (${(metrics.revenueYoY * 100).toFixed(1)}% q/q-4) while the reported net margin is negative (${(data.profitMargin * 100).toFixed(1)}%) — growth with deteriorating profitability.`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Aggregate state + evidence-based confidence (shared framework)
  // ═══════════════════════════════════════════════════════════════
  limitations.push(
    "Assessment covers only dimensions the provider actually supplies; unavailable dimensions are disclosed, never estimated.",
  );

  const { state, confidence, confidenceEvidence } = aggregateConfidence({
    dimensions,
    periodsCount: fiscalEnds.length,
    periodsLabel: "fiscal periods",
    reportingPeriod,
    staleDays: reportAgeDaysAtObservation,
  });

  const directionalBias: FundamentalDirection =
    state === "improving" ? "bullish" : state === "weakening" ? "bearish" : "none";
  const directionEvidence =
    directionalBias === "none"
      ? `No directional fundamental read: the engine's state is ${state.toUpperCase()} — a direction is never forced from non-directional evidence.`
      : `Reported fundamentals are ${state.toUpperCase()} across the engine's scored dimensions: ${dimensions
          .filter((d) => d.status !== "unavailable")
          .map((d) => d.name)
          .join(", ")}.`;

  const allLimitations = [
    ...limitations,
    "Balance-sheet line items (cash, debt, net debt, leverage, interest coverage, current ratio) are NOT supplied by the configured provider endpoints, so balance-sheet quality is unavailable rather than derived from ratios.",
    "Free cash flow, FCF margin, ROIC, cash conversion and share-count/stock-based-compensation data are NOT supplied by the configured provider endpoints, so those dimensions are unavailable rather than estimated.",
    "Trailing/forward multiples above are as-reported point-in-time values; they are never combined with peer data (none exists) and never presented as live market prices.",
  ];

  return {
    available: true,
    domain: "equity",
    provider,
    instrumentId,
    observedAt,
    reportingPeriod,
    reportAgeDaysAtObservation,
    periodsCount: fiscalEnds.length,
    state,
    confidence,
    confidenceEvidence,
    directionalBias,
    directionalBiasEvidence: directionEvidence,
    dimensions,
    contradictions,
    unavailableDimensions: dimensions.filter((d) => d.status === "unavailable").map((d) => d.name),
    evidenceCoverage: coverageOf(dimensions, [provider]),
    evidence: extraEvidence,
    metrics,
    limitations: allLimitations,
  };
}

// ── Phase 279 dispatcher ────────────────────────────────────────

/**
 * Assess fundamentals for ANY instrument in the shared contract.
 *
 * The DOMAIN is taken from the analysis routing (`instrumentType`), never from
 * the shape of the ticker: a stock ticker is not turned into a token and a
 * token is not turned into a company. A domain whose evidence is absent returns
 * the explicit unavailable state — never another domain's metrics.
 */
export function assessFundamentals(
  data: FundamentalData | undefined,
  context?: FundamentalDomainContext,
): FundamentalAssessment {
  const instrumentType = context?.instrumentType ?? data?.instrumentType;

  if (instrumentType === "crypto") {
    return assessCryptoFundamentals({
      instrument: context?.instrument ?? data?.providerInstrumentId ?? data?.symbol ?? "",
      provider: context?.provider ?? data?.provider,
      providerInstrumentId: context?.providerInstrumentId ?? data?.providerInstrumentId ?? data?.symbol,
      crypto: context?.crypto,
      derivatives: context?.derivatives,
      price: context?.price,
      priceObservedAt: context?.priceObservedAt,
      priceProvider: context?.priceProvider,
    });
  }

  if (instrumentType === "forex") {
    return assessForexFundamentals({
      instrument: context?.instrument ?? data?.symbol ?? "",
      provider: context?.provider ?? data?.provider,
      providerInstrumentId: context?.providerInstrumentId ?? data?.providerInstrumentId ?? data?.symbol,
      calendar: context?.calendar,
      treasury: context?.treasury,
      cot: context?.cot,
    });
  }

  if (instrumentType === "commodity") {
    return assessCommodityFundamentals({
      instrument: context?.instrument ?? data?.symbol ?? "",
      provider: context?.provider ?? data?.provider,
      providerInstrumentId: context?.providerInstrumentId ?? data?.providerInstrumentId ?? data?.symbol,
      eia: context?.eia,
      cot: context?.cot,
      treasury: context?.treasury,
      futuresCurve: context?.commodityCurve,
    });
  }

  if (instrumentType === "stock" || instrumentType === undefined) {
    return assessEquityFundamentals(data);
  }

  // A routing domain this framework does not assess (for example `indices`):
  // explicit unavailable with the named domain — never another domain's metrics.
  return unassessedDomain(
    String(instrumentType),
    context?.provider ?? data?.provider ?? "",
    context?.providerInstrumentId ?? data?.providerInstrumentId ?? data?.symbol,
  );
}

/**
 * Convenience re-exports for consumers that need the domain parameter sets
 * (tests / UI footnotes). Importing them here keeps a single source of truth.
 */
export { CRYPTO_PARAMETERS };
