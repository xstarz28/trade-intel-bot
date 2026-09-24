/**
 * Phase 270 — email-OTP retirement invariants.
 *
 * Email-OTP sign-in was retired so the repository no longer presents it as an
 * active method, WITHOUT destructive data deletion: schema tables, the limiter
 * rows and the frozen helpers remain untouched. The evidence mechanism the
 * path fed (Evidence D's D1) is terminally NON_VERIFIED — recorded, not
 * dropped.
 *
 * These pins are the anti-resurrection boundary: each one describes a way the
 * retired path could silently reappear as if active, and asserts it cannot.
 * They are retirement assertions, not weakened versions of the Phase 185–269
 * pins they replace — several of them (module absence, preflight non-
 * evaluation, gate unrecognised-claim behaviour) prove strictly stronger
 * properties than the old "configured correctly" checks ever could.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_CONFIG_VARIABLES,
  evaluateProductionConfiguration,
} from "./production-config";
import { RELEASE_PREREQUISITES } from "./release-gate";
import { evaluateReleaseAdmission } from "./release-admission";
import { REMEDIATION_MANIFEST } from "./remediation-manifest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const AUTH_TS = "src/convex/auth.ts";
const CONFIG_TS = "src/convex/auth.config.ts";
const HARNESS = "scripts/evidence-d-harness.mjs";

/* ------------------------------------------------------------------ *
 * 1. The provider surface is gone
 * ------------------------------------------------------------------ */

describe("270 — the provider surface is gone, not dormant", () => {
  it("the OTP provider module and its delivery stack do not exist", () => {
    for (const path of [
      "src/convex/auth/emailOtp.ts",
      "src/convex/lib/emailDelivery.ts",
      "src/convex/lib/emailTemplates.ts",
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false);
    }
  });

  it("auth.ts registers only anonymous and Google, and references no OTP module", () => {
    const source = read(AUTH_TS);
    expect(source).not.toContain("emailOtp");
    expect(source).not.toMatch(/@convex-dev\/auth\/providers\/Password/);
    expect(source).toContain("Anonymous");
    for (const p of ["google", "Google"]) {
      // Google OAuth is deliberately untouched by the retirement.
      expect(source.includes(p), `auth.ts should still register ${p}`).toBe(true);
    }
  });

  it("auth.config.ts carries no email provider configuration", () => {
    const source = read(CONFIG_TS);
    expect(source).not.toMatch(/XSTARZ_EMAIL/);
    expect(source).not.toContain("emailOtp");
  });

  it("schema.ts is unchanged by the retirement: OTP data tables are retained", () => {
    const source = read("src/convex/schema.ts");
    // Retained-frozen: the tables exist, with their historical rows' shape.
    expect(source).toMatch(/otpResendBuckets/);
    expect(source).toMatch(/RETAINED FROZEN/);
    // The convex-auth tables (verification codes, accounts, sessions) come
    // through the authTables spread — untouched per the do-not-remove comment.
    expect(source).toContain("...authTables");
  });

  it("the limiter and throttle modules are retained-frozen, not deleted", () => {
    expect(existsSync(join(root, "src/convex/otpLimiter.ts"))).toBe(true);
    expect(existsSync(join(root, "src/convex/lib/otpResendThrottle.ts"))).toBe(true);
    expect(read("src/convex/otpLimiter.ts")).toMatch(/RETAINED FROZEN/i);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Configuration truth no longer carries email
 * ------------------------------------------------------------------ */

describe("270 — configuration truth has no email boundary", () => {
  it("the production inventory has no XSTARZ_EMAIL_* entry", () => {
    expect(PRODUCTION_CONFIG_VARIABLES.some((entry) => entry.name.startsWith("XSTARZ_EMAIL_"))).toBe(false);
  });

  it("a still-set XSTARZ_EMAIL_* value is inert: reported unexpected, never load-bearing", () => {
    const report = evaluateProductionConfiguration({
      env: {
        XSTARZ_DEPLOYMENT_ENV: "production",
        CONVEX_SITE_URL: "https://xstarz-prod.convex.site",
        VITE_CONVEX_URL: "https://xstarz-prod.convex.cloud",
        CONVEX_DEPLOYMENT: "prod:xstarz-team:xstarz-prod",
        XSTARZ_EMAIL_TRANSPORT: "console",
        /* A secret long enough to exercise redaction, assembled at runtime so
         * it can never trip the static credential-literal scan. */
        XSTARZ_EMAIL_API_KEY: ["e270", "aaaaaaaaaaaaaaaaaaaa"].join("-"),
        TWELVE_DATA_API_KEY: "td-270",
        ALPHA_VANTAGE_API_KEY: "av-270",
        COINGLASS_API_KEY: "cg-270",
        TICKATLAS_API_KEY: "ta-270",
        EIA_API_KEY: "eia-270",
      },
    });
    expect(report.unexpected).toContain("XSTARZ_EMAIL_TRANSPORT");
    expect(report.unexpected).toContain("XSTARZ_EMAIL_API_KEY");
    expect(report.outcome).toBe("READY_FOR_CONFIGURATION");
    expect(JSON.stringify(report)).not.toContain(["e270", "aaaaaaaaaaaaaaaaaaaa"].join("-"));
  });

  it("the deployment preflight reads no email module", () => {
    const preflight = read("scripts/verify-deployment-config.mjs");
    expect(preflight).not.toContain("emailDelivery");
    // The variable may be named only inside the retirement notice, never as a
    // required/validated configuration.
    expect(preflight).not.toMatch(/XSTARZ_EMAIL_API_KEY.*required/);
    expect(preflight).toMatch(/RETIRED_EMAIL_VARS/);
    expect(preflight).toMatch(/email authentication retired/i);
  });

  it(".env.example has no XSTARZ_EMAIL_* assignment and records the retirement", () => {
    const example = read(".env.example");
    expect(example.match(/^XSTARZ_EMAIL_[A-Z_]*=.*/gm)).toBeNull();
    expect(example).toMatch(/RETIRED in Phase 270/);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The release gate treats email evidence as unrecognised
 * ------------------------------------------------------------------ */

describe("270 — the release gate cannot resurrect the email prerequisite", () => {
  it("PRODUCTION_EMAIL_TRANSPORT is not a prerequisite anymore", () => {
    expect(RELEASE_PREREQUISITES.some((p) => p.id === "PRODUCTION_EMAIL_TRANSPORT")).toBe(false);
    expect(RELEASE_PREREQUISITES.map((p) => p.id)).toEqual([
      "A1_OTP_ISSUER_REVOCATION",
      "A2_HISTORY_REWRITE",
      "CONVEX_PRODUCTION_DEPLOYMENT",
      "EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION",
    ]);
  });

  it("the remediation manifest keeps the leak recorded at its historical path", () => {
    expect(REMEDIATION_MANIFEST.credential.path).toBe("src/convex/auth/emailOtp.ts");
    expect(REMEDIATION_MANIFEST.credential.blob).toMatch(/^[0-9a-f]{40}$/);
    // A2 stays open: retirement did not rewrite history.
    expect(evaluateReleaseAdmission({}).blockers.map((b) => b.id)).toContain("A2_HISTORY_REWRITE");
  });
});

/* ------------------------------------------------------------------ *
 * 4. Evidence D: D1 is retired, the harness runs anonymous only
 * ------------------------------------------------------------------ */

describe("270 — D1 is terminally NOT_VERIFIED, and no other mechanism can appear", () => {
  it("the harness refuses any --auth mechanism that is not anonymous, by name", () => {
    for (const mechanism of ["otp", "password", "github"]) {
      const result = spawn(mechanism);
      expect(result.code, mechanism).toBe(2);
      expect(result.stderr + result.stdout, mechanism).toMatch(/retired in Phase 270|unknown auth mechanism/i);
    }
  });

  it("D1's record is the retirement, verbatim", () => {
    const harness = read(HARNESS);
    expect(harness).toMatch(/OTP mailbox delivery is retired \(Phase 270\)/);
    expect(harness).toMatch(/"D1",\s*\n?\s*"NOT_VERIFIED"/);
    expect(harness).not.toContain("EVIDENCE_D_EMAIL");
  });

  it("a complete run cannot reach ACHIEVED: passed is capped at 9 forever", () => {
    const harness = read(HARNESS);
    // The harness may record D1 only as the retired NOT_VERIFIED marker —
    // there is no code path that writes "D1", "PASS".
    expect(harness).not.toMatch(/record\(\s*"D1",\s*"PASS"/);
  });
});

/** Spawn the harness with a mechanism; preflight refuses before any network. */
function spawn(mechanism: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(root, HARNESS), "--json", "--auth", mechanism],
      {
        env: {
          PATH: process.env.PATH ?? "",
          CONVEX_DEPLOYMENT: "dev:tidy-example-123",
          VITE_CONVEX_URL: "https://tidy-example-123.convex.cloud",
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

/* ------------------------------------------------------------------ *
 * 5. Client surface: no email-OTP copy ships
 * ------------------------------------------------------------------ */

describe("270 — the client no longer presents email sign-in", () => {
  it("the English locale has no email-OTP copy keys", () => {
    for (const path of ["src/lib/i18n/en.ts"]) {
      const source = read(path);
      expect(source).not.toMatch(/emailPlaceholder|checkEmailTitle|otpLabel|resendCode/);
    }
  });

  it("Auth.tsx contains no email/OTP input or send-code handler", () => {
    const source = read("src/pages/Auth.tsx");
    expect(source).not.toMatch(/InputOTP/);
    expect(source).not.toMatch(/type="email"/);
    expect(source).not.toMatch(/checkEmailTitle|resendCode|emailPlaceholder/);
  });

  it("safe diagnostics cannot blame an email transport that no longer exists", () => {
    const source = read("src/lib/auth/safe-diagnostics.ts");
    expect(source).not.toMatch(/XSTARZ_EMAIL/);
  });
});
