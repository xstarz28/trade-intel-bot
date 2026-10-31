import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types/analysis";
import { buildConditionalEntryScenarios } from "./conditional-entry-scenarios";

function resultFixture(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: "test",
    instrument: "XAU/USD",
    instrumentType: "commodity",
    timeframe: "M5",
    bias: "Neutral",
    confidence: 20,
    recommendation: "NO_TRADE",
    noTradeReasons: ["range"],
    tradingStyle: "scalping",
    technicalSummary: "",
    fundamentalSummary: "",
    breakdown: { trend: 0, indicator: 0, fundamental: 0, sentiment: 0 },
    keyLevels: { support: "90", resistance: "110", invalidation: "—" },
    riskNote: "",
    dataCompleteness: "partial",
    dataFlags: [],
    timestamp: 1,
    candles: Array.from({ length: 30 }, (_, i) => ({
      timestamp: (i + 1) * 60_000,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 10,
    })),
    technicalData: {
      dataPoints: 30,
      structure: "range",
      swingHighs: [110, 120],
      swingLows: [90, 80],
      resistanceLevels: [110, 120],
      supportLevels: [90, 80],
      volumeTrend: "stable",
      atr14: 2,
    },
    ...overrides,
  } as AnalysisResult;
}

describe("buildConditionalEntryScenarios", () => {
  it("derives two conditional triggers from observed support/resistance and swing targets", () => {
    const scenarios = buildConditionalEntryScenarios(resultFixture());
    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]).toMatchObject({ id: "bullish-breakout", direction: "long", trigger: 110.2, invalidation: 90, target: 120, ready: false });
    expect(scenarios[1]).toMatchObject({ id: "bearish-breakdown", direction: "short", trigger: 89.8, invalidation: 110, target: 80, ready: false });
    expect(scenarios.every((scenario) => (scenario.riskReward ?? 0) < 1.5)).toBe(true);
  });

  it("selects the nearest farther observed swing that meets the 1.5R minimum", () => {
    const fixture = resultFixture({
      technicalData: {
        dataPoints: 30,
        structure: "range",
        swingHighs: [110, 120, 145],
        swingLows: [90, 80, 50],
        resistanceLevels: [110, 120, 145],
        supportLevels: [90, 80, 50],
        volumeTrend: "stable",
        atr14: 2,
      },
    });
    const scenarios = buildConditionalEntryScenarios(fixture);
    const long = scenarios.find((scenario) => scenario.direction === "long")!;
    const short = scenarios.find((scenario) => scenario.direction === "short")!;

    expect(long.target).toBe(145);
    expect(long.riskReward).toBeGreaterThanOrEqual(1.5);
    expect(long.ready).toBe(true);
    expect(long.targetBasis).toContain("memenuhi minimum R:R");

    expect(short.target).toBe(50);
    expect(short.riskReward).toBeGreaterThanOrEqual(1.5);
    expect(short.ready).toBe(true);
    expect(short.targetBasis).toContain("memenuhi minimum R:R");
  });

  it("leaves target and R:R unavailable when no farther observed swing exists", () => {
    const fixture = resultFixture({
      technicalData: {
        dataPoints: 30,
        structure: "range",
        swingHighs: [110],
        swingLows: [90],
        resistanceLevels: [110],
        supportLevels: [90],
        volumeTrend: "stable",
        atr14: 2,
      },
    });
    const scenarios = buildConditionalEntryScenarios(fixture);
    expect(scenarios).toHaveLength(2);
    expect(scenarios.every((scenario) => scenario.target === undefined && scenario.riskReward === undefined && !scenario.ready)).toBe(true);
  });

  it("uses observed range extremes for fallback triggers but does not fabricate a target or R:R", () => {
    const fixture = resultFixture({
      technicalData: {
        dataPoints: 30,
        structure: "range",
        swingHighs: [],
        swingLows: [],
        resistanceLevels: [],
        supportLevels: [],
        volumeTrend: "unknown",
        atr14: 2,
      },
    });
    const scenarios = buildConditionalEntryScenarios(fixture);
    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]).toMatchObject({
      id: "bullish-breakout",
      trigger: 102.2,
      invalidation: 98,
      ready: false,
    });
    expect(scenarios[0].target).toBeUndefined();
    expect(scenarios[0].riskReward).toBeUndefined();
    expect(scenarios[1].target).toBeUndefined();
    expect(scenarios[1].riskReward).toBeUndefined();
    expect(scenarios.every((scenario) => scenario.reason.includes("no opposing structural target is verified"))).toBe(true);
  });

  it("rejects malformed latest OHLC instead of producing plausible levels", () => {
    const fixture = resultFixture({
      candles: Array.from({ length: 30 }, (_, i) => ({
        timestamp: (i + 1) * 60_000,
        open: 100,
        high: i === 29 ? 99 : 102,
        low: 98,
        close: 100,
        volume: 10,
      })),
    });
    expect(buildConditionalEntryScenarios(fixture)).toEqual([]);
  });

  it("rejects non-monotonic candle timestamps", () => {
    const fixture = resultFixture({
      candles: Array.from({ length: 30 }, (_, i) => ({
        timestamp: (i === 25 ? 24 : i + 1) * 60_000,
        open: 100,
        high: 102,
        low: 98,
        close: 100,
        volume: 10,
      })),
    });
    expect(buildConditionalEntryScenarios(fixture)).toEqual([]);
  });

  it("refuses to derive scenarios from insufficient candles", () => {
    const fixture = resultFixture({ candles: [] });
    expect(buildConditionalEntryScenarios(fixture)).toEqual([]);
  });
});
