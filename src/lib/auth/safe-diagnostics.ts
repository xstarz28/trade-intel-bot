/**
 * Phase 189 — safe client-side auth diagnostics.
 *
 * Passing a caught error straight to `console.error` is a real disclosure
 * risk on the auth path. A rejected sign-in can carry:
 *
 *   - provider response bodies (including vendor names and account hints)
 *   - request URLs and internal endpoint paths
 *   - tokens, one-time codes or credential fragments echoed back by a provider
 *   - stack traces exposing bundle layout and configuration
 *
 * The browser console is user-visible, is captured by extensions and session
 * recorders, and is trivially copied into a screenshot or bug report. So we
 * never log the error VALUE. We log a fixed, developer-chosen category that
 * is enough to locate the failing step in the source and nothing more.
 *
 * This is intentionally not a "sanitiser": there is no attempt to scrub an
 * arbitrary payload, because scrubbing is a losing game against nested
 * provider objects. The category is a constant known at author time.
 */

/**
 * The only auth failures a client is allowed to report. Fixed string union —
 * a caller cannot smuggle a dynamic value through this parameter.
 */
export type AuthDiagnosticCategory =
  // Phase 270: "email-code-send-failed" and "otp-verification-failed" retired
  // with the email-OTP provider; no caller can report them again.
  | "guest-session-failed"
  | "google-signin-failed"
  | "sign-out-failed";

/**
 * Report that an auth step failed, without revealing why.
 *
 * Deliberately takes NO error argument, so there is no parameter through
 * which a provider payload could reach the console even by accident.
 */
export function reportAuthDiagnostic(category: AuthDiagnosticCategory): void {
  // A stable, greppable prefix keeps this debuggable without leaking data.
  console.warn(`[auth] step failed: ${category}`);
}
