import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

const boundedLimit = (value: number, fallback: number, maximum: number) =>
  Math.max(1, Math.min(Math.floor(value || fallback), maximum));

/**
 * MCP-only data accessors. These are internal functions, and every query is
 * scoped to the verified users-table ID supplied by the MCP OAuth layer.
 * Text fields that could carry arbitrary instructions are intentionally
 * excluded from the initial read-only tool surface.
 */
export const listRecentAnalyses = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  handler: async (ctx, { userId, limit }) => {
    const rows = await ctx.db
      .query("analyses")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(boundedLimit(limit, 10, 25));

    return rows.map((row) => ({
      id: row._id,
      instrument: row.instrument,
      instrumentType: row.instrumentType,
      timeframe: row.timeframe,
      bias: row.bias,
      confidence: row.confidence,
      ...(row.recommendation !== undefined ? { recommendation: row.recommendation } : {}),
      ...(row.riskReward !== undefined ? { riskReward: row.riskReward } : {}),
      ...(row.price !== undefined ? { price: row.price } : {}),
      dataCompleteness: row.dataCompleteness,
      keyLevels: row.keyLevels,
      timestamp: row.timestamp,
    }));
  },
});

export const listTradeJournal = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  handler: async (ctx, { userId, limit }) => {
    const rows = await ctx.db
      .query("journal")
      .withIndex("by_user_journal", (q) => q.eq("userId", userId))
      .order("desc")
      .take(boundedLimit(limit, 10, 50));

    return rows.map((row) => ({
      id: row._id,
      instrument: row.instrument,
      instrumentType: row.instrumentType,
      timeframe: row.timeframe,
      style: row.style,
      status: row.status,
      ...(row.entry !== undefined ? { entry: row.entry } : {}),
      ...(row.stopLoss !== undefined ? { stopLoss: row.stopLoss } : {}),
      ...(row.takeProfit !== undefined ? { takeProfit: row.takeProfit } : {}),
      ...(row.riskReward !== undefined ? { riskReward: row.riskReward } : {}),
      ...(row.pnl !== undefined ? { pnl: row.pnl } : {}),
      ...(row.outcome !== undefined ? { outcome: row.outcome } : {}),
      createdAt: row.timestamps.createdAt,
      updatedAt: row.timestamps.updatedAt,
    }));
  },
});

export const listMonitoredPositions = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  handler: async (ctx, { userId, limit }) => {
    const rows = await ctx.db
      .query("monitoredPositions")
      .withIndex("by_user_lifecycle", (q) => q.eq("userId", userId))
      .order("desc")
      .take(boundedLimit(limit, 20, 50));

    return rows.map((row) => ({
      positionId: row.positionId,
      instrument: row.instrument,
      side: row.side,
      entryPrice: row.entryPrice,
      ...(row.stopLoss !== undefined ? { stopLoss: row.stopLoss } : {}),
      ...(row.takeProfit !== undefined ? { takeProfit: row.takeProfit } : {}),
      horizon: row.horizon,
      currentSeverity: row.currentSeverity,
      lifecycleState: row.lifecycleState,
      monitoringLifecycle: row.monitoringLifecycle,
      openedAt: row.openedAt,
      lastUpdateAt: row.lastUpdateAt,
    }));
  },
});

export const getRuntimeHealth = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("runtimeHealthSnapshots")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first();

    if (!row) return null;

    return {
      overallStatus: row.overallStatus,
      timestamp: row.timestamp,
      intelligenceCycleStatus: row.intelligenceCycleStatus,
      alertPipelineStatus: row.alertPipelineStatus,
      persistenceStatus: row.persistenceStatus,
      staleComponents: row.staleComponents,
      unavailableComponents: row.unavailableComponents,
      components: row.components.map((component) => ({
        component: component.component,
        status: component.status,
        freshness: component.freshness,
        consecutiveFailures: component.consecutiveFailures,
      })),
    };
  },
});
