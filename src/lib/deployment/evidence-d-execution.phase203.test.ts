/**
 * Phase 203 — the Evidence D harness must execute correctly, or refuse.
 *
 * Phase 200 proved the harness refuses substitutes. That is necessary but not
 * sufficient: a harness can refuse every fake backend and still produce
 * meaningless results against the real one. An audit found exactly that —
 * it called `runProtectedAnalysis` with an argument shape the server does not
 * accept, and sent D9's forged payload to a nesting level the server never
 * reads, so D9 would have reported PASS without the server stripping anything.
 * A security check that passes when the defence is absent is worse than no
 * check.
 *
 * These tests pin four things:
 *   1. the call shapes match the deployed function contracts (checked against
 *      the server source, so a server-side rename breaks the harness loudly);
 *   2. the refusals — including the new dev/prod mislabelling refusals;
 *   3. the impossibility of satisfying D1–D10 from fixtures or a cache;
 *   4. Phase 235 — that the deployment's transport outcome is CLASSIFIED rather
 *      than assumed. What the harness observes depends on the network the
 *      machine happens to have (a wildcard host resolves on a networked runner
 *      and dies at the TLS layer behind an egress block); what it may CONCLUDE
 *      does not. Sections 5b–5d fixture every layer of transport failure and
 *      every answered shape through `scripts/lib/evidence-d-probe.mjs`, so the
 *      same conclusions are asserted on both kinds of machine.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// Typed via scripts/lib/evidence-d-probe.d.mts — no `any` cast.
import {
  AUTH_EVIDENCE_STATES,
  INFRASTRUCTURE_STATES,
  PROBE_STATES,
  classifyProbeResult,
  probeRefusalReason,
  transportLayerOf,
  validateProbeClassification,
} from "../../../scripts/lib/evidence-d-probe.mjs";

const root = process.cwd();
const HARNESS = join(root, "scripts/evidence-d-harness.mjs");
const FETCH_STUB = join(root, "scripts/lib/fixtures/evidence-d-fetch-stub.mjs");
const PROTECTED = join(root, "src/convex/protectedAnalysis.ts");
const ENTITLEMENTS = join(root, "src/convex/entitlements.ts");
const GATE = join(root, "src/lib/entitlement/decision-gate.ts");

const harnessSource = readFileSync(HARNESS, "utf8");

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runHarness(env: Record<string, string>, argv: string[] = ["--json"]): Run {
  try {
    const stdout = execFileSync(process.execPath, [HARNESS, ...argv], {
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

/*
 * Phase 235 — a deterministic deployment.
 *
 * `reachable-example.convex.cloud` cannot be relied on to be unreachable: the
 * host sits behind a wildcard DNS record, so on a networked runner it resolves,
 * TLS completes and the harness receives an HTTP answer, while in an
 * egress-blocked sandbox the same probe dies at the TLS layer. Asserting the
 * outcome was therefore asserting the *machine*, not the harness.
 *
 * `--import <stub>` lets the guard hand the harness a fake transport, so each
 * branch of the classification can be produced on demand, on any machine, in
 * milliseconds. The harness is unaware: the stub replaces `globalThis.fetch` in
 * the child process only, and no production code was given a test hook.
 */
const UNREACHABLE_ENV: Record<string, string> = {
  CONVEX_DEPLOYMENT: "dev:unreachable-example",
  VITE_CONVEX_URL: "https://unreachable-example.convex.cloud",
  EVIDENCE_D_EMAIL: "a@b.co",
};

function runStubbedHarness(mode: string, timeoutSeconds = 5): Run {
  return runHarness(
    { ...UNREACHABLE_ENV, NODE_OPTIONS: `--import ${FETCH_STUB}`, EVIDENCE_D_STUB_MODE: mode },
    ["--json", "--timeout", String(timeoutSeconds)],
  );
}

interface ReportCheck {
  id: string;
  status: string;
  detail?: string;
  evidence?: Record<string, unknown> | null;
}

interface HarnessReport {
  evidenceD: string;
  reason?: string;
  checks: ReportCheck[];
  summary?: { failed?: number; blocked?: number; passed?: number };
}

function parseReport(run: Run): HarnessReport {
  // A stub failure must be loud, not parsed into an undefined-shaped report.
  expect(run.stdout.trim(), `harness produced no JSON (exit ${run.exitCode}): ${run.stderr.slice(0, 400)}`).not.toBe("");
  return JSON.parse(run.stdout) as HarnessReport;
}


/* ------------------------------------------------------------------ *
 * 1. Call shapes must match the deployed contracts
 * ------------------------------------------------------------------ */

describe("Phase 203 — the harness calls the functions the server actually exposes", () => {
  it("sends analysis arguments under `input`, as the action declares", () => {
    const server = readFileSync(PROTECTED, "utf8");
    // The server's only declared argument.
    expect(server).toMatch(/export const runProtectedAnalysis = action\(\{\s*args:\s*\{[^}]*input:/s);

    // The harness must therefore nest everything under `input`. A top-level
    // {symbol, tradingStyle} call yields INVALID_INPUT, which would read as a
    // product defect when it is really a harness defect.
    expect(harnessSource).toMatch(/const analysisInput = \([^)]*\) => \(\{\s*input:/);
    expect(harnessSource).not.toMatch(/runProtectedAnalysis",\s*\{\s*symbol:/);
  });

  it("uses `instrument`/`timeframe`, the field names the server reads", () => {
    const server = readFileSync(PROTECTED, "utf8");
    expect(server).toContain("trustedInput.instrument");
    expect(server).toContain("trustedInput.timeframe");
    expect(harnessSource).toMatch(/instrument:\s*"EURUSD"/);
    expect(harnessSource).toMatch(/timeframe:\s*"1h"/);
    // `symbol` is not a field the server knows about.
    expect(harnessSource).not.toMatch(/symbol:\s*"/);
  });

  it("targets the real function names for entitlement and provenance", () => {
    expect(readFileSync(ENTITLEMENTS, "utf8")).toContain("export const getMyEntitlement");
    expect(harnessSource).toContain("entitlements:getMyEntitlement");
    expect(harnessSource).toContain("protectedAnalysis:runProtectedAnalysis");
    expect(harnessSource).toContain("marketData:fetchMarketData");
  });
});

/* ------------------------------------------------------------------ *
 * 2. D9 must forge fields the server actually strips
 * ------------------------------------------------------------------ */

describe("Phase 203 — D9 exercises the real anti-spoofing boundary", () => {
  it("forges fields that appear in CLIENT_UNTRUSTED_EVIDENCE_FIELDS", () => {
    const server = readFileSync(PROTECTED, "utf8");
    const untrusted = server
      .slice(
        server.indexOf("CLIENT_UNTRUSTED_EVIDENCE_FIELDS = ["),
        server.indexOf("] as const", server.indexOf("CLIENT_UNTRUSTED_EVIDENCE_FIELDS = [")),
      )
      .match(/"([a-zA-Z]+)"/g)!
      .map((s) => s.replace(/"/g, ""));

    // Every field the harness forges must be one the server claims to strip.
    for (const forged of ["marketData", "currentPrice", "instrumentSpec", "newsContext"]) {
      expect(untrusted, `${forged} must be a field the server strips`).toContain(forged);
      expect(harnessSource, `D9 must forge ${forged}`).toContain(forged);
    }
  });

  it("places forged evidence inside `input`, where stripClientEvidence can see it", () => {
    // The original defect: forged data sent as a sibling of `input` is never
    // read by the server, so the check passed without any defence running.
    const d9Block = harnessSource.slice(
      harnessSource.indexOf("D9 BEFORE exhaustion"),
      harnessSource.indexOf("D5: a chargeable recommendation"),
    );
    expect(d9Block).toContain("analysisInput({");
    expect(d9Block).toMatch(/currentPrice:\s*FORGED_PRICE/);

    // The forged fields must be arguments OF analysisInput, not merged around
    // it. `Object.assign(analysisInput({}), {currentPrice})` still contains the
    // substring above while re-creating the original defect exactly, so assert
    // the call actually encloses the forged field.
    const call = /analysisInput\(\{([\s\S]*?)\n\s{4}\}\),/.exec(d9Block);
    expect(call, "forged evidence must be passed into analysisInput()").not.toBeNull();
    expect(call![1]).toMatch(/currentPrice:\s*FORGED_PRICE/);
    expect(call![1]).toContain("marketData:");
    expect(call![1]).toContain("instrumentSpec:");
    expect(d9Block).not.toMatch(/Object\.assign\(\s*analysisInput/);
  });

  it("runs D9 before the account is exhausted, so a LOCKED redaction cannot fake a pass", () => {
    const d9At = harnessSource.indexOf("D9 BEFORE exhaustion");
    const d7At = harnessSource.indexOf("D7 + D8: exhaustion must LOCK");
    expect(d9At).toBeGreaterThan(0);
    expect(d9At, "D9 must precede exhaustion").toBeLessThan(d7At);
    expect(harnessSource).toMatch(/vacuously/);
  });

  it("checks D8 against the server's full protected-field list, not a guessed subset", () => {
    const gate = readFileSync(GATE, "utf8");
    const protectedFields = gate
      .slice(
        gate.indexOf("PROTECTED_DECISION_FIELDS = ["),
        gate.indexOf("] as const", gate.indexOf("PROTECTED_DECISION_FIELDS = [")),
      )
      .match(/"([a-zA-Z]+)"/g)!
      .map((s) => s.replace(/"/g, ""));

    expect(protectedFields.length).toBeGreaterThanOrEqual(18);
    for (const field of protectedFields) {
      expect(harnessSource, `D8 must check for leaked "${field}"`).toContain(`"${field}"`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. Dev vs production labelling
 * ------------------------------------------------------------------ */

describe("Phase 203 — a development run is never production evidence", () => {
  it("labels a dev deployment DEV_VERIFIED and refuses the production claim", () => {
    const run = runHarness({
      CONVEX_DEPLOYMENT: "dev:tidy-example-123",
      VITE_CONVEX_URL: "https://tidy-example-123.convex.cloud",
      EVIDENCE_D_EMAIL: "a@b.co",
      "--": "",
    });
    // Unreachable from CI, so it refuses at transport — but the label is the
    // point, and the refusal must not claim production.
    expect(run.exitCode).not.toBe(0);
    expect(run.stdout).not.toContain("PRODUCTION_EVIDENCE");
  });

  it("refuses --production-evidence against a development deployment", () => {
    const run = runHarness(
      {
        CONVEX_DEPLOYMENT: "dev:tidy-example-123",
        VITE_CONVEX_URL: "https://tidy-example-123.convex.cloud",
        EVIDENCE_D_EMAIL: "a@b.co",
      },
      ["--json", "--production-evidence"],
    );
    expect(run.exitCode).toBe(2);
    const report = JSON.parse(run.stdout);
    expect(report.evidenceD).toBe("NOT EXECUTED");
    expect(report.reason).toMatch(/production evidence requires an actual production/i);
  });

  it("does not treat an unlabelled deployment as production", () => {
    const run = runHarness(
      {
        VITE_CONVEX_URL: "https://unlabelled-example.convex.cloud",
        EVIDENCE_D_EMAIL: "a@b.co",
      },
      ["--json", "--production-evidence"],
    );
    expect(run.exitCode).toBe(2);
    expect(JSON.parse(run.stdout).reason).toMatch(/"unknown"/);
  });

  it("refuses anonymous sign-in as production evidence", () => {
    const run = runHarness(
      {
        CONVEX_DEPLOYMENT: "prod:real-example-999",
        VITE_CONVEX_URL: "https://real-example-999.convex.cloud",
      },
      ["--json", "--auth", "anonymous"],
    );
    expect(run.exitCode).toBe(2);
    expect(JSON.parse(run.stdout).reason).toMatch(/anonymous sign-in is a development/i);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Wrong / ambiguous deployment
 * ------------------------------------------------------------------ */

describe("Phase 203 — evidence is never attributed to an ambiguous target", () => {
  it("refuses when CONVEX_DEPLOYMENT and the URL name different deployments", () => {
    const run = runHarness({
      CONVEX_DEPLOYMENT: "dev:deployment-alpha",
      VITE_CONVEX_URL: "https://deployment-beta.convex.cloud",
      EVIDENCE_D_EMAIL: "a@b.co",
    });
    expect(run.exitCode).toBe(2);
    const report = JSON.parse(run.stdout);
    expect(report.reason).toMatch(/deployment mismatch/i);
    expect(report.checks.every((c: { status: string }) => c.status === "BLOCKED")).toBe(true);
  });

  it("still refuses localhost even when a deployment name is declared", () => {
    const run = runHarness({
      CONVEX_DEPLOYMENT: "dev:localhost",
      VITE_CONVEX_URL: "http://localhost:3210",
      EVIDENCE_D_EMAIL: "a@b.co",
    });
    expect(run.exitCode).toBe(2);
    expect(JSON.parse(run.stdout).reason).toMatch(/local host/i);
  });

  it("derives the target from configuration rather than hardcoding a deployment", () => {
    // The real dev deployment name must never be baked into the script.
    expect(harnessSource).not.toContain("tough-goose-455");
    expect(harnessSource).toContain("CONVEX_DEPLOYMENT");
  });
});

/* ------------------------------------------------------------------ *
 * 5. No fixtures, no cache, no mock mode
 * ------------------------------------------------------------------ */

describe("Phase 203 — D1–D10 cannot be satisfied without a live deployment", () => {
  it("has no mock or replay path, and no fixture that can yield evidence", () => {
    // Phase 209 added an explicit --fixture mode so the CLI itself could be
    // exercised end to end (the sandbox reaches no real deployment). That does
    // NOT weaken this guard: the invariant was never "the word fixture must
    // not appear", it was "a substitute backend can never produce Evidence D".
    // So every replay/mock escape hatch stays forbidden, and the fixture is
    // pinned to be structurally evidence-incapable instead.
    const code = harnessSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const forbidden of [/--mock/, /mockMode/, /replay/i, /loadReport/i, /cachedResult/i, /stubResponse/i]) {
      expect(code, `harness must not support ${forbidden}`).not.toMatch(forbidden);
    }
    // The fixture is never classified as a real deployment...
    expect(code).toMatch(/const DEPLOYMENT_ENVIRONMENT = isFixture/);
    expect(code).toMatch(/const EVIDENCE_CLASS = isFixture/);
    expect(code).toMatch(/"FIXTURE — NOT EVIDENCE"/);
    // ...is opt-in and loopback-only...
    expect(code).toMatch(/args\.includes\("--fixture"\)/);
    expect(code).toMatch(/127\\.0\\.0\\.1/);
    // ...and can never carry a production claim.
    expect(code).toMatch(/--production-evidence cannot be combined with --fixture/);
    // Every relaxed host check remains enforced for non-fixture runs.
    for (const gated of [
      /if \(!isFixture && LOCAL_RE\.test/,
      /if \(!isFixture && parsed\.protocol !== "https:"\)/,
      /if \(!isFixture && deployment\.name\)/,
    ]) {
      expect(code, `non-fixture runs must still enforce ${gated}`).toMatch(gated);
    }
    // And the report builder makes a fixture production claim impossible.
    const schema = readFileSync(join(root, "scripts/lib/evidence-report.mjs"), "utf8");
    expect(schema).toMatch(/fixture !== true &&/);
  });

  it("never reads a previous report back in", () => {
    // readFileSync is permitted only for dotenv parsing.
    const reads = [...harnessSource.matchAll(/readFileSync\(([^)]*)\)/g)].map((m) => m[1]);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatch(/path,\s*"utf8"/);
  });

  it("derives every status from a response received in this process", () => {
    // Every observation-recording call must sit inside run(), which is the only
    // place a response exists. Compare positions rather than two different
    // regexes: an inline `record(...)` after an if-guard is not at line start,
    // so a line-anchored count would undercount and the test would fail on
    // correct code.
    const runStart = harnessSource.indexOf("async function run()");
    const runEnd = harnessSource.indexOf("const safety = (await run())");
    expect(runStart).toBeGreaterThan(0);
    expect(runEnd).toBeGreaterThan(runStart);

    const callSites = [...harnessSource.matchAll(/\brecord\(/g)].map((m) => m.index!);
    expect(callSites.length).toBeGreaterThan(10);
    const outside = callSites.filter((i) => i < runStart || i > runEnd);
    // The only permitted occurrence outside run() is the definition itself.
    expect(outside).toHaveLength(0);

    // And every status must originate from a `record(` — there is no other
    // writer into the checks array.
    const pushes = [...harnessSource.matchAll(/checks\.push\(/g)].map((m) => m.index!);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toBeLessThan(runStart);
  });

  it("refuses a file-configured deployment whose transport is blocked, rather than reporting PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "evd-"));
    const envFile = join(dir, ".env.test");
    writeFileSync(
      envFile,
      [
        "CONVEX_DEPLOYMENT=dev:unreachable-example",
        "VITE_CONVEX_URL=https://unreachable-example.convex.cloud",
        "EVIDENCE_D_EMAIL=a@b.co",
      ].join("\n"),
    );
    // Phase 235: the transport is stubbed, so this asserts a conclusion the
    // harness must reach on every machine rather than restating the runner's
    // egress policy.
    const run = runHarness(
      { NODE_OPTIONS: `--import ${FETCH_STUB}`, EVIDENCE_D_STUB_MODE: "dns" },
      ["--json", "--env-file", envFile, "--timeout", "5"],
    );
    expect(run.exitCode).toBe(2);
    const report = parseReport(run);
    expect(report.evidenceD).toBe("NOT EXECUTED");
    expect(report.checks.filter((c) => c.status === "PASS")).toHaveLength(0);
    expect(report.checks.every((c) => c.status === "BLOCKED")).toBe(true);
  });

  it("reports a transport failure as transport, never as an auth result", () => {
    const run = runStubbedHarness("dns");
    const report = parseReport(run);
    expect(report.reason).toMatch(/transport failure/i);
    expect(report.reason).not.toMatch(/unauthenticated|rejected credential/i);
    expect(report.reason).toMatch(/not an authentication or authorisation result/i);
  });
});

/* ------------------------------------------------------------------ *
 * 5b. Phase 235 — the deployment's answer decides the verdict
 * ------------------------------------------------------------------ */

/**
 * The guard used to prove "unreachable is not an auth failure" by pointing the
 * harness at a real host and asserting what the machine's network did. These
 * fixtures instead hand the harness a simulated transport, so each outcome can
 * be produced on demand and the assertions describe the harness rather than the
 * runner.
 *
 * The property under test is the one that must hold everywhere: an
 * authentication verdict requires an actual answer from the service, and a
 * result that only proves the transport failed stays an infrastructure
 * condition.
 */
describe("Phase 235 — a blocked transport refuses as infrastructure, never as authentication", () => {
  const blockedModes: Array<[string, string]> = [
    ["dns", "ENOTFOUND"],
    ["tcp", "ECONNREFUSED"],
    ["tls", "ECONNRESET"],
    ["cert", "ERR_TLS_CERT_ALTNAME_INVALID"],
    ["timeout", "ETIMEDOUT"],
    ["opaque", "Error"],
  ];

  it("refuses every blocked transport with the same shape and names the layer", () => {
    for (const [mode, code] of blockedModes) {
      const run = runStubbedHarness(mode);
      const report = parseReport(run);

      // Refusal, not a verdict: nothing was executed, so nothing is claimed.
      expect(run.exitCode, mode).toBe(2);
      expect(report.evidenceD, mode).toBe("NOT EXECUTED");
      expect(
        report.checks.every((c) => c.status === "BLOCKED"),
        mode,
      ).toBe(true);
      expect(report.checks, mode).toHaveLength(10);

      // The reason states the transport fact, names the hop, and explicitly
      // disclaims an authentication conclusion.
      expect(report.reason, mode).toMatch(/transport failure/i);
      expect(report.reason, mode).toMatch(/not an authentication or authorisation result/i);
      expect(report.reason, mode).toContain(code);
      expect(report.reason, mode).not.toMatch(/unauthenticated|rejected credential/i);

      // And the classification the harness used is the same one the exported
      // contract produces for that probe result.
      const classified = classifyProbeResult({ httpStatus: 0, transportError: code });
      expect(classified.state, mode).toBe("TRANSPORT_BLOCKED");
      expect(classified.isAuthEvidence, mode).toBe(false);
      expect(classified.isRevocationEvidence, mode).toBe(false);
      expect(report.reason, mode).toBe(probeRefusalReason(classified, "unreachable-example.convex.cloud"));
    }
  });

  it("bounds a hanging probe by --timeout, so a guard cannot stall for a minute", () => {
    // A stub that never answers: the refusal must arrive on the configured
    // budget, not the 60s default. This is what makes a live probe cheap enough
    // to keep in a suite — and it pins that the flag is honoured at all.
    const started = Date.now();
    const run = runStubbedHarness("hang", 1);
    const elapsed = Date.now() - started;
    const report = parseReport(run);

    expect(report.evidenceD).toBe("NOT EXECUTED");
    expect(report.reason).toMatch(/timeout layer/i);
    expect(elapsed).toBeLessThan(15_000);
  });

  it("never records a check verdict for a run that refused", () => {
    const report = parseReport(runStubbedHarness("tls"));
    const d3 = report.checks.find((c) => c.id === "D3");
    expect(d3?.status).toBe("BLOCKED");
    expect(d3?.evidence ?? null).toBeNull();
    expect(report.summary?.passed ?? 0).toBe(0);
  });
});

describe("Phase 235 — an answer that is not a working deployment is not authentication evidence", () => {
  const notServingModes = ["http-503", "http-404", "malformed-200", "non-json"];

  it("fails closed on an unavailable or uninterpretable answer", () => {
    for (const mode of notServingModes) {
      const run = runStubbedHarness(mode);
      const report = parseReport(run);

      // The checks ran — so this is a result, not a refusal — and none passed.
      expect(run.exitCode, mode).toBe(1);
      expect(report.evidenceD, mode).toBe("FAILED");
      expect(report.reason, mode).toBeUndefined();
      expect(
        report.checks.filter((c) => c.status === "PASS"),
        mode,
      ).toHaveLength(0);

      const d3 = report.checks.find((c) => c.id === "D3");
      expect(d3?.status, mode).toBe("FAIL");
      const resultClass = String(d3?.evidence?.resultClass);
      expect(INFRASTRUCTURE_STATES, mode).toContain(resultClass);
      expect(resultClass, mode).not.toBe("TRANSPORT_BLOCKED");
      expect(AUTH_EVIDENCE_STATES, mode).not.toContain(resultClass);
    }
  });

  it("keeps a 5xx/404 an infrastructure condition, distinct from a transport failure", () => {
    for (const [mode, status] of [
      ["http-503", 503],
      ["http-404", 404],
    ] as Array<[string, number]>) {
      const report = parseReport(runStubbedHarness(mode));
      const d3 = report.checks.find((c) => c.id === "D3");
      expect(d3?.evidence?.httpStatus, mode).toBe(status);
      expect(d3?.evidence?.resultClass, mode).toBe("SERVICE_UNAVAILABLE");
    }
    for (const mode of ["malformed-200", "non-json"]) {
      const report = parseReport(runStubbedHarness(mode));
      const d3 = report.checks.find((c) => c.id === "D3");
      expect(d3?.evidence?.httpStatus, mode).toBe(200);
      expect(d3?.evidence?.resultClass, mode).toBe("MALFORMED");
    }
  });

  it("only passes D3 when the service actually answered with a refusal", () => {
    // A reached deployment that refuses the caller IS the evidence D3 exists to
    // collect — that is the difference between this and a transport failure.
    for (const [mode, withheld] of [
      ["unauth-401", false],
      ["unauth-app", true],
    ] as Array<[string, boolean]>) {
      const run = runStubbedHarness(mode);
      const report = parseReport(run);
      const d3 = report.checks.find((c) => c.id === "D3");
      expect(d3?.status, mode).toBe("PASS");
      expect(d3?.evidence?.resultClass, mode).toBe("UNAUTHENTICATED");
      expect(d3?.evidence?.resultWithheld, mode).toBe(withheld);

      // One passing check is still not a passed gate.
      expect(run.exitCode, mode).toBe(2);
      expect(report.evidenceD, mode).toBe("INCOMPLETE");
      const passes = report.checks.filter((c) => c.status === "PASS");
      expect(passes, mode).toHaveLength(1);
      expect(passes[0].id, mode).toBe("D3");
    }
  });
});

/* ------------------------------------------------------------------ *
 * 5c. Phase 235 — the classification contract (fixtures only)
 * ------------------------------------------------------------------ */

describe("Phase 235 — probe classification is pure, total and fails closed", () => {
  const layerCases: Array<[string, string]> = [
    ["ENOTFOUND", "dns"],
    ["EAI_AGAIN", "dns"],
    ["ECONNREFUSED", "tcp"],
    ["EHOSTUNREACH", "tcp"],
    ["ENETUNREACH", "tcp"],
    ["ECONNRESET", "tls"],
    ["EPIPE", "tls"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "tls"],
    ["ETIMEDOUT", "timeout"],
    ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
    ["AbortError", "timeout"],
    // Unrecognised codes stay unknown rather than being guessed into a layer
    // that would look more precise than the evidence supports.
    ["WEIRD_FAILURE", "unknown"],
    ["", "unknown"],
  ];

  it("maps transport error codes onto layers, defaulting to unknown", () => {
    for (const [code, layer] of layerCases) {
      expect(transportLayerOf(code), code).toBe(layer);
    }
    expect(transportLayerOf(undefined)).toBe("unknown");
  });

  it("classifies every layer of transport failure as infrastructure, never auth", () => {
    for (const [code, layer] of layerCases) {
      const classified = classifyProbeResult({ httpStatus: 0, transportError: code });
      expect(classified.state, code).toBe("TRANSPORT_BLOCKED");
      expect(classified.layer, code).toBe(layer);
      expect(classified.reached, code).toBe(false);
      expect(classified.isAuthEvidence, code).toBe(false);
      expect(classified.isRevocationEvidence, code).toBe(false);
      expect(AUTH_EVIDENCE_STATES, code).not.toContain(classified.state);
      expect(validateProbeClassification(classified), code).toEqual([]);
    }
  });

  it("treats a missing or contradictory answer as unreached, not as success", () => {
    // No answer at all: nothing reached, so nothing may be concluded.
    for (const probe of [{}, { httpStatus: 0 }, { transportError: "ECONNRESET" }]) {
      const classified = classifyProbeResult(probe);
      expect(classified.state, JSON.stringify(probe)).toBe("TRANSPORT_BLOCKED");
      expect(classified.isAuthEvidence, JSON.stringify(probe)).toBe(false);
      expect(validateProbeClassification(classified), JSON.stringify(probe)).toEqual([]);
    }
  });

  it("lets a recorded transport error outrank any status, however it is shaped", () => {
    // A caller that reshapes a thrown fetch into an auth-looking answer cannot
    // win: the transport fact is decided first and unconditionally, so no HTTP
    // status, application status or `value` payload can pull a verdict out of a
    // request that never reached the service.
    const forged = [
      { httpStatus: 401, transportError: "ECONNREFUSED" },
      { httpStatus: 401, transportError: "ECONNREFUSED", appStatus: "UNAUTHENTICATED" },
      { httpStatus: 200, transportError: "ECONNRESET", appStatus: "DELIVERED" },
      { httpStatus: 500, transportError: "ETIMEDOUT" },
    ];
    for (const probe of forged) {
      const classified = classifyProbeResult(probe);
      expect(classified.state, JSON.stringify(probe)).toBe("TRANSPORT_BLOCKED");
      expect(classified.isAuthEvidence, JSON.stringify(probe)).toBe(false);
      expect(classified.reached, JSON.stringify(probe)).toBe(false);
      expect(classified.httpStatus, JSON.stringify(probe)).toBe(0);
      expect(validateProbeClassification(classified), JSON.stringify(probe)).toEqual([]);
    }
  });

  it("separates an answered-but-unavailable service from an auth verdict", () => {
    for (const status of [400, 403, 404, 429, 500, 502, 503]) {
      const classified = classifyProbeResult({ httpStatus: status });
      expect(classified.state, String(status)).toBe("SERVICE_UNAVAILABLE");
      expect(classified.reached, String(status)).toBe(true);
      expect(classified.layer, String(status)).toBeNull();
      expect(classified.isAuthEvidence, String(status)).toBe(false);
      expect(validateProbeClassification(classified), String(status)).toEqual([]);
    }
  });

  it("only calls a response authentication evidence when the service said something", () => {
    const refusal = classifyProbeResult({ httpStatus: 401 });
    expect(refusal.state).toBe("UNAUTHENTICATED");
    expect(refusal.reached).toBe(true);
    expect(refusal.isAuthEvidence).toBe(true);
    expect(validateProbeClassification(refusal)).toEqual([]);

    const appRefusal = classifyProbeResult({ httpStatus: 200, appStatus: "UNAUTHENTICATED" });
    expect(appRefusal.state).toBe("UNAUTHENTICATED");
    expect(appRefusal.isAuthEvidence).toBe(true);
    expect(validateProbeClassification(appRefusal)).toEqual([]);

    const ok = classifyProbeResult({ httpStatus: 200, appStatus: "DELIVERED" });
    expect(ok.state).toBe("AUTHENTICATED");
    expect(ok.reached).toBe(true);
    expect(ok.isAuthEvidence).toBe(true);
    expect(validateProbeClassification(ok)).toEqual([]);
  });

  it("fails closed on a 2xx that states no application status", () => {
    for (const appStatus of [undefined, null, "", "   ", 42, {}]) {
      const classified = classifyProbeResult({ httpStatus: 200, appStatus });
      expect(classified.state, JSON.stringify(appStatus)).toBe("MALFORMED");
      expect(classified.isAuthEvidence, JSON.stringify(appStatus)).toBe(false);
      expect(classified.detail, JSON.stringify(appStatus)).toMatch(/fails closed/i);
      expect(validateProbeClassification(classified), JSON.stringify(appStatus)).toEqual([]);
    }
  });

  it("is deterministic and independent of the environment it runs in", () => {
    const probes = [
      { httpStatus: 0, transportError: "ENOTFOUND" },
      { httpStatus: 401 },
      { httpStatus: 200, appStatus: "DELIVERED" },
      { httpStatus: 200 },
      { httpStatus: 503 },
    ];
    for (const probe of probes) {
      expect(classifyProbeResult({ ...probe })).toEqual(classifyProbeResult({ ...probe }));
    }

    // The classifier must not consult process.env: a machine's network state or
    // configuration may not change the semantics of a given probe result.
    const source = readFileSync(join(root, "scripts/lib/evidence-d-probe.mjs"), "utf8");
    expect(source).not.toMatch(/process\.env/);

    // The state set is closed, duplicate-free, and exactly partitioned into
    // "justifies an auth conclusion" and "is infrastructure".
    expect(new Set(PROBE_STATES).size).toBe(PROBE_STATES.length);
    expect(PROBE_STATES).toContain("TRANSPORT_BLOCKED");
    const expectedStates = [...AUTH_EVIDENCE_STATES, ...INFRASTRUCTURE_STATES].sort();
    expect([...PROBE_STATES].sort()).toEqual(expectedStates);
    expect(AUTH_EVIDENCE_STATES.filter((s) => INFRASTRUCTURE_STATES.includes(s))).toHaveLength(0);
  });

  it("rejects a classification that claims authentication it cannot have observed", () => {
    const blocked = classifyProbeResult({ httpStatus: 0, transportError: "ECONNRESET" });
    const unauth = classifyProbeResult({ httpStatus: 401 });

    // The Phase 235 defect stated as a fixture: a transport failure laundered
    // into an auth verdict must not validate.
    expect(validateProbeClassification({ ...blocked, state: "UNAUTHENTICATED", isAuthEvidence: true })).not.toEqual([]);
    expect(validateProbeClassification({ ...blocked, state: "AUTHENTICATED", isAuthEvidence: true })).not.toEqual([]);
    expect(validateProbeClassification({ ...blocked, isAuthEvidence: true })).not.toEqual([]);

    // Auth evidence without a reached service is the same violation stated the
    // other way; revocation is never claimable by this probe.
    expect(validateProbeClassification({ ...unauth, reached: false })).not.toEqual([]);
    expect(validateProbeClassification({ ...unauth, isRevocationEvidence: true })).not.toEqual([]);
    expect(validateProbeClassification({ ...unauth, state: "REVOKED" })).not.toEqual([]);
    expect(validateProbeClassification({ ...unauth, httpStatus: 0 })).not.toEqual([]);
    expect(validateProbeClassification({ ...unauth, detail: "" })).not.toEqual([]);
    expect(validateProbeClassification({ ...blocked, layer: null })).not.toEqual([]);
    expect(validateProbeClassification(null)).not.toEqual([]);
    expect(validateProbeClassification("UNAUTHENTICATED")).not.toEqual([]);
  });

  it("keeps the harness dispatching through the shared contract, not inline rules", () => {
    // The harness must not re-derive reachability itself: one classification
    // function, so the fixture matrix above describes what the harness does.
    expect(harnessSource).toMatch(/classifyProbeResult/);
    expect(harnessSource).toMatch(/probeRefusalReason/);
    // No inline reachability rule and no inline refusal wording: if the harness
    // still decided (or phrased) this itself, the fixture matrix above would
    // stop describing what actually runs.
    expect(harnessSource).not.toMatch(/unauth\.httpStatus === 0/);
    expect(harnessSource).not.toMatch(/not an authentication or authorisation result/);
    expect(harnessSource).not.toMatch(/The deployment did not answer/);
    // ...and the refusal wording, asserted behaviourally rather than by grepping
    // the module's source text, does carry that disclaimer.
    const refusal = probeRefusalReason(classifyProbeResult({ httpStatus: 0, transportError: "ENOTFOUND" }), "h");
    expect(refusal).toMatch(/transport failure/i);
    expect(refusal).toMatch(/not an authentication or authorisation result/i);
    // Bounded probing must be reachable, or a guard cannot use it.
    expect(harnessSource).toMatch(/--timeout/);
  });
});

/* ------------------------------------------------------------------ *
 * 5d. Phase 235 — one bounded live probe (smoke, environment-agnostic)
 * ------------------------------------------------------------------ */

/**
 * Exactly one real-socket probe per file, memoised, bounded by `--timeout`.
 *
 * It exists to prove the harness still runs end to end against a real
 * transport — the fixtures above replace `fetch`, so they cannot. It asserts
 * only what holds in EVERY environment: a fake deployment can never be reported
 * ACHIEVED, the refusal shape is coherent, and a transport failure is never
 * described as an authentication result — whichever way this machine's network
 * happens to behave.
 */
let liveProbe: { run: Run; report: HarnessReport } | null = null;

function liveProbeOnce(): { run: Run; report: HarnessReport } {
  if (!liveProbe) {
    const run = runHarness({ ...UNREACHABLE_ENV }, ["--json", "--timeout", "5"]);
    liveProbe = { run, report: parseReport(run) };
  }
  return liveProbe;
}

describe("Phase 235 — the live probe is classified, not assumed", () => {
  it("never reaches ACHIEVED against a deployment that is not a real one", () => {
    const { run, report } = liveProbeOnce();
    // ACHIEVED requires positive evidence from every check, which a wildcard
    // host cannot supply in any environment.
    expect(report.evidenceD).not.toBe("ACHIEVED");
    expect(run.exitCode).not.toBe(0);
  });

  it("keeps its refusal shape coherent, whichever way this machine's network behaves", () => {
    const { run, report } = liveProbeOnce();
    // `refuse()` is the only writer of a top-level reason, and the only path
    // that reports NOT EXECUTED. Tying them together means a transport failure
    // can never arrive as a check verdict, and an executed run can never borrow
    // transport wording — on any machine.
    const refused = report.evidenceD === "NOT EXECUTED";
    expect(report.reason !== undefined).toBe(refused);

    if (refused) {
      expect(run.exitCode).toBe(2);
      expect(report.checks.every((c) => c.status === "BLOCKED")).toBe(true);
      expect(report.reason).toMatch(/transport failure/i);
      expect(report.reason).not.toMatch(/unauthenticated|rejected credential/i);
    } else {
      // Checks ran: the deployment's answer decided at least one status. Other
      // checks may legitimately be BLOCKED — refusing to guess is correct.
      expect(report.checks.some((c) => c.status !== "BLOCKED")).toBe(true);
    }

    // Whether or not the host answered, no check may claim authentication
    // evidence it did not observe: D3 passes only on a reached refusal.
    const d3 = report.checks.find((c) => c.id === "D3");
    if (d3?.status === "PASS") {
      expect(d3.evidence?.resultClass).toBe("UNAUTHENTICATED");
      const withheld = d3.evidence?.resultWithheld;
      const answered401 = d3.evidence?.httpStatus === 401;
      expect(withheld === true || answered401).toBe(true);
    }
    if (d3?.evidence) {
      expect(d3.evidence.resultClass).not.toBe("TRANSPORT_BLOCKED");
    }
  });
});

/* ------------------------------------------------------------------ *
 * 6. Partial runs and honest vocabulary
 * ------------------------------------------------------------------ */

describe("Phase 203 — partial evidence is never reported as complete", () => {
  it("exits non-zero and withholds ACHIEVED whenever anything is unresolved", () => {
    // Phase 208 moved this rule into scripts/lib/evidence-report.mjs, where it
    // is asserted behaviourally (evidence-report-schema.phase208.test.ts).
    // Here we pin only the harness-side contract: the exit code follows the
    // canonical verdict, and ACHIEVED is the sole success condition.
    expect(harnessSource).toMatch(/const complete = report\.evidenceD === "ACHIEVED";/);
    expect(harnessSource).toMatch(/const failed = report\.summary\.failed;/);
    expect(harnessSource).toMatch(/process\.exit\(failed > 0 \? 1 : complete \? 0 : 2\)/);
  });

  it("blocks D1 when the transport cannot deliver mail", () => {
    // The console transport reports delivered:true and sends nothing.
    expect(harnessSource).toContain("XSTARZ_EMAIL_TRANSPORT");
    expect(harnessSource).toMatch(/delivers nothing while reporting success/);
  });

  it("marks an already-used identity NOT_VERIFIED for D4 rather than FAIL", () => {
    // A re-run against a consumed account is an operator condition, not a
    // product defect; reporting FAIL would be a false alarm.
    expect(harnessSource).toMatch(/already consumed \$\{startUsed\}/);
    expect(harnessSource).toMatch(/"D4",\s*\n?\s*"NOT_VERIFIED"/);
  });

  it("never forces a directional signal to make D5 pass", () => {
    expect(harnessSource).toMatch(/is not a chargeable directional/);
    expect(harnessSource).toMatch(/The engine is never forced/);
  });

  it("uses only the approved status vocabulary", () => {
    const statuses = [...harnessSource.matchAll(/record\(\s*"D\d+",\s*\n?\s*"([A-Z_ ]+)"/g)].map(
      (m) => m[1],
    );
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) {
      expect(["PASS", "FAIL", "BLOCKED", "NOT_VERIFIED"]).toContain(s);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 7. Secrets
 * ------------------------------------------------------------------ */

describe("Phase 203 — the harness never emits a secret", () => {
  it("masks the mailbox and withholds session tokens", () => {
    expect(harnessSource).toContain("maskEmail");
    expect(harnessSource).toMatch(/token withheld/);
    // The token is used as a bearer credential but never recorded as evidence.
    expect(harnessSource).not.toMatch(/evidence[^}]*token:/);

    // Behavioural: asserting that maskEmail is *called* does not prove it
    // masks. Execute the implementation and check the address is redacted, so
    // a body rewritten to `return email` is caught.
    const body = /const maskEmail = \(email\) => \{([\s\S]*?)\n\};/.exec(harnessSource);
    expect(body, "maskEmail must be a recognisable single expression").not.toBeNull();
    const maskEmail = new Function("email", body![1]) as (e: string) => string;

    const masked = maskEmail("verylongmailbox@example.com");
    expect(masked).not.toContain("verylongmailbox");
    expect(masked).toContain("***");
    expect(masked).toContain("@example.com");
    expect(maskEmail("nodomain")).toBe("***");
  });

  it("records only whether a session exists, not its value", () => {
    expect(harnessSource).toMatch(/sessionEstablished: Boolean\(token\)/);
  });

  it("the operator documentation carries no credential values", () => {
    const doc = join(root, "docs/EVIDENCE-D.md");
    expect(existsSync(doc)).toBe(true);
    const text = readFileSync(doc, "utf8");

    // A bare length rule flags long SCREAMING_SNAKE identifiers such as
    // CLIENT_UNTRUSTED_EVIDENCE_FIELDS, which are code references, not secrets.
    // Use the repository's established assignment-shaped secret pattern.
    expect(text).not.toMatch(
      /(api[_-]?key|secret|password|bearer|token)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i,
    );
    // No real deployment identity is baked into the operator doc either.
    expect(text).not.toContain("tough-goose-455");
    expect(text).toMatch(/EVIDENCE_D_EMAIL/);
  });
});

/* ------------------------------------------------------------------ *
 * 8. Phase 204 — session continuity and honest failure attribution
 * ------------------------------------------------------------------ */

describe("Phase 204 — D4-D7 run on one identity, and a rejected session cannot pass", () => {
  it("acquires exactly one token and reuses it for every authenticated call", () => {
    // One assignment of `token` per auth mechanism, then read-only afterwards.
    const assignments = [...harnessSource.matchAll(/^\s*token = /gm)];
    expect(assignments.length, "token must be assigned once per auth path").toBe(2);

    // Every authenticated call passes that same `token` binding — there is no
    // second client and no re-auth between D4 and D7.
    for (const call of [
      /readEntitlement\(token\)/,
      /"protectedAnalysis:runProtectedAnalysis",\s*analysisInput\(\),\s*token,?\s*\)/,
      /"entitlements:grantPremium",[\s\S]{0,120}token,/,
    ]) {
      expect(harnessSource).toMatch(call);
    }

    // Stronger than any single regex: every runProtectedAnalysis call after the
    // unauthenticated D3 probe must pass the token. Count them directly.
    const analysisCalls = [
      ...harnessSource.matchAll(/action\(\s*"protectedAnalysis:runProtectedAnalysis",[\s\S]*?\n?\s*\);/g),
    ].map((m) => m[0]);
    expect(analysisCalls.length).toBeGreaterThanOrEqual(5);
    const withoutToken = analysisCalls.filter((c) => !/\btoken\b/.test(c));
    // Exactly one: the deliberate D3 unauthenticated probe.
    expect(withoutToken).toHaveLength(1);
    // The entitlement read helper takes the token explicitly, so D4 cannot
    // silently read anonymously while D5-D7 use a session.
    expect(harnessSource).toMatch(/async function readEntitlement\(token\)/);
    expect(harnessSource).toMatch(/query\("entitlements:getMyEntitlement", \{\}, token\)/);
  });

  it("treats a guest-shaped UNAUTHENTICATED reply as D4 FAIL, not PASS", () => {
    // getMyEntitlement answers unauthenticated callers with plan GUEST /
    // remaining 2 / used 0. Asserting only those three fields passes with no
    // session at all, which is how the first real run reported D4 PASS while
    // the backend rejected every session.
    expect(harnessSource).toMatch(/if \(e0\.authenticated !== true\)/);
    const d4 = harnessSource.slice(
      harnessSource.indexOf("D4: a fresh guest"),
      harnessSource.indexOf("Client cannot self-grant Premium"),
    );
    expect(d4).toMatch(/"D4",\s*\n?\s*"FAIL"/);
    expect(d4).toMatch(/authenticated=\$\{e0\.authenticated\}/);
  });

  it("blocks the remaining observations when the session is not recognised", () => {
    expect(harnessSource).toMatch(/the session was not recognised by the deployment/);
    expect(harnessSource).toMatch(/return \{ sessionRecognised: false \}/);
  });

  it("attributes UNAUTHENTICATED to the session, never to the entitlement rules", () => {
    for (const id of ["D5", "D6", "D7"]) {
      const idx = harnessSource.indexOf(`"${id}",\n      "BLOCKED"`);
      expect(idx, `${id} must have an UNAUTHENTICATED-specific BLOCKED branch`).toBeGreaterThan(0);
    }
    expect(harnessSource).toMatch(/NOT evidence about the entitlement rules/);
    // And it must stop retrying rather than burning attempts on a dead session.
    expect(harnessSource).toMatch(/if \(lastStatus === "UNAUTHENTICATED"\) break;/);

    // The branches must be guarded by a real status test. Asserting only that
    // the BLOCKED text exists passes when the guard is stubbed to `if (false)`,
    // leaving the branch unreachable and D7 free to blame entitlements again.
    const guards = [
      /if \(buyStatus === "UNAUTHENTICATED"\) \{/,
      /if \(waitStatus === "UNAUTHENTICATED"\) \{/,
      /if \(lastStatus === "UNAUTHENTICATED"\) \{/,
    ];
    for (const g of guards) {
      expect(harnessSource, `branch must be guarded by ${g}`).toMatch(g);
    }
    // No unreachable literal guards anywhere in the harness.
    expect(harnessSource).not.toMatch(/if \(false\)/);
  });
});

/* ------------------------------------------------------------------ *
 * 9. Phase 205 — entitlement state machine vs market conditions
 * ------------------------------------------------------------------ */

describe("Phase 205 — a quiet market is NOT_VERIFIED, never FAIL and never forced", () => {
  it("never fabricates a directional recommendation", () => {
    const code = harnessSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // The harness may NAME chargeable values (to classify what the engine
    // returned) but must never send one into the analysis path as input.
    expect(code).not.toMatch(/analysisInput\([^)]*recommendation/s);
    // The E-track legitimately names BUY/SELL when calling the ACCOUNTING
    // mutation — that argument is what the mutation charges against, and it
    // returns no signal. What must never happen is a recommendation being fed
    // into the ANALYSIS path, where it would fake an engine decision.
    const analysisCalls = [
      ...code.matchAll(/runProtectedAnalysis"[\s\S]{0,400}?\n\s{2,4}\);/g),
    ].map((m) => m[0]);
    for (const call of analysisCalls) {
      expect(call, "analysis calls must not carry a recommendation").not.toMatch(
        /recommendation/,
      );
    }
    // Chargeable literals may only reach entitlements:consumeProfitSignal.
    for (const m of code.matchAll(/recommendation:\s*"(BUY|SELL|LONG|SHORT)"/g)) {
      const around = code.slice(Math.max(0, m.index! - 260), m.index! + 120);
      expect(around, "a chargeable literal may only go to the accounting mutation").toMatch(
        /consumeProfitSignal/,
      );
    }
    // forced/fake/stub engine results have no place here.
    expect(code).not.toMatch(/forceRecommendation|fakeSignal|stubEngine/i);
  });

  it("reports D7 NOT_VERIFIED when no chargeable signal occurred", () => {
    const d7 = harnessSource.slice(
      harnessSource.indexOf("D7 + D8: exhaustion"),
      harnessSource.indexOf("Post-exhaustion safety"),
    );
    expect(d7).toMatch(/no real chargeable signal occurred/);
    expect(d7).toMatch(/"D7",\s*\n?\s*"NOT_VERIFIED"/);
    expect(d7).toMatch(/market-condition limitation, not a product defect/);
  });

  it("still FAILS D7 when a chargeable signal occurred but no lock followed", () => {
    // The NOT_VERIFIED branch must be conditional on the absence of a
    // chargeable result — otherwise a genuine entitlement defect would be
    // silently downgraded to "market was quiet".
    const d7 = harnessSource.slice(
      harnessSource.indexOf("D7 + D8: exhaustion"),
      harnessSource.indexOf("Post-exhaustion safety"),
    );
    expect(d7).toMatch(/} else if \(!sawChargeable\) \{/);
    expect(d7).toMatch(/"D7",\s*\n?\s*"FAIL"/);
    expect(d7).toMatch(/the engine produced a chargeable signal/);
    expect(harnessSource).toMatch(/const sawChargeable = observedRecs\.some/);
  });

  it("defines the E-track separately from D1-D10", () => {
    expect(harnessSource).toMatch(/const E_DEFINITIONS = \[/);
    for (const id of ["E1", "E2", "E3", "E4", "E5", "E6"]) {
      expect(harnessSource).toContain(`"${id}"`);
    }
    // D-track definitions must remain exactly ten.
    const dIds = [...harnessSource.matchAll(/\{ id: "(D\d+)", title:/g)].map((m) => m[1]);
    expect(dIds).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"]);
  });

  it("never folds the E-track into the Evidence D verdict", () => {
    // The D verdict must derive ONLY from `checks`. Assert on the exact
    // expressions rather than a source slice: the E-track summary is computed
    // nearby, so a wide slice would match its (legitimate) mentions.
    const verdictLines = [
      // Phase 208: the verdict is computed by buildReport() from the D-track
      // definitions and `checks` only. The E-track is passed as a SEPARATE
      // field and is proven non-contributing in the Phase 208 suite.
      /definitions: D_DEFINITIONS,\n\s*checks,/,
      /const failed = report\.summary\.failed;/,
      /const complete = report\.evidenceD === "ACHIEVED";/,
    ];
    for (const line of verdictLines) {
      expect(harnessSource, `D verdict must be derived by ${line}`).toMatch(line);
    }
    // No E-track array may participate in the D verdict or the exit code.
    expect(harnessSource).not.toMatch(/(?:failed|blocked|notVerified|complete)[^\n]*entitlementChecks/);
    expect(harnessSource).not.toMatch(/evidenceD[^\n]*entitlementChecks/);
    // entitlementChecks reaches the report only through its own named field.
    const entitlementUses = [...harnessSource.matchAll(/^\s*entitlementChecks,?$/gm)];
    expect(entitlementUses.length).toBeGreaterThan(0);
    expect(harnessSource).not.toMatch(/process\.exit\([^)]*entitlement/);
    // And it is still reported, separately.
    // The separate reporting now lives in the canonical schema module, which
    // the harness delegates to. Assert it there rather than deleting the check.
    const schemaSource = readFileSync(join(root, "scripts/lib/evidence-report.mjs"), "utf8");
    expect(schemaSource).toMatch(/entitlementStateMachine/);
    expect(schemaSource).toMatch(/never folded into it|never merged into them/);
    expect(harnessSource).toMatch(/never folded in/);
  });
});

describe("Phase 205 — the E-track uses a legitimate least-privileged boundary", () => {
  it("calls the real deployed public mutation, not an internal function", () => {
    expect(harnessSource).toContain("entitlements:consumeProfitSignal");
    expect(harnessSource).not.toMatch(/protectedAnalysis:resolveCallerId/);
    expect(harnessSource).not.toMatch(/"internal[.:]/);
    // resolveAndConsume appears ONLY as E7's negative control: the deployment
    // must refuse it. Its success is recorded as a FAIL, never relied upon.
    const internalRefs = [...harnessSource.matchAll(/protectedAnalysis:resolveAndConsume/g)];
    expect(internalRefs).toHaveLength(1);
    expect(harnessSource).toMatch(/if \(internalProbe\.ok\) findings\.push\(/);
    // No E-track observation may depend on that call succeeding.
    expect(harnessSource).not.toMatch(/internalProbe\.ok\s*\?\s*"PASS"/);
  });

  it("that boundary is genuinely public, authenticated and accounting-only", () => {
    const server = readFileSync(ENTITLEMENTS, "utf8");
    const body = server.slice(
      server.indexOf("export const consumeProfitSignal"),
      server.indexOf("export const grantPremium"),
    );
    // Public mutation (not internalMutation).
    expect(body).toMatch(/export const consumeProfitSignal = mutation\(/);
    // Authenticated.
    expect(body).toMatch(/if \(!user\) throw new Error\("Unauthenticated/);
    // Returns accounting only — no directional field.
    for (const field of ["tradePlan", "entry", "stopLoss", "takeProfit", "keyLevels"]) {
      expect(body, `consumeProfitSignal must not return ${field}`).not.toContain(`${field}:`);
    }
    // Cannot grant: no PREMIUM assignment anywhere in the handler.
    expect(body).not.toMatch(/plan:\s*"PREMIUM"/);
  });

  it("never grants premium or mutates the database directly", () => {
    const code = harnessSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // grantPremium appears ONCE, as the rejection probe, and must stay a probe.
    // Two probes now: the D-track self-grant probe and E7's non-admin probe.
    // Both assert REFUSAL; neither may be treated as a way to obtain Premium.
    const grants = [...code.matchAll(/entitlements:grantPremium/g)];
    expect(grants).toHaveLength(2);
    expect(code).toMatch(/premiumProbe/);
    expect(code).toMatch(/a non-admin caller was able to grant Premium/);
    expect(code).not.toMatch(/selfGrant\.ok\s*\?\s*"PASS"/);
    expect(code).not.toMatch(/db\.(insert|patch|replace|delete)/);
  });

  it("mints a fresh identity for the E-track instead of reusing a spent one", () => {
    expect(harnessSource).toMatch(/const freshAnon = await action\("auth:signIn", \{ provider: "anonymous" \}\)/);
    expect(harnessSource).toMatch(/needs a pristine identity/);
    // Every E-track read/write must use eToken, not the D-track token.
    const eBlock = harnessSource.slice(
      harnessSource.indexOf("E-TRACK"),
      harnessSource.indexOf("D10: observedAt"),
    );
    const eCalls = [...eBlock.matchAll(/(?:query|mutation)\([^)]*\)/gs)].map((m) => m[0]);
    expect(eCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of eCalls) {
      if (/getMyEntitlement|consumeProfitSignal/.test(c)) {
        expect(c, `E-track call must use eToken: ${c}`).toMatch(/eToken/);
      }
    }
  });

  it("asserts exact deltas rather than 'it changed'", () => {
    expect(harnessSource).toMatch(/s1\.remaining === 1 &&\s*\n?\s*usedOf\(s1\) === 1/);
    expect(harnessSource).toMatch(/s2\.remaining === 0 &&\s*\n?\s*usedOf\(s2\) === 2/);
    expect(harnessSource).toMatch(/usedOf\(afterFree\) === beforeFree/);
  });

  it("verifies the refusal is redacted against the server's protected list", () => {
    const gate = readFileSync(GATE, "utf8");
    const fields = gate
      .slice(
        gate.indexOf("PROTECTED_DECISION_FIELDS = ["),
        gate.indexOf("] as const", gate.indexOf("PROTECTED_DECISION_FIELDS = [")),
      )
      .match(/"([a-zA-Z]+)"/g)!
      .map((s) => s.replace(/"/g, ""));
    const list = harnessSource.slice(
      harnessSource.indexOf("const PROTECTED_FIELDS = ["),
      harnessSource.indexOf("const entitlementChecks"),
    );
    for (const f of fields) {
      expect(list, `E6 must check for leaked "${f}"`).toContain(`"${f}"`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 10. Phase 206 — full state-machine assertions and live authorization
 * ------------------------------------------------------------------ */

describe("Phase 206 — E-track asserts the complete contract", () => {
  it("E1 asserts plan, remaining AND used", () => {
    expect(harnessSource).toMatch(/s0\.authenticated === true &&\s*\n?\s*s0\.plan === "GUEST" &&\s*\n?\s*s0\.remaining === 2 &&\s*\n?\s*usedOf\(s0\) === 0/);
  });

  it("E3 and E4 assert the plan never escalates during consumption", () => {
    expect(harnessSource).toMatch(/s1\.remaining === 1 &&\s*\n?\s*usedOf\(s1\) === 1 &&\s*\n?\s*s1\.plan === "GUEST"/);
    expect(harnessSource).toMatch(/s2\.remaining === 0 &&\s*\n?\s*usedOf\(s2\) === 2 &&\s*\n?\s*s2\.plan === "GUEST"/);
  });

  it("E7 probes a fourth attempt, unauthenticated access, Premium and the internal mutation", () => {
    const e7 = harnessSource.slice(
      harnessSource.indexOf("E7 — the boundary's authorization properties"),
      harnessSource.indexOf("D10: observedAt"),
    );
    expect(e7).toMatch(/const fourth = await eConsume\("BUY"\)/);
    expect(e7).toMatch(/usedOf\(sAfterFourth\) !== 2/);
    expect(e7).toMatch(/consumeProfitSignal accepted an unauthenticated caller/);
    expect(e7).toMatch(/a non-admin caller was able to grant Premium/);
    expect(e7).toMatch(/internal resolveAndConsume was callable from a client/);
  });

  it("every E7 probe asserts a REFUSAL, never a success", () => {
    const e7 = harnessSource.slice(
      harnessSource.indexOf("E7 — the boundary's authorization properties"),
      harnessSource.indexOf("D10: observedAt"),
    );
    // The verdict is PASS only when nothing was found.
    expect(e7).toMatch(/findings\.length === 0 \? "PASS" : "FAIL"/);
    // The internal probe must be checked for NOT being callable.
    expect(e7).toMatch(/internalNotCallable: !internalProbe\.ok/);
    expect(e7).toMatch(/unauthenticatedRejected: !noAuth\.ok/);
  });

  it("the internal-mutation probe exists only as a negative control", () => {
    // It must appear exactly once, inside E7, and its success must be a FAIL.
    // Appears as: the probe call, the finding message, and E7's comment.
    const hits = [...harnessSource.matchAll(/resolveAndConsume/g)];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // But only ONE actual invocation.
    const calls = [...harnessSource.matchAll(/"protectedAnalysis:resolveAndConsume"/g)];
    expect(calls).toHaveLength(1);
    // Whitespace-tolerant: the comment wraps across lines in the source.
    expect(harnessSource).toMatch(/answer with an error,\s*(?:\/\/\s*)?never execute/);
  });

  it("E_DEFINITIONS covers E1-E7 and the unresolved path reports all of them", () => {
    const ids = [...harnessSource.matchAll(/\["(E\d)", "/g)].map((m) => m[1]);
    expect(ids).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
    // A run that cannot mint an identity must still report every E check.
    expect(harnessSource).toMatch(/for \(const \[id, title\] of E_DEFINITIONS\)/);
  });
});

/* ------------------------------------------------------------------ *
 * 11. Phase 207 — live provenance and the natural chargeable sweep
 * ------------------------------------------------------------------ */

describe("Phase 207 — D10 prefers a provider that stamps its own observation", () => {
  it("tries the credential-free OKX order book before the credentialed provider", () => {
    const d10 = harnessSource.slice(
      harnessSource.indexOf("D10: observedAt must come from"),
      harnessSource.indexOf("return { premiumProbe"),
    );
    const okxAt = d10.indexOf("okx:fetchOkxOrderBook");
    const tdAt = d10.indexOf("marketData:fetchMarketData");
    expect(okxAt).toBeGreaterThan(0);
    expect(tdAt).toBeGreaterThan(0);
    expect(okxAt, "OKX must be attempted first").toBeLessThan(tdAt);

    // Order alone is not enough: the OKX result must be the one that feeds the
    // verdict. Renaming the binding (okx -> okxDISABLED) keeps the call in
    // place while silently detaching it, so pin the data flow too.
    expect(d10).toMatch(/const okx = await probe\(/);
    expect(d10).toMatch(/let chosen = okx;/);
    expect(d10).toMatch(/if \(okx\.out\.observedAt === null\) \{/);
  });

  it("only OKX can produce a D10 PASS; the acquisition-stamped provider cannot", () => {
    const d10 = harnessSource.slice(
      harnessSource.indexOf("D10: observedAt must come from"),
      harnessSource.indexOf("return { premiumProbe"),
    );
    // The PASS branch is gated on the OKX path.
    expect(d10).toMatch(/} else if \(chosenLabel === "okx"\) \{/);
    // The fallback provider yields NOT_VERIFIED, never PASS.
    expect(d10).toMatch(/"D10",\s*\n?\s*"NOT_VERIFIED"/);
    expect(d10).toMatch(/stamped at acquisition time/);
  });

  it("the OKX timestamp really is the exchange's own field, not local time", () => {
    // Pin the server-side contract: execution-quality rejects a snapshot whose
    // exchange ts is missing, so observedAt can never silently become Date.now().
    const eq = readFileSync(join(root, "src/lib/execution-quality.ts"), "utf8");
    expect(eq).toMatch(/missing\/invalid exchange timestamp \(ts\)/);
    expect(eq).toMatch(/snapshotTs: ts/);
    const okx = readFileSync(join(root, "src/convex/okx.ts"), "utf8");
    // observedAt is emitted only when the exchange supplied it.
    expect(okx).toMatch(/snapshotTs !== undefined \? \{ observedAt: snapshotTs \} : \{\}/);
  });

  it("rejects a timestamp indistinguishable from the local clock", () => {
    expect(harnessSource).toMatch(/looksLikeLocalClock/);
    // The message spans a string concatenation, so match the two halves.
    expect(harnessSource).toMatch(/indistinguishable from the local request clock/);
    expect(harnessSource).toMatch(/evidence a provider observation/);
    // And the check must actually gate the verdict.
    expect(harnessSource).toMatch(/looksLikeLocalClock \? "FAIL" : "PASS"/);
  });

  it("records a per-provider inventory with failure reasons", () => {
    for (const field of ["provider", "dataset", "instrument", "access", "basis", "acquired", "observedAt", "failure"]) {
      expect(harnessSource, `provider inventory must record ${field}`).toMatch(
        new RegExp(`${field}:`),
      );
    }
    expect(harnessSource).toMatch(/providerAttempts/);
  });
});

describe("Phase 207 — the chargeable sweep is discovery-driven and non-coercive", () => {
  it("sources candidates from the deployment's discovery action, not a hardcoded list", () => {
    expect(harnessSource).toContain("okx:discoverOkxInstruments");
    const sweep = harnessSource.slice(
      harnessSource.indexOf("Natural chargeable-signal search"),
      harnessSource.indexOf("D5: a chargeable recommendation"),
    );
    // No literal instrument whitelist inside the sweep.
    const literals = [...sweep.matchAll(/"[A-Z]{3,}-[A-Z]{3,}"/g)];
    expect(literals, "sweep must not hardcode instrument ids").toHaveLength(0);
    expect(sweep).toMatch(/cand\.instId/);
  });

  it("preserves provider-native identity for every candidate", () => {
    const sweep = harnessSource.slice(
      harnessSource.indexOf("Natural chargeable-signal search"),
      harnessSource.indexOf("D5: a chargeable recommendation"),
    );
    expect(sweep).toMatch(/instrument: cand\.instId/);
    expect(sweep).toMatch(/no symbol substitution/i);
    // No rewriting/normalising of the provider id.
    expect(sweep).not.toMatch(/instId\.(replace|split|toUpperCase|slice)/);
  });

  it("never alters engine inputs to coerce a signal", () => {
    const sweep = harnessSource.slice(
      harnessSource.indexOf("Natural chargeable-signal search"),
      harnessSource.indexOf("D5: a chargeable recommendation"),
    );
    // Assert on CODE only: the header comment legitimately promises not to
    // touch thresholds/bias/confidence, and matching prose would fail on the
    // very sentence documenting the guarantee.
    const sweepCode = sweep
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/^\s*\*.*$/gm, "");
    for (const forbidden of [/threshold/i, /confidence\s*:/, /bias\s*:/]) {
      expect(sweepCode, `sweep must not set ${forbidden}`).not.toMatch(forbidden);
    }
    // `recommendation` appears only as a READ of the engine's response and in
    // the sweep log — never as an input. Pin that distinction precisely: the
    // analysisInput() call must carry no recommendation at all.
    const inputCall = /analysisInput\(\{([\s\S]*?)\n\s{8}\}\)/.exec(sweepCode);
    expect(inputCall, "sweep must build its input via analysisInput").not.toBeNull();
    expect(inputCall![1]).not.toMatch(/recommendation/);
    for (const read of [/const rec = r\.value\?\.result\?\.recommendation/]) {
      expect(sweepCode, "the recommendation must be read from the response").toMatch(read);
    }
    // The only thing it varies is which discovered instrument is analysed.
    expect(sweepCode).toMatch(/instrument: cand\.instId/);
    expect(sweepCode).toMatch(/instrumentType: "crypto"/);
  });

  it("stops at the first natural chargeable result and reports none as NOT_VERIFIED", () => {
    const sweep = harnessSource.slice(
      harnessSource.indexOf("Natural chargeable-signal search"),
      harnessSource.indexOf("D5: a chargeable recommendation"),
    );
    expect(sweep).toMatch(/CHARGEABLE_RECS\.includes\(String\(rec\)\)/);
    expect(sweep).toMatch(/break;/);
    expect(sweep).toMatch(/never FAIL/);
  });

  it("is opt-in, so the default run keeps its previous single-instrument behaviour", () => {
    expect(harnessSource).toMatch(/const sweepLimit = Math\.max\(1, Number\.parseInt\(flag\("--sweep"\) \?\? "1", 10\) \|\| 1\)/);
    expect(harnessSource).toMatch(/if \(sweepLimit > 1\) \{/);
  });

  it("measures the consumption delta for a swept chargeable result", () => {
    expect(harnessSource).toMatch(/chargeableFind\.consumed === 1 \? "PASS" : "FAIL"/);
    expect(harnessSource).toMatch(/consumed: after - before/);
  });
});
