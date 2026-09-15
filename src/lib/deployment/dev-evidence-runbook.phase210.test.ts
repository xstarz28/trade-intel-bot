/**
 * Phase 210 — the DEV Evidence D operator runbook must stay true.
 *
 * A runbook that drifts from the implementation is worse than no runbook: the
 * operator follows it, the command fails or (far worse) silently does
 * something different, and the returned evidence is misattributed.
 *
 * So every command, flag, classification string and exit code the runbook
 * promises is asserted against the real harness, the real report builder and
 * the real package.json. If someone renames a flag or a verdict, these fail.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runbook = readFileSync(join(root, "docs/DEV-EVIDENCE-OPERATOR-RUNBOOK.md"), "utf8");
const harness = readFileSync(join(root, "scripts/evidence-d-harness.mjs"), "utf8");
const schema = readFileSync(join(root, "scripts/lib/evidence-report.mjs"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/** Fenced code blocks, so prose mentioning a flag is not mistaken for an instruction. */
const codeBlocks = [...runbook.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
const allCode = codeBlocks.join("\n");

describe("Phase 210 — the documented commands exist and are spelled correctly", () => {
  it("references the real npm script name", () => {
    expect(pkg.scripts).toHaveProperty("evidence:d");
    expect(runbook).toContain("evidence:d");
    // And the script body the runbook quotes must match package.json exactly.
    expect(runbook).toContain(pkg.scripts["evidence:d"]);
  });

  it("uses Windows-safe entry points in every PowerShell command", () => {
    const invocations = allCode.match(/\b(npm|npx)(\.cmd)?\b/g) ?? [];
    expect(invocations.length).toBeGreaterThan(3);
    for (const inv of invocations) {
      expect(inv, `PowerShell commands must use .cmd (found "${inv}")`).toMatch(/\.cmd$/);
    }
  });

  it("documents the exact deployment-refresh command", () => {
    expect(allCode).toContain("npx.cmd convex dev --once");
  });

  it("documents the exact evidence commands, including the JSON capture", () => {
    expect(allCode).toContain("npm.cmd run evidence:d -- --auth anonymous --sweep 25");
    expect(allCode).toMatch(
      /npm\.cmd run evidence:d -- --auth anonymous --sweep 25 --json > evidence-d-dev\.json/,
    );
    expect(allCode).toContain("$LASTEXITCODE");
  });

  it("installs dependencies the way this project requires", () => {
    expect(allCode).toContain("npm.cmd install --legacy-peer-deps");
    // Never instruct a dependency-tree rewrite.
    expect(allCode).not.toMatch(/npm(\.cmd)? audit fix/);
    expect(runbook).toMatch(/Do not run `npm audit fix`/);
  });

  it("never tells the operator to install unrelated tooling", () => {
    expect(runbook).not.toMatch(/GitHub Desktop/i);
  });
});

describe("Phase 210 — every flag the runbook promises is implemented", () => {
  it.each([
    ["--auth anonymous", /--auth/],
    ["--sweep", /flag\("--sweep"\)/],
    ["--json", /asJson/],
    ["--auto-env", /autoEnv/],
  ])("%s exists in the harness", (documented, implemented) => {
    expect(runbook).toContain(documented.split(" ")[0]);
    expect(harness).toMatch(implemented);
  });

  it("the anonymous provider the runbook relies on is actually registered", () => {
    const auth = readFileSync(join(root, "src/convex/auth.ts"), "utf8");
    expect(auth).toMatch(/Anonymous/);
    expect(harness).toContain('{ provider: "anonymous" }');
  });

  it("the sweep really sources candidates from deployment discovery", () => {
    expect(harness).toContain("okx:discoverOkxInstruments");
    expect(runbook).toContain("okx:discoverOkxInstruments");
    expect(harness).toMatch(/\(i\.state \?\? "live"\) === "live"/);
    expect(runbook).toMatch(/state === "live"/);
  });

  it("D10 is described as OKX-first and credential-free, matching the code", () => {
    expect(harness).toContain("okx:fetchOkxOrderBook");
    const d10 = harness.slice(harness.indexOf("D10: observedAt must come from"));
    expect(d10.indexOf("okx:fetchOkxOrderBook")).toBeLessThan(d10.indexOf("marketData:fetchMarketData"));
    expect(runbook).toMatch(/OKX-first/);
    expect(runbook).toMatch(/credential-free/);
    expect(runbook).toMatch(/within 2 ms of the local clock/);
    expect(harness).toMatch(/Math\.abs\(observedAt - chosen\.startedAt\) < 2/);
  });
});

describe("Phase 210 — documented classifications match the implementation exactly", () => {
  it.each([
    "ACHIEVED",
    "INCOMPLETE",
    "FAILED",
    "NOT EXECUTED",
  ])("verdict %s is produced by the report builder", (verdict) => {
    expect(schema).toContain(`"${verdict}"`);
    expect(runbook).toContain(verdict);
  });

  it("the documented verdict set is exactly the set the builder can emit", () => {
    // R6: asserting each documented verdict exists in the schema is not enough
    // — renaming ACHIEVED to COMPLETE would leave the runbook describing a
    // verdict the builder can no longer produce, and every per-verdict
    // assertion above would still pass for the others. Pin the whole set.
    const evidenceDBlock = schema.slice(
      schema.indexOf("const evidenceD = !executed"),
      schema.indexOf("// The E-track is summarised"),
    );
    const emitted = new Set([...evidenceDBlock.matchAll(/"([A-Z][A-Z ]+)"/g)].map((m) => m[1]));
    expect(emitted).toEqual(new Set(["NOT EXECUTED", "FAILED", "ACHIEVED", "INCOMPLETE"]));
    for (const v of emitted) {
      expect(runbook, `runbook must explain the ${v} verdict`).toContain(v);
    }
    // And the exit-code table must key off the same vocabulary.
    expect(runbook).toMatch(/`ACHIEVED`/);
    expect(runbook).toMatch(/`INCOMPLETE`, refused, or `NOT EXECUTED`/);
  });

  it.each([
    "DEV_VERIFIED — NOT PRODUCTION EVIDENCE",
    "PRODUCTION_EVIDENCE",
    "FIXTURE — NOT EVIDENCE",
  ])("class %s is produced by the harness", (cls) => {
    expect(harness).toContain(cls);
    expect(runbook).toContain(cls);
  });

  it.each(["PASS", "NOT_VERIFIED", "BLOCKED", "FAIL"])(
    "status %s is part of the canonical vocabulary",
    (status) => {
      expect(schema).toContain(`"${status}"`);
      expect(runbook).toContain(status);
    },
  );

  it("documents the exit-code contract the harness actually implements", () => {
    expect(harness).toMatch(/process\.exit\(failed > 0 \? 1 : complete \? 0 : 2\)/);
    expect(runbook).toMatch(/\|\s*\*\*0\*\*\s*\|/);
    expect(runbook).toMatch(/\|\s*\*\*1\*\*\s*\|/);
    expect(runbook).toMatch(/\|\s*\*\*2\*\*\s*\|/);
    // Refusals exit 2, and the runbook must not promise otherwise.
    expect(harness).toMatch(/process\.exit\(2\);/);
  });
});

describe("Phase 210 — the runbook states the honest limits", () => {
  it("separates the E-track verdict from the D verdict", () => {
    expect(runbook).toMatch(/E1–E7 `VERIFIED` does not make D verified/i);
    // And that separation is real in the builder.
    expect(schema).toMatch(/never folded into it/);
  });

  it("states that DEV is not production evidence", () => {
    expect(runbook).toMatch(/does not.{0,40}release-ready/is);
    expect(runbook).toContain("NOT PRODUCTION EVIDENCE");
  });

  it("states that a quiet market leaves D5/D7/D8 NOT_VERIFIED rather than FAIL", () => {
    expect(runbook).toMatch(/D5\/D7\/D8 (may|stay).{0,60}NOT_VERIFIED/is);
    expect(runbook).toMatch(/may ever be converted into a PASS/i);
    // The harness genuinely reports NOT_VERIFIED there.
    expect(harness).toMatch(/"D5",\s*\n?\s*"NOT_VERIFIED"/);
  });

  it("forbids the unsafe operator actions", () => {
    for (const forbidden of [
      /--production-evidence/,
      /--fixture/,
      /localhost/,
      /symbol substitution|Substitute a different instrument/i,
      /Delete or edit `\.env\.local`/,
    ]) {
      expect(runbook, `runbook must warn against ${forbidden}`).toMatch(forbidden);
    }
    // Those refusals are real.
    expect(harness).toMatch(/--production-evidence cannot be combined with --fixture/);
    expect(harness).toMatch(/Production evidence requires an actual production/);
  });
});

describe("Phase 210 — the runbook never asks for a secret", () => {
  it("explicitly forbids returning credentials", () => {
    expect(runbook).toMatch(/Never send/);
    for (const item of ["API keys", "deploy key", "OTP", "token"]) {
      expect(runbook.toLowerCase()).toContain(item.toLowerCase());
    }
  });

  it("never instructs the operator to print or paste .env.local", () => {
    // Test-Path is a presence check and is fine; reading it is not.
    expect(allCode).toContain("Test-Path .env.local");
    expect(allCode).not.toMatch(/Get-Content\s+\.env\.local/i);
    expect(allCode).not.toMatch(/cat\s+\.env\.local/i);
    expect(allCode).not.toMatch(/type\s+\.env\.local/i);
  });

  it("contains no credential-shaped literal of its own", () => {
    expect(runbook).not.toMatch(/(api[_-]?key|secret|password|bearer)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i);
    expect(runbook).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it("tells the operator to scan the output before sending it", () => {
    expect(allCode).toMatch(/Select-String -Path evidence-d-dev\.json/);
    expect(runbook).toMatch(/no matches/i);
  });

  it("warns that the captured report is not covered by .gitignore", () => {
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env\.\*$/m);
    // evidence-d-dev.json is NOT ignored, so the runbook must say to remove it.
    expect(ignore).not.toMatch(/evidence-d-dev\.json/);
    expect(runbook).toMatch(/delete it when you are done|deleted or moved out of the repo/i);
  });
});

describe("Phase 210 — troubleshooting covers the failures this setup can actually hit", () => {
  it.each([
    ["missing .env.local", /T1/],
    ["missing node_modules", /T2/],
    ["PowerShell execution policy", /T3/],
    ["Convex TLS/network failure", /T4/],
    ["missing deployment configuration", /T5/],
    ["deployment mismatch", /T6/],
    ["rate limit", /T7/],
    ["no chargeable signal", /T8/],
    ["expired dev deployment", /T9/],
  ])("covers %s", (_label, marker) => {
    expect(runbook).toMatch(marker);
  });

  it("the execution-policy fix uses the least-privilege scope", () => {
    expect(runbook).toContain("Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned");
    expect(runbook).not.toMatch(/Set-ExecutionPolicy\s+(-Scope\s+LocalMachine|Unrestricted|Bypass)/);
  });

  it("quotes refusal wording that the harness really emits", () => {
    expect(runbook).toMatch(/No deployment is configured/);
    expect(harness).toMatch(/No deployment is configured/);
    expect(runbook).toMatch(/transport failure/);
    expect(harness).toMatch(/This is a transport failure/);
    expect(runbook).toMatch(/Deployment mismatch/);
    expect(harness).toMatch(/Deployment mismatch/);
  });
});

describe("Phase 210 — no obsolete instructions survive", () => {
  it("does not resurrect the pre-Phase-207 single-provider D10 story", () => {
    expect(runbook).not.toMatch(/D10 (is )?(reported )?BLOCKED.{0,60}without a live provider credential/is);
    expect(runbook).not.toMatch(/TWELVE_DATA_API_KEY is required for D10/i);
  });

  it("does not use the pre-Phase-203 argument shape", () => {
    // Analysis args nest under `input`; a runbook telling the operator to pass
    // `--symbol` would be from a harness that no longer exists.
    expect(runbook).not.toMatch(/--symbol\b/);
    expect(runbook).not.toMatch(/--instrument\b/);
  });

  it("does not promise a report field the builder no longer emits", () => {
    const promised = ["providerAttempts", "sweep log", "chargeableFind"].filter((f) =>
      runbook.includes(f),
    );
    expect(promised.length).toBeGreaterThan(0);
    expect(schema).toMatch(/providerEvidence/);
    expect(schema).toMatch(/chargeableFind/);
  });

  it("points at the UAT sections that actually exist", () => {
    const uat = readFileSync(join(root, "docs/UAT-MATRIX.md"), "utf8");
    for (const section of ["35j", "35k"]) {
      expect(runbook).toContain(`§${section}`);
      expect(uat).toContain(`## ${section}.`);
    }
  });

  it("references a commit that is real, and the branch this work lives on", () => {
    expect(runbook).toMatch(/e3ea951/);
    expect(runbook).toContain("arena/01a08e67-trade-intel-bot");
  });
});
