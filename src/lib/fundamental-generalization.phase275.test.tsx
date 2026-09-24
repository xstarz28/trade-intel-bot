/**
 * Phase 275 — the shipped Fundamental section is not AAPL-specific.
 *
 * Two distinct stock symbols are normalized from their OWN provider evidence,
 * assessed by the same engine, run through the same `runAnalysis`, and
 * rendered by the SAME `AnalysisResultDisplay`. Each card must show the
 * assessment that belongs to its instrument — identity, state, metrics and
 * limitations — with no bleed between them, and identical evidence must keep
 * producing an identical result for either symbol.
 *
 * Fixtures are Alpha Vantage response shapes used as test input only.
 */

import { describe, it, expect } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { I18nProvider } from "./i18n";
import {
  normalizeFundamentals,
  type RawEarnings,
  type RawOverview,
} from "./data/alpha-vantage/normalize";
import { assessFundamentals } from "./fundamental-engine";
import { runAnalysis } from "./analysis-engine";
import { AnalysisResultDisplay } from "../components/AnalysisResult";

const render = (ui: ReactNode) => rtlRender(createElement(I18nProvider, null, ui));

const OBSERVED_AT = Date.parse("2025-07-05T14:30:00Z");

/** Two independent companies, distinct fiscal dates and distinct numbers. */
const MSFT: { overview: RawOverview; earnings: RawEarnings } = {
  overview: {
    Symbol: "MSFT",
    Name: "Microsoft Corporation",
    Sector: "TECHNOLOGY",
    PERatio: "34.0",
    ForwardPE: "30.0",
    EPS: "11.90",
    ProfitMargin: "0.360",
    ReturnOnEquityTTM: "0.350",
    ReturnOnAssetsTTM: "0.200",
    PriceToBookRatio: "12.10",
  },
  earnings: {
    quarterlyEarnings: [
      { fiscalDateEnding: "2025-06-30", reportedDate: "2025-07-24", reportedEPS: "3.30", estimatedEPS: "3.20", reportedRevenue: "70000000000" },
      { fiscalDateEnding: "2025-03-31", reportedDate: "2025-04-24", reportedEPS: "3.12", estimatedEPS: "3.05", reportedRevenue: "66000000000" },
      { fiscalDateEnding: "2024-12-31", reportedDate: "2025-01-28", reportedEPS: "3.05", estimatedEPS: "2.98", reportedRevenue: "64000000000" },
      { fiscalDateEnding: "2024-09-30", reportedDate: "2024-10-30", reportedEPS: "2.95", estimatedEPS: "2.90", reportedRevenue: "62000000000" },
      { fiscalDateEnding: "2024-06-30", reportedDate: "2024-07-30", reportedEPS: "2.80", estimatedEPS: "2.74", reportedRevenue: "60000000000" },
      { fiscalDateEnding: "2024-03-31", reportedDate: "2024-04-25", reportedEPS: "2.72", estimatedEPS: "2.66", reportedRevenue: "58000000000" },
    ],
  },
};

const TSLA: { overview: RawOverview; earnings: RawEarnings } = {
  overview: {
    Symbol: "TSLA",
    Name: "Tesla, Inc.",
    Sector: "CONSUMER CYCLICAL",
    PERatio: "62.0",
    EPS: "-1.20",
    ProfitMargin: "-0.041",
    ReturnOnEquityTTM: "-0.076",
  },
  earnings: {
    quarterlyEarnings: [
      { fiscalDateEnding: "2025-03-31", reportedDate: "2025-04-22", reportedEPS: "0.31", estimatedEPS: "0.42", reportedRevenue: "21000000000" },
      { fiscalDateEnding: "2024-12-31", reportedDate: "2025-01-29", reportedEPS: "0.44", estimatedEPS: "0.50", reportedRevenue: "23000000000" },
      { fiscalDateEnding: "2024-09-30", reportedDate: "2024-10-23", reportedEPS: "0.58", estimatedEPS: "0.60", reportedRevenue: "25000000000" },
      { fiscalDateEnding: "2024-06-30", reportedDate: "2024-07-23", reportedEPS: "0.72", estimatedEPS: "0.70", reportedRevenue: "26000000000" },
      { fiscalDateEnding: "2024-03-31", reportedDate: "2024-04-23", reportedEPS: "0.85", estimatedEPS: "0.80", reportedRevenue: "27000000000" },
    ],
  },
};

function evidence(
  symbol: "MSFT" | "TSLA",
  observedAt = OBSERVED_AT,
): ReturnType<typeof normalizeFundamentals> {
  const fixture = symbol === "MSFT" ? MSFT : TSLA;
  return {
    ...normalizeFundamentals(fixture.overview, fixture.earnings, "stock", symbol),
    timestamp: observedAt,
  };
}

const resultFor = (symbol: "MSFT" | "TSLA") =>
  runAnalysis({
    instrument: symbol,
    instrumentType: "stock",
    timeframe: "D1",
    provider: "alpha-vantage",
    providerInstrumentId: symbol,
    fundamentalData: evidence(symbol),
  });

describe("275 — the same section serves every supported stock", () => {
  it("renders each instrument's own identity, state and metrics", () => {
    const msft = resultFor("MSFT");
    const tsla = resultFor("TSLA");

    const msftText = render(createElement(AnalysisResultDisplay, { result: msft })).container.textContent ?? "";
    const tslaText = render(createElement(AnalysisResultDisplay, { result: tsla })).container.textContent ?? "";

    // MSFT: improving, profitable, its own numbers.
    expect(msftText).toContain("FUNDAMENTAL ASSESSMENT");
    expect(msftText).toContain("alpha-vantage · MSFT");
    expect(msftText).toContain("IMPROVING");
    expect(msftText).toContain("net margin 36.0%");
    expect(msftText).not.toContain("net margin -4.1%");
    expect(msftText).not.toContain("alpha-vantage · TSLA");

    // TSLA: its own weakening evidence, never MSFT's.
    expect(tslaText).toContain("alpha-vantage · TSLA");
    expect(tslaText).toContain("WEAKENING");
    expect(tslaText).toContain("net margin -4.1%");
    expect(tslaText).not.toContain("net margin 36.0%");
    expect(tslaText).not.toContain("alpha-vantage · MSFT");
  });

  it("displays the exact assessment object the engine produced, per instrument", () => {
    for (const symbol of ["MSFT", "TSLA"] as const) {
      const result = resultFor(symbol);
      const engine = result.fundamentalAssessment!;
      const text = render(createElement(AnalysisResultDisplay, { result })).container.textContent ?? "";

      expect(engine.instrumentId).toBe(symbol);
      expect(text).toContain(engine.reportingPeriod!);
      for (const dimension of engine.dimensions.filter((d) => d.status !== "unavailable")) {
        expect(text).toContain(dimension.evidence!);
      }
      for (const limitation of engine.limitations) {
        expect(text).toContain(limitation);
      }
    }
  });

  it("keeps identical evidence → identical result for either instrument", () => {
    for (const symbol of ["MSFT", "TSLA"] as const) {
      const a = resultFor(symbol).fundamentalAssessment;
      const b = resultFor(symbol).fundamentalAssessment;
      expect(b).toEqual(a);
    }
  });

  it("keeps reporting periods per instrument and never claims live data", () => {
    const msft = resultFor("MSFT").fundamentalAssessment!;
    const tsla = resultFor("TSLA").fundamentalAssessment!;
    expect(msft.reportingPeriod).toBe("2025-06-30");
    expect(tsla.reportingPeriod).toBe("2025-03-31");
    expect(msft.reportingPeriod).not.toBe(tsla.reportingPeriod);

    const text = render(createElement(AnalysisResultDisplay, { result: resultFor("TSLA") })).container.textContent ?? "";
    expect(text).not.toMatch(/\bLIVE\b/);
    expect(text).toContain("distinct from any live market price");
  });

  it("shows explicit unavailability for a stock the provider cannot cover", () => {
    const empty = runAnalysis({
      instrument: "ZZZZ",
      instrumentType: "stock",
      timeframe: "D1",
      fundamentalData: {
        provider: "alpha-vantage",
        timestamp: 0,
        instrumentType: "stock",
        symbol: "ZZZZ",
        providerInstrumentId: "ZZZZ",
        available: false,
        unavailableReason: "No fundamental data available for this symbol.",
      },
    });
    expect(empty.fundamentalAssessment!.available).toBe(false);
    const text = render(createElement(AnalysisResultDisplay, { result: empty })).container.textContent ?? "";
    expect(text).toContain("FUNDAMENTAL ASSESSMENT");
    expect(text).toContain("No fundamental data available for this symbol.");
  });

  it("assesses a withheld-metric payload identically for both symbols", () => {
    for (const symbol of ["MSFT", "TSLA"] as const) {
      const bare = { ...evidence(symbol), profitMargin: undefined, returnOnEquity: undefined, returnOnAssets: undefined };
      const a = assessFundamentals(bare);
      const profitability = a.dimensions.find((d) => d.name === "profitability")!;
      expect(profitability.status).toBe("unavailable");
      expect(a.instrumentId).toBe(symbol);
    }
  });
});
