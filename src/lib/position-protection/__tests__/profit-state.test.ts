/**
 * Phase 57 — Profit State Tests
 */
import { describe, it, expect } from "vitest";
import { calculateProfitMetrics } from "../profit-state";
import type { PositionContext } from "../types";

function longPosition(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 100_000,
    currentPrice: 105_000,
    openedAt: Date.now(),
    ...overrides,
  };
}

function shortPosition(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "SHORT",
    entryPrice: 100_000,
    currentPrice: 95_000,
    openedAt: Date.now(),
    ...overrides,
  };
}

describe("calculateProfitMetrics", () => {
  it("classifies a profitable long", () => {
    const m = calculateProfitMetrics(longPosition());
    expect(m.profitState).toBe("PROFITABLE");
    expect(m.unrealizedPnL).toBe(5000);
    expect(m.distanceFromEntryPct).toBeCloseTo(5);
  });

  it("classifies a strongly profitable long", () => {
    const m = calculateProfitMetrics(longPosition({ currentPrice: 110_000 }));
    expect(m.profitState).toBe("STRONGLY_PROFITABLE");
    expect(m.distanceFromEntryPct).toBeCloseTo(10);
  });

  it("classifies a losing long", () => {
    const m = calculateProfitMetrics(longPosition({ currentPrice: 95_000 }));
    expect(m.profitState).toBe("LOSING");
    expect(m.unrealizedPnL).toBe(-5000);
  });

  it("classifies a profitable short", () => {
    const m = calculateProfitMetrics(shortPosition());
    expect(m.profitState).toBe("PROFITABLE");
    expect(m.unrealizedPnL).toBe(5000);
  });

  it("classifies a losing short", () => {
    const m = calculateProfitMetrics(shortPosition({ currentPrice: 105_000 }));
    expect(m.profitState).toBe("LOSING");
    expect(m.unrealizedPnL).toBe(-5000);
  });

  it("computes R-multiple when stop loss is available", () => {
    const m = calculateProfitMetrics(
      longPosition({ stopLoss: 98_000, currentPrice: 105_000 }),
    );
    expect(m.rMultiple).toBeDefined();
    expect(m.rMultiple!).toBeGreaterThan(0);
    expect(m.distanceToSLPct).toBeDefined();
  });

  it("computes leveraged PnL", () => {
    const m = calculateProfitMetrics(longPosition({ leverage: 10 }));
    expect(m.leveragedPnL).toBe(50_000);
  });

  it("computes distance to TP", () => {
    const m = calculateProfitMetrics(
      longPosition({ takeProfit: 120_000, currentPrice: 105_000 }),
    );
    expect(m.distanceToTPPct).toBeDefined();
    expect(m.distanceToTPPct!).toBeCloseTo(15, 0);
  });

  it("handles break-even zone", () => {
    const m = calculateProfitMetrics(longPosition({ currentPrice: 100_200 }));
    expect(m.profitState).toBe("BREAK_EVEN_ZONE");
  });

  it("computes giveback from peak price", () => {
    const m = calculateProfitMetrics(
      longPosition({ currentPrice: 103_000, peakPrice: 110_000 }),
    );
    expect(m.givebackPct).toBeDefined();
    expect(m.givebackPct!).toBeGreaterThan(0);
    expect(m.peakProfit).toBe(10_000);
  });

  it("shows zero giveback when at peak", () => {
    const m = calculateProfitMetrics(
      longPosition({ currentPrice: 110_000, peakPrice: 110_000 }),
    );
    expect(m.givebackPct).toBe(0);
  });

  it("handles zero entry price safely", () => {
    const m = calculateProfitMetrics(
      longPosition({ entryPrice: 0, currentPrice: 100 }),
    );
    expect(m.distanceFromEntryPct).toBe(0);
  });
});
