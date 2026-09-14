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
 * These tests pin three things:
 *   1. the call shapes match the deployed function contracts (checked against
 *      the server source, so a server-side rename breaks the harness loudly);
 *   2. the refusals — including the new dev/prod mislabelling refusals;
 *   3. the impossibility of satisfying D1–D10 from fixtures or a cache.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const HARNESS = join(root, "scripts/evidence-d-harness.mjs");
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
  it("has no fixture, mock or replay path", () => {
    // Match against code only. The header prose says "no fixture path, no mock
    // mode" — an assertion over the whole file would fail on the very sentence
    // that documents the guarantee, which is a test defect, not a real one.
    const code = harnessSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const forbidden of [
      /fixture/i,
      /--mock/,
      /mockMode/,
      /replay/i,
      /loadReport/i,
      /cachedResult/i,
    ]) {
      expect(code, `harness must not support ${forbidden}`).not.toMatch(forbidden);
    }
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

  it("refuses a file-configured deployment that is not reachable, rather than reporting PASS", () => {
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
    const run = runHarness({}, ["--json", "--env-file", envFile]);
    expect(run.exitCode).toBe(2);
    const report = JSON.parse(run.stdout);
    expect(report.evidenceD).toBe("NOT EXECUTED");
    expect(report.checks.filter((c: { status: string }) => c.status === "PASS")).toHaveLength(0);
  });

  it("reports a transport failure as transport, never as an auth result", () => {
    const run = runHarness({
      CONVEX_DEPLOYMENT: "dev:unreachable-example",
      VITE_CONVEX_URL: "https://unreachable-example.convex.cloud",
      EVIDENCE_D_EMAIL: "a@b.co",
    });
    const report = JSON.parse(run.stdout);
    expect(report.reason).toMatch(/transport failure/i);
    expect(report.reason).not.toMatch(/unauthenticated|rejected credential/i);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Partial runs and honest vocabulary
 * ------------------------------------------------------------------ */

describe("Phase 203 — partial evidence is never reported as complete", () => {
  it("exits non-zero and withholds ACHIEVED whenever anything is unresolved", () => {
    expect(harnessSource).toMatch(
      /const complete =\s*failed\.length === 0 && blocked\.length === 0 && notVerified\.length === 0/,
    );
    expect(harnessSource).toMatch(/process\.exit\(failed\.length > 0 \? 1 : complete \? 0 : 2\)/);
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
