// This file configures the auth providers. Do not restructure it casually.
//
// Phase 185 added the `signIn` block below. That is a configuration change to
// the existing `convexAuth` call, not a new provider and not a change to the
// auth model: the provider list is unchanged.
//
// Phase 246 adds Google OAuth without OTP. Google identity is the auth factor;
// no email OTP is required after successful Google authentication.
//
// Phase 270 retires the email-OTP provider (safe, non-destructive): it is no
// longer registered, so no new email-OTP sign-in can be started or completed.
// Auth DATA is untouched — `authTables` (users, accounts, sessions, refresh
// tokens, verification codes) stays exactly as deployed, existing identities
// and sessions keep working (session continuity is provider-independent),
// and the former email-OTP users' return path is Google sign-in under the
// Phase 246 linking rules. The durable OTP anti-abuse limiter
// (`otpLimiter.ts`, `otpResendBuckets`) is retained frozen pending a separate
// data-lifecycle decision — see the module header.

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
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
 * Convex Auth defaults to 10. This global credential-attempt budget is
 * retained unchanged after the Phase 270 email-OTP retirement: it applies to
 * any credential-provider sign-in, it is not email-specific, and keeping it
 * preserves the deployed auth configuration rather than redesigning it.
 */
export const MAX_FAILED_SIGN_IN_ATTEMPTS_PER_HOUR = 5;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous, googleProvider],
  signIn: {
    maxFailedAttempsPerHour: MAX_FAILED_SIGN_IN_ATTEMPTS_PER_HOUR,
  },
});
