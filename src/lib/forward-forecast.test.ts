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
    expect(forecast.trader.alternateScenarios?.[0]).toMatchObject({
      direction: "bearish",
      objective: { price: 98_000 },
      invalidation: { price: 105_000 },
    });
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
    expect(forecast.investor.alternateScenarios?.[0]).toMatchObject({
      direction: "bearish",
      objective: { price: 94_000 },
      invalidation: { price: 112_000 },
    });
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

  it("keeps candle price provenance paired with the candle timestamp when snapshot price is absent", () => {
    const forecast = buildForwardForecast(baseResult({
      priceSnapshot: { price: Number.NaN, timestamp: 1_799_000_000_000, source: "missing-price" },
      candles: [{ timestamp: 1_799_998_000_000, open: 99_000, high: 101_000, low: 98_000, close: 100_500, volume: 10 }],
    }));
    expect(forecast.trader.horizon.startsAt).toBe(1_799_998_000_000);
    expect(forecast.trader.dataAsOf).toBe(1_799_998_000_000);
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
  it("surfaces a fresh, exact-instrument provider intrinsic-value reference without changing the structural thesis", () => {
    const timestamp = 1_800_000_000_000;
    const result = baseResult({
      instrument: "AAPL",
      instrumentType: "stock",
      timestamp,
      priceSnapshot: { price: 100, timestamp: timestamp - 1_000, source: "test-provider" },
      htfAlignment: { htfTimeframe: "D1", htfStructure: "HH/HL", state: "aligned" },
      universalIntelligenceContext: {
        instrument: "AAPL",
        assetClass: "equity",
        assembledAt: timestamp - 500,
        equity: {
          instrument: "AAPL",
          instrumentType: "equity",
          assembledAt: timestamp - 500,
          valuation: {
            provider: "Verified Valuation Provider",
            observedAt: timestamp - 60_000,
            freshness: "FRESH",
            quality: "VERIFIED",
            available: true,
            availableDatasets: 1,
            totalDatasets: 1,
            intrinsicValue: 120,
            relativeValuation: "undervalued",
          },
          evidence: [],
          overallAvailability: "FULL",
          overallQuality: "VERIFIED",
          missingInformation: [],
          analystSummary: "Verified equity valuation context.",
        },
        evidence: [{
          source: "Verified Valuation Provider",
          category: "VALUATION",
          direction: "SUPPORTING",
          strength: "MODERATE",
          quality: "VERIFIED",
          freshness: "FRESH",
          dependencyGroup: "EQUITY_VALUATION",
          explanation: "Provider-supplied valuation evidence.",
          providerAvailable: true,
          assetClass: "equity",
          instrument: "AAPL",
        }],
        overallAvailability: "FULL",
        overallQuality: "VERIFIED",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "AAPL fundamentals available.",
      } as AnalysisResult["universalIntelligenceContext"],
    });
    const forecast = buildForwardForecast(result);
    expect(forecast.investor.valuationStatus).toBe("AVAILABLE");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toMatchObject({
      kind: "PROVIDER_INTRINSIC_VALUE",
      price: 120,
      source: "Verified Valuation Provider",
      upsidePct: 20,
    });
    expect(forecast.investor.fundamentalOutlook.evidence).toHaveLength(1);
    expect(forecast.investor.direction).toBe("bullish");
    expect(result.recommendation).toBe("NO_TRADE");
  });

  it("rejects valuation and evidence belonging to a different instrument", () => {
    const timestamp = 1_800_000_000_000;
    const result = baseResult({
      instrument: "AAPL",
      instrumentType: "stock",
      timestamp,
      priceSnapshot: { price: 100, timestamp: timestamp - 1_000, source: "test-provider" },
      fundamentalData: {
        provider: "Alpha Vantage",
        timestamp: timestamp - 60_000,
        instrumentType: "stock",
        symbol: "MSFT",
        analystTargetPrice: 150,
        available: true,
      },
      universalIntelligenceContext: {
        instrument: "MSFT",
        assetClass: "equity",
        assembledAt: timestamp - 500,
        evidence: [{
          source: "Other instrument",
          category: "VALUATION",
          direction: "SUPPORTING",
          strength: "STRONG",
          quality: "VERIFIED",
          freshness: "FRESH",
          dependencyGroup: "EQUITY_VALUATION",
          explanation: "Evidence for MSFT only.",
          providerAvailable: true,
          assetClass: "equity",
          instrument: "MSFT",
        }],
        overallAvailability: "FULL",
        overallQuality: "VERIFIED",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "MSFT context.",
      } as AnalysisResult["universalIntelligenceContext"],
    });
    const forecast = buildForwardForecast(result);
    expect(forecast.investor.valuationStatus).toBe("NOT_AVAILABLE");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toBeUndefined();
    expect(forecast.investor.fundamentalOutlook.evidence).toHaveLength(0);
  });

  it("suppresses stale valuation references and stale fundamental evidence", () => {
    const timestamp = 1_800_000_000_000;
    const result = baseResult({
      instrument: "AAPL",
      instrumentType: "stock",
      timestamp,
      priceSnapshot: { price: 100, timestamp: timestamp - 1_000, source: "test-provider" },
      fundamentalData: {
        provider: "Alpha Vantage",
        timestamp: timestamp - 31 * 24 * 60 * 60 * 1000,
        instrumentType: "stock",
        symbol: "AAPL",
        analystTargetPrice: 120,
        available: true,
      },
      universalIntelligenceContext: {
        instrument: "AAPL",
        assetClass: "equity",
        assembledAt: timestamp - 31 * 24 * 60 * 60 * 1000,
        evidence: [{
          source: "Stale provider",
          category: "VALUATION",
          direction: "SUPPORTING",
          strength: "STRONG",
          quality: "STALE",
          freshness: "STALE",
          dependencyGroup: "EQUITY_VALUATION",
          explanation: "Stale evidence must not be used.",
          providerAvailable: true,
          assetClass: "equity",
          instrument: "AAPL",
        }],
        overallAvailability: "PARTIAL",
        overallQuality: "STALE",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "Stale context.",
      } as AnalysisResult["universalIntelligenceContext"],
    });
    const forecast = buildForwardForecast(result);
    expect(forecast.investor.valuationStatus).toBe("STALE");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toBeUndefined();
    expect(forecast.investor.fundamentalOutlook.evidence).toHaveLength(0);
  });

  it("labels a provider analyst target as consensus rather than intrinsic value", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      instrument: "AAPL",
      instrumentType: "stock",
      timestamp,
      priceSnapshot: { price: 100, timestamp: timestamp - 1_000, source: "test-provider" },
      fundamentalData: {
        provider: "Alpha Vantage",
        timestamp: timestamp - 60_000,
        instrumentType: "stock",
        symbol: "AAPL",
        analystTargetPrice: 115,
        available: true,
      },
    }));
    expect(forecast.investor.valuationStatus).toBe("AVAILABLE");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toMatchObject({
      kind: "ANALYST_CONSENSUS_TARGET",
      price: 115,
      source: "Alpha Vantage",
      upsidePct: 15,
    });
    expect(forecast.investor.fundamentalOutlook.valuationReference?.description).toMatch(/not intrinsic value/i);
  });

  it("includes fresh instrument-matched crypto fundamentals but never turns them into a price target", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      instrument: "ETH/USD",
      instrumentType: "crypto",
      timestamp,
      priceSnapshot: { price: 3_000, timestamp: timestamp - 1_000, source: "test-provider" },
      cryptoIntelligenceContext: {
        instrument: "ETH/USD",
        instrumentType: "crypto",
        assembledAt: timestamp - 30_000,
        derivatives: {
          provider: "CoinGlass",
          observedAt: timestamp - 60_000,
          freshness: "FRESH",
          quality: "VERIFIED",
          available: true,
          availableDatasets: 1,
          totalDatasets: 1,
        },
        evidence: [{
          source: "CoinGlass",
          category: "DERIVATIVES_POSITIONING",
          direction: "NEUTRAL",
          strength: "WEAK",
          quality: "VERIFIED",
          freshness: "FRESH",
          dependencyGroup: "DERIVATIVES_POSITIONING",
          explanation: "Positioning is contextual.",
          providerAvailable: true,
        }],
        overallAvailability: "PARTIAL",
        overallQuality: "VERIFIED",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "Crypto intelligence available.",
      } as AnalysisResult["cryptoIntelligenceContext"],
    }));
    expect(forecast.investor.fundamentalOutlook.evidenceStatus).toBe("VERIFIED");
    expect(forecast.investor.fundamentalOutlook.evidence[0]).toMatchObject({
      source: "CoinGlass",
      category: "DERIVATIVES_POSITIONING",
      asOf: timestamp - 60_000,
    });
    expect(forecast.investor.valuationStatus).toBe("NOT_AVAILABLE");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toBeUndefined();
  });

});
