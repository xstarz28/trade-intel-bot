/**
 * Phase 217 — the Evidence-D closure must hold.
 *
 * Repository-side Evidence-D work stopped at an external provisioning
 * boundary: the DEV deployment has no email transport, API key or sender
 * address, so no OTP can be delivered and D1 cannot be executed.
 *
 * These guards exist because the recorded outcome is the kind that decays
 * quietly. They fail if:
 *
 *   - D1 is recorded as anything other than BLOCKED,
 *   - Evidence D is described as complete,
 *   - D5/D7/D8 lose their MARKET_CONDITION qualifier,
 *   - the blocker is reframed as a code defect,
 *   - the Phase 184 credential is implied to be resolved,
 *   - or the fail-closed behaviour this record depends on is weakened.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FORBIDDEN_DELIVERY_HOSTS } from "@/convex/lib/issuerPolicy";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const uat = read("docs/UAT-MATRIX.md");
/** Collapse newlines so wrapped prose still matches a single-line phrase. */
const flat = (t: string) => t.replace(/\s+/g, " ");
const gate = read("docs/RELEASE-GATE.md");

/** The exact operator-confirmed DEV environment. */
const CONFIRMED_DEV_ENV: Record<string, string> = {
  XSTARZ_DEPLOYMENT_ENV: "development",
  SITE_URL: "https://example-dev.test",
};

describe("Phase 217 — D1 is retired, not just blocked (Phase 270)", () => {
  it("the module that would have read email configuration no longer exists", () => {
    // The original closure assertion: with no transport/key/sender,
    // readEmailDeliveryConfig refused with `not_configured`, so D1 never ran.
    // Post-retirement the refusal is total: the code path itself is gone.
    expect(existsSync(join(process.cwd(), "src/convex/lib/emailDelivery.ts"))).toBe(false);
  });

  it("the harness records D1 as NOT_VERIFIED with retirement as the reason", () => {
    const harness = read("scripts/evidence-d-harness.mjs");
    expect(harness).toContain("RETIRED (Phase 270)");
    expect(harness).not.toContain('--auth otp|anonymous');
    expect(harness).toMatch(/if \(authMode !== "anonymous"\)/);
  });

  it("the EVIDENCE-D doc marks D1 retired with the mechanism", () => {
    const doc = read("docs/EVIDENCE-D.md");
    expect(doc).toMatch(/D1.*RETIRED \(Phase 270\)/);
  });
});

describe("Phase 217 — the recorded closure states the truth", () => {
  const section = uat.slice(uat.indexOf("## 35t."), uat.indexOf("## 36."));

  it("records the section", () => {
    expect(uat).toContain("## 35t. Phase 217");
    expect(section.length).toBeGreaterThan(500);
  });

  it("records D1 as BLOCKED and never as PASS or VERIFIED", () => {
    expect(section).toMatch(/D1 = BLOCKED|D1 \| \*\*BLOCKED\*\*/);
    const d1Row = section
      .split("\n")
      .find((l) => /^\|/.test(l.trim()) && l.trim().split("|")[1]?.trim() === "D1");
    expect(d1Row).toBeTruthy();
    expect(d1Row).toContain("BLOCKED");
    expect(d1Row).not.toMatch(/\bPASS\b/);
    expect(section).not.toMatch(/D1 (is|=) (VERIFIED|PASS)/i);
  });

  it("states that no mailbox delivery and no OTP session occurred", () => {
    expect(flat(section)).toMatch(/No OTP mailbox delivery occurred/i);
    expect(flat(section)).toMatch(/no OTP-authenticated session was created/i);
  });

  it("keeps Evidence D explicitly INCOMPLETE", () => {
    expect(flat(section)).toMatch(/Evidence D remains explicitly INCOMPLETE/i);
    expect(flat(section)).not.toMatch(/Evidence D (is )?(now )?COMPLETE\b/i);
    expect(section).toContain("productionEvidence:false");
  });

  it("keeps the MARKET_CONDITION qualifier on D5, D7 and D8", () => {
    const row = section
      .split("\n")
      .find((l) => l.includes("D5, D7, D8") || l.includes("D5, D7 and D8"));
    expect(row, "D5/D7/D8 must be recorded together").toBeTruthy();
    expect(row).toContain("MARKET_CONDITION");
    expect(row).not.toMatch(/\bPASS\b/);
  });

  it("frames the blocker as external provisioning, not a code defect", () => {
    expect(flat(section)).toMatch(/external provisioning blocker, not a code defect/i);
    for (const requirement of [
      "domain controlled by Xstarz",
      "Resend",
      "SMTP2GO",
      "SPF, DKIM and DMARC",
      "real mailbox",
    ]) {
      expect(section, `must list prerequisite: ${requirement}`).toContain(requirement);
    }
  });

  it("warns that the API key must never be written down", () => {
    expect(flat(section)).toMatch(
      /never be placed in source control, documentation, evidence artefacts, screenshots, or terminal output/i,
    );
  });

  it("declares the stopping point and forbids re-inspection phases", () => {
    expect(flat(section)).toMatch(/end of repository-side Evidence-D work/i);
    expect(flat(section)).toMatch(/No further phase may re-inspect/i);
  });
});

describe("Phase 217 — the release gate stays honest", () => {
  it("corrects the Auth row to the confirmed DEV finding", () => {
    const row = gate.split("\n").find((l) => l.startsWith("| Auth |"));
    expect(row).toBeTruthy();
    expect(row).toContain("BLOCKED");
    expect(row).toMatch(/no\*\* email transport|no email transport/i);
  });

  it("does not claim Phase 184 is resolved", () => {
    const section = gate.slice(gate.indexOf("## Phase 217"));
    const phase217 = section.slice(0, section.indexOf("## Phase 186"));
    expect(phase217).toMatch(/Phase 184 is \*\*not\*\* resolved/i);
    expect(phase217).toMatch(/401\/403/);
    expect(phase217).not.toMatch(/Phase 184 (is )?(now )?(resolved|closed|complete)/i);
  });

  it("keeps Evidence D partial and DEV-only in the matrix", () => {
    const row = gate.split("\n").find((l) => l.startsWith("| Evidence D |"));
    expect(row).toContain("PARTIAL (DEV only)");
  });
});
