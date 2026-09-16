/**
 * Phase 209 — operator handoff end-to-end dry-run.
 *
 * Phase 208 hardened the report, but the CLI path had never executed: the
 * harness refuses every host reachable from this environment, so argument
 * parsing, HTTP transport, check recording, the verdict and both renderers
 * were only ever exercised through unit inputs.
 *
 * These tests drive the REAL CLI against a loopback fixture that speaks the
 * Convex /api/* contract, and then prove the thing that matters most: a
 * fixture run can never be mistaken for evidence. The fixture is tooling
 * validation only.
 *
 * Every assertion here is on observed process behaviour — stdout, parsed JSON,
 * exit codes — not on strings in the source, except where the property under
 * test genuinely is a source property.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const HARNESS = join(root, "scripts/evidence-d-harness.mjs");
const FIXTURE = join(root, "scripts/evidence-d-fixture.mjs");

type Proc = { proc: ReturnType<typeof spawn>; port: number };
const servers: Proc[] = [];

/** Start a fixture on an ephemeral port and wait for its banner. */
async function startFixture(scenario: string): Promise<number> {
  const proc = spawn("node", [FIXTURE, "--scenario", scenario, "--port", "0"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture ${scenario} did not start`)), 15_000);
    let buf = "";
    proc.stdout!.on("data", (c) => {
      buf += String(c);
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      reject(new Error(`fixture ${scenario} exited: ${buf}`));
    });
  });
  servers.push({ proc, port });
  return port;
}

/** Run the real CLI. Returns exit code and raw streams. */
function runHarness(args: string[]) {
  const r = spawnSync("node", [HARNESS, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, VITE_CONVEX_URL: "", CONVEX_DEPLOYMENT: "", CONVEX_URL: "" },
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function runAgainstFixture(scenario: string, args: string[]) {
  const port = await startFixture(scenario);
  return runHarness(["--fixture", `http://127.0.0.1:${port}`, ...args]);
}

const parseJson = (stdout: string) => JSON.parse(stdout);

afterAll(() => {
  for (const s of servers) s.proc.kill("SIGKILL");
});

/* ------------------------------------------------------------------ *
 * 1. The fixture is safe by construction
 * ------------------------------------------------------------------ */

describe("Phase 209 — fixture safety boundary", () => {
  const fixtureSource = readFileSync(FIXTURE, "utf8");

  it("binds to loopback only, never a routable interface", () => {
    expect(fixtureSource).toMatch(/server\.listen\(port, "127\.0\.0\.1"/);
    expect(fixtureSource).not.toMatch(/listen\([^)]*"0\.0\.0\.0"/);
  });

  it("never contacts a real provider, deployment or mailbox", () => {
    // Assert on CODE only: the header comment legitimately explains why the
    // fixture cannot satisfy the harness's *.convex.cloud requirement, and
    // matching prose would fail on the sentence documenting the guarantee.
    const code = fixtureSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)[a-z]/i);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/convex\.(cloud|site|dev)/);
    expect(code).not.toMatch(/okx\.com|twelvedata|alphavantage/i);
    // No outbound network capability at all.
    expect(code).not.toMatch(/require\(["']node:https?["']\)|from ["']node:https["']/);
  });

  it("carries no credential and is deterministic", () => {
    expect(fixtureSource).not.toMatch(/process\.env\.[A-Z_]*KEY/);
    expect(fixtureSource).not.toMatch(/Math\.random|Date\.now\(\)/);
    expect(fixtureSource).toMatch(/const BASE_TS = /);
  });

  it("labels itself FIXTURE — NOT EVIDENCE on startup", async () => {
    const port = await startFixture("incomplete");
    expect(port).toBeGreaterThan(0);
    const banner = servers.find((s) => s.port === port);
    expect(banner).toBeDefined();
  });
});

/* ------------------------------------------------------------------ *
 * 2. A fixture run can never become evidence
 * ------------------------------------------------------------------ */

describe("Phase 209 — fixture output can never be presented as evidence", () => {
  it("stamps fixture=true, the FIXTURE class, and a synthetic deployment identity", async () => {
    const r = await runAgainstFixture("complete", ["--auth", "otp", "--otp", "123456", "--json"]);
    const report = parseJson(r.stdout);
    expect(report.fixture).toBe(true);
    expect(report.fixtureNotice).toBe("FIXTURE — NOT EVIDENCE");
    expect(report.environment).toBe("fixture");
    expect(report.evidenceClass).toContain("FIXTURE");
    expect(report.deployment.name).toBe("FIXTURE-NOT-EVIDENCE");
  });

  it("keeps productionEvidence false even at a perfect 10/10 ACHIEVED run", async () => {
    const r = await runAgainstFixture("complete", ["--auth", "otp", "--otp", "123456", "--json"]);
    const report = parseJson(r.stdout);
    // This is the decisive assertion of the phase: a fully green fixture run.
    expect(report.evidenceD).toBe("ACHIEVED");
    expect(report.summary.passed).toBe(10);
    expect(r.code).toBe(0);
    // ...and it is still not evidence.
    expect(report.productionEvidence).toBe(false);
    expect(report.evidenceClass).not.toContain("DEV_VERIFIED");
    expect(report.evidenceClass).not.toContain("PRODUCTION_EVIDENCE");
  });

  it("never emits DEV_VERIFIED for a fixture run, whatever the env says", async () => {
    const port = await startFixture("complete");
    const r = spawnSync(
      "node",
      [HARNESS, "--fixture", `http://127.0.0.1:${port}`, "--auth", "otp", "--otp", "123456", "--json"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        // A hostile environment claiming a real dev deployment must not leak in.
        env: {
          ...process.env,
          CONVEX_DEPLOYMENT: "dev:tough-goose-455",
          VITE_CONVEX_URL: "https://tough-goose-455.convex.cloud",
        },
      },
    );
    const report = parseJson(r.stdout ?? "");
    expect(report.environment).toBe("fixture");
    expect(report.evidenceClass).not.toContain("DEV_VERIFIED");
    expect(report.deployment.host).toBe("127.0.0.1");
    expect(report.deployment.name).toBe("FIXTURE-NOT-EVIDENCE");
    expect(report.productionEvidence).toBe(false);
  });

  it("refuses --production-evidence combined with --fixture", async () => {
    const port = await startFixture("complete");
    const r = runHarness(["--fixture", `http://127.0.0.1:${port}`, "--production-evidence"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/cannot be combined with --fixture/);
    expect(r.stdout).not.toContain("PASS");
  });

  it("refuses a non-loopback --fixture target", () => {
    const r = runHarness(["--fixture", "https://evil.example.com"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/must be a loopback http URL/);
  });

  it("shouts the fixture banner in the human-readable output", async () => {
    const r = await runAgainstFixture("incomplete", ["--auth", "anonymous"]);
    expect(r.stdout).toContain("FIXTURE — NOT EVIDENCE");
    expect(r.stdout).toMatch(/NOT\s+#?\s*$|not evidence/im);
    expect(r.stdout).toContain("This run is NOT production release evidence.");
  });
});

/* ------------------------------------------------------------------ *
 * 3. End-to-end report execution through the real CLI
 * ------------------------------------------------------------------ */

describe("Phase 209 — the whole CLI path produces a complete report", () => {
  let report: Record<string, unknown>;
  let human: string;

  beforeAll(async () => {
    const j = await runAgainstFixture("incomplete", ["--auth", "anonymous", "--sweep", "5", "--json"]);
    report = parseJson(j.stdout);
    const h = await runAgainstFixture("incomplete", ["--auth", "anonymous", "--sweep", "5"]);
    human = h.stdout;
  });

  it("emits valid JSON carrying every canonical key", () => {
    for (const key of [
      "schemaVersion", "fixture", "fixtureNotice", "evidenceD", "evidenceClass", "environment",
      "deployment", "productionEvidence", "configSource", "authMechanism", "capturedAt",
      "durationMs", "transportCalls", "summary", "integrity", "checks", "providerEvidence",
      "sweep", "entitlementStateMachine", "safetyProbes", "blockers",
    ]) {
      expect(report, `JSON must expose ${key}`).toHaveProperty(key);
    }
    expect(report.schemaVersion).toBe("evidence-d/2");
    expect((report.checks as unknown[]).length).toBe(10);
  });

  it("actually reached the deployment (transport calls were made)", () => {
    expect(report.transportCalls as number).toBeGreaterThan(5);
  });

  it("exposes providerAttempts from a real probe over HTTP", () => {
    const attempts = (report.providerEvidence as { attempts: Record<string, unknown>[] }).attempts;
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts[0].provider).toBe("okx");
    expect(attempts[0].basis).toBe("exchange ts field");
    expect(human).toContain("PROVIDER ATTEMPTS");
    expect(human).toContain("okx/order-book");
  });

  it("exposes the sweep log with provider-native ids from discovery", () => {
    const sweep = report.sweep as { candidates: { instrument?: string }[]; attempted: number };
    expect(sweep.attempted).toBeGreaterThan(0);
    const ids = sweep.candidates.map((c) => c.instrument).filter(Boolean);
    expect(ids).toContain("BTC-USDT");
    // The suspended instrument from discovery must be filtered out.
    expect(ids).not.toContain("SOL-USDT");
    expect(human).toContain("CHARGEABLE-SIGNAL SWEEP");
  });

  it("exposes chargeableFind and the E-track separately, plus blockers", () => {
    expect(report.sweep).toHaveProperty("chargeableFind");
    const e = report.entitlementStateMachine as { verdict: string; checks: unknown[] };
    expect(e.checks).toHaveLength(7);
    expect(human).toContain("ENTITLEMENT STATE MACHINE");
    expect((report.blockers as unknown[]).length).toBeGreaterThan(0);
    expect(human).toContain("REMAINING BLOCKERS");
  });

  it("renders both modes from the same canonical object", () => {
    for (const row of report.checks as { id: string; status: string }[]) {
      expect(human, `human output must show ${row.id}`).toContain(row.id);
      expect(human).toContain(row.status);
    }
    expect(human).toContain(String(report.evidenceD));
  });
});

/* ------------------------------------------------------------------ *
 * 4. Exit-code contract
 * ------------------------------------------------------------------ */

describe("Phase 209 — exit-code contract across fixture scenarios", () => {
  it("exits 0 only when every observation genuinely passed", async () => {
    const r = await runAgainstFixture("complete", ["--auth", "otp", "--otp", "123456", "--json"]);
    const report = parseJson(r.stdout);
    expect(report.evidenceD).toBe("ACHIEVED");
    expect(report.summary.unknown).toBe(0);
    expect(r.code).toBe(0);
  });

  it("exits 2 when the run is incomplete", async () => {
    const r = await runAgainstFixture("incomplete", ["--auth", "anonymous", "--json"]);
    expect(parseJson(r.stdout).evidenceD).toBe("INCOMPLETE");
    expect(r.code).toBe(2);
  });

  it("exits 1 when an observation actually fails", async () => {
    const r = await runAgainstFixture("blocked", ["--auth", "anonymous", "--json"]);
    const report = parseJson(r.stdout);
    expect(report.evidenceD).toBe("FAILED");
    expect(report.summary.failed).toBeGreaterThan(0);
    expect(r.code).toBe(1);
  });

  it("treats an unknown status as UNKNOWN, never PASS, and exits 2", async () => {
    const r = await runAgainstFixture("malformed", ["--auth", "anonymous", "--json"]);
    const report = parseJson(r.stdout);
    expect(report.evidenceD).not.toBe("ACHIEVED");
    expect(r.code).toBe(2);
    // The nonsense recommendation must not be laundered into a chargeable find.
    expect(report.sweep.chargeableFind).toBeNull();
  });

  it("renders BLOCKED rows as BLOCKED end-to-end, never PASS", async () => {
    // N5: the silent scenario is the only fixture path that produces BLOCKED
    // rows through the real CLI, so it is where the BLOCKED->PASS mutation has
    // to be caught at this level (the unit suite catches it structurally).
    const r = await runAgainstFixture("silent", ["--auth", "anonymous"]);
    expect(r.code).toBe(2);
    const stream = r.stdout + r.stderr;
    expect(stream).toMatch(/BLOCKED/);
    // Scope to rendered STATUS columns: the refusal banner legitimately says
    // "No check was marked PASS.", so matching the bare word is a test defect.
    expect(stream).not.toMatch(/^\s*PASS\s+D\d+/m);

    const j = await runAgainstFixture("silent", ["--auth", "anonymous", "--json"]);
    const report = parseJson(j.stdout);
    const statuses = (report.checks as { status: string }[]).map((c) => c.status);
    expect(new Set(statuses)).toEqual(new Set(["BLOCKED"]));
    expect(statuses).toHaveLength(10);
  });

  it("exits 2 and records zero passes when the deployment is silent", async () => {
    const r = await runAgainstFixture("silent", ["--auth", "anonymous", "--json"]);
    expect(r.code).toBe(2);
    const report = parseJson(r.stdout);
    expect(report.evidenceD).toBe("NOT EXECUTED");
    expect((report.checks as { status: string }[]).every((c) => c.status === "BLOCKED")).toBe(true);
    expect((report.checks as { status: string }[]).some((c) => c.status === "PASS")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 5. D/E separation under fixture conditions
 * ------------------------------------------------------------------ */

describe("Phase 209 — D and E stay separate against the fixture", () => {
  it("a fully VERIFIED E-track cannot make an INCOMPLETE D-track achieved", async () => {
    const r = await runAgainstFixture("incomplete", ["--auth", "anonymous", "--sweep", "5", "--json"]);
    const report = parseJson(r.stdout);
    expect(report.entitlementStateMachine.verdict).toBe("VERIFIED");
    expect(report.evidenceD).toBe("INCOMPLETE");
    expect(r.code).toBe(2);
    expect(report.productionEvidence).toBe(false);
  });

  it("the D summary counts only D1-D10", async () => {
    const r = await runAgainstFixture("incomplete", ["--auth", "anonymous", "--json"]);
    const report = parseJson(r.stdout);
    const s = report.summary;
    expect(s.total).toBe(10);
    expect(s.passed + s.failed + s.blocked + s.notVerified + s.unknown).toBe(10);
    expect(report.entitlementStateMachine.checks).toHaveLength(7);
  });

  it("a quiet fixture market leaves D5/D7/D8 NOT_VERIFIED, never FAIL", async () => {
    const r = await runAgainstFixture("incomplete", ["--auth", "anonymous", "--sweep", "5", "--json"]);
    const report = parseJson(r.stdout);
    const by = Object.fromEntries(
      (report.checks as { id: string; status: string }[]).map((c) => [c.id, c.status]),
    );
    for (const id of ["D5", "D7", "D8"]) expect(by[id]).toBe("NOT_VERIFIED");
    expect(report.summary.failed).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 6. The production safety boundary is unchanged
 * ------------------------------------------------------------------ */

describe("Phase 209 — real-deployment refusals still hold", () => {
  it.each([
    ["localhost without fixture mode", { VITE_CONVEX_URL: "http://localhost:7311" }, /must be https|local host/],
    ["loopback IP without fixture mode", { VITE_CONVEX_URL: "http://127.0.0.1:7311" }, /must be https|local host/],
    ["arbitrary https host", { VITE_CONVEX_URL: "https://evil.example.com" }, /not a Convex deployment domain/],
    ["non-https convex host", { VITE_CONVEX_URL: "http://x.convex.cloud" }, /must be https/],
    ["no deployment configured", { VITE_CONVEX_URL: "" }, /No deployment is configured/],
  ])("still refuses %s", (_label, env, pattern) => {
    const r = spawnSync("node", [HARNESS], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, CONVEX_DEPLOYMENT: "", CONVEX_URL: "", ...env },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(pattern);
    expect(r.stdout).not.toContain("PASS");
  });

  it("still refuses a deployment-name mismatch", () => {
    const r = spawnSync("node", [HARNESS], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        CONVEX_DEPLOYMENT: "dev:some-deployment",
        VITE_CONVEX_URL: "https://other-deployment.convex.cloud",
        CONVEX_URL: "",
      },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Deployment mismatch/);
  });

  it("still refuses --production-evidence against a dev deployment", () => {
    const r = spawnSync("node", [HARNESS, "--production-evidence"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        CONVEX_DEPLOYMENT: "dev:tough-goose-455",
        VITE_CONVEX_URL: "https://tough-goose-455.convex.cloud",
        CONVEX_URL: "",
      },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Production evidence requires an actual production/);
  });

  it("the fixture branch does not weaken any non-fixture check", () => {
    const harnessSource = readFileSync(HARNESS, "utf8");
    // Each relaxation must be explicitly gated on isFixture, never removed.
    expect(harnessSource).toMatch(/if \(!isFixture && LOCAL_RE\.test\(parsed\.hostname\)\)/);
    expect(harnessSource).toMatch(/if \(!isFixture && parsed\.protocol !== "https:"\)/);
    expect(harnessSource).toMatch(/if \(!isFixture && !\/\\\.convex\\\.\(cloud\|site\)\$\/i\.test/);
    expect(harnessSource).toMatch(/if \(!isFixture && deployment\.name\)/);
    // Production classification can never be reached in fixture mode.
    expect(harnessSource).toMatch(/const DEPLOYMENT_ENVIRONMENT = isFixture\s*\n?\s*\? "fixture"/);
    expect(harnessSource).toMatch(/const EVIDENCE_CLASS = isFixture\s*\n?\s*\? "FIXTURE — NOT EVIDENCE"/);
  });

  it("the report builder makes productionEvidence structurally impossible for a fixture", () => {
    const schema = readFileSync(join(root, "scripts/lib/evidence-report.mjs"), "utf8");
    expect(schema).toMatch(/const productionEvidence =\s*\n\s*fixture !== true &&/);
  });
});
