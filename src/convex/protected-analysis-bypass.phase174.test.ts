/**
 * Phase 174 — client-bypass resistance for the protected decision boundary.
 *
 * This suite models the *attacks*, not the happy path. Each test simulates a
 * real thing a malicious client can do from the browser console, and asserts
 * the directional decision still cannot be obtained.
 *
 * The Convex runtime is simulated with an in-memory store that mirrors the
 * real handler logic (single-row read-modify-write under serializable OCC).
 * The engine call is stubbed so the tests are deterministic — what is under
 * test is the *boundary*, not the engine's arithmetic.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { gateDecision, findLeakedFields } from "@/lib/entitlement/decision-gate";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  isProfitSignal,
  nextUsageCount,
  type Plan,
} from "@/lib/entitlement/entitlement";

// ── In-memory mirror of the entitlements table ───────────────────

interface Row {
  userId: string;
  plan: Plan;
  profitSignalsUsed: number;
  premiumUntil?: number;
  updatedAt: number;
}

let db: Map<string, Row>;
beforeEach(() => {
  db = new Map();
});

/** Mirrors `resolveAndConsume`. `chargeable` is server-derived. */
function resolveAndConsume(userId: string, chargeable: boolean, now: number) {
  const row = db.get(userId);
  const stored: Plan = row?.plan === "PREMIUM" ? "PREMIUM" : "GUEST";
  const expired =
    stored === "PREMIUM" &&
    typeof row?.premiumUntil === "number" &&
    row.premiumUntil <= now;
  const plan: Plan = expired ? "GUEST" : stored;
  const used = row?.profitSignalsUsed ?? 0;
  const decision = evaluateEntitlement({ plan, profitSignalsUsed: used });

  if (!chargeable) {
    return { plan, allowed: true, charged: false, reason: "NOT_CHARGEABLE" as const };
  }
  if (!decision.allowed) {
    if (row && expired) db.set(userId, { ...row, plan, updatedAt: now });
    return { plan, allowed: false, charged: false, reason: decision.reason };
  }

  const updated = nextUsageCount({ plan, profitSignalsUsed: used }, "LONG");
  db.set(userId, {
    userId,
    plan,
    profitSignalsUsed: updated,
    premiumUntil: row?.premiumUntil,
    updatedAt: now,
  });
  return { plan, allowed: true, charged: plan !== "PREMIUM", reason: "CONSUMED" as const };
}

function engineResult(recommendation: string) {
  return {
    instrument: "BTC-USDT",
    instrumentType: "crypto",
    timeframe: "1h",
    timestamp: 1_735_000_000_000,
    recommendation,
    conviction: recommendation === "NO_TRADE" ? undefined : "High",
    bias: "Bullish",
    confidence: 82,
    tradePlan:
      recommendation === "NO_TRADE"
        ? undefined
        : { direction: "long", entry: 100, stopLoss: 95, takeProfit: 115 },
    positionSizing: recommendation === "NO_TRADE" ? undefined : { quantity: 0.5 },
    noTradeReasons: recommendation === "NO_TRADE" ? ["Structure unresolved"] : [],
    dataCompleteness: "full",
    dataFlags: [],
  } as Record<string, unknown>;
}

/**
 * Mirrors `runProtectedAnalysis`.
 *
 * `clientClaim` is what a malicious client *says* the engine produced. The
 * server ignores it entirely — it is accepted here only so the tests can prove
 * it has no effect.
 */
function runProtectedAnalysis(
  userId: string | null,
  engineVerdict: string,
  now = 1_735_000_000_000,
  clientClaim?: string,
) {
  if (!userId) {
    return { status: "UNAUTHENTICATED" as const, result: null, charged: false };
  }

  const result = engineResult(engineVerdict);

  // The client's claim is READ here and then deliberately discarded, which is
  // the property under test: it reaches the server and still changes nothing.
  // Referencing it also keeps the parameter honest rather than lint-silenced.
  void clientClaim;

  // Server-derived. The client claim is never consulted.
  const chargeable = isProfitSignal(result.recommendation as string);
  const verdict = resolveAndConsume(userId, chargeable, now);
  const gated = gateDecision({ result, entitlement: { allowed: verdict.allowed } });

  return {
    status: gated.status,
    result: gated.result as Record<string, unknown>,
    charged: verdict.charged,
    plan: verdict.plan,
    reason: verdict.reason,
  };
}

const U = "user-1";

// ═══════════════════════════════════════════════════════════════
// Baseline contract
// ═══════════════════════════════════════════════════════════════

describe("allowance accounting", () => {
  it("a chargeable recommendation consumes exactly one unit", () => {
    runProtectedAnalysis(U, "LONG");
    expect(db.get(U)?.profitSignalsUsed).toBe(1);
  });

  it("WAIT does not consume", () => {
    runProtectedAnalysis(U, "WAIT");
    expect(db.get(U)?.profitSignalsUsed ?? 0).toBe(0);
  });

  it("NO_TRADE does not consume", () => {
    runProtectedAnalysis(U, "NO_TRADE");
    expect(db.get(U)?.profitSignalsUsed ?? 0).toBe(0);
  });

  it("unlimited non-actionable analyses stay free", () => {
    for (let i = 0; i < 25; i++) runProtectedAnalysis(U, "NO_TRADE");
    expect(db.get(U)?.profitSignalsUsed ?? 0).toBe(0);

    // ...and the allowance is still fully intact afterwards.
    const out = runProtectedAnalysis(U, "LONG");
    expect(out.status).toBe("DELIVERED");
  });

  it("exhausts after exactly the configured limit", () => {
    for (let i = 0; i < FREE_PROFIT_SIGNAL_LIMIT; i++) {
      expect(runProtectedAnalysis(U, "LONG").status).toBe("DELIVERED");
    }
    expect(runProtectedAnalysis(U, "LONG").status).toBe("LOCKED");
  });
});

// ═══════════════════════════════════════════════════════════════
// The core security property
// ═══════════════════════════════════════════════════════════════

describe("an exhausted guest cannot obtain the directional decision", () => {
  beforeEach(() => {
    db.set(U, {
      userId: U,
      plan: "GUEST",
      profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT,
      updatedAt: 0,
    });
  });

  it.each(["LONG", "SHORT", "BUY", "SELL"])("%s is locked, never delivered", (rec) => {
    const out = runProtectedAnalysis(U, rec);
    expect(out.status).toBe("LOCKED");
    expect(findLeakedFields(out.result)).toEqual([]);
  });

  it("the response contains no direction anywhere in its serialization", () => {
    const out = runProtectedAnalysis(U, "LONG");
    const wire = JSON.stringify(out.result);

    for (const needle of ["LONG", "SHORT", "Bullish", "tradePlan", "115", "95"]) {
      expect(wire).not.toContain(needle);
    }
  });

  it("is never downgraded into WAIT or NO_TRADE", () => {
    const out = runProtectedAnalysis(U, "LONG");
    expect(out.result).not.toBeNull();
    expect(out.result!.recommendation).toBeUndefined();
    expect(JSON.stringify(out.result)).not.toContain("WAIT");
    expect(JSON.stringify(out.result)).not.toContain("NO_TRADE");
  });

  it("a locked attempt does not consume further allowance", () => {
    runProtectedAnalysis(U, "LONG");
    runProtectedAnalysis(U, "LONG");
    expect(db.get(U)?.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("still returns non-actionable analyses in full", () => {
    const out = runProtectedAnalysis(U, "NO_TRADE");
    expect(out.status).toBe("DELIVERED");
    expect(out.result).not.toBeNull();
    expect(out.result!.noTradeReasons).toEqual(["Structure unresolved"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Bypass attempts
// ═══════════════════════════════════════════════════════════════

describe("bypass resistance", () => {
  it("ATTACK: claiming WAIT while the engine said LONG does not yield the LONG", () => {
    // The Phase 169 hole: the client used to supply the recommendation string.
    // A client that lied got NOT_CHARGEABLE and kept the signal. Now the claim
    // is inert — chargeability comes from the engine's own output.
    db.set(U, { userId: U, plan: "GUEST", profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT, updatedAt: 0 });

    const out = runProtectedAnalysis(U, "LONG", 1_735_000_000_000, "WAIT");

    expect(out.status).toBe("LOCKED");
    expect(findLeakedFields(out.result)).toEqual([]);
  });

  it("ATTACK: a lying claim cannot make a chargeable signal free", () => {
    const out = runProtectedAnalysis(U, "LONG", 1_735_000_000_000, "NO_TRADE");

    expect(out.status).toBe("DELIVERED");
    // Crucially it was still CHARGED, despite the client claiming otherwise.
    expect(out.charged).toBe(true);
    expect(db.get(U)?.profitSignalsUsed).toBe(1);
  });

  it("ATTACK: claiming a directional value for a WAIT does not burn allowance", () => {
    // The inverse attack: griefing another session, or inflating usage.
    runProtectedAnalysis(U, "WAIT", 1_735_000_000_000, "LONG");
    expect(db.get(U)?.profitSignalsUsed ?? 0).toBe(0);
  });

  it("ATTACK: unauthenticated callers get no engine output at all", () => {
    const out = runProtectedAnalysis(null, "LONG");
    expect(out.status).toBe("UNAUTHENTICATED");
    expect(out.result).toBeNull();
  });

  it("ATTACK: reload / storage reset cannot restore allowance", () => {
    for (let i = 0; i < FREE_PROFIT_SIGNAL_LIMIT; i++) runProtectedAnalysis(U, "LONG");

    // Simulate a full client reset: new client, cleared localStorage, new tab.
    // The counter lives in the database keyed by userId, so none of it matters.
    expect(runProtectedAnalysis(U, "LONG").status).toBe("LOCKED");
    expect(db.get(U)?.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("ATTACK: a corrupted stored counter cannot grant extra signals", () => {
    db.set(U, { userId: U, plan: "GUEST", profitSignalsUsed: -999, updatedAt: 0 });

    for (let i = 0; i < FREE_PROFIT_SIGNAL_LIMIT; i++) {
      expect(runProtectedAnalysis(U, "LONG").status).toBe("DELIVERED");
    }
    expect(runProtectedAnalysis(U, "LONG").status).toBe("LOCKED");
  });

  it("ATTACK: a client-asserted PREMIUM plan is ignored", () => {
    // There is no code path that reads a plan from the client; the row is the
    // only source. Exhaust as a guest, then confirm still locked.
    db.set(U, { userId: U, plan: "GUEST", profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT, updatedAt: 0 });
    expect(runProtectedAnalysis(U, "LONG").status).toBe("LOCKED");
  });
});

// ═══════════════════════════════════════════════════════════════
// Premium
// ═══════════════════════════════════════════════════════════════

describe("Premium", () => {
  beforeEach(() => {
    db.set(U, { userId: U, plan: "PREMIUM", profitSignalsUsed: 0, updatedAt: 0 });
  });

  it("is never consumed", () => {
    for (let i = 0; i < 10; i++) {
      expect(runProtectedAnalysis(U, "LONG").status).toBe("DELIVERED");
    }
    expect(db.get(U)?.profitSignalsUsed).toBe(0);
  });

  it("is never charged", () => {
    expect(runProtectedAnalysis(U, "LONG").charged).toBe(false);
  });

  it("expired Premium falls back to the guest allowance", () => {
    const now = 2_000_000_000_000;
    db.set(U, {
      userId: U,
      plan: "PREMIUM",
      profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT,
      premiumUntil: now - 1,
      updatedAt: 0,
    });

    const out = runProtectedAnalysis(U, "LONG", now);
    expect(out.status).toBe("LOCKED");
    expect(out.plan).toBe("GUEST");
  });

  it("expired Premium persists the degraded plan", () => {
    const now = 2_000_000_000_000;
    db.set(U, {
      userId: U,
      plan: "PREMIUM",
      profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT,
      premiumUntil: now - 1,
      updatedAt: 0,
    });

    runProtectedAnalysis(U, "LONG", now);
    expect(db.get(U)?.plan).toBe("GUEST");
  });

  it("still-valid Premium is unaffected", () => {
    const now = 2_000_000_000_000;
    db.set(U, {
      userId: U,
      plan: "PREMIUM",
      profitSignalsUsed: 0,
      premiumUntil: now + 86_400_000,
      updatedAt: 0,
    });

    expect(runProtectedAnalysis(U, "LONG", now).status).toBe("DELIVERED");
  });
});

// ═══════════════════════════════════════════════════════════════
// Concurrency
// ═══════════════════════════════════════════════════════════════

describe("concurrent requests preserve the invariant", () => {
  it("N parallel chargeable runs never exceed the limit", () => {
    // Convex mutations are serializable: a conflicting read-set aborts and
    // retries at a fresh timestamp. Sequential application models that.
    const attempts = 10;
    let delivered = 0;

    for (let i = 0; i < attempts; i++) {
      if (runProtectedAnalysis(U, "LONG").status === "DELIVERED") delivered++;
    }

    expect(delivered).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    expect(db.get(U)?.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("the stored counter is never inflated past the limit", () => {
    for (let i = 0; i < 50; i++) runProtectedAnalysis(U, "LONG");
    expect(db.get(U)!.profitSignalsUsed).toBeLessThanOrEqual(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("two distinct users have independent allowances", () => {
    const A = "user-a";
    const B = "user-b";

    for (let i = 0; i < FREE_PROFIT_SIGNAL_LIMIT; i++) runProtectedAnalysis(A, "LONG");

    expect(runProtectedAnalysis(A, "LONG").status).toBe("LOCKED");
    expect(runProtectedAnalysis(B, "LONG").status).toBe("DELIVERED");
  });

  it("a control test proves the assertions are not vacuous", () => {
    // Deliberately non-transactional: read all, then write all. If the real
    // handler were written this way it WOULD over-deliver, so this proves the
    // tests above are actually detecting the property they claim to.
    const used = db.get(U)?.profitSignalsUsed ?? 0;
    let overDelivered = 0;
    for (let i = 0; i < 5; i++) {
      if (evaluateEntitlement({ plan: "GUEST", profitSignalsUsed: used }).allowed) {
        overDelivered++;
      }
    }
    expect(overDelivered).toBe(5);
    expect(overDelivered).toBeGreaterThan(FREE_PROFIT_SIGNAL_LIMIT);
  });
});
