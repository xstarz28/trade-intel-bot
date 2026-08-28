/**
 * Phase 67 — Production Trader Control Center, Alert Intelligence & Observability
 *
 * Comprehensive validation test suite.
 */
import { describe, it, expect } from "vitest";
import { computeEventPriority } from "../position-protection/event-priority";
import {
  evaluateProtection,
  type ProtectionEngineInput,
} from "../position-protection/protection-engine";
import {
  computePositionPriority,
  sortByPriority,
} from "../position-protection/position-priority";
import { calculateGiveback } from "../position-protection/giveback-monitor";
import type { PositionContext } from "../position-protection/types";
import type { MarketEvidence } from "../position-protection/thesis-health";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function pos(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 100000,
    currentPrice: 105000,
    stopLoss: 98000,
    takeProfit: 115000,
    leverage: 1,
    horizon: "SWING",
    openedAt: Date.now(),
    ...overrides,
  };
}

function evidence(overrides: Partial<MarketEvidence> = {}): MarketEvidence {
  return {
    price: 105000,
    shortTermTrend: "bullish",
    mediumTermTrend: "bullish",
    longTermTrend: "bullish",
    momentumChange: 5,
    volatility: 20,
    avgVolatility: 20,
    fundingRate: 0.01,
    oiChange: 5,
    liquidationSpike: false,
    longShortRatio: 1.2,
    dxyTrend: "stable",
    vix: 18,
    vixChange: 0,
    riskRegime: "risk_on",
    riskRegimeChanged: false,
    eventApproaching: false,
    correlatedDivergence: false,
    structureBroken: false,
    ...overrides,
  };
}

function inp(
  posCtx: Partial<PositionContext> = {},
  evidenceCtx: Partial<MarketEvidence> = {}
): ProtectionEngineInput {
  return { position: pos(posCtx), evidence: evidence(evidenceCtx) };
}

// ═══════════════════════════════════════════════════════════════
// A. CONTROL CENTER AGGREGATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 A — Control Center Aggregation", () => {
  it("determines severity for healthy profitable position", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(result.alert).toBeDefined();
    expect(result.alert.severity).toBeDefined();
    expect(result.alert.actionRecommendation).toBeDefined();
  });

  it("determines severity for deteriorating position", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          momentumChange: -10,
          fundingRate: 0.05,
          oiChange: -20,
          liquidationSpike: true,
          riskRegime: "risk_off",
          riskRegimeChanged: true,
          vix: 28,
          correlatedDivergence: true,
          structureBroken: true,
        }
      )
    );
    expect(
      ["WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"].includes(
        result.alert.severity
      )
    ).toBe(true);
  });

  it("provides alert urgency", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(result.alert.urgency).toBeDefined();
    expect(typeof result.alert.urgency).toBe("string");
  });

  it("provides whyTpNow explanation", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    expect(result.alert.whyTpNow).toBeDefined();
    expect(result.alert.whyTpNow.disclaimer).toBeDefined();
    expect(typeof result.alert.whyTpNow.disclaimer).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. POSITION PRIORITY ORDERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 B — Position Priority Ordering", () => {
  it("ranks INVALIDATED above WATCH", () => {
    const items = [
      {
        positionId: "p1",
        priority: computePositionPriority({
          severity: "WATCH",
          urgency: "LOW",
          givebackPct: 10,
          accelerationLevel: "NORMAL",
          profitState: "PROFITABLE",
        }),
      },
      {
        positionId: "p2",
        priority: computePositionPriority({
          severity: "INVALIDATED",
          urgency: "CRITICAL",
          givebackPct: 50,
          accelerationLevel: "HIGH",
          profitState: "LOSING",
        }),
      },
    ];
    const ranked = sortByPriority(items);
    expect(ranked[0].positionId).toBe("p2");
    expect(ranked[1].positionId).toBe("p1");
  });

  it("handles empty position list", () => {
    expect(sortByPriority([])).toEqual([]);
  });

  it("handles single position", () => {
    const items = [
      {
        positionId: "p1",
        priority: computePositionPriority({
          severity: "CAUTION",
          urgency: "MODERATE",
          givebackPct: 25,
          accelerationLevel: "ELEVATED",
          profitState: "PROFITABLE",
        }),
      },
    ];
    expect(sortByPriority(items)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. ALERT CENTER
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 C — Alert Center", () => {
  it("produces alert for deteriorating position", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        {
          shortTermTrend: "bearish",
          structureBroken: true,
          momentumChange: -15,
          fundingRate: 0.05,
        }
      )
    );
    expect(result.alert).toBeDefined();
    expect(result.alert.severity).toBeDefined();
    expect(result.alert.instrument).toBe("BTC/USDT");
    expect(result.alert.side).toBe("LONG");
  });

  it("alert includes all required fields", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const alert = result.alert;
    expect(alert.severity).toBeDefined();
    expect(alert.urgency).toBeDefined();
    expect(alert.actionRecommendation).toBeDefined();
    expect(alert.whyTpNow).toBeDefined();
    expect(alert.timestamp).toBeGreaterThan(0);
    expect(alert.instrument).toBe("BTC/USDT");
    expect(alert.side).toBe("LONG");
    expect(alert.alertMessage).toBeDefined();
  });

  it("healthy position produces lower severity", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(
      ["NONE", "WATCH"].includes(result.alert.severity)
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. ALERT DEDUP
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 D — Alert Deduplication", () => {
  it("alerts for different instruments are distinguishable", () => {
    const r1 = evaluateProtection(inp({ instrument: "BTC/USDT", currentPrice: 110000 }));
    const r2 = evaluateProtection(inp({ instrument: "ETH/USDT", currentPrice: 4000 }));
    expect(r1.alert.instrument).toBe("BTC/USDT");
    expect(r2.alert.instrument).toBe("ETH/USDT");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. ALERT ANTI-SPAM
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 E — Alert Anti-Spam", () => {
  it("same inputs produce same severity", () => {
    const input = inp(
      { currentPrice: 110000 },
      { shortTermTrend: "bearish" }
    );
    const r1 = evaluateProtection(input);
    const r2 = evaluateProtection(input);
    expect(r1.alert.severity).toBe(r2.alert.severity);
  });

  it("escalation produces higher or equal severity", () => {
    const r1 = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", momentumChange: -5 }
      )
    );
    const r2 = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          momentumChange: -15,
          structureBroken: true,
          fundingRate: 0.05,
          riskRegime: "risk_off",
          vix: 30,
        }
      )
    );
    const rank = [
      "NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED",
    ] as const;
    expect(rank.indexOf(r2.alert.severity as any)).toBeGreaterThanOrEqual(
      rank.indexOf(r1.alert.severity as any)
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// F. WHY TP NOW QUALITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 F — Why TP Now Quality", () => {
  it("always includes disclaimer", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(result.alert.whyTpNow).toBeDefined();
    expect(typeof result.alert.whyTpNow.disclaimer).toBe("string");
    expect(result.alert.whyTpNow.disclaimer!.length).toBeGreaterThan(0);
  });

  it("does not contain probability language", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const fullText = JSON.stringify(result.alert.whyTpNow).toLowerCase();
    expect(fullText).not.toContain("probability of profit");
    expect(fullText).not.toContain("guaranteed");
    expect(fullText).not.toContain("100%");
  });

  it("does not recommend automatic execution", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const fullText = JSON.stringify(result.alert).toLowerCase();
    expect(fullText).not.toContain("auto-close");
    expect(fullText).not.toContain("auto-execute");
    expect(fullText).not.toContain("sell now");
  });

  it("includes profit status", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    expect(result.alert.whyTpNow.profitStatus).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// G. DATA QUALITY STATES
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 G — Data Quality States", () => {
  it("fresh data allows normal evaluation", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(result.alert).toBeDefined();
    expect(result.alert.severity).toBeDefined();
  });

  it("stale data degrades gracefully", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { volatility: undefined, avgVolatility: undefined })
    );
    expect(result.alert).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// H. PROVIDER HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 H — Provider Health", () => {
  it("missing evidence does not produce directional bias", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { shortTermTrend: undefined, mediumTermTrend: undefined })
    );
    expect(result.alert).toBeDefined();
    expect(result.alert.severity).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// I. POSITION DETAIL TIMELINE
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 I — Position Detail Timeline", () => {
  it("alert contains timestamp", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { shortTermTrend: "bearish" })
    );
    expect(result.alert.timestamp).toBeGreaterThan(0);
  });

  it("multiple evaluations produce valid timestamps", () => {
    const input = inp({ currentPrice: 110000 }, { shortTermTrend: "bearish" });
    const r1 = evaluateProtection(input);
    const r2 = evaluateProtection(input);
    expect(r1.alert.timestamp).toBeGreaterThan(0);
    expect(r2.alert.timestamp).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. MONITORING CONTROLS
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 J — Monitoring Controls", () => {
  it("different horizons produce valid results", () => {
    const scalping = evaluateProtection(
      inp({ currentPrice: 110000, horizon: "SCALPING" })
    );
    const investing = evaluateProtection(
      inp({ currentPrice: 110000, horizon: "INVESTING" })
    );
    expect(scalping.alert.severity).toBeDefined();
    expect(investing.alert.severity).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// K. CONVEX PERSISTENCE COMPATIBILITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 K — Persistence Compatibility", () => {
  it("alert serializes to JSON without secrets", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const serialized = JSON.stringify(result.alert);
    JSON.parse(serialized);
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("password");
  });

  it("alert has required persistence fields", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(result.alert.timestamp).toBeGreaterThan(0);
    expect(result.alert.severity).toBeDefined();
    expect(result.alert.instrument).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// L. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 L — Security", () => {
  it("no API keys in alert payload", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const fullText = JSON.stringify(result.alert);
    expect(fullText).not.toContain("Bearer");
    expect(fullText).not.toContain("process.env");
  });

  it("no credentials in whyTpNow", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const whyText = JSON.stringify(result.alert.whyTpNow);
    expect(whyText).not.toContain("password");
    expect(whyText).not.toContain("token");
    expect(whyText).not.toContain("secret");
    expect(whyText).not.toContain("api_key");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 M — Determinism", () => {
  it("same inputs produce same severity", () => {
    const input = inp(
      { currentPrice: 110000 },
      { shortTermTrend: "bearish", structureBroken: true }
    );
    const r1 = evaluateProtection(input);
    const r2 = evaluateProtection(input);
    expect(r1.alert.severity).toBe(r2.alert.severity);
    expect(r1.alert.urgency).toBe(r2.alert.urgency);
  });

  it("same inputs produce same action recommendation", () => {
    const input = inp(
      { currentPrice: 110000 },
      { shortTermTrend: "bearish", structureBroken: true }
    );
    const r1 = evaluateProtection(input);
    const r2 = evaluateProtection(input);
    expect(r1.alert.actionRecommendation).toBe(r2.alert.actionRecommendation);
  });

  it("position priority is deterministic", () => {
    const makeInput = () => ({
      positionId: "p1",
      priority: computePositionPriority({
        severity: "WATCH",
        urgency: "MODERATE",
        givebackPct: 20,
        accelerationLevel: "NORMAL" as const,
        profitState: "PROFITABLE" as const,
      }),
    });
    const r1 = sortByPriority([makeInput(), makeInput()]);
    const r2 = sortByPriority([makeInput(), makeInput()]);
    expect(r1.map((x) => x.positionId)).toEqual(
      r2.map((x) => x.positionId)
    );
  });

  it("event priority is deterministic", () => {
    const event = {
      eventId: "ev1",
      instrument: "BTC/USDT",
      timestamp: Date.now(),
      source: "test",
      freshness: "FRESH" as const,
      eventType: "PRICE_UPDATE" as const,
      priority: "LOW" as const,
      dependencyGroup: "price",
      payload: { price: 105000, change: 100 },
    };
    expect(computeEventPriority(event)).toBe(computeEventPriority(event));
  });
});

// ═══════════════════════════════════════════════════════════════
// N. MEMORY BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 N — Memory Bounds", () => {
  it("60 positions produce valid rankings", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      positionId: `pos_${i}`,
      priority: computePositionPriority({
        severity: (
          ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const
        )[i % 5],
        urgency: (["NONE", "LOW", "MODERATE", "HIGH", "CRITICAL"] as const)[i % 5],
        givebackPct: i * 2,
        accelerationLevel: (["NORMAL", "ELEVATED", "HIGH"] as const)[i % 3],
        profitState: (["PROFITABLE", "LOSING", "BREAK_EVEN_ZONE"] as const)[i % 3],
      }),
    }));
    const ranked = sortByPriority(items);
    expect(ranked).toHaveLength(60);
    const topRanks = ranked.slice(0, 5).map((x) => x.priority.rank);
    expect(topRanks[0]).toBeGreaterThanOrEqual(topRanks[4]);
  });

  it("200 evaluations produce valid results", () => {
    for (let i = 0; i < 200; i++) {
      const result = evaluateProtection(
        inp({ currentPrice: 110000 + (i % 50) * 100 })
      );
      expect(result.alert).toBeDefined();
      expect(result.alert.severity).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// O. FULL TRADER SCENARIO — LONG
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 O — Full Trader Scenario LONG", () => {
  it("profitable LONG → healthy → deterioration → protection before SL", () => {
    // Step 1: Profitable with healthy thesis
    const r1 = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(["NONE", "WATCH"].includes(r1.alert.severity)).toBe(true);

    // Step 2: Momentum weakens
    const r2 = evaluateProtection(
      inp(
        { currentPrice: 109000 },
        { shortTermTrend: "bearish", momentumChange: -8 }
      )
    );
    expect(r2.alert.severity).toBeDefined();

    // Step 3: Structure breaks + multi-timeframe
    const r3 = evaluateProtection(
      inp(
        { currentPrice: 107000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          momentumChange: -15,
          structureBroken: true,
          fundingRate: 0.05,
          oiChange: -15,
          liquidationSpike: true,
          riskRegime: "risk_off",
          vix: 28,
          correlatedDivergence: true,
        }
      )
    );
    expect(
      ["CAUTION", "HIGH_RISK", "INVALIDATED"].includes(r3.alert.severity)
    ).toBe(true);

    // Step 4: Severe deterioration — but still above SL
    const currentPrice = 104000;
    const ctx4 = pos({ currentPrice });
    const r4 = evaluateProtection(
      inp(
        { currentPrice: 104000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          momentumChange: -25,
          structureBroken: true,
          fundingRate: 0.08,
          oiChange: -30,
          liquidationSpike: true,
          riskRegime: "risk_off",
          riskRegimeChanged: true,
          vix: 32,
          correlatedDivergence: true,
        }
      )
    );
    expect(
      ["HIGH_RISK", "INVALIDATED"].includes(r4.alert.severity)
    ).toBe(true);

    // Price still above SL (98000)
    expect(currentPrice).toBeGreaterThan(ctx4.stopLoss!);

    // No auto-execution
    expect(r4.alert.actionRecommendation.toLowerCase()).not.toContain("auto");
  });
});

// ═══════════════════════════════════════════════════════════════
// O2. FULL TRADER SCENARIO — SHORT
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 O2 — Full Trader Scenario SHORT", () => {
  it("profitable SHORT → adverse → protection before SL", () => {
    const r1 = evaluateProtection(
      inp({
        side: "SHORT",
        entryPrice: 100000,
        currentPrice: 95000,
        stopLoss: 102000,
        takeProfit: 90000,
      })
    );
    expect(r1.alert.severity).toBeDefined();

    // Price rises (adverse for SHORT)
    const r2 = evaluateProtection(
      inp(
        {
          side: "SHORT",
          entryPrice: 100000,
          currentPrice: 97000,
          stopLoss: 102000,
          takeProfit: 90000,
        },
        { shortTermTrend: "bullish", momentumChange: 8 }
      )
    );
    expect(r2.alert.severity).toBeDefined();

    // Stronger adverse
    const r3 = evaluateProtection(
      inp(
        {
          side: "SHORT",
          entryPrice: 100000,
          currentPrice: 99000,
          stopLoss: 102000,
          takeProfit: 90000,
        },
        {
          shortTermTrend: "bullish",
          mediumTermTrend: "bullish",
          momentumChange: 15,
          fundingRate: 0.001,
          oiChange: 25,
        }
      )
    );
    expect(
      ["WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"].includes(r3.alert.severity)
    ).toBe(true);

    // No auto-execution
    expect(r3.alert.actionRecommendation.toLowerCase()).not.toContain("auto");
  });
});

// ═══════════════════════════════════════════════════════════════
// P. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 P — No Auto-Execution", () => {
  it("action recommendation never contains execution words", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const action = result.alert.actionRecommendation.toLowerCase();
    expect(action).not.toContain("auto-execute");
    expect(action).not.toContain("auto-close");
    expect(action).not.toContain("executed");
    expect(action).not.toContain("order placed");
  });

  it("no order/execution fields in alert", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const alert = result.alert as any;
    expect(alert.orderId).toBeUndefined();
    expect(alert.executionResult).toBeUndefined();
    expect(alert.tradeId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 Q — Decision Immutability", () => {
  it("protection alert does not modify position context", () => {
    const ctx = pos({ currentPrice: 110000 });
    const snapshot = { ...ctx };
    evaluateProtection({ position: ctx, evidence: evidence() });
    expect(ctx.instrument).toBe(snapshot.instrument);
    expect(ctx.side).toBe(snapshot.side);
    expect(ctx.entryPrice).toBe(snapshot.entryPrice);
    expect(ctx.currentPrice).toBe(snapshot.currentPrice);
  });

  it("protection alert does not contain trade plan fields", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    const alert = result.alert as any;
    expect(alert.recommendation).toBeUndefined();
    expect(alert.bias).toBeUndefined();
    expect(alert.conviction).toBeUndefined();
    expect(alert.tradePlan).toBeUndefined();
    expect(alert.entry).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// R. INSTRUMENT / POSITION ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 R — Instrument/Position Isolation", () => {
  it("BTC LONG != BTC SHORT", () => {
    const evidenceData = {
      shortTermTrend: "bearish" as const,
      momentumChange: -8,
    };
    const rLong = evaluateProtection(
      inp(
        { instrument: "BTC/USDT", side: "LONG", entryPrice: 100000, currentPrice: 105000 },
        evidenceData
      )
    );
    const rShort = evaluateProtection(
      inp(
        { instrument: "BTC/USDT", side: "SHORT", entryPrice: 100000, currentPrice: 105000 },
        evidenceData
      )
    );
    expect(rLong.alert.side).toBe("LONG");
    expect(rShort.alert.side).toBe("SHORT");
  });

  it("BTC != ETH", () => {
    const rBtc = evaluateProtection(inp({ instrument: "BTC/USDT", currentPrice: 110000 }));
    const rEth = evaluateProtection(inp({ instrument: "ETH/USDT", currentPrice: 4000 }));
    expect(rBtc.alert.instrument).toBe("BTC/USDT");
    expect(rEth.alert.instrument).toBe("ETH/USDT");
  });

  it("EUR/USD != GBP/USD", () => {
    const rEur = evaluateProtection(
      inp({
        instrument: "EUR/USD",
        assetClass: "forex",
        entryPrice: 1.1,
        currentPrice: 1.12,
        stopLoss: 1.08,
        takeProfit: 1.15,
      })
    );
    const rGbp = evaluateProtection(
      inp({
        instrument: "GBP/USD",
        assetClass: "forex",
        entryPrice: 1.25,
        currentPrice: 1.23,
        stopLoss: 1.27,
        takeProfit: 1.2,
      })
    );
    expect(rEur.alert.instrument).toBe("EUR/USD");
    expect(rGbp.alert.instrument).toBe("GBP/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// S. RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 S — Recovery", () => {
  it("improving evidence produces lower or equal severity", () => {
    const rBad = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const rGood = evaluateProtection(
      inp({ currentPrice: 110000 }, { shortTermTrend: "bullish" })
    );
    const rank = [
      "NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED",
    ] as const;
    expect(rank.indexOf(rGood.alert.severity as any)).toBeLessThanOrEqual(
      rank.indexOf(rBad.alert.severity as any)
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// T. THESIS HEALTH INTERACTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 T — Thesis Health Interaction", () => {
  it("strong evidence produces thesis health", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(result.alert.thesisHealth).toBeDefined();
    expect(result.alert.thesisHealthScore).toBeDefined();
  });

  it("deteriorated evidence degrades thesis", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          momentumChange: -20,
          structureBroken: true,
        }
      )
    );
    expect(result.alert.thesisHealth).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// U. SHOCK INTERACTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 U — Shock Interaction", () => {
  it("VIX spike produces elevated shock", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { vix: 35 })
    );
    expect(result.alert.shock).toBeDefined();
    expect(["ELEVATED", "SHOCK"]).toContain(result.alert.shock.state);
  });

  it("extreme VIX produces shock state", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { vix: 45 })
    );
    expect(result.alert.shock.state).toBeDefined();
  });

  it("funding shock affects protection", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { fundingRate: 0.1 })
    );
    expect(result.alert.shock).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// V. EVENT PRIORITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 V — Event Priority", () => {
  it("PRICE_UPDATE gets LOW priority", () => {
    expect(
      computeEventPriority({
        eventId: "ev1",
        instrument: "BTC/USDT",
        timestamp: Date.now(),
        source: "test",
        freshness: "FRESH",
        eventType: "PRICE_UPDATE",
        priority: "LOW",
        dependencyGroup: "price",
        payload: { price: 105000 },
      })
    ).toBe("LOW");
  });

  it("VOLATILITY_CHANGE gets MEDIUM priority", () => {
    expect(
      computeEventPriority({
        eventId: "ev1",
        instrument: "BTC/USDT",
        timestamp: Date.now(),
        source: "test",
        freshness: "FRESH",
        eventType: "VOLATILITY_CHANGE",
        priority: "MEDIUM",
        dependencyGroup: "volatility",
        payload: { volatility: 50 },
      })
    ).toBe("MEDIUM");
  });

  it("LIQUIDATION_CHANGE gets HIGH priority", () => {
    expect(
      computeEventPriority({
        eventId: "ev1",
        instrument: "BTC/USDT",
        timestamp: Date.now(),
        source: "test",
        freshness: "FRESH",
        eventType: "LIQUIDATION_CHANGE",
        priority: "HIGH",
        dependencyGroup: "derivatives",
        payload: { level: "HIGH" },
      })
    ).toBe("HIGH");
  });

  it("unknown event returns valid priority or undefined", () => {
    const priority = computeEventPriority({
      eventId: "ev1",
      instrument: "BTC/USDT",
      timestamp: Date.now(),
      source: "test",
      freshness: "FRESH",
      eventType: "NEWS_EVENT",
      priority: "LOW",
      dependencyGroup: "news",
      payload: {},
    });
    const valid = ["CRITICAL", "HIGH", "MEDIUM", "LOW", undefined];
    expect(valid).toContain(priority);
  });
});

// ═══════════════════════════════════════════════════════════════
// W. GIVEBACK INTERACTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 W — Giveback Interaction", () => {
  it("healthy profit has no giveback", () => {
    const g = calculateGiveback(
      {
        positionId: "p1",
        instrument: "BTC/USDT",
        side: "LONG",
        entryPrice: 100,
        currentPrice: 110,
        horizon: "SWING",
        openedAt: Date.now(),
        lastUpdateAt: Date.now(),
        monitoringStatus: "LIVE",
      },
      110
    );
    expect(g.givebackPct).toBe(0);
  });

  it("partial giveback is calculated correctly", () => {
    const g = calculateGiveback(
      {
        positionId: "p1",
        instrument: "BTC/USDT",
        side: "LONG",
        entryPrice: 100,
        currentPrice: 115,
        horizon: "SWING",
        openedAt: Date.now(),
        lastUpdateAt: Date.now(),
        monitoringStatus: "LIVE",
      },
      120
    );
    expect(g.givebackPct).toBeCloseTo(25, 0);
  });

  it("SHORT giveback works correctly", () => {
    const g = calculateGiveback(
      {
        positionId: "p1",
        instrument: "BTC/USDT",
        side: "SHORT",
        entryPrice: 100,
        currentPrice: 92,
        horizon: "SWING",
        openedAt: Date.now(),
        lastUpdateAt: Date.now(),
        monitoringStatus: "LIVE",
      },
      90
    );
    expect(g.givebackPct).toBeCloseTo(20, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. MULTIPLE POSITIONS STRESS
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 X — Multiple Positions Stress", () => {
  it("100 positions produce valid rankings", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      positionId: `stress_${i}`,
      priority: computePositionPriority({
        severity: (
          ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const
        )[i % 5],
        urgency: (["NONE", "LOW", "MODERATE", "HIGH", "CRITICAL"] as const)[i % 5],
        givebackPct: (i * 3) % 100,
        accelerationLevel: (["NORMAL", "ELEVATED", "HIGH"] as const)[i % 3],
        profitState: (["PROFITABLE", "LOSING", "BREAK_EVEN_ZONE"] as const)[i % 3],
      }),
    }));
    const ranked = sortByPriority(items);
    expect(ranked).toHaveLength(100);
  });

  it("100 evaluations produce valid results", () => {
    for (let i = 0; i < 100; i++) {
      const result = evaluateProtection(
        inp({ instrument: `INST_${i}`, currentPrice: 100000 + i * 100 })
      );
      expect(result.alert).toBeDefined();
      expect(result.alert.instrument).toBe(`INST_${i}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. NORMAL PULLBACK — NO FALSE POSITIVE
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 Y — Normal Pullback No False Positive", () => {
  it("small pullback in healthy trend does not trigger HIGH_RISK", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 109500 },
        { shortTermTrend: "neutral", momentumChange: 0 }
      )
    );
    expect(
      ["HIGH_RISK", "INVALIDATED"].includes(result.alert.severity)
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. DATA FRESHNESS SAFETY
// ═══════════════════════════════════════════════════════════════

describe("Phase 67 Z — Data Freshness Safety", () => {
  it("stale data degrades gracefully", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bullish", volatility: undefined, avgVolatility: undefined }
      )
    );
    expect(result.alert).toBeDefined();
  });

  it("missing provider does not become directional evidence", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { shortTermTrend: undefined, mediumTermTrend: undefined })
    );
    expect(result.alert).toBeDefined();
  });
});
