#!/usr/bin/env node
/**
 * Phase 286 — operator/CI gate in front of a Convex DEVELOPMENT deploy.
 *
 * Reads CONVEX_DEPLOY_KEY / CONVEX_DEPLOYMENT / VITE_CONVEX_URL /
 * CONVEX_SITE_URL / XSTARZ_DEPLOYMENT_ENV / SOURCE_REF (or GITHUB_REF) from the
 * process environment (or --config) and asks
 * `src/lib/deployment/development-deploy-guard.ts` whether the Convex
 * development deploy command may be invoked. It never deploys, never contacts
 * Convex, never prints a credential, and never admits a release.
 *
 * It is the counterpart to `scripts/production-deploy-guard.mjs`, with the
 * opposite polarity: production refuses anything that is not production; this
 * refuses anything that is production (or preview / local / anonymous). The
 * two guards share the placeholder-key, endpoint-host and forbidden-ref rules.
 *
 * Exit codes:
 *   0 = READY_TO_INVOKE_DEV_DEPLOY (permission to attempt; NOT a deployment)
 *   1 = refused
 *   2 = could not evaluate
 *
 * Usage:
 *   npm run development:deploy:guard
 *   npm run development:deploy:guard -- --json
 *   npm run development:deploy:guard -- --config dev.env
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registerTypeScriptResolution } from "./lib/ts-module-loader.mjs";

registerTypeScriptResolution();

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
    pathToFileURL(resolve(process.cwd(), "src/lib/deployment/development-deploy-guard.ts")).href
  );
} catch (error) {
  console.error(
    "REFUSED: could not load the development-deploy-guard policy module. " +
      "Run with a Node build that can load TypeScript " +
      "(node >= 22.6 with --experimental-strip-types, which the npm script sets).",
  );
  console.error(String(error?.message ?? error));
  process.exit(2);
}

const {
  evaluateDevelopmentDeployGuard,
  formatDevelopmentDeployGuard,
  developmentDeployGuardJson,
  developmentDeployGuardExitCode,
} = guard;

const evaluated = evaluateDevelopmentDeployGuard({
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
        "Development deploy is refused. This is a missing, production or non-development input, not a negative result about any live deployment.",
    }
  : evaluated;

if (asJson) {
  process.stdout.write(developmentDeployGuardJson(report));
} else {
  process.stdout.write(`source: ${source}\n`);
  process.stdout.write(formatDevelopmentDeployGuard(report));
}

process.exit(developmentDeployGuardExitCode(report));
