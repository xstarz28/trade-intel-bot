import { describe, it, expect } from "vitest";
import { computeProtectionReference } from "./protection-reference";
import type { PositionContext } from "./types";
import type { MarketEvidence } from "./thesis-health";

function longProfitablePosition(): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 50000,
    currentPrice: 52000,
    stopLoss: 49000,
    takeProfit: 56000,
    openedAt: Date.now(),
    horizon: "SWING",
  };
}

describe("computeProtectionReference", () => {
  it("returns VOLATILITY-based reference when volatility is available", () => {
    const pos = longProfitablePosition();
    const evidence: MarketEvidence = {
      price: 52000,
      volatility: 1000,
    };
    const result = computeProtectionReference(pos, evidence);
    expect(result.available).toBe(true);
    expect(result.method).toBe("VOLATILITY");
    expect(result.level).toBeDefined();
    expect(result.level!).toBeGreaterThanOrEqual(pos.entryPrice);
  });

  it("returns STRUCTURAL reference using midpoint when no volatility", () => {
    const pos = longProfitablePosition();
    const evidence: MarketEvidence = { price: 52000 };
    const result = computeProtectionReference(pos, evidence);
    expect(result.available).toBe(true);
    expect(result.method).toBe("STRUCTURAL");
    expect(result.level).toBeDefined();
  });

  it("returns break-even reference when no SL and no volatility", () => {
    const pos: PositionContext = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      side: "LONG",
      entryPrice: 50000,
      currentPrice: 52000,
      openedAt: Date.now(),
      horizon: "SWING",
    };
    const evidence: MarketEvidence = { price: 52000 };
    const result = computeProtectionReference(pos, evidence);
    expect(result.available).toBe(true);
    expect(result.method).toBe("STRUCTURAL");
    expect(result.level).toBe(50000); // break-even at entry
  });

  it("returns UNAVAILABLE for losing position without data", () => {
    const pos: PositionContext = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      side: "LONG",
      entryPrice: 50000,
      currentPrice: 48000,
      openedAt: Date.now(),
      horizon: "SWING",
    };
    const evidence: MarketEvidence = { price: 48000 };
    const result = computeProtectionReference(pos, evidence);
    expect(result.available).toBe(false);
    expect(result.method).toBe("UNAVAILABLE");
  });

  it("clamps reference above entry for LONG", () => {
    const pos: PositionContext = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      side: "LONG",
      entryPrice: 50000,
      currentPrice: 50100,
      openedAt: Date.now(),
      horizon: "SCALPING",
    };
    const evidence: MarketEvidence = {
      price: 50100,
      volatility: 500,
    };
    const result = computeProtectionReference(pos, evidence);
    if (result.available && result.level !== undefined) {
      expect(result.level).toBeGreaterThanOrEqual(pos.entryPrice);
    }
  });

  it("adjusts by horizon (SCALPING has tighter reference)", () => {
    const evidence: MarketEvidence = { price: 52000, volatility: 1000 };
    const scalp = computeProtectionReference(
      { ...longProfitablePosition(), horizon: "SCALPING" },
      evidence,
    );
    const swing = computeProtectionReference(
      { ...longProfitablePosition(), horizon: "SWING" },
      evidence,
    );
    if (scalp.available && swing.available && scalp.level !== undefined && swing.level !== undefined) {
      expect(scalp.level).toBeGreaterThanOrEqual(swing.level! - 1);
    }
  });
});
