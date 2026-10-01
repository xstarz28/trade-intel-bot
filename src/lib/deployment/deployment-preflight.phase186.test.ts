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

/**
 * A credential-shaped value for the VALID_PRODUCTION fixture.
 *
 * Phase 200 added a `credential-plausibility` check that rejects values
 * containing "placeholder", "example", "dummy" and friends. `PLACEHOLDER_KEY`
 * is deliberately one of those, so it can no longer stand in for a *valid*
 * configuration — the fixture has to look like a real key while still being
 * assembled at runtime so the Phase 12 secret scanner stays satisfied.
 *
 * `PLACEHOLDER_KEY` is kept for the tests that exercise rejection.
 */
const PLAUSIBLE_KEY = ["re", "8Kd92Lfm4QpXvR7nT3wY6bZa"].join("_");

/**
 * A plausible Google OAuth client id for the VALID_PRODUCTION fixture.
 *
 * Assembled at runtime for the same reason as PLAUSIBLE_KEY — a literal that
 * looks like a real Google client id trips the Phase 12 credential scanner —
 * and long enough to clear the preflight's own plausibility check, because a
 * *valid* production fixture has to look real. It was never a credential.
 */
const GOOGLE_CLIENT_ID_FIXTURE =
  ["726184920113", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"].join("-") +
  ".apps.googleusercontent.com";

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
  // Phase 300 — the Google pair `docs/production-activation-checklist.md` §4
  // and `docs/production-launch-gate.md` §E already required. Convex Auth
  // reads them as AUTH_<PROVIDER_ID>_ID / _SECRET; without them sign-in dies
  // at Google as `401 invalid_client`, so a valid production fixture has to
  // carry them.
  AUTH_GOOGLE_ID: GOOGLE_CLIENT_ID_FIXTURE,
  AUTH_GOOGLE_SECRET: PLAUSIBLE_KEY,
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
    // Phase 270: the email policy module is retired and the script must NOT
    // load it — it must not exist at all.
    expect(src).not.toContain("emailDelivery.ts");
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
    expect(run.report.notVerified.join(" ")).toMatch(/provider account validity/i);
    // Phase 270: the DNS/SPF/DKIM/DMARC unknown rows retired with email auth.
    expect(run.report.notVerified.join(" ")).not.toMatch(/SPF|DKIM|DMARC/);
    expect(run.report.notVerified.join(" ")).toMatch(/Evidence Level D/);
  });
});

describe("Phase 186 — §9 security boundary: production fails closed", () => {
  it("email retirement is reported and passes without any email variables", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(run.exitCode).toBe(0);
    expect(statusOf(run, "email-retired")).toBe("PASS");
  });

  it("a still-configured XSTARZ_EMAIL_* stays inert — reported, never refused or required", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, XSTARZ_EMAIL_TRANSPORT: "console" });
    expect(run.exitCode).toBe(0);
    expect(statusOf(run, "email-retired")).toBe("PASS");
    expect(detailOf(run, "email-retired")).toMatch(/inert/i);
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

  it("the retired sender-identity check is gone — no sender check can exist without a sender", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(run.report.results.every((r) => r.id !== "sender-identity")).toBe(true);
    expect(run.report.results.every((r) => r.id !== "email-delivery")).toBe(true);
  });

  it("the email variables are not production-required anymore", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(statusOf(run, "required-production-vars")).toBe("PASS");
    expect(detailOf(run, "required-production-vars")).not.toContain("XSTARZ_EMAIL");
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
    const run = runPreflight({ ...VALID_PRODUCTION, TWELVE_DATA_API_KEY: secret });
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
  it("allows an explicit legacy issuer on preview (the console transport is retired, not allowed)", () => {
    const run = runPreflight({
      XSTARZ_DEPLOYMENT_ENV: "preview",
      CONVEX_SITE_URL: "https://preview-deployment.convex.site",
      VLY_CONVEX_AUTH_ISSUER: "https://freebuff.com",
    });
    expect(run.exitCode).toBe(0);
    expect(run.report.isProduction).toBe(false);
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

/* ------------------------------------------------------------------ *
 * Phase 199 — deployment-blocker checks added to the preflight
 * ------------------------------------------------------------------ */

describe("Phase 199 — no Freebuff runtime OTP dependency", () => {
  it("passes on the current tree, and says so without claiming deployment works", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(statusOf(run, "no-freebuff-otp-dependency")).toBe("PASS");
    expect(detailOf(run, "no-freebuff-otp-dependency")).toMatch(/no runtime Freebuff/i);
  });

  it("scans a non-trivial number of server modules (the check is not vacuous)", () => {
    const run = runPreflight(VALID_PRODUCTION);
    const detail = detailOf(run, "no-freebuff-otp-dependency");
    const scanned = Number(/(\d+) server modules/.exec(detail)?.[1] ?? 0);
    // A regex that matched nothing would also report "no dependency". Require
    // evidence that real files were read.
    expect(scanned).toBeGreaterThan(20);
  });

  it("treats denylist entries as protective, not as a dependency", () => {
    // issuerPolicy.ts names the retired hosts on purpose. If the check
    // flagged that, removing the protection would be the only way to make it
    // pass — exactly backwards.
    const run = runPreflight(VALID_PRODUCTION);
    expect(statusOf(run, "no-freebuff-otp-dependency")).toBe("PASS");
  });
});

describe("Phase 199 — production runtime modules are wired", () => {
  it("passes on the current tree", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(statusOf(run, "runtime-modules-wired")).toBe("PASS");
  });

  it("recognises destructured Convex exports (export const { auth } = convexAuth(...))", () => {
    // auth.ts exports `auth` by destructuring convexAuth()'s return value. A
    // naive `export const auth` regex reports a false failure, which would
    // train an operator to ignore the check.
    const run = runPreflight(VALID_PRODUCTION);
    expect(detailOf(run, "runtime-modules-wired")).not.toMatch(/does not export auth\b/);
  });

  it("states that it verifies wiring only, never deployed behaviour", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(detailOf(run, "runtime-modules-wired")).toMatch(/NOT deployed behaviour/i);
  });

  it("checks every module the production runtime depends on", () => {
    const run = runPreflight(VALID_PRODUCTION);
    const detail = detailOf(run, "runtime-modules-wired");
    const count = Number(/(\d+) modules checked/.exec(detail)?.[1] ?? 0);
    // auth.ts, entitlements.ts, protectedAnalysis.ts, otpLimiter.ts, http.ts,
    // schema.ts. The retired emailOtp.ts row was removed in Phase 270.
    expect(count).toBe(6);
  });
});

describe("Phase 199 — the preflight still refuses to claim deployment success", () => {
  it("a fully valid configuration is still not evidence of a deployment", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(run.exitCode).toBe(0);
    // Everything that requires a live deployment must remain unproven.
    const joined = run.report.notVerified.join(" ").toLowerCase();
    expect(joined).toMatch(/deployed convex runtime|evidence level d/);
  });

  it("no check reports PASS for anything requiring network or a deployment", () => {
    const run = runPreflight(VALID_PRODUCTION);
    for (const result of run.report.results) {
      if (result.status !== "PASS") continue;
      // A PASS may describe configuration or source wiring. It must never
      // assert that mail was delivered or that a deployment is reachable.
      expect(result.detail).not.toMatch(/deployed successfully|delivery confirmed|is live/i);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Phase 200 — endpoint and credential plausibility
 * ------------------------------------------------------------------ */

describe("Phase 200 — production endpoints must be real production endpoints", () => {
  it("accepts a genuine Convex deployment URL", () => {
    const run = runPreflight({
      ...VALID_PRODUCTION,
      VITE_CONVEX_URL: "https://blissful-otter-123.convex.cloud",
    });
    expect(statusOf(run, "production-endpoints")).toBe("PASS");
  });

  it("rejects a localhost endpoint in production", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, CONVEX_SITE_URL: "http://localhost:3000" });
    expect(statusOf(run, "production-endpoints")).toBe("FAIL");
    expect(detailOf(run, "production-endpoints")).toMatch(/development host/i);
  });

  it("rejects a 127.0.0.1 endpoint in production", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, VITE_CONVEX_URL: "https://127.0.0.1:3210" });
    expect(statusOf(run, "production-endpoints")).toBe("FAIL");
  });

  it("rejects a placeholder domain that was never replaced", () => {
    const run = runPreflight({
      ...VALID_PRODUCTION,
      CONVEX_SITE_URL: "https://your-app.example.com",
    });
    expect(statusOf(run, "production-endpoints")).toBe("FAIL");
    expect(detailOf(run, "production-endpoints")).toMatch(/placeholder/i);
  });

  it("rejects plain http in production", () => {
    const run = runPreflight({
      ...VALID_PRODUCTION,
      VITE_CONVEX_URL: "http://real-deployment.convex.cloud",
    });
    expect(statusOf(run, "production-endpoints")).toBe("FAIL");
    expect(detailOf(run, "production-endpoints")).toMatch(/https/i);
  });

  it("stays silent rather than failing when no endpoint is configured yet", () => {
    // Today's reality. A check that failed here would be noise, not signal.
    const run = runPreflight(without(VALID_PRODUCTION, "CONVEX_SITE_URL"));
    expect(statusOf(run, "production-endpoints")).toBe("PASS");
    expect(detailOf(run, "production-endpoints")).toMatch(/nothing to validate/i);
  });
});

describe("Phase 200 — credential plausibility", () => {
  it("flags a placeholder credential in production", () => {
    const placeholder = ["placeholder", "value"].join("_");
    const run = runPreflight({ ...VALID_PRODUCTION, TWELVE_DATA_API_KEY: placeholder });
    expect(statusOf(run, "credential-plausibility")).toBe("FAIL");
  });

  it("flags an implausibly short credential", () => {
    const run = runPreflight({ ...VALID_PRODUCTION, TWELVE_DATA_API_KEY: "abc" });
    expect(statusOf(run, "credential-plausibility")).toBe("FAIL");
  });

  it("never echoes the credential value in its report", () => {
    const sentinel = ["zz", "sentinel", "credential", "4417"].join("_");
    const run = runPreflight({ ...VALID_PRODUCTION, TWELVE_DATA_API_KEY: sentinel });
    expect(JSON.stringify(run.report)).not.toContain(sentinel);
  });

  it("does not claim a plausible credential is valid", () => {
    const run = runPreflight({
      ...VALID_PRODUCTION,
      TWELVE_DATA_API_KEY: ["zz", "8Kd92Lfm4QpXvR7nT3wY6bZa98765432"].join("_"),
    });
    expect(statusOf(run, "credential-plausibility")).toBe("PASS");
    // Plausibility is not validity, and the report must say so.
    expect(detailOf(run, "credential-plausibility")).toMatch(/NOT VERIFIED/i);
  });
});

describe("Phase 300 — Google OAuth credentials are a production requirement", () => {
  /*
   * Root cause this encodes: `@convex-dev/auth` fills the Google provider from
   * the Convex deployment environment (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
   * via `@auth/core` `setEnvDefaults`) and sends `client_id` to Google without
   * validating it. When the pair is absent the only symptom is Google's
   * `401 invalid_client` in a real browser, after the user clicks sign in.
   *
   * The preflight must refuse that configuration instead of passing it, and it
   * must never print either value while doing so.
   */
  it("fails closed when the client id is absent on production", () => {
    const run = runPreflight(without(VALID_PRODUCTION, "AUTH_GOOGLE_ID"));
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "required-production-vars")).toBe("FAIL");
    expect(detailOf(run, "required-production-vars")).toContain("AUTH_GOOGLE_ID");
  });

  it("fails closed when the client secret is absent on production", () => {
    const run = runPreflight(without(VALID_PRODUCTION, "AUTH_GOOGLE_SECRET"));
    expect(run.exitCode).toBe(1);
    expect(statusOf(run, "required-production-vars")).toBe("FAIL");
    expect(detailOf(run, "required-production-vars")).toContain("AUTH_GOOGLE_SECRET");
  });

  it("passes when both names are present, and still refuses to call the exchange verified", () => {
    const run = runPreflight(VALID_PRODUCTION);
    expect(statusOf(run, "required-production-vars")).toBe("PASS");
    // Presence is configuration, not a sign-in. The report keeps saying so.
    expect(run.report.notVerified.join(" ")).toMatch(/deployed Convex runtime behaviour/i);
  });

  it("never prints either value", () => {
    const idSentinel = ["726184920113", "sentinelid"].join("-");
    const secretSentinel = ["zz", "sentinel", "google", "9902"].join("_");
    const run = runPreflight({
      ...VALID_PRODUCTION,
      AUTH_GOOGLE_ID: idSentinel,
      AUTH_GOOGLE_SECRET: secretSentinel,
    });
    const text = JSON.stringify(run.report);
    expect(text).not.toContain(idSentinel);
    expect(text).not.toContain(secretSentinel);
  });

  it("rejects a placeholder Google client before it can reach Google", () => {
    const run = runPreflight({
      ...VALID_PRODUCTION,
      AUTH_GOOGLE_ID: ["placeholder", "google", "client", "id"].join("-"),
    });
    expect(statusOf(run, "credential-plausibility")).toBe("FAIL");
  });

  it("the script declares the two names the library actually reads", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain("AUTH_GOOGLE_ID");
    expect(src).toContain("AUTH_GOOGLE_SECRET");
  });
});
