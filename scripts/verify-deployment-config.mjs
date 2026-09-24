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
 * `lib/issuerPolicy.ts`) so the preflight verdict and the running backend can
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

import { existsSync, readdirSync, readFileSync } from "node:fs";
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
try {
  deploymentEnvironment = await import(libUrl("deploymentEnvironment.ts"));
  issuerPolicy = await import(libUrl("issuerPolicy.ts"));
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
const { FEDERATED_ISSUER_VAR, resolveFederatedIssuer, FORBIDDEN_DELIVERY_HOSTS } =
  issuerPolicy;

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

/**
 * Phase 270 — email authentication retired. XSTARZ_EMAIL_* no longer exists
 * in any class above: nothing reads, requires or validates it. It is NOT in
 * RETIRED_VARS — those names are leaked-credential history that must never
 * reappear, while XSTARZ_EMAIL_* is simply inert config still tolerated as
 * "unexpected" rather than load-bearing.
 */
const RETIRED_EMAIL_VARS = [
  "XSTARZ_EMAIL_TRANSPORT",
  "XSTARZ_EMAIL_API_KEY",
  "XSTARZ_EMAIL_SENDER_ADDRESS",
  "XSTARZ_EMAIL_SENDER_NAME",
  "XSTARZ_EMAIL_TIMEOUT_MS",
];

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

// --- Email authentication: RETIRED (Phase 270) ---------------------------
// The email-OTP provider and its delivery stack are gone, so there is no
// transport, credential or sender to verify. A still-configured
// XSTARZ_EMAIL_* value is inert — reported, never required.
{
  const stillSet = RETIRED_EMAIL_VARS.filter((name) => present(name));
  record(
    "email-retired",
    "PASS",
    stillSet.length === 0
      ? "email authentication retired: no email variables required"
      : `email authentication retired; still-configured (inert) variables: ${stillSet.join(", ")}`,
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

// --- No Freebuff runtime OTP dependency -----------------------------------
// Phase 184's credential leaked because auth called a third-party OTP endpoint
// directly. Phase 185 removed it. This check proves the dependency has not come
// back, and distinguishes a *denylist* mention (which is protective and must be
// allowed) from a real call site (which is a regression).
{
  const RUNTIME_DIRS = ["src/convex"];
  const offenders = [];
  let scanned = 0;

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "_generated" || entry.name === "testing") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.includes(".test.")) continue;
      scanned += 1;
      const source = readFileSync(full, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        if (!/freebuff/i.test(line)) return;
        // A denylist entry or a historical comment is not a dependency. A fetch
        // to the host, or an env var feeding one, is.
        const isDenylist =
          /FORBIDDEN_DELIVERY_HOSTS|RETIRED_ISSUER_HOSTS|RETIRED_/.test(line) ||
          /^\s*\*/.test(line) ||
          /^\s*\/\//.test(line);
        if (isDenylist) return;
        offenders.push(`${full}:${i + 1}`);
      });
    }
  };
  for (const dir of RUNTIME_DIRS) walk(dir);

  record(
    "no-freebuff-otp-dependency",
    offenders.length === 0 ? "PASS" : "FAIL",
    offenders.length === 0
      ? `no runtime Freebuff OTP dependency in ${scanned} server modules ` +
          "(denylist entries are expected and allowed)"
      : `runtime Freebuff reference(s): ${offenders.join(", ")}`,
  );
}

// --- Production runtime modules must be wired -----------------------------
// A deployment that is missing one of these does not fail at deploy time; it
// fails the first time a user signs in or requests an analysis. Checking for
// presence and for the export the runtime actually calls turns that into a
// pre-deploy error.
{
  const REQUIRED_MODULES = [
    { path: "src/convex/auth.ts", exports: ["auth"], why: "sign-in" },
    {
      path: "src/convex/entitlements.ts",
      exports: ["getMyEntitlement", "consumeProfitSignal"],
      why: "free-tier limit",
    },
    {
      path: "src/convex/protectedAnalysis.ts",
      exports: ["runProtectedAnalysis"],
      why: "gated analysis + provenance",
    },
    {
      path: "src/convex/otpLimiter.ts",
      exports: ["consumeResendAllowance"],
      why: "durable abuse limiting",
    },
    { path: "src/convex/http.ts", exports: [], why: "auth HTTP routes / OIDC discovery" },
    { path: "src/convex/schema.ts", exports: [], why: "data model" },
  ];

  const problems = [];
  for (const mod of REQUIRED_MODULES) {
    let source;
    try {
      source = readFileSync(mod.path, "utf8");
    } catch {
      problems.push(`${mod.path} missing (${mod.why})`);
      continue;
    }
    for (const name of mod.exports) {
      // Convex modules export entry points in three shapes, all legitimate:
      //   export const foo = query({...})
      //   export function foo() {}
      //   export const { auth, signIn } = convexAuth({...})   <- destructured
      const direct = new RegExp(
        `export\\s+(const|let|function|async function)\\s+${name}\\b`,
      ).test(source);
      const destructured = new RegExp(
        `export\\s+const\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`,
        "s",
      ).test(source);
      if (!direct && !destructured) {
        problems.push(`${mod.path} does not export ${name} (${mod.why})`);
      }
    }
  }

  record(
    "runtime-modules-wired",
    problems.length === 0 ? "PASS" : "FAIL",
    problems.length === 0
      ? `auth, entitlement, provenance and limiter modules export their runtime entry points ` +
          `(${REQUIRED_MODULES.length} modules checked; wiring only — NOT deployed behaviour)`
      : problems.join("; "),
  );
}

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

// --- Production URLs must be real production URLs -------------------------
// Phase 200. These only become checkable once an operator supplies values, so
// they are silent (PASS with "nothing configured yet") until then. They exist
// to catch the specific mistakes that happen when someone copies a preview or
// example configuration into production.
{
  const URL_VARS = ["CONVEX_SITE_URL", "VITE_CONVEX_URL", "CONVEX_CLOUD_URL", "SITE_URL"];

  const DEV_HOST_RE =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal|.*\.local)$/i;
  // RFC 2606 / RFC 6761 reserved names plus the usual copy-paste placeholders.
  // These can never be a real production deployment.
  const PLACEHOLDER_HOST_RE =
    /(^|\.)(example|test|invalid|localhost)$|(^|\.)(example\.(com|net|org))$|your-|my-app|changeme|placeholder|todo|xxx/i;

  const problems = [];
  const checked = [];

  for (const name of URL_VARS) {
    if (!present(name)) continue;
    const raw = env[name].trim();
    checked.push(name);

    let url;
    try {
      url = new URL(raw);
    } catch {
      problems.push(`${name} is not a valid absolute URL`);
      continue;
    }

    if (isProduction && url.protocol !== "https:") {
      problems.push(`${name} must use https in production (got ${url.protocol})`);
    }
    if (isProduction && DEV_HOST_RE.test(url.hostname)) {
      problems.push(`${name} points at a development host (${url.hostname})`);
    }
    if (isProduction && PLACEHOLDER_HOST_RE.test(url.hostname)) {
      problems.push(`${name} still holds a placeholder/example host (${url.hostname})`);
    }
  }

  record(
    "production-endpoints",
    problems.length === 0 ? "PASS" : "FAIL",
    problems.length === 0
      ? checked.length === 0
        ? "no endpoint configured yet — nothing to validate (values still missing)"
        : `${checked.join(", ")} are https, non-local and non-placeholder`
      : problems.join("; "),
  );
}

// --- Credentials must not be obvious fakes --------------------------------
// A placeholder key that reaches production fails at the worst possible time:
// the first real user sign-in. Cheap to catch here.
{
  const CREDENTIAL_VARS = [];
  for (const cls of CLASSES) {
    for (const v of cls.vars) if (v.secret) CREDENTIAL_VARS.push(v.name);
  }

  const FAKE_RE = /(placeholder|example|changeme|your[_-]?key|dummy|sample|test[_-]?key|xxxx|todo|replace[_-]?me|not[_-]?a[_-]?key)/i;

  const suspicious = [];
  let configured = 0;
  for (const name of CREDENTIAL_VARS) {
    if (!present(name)) continue;
    configured += 1;
    const value = env[name].trim();
    // Report the VARIABLE NAME and the reason only. Never the value.
    if (FAKE_RE.test(value)) suspicious.push(`${name} looks like a placeholder`);
    else if (value.length < 8) suspicious.push(`${name} is implausibly short`);
  }

  record(
    "credential-plausibility",
    !isProduction || suspicious.length === 0 ? "PASS" : "FAIL",
    suspicious.length > 0 && isProduction
      ? `${suspicious.join("; ")} (values never printed)`
      : configured === 0
        ? "no credential configured yet — nothing to validate (values still missing)"
        : `${configured} configured credential(s) are not obvious placeholders ` +
          "(plausibility only — validity NOT VERIFIED without network access)",
  );
}

// --- Things this script cannot prove --------------------------------------
const notVerified = [
  "provider account validity (no network egress from this environment)",
  "deployed Convex runtime behaviour (Evidence Level D)",
  // Phase 270: sender-domain DNS and email delivery are retired along with
  // the email auth path — they are no longer listable unknowns because there
  // is no capability left they could verify.
];

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const failures = results.filter((r) => r.status === "FAIL");
const exitCode = failures.length === 0 ? 0 : 1;

if (asJson) {
  console.log(
    JSON.stringify(
      { environment, isProduction, emailRetired: true, results, notVerified, exitCode },
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
