import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import {
  EmailDeliveryError,
  sendXstarzVerificationEmail,
} from "../lib/emailDelivery";
import { checkResendAllowed, recordResend } from "../lib/otpResendThrottle";

/**
 * How long a verification code stays valid.
 *
 * Shortened from 15 minutes to 10 in Phase 185. A six-digit code is only
 * 10^6 possibilities, so its security rests on a short window plus the
 * attempt limiting Convex Auth applies — not on the code's entropy alone.
 */
export const OTP_EXPIRY_MINUTES = 10;

/**
 * Email OTP sign-in.
 *
 * Delivery is deliberately not implemented here. This provider generates the
 * code and hands it to the Xstarz-owned delivery abstraction, which decides
 * which transactional provider actually sends it. Swapping vendors is an
 * environment change, not an auth change.
 *
 * ## Guarantees provided by Convex Auth (not reimplemented here)
 *
 * Verified against `@convex-dev/auth` internals rather than assumed:
 *
 * - Codes are stored as SHA-256 hashes, never in plaintext
 *   (`mutations/createVerificationCode.ts`).
 * - A code is deleted the moment it is consumed, so replay fails
 *   (`mutations/verifyCodeAndSignIn.ts`).
 * - Expiry is enforced server-side against `expirationTime`.
 * - Issuing a new code deletes the previous one for that account, so only the
 *   newest code is ever live.
 * - Failed sign-in attempts are rate limited per identifier
 *   (`implementation/rateLimit.ts`).
 *
 * Duplicating any of that here would add a second source of truth for
 * authentication state, which is worse than the problem it would solve.
 */
export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * OTP_EXPIRY_MINUTES,

  async generateVerificationToken() {
    // crypto.getRandomValues is a CSPRNG; Math.random must never appear here.
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    // generateRandomString is rejection-sampled, so digits stay uniform.
    return generateRandomString(random, "0123456789", 6);
  },

  async sendVerificationRequest({ identifier: email, token }) {
    // Throttle BEFORE sending. Convex Auth limits failed verification
    // attempts but not send requests, so without this an attacker could use
    // the sign-in form to mail-bomb an address and burn the sending
    // reputation of the Xstarz domain.
    const decision = checkResendAllowed(email);
    if (!decision.allowed) {
      const seconds = Math.ceil(decision.retryAfterMs / 1000);
      throw new Error(
        `Too many verification codes requested. Try again in ${seconds} seconds.`,
      );
    }

    try {
      await sendXstarzVerificationEmail(
        { recipient: email, otp: token, expiryMinutes: OTP_EXPIRY_MINUTES },
        { env: (key) => process.env[key] },
      );
      recordResend(email);
    } catch (error) {
      // Surface the category, never the payload. The underlying error can
      // embed the request body, which carries both the OTP and the API key.
      if (error instanceof EmailDeliveryError) {
        throw new Error(`Failed to send verification email (${error.reason}).`);
      }
      throw new Error("Failed to send verification email.");
    }
  },
});
