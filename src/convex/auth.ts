import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import Google from "@auth/core/providers/google";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      redirectProxyUrl: "https://xstarzanalysis.vercel.app/api/auth",
    }),
    Anonymous,
  ],
});
