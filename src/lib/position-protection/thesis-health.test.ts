import { describe, it, expect } from "vitest";
import { evaluateThesisHealth, extractAllSignals, type MarketEvidence } from "./thesis-health";
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

function healthyEvidence(): MarketEvidence {
  return {
    price: 52000,
    shortTermTrend: "bullish",
    mediumTermTrend: "bullish",
    longTermTrend: "bullish",
    volatility: 1500,
    avgVolatility: 1500,
    riskRegime: "risk_on",
  };
}

describe("evaluateThesisHealth", () => {
  it("returns HEALTHY for aligned bullish evidence on LONG", () => {
    const pos = longPosition();
    const result = evaluateThesisHealth(pos, healthyEvidence());
    expect(result.state).toBe("HEALTHY");
    expect(result.score).toBeGreaterThan(70);
    expect(result.confirmingCount).toBeGreaterThanOrEqual(2);
    expect(result.deteriorationCount).toBe(0);
  });

  it("detects DETIORATING when short-term trend opposes", () => {
    const pos = longPosition();
    const evidence: MarketEvidence = {
      ...healthyEvidence(),
      shortTermTrend: "bearish",
    };
    const result = evaluateThesisHealth(pos, evidence);
    expect(result.deteriorationCount).toBeGreaterThanOrEqual(1);
    expect(["DETERIORATING", "STABLE", "SEVERELY_DETERIORATING"]).toContain(result.state);
  });

  it("detects SEVERELY_DETERIORATING with multiple adverse signals", () => {
    const pos = longPosition();
    const evidence: MarketEvidence = {
      price: 45000,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
      momentumChange: -20,
      structureBroken: true,
      riskRegimeChanged: true,
      riskRegime: "risk_off",
    };
    const result = evaluateThesisHealth(pos, evidence);
    expect(result.deteriorationCount).toBeGreaterThanOrEqual(3);
    expect(["SEVERELY_DETERIORATING", "INVALIDATED"]).toContain(result.state);
    expect(result.score).toBeLessThan(60);
  });

  it("detects INVALIDATED with structure break and no confirming signals", () => {
    const pos = longPosition();
    const evidence: MarketEvidence = {
      price: 42000,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
      structureBroken: true,
      riskRegimeChanged: true,
      riskRegime: "risk_off",
    };
    const result = evaluateThesisHealth(pos, evidence);
    expect(result.state).toBe("INVALIDATED");
    expect(result.confirmingCount).toBe(0);
  });

  it("reports missing data points when evidence is sparse", () => {
    const pos = longPosition();
    const evidence: MarketEvidence = { price: 52000 };
    const result = evaluateThesisHealth(pos, evidence);
    expect(result.missingDataPoints).toContain("short-term trend");
    expect(result.missingDataPoints).toContain("volatility data");
  });

  it("detects derivatives deterioration for crypto", () => {
    const pos = longPosition({ assetClass: "crypto" });
    const evidence: MarketEvidence = {
      ...healthyEvidence(),
      fundingRate: -0.002,
      oiChange: -25,
      liquidationSpike: true,
    };
    const result = evaluateThesisHealth(pos, evidence);
    expect(result.deteriorationCount).toBeGreaterThanOrEqual(2);
  });

  it("detects macro deterioration with VIX spike", () => {
    const pos = longPosition();
    const evidence: MarketEvidence = {
      ...healthyEvidence(),
      vix: 35,
      riskRegimeChanged: true,
      riskRegime: "risk_off",
    };
    const result = evaluateThesisHealth(pos, evidence);
    expect(result.deteriorationCount).toBeGreaterThanOrEqual(2);
  });
});

describe("extractAllSignals", () => {
  it("extracts deterioration and confirming signals", () => {
    const pos = longPosition();
    const evidence: MarketEvidence = {
      ...healthyEvidence(),
      shortTermTrend: "bearish",
    };
    const { deterioration, confirming } = extractAllSignals(pos, evidence);
    expect(deterioration.length).toBeGreaterThanOrEqual(1);
    expect(confirming.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty deterioration for perfectly aligned evidence", () => {
    const pos = longPosition();
    const { deterioration } = extractAllSignals(pos, healthyEvidence());
    expect(deterioration.length).toBe(0);
  });

  it("SHORT position detects bearish trend as opposing", () => {
    const pos: PositionContext = {
      instrument: "ETH/USDT",
      assetClass: "crypto",
      side: "SHORT",
      entryPrice: 3000,
      currentPrice: 2800,
      openedAt: Date.now(),
    };
    const evidence: MarketEvidence = {
      price: 2800,
      shortTermTrend: "bullish",
    };
    const { deterioration } = extractAllSignals(pos, evidence);
    expect(deterioration.length).toBeGreaterThanOrEqual(1);
  });
});
