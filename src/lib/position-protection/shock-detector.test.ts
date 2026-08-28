import { describe, it, expect } from "vitest";
import { detectShock } from "./shock-detector";
import type { MarketEvidence } from "./thesis-health";

describe("detectShock", () => {
  it("returns NORMAL for calm market", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      volatility: 1000,
      avgVolatility: 1000,
      change24h: 0.5,
    };
    const result = detectShock(evidence);
    expect(result.state).toBe("NORMAL");
    expect(result.description).toContain("No abnormal");
  });

  it("detects SHOCK when multiple indicators fire", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      volatility: 5000,
      avgVolatility: 1000,
      change24h: -10,
      vix: 40,
      oiChange: -25,
      fundingRate: -0.005,
      liquidationSpike: true,
      riskRegimeChanged: true,
      riskRegime: "risk_off",
    };
    const result = detectShock(evidence);
    expect(result.state).toBe("SHOCK");
    expect(result.indicators.volatilityExpansion).toBe(true);
    expect(result.indicators.rapidDisplacement).toBe(true);
    expect(result.indicators.oiShock).toBe(true);
    expect(result.indicators.fundingShock).toBe(true);
    expect(result.indicators.volumeSpike).toBe(true);
    expect(result.indicators.regimeTransition).toBe(true);
  });

  it("detects ELEVATED for single shock indicator", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      volatility: 3000,
      avgVolatility: 1000,
    };
    const result = detectShock(evidence);
    expect(result.state).toBe("ELEVATED");
  });

  it("detects volatility expansion when ratio > 3", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      volatility: 4000,
      avgVolatility: 1000,
    };
    const result = detectShock(evidence);
    expect(result.indicators.volatilityExpansion).toBe(true);
  });

  it("detects rapid displacement when 24h change > 3%", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      change24h: 8,
    };
    const result = detectShock(evidence);
    expect(result.indicators.rapidDisplacement).toBe(true);
  });

  it("detects VIX shock when VIX > 35", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      vix: 40,
    };
    const result = detectShock(evidence);
    expect(result.indicators.regimeTransition).toBe(true);
    expect(result.state).not.toBe("NORMAL");
  });

  it("detects funding shock when |rate| > 0.003", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      fundingRate: 0.005,
    };
    const result = detectShock(evidence);
    expect(result.indicators.fundingShock).toBe(true);
  });

  it("detects OI shock when |change| > 20%", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      oiChange: -30,
    };
    const result = detectShock(evidence);
    expect(result.indicators.oiShock).toBe(true);
  });

  it("detects cross-asset divergence", () => {
    const evidence: MarketEvidence = {
      price: 50000,
      correlatedDivergence: true,
    };
    const result = detectShock(evidence);
    expect(result.indicators.crossAssetDivergence).toBe(true);
  });

  it("handles missing data gracefully", () => {
    const evidence: MarketEvidence = { price: 50000 };
    const result = detectShock(evidence);
    expect(result.state).toBe("NORMAL");
    expect(result.confidence).toBeGreaterThan(0);
  });
});
