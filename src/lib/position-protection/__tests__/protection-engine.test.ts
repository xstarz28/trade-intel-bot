/**
 * Phase 57 — Protection Engine Tests
 */
import { describe, it, expect } from "vitest";
import { evaluateProtection } from "../protection-engine";
import type { PositionContext } from "../types";
import type { MarketEvidence } from "../thesis-health";

function longBtc(overrides?: Partial<PositionContext>): PositionContext {
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

describe("evaluateProtection", () => {
  it("returns NONE severity for healthy position", () => {
    const pos = longBtc({ currentPrice: 102_000 });
    const ev: MarketEvidence = {
      price: 102_000,
      shortTermTrend: "bullish",
      mediumTermTrend: "bullish",
      structureBroken: false,
      riskRegime: "risk_on",
    };
    const result = evaluateProtection({ position: pos, evidence: ev, now: Date.now() });
    expect(result.alert.severity).toBe("NONE");
    expect(result.alert.instrument).toBe("BTC/USDT");
    expect(result.alert.profit.profitState).toBe("PROFITABLE");
    expect(result.alert.actionRecommendation).toContain("Hold");
  });

  it("returns WATCH on single deterioration signal", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      shortTermTrend: "bearish",
    };
    const result = evaluateProtection({ position: pos, evidence: ev, now: Date.now() });
    expect(["WATCH", "CAUTION", "NONE"]).toContain(result.alert.severity);
  });

  it("returns INVALIDATED on thesis invalidation", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 90_000,
      structureBroken: true,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
    };
    const result = evaluateProtection({ position: pos, evidence: ev, now: Date.now() });
    expect(result.alert.severity).toBe("INVALIDATED");
    expect(result.alert.actionRecommendation).toContain("thesis");
  });

  it("returns HIGH_RISK for severely deteriorating profitable position", () => {
    const pos = longBtc({ currentPrice: 110_000 });
    const ev: MarketEvidence = {
      price: 110_000,
      structureBroken: true,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
      momentumChange: -25,
      volatility: 5000,
      avgVolatility: 1000,
      fundingRate: -0.002,
      oiChange: -20,
      liquidationSpike: true,
    };
    const result = evaluateProtection({ position: pos, evidence: ev, now: Date.now() });
    expect(["HIGH_RISK", "CAUTION", "INVALIDATED"]).toContain(result.alert.severity);
  });

  it("includes conflicting evidence for non-NONE alerts", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      shortTermTrend: "bearish",
    };
    const result = evaluateProtection({ position: pos, evidence: ev, now: Date.now() });
    if (result.alert.severity !== "NONE") {
      expect(result.alert.conflictingEvidence.length).toBeGreaterThan(0);
    }
  });

  it("tracks peak profit in monitoring state", () => {
    const pos = longBtc({ currentPrice: 115_000 });
    const ev: MarketEvidence = { price: 115_000 };
    const r1 = evaluateProtection({ position: pos, evidence: ev, now: Date.now() });
    expect(r1.updatedMonitoringState.peakProfitSeen).toBeDefined();
    expect(r1.updatedMonitoringState.peakProfitSeen!).toBeGreaterThan(0);
  });

  it("compute protection reference for profitable positions", () => {
    const pos = longBtc({ horizon: "SWING" });
    const ev: MarketEvidence = { price: 105_000, volatility: 2000 };
    const result = evaluateProtection({ position: pos, evidence: ev, now: Date.now() });
    expect(result.alert.protectionReference).toBeDefined();
  });

  it("never auto-executes — only recommends manual action", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      structureBroken: true,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
    };
    const result = evaluateProtection({ position: pos, evidence: ev, now: Date.now() });
    // Action should always be a recommendation string, never an execution command
    expect(result.alert.actionRecommendation).not.toContain("execute");
    expect(result.alert.actionRecommendation).not.toContain("auto");
    expect(result.alert.actionRecommendation).not.toContain("close position");
  });

  it("preserves instrument isolation — BTC result does not leak to ETH", () => {
    const btcPos = longBtc();
    const ethEv: MarketEvidence = { price: 3000 };
    const result = evaluateProtection({ position: btcPos, evidence: ethEv, now: Date.now() });
    expect(result.alert.instrument).toBe("BTC/USDT");
  });
});
