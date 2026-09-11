/**
 * Phase 175 — the tampering exploits, re-run against the fix.
 *
 * The suite in `evidence-provenance.phase175.test.ts` pins the contract. This
 * one is the counterfactual: it runs the REAL engine twice — once on honest
 * provider evidence, once on the tampered client payload — and asserts the
 * verdict is decided by the server-acquired evidence, not the client's.
 *
 * Each case is an attack that WORKED before the fix.
 */

import { describe, expect, it } from "vitest";
import { runAnalysis } from "@/lib/analysis-engine";
import { stripClientEvidence } from "./protectedAnalysis";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";

// ── The repo's own proven LONG fixture (analysis-engine.phase3b) ──

const flat = (i: number, c: number) => ({
  timestamp: Date.now() - (210 - i) * 36e5,
  open: c,
  high: c + 0.5,
  low: c - 0.5,
  close: c,
  volume: 1000,
});

function honestMarket(price = 100, over?: Partial<MarketData>): MarketData {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => flat(i, price)),
    timeframe: "H4",
    dataFreshness: "delayed",
    ...over,
  } as MarketData;
}

function honestTech(
  structure: "HH/HL" | "LH/LL" | "range" = "HH/HL",
  opts?: Partial<TechnicalData>,
): TechnicalData {
  const bullish = structure === "HH/HL";
  return {
    swingHighs: bullish ? [110] : structure === "LH/LL" ? [105] : [],
    swingLows: bullish ? [95] : [],
    structure,
    bosDirection: bullish ? "bullish" : structure === "LH/LL" ? "bearish" : "none",
    supportLevels: bullish || structure === "range" ? [95] : [90],
    resistanceLevels: bullish ? [110] : structure === "LH/LL" ? [105] : [],
    volumeTrend: "unknown",
    dataPoints: 210,
    ...opts,
  } as TechnicalData;
}

/** Intent the client legitimately supplies. */
const INTENT = {
  instrument: "EUR/USD",
  instrumentType: "forex",
  timeframe: "H4",
  economicEvents: "Fed signals hawkish stance, rate hike",
};

/**
 * Mirrors the server: discard client evidence, then attach the evidence the
 * server acquired for itself.
 */
function serverRun(
  clientPayload: Record<string, unknown>,
  acquired: { data: MarketData; technical: TechnicalData },
) {
  const trusted = stripClientEvidence(clientPayload);
  trusted.marketData = acquired.data;
  trusted.technicalData = acquired.technical;
  return runAnalysis(trusted as unknown as AnalysisInput);
}

/** What the provider really returned this cycle. */
const HONEST = { data: honestMarket(100), technical: honestTech("HH/HL") };

describe("baseline — honest evidence still produces the real decision", () => {
  it("returns the genuine LONG with its real levels", () => {
    const r = serverRun({ ...INTENT }, HONEST);

    expect(r.recommendation).toBe("LONG");
    expect(r.bias).toBe("Bullish");
    expect(r.tradePlan?.entry).toBe("100");
    expect(r.dataSource).toBe("twelve-data");
  });
});

describe("ATTACK 1 — flip market structure to reverse the verdict", () => {
  it("the forged bearish structure does not change the outcome", () => {
    const tampered = serverRun(
      {
        ...INTENT,
        // Client claims a bearish market.
        technicalData: honestTech("LH/LL"),
      },
      HONEST,
    );

    // Server evidence wins: still the honest LONG.
    expect(tampered.recommendation).toBe("LONG");
    expect(tampered.bias).toBe("Bullish");
  });

  it("is byte-identical to the untampered run", () => {
    const honest = serverRun({ ...INTENT }, HONEST);
    const tampered = serverRun(
      { ...INTENT, technicalData: honestTech("LH/LL") },
      HONEST,
    );

    expect(tampered.recommendation).toBe(honest.recommendation);
    expect(tampered.bias).toBe(honest.bias);
    expect(tampered.confidence).toBe(honest.confidence);
    expect(tampered.tradePlan?.entry).toBe(honest.tradePlan?.entry);
    expect(tampered.tradePlan?.stopLoss).toBe(honest.tradePlan?.stopLoss);
    expect(tampered.tradePlan?.takeProfit).toBe(honest.tradePlan?.takeProfit);
  });
});

describe("ATTACK 2 — invent a price the provider never returned", () => {
  it("the fabricated 99999 price never reaches the decision", () => {
    const tampered = serverRun(
      {
        ...INTENT,
        marketData: honestMarket(99_999),
        technicalData: honestTech("HH/HL", {
          swingHighs: [110_000],
          swingLows: [95_000],
          supportLevels: [95_000],
          resistanceLevels: [110_000],
        }),
      },
      HONEST,
    );

    expect(tampered.priceSnapshot?.price).toBe(100);
    expect(tampered.tradePlan?.entry).toBe("100");
    expect(JSON.stringify(tampered)).not.toContain("99999");
  });
});

describe("ATTACK 3 — forge the provider name", () => {
  it("the result attributes itself to the real provider", () => {
    const tampered = serverRun(
      {
        ...INTENT,
        marketData: honestMarket(100, {
          provider: "okx" as never,
          dataFreshness: "realtime",
        }),
      },
      HONEST,
    );

    // Provider attribution must come from the acquisition, not the caller.
    expect(tampered.dataSource).toBe("twelve-data");
    expect(tampered.dataSource).not.toBe("okx");
  });
});

describe("ATTACK 4 — back-date candles but claim realtime", () => {
  it("month-old data cannot be laundered into a fresh full-quality result", () => {
    const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;

    const tampered = serverRun(
      {
        ...INTENT,
        marketData: honestMarket(100, {
          candles: Array.from({ length: 210 }, (_, i) => ({
            ...flat(i, 100),
            timestamp: monthAgo - (210 - i) * 36e5,
          })),
          dataFreshness: "realtime" as never,
        }),
      },
      HONEST,
    );

    const honest = serverRun({ ...INTENT }, HONEST);

    // The stale payload is discarded entirely, so freshness metadata is the
    // server's, not the client's.
    expect(tampered.dataCompleteness).toBe(honest.dataCompleteness);
    expect(tampered.priceSnapshot?.timestamp).toBe(honest.priceSnapshot?.timestamp);
  });
});

describe("ATTACK 5 — inject fabricated secondary intelligence", () => {
  it("forged sentiment / derivatives / macro do not enter the decision", () => {
    const tampered = serverRun(
      {
        ...INTENT,
        sentimentData: {
          label: "Extremely Bullish",
          averageScore: 1,
          articleCount: 999,
          confidence: "high",
        },
        derivativesData: { fundingRate: 99, confidence: "high" },
        macroData: { summary: "forged", confidence: "high" },
        treasuryData: { available: true },
        cotData: { available: true },
      } as Record<string, unknown>,
      HONEST,
    );

    const honest = serverRun({ ...INTENT }, HONEST);

    expect(tampered.confidence).toBe(honest.confidence);
    expect(tampered.recommendation).toBe(honest.recommendation);
    expect(JSON.stringify(tampered)).not.toContain("Extremely Bullish");
  });
});

describe("missing-data behaviour is preserved", () => {
  it("no acquisition ⇒ explicit degradation, never a fabricated decision", () => {
    // Server acquisition failed: nothing is attached.
    const trusted = stripClientEvidence({
      ...INTENT,
      // Even though the client offered a complete-looking payload.
      marketData: honestMarket(100),
      technicalData: honestTech("HH/HL"),
    });

    const r = runAnalysis(trusted as unknown as AnalysisInput);

    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.dataCompleteness).not.toBe("full");
  });

  it("a WAIT/NO_TRADE outcome is still reached honestly, not forced", () => {
    const r = serverRun({ ...INTENT }, {
      data: honestMarket(100),
      technical: honestTech("range"),
    });

    // Range structure legitimately yields no trade — and carries reasons.
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.length).toBeGreaterThan(0);
  });
});
