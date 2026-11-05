import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import Google from "@auth/core/providers/google";

const LEGACY_MIGRATION_ORIGINS = new Set([
  "https://xstarzganaliys.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function allowedLegacyRedirectOrigins(): Set<string> {
  const allowed = new Set(LEGACY_MIGRATION_ORIGINS);
  const configuredSiteUrl = process.env.SITE_URL;
  if (configuredSiteUrl) {
    try {
      allowed.add(new URL(configuredSiteUrl).origin);
    } catch {
      // An invalid legacy SITE_URL must not expand the redirect allowlist.
    }
  }
  return allowed;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, Anonymous],
  callbacks: {
    async redirect({ redirectTo }) {
      const baseUrl = process.env.SITE_URL || "https://xstarzganaliys.com";
      const target = new URL(redirectTo, baseUrl);
      if (!allowedLegacyRedirectOrigins().has(target.origin)) {
        throw new Error("Legacy account migration redirect origin is not allowed.");
      }
      return target.toString();
    },
  },
});
