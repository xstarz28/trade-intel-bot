import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types/analysis";
import { buildForwardForecast } from "./forward-forecast";

function baseResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: "forecast-test",
    instrument: "BTCUSDT",
    instrumentType: "crypto",
    timeframe: "H1",
    bias: "Bullish",
    confidence: 55,
    recommendation: "NO_TRADE",
    noTradeReasons: ["Await confirmation"],
    tradingStyle: "intraday",
    technicalSummary: "Bullish structure",
    fundamentalSummary: "No valuation data",
    breakdown: { trend: 1, indicator: 1, fundamental: 0, sentiment: 0 },
    keyLevels: { support: "98,000", resistance: "105,000", invalidation: "97,500" },
    riskNote: "Conditional",
    dataCompleteness: "full",
    dataFlags: [],
    timestamp: 1_800_000_000_000,
    priceSnapshot: { price: 100_000, timestamp: 1_799_999_000_000, source: "test-provider" },
    ...overrides,
  } as AnalysisResult;
}

describe("Phase 46 — forward forecast contract", () => {
  it("uses the existing projected plan and keeps it conditional", () => {
    const result = baseResult({
      projectedTradePlan: {
        direction: "long",
        entry: "100000",
        entryBasis: "Breakout retest",
        stopLoss: "98000",
        slBasis: "Retest swing low",
        takeProfit: "104000",
        tpBasis: "Prior external high",
        riskReward: 2,
      },
    });
    const forecast = buildForwardForecast(result);
    expect(forecast.trader.status).toBe("CONDITIONAL");
    expect(forecast.trader.entry?.price).toBe(100_000);
    expect(forecast.trader.objective?.price).toBe(104_000);
    expect(forecast.trader.invalidation?.price).toBe(98_000);
    expect(forecast.trader.rewardRisk).toBe(2);
    expect(result.recommendation).toBe("NO_TRADE");
    expect(forecast.trader.limitations.join(" ")).toMatch(/not an order/i);
    expect(forecast.trader.calibration).toBe("UNVALIDATED");
  });

  it("creates explicit future time windows from the observed data timestamp", () => {
    const forecast = buildForwardForecast(baseResult());
    expect(forecast.trader.horizon.startsAt).toBe(1_799_999_000_000);
    expect(forecast.trader.horizon.endsAt).toBeGreaterThan(forecast.trader.horizon.startsAt);
    expect(forecast.investor.horizon.endsAt).toBeGreaterThan(forecast.trader.horizon.endsAt);
  });

  it("does not invent an entry, objective, or R:R when no validated plan exists", () => {
    const forecast = buildForwardForecast(baseResult({
      bias: "Neutral",
      keyLevels: { support: "N/A", resistance: "N/A", invalidation: "N/A" },
    }));
    expect(forecast.trader.status).toBe("UNAVAILABLE");
    expect(forecast.trader.direction).toBe("neutral");
    expect(forecast.trader.entry).toBeUndefined();
    expect(forecast.trader.objective).toBeUndefined();
    expect(forecast.trader.rewardRisk).toBeUndefined();
  });

  it("uses higher-timeframe swing levels for investor scenarios only", () => {
    const forecast = buildForwardForecast(baseResult({
      htfAlignment: { htfTimeframe: "D1", htfStructure: "HH/HL", state: "aligned" },
      technicalData: {
        htfContext: { timeframe: "D1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: 112_000, lastSwingLow: 94_000, dataPoints: 80 },
      } as AnalysisResult["technicalData"],
    }));
    expect(forecast.investor.status).toBe("CONDITIONAL");
    expect(forecast.investor.direction).toBe("bullish");
    expect(forecast.investor.objective?.price).toBe(112_000);
    expect(forecast.investor.invalidation?.price).toBe(94_000);
    expect(forecast.investor.structuralUpsideDownsideRatio).toBeCloseTo(12_000 / 6_000);
    expect(forecast.investor.valuationStatus).toBe("NOT_AVAILABLE");
  });

  it("suppresses numeric forecasts when primary data quality is stale", () => {
    const forecast = buildForwardForecast(baseResult({
      dataQualityContext: {
        primaryData: { status: "STALE" },
      } as AnalysisResult["dataQualityContext"],
      tradePlan: {
        direction: "long",
        entry: "100000",
        entryBasis: "confirmed",
        stopLoss: "98000",
        slBasis: "swing low",
        takeProfit: "104000",
        tpBasis: "swing high",
        riskReward: 2,
      },
    }));
    expect(forecast.trader.status).toBe("BLOCKED_DATA_QUALITY");
    expect(forecast.trader.entry).toBeUndefined();
    expect(forecast.investor.status).toBe("BLOCKED_DATA_QUALITY");
  });

  it("rejects malformed or directionally inconsistent trade-plan geometry", () => {
    const forecast = buildForwardForecast(baseResult({
      tradePlan: {
        direction: "long",
        entry: "100000",
        entryBasis: "confirmed",
        stopLoss: "101000",
        slBasis: "above entry",
        takeProfit: "104000",
        tpBasis: "target",
        riskReward: 3,
      },
    }));
    expect(forecast.trader.status).toBe("CONDITIONAL");
    expect(forecast.trader.entry).toBeUndefined();
    expect(forecast.trader.rewardRisk).toBeUndefined();
  });

  it("does not issue an investor direction without higher-timeframe structure", () => {
    const forecast = buildForwardForecast(baseResult({ htfAlignment: undefined, technicalData: undefined }));
    expect(forecast.investor.direction).toBe("neutral");
    expect(forecast.investor.status).toBe("UNAVAILABLE");
    expect(forecast.investor.objective).toBeUndefined();
    expect(forecast.investor.structuralUpsideDownsideRatio).toBeUndefined();
  });

  it("does not publish a key level on the wrong side of spot", () => {
    const forecast = buildForwardForecast(baseResult({
      keyLevels: { support: "101000", resistance: "99000", invalidation: "102000" },
    }));
    expect(forecast.trader.objective).toBeUndefined();
    expect(forecast.trader.status).toBe("UNAVAILABLE");
  });
});
