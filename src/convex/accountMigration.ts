/**
 * User-scoped, read-only export for moving an existing Convex account to the
 * self-hosted backend. Provider caches, global scanner state, auth tokens and
 * Convex auth/session tables are intentionally excluded.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, type QueryCtx } from "./_generated/server";

const MAX_ROWS_PER_TABLE = 10_000;

async function takeUserRows(
  ctx: QueryCtx,
  table: any,
  index: string,
  userId: any,
) {
  const rows = await ctx.db
    .query(table)
    .withIndex(index as any, (q: any) => q.eq("userId", userId))
    .take(MAX_ROWS_PER_TABLE + 1);
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
      takeUserRows(ctx, "analyses", "by_user", userId),
      takeUserRows(ctx, "journal", "by_user_journal", userId),
      takeUserRows(ctx, "monitoredPositions", "by_user_position", userId),
      takeUserRows(ctx, "alertHistory", "by_user_alerts", userId),
      takeUserRows(ctx, "streamCursors", "by_user_provider_instrument", userId),
      takeUserRows(ctx, "historicalSnapshots", "by_user_position_ts", userId),
      takeUserRows(ctx, "alertRules", "by_user", userId),
      takeUserRows(ctx, "ruleAlertHistory", "by_user", userId),
      takeUserRows(ctx, "notifications", "by_user", userId),
      takeUserRows(ctx, "notificationPreferences", "by_user", userId),
      takeUserRows(ctx, "historicalEvents", "by_user_position_ts", userId),
      takeUserRows(ctx, "runtimeHealthSnapshots", "by_user", userId),
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
