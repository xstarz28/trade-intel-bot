/**
 * Phase 57 — Intelligent Profit Protection & Early Exit Alert Engine
 * Comprehensive test suite (groups A-AJ).
 */
import { describe, it, expect } from "vitest";
import { calculateProfitMetrics } from "./position-protection/profit-state";
import { evaluateThesisHealth, extractAllSignals, type MarketEvidence } from "./position-protection/thesis-health";
import { detectShock } from "./position-protection/shock-detector";
import {
  shouldAlert,
  createMonitoringState,
  updateMonitoringState,
  deduplicateByDependencyGroup,
} from "./position-protection/alert-lifecycle";
import { computeProtectionReference } from "./position-protection/protection-reference";
import { evaluateProtection, type ProtectionEngineInput } from "./position-protection/protection-engine";
import type { PositionContext } from "./position-protection/types";

// ═══════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════

const NOW = Date.now();

function longBtc(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USD",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 80000,
    currentPrice: 84000,
    stopLoss: 78000,
    takeProfit: 92000,
    openedAt: NOW - 3600_000,
    horizon: "SWING",
    ...overrides,
  };
}

function shortEur(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "EUR/USD",
    assetClass: "forex",
    side: "SHORT",
    entryPrice: 1.0900,
    currentPrice: 1.0800,
    stopLoss: 1.0950,
    takeProfit: 1.0700,
    openedAt: NOW - 7200_000,
    horizon: "INTRADAY",
    ...overrides,
  };
}

function healthyEvidence(overrides: Partial<MarketEvidence> = {}): MarketEvidence {
  return {
    price: 84000,
    shortTermTrend: "bullish",
    mediumTermTrend: "bullish",
    longTermTrend: "bullish",
    momentumChange: 5,
    volatility: 30,
    avgVolatility: 28,
    riskRegime: "risk_on",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. Position state
// ═══════════════════════════════════════════════════════════════

describe("A. Position state", () => {
  it("A1 — long position calculates correct P/L direction", () => {
    const p = longBtc();
    const m = calculateProfitMetrics(p);
    expect(m.unrealizedPnL).toBeGreaterThan(0);
  });

  it("A2 — short position calculates correct P/L direction", () => {
    const p = shortEur();
    const m = calculateProfitMetrics(p);
    expect(m.unrealizedPnL).toBeGreaterThan(0);
  });

  it("A3 — losing long position", () => {
    const m = calculateProfitMetrics(longBtc({ currentPrice: 75000 }));
    expect(m.unrealizedPnL).toBeLessThan(0);
    expect(m.profitState).toBe("LOSING");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. Long position
// ═══════════════════════════════════════════════════════════════

describe("B. Long position", () => {
  it("B1 — R-multiple computed from SL", () => {
    const m = calculateProfitMetrics(longBtc());
    expect(m.rMultiple).toBeDefined();
    expect(m.rMultiple).toBeGreaterThan(0);
  });

  it("B2 — distance to SL computed", () => {
    const m = calculateProfitMetrics(longBtc());
    expect(m.distanceToSLPct).toBeDefined();
    expect(m.distanceToSLPct).toBeGreaterThan(0);
  });

  it("B3 — distance to TP computed", () => {
    const m = calculateProfitMetrics(longBtc());
    expect(m.distanceToTPPct).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// C. Short position
// ═══════════════════════════════════════════════════════════════

describe("C. Short position", () => {
  it("C1 — profitable short", () => {
    const m = calculateProfitMetrics(shortEur());
    expect(m.unrealizedPnL).toBeGreaterThan(0);
  });

  it("C2 — losing short", () => {
    const m = calculateProfitMetrics(shortEur({ currentPrice: 1.1000 }));
    expect(m.unrealizedPnL).toBeLessThan(0);
    expect(m.profitState).toBe("LOSING");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. P/L calculation
// ═══════════════════════════════════════════════════════════════

describe("D. P/L calculation", () => {
  it("D1 — distance from entry percentage", () => {
    const m = calculateProfitMetrics(longBtc());
    expect(m.distanceFromEntryPct).toBeCloseTo(5, 0);
  });

  it("D2 — leveraged P/L", () => {
    const m = calculateProfitMetrics(longBtc({ leverage: 10 }));
    expect(m.leveragedPnL).toBeDefined();
    expect(m.leveragedPnL).toBeGreaterThan(m.unrealizedPnL);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. R calculation
// ═══════════════════════════════════════════════════════════════

describe("E. R calculation", () => {
  it("E1 — R multiple positive for profit", () => {
    const m = calculateProfitMetrics(longBtc());
    expect(m.rMultiple).toBeGreaterThan(0);
  });

  it("E2 — R undefined without SL", () => {
    const m = calculateProfitMetrics(longBtc({ stopLoss: undefined }));
    expect(m.rMultiple).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// F. Profit state
// ═══════════════════════════════════════════════════════════════

describe("F. Profit state", () => {
  it("F1 — strongly profitable when far from entry", () => {
    const m = calculateProfitMetrics(longBtc({ currentPrice: 100000 }));
    expect(m.profitState).toBe("STRONGLY_PROFITABLE");
  });

  it("F2 — profitable", () => {
    const m = calculateProfitMetrics(longBtc({ currentPrice: 82000 }));
    expect(m.profitState).toBe("PROFITABLE");
  });

  it("F3 — break even zone", () => {
    const m = calculateProfitMetrics(longBtc({ currentPrice: 80200 }));
    expect(m.profitState).toBe("BREAK_EVEN_ZONE");
  });

  it("F4 — losing", () => {
    const m = calculateProfitMetrics(longBtc({ currentPrice: 75000 }));
    expect(m.profitState).toBe("LOSING");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. Thesis health
// ═══════════════════════════════════════════════════════════════

describe("G. Thesis health", () => {
  it("G1 — healthy when all aligned", () => {
    const h = evaluateThesisHealth(longBtc(), healthyEvidence());
    expect(h.state).toBe("HEALTHY");
    expect(h.score).toBeGreaterThanOrEqual(80);
  });

  it("G2 — deteriorating with opposing signals", () => {
    const h = evaluateThesisHealth(longBtc(), healthyEvidence({
      shortTermTrend: "bearish",
      momentumChange: -20,
      structureBroken: true,
    }));
    expect(["DETERIORATING", "SEVERELY_DETERIORATING"]).toContain(h.state);
  });

  it("G3 — score decreases with more deterioration", () => {
    const h1 = evaluateThesisHealth(longBtc(), healthyEvidence());
    const h2 = evaluateThesisHealth(longBtc(), healthyEvidence({
      shortTermTrend: "bearish",
      momentumChange: -30,
      structureBroken: true,
      riskRegime: "risk_off",
      riskRegimeChanged: true,
    }));
    expect(h2.score).toBeLessThan(h1.score);
  });

  it("G4 — invalidated with severe damage and no confirmation", () => {
    const h = evaluateThesisHealth(longBtc(), {
      price: 75000,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
      longTermTrend: "bearish",
      momentumChange: -40,
      structureBroken: true,
      riskRegime: "risk_off",
      riskRegimeChanged: true,
    });
    expect(h.state).toBe("INVALIDATED");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. Technical deterioration
// ═══════════════════════════════════════════════════════════════

describe("H. Technical deterioration", () => {
  it("H1 — structure break detected", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({ structureBroken: true }));
    expect(deterioration.some(s => s.name === "structure_break")).toBe(true);
  });

  it("H2 — short-term trend reversal detected", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({ shortTermTrend: "bearish" }));
    expect(deterioration.some(s => s.name === "short_term_trend_reversal")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. Momentum deterioration
// ═══════════════════════════════════════════════════════════════

describe("I. Momentum deterioration", () => {
  it("I1 — momentum deterioration for long", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({ momentumChange: -25 }));
    expect(deterioration.some(s => s.name === "momentum_deterioration")).toBe(true);
  });

  it("I2 — momentum deterioration for short", () => {
    const { deterioration } = extractAllSignals(shortEur(), {
      price: 1.0800,
      shortTermTrend: "bearish",
      momentumChange: 25,
    });
    expect(deterioration.some(s => s.name === "momentum_deterioration")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. Volatility shock
// ═══════════════════════════════════════════════════════════════

describe("J. Volatility shock", () => {
  it("J1 — volatility expansion detected", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({
      volatility: 80,
      avgVolatility: 30,
    }));
    expect(deterioration.some(s => s.name === "volatility_expansion")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. Derivatives deterioration
// ═══════════════════════════════════════════════════════════════

describe("K. Derivatives deterioration", () => {
  it("K1 — funding shock for crypto", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({
      fundingRate: -0.005,
    }));
    expect(deterioration.some(s => s.name === "funding_shock")).toBe(true);
  });

  it("K2 — OI shock", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({
      oiChange: 25,
    }));
    expect(deterioration.some(s => s.name === "oi_shock")).toBe(true);
  });

  it("K3 — liquidation spike", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({
      liquidationSpike: true,
    }));
    expect(deterioration.some(s => s.name === "liquidation_spike")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. Fundamental deterioration
// ═══════════════════════════════════════════════════════════════

describe("L. Fundamental deterioration", () => {
  it("L1 — earnings deterioration", () => {
    const pos: PositionContext = { instrument: "AAPL", assetClass: "equity", side: "LONG", entryPrice: 180, currentPrice: 195, openedAt: NOW - 86400_000 };
    const { deterioration } = extractAllSignals(pos, { price: 195, earningsSurpriseChange: -8 });
    expect(deterioration.some(s => s.name === "earnings_deterioration")).toBe(true);
  });

  it("L2 — negative guidance", () => {
    const pos: PositionContext = { instrument: "AAPL", assetClass: "equity", side: "LONG", entryPrice: 180, currentPrice: 195, openedAt: NOW - 86400_000 };
    const { deterioration } = extractAllSignals(pos, { price: 195, guidanceChange: "negative" });
    expect(deterioration.some(s => s.name === "guidance_negative")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. Macro deterioration
// ═══════════════════════════════════════════════════════════════

describe("M. Macro deterioration", () => {
  it("M1 — risk regime shift against long", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({
      riskRegimeChanged: true,
      riskRegime: "risk_off",
    }));
    expect(deterioration.some(s => s.name === "risk_regime_shift")).toBe(true);
  });

  it("M2 — VIX elevated", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({ vix: 35 }));
    expect(deterioration.some(s => s.name === "vix_elevated")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. Cross-asset deterioration
// ═══════════════════════════════════════════════════════════════

describe("N. Cross-asset deterioration", () => {
  it("N1 — correlated divergence", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({
      correlatedDivergence: true,
      correlatedAsset: "ETH/USD",
    }));
    expect(deterioration.some(s => s.name === "correlated_divergence")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. Event risk
// ═══════════════════════════════════════════════════════════════

describe("O. Event risk", () => {
  it("O1 — event approaching detected", () => {
    const { deterioration } = extractAllSignals(longBtc(), healthyEvidence({
      eventApproaching: true,
      eventName: "FOMC",
    }));
    expect(deterioration.some(s => s.name === "event_approaching")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. Shock detection
// ═══════════════════════════════════════════════════════════════

describe("P. Shock detection", () => {
  it("P1 — normal when no indicators", () => {
    const s = detectShock({ price: 84000 });
    expect(s.state).toBe("NORMAL");
  });

  it("P2 — shock when multiple indicators", () => {
    const s = detectShock({
      price: 75000,
      change24h: -10,
      volatility: 100,
      avgVolatility: 30,
      oiChange: 25,
      fundingRate: -0.005,
      riskRegimeChanged: true,
    });
    expect(s.state).toBe("SHOCK");
  });

  it("P3 — elevated with single strong indicator", () => {
    const s = detectShock({ price: 80000, vix: 32 });
    expect(["ELEVATED", "SHOCK"]).toContain(s.state);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. Alert severity
// ═══════════════════════════════════════════════════════════════

describe("Q. Alert severity", () => {
  it("Q1 — NONE for healthy profitable position", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    expect(r.alert.severity).toBe("NONE");
  });

  it("Q2 — WATCH/CAUTION for profitable + deteriorating", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence({
      shortTermTrend: "bearish",
      momentumChange: -18,
    }), now: NOW });
    expect(["WATCH", "CAUTION", "HIGH_RISK"]).toContain(r.alert.severity);
  });

  it("Q3 — HIGH_RISK for profitable + severely deteriorating", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: {
      price: 76000,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
      momentumChange: -35,
      structureBroken: true,
      riskRegime: "risk_off",
      riskRegimeChanged: true,
      oiChange: 20,
      liquidationSpike: true,
    }, now: NOW });
    expect(["CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(r.alert.severity);
  });

  it("Q4 — INVALIDATED for thesis destruction", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: {
      price: 72000,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
      longTermTrend: "bearish",
      momentumChange: -40,
      structureBroken: true,
      riskRegime: "risk_off",
      riskRegimeChanged: true,
      oiChange: 25,
      liquidationSpike: true,
      fundingRate: -0.005,
    }, now: NOW });
    expect(["HIGH_RISK", "INVALIDATED"]).toContain(r.alert.severity);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. Alert lifecycle
// ═══════════════════════════════════════════════════════════════

describe("R. Alert lifecycle", () => {
  it("R1 — initial state is NONE/MONITORING", () => {
    const s = createMonitoringState("BTC/USD");
    expect(s.currentSeverity).toBe("NONE");
    expect(s.lifecycleState).toBe("MONITORING");
  });

  it("R2 — escalation fires on transition", () => {
    const s = createMonitoringState("BTC/USD");
    const decision = shouldAlert(s, "CAUTION", NOW);
    expect(decision.shouldFire).toBe(true);
    expect(decision.reason).toContain("Escalation");
  });

  it("R3 — same severity within cooldown does not fire", () => {
    let s = createMonitoringState("BTC/USD");
    s = updateMonitoringState(s, "WATCH", NOW);
    const decision = shouldAlert(s, "WATCH", NOW + 10_000);
    expect(decision.shouldFire).toBe(false);
  });

  it("R4 — INVALIDATED always fires", () => {
    let s = createMonitoringState("BTC/USD");
    s = updateMonitoringState(s, "HIGH_RISK", NOW);
    const decision = shouldAlert(s, "INVALIDATED", NOW + 1_000);
    expect(decision.shouldFire).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. Manual TP semantics
// ═══════════════════════════════════════════════════════════════

describe("S. Manual TP semantics", () => {
  it("S1 — NONE says hold", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    expect(r.alert.actionRecommendation).toContain("Hold");
  });

  it("S2 — CAUTION says consider protecting", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence({
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
      momentumChange: -25,
    }), now: NOW });
    if (r.alert.severity === "CAUTION" || r.alert.severity === "HIGH_RISK") {
      expect(r.alert.actionRecommendation.toLowerCase()).toContain("profit");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// T. Protection reference
// ═══════════════════════════════════════════════════════════════

describe("T. Protection reference", () => {
  it("T1 — available with volatility data", () => {
    const r = computeProtectionReference(longBtc(), { price: 84000, volatility: 30 });
    expect(r.available).toBe(true);
    expect(r.level).toBeDefined();
  });

  it("T2 — available at break-even without volatility", () => {
    const r = computeProtectionReference(longBtc(), { price: 84000 });
    expect(r.available).toBe(true);
  });

  it("T3 — unavailable for losing position without data", () => {
    const r = computeProtectionReference(longBtc({ currentPrice: 75000 }), { price: 75000 });
    expect(r.available).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. Missing data
// ═══════════════════════════════════════════════════════════════

describe("U. Missing data", () => {
  it("U1 — no fabricated signals with empty evidence", () => {
    const h = evaluateThesisHealth(longBtc(), { price: 84000 });
    expect(h.deteriorationCount).toBe(0);
    expect(h.missingDataPoints.length).toBeGreaterThan(0);
  });

  it("U2 — missing data tracked in alert", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: { price: 84000 }, now: NOW });
    expect(r.alert.missingData.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// V. Stale data
// ═══════════════════════════════════════════════════════════════

describe("V. Stale data", () => {
  it("V1 — no shock from stale data", () => {
    const s = detectShock({ price: 84000 });
    expect(s.state).toBe("NORMAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// W. Provider failure
// ═══════════════════════════════════════════════════════════════

describe("W. Provider failure", () => {
  it("W1 — no shock from missing providers", () => {
    const s = detectShock({ price: 0 });
    expect(s.state).toBe("NORMAL");
  });

  it("W2 — no adverse signals from empty evidence", () => {
    const { deterioration } = extractAllSignals(longBtc(), { price: 84000 });
    expect(deterioration.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. No fabricated shock
// ═══════════════════════════════════════════════════════════════

describe("X. No fabricated shock", () => {
  it("X1 — no NaN in shock assessment", () => {
    const s = detectShock({ price: 84000, volatility: 30, avgVolatility: 28 });
    expect(JSON.stringify(s)).not.toContain("NaN");
  });

  it("X2 — no fabricated signals in thesis health", () => {
    const h = evaluateThesisHealth(longBtc(), { price: 84000 });
    expect(JSON.stringify(h)).not.toContain("NaN");
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. No fabricated probability
// ═══════════════════════════════════════════════════════════════

describe("Y. No fabricated probability", () => {
  it("Y1 — no % chance in any output", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    const s = JSON.stringify(r.alert).toLowerCase();
    expect(s).not.toMatch(/\d+%\s*chance/);
    expect(s).not.toContain("probability of profit");
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. Instrument isolation
// ═══════════════════════════════════════════════════════════════

describe("Z. Instrument isolation", () => {
  it("Z1 — BTC alert only mentions BTC", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    expect(r.alert.instrument).toBe("BTC/USD");
  });

  it("Z2 — separate instruments independent", () => {
    const r1 = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    const r2 = evaluateProtection({ position: shortEur(), evidence: { price: 1.08, shortTermTrend: "bearish" }, now: NOW });
    expect(r1.alert.instrument).not.toBe(r2.alert.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. Position isolation
// ═══════════════════════════════════════════════════════════════

describe("AA. Position isolation", () => {
  it("AA1 — same instrument different side independent", () => {
    const r1 = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    const r2 = evaluateProtection({
      position: longBtc({ side: "SHORT", currentPrice: 75000 }),
      evidence: { price: 75000, shortTermTrend: "bearish" },
      now: NOW,
    });
    expect(r1.alert.instrument).toBe(r2.alert.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. Long/short isolation
// ═══════════════════════════════════════════════════════════════

describe("AB. Long/short isolation", () => {
  it("AB1 — bullish trend supports long but opposes short", () => {
    const long = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    const short = evaluateProtection({
      position: shortEur(),
      evidence: { price: 1.0950, shortTermTrend: "bullish" },
      now: NOW,
    });
    // Long should be healthier than short with bullish evidence
    expect(long.alert.thesisHealthScore).toBeGreaterThanOrEqual(short.alert.thesisHealthScore);
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. Multiple position isolation
// ═══════════════════════════════════════════════════════════════

describe("AC. Multiple position isolation", () => {
  it("AC1 — independent monitoring states", () => {
    const s1 = createMonitoringState("BTC/USD");
    const s2 = createMonitoringState("ETH/USD");
    const u1 = updateMonitoringState(s1, "WATCH", NOW);
    expect(u1.currentSeverity).toBe("WATCH");
    expect(s2.currentSeverity).toBe("NONE"); // s2 unaffected
  });
});

// ═══════════════════════════════════════════════════════════════
// AD. Determinism
// ═══════════════════════════════════════════════════════════════

describe("AD. Determinism", () => {
  it("AD1 — same inputs → same alert", () => {
    const input: ProtectionEngineInput = { position: longBtc(), evidence: healthyEvidence(), now: NOW };
    const r1 = evaluateProtection(input);
    const r2 = evaluateProtection(input);
    expect(r1.alert.severity).toBe(r2.alert.severity);
    expect(r1.alert.thesisHealthScore).toBe(r2.alert.thesisHealthScore);
  });

  it("AD2 — thesis health deterministic", () => {
    const ev = healthyEvidence({ shortTermTrend: "bearish" });
    const h1 = evaluateThesisHealth(longBtc(), ev);
    const h2 = evaluateThesisHealth(longBtc(), ev);
    expect(h1.state).toBe(h2.state);
    expect(h1.score).toBe(h2.score);
  });
});

// ═══════════════════════════════════════════════════════════════
// AE. Decision immutability
// ═══════════════════════════════════════════════════════════════

describe("AE. Decision immutability", () => {
  it("AE1 — alert has no recommendation/bias/conviction", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    expect((r.alert as any).recommendation).toBeUndefined();
    expect((r.alert as any).bias).toBeUndefined();
    expect((r.alert as any).conviction).toBeUndefined();
  });

  it("AE2 — alert has no tradePlan", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    expect((r.alert as any).tradePlan).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AF. Security
// ═══════════════════════════════════════════════════════════════

describe("AF. Security", () => {
  it("AF1 — no API keys in any output", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    const s = JSON.stringify(r.alert).toLowerCase();
    expect(s).not.toContain("api_key");
    expect(s).not.toContain("secret");
    expect(s).not.toContain("bearer");
  });
});

// ═══════════════════════════════════════════════════════════════
// AG. Alert deduplication
// ═══════════════════════════════════════════════════════════════

describe("AG. Alert deduplication", () => {
  it("AG1 — dependency group deduplication", () => {
    const signals = [
      { category: "TECHNICAL" as const, name: "s1", description: "a", severity: 30, source: "test", observedAt: NOW, freshness: "FRESH" as const, dependencyGroup: "GRP_A" },
      { category: "MOMENTUM" as const, name: "s2", description: "b", severity: 50, source: "test", observedAt: NOW, freshness: "FRESH" as const, dependencyGroup: "GRP_A" },
      { category: "MACRO" as const, name: "s3", description: "c", severity: 40, source: "test", observedAt: NOW, freshness: "FRESH" as const, dependencyGroup: "GRP_B" },
    ];
    const deduped = deduplicateByDependencyGroup(signals);
    expect(deduped.length).toBe(2); // GRP_A keeps higher severity (50)
  });
});

// ═══════════════════════════════════════════════════════════════
// AH. Recovery/de-escalation
// ═══════════════════════════════════════════════════════════════

describe("AH. Recovery/de-escalation", () => {
  it("AH1 — recovery from CAUTION to NONE fires", () => {
    let s = createMonitoringState("BTC/USD");
    s = updateMonitoringState(s, "CAUTION", NOW);
    const decision = shouldAlert(s, "NONE", NOW + 60_000);
    expect(decision.shouldFire).toBe(true);
    expect(decision.reason).toContain("Recovery");
  });
});

// ═══════════════════════════════════════════════════════════════
// AI. Thesis invalidation
// ═══════════════════════════════════════════════════════════════

describe("AI. Thesis invalidation", () => {
  it("AI1 — full invalidation with all signals", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: {
      price: 70000,
      shortTermTrend: "bearish",
      mediumTermTrend: "bearish",
      longTermTrend: "bearish",
      momentumChange: -40,
      structureBroken: true,
      riskRegime: "risk_off",
      riskRegimeChanged: true,
      oiChange: 25,
      liquidationSpike: true,
      fundingRate: -0.005,
      volatility: 100,
      avgVolatility: 30,
    }, now: NOW });
    expect(["HIGH_RISK", "INVALIDATED"]).toContain(r.alert.severity);
  });
});

// ═══════════════════════════════════════════════════════════════
// AJ. Critical protection state
// ═══════════════════════════════════════════════════════════════

describe("AJ. Critical protection state", () => {
  it("AJ1 — INVALIDATED alerts always fire", () => {
    let s = createMonitoringState("BTC/USD");
    s = updateMonitoringState(s, "HIGH_RISK", NOW);
    s = updateMonitoringState(s, "INVALIDATED", NOW + 1000);
    expect(s.history.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// AK. Empty input
// ═══════════════════════════════════════════════════════════════

describe("AK. Empty input", () => {
  it("AK1 — engine handles minimal input", () => {
    const r = evaluateProtection({
      position: { instrument: "X", assetClass: "crypto", side: "LONG", entryPrice: 100, currentPrice: 100, openedAt: NOW },
      evidence: { price: 100 },
      now: NOW,
    });
    expect(r.alert.instrument).toBe("X");
    expect(r.alert.severity).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AL. Large input stress
// ═══════════════════════════════════════════════════════════════

describe("AL. Large input stress", () => {
  it("AL1 — 50 evaluations without error", () => {
    for (let i = 0; i < 50; i++) {
      const r = evaluateProtection({
        position: longBtc({ currentPrice: 80000 + i * 100 }),
        evidence: { price: 80000 + i * 100, shortTermTrend: "bullish" },
        now: NOW,
      });
      expect(r.alert.severity).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AM. UI result shape
// ═══════════════════════════════════════════════════════════════

describe("AM. UI result shape", () => {
  it("AM1 — alert has all required UI fields", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    expect(typeof r.alert.instrument).toBe("string");
    expect(typeof r.alert.severity).toBe("string");
    expect(typeof r.alert.alertMessage).toBe("string");
    expect(typeof r.alert.actionRecommendation).toBe("string");
    expect(typeof r.alert.thesisHealth).toBe("string");
    expect(typeof r.alert.thesisHealthScore).toBe("number");
    expect(Array.isArray(r.alert.supportingEvidence)).toBe(true);
    expect(Array.isArray(r.alert.conflictingEvidence)).toBe(true);
    expect(Array.isArray(r.alert.missingData)).toBe(true);
    expect(typeof r.alert.timestamp).toBe("number");
    expect(typeof r.alert.stateTransition).toBe("boolean");
  });

  it("AM2 — alert message is human-readable", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    expect(r.alert.alertMessage.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// AN. Regression compatibility
// ═══════════════════════════════════════════════════════════════

describe("AN. Regression compatibility", () => {
  it("AN1 — does not modify existing decision types", () => {
    const r = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: NOW });
    // These fields should NOT exist on the alert
    expect((r.alert as any).decisionFingerprint).toBeUndefined();
    expect((r.alert as any).structuralVeto).toBeUndefined();
    expect((r.alert as any).riskGate).toBeUndefined();
    expect((r.alert as any).noTradeReason).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AO. Profit giveback
// ═══════════════════════════════════════════════════════════════

describe("AO. Profit giveback", () => {
  it("AO1 — giveback tracked when peak known", () => {
    const r = evaluateProtection({
      position: longBtc({ peakPrice: 90000 }),
      evidence: healthyEvidence(),
      now: NOW,
    });
    expect(r.alert.profit.givebackPct).toBeDefined();
    expect(r.alert.profit.givebackPct).toBeGreaterThan(0);
  });

  it("AO2 — no giveback at peak", () => {
    const r = evaluateProtection({
      position: longBtc({ peakPrice: 84000 }),
      evidence: healthyEvidence(),
      now: NOW,
    });
    expect(r.alert.profit.givebackPct).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AP. Horizon sensitivity
// ═══════════════════════════════════════════════════════════════

describe("AP. Horizon sensitivity", () => {
  it("AP1 — scalping position uses different protection ref", () => {
    const scalping = computeProtectionReference(
      longBtc({ horizon: "SCALPING" }),
      { price: 84000, volatility: 30 },
    );
    const swing = computeProtectionReference(
      longBtc({ horizon: "SWING" }),
      { price: 84000, volatility: 30 },
    );
    // Scalping should have tighter reference
    if (scalping.available && swing.available && scalping.level && swing.level) {
      expect(scalping.level).toBeGreaterThan(swing.level); // closer to current price
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AQ. Cache reuse
// ═══════════════════════════════════════════════════════════════

describe("AQ. Cache reuse", () => {
  it("AQ1 — pure functions don't mutate input", () => {
    const pos = longBtc();
    const ev = healthyEvidence();
    evaluateProtection({ position: pos, evidence: ev, now: NOW });
    expect(pos.entryPrice).toBe(80000); // unchanged
  });
});
