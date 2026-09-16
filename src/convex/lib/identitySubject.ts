/**
 * Resolving a Convex Auth `identity.subject` to a user id.
 *
 * Convex Auth mints its JWT with a COMPOSITE subject:
 *
 *     sub = `${userId}${TOKEN_SUB_CLAIM_DIVIDER}${sessionId}`     // divider: "|"
 *
 * and sets no other identifying claim — in particular there is no `email`
 * claim (see `@convex-dev/auth/dist/server/implementation/tokens.js`).
 *
 * Treating that value as a document id is not a lookup that merely misses: the
 * string contains a character no Convex id contains, so `ctx.db.get` rejects
 * it and the caller is reported as unauthenticated. Because the library sets
 * no email claim, an email-based fallback never rescues it either.
 *
 * That was the Phase 204 defect. It was invisible to the test-suite because
 * every test double mocked `{ subject: "user_A" }`, a shape the library never
 * produces, so the mocks agreed with the bug. It surfaced only when the
 * Evidence D harness ran against a real deployment and a valid session came
 * back UNAUTHENTICATED.
 *
 * The library exposes `getAuthUserId(ctx)`, which is the right thing to call
 * from a query/mutation ctx. These helpers exist for the places that need the
 * same rule without a ctx — notably test doubles, which must construct the
 * REAL subject shape rather than a convenient one.
 */

/**
 * The divider Convex Auth places between the user id and the session id.
 *
 * Kept as a named constant so the intent is greppable, and pinned by
 * `identity-subject.phase204.test.ts` against the installed library so an
 * upstream change fails loudly instead of silently degrading auth.
 */
export const TOKEN_SUB_CLAIM_DIVIDER = "|";

/**
 * Extract the user id from an `identity.subject`.
 *
 * Accepts both the composite form and a bare subject: a federated provider may
 * issue a plain subject, and splitting must not corrupt it.
 *
 * @returns the user id, or `null` when the subject carries none. Returning
 * `null` rather than `""` matters — an empty string is falsy but still a
 * string, and would flow into a document lookup as a malformed id.
 */
export function userIdFromSubject(subject: string | null | undefined): string | null {
  if (typeof subject !== "string") return null;
  const [userId] = subject.split(TOKEN_SUB_CLAIM_DIVIDER);
  const trimmed = userId?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build a subject in the shape the library really mints.
 *
 * For test doubles only. A mock that returns a bare id re-creates the blind
 * spot this module exists to close, so tests should construct identities with
 * this helper instead of hand-writing `{ subject: "user_A" }`.
 */
export function testIdentitySubject(userId: string, sessionId = "session_test"): string {
  return `${userId}${TOKEN_SUB_CLAIM_DIVIDER}${sessionId}`;
}
