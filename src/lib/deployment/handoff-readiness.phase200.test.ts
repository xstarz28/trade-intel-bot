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
// Typed via scripts/lib/convex-access-verdict.d.mts — no `any` cast.
import {
  EXIT_CODES,
  TRANSPORT_LAYERS,
  computeVerdict,
  validateVerdict,
} from "../../../scripts/lib/convex-access-verdict.mjs";

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

/**
 * Phase 234 — these assertions no longer pin the runner's network state.
 *
 * They previously required `NOT_REACHABLE` / a transport `blockedAt`, which is
 * a statement about the MACHINE, not the program: it held in the sandbox
 * (egress blocked at TLS) and failed on any networked CI runner, where the
 * same probe legitimately reaches the control plane and reports
 * `CREDENTIALS_REJECTED`. A green local run therefore proved nothing about the
 * property under test — the same failure shape as the phase75 suite.
 *
 * The property is now asserted directly, and it holds in BOTH environments:
 * reachability may never be reported as authentication evidence, and no
 * credential verdict may be emitted unless the service was actually reached
 * and answered. The deterministic proof of that rule lives in
 * `convex-access-verdict.phase234.test.ts`, which drives every network outcome
 * from fixtures — including ones this machine cannot produce. These tests
 * cross-check the REAL probe against the same contract.
 */
describe("Phase 200 — the control-plane diagnostic never infers authentication", () => {
  interface Report {
    primaryHost: string;
    reachable: boolean;
    verdict: {
      state: string;
      blockedAt: string | null;
      classification: string;
      isAuthEvidence: boolean;
      isRevocationEvidence: boolean;
    };
    layers: Array<{ layer: string; host: string; status: string; detail: string }>;
  }

  const runReport = (env: Record<string, string>): { run: Run; report: Report } => {
    const run = runScript(ACCESS, env, ["--json"]);
    return { run, report: JSON.parse(run.stdout) as Report };
  };

  const passed = (report: Report, layer: string) =>
    report.layers.some(
      (l) => l.layer === layer && l.host === report.primaryHost && l.status === "PASS",
    );

  it("emits a verdict that conforms to the contract, in whatever network this is", () => {
    const { run, report } = runReport({});
    // Runs in every environment, so it cannot be satisfied by pinning one.
    expect(validateVerdict(report.verdict, { reachable: report.reachable })).toEqual([]);
    expect(report.verdict.isRevocationEvidence).toBe(false);
    expect(run.exitCode).toBe(EXIT_CODES[report.verdict.state as keyof typeof EXIT_CODES]);
  });

  it("reports an unreachable control plane as transport, never as auth", () => {
    const { run, report } = runReport({});
    if (report.reachable) return; // the other branch below covers this environment
    expect(report.verdict.state).toBe("NOT_REACHABLE");
    expect(report.verdict.isAuthEvidence).toBe(false);
    expect(report.verdict.isRevocationEvidence).toBe(false);
    expect(run.exitCode).toBe(2);
    expect(TRANSPORT_LAYERS).toContain(report.verdict.blockedAt);
  });

  it("names the exact layer where transport stopped, and only the first", () => {
    const { report } = runReport({});
    if (report.reachable) return;
    const index = TRANSPORT_LAYERS.indexOf(report.verdict.blockedAt as never);
    expect(index, "blockedAt must be a real transport layer").toBeGreaterThanOrEqual(0);
    // Every layer before the failing one must have genuinely passed — a
    // "blocked at tls" claim with DNS failing above it would be a lie.
    for (const layer of TRANSPORT_LAYERS.slice(0, index)) {
      expect(passed(report, layer), `${layer} should have passed before ${report.verdict.blockedAt}`).toBe(true);
    }
    expect(
      report.layers.some((l) => l.layer === report.verdict.blockedAt && l.status === "FAIL"),
      "the named layer must actually have failed",
    ).toBe(true);
  });

  it("claims auth evidence only when the control plane actually answered", () => {
    const { report } = runReport({ CONVEX_DEPLOY_KEY: "unused-because-unreachable" });
    // The load-bearing direction: a blocked egress must never look like a bad key.
    if (!report.verdict.isAuthEvidence) {
      expect(report.verdict.state).not.toBe("CREDENTIALS_REJECTED");
      return;
    }
    expect(report.reachable).toBe(true);
    for (const layer of TRANSPORT_LAYERS) {
      expect(passed(report, layer), `${layer} must pass before any auth verdict`).toBe(true);
    }
  });

  it("refuses to treat a transport failure as a rejected credential", () => {
    const { report } = runReport({ CONVEX_DEPLOY_KEY: "unused-because-unreachable" });
    if (report.reachable) {
      // Reached: a rejection is now legitimate — but only because the service
      // answered, which is what makes this an auth verdict at all.
      expect(report.verdict.blockedAt === "auth" || report.verdict.blockedAt === null).toBe(true);
      expect(["CREDENTIALS_REJECTED", "AUTH_INDETERMINATE", "AUTHENTICATED", "CONTROL_PLANE_ONLY", "UNAUTHENTICATED"]).toContain(
        report.verdict.state,
      );
      return;
    }
    expect(report.verdict.state).toBe("NOT_REACHABLE");
    expect(report.verdict.isAuthEvidence).toBe(false);
  });

  it("records both the network stage and the auth stage, whatever the network did", () => {
    const { report } = runReport({});
    // The network stage is always probed, starting at DNS for the primary host.
    expect(
      report.layers.some((l) => l.layer === "dns" && l.host === report.primaryHost),
      "the DNS layer must always be recorded",
    ).toBe(true);
    if (report.reachable) {
      for (const layer of TRANSPORT_LAYERS) {
        expect(passed(report, layer), `${layer} must be recorded once the plane is reached`).toBe(true);
      }
    }
    // The auth stage is recorded even when it was not attempted. Omitting it
    // would make a skipped credential check invisible in the report — and
    // "not attempted" is exactly the case a reader must be able to see.
    const auth = report.layers.filter((l) => l.layer === "auth");
    expect(auth, "the auth stage must be recorded exactly once").toHaveLength(1);
    expect(auth[0].host).toBe(report.primaryHost);
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
    // The dangerous middle state must not be reported as success. Phase 234
    // moved the classification out of the script into a pure function, so this
    // asserts the RULE rather than grepping for its wording in a file it no
    // longer lives in. The exhaustive outcome matrix is in
    // convex-access-verdict.phase234.test.ts.
    const host = "api.convex.dev";
    const { verdict, exitCode } = computeVerdict({
      layers: TRANSPORT_LAYERS.map((layer) => ({
        layer,
        host,
        status: "PASS",
        detail: "fixture",
      })),
      primaryHost: host,
      reachable: true,
      authState: "authenticated",
      deploymentPlaneReachable: false,
    });
    expect(verdict.state).toBe("CONTROL_PLANE_ONLY");
    expect(verdict.blockedAt).toBe("deployment-plane");
    expect(exitCode).not.toBe(0);
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
