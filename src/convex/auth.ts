// This file configures the auth providers. Do not restructure it casually.
//
// Phase 185 added the `signIn` block below. That is a configuration change to
// the existing `convexAuth` call, not a new provider and not a change to the
// auth model: the provider list is unchanged.
//
// Phase 246 adds Google OAuth without OTP. Google identity is the auth factor;
// no email OTP is required after successful Google authentication.

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { emailOtp } from "./auth/emailOtp";
import Google from "@auth/core/providers/google";

const googleProvider = Google({
  // Client ID/secret are injected from AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
  // via setEnvDefaults in @convex-dev/auth. Never hardcode secrets here.
  allowDangerousEmailAccountLinking: false,
  checks: ["pkce", "state"],
  profile(profile: {
    sub: string;
    name?: string;
    given_name?: string;
    email: string;
    email_verified?: boolean;
    picture?: string;
  }) {
    return {
      id: profile.sub,
      name: profile.name ?? profile.given_name ?? profile.email,
      email: profile.email,
      image: profile.picture,
      // Only treat as verified when Google says so. This prevents unverified
      // email claims from linking to existing verified accounts.
      emailVerified: profile.email_verified === true,
    };
  },
});

/**
 * Failed verification attempts allowed per identifier per hour.
 *
 * Convex Auth defaults to 10. Six digits is a 10^6 space, so 10 guesses/hour
 * already makes brute force impractical; 5 halves the budget while still
 * leaving room for a user who fat-fingers a code a few times.
 *
 * Convex Auth replenishes the allowance continuously rather than in a block,
 * so after exhausting it a user regains one attempt every 12 minutes instead
 * of being locked out for a full hour.
 */
export const MAX_FAILED_SIGN_IN_ATTEMPTS_PER_HOUR = 5;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp, Anonymous, googleProvider],
  signIn: {
    maxFailedAttempsPerHour: MAX_FAILED_SIGN_IN_ATTEMPTS_PER_HOUR,
  },
});
