/**
 * Phase 243 — secret hygiene for the production-configuration surfaces.
 *
 * The client-hygiene scan in `production.phase12.test.ts` covers `src/`. The
 * files that teach an operator how to configure production — templates, workflow
 * files, scripts, runbooks — are exactly as dangerous and were not covered, so
 * this guard covers them with the project's own credential rule plus one
 * assignment rule aimed at the specific failure mode: a real value pasted into a
 * configuration surface.
 *
 * It reports nothing to redact today, and that is the assertion: the scan is the
 * control, not a cleanup. The historical leaked credential lives in Git history
 * and is owned by A1/A2 — this file does not touch it, and it never rewrites
 * anything.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_CONFIG_VARIABLES } from "./production-config";

const root = process.cwd();

/** The project's existing credential-literal rule (production.phase12). */
const CREDENTIAL_LITERAL =
  /(api[_-]?key|secret|password|bearer)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i;
/** A bearer token pasted into a header inside a config surface. */
const BEARER_HEADER = /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]{20,}/i;

/** The configuration surfaces: everything that tells an operator what to set. */
const CONFIG_SURFACES = [
  ".env.example",
  "scripts/verify-production-config.mjs",
  "scripts/verify-deployment-config.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/mobile.yml",
  ".github/workflows/release-admission.yml",
  "docs/DEPLOYMENT.md",
  "docs/DEPLOYMENT-HANDOFF.md",
  "docs/SECURITY-REMEDIATION.md",
];

const CONFIG_KEYS = [
  ...PRODUCTION_CONFIG_VARIABLES.map((entry) => entry.name),
  "OTP_EMAIL_API_KEY",
  "VLY_APP_NAME",
  "CONVEX_DEPLOY_KEY",
];

const ASSIGNMENT = new RegExp(`\\b(${CONFIG_KEYS.join("|")})\\b\\s*[:=]\\s*([^\\s"',;)]*)`, "g");
const ALLOWED_VALUE =
  /^(|["'`]+|["'`][A-Za-z0-9_ -]*["'`]|your|replace|test|fixture|dummy|example|placeholder|\$\{|\$\{\{|<|\.\.\.|Xstarz$)/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const configSurfaceFiles = (): { path: string; text: string }[] => {
  const files: string[] = [];
  for (const dir of ["scripts", "docs", ".github"]) files.push(...walk(resolve(root, dir)));
  const env = resolve(root, ".env.example");
  if (existsSync(env)) files.push(env);
  return files
    .filter((path) => /\.(mjs|js|sh|yml|yaml|md|json|example)$/.test(path) || path.endsWith(".env.example"))
    .map((path) => ({ path: path.slice(root.length + 1), text: readFileSync(path, "utf8") }));
};

describe("243 — no credential literals in the configuration surfaces", () => {
  it("the project's credential rule finds nothing", () => {
    const offenders = configSurfaceFiles()
      .filter(({ text }) => CREDENTIAL_LITERAL.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("no authorization header carries a token", () => {
    const offenders = configSurfaceFiles()
      .filter(({ text }) => BEARER_HEADER.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("no configuration key is assigned a value anywhere in a surface", () => {
    /*
      The failure this prevents: someone pastes a working key into a runbook "just
      for now", and the next clone carries it. Empty, templated and obviously
      placeholder values are allowed — they are how a template teaches.
    */
    const offenders: string[] = [];
    for (const { path, text } of configSurfaceFiles()) {
      for (const match of text.matchAll(ASSIGNMENT)) {
        const value = match[2] ?? "";
        if (!ALLOWED_VALUE.test(value.trim())) offenders.push(`${path}: ${match[1]}=…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the surfaces that teach configuration all exist", () => {
    for (const path of CONFIG_SURFACES) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
  });

  it("the template keeps every credential empty or explicitly local", () => {
    const template = readFileSync(resolve(root, ".env.example"), "utf8");
    const assignments = [...template.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((match) => ({
      name: match[1],
      value: match[2].trim(),
    }));

    expect(assignments.length).toBeGreaterThan(8);
    for (const { name, value } of assignments) {
      if (/API_KEY|SECRET|TOKEN|PASSWORD/.test(name)) {
        expect(value, name).toBe("");
      }
      expect(CREDENTIAL_LITERAL.test(`${name}=${value}`), name).toBe(false);
    }
    // The template describes LOCAL development; it must not describe production.
    expect(template).toMatch(/XSTARZ_EMAIL_TRANSPORT=console/);
    expect(template).toMatch(/XSTARZ_DEPLOYMENT_ENV=development/);
    expect(template).toMatch(/Never commit real values/);
  });

  it("no `.env` file other than the example is present in the repository", () => {
    const candidates = [
      resolve(root, ".env"),
      resolve(root, ".env.local"),
      resolve(root, ".env.production.local"),
    ].filter((path) => existsSync(path));
    const strays = [
      ...walk(resolve(root, "scripts")),
      ...walk(resolve(root, "docs")),
      ...walk(resolve(root, ".github")),
      ...candidates,
    ]
      .map((path) => path.slice(root.length + 1))
      .filter((path) => /(^|\/)\.env(\.|$)/.test(path) && !path.endsWith(".env.example"));

    expect(strays).toEqual([]);
  });

  it("the inventory carries names and rules, never a value or a default", () => {
    const text = readFileSync(resolve(root, "src/lib/deployment/production-config.ts"), "utf8");
    for (const entry of PRODUCTION_CONFIG_VARIABLES) {
      const assignment = new RegExp(`name:\\s*"${entry.name}"[\\s\\S]{0,400}?value:\\s*"`, "m");
      expect(assignment.test(text), entry.name).toBe(false);
    }
    expect(text).not.toMatch(/=\s*"[A-Za-z0-9]{20,}"/);
  });
});
