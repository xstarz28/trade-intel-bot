import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import Google from "@auth/core/providers/google";
import { resolveLegacyMigrationRedirect } from "./legacy-redirect";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, Anonymous],
  callbacks: {
    async redirect({ redirectTo }) {
      return resolveLegacyMigrationRedirect(redirectTo, process.env.SITE_URL);
    },
  },
});
