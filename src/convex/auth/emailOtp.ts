import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { makeFunctionReference } from "convex/server";
import type { GenericActionCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import {
  EmailDeliveryError,
  sendXstarzVerificationEmail,
} from "../lib/emailDelivery";
import { hashIdentifier, type ConsumeResult } from "../otpLimiter";

/**
 * Reference to the durable limiter mutation.
 *
 * `internal.otpLimiter.*` would be the normal way to write this, but that
 * type comes from `_generated/api.d.ts`, which can only be refreshed by
 * `npx convex codegen` against a real deployment — unavailable here, and
 * hand-editing `_generated/*` is forbidden. `makeFunctionReference` is the
 * documented, officially supported way to name a function without the
 * generated types. At runtime `internal` is `anyApi`, a proxy that resolves
 * the identical string path, so this is the same reference by a different
 * route. Replace it with `internal.otpLimiter.consumeResendAllowance` once
 * codegen can run.
 */
const consumeResendAllowanceRef = makeFunctionReference<
  "mutation",
  { identityHash: string; now?: number },
  ConsumeResult
>("otpLimiter:consumeResendAllowance");

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
 *   (`implementation/rateLimit.ts`). Phase 187 deliberately does NOT add a
 *   second failed-attempt counter: a competing counter would create a second
 *   source of truth for authentication state.
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

  // The upstream Auth.js `EmailConfig["sendVerificationRequest"]` type declares
  // a single parameter, but Convex Auth actually invokes it with a second
  // argument — the ActionCtx — using its own `@ts-expect-error` at the call
  // site (`implementation/signIn.ts`, "Figure out typing for email providers
  // so they can access ctx"). The runtime contract is therefore two
  // parameters while the published type says one.
  //
  // This suppression covers exactly that upstream gap. It is not a broad
  // `any` escape: `ctx` is explicitly typed as GenericActionCtx<DataModel>
  // below, so everything on our side of the boundary stays fully checked.
  // @ts-expect-error -- upstream type omits the ctx parameter it passes.
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    // Convex Auth passes an ActionCtx here. The upstream Auth.js `EmailConfig`
    // type only declares one parameter, which is why the library itself calls
    // this with a `@ts-expect-error`. Typing it explicitly keeps `ctx` sound
    // on our side of the boundary.
    ctx: GenericActionCtx<DataModel>,
  ) {
    // Phase 187: the allowance now lives in the database, not in this
    // process. Convex Auth hands the provider an ActionCtx, so the callback
    // can run a mutation — that is what makes the limit shared across
    // instances instead of per-instance.
    //
    // Check-and-record is ONE mutation on purpose. Splitting it into a query
    // plus a later write would let two concurrent requests both observe the
    // same remaining allowance and both send.
    const identityHash = await hashIdentifier(email);

    let decision;
    try {
      decision = await ctx.runMutation(consumeResendAllowanceRef, { identityHash });
    } catch {
      // §12 fail closed. Sending OTP email is security-sensitive and costs
      // real reputation, so "cannot enforce the limit" must not degrade into
      // "no limit". The message deliberately does not reveal that the
      // limiter specifically failed.
      throw new Error("Unable to send a verification code right now. Please try again shortly.");
    }

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
    } catch (error) {
      // The allowance is intentionally NOT refunded on a delivery failure.
      // A refund path would let an attacker who can force provider errors
      // retry without limit, which is the more dangerous failure mode than a
      // legitimate user waiting out one cooldown.
      //
      // Surface the category, never the payload. The underlying error can
      // embed the request body, which carries both the OTP and the API key.
      if (error instanceof EmailDeliveryError) {
        throw new Error(`Failed to send verification email (${error.reason}).`);
      }
      throw new Error("Failed to send verification email.");
    }
  },
});
