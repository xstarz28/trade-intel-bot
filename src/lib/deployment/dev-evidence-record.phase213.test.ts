/**
 * Phase 213 — guards over the recorded DEV evidence.
 *
 * The first real DEV run produced D10 PASS against a live OKX order book. That
 * is a genuine result and it is recorded as such. These tests exist so the
 * record cannot quietly drift into claiming more than it proved:
 *
 *   - DEV evidence must never be relabelled production evidence,
 *   - D1/D5/D7/D8 must never be recorded PASS,
 *   - the D10 PASS gate must keep rejecting a local clock, a future stamp and
 *     a cache read relabelled as an observation,
 *   - the stopping rule that prevents endless repeat-sweep phases must survive.
 *
 * They read the real documents and the real harness/provider source. Nothing
 * here mocks the deployment, and nothing here can turn a market-limited row
 * into a pass.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const uat = read("docs/UAT-MATRIX.md");
const gate = read("docs/RELEASE-GATE.md");
const harness = read("scripts/evidence-d-harness.mjs");
const okx = read("src/convex/okx.ts");
const executionQuality = read("src/lib/execution-quality.ts");

describe("Phase 213 — the DEV run is recorded, and recorded honestly", () => {
  it("records the run under an explicitly non-production classification", () => {
    expect(uat).toContain("## 35o. Phase 213");
    expect(uat).toContain("DEV_VERIFIED — NOT PRODUCTION EVIDENCE");
    expect(uat).toContain("`productionEvidence` | **false**");
  });

  it("never claims production evidence anywhere in the recorded section", () => {
    // P2: the highest-consequence drift is relabelling a DEV run as production
    // evidence. Asserting the honest string is PRESENT does not stop a
    // contradicting claim being ADDED, so assert the contradiction is absent.
    // Scan the WHOLE document: a slice anchored on the section header can be
    // escaped by a mutation that edits the header line itself.
    for (const forbidden of [
      "PRODUCTION EVIDENCE VERIFIED",
      "production evidence verified",
      "`productionEvidence` | **true**",
      "PRODUCTION_VERIFIED",
    ]) {
      expect(uat, `DEV record must not claim: ${forbidden}`).not.toContain(forbidden);
    }
    // The honest classification must still be present and unambiguous.
    expect(uat).toContain("DEV_VERIFIED — NOT PRODUCTION EVIDENCE");
    expect(uat).not.toMatch(/\bis production evidence\b/i);
    // Scoped to the Phase 213 record: the flag must be reported false there.
    const record = uat.slice(uat.indexOf("## 35o."), uat.indexOf("## 35p."));
    expect(record).not.toContain("productionEvidence: true");
  });

  it("names the deployment identity, environment and evidence basis", () => {
    expect(uat).toContain("tough-goose-455.convex.cloud");
    expect(uat).toContain("development");
    expect(uat).toMatch(/exchange `ts`/);
    expect(uat).toContain("BTC-USDT-SWAP");
  });

  it("does not record D1, D5, D7 or D8 as PASS", () => {
    const section = uat.slice(uat.indexOf("## 35o."), uat.indexOf("## 35p."));
    for (const row of ["D1", "D5", "D7", "D8"]) {
      const line = section
        .split("\n")
        .find((l) => /^\|/.test(l.trim()) && l.trim().split("|")[1]?.trim() === row);
      expect(line, `${row} must appear in the recorded table`).toBeTruthy();
      // Assert on the STATUS cell specifically: "PASS" must not appear there in
      // any form, bolded or not.
      const status = line!.split("|")[2]?.trim() ?? "";
      expect(status, `${row} status cell must not claim PASS`).not.toMatch(/PASS/i);
      expect(status.length, `${row} must have a status`).toBeGreaterThan(0);
    }
  });

  it("records D5/D7/D8 with the market-condition qualifier, not a bare NOT_VERIFIED", () => {
    // Scoped to the Phase 213 record: the qualifier appears elsewhere too, so a
    // global assertion would survive this section losing it.
    const record = uat.slice(uat.indexOf("## 35o."), uat.indexOf("## 35p."));
    for (const row of ["D5", "D7", "D8"]) {
      const line = record
        .split("\n")
        .find((l) => /^\|/.test(l.trim()) && l.trim().split("|")[1]?.trim() === row);
      expect(line, `${row} must be recorded`).toBeTruthy();
      expect(line, `${row} must carry the MARKET_CONDITION qualifier`).toContain(
        "MARKET_CONDITION",
      );
    }
  });

  it("keeps the E-track separate from D5/D7/D8", () => {
    // E1-E7 take `recommendation` as an argument, so they can never evidence
    // that the engine decided chargeability on its own.
    expect(uat).toMatch(/E-track takes `recommendation` as an argument|takes `recommendation` as an argument/);
  });

  it("preserves the caveat that the JSON artefact was not attached", () => {
    expect(uat).toMatch(/was \*\*not\*\* attached|not attached to the repository/);
  });
});

describe("Phase 213 — the D10 PASS gate still cannot be satisfied by a fake timestamp", () => {
  it("rejects a payload with no exchange ts at the parser", () => {
    expect(executionQuality).toContain("missing/invalid exchange timestamp (ts)");
  });

  it("derives observedAt from the exchange ts, never from the local clock", () => {
    // snapshotTs IS the parsed e.ts; observedAt is set from snapshotTs only.
    expect(okx).toMatch(/observedAt: snapshotTs/);
    expect(okx).not.toMatch(/observedAt: Date\.now\(\)\s*,?\s*\}\s*as \{ success: boolean; data: ExecutionData/);
  });

  it("fails D10 when observedAt is indistinguishable from the request clock", () => {
    expect(harness).toContain("looksLikeLocalClock");
    expect(harness).toMatch(/Math\.abs\(observedAt - chosen\.startedAt\) < 2/);
  });

  it("fails D10 on a future timestamp", () => {
    expect(harness).toMatch(/observedAt > chosen\.finishedAt \+ 5_000/);
  });

  it("fails D10 when a cache read is relabelled as an observation", () => {
    expect(harness).toMatch(/acquisition === "cache-reused" && observedAt >= chosen\.startedAt/);
  });

  it("blocks rather than passes when no provider supplies a timestamp", () => {
    expect(harness).toMatch(/if \(observedAt === null\) \{[\s\S]{0,200}"D10",\s*\n?\s*"BLOCKED"/);
  });
});

describe("Phase 213 — the stopping rule prevents endless repeat-sweep phases", () => {
  it("states the rule and its permitted triggers", () => {
    expect(uat).toContain("## 35p. Stopping rule");
    expect(uat).toMatch(/must \*\*not\*\* create further phases whose only\s*\n?content is re-running the sweep/);
    expect(uat).toContain("Permitted triggers");
  });

  it("enumerates every forbidden way to manufacture a chargeable signal", () => {
    const section = uat.slice(uat.indexOf("## 35p."), uat.indexOf("## 36."));
    for (const forbidden of [
      "hardcoded instrument whitelist",
      "symbol substitution",
      "forcing or injecting a recommendation",
      "moving a threshold",
      "fabricating provider data",
    ]) {
      expect(section, `stopping rule must forbid: ${forbidden}`).toContain(forbidden);
    }
  });

  it("keeps the sweep restricted to discovery-derived live instruments", () => {
    // The only legitimate expansion: no whitelist, provider-native id verbatim.
    expect(harness).toMatch(/\(i\.state \?\? "live"\) === "live"/);
    expect(harness).toMatch(/instId/);
  });
});

describe("Phase 213 — the release gate does not overstate the DEV result", () => {
  it("marks Evidence D as partial and DEV-only, not PASS", () => {
    const row = gate.split("\n").find((l) => l.startsWith("| Evidence D |"));
    expect(row).toBeTruthy();
    expect(row).toContain("PARTIAL (DEV only)");
    expect(row).not.toMatch(/\|\s*\*\*PASS\*\*\s*\|/);
  });

  it("separates DEV provider reachability from production provider readiness", () => {
    expect(gate).toContain("## Phase 213");
    expect(gate).toContain("Production live-provider credentials");
    expect(gate).toContain("Production Convex deployment");
  });

  it("keeps the overall decision NOT READY in the Phase 213 section itself", () => {
    // Scoped: the document contains several NOT READY strings, so a global
    // toContain would stay green even if THIS section flipped to READY.
    const section = gate.slice(gate.indexOf("## Phase 213"));
    const phase213 = section.slice(0, section.indexOf("## Phase 186"));
    expect(phase213).toContain("**Release decision: NOT READY.**");
    expect(phase213).not.toMatch(/\*\*Release decision: READY\.\*\*/);
  });

  it("still lists every outstanding external blocker", () => {
    for (const blocker of [
      "OTP credential rotation",
      "Production Convex deployment",
      "Deploy credential",
      "Email account + verified domain",
      "SPF/DKIM/DMARC",
      "Live provider keys",
      "Mobile signing material",
    ]) {
      expect(gate, `blocker must remain listed: ${blocker}`).toContain(blocker);
    }
  });

  it("spells out all four D1 requirements without allowing a simulated one", () => {
    expect(gate).toContain("A real OTP transport");
    expect(gate).toContain("A verified sender domain");
    expect(gate).toContain("Actual mailbox delivery");
    expect(gate).toContain("An authenticated OTP session");
    expect(gate).toMatch(/`console` is not evidence/);
  });
});
