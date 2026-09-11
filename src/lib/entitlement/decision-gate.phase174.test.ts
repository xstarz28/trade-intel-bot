/**
 * Phase 174 — decision-delivery boundary.
 *
 * These tests target the property that actually matters: an unentitled caller
 * must not be able to obtain the directional decision. Not "must not see it" —
 * must not *receive* it.
 */

import { describe, expect, it } from "vitest";
import {
  gateDecision,
  findLeakedFields,
  PROTECTED_DECISION_FIELDS,
} from "./decision-gate";
import { isProfitSignal, FREE_PROFIT_SIGNAL_LIMIT } from "./entitlement";

/** A realistic actionable engine result, including every protected field. */
function actionableResult(recommendation = "LONG") {
  return {
    id: "analysis-1",
    instrument: "BTC-USDT",
    instrumentType: "crypto",
    timeframe: "1h",
    timestamp: 1_735_000_000_000,
    recommendation,
    conviction: "High",
    bias: "Bullish",
    confidence: 82,
    noTradeReasons: [],
    tradePlan: {
      direction: "long",
      entry: 100,
      stopLoss: 95,
      takeProfit: 115,
      riskReward: 3,
    },
    positionSizing: { quantity: 0.5, riskAmount: 250 },
    keyLevels: { support: [95], resistance: [115] },
    technicalSummary: "Structure is bullish above 95.",
    fundamentalSummary: "Flows supportive.",
    riskNote: "Invalidation below 95.",
    decisionFingerprint: "abc123",
    decisionTrace: { gates: [] },
    analystThesis: { headline: "Long continuation" },
    dataCompleteness: "full",
    dataFlags: [],
  } as Record<string, unknown>;
}

function nonActionableResult(recommendation = "NO_TRADE") {
  return {
    ...actionableResult(recommendation),
    recommendation,
    conviction: undefined,
    tradePlan: undefined,
    positionSizing: undefined,
    noTradeReasons: ["Structure unresolved", "Conflicting MTF"],
  } as Record<string, unknown>;
}

describe("chargeability is derived from the engine output", () => {
  it.each(["LONG", "SHORT", "BUY", "SELL"])("%s is chargeable", (rec) => {
    expect(isProfitSignal(rec)).toBe(true);
  });

  it.each(["WAIT", "NO_TRADE", "NO TRADE", "HOLD", "AVOID", "INSUFFICIENT_DATA"])(
    "%s is never chargeable",
    (rec) => {
      expect(isProfitSignal(rec)).toBe(false);
    },
  );

  it("an unknown future value is not charged", () => {
    expect(isProfitSignal("SOMETHING_NEW")).toBe(false);
  });
});

describe("entitled callers receive the full decision", () => {
  it("delivers an actionable result intact when allowed", () => {
    const result = actionableResult("LONG");
    const out = gateDecision({ result, entitlement: { allowed: true } });

    expect(out.status).toBe("DELIVERED");
    expect(out.chargeable).toBe(true);
    if (out.status !== "DELIVERED") throw new Error("expected delivery");
    expect(out.result.recommendation).toBe("LONG");
    expect(out.result.tradePlan).toBeDefined();
  });

  it("delivers a Premium-style unlimited caller the same payload", () => {
    const result = actionableResult("SHORT");
    const out = gateDecision({ result, entitlement: { allowed: true } });

    expect(out.status).toBe("DELIVERED");
    if (out.status !== "DELIVERED") throw new Error("expected delivery");
    expect(out.result.recommendation).toBe("SHORT");
  });
});

describe("non-actionable decisions are always free and always complete", () => {
  it.each(["WAIT", "NO_TRADE"])("%s is delivered even when NOT allowed", (rec) => {
    const result = nonActionableResult(rec);
    const out = gateDecision({ result, entitlement: { allowed: false } });

    expect(out.status).toBe("DELIVERED");
    expect(out.chargeable).toBe(false);
    if (out.status !== "DELIVERED") throw new Error("expected delivery");
    expect(out.result.recommendation).toBe(rec);
  });

  it("preserves the refusal reasoning for an exhausted guest", () => {
    const out = gateDecision({
      result: nonActionableResult("NO_TRADE"),
      entitlement: { allowed: false },
    });

    if (out.status !== "DELIVERED") throw new Error("expected delivery");
    expect(out.result.noTradeReasons).toEqual([
      "Structure unresolved",
      "Conflicting MTF",
    ]);
  });
});

describe("exhausted guest: the directional decision is withheld, not disguised", () => {
  const denied = { allowed: false };

  it("returns LOCKED for an actionable result", () => {
    const out = gateDecision({ result: actionableResult("LONG"), entitlement: denied });
    expect(out.status).toBe("LOCKED");
  });

  it("NEVER substitutes WAIT or NO_TRADE for the real direction", () => {
    const out = gateDecision({ result: actionableResult("LONG"), entitlement: denied });
    const payload = out.result as Record<string, unknown>;

    // The critical integrity rule: a locked BUY must not become a WAIT.
    expect(payload.recommendation).toBeUndefined();
    expect(Object.values(payload)).not.toContain("WAIT");
    expect(Object.values(payload)).not.toContain("NO_TRADE");
  });

  it("states that a signal existed without revealing its direction", () => {
    const out = gateDecision({ result: actionableResult("SHORT"), entitlement: denied });
    const payload = out.result as Record<string, unknown>;

    expect(payload.locked).toBe(true);
    expect(payload.hadActionableSignal).toBe(true);
    expect(payload.upgradeRequired).toBe(true);
    expect(payload.reason).toBe("FREE_ALLOWANCE_EXHAUSTED");
  });

  it.each(["LONG", "SHORT", "BUY", "SELL"])(
    "leaks no protected field for %s",
    (rec) => {
      const out = gateDecision({ result: actionableResult(rec), entitlement: denied });
      expect(findLeakedFields(out.result)).toEqual([]);
    },
  );

  it("the locked payload cannot be inverted back into a direction", () => {
    const out = gateDecision({ result: actionableResult("LONG"), entitlement: denied });
    const serialized = JSON.stringify(out.result);

    // Nothing in the wire payload should name the direction or the levels.
    for (const needle of ["LONG", "SHORT", "long", "Bullish", "High", "115", "95"]) {
      expect(serialized).not.toContain(needle);
    }
  });

  it("still discloses data quality, so nothing looks healthier than it is", () => {
    const out = gateDecision({ result: actionableResult("LONG"), entitlement: denied });
    const payload = out.result as Record<string, unknown>;

    expect(payload.dataCompleteness).toBe("full");
    expect(payload.instrument).toBe("BTC-USDT");
  });
});

describe("redaction is build-up, not strip-down", () => {
  it("withholds an unknown protected-looking field added upstream", () => {
    // A field the redactor has never heard of must NOT survive by default.
    const result = {
      ...actionableResult("LONG"),
      someFutureDirectionalField: "LONG_WITH_LEVERAGE",
    };

    const out = gateDecision({ result, entitlement: { allowed: false } });
    expect((out.result as Record<string, unknown>).someFutureDirectionalField).toBeUndefined();
  });

  it("every declared protected field is actually absent when locked", () => {
    const out = gateDecision({ result: actionableResult("LONG"), entitlement: { allowed: false } });
    const payload = out.result as Record<string, unknown>;

    for (const field of PROTECTED_DECISION_FIELDS) {
      expect(payload[field]).toBeUndefined();
    }
  });

  it("findLeakedFields detects a leak if redaction ever regresses", () => {
    // Guard the guard: prove the detector is not vacuous.
    const leaky = { recommendation: "LONG", tradePlan: { entry: 1 } };
    expect(findLeakedFields(leaky).sort()).toEqual(["recommendation", "tradePlan"]);
  });
});

describe("the free allowance constant is the single source of truth", () => {
  it("is a small positive integer", () => {
    expect(Number.isInteger(FREE_PROFIT_SIGNAL_LIMIT)).toBe(true);
    expect(FREE_PROFIT_SIGNAL_LIMIT).toBeGreaterThan(0);
  });
});
