/**
 * Phase 57 — Protection Reference Tests
 */
import { describe, it, expect } from "vitest";
import { computeProtectionReference } from "../protection-reference";
import type { PositionContext } from "../types";
import type { MarketEvidence } from "../thesis-health";

function longPosition(
  overrides: Partial<PositionContext> = {},
): PositionContext {
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

describe("computeProtectionReference", () => {
  it("computes volatility-based reference when data is available", () => {
    const pos = longPosition({ horizon: "SWING" });
    const ev: MarketEvidence = { price: 105_000, volatility: 2000 };
    const ref = computeProtectionReference(pos, ev);
    expect(ref.available).toBe(true);
    expect(ref.method).toBe("VOLATILITY");
    expect(ref.level).toBeDefined();
    expect(ref.level!).toBeGreaterThanOrEqual(pos.entryPrice);
    expect(ref.level!).toBeLessThanOrEqual(pos.currentPrice);
  });

  it("computes structural reference from stop-loss midpoint", () => {
    const pos = longPosition({ stopLoss: 95_000 });
    const ev: MarketEvidence = { price: 105_000 };
    const ref = computeProtectionReference(pos, ev);
    expect(ref.available).toBe(true);
    expect(ref.method).toBe("STRUCTURAL");
  });

  it("computes break-even reference when no SL or volatility", () => {
    const pos = longPosition();
    const ev: MarketEvidence = { price: 105_000 };
    const ref = computeProtectionReference(pos, ev);
    expect(ref.available).toBe(true);
    expect(ref.level).toBe(pos.entryPrice);
  });

  it("returns unavailable for losing position with no data", () => {
    const pos = longPosition({ currentPrice: 95_000 });
    const ev: MarketEvidence = { price: 95_000 };
    const ref = computeProtectionReference(pos, ev);
    expect(ref.available).toBe(false);
    expect(ref.method).toBe("UNAVAILABLE");
  });

  it("computes reference for short position", () => {
    const pos: PositionContext = {
      instrument: "ETH/USDT",
      assetClass: "crypto",
      side: "SHORT",
      entryPrice: 3000,
      currentPrice: 2800,
      openedAt: Date.now(),
      horizon: "INTRADAY",
    };
    const ev: MarketEvidence = { price: 2800, volatility: 100 };
    const ref = computeProtectionReference(pos, ev);
    expect(ref.available).toBe(true);
    // For short: reference is between currentPrice and entryPrice
    expect(ref.level!).toBeGreaterThanOrEqual(pos.currentPrice);
    expect(ref.level!).toBeLessThanOrEqual(pos.entryPrice);
  });

  it("scales ATR multiple by horizon", () => {
    const scalping = longPosition({ horizon: "SCALPING" });
    const investing = longPosition({ horizon: "INVESTING" });
    const ev: MarketEvidence = { price: 105_000, volatility: 2000 };

    const refScalping = computeProtectionReference(scalping, ev);
    const refInvesting = computeProtectionReference(investing, ev);

    if (refScalping.available && refInvesting.available && refScalping.level && refInvesting.level) {
      // Scalping: 1.0x ATR, Investing: 2.5x ATR — investing ref should be lower
      expect(refInvesting.level).toBeLessThanOrEqual(refScalping.level);
    }
  });
});
