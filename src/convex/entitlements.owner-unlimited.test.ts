/**
 * OWNER consumeProfitSignal accounting.
 *
 * OWNER is unlimited because isUnlimitedPlan includes it — not because
 * the client sent a flag, and not because the row stored "OWNER".
 * Matching/parsing of XSTARZ_OWNER_PRINCIPALS is unchanged here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  evaluateEntitlement,
  isUnlimitedPlan,
  nextUsageCount,
  overlayOwnerPlan,
} from "@/lib/entitlement/entitlement";

const SRC = readFileSync("src/convex/entitlements.ts", "utf8");
const CONSUME = SRC.slice(
  SRC.indexOf("export const consumeProfitSignal"),
  SRC.indexOf("export const grantPremium"),
);

describe("consumeProfitSignal treats OWNER as unlimited", () => {
  it("charged/remaining use isUnlimitedPlan, not a PREMIUM-only check", () => {
    expect(CONSUME).toContain("charged: !isUnlimitedPlan(state.plan)");
    expect(CONSUME).toMatch(
      /remaining:\s*isUnlimitedPlan\(state\.plan\)\s*\?\s*null/,
    );
    expect(CONSUME).not.toMatch(/charged:\s*state\.plan\s*!==\s*"PREMIUM"/);
    expect(CONSUME).not.toMatch(
      /remaining:\s*state\.plan\s*===\s*"PREMIUM"\s*\?\s*null/,
    );
  });

  it("isUnlimitedPlan covers OWNER and PREMIUM, not GUEST", () => {
    expect(isUnlimitedPlan("OWNER")).toBe(true);
    expect(isUnlimitedPlan("PREMIUM")).toBe(true);
    expect(isUnlimitedPlan("GUEST")).toBe(false);
  });

  it("OWNER overlay never consumes the free counter", () => {
    const plan = overlayOwnerPlan("GUEST", true);
    expect(plan).toBe("OWNER");
    const used = { plan, profitSignalsUsed: 2 };
    expect(evaluateEntitlement(used).allowed).toBe(true);
    expect(nextUsageCount(used, "BUY")).toBe(2);
  });

  it("does not hardcode a deployment owner email", () => {
    expect(SRC).not.toMatch(/email:\s*["'][^"']+@[^"']+["']/);
  });

  it("OWNER is an overlay from isConfiguredOwner, not a stored commercial plan", () => {
    expect(SRC).toContain("overlayOwnerPlan(");
    expect(SRC).toContain("isConfiguredOwner(");
    expect(SRC).toContain("plan: state.commercial");
  });
});
