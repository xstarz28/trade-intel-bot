import type { AuthConfig } from "convex/server";

/**
 * Federated sign-in from the legacy hosting platform.
 *
 * This entry trusts an EXTERNAL issuer: any party controlling that issuer's
 * JWKS can mint a token this deployment will accept as a signed-in user. That
 * is acceptable while the project is previewed on that platform, and not
 * acceptable in production for a product that owns its own identity.
 *
 * Phase 185 therefore made it opt-in. It is included only when
 * `VLY_CONVEX_AUTH_ISSUER` is explicitly set, so a production deployment that
 * does not set it trusts exactly one issuer: itself.
 *
 * This is intentionally NOT deleted outright — the preview environment still
 * uses it, and removing it would break the platform the project is developed
 * on. Making it explicit removes the ambient trust without breaking the
 * workflow.
 */
const federatedIssuer = process.env.VLY_CONVEX_AUTH_ISSUER?.trim();

const federatedProvider =
  federatedIssuer && federatedIssuer.length > 0
    ? [
        {
          type: "customJwt" as const,
          issuer: federatedIssuer,
          jwks: `${federatedIssuer}/api/web/.well-known/jwks.json`,
          applicationID: "vly-convex",
          algorithm: "RS256" as const,
        },
      ]
    : [];

export default {
  providers: [
    // This project's own sign-in (email OTP and guest). The deployment
    // self-issues JWTs (iss = CONVEX_SITE_URL, no `kid` header) validated via
    // OIDC discovery at `${domain}/.well-known/openid-configuration`, served
    // by auth.addHttpRoutes() in convex/http.ts.
    //
    // Do NOT convert this entry to `type: "customJwt"` — that path rejects
    // tokens without a `kid` header, so sign-in would silently never confirm
    // and RequireAuth would loop back to /auth forever.
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
    ...federatedProvider,
  ],
} satisfies AuthConfig;
