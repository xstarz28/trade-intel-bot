import { describe, it, expect } from "vitest";
import { evaluateProtection } from "./protection-engine";
import type { PositionContext } from "./types";
import type { MarketEvidence } from "./thesis-health";

function longPosition(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 50000,
    currentPrice: 52000,
    stopLoss: 49000,
    openedAt: Date.now(),
    horizon: "SWING",
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

describe("evaluateProtection", () => {
  it("returns NONE severity for healthy profitable position", () => {
    const result = evaluateProtection({
      position: longPosition(),
      evidence: healthyEvidence(),
      now: Date.now(),
    });
    expect(result.alert.severity).toBe("NONE");
    expect(result.alert.instrument).toBe("BTC/USDT");
    expect(result.alert.thesisHealth).toBe("HEALTHY");
    // Severity NONE matches initial state's NONE → no state transition
    expect(result.alert.stateTransition).toBe(false);
  });

  it("returns CAUTION when thesis is deteriorating", () => {
    const result = evaluateProtection({
      position: longPosition({ currentPrice: 48000 }),
      evidence: {
        price: 48000,
        shortTermTrend: "bearish",
        mediumTermTrend: "bearish",
        structureBroken: true,
        riskRegime: "risk_off",
      },
      now: Date.now(),
    });
    expect(["CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(result.alert.severity);
    expect(result.alert.conflictingEvidence.length).toBeGreaterThan(0);
  });

  it("returns INVALIDATED with severe deterioration and no confirming signals", () => {
    const result = evaluateProtection({
      position: longPosition({ currentPrice: 45000 }),
      evidence: {
        price: 45000,
        shortTermTrend: "bearish",
        mediumTermTrend: "bearish",
        structureBroken: true,
        riskRegimeChanged: true,
        riskRegime: "risk_off",
        momentumChange: -25,
      },
      now: Date.now(),
    });
    expect(result.alert.severity).toBe("INVALIDATED");
    expect(result.alert.actionRecommendation).toContain("closing");
  });

  it("tracks peak profit and giveback", () => {
    const now = Date.now();
    const first = evaluateProtection({
      position: longPosition({ peakPrice: 53000 }),
      evidence: healthyEvidence(),
      now,
    });
    expect(first.alert.profit.peakProfit).toBeDefined();
    expect(first.alert.profit.givebackPct).toBeDefined();
  });

  it("computes protection reference for profitable positions", () => {
    const result = evaluateProtection({
      position: longPosition({ currentPrice: 53000, peakPrice: 53000 }),
      evidence: { ...healthyEvidence(), volatility: 1000 },
      now: Date.now(),
    });
    expect(result.alert.protectionReference).toBeDefined();
  });

  it("produces deterministic output for same inputs", () => {
    const now = 1234567890;
    const input = {
      position: longPosition(),
      evidence: healthyEvidence(),
      now,
    };
    const r1 = evaluateProtection(input);
    const r2 = evaluateProtection(input);
    expect(r1.alert.severity).toBe(r2.alert.severity);
    expect(r1.alert.thesisHealthScore).toBe(r2.alert.thesisHealthScore);
    expect(r1.alert.shock.state).toBe(r2.alert.shock.state);
  });

  it("returns action recommendation for each severity", () => {
    const severities = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const;
    for (const severity of severities) {
      let evidence: MarketEvidence;
      let pos: PositionContext;

      if (severity === "NONE") {
        evidence = healthyEvidence();
        pos = longPosition();
      } else if (severity === "WATCH") {
        evidence = {
          price: 52000,
          shortTermTrend: "bearish",
          mediumTermTrend: "bullish",
        };
        pos = longPosition();
      } else if (severity === "CAUTION") {
        evidence = {
          price: 48000,
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
        };
        pos = longPosition({ currentPrice: 48000 });
      } else {
        evidence = {
          price: 45000,
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
          riskRegimeChanged: true,
          riskRegime: "risk_off",
          momentumChange: -30,
        };
        pos = longPosition({ currentPrice: 45000 });
      }

      const result = evaluateProtection({
        position: pos,
        evidence,
        now: Date.now(),
      });
      expect(result.alert.actionRecommendation).toBeDefined();
      expect(result.alert.actionRecommendation.length).toBeGreaterThan(0);
    }
  });

  it("includes missing data in alert", () => {
    const result = evaluateProtection({
      position: longPosition(),
      evidence: { price: 52000 },
      now: Date.now(),
    });
    expect(result.alert.missingData.length).toBeGreaterThan(0);
  });

  it("includes deterioration signals when present", () => {
    const result = evaluateProtection({
      position: longPosition({ currentPrice: 48000 }),
      evidence: {
        price: 48000,
        shortTermTrend: "bearish",
        momentumChange: -20,
        volatility: 5000,
        avgVolatility: 1000,
      },
      now: Date.now(),
    });
    expect(result.alert.deteriorationSignals.length).toBeGreaterThan(0);
  });
});
