/**
 * Phase 242 — the release entry points, and the shadow gates that are not there.
 *
 * The audit that opened this phase asked one question of every path that could
 * admit, package, publish or describe a release: *which* readiness check does it
 * use, and can it disagree with the canonical one? This suite is the audit,
 * encoded, so the answer cannot rot.
 *
 * Most of these are source guards, and that is deliberate: CI wiring, workflow
 * triggers and package scripts cannot be executed from the sandbox, and a review
 * of prose cannot be re-run. Where behaviour CAN be exercised locally it is
 * exercised in `release-admission.phase242.test.ts` instead; this file only holds
 * the structure that has no runnable behaviour. Each guard names what it is
 * protecting against, so a future reader can tell a real regression from a
 * wording preference.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROOF_PATHS } from "./release-current-state";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

const CI = ".github/workflows/ci.yml";
const MOBILE = ".github/workflows/mobile.yml";
const RELEASE_WORKFLOW = ".github/workflows/release-admission.yml";

describe("242 — the entry-point map covers every path that could admit a release", () => {
  it("every mapped entry point exists", () => {
    const mapped = [
      CI,
      MOBILE,
      RELEASE_WORKFLOW,
      "package.json",
      "scripts/verify-deployment-config.mjs",
      "scripts/verify-history-clean.mjs",
      "scripts/verify-mobile-artifacts.mjs",
      "src/lib/deployment/release-gate.ts",
      "src/lib/deployment/release-current-state.ts",
      "src/lib/deployment/release-admission.ts",
      "docs/RELEASE-GATE.md",
    ];
    for (const path of mapped) expect(existsSync(resolve(root, path)), path).toBe(true);
  });

  it("the repository has NO production deployment entry point, and says so", () => {
    // Phase 186/234 stopped at "configuration present, deployment not performed".
    // There is no deploy command to attach an admission check to, so the boundary
    // is enforced at the nearest layer that exists (the release workflow and the
    // operator preflight) rather than by inventing a deployment step.
    const scripts = readJson("package.json").scripts as Record<string, string>;
    const commands = Object.values(scripts).join("\n");

    expect(commands).not.toMatch(/convex deploy|tauri build.*--release|gh release|npm publish/);
    for (const workflow of [CI, MOBILE, RELEASE_WORKFLOW]) {
      const body = read(workflow);
      expect(body, workflow).not.toMatch(/npx convex deploy|gh release create|npm publish/);
    }
  });

  it("no workflow deploys, and none can declare a release", () => {
    for (const workflow of [CI, MOBILE]) {
      const body = read(workflow);
      expect(body, workflow).not.toMatch(/release:admission|RELEASE_ADMISSION/);
    }
  });
});

describe("242 — the release workflow is fail-closed and release-scoped", () => {
  const workflow = read(RELEASE_WORKFLOW);

  it("runs on the release boundary only — tags and manual dispatch, never a branch push", () => {
    const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\njobs:"));
    expect(triggers).toMatch(/workflow_dispatch:/);
    expect(triggers).toMatch(/tags:/);
    // Ordinary development pushes must not run a job whose failure is "the
    // release is blocked" — that is how a red pipeline stops meaning anything.
    expect(triggers).not.toMatch(/branches:/);
    expect(triggers).not.toMatch(/^\s{2}pull_request:/m);
  });

  it("verifies the gate logic and enforces admission as two distinct jobs", () => {
    const jobs = workflow.slice(workflow.indexOf("\njobs:"));
    const jobNames = [...jobs.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((match) => match[1]);

    expect(jobNames).toEqual(expect.arrayContaining(["gate-logic", "release-admission"]));

    const gateLogic = jobs.slice(jobs.indexOf("  gate-logic:"), jobs.indexOf("  release-admission:"));
    expect(gateLogic).toMatch(/npm run release:gate-verify/);
    expect(gateLogic).not.toMatch(/RELEASE_ADMISSION=require/);

    const boundary = jobs.slice(jobs.indexOf("  release-admission:"));
    expect(boundary).toMatch(/npm run release:admission/);
    expect(boundary).toMatch(/node-version/);
  });

  it("admission is enforced, not advisory", () => {
    const boundary = workflow.slice(workflow.indexOf("  release-admission:"));
    // `continue-on-error` on the boundary job would turn the gate into a report.
    expect(boundary).not.toMatch(/continue-on-error/);
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  });

  it("needs no secrets, no provider call and no external remediation", () => {
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/convex|resend|smtp2go|api[_-]?key/i);
  });
});

describe("242 — dev CI cannot be read as readiness, and is not forced red", () => {
  it("the ordinary test job does not run any release check", () => {
    const ci = read(CI);
    expect(ci).not.toMatch(/release:admission|release:gate-verify|RELEASE_ADMISSION/);
    // The pipeline states its own limits; if that comment is removed the claim
    // "green CI means the tests passed" is still true, but the disclaimer that
    // the run cannot overstate readiness is what keeps it from being misread.
    expect(ci).toMatch(/cannot produce a green check that overstates readiness/);
  });

  it("packaging jobs keep stating that an unsigned artifact is not a release", () => {
    const mobile = read(MOBILE);
    expect(mobile).toMatch(/does NOT constitute release or store readiness/);
    expect(mobile).not.toMatch(/gh release|action-gh-release|publish/);
  });

  it("the operator preflight is a configuration gate, not a release verdict", () => {
    const preflight = read("scripts/verify-deployment-config.mjs");

    expect(preflight).toMatch(/configuration REJECTED/);
    expect(preflight).not.toMatch(/\brelease[- ]ready\b/i);
    expect(preflight).not.toMatch(/\badmitted\b/);
  });
});

describe("242 — nothing outside the canonical layer can issue a release verdict", () => {
  /** Code files that are allowed to mention a release verdict, and why. */
  const VERDICT_PRODUCERS = [
    "src/lib/deployment/release-gate.ts", // the evaluator
    "src/lib/deployment/release-current-state.ts", // the evidence reader
    "src/lib/deployment/release-admission.ts", // the admission operation
  ];

  it("only the canonical layer assigns a release verdict", () => {
    const offenders: string[] = [];
    for (const file of walk(resolve(root, "src"))) {
      // Source only: a `.bak`, `.orig` or scratch copy of a source file is not
      // part of the program, and treating it as source makes the guard fail for
      // reasons that have nothing to do with the code.
      if (!/\.tsx?$/.test(file)) continue;
      if (/\.test\.tsx?$/.test(file)) continue;
      const relative = file.slice(root.length + 1);
      if (VERDICT_PRODUCERS.includes(relative)) continue;
      const text = readFileSync(file, "utf8");
      if (/verdict\s*[:=]\s*["'`](READY|NOT READY)["'`]/.test(text)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it("every other 'ready' in production code is an unrelated domain status", () => {
    /*
      Phase B classification, encoded. Each entry is a file that contains the
      word "ready" and has nothing to do with releasing: a data-coverage flag, the
      application's boot phase, a scanner-input comment, UI copy and a locale
      completeness flag. A file that is not on this list and contains the word is
      a new readiness-ish surface, and the failure is the prompt to classify it
      rather than to rename it.
    */
    const DOMAIN_STATUS = [
      "src/lib/data/universal/coverage.ts",
      "src/lib/runtime/diagnostics.ts",
      "src/lib/discovery/pipeline.ts",
      "src/lib/i18n/en.ts",
      "src/lib/i18n/de.ts",
      "src/lib/i18n/es.ts",
      "src/lib/i18n/fr.ts",
      "src/lib/i18n/locales.ts",
      ...VERDICT_PRODUCERS,
      // Phase 244: READY_TO_REVOKE / READY_TO_REWRITE are operator preconditions
      // for the A1/A2 remediation, and every report hardcodes `verified: false`,
      // so this layer never issues a release verdict.
      "src/lib/deployment/remediation-readiness.ts",
    ];

    const unclassified: string[] = [];
    for (const file of walk(resolve(root, "src"))) {
      if (!/\.tsx?$/.test(file)) continue;
      if (/\.test\.tsx?$/.test(file)) continue;
      const relative = file.slice(root.length + 1);
      if (DOMAIN_STATUS.includes(relative)) continue;
      if (/\bready\b/i.test(readFileSync(file, "utf8"))) unclassified.push(relative);
    }
    expect(unclassified).toEqual([]);
  });

  it("a document can never be a proof: every proof path is machine-readable JSON", () => {
    for (const path of Object.values(PROOF_PATHS)) expect(path).toMatch(/\.json$/);
    expect(Object.values(PROOF_PATHS).some((path) => /\.md$/.test(path))).toBe(false);
  });

  it("no script or workflow decides anything by reading the gate document", () => {
    const readers: string[] = [];
    for (const file of [...walk(resolve(root, "scripts")), ...walk(resolve(root, ".github"))]) {
      const relative = file.slice(root.length + 1);
      if (!/\.(mjs|js|sh|yml|yaml)$/.test(relative)) continue;
      const text = readFileSync(file, "utf8");
      if (/RELEASE-GATE\.md/.test(text) && !relative.includes("mutation-suite")) readers.push(relative);
    }
    expect(readers).toEqual([]);
  });
});

describe("242 — the package scripts name the three modes", () => {
  const scripts = readJson("package.json").scripts as Record<string, string>;

  it("the gate, the boundary and the report are separate commands", () => {
    expect(scripts["release:gate-verify"]).toContain("release-admission.boundary.phase242.test.ts");
    expect(scripts["release:gate-verify"]).not.toContain("require");
    expect(scripts["release:admission"]).toContain("RELEASE_ADMISSION=require");
    expect(scripts["release:admission"]).toContain("release-admission.boundary.phase242.test.ts");
    expect(scripts["release:report"]).toContain("RELEASE_ADMISSION=report");
  });

  it("the boundary command is not part of the default test run", () => {
    // `npm test` runs every spec, including the boundary spec in verify mode; it
    // must not run it in require mode, or development CI would go red for an
    // external blocker.
    expect(scripts.test).toBe("vitest run");
    expect(scripts.test).not.toContain("RELEASE_ADMISSION");
  });
});

/** Recursive listing without adding a dependency. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
