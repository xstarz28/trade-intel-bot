import { fetchMarketCandlesBatch } from "./market-data-engine";
import { DEFAULT_UNIVERSE } from "../../src/lib/market-radar/universe";
import { selectBackgroundScanBatch } from "../../src/lib/market-radar/background-schedule";
import { scanRadar, type RadarState } from "../../src/lib/market-radar/radar";
import { toRadarCandidateSource } from "../../src/lib/market-radar/candidate-builder";
import type { LiveCandidateSource } from "../../src/lib/liveCandidateBuilder";
import type { MarketData } from "../../src/lib/data/market-types";
import type { RadarOpportunity, RadarScanConfig } from "../../src/lib/market-radar/types";
import type { TradingMode, InvestorHorizon } from "../../src/lib/recommendation-engine";

const HORIZONS: RadarScanConfig["horizons"] = [
  "SCALPING", "INTRADAY", "SWING",
  "1-4_WEEKS", "1-3_MONTHS", "3-6_MONTHS",
  "6-12_MONTHS", "1-3_YEARS", "3+_YEARS",
];
const TF_MS: Record<string, number> = {
  M5: 300_000, H1: 3_600_000, H4: 14_400_000,
  D1: 86_400_000, W1: 604_800_000,
};
function instrumentType(assetClass: string): MarketData["instrumentType"] {
  if (assetClass === "equity") return "stock";
  if (assetClass === "forex" || assetClass === "crypto" || assetClass === "commodity" || assetClass === "indices") return assetClass;
  return "indices";
}
function freshness(timestamp: number, now: number, timeframe: string): MarketData["dataFreshness"] {
  const age = now - timestamp;
  if (!Number.isFinite(age) || age < 0) return "unavailable";
  if (age < 5 * 60_000) return "realtime";
  if (age < 60 * 60_000) return "delayed";
  const limit = timeframe === "W1" ? 14 : timeframe === "D1" || timeframe === "H4" ? 4 : 2;
  return age < limit * 86_400_000 ? "stale" : "unavailable";
}
function key(source: LiveCandidateSource): string {
  return source.instrument.toUpperCase() + "|" + (source.marketData?.timeframe ?? "UNKNOWN").toUpperCase();
}
export async function runOpportunityBatch(input: {
  cursor: number;
  sources: LiveCandidateSource[];
  previousResults: RadarOpportunity[];
  now?: number;
  fetchImpl?: typeof fetch;
}) {
  const now = input.now ?? Date.now();
  const batch = selectBackgroundScanBatch(input.cursor, DEFAULT_UNIVERSE.length);
  const entry = DEFAULT_UNIVERSE[batch.instrumentIndex]!;
  const fetched = await fetchMarketCandlesBatch(
    [entry.instrument], [...batch.timeframes], 210, input.fetchImpl ?? fetch,
  );
  const valid = fetched.filter(item => item.success && item.candles.length >= 20);
  const byTimeframe = new Map(valid.map(item => [item.timeframe, item]));
  const durations = batch.timeframes.map(tf => TF_MS[tf] ?? 0);
  const updates: LiveCandidateSource[] = valid.map(item => {
    const last = item.candles[item.candles.length - 1]!;
    const higherIndex = batch.timeframes.findIndex((tf, i) =>
      i !== batch.timeframes.indexOf(item.timeframe) && (TF_MS[tf] ?? 0) > (TF_MS[item.timeframe] ?? 0),
    );
    const higher = higherIndex >= 0 ? byTimeframe.get(batch.timeframes[higherIndex]!) : undefined;
    const marketData: MarketData = {
      instrument: entry.instrument,
      instrumentType: instrumentType(entry.assetClass),
      provider: item.provider ?? "unknown",
      fetchTimestamp: now,
      price: { price: last.close, timestamp: last.timestamp, source: item.provider ?? "unknown" },
      candles: item.candles,
      timeframe: item.timeframe,
      ...(higher && higher.candles.length >= 30 ? {
        higherTimeframe: higher.timeframe,
        higherTimeframeCandles: higher.candles,
      } : {}),
      dataFreshness: freshness(last.timestamp, now, item.timeframe),
    };
    return { instrument: entry.instrument, assetClass: entry.assetClass, marketData };
  });
  const merged = new Map(input.sources.map(source => [key(source), source]));
  for (const source of updates) merged.set(key(source), source);
  const allSources = [...merged.values()];
  const radarSources = allSources.map(source => toRadarCandidateSource(source, allSources));
  const previous = new Map<string, RadarOpportunity>();
  for (const item of input.previousResults) if (!previous.has(item.instrument)) previous.set(item.instrument, item);
  const result = scanRadar(radarSources, { horizons: HORIZONS, maxResults: 20 }, {
    previous,
    lastScanAt: now,
  } satisfies RadarState, now);
  return {
    cursor: batch.nextCursor,
    instrument: entry.instrument,
    timeframes: [...batch.timeframes],
    updates,
    results: [...result.results.entries()] as Array<[TradingMode | InvestorHorizon, RadarOpportunity[]]>,
    diffs: result.diffs,
    metrics: {
      totalScanned: result.totalScanned,
      totalWithLiveData: result.totalWithLiveData,
      totalInsufficient: result.totalInsufficient,
      freshCount: result.freshCount,
      delayedCount: result.delayedCount,
      staleCount: result.staleCount,
      unavailableCount: result.unavailableCount,
      durationMs: result.durationMs,
    },
    errors: fetched.filter(item => !item.success).map(item => `${item.instrument} ${item.timeframe}: ${item.error ?? "provider unavailable"}`).slice(0, 20),
    scannedAt: now,
  };
}
