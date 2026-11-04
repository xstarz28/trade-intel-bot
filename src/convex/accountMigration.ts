/**
 * User-scoped, read-only export for moving an existing Convex account to the
 * self-hosted backend. Provider caches, global scanner state, auth tokens and
 * Convex auth/session tables are intentionally excluded.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

const MAX_ROWS_PER_TABLE = 10_000;

function ensureBounded<T>(table: string, rows: T[]) {
  if (rows.length > MAX_ROWS_PER_TABLE) {
    throw new Error(`Account migration export limit exceeded for ${table}`);
  }
  return rows;
}

/**
 * Export all private Trade Intel records for the authenticated Convex user.
 * This is a snapshot for explicit migration, not an ongoing sync mechanism.
 */
export const exportMyAccount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Authenticated user record not found");

    const [
      analyses,
      journal,
      monitoredPositions,
      alertHistory,
      streamCursors,
      historicalSnapshots,
      alertRules,
      ruleAlertHistory,
      notifications,
      notificationPreferences,
      historicalEvents,
      runtimeHealthSnapshots,
    ] = await Promise.all([
      ctx.db.query("analyses").withIndex("by_user", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("analyses", rows)),
      ctx.db.query("journal").withIndex("by_user_journal", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("journal", rows)),
      ctx.db.query("monitoredPositions").withIndex("by_user_position", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("monitoredPositions", rows)),
      ctx.db.query("alertHistory").withIndex("by_user_alerts", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("alertHistory", rows)),
      ctx.db.query("streamCursors").withIndex("by_user_provider_instrument", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("streamCursors", rows)),
      ctx.db.query("historicalSnapshots").withIndex("by_user_position_ts", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("historicalSnapshots", rows)),
      ctx.db.query("alertRules").withIndex("by_user", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("alertRules", rows)),
      ctx.db.query("ruleAlertHistory").withIndex("by_user", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("ruleAlertHistory", rows)),
      ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("notifications", rows)),
      ctx.db.query("notificationPreferences").withIndex("by_user", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("notificationPreferences", rows)),
      ctx.db.query("historicalEvents").withIndex("by_user_position_ts", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("historicalEvents", rows)),
      ctx.db.query("runtimeHealthSnapshots").withIndex("by_user", (q) => q.eq("userId", userId))
        .take(MAX_ROWS_PER_TABLE + 1).then((rows) => ensureBounded("runtimeHealthSnapshots", rows)),
    ]);

    const data = {
      analyses,
      journal,
      monitoredPositions,
      alertHistory,
      streamCursors,
      historicalSnapshots,
      alertRules,
      ruleAlertHistory,
      notifications,
      notificationPreferences,
      historicalEvents,
      runtimeHealthSnapshots,
    };
    const counts = Object.fromEntries(
      Object.entries(data).map(([table, rows]) => [table, rows.length]),
    );
    const totalRows = Object.values(counts).reduce((total, count) => total + count, 0);
    if (totalRows > MAX_ROWS_PER_TABLE) {
      throw new Error("Account migration export exceeds the total row limit");
    }

    return {
      format: "trade-intel-convex-account-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      account: {
        id: user._id,
        email: user.email ?? null,
        name: user.name ?? null,
        isAnonymous: user.isAnonymous ?? false,
      },
      data,
      counts,
    };
  },
});
