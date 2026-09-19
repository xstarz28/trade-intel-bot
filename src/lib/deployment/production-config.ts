/**
 * Phase 243 — the production configuration boundary.
 *
 * Answers one question, and only one: *would this configuration be accepted for a
 * production deployment?* It does not deploy, does not call anything, and does not
 * verify anything. Configuration presence is not production verification, and the
 * report says so in the same breath as everything else it says.
 *
 * Three design rules, each of which the Phase 243 suites and mutation run enforce:
 *
 * 1. **The real policies decide.** This module imports `deploymentEnvironment.ts`,
 *    `issuerPolicy.ts`, `emailDelivery.ts` and the provider credential specs from
 *    the code that runs in production. A second copy of the rules would drift and
 *    produce a confident, wrong acceptance — the exact failure this phase exists
 *    to prevent.
 * 2. **No environment access, no I/O.** The environment arrives as an explicit
 *    object. Nothing here reads the ambient process environment, touches the
 *    filesystem, opens a socket or spawns a process, so the same input always
 *    produces the same report, and the module is safe to import from anywhere.
 * 3. **Secrets never leave.** Values of variables classified `secret` are used
 *    for presence and equality checks and are then discarded; every message —
 *    including messages raised by the imported policies — is passed through
 *    `redactSecrets` before it can reach a report.
 */
import {
  DEPLOYMENT_ENV_VAR,
  DeploymentPolicyError,
  resolveDeploymentEnvironment,
  type DeploymentEnvironment,
} from "../../convex/lib/deploymentEnvironment";
import {
  FEDERATED_ISSUER_VAR,
  IssuerPolicyError,
  RETIRED_ISSUER_HOSTS,
  resolveFederatedIssuer,
} from "../../convex/lib/issuerPolicy";
import {
  EmailDeliveryError,
  FORBIDDEN_DELIVERY_HOSTS,
  NON_DELIVERING_TRANSPORTS,
  isPlausibleEmailAddress,
  readEmailDeliveryConfig,
} from "../../convex/lib/emailDelivery";
import { getAllCredentialSpecs } from "../data/universal/live/credentials";

/** The only target this phase configures. */
export const PRODUCTION_TARGET = "production" as const;

/**
 * The outcomes an operator can receive. `READY_FOR_CONFIGURATION` is the best
 * available answer and it is NOT a claim that production is verified — no
 * configuration outcome is. `NOT_VERIFIED` is what an operator gets when they ask
 * the checker to prove verification, which it never can.
 */
export const CONFIGURATION_OUTCOMES = [
  "READY_FOR_CONFIGURATION",
  "MISSING_REQUIRED_CONFIG",
  "INVALID_CONFIG",
  "WRONG_ENVIRONMENT",
  "WRONG_IDENTITY",
  "FORBIDDEN_FALLBACK",
  "NOT_VERIFIED",
] as const;
export type ConfigurationOutcome = (typeof CONFIGURATION_OUTCOMES)[number];

export interface ConfigVariable {
  name: string;
  /** Never printed, never returned, never included in a diagnostic. */
  secret: boolean;
  /** Which subsystem consumes it, for the inventory table. */
  consumer: string;
  /** Where it has to be set. */
  scope: "convex-production" | "convex-cli" | "app-build" | "provider";
  requiredInProduction: boolean;
  /** A value that must NOT be present in production (a fallback, not a setting). */
  forbiddenInProduction?: boolean;
  /** How the checker validates it, when a shape check applies. */
  shape?: "https-url" | "deployment-identity" | "email-address" | "transport" | "issuer-url";
}

/** Variables that must never come back — retired in Phase 185 and before it. */
export const RETIRED_CONFIG_VARIABLES: readonly string[] = ["OTP_EMAIL_API_KEY", "VLY_APP_NAME"];

/**
 * The configuration inventory (Phase A). Names, consumers, scopes and rules —
 * no values, and nothing invented: every entry is consumed by code that exists.
 */
export const PRODUCTION_CONFIG_VARIABLES: readonly ConfigVariable[] = [
  {
    name: DEPLOYMENT_ENV_VAR,
    secret: false,
    consumer: "deployment environment policy (fail-closed: absent means production)",
    scope: "convex-production",
    requiredInProduction: false,
  },
  {
    name: "CONVEX_SITE_URL",
    secret: false,
    consumer: "authentication callback / site origin",
    scope: "convex-production",
    requiredInProduction: true,
    shape: "https-url",
  },
  {
    name: FEDERATED_ISSUER_VAR,
    secret: false,
    consumer: "legacy federated sign-in issuer",
    scope: "convex-production",
    requiredInProduction: false,
    forbiddenInProduction: true,
    shape: "issuer-url",
  },
  {
    name: "XSTARZ_EMAIL_TRANSPORT",
    secret: false,
    consumer: "email delivery transport selection",
    scope: "convex-production",
    requiredInProduction: true,
    shape: "transport",
  },
  {
    name: "XSTARZ_EMAIL_API_KEY",
    secret: true,
    consumer: "email delivery transport credential",
    scope: "convex-production",
    requiredInProduction: true,
  },
  {
    name: "XSTARZ_EMAIL_SENDER_ADDRESS",
    secret: false,
    consumer: "email sender identity (must be Xstarz-owned)",
    scope: "convex-production",
    requiredInProduction: true,
    shape: "email-address",
  },
  {
    name: "XSTARZ_EMAIL_SENDER_NAME",
    secret: false,
    consumer: "email display name",
    scope: "convex-production",
    requiredInProduction: false,
  },
  {
    name: "VITE_CONVEX_URL",
    secret: false,
    consumer: "client-side Convex endpoint (build-time, publicly visible)",
    scope: "app-build",
    requiredInProduction: true,
    shape: "https-url",
  },
  {
    name: "CONVEX_DEPLOYMENT",
    secret: false,
    consumer: "Convex CLI deployment identity",
    scope: "convex-cli",
    requiredInProduction: true,
    shape: "deployment-identity",
  },
];

/** Provider credentials, derived from the live credential registry — not copied. */
export const PROVIDER_CREDENTIAL_REQUIREMENTS: readonly {
  providerId: string;
  requiredEnvVars: readonly string[];
}[] = getAllCredentialSpecs()
  .map((spec) => ({ providerId: spec.providerId, requiredEnvVars: [...spec.requiredEnvVars] }))
  .sort((a, b) => a.providerId.localeCompare(b.providerId));

/**
 * Values that look like a placeholder, a fixture or a test credential. This is a
 * heuristic for catching a configuration MAINSTREAM mistake ("someone pasted the
 * fixture"), not a security control: a real key that happens to match would be
 * reported as suspicious, which is the direction an operator wants to err.
 */
const PLACEHOLDER_PATTERNS: readonly { pattern: RegExp; problem: string }[] = [
  { pattern: /^(test|mock|fixture|dummy|fake|sample|example|placeholder|changeme|todo|xxx+)$/i, problem: "value is a placeholder" },
  { pattern: /^(your|my|replace)[-_ ]/i, problem: "value is a template placeholder" },
  { pattern: /^(test|mock|fixture|dummy|fake|sample|example|placeholder|changeme)[-_]/i, problem: "value is a placeholder" },
  { pattern: /^replace_with/i, problem: "value is a template placeholder" },
  { pattern: /^(sk|xk|pk)_test_/i, problem: "value is a test-mode credential" },
  { pattern: /(^|[-_])test[-_]?(key|token|secret|credential)/i, problem: "value names itself a test credential" },
  { pattern: /<[a-z0-9_-]+>/i, problem: "value still contains an angle-bracket placeholder" },
  { pattern: /^(abc|abc123|123|1234|secret|password|apikey|api_key)$/i, problem: "value is a well-known throwaway" },
];

/** Providers whose key must never be reused for another provider. */
const KEYLESS_PROVIDER_NOTE = "public endpoint: no credential required";

export interface ProductionConfigRequest {
  /** The environment to evaluate. Explicit: this module reads no ambient environment. */
  env: Readonly<Record<string, string | undefined>>;
  /** What the operator intends to configure. Only production is supported. */
  target?: string;
  /**
   * Ask the checker to prove production verification. It never can, so this
   * always yields NOT_VERIFIED — which is the point of offering it.
   */
  requireVerified?: boolean;
}

export type VariableState = "present" | "missing" | "forbidden-present";

export interface ConfigPresence {
  name: string;
  consumer: string;
  scope: ConfigVariable["scope"];
  secret: boolean;
  requiredInProduction: boolean;
  state: VariableState;
}

export interface ConfigProblem {
  name: string;
  /** A sentence an operator can act on. Never contains a value. */
  problem: string;
}

export interface EmailBoundary {
  transport: string | null;
  /** A transport that reports success without delivering. */
  nonDelivering: boolean;
  /** True only when a delivering transport was accepted for production. */
  productionTransportAccepted: boolean;
  senderHost: string | null;
  /** Always false: no delivery is observed by a configuration check. */
  senderVerified: false;
}

export interface DeploymentBoundary {
  /** The identity as declared, when it is well-formed enough to report. */
  declared: string | null;
  /** True only for a `prod:` deployment identity. */
  productionShaped: boolean;
  /** Always false: a name is not a deployment. */
  deploymentVerified: false;
}

export interface ProviderBoundary {
  providerId: string;
  requiredEnvVarNames: readonly string[];
  configured: boolean;
  missingEnvVarNames: readonly string[];
  keyless: boolean;
  /** Present when the same value is used by more than one provider. */
  sharedCredentialWith?: string;
}

export interface ProductionConfigReport {
  outcome: ConfigurationOutcome;
  /** True only for READY_FOR_CONFIGURATION. */
  configurationAccepted: boolean;
  /** Always false. Configuration is not production verification. */
  productionVerified: false;
  target: string;
  environment: {
    resolved: DeploymentEnvironment | null;
    isProduction: boolean;
    /** Why the environment resolved the way it did, or why it could not. */
    detail: string;
  };
  presence: readonly ConfigPresence[];
  missing: readonly string[];
  malformed: readonly ConfigProblem[];
  forbidden: readonly ConfigProblem[];
  /** Production-shaped variables nobody declared in the inventory. */
  unexpected: readonly string[];
  email: EmailBoundary;
  deployment: DeploymentBoundary;
  providers: readonly ProviderBoundary[];
  /** Redacted, ordered, operator-facing. */
  diagnostics: readonly string[];
  verification: { verified: false; reason: string };
}

/* ── helpers ────────────────────────────────────────────────────────────── */

const INVENTORY = new Map(PRODUCTION_CONFIG_VARIABLES.map((entry) => [entry.name, entry]));

/** Replace every occurrence of a secret value with a fixed marker. */
export function redactSecrets(message: string, secretValues: readonly string[]): string {
  let out = message;
  for (const value of secretValues) {
    if (!value || value.length < 8) continue;
    out = out.split(value).join("[redacted]");
  }
  return out;
}

const present = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

function placeholderProblem(value: string): string | null {
  const trimmed = value.trim();
  for (const { pattern, problem } of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) return problem;
  }
  return null;
}

function urlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "not an absolute URL";
  }
  if (url.protocol !== "https:") return "must use https";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "[::1]") {
    return "points at a loopback host, which cannot be reached from production";
  }
  return null;
}

function issuerProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "not an absolute URL";
  }
  if (url.protocol !== "https:") return "must use https";
  const host = url.hostname.toLowerCase();
  const retired = RETIRED_ISSUER_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`));
  return retired ? `uses a retired issuer host (${RETIRED_ISSUER_HOSTS.join(", ")})` : null;
}

const DEPLOYMENT_IDENTITY_PATTERN = /^prod:[a-z0-9-]+:[a-z0-9-]+$/i;
const NON_PRODUCTION_DEPLOYMENT_PREFIX = /^(dev|local|anonymous|preview)[:-]/i;

function deploymentIdentityProblem(value: string): string | null {
  const trimmed = value.trim();
  if (NON_PRODUCTION_DEPLOYMENT_PREFIX.test(trimmed)) {
    return "names a development, preview or local deployment, not a production one";
  }
  if (!DEPLOYMENT_IDENTITY_PATTERN.test(trimmed)) {
    return "is not a `prod:<team>:<project>` deployment identity";
  }
  return null;
}

/** Names that are production-shaped but not in the inventory. */
const PRODUCTION_SHAPED = /^(CONVEX|XSTARZ)_[A-Z0-9_]+$|_API_KEY$|_SECRET$|_TOKEN$/;

/* ── the evaluation ─────────────────────────────────────────────────────── */

/**
 * Evaluate a configuration for production. Pure: same input, same report, no
 * clock, no environment, no I/O.
 */
export function evaluateProductionConfiguration(
  request: ProductionConfigRequest,
): ProductionConfigReport {
  const env = request.env;
  const target = (request.target ?? PRODUCTION_TARGET).trim().toLowerCase();
  const readEnv = (key: string): string | undefined => env[key];

  const secretValues = PRODUCTION_CONFIG_VARIABLES.filter((entry) => entry.secret)
    .map((entry) => env[entry.name])
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const problems: ConfigProblem[] = [];
  const forbidden: ConfigProblem[] = [];
  const missing: string[] = [];
  const diagnostics: string[] = [];
  const say = (line: string) => diagnostics.push(redactSecrets(line, secretValues));

  /* The target itself: only production is configured here, and an operator who
     asks for another target is told so rather than quietly served production. */
  if (target !== PRODUCTION_TARGET) {
    say(`target "${target}" is not supported; this checker configures production only`);
  }

  /* 1. The environment policy, imported rather than re-implemented. */
  let resolved: DeploymentEnvironment | null = null;
  let environmentDetail = "not resolved";
  let environmentFailure: string | null = null;
  try {
    resolved = resolveDeploymentEnvironment(readEnv);
    const isProduction = resolved === "production";
    environmentDetail = isProduction
      ? `${DEPLOYMENT_ENV_VAR} resolves to production (absent means production)`
      : `${DEPLOYMENT_ENV_VAR} resolves to ${resolved}, which is not production`;
    say(environmentDetail);
  } catch (error) {
    environmentFailure =
      error instanceof DeploymentPolicyError ? error.message : "environment policy refused the configuration";
    say(`environment refused: ${environmentFailure}`);
  }

  /* 2. The issuer policy, imported rather than re-implemented. */
  let issuerRefusal: string | null = null;
  try {
    const decision = resolveFederatedIssuer(readEnv);
    if (decision.federated) {
      issuerRefusal = "a federated (legacy platform) issuer is configured for production";
      say(`issuer refused: ${issuerRefusal}`);
    } else {
      say(`issuer: ${decision.reason}`);
    }
  } catch (error) {
    issuerRefusal =
      error instanceof IssuerPolicyError ? error.message : "issuer policy refused the configuration";
    say(`issuer refused: ${issuerRefusal}`);
  }

  /* 3. Per-variable presence and shape. */
  const presence: ConfigPresence[] = [];
  for (const entry of PRODUCTION_CONFIG_VARIABLES) {
    const raw = env[entry.name];
    const isPresent = present(raw);
    const state: VariableState = isPresent
      ? entry.forbiddenInProduction
        ? "forbidden-present"
        : "present"
      : "missing";
    presence.push({
      name: entry.name,
      consumer: entry.consumer,
      scope: entry.scope,
      secret: entry.secret,
      requiredInProduction: entry.requiredInProduction,
      state,
    });

    if (!isPresent) {
      if (entry.requiredInProduction) missing.push(entry.name);
      continue;
    }

    if (entry.forbiddenInProduction) {
      forbidden.push({
        name: entry.name,
        problem: "a legacy federated issuer must not be configured on a production deployment",
      });
      continue;
    }

    const value = (raw ?? "").trim();
    const placeholder = placeholderProblem(value);
    if (placeholder && entry.secret) {
      problems.push({ name: entry.name, problem: placeholder });
      continue;
    }
    if (entry.shape === "https-url") {
      const problem = urlProblem(value);
      if (problem) problems.push({ name: entry.name, problem });
    } else if (entry.shape === "issuer-url") {
      const problem = issuerProblem(value);
      if (problem) problems.push({ name: entry.name, problem });
    } else if (entry.shape === "email-address" && !isPlausibleEmailAddress(value)) {
      problems.push({ name: entry.name, problem: "is not a plausible email address" });
    } else if (entry.shape === "deployment-identity") {
      const problem = deploymentIdentityProblem(value);
      if (problem) problems.push({ name: entry.name, problem });
    } else if (entry.shape === "transport") {
      const known = ["resend", "smtp2go", ...NON_DELIVERING_TRANSPORTS];
      if (!known.includes(value as never)) {
        problems.push({ name: entry.name, problem: `is not a supported transport (${known.join(", ")})` });
      }
    }
  }

  /* 4. Retired variables, and production-shaped variables nobody declared. */
  const unexpected: string[] = [];
  for (const name of Object.keys(env).sort()) {
    if (!present(env[name])) continue;
    if (RETIRED_CONFIG_VARIABLES.includes(name)) {
      forbidden.push({ name, problem: "retired variable: it must not be configured again" });
      continue;
    }
    if (INVENTORY.has(name)) continue;
    if (PROVIDER_CREDENTIAL_REQUIREMENTS.some((requirement) => requirement.requiredEnvVars.includes(name))) {
      continue;
    }
    if (PRODUCTION_SHAPED.test(name)) unexpected.push(name);
  }
  if (unexpected.length > 0) {
    say(`unexpected production-shaped variables are configured: ${unexpected.join(", ")}`);
  }

  /* 5. The email boundary, decided by the real email policy. */
  let email: EmailBoundary = {
    transport: null,
    nonDelivering: false,
    productionTransportAccepted: false,
    senderHost: null,
    senderVerified: false,
  };
  const declaredTransport = (env["XSTARZ_EMAIL_TRANSPORT"] ?? "").trim() || null;
  const declaredSender = (env["XSTARZ_EMAIL_SENDER_ADDRESS"] ?? "").trim();
  const declaredSenderHost = declaredSender.includes("@")
    ? (declaredSender.split("@")[1] ?? "").toLowerCase()
    : null;
  const senderHostForbidden =
    declaredSenderHost !== null &&
    FORBIDDEN_DELIVERY_HOSTS.some(
      (host) => declaredSenderHost === host || declaredSenderHost.endsWith(`.${host}`),
    );
  if (senderHostForbidden) {
    forbidden.push({
      name: "XSTARZ_EMAIL_SENDER_ADDRESS",
      problem: "a sender on a retired third-party domain must not send production email",
    });
    say(`email sender host ${declaredSenderHost} is a retired third-party domain`);
  }
  /* The refusal reason, kept so ONE rule can judge the delivery boundary below
     instead of each exit path deciding for itself. */
  let emailRefusal: string | null = null;
  try {
    const config = readEmailDeliveryConfig(readEnv);
    const nonDelivering = NON_DELIVERING_TRANSPORTS.includes(config.transport);
    email = {
      transport: config.transport,
      nonDelivering,
      // The email policy refuses the console transport in production, so a
      // transport that got this far is delivering. Recorded as a fact either way.
      productionTransportAccepted: resolved === "production" && !nonDelivering,
      senderHost: config.senderAddress.includes("@")
        ? config.senderAddress.split("@")[1].toLowerCase()
        : null,
      senderVerified: false,
    };
    say(`email transport: ${config.transport}${nonDelivering ? " (delivers nothing)" : ""}`);
  } catch (error) {
    const reason =
      error instanceof EmailDeliveryError
        ? error.message
        : "the email policy refused the configuration";
    email = {
      transport: declaredTransport,
      nonDelivering:
        declaredTransport !== null &&
        NON_DELIVERING_TRANSPORTS.includes(declaredTransport as never),
      productionTransportAccepted: false,
      senderHost: senderHostForbidden ? declaredSenderHost : null,
      senderVerified: false,
    };
    emailRefusal = reason;
    say(`email refused: ${reason}`);
  }

  /*
    The delivery boundary, decided once over the resulting transport:
    a transport that delivers nothing, or one the policy refuses as
    production-forbidden, may not serve production email. This is deliberately a
    second, independent decision — the boundary must not depend on the email
    policy being the only layer that refuses a silent fallback.
  */
  const nonDelivering = email.nonDelivering;
  const locallyScoped = emailRefusal !== null && /forbidden in production/i.test(emailRefusal);
  if (nonDelivering || locallyScoped) {
    forbidden.push({
      name: "XSTARZ_EMAIL_TRANSPORT",
      problem: "a non-delivering or locally-scoped transport must not serve production email",
    });
    say(`email delivery refused: ${email.transport ?? declaredTransport ?? "unnamed transport"} delivers nothing`);
  } else if (emailRefusal !== null && (declaredTransport !== null || present(env["XSTARZ_EMAIL_SENDER_ADDRESS"]))) {
    problems.push({ name: "XSTARZ_EMAIL_TRANSPORT", problem: emailRefusal.replace(/\s+/g, " ") });
  }

  /* 6. The deployment boundary. A name is not a deployment. */
  const declaredDeployment = (env["CONVEX_DEPLOYMENT"] ?? "").trim() || null;
  const deployment: DeploymentBoundary = {
    declared: declaredDeployment,
    productionShaped:
      declaredDeployment !== null && deploymentIdentityProblem(declaredDeployment) === null,
    deploymentVerified: false,
  };
  say(
    deployment.productionShaped
      ? "deployment identity is production-shaped; no deployment is verified by configuration"
      : "deployment identity is not production-shaped",
  );

  /* 7. The provider boundary: per-provider keys, no cross-substitution. */
  const seenValues = new Map<string, string>();
  /** providerId -> the other provider sharing its credential value. */
  const sharedGroups = new Map<string, string>();
  const providers: ProviderBoundary[] = PROVIDER_CREDENTIAL_REQUIREMENTS.map((requirement) => {
    const missingEnvVarNames = requirement.requiredEnvVars.filter((name) => {
      const raw = env[name];
      if (!present(raw)) return true;
      return placeholderProblem((raw ?? "").trim()) !== null;
    });
    let sharedCredentialWith: string | undefined;
    for (const name of requirement.requiredEnvVars) {
      const raw = (env[name] ?? "").trim();
      if (!raw) continue;
      const owner = seenValues.get(raw);
      if (owner && owner !== requirement.providerId) sharedCredentialWith = owner;
      else seenValues.set(raw, requirement.providerId);
    }
    if (sharedCredentialWith) {
      sharedGroups.set(requirement.providerId, sharedCredentialWith);
      if (!sharedGroups.has(sharedCredentialWith)) sharedGroups.set(sharedCredentialWith, requirement.providerId);
    }
    if (missingEnvVarNames.length > 0) {
      for (const name of missingEnvVarNames) {
        if (!missing.includes(name)) missing.push(name);
      }
      say(`provider ${requirement.providerId}: missing ${missingEnvVarNames.join(", ")}`);
    }
    return {
      providerId: requirement.providerId,
      requiredEnvVarNames: requirement.requiredEnvVars,
      configured: missingEnvVarNames.length === 0,
      missingEnvVarNames,
      keyless: requirement.requiredEnvVars.length === 0,
      sharedCredentialWith,
    };
  });

  /* A shared credential is reported on every provider that uses it, so the
     operator sees the conflict from whichever one they look at — and it is always
     a refusal, because one key cannot stand in for another provider's identity. */
  for (const provider of providers) {
    const other = sharedGroups.get(provider.providerId);
    if (!other) continue;
    provider.sharedCredentialWith = other;
    problems.push({
      name: provider.requiredEnvVarNames.join(", "),
      problem: `uses the same credential value as provider "${other}"; provider keys are provider-specific`,
    });
  }

  /* 8. The order of refusal decides which sentence the operator reads. */
  let outcome: ConfigurationOutcome;
  if (target !== PRODUCTION_TARGET) {
    outcome = "WRONG_ENVIRONMENT";
  } else if (environmentFailure !== null || (resolved !== null && resolved !== "production")) {
    outcome = "WRONG_ENVIRONMENT";
  } else if (forbidden.length > 0) {
    outcome = "FORBIDDEN_FALLBACK";
  } else if (issuerRefusal !== null) {
    outcome = "FORBIDDEN_FALLBACK";
  } else if (missing.length > 0) {
    outcome = "MISSING_REQUIRED_CONFIG";
  } else if (problems.length > 0) {
    // A malformed deployment identity is an identity problem, not a typo.
    const identityOnly = problems.every((problem) => problem.name === "CONVEX_DEPLOYMENT");
    outcome = identityOnly ? "WRONG_IDENTITY" : "INVALID_CONFIG";
  } else if (request.requireVerified) {
    outcome = "NOT_VERIFIED";
  } else {
    outcome = "READY_FOR_CONFIGURATION";
  }

  if (email.transport === null && resolved === "production") {
    say("email transport: none declared");
  }
  say(
    outcome === "READY_FOR_CONFIGURATION"
      ? "configuration is acceptable for a production deployment; nothing has been deployed or verified"
      : `configuration refused: ${outcome}`,
  );

  return {
    outcome,
    configurationAccepted: outcome === "READY_FOR_CONFIGURATION",
    productionVerified: false,
    target,
    environment: {
      resolved,
      isProduction: resolved === "production",
      detail: environmentDetail,
    },
    presence,
    missing,
    malformed: problems,
    forbidden,
    unexpected,
    email,
    deployment,
    providers,
    diagnostics,
    verification: {
      verified: false,
      reason:
        "a configuration check observes configuration; production verification requires observed production behaviour and is controlled by the release gate",
    },
  };
}

/** Deterministic human-readable form. Contains no values. */
export function formatProductionConfigReport(report: ProductionConfigReport): string {
  const lines = [
    "PRODUCTION CONFIGURATION CHECK",
    `outcome: ${report.outcome}`,
    `target: ${report.target}`,
    `environment: ${report.environment.resolved ?? "unresolved"}`,
    `productionVerified: ${report.productionVerified ? "yes" : "no"}`,
    "",
    "variables:",
  ];
  for (const entry of report.presence) {
    lines.push(
      `  ${entry.state.padEnd(16)} ${entry.name}${entry.secret ? " [secret]" : ""}${entry.requiredInProduction ? " [required]" : ""} — ${entry.consumer}`,
    );
  }
  lines.push("", "missing:");
  lines.push(report.missing.length === 0 ? "  none" : report.missing.map((name) => `  ${name}`).join("\n"));
  lines.push("", "malformed:");
  lines.push(
    report.malformed.length === 0
      ? "  none"
      : report.malformed.map((entry) => `  ${entry.name}: ${entry.problem}`).join("\n"),
  );
  lines.push("", "forbidden:");
  lines.push(
    report.forbidden.length === 0
      ? "  none"
      : report.forbidden.map((entry) => `  ${entry.name}: ${entry.problem}`).join("\n"),
  );
  lines.push("", "unexpected:");
  lines.push(report.unexpected.length === 0 ? "  none" : report.unexpected.map((n) => `  ${n}`).join("\n"));
  lines.push("", "providers:");
  for (const provider of report.providers) {
    lines.push(
      `  ${provider.providerId}: ${provider.keyless ? KEYLESS_PROVIDER_NOTE : provider.configured ? "configured" : `missing ${provider.missingEnvVarNames.join(", ")}`}`,
    );
  }
  lines.push("", "diagnostics:", ...report.diagnostics.map((line) => `  ${line}`));
  lines.push("", `verification: not verified — ${report.verification.reason}`);
  return `${lines.join("\n")}\n`;
}

/** Machine-readable form, shaped from the same report. Contains no values. */
export function productionConfigJson(report: ProductionConfigReport): string {
  return `${JSON.stringify(
    {
      outcome: report.outcome,
      configurationAccepted: report.configurationAccepted,
      productionVerified: report.productionVerified,
      target: report.target,
      environment: report.environment,
      missing: report.missing,
      malformed: report.malformed,
      forbidden: report.forbidden,
      unexpected: report.unexpected,
      email: report.email,
      deployment: report.deployment,
      providers: report.providers,
      diagnostics: report.diagnostics,
      verification: report.verification,
    },
    null,
    2,
  )}\n`;
}

/** 0 only for an accepted configuration; 1 for any refusal; 2 when not evaluated. */
export function productionConfigExitCode(report: ProductionConfigReport): 0 | 1 {
  return report.configurationAccepted ? 0 : 1;
}

/** Hosts that must never appear as a delivery or issuer identity. */
export const FORBIDDEN_IDENTITY_HOSTS: readonly string[] = [
  ...FORBIDDEN_DELIVERY_HOSTS,
  ...RETIRED_ISSUER_HOSTS,
];
