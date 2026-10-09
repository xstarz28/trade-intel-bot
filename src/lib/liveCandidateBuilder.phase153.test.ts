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
});
