/**
 * Phase 214 — production email / OTP readiness → RETIRED in Phase 270.
 *
 * The headline regression this suite guarded: production ACCEPTED
 * `noreply@vly.ai` as an OTP sender because the delivery denylist was a
 * hand-maintained copy of the issuer list. Post-retirement the property holds
 * maximally — there is NO sender-accepting code path anywhere — and the
 * denylist that proved it (`FORBIDDEN_DELIVERY_HOSTS`) is consolidated in the
 * retained `issuerPolicy.ts`, where it shares one list with issuer retirement.
 *
 * These tests never perform a send and never contain a credential.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_DELIVERY_HOSTS,
  RETIRED_ISSUER_HOSTS,
} from "./issuerPolicy";

describe("Phase 214 (retired, Phase 270) — retired domains can never be OTP senders", () => {
  it("there is no sender-accepting configuration reader anymore", () => {
    // readEmailDeliveryConfig was the function that once accepted the sender.
    // Its module is gone; the acceptance path cannot regress.
    expect(existsSync(resolve(process.cwd(), "src/convex/lib/emailDelivery.ts"))).toBe(false);
  });

  it("the consolidated denylist covers the freebuff identity and vly.ai", () => {
    expect(FORBIDDEN_DELIVERY_HOSTS).toContain("auth.freebuff.app");
    expect(FORBIDDEN_DELIVERY_HOSTS).toContain("vly.ai");
  });

  it("issuer and delivery retirement share ONE list now", () => {
    for (const host of RETIRED_ISSUER_HOSTS) {
      expect(FORBIDDEN_DELIVERY_HOSTS).toContain(host);
    }
    expect(RETIRED_ISSUER_HOSTS).toEqual(["freebuff.com", "freebuff.app", "vly.ai"]);
  });
});

describe("Phase 214 (retired, Phase 270) — production readiness is now vacuous", () => {
  it("production config validation no longer requires any email variable", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/deployment/production-config.ts"),
      "utf8",
    );
    // No inventory entry, no requiredInProduction for the retired names.
    expect(src).not.toContain('"XSTARZ_EMAIL_TRANSPORT"');
    expect(src).not.toContain('"XSTARZ_EMAIL_API_KEY"');
    expect(src).not.toContain('"XSTARZ_EMAIL_SENDER_ADDRESS"');
    // The retirement must be recorded in the module itself.
    expect(src).toContain("Phase 270");
  });

  it("the OTP security policy section is gone with the capability it governed", () => {
    // 10-minute expiry, failed-attempt limits, template hygiene: all of it
    // applied to a flow that no longer exists. The auth surface carries no
    // OTP vocabulary.
    const auth = readFileSync(resolve(process.cwd(), "src/convex/auth.ts"), "utf8");
    expect(auth).not.toContain("OTP_EXPIRY_MINUTES");
    expect(auth).toMatch(/providers:\s*\[\s*Anonymous\s*,\s*googleProvider\s*\]/);
  });

  it("the runbook and checklist documents are marked retired, not quietly stale", () => {
    for (const doc of [
      "docs/PRODUCTION-EMAIL-SETUP.md",
      "docs/production-launch-gate.md",
      "docs/production-activation-checklist.md",
      "docs/AUTHENTICATION.md",
    ]) {
      expect(readFileSync(resolve(process.cwd(), doc), "utf8")).toMatch(/RETIRED.{0,40}Phase 270/i);
    }
  });
});
