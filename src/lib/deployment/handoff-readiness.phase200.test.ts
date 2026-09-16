/**
 * Phase 200 — the deployment handoff must stay executable and fail-closed.
 *
 * Two scripts are the handoff: the control-plane diagnostic and the Evidence D
 * harness. Both are run by a human, later, in an environment nobody here can
 * see. The risk is therefore not that they fail — it is that they *succeed
 * wrongly*: report auth conclusions from a dead network, or produce Evidence D
 * from a substitute backend.
 *
 * These tests pin the refusals, because the refusals are the product.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const ACCESS = join(root, "scripts/verify-convex-access.mjs");
const HARNESS = join(root, "scripts/evidence-d-harness.mjs");
const HANDOFF_DOC = join(root, "docs/DEPLOYMENT-HANDOFF.md");

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runScript(script: string, env: Record<string, string>, argv: string[] = []): Run {
  try {
    const stdout = execFileSync(process.execPath, [script, ...argv], {
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
      cwd: root,
      timeout: 120_000,
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { exitCode: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("Phase 200 — handoff artifacts exist and are wired", () => {
  it("both scripts and the handoff document are present", () => {
    expect(existsSync(ACCESS), "verify-convex-access.mjs missing").toBe(true);
    expect(existsSync(HARNESS), "evidence-d-harness.mjs missing").toBe(true);
    expect(existsSync(HANDOFF_DOC), "DEPLOYMENT-HANDOFF.md missing").toBe(true);
  });

  it("the handoff document keeps the steps in dependency-safe order", () => {
    const doc = readFileSync(HANDOFF_DOC, "utf8");
    const order = ["### A.", "### B.", "### C.", "### D.", "### E.", "### F.", "### G.", "### H."];
    let cursor = -1;
    for (const marker of order) {
      const at = doc.indexOf(marker);
      expect(at, `${marker} missing from the handoff`).toBeGreaterThan(-1);
      expect(at, `${marker} is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("records the exact deployment baseline commit", () => {
    const doc = readFileSync(HANDOFF_DOC, "utf8");
    expect(doc).toMatch(/Deployment baseline: `[0-9a-f]{7,40}`/);
  });
});

describe("Phase 200 — the control-plane diagnostic never infers authentication", () => {
  it("classifies an unreachable control plane as transport, not auth", () => {
    const run = runScript(ACCESS, {}, ["--json"]);
    // Exit 2 = not reachable. Exit 0/1 would mean the network opened up, in
    // which case this assertion should be revisited deliberately.
    expect(run.exitCode).toBe(2);
    const report = JSON.parse(run.stdout);
    expect(report.verdict.state).toBe("NOT_REACHABLE");
    expect(report.verdict.isAuthEvidence).toBe(false);
    expect(report.verdict.isRevocationEvidence).toBe(false);
  });

  it("identifies the exact layer that fails, not just 'it failed'", () => {
    const run = runScript(ACCESS, {}, ["--json"]);
    const report = JSON.parse(run.stdout);
    expect(["dns", "tcp", "tls", "http"]).toContain(report.verdict.blockedAt);
    // DNS and TCP currently succeed; the block is at TLS. If that changes the
    // diagnostic should say so rather than silently reporting the same verdict.
    const layers = report.layers as Array<{ layer: string; status: string }>;
    expect(layers.some((l) => l.layer === "dns" && l.status === "PASS")).toBe(true);
  });

  it("refuses to treat a transport failure as a rejected credential", () => {
    const run = runScript(ACCESS, { CONVEX_DEPLOY_KEY: "unused-because-unreachable" }, ["--json"]);
    const report = JSON.parse(run.stdout);
    // A key is present, the network is not. The verdict must still be about
    // the network — otherwise a blocked egress would look like a bad key.
    expect(report.verdict.state).toBe("NOT_REACHABLE");
    expect(report.verdict.isAuthEvidence).toBe(false);
  });

  it("never prints a credential value, only presence and a fingerprint", () => {
    const secret = ["convex", "deploy", "key", "sentinel", "9137"].join("-");
    const run = runScript(ACCESS, { CONVEX_DEPLOY_KEY: secret }, ["--json"]);
    expect(run.stdout).not.toContain(secret);
    expect(run.stderr).not.toContain(secret);
    const report = JSON.parse(run.stdout);
    expect(report.credentials.deployKeyPresent).toBe(true);
    expect(report.credentials.deployKeyFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("probes the deployment domain family, not just the control plane", () => {
    // Phase 201: *.convex.cloud (Evidence D) and *.convex.site (auth issuer)
    // are a SEPARATE allowlist entry from *.convex.dev. Allowlisting only the
    // control plane lets this gate pass while Evidence D remains impossible.
    const run = runScript(ACCESS, {}, ["--json"]);
    const report = JSON.parse(run.stdout);
    const layers = report.layers as Array<{ layer: string; host: string }>;
    const planeHosts = layers.filter((l) => l.layer === "deployment-plane").map((l) => l.host);
    expect(planeHosts.some((h) => h.endsWith(".convex.cloud"))).toBe(true);
    expect(planeHosts.some((h) => h.endsWith(".convex.site"))).toBe(true);
  });

  it("defines a distinct verdict for control-plane-only reachability", () => {
    // The dangerous middle state must not be reported as success.
    const source = readFileSync(ACCESS, "utf8");
    expect(source).toContain("CONTROL_PLANE_ONLY");
    expect(source).toMatch(/deployment would succeed while Evidence D could never run/i);
  });

  it("reports same-network controls so a block can be distinguished from an outage", () => {
    const run = runScript(ACCESS, {}, ["--json"]);
    const report = JSON.parse(run.stdout);
    const controls = (report.layers as Array<{ layer: string }>).filter((l) => l.layer === "control");
    expect(controls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Phase 200 — the Evidence D harness cannot be satisfied by a substitute", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["no deployment configured", {}],
    ["localhost", { VITE_CONVEX_URL: "http://localhost:3210", EVIDENCE_D_EMAIL: "a@b.co" }],
    ["127.0.0.1", { VITE_CONVEX_URL: "http://127.0.0.1:3210", EVIDENCE_D_EMAIL: "a@b.co" }],
    ["plain http", { VITE_CONVEX_URL: "http://x.convex.cloud", EVIDENCE_D_EMAIL: "a@b.co" }],
    [
      "a non-Convex host",
      { VITE_CONVEX_URL: "https://evil.example.com", EVIDENCE_D_EMAIL: "a@b.co" },
    ],
    ["no mailbox", { VITE_CONVEX_URL: "https://demo.convex.cloud" }],
  ];

  for (const [name, env] of cases) {
    it(`refuses to run against ${name}`, () => {
      const run = runScript(HARNESS, env, ["--json"]);
      expect(run.exitCode, `${name} must not produce a runnable harness`).toBe(2);
      const report = JSON.parse(run.stdout);
      expect(report.evidenceD).toBe("NOT EXECUTED");
    });
  }

  it("a refusal marks every one of D1–D10 BLOCKED and none PASS", () => {
    const run = runScript(
      HARNESS,
      { VITE_CONVEX_URL: "http://localhost:3210", EVIDENCE_D_EMAIL: "a@b.co" },
      ["--json"],
    );
    const report = JSON.parse(run.stdout);
    const statuses = (report.checks as Array<{ status: string }>).map((c) => c.status);
    expect(statuses).toHaveLength(10);
    expect(statuses.filter((s) => s === "PASS")).toHaveLength(0);
    expect(statuses.every((s) => s === "BLOCKED")).toBe(true);
  });

  it("covers exactly the ten defined observations, in order", () => {
    const run = runScript(HARNESS, {}, ["--json"]);
    const report = JSON.parse(run.stdout);
    const ids = (report.checks as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"]);
  });

  it("treats D1 as human-attested rather than inferring delivery from a 200", () => {
    const source = readFileSync(HARNESS, "utf8");
    expect(source).toMatch(/not delivery/i);
    expect(source).toMatch(/HUMAN-attested|humanAttested/);
  });

  it("never reports Evidence D as achieved while any check is blocked", () => {
    // Behavioural, not a source-string match: a refused run has ten BLOCKED
    // checks, so if "ACHIEVED" were ever reachable with blockers present this
    // would catch it. Phase 203 widened the rule to NOT_VERIFIED as well, and
    // a regex pinned to the old expression would have failed on a strictly
    // stronger implementation.
    const run = runScript(
      HARNESS,
      { VITE_CONVEX_URL: "http://localhost:3210", EVIDENCE_D_EMAIL: "a@b.co" },
      ["--json"],
    );
    const report = JSON.parse(run.stdout);
    expect(report.evidenceD).not.toBe("ACHIEVED");
    expect(run.exitCode).not.toBe(0);
  });
});
