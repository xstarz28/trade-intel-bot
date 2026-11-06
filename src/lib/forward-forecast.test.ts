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
      htfAlignment: { htfTimeframe: "W1", htfStructure: "HH/HL", state: "aligned" },
      technicalData: {
        htfContext: { timeframe: "W1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: 112_000, lastSwingLow: 94_000, dataPoints: 160 },
      } as AnalysisResult["technicalData"],
    }));
    expect(forecast.investor.status).toBe("CONDITIONAL");
    expect(forecast.investor.direction).toBe("bullish");
    expect(forecast.investor.entry?.price).toBe(100_000);
    expect(forecast.investor.accumulationReference?.price).toBe(94_000);
    expect(forecast.investor.objective?.price).toBe(112_000);
    expect(forecast.investor.invalidation?.price).toBe(94_000);
    expect(forecast.investor.potentialUpsidePct).toBeCloseTo(12);
    expect(forecast.investor.potentialDownsidePct).toBeCloseTo(6);
    expect(forecast.investor.potentialUpsideDownsideRatio).toBeCloseTo(2);
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
      keyLevels: { support: "N/A", resistance: "N/A", invalidation: "N/A" },
    }));
    expect(forecast.trader.status).toBe("UNAVAILABLE");
    expect(forecast.trader.entry).toBeUndefined();
    expect(forecast.trader.objective).toBeUndefined();
    expect(forecast.trader.invalidation).toBeUndefined();
    expect(forecast.trader.rewardRisk).toBeUndefined();
  });

  it("does not label a one-sided structural target as a conditional forecast", () => {
    const forecast = buildForwardForecast(baseResult({
      keyLevels: { support: "N/A", resistance: "105000", invalidation: "N/A" },
    }));
    expect(forecast.trader.status).toBe("UNAVAILABLE");
    expect(forecast.trader.objective).toBeUndefined();
    expect(forecast.trader.invalidation).toBeUndefined();
    expect(forecast.trader.limitations.join(" ")).toMatch(/invalidation level is unavailable/i);
  });

  it("does not publish an alternate conditional scenario without opposing invalidation", () => {
    const forecast = buildForwardForecast(baseResult({
      keyLevels: { support: "N/A", resistance: "105000", invalidation: "N/A" },
    }));
    expect(forecast.trader.alternateScenarios).toEqual([]);
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
      htfAlignment: { htfTimeframe: "W1", htfStructure: "HH/HL", state: "aligned" },
      technicalData: {
        htfContext: { timeframe: "W1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: 115, lastSwingLow: 90, dataPoints: 160 },
      } as AnalysisResult["technicalData"],
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
    });
    expect(forecast.investor.fundamentalOutlook.valuationReference?.upsidePct).toBeCloseTo(20);
    expect(forecast.investor.entry?.price).toBe(100);
    expect(forecast.investor.accumulationReference?.price).toBe(90);
    expect(forecast.investor.objective?.price).toBe(120);
    expect(forecast.investor.objective?.source).toBe("PROVIDER_INTRINSIC_VALUE");
    expect(forecast.investor.potentialUpsidePct).toBeCloseTo(20);
    expect(forecast.investor.potentialDownsidePct).toBeCloseTo(10);
    expect(forecast.investor.potentialUpsideDownsideRatio).toBeCloseTo(2);
    expect(forecast.investor.structuralUpsideDownsideRatio).toBeCloseTo(15 / 10);
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
    });
    expect(forecast.investor.fundamentalOutlook.valuationReference?.upsidePct).toBeCloseTo(15);
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
          category: "DERIVATIVES",
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
      category: "DERIVATIVES",
      asOf: timestamp - 60_000,
    });
    expect(forecast.investor.valuationStatus).toBe("NOT_AVAILABLE");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toBeUndefined();
  });

  it("does not publish a valuation reference when primary market data quality blocks the forecast", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      instrument: "AAPL",
      instrumentType: "stock",
      timestamp,
      priceSnapshot: { price: 100, timestamp: timestamp - 1_000, source: "test-provider" },
      dataQualityContext: { primaryData: { status: "STALE" } } as AnalysisResult["dataQualityContext"],
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
          },
          evidence: [],
          overallAvailability: "FULL",
          overallQuality: "VERIFIED",
          missingInformation: [],
          analystSummary: "Verified equity valuation context.",
        },
        evidence: [],
        overallAvailability: "FULL",
        overallQuality: "VERIFIED",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "AAPL fundamentals available.",
      } as AnalysisResult["universalIntelligenceContext"],
    }));
    expect(forecast.investor.status).toBe("BLOCKED_DATA_QUALITY");
    expect(forecast.investor.valuationStatus).toBe("NOT_AVAILABLE");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toBeUndefined();
  });

  it("respects provider-declared stale valuation even when its retrieval timestamp is recent", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      instrument: "AAPL",
      instrumentType: "stock",
      timestamp,
      priceSnapshot: { price: 100, timestamp: timestamp - 1_000, source: "test-provider" },
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
            freshness: "STALE",
            quality: "STALE",
            available: true,
            availableDatasets: 1,
            totalDatasets: 1,
            intrinsicValue: 120,
          },
          evidence: [],
          overallAvailability: "PARTIAL",
          overallQuality: "STALE",
          missingInformation: [],
          analystSummary: "Provider marked valuation stale.",
        },
        evidence: [],
        overallAvailability: "PARTIAL",
        overallQuality: "STALE",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "Stale equity valuation.",
      } as AnalysisResult["universalIntelligenceContext"],
    }));
    expect(forecast.investor.valuationStatus).toBe("STALE");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toBeUndefined();
  });

  it("includes fresh instrument-matched FX rates and carry evidence with source timestamps", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timestamp,
      priceSnapshot: { price: 1.08, timestamp: timestamp - 1_000, source: "test-provider" },
      universalIntelligenceContext: {
        instrument: "EUR/USD",
        assetClass: "forex",
        assembledAt: timestamp - 30_000,
        forex: {
          instrument: "EUR/USD",
          instrumentType: "forex",
          assembledAt: timestamp - 30_000,
          rates: { provider: "Central Bank Data", observedAt: timestamp - 60_000, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, rateDifferential: 0.5 },
          evidence: [],
          overallAvailability: "PARTIAL",
          overallQuality: "VERIFIED",
          missingInformation: [],
          analystSummary: "FX rate differential available.",
        },
        evidence: [{ source: "Central Bank Data", category: "RATES", direction: "SUPPORTING", strength: "MODERATE", quality: "VERIFIED", freshness: "FRESH", dependencyGroup: "MACRO_RATES", explanation: "Observed rate differential.", providerAvailable: true, assetClass: "forex", instrument: "EUR/USD" }],
        overallAvailability: "PARTIAL",
        overallQuality: "VERIFIED",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "EUR/USD macro intelligence available.",
      } as AnalysisResult["universalIntelligenceContext"],
    }));
    expect(forecast.investor.fundamentalOutlook.evidence).toMatchObject([{ category: "RATES", source: "Central Bank Data", asOf: timestamp - 60_000 }]);
    expect(forecast.investor.fundamentalOutlook.evidenceStatus).toBe("VERIFIED");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toBeUndefined();
  });

  it("includes fresh instrument-matched commodity inventory and supply-demand evidence", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timestamp,
      priceSnapshot: { price: 2_700, timestamp: timestamp - 1_000, source: "test-provider" },
      universalIntelligenceContext: {
        instrument: "XAU/USD",
        assetClass: "commodity",
        assembledAt: timestamp - 30_000,
        commodity: {
          instrument: "XAU/USD",
          instrumentType: "commodity",
          assembledAt: timestamp - 30_000,
          inventory: { provider: "Commodity Data", observedAt: timestamp - 90_000, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, currentInventory: 100 },
          evidence: [],
          overallAvailability: "PARTIAL",
          overallQuality: "VERIFIED",
          missingInformation: [],
          analystSummary: "Commodity inventory available.",
        },
        evidence: [{ source: "Commodity Data", category: "INVENTORY", direction: "SUPPORTING", strength: "MODERATE", quality: "VERIFIED", freshness: "FRESH", dependencyGroup: "COMMODITY_INVENTORY", explanation: "Observed inventory data.", providerAvailable: true, assetClass: "commodity", instrument: "XAU/USD" }],
        overallAvailability: "PARTIAL",
        overallQuality: "VERIFIED",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "Gold fundamental intelligence available.",
      } as AnalysisResult["universalIntelligenceContext"],
    }));
    expect(forecast.investor.fundamentalOutlook.evidence).toMatchObject([{ category: "INVENTORY", source: "Commodity Data", asOf: timestamp - 90_000 }]);
    expect(forecast.investor.fundamentalOutlook.evidenceStatus).toBe("VERIFIED");
    expect(forecast.investor.fundamentalOutlook.valuationReference).toBeUndefined();
  });


  it("keeps the long-term investor horizon independent of higher-timeframe chart selection", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      timeframe: "H4",
      htfAlignment: { htfTimeframe: "W1", htfStructure: "HH/HL", state: "aligned" },
      technicalData: {
        htfContext: { timeframe: "W1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: 120_000, lastSwingLow: 90_000, dataPoints: 160 },
      } as AnalysisResult["technicalData"],
      timestamp,
      priceSnapshot: { price: 100_000, timestamp: timestamp - 1_000, source: "test-provider" },
    }));
    expect(forecast.investor.horizon.label).toContain("1–3 years");
    expect(forecast.investor.horizon.endsAt - forecast.investor.horizon.startsAt).toBe(3 * 365 * 86_400_000);
  });

  it("publishes an accumulation zone only from a fresh validated higher-timeframe bullish order block", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      timeframe: "H4",
      timestamp,
      priceSnapshot: { price: 100_000, timestamp: timestamp - 1_000, source: "test-provider" },
      htfAlignment: { htfTimeframe: "W1", htfStructure: "HH/HL", state: "aligned" },
      technicalData: {
        htfContext: { timeframe: "W1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: 120_000, lastSwingLow: 90_000, dataPoints: 160 },
        mtf: {
          requestedTimeframe: "H4",
          chainUsed: ["W1", "H4"],
          unavailable: [],
          alignment: "ALIGNED_BULLISH",
          htfBias: "long",
          htfTimeframe: "W1",
          setupTimeframe: "H4",
          timeframes: [{
            timeframe: "W1",
            role: "macro",
            available: true,
            smc: {
              timeframe: "W1",
              liquidityPools: [],
              internalExternal: {
                external: { timeframe: "W1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", dataPoints: 160 },
                internal: { timeframe: "W1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", dataPoints: 160 },
                internalConflict: false,
              },
              fvgs: [],
              orderBlocks: [{
                direction: "bullish",
                lower: 92_000,
                upper: 96_000,
                timeframe: "W1",
                createdAt: timestamp - 10_000,
                status: "fresh",
                evidence: {
                  precedingOpposingCandle: true,
                  displacementAfter: true,
                  structuralBreakAfter: true,
                  displacementRangeAtr: 1.8,
                },
              }],
              vwap: { available: false, priceLocation: "unavailable" },
              volumeProfile: { available: false },
            },
          }],
        },
      } as unknown as AnalysisResult["technicalData"],
    }));
    expect(forecast.investor.accumulationZone).toMatchObject({
      lower: 92_000,
      upper: 96_000,
      timeframe: "W1",
      source: "validated_bullish_order_block",
    });
  });

  it("keeps bearish investment objective return negative while measuring invalidation distance positively", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      bias: "Bearish",
      timestamp,
      priceSnapshot: { price: 100, timestamp: timestamp - 1_000, source: "test-provider" },
      htfAlignment: { htfTimeframe: "W1", htfStructure: "LH/LL", state: "aligned" },
      technicalData: {
        htfContext: { timeframe: "W1", structure: "LH/LL", bosDirection: "bearish", chochDirection: "none", lastSwingHigh: 110, lastSwingLow: 80, dataPoints: 160 },
      } as AnalysisResult["technicalData"],
    }));
    expect(forecast.investor.direction).toBe("bearish");
    expect(forecast.investor.objective?.price).toBe(80);
    expect(forecast.investor.invalidation?.price).toBe(110);
    expect(forecast.investor.potentialUpsidePct).toBeCloseTo(-20);
    expect(forecast.investor.potentialDownsidePct).toBeCloseTo(10);
    expect(forecast.investor.potentialUpsideDownsideRatio).toBeCloseTo(2);
  });


  it("defaults investor analysis to a multi-year horizon independent of chart timeframe", () => {
    const shortChart = buildForwardForecast(baseResult({ timeframe: "H1" }));
    const weeklyChart = buildForwardForecast(baseResult({ timeframe: "W1" }));
    const expectedDuration = 3 * 365 * 24 * 60 * 60 * 1000;

    expect(shortChart.investor.horizon.label).toContain("1–3 years");
    expect(weeklyChart.investor.horizon.label).toContain("1–3 years");
    expect(shortChart.investor.horizon.endsAt - shortChart.investor.horizon.startsAt).toBe(expectedDuration);
    expect(weeklyChart.investor.horizon.endsAt - weeklyChart.investor.horizon.startsAt).toBe(expectedDuration);
    expect(shortChart.investor.horizon.basis).toContain("Three-year upper boundary");
  });

  it("supports an explicit open-ended 3+ year investor horizon", () => {
    const forecast = buildForwardForecast(baseResult(), { investorHorizon: "3+_YEARS" });

    expect(forecast.investor.horizon.label).toContain("3+ years");
    expect(forecast.investor.horizon.endBoundary).toBe("MINIMUM");
    expect(forecast.investor.horizon.basis).toContain("no fixed upper date");
    expect(forecast.investor.horizon.endsAt - forecast.investor.horizon.startsAt).toBe(3 * 365 * 24 * 60 * 60 * 1000);
  });

  it("honors shorter explicitly selected investor horizons without changing trader horizon", () => {
    const result = baseResult();
    const defaultForecast = buildForwardForecast(result);
    const shortForecast = buildForwardForecast(result, { investorHorizon: "1-4_WEEKS" });

    expect(shortForecast.investor.horizon.label).toContain("1–4 weeks");
    expect(shortForecast.investor.horizon.endsAt - shortForecast.investor.horizon.startsAt).toBe(28 * 24 * 60 * 60 * 1000);
    expect(shortForecast.trader.horizon).toEqual(defaultForecast.trader.horizon);
  });


  it("uses authoritative adaptive MTF structure instead of stale legacy HTF context", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      timeframe: "H4",
      timestamp,
      priceSnapshot: { price: 100_000, timestamp: timestamp - 1_000, source: "test" },
      htfAlignment: { htfTimeframe: "W1", htfStructure: "HH/HL", state: "aligned" },
      technicalData: {
        htfContext: {
          timeframe: "D1",
          structure: "LH/LL",
          bosDirection: "bearish",
          chochDirection: "none",
          lastSwingHigh: 105_000,
          lastSwingLow: 95_000,
          dataPoints: 80,
        },
        mtf: {
          requestedTimeframe: "H4",
          chainUsed: ["W1", "H4"],
          unavailable: [],
          alignment: "ALIGNED_BULLISH",
          htfBias: "long",
          htfTimeframe: "W1",
          setupTimeframe: "H4",
          timeframes: [{
            timeframe: "W1",
            role: "macro",
            available: true,
            smc: {
              timeframe: "W1",
              liquidityPools: [],
              internalExternal: {
                external: {
                  timeframe: "W1",
                  structure: "HH/HL",
                  bosDirection: "bullish",
                  chochDirection: "none",
                  lastSwingHigh: 125_000,
                  lastSwingLow: 88_000,
                  dataPoints: 160,
                },
                internal: {
                  timeframe: "W1",
                  structure: "HH/HL",
                  bosDirection: "bullish",
                  chochDirection: "none",
                  dataPoints: 160,
                },
              },
            } as unknown as NonNullable<NonNullable<AnalysisResult["technicalData"]>["mtf"]>["timeframes"][number]["smc"],
          }],
        },
      } as unknown as AnalysisResult["technicalData"],
    }));

    expect(forecast.investor.direction).toBe("bullish");
    expect(forecast.investor.objective?.price).toBe(125_000);
  });

  it("requires history proportional to the selected investment horizon", () => {
    const resultFor = (dataPoints: number) => baseResult({
      technicalData: {
        htfContext: {
          timeframe: "W1",
          structure: "HH/HL",
          bosDirection: "bullish",
          chochDirection: "none",
          lastSwingHigh: 112_000,
          lastSwingLow: 94_000,
          dataPoints,
        },
      } as AnalysisResult["technicalData"],
    });

    const shortHorizon = buildForwardForecast(resultFor(20), { investorHorizon: "1-4_WEEKS" });
    expect(shortHorizon.investor.status).toBe("CONDITIONAL");

    const longHorizonInsufficient = buildForwardForecast(resultFor(156), { investorHorizon: "1-3_YEARS" });
    expect(longHorizonInsufficient.investor.status).toBe("UNAVAILABLE");
    expect(longHorizonInsufficient.investor.objective).toBeUndefined();
    expect(longHorizonInsufficient.investor.limitations.join(" ")).toContain("enough completed history");

    const longHorizonSufficient = buildForwardForecast(resultFor(157), { investorHorizon: "1-3_YEARS" });
    expect(longHorizonSufficient.investor.status).toBe("CONDITIONAL");

    const openEndedInsufficient = buildForwardForecast(resultFor(156), { investorHorizon: "3+_YEARS" });
    expect(openEndedInsufficient.investor.status).toBe("UNAVAILABLE");
    const openEndedMinimumBoundary = buildForwardForecast(resultFor(157), { investorHorizon: "3+_YEARS" });
    expect(openEndedMinimumBoundary.investor.status).toBe("CONDITIONAL");
  });

  it("selects the highest available macro timeframe that satisfies the investment horizon", () => {
    const forecast = buildForwardForecast(baseResult({
      timeframe: "H4",
      technicalData: {
        mtf: {
          htfTimeframe: "D1",
          timeframes: [
            {
              timeframe: "D1",
              role: "structure",
              available: true,
              smc: {
                internalExternal: {
                  external: {
                    timeframe: "D1",
                    structure: "HH/HL",
                    bosDirection: "bullish",
                    chochDirection: "none",
                    lastSwingHigh: 112_000,
                    lastSwingLow: 94_000,
                    dataPoints: 300,
                  },
                },
              },
            },
            {
              timeframe: "W1",
              role: "macro",
              available: true,
              smc: {
                internalExternal: {
                  external: {
                    timeframe: "W1",
                    structure: "HH/HL",
                    bosDirection: "bullish",
                    chochDirection: "none",
                    lastSwingHigh: 125_000,
                    lastSwingLow: 88_000,
                    dataPoints: 160,
                  },
                },
              },
            },
          ],
        },
      } as unknown as AnalysisResult["technicalData"],
    }));

    expect(forecast.investor.status).toBe("CONDITIONAL");
    expect(forecast.investor.objective?.price).toBe(125_000);
  });

  it("does not label an investment thesis conditional without a valid invalidation", () => {
    const forecast = buildForwardForecast(baseResult({
      technicalData: {
        htfContext: {
          timeframe: "W1",
          structure: "HH/HL",
          bosDirection: "bullish",
          chochDirection: "none",
          lastSwingHigh: 112_000,
          lastSwingLow: 101_000,
          dataPoints: 160,
        },
      } as AnalysisResult["technicalData"],
    }));

    expect(forecast.investor.direction).toBe("bullish");
    expect(forecast.investor.objective?.price).toBe(112_000);
    expect(forecast.investor.invalidation).toBeUndefined();
    expect(forecast.investor.status).toBe("UNAVAILABLE");
    expect(forecast.investor.potentialUpsideDownsideRatio).toBeUndefined();
    expect(forecast.investor.limitations.join(" ")).toContain("complete investment reward/risk plan");
  });

  it("does not relabel primary-timeframe SMC as higher-timeframe investment structure", () => {
    const forecast = buildForwardForecast(baseResult({
      htfAlignment: undefined,
      technicalData: {
        structure: "HH/HL",
        smc: {
          internalExternal: {
            external: {
              timeframe: "H1",
              structure: "HH/HL",
              bosDirection: "bullish",
              chochDirection: "none",
              lastSwingHigh: 112_000,
              lastSwingLow: 94_000,
              dataPoints: 80,
            },
          },
        },
      } as AnalysisResult["technicalData"],
    }));

    expect(forecast.investor.direction).toBe("neutral");
    expect(forecast.investor.status).toBe("UNAVAILABLE");
    expect(forecast.investor.objective).toBeUndefined();
  });

  it("blocks trader and investor forecasts when the price snapshot is stale without provider quality metadata", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      timestamp,
      priceSnapshot: {
        price: 100_000,
        timestamp: timestamp - 4 * 60 * 60 * 1000,
        source: "provider-without-quality-metadata",
      },
      dataQualityContext: undefined,
    }));

    expect(forecast.trader.status).toBe("BLOCKED_DATA_QUALITY");
    expect(forecast.trader.entry).toBeUndefined();
    expect(forecast.trader.objective).toBeUndefined();
    expect(forecast.trader.rewardRisk).toBeUndefined();
    expect(forecast.investor.status).toBe("BLOCKED_DATA_QUALITY");
    expect(forecast.investor.entry).toBeUndefined();
    expect(forecast.investor.objective).toBeUndefined();
    expect(forecast.investor.potentialUpsideDownsideRatio).toBeUndefined();
    expect(forecast.trader.limitations.join(" ")).toContain("Primary market data is stale or does not meet quality requirements");
  });

  it("keeps snapshots within the three-bar freshness window eligible for normal validation", () => {
    const timestamp = 1_800_000_000_000;
    const forecast = buildForwardForecast(baseResult({
      timestamp,
      priceSnapshot: {
        price: 100_000,
        timestamp: timestamp - 3 * 60 * 60 * 1000,
        source: "fresh-enough-provider",
      },
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
    }));

    expect(forecast.trader.status).toBe("CONDITIONAL");
    expect(forecast.trader.rewardRisk).toBe(2);
  });

});
