/**
 * Phase 8 P7 — provider-failure CHAOS MATRIX.
 *
 * Oracle principle: for every provider-unavailable overlay, compare against
 * the SAME fixture with that provider simply ABSENT. Invariants asserted:
 *   1. market facts unchanged        6. NO_TRADE stays NO_TRADE
 *   2. structural bias unchanged     7. no plan synthesized after failure
 *   3. failure creates no bias       8. sizing failure ≠ invalid thesis
 *   4. availability adds nothing     9. execution failure ≠ non-crypto change
 *   5. informational flags present  10. failure never becomes DECISIVE
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";

// ── Fixtures ───────────────────────────────────────────────────────

function makeMarket(price: number): MarketData {
  return {
    instrument: "EUR/USD", instrumentType: "forex", provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

function tech(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [112], swingLows: [95],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [112],
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

/** Actionable LONG baseline (forex). */
function longFixture(): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100),
    technicalData: tech(),
    economicEvents: "Fed signals hawkish stance, rate hike",
  } as AnalysisInput;
}

/** Neutral NO_TRADE baseline. */
function neutralFixture(): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100),
    technicalData: tech({ structure: "range", bosDirection: "none" }),
  } as AnalysisInput;
}

// ── Unavailability overlays ────────────────────────────────────────

type Overlay = { name: string; patch: Partial<AnalysisInput> };

const OVERLAYS: Overlay[] = [
  { name: "Treasury unavailable", patch: { treasuryData: { available: false, reason: "feed timeout", fetchedAt: Date.now() } as never } },
  { name: "COT unavailable", patch: { cotData: { available: false, reason: "no mapping", fetchedAt: Date.now(), requestedInstrument: "EUR/USD" } as never } },
  { name: "EIA unavailable (non-oil: ignored)", patch: { eiaData: { available: false, reason: "key missing", fetchedAt: Date.now() } as never } },
  { name: "Alpha Vantage sentiment unavailable", patch: { sentimentData: undefined } },
  { name: "Cross-asset unavailable", patch: { technicalData: tech({ crossAsset: { comparatorSymbol: "DXY", timeframe: "H4", available: false, unavailableReason: "provider 404" } }) } },
  { name: "OKX execution unavailable (non-crypto: ignored)", patch: { executionData: { available: false, reason: "books down", instrumentId: null } as never } },
];

const ALL_UNAVAILABLE: Overlay = {
  name: "ALL contextual providers unavailable simultaneously",
  patch: Object.assign(
    {},
    ...OVERLAYS.map((o) => o.patch),
  ) as Partial<AnalysisInput>,
};

// ── Oracle helpers ─────────────────────────────────────────────────

function assertSameDecision(baseline: AnalysisResult, degraded: AnalysisResult, label: string) {
  // 1–3. market facts / structural bias unchanged
  expect(degraded.bias, `${label}: bias`).toBe(baseline.bias);
  expect(degraded.breakdown, `${label}: breakdown (market facts)`).toEqual(baseline.breakdown);
  expect(degraded.marketRegime!.regime, `${label}: regime`).toBe(baseline.marketRegime!.regime);
  // 4. availability adds nothing / failure subtracts nothing unearned
  expect(degraded.confidence, `${label}: confidence`).toBe(baseline.confidence);
  // 6–7. state machine integrity
  expect(degraded.recommendation, `${label}: recommendation`).toBe(baseline.recommendation);
  if (baseline.tradePlan === undefined) {
    expect(degraded.tradePlan, `${label}: no plan synthesized`).toBeUndefined();
  } else if (degraded.tradePlan) {
    expect(degraded.tradePlan.entry).toBe(baseline.tradePlan!.entry);
    expect(degraded.tradePlan.stopLoss).toBe(baseline.tradePlan!.stopLoss);
    expect(degraded.tradePlan.takeProfit).toBe(baseline.tradePlan!.takeProfit);
    expect(degraded.tradePlan.riskReward).toBe(baseline.tradePlan!.riskReward);
  }
  // 10. provider failure never becomes a DECISIVE contradiction
  const decisive = (degraded.keyContradictions ?? []).filter((c) => c.severity === "DECISIVE");
  const decisiveBase = (baseline.keyContradictions ?? []).filter((c) => c.severity === "DECISIVE");
  expect(decisive.length, `${label}: DECISIVE count`).toBeLessThanOrEqual(decisiveBase.length);
}

// ── Matrix ─────────────────────────────────────────────────────────

describe("P7 chaos matrix — actionable-LONG fixture under provider failures", () => {
  const baseline = runAnalysis(longFixture());
  expect(baseline.recommendation).toBe("LONG");

  for (const o of [...OVERLAYS, ALL_UNAVAILABLE]) {
    it(`${o.name} → thesis, conviction and plan identical to absent-provider baseline`, () => {
      const degraded = runAnalysis({ ...longFixture(), ...o.patch });
      assertSameDecision(baseline, degraded, o.name);
      // 8. sizing failure must NOT invalidate a valid thesis
      if (degraded.recommendation !== "NO_TRADE") {
        expect(degraded.tradePlan).toBeDefined();
      }
    });
  }

  it("informational flags are present for every failed contextual provider", () => {
    const degraded = runAnalysis({ ...longFixture(), ...ALL_UNAVAILABLE.patch });
    const joined = (degraded.dataFlags ?? []).join(" ");
    expect(joined).toContain("Treasury yield context unavailable");
    expect(joined).toContain("COT positioning context unavailable");
  });

  it("NO_TRADE fixture stays NO_TRADE with identical reasons count ≥ baseline", () => {
    const baseNeutral = runAnalysis(neutralFixture());
    const degraded = runAnalysis({ ...neutralFixture(), ...ALL_UNAVAILABLE.patch });
    expect(baseNeutral.recommendation).toBe("NO_TRADE");
    expect(degraded.recommendation).toBe("NO_TRADE");
    expect(degraded.tradePlan).toBeUndefined();
    expect(degraded.conviction).toBeUndefined();
    expect(degraded.noTradeReasons.length).toBeGreaterThanOrEqual(baseNeutral.noTradeReasons.length);
  });
});

describe("P7 crypto fixture — OKX execution/spec failures are non-fatal context", () => {
  function cryptoFixture(): AnalysisInput {
    return {
      instrument: "BTC/USD", instrumentType: "crypto", timeframe: "H4",
      marketData: { ...makeMarket(100), instrumentType: "crypto" },
      technicalData: tech(),
      economicEvents: "ETF approval institutional adoption",
    } as AnalysisInput;
  }

  it("execution + spec unavailable → same decision as provider absent", () => {
    const baseline = runAnalysis(cryptoFixture());
    const degraded = runAnalysis({
      ...cryptoFixture(),
      executionData: { available: false, reason: "books unreachable", instrumentId: null } as never,
      okxSpecData: { success: false as const, error: "instruments endpoint down" } as never,
    });
    assertSameDecision(baseline, degraded, "crypto providers down");
  });
});
