/**
 * A2 authorization after the A1 compensating-controls path.
 *
 * Pins the runbook restatement: §2 may be satisfied by issuer 401/403 (Path R)
 * or by a valid owner A1 compensating-controls filing that does not claim
 * revocation (Path C). Neither path is recorded on this tree. This suite does
 * not execute the rewrite, does not file the owner JSON, and does not mark A2
 * verified.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { A1_COMPENSATING_PROOF_PATH } from "./a1-compensating-controls";
import {
  AFFECTED_REF_EXPECTATIONS,
  A2_REQUIREMENTS,
  EXPOSED_CREDENTIAL,
} from "./remediation-manifest";
import { deriveCurrentReleaseState, PROOF_PATHS } from "./release-current-state";
import { RELEASE_PREREQUISITES, verifyingSourcesFor } from "./release-gate";
import { parseRewriteCoverage } from "./runbook-ref-facts";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const runbook = read("docs/SECRET-REMEDIATION-RUNBOOK.md");
const gate = read("docs/RELEASE-GATE.md");
const inventory = JSON.parse(read("docs/secret-remediation-refs.json")) as {
  carrierCommits: number;
  refs: { ref: string; affected: boolean; carrierCommits: number; exposedAtTip: boolean }[];
};

const GITHUB_PULL_REFS = [
  "refs/pull/1/head",
  "refs/pull/2/head",
  "refs/pull/2/merge",
  "refs/pull/3/head",
  "refs/pull/3/merge",
  "refs/pull/4/head",
  "refs/pull/4/merge",
] as const;

const REWRITEABLE_REFS = AFFECTED_REF_EXPECTATIONS.map((entry) => entry.ref);

describe("A2 authorization — §2 paths", () => {
  it("names Path R (issuer 401/403) and Path C (compensating-controls, not revocation)", () => {
    expect(runbook).toMatch(/Path R — issuer revocation/);
    expect(runbook).toMatch(/Path C — owner compensating-controls/);
    expect(runbook).toMatch(/does \*\*not\*\* claim revocation/);
    expect(runbook).toMatch(/`revocationClaimed: false`/);
    expect(runbook).toMatch(/Path C is not a\n401\/403/);
    expect(gate).toMatch(/owner-filed `a1\.compensating-controls\/v1` with `revocationClaimed: false`/);
  });

  it("does not treat Path C as issuer revocation or as A2 verification", () => {
    expect(runbook).toMatch(/Path C does not mark `A2_HISTORY_REWRITE` verified/);
    expect(runbook).toMatch(/Path C does not make it dead/);
    expect(runbook).not.toMatch(/revocationClaimed:\s*true/);
    expect(gate).toMatch(/issuer revocation, an exemption, this tooling filing the file/);
  });

  it("stays BLOCKED on §2 because neither path is recorded on this tree", () => {
    expect(runbook).toMatch(/Today \*\*neither path is recorded\*\*\. Status remains \*\*BLOCKED on §2\*\*/);
    expect(runbook).toMatch(/Status remains \*\*BLOCKED on §2\*\*/);
    expect(existsSync(resolve(root, A1_COMPENSATING_PROOF_PATH))).toBe(false);
    expect(existsSync(resolve(root, PROOF_PATHS.a1Revocation))).toBe(false);
    expect(existsSync(resolve(root, "docs/remediation"))).toBe(false);
  });

  it("does not start §3, force-push, or touch main from this tooling", () => {
    expect(runbook).toMatch(/This tooling does not start §3, does not force-push, and does not touch\n`main`/);
    expect(gate).toMatch(/This tooling does not start §3, does not force-push, and does not touch `main`/);
    expect(parseRewriteCoverage(runbook).find((row) => row.ref === "heads/main")?.before).toMatch(
      /51c9ddeb/,
    );
  });
});

describe("A2 authorization — rewriteable vs GitHub-managed refs", () => {
  it("keeps the nine rewriteable refs and 270 carriers", () => {
    expect(REWRITEABLE_REFS).toHaveLength(9);
    expect(inventory.refs.map((entry) => entry.ref)).toEqual(REWRITEABLE_REFS);
    expect(inventory.refs.every((entry) => entry.affected)).toBe(true);
    expect(inventory.carrierCommits).toBe(270);
    expect(EXPOSED_CREDENTIAL.carrierCommits).toBe(270);
    expect(parseRewriteCoverage(runbook).map((row) => row.ref)).toEqual(REWRITEABLE_REFS);
  });

  it("names the seven GitHub-managed pull refs that ordinary git cannot rewrite", () => {
    for (const ref of GITHUB_PULL_REFS) {
      expect(runbook, ref).toContain(ref.replace(/^refs\//, ""));
      expect(gate, ref).toContain(ref);
    }
    expect(runbook).toMatch(/deny updating a hidden ref/);
    expect(runbook).toMatch(/GitHub Support must clear/);
    expect(gate).toMatch(/GitHub Support clearing/);
    expect(runbook).toMatch(
      /A2 cannot be considered verified while any affected PR ref still reaches the\n {3}credential/,
    );
  });

  it("does not shrink A2 post-rewrite evidence to heads and tags", () => {
    const post = A2_REQUIREMENTS.filter((entry) => entry.phase === "post").map((entry) => entry.id);
    expect(post).toEqual([
      "a2-post-zero-occurrences",
      "a2-post-per-ref-verification",
      "a2-post-history-consistency",
    ]);
    expect(A2_REQUIREMENTS.find((entry) => entry.id === "a2-post-zero-occurrences")?.description).toMatch(
      /every ref/,
    );
  });
});

describe("A2 authorization — gate not weakened", () => {
  it("A2 remains mandatory, production-only, affected-refs, external-verification only", () => {
    const a2 = RELEASE_PREREQUISITES.find((entry) => entry.id === "A2_HISTORY_REWRITE");
    expect(a2?.mandatory).toBe(true);
    expect(a2?.exemptible).toBe(false);
    expect(a2?.requiredEnvironment).toBe("production");
    expect(a2?.binding).toBe("affected-refs");
    expect(verifyingSourcesFor(a2!)).toEqual(["external-verification"]);
  });

  it("A1 stays UNVERIFIED and A2 stays UNVERIFIED on this tree", () => {
    const { verdict } = deriveCurrentReleaseState();
    expect(verdict.prerequisites.find((entry) => entry.id === "A1_OTP_ISSUER_REVOCATION")?.state).toBe(
      "UNVERIFIED",
    );
    expect(verdict.prerequisites.find((entry) => entry.id === "A2_HISTORY_REWRITE")?.state).toBe(
      "UNVERIFIED",
    );
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toEqual(
      expect.arrayContaining(["A1_OTP_ISSUER_REVOCATION", "A2_HISTORY_REWRITE"]),
    );
  });

  it("Phase 221's 14-step order is still revoke → 401/403 → rewrite", () => {
    const p221 = gate.slice(gate.indexOf("## Phase 221"));
    const orderStart = p221.indexOf("### Release order");
    const orderEnd = p221.indexOf("\n### ", orderStart + 1);
    const steps = p221
      .slice(orderStart, orderEnd === -1 ? undefined : orderEnd)
      .split("\n")
      .filter((line) => /^\d+\. /.test(line))
      .map((line) => line.replace(/^\d+\. /, ""));
    expect(steps).toHaveLength(14);
    expect(steps[0]).toMatch(/^Revoke the old Freebuff/);
    expect(steps[1]).toMatch(/401\/403/);
    expect(steps[2]).toMatch(/rehearsed rewrite/);
  });
});
