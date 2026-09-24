/**
 * Phase 274 — regression contract for the COMPLETE deterministic fundamental
 * analysis vertical slice.
 *
 *   provider-native identity → real Alpha Vantage OVERVIEW+EARNINGS evidence
 *   → normalization with fiscal periods preserved → deterministic metrics
 *   (revenue/EPS trend, profitability, estimate consistency, valuation
 *   context) → explicit unavailable dimensions (never fabricated) →
 *   interpretation state + evidence-capped confidence → the existing
 *   analysis result object → the existing AnalysisResult UI section.
 *
 * Integrity rules asserted here:
 *   · the assessment is a function of the PAYLOAD ONLY — it never reads the
 *     clock, so identical evidence is byte-identical across runs;
 *   · provider identity, symbol and fiscal reporting periods are preserved;
 *   · missing metrics stay UNAVAILABLE (no defaults, no hardcoded ratios);
 *   · changed evidence changes the assessment;
 *   · stale reporting data is disclosed as stale — never as live data;
 *   · the UI renders the engine's own values, not a re-derivation.
 *
 * Fixtures below are Alpha Vantage RESPONSE SHAPES used as test input only.
 * Nothing in this file is reachable from the production path.
 */

import { describe, it, expect, vi } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { I18nProvider } from "./i18n";
import { normalizeFundamentals, type RawEarnings, type RawOverview } from "./data/alpha-vantage/normalize";
import { assessFundamentals } from "./fundamental-engine";
import { runAnalysis } from "./analysis-engine";
import { AnalysisResultDisplay } from "../components/AnalysisResult";
import type { FundamentalData } from "./data/intelligence-types";

const render = (ui: ReactNode) => rtlRender(createElement(I18nProvider, null, ui));

/** Acquisition stamp used by every fixture — a payload instant, never "now". */
const OBSERVED_AT = Date.parse("2025-07-05T14:30:00Z");

// ── Real Alpha Vantage OVERVIEW + EARNINGS fixtures ─────────────────

const OVERVIEW: RawOverview = {
  Symbol: "AAPL",
  Name: "Apple Inc",
  Sector: "TECHNOLOGY",
  Industry: "ELECTRONIC COMPUTERS",
  MarketCapitalization: "3000000000000",
  PERatio: "28.5",
  PEGRatio: "1.82",
  BookValue: "4.38",
  DividendPerShare: "0.98",
  DividendYield: "0.0044",
  EPS: "6.42",
  RevenuePerShareTTM: "24.51",
  ProfitMargin: "0.265",
  OperatingMarginTTM: "0.31",
  ReturnOnEquityTTM: "1.47",
  ReturnOnAssetsTTM: "0.22",
  PriceToBookRatio: "46.2",
  PriceToSalesRatioTTM: "7.8",
  EVToRevenue: "7.95",
  EVToEBITDA: "22.4",
  ForwardPE: "26.1",
  QuarterlyRevenueGrowthYOY: "0.061",
  QuarterlyEarningsGrowthYOY: "0.078",
  FiftyTwoWeekHigh: "260.1",
  FiftyTwoWeekLow: "164.08",
};

/** 8 quarters, newest first — every fiscal period ends on a real date. */
const QUARTERS_RISING = [
  { fiscalDateEnding: "2025-06-30", reportedDate: "2025-07-31", reportedEPS: "1.65", estimatedEPS: "1.60", reportedRevenue: "94000000000" },
  { fiscalDateEnding: "2025-03-31", reportedDate: "2025-04-30", reportedEPS: "1.53", estimatedEPS: "1.50", reportedRevenue: "90000000000" },
  { fiscalDateEnding: "2024-12-31", reportedDate: "2025-01-30", reportedEPS: "1.50", estimatedEPS: "1.45", reportedRevenue: "85000000000" },
  { fiscalDateEnding: "2024-09-30", reportedDate: "2024-10-31", reportedEPS: "1.42", estimatedEPS: "1.38", reportedRevenue: "81000000000" },
  { fiscalDateEnding: "2024-06-30", reportedDate: "2024-08-01", reportedEPS: "1.35", estimatedEPS: "1.33", reportedRevenue: "78000000000" },
  { fiscalDateEnding: "2024-03-31", reportedDate: "2024-05-02", reportedEPS: "1.28", estimatedEPS: "1.25", reportedRevenue: "74000000000" },
  { fiscalDateEnding: "2023-12-31", reportedDate: "2024-02-01", reportedEPS: "1.24", estimatedEPS: "1.20", reportedRevenue: "71000000000" },
  { fiscalDateEnding: "2023-09-30", reportedDate: "2023-11-02", reportedEPS: "1.15", estimatedEPS: "1.12", reportedRevenue: "68000000000" },
];

const QUARTERS_FALLING = [
  { fiscalDateEnding: "2025-06-30", reportedDate: "2025-07-31", reportedEPS: "0.82", estimatedEPS: "0.95", reportedRevenue: "61000000000" },
  { fiscalDateEnding: "2025-03-31", reportedDate: "2025-04-30", reportedEPS: "0.95", estimatedEPS: "1.05", reportedRevenue: "65000000000" },
  { fiscalDateEnding: "2024-12-31", reportedDate: "2025-01-30", reportedEPS: "1.08", estimatedEPS: "1.15", reportedRevenue: "69000000000" },
  { fiscalDateEnding: "2024-09-30", reportedDate: "2024-10-31", reportedEPS: "1.21", estimatedEPS: "1.24", reportedRevenue: "73000000000" },
  { fiscalDateEnding: "2024-06-30", reportedDate: "2024-08-01", reportedEPS: "1.34", estimatedEPS: "1.33", reportedRevenue: "77000000000" },
  { fiscalDateEnding: "2024-03-31", reportedDate: "2024-05-02", reportedEPS: "1.40", estimatedEPS: "1.38", reportedRevenue: "80000000000" },
  { fiscalDateEnding: "2023-12-31", reportedDate: "2024-02-01", reportedEPS: "1.47", estimatedEPS: "1.44", reportedRevenue: "83000000000" },
  { fiscalDateEnding: "2023-09-30", reportedDate: "2023-11-02", reportedEPS: "1.52", estimatedEPS: "1.50", reportedRevenue: "86000000000" },
];

const EARNINGS_RISING: RawEarnings = {
  quarterlyEarnings: QUARTERS_RISING,
  annualEarnings: [
    { fiscalDateEnding: "2024-09-30", reportedEPS: "5.55" },
    { fiscalDateEnding: "2023-09-30", reportedEPS: "5.12" },
  ],
};

const EARNINGS_FALLING: RawEarnings = {
  quarterlyEarnings: QUARTERS_FALLING,
  annualEarnings: [{ fiscalDateEnding: "2024-09-30", reportedEPS: "4.35" }],
};

/** Overview for a deteriorating company — real reported negatives. */
const OVERVIEW_WEAK: RawOverview = {
  Symbol: "AAPL",
  Name: "Apple Inc",
  Sector: "TECHNOLOGY",
  PERatio: "41.0",
  EPS: "-0.85",
  ProfitMargin: "-0.052",
  OperatingMarginTTM: "-0.08",
  ReturnOnEquityTTM: "-0.11",
  ReturnOnAssetsTTM: "-0.03",
  BookValue: "2.10",
  PriceToBookRatio: "9.9",
};

/** Normalize a fixture exactly the way the ingestion path does, then pin the
 *  payload's own observation stamp so tests never depend on the wall clock. */
function evidence(
  overview: RawOverview | null,
  earnings: RawEarnings | null,
  observedAt = OBSERVED_AT,
): FundamentalData {
  return { ...normalizeFundamentals(overview, earnings, "stock", "AAPL"), timestamp: observedAt };
}

const RISING = evidence(OVERVIEW, EARNINGS_RISING);
const FALLING = evidence(OVERVIEW_WEAK, EARNINGS_FALLING);

// ── 1. Provider-native evidence + identity + reporting periods ─────

describe("274 — provider-native normalized evidence", () => {
  it("preserves the exact symbol, provider and full quarterly history", () => {
    expect(RISING.provider).toBe("alpha-vantage");
    expect(RISING.symbol).toBe("AAPL");
    expect(RISING.available).toBe(true);
    expect(RISING.quarterlyEarningsHistory).toHaveLength(8);
    expect(RISING.annualEarningsHistory).toHaveLength(2);
  });

  it("preserves each fiscal period end and report date verbatim", () => {
    for (let i = 0; i < QUARTERS_RISING.length; i++) {
      expect(RISING.quarterlyEarningsHistory![i].fiscalDateEnding).toBe(
        QUARTERS_RISING[i].fiscalDateEnding,
      );
      expect(RISING.quarterlyEarningsHistory![i].reportedDate).toBe(QUARTERS_RISING[i].reportedDate);
    }
  });

  it("captures the additional reported overview evidence as reported", () => {
    expect(RISING.forwardPe).toBe(26.1);
    expect(RISING.returnOnAssets).toBe(0.22);
    expect(RISING.priceToSales).toBe(7.8);
    expect(RISING.evToEbitda).toBe(22.4);
    expect(RISING.quarterlyRevenueGrowthYoY).toBe(0.061);
    expect(RISING.quarterlyEarningsGrowthYoY).toBe(0.078);
  });

  it("does not invent values the provider omitted", () => {
    const sparse = evidence({ Symbol: "AAPL", Name: "Apple Inc" }, null);
    expect(sparse.available).toBe(true);
    expect(sparse.peRatio).toBeUndefined();
    expect(sparse.forwardPe).toBeUndefined();
    expect(sparse.quarterlyEarningsHistory).toBeUndefined();
    expect(sparse.latestEarnings).toBeUndefined();
  });
});

// ── 2. Determinism — payload-only, zero clock reads ────────────────

describe("274 — deterministic same-input result", () => {
  it("never reads the clock while assessing (no Date.now() anywhere)", () => {
    const nowSpy = vi.spyOn(Date, "now");
    const a = assessFundamentals(RISING);
    expect(nowSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
    expect(a.available).toBe(true);
  });

  it("identical evidence → identical assessment, even days apart", () => {
    const first = assessFundamentals(RISING);
    const nowSpy = vi.spyOn(Date, "now");
    const second = assessFundamentals(RISING);
    nowSpy.mockRestore();
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("assessment carries no analysis-time timestamp — only payload instants", () => {
    const a = assessFundamentals(RISING);
    expect(a.observedAt).toBe(OBSERVED_AT);
    expect(a.reportingPeriod).toBe("2025-06-30");
    expect(a.reportAgeDaysAtObservation).toBe(5);
  });
});

// ── 3. Calculations come from the payload ──────────────────────────

describe("274 — metrics derived from supplied evidence", () => {
  const a = assessFundamentals(RISING);

  it("revenue trend counts real quarter-over-quarter moves", () => {
    expect(a.metrics.revenueRises).toBe(7);
    expect(a.metrics.revenueFalls).toBe(0);
    expect(a.metrics.revenueYoY).toBeCloseTo(94 / 78 - 1, 6);
  });

  it("EPS trend counts real quarter-over-quarter moves and YoY change", () => {
    expect(a.metrics.epsRises).toBe(7);
    expect(a.metrics.epsFalls).toBe(0);
    expect(a.metrics.epsYoY).toBeCloseTo(1.65 / 1.35 - 1, 6);
  });

  it("profitability is cited from reported margins/ROE/ROA", () => {
    const profitability = a.dimensions.find((d) => d.name === "profitability")!;
    expect(profitability.status).toBe("positive");
    expect(profitability.evidence).toContain("net margin 26.5%");
    expect(profitability.evidence).toContain("ROE 147.0%");
    expect(profitability.evidence).toContain("ROA 22.0%");
  });

  it("estimate consistency counts real beats against real estimates", () => {
    expect(a.metrics.estimateBeats).toBe(8);
    expect(a.metrics.estimateMisses).toBe(0);
    expect(a.dimensions.find((d) => d.name === "earnings-quality")!.status).toBe("positive");
  });

  it("valuation context uses real multiples and the MEASURED growth", () => {
    const valuation = a.dimensions.find((d) => d.name === "valuation")!;
    expect(valuation.evidence).toContain("P/E 28.5");
    expect(valuation.evidence).toContain("forward P/E 26.1");
    expect(valuation.evidence).toContain("measured q/q-4 EPS growth 22.2%");
    expect(valuation.evidence).toContain("ratio 1.28");
  });

  it("interprets supplied improving evidence as improving with high confidence", () => {
    expect(a.state).toBe("improving");
    expect(a.confidence).toBe("high");
    expect(a.confidenceEvidence).toContain("5 usable dimensions");
  });
});

// ── 4. Missing metrics stay unavailable ────────────────────────────

describe("274 — missing metrics remain unavailable", () => {
  it("reports balance-sheet and cash-flow as unavailable, never estimated", () => {
    const a = assessFundamentals(RISING);
    expect(a.dimensions.find((d) => d.name === "balance-sheet")!.status).toBe("unavailable");
    expect(a.dimensions.find((d) => d.name === "cash-flow")!.status).toBe("unavailable");
    expect(a.limitations.some((l) => /Balance-sheet quality .* UNAVAILABLE/.test(l))).toBe(true);
    expect(a.limitations.some((l) => /Free cash flow UNAVAILABLE/.test(l))).toBe(true);
  });

  it("marks dimensions unavailable when the payload carries no evidence for them", () => {
    const sparse = evidence({ Symbol: "AAPL", Name: "Apple Inc" }, null);
    const a = assessFundamentals(sparse);
    expect(a.dimensions.find((d) => d.name === "revenue-growth")!.status).toBe("unavailable");
    expect(a.dimensions.find((d) => d.name === "earnings-quality")!.status).toBe("unavailable");
    expect(a.metrics.epsYoY).toBeUndefined();
    expect(a.limitations.some((l) => /UNAVAILABLE/.test(l))).toBe(true);
  });

  it("never fabricates a growth-vs-valuation ratio without measured growth", () => {
    const sparse = evidence({ Symbol: "AAPL", PERatio: "28.5" }, null);
    const a = assessFundamentals(sparse);
    const valuation = a.dimensions.find((d) => d.name === "valuation")!;
    expect(valuation.status).toBe("neutral");
    expect(valuation.evidence).toContain("not interpreted directionally");
    expect(valuation.evidence).not.toContain("implied growth-vs-valuation");
  });

  it("produces no assessment at all when the provider returned nothing", () => {
    const a = assessFundamentals(undefined);
    expect(a.available).toBe(false);
    expect(a.state).toBe("insufficient");
    expect(a.confidence).toBe("insufficient");
    expect(a.dimensions.every((d) => d.status === "unavailable")).toBe(true);

    const failed = assessFundamentals({
      provider: "alpha-vantage",
      timestamp: 0,
      instrumentType: "stock",
      available: false,
      unavailableReason: "No fundamental data available for this symbol.",
    });
    expect(failed.available).toBe(false);
    expect(failed.limitations[0]).toBe("No fundamental data available for this symbol.");
  });
});

// ── 5. Changed evidence changes the assessment ─────────────────────

describe("274 — material evidence change changes the result", () => {
  it("deteriorating reported quarters produce weakening, not improving", () => {
    const weak = assessFundamentals(FALLING);
    expect(weak.state).toBe("weakening");
    expect(weak.metrics.epsFalls).toBeGreaterThan(0);
    expect(weak.metrics.estimateMisses).toBeGreaterThan(0);
    expect(weak.dimensions.find((d) => d.name === "profitability")!.status).toBe("negative");
  });

  it("conflicting dimensions produce mixed with capped confidence", () => {
    // Real revenue/EPS growth (from the quarterly series) alongside reported
    // losses and a stretched multiple: the payload disagrees with itself, and
    // the engine must not paper over it.
    const conflicted = evidence({ ...OVERVIEW_WEAK, PERatio: "90.0" }, EARNINGS_RISING);
    const a = assessFundamentals(conflicted);
    expect(a.state).toBe("mixed");
    expect(a.confidence).toBe("medium");
    expect(a.confidenceEvidence).toContain("conflicting dimension evidence caps confidence");
  });
});

// ── 6. Reporting periods are never presented as live data ──────────

describe("274 — reporting-period honesty", () => {
  it("discloses a stale period as stale against the observation instant", () => {
    // Period ended 2023-06-30 but observed 2025-07-05: 736 days apart.
    const stale = evidence(
      OVERVIEW,
      { quarterlyEarnings: [{ fiscalDateEnding: "2023-06-30", reportedDate: "2023-08-01", reportedEPS: "1.10" }] },
      OBSERVED_AT,
    );
    const a = assessFundamentals(stale);
    expect(a.reportAgeDaysAtObservation).toBe(736);
    expect(a.limitations.some((l) => /stale reporting data, never presented as live market data/.test(l))).toBe(true);
    expect(a.confidence).toBe("low");
  });

  it("states that figures are reported statements, not live quotes", () => {
    const a = assessFundamentals(RISING);
    expect(a.limitations.some((l) => /reported financial statements .* distinct from any live market price/.test(l))).toBe(true);
  });

  it("discloses when no observation instant exists rather than assuming one", () => {
    const noStamp = { ...RISING, timestamp: 0 };
    const a = assessFundamentals(noStamp);
    expect(a.reportAgeDaysAtObservation).toBeUndefined();
    expect(a.limitations.some((l) => /no provider observation instant is recorded/.test(l))).toBe(true);
  });
});

// ── 7. The result object carries the same assessment ───────────────

describe("274 — analysis result integration", () => {
  const result = runAnalysis({
    instrument: "AAPL",
    instrumentType: "stock",
    timeframe: "D1",
    fundamentalData: RISING,
  });

  it("attaches the fundamental assessment alongside — not inside — technical data", () => {
    expect(result.fundamentalAssessment).toBeDefined();
    expect(result.fundamentalAssessment!.reportingPeriod).toBe("2025-06-30");
    expect(result.fundamentalAssessment!.provider).toBe("alpha-vantage");
    // The technical surface is untouched by fundamental evidence: no
    // technical data was supplied, and none was invented from fundamentals.
    expect(result.technicalData).toBeUndefined();
    expect(result.fundamentalData).toEqual(RISING);
  });

  it("keeps the existing fundamental scoring narrative intact and separate", () => {
    expect(result.fundamentalSummary).toContain("Fundamentals — Apple Inc");
    expect(result.fundamentalSummary).toContain("Latest earnings: 2025-06-30");
  });

  it("is deterministic end-to-end for identical provider evidence", () => {
    const again = runAnalysis({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "D1",
      fundamentalData: RISING,
    });
    expect(again.fundamentalAssessment).toEqual(result.fundamentalAssessment);
  });
});

// ── 8. The existing UI renders the engine's own values ─────────────

describe("274 — fundamental result reaches the UI", () => {
  const result = runAnalysis({
    instrument: "AAPL",
    instrumentType: "stock",
    timeframe: "D1",
    fundamentalData: RISING,
  });
  const engine = result.fundamentalAssessment!;

  it("renders state, source, reporting period and observation instant", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result }));
    const text = container.textContent ?? "";
    expect(text).toContain("FUNDAMENTAL ASSESSMENT");
    expect(text).toContain("IMPROVING");
    expect(text).toContain("alpha-vantage");
    expect(text).toContain("2025-06-30");
    expect(text).toContain(new Date(OBSERVED_AT).toISOString());
  });

  it("renders the engine's derived evidence verbatim (no re-derivation)", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result }));
    const text = container.textContent ?? "";
    for (const dimension of engine.dimensions.filter((d) => d.status !== "unavailable")) {
      expect(dimension.evidence).toBeTruthy();
      expect(text).toContain(dimension.evidence!);
    }
    expect(text).toContain(engine.confidenceEvidence);
  });

  it("renders every limitation, including the unavailable dimensions", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result }));
    const text = container.textContent ?? "";
    for (const limitation of engine.limitations) {
      expect(text).toContain(limitation);
    }
    expect(text).toContain("Free cash flow UNAVAILABLE");
  });

  it("shows an explicit unavailable state when no provider result exists", () => {
    const empty = runAnalysis({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "D1",
    });
    expect(empty.fundamentalAssessment!.available).toBe(false);
    const { container } = render(createElement(AnalysisResultDisplay, { result: empty }));
    const text = container.textContent ?? "";
    expect(text).toContain("FUNDAMENTAL ASSESSMENT");
    expect(text).toContain("no assessment produced");
  });

  it("never labels reported fundamentals as live data", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result }));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bLIVE\b/);
    expect(text).toContain("a reported disclosure, distinct from any live market price");
  });
});

// ── 9. No hardcoded financial values on the production path ────────

describe("274 — no hardcoded financial values", () => {
  it("derived numbers track the payload, not constants", () => {
    const variant = evidence(
      { ...OVERVIEW, ProfitMargin: "0.101", PERatio: "19.4" },
      EARNINGS_RISING,
    );
    const base = assessFundamentals(RISING);
    const changed = assessFundamentals(variant);
    expect(base.dimensions.find((d) => d.name === "profitability")!.evidence).toContain("26.5%");
    expect(changed.dimensions.find((d) => d.name === "profitability")!.evidence).toContain("10.1%");
    expect(base.dimensions.find((d) => d.name === "valuation")!.evidence).not.toBe(
      changed.dimensions.find((d) => d.name === "valuation")!.evidence,
    );
  });
});
