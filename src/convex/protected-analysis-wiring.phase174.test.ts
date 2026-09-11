/**
 * Phase 174 — wiring guards for the protected boundary.
 *
 * The behavioural suite simulates the Convex runtime. That proves the *logic*
 * is right, but not that the shipped module is wired that way. These tests
 * read the real source and pin the structural properties the security argument
 * depends on. If someone re-introduces the client-supplied recommendation, or
 * makes the internal mutation public, these fail.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SERVER = readFileSync("src/convex/protectedAnalysis.ts", "utf8");
const DASHBOARD = readFileSync("src/pages/Dashboard.tsx", "utf8");
const ENTITLEMENTS = readFileSync("src/convex/entitlements.ts", "utf8");

describe("the engine runs on the server", () => {
  it("the protected action imports the real analysis engine", () => {
    expect(SERVER).toMatch(/import \{ runAnalysis \} from "@\/lib\/analysis-engine"/);
  });

  it("it actually invokes it", () => {
    expect(SERVER).toMatch(/runAnalysis\(/);
  });

  it("chargeability is derived from the engine output, not an argument", () => {
    const idx = SERVER.indexOf("const chargeable");
    expect(idx).toBeGreaterThan(-1);
    const block = SERVER.slice(idx, idx + 300);

    expect(block).toContain("engineResult.recommendation");
    // The decisive property: it must not read a client-supplied field.
    expect(block).not.toMatch(/args\.recommendation/);
  });

  it("the public action accepts inputs only — never a recommendation", () => {
    const idx = SERVER.indexOf("export const runProtectedAnalysis");
    const argsBlock = SERVER.slice(idx, SERVER.indexOf("handler:", idx));

    expect(argsBlock).toContain("input:");
    expect(argsBlock).not.toContain("recommendation");
    expect(argsBlock).not.toContain("plan");
    expect(argsBlock).not.toContain("isPremium");
    expect(argsBlock).not.toContain("remaining");
  });
});

describe("the consumption path is not client-callable", () => {
  it("resolveAndConsume is an internalMutation", () => {
    expect(SERVER).toMatch(/export const resolveAndConsume = internalMutation\(/);
  });

  it("resolveCallerId is an internalMutation", () => {
    expect(SERVER).toMatch(/export const resolveCallerId = internalMutation\(/);
  });

  it("neither is exported as a public mutation", () => {
    expect(SERVER).not.toMatch(/export const resolveAndConsume = mutation\(/);
    expect(SERVER).not.toMatch(/export const resolveCallerId = mutation\(/);
  });
});

describe("ordering: consume before deliver, fail closed", () => {
  it("entitlement is resolved before the result is gated", () => {
    const consumeAt = SERVER.indexOf("resolveAndConsume,");
    const gateAt = SERVER.indexOf("gateDecision({");
    expect(consumeAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(consumeAt);
  });

  it("an unauthenticated caller returns before the engine runs", () => {
    const guardAt = SERVER.indexOf('status: "UNAUTHENTICATED"');
    const engineAt = SERVER.indexOf("runAnalysis(args.input");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(engineAt);
  });

  it("the gate decides delivery, not the client", () => {
    expect(SERVER).toContain("entitlement: { allowed: verdict.allowed }");
  });
});

describe("the client no longer computes the delivered decision", () => {
  it("Dashboard does not import runAnalysis", () => {
    // The whole point: the directional payload must not be producible locally
    // on the delivery path.
    expect(DASHBOARD).not.toMatch(/import \{[^}]*\brunAnalysis\b[^}]*\} from "@\/lib\/analysis-engine"/);
  });

  it("Dashboard calls the protected action", () => {
    expect(DASHBOARD).toMatch(/api\.protectedAnalysis\.runProtectedAnalysis/);
  });

  it("Dashboard never derives entitlement locally", () => {
    // No client-side plan/allowance arithmetic.
    expect(DASHBOARD).not.toMatch(/FREE_PROFIT_SIGNAL_LIMIT\s*-/);
    expect(DASHBOARD).not.toMatch(/const\s+isPremium\s*=\s*(true|false)/);
    expect(DASHBOARD).not.toMatch(/localStorage[^\n]*(entitle|premium|signal|quota|usage)/i);
  });
});

describe("the legacy client-trusting mutation is neutralised", () => {
  it("consumeProfitSignal is documented as superseded", () => {
    // It must not remain an alternative, client-trusting way to spend or
    // avoid spending allowance without the boundary.
    expect(ENTITLEMENTS).toMatch(/DEPRECATED|SUPERSEDED|do not use/i);
  });
});

describe("no entitlement state is trusted from the client", () => {
  it("the server never reads a plan from its arguments", () => {
    expect(SERVER).not.toMatch(/args\.plan/);
    expect(SERVER).not.toMatch(/args\.isPremium/);
    expect(SERVER).not.toMatch(/args\.profitSignalsUsed/);
    expect(SERVER).not.toMatch(/args\.remaining/);
  });

  it("no localStorage anywhere in the server module", () => {
    expect(SERVER).not.toContain("localStorage");
  });
});
