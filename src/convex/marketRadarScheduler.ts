/**
 * Durable background market scanner.
 *
 * The cron owns discovery cadence and checkpoints; provider actions remain
 * bounded by the existing provider request budgets. The foreground dashboard
 * scanner remains available for immediate refresh and low-latency views.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { DEFAULT_UNIVERSE } from "../lib/market-radar/universe";
import { ALL_SCAN_HORIZONS } from "../lib/liveScanner";
import {
  scanRadar,
  type RadarState,
} from "../lib/market-radar/radar";
import {
  toRadarCandidateSource,
  type RadarCandidateSource,
} from "../lib/market-radar/candidate-builder";
import type { RadarOpportunity } from "../lib/market-radar/types";
import type { LiveCandidateSource } from "../lib/liveCandidateBuilder";
import type { MarketData, TechnicalData } from "../lib/data/market-types";

const GLOBAL_SCOPE = "global";
const SOURCE_LIMIT = 250;
const LEASE_MS = 120_000;
const CANDLES_TO_PERSIST = 40;

function sourceKey(source: LiveCandidateSource): string {
  const timeframe = source.marketData?.timeframe?.trim().toUpperCase() ?? "UNKNOWN";
  return `${source.instrument.trim().toUpperCase()}|${timeframe}`;
}

function compactSource(source: LiveCandidateSource): LiveCandidateSource {
  const marketData = source.marketData;
  if (!marketData) return source;
  const compact = {
    instrument: source.instrument,
    assetClass: source.assetClass,
    ...(source.providerNative ? { providerNative: source.providerNative } : {}),
    marketData: {
      ...marketData,
      candles: marketData.candles.slice(-CANDLES_TO_PERSIST),
      ...(marketData.higherTimeframeCandles
        ? { higherTimeframeCandles: marketData.higherTimeframeCandles.slice(-CANDLES_TO_PERSIST) }
        : {}),
    },
    ...(source.technicalData ? { technicalData: source.technicalData } : {}),
  };
  // Convex values cannot contain undefined; JSON round-tripping strips only
  // absent optional fields before the snapshot is persisted.
  return JSON.parse(JSON.stringify(compact)) as LiveCandidateSource;
}

function toInstrumentType(assetClass: string): "forex" | "crypto" | "stock" | "commodity" | "indices" | undefined {
  if (assetClass === "equity") return "stock";
  if (assetClass === "forex" || assetClass === "crypto" || assetClass === "commodity" || assetClass === "indices") {
    return assetClass;
  }
  return undefined;
}

export const claimScan = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const existing = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();

    if (existing && existing.leaseUntil > now) {
      return { claimed: false as const };
    }

    const leaseUntil = now + LEASE_MS;
    if (existing) {
      await ctx.db.patch(existing._id, { leaseUntil, updatedAt: now });
      return {
        claimed: true as const,
        cursor: existing.cursor,
        previousResults: existing.results,
        lastScanAt: existing.lastScanAt,
      };
    }

    await ctx.db.insert("marketRadarState", {
      scope: GLOBAL_SCOPE,
      cursor: 0,
      leaseUntil,
      results: [],
      diffs: [],
      metrics: {},
      errors: [],
      lastScanAt: 0,
      updatedAt: now,
    });
    return {
      claimed: true as const,
      cursor: 0,
      previousResults: [],
      lastScanAt: 0,
    };
  },
});

export const listSources = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("marketRadarSources")
      .withIndex("by_updated_at")
      .order("desc")
      .take(SOURCE_LIMIT);
    return rows.map((row) => row.payload as LiveCandidateSource);
  },
});

export const persistScan = internalMutation({
  args: {
    updates: v.array(v.object({
      key: v.string(),
      instrument: v.string(),
      timeframe: v.string(),
      assetClass: v.string(),
      payload: v.any(),
      updatedAt: v.number(),
    })),
    cursor: v.number(),
    results: v.any(),
    diffs: v.any(),
    metrics: v.any(),
    errors: v.array(v.string()),
    lastScanAt: v.number(),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      const existing = await ctx.db
        .query("marketRadarSources")
        .withIndex("by_key", (q) => q.eq("key", update.key))
        .unique();
      if (existing) await ctx.db.patch(existing._id, update);
      else await ctx.db.insert("marketRadarSources", update);
    }

    const state = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();
    const patch = {
      cursor: args.cursor,
      leaseUntil: 0,
      results: args.results,
      diffs: args.diffs,
      metrics: args.metrics,
      errors: args.errors.slice(0, 20),
      lastScanAt: args.lastScanAt,
      updatedAt: args.lastScanAt,
    };
    if (state) await ctx.db.patch(state._id, patch);
    else await ctx.db.insert("marketRadarState", { scope: GLOBAL_SCOPE, ...patch });
    return { savedSources: args.updates.length, lastScanAt: args.lastScanAt };
  },
});

export const releaseScan = internalMutation({
  args: { now: v.number(), error: v.string() },
  handler: async (ctx, { now, error }) => {
    const state = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();
    if (!state) return;
    await ctx.db.patch(state._id, {
      leaseUntil: 0,
      errors: [error.slice(0, 500)],
      updatedAt: now,
    });
  },
});

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const state = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();
    if (!state) return null;

    const rows = await ctx.db
      .query("marketRadarSources")
      .withIndex("by_updated_at")
      .order("desc")
      .take(SOURCE_LIMIT);

    return {
      lastScanAt: state.lastScanAt,
      metrics: state.metrics,
      errors: state.errors,
      sources: rows.map((row) => row.payload as LiveCandidateSource),
    };
  },
});

export const runScheduledScan = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const claim = await ctx.runMutation(internal.marketRadarScheduler.claimScan, { now });
    if (!claim.claimed) return { skipped: true as const, reason: "previous scan still holds the lease" };

    try {
      const universe = DEFAULT_UNIVERSE.filter((entry) => entry.assetClass !== "macro");
      if (universe.length === 0) throw new Error("market radar universe is empty");

      // Three rotating passes cover H1/D1, H4/W1, and M5/H1. Two acquisitions
      // per minute preserve the shared provider request budget.
      const instrumentIndex = claim.cursor % universe.length;
      const timeframePass = Math.floor(claim.cursor / universe.length) % 3;
      const entry = universe[instrumentIndex]!;
      const instrumentType = toInstrumentType(entry.assetClass);
      const timeframes = timeframePass === 0
        ? ["H1", "D1"]
        : timeframePass === 1
          ? ["H4", "W1"]
          : ["M5", "H1"];

      const existingSources = await ctx.runQuery(internal.marketRadarScheduler.listSources, {});
      const sourceMap = new Map(existingSources.map((source) => [sourceKey(source), source]));
      const updates: Array<{
        key: string;
        instrument: string;
        timeframe: string;
        assetClass: string;
        payload: LiveCandidateSource;
        updatedAt: number;
      }> = [];
      const errors: string[] = [];

      if (!instrumentType) {
        errors.push(`Unsupported asset class for ${entry.instrument}: ${entry.assetClass}`);
      } else {
        for (const timeframe of timeframes) {
          const response = await ctx.runAction(api.marketData.fetchMarketData, {
            instrument: entry.instrument,
            instrumentType,
            timeframe,
          });
          if (!response.success || !response.data) {
            errors.push(`${entry.instrument} ${timeframe}: ${response.error ?? "provider returned no market data"}`);
            if (response.errorCode === "RATE_LIMIT") break;
            continue;
          }

          const liveSource: LiveCandidateSource = compactSource({
            instrument: entry.instrument,
            assetClass: entry.assetClass,
            marketData: response.data as MarketData,
            ...(response.technical ? { technicalData: response.technical as TechnicalData } : {}),
          });
          const key = sourceKey(liveSource);
          sourceMap.set(key, liveSource);
          updates.push({
            key,
            instrument: entry.instrument,
            timeframe,
            assetClass: entry.assetClass,
            payload: liveSource,
            updatedAt: now,
          });
        }
      }

      const allLiveSources = Array.from(sourceMap.values());
      const universeByInstrument = new Map(universe.map((item) => [item.instrument, item]));
      const radarSources: RadarCandidateSource[] = allLiveSources.flatMap((source) => {
        if (!universeByInstrument.has(source.instrument)) return [];
        return [toRadarCandidateSource(source, allLiveSources)];
      });

      const previousEntries = Array.isArray(claim.previousResults)
        ? claim.previousResults as Array<[string, RadarOpportunity[]]>
        : [];
      const previous = new Map<string, RadarOpportunity>();
      for (const [, opportunities] of previousEntries) {
        for (const opportunity of opportunities) {
          if (!previous.has(opportunity.instrument)) previous.set(opportunity.instrument, opportunity);
        }
      }
      const previousState: RadarState = { previous, lastScanAt: claim.lastScanAt };
      const scan = scanRadar(
        radarSources,
        { horizons: ALL_SCAN_HORIZONS, maxResults: 10 },
        previousState,
        now,
      );

      const metrics = {
        totalScanned: scan.totalScanned,
        totalWithLiveData: scan.totalWithLiveData,
        totalInsufficient: scan.totalInsufficient,
        freshCount: scan.freshCount,
        delayedCount: scan.delayedCount,
        staleCount: scan.staleCount,
        unavailableCount: scan.unavailableCount,
        durationMs: scan.durationMs,
      };

      const saved = await ctx.runMutation(internal.marketRadarScheduler.persistScan, {
        updates,
        cursor: claim.cursor + 1,
        results: JSON.parse(JSON.stringify(Array.from(scan.results.entries()))),
        diffs: JSON.parse(JSON.stringify(scan.diffs)),
        metrics,
        errors,
        lastScanAt: now,
      });

      return {
        skipped: false as const,
        instrument: entry.instrument,
        timeframes,
        acquired: updates.length,
        savedSources: saved.savedSources,
        scanned: scan.totalScanned,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.marketRadarScheduler.releaseScan, {
        now: Date.now(),
        error: message,
      });
      return { skipped: false as const, error: message.slice(0, 500) };
    }
  },
});
