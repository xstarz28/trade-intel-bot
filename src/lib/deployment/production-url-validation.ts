/**
 * Phase 260 — Production URL validation
 *
 * Deterministic, pure validation for production activation.
 * No I/O, no env access, no secrets, no network.
 *
 * Covers:
 * - valid production
 * - invalid localhost
 * - wrong deployment identity
 * - missing deployment identity
 * - HTTP site URL
 * - mismatched callback domain
 *
 * Callback must be `<production-site>/api/auth/callback/google`
 * where origin matches CONVEX_SITE_URL origin exactly.
 */

import { deploymentIdentityProblem } from "./production-config";

export type ProductionUrlValidationOutcome =
  | "VALID_PRODUCTION"
  | "INVALID_LOCALHOST"
  | "WRONG_DEPLOYMENT_IDENTITY"
  | "MISSING_DEPLOYMENT_IDENTITY"
  | "HTTP_SITE_URL"
  | "MISMATCHED_CALLBACK_DOMAIN"
  | "INVALID_CONVEX_URL"
  | "INVALID_CALLBACK_PATH"
  | "NOT_HTTPS";

export interface ProductionUrlValidationInput {
  convexDeployment?: string | null;
  convexSiteUrl?: string | null;
  viteConvexUrl?: string | null;
  /** Full callback URL, e.g. https://<site>.convex.site/api/auth/callback/google */
  callbackUrl?: string | null;
}

export interface ProductionUrlValidationDetail {
  field: "CONVEX_DEPLOYMENT" | "CONVEX_SITE_URL" | "VITE_CONVEX_URL" | "CALLBACK_URL";
  outcome: ProductionUrlValidationOutcome;
  message: string;
}

export interface ProductionUrlValidationReport {
  valid: boolean;
  outcomes: ProductionUrlValidationOutcome[];
  details: ProductionUrlValidationDetail[];
  siteHost: string | null;
  viteHost: string | null;
  callbackHost: string | null;
  deploymentShaped: boolean;
  callbackOriginMatches: boolean;
}

const CONVEX_CLOUD_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.convex\.cloud$/i;
const CONVEX_SITE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.convex\.site$/i;
const EXPECTED_CALLBACK_PATH = "/api/auth/callback/google";

function trim(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopback(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".local")
  );
}

export function validateConvexSiteUrl(siteUrl: string | null): ProductionUrlValidationDetail | null {
  if (siteUrl === null) return null;
  const url = parseUrl(siteUrl);
  if (!url) {
    return {
      field: "CONVEX_SITE_URL",
      outcome: "INVALID_CONVEX_URL",
      message: "CONVEX_SITE_URL not an absolute URL",
    };
  }
  if (url.protocol !== "https:") {
    return {
      field: "CONVEX_SITE_URL",
      outcome: "HTTP_SITE_URL",
      message: "CONVEX_SITE_URL must use https",
    };
  }
  if (isLoopback(url.hostname)) {
    return {
      field: "CONVEX_SITE_URL",
      outcome: "INVALID_LOCALHOST",
      message: "CONVEX_SITE_URL points at loopback, cannot be production",
    };
  }
  if (!CONVEX_SITE_HOST.test(url.hostname)) {
    return {
      field: "CONVEX_SITE_URL",
      outcome: "INVALID_CONVEX_URL",
      message: "CONVEX_SITE_URL must be on *.convex.site",
    };
  }
  return null;
}

export function validateViteConvexUrl(viteUrl: string | null): ProductionUrlValidationDetail | null {
  if (viteUrl === null) return null;
  const url = parseUrl(viteUrl);
  if (!url) {
    return {
      field: "VITE_CONVEX_URL",
      outcome: "INVALID_CONVEX_URL",
      message: "VITE_CONVEX_URL not an absolute URL",
    };
  }
  if (url.protocol !== "https:") {
    return {
      field: "VITE_CONVEX_URL",
      outcome: "HTTP_SITE_URL",
      message: "VITE_CONVEX_URL must use https",
    };
  }
  if (isLoopback(url.hostname)) {
    return {
      field: "VITE_CONVEX_URL",
      outcome: "INVALID_LOCALHOST",
      message: "VITE_CONVEX_URL points at loopback",
    };
  }
  if (!CONVEX_CLOUD_HOST.test(url.hostname)) {
    return {
      field: "VITE_CONVEX_URL",
      outcome: "INVALID_CONVEX_URL",
      message: "VITE_CONVEX_URL must be on *.convex.cloud",
    };
  }
  return null;
}

export function validateDeploymentIdentity(identity: string | null): ProductionUrlValidationDetail | null {
  if (identity === null) {
    return {
      field: "CONVEX_DEPLOYMENT",
      outcome: "MISSING_DEPLOYMENT_IDENTITY",
      message: "CONVEX_DEPLOYMENT is absent",
    };
  }
  const problem = deploymentIdentityProblem(identity);
  if (problem !== null) {
    const isNonProd = /development, preview or local/.test(problem);
    return {
      field: "CONVEX_DEPLOYMENT",
      outcome: isNonProd ? "WRONG_DEPLOYMENT_IDENTITY" : "WRONG_DEPLOYMENT_IDENTITY",
      message: `CONVEX_DEPLOYMENT ${problem}`,
    };
  }
  return null;
}

export function validateCallbackUrl(
  callbackUrl: string | null,
  siteUrl: string | null,
): ProductionUrlValidationDetail | null {
  if (callbackUrl === null) return null;
  const cb = parseUrl(callbackUrl);
  if (!cb) {
    return {
      field: "CALLBACK_URL",
      outcome: "INVALID_CALLBACK_PATH",
      message: "callback URL not an absolute URL",
    };
  }
  if (cb.protocol !== "https:") {
    return {
      field: "CALLBACK_URL",
      outcome: "NOT_HTTPS",
      message: "callback must use https",
    };
  }
  if (cb.pathname !== EXPECTED_CALLBACK_PATH) {
    return {
      field: "CALLBACK_URL",
      outcome: "INVALID_CALLBACK_PATH",
      message: `callback must be ${EXPECTED_CALLBACK_PATH}`,
    };
  }
  if (siteUrl !== null) {
    const site = parseUrl(siteUrl);
    if (site && cb.origin !== site.origin) {
      return {
        field: "CALLBACK_URL",
        outcome: "MISMATCHED_CALLBACK_DOMAIN",
        message: `callback origin ${cb.origin} does not match CONVEX_SITE_URL origin ${site.origin}`,
      };
    }
  }
  return null;
}

export function validateProductionConfiguration(
  input: ProductionUrlValidationInput,
): ProductionUrlValidationReport {
  const site = trim(input.convexSiteUrl);
  const vite = trim(input.viteConvexUrl);
  const dep = trim(input.convexDeployment);
  const cb = trim(input.callbackUrl);

  const details: ProductionUrlValidationDetail[] = [];
  const outcomes: ProductionUrlValidationOutcome[] = [];

  const siteErr = validateConvexSiteUrl(site);
  if (siteErr) {
    details.push(siteErr);
    outcomes.push(siteErr.outcome);
  }

  const viteErr = validateViteConvexUrl(vite);
  if (viteErr) {
    details.push(viteErr);
    outcomes.push(viteErr.outcome);
  }

  const depErr = validateDeploymentIdentity(dep);
  if (depErr) {
    details.push(depErr);
    outcomes.push(depErr.outcome);
  }

  const cbErr = validateCallbackUrl(cb, site);
  if (cbErr) {
    details.push(cbErr);
    outcomes.push(cbErr.outcome);
  }

  const siteHost = site ? parseUrl(site)?.hostname ?? null : null;
  const viteHost = vite ? parseUrl(vite)?.hostname ?? null : null;
  const callbackHost = cb ? parseUrl(cb)?.hostname ?? null : null;

  const deploymentShaped = dep !== null && deploymentIdentityProblem(dep) === null;
  const callbackOriginMatches =
    site !== null && cb !== null
      ? (() => {
          const s = parseUrl(site);
          const c = parseUrl(cb);
          return s !== null && c !== null && s.origin === c.origin;
        })()
      : false;

  const valid = details.length === 0;

  return {
    valid,
    outcomes: valid ? ["VALID_PRODUCTION"] : outcomes,
    details,
    siteHost,
    viteHost,
    callbackHost,
    deploymentShaped,
    callbackOriginMatches,
  };
}

/**
 * Deterministic cases required by Phase260 Task C
 */
export const PRODUCTION_URL_VALIDATION_CASES = {
  validProduction: {
    convexDeployment: "prod:myteam:myproject",
    convexSiteUrl: "https://myproject-123.convex.site",
    viteConvexUrl: "https://myproject-123.convex.cloud",
    callbackUrl: "https://myproject-123.convex.site/api/auth/callback/google",
    expectedValid: true,
  },
  invalidLocalhost: {
    convexDeployment: "prod:myteam:myproject",
    convexSiteUrl: "http://localhost:5173",
    viteConvexUrl: "http://localhost:5173",
    callbackUrl: "http://localhost:5173/api/auth/callback/google",
    expectedOutcomes: ["INVALID_LOCALHOST", "HTTP_SITE_URL"] as ProductionUrlValidationOutcome[],
  },
  wrongDeploymentIdentity: {
    convexDeployment: "dev:myteam:myproject",
    convexSiteUrl: "https://myproject-123.convex.site",
    viteConvexUrl: "https://myproject-123.convex.cloud",
    callbackUrl: "https://myproject-123.convex.site/api/auth/callback/google",
    expectedOutcomes: ["WRONG_DEPLOYMENT_IDENTITY"] as ProductionUrlValidationOutcome[],
  },
  missingDeploymentIdentity: {
    convexDeployment: null,
    convexSiteUrl: "https://myproject-123.convex.site",
    viteConvexUrl: "https://myproject-123.convex.cloud",
    callbackUrl: "https://myproject-123.convex.site/api/auth/callback/google",
    expectedOutcomes: ["MISSING_DEPLOYMENT_IDENTITY"] as ProductionUrlValidationOutcome[],
  },
  httpSiteUrl: {
    convexDeployment: "prod:myteam:myproject",
    convexSiteUrl: "http://myproject-123.convex.site",
    viteConvexUrl: "http://myproject-123.convex.cloud",
    callbackUrl: "http://myproject-123.convex.site/api/auth/callback/google",
    expectedOutcomes: ["HTTP_SITE_URL"] as ProductionUrlValidationOutcome[],
  },
  mismatchedCallbackDomain: {
    convexDeployment: "prod:myteam:myproject",
    convexSiteUrl: "https://myproject-123.convex.site",
    viteConvexUrl: "https://myproject-123.convex.cloud",
    callbackUrl: "https://other-project-456.convex.site/api/auth/callback/google",
    expectedOutcomes: ["MISMATCHED_CALLBACK_DOMAIN"] as ProductionUrlValidationOutcome[],
  },
} as const;
