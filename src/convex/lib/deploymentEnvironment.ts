/**
 * Deployment environment policy.
 *
 * SERVER-ONLY. Shared by every auth guard that must behave differently in
 * production than in development.
 *
 * ## Why an explicit variable, and not inference
 *
 * Convex exposes exactly two system environment variables to functions:
 * `CONVEX_CLOUD_URL` and `CONVEX_SITE_URL`. Neither states whether the
 * deployment is production — a prod deployment and a dev deployment both get a
 * `https://<name>.convex.cloud` URL, and the names are indistinguishable.
 * There is no `deploymentType` available at runtime.
 *
 * `NODE_ENV` was rejected too: it describes how the *bundle* was built, not
 * which deployment the code is running against, and it is trivially
 * `"production"` in contexts that are not the production deployment.
 *
 * So the mechanism is an explicit, deliberately-set variable:
 *
 *     XSTARZ_DEPLOYMENT_ENV = production | preview | development
 *
 * Convex environment variables are per-deployment, so setting this once on the
 * production deployment is exactly the "real deployment setting" this needs to
 * be. It cannot drift with a build flag or a bundler mode.
 *
 * ## The default is the important design decision
 *
 * **Unset means production.** That is intentional and it is the opposite of
 * convenient.
 *
 * If the default were `development`, then forgetting to set the variable on
 * the production deployment would silently enable every development
 * affordance: the fake email transport, the retired federated issuer. The
 * failure would be invisible and the system would *appear* to work.
 *
 * Defaulting to production inverts that. Forgetting the variable makes a
 * developer machine fail loudly with a configuration error, which is noticed
 * in seconds and costs nothing. A misconfigured production deployment stays
 * locked down.
 *
 * Fail closed, not convenient.
 */

export type DeploymentEnvironment = "production" | "preview" | "development";

export const DEPLOYMENT_ENV_VAR = "XSTARZ_DEPLOYMENT_ENV";

export type EnvSource = (key: string) => string | undefined;

export class DeploymentPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentPolicyError";
  }
}

/**
 * Resolve the environment. Unrecognised values are a hard error rather than a
 * silent downgrade: `XSTARZ_DEPLOYMENT_ENV=prod` must not quietly become
 * development because it did not match `"production"` exactly.
 */
export function resolveDeploymentEnvironment(env: EnvSource): DeploymentEnvironment {
  const raw = env(DEPLOYMENT_ENV_VAR);

  if (raw === undefined || raw.trim().length === 0) {
    // Absent => production. See the note above: this default is a safety
    // property, not an oversight.
    return "production";
  }

  const value = raw.trim().toLowerCase();
  if (value === "production" || value === "preview" || value === "development") {
    return value;
  }

  throw new DeploymentPolicyError(
    `${DEPLOYMENT_ENV_VAR} must be "production", "preview" or "development" ` +
      `(received ${JSON.stringify(raw)}). Refusing to guess.`,
  );
}

/** True only for the real production deployment. */
export function isProductionDeployment(env: EnvSource): boolean {
  return resolveDeploymentEnvironment(env) === "production";
}

/**
 * True when development-only affordances may be used.
 *
 * Preview is deliberately NOT production, because the hosting platform's
 * preview environment still needs legacy federation. Preview is also not a
 * free-for-all: each affordance decides for itself whether preview qualifies.
 */
export function allowsDevelopmentAffordances(env: EnvSource): boolean {
  return resolveDeploymentEnvironment(env) !== "production";
}
