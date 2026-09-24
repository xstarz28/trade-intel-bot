import type { AuthConfig } from "convex/server";
import { resolveFederatedIssuer } from "./lib/issuerPolicy";

/**
 * Trusted token issuers.
 *
 * A trusted issuer can mint identities this deployment accepts, so the set is
 * decided by an explicit policy rather than by reading a variable inline.
 * See `lib/issuerPolicy.ts` for the reasoning and `docs/AUTHENTICATION.md` for
 * the operator-facing rules.
 *
 * Production trusts only itself. Preview and development may opt into the
 * legacy platform federation, because the hosting preview still requires it.
 */
const federation = resolveFederatedIssuer((key) => process.env[key]);

const federatedProvider = federation.federated
  ? [
      {
        type: "customJwt" as const,
        issuer: federation.issuer,
        jwks: federation.jwks,
        applicationID: "vly-convex",
        algorithm: "RS256" as const,
      },
    ]
  : [];

export default {
  providers: [
    // This project's own sign-in (Google and guest; email OTP was retired in
    // Phase 270 — no provider calling convention remains for it). The deployment
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
