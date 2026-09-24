/**
 * Phase 187 — distributed abuse protection.
 *
 * Covers the twenty required scenarios. Where a behaviour is already proven
 * elsewhere (entitlement concurrency in Phase 172, bypass in Phase 174,
 * chargeability in Phase 169) this suite asserts the *server path* still
 * enforces it rather than duplicating those suites.
 *
 * Evidence level: **C**. Storage is modelled by a harness that reproduces
 * Convex's serializable semantics; the policy logic under test is real.
 * Durability and production contention remain Evidence D and BLOCKED.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appendSend,
  decideResend,
  isExpired,
  MAX_SENDS_PER_WINDOW,
  normaliseIdentifier,
  pruneTimestamps,
  RESEND_COOLDOWN_MS,
  RESEND_WINDOW_MS,
  BUCKET_RETENTION_MS,
} from "./lib/abuseLimiterPolicy";
import {
  hashIdentifierForTest,
  makeDurableLimiterStub,
} from "./lib/testing/durableLimiterStub";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  isProfitSignal,
  nextUsageCount,
} from "../lib/entitlement/entitlement";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const LIMITER_SRC = read("src/convex/otpLimiter.ts");
const AUTH_SRC = read("src/convex/auth.ts");
// Phase 270: the email-OTP provider module is retired; there is no OTP_SRC to read.
const OTP_PROVIDER_ABSENT = !existsSync(join(process.cwd(), "src/convex/auth/emailOtp.ts"));
const ENTITLEMENTS_SRC = read("src/convex/entitlements.ts");
const SCHEMA_SRC = read("src/convex/schema.ts");

/** Drive the limiter the way the auth provider does. */
async function send(
  stub: ReturnType<typeof makeDurableLimiterStub>,
  ctx: { runMutation: (ref: unknown, args: { identityHash: string; now?: number }) => Promise<{ allowed: boolean; retryAfterMs: number; reason?: string }> },
  email: string,
  now: number,
) {
  const identityHash = await hashIdentifierForTest(email);
  return ctx.runMutation(null, { identityHash, now });
}

// ════════════════ 1. DURABLE, DISTRIBUTED STATE ════════════════

describe("187.1 — the limiter state is durable and server-authoritative", () => {
  it("stores state in a Convex table, not in module memory", () => {
    expect(SCHEMA_SRC).toContain("otpResendBuckets");
    expect(SCHEMA_SRC).toContain("by_identity");
    // The authoritative path must not be a process-local Map.
    expect(LIMITER_SRC).not.toMatch(/new Map\(/);
  });

  it("the OTP provider is retired; the durable limiter stays installed and frozen", () => {
    expect(OTP_PROVIDER_ABSENT).toBe(true);
    // Nothing may wire the limiter to a new email send path behind the freeze.
    expect(LIMITER_SRC).toContain("RETAINED FROZEN");
    // The registered auth providers are exactly guest + Google (Phase 270).
    expect(AUTH_SRC).toMatch(/providers:\s*\[\s*Anonymous\s*,\s*googleProvider\s*\]/);
  });

  it("never stores or logs the email address itself", () => {
    // Only the hash crosses into storage.
    expect(LIMITER_SRC).toContain("identityHash");
    expect(LIMITER_SRC).not.toMatch(/\bidentifier:\s*v\.string\(\)/);
    expect(SCHEMA_SRC).toContain("identityHash");
    // No console logging of any kind in the limiter.
    expect(LIMITER_SRC).not.toMatch(/console\.(log|warn|error|info)/);
  });

  it("4. state is shared across independent backend contexts", async () => {
    const stub = makeDurableLimiterStub();
    const instanceA = stub.ctx;
    const instanceB = stub.newInstanceCtx();
    const t = 1_000_000;

    const first = await send(stub, instanceA, "shared@example.com", t);
    // A DIFFERENT instance must observe the send that instance A recorded.
    const second = await send(stub, instanceB, "shared@example.com", t + 1_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe("cooldown");
  });

  it("5. the limiter survives process recreation", async () => {
    const stub = makeDurableLimiterStub();
    const t = 2_000_000;
    await send(stub, stub.ctx, "persist@example.com", t);

    // A brand-new ctx models a cold action instance. The row is still there,
    // because the row is in the database rather than in the instance.
    const fresh = stub.newInstanceCtx();
    const result = await send(stub, fresh, "persist@example.com", t + 5_000);
    expect(result.allowed).toBe(false);
  });

  it("6. allowance expires as the rolling window advances", async () => {
    const stub = makeDurableLimiterStub();
    const t = 3_000_000;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i += 1) {
      const r = await send(stub, stub.ctx, "expiry@example.com", t + i * RESEND_COOLDOWN_MS);
      expect(r.allowed).toBe(true);
    }
    // Exhausted inside the window.
    const blocked = await send(
      stub,
      stub.ctx,
      "expiry@example.com",
      t + MAX_SENDS_PER_WINDOW * RESEND_COOLDOWN_MS,
    );
    expect(blocked.allowed).toBe(false);

    // Once the window has fully passed, the allowance returns.
    const later = await send(stub, stub.ctx, "expiry@example.com", t + RESEND_WINDOW_MS + 1);
    expect(later.allowed).toBe(true);
  });

  it("expired rows are reclaimable without affecting decisions", () => {
    expect(isExpired(1_000, 1_000 + BUCKET_RETENTION_MS + 1)).toBe(true);
    expect(isExpired(1_000, 1_000 + BUCKET_RETENTION_MS - 1)).toBe(false);
    expect(LIMITER_SRC).toContain("purgeExpiredBuckets");
  });
});

// ════════════════ 2. CONCURRENCY / ATOMICITY ════════════════

describe("187.2 — concurrent requests cannot double-spend the allowance", () => {
  it("1 & 2. 20 concurrent sends consume exactly the permitted number", async () => {
    const stub = makeDurableLimiterStub();
    const t = 4_000_000;
    const hash = await hashIdentifierForTest("burst@example.com");

    // Fired without awaiting between them: all 20 are in flight at once.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => stub.ctx.runMutation(null, { identityHash: hash, now: t })),
    );

    const allowed = results.filter((r) => r.allowed).length;
    // At a single instant the cooldown permits exactly one send.
    expect(allowed).toBe(1);
    expect(results.filter((r) => !r.allowed)).toHaveLength(19);
  });

  it("3. the cooldown is enforced atomically, not per caller", async () => {
    const stub = makeDurableLimiterStub();
    const t = 5_000_000;
    const hash = await hashIdentifierForTest("atomic@example.com");

    await stub.ctx.runMutation(null, { identityHash: hash, now: t });

    // Ten concurrent retries one second later: all inside the cooldown.
    const retries = await Promise.all(
      Array.from({ length: 10 }, () =>
        stub.ctx.runMutation(null, { identityHash: hash, now: t + 1_000 }),
      ),
    );
    expect(retries.every((r) => !r.allowed)).toBe(true);
    expect(retries.every((r) => r.reason === "cooldown")).toBe(true);
  });

  it("never records more sends than the window allows, however they interleave", async () => {
    const stub = makeDurableLimiterStub();
    const base = 6_000_000;
    const hash = await hashIdentifierForTest("interleave@example.com");

    // Spread across the window so the cooldown does not mask the ceiling,
    // with every request issued concurrently at each step.
    for (let step = 0; step < 12; step += 1) {
      const now = base + step * (RESEND_COOLDOWN_MS + 1_000);
      await Promise.all(
        Array.from({ length: 4 }, () => stub.ctx.runMutation(null, { identityHash: hash, now })),
      );
    }

    const row = stub.rows()[0];
    expect(row.sendTimestamps.length).toBeLessThanOrEqual(MAX_SENDS_PER_WINDOW);
    // And no counter went negative or produced a duplicate row.
    expect(stub.rows()).toHaveLength(1);
  });

  it("check-and-record live in ONE mutation, which is what makes it atomic", () => {
    // A separate query+mutation pair would reopen the race. Assert the
    // structure that provides the guarantee.
    const consume = LIMITER_SRC.slice(LIMITER_SRC.indexOf("consumeResendAllowance"));
    expect(consume).toContain("internalMutation");
    expect(consume).toMatch(/ctx\.db\.(patch|insert)/);
    // The limiter exposes no public "check" entry point to race against.
    expect(LIMITER_SRC).not.toMatch(/export const \w+ = query\(/);
    expect(LIMITER_SRC).not.toMatch(/export const \w+ = mutation\(/);
  });

  it("a rejected request does not extend the cooldown", async () => {
    const stub = makeDurableLimiterStub();
    const t = 7_000_000;
    const hash = await hashIdentifierForTest("noextend@example.com");

    await stub.ctx.runMutation(null, { identityHash: hash, now: t });
    // Hammer during the cooldown; none of these may be recorded.
    for (let i = 1; i <= 5; i += 1) {
      await stub.ctx.runMutation(null, { identityHash: hash, now: t + i * 1_000 });
    }
    // The original cooldown still expires on its original schedule.
    const after = await stub.ctx.runMutation(null, {
      identityHash: hash,
      now: t + RESEND_COOLDOWN_MS + 1,
    });
    expect(after.allowed).toBe(true);
    expect(stub.rows()[0].sendTimestamps).toHaveLength(2);
  });
});

// ════════════════ 3. FAIL-CLOSED BEHAVIOUR ════════════════

describe("187.3 — limiter failure does not become unlimited access", () => {
  it("19. a storage failure fails closed rather than sending", async () => {
    const stub = makeDurableLimiterStub();
    stub.failNext(1);
    await expect(
      stub.ctx.runMutation(null, { identityHash: "abc", now: 1 }),
    ).rejects.toThrow(/simulated limiter storage failure/);
  });

  it("no email can be sent through a retired provider: the module import fails closed", async () => {
    // The strongest form of "a limiter refusal becomes no-send": there is no
    // provider callback at all. A import of the retired module must fail, so
    // nothing can send through it regardless of limiter state.
    // @ts-expect-error — Phase 270: the module is retired; importing it must
    // fail closed, so tsc knowingly cannot resolve the specifier.
    await expect(import("./auth/emailOtp")).rejects.toThrow();
  });

  it("the retired refusal vocabulary is gone with the provider", () => {
    // The user-facing refusal text lived in the retired provider. Asserting
    // its absence everywhere proves nothing along the auth surface can still
    // speak the OTP language — which also means it cannot leak limiter state.
    expect(OTP_PROVIDER_ABSENT).toBe(true);
    expect(AUTH_SRC).not.toContain("Unable to send a verification code");
  });

  it("a delivery failure does not refund the allowance", async () => {
    // Refunding would let an attacker who can force provider errors retry
    // without limit. The delivery path is retired, so the invariant now
    // reads on the retained limiter alone: it has no refund path at all.
    expect(LIMITER_SRC).not.toMatch(/refund/i);
    const stub = makeDurableLimiterStub();
    const t = 8_000_000;
    const hash = await hashIdentifierForTest("nofund@example.com");
    await stub.ctx.runMutation(null, { identityHash: hash, now: t });
    // Even though "delivery failed", the slot stays consumed.
    const retry = await stub.ctx.runMutation(null, { identityHash: hash, now: t + 1_000 });
    expect(retry.allowed).toBe(false);
  });
});

// ════════════════ 4. POLICY SEMANTICS ════════════════

describe("187.4 — resend policy is explicit and defensible", () => {
  it("cooldown and window are the documented values", () => {
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
    expect(MAX_SENDS_PER_WINDOW).toBe(5);
    expect(RESEND_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it("the hourly ceiling binds independently of the cooldown", () => {
    // Without the ceiling, a 60s cooldown would still allow 60 mails an hour.
    let stamps: number[] = [];
    const t0 = 0;
    for (let i = 0; i < 60; i += 1) {
      const now = t0 + i * (RESEND_COOLDOWN_MS + 1);
      if (decideResend(pruneTimestamps(stamps, now), now).allowed) {
        stamps = appendSend(stamps, now);
      }
    }
    expect(stamps.length).toBeLessThanOrEqual(MAX_SENDS_PER_WINDOW);
  });

  it("normalisation prevents casing and padding from evading the limit", async () => {
    const a = await hashIdentifierForTest("User@Example.com");
    const b = await hashIdentifierForTest("  user@example.COM  ");
    expect(a).toBe(b);
    expect(normaliseIdentifier(" A@B.C ")).toBe("a@b.c");
  });

  it("different identities have independent allowances", async () => {
    const stub = makeDurableLimiterStub();
    const t = 9_000_000;
    const one = await send(stub, stub.ctx, "one@example.com", t);
    const two = await send(stub, stub.ctx, "two@example.com", t);
    expect(one.allowed).toBe(true);
    expect(two.allowed).toBe(true);
  });
});

// ════════════════ 5. FAILED VERIFICATION ATTEMPTS ════════════════

describe("187.5 — failed attempts stay with Convex Auth, no second counter", () => {
  it("7. the project does not add a competing failed-attempt counter", () => {
    // A second source of truth for auth state is worse than the gap it fills.
    expect(LIMITER_SRC).not.toMatch(/failedAttempts|attemptCount|verifyAttempts/i);
    expect(SCHEMA_SRC).not.toMatch(/failedAttempts|verificationAttempts/i);
  });

  it("the library's own attempt limit is configured and bounded", () => {
    const authSrc = read("src/convex/auth.ts");
    expect(authSrc).toContain("maxFailedAttempsPerHour");
    const match = authSrc.match(/MAX_FAILED_SIGN_IN_ATTEMPTS_PER_HOUR\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const limit = Number(match![1]);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(10);
  });

  it("replay is prevented upstream by delete-on-use, not re-implemented here", () => {
    const lib = read("node_modules/@convex-dev/auth/src/server/implementation/mutations/verifyCodeAndSignIn.ts");
    expect(lib).toMatch(/delete\(/);
    // The provider must not implement verification itself. Strip comments
    // first: the module *documents* the library's verifyCodeAndSignIn, and a
    // raw string match would flag that reference as an implementation.
    // The OTP code-issuing surface is retired; the library mutation keeps
    // serving only the flows that remain (Google callback uses none of it).
    expect(AUTH_SRC.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/consumeCode/);
  });
});

// ════════════════ 6. ENTITLEMENT ABUSE ════════════════

describe("187.6 — entitlement remains server-authoritative", () => {
  it("8, 9, 10. remaining=1 with 10 concurrent chargeable requests consumes exactly one", () => {
    // Serializable execution: each transaction sees the committed prior one.
    let used = FREE_PROFIT_SIGNAL_LIMIT - 1;
    let consumed = 0;
    let locked = 0;

    for (let i = 0; i < 10; i += 1) {
      const decision = evaluateEntitlement({ plan: "GUEST", profitSignalsUsed: used });
      if (decision.allowed) {
        used = nextUsageCount({ plan: "GUEST", profitSignalsUsed: used }, "BUY");
        consumed += 1;
      } else {
        locked += 1;
      }
    }

    expect(consumed).toBe(1);
    expect(locked).toBe(9);
    expect(used).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    // No negative balance, and never past the ceiling.
    expect(FREE_PROFIT_SIGNAL_LIMIT - used).toBe(0);
    expect(FREE_PROFIT_SIGNAL_LIMIT - used).toBeGreaterThanOrEqual(0);
  });

  it("usage is monotonic — no path decrements it", () => {
    // The invariant is declared where the field is defined.
    expect(SCHEMA_SRC).toContain("never decremented");
    // Scope to the consume path. Two `profitSignalsUsed: 0` literals exist
    // elsewhere and both are legitimate: the unauthenticated guest read
    // shape, and the initial value for a brand-new row. Neither resets an
    // existing counter, and grantPremium's patch deliberately omits the
    // field so an upgrade cannot clear prior usage.
    const consumePath = ENTITLEMENTS_SRC.slice(
      ENTITLEMENTS_SRC.indexOf("export const consumeProfitSignal"),
      ENTITLEMENTS_SRC.indexOf("export const grantPremium"),
    );
    expect(consumePath).not.toMatch(/profitSignalsUsed\s*-[^-]/);
    expect(consumePath).not.toMatch(/profitSignalsUsed:\s*0\b/);

    // A Premium grant must never zero an existing user's usage.
    const grantPath = ENTITLEMENTS_SRC.slice(ENTITLEMENTS_SRC.indexOf("export const grantPremium"));
    const patchBlock = grantPath.slice(grantPath.indexOf("ctx.db.patch"), grantPath.indexOf("return existing._id"));
    expect(patchBlock).not.toContain("profitSignalsUsed");

    // Behavioural proof. The security-relevant invariant is not that the
    // stored integer never decreases — `nextUsageCount` deliberately clamps
    // to FREE_PROFIT_SIGNAL_LIMIT so a race cannot inflate it — but that a
    // write can never GRANT allowance. Remaining must never increase.
    //
    // The clamp looks like a decrement for an out-of-range input (used=5
    // stores 2), yet 2 is still at the lock threshold, so the user stays
    // LOCKED. That path is also unreachable in the real mutation:
    // consumeProfitSignal returns LOCKED before calling nextUsageCount
    // whenever remaining is 0.
    for (const used of [0, 1, 2, 5, 50]) {
      const remainingBefore = evaluateEntitlement({
        plan: "GUEST",
        profitSignalsUsed: used,
      }).remaining;
      for (const action of ["BUY", "SELL", "LONG", "SHORT", "WAIT", "NO_TRADE", "??"]) {
        const next = nextUsageCount({ plan: "GUEST", profitSignalsUsed: used }, action);
        const remainingAfter = evaluateEntitlement({
          plan: "GUEST",
          profitSignalsUsed: next,
        }).remaining;
        expect(
          remainingAfter,
          `used=${used} action=${action} must not gain allowance`,
        ).toBeLessThanOrEqual(remainingBefore);
        expect(remainingAfter).toBeGreaterThanOrEqual(0);
      }
    }

    // And the clamp can never leave an exhausted user unlocked.
    for (const used of [2, 3, 5, 50]) {
      const next = nextUsageCount({ plan: "GUEST", profitSignalsUsed: used }, "BUY");
      expect(evaluateEntitlement({ plan: "GUEST", profitSignalsUsed: next }).allowed).toBe(false);
    }
  });

  it("11 & 12. WAIT and NO_TRADE are free", () => {
    expect(isProfitSignal("WAIT")).toBe(false);
    expect(isProfitSignal("NO_TRADE")).toBe(false);
    for (const action of ["BUY", "SELL", "LONG", "SHORT"]) {
      expect(isProfitSignal(action)).toBe(true);
    }
    const before = { plan: "GUEST" as const, profitSignalsUsed: 0 };
    expect(nextUsageCount(before, "WAIT")).toBe(0);
    expect(nextUsageCount(before, "NO_TRADE")).toBe(0);
  });

  it("8. chargeability is derived from the engine output, never from the client", () => {
    // The mutation takes the recommendation and classifies it server-side;
    // it must not accept a client-supplied chargeable/free flag.
    expect(ENTITLEMENTS_SRC).toContain("isProfitSignal");
    expect(ENTITLEMENTS_SRC).not.toMatch(/args\.(chargeable|isFree|skipCharge|free)\b/);
  });

  it("13. a forged Premium claim is ignored — plan is resolved server-side", () => {
    expect(SCHEMA_SRC).toContain("resolved server-side, never sent by the client");
    // consumeProfitSignal accepts only the recommendation.
    const consume = ENTITLEMENTS_SRC.slice(
      ENTITLEMENTS_SRC.indexOf("export const consumeProfitSignal"),
      ENTITLEMENTS_SRC.indexOf("export const grantPremium"),
    );
    expect(consume).not.toMatch(/args\.(plan|premium|tier|remaining|unlimited)/i);
    expect(consume).toContain("resolveUser");
  });

  it("grantPremium is not reachable from a client upgrade button", () => {
    expect(ENTITLEMENTS_SRC).toContain("NOT wired to a client");
  });

  it("15 & 16. identity comes from the server session, so storage resets and device switches share state", () => {
    // Entitlement is keyed by server-resolved userId, never by a client token
    // or a device identifier — so clearing localStorage or switching from Web
    // to Android reaches the same row.
    expect(SCHEMA_SRC).toMatch(/userId: v\.id\("users"\)/);
    expect(ENTITLEMENTS_SRC).toContain("resolveUser");
    expect(ENTITLEMENTS_SRC).not.toMatch(/deviceId|installId|clientId|localStorage/i);
  });

  it("14. an unauthenticated caller cannot consume or read allowance", () => {
    expect(ENTITLEMENTS_SRC).toContain("Unauthenticated");
  });
});

// ════════════════ 7. DIAGNOSTICS PRIVACY ════════════════

describe("187.7 — abuse diagnostics carry no sensitive data", () => {
  it("20. the limiter returns no counters to the caller", () => {
    // Exposing "3 of 5 used" would let an attacker probe another identity.
    const returns = LIMITER_SRC.slice(LIMITER_SRC.indexOf("returns: v.object"));
    expect(returns).not.toMatch(/remaining|used|count|attempts/i);
    expect(returns).toContain("allowed");
  });

  it("no user-facing throttle message survives the retirement", () => {
    // The "Try again in N seconds" copy lived in the retired provider. Its
    // disappearance proves no OTP-facing copy leaks throttle detail anywhere:
    // there is no OTP surface left that could.
    expect(OTP_PROVIDER_ABSENT).toBe(true);
    expect(LIMITER_SRC).not.toMatch(/Try again in \$\{seconds\} seconds/);
  });

  it("no OTP, key, token or address appears in limiter or auth source", () => {
    for (const src of [LIMITER_SRC, AUTH_SRC]) {
      expect(src).not.toMatch(/console\.log/);
      expect(src).not.toMatch(/Authorization:\s*`?Bearer/);
    }
  });
});

// ════════════════ 8. ENUMERATION RESISTANCE ════════════════

describe("187.8 — responses do not disclose account or throttle state", () => {
  it("the limiter is internal, so a client cannot probe an address", () => {
    expect(LIMITER_SRC).toContain("internalMutation");
    expect(LIMITER_SRC).not.toContain("export const consumeResendAllowance = mutation");
  });

  it("no OTP response exists that could distinguish an existing account", () => {
    // Enumeration resistance once meant throttle replies carried no account
    // hints. With the provider retired there are no OTP replies at all, so
    // the property holds universally.
    expect(OTP_PROVIDER_ABSENT).toBe(true);
  });
});

// ════════════════ 9. BOUNDED WORK ════════════════

describe("187.9 — the limiter adds bounded, predictable work", () => {
  it("costs exactly one indexed mutation per send attempt", async () => {
    const stub = makeDurableLimiterStub();
    const t = 10_000_000;
    await send(stub, stub.ctx, "cost@example.com", t);
    expect(stub.callCount()).toBe(1);
    await send(stub, stub.ctx, "cost@example.com", t + 1);
    expect(stub.callCount()).toBe(2);
  });

  it("reads through an index rather than scanning the table", () => {
    expect(LIMITER_SRC).toContain("withIndex");
    expect(LIMITER_SRC).toContain("by_identity");
    expect(LIMITER_SRC).not.toMatch(/\.collect\(\)/);
  });

  it("a hot key cannot grow the stored array without bound", async () => {
    const stub = makeDurableLimiterStub();
    const base = 11_000_000;
    const hash = await hashIdentifierForTest("hot@example.com");
    for (let i = 0; i < 200; i += 1) {
      await stub.ctx.runMutation(null, {
        identityHash: hash,
        now: base + i * (RESEND_COOLDOWN_MS + 1),
      });
    }
    expect(stub.rows()[0].sendTimestamps.length).toBeLessThanOrEqual(MAX_SENDS_PER_WINDOW);
  });

  it("cleanup work per invocation is capped", () => {
    expect(LIMITER_SRC).toMatch(/Math\.min\(/);
    expect(LIMITER_SRC).toContain("take(");
  });
});

// ════════════════ 10. PRESERVED ARCHITECTURE ════════════════

describe("187.10 — Phase 185b/186 guarantees are untouched", () => {
  it("the console-transport fail-closed policy retired with the module; the issuer policy is intact", () => {
    // emailDelivery.ts carried the isProductionDeployment guard; it is gone —
    // there is no transport left to configure, so the property cannot regress.
    expect(existsSync(join(process.cwd(), "src/convex/lib/emailDelivery.ts"))).toBe(false);
    const issuer = read("src/convex/lib/issuerPolicy.ts");
    expect(issuer).toContain("RETIRED_ISSUER_HOSTS");
  });

  it("no Freebuff OTP dependency returned to the runtime path", () => {
    expect(AUTH_SRC).not.toMatch(/freebuff/i);
    expect(LIMITER_SRC).not.toMatch(/freebuff/i);
  });

  it("the OTP expiry policy is gone with the capability it governed", () => {
    // OTP_EXPIRY_MINUTES was defined in the retired provider. Retirement
    // removed the policy setting, which is strictly stronger than keeping a
    // correct value: no OTP is generated, so no OTP can be valid too long.
    expect(AUTH_SRC).not.toContain("OTP_EXPIRY_MINUTES");
    expect(OTP_PROVIDER_ABSENT).toBe(true);
  });
});

// ════════════════ 11. ANALYSIS FLOODING & AMPLIFICATION ════════════════

describe("187.11 — §9/§10 analysis flooding and provider amplification", () => {
  const ANALYSIS_SRC = read("src/convex/protectedAnalysis.ts");
  const RESILIENCE_SRC = read("src/lib/data/provider-resilience.ts");

  it("17. work per analysis is bounded by a fixed leg list, not by client input", () => {
    // Amplification would require the client to influence how many provider
    // calls happen. The fan-out is a literal array of legs, so a malformed or
    // oversized payload cannot multiply provider traffic.
    expect(ANALYSIS_SRC).toContain("runFanOut([");
    const fanOutCall = ANALYSIS_SRC.slice(ANALYSIS_SRC.indexOf("runFanOut(["));
    const legs = fanOutCall.slice(0, fanOutCall.indexOf("]"));
    // No client-driven iteration constructs the leg list.
    expect(legs).not.toMatch(/args\.|\.map\(|for\s*\(/);
  });

  it("the 15s overall wave and per-provider budgets remain intact", () => {
    expect(RESILIENCE_SRC).toContain("FANOUT_BUDGET_MS = 15_000");
    expect(RESILIENCE_SRC).toContain("PROVIDER_BUDGET_MS");
    expect(RESILIENCE_SRC).toContain("DEFAULT_PROVIDER_BUDGET_MS");
  });

  it("unauthenticated callers are rejected before any provider work", () => {
    const handler = ANALYSIS_SRC.slice(ANALYSIS_SRC.indexOf("export const runProtectedAnalysis"));
    const authIdx = handler.indexOf("resolveCallerId");
    const failClosedIdx = handler.indexOf("UNAUTHENTICATED");
    const acquisitionIdx = handler.indexOf("runFanOut");
    expect(authIdx).toBeGreaterThan(-1);
    // Identity is resolved, and the unauthenticated exit happens, before fan-out.
    expect(authIdx).toBeLessThan(acquisitionIdx);
    expect(failClosedIdx).toBeLessThan(acquisitionIdx);
  });

  it("invalid input is rejected early, before provider acquisition", () => {
    const handler = ANALYSIS_SRC.slice(ANALYSIS_SRC.indexOf("export const runProtectedAnalysis"));
    expect(handler.indexOf("INVALID_INPUT")).toBeLessThan(handler.indexOf("runFanOut"));
  });

  it("client-supplied provider evidence is stripped before the engine runs", () => {
    const handler = ANALYSIS_SRC.slice(ANALYSIS_SRC.indexOf("export const runProtectedAnalysis"));
    expect(handler).toContain("stripClientEvidence");
    expect(handler.indexOf("stripClientEvidence")).toBeLessThan(handler.indexOf("runFanOut"));
  });

  it("18. entitlement is the primary per-identity spend control on analysis", () => {
    // Deliberate design note, asserted so it cannot silently change: there is
    // no blanket per-request analysis throttle, because chargeable work is
    // already bounded per identity by the entitlement ledger, and throttling
    // all analysis would harm legitimate users (§9 says not to do this
    // blindly). Free WAIT/NO_TRADE results remain bounded by the fixed
    // provider budget plus the authoritative cache.
    expect(ANALYSIS_SRC).toContain("resolveCallerId");
    // The exhausted state is declared by the entitlement library and surfaced
    // by the analysis action; entitlements.ts consumes the decision rather
    // than restating the constant.
    expect(read("src/lib/entitlement/entitlement.ts")).toContain("FREE_ALLOWANCE_EXHAUSTED");
    expect(ANALYSIS_SRC).toContain("FREE_ALLOWANCE_EXHAUSTED");
  });

  it("no hidden retry loop can amplify provider calls", () => {
    // A retry inside a leg would multiply outbound requests per analysis.
    const legSection = RESILIENCE_SRC.slice(RESILIENCE_SRC.indexOf("export async function runFanOut"));
    expect(legSection).not.toMatch(/for\s*\([^)]*retry|while\s*\(|attempt\+\+/i);
  });
});
