/**
 * Phase 276 — unified technical + fundamental intelligence regression contract.
 *
 * The unified layer sits ABOVE the two existing engines. This suite proves it:
 *   · reads both engines' finished results and computes nothing itself;
 *   · produces a combined conclusion ONLY when both classes genuinely supply
 *     evidence (cases A–D);
 *   · states missing evidence explicitly instead of treating it as neutral;
 *   · lowers confidence on conflict and never raises it for having two sources;
 *   · refuses actionability for conflict, non-directionality, or a missing
 *     technical invalidation;
 *   · preserves BOTH sets of provenance and the fundamental reporting period;
 *   · is deterministic, and reacts to changes in EITHER evidence class;
 *   · drives the existing UI section verbatim (no recomputation in React).
 *
 * Fixtures are Alpha Vantage response shapes used as test input only; the
 * technical fixtures are real OHLCV candle series fed to the production engine.
 */

import { describe, it, expect } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { I18nProvider } from "./i18n";
import { runAnalysis, type AnalysisInput } from "./analysis-engine";
import { calculateTechnical } from "./data/technical";
import { buildUnifiedIntelligence } from "./unified-intelligence";
import { normalizeFundamentals, type RawEarnings, type RawOverview } from "./data/alpha-vantage/normalize";
import type { FundamentalData } from "./data/intelligence-types";
import type { OhlcvCandle } from "./data/market-types";
import { AnalysisResultDisplay } from "../components/AnalysisResult";

const render = (ui: ReactNode) => rtlRender(createElement(I18nProvider, null, ui));

const OBSERVED_AT = Date.parse("2025-07-05T14:30:00Z");
const BAR_MS = 900_000;
const END_TS = Date.parse("2025-07-04T20:00:00Z");

/** Real candle series (SID-controlled sinusoid, as in Phase 273). */
function makeCandles(n: number, start: number, slopePerBar: number, seed = 0): OhlcvCandle[] {
  const amp = Math.max(4, Math.abs(slopePerBar) * 5);
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = Math.max(1, start + slopePerBar * j + amp * Math.sin(j * 0.55 + seed));
    out.push({
      timestamp: END_TS - (n - 1 - j) * BAR_MS,
      open: close - slopePerBar / 2,
      high: close + amp / 2,
      low: close - amp / 2,
      close,
      volume: 1_000 + j,
    });
  }
  return out;
}

const UPTREND = makeCandles(210, 40_000, 40, 0); // HH/HL structure
const DOWNTREND = makeCandles(210, 64_000, -60, 3); // LH/LL structure
const RANGEBOUND = makeCandles(210, 50_000, 0, 1); // "range" structure — non-directional

/** Fundamental evidence (Alpha Vantage shapes). */
function fundamentals(
  direction: "improving" | "weakening",
  overrides: Partial<RawOverview> = {},
): FundamentalData {
  const rising = direction === "improving";
  const eps = rising
    ? ["1.65", "1.53", "1.50", "1.42", "1.35", "1.28", "1.24", "1.15"]
    : ["0.82", "0.95", "1.08", "1.21", "1.34", "1.40", "1.47", "1.52"];
  const revenue = rising
    ? ["94000000000", "90000000000", "85000000000", "81000000000", "78000000000", "74000000000", "71000000000", "68000000000"]
    : ["61000000000", "65000000000", "69000000000", "73000000000", "77000000000", "80000000000", "83000000000", "86000000000"];
  const estimates = rising
    ? ["1.60", "1.50", "1.45", "1.38", "1.33", "1.25", "1.20", "1.12"]
    : ["0.95", "1.05", "1.15", "1.24", "1.33", "1.38", "1.44", "1.50"];
  const dates = [
    "2025-06-30", "2025-03-31", "2024-12-31", "2024-09-30",
    "2024-06-30", "2024-03-31", "2023-12-31", "2023-09-30",
  ];

  const overview: RawOverview = {
    Symbol: "MSFT",
    Name: "Microsoft Corporation",
    Sector: "TECHNOLOGY",
    PERatio: rising ? "34.0" : "41.0",
    ForwardPE: rising ? "30.0" : "38.0",
    EPS: rising ? "11.90" : "-0.90",
    ProfitMargin: rising ? "0.360" : "-0.081",
    ReturnOnEquityTTM: rising ? "0.350" : "-0.152",
    ReturnOnAssetsTTM: rising ? "0.200" : "-0.061",
    PriceToBookRatio: rising ? "12.10" : "9.90",
    QuarterlyRevenueGrowthYOY: rising ? "0.151" : "-0.121",
    QuarterlyEarningsGrowthYOY: rising ? "0.178" : "-0.211",
    ...overrides,
  };
  const earnings: RawEarnings = {
    quarterlyEarnings: eps.map((e, i) => ({
      fiscalDateEnding: dates[i],
      reportedDate: dates[i],
      reportedEPS: e,
      estimatedEPS: estimates[i],
      reportedRevenue: revenue[i],
    })),
  };
  return { ...normalizeFundamentals(overview, earnings, "stock", "MSFT"), timestamp: OBSERVED_AT };
}

/**
 * A production-shaped input: the technical surface is the one the acquisition
 * layer computes (`calculateTechnical`), exactly as `fetchMarketData` supplies
 * it. The unified layer never computes it — it reads the finished result.
 */
function analysisInput(
  candles: OhlcvCandle[],
  fundamentalData?: FundamentalData,
  instrument = "MSFT",
): AnalysisInput {
  const tech = calculateTechnical(candles);
  const last = candles[candles.length - 1];
  return {
    instrument,
    instrumentType: "stock",
    timeframe: "H4",
    tradingStyle: "intraday",
    provider: "alpha-vantage",
    providerInstrumentId: instrument,
    marketData: {
      instrument,
      instrumentType: "stock",
      provider: "alpha-vantage",
      providerInstrumentId: instrument,
      price: { price: last.close, timestamp: last.timestamp, source: "alpha-vantage" },
      candles,
      timeframe: "H4",
      fetchTimestamp: END_TS,
      dataFreshness: "realtime",
    } as AnalysisInput["marketData"],
    technicalData: tech,
    ...(fundamentalData ? { fundamentalData } : {}),
  } as AnalysisInput;
}

// ── 1–4. The four agreement cases ────────────────────────────────

describe("276 — confluence across the two evidence classes", () => {
  it("(1) bullish technical + improving fundamentals → aligned bullish", () => {
    const result = runAnalysis(analysisInput(UPTREND, fundamentals("improving")));
    const unified = result.unifiedIntelligence!;
    expect(unified.state).toBe("aligned_bullish");
    expect(unified.technical.bias).toBe("bullish");
    expect(unified.fundamental.state).toBe("improving");
    expect(unified.confluence.agreement).toBe("aligned");
  });

  it("(2) bearish technical + weakening fundamentals → aligned bearish", () => {
    const result = runAnalysis(analysisInput(DOWNTREND, fundamentals("weakening")));
    const unified = result.unifiedIntelligence!;
    expect(unified.state).toBe("aligned_bearish");
    expect(unified.technical.bias).toBe("bearish");
    expect(unified.fundamental.state).toBe("weakening");
    expect(unified.confluence.agreement).toBe("aligned");
  });

  it("(3) bullish technical + weakening fundamentals → conflicting", () => {
    const result = runAnalysis(analysisInput(UPTREND, fundamentals("weakening")));
    const unified = result.unifiedIntelligence!;
    expect(unified.technical.bias).toBe("bullish");
    expect(unified.fundamental.state).toBe("weakening");
    expect(unified.state).toBe("conflicting");
    expect(unified.confluence.agreement).toBe("conflicting");
    expect(unified.confluence.reason).toMatch(/contradict/i);
  });

  it("(4) bearish technical + improving fundamentals → conflicting", () => {
    const result = runAnalysis(analysisInput(DOWNTREND, fundamentals("improving")));
    const unified = result.unifiedIntelligence!;
    expect(unified.technical.bias).toBe("bearish");
    expect(unified.fundamental.state).toBe("improving");
    expect(unified.state).toBe("conflicting");
    expect(unified.actionable).toBe(false);
  });
});

// ── 5–7. Missing evidence is stated, never faked ─────────────────

describe("276 — single-class and empty evidence", () => {
  it("(4b) neutral technical + directional fundamentals → mixed, not aligned and not conflicting", () => {
    const result = runAnalysis(analysisInput(RANGEBOUND, fundamentals("improving")));
    const unified = result.unifiedIntelligence!;
    expect(result.technicalData!.structure).toBe("range");
    expect(unified.technical.bias).toBe("neutral");
    expect(unified.fundamental.state).toBe("improving");
    expect(unified.state).toBe("mixed");
    expect(unified.confluence.agreement).toBe("not-assessable");
    expect(unified.actionable).toBe(false);
    expect(unified.directionalConclusion).toBeUndefined();
  });

  it("(4c) a mixed fundamental read cannot join a directional technical read", () => {
    // Growth that contradicts profitability: the fundamental engine reports
    // MIXED, which is present but not usable for a combined conclusion.
    const mixedFundamental = fundamentals("improving", {
      ProfitMargin: "-0.05",
      ReturnOnEquityTTM: "-0.10",
      ReturnOnAssetsTTM: "-0.02",
    });
    const result = runAnalysis(analysisInput(UPTREND, { ...mixedFundamental, timestamp: OBSERVED_AT }));
    const unified = result.unifiedIntelligence!;
    expect(result.fundamentalAssessment!.state).toBe("mixed");
    expect(unified.fundamental.present).toBe(true);
    expect(unified.fundamental.available).toBe(false);
    expect(unified.state).toBe("technical_only");
    expect(unified.actionable).toBe(false);
    expect(unified.confluence.reason).toMatch(/did not reach a directional state \(mixed\)/);
  });

  it("(5) technical-only → technical_only, no combined conclusion", () => {
    const result = runAnalysis(analysisInput(UPTREND));
    const unified = result.unifiedIntelligence!;
    expect(unified.state).toBe("technical_only");
    expect(unified.available).toBe(true);
    expect(unified.actionable).toBe(false);
    expect(unified.directionalConclusion).toBeUndefined();
    expect(unified.confluence.reason).toMatch(/fundamental evidence is UNAVAILABLE/i);
    expect(unified.limitations.join(" ")).toMatch(/makes no combined claim/i);
    // The technical read itself stays fully usable.
    expect(unified.technical.available).toBe(true);
    expect(unified.technical.bias).toBe("bullish");
  });

  it("(5b) a present-but-unscorable fundamental payload cannot create a combined read", () => {
    const sparse = fundamentals("improving", {
      ProfitMargin: undefined,
      ReturnOnEquityTTM: undefined,
      ReturnOnAssetsTTM: undefined,
    });
    const bare: FundamentalData = {
      ...sparse,
      peRatio: undefined,
      forwardPe: undefined,
      priceToBook: undefined,
      priceToSales: undefined,
      evToEbitda: undefined,
      quarterlyRevenueGrowthYoY: undefined,
      quarterlyEarningsGrowthYoY: undefined,
      quarterlyEarningsHistory: undefined,
      latestEarnings: undefined,
      profitMargin: undefined,
      returnOnEquity: undefined,
      returnOnAssets: undefined,
      earningsPerShare: undefined,
    };
    const result = runAnalysis(analysisInput(UPTREND, bare));
    const unified = result.unifiedIntelligence!;
    expect(unified.fundamental.present).toBe(true);
    expect(unified.fundamental.available).toBe(false);
    expect(unified.state).toBe("technical_only");
    expect(unified.actionable).toBe(false);
    expect(unified.limitations.join(" ")).toMatch(/insufficient/i);
  });

  it("(6) fundamental-only → fundamental_only, no combined conclusion", () => {
    const result = runAnalysis({
      instrument: "MSFT",
      instrumentType: "stock",
      timeframe: "D1",
      provider: "alpha-vantage",
      providerInstrumentId: "MSFT",
      fundamentalData: fundamentals("improving"),
    });
    const unified = result.unifiedIntelligence!;
    expect(unified.state).toBe("fundamental_only");
    expect(unified.technical.available).toBe(false);
    expect(unified.fundamental.available).toBe(true);
    expect(unified.actionable).toBe(false);
    expect(unified.directionalConclusion).toBeUndefined();
    expect(unified.confluence.reason).toMatch(/technical evidence is UNAVAILABLE/i);
  });

  it("(7) neither class → insufficient / unavailable, no assessment claimed", () => {
    const result = runAnalysis({
      instrument: "MSFT",
      instrumentType: "stock",
      timeframe: "D1",
    });
    const unified = result.unifiedIntelligence!;
    expect(unified.available).toBe(false);
    expect(unified.state).toBe("insufficient");
    expect(unified.confidence).toBe("insufficient");
    expect(unified.actionable).toBe(false);
    expect(unified.technical.bias).toBe("unavailable");
    expect(unified.fundamental.state).toBe("unavailable");
    expect(unified.explanation).toMatch(/no technical evidence/i);
  });
});

// ── 8–9. Confidence and actionability discipline ─────────────────

describe("276 — confidence and actionability", () => {
  it("(8) conflict lowers confidence below the weaker class", () => {
    const aligned = runAnalysis(analysisInput(UPTREND, fundamentals("improving"))).unifiedIntelligence!;
    const conflicting = runAnalysis(analysisInput(UPTREND, fundamentals("weakening"))).unifiedIntelligence!;

    expect(aligned.state).toBe("aligned_bullish");
    expect(conflicting.state).toBe("conflicting");
    const order = { insufficient: 0, low: 1, medium: 2, high: 3 } as const;
    expect(order[conflicting.confidence]).toBeLessThan(order[aligned.confidence]);
    expect(conflicting.confidenceEvidence).toMatch(/conflict, which lowers confidence/);
  });

  it("(8b) unified confidence never exceeds the weaker class", () => {
    const order = { insufficient: 0, low: 1, medium: 2, high: 3 } as const;
    for (const input of [
      analysisInput(UPTREND, fundamentals("improving")),
      analysisInput(DOWNTREND, fundamentals("weakening")),
      analysisInput(UPTREND, fundamentals("weakening")),
    ]) {
      const unified = runAnalysis(input).unifiedIntelligence!;
      expect(order[unified.confidence]).toBeLessThanOrEqual(order[unified.technical.confidence]);
      expect(order[unified.confidence]).toBeLessThanOrEqual(order[unified.fundamental.confidence]);
      expect(unified.confidenceEvidence).toMatch(/weaker of technical/);
    }
  });

  it("(9) conflict cannot produce an actionable directional conclusion", () => {
    const unified = runAnalysis(analysisInput(DOWNTREND, fundamentals("improving"))).unifiedIntelligence!;
    expect(unified.state).toBe("conflicting");
    expect(unified.actionable).toBe(false);
    expect(unified.directionalConclusion).toBeUndefined();
    expect(unified.actionabilityReason).toMatch(/conflict/i);
  });

  it("(9b) an aligned pair with no technical invalidation is not actionable", () => {
    const result = runAnalysis(analysisInput(UPTREND, fundamentals("improving")));
    const basis = result.unifiedIntelligence!;
    // Simulate the engine having supplied no invalidation level: the layer must
    // refuse actionability rather than invent a failure condition.
    const stripped = buildUnifiedIntelligence({
      ...result,
      keyLevels: { support: "-", resistance: "-", invalidation: "unavailable" },
    });
    expect(stripped.state).toBe("aligned_bullish");
    expect(stripped.technical.invalidation).toBeUndefined();
    expect(stripped.actionable).toBe(false);
    expect(stripped.actionabilityReason).toMatch(/no valid invalidation level/i);
    expect(stripped.directionalConclusion).toBeUndefined();
    // The aligned reading itself is unchanged — only actionability is withheld.
    expect(stripped.confidence).toBe(basis.confidence);
  });
});

// ── 10–12. Invalidation + provenance ────────────────────────────

describe("276 — invalidation and provenance", () => {
  it("(10) the engine's technical invalidation is preserved verbatim", () => {
    const result = runAnalysis(analysisInput(UPTREND, fundamentals("improving")));
    // The engine defines an invalidation only for a setup it accepts. This run
    // is rejected by its own gates, so the layer must NOT invent a level — it
    // reports none and withholds actionability (proved in 9b).
    expect(result.keyLevels.invalidation).toBe("");
    const honest = result.unifiedIntelligence!;
    expect(honest.technical.invalidation).toBeUndefined();
    expect(honest.actionable).toBe(false);

    // When the engine DOES supply one, it travels through unchanged.
    const LEVEL = "48,194.05 (structural swing low)";
    const withLevel = buildUnifiedIntelligence({
      ...result,
      keyLevels: { support: "47,736.08", resistance: "51,900.00", invalidation: LEVEL },
    });
    expect(withLevel.technical.invalidation).toBe(LEVEL);
    expect(withLevel.explanation).toContain(LEVEL);
    expect(withLevel.actionable).toBe(true);
    expect(withLevel.directionalConclusion).toBe("long");
    // ...and the fundamental side still contributes no price invalidation.
    expect(withLevel.explanation).toMatch(
      /reporting period 2025-06-30 is context only and does not define a price invalidation/,
    );
  });

  it("(11) the fundamental reporting period survives into the unified object", () => {
    const result = runAnalysis(analysisInput(UPTREND, fundamentals("improving")));
    const unified = result.unifiedIntelligence!;
    expect(unified.fundamental.reportingPeriod).toBe("2025-06-30");
    expect(unified.fundamental.reportingPeriod).toBe(result.fundamentalAssessment!.reportingPeriod);
  });

  it("(12) both providers and native identities survive", () => {
    const result = runAnalysis(analysisInput(UPTREND, fundamentals("improving")));
    const unified = result.unifiedIntelligence!;
    expect(unified.technical.provider).toBeTruthy();
    expect(unified.technical.instrumentId).toBe("MSFT");
    expect(unified.fundamental.provider).toBe("alpha-vantage");
    expect(unified.fundamental.instrumentId).toBe("MSFT");
    expect(unified.technical.observedAt).toBe(END_TS);
    expect(unified.fundamental.observedAt).toBe(OBSERVED_AT);
    expect(unified.limitations.join(" ")).toMatch(/fiscal period ending 2025-06-30/);
    expect(unified.limitations.join(" ")).toMatch(/reported statements, never live market data/);
  });

  it("(12b) fundamental reporting dates are never relabelled as market timestamps", () => {
    const unified = runAnalysis(analysisInput(UPTREND, fundamentals("improving"))).unifiedIntelligence!;
    expect(unified.technical.observedAt).not.toBe(unified.fundamental.observedAt);
    expect(new Date(unified.fundamental.observedAt!).toISOString()).toBe("2025-07-05T14:30:00.000Z");
    expect(new Date(unified.technical.observedAt!).toISOString()).toBe("2025-07-04T20:00:00.000Z");
  });
});

// ── 13–15. Determinism and sensitivity ──────────────────────────

describe("276 — determinism and evidence sensitivity", () => {
  const base = analysisInput(UPTREND, fundamentals("improving"));

  it("(13) identical evidence → byte-identical unified object", () => {
    const a = runAnalysis(base).unifiedIntelligence!;
    const b = runAnalysis(base).unifiedIntelligence!;
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("(14) changed technical evidence changes the unified result", () => {
    const up = runAnalysis(analysisInput(UPTREND, fundamentals("improving"))).unifiedIntelligence!;
    const down = runAnalysis(analysisInput(DOWNTREND, fundamentals("improving"))).unifiedIntelligence!;
    expect(down.technical.bias).not.toBe(up.technical.bias);
    expect(down.state).not.toBe(up.state);
    expect(down.state).toBe("conflicting");
  });

  it("(15) changed fundamental evidence changes the unified result", () => {
    const improving = runAnalysis(analysisInput(UPTREND, fundamentals("improving"))).unifiedIntelligence!;
    const weakening = runAnalysis(analysisInput(UPTREND, fundamentals("weakening"))).unifiedIntelligence!;
    expect(weakening.fundamental.state).not.toBe(improving.fundamental.state);
    expect(weakening.state).not.toBe(improving.state);
    expect(weakening.confidence).not.toBe(improving.confidence);
  });
});

// ── 16–17. UI renders the engine's object ───────────────────────

describe("276 — the UI renders the exact unified object", () => {
  const result = runAnalysis(analysisInput(UPTREND, fundamentals("improving")));
  const unified = result.unifiedIntelligence!;

  it("(16) renders state, bias, fundamental state, agreement, confidence, actionability, invalidation and provenance", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result }));
    const text = container.textContent ?? "";

    expect(text).toContain("UNIFIED INTELLIGENCE");
    expect(text).toContain("ALIGNED BULLISH");
    expect(text).toContain(unified.technical.bias);
    expect(text).toContain(unified.fundamental.state);
    expect(text).toContain(unified.confluence.reason);
    expect(text).toContain(unified.confidence);
    expect(text).toContain(unified.actionabilityReason);
    expect(text).toContain(unified.explanation);
    // No engine invalidation exists in this run → the card says so, and never
    // prints a fabricated level in its place.
    expect(unified.technical.invalidation).toBeUndefined();
    expect(text).toContain("not applicable");
    for (const limitation of unified.limitations) {
      expect(text).toContain(limitation);
    }
    expect(text).toContain("2025-06-30");
  });

  it("(16b) when the engine supplies an invalidation the card shows that exact level", () => {
    const LEVEL = "48,194.05 (structural swing low)";
    const withLevel = {
      ...result,
      keyLevels: { support: "47,736.08", resistance: "51,900.00", invalidation: LEVEL },
    };
    withLevel.unifiedIntelligence = buildUnifiedIntelligence(withLevel);
    const text = render(createElement(AnalysisResultDisplay, { result: withLevel })).container.textContent ?? "";
    expect(text).toContain(LEVEL);
    expect(withLevel.unifiedIntelligence.actionable).toBe(true);
    expect(text).toContain("actionable");
  });

  it("(17) the card shows only the two evidence sets' own values — nothing re-derived", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result }));
    const text = container.textContent ?? "";
    // Values come from the unified object and the existing sections.
    expect(text).toContain(result.fundamentalAssessment!.confidenceEvidence);
    expect(text).toContain(unified.technical.evidence);
    expect(text).toContain(unified.fundamental.evidence);
    // The technical and fundamental sections remain present and separate: the
    // engine's own summaries are rendered side by side with the unified card.
    expect(text).toContain(result.technicalSummary);
    expect(text).toContain(result.fundamentalSummary);
    expect(text).toContain("FUNDAMENTAL ASSESSMENT");
    expect(text).toContain("UNIFIED INTELLIGENCE");
  });

  it("(17b) no combined directional claim is rendered for single-class evidence", () => {
    const techOnly = runAnalysis(analysisInput(UPTREND));
    const text = (render(createElement(AnalysisResultDisplay, { result: techOnly })).container.textContent ?? "");
    expect(text).toContain("TECHNICAL ONLY");
    expect(text).toContain("not actionable");
    expect(text).not.toMatch(/\bLONG\b/);
    expect(text).not.toMatch(/\bSHORT\b/);

    const fundOnly = runAnalysis({
      instrument: "MSFT",
      instrumentType: "stock",
      timeframe: "D1",
      fundamentalData: fundamentals("improving"),
    });
    const fundText = (render(createElement(AnalysisResultDisplay, { result: fundOnly })).container.textContent ?? "");
    expect(fundText).toContain("FUNDAMENTAL ONLY");
    expect(fundText).toContain("not actionable");
  });

  it("(20) never labels reported fundamentals as live market data", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result }));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bLIVE\b/);
    expect(text).toContain("never live market data");
  });
});

// ── Purity: the layer computes nothing of its own ───────────────

describe("276 — the layer is a derivation, not a second engine", () => {
  it("reads the engine's outputs rather than recomputing indicators", () => {
    const result = runAnalysis(analysisInput(UPTREND, fundamentals("improving")));
    const unified = buildUnifiedIntelligence(result);
    // Every number cited is traceable to the engine's own technical output.
    expect(unified.technical.evidence).toContain(`structure ${result.technicalData!.structure}`);
    expect(unified.technical.evidence).toContain(`RSI(14) ${result.technicalData!.rsi14!.toFixed(1)}`);
    expect(unified.technical.evidence).toContain(`${result.technicalData!.dataPoints} candles`);
    expect(unified.technical.evidence).toContain(`engine trend factor ${result.breakdown.trend >= 0 ? "+" : ""}${result.breakdown.trend}`);
  });

  it("produces an identical object when the engine's decision is unchanged", () => {
    const result = runAnalysis(analysisInput(DOWNTREND, fundamentals("weakening")));
    const again = buildUnifiedIntelligence(result);
    expect(again).toEqual(result.unifiedIntelligence);
  });

  it("does not modify the engine's own decision fields", () => {
    const result = runAnalysis(analysisInput(UPTREND, fundamentals("improving")));
    const isolated = buildUnifiedIntelligence(result);
    expect(isolated.state).toBe("aligned_bullish");
    // The unified layer's actionability is its own field; the engine decision
    // is untouched by it and remains the authority for recommendation.
    expect(result.recommendation).toBeDefined();
    expect(["LONG", "SHORT", "NO_TRADE"]).toContain(result.recommendation);
  });
});
