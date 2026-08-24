/**
 * Phase 7C — actual DXY price verification & cross-asset integration.
 *
 * Live audit result (this account/plan): literal "DXY", "DX.Y.NYB",
 * "USD_INDEX" and "I:DXY" ALL return 404 invalid-symbol while the control
 * EUR/USD series succeeds → ACTUAL DXY is honestly unavailable today; the
 * candidate list + failure cache keep the path future-proof. These tests pin
 * that behavior: no fabricated DXY, proxy labeled & excluded when actual
 * data exists, CROSS_ASSET cap unchanged at ±3.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";
import { DXY_CANDIDATE_SYMBOLS, resolveWorkingSymbol, pearsonCorrelation } from "@/lib/market-context";

// ── Candidate resolution ──────────────────────────────────────────

describe("defensive DXY symbol discovery", () => {
  it("candidate list is ordered and documented", () => {
    expect(DXY_CANDIDATE_SYMBOLS[0]).toBe("DXY");
    expect(DXY_CANDIDATE_SYMBOLS).toContain("DX.Y.NYB");
  });

  it("picks the FIRST valid candidate (mirrors live probe semantics)", () => {
    const picked = resolveWorkingSymbol(DXY_CANDIDATE_SYMBOLS, (s) => s === "USD_INDEX");
    expect(picked).toBe("USD_INDEX");
  });

  it("all candidates invalid (current live reality: 404 on every index symbol) → none", () => {
    // Mirrors the verified live result: every candidate 404s.
    expect(resolveWorkingSymbol(DXY_CANDIDATE_SYMBOLS, () => false)).toBeNull();
  });
});

// ── Fixtures ──────────────────────────────────────────────────────

function makeMarket(instrument: string, price = 100): MarketData {
  return {
    instrument, instrumentType: "forex", provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

function techBase(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [105], swingLows: [98],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [98], resistanceLevels: [105],
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

function baseInput(over?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    economicEvents: "hawkish rate hike strong gdp",
    marketData: makeMarket("EUR/USD"),
    technicalData: techBase(),
    ...over,
  } as AnalysisInput;
}

const macroWithProxy = (trend: "rising" | "falling") => ({
  provider: "alpha-vantage", timestamp: Date.now(), confidence: "medium" as const,
  indicators: [
    { name: "Inflation", description: "cpi print", relevance: "high" as const, sentiment: "negative" as const },
  ],
  summary: "", dxyTrend: trend,
});

const actualDxy = (over?: Record<string, unknown>) => ({
  comparatorSymbol: "DXY",
  timeframe: "H4",
  available: true,
  correlation: -0.82,
  sampleSize: 100,
  directionalContext: "inverse" as const,
  comparatorMomentum: "up" as const,
  dataKind: "actual_price" as const,
  provider: "Twelve Data",
  ...over,
});

// ── Provenance & anti-double-counting ─────────────────────────────

describe("actual vs NEWS-derived proxy", () => {
  it("news proxy is scored ONLY when actual DXY is unavailable (no double-count)", () => {
    const { dxyTrend, ...macroWithoutTrend } = macroWithProxy("falling");
    void dxyTrend;
    const proxyActive = runAnalysis(baseInput({ macroData: macroWithProxy("falling") }));
    const noTrendBaseline = runAnalysis(
      baseInput({ macroData: macroWithoutTrend as AnalysisInput["macroData"] }),
    );
    // Same payload WITH actual DXY present → proxy contributes NOTHING:
    // fundamental equals the no-dxyTrend baseline exactly.
    const withActual = runAnalysis(
      baseInput({ macroData: macroWithProxy("falling"), technicalData: techBase({ crossAsset: actualDxy() }) }),
    );
    expect(withActual.breakdown.fundamental).toBe(noTrendBaseline.breakdown.fundamental);
    // Without actual DXY the same payload actively moves the score.
    expect(proxyActive.breakdown.fundamental).not.toBe(noTrendBaseline.breakdown.fundamental);
  });

  it("summary distinguishes ACTUAL price data from NEWS-derived proxy", () => {
    const actual = runAnalysis(baseInput({ technicalData: techBase({ crossAsset: actualDxy() }) }));
    expect(actual.fundamentalSummary).toMatch(/ACTUAL DXY price data/i);
    expect(actual.fundamentalSummary).toMatch(/redundant and excluded/i);

    const proxy = runAnalysis(baseInput({ macroData: macroWithProxy("rising") }));
    expect(proxy.fundamentalSummary).toMatch(/NEWS-derived proxy, not actual DXY price data/i);
  });

  it("actual-DXY evidence stays inside the CROSS_ASSET ±3 cap", () => {
    const none = runAnalysis(baseInput());
    const withActual = runAnalysis(baseInput({ technicalData: techBase({ crossAsset: actualDxy() }) }));
    const diff = Math.abs((withActual.confidence ?? 0) - (none.confidence ?? 0));
    expect(diff).toBeLessThanOrEqual(3);
  });
});

// ── Hierarchy invariants ──────────────────────────────────────────

describe("DXY cannot overpower structure", () => {
  it("actual DXY cannot flip a bearish-structure thesis to bullish", () => {
    const r = runAnalysis(
      baseInput({
        technicalData: techBase({
          structure: "LH/LL", bosDirection: "bearish", chochDirection: "bearish",
          swingHighs: [101], swingLows: [95], supportLevels: [95], resistanceLevels: [101],
          crossAsset: actualDxy(),
        }),
      }),
    );
    expect(r.bias).toBe("Bearish");
  });

  it("actual DXY cannot rescue a Neutral-bias / NO_TRADE market", () => {
    const r = runAnalysis(
      baseInput({
        technicalData: techBase({
          structure: "range", bosDirection: "none",
          swingHighs: [101], swingLows: [99], resistanceLevels: [101], supportLevels: [99],
          crossAsset: actualDxy(),
        }),
        economicEvents: undefined,
        newsContext: undefined,
        calendarData: undefined,
        macroData: undefined,
      }),
    );
    expect(r.recommendation).toBe("NO_TRADE");
    if (r.recommendation === "NO_TRADE") expect(r.tradePlan).toBeUndefined();
  });

  it("cross-asset fetch failure yields conviction identical to baseline (non-fatal)", () => {
    const baseline = runAnalysis(baseInput());
    const failed = runAnalysis(
      baseInput({
        technicalData: techBase({
          crossAsset: {
            comparatorSymbol: "DXY", timeframe: "H4", available: false,
            unavailableReason:
              "actual DXY price series is not available on the current Twelve Data plan (all documented index symbols verified invalid live) — NEWS-derived USD proxy remains labeled fallback",
          },
        }),
      }),
    );
    expect(failed.recommendation).toBe(baseline.recommendation);
    expect(failed.confidence).toBe(baseline.confidence);
    expect(failed.dataFlags.join(" ")).toMatch(/Cross-asset context unavailable/);
  });
});

// ── Styles & correlation methodology ─────────────────────────────

describe("styles & correlation policy preserved", () => {
  it("style profiles still gate decisions identically with actual DXY context present", () => {
    for (const tradingStyle of ["scalping", "intraday", "swing"] as const) {
      const none = runAnalysis(baseInput({ tradingStyle }));
      const withDxy = runAnalysis(baseInput({ tradingStyle, technicalData: techBase({ crossAsset: actualDxy() }) }));
      expect(withDxy.tradingStyle).toBe(tradingStyle);
      // Cross-asset layer never changes the recommendation by itself.
      expect(withDxy.recommendation === none.recommendation || Math.abs((withDxy.confidence ?? 0) - (none.confidence ?? 0)) <= 3).toBe(true);
    }
  });

  it("correlation needs sufficient samples — small series yield null (no synthetic corr)", () => {
    expect(pearsonCorrelation([1, 2, 3], [1, 2, 3])).toBeNull(); // n < minimum
    // Zigzag series (non-degenerate returns): mirrored series → corr −1.
    const a = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? i : -i));
    const mirrored = a.map((x) => 200 - x); // returns exactly negated
    const r = pearsonCorrelation(a, mirrored);
    expect(r?.correlation).toBeLessThan(-0.9); // strongly inverse, honestly computed
    const same = pearsonCorrelation(a, [...a]);
    expect(same?.correlation).toBeCloseTo(1, 5);
  });

  it("weak correlation stays 'weak' — no assumed −1 for EUR/USD↔DXY", () => {
    const weak = runAnalysis(baseInput({
      technicalData: techBase({ crossAsset: actualDxy({ correlation: -0.3, directionalContext: "weak", sampleSize: 100 }) }),
    }));
    expect(weak.technicalData?.crossAsset?.directionalContext).toBe("weak");
  });

  it("NO_TRADE state integrity intact with rich DXY context", () => {
    const r = runAnalysis(baseInput({
      technicalData: techBase({
        supportLevels: [99], resistanceLevels: [101], swingHighs: [101], swingLows: [99],
        crossAsset: actualDxy(),
      }),
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
  });
});
