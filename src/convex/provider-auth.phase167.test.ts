/**
 * Phase 167 — Authorization boundary for credentialed provider actions.
 *
 * Convex actions are publicly callable by anyone who knows the deployment
 * URL. Eight actions proxy third-party APIs using server-side keys
 * (Alpha Vantage, CoinGlass, EIA, Trading Economics, Twelve Data). With no
 * guard, an anonymous caller could invoke them in a loop and exhaust a paid
 * quota, or use the deployment as a free proxy for an API the project pays
 * for.
 *
 * The requirement is deliberately minimal — these serve market data, not user
 * data, so the caller need only present *some* identity. Anonymous/guest
 * sign-in satisfies it, so the guest experience is unaffected.
 *
 * Actions hitting genuinely keyless public endpoints (OKX, CFTC/CoT, US
 * Treasury) are intentionally left open: requiring a session there would add
 * no protection, since anyone can call those upstream APIs directly at no
 * cost to this project.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireIdentity } from "./lib/requireIdentity";

// ── The guard itself ────────────────────────────────────────────

describe("requireIdentity", () => {
  it("rejects a caller with no identity", async () => {
    const ctx = { auth: { getUserIdentity: async () => null } };
    await expect(requireIdentity(ctx)).rejects.toThrow(/Unauthenticated/);
  });

  it("accepts any authenticated identity, including anonymous guests", async () => {
    const guest = {
      auth: { getUserIdentity: async () => ({ subject: "guest|1", isAnonymous: true }) },
    };
    await expect(requireIdentity(guest)).resolves.toBeUndefined();

    const user = {
      auth: { getUserIdentity: async () => ({ subject: "user|1", email: "a@b.c" }) },
    };
    await expect(requireIdentity(user)).resolves.toBeUndefined();
  });

  it("never echoes arguments or credentials in the error", async () => {
    const ctx = { auth: { getUserIdentity: async () => null } };
    const err = await requireIdentity(ctx).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).not.toMatch(/api[_-]?key|token|secret|authorization|bearer/i);
  });
});

// ── Every credentialed action must be guarded ───────────────────

/**
 * Files that read a provider API key out of the environment, together with
 * the exported actions in each. If an action in one of these files spends a
 * key, it must require an identity first.
 */
const CREDENTIALED = [
  "src/convex/alphaVantage.ts",
  "src/convex/coinglass.ts",
  "src/convex/eia.ts",
  "src/convex/tradingEconomics.ts",
  "src/convex/marketData.ts",
  "src/convex/liveProtection.ts",
];

function exportedActions(src: string): { name: string; body: string }[] {
  const parts = src.split(/\nexport const (\w+)\s*=\s*action\(/);
  const out: { name: string; body: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ name: parts[i], body: parts[i + 1] ?? "" });
  }
  return out;
}

describe("credentialed provider actions", () => {
  for (const file of CREDENTIALED) {
    const src = readFileSync(file, "utf8");

    it(`${file} actually reads an API key from the environment`, () => {
      // Guards the list itself: if a file stops using a key this test tells
      // us to re-evaluate rather than silently over-restricting.
      expect(src).toMatch(/process\.env\.\w*(API_KEY|KEY)/);
    });

    it(`${file} guards every exported action`, () => {
      const unguarded = exportedActions(src)
        .filter((a) => !a.body.includes("requireIdentity"))
        .map((a) => a.name);

      expect(unguarded).toEqual([]);
    });

    it(`${file} checks identity before spending the key`, () => {
      for (const action of exportedActions(src)) {
        const guardAt = action.body.indexOf("requireIdentity");
        const keyAt = action.body.search(/process\.env\.\w*(API_KEY|KEY)/);
        if (keyAt === -1) continue;
        expect(
          guardAt,
          `${action.name} reads its API key before authenticating`,
        ).toBeLessThan(keyAt);
      }
    });
  }
});

// ── No credential may leak through an error path ────────────────

describe("credential leakage", () => {
  it("the retired email-OTP module stays absent (a credential alias could once hide there)", () => {
    // The file previously scanned here alongside CREDENTIALED was deleted in
    // Phase 270. Its absence is asserted so the scan list stays honest.
    expect(existsSync(join(process.cwd(), "src/convex/auth/emailOtp.ts"))).toBe(false);
  });

  it("no convex module stringifies a whole error object", () => {
    const offenders: string[] = [];
    for (const file of CREDENTIALED) {
      const src = readFileSync(file, "utf8");
      // JSON.stringify(error) serializes request config including headers.
      if (/JSON\.stringify\(\s*(error|err|e)\s*\)/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("no convex module contains a hardcoded api key literal", () => {
    const offenders: string[] = [];
    for (const file of CREDENTIALED) {
      const src = readFileSync(file, "utf8");
      if (/["'][A-Za-z0-9_]{4,}_[A-Za-z0-9]{16,}["']/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
