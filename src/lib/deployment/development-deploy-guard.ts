/**
 * Phase 286 — fail-closed guard in front of a Convex DEVELOPMENT deploy.
 *
 * WHY THIS EXISTS
 * ---------------
 * The development deployment carries the running build a person can actually
 * look at, and it had gone stale: nothing in the repository could refresh it
 * from CI. The production guard cannot serve that purpose — it refuses any
 * non-production identity by design (`deploymentIdentityProblem` reports a
 * `dev:` name as "names a development, preview or local deployment"), which is
 * correct for production and useless for development.
 *
 * So development gets its OWN gate, with the opposite polarity: it refuses
 * anything that is production-shaped, preview, local or anonymous, and it
 * refuses a deploy key or identity that is merely declared without being
 * development. It answers exactly one question — *may CI invoke the Convex
 * development deploy against these inputs?* — and it never deploys, never
 * contacts Convex, never reads the ambient environment and never returns a
 * credential value.
 *
 * REUSED, NOT RESTATED
 * --------------------
 * The placeholder-key rule, the endpoint-host rule, the forbidden-source-ref
 * rule, the identity vocabulary and the environment resolver all come from the
 * existing modules. A second copy of those rules is a second answer waiting to
 * disagree with the first, so there is no second copy.
 *
 * READY_TO_INVOKE_DEV_DEPLOY means "the identity is development-shaped and a
 * deploy key is present". It does NOT mean:
 *
 *   - a development deployment exists,
 *   - the control plane is reachable,
 *   - the deployed build carries the current result contract,
 *   - any provider credential is configured on that deployment,
 *   - the release gate admits this candidate.
 *
 * Those are separate checks with separate evidence.
 */
import {
  DEPLOYMENT_ENV_VAR,
  resolveDeploymentEnvironment,
  DeploymentPolicyError,
} from "../../convex/lib/deploymentEnvironment";
import { deploymentIdentityProblem } from "./production-config";
import {
  PLACEHOLDER_DEPLOY_KEY_PATTERN,
  httpsHost,
  isForbiddenDeploySourceRef,
} from "./production-deploy-guard";

export const DEVELOPMENT_DEPLOY_GUARD_SCHEMA = "phase286.development-deploy-guard/v1";

export type DevelopmentDeployGuardState =
  | "READY_TO_INVOKE_DEV_DEPLOY"
  | "PLACEHOLDER_DEPLOY_KEY"
  | "MISSING_DEPLOY_KEY"
  | "FORBIDDEN_SOURCE_REF"
  | "PRODUCTION_IDENTITY"
  | "WRONG_IDENTITY"
  | "MISSING_DEPLOYMENT_IDENTITY"
  | "WRONG_ENVIRONMENT"
  | "WRONG_CONVEX_URL"
  | "WRONG_SITE_URL";

export const DEVELOPMENT_DEPLOY_GUARD_PRECEDENCE: readonly DevelopmentDeployGuardState[] = [
  "PLACEHOLDER_DEPLOY_KEY",
  "MISSING_DEPLOY_KEY",
  "FORBIDDEN_SOURCE_REF",
  "PRODUCTION_IDENTITY",
  "WRONG_IDENTITY",
  "MISSING_DEPLOYMENT_IDENTITY",
  "WRONG_ENVIRONMENT",
  "WRONG_CONVEX_URL",
  "WRONG_SITE_URL",
  "READY_TO_INVOKE_DEV_DEPLOY",
];

/**
 * The identity CI must be given to deploy development: `dev:<team>:<project>`.
 * `prod:` is refused loudly (that is the point of the guard), and
 * `preview:`/`local:`/`anonymous:` are refused as the wrong target rather than
 * quietly accepted because they are also "not production".
 */
export const DEVELOPMENT_DEPLOYMENT_IDENTITY_PATTERN = /^dev:[a-z0-9-]+:[a-z0-9-]+$/i;

const CONVEX_CLOUD_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.convex\.cloud$/i;
const CONVEX_SITE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.convex\.site$/i;

export interface DevelopmentDeployGuardInput {
  /** Deploy key value. Used for presence/placeholder only; never copied to the report. */
  convexDeployKey?: string;
  convexDeployment?: string;
  viteConvexUrl?: string;
  convexSiteUrl?: string;
  xstarzDeploymentEnv?: string;
  /**
   * Git ref CI is checking out (`GITHUB_REF` / `SOURCE_REF`).
   *
   * The repository-wide rule is that `main` is not a deployable source (its tip
   * still serves the leaked OTP credential), and a development deployment is
   * not exempt: it is reachable, so it would serve the same leak. The rule is
   * imported rather than re-decided here.
   */
  sourceRef?: string;
}

export interface DevelopmentDeployGuardReport {
  schema: string;
  state: DevelopmentDeployGuardState;
  /** True only for READY_TO_INVOKE_DEV_DEPLOY. Not a deployment, not a release. */
  mayInvokeDeploy: boolean;
  /** Always false: this checker does not deploy. */
  deploymentPerformed: false;
  /** Always false: a development deploy is never production verification. */
  productionVerified: false;
  /** Always false: the release gate is a different command. */
  releaseAdmitted: false;
  keyPresent: boolean;
  deployment: {
    declared: string | null;
    developmentShaped: boolean;
    productionShaped: boolean;
  };
  urls: {
    viteConvexUrlHost: string | null;
    convexSiteUrlHost: string | null;
  };
  environment: {
    declared: string | null;
    resolved: string | null;
    isDevelopment: boolean;
  };
  problems: readonly string[];
  statement: string;
}

const trim = (value: string | undefined): string =>
  typeof value === "string" ? value.trim() : "";

function worst(states: readonly DevelopmentDeployGuardState[]): DevelopmentDeployGuardState {
  for (const state of DEVELOPMENT_DEPLOY_GUARD_PRECEDENCE) {
    if (states.includes(state)) return state;
  }
  return "MISSING_DEPLOY_KEY";
}

/**
 * Pure. Same input, same report. No clock, no filesystem, no network, no
 * ambient environment access.
 */
export function evaluateDevelopmentDeployGuard(
  input: DevelopmentDeployGuardInput,
): DevelopmentDeployGuardReport {
  const states: DevelopmentDeployGuardState[] = [];
  const problems: string[] = [];

  const key = trim(input.convexDeployKey);
  const keyPresent = key.length > 0;
  if (!keyPresent) {
    states.push("MISSING_DEPLOY_KEY");
    problems.push(
      "CONVEX_DEPLOY_KEY is absent; a DEVELOPMENT deploy key must be supplied as a CI secret, never committed",
    );
  } else if (key.length < 16 || PLACEHOLDER_DEPLOY_KEY_PATTERN.test(key)) {
    states.push("PLACEHOLDER_DEPLOY_KEY");
    problems.push("CONVEX_DEPLOY_KEY is a placeholder or too short to be a real deploy key");
  }

  const sourceRef = trim(input.sourceRef);
  if (sourceRef && isForbiddenDeploySourceRef(sourceRef)) {
    states.push("FORBIDDEN_SOURCE_REF");
    problems.push(
      "source ref is main; main still serves the leaked OTP credential at its tip and must not be deployed to any deployment, development included",
    );
  }

  const deployment = trim(input.convexDeployment) || null;
  let developmentShaped = false;
  let productionShaped = false;
  if (deployment === null) {
    states.push("MISSING_DEPLOYMENT_IDENTITY");
    problems.push("CONVEX_DEPLOYMENT is absent; a `dev:<team>:<project>` identity is required");
  } else if (deploymentIdentityProblem(deployment) === null) {
    // `deploymentIdentityProblem` returns null only for a `prod:` identity.
    productionShaped = true;
    states.push("PRODUCTION_IDENTITY");
    problems.push(
      "CONVEX_DEPLOYMENT names the PRODUCTION deployment; a development deploy must never target production",
    );
  } else if (!DEVELOPMENT_DEPLOYMENT_IDENTITY_PATTERN.test(deployment)) {
    states.push("WRONG_IDENTITY");
    problems.push(
      "CONVEX_DEPLOYMENT is not a `dev:<team>:<project>` development identity (preview, local and anonymous targets are not this workflow's job)",
    );
  } else {
    developmentShaped = true;
  }

  let resolved: string | null = null;
  let isDevelopment = false;
  const declaredEnv = trim(input.xstarzDeploymentEnv) || null;
  if (declaredEnv !== null) {
    try {
      resolved = resolveDeploymentEnvironment((name) =>
        name === DEPLOYMENT_ENV_VAR ? input.xstarzDeploymentEnv : undefined,
      );
      isDevelopment = resolved === "development";
      if (!isDevelopment) {
        states.push("WRONG_ENVIRONMENT");
        problems.push(
          `${DEPLOYMENT_ENV_VAR} resolves to ${resolved}, but this workflow deploys development only`,
        );
      }
    } catch (error) {
      states.push("WRONG_ENVIRONMENT");
      problems.push(
        error instanceof DeploymentPolicyError
          ? error.message
          : `${DEPLOYMENT_ENV_VAR} is not a recognised environment`,
      );
    }
  }
  // Absent is allowed: the deployment's own value is what governs runtime
  // behaviour, and this workflow neither sets nor needs it.

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

  const state = states.length === 0 ? "READY_TO_INVOKE_DEV_DEPLOY" : worst(states);
  const mayInvokeDeploy = state === "READY_TO_INVOKE_DEV_DEPLOY";

  return {
    schema: DEVELOPMENT_DEPLOY_GUARD_SCHEMA,
    state,
    mayInvokeDeploy,
    deploymentPerformed: false,
    productionVerified: false,
    releaseAdmitted: false,
    keyPresent,
    deployment: { declared: deployment, developmentShaped, productionShaped },
    urls: { viteConvexUrlHost: viteHost, convexSiteUrlHost: siteHost },
    environment: { declared: declaredEnv, resolved, isDevelopment },
    problems,
    statement: mayInvokeDeploy
      ? "Inputs are development-shaped and a deploy key is present. This is not a deployment and not a release admission."
      : "Development deploy is refused. This is a missing, production or non-development input, not a negative result about any live deployment.",
  };
}

export function formatDevelopmentDeployGuard(report: DevelopmentDeployGuardReport): string {
  const lines = [
    `schema: ${report.schema}`,
    `state: ${report.state}`,
    `mayInvokeDeploy: ${report.mayInvokeDeploy ? "yes" : "no"}`,
    `deploymentPerformed: no`,
    `productionVerified: no`,
    `releaseAdmitted: no`,
    `keyPresent: ${report.keyPresent ? "yes" : "no"}`,
    `deployment: ${report.deployment.declared ?? "<absent>"} (developmentShaped: ${report.deployment.developmentShaped ? "yes" : "no"}, productionShaped: ${report.deployment.productionShaped ? "yes" : "no"})`,
    `VITE_CONVEX_URL host: ${report.urls.viteConvexUrlHost ?? "<absent>"}`,
    `CONVEX_SITE_URL host: ${report.urls.convexSiteUrlHost ?? "<absent>"}`,
    `environment: ${report.environment.resolved ?? "undeclared"}`,
    "",
    "problems:",
    ...(report.problems.length === 0 ? ["  none"] : report.problems.map((line) => `  - ${line}`)),
    "",
    `statement: ${report.statement}`,
    "This command does not deploy, does not print a credential, and does not admit a release.",
  ];
  return `${lines.join("\n")}\n`;
}

export function developmentDeployGuardJson(report: DevelopmentDeployGuardReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function developmentDeployGuardExitCode(report: DevelopmentDeployGuardReport): 0 | 1 {
  return report.mayInvokeDeploy ? 0 : 1;
}
