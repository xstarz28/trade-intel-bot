import { describe, expect, it } from "vitest";
import { buildCandidateFromSource, findLiveSnapshotForInstrument } from "./liveCandidateBuilder";
import { buildRadarCandidate, toRadarCandidateSource } from "./market-radar/candidate-builder";

describe("Phase 153 — Live Candidate Builder integrity", () => {
  it("never substitutes a different quote or contract with the same base asset", () => {
    const nativeSource = {
      instrument: "BTC-USDT-SWAP",
      assetClass: "crypto" as const,
      providerNative: {
        provider: "okx",
        providerInstrumentId: "BTC-USDT-SWAP",
      },
    };
    const liveSources = new Map([[nativeSource.instrument, nativeSource]]);

    expect(findLiveSnapshotForInstrument(liveSources, "BTC/USD")).toBeUndefined();
    expect(findLiveSnapshotForInstrument(liveSources, "BTC-USDT-SWAP")).toBe(nativeSource);
  });

  it("uses verified market snapshot as the candidate price and data source", () => {
    const now = Date.now();

    const candidate = buildCandidateFromSource({
      instrument: "BTC/USD",
      assetClass: "crypto",
      marketData: {
        instrument: "BTC/USD",
        instrumentType: "crypto",
        provider: "twelve-data",
        fetchTimestamp: now,
        price: {
          price: 100000,
          timestamp: now,
          source: "twelve-data",
        },
        candles: Array.from({ length: 210 }, (_, i) => ({
          time: now - i * 60_000,
          timestamp: now - i * 60_000,
          open: 100000,
          high: 100100,
          low: 99900,
          close: 100000,
          volume: 1,
        })),
        timeframe: "H1",
        higherTimeframe: "H4",
        dataFreshness: "delayed",
      },
    });

    expect(candidate.instrument).toBe("BTC/USD");
    expect(candidate.currentPrice).toBe(100000);
    expect(candidate.dataPoints).toBe(210);
    expect(candidate.hasLiveData).toBe(true);
    expect(candidate.freshness).toBe("DELAYED");
    expect(candidate.providerCoverage).toBe("PARTIAL");
  });

  it.each([
    ["stale", "STALE"],
    ["unavailable", "UNAVAILABLE"],
  ] as const)(
    "does not promote provider-reported %s data because retrieval timestamp is recent",
    (providerFreshness, expectedFreshness) => {
      const now = Date.now();
      const candidate = buildCandidateFromSource({
        instrument: "BTC/USD",
        assetClass: "crypto",
        marketData: {
          instrument: "BTC/USD",
          instrumentType: "crypto",
          provider: "fixture",
          fetchTimestamp: now,
          price: { price: 100000, timestamp: now, source: "fixture" },
          candles: [],
          timeframe: "H1",
          dataFreshness: providerFreshness,
        },
      });

      expect(candidate.freshness).toBe(expectedFreshness);
      expect(candidate.hasLiveData).toBe(false);
    },
  );

  it("derives technical evidence from provider OHLCV when no precomputed technical payload exists", () => {
    const now = Date.now();
    const candles = Array.from({ length: 210 }, (_, i) => {
      const close = 100 + (210 - i) * 0.5;
      return {
        time: now - i * 60_000,
        timestamp: now - i * 60_000,
        open: close - 0.2,
        high: close + 0.5,
        low: close - 0.5,
        close,
        volume: 1000,
      };
    });

    const candidate = buildCandidateFromSource({
      instrument: "BTC/USD",
      assetClass: "crypto",
      marketData: {
        instrument: "BTC/USD",
        instrumentType: "crypto",
        provider: "okx",
        fetchTimestamp: now,
        price: { price: candles[0].close, timestamp: now, source: "okx" },
        candles,
        timeframe: "H1",
        higherTimeframe: "H4",
        dataFreshness: "realtime",
      },
    });

    expect(candidate.dataCompleteness).toBe("PARTIAL");
    expect(candidate.dataPoints).toBe(210);
    expect(candidate.setupDirection).not.toBe("unknown");
    expect(candidate.setupStrength).toBeGreaterThan(0);
  });

  it("differentiates neutral setup strength using observed RSI and volume context", () => {
    const now = Date.now();
    const build = (rsi14: number, volumeTrend: "stable" | "increasing") =>
      buildCandidateFromSource({
        instrument: "TEST-USDT",
        assetClass: "crypto",
        marketData: {
          instrument: "TEST-USDT",
          instrumentType: "crypto",
          provider: "okx",
          fetchTimestamp: now,
          price: { price: 100, timestamp: now, source: "okx" },
          candles: Array.from({ length: 100 }, (_, i) => ({
            timestamp: now - (100 - i) * 60_000,
            time: now - (100 - i) * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1000,
          })),
          timeframe: "H1",
          higherTimeframe: "H4",
          dataFreshness: "realtime",
        },
        technicalData: {
          rsi14,
          structure: "range",
          bosDirection: "none",
          chochDirection: "none",
          swingHighs: [101],
          swingLows: [99],
          supportLevels: [99],
          resistanceLevels: [101],
          volumeTrend,
          dataPoints: 100,
        },
      });

    const quiet = build(50, "stable");
    const active = build(70, "increasing");

    expect(quiet.setupDirection).toBe("neutral");
    expect(active.setupDirection).toBe("neutral");
    expect(active.setupStrength ?? 0).toBeGreaterThan(quiet.setupStrength ?? 0);
    expect(active.confluenceCount ?? 0).toBeGreaterThan(quiet.confluenceCount ?? 0);
  });

  it.each([
    ["bullish", "long"],
    ["bearish", "short"],
  ] as const)(
    "uses a %s break of structure when market structure is ranging",
    (bosDirection, expectedDirection) => {
      const now = Date.now();
      const candles = Array.from({ length: 100 }, (_, i) => ({
        timestamp: now - (100 - i) * 60_000,
        time: now - (100 - i) * 60_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      }));
      const candidate = buildCandidateFromSource({
        instrument: "TEST-USDT",
        assetClass: "crypto",
        marketData: {
          instrument: "TEST-USDT",
          instrumentType: "crypto",
          provider: "okx",
          fetchTimestamp: now,
          price: { price: 100, timestamp: now, source: "okx" },
          candles,
          timeframe: "H1",
          higherTimeframe: "H4",
          dataFreshness: "realtime",
        },
        technicalData: {
          swingHighs: [101, 102, 103],
          swingLows: [97, 98, 99],
          structure: "range",
          bosDirection,
          chochDirection: "none",
          supportLevels: [99],
          resistanceLevels: [103],
          volumeTrend: "stable",
          dataPoints: 100,
        },
      });

      expect(candidate.setupDirection).toBe(expectedDirection);
      expect(candidate.setupStrength).toBeGreaterThan(35);
      expect(candidate.confluenceCount).toBeGreaterThan(1);
    },
  );

  it("passes verified technical structure and derivatives into the radar source", () => {
    const now = Date.now();
    const source = {
      instrument: "BTC-USDT-SWAP",
      assetClass: "crypto" as const,
      marketData: {
        instrument: "BTC-USDT-SWAP",
        instrumentType: "crypto" as const,
        provider: "okx",
        fetchTimestamp: now,
        price: { price: 100_000, timestamp: now, source: "okx" },
        candles: [{
          time: now,
          timestamp: now,
          open: 99_900,
          high: 100_100,
          low: 99_800,
          close: 100_000,
          volume: 12,
        }],
        timeframe: "H1" as const,
        dataFreshness: "realtime" as const,
      },
      technicalData: {
        structure: "HH/HL" as const,
        mtf: { htfBias: "long" as const, alignment: "ALIGNED_BULLISH" as const },
        atr14: 250,
        dataPoints: 1,
      } as any,
      derivativesData: {
        provider: "fixture",
        symbol: "BTC-USDT-SWAP",
        timestamp: now,
        freshness: "realtime" as const,
        availability: {
          openInterest: true,
          fundingRate: true,
          longShort: false,
          liquidations: true,
        },
        confidence: "high" as const,
        fundingRate: { currentRate: 0.0001 },
        openInterest: { current: 500_000_000 },
        liquidations: { totalVolume: 1_000_000 },
      },
    };

    const radarSource = toRadarCandidateSource(source);
    expect(radarSource.snapshot?.htfBias).toBe("long");
    expect(radarSource.snapshot?.marketRegime).toBe("TRENDING");
    expect(radarSource.snapshot?.mtfAlignment).toBe("ALIGNED_BULLISH");
    expect(radarSource.derivatives?.fundingRate).toBe(0.0001);
    expect(radarSource.derivatives?.openInterest).toBe(500_000_000);
    expect(radarSource.derivatives?.liquidationVolume).toBe(1_000_000);
    expect(buildRadarCandidate(radarSource, now).dataCompleteness).toBe("FULL");
  });

  it("does not treat historical analysis alone as live market data", () => {
    const candidate = buildCandidateFromSource({
      instrument: "BTC/USD",
      assetClass: "crypto",
      analysisResult: {
        instrument: "BTC/USD",
        instrumentType: "crypto",
        timestamp: Date.now(),
        confidence: 80,
        bias: "Bullish",
        recommendation: "BUY",
      } as any,
    });

    expect(candidate.currentPrice).toBe(0);
    expect(candidate.hasLiveData).toBe(false);
    expect(candidate.freshness).toBe("UNAVAILABLE");
    expect(candidate.dataPoints).toBe(0);
  });




  it("rejects market snapshots whose instrument identity differs from the candidate", () => {
    const now = Date.now();
    const candidate = buildCandidateFromSource({
      instrument: "BTC/USD",
      assetClass: "crypto",
      marketData: {
        instrument: "ETH/USD", instrumentType: "crypto", provider: "fixture",
        fetchTimestamp: now,
        price: { price: 3000, timestamp: now, source: "fixture" },
        candles: [{ timestamp: now, open: 2990, high: 3010, low: 2980, close: 3000, volume: 1 }],
        timeframe: "H1", dataFreshness: "realtime",
      },
    });

    expect(candidate.currentPrice).toBe(0);
    expect(candidate.dataPoints).toBe(0);
    expect(candidate.hasLiveData).toBe(false);
    expect(candidate.freshness).toBe("UNAVAILABLE");
    expect(candidate.dataCompleteness).toBe("NONE");
  });




  it("rejects derivatives and COT context for a different instrument", () => {
    const now = Date.now();
    const cryptoCandidate = buildCandidateFromSource({
      instrument: "BTC/USD",
      assetClass: "crypto",
      marketData: {
        instrument: "BTC/USD", instrumentType: "crypto", provider: "fixture",
        fetchTimestamp: now,
        price: { price: 100000, timestamp: now, source: "fixture" },
        candles: [{ timestamp: now, open: 99900, high: 100100, low: 99800, close: 100000, volume: 1 }],
        timeframe: "H1", dataFreshness: "realtime",
      },
      derivativesData: {
        provider: "fixture", symbol: "ETH/USD", timestamp: now, freshness: "realtime",
        availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
        confidence: "high",
        openInterest: { current: 123456 },
        fundingRate: { currentRate: 0.01 },
      } as any,
    });
    expect(cryptoCandidate.hasDerivatives).toBe(false);
    expect(cryptoCandidate.openInterest).toBeUndefined();
    expect(cryptoCandidate.fundingRate).toBeUndefined();

    const forexCandidate = buildCandidateFromSource({
      instrument: "EUR/USD",
      assetClass: "forex",
      marketData: {
        instrument: "EUR/USD", instrumentType: "forex", provider: "fixture",
        fetchTimestamp: now,
        price: { price: 1.1, timestamp: now, source: "fixture" },
        candles: [{ timestamp: now, open: 1.09, high: 1.11, low: 1.08, close: 1.1, volume: 1 }],
        timeframe: "H1", dataFreshness: "realtime",
      },
      cotData: {
        available: true,
        requestedInstrument: "GBP/USD",
        source: "fixture",
        fetchedAt: now,
        freshness: "FRESH",
        netNonCommercial: 999,
      } as any,
    });
    expect(forexCandidate.hasCOT).toBe(false);
    expect(forexCandidate.cotNet).toBeUndefined();
  });

  it("carries universal forex and commodity context into radar recommendation candidates", () => {
    const now = Date.now();
    const forexSource = toRadarCandidateSource({
      instrument: "EUR/USD",
      assetClass: "forex",
      marketData: {
        instrument: "EUR/USD", instrumentType: "forex", provider: "fixture",
        fetchTimestamp: now,
        price: { price: 1.1, timestamp: now, source: "fixture" },
        candles: [{ timestamp: now, open: 1.09, high: 1.11, low: 1.08, close: 1.1, volume: 10 }],
        timeframe: "H1", dataFreshness: "realtime",
      },
      analysisResult: {
        instrument: "EUR/USD",
        instrumentType: "forex",
        timestamp: now,
        confidence: 75,
        bias: "Bullish",
        recommendation: "BUY",
        breakdown: { trend: 1, indicator: 1, fundamental: 1, sentiment: -1 },
        fundamentalData: { available: true },
      } as any,
      universalIntelligence: {
        instrument: "EUR/USD", assetClass: "forex", assembledAt: now,
        forex: {
          instrument: "EUR/USD", instrumentType: "forex", assembledAt: now,
          rates: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, rateDifferential: 1.25 },
          yields: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, yieldDifferential: 0.8 },
          positioning: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, nonCommercialNet: 4200 },
          evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], analystSummary: "fixture",
        },
        crossAsset: {
          assembledAt: now,
          dxy: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, trend: "falling" },
          riskRegime: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, regime: "risk_on" },
          evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], analystSummary: "fixture",
        },
        evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], dataFlags: [], analystSummary: "fixture",
      } as any,
    });
    const forexCandidate = buildRadarCandidate(forexSource, now);
    expect(forexCandidate.rateDifferential).toBe(1.25);
    expect(forexCandidate.yieldDifferential).toBe(0.8);
    expect(forexCandidate.cotNet).toBe(4200);
    expect(forexCandidate.dxyTrend).toBe("falling");
    expect(forexCandidate.riskRegime).toBe("risk_on");
    expect(forexCandidate.fundamentalScore).toBe(1);
    expect(forexCandidate.positioningScore).toBe(-1);
    expect(forexCandidate.fundamentalEvidenceAvailable).toBe(true);

    const commoditySource = toRadarCandidateSource({
      instrument: "WTI",
      assetClass: "commodity",
      marketData: {
        instrument: "WTI", instrumentType: "commodity", provider: "fixture",
        fetchTimestamp: now,
        price: { price: 75, timestamp: now, source: "fixture" },
        candles: [{ timestamp: now, open: 74, high: 76, low: 73, close: 75, volume: 100 }],
        timeframe: "H1", dataFreshness: "realtime",
      },
      universalIntelligence: {
        instrument: "WTI", assetClass: "commodity", assembledAt: now,
        commodity: {
          instrument: "WTI", instrumentType: "commodity", assembledAt: now,
          inventory: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, currentInventory: 420, changeWeekly: -8 },
          futuresStructure: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, structure: "backwardation" },
          positioning: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, managedMoneyNet: 1234 },
          evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], analystSummary: "fixture",
        },
        evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], dataFlags: [], analystSummary: "fixture",
      } as any,
    });
    const commodityCandidate = buildRadarCandidate(commoditySource, now);
    expect(commodityCandidate.inventory).toBe(420);
    expect(commodityCandidate.inventoryChange).toBe(-8);
    expect(commodityCandidate.futuresStructure).toBe("backwardation");
    expect(commodityCandidate.cotNet).toBe(1234);
  });

  it("does not pass mismatched market or analysis identities into radar candidates", () => {
    const now = Date.now();
    const radarSource = toRadarCandidateSource({
      instrument: "BTC/USD",
      assetClass: "crypto",
      marketData: {
        instrument: "ETH/USD", instrumentType: "crypto", provider: "fixture",
        fetchTimestamp: now,
        price: { price: 3000, timestamp: now, source: "fixture" },
        candles: [{ timestamp: now, open: 2990, high: 3010, low: 2980, close: 3000, volume: 1 }],
        timeframe: "H1", dataFreshness: "realtime",
      },
      analysisResult: {
        instrument: "ETH/USD",
        instrumentType: "crypto",
        timestamp: now,
        confidence: 99,
        bias: "Bullish",
        recommendation: "BUY",
      } as any,
    });

    expect(radarSource.universe.instrument).toBe("BTC/USD");
    expect(radarSource.snapshot).toBeNull();
    expect(radarSource.analysisResult).toBeUndefined();
  });

  it("never borrows price or analysis confidence from a different instrument", () => {
    const candidate = buildCandidateFromSource({
      instrument: "BTC/USD",
      assetClass: "crypto",
      analysisResult: {
        instrument: "ETH/USD",
        instrumentType: "crypto",
        timestamp: Date.now(),
        priceSnapshot: { price: 3000, timestamp: Date.now(), source: "fixture" },
        confidence: 99,
        bias: "Bullish",
        recommendation: "BUY",
      } as any,
    });

    expect(candidate.currentPrice).toBe(0);
    expect(candidate.hasAnalysis).toBe(false);
    expect(candidate.analysisConfidence).toBeUndefined();
    expect(candidate.freshness).toBe("UNAVAILABLE");
    expect(candidate.dataCompleteness).toBe("NONE");
  });

  it("produces identical technical setup when provider candles arrive newest-first or oldest-first", () => {
    const now = Date.now();
    const chronological = Array.from({ length: 210 }, (_, i) => {
      const close = 100 + i * 0.25 + Math.sin(i / 7);
      return {
        timestamp: now - (210 - i) * 60_000,
        open: close - 0.1,
        high: close + 0.4,
        low: close - 0.4,
        close,
        volume: 100 + i,
      };
    });
    const build = (candles: typeof chronological) => buildCandidateFromSource({
      instrument: "BTC/USD",
      assetClass: "crypto",
      marketData: {
        instrument: "BTC/USD", instrumentType: "crypto", provider: "fixture",
        fetchTimestamp: now,
        price: { price: chronological[chronological.length - 1].close, timestamp: now, source: "fixture" },
        candles,
        timeframe: "H1", dataFreshness: "realtime",
      },
    });

    const oldestFirst = build(chronological);
    const newestFirst = build([...chronological].reverse());
    expect(newestFirst.setupDirection).toBe(oldestFirst.setupDirection);
    expect(newestFirst.setupStrength).toBe(oldestFirst.setupStrength);
    expect(newestFirst.htfBias).toBe(oldestFirst.htfBias);
    expect(newestFirst.keySupport).toBe(oldestFirst.keySupport);
    expect(newestFirst.keyResistance).toBe(oldestFirst.keyResistance);
  });

  it("maps available universal forex and cross-asset intelligence into ranking inputs", () => {
    const now = Date.now();
    const candidate = buildCandidateFromSource({
      instrument: "EUR/USD", assetClass: "forex",
      marketData: { instrument: "EUR/USD", instrumentType: "forex", provider: "fixture", fetchTimestamp: now, price: { price: 1.1, timestamp: now, source: "fixture" }, candles: [{ timestamp: now, open: 1.09, high: 1.11, low: 1.08, close: 1.1, volume: 10 }], timeframe: "H1", dataFreshness: "realtime" },
      universalIntelligence: {
        instrument: "EUR/USD", assetClass: "forex", assembledAt: now,
        forex: {
          instrument: "EUR/USD", instrumentType: "forex", assembledAt: now,
          rates: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, rateDifferential: -1.25 },
          yields: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, yieldDifferential: -0.8 },
          positioning: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, nonCommercialNet: 4200 },
          crossAsset: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, dxyTrend: "rising", riskRegime: "risk_off" },
          evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], analystSummary: "fixture",
        },
        crossAsset: {
          assembledAt: now,
          dxy: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, trend: "falling" },
          riskRegime: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, regime: "risk_on" },
          evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], analystSummary: "fixture",
        },
        evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], dataFlags: [], analystSummary: "fixture",
      } as any,
    });
    expect(candidate.rateDifferential).toBe(-1.25);
    expect(candidate.yieldDifferential).toBe(-0.8);
    expect(candidate.cotNet).toBe(4200);
    expect(candidate.hasCOT).toBe(true);
    expect(candidate.dxyTrend).toBe("falling");
    expect(candidate.riskRegime).toBe("risk_on");
  });

  it("maps available universal equity fundamentals into ranking inputs", () => {
    const now = Date.now();
    const candidate = buildCandidateFromSource({
      instrument: "AAPL", assetClass: "equity",
      marketData: { instrument: "AAPL", instrumentType: "stock", provider: "fixture", fetchTimestamp: now, price: { price: 250, timestamp: now, source: "fixture" }, candles: [{ timestamp: now, open: 249, high: 251, low: 248, close: 250, volume: 100 }], timeframe: "H1", dataFreshness: "realtime" },
      universalIntelligence: {
        instrument: "AAPL", assetClass: "equity", assembledAt: now,
        equity: {
          instrument: "AAPL", instrumentType: "stock", assembledAt: now,
          fundamentals: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, peRatio: 31, revenueGrowth: 0.12, profitMargin: 0.24, marketCap: 3000000000000 },
          evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], analystSummary: "fixture",
        },
        evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], dataFlags: [], analystSummary: "fixture",
      } as any,
    });
    expect(candidate.hasFundamentals).toBe(true);
    expect(candidate.fundamentalEvidenceAvailable).toBe(false); // raw fundamentals are not signed directional evidence
    expect(candidate.peRatio).toBe(31);
    expect(candidate.revenueGrowth).toBe(0.12);
    expect(candidate.profitMargin).toBe(0.24);
    expect(candidate.marketCap).toBe(3000000000000);
  });

  it("maps available universal commodity inventory, positioning, and futures structure", () => {
    const now = Date.now();
    const candidate = buildCandidateFromSource({
      instrument: "WTI", assetClass: "commodity",
      marketData: { instrument: "WTI", instrumentType: "commodity", provider: "fixture", fetchTimestamp: now, price: { price: 75, timestamp: now, source: "fixture" }, candles: [{ timestamp: now, open: 74, high: 76, low: 73, close: 75, volume: 100 }], timeframe: "H1", dataFreshness: "realtime" },
      universalIntelligence: {
        instrument: "WTI", assetClass: "commodity", assembledAt: now,
        commodity: {
          instrument: "WTI", instrumentType: "commodity", assembledAt: now,
          inventory: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, currentInventory: 420, changeWeekly: -8 },
          futuresStructure: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, structure: "backwardation" },
          positioning: { provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, managedMoneyNet: 1234 },
          evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], analystSummary: "fixture",
        },
        evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED", missingInformation: [], dataFlags: [], analystSummary: "fixture",
      } as any,
    });
    expect(candidate.inventory).toBe(420);
    expect(candidate.inventoryChange).toBe(-8);
    expect(candidate.futuresStructure).toBe("backwardation");
    expect(candidate.cotNet).toBe(1234);
    expect(candidate.hasCOT).toBe(true);
  });

  it("never applies petroleum inventory to non-oil commodities", () => {
    const now = Date.now();
    const eiaData = {
      available: true,
      source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)",
      fetchedAt: now,
      freshness: "FRESH",
      series: [{ productId: "EPC0", observationDate: "2026-10-07", latestValue: 420, change: -8 }],
      failedLegs: [],
    } as any;
    const source = {
      instrument: "XAU/USD",
      assetClass: "commodity" as const,
      eiaData,
    };
    const live = buildCandidateFromSource(source);
    const radar = toRadarCandidateSource(source);
    expect(live.inventory).toBeUndefined();
    expect(live.inventoryChange).toBeUndefined();
    expect(radar.eia).toBeUndefined();
  });

  it("rejects universal intelligence with a mismatched asset class even when symbol matches", () => {
    const now = Date.now();
    const candidate = buildCandidateFromSource({
      instrument: "AAPL",
      assetClass: "equity",
      marketData: {
        instrument: "AAPL", instrumentType: "stock", provider: "fixture",
        fetchTimestamp: now,
        price: { price: 250, timestamp: now, source: "fixture" },
        candles: [{ timestamp: now, open: 249, high: 251, low: 248, close: 250, volume: 100 }],
        timeframe: "H1", dataFreshness: "realtime",
      },
      universalIntelligence: {
        instrument: "AAPL",
        assetClass: "crypto",
        assembledAt: now,
        equity: {
          instrument: "AAPL", instrumentType: "stock", assembledAt: now,
          fundamentals: {
            provider: "fixture", observedAt: now, freshness: "FRESH", quality: "VERIFIED",
            available: true, availableDatasets: 1, totalDatasets: 1,
            peRatio: 31, revenueGrowth: 0.12, profitMargin: 0.24, marketCap: 3000000000000,
          },
          evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED",
          missingInformation: [], analystSummary: "fixture",
        },
        evidence: [], overallAvailability: "FULL", overallQuality: "VERIFIED",
        missingInformation: [], dataFlags: [], analystSummary: "fixture",
      } as any,
    });

    expect(candidate.hasFundamentals).toBe(false);
    expect(candidate.peRatio).toBeUndefined();
    expect(candidate.revenueGrowth).toBeUndefined();
  });

  it("does not convert raw analysis fundamentals or calendar availability into signed evidence", () => {
    const now = Date.now();
    const source = {
      instrument: "AAPL",
      assetClass: "equity" as const,
      marketData: {
        instrument: "AAPL", instrumentType: "stock" as const, provider: "fixture",
        fetchTimestamp: now,
        price: { price: 250, timestamp: now, source: "fixture" },
        candles: [{ timestamp: now, open: 249, high: 251, low: 248, close: 250, volume: 100 }],
        timeframe: "H1" as const, dataFreshness: "realtime" as const,
      },
      analysisResult: {
        instrument: "AAPL", instrumentType: "stock", timestamp: now,
        confidence: 70, bias: "Bullish", recommendation: "BUY",
        fundamentalData: { available: true, peRatio: 31 },
        macroData: { confidence: "high" },
        calendarData: { events: [{ status: "released", actual: 2, forecast: 1 }] },
      } as any,
    };
    const live = buildCandidateFromSource(source);
    const radar = buildRadarCandidate(toRadarCandidateSource(source), now);
    expect(live.fundamentalEvidenceAvailable).toBe(false);
    expect(radar.fundamentalEvidenceAvailable).toBe(false);
  });

});
