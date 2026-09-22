/**
 * Owner-principal parser and matcher.
 *
 * OWNER is a server overlay. These tests pin fail-closed parsing and exact
 * matching so a malformed env value cannot grant unlimited analysis, and so
 * an arbitrary authenticated user cannot match by substring, glob, or role.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  OWNER_PRINCIPALS_ENV,
  isConfiguredOwner,
  matchOwnerPrincipal,
  parseOwnerPrincipals,
} from "./owner-principals";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  nextUsageCount,
  overlayOwnerPlan,
  storedPlanFrom,
} from "./entitlement";

describe("parseOwnerPrincipals", () => {
  it("unset, empty, and whitespace match nobody", () => {
    for (const raw of [undefined, null, "", "   ", "\n\t"]) {
      const parsed = parseOwnerPrincipals(raw);
      expect(parsed.status, String(raw)).toBe("empty");
      expect(parsed.principals).toEqual([]);
      expect(isConfiguredOwner({ userId: "u1", email: "a@b.com" }, raw)).toBe(false);
    }
  });

  it("accepts email and user principals", () => {
    const parsed = parseOwnerPrincipals(
      "email:Owner@example.com, user:k57abc_user-1",
    );
    expect(parsed.status).toBe("ok");
    expect(parsed.principals).toEqual([
      { kind: "email", value: "owner@example.com" },
      { kind: "user", value: "k57abc_user-1" },
    ]);
  });

  it("a single malformed token rejects the whole list", () => {
    const cases = [
      "email:owner@example.com,bogus",
      "email:*@example.com",
      "email:owner@example.com,email:*",
      "role:admin",
      "email:",
      "user:",
      "user:user@example.com",
      "email:not-an-email",
      "email:owner@example.com,user:*",
      "mailto:owner@example.com",
      "email:owner@example.com;email:other@example.com",
    ];
    for (const raw of cases) {
      const parsed = parseOwnerPrincipals(raw);
      expect(parsed.status, raw).toBe("malformed");
      expect(parsed.principals).toEqual([]);
      expect(
        isConfiguredOwner({ userId: "k57abc_user-1", email: "owner@example.com" }, raw),
        raw,
      ).toBe(false);
    }
  });
});

describe("matchOwnerPrincipal", () => {
  const cfg = parseOwnerPrincipals("email:owner@example.com,user:ownerUser1");

  it("matches email case-insensitively", () => {
    expect(matchOwnerPrincipal({ email: "Owner@Example.com" }, cfg)).toBe(true);
  });

  it("matches the Convex user id exactly", () => {
    expect(matchOwnerPrincipal({ userId: "ownerUser1" }, cfg)).toBe(true);
    expect(matchOwnerPrincipal({ userId: "OwnerUser1" }, cfg)).toBe(false);
  });

  it("does not match arbitrary authenticated users", () => {
    expect(
      matchOwnerPrincipal({ userId: "someoneElse", email: "guest@example.com" }, cfg),
    ).toBe(false);
  });

  it("does not match a substring or a different user sharing a domain", () => {
    expect(matchOwnerPrincipal({ email: "not-owner@example.com" }, cfg)).toBe(false);
    expect(matchOwnerPrincipal({ email: "owner@example.com.evil" }, cfg)).toBe(false);
    expect(matchOwnerPrincipal({ userId: "ownerUser1x" }, cfg)).toBe(false);
  });

  it("an empty identity is never owner", () => {
    expect(matchOwnerPrincipal({}, cfg)).toBe(false);
    expect(matchOwnerPrincipal({ userId: "", email: "" }, cfg)).toBe(false);
    expect(matchOwnerPrincipal({ userId: null, email: null }, cfg)).toBe(false);
  });
});

describe("OWNER overlay on the entitlement rules", () => {
  it("is unlimited and never consumes the free counter", () => {
    const owner = { plan: "OWNER" as const, profitSignalsUsed: FREE_PROFIT_SIGNAL_LIMIT };
    const decision = evaluateEntitlement(owner);
    expect(decision.allowed).toBe(true);
    expect(decision.upgradeRequired).toBe(false);
    expect(decision.reason).toBe("OWNER");
    expect(nextUsageCount(owner, "BUY")).toBe(FREE_PROFIT_SIGNAL_LIMIT);
    expect(nextUsageCount(owner, "LONG")).toBe(FREE_PROFIT_SIGNAL_LIMIT);
  });

  it("still allows analysis after the guest limit is exhausted", () => {
    const used = { plan: "OWNER" as const, profitSignalsUsed: 2 };
    expect(evaluateEntitlement(used).allowed).toBe(true);
    expect(nextUsageCount(used, "SELL")).toBe(2);
  });

  it("does not change what counts as chargeable for guests", () => {
    const guest = { plan: "GUEST" as const, profitSignalsUsed: 0 };
    expect(nextUsageCount(guest, "BUY")).toBe(1);
    expect(nextUsageCount(guest, "WAIT")).toBe(0);
    expect(evaluateEntitlement({ plan: "GUEST", profitSignalsUsed: 2 }).allowed).toBe(
      false,
    );
  });

  it("does not change Premium", () => {
    const premium = { plan: "PREMIUM" as const, profitSignalsUsed: 0 };
    expect(evaluateEntitlement(premium).reason).toBe("PREMIUM");
    expect(nextUsageCount(premium, "BUY")).toBe(0);
  });

  it("never stores OWNER as the commercial plan", () => {
    expect(storedPlanFrom("OWNER")).toBe("GUEST");
    expect(overlayOwnerPlan("GUEST", true)).toBe("OWNER");
    expect(overlayOwnerPlan("PREMIUM", true)).toBe("OWNER");
    expect(overlayOwnerPlan("GUEST", false)).toBe("GUEST");
    expect(overlayOwnerPlan("PREMIUM", false)).toBe("PREMIUM");
  });
});

describe("OWNER is not a client concern", () => {
  it("the env name is the Convex-only variable", () => {
    expect(OWNER_PRINCIPALS_ENV).toBe("XSTARZ_OWNER_PRINCIPALS");
    expect(OWNER_PRINCIPALS_ENV.startsWith("VITE_")).toBe(false);
  });

  it("pages, components and hooks never read the owner env or parser", () => {
    const roots = ["src/pages", "src/components", "src/hooks"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (
          /\.(ts|tsx)$/.test(name) &&
          !/\.test\.(ts|tsx)$/.test(name)
        ) {
          files.push(path);
        }
      }
    };
    for (const root of roots) walk(root);
    files.push("src/main.tsx");

    const needles = [
      "XSTARZ_OWNER_PRINCIPALS",
      "parseOwnerPrincipals",
      "isConfiguredOwner",
      "process.env.XSTARZ_OWNER",
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const needle of needles) {
        if (text.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
