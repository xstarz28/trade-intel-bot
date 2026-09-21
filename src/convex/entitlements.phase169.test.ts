/**
 * Phase 169 — Entitlement enforcement cannot be bypassed.
 *
 * Simulates the realistic attacks against a free-tier limit using the same
 * pure rules the Convex mutation applies, plus a static audit of the module
 * itself for the mistakes that make a paywall decorative:
 *
 *  - trusting a client-supplied plan or counter,
 *  - storing the counter in localStorage,
 *  - letting a client call the Premium grant directly.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  isProfitSignal,
  nextUsageCount,
  type EntitlementState,
} from "../lib/entitlement/entitlement";

const SRC = readFileSync("src/convex/entitlements.ts", "utf8");

/** Minimal server simulation: one persisted row, many client calls. */
function makeServer(
  initial: Partial<EntitlementState> = {},
  opts: { isOwner?: boolean } = {},
) {
  const stored: EntitlementState = {
    plan: initial.plan === "PREMIUM" ? "PREMIUM" : "GUEST",
    profitSignalsUsed: initial.profitSignalsUsed ?? 0,
  };

  return {
    stored,
    /** Mirrors consumeProfitSignal. `claim` is untrusted client input. */
    consume(
      recommendation: string | undefined,
      claim?: Partial<EntitlementState> & { isOwner?: boolean },
    ) {
      // The server deliberately IGNORES `claim`, including a forged isOwner.
      void claim;

      const plan = opts.isOwner ? "OWNER" : stored.plan;
      const chargeable = isProfitSignal(recommendation);
      const decision = evaluateEntitlement({ plan, profitSignalsUsed: stored.profitSignalsUsed });

      if (!chargeable) return { allowed: true, charged: false, plan };
      if (!decision.allowed) return { allowed: false, charged: false, plan };

      stored.profitSignalsUsed = nextUsageCount(
        { plan, profitSignalsUsed: stored.profitSignalsUsed },
        recommendation,
      );
      return { allowed: true, charged: plan !== "PREMIUM" && plan !== "OWNER", plan };
    },
  };
}

describe("free allowance is genuinely finite", () => {
  it("blocks the (limit + 1)-th actionable signal", () => {
    const s = makeServer();
    for (let i = 0; i < FREE_PROFIT_SIGNAL_LIMIT; i++) {
      expect(s.consume("BUY").allowed, `call ${i + 1}`).toBe(true);
    }
    expect(s.consume("BUY").allowed).toBe(false);
  });

  it("stays blocked across many further attempts", () => {
    const s = makeServer({ profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT });
    for (let i = 0; i < 25; i++) {
      expect(s.consume("SELL").allowed).toBe(false);
    }
  });
});

describe("bypass attempts", () => {
  it("a reload cannot reset the counter (state is server-side)", () => {
    const s = makeServer();
    s.consume("BUY");
    s.consume("BUY");

    // "Reload": the client forgets everything and asks again. The server row
    // is unchanged, so the allowance is still exhausted.
    expect(s.consume("BUY").allowed).toBe(false);
    expect(s.stored.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("a client claiming PREMIUM is ignored", () => {
    const s = makeServer({ profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT });
    const res = s.consume("BUY", { plan: "PREMIUM", profitSignalsUsed: 0 });
    expect(res.allowed).toBe(false);
  });

  it("a client claiming zero usage is ignored", () => {
    const s = makeServer({ profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT });
    expect(s.consume("BUY", { profitSignalsUsed: 0 }).allowed).toBe(false);
  });

  it("concurrent duplicate requests cannot exceed the limit", () => {
    const s = makeServer();
    // Even if many calls arrive, the stored counter is clamped.
    for (let i = 0; i < 10; i++) s.consume("BUY");
    expect(s.stored.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });
});

describe("the paywall does not corrupt the engine", () => {
  it("unlimited WAIT results never exhaust the free tier", () => {
    const s = makeServer();
    for (let i = 0; i < 100; i++) {
      expect(s.consume("WAIT").allowed).toBe(true);
    }
    expect(s.stored.profitSignalsUsed).toBe(0);
  });

  it("NO_TRADE remains free forever", () => {
    const s = makeServer({ profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT });
    // Exhausted guests still get honest non-actionable analysis.
    expect(s.consume("NO_TRADE").allowed).toBe(true);
  });
});

describe("premium", () => {
  it("is never charged or blocked", () => {
    const s = makeServer({ plan: "PREMIUM" });
    for (let i = 0; i < 50; i++) {
      const r = s.consume("BUY");
      expect(r.allowed).toBe(true);
      expect(r.charged).toBe(false);
    }
    expect(s.stored.profitSignalsUsed).toBe(0);
  });
});

describe("owner overlay", () => {
  it("does not decrement the free counter", () => {
    const s = makeServer({ profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT }, { isOwner: true });
    for (let i = 0; i < 10; i++) {
      const r = s.consume("BUY");
      expect(r.allowed).toBe(true);
      expect(r.charged).toBe(false);
      expect(r.plan).toBe("OWNER");
    }
    expect(s.stored.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    expect(s.stored.plan).toBe("GUEST");
  });

  it("a client claiming isOwner is ignored", () => {
    const s = makeServer({ profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT });
    const res = s.consume("BUY", { isOwner: true, plan: "OWNER", profitSignalsUsed: 0 });
    expect(res.allowed).toBe(false);
    expect(s.stored.profitSignalsUsed).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });
});

describe("server module audit", () => {
  it("never reads a plan or counter from the client arguments", () => {
    // The only accepted argument is the recommendation string.
    expect(SRC).not.toMatch(/args\.(plan|profitSignalsUsed|isPremium|remaining)/);
  });

  it("never uses client-side storage for the counter", () => {
    expect(SRC).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it("resolves the user before every entitlement decision", () => {
    for (const fn of ["consumeProfitSignal", "grantPremium"]) {
      const body = SRC.split(`export const ${fn}`)[1] ?? "";
      expect(body, `${fn} is unguarded`).toContain("resolveUser");
    }
  });

  it("does not let an ordinary client grant themselves Premium", () => {
    const body = SRC.split("export const grantPremium")[1] ?? "";
    expect(body).toContain('role !== "admin"');
  });

  it("degrades an expired premium period rather than trusting the stored plan", () => {
    expect(SRC).toContain("premiumUntil");
    expect(SRC).toMatch(/expired/);
  });

  it("the read-only query never mutates usage", () => {
    const body = SRC.split("export const getMyEntitlement")[1]?.split("export const")[0] ?? "";
    expect(body).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)/);
  });
});
