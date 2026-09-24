#!/usr/bin/env node
/**
 * Phase 255 — operator/CI gate in front of a Convex production deploy.
 *
 * Reads CONVEX_DEPLOY_KEY / CONVEX_DEPLOYMENT / VITE_CONVEX_URL /
 * CONVEX_SITE_URL / XSTARZ_DEPLOYMENT_ENV / SOURCE_REF (or GITHUB_REF) from
 * the process environment (or --config) and asks
 * `src/lib/deployment/production-deploy-guard.ts` whether the Convex
 * production deploy command may be invoked. It never deploys, never contacts
 * Convex, never prints a credential, and never admits a release.
 *
 * Exit codes:
 *   0 = READY_TO_INVOKE_DEPLOY (permission to attempt; NOT a deployment)
 *   1 = refused
 *   2 = could not evaluate
 *
 * Usage:
 *   npm run production:deploy:guard
 *   npm run production:deploy:guard -- --json
 *   npm run production:deploy:guard -- --config prod.env
 */

import { readFileSync } from "node:fs";
import module from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
          // fall through
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const configIdx = argv.indexOf("--config");
const configPath = configIdx >= 0 ? argv[configIdx + 1] : null;

if (configIdx >= 0 && (!configPath || configPath.startsWith("--"))) {
  console.error("REFUSED: --config needs a path.");
  process.exit(2);
}

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
      return { env: {}, source: configPath, parseFailure: "not valid JSON" };
    }
  }
  return { env: parseEnvFile(absolute), source: configPath };
}

const { env, source, parseFailure } = readConfig();

let guard;
try {
  guard = await import(
    pathToFileURL(resolve(process.cwd(), "src/lib/deployment/production-deploy-guard.ts")).href
  );
} catch (error) {
  console.error(
    "REFUSED: could not load the production-deploy-guard policy module. " +
      "Run with a Node build that can load TypeScript " +
      "(node >= 22.6 with --experimental-strip-types, which the npm script sets).",
  );
  console.error(String(error?.message ?? error));
  process.exit(2);
}

const {
  evaluateProductionDeployGuard,
  formatProductionDeployGuard,
  productionDeployGuardJson,
  productionDeployGuardExitCode,
} = guard;

const evaluated = evaluateProductionDeployGuard({
  convexDeployKey: env.CONVEX_DEPLOY_KEY,
  convexDeployment: env.CONVEX_DEPLOYMENT,
  viteConvexUrl: env.VITE_CONVEX_URL,
  convexSiteUrl: env.CONVEX_SITE_URL,
  xstarzDeploymentEnv: env.XSTARZ_DEPLOYMENT_ENV,
  sourceRef: env.SOURCE_REF || env.GITHUB_REF || env.GIT_REF,
});

const report = parseFailure
  ? {
      ...evaluated,
      state: "WRONG_IDENTITY",
      mayInvokeDeploy: false,
      problems: [`configuration source ${source} is ${parseFailure}`, ...evaluated.problems],
      statement:
        "Production deploy is refused. This is a missing or non-production input, not a negative result about any live deployment.",
    }
  : evaluated;

if (asJson) {
  process.stdout.write(productionDeployGuardJson(report));
} else {
  process.stdout.write(`source: ${source}\n`);
  process.stdout.write(formatProductionDeployGuard(report));
}

process.exit(productionDeployGuardExitCode(report));
