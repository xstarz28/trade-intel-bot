import { describe, expect, it } from "vitest";
import { buildCandidateFromSource } from "./liveCandidateBuilder";

describe("Phase 153 — Live Candidate Builder integrity", () => {
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
    expect(candidate.freshness).toBe("FRESH");
    expect(candidate.providerCoverage).toBe("PARTIAL");
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
