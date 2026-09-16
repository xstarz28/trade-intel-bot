/**
 * Phase 227 — typed owner id for user-scoped tables.
 *
 * Four modules (alertRules, notifications, notificationPreferences,
 * runtimeHealth) used `(await ctx.auth.getUserIdentity())?.subject` as the
 * `userId` column and needed an unchecked cast to compile. That cast hid a real
 * defect: Convex Auth mints `subject` as `userId|sessionId` (see
 * identitySubject.ts), so those tables were keyed per SESSION, not per user —
 * every re-login orphaned the previous rules/notifications/preferences, and
 * `schemaValidation: false` let the malformed id through.
 *
 * `getAuthUserId` is the library's own extractor and returns `Id<"users">`,
 * so the column type is satisfied without a cast.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import { userIdFromSubject } from "./identitySubject";
import type { QueryCtx, MutationCtx } from "../_generated/server";

export type AuthCtx = Pick<QueryCtx | MutationCtx, "auth">;

/** The authenticated user's document id, or null when there is no identity. */
export async function authUserId(ctx: AuthCtx): Promise<Id<"users"> | null> {
  return getAuthUserId(ctx);
}

// ── Full user document resolution ────────────────────────────────

export type DbCtx = Pick<QueryCtx | MutationCtx, "auth" | "db">;

/**
 * Resolve the caller to a `users` document: email index first (registered
 * users), then the id extracted from the composite subject (guests).
 * Previously copy-pasted into analyses/journal/positionProtection/
 * historicalIntelligence with an untyped db; entitlements.ts had the typed form.
 */
export async function resolveUser(ctx: DbCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const email = identity.email;
  if (email) {
    const byEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (byEmail) return byEmail;
  }
  // Convex Auth mints `sub` as `userId|sessionId`; the raw subject is not a
  // document id. See identitySubject.ts.
  const userId = userIdFromSubject(identity.subject);
  if (!userId) return null;
  try {
    return await ctx.db.get(userId as Id<"users">);
  } catch {
    return null;
  }
}
