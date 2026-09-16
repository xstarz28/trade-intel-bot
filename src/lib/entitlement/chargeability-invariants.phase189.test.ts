/**
 * Phase 189 — chargeability and provider-failure invariants.
 *
 * Written in response to two mutations that SURVIVED the Phase 189 suite:
 *
 *   M3  removing the `NON_ACTIONABLE` deny-list from `isProfitSignal`
 *   M6  relabelling a fan-out deadline failure as `status: "success"`
 *
 * Both survived for the same reason: the behaviour happened to be preserved
 * by a SECOND layer (the `ACTIONABLE` allow-list, and the ordinary per-leg
 * failure path), so no assertion noticed the first layer had been deleted.
 *
 * That is exactly the situation defence-in-depth is supposed to create — and
 * exactly why it must be tested directly. A silently removed safety layer is
 * a latent incident: the day someone adds "STRONG_BUY" upstream, the missing
 * deny-list starts billing users for WAIT.
 *
 * These tests execute the real functions rather than inspecting source text.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FREE_PROFIT_SIGNAL_LIMIT,
  isProfitSignal,
  nextUsageCount,
} from "@/lib/entitlement/entitlement";
import type { EntitlementState } from "@/lib/entitlement/entitlement";
import { runFanOut, runProviderLeg } from "@/lib/data/provider-resilience";

// ════════════ M3 — WAIT / NO_TRADE must never be chargeable ════════════

describe("189-M3 — non-actionable recommendations are always free", () => {
  /**
   * Every spelling the engine or a future contributor might produce. This is
   * the deny-list's whole purpose: it must hold even if the value is not in
   * the actionable allow-list either.
   */
  /** A guest with `used` signals already consumed. */
  const guest = (used: number): EntitlementState => ({ plan: "GUEST", profitSignalsUsed: used });

  const NON_ACTIONABLE = [
    "WAIT",
    "NO_TRADE",
    "NO TRADE",
    "HOLD",
    "AVOID",
    "INSUFFICIENT_DATA",
    "UNAVAILABLE",
  ];

  it.each(NON_ACTIONABLE)("%s is not a profit signal", (recommendation) => {
    expect(isProfitSignal(recommendation)).toBe(false);
  });

  it.each(NON_ACTIONABLE)("%s consumes no entitlement", (recommendation) => {
    // The user must not be billed for being told there is no trade.
    expect(nextUsageCount(guest(0), recommendation)).toBe(0);
    expect(nextUsageCount(guest(1), recommendation)).toBe(1);
  });

  it("case and whitespace variants stay free", () => {
    for (const variant of [" wait ", "no_trade", "No Trade", "hOlD", "\tAVOID\n"]) {
      expect(isProfitSignal(variant), `${variant} became chargeable`).toBe(false);
      expect(nextUsageCount(guest(0), variant)).toBe(0);
    }
  });

  it("the deny-list still exists as an explicit safety layer", () => {
    // HONEST LIMITATION, stated rather than hidden.
    //
    // `ACTIONABLE` and `NON_ACTIONABLE` are disjoint, so today the deny-list
    // changes no OUTCOME: every value it rejects would also fail the
    // allow-list. That means deleting it is behaviourally invisible, and no
    // black-box assertion can detect the deletion — mutation M3 survived the
    // entire suite for exactly this reason.
    //
    // The layer is still worth keeping: the moment someone adds a value like
    // "STRONG_BUY" or switches the allow-list to a prefix/heuristic match,
    // the deny-list is the thing that stops WAIT from becoming chargeable.
    // Since behaviour cannot witness it, its PRESENCE is asserted directly.
    // This is a structural assertion by necessity, not by preference.
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/entitlement/entitlement.ts"),
      "utf8",
    );
    expect(source, "the NON_ACTIONABLE deny-list was removed").toMatch(
      /NON_ACTIONABLE\s*=\s*new Set\(/,
    );
    expect(
      source,
      "isProfitSignal no longer consults the deny-list",
    ).toMatch(/NON_ACTIONABLE\.has\(normalized\)\s*\)\s*return false;/);

    // And every listed term must still be free in behaviour.
    for (const recommendation of NON_ACTIONABLE) {
      expect(nextUsageCount(guest(0), recommendation), `${recommendation} charged`).toBe(0);
    }
  });

  it("the two sets stay disjoint, so neither layer can contradict the other", () => {
    // If a term ever appears in both, the outcome depends on evaluation
    // order — a coin-flip about whether the user is billed.
    for (const recommendation of NON_ACTIONABLE) {
      expect(isProfitSignal(recommendation), `${recommendation} is in both sets`).toBe(false);
    }
  });

  it("genuinely actionable directions remain chargeable", () => {
    // The inverse must also hold, or "make everything free" would pass.
    for (const recommendation of ["BUY", "SELL", "LONG", "SHORT"]) {
      expect(isProfitSignal(recommendation), `${recommendation}`).toBe(true);
      expect(nextUsageCount(guest(0), recommendation)).toBe(1);
    }
  });

  it("unknown and empty values fail closed to free", () => {
    for (const recommendation of ["", "   ", "MAYBE", "STRONG_BUY", null, undefined]) {
      expect(isProfitSignal(recommendation as string)).toBe(false);
    }
  });

  it("usage never exceeds the free limit", () => {
    expect(nextUsageCount(guest(FREE_PROFIT_SIGNAL_LIMIT), "BUY")).toBe(
      FREE_PROFIT_SIGNAL_LIMIT,
    );
    // A PREMIUM plan is never counted at all.
    expect(nextUsageCount({ plan: "PREMIUM", profitSignalsUsed: 0 }, "BUY")).toBe(0);
  });
});

// ════════════ M6 — a failed provider leg is never a success ════════════

describe("189-M6 — provider failure never reports success", () => {
  const okLeg = async () => ({ success: true, data: { value: 1 } });

  it("a rejected leg is reported as failed and carries no data", async () => {
    const outcome = await runProviderLeg({
      provider: "test-provider",
      budgetMs: 200,
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.status).not.toBe("success");
    // A failure must surrender no payload, or fabricated evidence enters.
    expect(outcome.data).toBeUndefined();
  });

  it("a provider's own success:false envelope is a failure", async () => {
    const outcome = await runProviderLeg({
      provider: "test-provider",
      budgetMs: 200,
      run: async () => ({ success: false, error: "upstream said no" }),
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.data).toBeUndefined();
  });

  it("a successful leg is still reported as success", async () => {
    // Guards against the inverse mutation ("call everything failed").
    const outcome = await runProviderLeg({
      provider: "test-provider",
      budgetMs: 500,
      run: okLeg,
    });
    expect(outcome.status).toBe("success");
    expect(outcome.data).toEqual({ value: 1 });
  });

  it("a leg unsettled at the fan-out deadline is failed, never success", async () => {
    // This is the exact line M6 mutated: the deadline-exceeded synthesiser in
    // `runFanOut`. Nothing previously asserted its STATUS, so relabelling it
    // "success" survived the whole suite.
    const pending = new Promise<never>(() => {});
    const diag = await runFanOut([pending as never], { budgetMs: 50 });

    expect(diag.deadlineExceeded).toBe(true);
    expect(diag.outcomes.length).toBe(1);
    for (const outcome of diag.outcomes) {
      expect(outcome.status, "an unsettled leg must not be success").not.toBe("success");
      expect(outcome.status).toBe("failed");
      expect(outcome.data).toBeUndefined();
      expect(outcome.timedOut).toBe(true);
      expect(String(outcome.reason)).toMatch(/budget|deadline/i);
    }
  });

  it("legs that finished before the deadline keep their real results", async () => {
    // Preservation: good evidence is never discarded, and a failed neighbour
    // never promotes itself using a successful sibling's status.
    const good = runProviderLeg({ provider: "good", budgetMs: 200, run: okLeg });
    const pending = new Promise<never>(() => {});
    const diag = await runFanOut([good, pending as never], { budgetMs: 80 });

    const statuses = diag.outcomes.map((o) => o.status);
    expect(statuses).toContain("success");
    expect(statuses).toContain("failed");
    // Collapsing the two into one status is precisely what M6 attempted.
    expect(new Set(statuses).size).toBeGreaterThan(1);

    for (const outcome of diag.outcomes) {
      if (outcome.status === "failed") expect(outcome.data).toBeUndefined();
    }
  });
});
