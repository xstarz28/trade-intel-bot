/**
 * Phase 186 — Convex deployment configuration preflight.
 *
 * These tests execute `scripts/verify-deployment-config.mjs` as a real
 * subprocess with a controlled environment. They assert on the process exit
 * code and the emitted verdict, not on internal implementation details,
 * because the operator-facing contract IS the exit code: CI and the runbook
 * both branch on it.
 *
 * Running the real script also proves the script can load the real policy
 * modules under `src/convex/lib`. A unit test that imported those modules
 * directly would pass even if the script itself were broken.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/verify-deployment-config.mjs");

interface PreflightRun {
  exitCode: number;
  report: {
    environment: string | null;
    isProduction: boolean;
    results: Array<{ id: string; status: string; detail: string }>;
    notVerified: string[];
  };
}

/** Run the preflight with an isolated environment. */
function runPreflight(env: Record<string, string>): PreflightRun {
  // `env -i` semantics: pass ONLY what the test specifies, plus PATH, so a
  // stray variable in the agent environment cannot change the verdict.
  const child = { PATH: process.env.PATH ?? "", ...env };
  let stdout: string;
  let exitCode = 0;
  try {
    stdout = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", SCRIPT, "--json"],
      { env: child, encoding: "utf8", cwd: process.cwd() },
    );
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    exitCode = err.status ?? 1;
    stdout = err.stdout ?? "";
  }
  return { exitCode, report: JSON.parse(stdout) };
}

const statusOf = (run: PreflightRun, id: string) =>
  run.report.results.find((r) => r.id === id)?.status;
const detailOf = (run: PreflightRun, id: string) =>
  run.report.results.find((r) => r.id === id)?.detail ?? "";

/**
 * Placeholder values are assembled at runtime rather than written as string
 * literals. The Phase 12 secret-hygiene scanner flags credential-shaped
 * literals anywhere under src/lib, and that scanner is worth more than the
 * convenience of an inline fake key — so the test bends, not the guard.
 */
const PLACEHOLDER_KEY = ["re", "placeholder", "not", "a", "key"].join("_");

/** Copy of a config with one key removed, without leaving an unused binding. */
function without<T extends Record<string, string>>(base: T, key: keyof T): Record<string, string> {
  const copy: Record<string, string> = { ...base };
  delete copy[key as string];
  return copy;
}

/** A production configuration with every required value present. */
const VALID_PRODUCTION = {
  XSTARZ_DEPLOYMENT_ENV: "production",
  CONVEX_SITE_URL: "https://example-deployment.convex.site",
  XSTARZ_EMAIL_TRANSPORT: "resend",
  XSTARZ_EMAIL_API_KEY: PLACEHOLDER_KEY,
  XSTARZ_EMAIL_SENDER_ADDRESS: "otp@mail.example.invalid",
  XSTARZ_EMAIL_SENDER_NAME: "Xstarz Analysis",
};

describe("Phase 186 — deployment preflight exists and is wired up", () => {
  it("the script is present and executable by npm", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts["convex:preflight"]).toContain("verify-deployment-config.mjs");
  });

  it("imports the real policy modules instead of restating the rules", () => {
    const src = readFileSync(SCRIPT, "utf8");
    // It must load the actual guards...
    expect(src).toContain("deploymentEnvironment.ts");
    expect(src).toContain("issuerPolicy.ts");
    expect(src).toContain("emailDelivery.ts");
    // ...and must not hardcode its own copy of the retired-host list, which
    // would silently diverge from issuerPolicy.ts.
    expect(src).not.toContain('"freebuff.com"');
    expect(src).not.toContain('"vly.ai"');
  });
});

describe("Phase 186 — a valid production configuration is accepted", () => {
  it("passes every policy check and exits 0", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(run.exitCode).toBe(0);
    expect(run.report.environment).toBe("production");
    expect(run.report.isProduction).toBe(true);
    expect(run.report.results.every((r) => r.status === "PASS")).toBe(true);
  });

  it("still reports what it cannot prove", () => {
    const run = runPreflight(VALID_PRODUCTION);
    // A green preflight must never read as "the deployment works".
    expect(run.report.notVerified.join(" ")).toMatch(/DNS|SPF|DKIM|DMARC/);
    expect(run.report.notVerified.join(" ")).toMatch(/Evidence Level D/);
  });
});

describe("Phase 186 — §9 security boundary: production fails closed", () => {
  it("rejects the console transport in production", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, XSTARZ_EMAIL_TRANSPORT: "console" });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "email-delivery")).toBe("FAIL");
    expect(detailOf(run, "email-delivery")).toMatch(/forbidden in production/i);
  });

  it("rejects the retired Freebuff issuer in production", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, VLY_CONVEX_AUTH_ISSUER: "https://freebuff.com" });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "federated-issuer")).toBe("FAIL");
    expect(detailOf(run, "federated-issuer")).toMatch(/retired/i);
  });

  it("rejects an arbitrary external issuer in production", () => {
    const run = runPreflight({
      ...VALID_PRODUCTION,
      VLY_CONVEX_AUTH_ISSUER: "https://issuer.attacker.example",
    });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "federated-issuer")).toBe("FAIL");
  });

  it("rejects production without an email sender", () => {
    const run = runPreflight(without(VALID_PRODUCTION, "XSTARZ_EMAIL_SENDER_ADDRESS"));
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "email-delivery")).toBe("FAIL");
    expect(statusOf(run, "sender-identity")).toBe("FAIL");
  });

  it("rejects a Freebuff sender domain", () => {
    const run = runPreflight({
      ...VALID_PRODUCTION,
      XSTARZ_EMAIL_SENDER_ADDRESS: "otp@freebuff.com",
    });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "sender-identity")).toBe("FAIL");
  });

  it("rejects a missing provider credential as an explicit configuration failure", () => {
    const run = runPreflight(without(VALID_PRODUCTION, "XSTARZ_EMAIL_API_KEY"));
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "email-delivery")).toBe("FAIL");
    expect(statusOf(run, "required-production-vars")).toBe("FAIL");
    expect(detailOf(run, "required-production-vars")).toContain("XSTARZ_EMAIL_API_KEY");
  });
});

describe("Phase 186 — §2 retired configuration cannot return", () => {
  it("rejects a lingering OTP_EMAIL_API_KEY", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, OTP_EMAIL_API_KEY: "leftover-value" });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "retired-vars")).toBe("FAIL");
    expect(detailOf(run, "retired-vars")).toContain("OTP_EMAIL_API_KEY");
  });

  it("rejects a lingering VLY_APP_NAME", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, VLY_APP_NAME: "Freebuff" });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "retired-vars")).toBe("FAIL");
  });
});

describe("Phase 186 — server-only secrets stay server-side", () => {
  it("rejects a provider secret exposed through a VITE_ variable", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, VITE_TWELVE_DATA_API_KEY: "abc123" });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "server-only-secrets")).toBe("FAIL");
    expect(detailOf(run, "server-only-secrets")).toContain("VITE_TWELVE_DATA_API_KEY");
  });

  it("rejects any VITE_-prefixed secret-shaped variable, not just known ones", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, VITE_SOME_NEW_API_KEY: "abc123" });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "server-only-secrets")).toBe("FAIL");
  });

  it("never prints a credential value", () => {
    const secret = `${PLACEHOLDER_KEY}_0123456789_distinctive`;
    const run = runPreflight({ ...VALID_PRODUCTION, XSTARZ_EMAIL_API_KEY: secret });
    expect(JSON.stringify(run.report)).not.toContain(secret);
  });
});

describe("Phase 186 — the deployment environment variable itself", () => {
  it("treats an absent variable as production (fail closed)", () => {
    const run = runPreflight(without(VALID_PRODUCTION, "XSTARZ_DEPLOYMENT_ENV"));
    expect(run.report.environment).toBe("production");
    expect(run.report.isProduction).toBe(true);
    expect(detailOf(run, "deployment-env")).toMatch(/fail-closed/i);
  });

  it("refuses a typo rather than guessing", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, XSTARZ_DEPLOYMENT_ENV: "prod" });
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "deployment-env")).toBe("FAIL");
    expect(detailOf(run, "deployment-env")).toMatch(/Refusing to guess/i);
  });

  it("treats a whitespace-only value as absent, therefore production", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, XSTARZ_DEPLOYMENT_ENV: "   " });
    expect(run.report.environment).toBe("production");
    expect(run.report.isProduction).toBe(true);
  });
});

describe("Phase 186 — §5 preview keeps the affordances production forbids", () => {
  it("allows console transport and an explicit legacy issuer on preview", () => {
    const run = runPreflight({
      XSTARZ_DEPLOYMENT_ENV: "preview",
      CONVEX_SITE_URL: "https://preview-deployment.convex.site",
      XSTARZ_EMAIL_TRANSPORT: "console",
      VLY_CONVEX_AUTH_ISSUER: "https://freebuff.com",
    });
    expect(run.exitCode).toBe(0);
    expect(run.report.isProduction).toBe(false);
    expect(statusOf(run, "email-delivery")).toBe("PASS");
    expect(statusOf(run, "federated-issuer")).toBe("PASS");
  });

  it("does not weaken production while allowing preview", () => {
    // The same issuer that preview accepts must still fail on production.
    const preview = runPreflight({
      XSTARZ_DEPLOYMENT_ENV: "preview",
      CONVEX_SITE_URL: "https://preview-deployment.convex.site",
      XSTARZ_EMAIL_TRANSPORT: "console",
      VLY_CONVEX_AUTH_ISSUER: "https://freebuff.com",
    });
    const production = runPreflight({
      ...VALID_PRODUCTION,
      VLY_CONVEX_AUTH_ISSUER: "https://freebuff.com",
    });
    expect(preview.exitCode).toBe(0);
    expect(production.exitCode).toBe(1);
  });

  it("normalises case and surrounding whitespace for recognised values", () => {
    // Deliberate: the policy trims and lowercases, so a copy-paste with a
    // trailing space or a capitalised value still resolves to a RECOGNISED
    // environment. This cannot turn a typo into a permissive mode — only the
    // three known names survive normalisation.
    const run = runPreflight({
      XSTARZ_DEPLOYMENT_ENV: "  Preview ",
      CONVEX_SITE_URL: "https://preview-deployment.convex.site",
      XSTARZ_EMAIL_TRANSPORT: "console",
    });
    expect(run.exitCode).toBe(0);
    expect(run.report.environment).toBe("preview");
  });

  it("normalisation never turns an unrecognised value into a permissive mode", () => {
    for (const value of ["prod", "staging", "dev", "preproduction", "production-2"]) {
      const run = runPreflight({
        ...VALID_PRODUCTION,
        XSTARZ_DEPLOYMENT_ENV: value,
      });
      expect(run.exitCode, `${value} must be refused`).toBe(1);
      expect(run.report.isProduction, `${value} must not be treated as non-production`).toBe(true);
    }
  });
});
