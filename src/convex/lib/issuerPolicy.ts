/**
 * Federated issuer trust policy.
 *
 * SERVER-ONLY. Decides which JWT issuers a deployment will accept identities
 * from.
 *
 * ## Why this is a security boundary
 *
 * A trusted issuer is not a convenience setting. Whoever controls a trusted
 * issuer's JWKS can mint a token this deployment accepts as a signed-in user —
 * for any account. Trusting an external issuer is therefore equivalent to
 * granting that party the ability to impersonate users.
 *
 * Phase 185 made the retired platform issuer opt-in, which removed the ambient
 * trust. Phase 185b goes further, because opt-in is still reachable by
 * configuration: **production must not trust it at all**, even if someone sets
 * the variable.
 *
 * ## Policy
 *
 * | Environment | Federation |
 * | --- | --- |
 * | production | Self-issued only. A configured federated issuer is a hard error. |
 * | preview / development | An explicitly configured issuer is allowed. |
 *
 * Production fails closed: a forbidden issuer does not get ignored with a
 * warning, it refuses to build a config at all. Silently dropping it would let
 * a deployment run in a state its operator believes is federated, which is its
 * own kind of unsafe.
 */

import {
  DEPLOYMENT_ENV_VAR,
  resolveDeploymentEnvironment,
  type EnvSource,
} from "./deploymentEnvironment";

export const FEDERATED_ISSUER_VAR = "VLY_CONVEX_AUTH_ISSUER";

/**
 * Issuer hosts belonging to the retired platform.
 *
 * Listed so that a regression re-enabling them is rejected by name rather than
 * only by the general production rule — defence in depth, and a clearer error.
 */
export const RETIRED_ISSUER_HOSTS = ["freebuff.com", "freebuff.app", "vly.ai"];

/**
 * Delivery-side forbidden hosts. Historically exported from the email
 * delivery module; Phase 270 retired that module along with the email-OTP
 * provider, and the denylist moves here with its meaning unchanged: a sender
 * or issuer identity on any of these hosts is the retired third-party
 * platform and must never be accepted. Kept under its original name so the
 * deployment-verification boundary keeps grepping to one authoritative list.
 */
export const FORBIDDEN_DELIVERY_HOSTS = ["auth.freebuff.app", ...RETIRED_ISSUER_HOSTS];

export class IssuerPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssuerPolicyError";
  }
}

export type IssuerDecision =
  | { federated: false; reason: "not_configured" | "production_self_only" }
  | { federated: true; issuer: string; jwks: string };

function isRetiredIssuer(host: string): boolean {
  const h = host.toLowerCase();
  return RETIRED_ISSUER_HOSTS.some((retired) => h === retired || h.endsWith(`.${retired}`));
}

/**
 * Decide whether federated sign-in is permitted, and from which issuer.
 *
 * Throws rather than returning a "denied" result when production has been
 * explicitly misconfigured, so the mistake surfaces at deploy time.
 */
export function resolveFederatedIssuer(env: EnvSource): IssuerDecision {
  const environment = resolveDeploymentEnvironment(env);
  const raw = env(FEDERATED_ISSUER_VAR);
  const configured = (raw ?? "").trim();

  // Empty or whitespace is treated as absent, in every environment.
  if (configured.length === 0) {
    return {
      federated: false,
      reason: environment === "production" ? "production_self_only" : "not_configured",
    };
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new IssuerPolicyError(
      `${FEDERATED_ISSUER_VAR} is not a valid absolute URL (received ${JSON.stringify(raw)}).`,
    );
  }

  // http:// would allow a network attacker to serve the JWKS.
  if (url.protocol !== "https:") {
    throw new IssuerPolicyError(
      `${FEDERATED_ISSUER_VAR} must use https (received ${JSON.stringify(url.protocol)}).`,
    );
  }

  if (environment === "production") {
    // Named check first: a more actionable error than the generic rule.
    if (isRetiredIssuer(url.hostname)) {
      throw new IssuerPolicyError(
        `${FEDERATED_ISSUER_VAR} points at the retired platform issuer ` +
          `(${url.hostname}), which production must never trust. ` +
          "Unset it, or deploy with " +
          `${DEPLOYMENT_ENV_VAR}="preview" if this is not production.`,
      );
    }
    // Any external issuer is refused in production. Approving a new federation
    // partner is a deliberate architectural decision, not a variable someone
    // sets on a deployment.
    throw new IssuerPolicyError(
      `${FEDERATED_ISSUER_VAR} is set to ${url.origin}, but production trusts only ` +
        "its own issuer. External federation requires an explicitly approved " +
        "mechanism, not an environment variable.",
    );
  }

  // Preview and development: allowed, still https-only and still explicit.
  return {
    federated: true,
    issuer: configured,
    jwks: `${configured}/api/web/.well-known/jwks.json`,
  };
}
