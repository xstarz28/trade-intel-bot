/**
 * Phase 172 — Entitlement concurrency and idempotency.
 *
 * Convex mutations run with serializable isolation under optimistic
 * concurrency control: conflicting transactions abort and are retried
 * automatically at a fresh timestamp, so a mutation observes the committed
 * result of any transaction it conflicts with.
 *
 * That guarantee only helps if the mutation's own logic is correct when
 * replayed. This suite models both halves:
 *
 *  1. A SERIALIZED harness, which is what Convex actually provides. The
 *     invariant is that N concurrent chargeable requests can never consume
 *     more than the limit.
 *  2. A deliberately BROKEN interleaved harness (read-all-then-write-all),
 *     which is what a non-transactional store would do. It is included to
 *     prove the serialized assertions are meaningful rather than vacuous —
 *     if the test passed under both models it would be testing nothing.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  isProfitSignal,
  nextUsageCount,
  type EntitlementState,
  type Plan,
} from "../lib/entitlement/entitlement";

const SRC = readFileSync("src/convex/entitlements.ts", "utf8");

// ───────────────────────────────────────────────────────────────
// Harness
// ───────────────────────────────────────────────────────────────

interface Row {
  userId: string;
  plan: Plan;
  profitSignalsUsed: number;
  premiumUntil?: number;
}

interface ConsumeOutcome {
  allowed: boolean;
  charged: boolean;
  reason: string;
  remaining: number | null;
}

/**
 * A table that can hold at most one row per user, mirroring the
 * `by_user` unique index used by the real module.
 */
class EntitlementTable {
  private rows = new Map<string, Row>();
  /** Counts insert attempts so duplicate-row creation is observable. */
  inserts = 0;

  get(userId: string): Row | undefined {
    return this.rows.get(userId);
  }

  upsert(row: Row): void {
    if (!this.rows.has(row.userId)) this.inserts += 1;
    this.rows.set(row.userId, { ...row });
  }

  seed(row: Row): void {
    this.rows.set(row.userId, { ...row });
  }

  /** Every row for this user — a unique index must never yield more than 1. */
  countFor(userId: string): number {
    return this.rows.has(userId) ? 1 : 0;
  }
}

/** Mirrors consumeProfitSignal's handler body exactly. */
function consume(
  table: EntitlementTable,
  userId: string,
  recommendation: string | undefined,
  now = Date.now(),
): ConsumeOutcome {
  const row = table.get(userId);

  const storedPlan: Plan = row?.plan === "PREMIUM" ? "PREMIUM" : "GUEST";
  const expired =
    storedPlan === "PREMIUM" &&
    typeof row?.premiumUntil === "number" &&
    row.premiumUntil <= now;
  const plan: Plan = expired ? "GUEST" : storedPlan;

  const state: EntitlementState = {
    plan,
    profitSignalsUsed: row?.profitSignalsUsed ?? 0,
  };

  const chargeable = isProfitSignal(recommendation);
  const decision = evaluateEntitlement(state);

  if (!chargeable) {
    return {
      allowed: true,
      charged: false,
      reason: "NOT_CHARGEABLE",
      remaining: plan === "PREMIUM" ? null : decision.remaining,
    };
  }

  if (!decision.allowed) {
    return {
      allowed: false,
      charged: false,
      reason: decision.reason,
      remaining: 0,
    };
  }

  const updated = nextUsageCount(state, recommendation);
  table.upsert({
    userId,
    plan,
    profitSignalsUsed: updated,
    ...(row?.premiumUntil !== undefined ? { premiumUntil: row.premiumUntil } : {}),
  });

  const after = evaluateEntitlement({ plan, profitSignalsUsed: updated });
  return {
    allowed: true,
    charged: plan !== "PREMIUM",
    reason: "CONSUMED",
    remaining: plan === "PREMIUM" ? null : after.remaining,
  };
}

/** Serializable execution — the model Convex actually guarantees. */
function runSerialized(
  table: EntitlementTable,
  userId: string,
  recommendations: readonly (string | undefined)[],
): ConsumeOutcome[] {
  return recommendations.map((r) => consume(table, userId, r));
}

// ───────────────────────────────────────────────────────────────
// Concurrency
// ───────────────────────────────────────────────────────────────

describe("concurrent chargeable requests cannot over-consume", () => {
  it("two simultaneous requests consume exactly two of the allowance", () => {
    const table = new EntitlementTable();
    const results = runSerialized(table, "u1", ["BUY", "SELL"]);

    expect(results.every((r) => r.allowed)).toBe(true);
    expect(table.get("u1")?.profitSignalsUsed).toBe(2);
  });

  it("ten simultaneous requests never exceed the limit", () => {
    const table = new EntitlementTable();
    const results = runSerialized(table, "u1", Array(10).fill("BUY"));

    const granted = results.filter((r) => r.allowed && r.charged).length;
    expect(granted).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    expect(table.get("u1")?.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);

    // Everyone past the limit is explicitly refused.
    const refused = results.filter((r) => !r.allowed);
    expect(refused).toHaveLength(10 - FREE_PROFIT_SIGNAL_LIMIT);
    expect(refused.every((r) => r.reason === "FREE_ALLOWANCE_EXHAUSTED")).toBe(true);
  });

  it("the counter is monotonic across an interleaved mixed workload", () => {
    const table = new EntitlementTable();
    let previous = 0;
    for (const rec of ["WAIT", "BUY", "NO_TRADE", "SELL", "WAIT", "LONG"]) {
      consume(table, "u1", rec);
      const current = table.get("u1")?.profitSignalsUsed ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
    expect(previous).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("a non-transactional store WOULD over-consume — proving the test bites", () => {
    // Read-all-then-write-all: every request sees used=0 and all are granted.
    // This is the failure mode serializability prevents. If this modelled
    // outcome equalled the serialized one, the assertions above would be
    // vacuous.
    const start: EntitlementState = { plan: "GUEST", profitSignalsUsed: 0 };
    const grantedWithoutIsolation = Array(10)
      .fill("BUY")
      .filter(() => evaluateEntitlement(start).allowed).length;

    expect(grantedWithoutIsolation).toBe(10);
    expect(grantedWithoutIsolation).toBeGreaterThan(FREE_PROFIT_SIGNAL_LIMIT);
  });
});

describe("concurrent creation of a missing entitlement row", () => {
  it("never produces two rows for one user", () => {
    const table = new EntitlementTable();
    // Several first-ever requests arrive together; none has a row yet.
    runSerialized(table, "fresh-user", ["BUY", "BUY", "BUY"]);

    expect(table.countFor("fresh-user")).toBe(1);
    expect(table.inserts).toBe(1);
  });

  it("the first request creates the row and the rest update it", () => {
    const table = new EntitlementTable();
    const results = runSerialized(table, "fresh-user", ["BUY", "BUY"]);

    expect(results.filter((r) => r.charged)).toHaveLength(2);
    expect(table.get("fresh-user")?.profitSignalsUsed).toBe(2);
    expect(table.inserts).toBe(1);
  });

  it("row creation for different users stays isolated", () => {
    const table = new EntitlementTable();
    runSerialized(table, "user-a", ["BUY", "BUY", "BUY"]);
    runSerialized(table, "user-b", ["BUY"]);

    expect(table.get("user-a")?.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    expect(table.get("user-b")?.profitSignalsUsed).toBe(1);
    // Exhausting one user must not affect another.
    expect(consume(table, "user-b", "BUY").allowed).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Non-chargeable results
// ───────────────────────────────────────────────────────────────

describe("WAIT and NO_TRADE never consume allowance", () => {
  it("a hundred concurrent WAIT results cost nothing", () => {
    const table = new EntitlementTable();
    const results = runSerialized(table, "u1", Array(100).fill("WAIT"));

    expect(results.every((r) => r.allowed && !r.charged)).toBe(true);
    expect(table.get("u1")).toBeUndefined();
  });

  for (const rec of ["WAIT", "NO_TRADE", "NO TRADE", "HOLD", "AVOID", "INSUFFICIENT_DATA"]) {
    it(`${rec} is delivered free even to an exhausted guest`, () => {
      const table = new EntitlementTable();
      table.seed({
        userId: "u1",
        plan: "GUEST",
        profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT,
      });

      const out = consume(table, "u1", rec);
      expect(out.allowed).toBe(true);
      expect(out.charged).toBe(false);
      expect(table.get("u1")?.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    });
  }
});

// ───────────────────────────────────────────────────────────────
// Locked state
// ───────────────────────────────────────────────────────────────

describe("exhausted users get an explicit lock, never a synthetic WAIT", () => {
  it("refusal is reported as a lock reason, not as an analysis result", () => {
    const table = new EntitlementTable();
    table.seed({ userId: "u1", plan: "GUEST", profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT });

    const out = consume(table, "u1", "BUY");
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("FREE_ALLOWANCE_EXHAUSTED");
    // A locked BUY must never be downgraded into a WAIT/NO_TRADE, which
    // would misrepresent what the engine actually found.
    expect(out.reason).not.toMatch(/WAIT|NO_TRADE|HOLD/);
  });

  it("the server never rewrites the recommendation it was given", () => {
    // The mutation returns a decision; it does not return a recommendation.
    const returns = SRC.split("export const consumeProfitSignal")[1] ?? "";
    expect(returns).not.toMatch(/recommendation:\s*"(WAIT|NO_TRADE|HOLD)"/);
  });
});

// ───────────────────────────────────────────────────────────────
// Bypass and privilege
// ───────────────────────────────────────────────────────────────

describe("client-supplied values cannot bypass enforcement", () => {
  it("the mutation accepts only the recommendation argument", () => {
    const argsBlock = SRC.split("export const consumeProfitSignal")[1]
      ?.split("handler:")[0] ?? "";
    expect(argsBlock).toContain("recommendation");
    for (const forbidden of ["plan", "profitSignalsUsed", "isPremium", "remaining", "userId", "isOwner", "owner"]) {
      expect(argsBlock, `args expose ${forbidden}`).not.toContain(`${forbidden}:`);
    }
  });

  it("reads the counter from the database, never from arguments", () => {
    expect(SRC).not.toMatch(/args\.(plan|profitSignalsUsed|isPremium|remaining|userId)/);
    expect(SRC).toContain("readEntitlement(ctx");
  });

  it("does not use client storage anywhere", () => {
    expect(SRC).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

describe("expired premium cannot retain access", () => {
  it("degrades to guest limits once the period has passed", () => {
    const now = 1_800_000_000_000;
    const table = new EntitlementTable();
    table.seed({
      userId: "u1",
      plan: "PREMIUM",
      profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT,
      premiumUntil: now - 1,
    });

    const out = consume(table, "u1", "BUY", now);
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("FREE_ALLOWANCE_EXHAUSTED");
  });

  it("expiry is evaluated on read, not only on write", () => {
    // A lapsed subscription must not keep access merely because no mutation
    // happened to run since it expired.
    const now = 1_800_000_000_000;
    const table = new EntitlementTable();
    table.seed({
      userId: "u1",
      plan: "PREMIUM",
      profitSignalsUsed: 0,
      premiumUntil: now - 1,
    });

    // Fresh guest allowance applies, and it is finite.
    for (let i = 0; i < FREE_PROFIT_SIGNAL_LIMIT; i++) {
      expect(consume(table, "u1", "BUY", now).allowed).toBe(true);
    }
    expect(consume(table, "u1", "BUY", now).allowed).toBe(false);
  });

  it("an unexpired premium period is still honoured", () => {
    const now = 1_800_000_000_000;
    const table = new EntitlementTable();
    table.seed({
      userId: "u1",
      plan: "PREMIUM",
      profitSignalsUsed: 0,
      premiumUntil: now + 86_400_000,
    });

    const results = runSerialized(table, "u1", Array(50).fill("BUY"));
    expect(results.every((r) => r.allowed && !r.charged)).toBe(true);
    expect(table.get("u1")?.profitSignalsUsed).toBe(0);
  });

  it("the degraded plan is persisted so it is not re-read as premium", () => {
    const now = 1_800_000_000_000;
    const table = new EntitlementTable();
    table.seed({
      userId: "u1",
      plan: "PREMIUM",
      profitSignalsUsed: 0,
      premiumUntil: now - 1,
    });

    consume(table, "u1", "BUY", now);
    expect(table.get("u1")?.plan).toBe("GUEST");
  });
});

describe("grantPremium is not client-callable", () => {
  const body = SRC.split("export const grantPremium")[1] ?? "";

  it("requires an authenticated caller", () => {
    expect(body).toContain("resolveUser");
    expect(body).toContain("Unauthenticated");
  });

  it("requires an admin role", () => {
    expect(body).toContain('role !== "admin"');
    expect(body).toMatch(/throw new Error\(\s*"Not permitted/);
  });

  it("the role check precedes any database write", () => {
    const roleAt = body.indexOf('role !== "admin"');
    const insertAt = body.indexOf("ctx.db.insert");
    const patchAt = body.indexOf("ctx.db.patch");
    expect(roleAt).toBeGreaterThan(-1);
    for (const writeAt of [insertAt, patchAt]) {
      if (writeAt > -1) expect(roleAt).toBeLessThan(writeAt);
    }
  });

  it("does not take a userId argument, so it cannot target another account", () => {
    const argsBlock = body.split("handler:")[0] ?? "";
    expect(argsBlock).not.toContain("userId");
  });
});

describe("the read-only query cannot consume or create", () => {
  const body = SRC.split("export const getMyEntitlement")[1]?.split("export const")[0] ?? "";

  it("performs no writes", () => {
    expect(body).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)/);
  });

  it("reports guests without inventing an identity", () => {
    expect(body).toContain("UNAUTHENTICATED");
  });

  it("does not serialise Infinity, which is not valid JSON", () => {
    expect(body).toContain("null");
    expect(body).not.toMatch(/remaining:\s*Infinity/);
  });
});
