/**
 * Phase 169 — Entitlement rules.
 *
 * The commercial model must not be able to corrupt the analysis engine, and
 * the free allowance must not be bypassable. These tests pin both.
 */

import { describe, expect, it } from "vitest";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  isProfitSignal,
  lockSignal,
  nextUsageCount,
  type EntitlementState,
} from "./entitlement";

const guest = (used: number): EntitlementState => ({
  plan: "GUEST",
  profitSignalsUsed: used,
});
const premium = (used = 0): EntitlementState => ({
  plan: "PREMIUM",
  profitSignalsUsed: used,
});

describe("what counts as a profit signal", () => {
  it("charges only actionable directions", () => {
    for (const r of ["BUY", "SELL", "LONG", "SHORT", "buy", " long "]) {
      expect(isProfitSignal(r), r).toBe(true);
    }
  });

  it("never charges WAIT or NO_TRADE", () => {
    // If these were chargeable, the pricing model would create pressure to
    // manufacture recommendations — which the integrity rules forbid.
    for (const r of ["WAIT", "NO_TRADE", "NO TRADE", "HOLD", "AVOID"]) {
      expect(isProfitSignal(r), r).toBe(false);
    }
  });

  it("never charges for missing or insufficient results", () => {
    for (const r of [undefined, null, "", "   ", "INSUFFICIENT_DATA", "UNAVAILABLE"]) {
      expect(isProfitSignal(r as string), String(r)).toBe(false);
    }
  });

  it("does not charge for an unrecognised future value", () => {
    // Absence of evidence that it is actionable is not evidence that it is.
    expect(isProfitSignal("SOME_NEW_STATE")).toBe(false);
  });
});

describe("guest allowance", () => {
  it("allows exactly the configured number of free signals", () => {
    for (let used = 0; used < FREE_PROFIT_SIGNAL_LIMIT; used++) {
      expect(evaluateEntitlement(guest(used)).allowed, `used=${used}`).toBe(true);
    }
    expect(evaluateEntitlement(guest(FREE_PROFIT_SIGNAL_LIMIT)).allowed).toBe(false);
  });

  it("reports the remaining count accurately", () => {
    expect(evaluateEntitlement(guest(0)).remaining).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    expect(evaluateEntitlement(guest(1)).remaining).toBe(FREE_PROFIT_SIGNAL_LIMIT - 1);
    expect(evaluateEntitlement(guest(FREE_PROFIT_SIGNAL_LIMIT)).remaining).toBe(0);
  });

  it("requires upgrade once exhausted", () => {
    const d = evaluateEntitlement(guest(FREE_PROFIT_SIGNAL_LIMIT));
    expect(d.upgradeRequired).toBe(true);
    expect(d.reason).toBe("FREE_ALLOWANCE_EXHAUSTED");
  });

  it("stays exhausted no matter how large the stored count grows", () => {
    expect(evaluateEntitlement(guest(999)).allowed).toBe(false);
    expect(evaluateEntitlement(guest(999)).remaining).toBe(0);
  });
});

describe("guest cannot become permanent free access", () => {
  it("a corrupt negative counter is treated as zero used, not as unlimited", () => {
    const d = evaluateEntitlement(guest(-5));
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("a non-numeric counter does not grant unlimited access", () => {
    const d = evaluateEntitlement({
      plan: "GUEST",
      profitSignalsUsed: Number.NaN,
    });
    // Falls back to zero-used, still bounded by the limit.
    expect(d.remaining).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    expect(d.reason).toBe("WITHIN_FREE_ALLOWANCE");
  });

  it("consuming the allowance is monotonic and cannot be decremented", () => {
    let used = 0;
    for (let i = 0; i < 10; i++) {
      const before = used;
      used = nextUsageCount(guest(used), "BUY");
      expect(used).toBeGreaterThanOrEqual(before);
    }
    expect(used).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("repeated WAIT results never exhaust the allowance", () => {
    let used = 0;
    for (let i = 0; i < 50; i++) used = nextUsageCount(guest(used), "WAIT");
    expect(used).toBe(0);
    expect(evaluateEntitlement(guest(used)).allowed).toBe(true);
  });
});

describe("premium", () => {
  it("is never blocked", () => {
    expect(evaluateEntitlement(premium(0)).allowed).toBe(true);
    expect(evaluateEntitlement(premium(10_000)).allowed).toBe(true);
    expect(evaluateEntitlement(premium()).upgradeRequired).toBe(false);
  });

  it("does not accumulate usage", () => {
    expect(nextUsageCount(premium(0), "BUY")).toBe(0);
    expect(nextUsageCount(premium(7), "SELL")).toBe(7);
  });
});

describe("owner overlay", () => {
  const owner = (used = 0): EntitlementState => ({
    plan: "OWNER",
    profitSignalsUsed: used,
  });

  it("is never blocked and never consumes", () => {
    expect(evaluateEntitlement(owner(0)).allowed).toBe(true);
    expect(evaluateEntitlement(owner(FREE_PROFIT_SIGNAL_LIMIT)).allowed).toBe(true);
    expect(evaluateEntitlement(owner(10_000)).upgradeRequired).toBe(false);
    expect(evaluateEntitlement(owner()).reason).toBe("OWNER");
    expect(nextUsageCount(owner(0), "BUY")).toBe(0);
    expect(nextUsageCount(owner(FREE_PROFIT_SIGNAL_LIMIT), "LONG")).toBe(
      FREE_PROFIT_SIGNAL_LIMIT,
    );
  });
});

describe("locked signal representation", () => {
  it("is explicitly locked rather than disguised as a WAIT", () => {
    const locked = lockSignal();
    // Presenting a locked BUY as a WAIT would corrupt the decision record.
    expect(locked.locked).toBe(true);
    expect(locked.reason).toBe("FREE_ALLOWANCE_EXHAUSTED");
    expect(JSON.stringify(locked)).not.toMatch(/WAIT|NO_TRADE|BUY|SELL/);
  });
});
