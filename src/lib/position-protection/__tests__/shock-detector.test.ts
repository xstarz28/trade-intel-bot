/**
 * Phase 57 — Shock Detector Tests
 */
import { describe, it, expect } from "vitest";
import { detectShock } from "../shock-detector";
import type { MarketEvidence } from "../thesis-health";

describe("detectShock", () => {
  it("returns NORMAL for calm market", () => {
    const ev: MarketEvidence = { price: 100_000 };
    const result = detectShock(ev);
    expect(result.state).toBe("NORMAL");
    expect(result.description).toContain("No abnormal");
  });

  it("detects volatility expansion shock", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      volatility: 5000,
      avgVolatility: 1000,
    };
    const result = detectShock(ev);
    expect(result.indicators.volatilityExpansion).toBe(true);
    expect(result.state).toBe("ELEVATED");
  });

  it("detects rapid displacement shock", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      change24h: -8,
    };
    const result = detectShock(ev);
    expect(result.indicators.rapidDisplacement).toBe(true);
    expect(result.state).toBe("ELEVATED");
  });

  it("detects VIX shock", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      vix: 40,
    };
    const result = detectShock(ev);
    expect(result.indicators.regimeTransition).toBe(true);
    expect(result.state).toBe("ELEVATED");
  });

  it("detects OI shock", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      oiChange: -25,
    };
    const result = detectShock(ev);
    expect(result.indicators.oiShock).toBe(true);
  });

  it("detects funding shock", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      fundingRate: -0.005,
    };
    const result = detectShock(ev);
    expect(result.indicators.fundingShock).toBe(true);
  });

  it("detects liquidation spike", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      liquidationSpike: true,
    };
    const result = detectShock(ev);
    expect(result.indicators.volumeSpike).toBe(true);
  });

  it("detects regime change", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      riskRegimeChanged: true,
    };
    const result = detectShock(ev);
    expect(result.indicators.regimeTransition).toBe(true);
  });

  it("returns SHOCK when multiple indicators fire", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      volatility: 5000,
      avgVolatility: 1000,
      change24h: -8,
      vix: 40,
      liquidationSpike: true,
      riskRegimeChanged: true,
    };
    const result = detectShock(ev);
    expect(result.state).toBe("SHOCK");
    expect(result.confidence).toBeGreaterThan(50);
  });

  it("does not produce false shocks from unrelated data", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      shortTermTrend: "bullish",
    };
    const result = detectShock(ev);
    expect(result.state).toBe("NORMAL");
  });

  it("detects cross-asset divergence as elevated", () => {
    const ev: MarketEvidence = {
      price: 100_000,
      correlatedDivergence: true,
    };
    const result = detectShock(ev);
    expect(result.indicators.crossAssetDivergence).toBe(true);
    expect(result.state).toBe("ELEVATED");
  });
});
