#!/usr/bin/env node
/**
 * Phase 186 — Convex deployment configuration preflight.
 *
 * Validates the environment a Convex deployment is ABOUT to be configured
 * with, before `npx convex deploy` is run. It is the operator-facing gate for
 * the Phase 185b fail-closed policies.
 *
 * Design rule: this script does NOT reimplement the security policies. It
 * imports the real modules (`lib/deploymentEnvironment.ts`, `lib/issuerPolicy.ts`,
 * `lib/emailDelivery.ts`) so the preflight verdict and the running backend can
 * never disagree. A second copy of the rules would drift and produce a
 * confident, wrong PASS.
 *
 * Honesty rules:
 *   - Reads env var NAMES and presence. Never prints a credential VALUE.
 *   - Checks CONFIGURATION only. It cannot prove a provider account works,
 *     that DNS resolves, or that an email is delivered. Those are reported as
 *     NOT VERIFIED, never PASS.
 *
 * Exit codes:
 *   0 = configuration valid for the requested deployment environment
 *   1 = configuration invalid (a fail-closed policy rejected it)
 *   2 = could not evaluate (refused, e.g. the policy modules failed to load)
 *
 * Usage:
 *   node scripts/verify-deployment-config.mjs                # reads process.env
 *   node scripts/verify-deployment-config.mjs --env-file .env.production.local
 *   node scripts/verify-deployment-config.mjs --json
 */

import { existsSync, readFileSync } from "node:fs";
import module from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * The policy modules under src/convex/lib use extensionless relative imports
 * ("./deploymentEnvironment"), which is what the Convex bundler expects but
 * not what Node's ESM resolver does. This hook appends the .ts extension so
 * the REAL modules load unmodified. Without it the script would have to keep
 * its own copy of the security rules, which is exactly the drift this design
 * avoids.
 */
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      const parentPath = context.parentURL?.startsWith("file:")
        ? fileURLToPath(context.parentURL)
        : null;
      if (parentPath) {
        const candidate = resolve(parentPath, "..", `${specifier}.ts`);
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const envFileIdx = argv.indexOf("--env-file");
const envFile = envFileIdx >= 0 ? argv[envFileIdx + 1] : null;

/* ------------------------------------------------------------------ *
 * Environment source
 * ------------------------------------------------------------------ */

/** Parse a dotenv-style file into a plain object. Values are never logged. */
function parseEnvFile(path) {
  const text = readFileSync(path, "utf8");
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = envFile ? parseEnvFile(resolve(process.cwd(), envFile)) : { ...process.env };

/**
 * The policy modules take an EnvSource reader, not a plain object, so that
 * tests can inject an environment. Adapt once, here.
 */
const readEnv = (key) => env[key];

/* ------------------------------------------------------------------ *
 * Load the REAL policy modules (never a copy of the rules)
 * ------------------------------------------------------------------ */

const libUrl = (f) => pathToFileURL(resolve(process.cwd(), "src/convex/lib", f)).href;

let deploymentEnvironment;
let issuerPolicy;
let emailDelivery;
try {
  deploymentEnvironment = await import(libUrl("deploymentEnvironment.ts"));
  issuerPolicy = await import(libUrl("issuerPolicy.ts"));
  emailDelivery = await import(libUrl("emailDelivery.ts"));
} catch (error) {
  const hint =
    "Run with a Node build that can load TypeScript " +
    "(node >= 22.6 with --experimental-strip-types, which npm run convex:preflight sets).";
  console.error(`REFUSED: could not load the policy modules. ${hint}`);
  console.error(String(error?.message ?? error));
  process.exit(2);
}

const { DEPLOYMENT_ENV_VAR, resolveDeploymentEnvironment, isProductionDeployment } =
  deploymentEnvironment;
const { FEDERATED_ISSUER_VAR, resolveFederatedIssuer } = issuerPolicy;
const { readEmailDeliveryConfig, NON_DELIVERING_TRANSPORTS, FORBIDDEN_DELIVERY_HOSTS } =
  emailDelivery;

/* ------------------------------------------------------------------ *
 * Variable classification (§2)
 * ------------------------------------------------------------------ */

const CLASSES = [
  {
    id: "authentication",
    title: "Authentication",
    vars: [
      { name: "CONVEX_SITE_URL", secret: false, requiredInProduction: true },
      { name: DEPLOYMENT_ENV_VAR, secret: false, requiredInProduction: false },
      { name: FEDERATED_ISSUER_VAR, secret: false, forbiddenInProduction: true },
    ],
  },
  {
    id: "email-delivery",
    title: "Email delivery",
    vars: [
      { name: "XSTARZ_EMAIL_TRANSPORT", secret: false, requiredInProduction: true },
      { name: "XSTARZ_EMAIL_API_KEY", secret: true, requiredInProduction: true },
      { name: "XSTARZ_EMAIL_SENDER_ADDRESS", secret: false, requiredInProduction: true },
      { name: "XSTARZ_EMAIL_SENDER_NAME", secret: false, requiredInProduction: false },
    ],
  },
  {
    id: "market-providers",
    title: "Market data providers",
    vars: [
      { name: "TWELVE_DATA_API_KEY", secret: true },
      { name: "ALPHA_VANTAGE_API_KEY", secret: true },
    ],
  },
  {
    id: "calendar",
    title: "Economic calendar",
    vars: [{ name: "TICKATLAS_API_KEY", secret: true }],
  },
  {
    id: "macro",
    title: "Macro / energy",
    vars: [{ name: "EIA_API_KEY", secret: true }],
  },
  {
    id: "derivatives",
    title: "Derivatives",
    vars: [{ name: "COINGLASS_API_KEY", secret: true }],
  },
  {
    id: "fx",
    title: "FX",
    vars: [],
    note: "FX is served by Twelve Data / Alpha Vantage; no separate credential.",
  },
  {
    id: "application",
    title: "Application configuration",
    vars: [
      { name: "VITE_CONVEX_URL", secret: false, clientVisible: true },
      { name: "CONVEX_DEPLOYMENT", secret: false, cliOnly: true },
    ],
  },
];

/** Vars that must never come back. */
const RETIRED_VARS = ["OTP_EMAIL_API_KEY", "VLY_APP_NAME"];

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

const results = [];
const record = (id, status, detail) => results.push({ id, status, detail });

const present = (name) => typeof env[name] === "string" && env[name].trim() !== "";

// --- Deployment environment -----------------------------------------------
let environment = null;
try {
  environment = resolveDeploymentEnvironment(readEnv);
  const explicit = present(DEPLOYMENT_ENV_VAR);
  record(
    "deployment-env",
    "PASS",
    explicit
      ? `${DEPLOYMENT_ENV_VAR}=${environment}`
      : `${DEPLOYMENT_ENV_VAR} not set — resolved to "${environment}" (fail-closed default)`,
  );
} catch (error) {
  record("deployment-env", "FAIL", String(error?.message ?? error));
}

const isProduction = environment === null ? true : isProductionDeployment(readEnv);

// --- Retired variables ----------------------------------------------------
const retiredPresent = RETIRED_VARS.filter((name) => present(name));
record(
  "retired-vars",
  retiredPresent.length === 0 ? "PASS" : "FAIL",
  retiredPresent.length === 0
    ? `none of ${RETIRED_VARS.join(", ")} are set`
    : `retired variables must not be set: ${retiredPresent.join(", ")}`,
);

// --- Federated issuer -----------------------------------------------------
try {
  const decision = resolveFederatedIssuer(readEnv);
  if (decision.trusted) {
    record(
      "federated-issuer",
      isProduction ? "FAIL" : "PASS",
      isProduction
        ? "a federated issuer resolved on a production deployment"
        : `${environment}: federated issuer accepted (${decision.issuer})`,
    );
  } else {
    record("federated-issuer", "PASS", "self-issuer only — no external federation");
  }
} catch (error) {
  // On production this is the CORRECT outcome for a configured issuer.
  // A throw is always a rejected configuration: on production this is the
  // policy working as designed, and the operator still has to remove the
  // variable before the deployment can proceed.
  record(
    "federated-issuer",
    "FAIL",
    `${FEDERATED_ISSUER_VAR} rejected: ${String(error?.message ?? error)}`,
  );
}

// --- Email delivery -------------------------------------------------------
const transport = (env.XSTARZ_EMAIL_TRANSPORT ?? "").trim();
try {
  const config = readEmailDeliveryConfig(readEnv);
  const nonDelivering = NON_DELIVERING_TRANSPORTS.includes(config.transport);
  record(
    "email-delivery",
    nonDelivering && isProduction ? "FAIL" : "PASS",
    nonDelivering
      ? `${environment}: "${config.transport}" transport logs instead of delivering (allowed outside production)`
      : `transport "${config.transport}" configured with a credential and sender`,
  );
} catch (error) {
  record("email-delivery", "FAIL", String(error?.message ?? error));
}

// --- Sender domain --------------------------------------------------------
const sender = (env.XSTARZ_EMAIL_SENDER_ADDRESS ?? "").trim().toLowerCase();
if (sender === "") {
  record(
    "sender-identity",
    isProduction ? "FAIL" : "NOT VERIFIED",
    "no sender address configured (production requires an Xstarz-owned verified sender)",
  );
} else {
  const domain = sender.includes("@") ? sender.split("@").pop() : "";
  const forbidden = FORBIDDEN_DELIVERY_HOSTS.some(
    (host) => domain === host || domain.endsWith(`.${host}`),
  );
  record(
    "sender-identity",
    forbidden ? "FAIL" : "PASS",
    forbidden
      ? `sender domain "${domain}" is a retired Freebuff domain`
      : `sender domain "${domain}" is not a retired domain (DNS/verification NOT VERIFIED by this script)`,
  );
}

// --- Required production variables ---------------------------------------
const missingRequired = [];
for (const cls of CLASSES) {
  for (const v of cls.vars) {
    if (v.requiredInProduction && isProduction && !present(v.name)) missingRequired.push(v.name);
  }
}
record(
  "required-production-vars",
  !isProduction || missingRequired.length === 0 ? "PASS" : "FAIL",
  !isProduction
    ? `${environment}: production-required variables not enforced`
    : missingRequired.length === 0
      ? "all production-required variables are present"
      : `missing on production: ${missingRequired.join(", ")}`,
);

// --- Server-only secrets must not be client-visible -----------------------
const leakedToClient = [];
for (const cls of CLASSES) {
  for (const v of cls.vars) {
    if (!v.secret) continue;
    if (present(`VITE_${v.name}`)) leakedToClient.push(`VITE_${v.name}`);
  }
}
for (const key of Object.keys(env)) {
  if (!key.startsWith("VITE_")) continue;
  if (/(_API_KEY|_SECRET|_TOKEN|_PASSWORD|_PRIVATE_KEY)$/.test(key) && present(key)) {
    if (!leakedToClient.includes(key)) leakedToClient.push(key);
  }
}
record(
  "server-only-secrets",
  leakedToClient.length === 0 ? "PASS" : "FAIL",
  leakedToClient.length === 0
    ? "no server-only secret is exposed through a VITE_-prefixed variable"
    : `client-visible secrets: ${leakedToClient.join(", ")}`,
);

// --- Things this script cannot prove --------------------------------------
const notVerified = [
  "provider account validity (no network egress from this environment)",
  "sender domain DNS: SPF / DKIM / DMARC records",
  "actual email delivery and inbox placement",
  "deployed Convex runtime behaviour (Evidence Level D)",
];

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const failures = results.filter((r) => r.status === "FAIL");
const exitCode = failures.length === 0 ? 0 : 1;

if (asJson) {
  console.log(
    JSON.stringify(
      { environment, isProduction, transport, results, notVerified, exitCode },
      null,
      2,
    ),
  );
  process.exit(exitCode);
}

const line = "─".repeat(72);
console.log(line);
console.log("Convex deployment configuration preflight (Phase 186)");
console.log(line);
console.log(`Target environment : ${environment ?? "UNRESOLVED"}`);
console.log(`Source             : ${envFile ? `file ${envFile}` : "process.env"}`);
console.log("");

console.log("Variable classification");
for (const cls of CLASSES) {
  console.log(`  ${cls.title}`);
  if (cls.vars.length === 0) console.log(`    (none) ${cls.note ?? ""}`);
  for (const v of cls.vars) {
    const tags = [
      v.secret ? "secret" : "config",
      v.clientVisible ? "client-visible" : null,
      v.cliOnly ? "cli-only" : null,
      v.forbiddenInProduction ? "forbidden-in-production" : null,
      v.requiredInProduction ? "required-in-production" : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`    ${present(v.name) ? "set    " : "not set"}  ${v.name}  [${tags}]`);
  }
}
console.log("");

console.log("Policy checks");
for (const r of results) {
  console.log(`  ${r.status.padEnd(4)}  ${r.id.padEnd(26)} ${r.detail}`);
}
console.log("");

console.log("NOT VERIFIED by this script (configuration-only preflight)");
for (const n of notVerified) console.log(`  - ${n}`);
console.log("");

console.log(line);
console.log(
  exitCode === 0
    ? `RESULT: configuration valid for a "${environment}" deployment.`
    : `RESULT: configuration REJECTED (${failures.length} failing check${failures.length === 1 ? "" : "s"}).`,
);
console.log(
  "This validates configuration only. It is not evidence that the deployment works,",
);
console.log("and it does not clear the Phase 184 credential gate.");
console.log(line);

process.exit(exitCode);
