/**
 * Phase 57 — Thesis Health Tests
 */
import { describe, it, expect } from "vitest";
import { evaluateThesisHealth, extractAllSignals } from "../thesis-health";
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

describe("evaluateThesisHealth", () => {
  it("returns HEALTHY when all evidence is supportive", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      shortTermTrend: "bullish",
      mediumTermTrend: "bullish",
      structureBroken: false,
      riskRegime: "risk_on",
    };
    const result = evaluateThesisHealth(pos, ev);
    expect(result.state).toBe("HEALTHY");
    expect(result.score).toBeGreaterThan(60);
    expect(result.deteriorationCount).toBe(0);
    expect(result.confirmingCount).toBeGreaterThanOrEqual(2);
  });

  it("returns INVALIDATED on structure break with no confirming signals", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 90_000,
      structureBroken: true,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
    };
    const result = evaluateThesisHealth(pos, ev);
    expect(result.state).toBe("INVALIDATED");
  });

  it("returns DETERIORATING on opposing short-term trend", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      shortTermTrend: "bearish",
    };
    const result = evaluateThesisHealth(pos, ev);
    expect(result.deteriorationCount).toBeGreaterThanOrEqual(1);
    expect(["DETERIORATING", "STABLE", "UNKNOWN"]).toContain(result.state);
  });

  it("detects derivatives deterioration for crypto", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      fundingRate: -0.002,
      oiChange: -20,
      liquidationSpike: true,
    };
    const result = evaluateThesisHealth(pos, ev);
    expect(result.deteriorationCount).toBeGreaterThanOrEqual(2);
  });

  it("detects macro deterioration with VIX spike", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      vix: 35,
      riskRegimeChanged: true,
      riskRegime: "risk_off",
    };
    const result = evaluateThesisHealth(pos, ev);
    expect(result.deteriorationCount).toBeGreaterThanOrEqual(1);
  });

  it("reports missing data points", () => {
    const pos = longBtc();
    const ev: MarketEvidence = { price: 105_000 };
    const result = evaluateThesisHealth(pos, ev);
    expect(result.missingDataPoints.length).toBeGreaterThan(0);
  });

  it("scores between 0 and 100", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      shortTermTrend: "bullish",
      volatility: 500,
      avgVolatility: 100,
      fundingRate: -0.005,
      oiChange: -25,
      liquidationSpike: true,
      vix: 40,
      riskRegimeChanged: true,
      riskRegime: "risk_off",
      structureBroken: true,
      momentumChange: -30,
      correlatedDivergence: true,
    };
    const result = evaluateThesisHealth(pos, ev);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("extractAllSignals", () => {
  it("returns deterioration and confirming signals", () => {
    const pos = longBtc();
    const ev: MarketEvidence = {
      price: 105_000,
      shortTermTrend: "bullish",
      structureBroken: true,
    };
    const { deterioration, confirming } = extractAllSignals(pos, ev);
    expect(deterioration.length).toBeGreaterThanOrEqual(1);
    expect(confirming.length).toBeGreaterThanOrEqual(1);
  });

  it("short position detects opposing bullish trend", () => {
    const pos: PositionContext = {
      instrument: "ETH/USDT",
      assetClass: "crypto",
      side: "SHORT",
      entryPrice: 3000,
      currentPrice: 2800,
      openedAt: Date.now(),
    };
    const ev: MarketEvidence = {
      price: 2800,
      shortTermTrend: "bullish",
    };
    const { deterioration } = extractAllSignals(pos, ev);
    expect(deterioration.length).toBeGreaterThanOrEqual(1);
  });
});
