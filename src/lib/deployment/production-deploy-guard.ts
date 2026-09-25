/**
 * Phase 255 — fail-closed guard for a future Convex production deploy command.
 *
 * This module answers one question: *may CI invoke the Convex production
 * deploy command against the inputs it was given?* It never deploys, never
 * contacts Convex, never reads the ambient environment, and never returns a
 * credential value.
 *
 * READY_TO_INVOKE_DEPLOY means "the identity is production-shaped and a deploy
 * key is present". It does NOT mean:
 *
 *   - a production deployment exists,
 *   - the control plane is reachable,
 *   - email or providers are configured,
 *   - Evidence D passed,
 *   - the release gate admits this candidate.
 *
 * Those remain the Phase 241/248 prerequisites. A green guard is permission to
 * *attempt* a deploy, not a release verdict.
 *
 * The required identity rule is imported from `production-config.ts`
 * (`deploymentIdentityProblem`) so a `dev:`/`preview:`/`anonymous:`/`local`
 * name cannot be relabelled production here while being refused there.
 */
import {
  DEPLOYMENT_ENV_VAR,
  resolveDeploymentEnvironment,
  DeploymentPolicyError,
} from "../../convex/lib/deploymentEnvironment";
import { deploymentIdentityProblem } from "./production-config";

export const PRODUCTION_DEPLOY_GUARD_SCHEMA = "phase255.production-deploy-guard/v1";

export type ProductionDeployGuardState =
  | "READY_TO_INVOKE_DEPLOY"
  | "MISSING_DEPLOY_KEY"
  | "PLACEHOLDER_DEPLOY_KEY"
  | "MISSING_DEPLOYMENT_IDENTITY"
  | "NON_PRODUCTION_IDENTITY"
  | "WRONG_IDENTITY"
  | "WRONG_CONVEX_URL"
  | "WRONG_SITE_URL"
  | "WRONG_ENVIRONMENT"
  | "FORBIDDEN_SOURCE_REF";

export const PRODUCTION_DEPLOY_GUARD_PRECEDENCE: readonly ProductionDeployGuardState[] = [
  "PLACEHOLDER_DEPLOY_KEY",
  "MISSING_DEPLOY_KEY",
  "FORBIDDEN_SOURCE_REF",
  "NON_PRODUCTION_IDENTITY",
  "WRONG_IDENTITY",
  "MISSING_DEPLOYMENT_IDENTITY",
  "WRONG_ENVIRONMENT",
  "WRONG_CONVEX_URL",
  "WRONG_SITE_URL",
  "READY_TO_INVOKE_DEPLOY",
];

/**
 * Phase 286 — exported so the development guard applies the same
 * placeholder rule instead of restating it. A value that is obviously not a
 * key must never satisfy either guard.
 */
export const PLACEHOLDER_DEPLOY_KEY_PATTERN =
  /^(test|mock|fixture|dummy|fake|sample|example|placeholder|changeme|todo|xxx+|your[-_ ].+|replace_with.+|sk_test_.+)$/i;

const PLACEHOLDER_KEY = PLACEHOLDER_DEPLOY_KEY_PATTERN;

const CONVEX_CLOUD_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.convex\.cloud$/i;
const CONVEX_SITE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.convex\.site$/i;

export interface ProductionDeployGuardInput {
  /** Deploy key value. Used for presence/placeholder only; never copied to the report. */
  convexDeployKey?: string;
  convexDeployment?: string;
  viteConvexUrl?: string;
  convexSiteUrl?: string;
  xstarzDeploymentEnv?: string;
  /**
   * Git ref CI is checking out (`GITHUB_REF` / `SOURCE_REF`). Absent is
   * allowed for a local configuration check. `main` is never a deployable
   * source: its tip still serves the leaked OTP credential.
   */
  sourceRef?: string;
}

export interface ProductionDeployGuardReport {
  schema: string;
  state: ProductionDeployGuardState;
  /** True only for READY_TO_INVOKE_DEPLOY. Not a deployment, not a release. */
  mayInvokeDeploy: boolean;
  /** Always false: this checker does not deploy. */
  deploymentPerformed: false;
  /** Always false: configuration is not production verification. */
  productionVerified: false;
  /** Always false: the release gate is a different command. */
  releaseAdmitted: false;
  keyPresent: boolean;
  deployment: {
    declared: string | null;
    productionShaped: boolean;
  };
  urls: {
    viteConvexUrlHost: string | null;
    convexSiteUrlHost: string | null;
  };
  environment: {
    declared: string | null;
    resolved: string | null;
    isProduction: boolean;
  };
  problems: readonly string[];
  statement: string;
}

const trim = (value: string | undefined): string =>
  typeof value === "string" ? value.trim() : "";

function worst(states: readonly ProductionDeployGuardState[]): ProductionDeployGuardState {
  for (const state of PRODUCTION_DEPLOY_GUARD_PRECEDENCE) {
    if (states.includes(state)) return state;
  }
  return "MISSING_DEPLOY_KEY";
}

/**
 * True when `ref` names `main` under any of the usual git/GitHub spellings.
 * Other branch names, including ones that merely contain the letters "main",
 * are not this check.
 */
export function isForbiddenDeploySourceRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed) return false;
  const normalised = trimmed
    .replace(/^refs\/remotes\/origin\//i, "")
    .replace(/^refs\/heads\//i, "")
    .replace(/^origin\//i, "")
    .replace(/^heads\//i, "")
    .toLowerCase();
  return normalised === "main";
}

/**
 * Phase 286 — exported so the development guard validates Convex endpoint
 * hosts with the SAME rule (https, not loopback) rather than a copy that can
 * drift from this one.
 */
export function httpsHost(value: string): { host: string } | { problem: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { problem: "not an absolute URL" };
  }
  if (url.protocol !== "https:") return { problem: "must use https" };
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  ) {
    return { problem: "points at a loopback host, which cannot be a production Convex endpoint" };
  }
  return { host };
}

/**
 * Pure. Same input, same report. No clock, no filesystem, no network, no
 * ambient environment access.
 */
export function evaluateProductionDeployGuard(
  input: ProductionDeployGuardInput,
): ProductionDeployGuardReport {
  const states: ProductionDeployGuardState[] = [];
  const problems: string[] = [];

  const key = trim(input.convexDeployKey);
  const keyPresent = key.length > 0;
  if (!keyPresent) {
    states.push("MISSING_DEPLOY_KEY");
    problems.push("CONVEX_DEPLOY_KEY is absent; a production deploy key must be supplied as a CI secret, never committed");
  } else if (key.length < 16 || PLACEHOLDER_KEY.test(key)) {
    states.push("PLACEHOLDER_DEPLOY_KEY");
    problems.push("CONVEX_DEPLOY_KEY is a placeholder or too short to be a real deploy key");
  }

  const sourceRef = trim(input.sourceRef);
  if (sourceRef && isForbiddenDeploySourceRef(sourceRef)) {
    states.push("FORBIDDEN_SOURCE_REF");
    problems.push(
      "source ref is main; main still serves the leaked OTP credential at its tip and must not be deployed",
    );
  }

  const deployment = trim(input.convexDeployment) || null;
  let productionShaped = false;
  if (deployment === null) {
    states.push("MISSING_DEPLOYMENT_IDENTITY");
    problems.push("CONVEX_DEPLOYMENT is absent; a `prod:<team>:<project>` identity is required");
  } else {
    const identity = deploymentIdentityProblem(deployment);
    if (identity !== null) {
      const nonProd = /development, preview or local/.test(identity);
      states.push(nonProd ? "NON_PRODUCTION_IDENTITY" : "WRONG_IDENTITY");
      problems.push(`CONVEX_DEPLOYMENT ${identity}`);
    } else {
      productionShaped = true;
    }
  }

  let resolved: string | null = null;
  let isProduction = false;
  const declaredEnv = trim(input.xstarzDeploymentEnv) || null;
  try {
    resolved = resolveDeploymentEnvironment((name) =>
      name === DEPLOYMENT_ENV_VAR ? input.xstarzDeploymentEnv : undefined,
    );
    isProduction = resolved === "production";
    if (!isProduction) {
      states.push("WRONG_ENVIRONMENT");
      problems.push(
        `${DEPLOYMENT_ENV_VAR} resolves to ${resolved}, which is not production; a production deploy cannot run against preview or development`,
      );
    }
  } catch (error) {
    states.push("WRONG_ENVIRONMENT");
    problems.push(
      error instanceof DeploymentPolicyError
        ? error.message
        : `${DEPLOYMENT_ENV_VAR} is not a recognised production environment`,
    );
  }

  const vite = trim(input.viteConvexUrl);
  let viteHost: string | null = null;
  if (vite) {
    const parsed = httpsHost(vite);
    if ("problem" in parsed) {
      states.push("WRONG_CONVEX_URL");
      problems.push(`VITE_CONVEX_URL ${parsed.problem}`);
    } else if (!CONVEX_CLOUD_HOST.test(parsed.host)) {
      states.push("WRONG_CONVEX_URL");
      problems.push("VITE_CONVEX_URL must be an https URL on a `*.convex.cloud` host");
    } else {
      viteHost = parsed.host;
    }
  }

  const site = trim(input.convexSiteUrl);
  let siteHost: string | null = null;
  if (site) {
    const parsed = httpsHost(site);
    if ("problem" in parsed) {
      states.push("WRONG_SITE_URL");
      problems.push(`CONVEX_SITE_URL ${parsed.problem}`);
    } else if (!CONVEX_SITE_HOST.test(parsed.host)) {
      states.push("WRONG_SITE_URL");
      problems.push("CONVEX_SITE_URL must be an https URL on a `*.convex.site` host");
    } else {
      siteHost = parsed.host;
    }
  }

  const state = states.length === 0 ? "READY_TO_INVOKE_DEPLOY" : worst(states);
  const mayInvokeDeploy = state === "READY_TO_INVOKE_DEPLOY";

  return {
    schema: PRODUCTION_DEPLOY_GUARD_SCHEMA,
    state,
    mayInvokeDeploy,
    deploymentPerformed: false,
    productionVerified: false,
    releaseAdmitted: false,
    keyPresent,
    deployment: { declared: deployment, productionShaped },
    urls: { viteConvexUrlHost: viteHost, convexSiteUrlHost: siteHost },
    environment: { declared: declaredEnv, resolved, isProduction },
    problems,
    statement: mayInvokeDeploy
      ? "Inputs are production-shaped and a deploy key is present. This is not a deployment and not a release admission."
      : "Production deploy is refused. This is a missing or non-production input, not a negative result about any live deployment.",
  };
}

export function formatProductionDeployGuard(report: ProductionDeployGuardReport): string {
  const lines = [
    `schema: ${report.schema}`,
    `state: ${report.state}`,
    `mayInvokeDeploy: ${report.mayInvokeDeploy ? "yes" : "no"}`,
    `deploymentPerformed: no`,
    `productionVerified: no`,
    `releaseAdmitted: no`,
    `keyPresent: ${report.keyPresent ? "yes" : "no"}`,
    `deployment: ${report.deployment.declared ?? "<absent>"} (productionShaped: ${report.deployment.productionShaped ? "yes" : "no"})`,
    `VITE_CONVEX_URL host: ${report.urls.viteConvexUrlHost ?? "<absent>"}`,
    `CONVEX_SITE_URL host: ${report.urls.convexSiteUrlHost ?? "<absent>"}`,
    `environment: ${report.environment.resolved ?? "unresolved"}`,
    "",
    "problems:",
    ...(report.problems.length === 0 ? ["  none"] : report.problems.map((line) => `  - ${line}`)),
    "",
    `statement: ${report.statement}`,
    "This command does not deploy, does not print a credential, and does not admit a release.",
  ];
  return `${lines.join("\n")}\n`;
}

export function productionDeployGuardJson(report: ProductionDeployGuardReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function productionDeployGuardExitCode(report: ProductionDeployGuardReport): 0 | 1 {
  return report.mayInvokeDeploy ? 0 : 1;
}
