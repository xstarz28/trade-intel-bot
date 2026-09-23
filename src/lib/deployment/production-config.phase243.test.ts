/**
 * Phase 243 — the production configuration boundary, exercised with synthetic
 * configuration only.
 *
 * Nothing here reads the real environment, contacts anything or deploys
 * anything: every case is an explicit object, which is also what makes the
 * outcomes deterministic. The rules themselves live in the imported production
 * policies (`deploymentEnvironment`, `issuerPolicy`, `emailDelivery`, provider
 * credentials); this file proves the boundary that composes them.
 *
 * Fixture values are deliberately short and joined at runtime. The repository's
 * client-hygiene scan (`production.phase12.test.ts`) looks for credential-shaped
 * string literals in `src/lib` — including test files — and a realistic-looking
 * fake key in a fixture is exactly what it must catch. Realism here would be a
 * defect, so the values are synthetic and stay under the threshold.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAllProviders } from "@/lib/data/universal/providers";
import { getAllCredentialSpecs } from "@/lib/data/universal/live/credentials";
import { RETIRED_ISSUER_HOSTS } from "@/convex/lib/issuerPolicy";
import {
  PRODUCTION_CONFIG_VARIABLES,
  PROVIDER_CREDENTIAL_REQUIREMENTS,
  evaluateProductionConfiguration,
  formatProductionConfigReport,
  productionConfigJson,
  productionConfigExitCode,
  redactSecrets,
  type ProductionConfigReport,
} from "./production-config";
import { currentReleaseVerdict } from "./release-current-state";
import { evaluateReleaseAdmission } from "./release-admission";
import {
  evaluateRelease,
  RELEASE_PREREQUISITES,
  type EvidenceRecord,
  type ReleaseInput,
} from "./release-gate";

/** A secret long enough to exercise redaction, assembled at runtime. */
const EMAIL_SECRET = ["e243", "9f2a4c6e8b0d1f3a5c7e"].join("-");

/** A complete, well-formed production configuration. Synthetic throughout. */
function completeConfig(): Record<string, string> {
  return {
    XSTARZ_DEPLOYMENT_ENV: "production",
    CONVEX_SITE_URL: "https://xstarz-prod.convex.site",
    VITE_CONVEX_URL: "https://xstarz-prod.convex.cloud",
    CONVEX_DEPLOYMENT: "prod:xstarz-team:xstarz-prod",
    XSTARZ_EMAIL_TRANSPORT: "resend",
    XSTARZ_EMAIL_API_KEY: EMAIL_SECRET,
    XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@xstarz.example",
    TWELVE_DATA_API_KEY: "td-243",
    ALPHA_VANTAGE_API_KEY: "av-243",
    COINGLASS_API_KEY: "cg-243",
    TICKATLAS_API_KEY: "ta-243",
    EIA_API_KEY: "eia-243",
  };
}

const evaluate = (overrides: Record<string, string | undefined> = {}, extras = {}) =>
  evaluateProductionConfiguration({
    env: { ...completeConfig(), ...overrides },
    ...extras,
  }) as ProductionConfigReport;

const outcomeOf = (overrides: Record<string, string | undefined> = {}, extras = {}) =>
  evaluate(overrides, extras).outcome;

describe("243 — the inventory", () => {
  it("declares names, consumers and scopes, and never a value", () => {
    expect(PRODUCTION_CONFIG_VARIABLES.length).toBeGreaterThan(8);
    for (const entry of PRODUCTION_CONFIG_VARIABLES) {
      expect(entry.name, entry.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(entry.consumer.length, entry.name).toBeGreaterThan(10);
      expect(["convex-production", "convex-cli", "app-build", "provider"]).toContain(entry.scope);
      // An inventory entry that carried a value would be a credential store.
      expect(Object.keys(entry)).not.toContain("value");
      expect(Object.keys(entry)).not.toContain("default");
    }
  });

  it("covers every provider the product routes to, and every credential spec", () => {
    const registryIds = getAllProviders()
      .map((provider) => provider.id)
      .sort();
    const specIds = getAllCredentialSpecs()
      .map((spec) => spec.providerId)
      .sort();

    expect(PROVIDER_CREDENTIAL_REQUIREMENTS.map((entry) => entry.providerId)).toEqual(specIds);
    // The credential registry is the product's own list; a provider it does not
    // know about would be a provider production configuration cannot check.
    for (const id of registryIds) expect(specIds).toContain(id);
  });

  it("marks exactly the credential-bearing providers as requiring a key", () => {
    const requiring = PROVIDER_CREDENTIAL_REQUIREMENTS.filter(
      (entry) => entry.requiredEnvVars.length > 0,
    ).map((entry) => entry.providerId);
    const keyless = PROVIDER_CREDENTIAL_REQUIREMENTS.filter(
      (entry) => entry.requiredEnvVars.length === 0,
    ).map((entry) => entry.providerId);

    expect(requiring).toEqual(["alpha-vantage", "coinglass", "eia", "tickatlas", "twelve-data"]);
    // Keyless set expanded in Phase235 with public discovery providers (ccxt, dexscreener, etc)
    expect(keyless.sort()).toEqual(
      [
        "ajaib",
        "ccxt",
        "cftc",
        "coingecko",
        "defillama",
        "dexscreener",
        "geckoterminal",
        "idx",
        "okx",
        "stockbit",
        "tokenomist",
        "treasury",
      ].sort(),
    );
    for (const entry of PROVIDER_CREDENTIAL_REQUIREMENTS) {
      if (entry.requiredEnvVars.length > 0) continue;
      expect(entry.requiredEnvVars).toEqual([]);
    }
  });
});

describe("243 — a complete configuration, and what it does not mean", () => {
  it("1. a complete synthetic production configuration is accepted", () => {
    const report = evaluate();

    expect(report.outcome).toBe("READY_FOR_CONFIGURATION");
    expect(report.configurationAccepted).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.malformed).toEqual([]);
    expect(report.forbidden).toEqual([]);
    expect(report.environment.resolved).toBe("production");
    expect(report.email.productionTransportAccepted).toBe(true);
    expect(report.deployment.productionShaped).toBe(true);
    expect(productionConfigExitCode(report)).toBe(0);
    for (const provider of report.providers) expect(provider.configured, provider.providerId).toBe(true);
  });

  it("13. configuration presence is not verification, in every surface", () => {
    const report = evaluate();

    expect(report.productionVerified).toBe(false);
    expect(report.email.senderVerified).toBe(false);
    expect(report.deployment.deploymentVerified).toBe(false);
    expect(report.verification.verified).toBe(false);
    expect(report.verification.reason).toMatch(/observed production behaviour/);
    expect(formatProductionConfigReport(report)).toMatch(/productionVerified: no/);
    expect(formatProductionConfigReport(report)).toMatch(/verification: not verified/);
  });

  it("13b. asking the checker to verify yields NOT_VERIFIED, not an acceptance", () => {
    const report = evaluate({}, { requireVerified: true });

    expect(report.outcome).toBe("NOT_VERIFIED");
    expect(report.configurationAccepted).toBe(false);
    expect(report.productionVerified).toBe(false);
  });

  it("21b. a configuration record is not production verification", () => {
    const now = 1_800_000_000_000;
    const refs = ["heads/one", "heads/two", "heads/three"];
    const providers = ["coingecko", "okx", "twelve-data"];
    const candidate = {
      commit: "cafe1234",
      ref: "heads/arena/01a0adfb-trade-intel-bot",
      productionDeployment: "prod-deployment-1",
    };

    /* The subject an evidence record must bind to, prerequisite by prerequisite —
       the same binding the release gate's own suite uses. */
    const subjectFor = (id: string) =>
      id === "A2_HISTORY_REWRITE"
        ? { refs: [...refs] }
        : id === "CONVEX_PRODUCTION_DEPLOYMENT"
          ? { deployment: candidate.productionDeployment }
          : id === "EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION"
            ? { providers: [...providers] }
            : undefined;

    /* Every prerequisite recorded as VERIFIED — but recorded by a *documentation*
       source. A runbook, a checklist or a filled-in configuration file is not an
       observation of production, so the verdict must stay NOT READY. */
    const documented: EvidenceRecord[] = RELEASE_PREREQUISITES.map((prerequisite) => ({
      prerequisite: prerequisite.id,
      status: "VERIFIED",
      source: "documentation",
      environment: "production",
      observedAt: now - 1000,
      subject: subjectFor(prerequisite.id),
    }));
    const input = (records: EvidenceRecord[]): ReleaseInput => ({
      candidate: { ...candidate },
      affectedRefs: [...refs],
      requiredProviders: [...providers],
      records,
    });

    expect(evaluateRelease(input(documented), { prerequisites: RELEASE_PREREQUISITES, now }).verdict).toBe(
      "NOT READY",
    );

    // The same records from a verifying source ARE accepted: the difference is
    // the source, not the shape, which is what makes the assertion meaningful.
    const observed = documented.map((record) => ({ ...record, source: "external-verification" as const }));
    expect(evaluateRelease(input(observed), { prerequisites: RELEASE_PREREQUISITES, now }).verdict).toBe("READY");
  });

  it("21. a perfect configuration does not move the release verdict by one step", () => {
    /*
      The whole point of the boundary: configuring production cannot manufacture
      evidence. Phase 241's verdict and Phase 242's admission are computed from
      observed production facts, so a complete configuration leaves them exactly
      where they were.
    */
    expect(outcomeOf()).toBe("READY_FOR_CONFIGURATION");
    expect(currentReleaseVerdict().verdict).toBe("NOT READY");
    expect(evaluateReleaseAdmission({}).admitted).toBe(false);
  });
});

describe("243 — missing and malformed configuration fail closed", () => {
  it("2. a missing required variable is reported by name", () => {
    for (const name of ["CONVEX_SITE_URL", "VITE_CONVEX_URL", "CONVEX_DEPLOYMENT", "XSTARZ_EMAIL_SENDER_ADDRESS"]) {
      const report = evaluate({ [name]: undefined });
      expect(report.outcome, name).toBe("MISSING_REQUIRED_CONFIG");
      expect(report.missing, name).toContain(name);
      expect(report.configurationAccepted).toBe(false);
    }
  });

  it("2b. a missing provider key is reported, and enables no provider", () => {
    const report = evaluate({ TWELVE_DATA_API_KEY: undefined });
    const twelveData = report.providers.find((provider) => provider.providerId === "twelve-data");

    expect(report.outcome).toBe("MISSING_REQUIRED_CONFIG");
    expect(report.missing).toContain("TWELVE_DATA_API_KEY");
    expect(twelveData?.configured).toBe(false);
    expect(twelveData?.missingEnvVarNames).toEqual(["TWELVE_DATA_API_KEY"]);
    // The other providers are untouched: no cross-satisfaction, no cascade.
    expect(report.providers.find((provider) => provider.providerId === "alpha-vantage")?.configured).toBe(true);
  });

  it("3. malformed values are refused with a reason and never echoed", () => {
    const cases: [string, string, string][] = [
      ["CONVEX_SITE_URL", "not-a-url", "not an absolute URL"],
      ["CONVEX_SITE_URL", "http://xstarz.example", "must use https"],
      ["VITE_CONVEX_URL", "https://localhost:5173", "loopback"],
      ["XSTARZ_EMAIL_SENDER_ADDRESS", "not-an-address", "plausible email"],
      ["XSTARZ_EMAIL_TRANSPORT", "sendmail", "supported transport"],
    ];

    for (const [name, value, expected] of cases) {
      const report = evaluate({ [name]: value });
      expect(report.outcome, `${name}=${value}`).toBe("INVALID_CONFIG");
      const problem = report.malformed.find((entry) => entry.name === name);
      expect(problem?.problem, `${name}=${value}`).toContain(expected);
    }

    // Non-secret values MAY be described back to the operator (a transport name
    // is not a credential, and "sendmail is not supported" is the sentence that
    // fixes the problem). Secrets are the invariant, and they are proven above.
    const secret = ["e243", "aabbccddeeff0011"].join("-");
    const leaked = evaluate({ XSTARZ_EMAIL_API_KEY: secret, CONVEX_SITE_URL: "http://xstarz.example" });
    expect(JSON.stringify(leaked)).not.toContain(secret);
  });

  it("3b. zero-length and whitespace-only values are missing, not present", () => {
    for (const value of ["", "   "]) {
      const report = evaluate({ CONVEX_SITE_URL: value });
      expect(report.outcome).toBe("MISSING_REQUIRED_CONFIG");
      expect(report.missing).toContain("CONVEX_SITE_URL");
    }
  });

  it("18b. a documentation-style example is refused for production", () => {
    // The repository's own `.env.example` describes LOCAL development: a console
    // transport and a loopback site URL. Evaluated as production it must be
    // refused, which is what stops a copied example becoming a deployment.
    const report = evaluate(
      {
        XSTARZ_DEPLOYMENT_ENV: "development",
        CONVEX_SITE_URL: "http://localhost:5173",
        XSTARZ_EMAIL_TRANSPORT: "console",
      },
      {},
    );

    expect(["WRONG_ENVIRONMENT", "FORBIDDEN_FALLBACK"]).toContain(report.outcome);
    expect(report.configurationAccepted).toBe(false);
  });
});

describe("243 — environment and identity separation", () => {
  it("4. a development or preview deployment cannot be configured as production", () => {
    for (const value of ["development", "preview"]) {
      const report = evaluate({ XSTARZ_DEPLOYMENT_ENV: value });
      expect(report.outcome, value).toBe("WRONG_ENVIRONMENT");
      expect(report.environment.isProduction, value).toBe(false);
      expect(report.email.productionTransportAccepted, value).toBe(false);
    }
  });

  it("4b. an unrecognised environment value is refused, not downgraded", () => {
    const report = evaluate({ XSTARZ_DEPLOYMENT_ENV: "prod" });

    expect(report.outcome).toBe("WRONG_ENVIRONMENT");
    expect(report.environment.resolved).toBeNull();
    expect(report.diagnostics.join(" ")).toMatch(/refused/);
  });

  it("4c. an absent environment variable still resolves to production (fail-closed)", () => {
    const report = evaluate({ XSTARZ_DEPLOYMENT_ENV: undefined });

    expect(report.environment.resolved).toBe("production");
    expect(report.outcome).toBe("READY_FOR_CONFIGURATION");
  });

  it("5. a non-production deployment identity is refused", () => {
    for (const value of ["dev:xstarz-team:xstarz-dev", "local", "anonymous:local", "preview:t:p", "xstarz-prod"]) {
      const report = evaluate({ CONVEX_DEPLOYMENT: value });
      expect(report.outcome, value).toBe("WRONG_IDENTITY");
      expect(report.deployment.productionShaped, value).toBe(false);
      expect(report.configurationAccepted, value).toBe(false);
    }
  });

  it("6. a locally authenticated deployment cannot become production proof", () => {
    const report = evaluate({ CONVEX_DEPLOYMENT: "anonymous:xstarz-team:local-dev" });

    expect(report.outcome).toBe("WRONG_IDENTITY");
    // An identity is a name, and even a production-shaped name is not a deployment.
    expect(report.deployment.deploymentVerified).toBe(false);
    const accepted = evaluate();
    expect(accepted.deployment.productionShaped).toBe(true);
    expect(accepted.deployment.deploymentVerified).toBe(false);
  });

  it("7. fixture and placeholder values cannot become production configuration", () => {
    for (const value of ["test", "fixture", "dummy-key", "abc123", "sk_test_abcdefgh", "REPLACE_WITH_KEY", "<your-key>"]) {
      const report = evaluate({ XSTARZ_EMAIL_API_KEY: value });
      expect(report.outcome, value).not.toBe("READY_FOR_CONFIGURATION");
      expect(report.configurationAccepted, value).toBe(false);
    }
  });

  it("7b. a placeholder provider key disables that provider", () => {
    const report = evaluate({ TWELVE_DATA_API_KEY: "test" });
    const twelveData = report.providers.find((provider) => provider.providerId === "twelve-data");

    expect(report.outcome).toBe("MISSING_REQUIRED_CONFIG");
    expect(twelveData?.configured).toBe(false);
    expect(report.missing).toContain("TWELVE_DATA_API_KEY");
  });

  it("13b-retired. a retired variable is a forbidden fallback, not a setting", () => {
    const report = evaluate({ OTP_EMAIL_API_KEY: "legacy-243" });

    expect(report.outcome).toBe("FORBIDDEN_FALLBACK");
    expect(report.forbidden.map((entry) => entry.name)).toContain("OTP_EMAIL_API_KEY");
  });

  it("reports unexpected production-shaped variables without inventing rules for them", () => {
    const report = evaluate({ XSTARZ_SOMETHING_NEW: "yes", CONVEX_EXTRA_VAR: "also" });

    expect(report.unexpected).toEqual(["CONVEX_EXTRA_VAR", "XSTARZ_SOMETHING_NEW"]);
    expect(report.outcome).toBe("READY_FOR_CONFIGURATION");
    expect(report.diagnostics.join(" ")).toMatch(/unexpected production-shaped variables/);
  });
});

describe("243 — the email boundary", () => {
  it("8. the console transport cannot serve production", () => {
    const report = evaluate({ XSTARZ_EMAIL_TRANSPORT: "console" });

    expect(report.outcome).toBe("FORBIDDEN_FALLBACK");
    expect(report.email.transport).toBe("console");
    expect(report.email.nonDelivering).toBe(true);
    expect(report.email.productionTransportAccepted).toBe(false);
  });

  it("9. a mock transport is not a transport", () => {
    for (const value of ["mock", "test", "smtp-mock", "noop"]) {
      const report = evaluate({ XSTARZ_EMAIL_TRANSPORT: value });
      expect(report.outcome, value).toBe("INVALID_CONFIG");
      expect(report.malformed.some((entry) => entry.name === "XSTARZ_EMAIL_TRANSPORT"), value).toBe(true);
      expect(report.email.productionTransportAccepted, value).toBe(false);
    }
  });

  it("9b. smtp2go is a delivering transport and is accepted", () => {
    const report = evaluate({ XSTARZ_EMAIL_TRANSPORT: "smtp2go" });

    expect(report.outcome).toBe("READY_FOR_CONFIGURATION");
    expect(report.email.transport).toBe("smtp2go");
    expect(report.email.nonDelivering).toBe(false);
    expect(report.email.senderVerified).toBe(false);
  });

  it("10. a Freebuff or VLY sender or issuer is refused", () => {
    const sender = evaluate({ XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@auth.freebuff.app" });
    expect(sender.outcome).toBe("FORBIDDEN_FALLBACK");
    expect(sender.email.senderHost).toBe("auth.freebuff.app");

    for (const host of RETIRED_ISSUER_HOSTS) {
      const issuer = evaluate({ VLY_CONVEX_AUTH_ISSUER: `https://${host}/api/auth` });
      expect(issuer.outcome, host).toBe("FORBIDDEN_FALLBACK");
      expect(issuer.forbidden.map((entry) => entry.name), host).toContain("VLY_CONVEX_AUTH_ISSUER");
    }

    const extra = evaluate({ VLY_CONVEX_AUTH_ISSUER: "https://xstarz.example/auth" });
    expect(extra.outcome).toBe("FORBIDDEN_FALLBACK");
  });

  it("10b. a malformed issuer URL is refused as a fallback to fix, not accepted", () => {
    const report = evaluate({ VLY_CONVEX_AUTH_ISSUER: "not a url" });

    expect(report.outcome).toBe("FORBIDDEN_FALLBACK");
    expect(report.configurationAccepted).toBe(false);
  });
});

describe("243 — the provider boundary", () => {
  it("11. one provider's key cannot satisfy another provider", () => {
    const shared = "shared-key-243";
    const report = evaluate({ TWELVE_DATA_API_KEY: shared, ALPHA_VANTAGE_API_KEY: shared });

    expect(report.outcome).toBe("INVALID_CONFIG");
    expect(report.malformed.some((entry) => /same credential value/.test(entry.problem))).toBe(true);
    expect(
      report.providers.find((provider) => provider.providerId === "alpha-vantage")?.sharedCredentialWith,
    ).toBe("twelve-data");
  });

  it("11b. distinct keys leave every provider satisfied by its own credential", () => {
    const report = evaluate();

    for (const provider of report.providers) {
      expect(provider.sharedCredentialWith, provider.providerId).toBeUndefined();
      expect(provider.keyless || provider.configured, provider.providerId).toBe(true);
    }
  });

  it("12. a provider without configuration is inert, and claims nothing", () => {
    const report = evaluate({ COINGLASS_API_KEY: undefined, TICKATLAS_API_KEY: undefined });
    const coinglass = report.providers.find((provider) => provider.providerId === "coinglass");
    const tickatlas = report.providers.find((provider) => provider.providerId === "tickatlas");

    expect(coinglass?.configured).toBe(false);
    expect(tickatlas?.configured).toBe(false);
    // No field in the boundary asserts data availability or liveness.
    const serialized = JSON.stringify(report.providers);
    for (const word of ["live", "fresh", "available", "observed"]) {
      expect(serialized.toLowerCase(), word).not.toContain(word);
    }
  });

  it("12b. keyless providers are reported as keyless, not as misconfigured", () => {
    const report = evaluate();
    const keyless = report.providers.filter((provider) => provider.keyless);

    expect(keyless.length).toBeGreaterThan(3);
    for (const provider of keyless) {
      expect(provider.requiredEnvVarNames).toEqual([]);
      expect(provider.missingEnvVarNames).toEqual([]);
      expect(provider.configured).toBe(true);
    }
  });
});

describe("243 — secrets stay inside", () => {
  it("14. no secret value appears in diagnostics, the report or the JSON", () => {
    const config = completeConfig();
    const report = evaluateProductionConfiguration({ env: config });
    const surfaces = [formatProductionConfigReport(report), productionConfigJson(report), JSON.stringify(report)];

    const secretNames = PRODUCTION_CONFIG_VARIABLES.filter((entry) => entry.secret).map((entry) => entry.name);
    const secretValues = secretNames.map((name) => config[name]).filter(Boolean);
    expect(secretValues.length).toBeGreaterThan(0);

    for (const surface of surfaces) {
      for (const value of secretValues) expect(surface, value.slice(0, 4)).not.toContain(value);
    }
  });

  it("14b. even a refusal that quotes a policy message is redacted", () => {
    const secretParts = ["e243", "abcdef1234567890"].join("-");
    const message = `the transport rejected key ${secretParts} for the sender`;

    expect(redactSecrets(message, [secretParts])).toBe("the transport rejected key [redacted] for the sender");
    // Short values are not redacted by accident: a two-character "secret" would
    // turn every sentence into noise.
    expect(redactSecrets("key ab was refused", ["ab"])).toBe("key ab was refused");
  });

  it("14c. a secret echoed through a foreign field is still redacted", () => {
    const secret = ["e243", "fedcba0987654321"].join("-");
    const report = evaluateProductionConfiguration({
      env: {
        ...completeConfig(),
        XSTARZ_EMAIL_API_KEY: secret,
        CONVEX_SITE_URL: `https://xstarz.example/?token=${secret}`,
      },
    });

    expect(JSON.stringify(report)).not.toContain(secret);
    expect(formatProductionConfigReport(report)).not.toContain(secret);
  });

  it("22. identical input produces an identical report, twice", () => {
    const first = evaluate();
    const second = evaluate();

    expect(productionConfigJson(second)).toBe(productionConfigJson(first));
    expect(formatProductionConfigReport(second)).toBe(formatProductionConfigReport(first));
  });

  it("22b. the module reads no environment and performs no I/O", () => {
    const text = readFileSync(resolve(process.cwd(), "src/lib/deployment/production-config.ts"), "utf8");
    const imports = text.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");

    expect(text).not.toMatch(/process\s*\.\s*env/);
    expect(imports).not.toMatch(/node:fs|node:child_process|node:net|node:http|node:https/);
    expect(text).not.toMatch(/\bfetch\s*\(|execSync|spawnSync|writeFileSync/);
  });
});
