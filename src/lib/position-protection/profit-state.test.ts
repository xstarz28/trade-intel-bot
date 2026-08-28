import { describe, it, expect } from "vitest";
import { calculateProfitMetrics } from "./profit-state";
import type { PositionContext } from "./types";

function longPosition(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 50000,
    currentPrice: 52000,
    openedAt: Date.now(),
    ...overrides,
  };
}

function shortPosition(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "SHORT",
    entryPrice: 50000,
    currentPrice: 48000,
    openedAt: Date.now(),
    ...overrides,
  };
}

describe("calculateProfitMetrics", () => {
  describe("LONG positions", () => {
    it("detects profitable state when price rises moderately", () => {
      const pos = longPosition({ currentPrice: 51500 });
      const m = calculateProfitMetrics(pos);
      // distanceFromEntryPct = 3.0% — falls in PROFITABLE (1%..5%)
      expect(m.profitState).toBe("PROFITABLE");
      expect(m.unrealizedPnL).toBe(1500);
      expect(m.distanceFromEntryPct).toBeCloseTo(3.0, 1);
    });

    it("detects profitable state at 2% (below 5% threshold)", () => {
      const pos = longPosition({ currentPrice: 51000 });
      const m = calculateProfitMetrics(pos);
      expect(m.profitState).toBe("PROFITABLE");
    });

    it("detects strongly profitable state at >=5%", () => {
      const pos = longPosition({ currentPrice: 53000 });
      const m = calculateProfitMetrics(pos);
      expect(m.profitState).toBe("STRONGLY_PROFITABLE");
    });

    it("detects break-even zone when 5.0% boundary hit", () => {
      const pos = longPosition({ currentPrice: 52500 });
      const m = calculateProfitMetrics(pos);
      // distanceFromEntryPct = 5.0 — this is the STRONGLY_PROFITABLE boundary
      expect(m.profitState).toBe("STRONGLY_PROFITABLE");
    });

    it("detects break-even zone", () => {
      const pos = longPosition({ currentPrice: 50200 });
      const m = calculateProfitMetrics(pos);
      expect(m.profitState).toBe("BREAK_EVEN_ZONE");
    });

    it("detects losing state", () => {
      const pos = longPosition({ currentPrice: 47000 });
      const m = calculateProfitMetrics(pos);
      expect(m.profitState).toBe("LOSING");
      expect(m.unrealizedPnL).toBe(-3000);
    });

    it("computes R-multiple when stopLoss is set", () => {
      const pos = longPosition({ currentPrice: 52000, stopLoss: 49000 });
      const m = calculateProfitMetrics(pos);
      expect(m.rMultiple).toBeDefined();
      expect(m.rMultiple!).toBeGreaterThan(0);
      expect(m.distanceToSLPct).toBeDefined();
    });

    it("computes R-multiple as negative when in loss", () => {
      const pos = longPosition({ currentPrice: 48000, stopLoss: 49000 });
      const m = calculateProfitMetrics(pos);
      expect(m.rMultiple).toBeDefined();
      expect(m.rMultiple!).toBeLessThan(0);
    });

    it("computes leveraged PnL", () => {
      const pos = longPosition({ currentPrice: 52000, leverage: 10 });
      const m = calculateProfitMetrics(pos);
      expect(m.leveragedPnL).toBe(20000);
    });

    it("computes giveback from peak", () => {
      const pos = longPosition({ currentPrice: 52000, peakPrice: 53000 });
      const m = calculateProfitMetrics(pos);
      expect(m.givebackPct).toBeGreaterThan(0);
      expect(m.peakProfit).toBe(3000);
    });

    it("computes zero giveback at peak", () => {
      const pos = longPosition({ currentPrice: 53000, peakPrice: 53000 });
      const m = calculateProfitMetrics(pos);
      expect(m.givebackPct).toBe(0);
    });

    it("computes distance to TP", () => {
      const pos = longPosition({ currentPrice: 52000, takeProfit: 55000 });
      const m = calculateProfitMetrics(pos);
      expect(m.distanceToTPPct).toBeDefined();
      expect(m.distanceToTPPct!).toBeGreaterThan(0);
    });
  });

  describe("SHORT positions", () => {
    it("detects profitable when price falls moderately", () => {
      const pos = shortPosition({ currentPrice: 49000 });
      const m = calculateProfitMetrics(pos);
      // distanceFromEntryPct = -2.0% → |2.0%| falls in PROFITABLE (1%..5%)
      expect(m.profitState).toBe("PROFITABLE");
      expect(m.unrealizedPnL).toBe(1000);
    });

    it("detects strongly profitable when price falls >=5%", () => {
      const pos = shortPosition({ currentPrice: 47000 });
      const m = calculateProfitMetrics(pos);
      // distanceFromEntryPct = -6.0% → |6.0%| >= 5.0 → STRONGLY_PROFITABLE
      expect(m.profitState).toBe("STRONGLY_PROFITABLE");
      expect(m.unrealizedPnL).toBe(3000);
    });

    it("detects strongly profitable at >5%", () => {
      const pos = shortPosition({ currentPrice: 46000 });
      const m = calculateProfitMetrics(pos);
      expect(m.profitState).toBe("STRONGLY_PROFITABLE");
    });

    it("detects losing when price rises", () => {
      const pos = shortPosition({ currentPrice: 53000 });
      const m = calculateProfitMetrics(pos);
      expect(m.profitState).toBe("LOSING");
      expect(m.unrealizedPnL).toBe(-3000);
    });

    it("computes R-multiple correctly for SHORT", () => {
      const pos = shortPosition({ currentPrice: 47000, stopLoss: 53000 });
      const m = calculateProfitMetrics(pos);
      expect(m.rMultiple).toBeDefined();
      expect(m.rMultiple!).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("handles entry at zero gracefully", () => {
      const pos = longPosition({ entryPrice: 0, currentPrice: 0 });
      const m = calculateProfitMetrics(pos);
      expect(m.unrealizedPnL).toBe(0);
      expect(m.distanceFromEntryPct).toBe(0);
    });

    it("handles missing stopLoss", () => {
      const pos = longPosition();
      const m = calculateProfitMetrics(pos);
      expect(m.rMultiple).toBeUndefined();
      expect(m.distanceToSLPct).toBeUndefined();
    });

    it("handles missing takeProfit", () => {
      const pos = longPosition();
      const m = calculateProfitMetrics(pos);
      expect(m.distanceToTPPct).toBeUndefined();
    });

    it("handles missing leverage", () => {
      const pos = longPosition();
      const m = calculateProfitMetrics(pos);
      expect(m.leveragedPnL).toBeUndefined();
    });
  });
});
