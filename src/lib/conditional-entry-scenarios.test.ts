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
      timestamp: i * 60_000,
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
    expect(scenarios[0]).toMatchObject({ id: "bullish-breakout", direction: "long", trigger: 110.2, invalidation: 90, target: 120, ready: true });
    expect(scenarios[1]).toMatchObject({ id: "bearish-breakdown", direction: "short", trigger: 89.8, invalidation: 110, target: 80, ready: true });
    expect(scenarios.every((scenario) => (scenario.riskReward ?? 0) >= 1.5)).toBe(true);
  });

  it("does not invent targets when no farther observed swing exists", () => {
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

  it("refuses to derive scenarios from insufficient candles", () => {
    const fixture = resultFixture({ candles: [] });
    expect(buildConditionalEntryScenarios(fixture)).toEqual([]);
  });
});
