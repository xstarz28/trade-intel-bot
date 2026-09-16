/**
 * Phase 185b — production auth hardening.
 *
 * Two guards, one principle: a production misconfiguration must fail closed.
 *
 * 1. The `console` email transport reports delivery without delivering. It
 *    must be impossible in production.
 * 2. The retired platform issuer can mint identities. Production must not
 *    trust it even when explicitly configured.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEPLOYMENT_ENV_VAR,
  DeploymentPolicyError,
  allowsDevelopmentAffordances,
  isProductionDeployment,
  resolveDeploymentEnvironment,
} from "./deploymentEnvironment";
import {
  FEDERATED_ISSUER_VAR,
  IssuerPolicyError,
  RETIRED_ISSUER_HOSTS,
  resolveFederatedIssuer,
} from "./issuerPolicy";
import {
  EmailDeliveryError,
  NON_DELIVERING_TRANSPORTS,
  readEmailDeliveryConfig,
  sendXstarzVerificationEmail,
  type FetchLike,
} from "./emailDelivery";

const envOf = (vars: Record<string, string | undefined>) => (key: string) => vars[key];

const REAL_TRANSPORT = {
  XSTARZ_EMAIL_TRANSPORT: "resend",
  XSTARZ_EMAIL_API_KEY: "re_test_value_not_real",
  XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@xstarz-placeholder.invalid",
};

describe("deployment environment resolution", () => {
  it("treats an ABSENT variable as production", () => {
    // The single most important line in this file. If an operator forgets to
    // set the variable on the production deployment, every development
    // affordance must stay off.
    expect(resolveDeploymentEnvironment(envOf({}))).toBe("production");
    expect(isProductionDeployment(envOf({}))).toBe(true);
  });

  it("treats an EMPTY or whitespace variable as production", () => {
    for (const value of ["", "   ", "\t", "\n"]) {
      expect(resolveDeploymentEnvironment(envOf({ [DEPLOYMENT_ENV_VAR]: value }))).toBe("production");
    }
  });

  it("accepts the three known values, case-insensitively", () => {
    const cases: Array<[string, string]> = [
      ["production", "production"],
      ["PRODUCTION", "production"],
      ["preview", "preview"],
      ["Development", "development"],
      ["  development  ", "development"],
    ];
    for (const [input, expected] of cases) {
      expect(resolveDeploymentEnvironment(envOf({ [DEPLOYMENT_ENV_VAR]: input }))).toBe(expected);
    }
  });

  it("REFUSES an unrecognised value rather than downgrading to development", () => {
    // "prod" must not silently become non-production just because it failed an
    // equality check against "production".
    for (const bad of ["prod", "dev", "staging", "true", "1"]) {
      expect(() => resolveDeploymentEnvironment(envOf({ [DEPLOYMENT_ENV_VAR]: bad }))).toThrow(
        DeploymentPolicyError,
      );
    }
  });

  it("only production forbids development affordances", () => {
    expect(allowsDevelopmentAffordances(envOf({}))).toBe(false);
    expect(allowsDevelopmentAffordances(envOf({ [DEPLOYMENT_ENV_VAR]: "preview" }))).toBe(true);
    expect(allowsDevelopmentAffordances(envOf({ [DEPLOYMENT_ENV_VAR]: "development" }))).toBe(true);
  });
});

describe("FINDING 1 — the console transport cannot be used in production", () => {
  it("development + console is allowed", () => {
    const config = readEmailDeliveryConfig(
      envOf({ [DEPLOYMENT_ENV_VAR]: "development", XSTARZ_EMAIL_TRANSPORT: "console" }),
    );
    expect(config.transport).toBe("console");
  });

  it("preview + console is allowed", () => {
    const config = readEmailDeliveryConfig(
      envOf({ [DEPLOYMENT_ENV_VAR]: "preview", XSTARZ_EMAIL_TRANSPORT: "console" }),
    );
    expect(config.transport).toBe("console");
  });

  it("production + console is REJECTED", () => {
    expect(() =>
      readEmailDeliveryConfig(
        envOf({ [DEPLOYMENT_ENV_VAR]: "production", XSTARZ_EMAIL_TRANSPORT: "console" }),
      ),
    ).toThrow(EmailDeliveryError);
  });

  it("console with the environment variable UNSET is rejected (default is production)", () => {
    expect(() => readEmailDeliveryConfig(envOf({ XSTARZ_EMAIL_TRANSPORT: "console" }))).toThrow(
      /forbidden in production/,
    );
  });

  it("production + console produces NO successful delivery result", async () => {
    // The finding was that console returns `delivered: true` without sending.
    // In production that path must not be reachable at all.
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, text: async () => "{}" };
    };

    let result: unknown = "NO RESULT";
    let error: Error | undefined;
    try {
      result = await sendXstarzVerificationEmail(
        { recipient: "user@example.com", otp: "123456", expiryMinutes: 10 },
        { env: envOf({ XSTARZ_EMAIL_TRANSPORT: "console" }), fetchImpl },
      );
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(result).toBe("NO RESULT");
    expect(calls).toHaveLength(0);
  });

  it("production + resend is valid when fully configured", () => {
    const config = readEmailDeliveryConfig(
      envOf({ [DEPLOYMENT_ENV_VAR]: "production", ...REAL_TRANSPORT }),
    );
    expect(config.transport).toBe("resend");
  });

  it("production + smtp2go is valid when fully configured", () => {
    const config = readEmailDeliveryConfig(
      envOf({ [DEPLOYMENT_ENV_VAR]: "production", ...REAL_TRANSPORT, XSTARZ_EMAIL_TRANSPORT: "smtp2go" }),
    );
    expect(config.transport).toBe("smtp2go");
  });

  it("production + missing provider credential is rejected", () => {
    expect(() =>
      readEmailDeliveryConfig(
        envOf({
          [DEPLOYMENT_ENV_VAR]: "production",
          ...REAL_TRANSPORT,
          XSTARZ_EMAIL_API_KEY: undefined,
        }),
      ),
    ).toThrow(/XSTARZ_EMAIL_API_KEY/);
  });

  it("production + missing sender is rejected", () => {
    expect(() =>
      readEmailDeliveryConfig(
        envOf({
          [DEPLOYMENT_ENV_VAR]: "production",
          ...REAL_TRANSPORT,
          XSTARZ_EMAIL_SENDER_ADDRESS: undefined,
        }),
      ),
    ).toThrow(/XSTARZ_EMAIL_SENDER_ADDRESS/);
  });

  it("the non-delivering transport list is accurate", () => {
    // Guards against a future transport being added that also fakes delivery
    // without being covered by the production check.
    expect(NON_DELIVERING_TRANSPORTS).toContain("console");
    for (const transport of NON_DELIVERING_TRANSPORTS) {
      expect(() => readEmailDeliveryConfig(envOf({ XSTARZ_EMAIL_TRANSPORT: transport }))).toThrow();
    }
  });
});

describe("FINDING 2 — production trusts only its own issuer", () => {
  it("1. production + no federated issuer => self-only", () => {
    const decision = resolveFederatedIssuer(envOf({ [DEPLOYMENT_ENV_VAR]: "production" }));
    expect(decision.federated).toBe(false);
  });

  it("2. production + Freebuff issuer => configuration failure", () => {
    expect(() =>
      resolveFederatedIssuer(
        envOf({ [DEPLOYMENT_ENV_VAR]: "production", [FEDERATED_ISSUER_VAR]: "https://freebuff.com" }),
      ),
    ).toThrow(IssuerPolicyError);
  });

  it("2b. production + any Freebuff subdomain or sibling domain => failure", () => {
    for (const issuer of [
      "https://freebuff.com",
      "https://www.freebuff.com",
      "https://auth.freebuff.app",
      "https://freebuff.app",
    ]) {
      expect(() =>
        resolveFederatedIssuer(envOf({ [DEPLOYMENT_ENV_VAR]: "production", [FEDERATED_ISSUER_VAR]: issuer })),
      ).toThrow(/retired platform issuer/);
    }
  });

  it("3. production + VLY issuer => configuration failure", () => {
    expect(() =>
      resolveFederatedIssuer(
        envOf({ [DEPLOYMENT_ENV_VAR]: "production", [FEDERATED_ISSUER_VAR]: "https://vly.ai" }),
      ),
    ).toThrow(/retired platform issuer/);
  });

  it("4. preview + explicitly configured legacy issuer => allowed", () => {
    const decision = resolveFederatedIssuer(
      envOf({ [DEPLOYMENT_ENV_VAR]: "preview", [FEDERATED_ISSUER_VAR]: "https://freebuff.com" }),
    );
    expect(decision.federated).toBe(true);
    if (decision.federated) {
      expect(decision.issuer).toBe("https://freebuff.com");
      expect(decision.jwks).toBe("https://freebuff.com/api/web/.well-known/jwks.json");
    }
  });

  it("4b. development + explicitly configured legacy issuer => allowed", () => {
    const decision = resolveFederatedIssuer(
      envOf({ [DEPLOYMENT_ENV_VAR]: "development", [FEDERATED_ISSUER_VAR]: "https://freebuff.com" }),
    );
    expect(decision.federated).toBe(true);
  });

  it("5. an arbitrary unrelated external issuer is rejected in production", () => {
    // Not on the retired list, still refused: approving a federation partner
    // is an architectural decision, not an environment variable.
    expect(() =>
      resolveFederatedIssuer(
        envOf({ [DEPLOYMENT_ENV_VAR]: "production", [FEDERATED_ISSUER_VAR]: "https://evil.example.com" }),
      ),
    ).toThrow(/trusts only its own issuer/);
  });

  it("6. a malformed issuer fails", () => {
    for (const bad of ["not-a-url", "://missing-scheme", "freebuff.com"]) {
      expect(() =>
        resolveFederatedIssuer(envOf({ [DEPLOYMENT_ENV_VAR]: "preview", [FEDERATED_ISSUER_VAR]: bad })),
      ).toThrow(IssuerPolicyError);
    }
  });

  it("6b. a non-https issuer fails even in preview", () => {
    expect(() =>
      resolveFederatedIssuer(
        envOf({ [DEPLOYMENT_ENV_VAR]: "preview", [FEDERATED_ISSUER_VAR]: "http://freebuff.com" }),
      ),
    ).toThrow(/must use https/);
  });

  it("7. an empty or whitespace issuer is treated as absent => self-only", () => {
    for (const value of ["", "   ", "\n"]) {
      const preview = resolveFederatedIssuer(
        envOf({ [DEPLOYMENT_ENV_VAR]: "preview", [FEDERATED_ISSUER_VAR]: value }),
      );
      expect(preview.federated).toBe(false);
      const production = resolveFederatedIssuer(
        envOf({ [DEPLOYMENT_ENV_VAR]: "production", [FEDERATED_ISSUER_VAR]: value }),
      );
      expect(production.federated).toBe(false);
    }
  });

  it("8. production can never SILENTLY fall back to external federation", () => {
    // Every production route either returns federated:false or throws. None
    // returns a federated decision.
    const attempts = [
      {},
      { [FEDERATED_ISSUER_VAR]: "" },
      { [FEDERATED_ISSUER_VAR]: "https://freebuff.com" },
      { [FEDERATED_ISSUER_VAR]: "https://vly.ai" },
      { [FEDERATED_ISSUER_VAR]: "https://anything.example" },
    ];
    for (const attempt of attempts) {
      let decision: ReturnType<typeof resolveFederatedIssuer> | undefined;
      try {
        decision = resolveFederatedIssuer(envOf({ [DEPLOYMENT_ENV_VAR]: "production", ...attempt }));
      } catch {
        continue; // threw: acceptable, fails closed
      }
      expect(decision?.federated).toBe(false);
    }
  });

  it("defaults to self-only when the environment variable is unset entirely", () => {
    expect(() =>
      resolveFederatedIssuer(envOf({ [FEDERATED_ISSUER_VAR]: "https://freebuff.com" })),
    ).toThrow();
    expect(resolveFederatedIssuer(envOf({})).federated).toBe(false);
  });

  it("the retired-host list covers the platform domains", () => {
    for (const host of ["freebuff.com", "freebuff.app", "vly.ai"]) {
      expect(RETIRED_ISSUER_HOSTS).toContain(host);
    }
  });
});

describe("auth.config.ts uses the policy rather than reading the variable inline", () => {
  const source = readFileSync(join(process.cwd(), "src/convex/auth.config.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("delegates to resolveFederatedIssuer", () => {
    expect(code).toContain("resolveFederatedIssuer");
  });

  it("contains no hardcoded retired issuer", () => {
    for (const host of RETIRED_ISSUER_HOSTS) {
      expect(code).not.toContain(host);
    }
  });

  it("does not build a JWKS URL from a raw environment read", () => {
    // The previous shape was `${process.env.VLY_CONVEX_AUTH_ISSUER}/...`,
    // which bypassed every policy check.
    expect(code).not.toMatch(/process\.env\.VLY_CONVEX_AUTH_ISSUER/);
  });
});

describe("session policy is documented honestly", () => {
  // Read from the library so the documented numbers cannot drift from reality.
  const authLib = join(process.cwd(), "node_modules/@convex-dev/auth/src/server/implementation");

  it("total session duration default is 30 days", () => {
    const src = readFileSync(join(authLib, "sessions.ts"), "utf8");
    expect(src).toContain("DEFAULT_SESSION_TOTAL_DURATION_MS = 1000 * 60 * 60 * 24 * 30");
  });

  it("inactive session duration default is 30 days", () => {
    const src = readFileSync(join(authLib, "refreshTokens.ts"), "utf8");
    expect(src).toContain("DEFAULT_SESSION_INACTIVE_DURATION_MS = 1000 * 60 * 60 * 24 * 30");
  });

  it("JWT duration default is 1 hour", () => {
    const src = readFileSync(join(authLib, "tokens.ts"), "utf8");
    expect(src).toContain("DEFAULT_JWT_DURATION_MS = 1000 * 60 * 60");
  });

  it("the project does not claim forever-login in its auth docs", () => {
    const docs = readFileSync(join(process.cwd(), "docs/AUTHENTICATION.md"), "utf8").toLowerCase();
    expect(docs).toContain("not");
    expect(docs).toContain("forever login");
    // The doc must state sessions expire, not that they never do.
    expect(docs).toMatch(/sessions expire|session expires/);
  });
});

describe("the in-memory throttle is described honestly", () => {
  it("documents that it is per-process and not distributed", () => {
    const src = readFileSync(join(process.cwd(), "src/convex/lib/otpResendThrottle.ts"), "utf8");
    const lower = src.toLowerCase();
    expect(lower).toContain("in-memory and per-process");
    expect(lower).toContain("not prevent distributed");
    expect(lower).toContain("not a complete anti-abuse system");
  });

  it("the auth doc does not claim distributed protection", () => {
    const docs = readFileSync(join(process.cwd(), "docs/AUTHENTICATION.md"), "utf8").toLowerCase();
    expect(docs).toContain("in-memory");
    expect(docs).not.toContain("prevents distributed abuse");
  });
});
