import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types/analysis";
import { buildForwardMarketPath } from "./forward-market-path";

function noTradeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: "test",
    instrument: "BTCUSDT",
    instrumentType: "crypto",
    timeframe: "H1",
    bias: "Neutral",
    confidence: 42,
    recommendation: "NO_TRADE",
    noTradeReasons: ["No confirmed trigger"],
    tradingStyle: "intraday",
    technicalSummary: "Range structure",
    fundamentalSummary: "No decisive catalyst",
    breakdown: { trend: 0, indicator: 0, fundamental: 0, sentiment: 0 },
    keyLevels: { support: "64000", resistance: "66000", invalidation: "63500" },
    riskNote: "Wait for confirmation",
    dataCompleteness: "full",
    dataFlags: [],
    timestamp: 1_800_000_000_000,
    ...overrides,
  } as AnalysisResult;
}

describe("buildForwardMarketPath future opportunity watchlist", () => {
  it("keeps a projected setup visible when current recommendation is NO_TRADE", () => {
    const result = noTradeResult({
      projectedTradePlan: {
        direction: "long",
        entry: "66100",
        entryBasis: "H1 close above resistance followed by a successful retest",
        stopLoss: "65200",
        slBasis: "Below the retest swing low",
        takeProfit: "67900",
        tpBasis: "Next opposing structural liquidity",
        riskReward: 2,
      },
    });

    const path = buildForwardMarketPath(result);

    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.tradePlan).toBeUndefined();
    expect(path.nextBestAction).toContain("watchlist");
    expect(path.nextBestAction).toContain("66100");
    expect(path.nextBestAction).toContain("65200");
    expect(path.confirmationConditions.join(" ")).toContain("H1 close above resistance");
    expect(path.watchLevels).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "66100", type: "entry", source: "projectedTradePlan" }),
      expect.objectContaining({ level: "65200", type: "invalidation", source: "projectedTradePlan" }),
      expect.objectContaining({ level: "67900", type: "resistance", source: "projectedTradePlan" }),
    ]));
    expect(path.scenarioTree[0].label).toContain("not executable");
    expect(path.forwardOpportunity).toEqual({
      status: "CONDITIONAL",
      direction: "long",
      entry: "66100",
      stopLoss: "65200",
      takeProfit: "67900",
      riskReward: 2,
      entryBasis: "H1 close above resistance followed by a successful retest",
      stopBasis: "Below the retest swing low",
      targetBasis: "Next opposing structural liquidity",
    });
  });

  it("provides numeric breakout and breakdown watch conditions without inventing an entry", () => {
    const path = buildForwardMarketPath(noTradeResult());

    expect(path.nextBestAction).toContain("66000");
    expect(path.nextBestAction).toContain("64000");
    expect(path.watchLevels).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "64000", type: "support", source: "keyLevels" }),
      expect.objectContaining({ level: "66000", type: "resistance", source: "keyLevels" }),
    ]));
    expect(path.watchLevels.some((level) => level.type === "entry")).toBe(false);
    expect(path.scenarioTree.some((node) => node.label.includes("Breakout / breakdown"))).toBe(true);
  });

  it("does not expose a projected plan as a watch-only plan when an actionable plan exists", () => {
    const result = noTradeResult({
      bias: "Bullish",
      recommendation: "LONG",
      tradePlan: {
        direction: "long",
        entry: "66100",
        entryBasis: "Confirmed breakout",
        stopLoss: "65200",
        slBasis: "Structural",
        takeProfit: "67900",
        tpBasis: "Liquidity",
        riskReward: 2,
      },
      projectedTradePlan: {
        direction: "short",
        entry: "63900",
        entryBasis: "Breakdown retest",
        stopLoss: "64700",
        slBasis: "Structural",
        takeProfit: "62300",
        tpBasis: "Liquidity",
        riskReward: 2,
      },
    });

    const path = buildForwardMarketPath(result);
    expect(path.watchLevels).toEqual([
      expect.objectContaining({ level: "66100", source: "tradePlan", type: "entry" }),
    ]);
    expect(path.watchLevels.some((level) => level.source === "projectedTradePlan")).toBe(false);
  });
});
