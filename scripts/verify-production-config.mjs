#!/usr/bin/env node
/**
 * Phase 243 — operator configuration checker.
 *
 * Answers "would this configuration be accepted for a production deployment?"
 * before anything is deployed, and answers nothing else. It does not deploy, does
 * not contact any service, does not verify a provider, a sender or a deployment,
 * and never prints a credential value.
 *
 * Design rule, the same as the Phase 186 preflight: this script does NOT
 * re-implement the policies. It loads `src/lib/deployment/production-config.ts`,
 * which in turn imports the real `deploymentEnvironment`, `issuerPolicy` and
 * provider-credential modules, so the checker and the running backend cannot
 * disagree about what production accepts. Phase 270: the email boundary
 * module (`emailDelivery`) retired with the provider; the checker now proves
 * the email variables are inert rather than configured.
 *
 * Exit codes:
 *   0 = READY_FOR_CONFIGURATION (configuration accepted; NOT a verification)
 *   1 = refused (missing, malformed, wrong environment, wrong identity, forbidden fallback)
 *   2 = could not evaluate (the policy modules failed to load)
 *
 * Usage:
 *   node scripts/verify-production-config.mjs                       # reads process.env
 *   node scripts/verify-production-config.mjs --config prod.env
 *   node scripts/verify-production-config.mjs --config prod.json --json
 *   node scripts/verify-production-config.mjs --require-verified    # always NOT_VERIFIED
 */

import { readFileSync } from "node:fs";
import module from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * The policy modules use extensionless relative imports ("../../convex/lib/..."),
 * which is what the Convex bundler expects but not what Node's ESM resolver does.
 * This hook appends the .ts extension so the REAL modules load unmodified.
 */
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      const parentPath = context.parentURL?.startsWith("file:")
        ? fileURLToPath(context.parentURL)
        : null;
      if (parentPath) {
        const candidate = resolve(parentPath, "..", `${specifier}.ts`);
        try {
          readFileSync(candidate);
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch {
          // fall through to the default resolver, which will report the miss
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const requireVerified = argv.includes("--require-verified");
const configIdx = argv.indexOf("--config");
const configPath = configIdx >= 0 ? argv[configIdx + 1] : null;
const targetIdx = argv.indexOf("--target");
const target = targetIdx >= 0 ? argv[targetIdx + 1] : undefined;

if (configIdx >= 0 && (!configPath || configPath.startsWith("--"))) {
  console.error("REFUSED: --config needs a path.");
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * Configuration source
 * ------------------------------------------------------------------ */

/** Parse a dotenv-style file into a plain object. Values are never logged. */
function parseEnvFile(path) {
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
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

function readConfig() {
  if (!configPath) return { env: { ...process.env }, source: "process.env" };
  const absolute = resolve(process.cwd(), configPath);
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    console.error(`REFUSED: cannot read configuration file ${configPath}.`);
    process.exit(2);
  }
  if (configPath.toLowerCase().endsWith(".json")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.error("REFUSED: the configuration file must contain a JSON object.");
        process.exit(2);
      }
      const env = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") env[key] = value;
        else if (value === null || value === undefined) continue;
        else env[key] = String(value);
      }
      return { env, source: configPath };
    } catch {
      // A malformed file is a refusal, not a crash: report it as invalid config.
      return { env: {}, source: configPath, parseFailure: "not valid JSON" };
    }
  }
  return { env: parseEnvFile(absolute), source: configPath };
}

const { env, source, parseFailure } = readConfig();

/* ------------------------------------------------------------------ *
 * The real policy module
 * ------------------------------------------------------------------ */

let productionConfig;
try {
  productionConfig = await import(
    pathToFileURL(resolve(process.cwd(), "src/lib/deployment/production-config.ts")).href
  );
} catch (error) {
  console.error(
    "REFUSED: could not load the production-config policy module. " +
      "Run with a Node build that can load TypeScript " +
      "(node >= 22.6 with --experimental-strip-types, which the npm script sets).",
  );
  console.error(String(error?.message ?? error));
  process.exit(2);
}

const { evaluateProductionConfiguration, formatProductionConfigReport, productionConfigJson } =
  productionConfig;

const evaluated = evaluateProductionConfiguration({ env, target, requireVerified });

/*
  A file that is not valid JSON is a MALFORMED configuration, not an absent one:
  evaluating "no variables present" would report MISSING_REQUIRED_CONFIG and hide
  the real problem behind a longer list. The overlay only ever refuses — it can
  turn an accepted configuration into INVALID_CONFIG, never the other way round.
*/
const finalReport = parseFailure
  ? {
      ...evaluated,
      outcome: "INVALID_CONFIG",
      configurationAccepted: false,
      malformed: [{ name: source, problem: parseFailure }, ...evaluated.malformed],
      diagnostics: [
        ...evaluated.diagnostics.filter((line) => !line.startsWith("configuration refused: ")),
        `configuration source ${source} is ${parseFailure}`,
        "configuration refused: INVALID_CONFIG",
      ],
    }
  : evaluated;

if (asJson) {
  process.stdout.write(productionConfigJson(finalReport));
} else {
  process.stdout.write(`source: ${source}\n`);
  process.stdout.write(formatProductionConfigReport(finalReport));
  if (finalReport.outcome === "READY_FOR_CONFIGURATION") {
    process.stdout.write(
      "\nNOTE: this means the configuration would be accepted. It does not mean production\n" +
        "      is ready: verification requires observed production behaviour, and the release\n" +
        "      verdict is computed by the release gate (`npm run release:report`).\n",
    );
  }
}

process.exit(finalReport.configurationAccepted ? 0 : 1);
