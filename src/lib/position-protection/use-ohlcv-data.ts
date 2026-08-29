/**
 * Phase 80 — OHLCV Data Hook
 *
 * Fetches real OHLCV candle data from the Convex fetchOHLCVCandles action.
 * Maintains per-instrument candle history for M5/M15/H1 analysis.
 *
 * Rate-limit safe: staggered fetching, deduplication, bounded history.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { type Candle, normalizeCandles } from "./technical-indicators";
import {
  type TimeframeKey,
  createTimeframeData,
  type TimeframeData,
  analyzeMTFConfluence,
  type MTFConfluence,
} from "./multi-timeframe-engine";

const MAX_CANDLES_PER_TIMEFRAME = 50;
const DEFAULT_TIMEFRAMES: TimeframeKey[] = ["M5", "M15", "H1"];
const REFRESH_INTERVAL_MS = 120_000; // 2 minutes between OHLCV refreshes
const STALE_THRESHOLD_MS = 60_000; // Data younger than 60s is still fresh
const MAX_INSTRUMENTS_PER_FETCH = 2; // Limit instruments per fetch to avoid rate limits

export interface OHLCVState {
  /** Candles per instrument per timeframe. */
  data: Map<string, Map<TimeframeKey, Candle[]>>;
  /** MTF confluence per instrument. */
  confluence: Map<string, MTFConfluence>;
  /** Whether fetch is in progress. */
  isFetching: boolean;
  /** Last fetch timestamp. */
  lastFetchAt: number;
  /** Fetch count. */
  fetchCount: number;
  /** Error count. */
  errorCount: number;
  /** Last error. */
  lastError: string | undefined;
}

export interface UseOHLCVResult extends OHLCVState {
  /** Manually trigger a refresh. */
  refresh: () => void;
}

export function useOHLCVData(
  instruments: string[],
  options?: {
    timeframes?: TimeframeKey[];
    enabled?: boolean;
    refreshIntervalMs?: number;
  },
): UseOHLCVResult {
  const timeframes = options?.timeframes ?? DEFAULT_TIMEFRAMES;
  const enabled = options?.enabled ?? true;
  const refreshMs = options?.refreshIntervalMs ?? REFRESH_INTERVAL_MS;

  const fetchCandles = useAction(api.liveProtection.fetchOHLCVCandles);

  const [state, setState] = useState<OHLCVState>({
    data: new Map(),
    confluence: new Map(),
    isFetching: false,
    lastFetchAt: 0,
    fetchCount: 0,
    errorCount: 0,
    lastError: undefined,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchOHLCV = useCallback(async () => {
    if (!enabled || instruments.length === 0) return;
    if (stateRef.current.isFetching) return;

    const now = Date.now();

    // Skip if data is still fresh (caching)
    if (now - stateRef.current.lastFetchAt < STALE_THRESHOLD_MS) return;

    // Only fetch instruments that don't have fresh data
    const instrumentsToFetch = instruments.filter((inst) => {
      const instData = stateRef.current.data.get(inst);
      if (!instData) return true; // no data yet
      // Check if any timeframe has data
      let hasFreshData = false;
      for (const tf of timeframes) {
        const candles = instData.get(tf);
        if (candles && candles.length > 0) hasFreshData = true;
      }
      return !hasFreshData;
    });

    // If all instruments have fresh data, skip
    if (instrumentsToFetch.length === 0 && stateRef.current.data.size > 0) return;

    // Limit instruments per fetch to avoid rate limits
    const batch = instrumentsToFetch.length > 0
      ? instrumentsToFetch.slice(0, MAX_INSTRUMENTS_PER_FETCH)
      : instruments.slice(0, MAX_INSTRUMENTS_PER_FETCH);

    setState((prev) => ({ ...prev, isFetching: true }));

    try {
      const results = await fetchCandles({
        instruments: batch,
        timeframes,
        outputsize: MAX_CANDLES_PER_TIMEFRAME,
      });

      const now = Date.now();
      setState((prev) => {
        const newData = new Map(prev.data);
        const newConfluence = new Map(prev.confluence);

        for (const result of results) {
          if (!result.success || result.candles.length === 0) continue;

          // Normalize candles
          const rawCandles: Candle[] = result.candles.map((c: any) => ({
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? 0,
          }));
          const normalized = normalizeCandles(rawCandles);

          // Store candles
          let instData = newData.get(result.instrument);
          if (!instData) instData = new Map();
          instData.set(result.timeframe as TimeframeKey, normalized.slice(-MAX_CANDLES_PER_TIMEFRAME));
          newData.set(result.instrument, instData);
        }

        // Compute confluence for each instrument
        for (const instrument of instruments) {
          const instData = newData.get(instrument);
          if (!instData) continue;

          const tfData = timeframes
            .map((tf) => {
              const candles = instData.get(tf) ?? [];
              return createTimeframeData(tf, candles);
            })
            .filter((d) => d.candleCount > 0);

          if (tfData.length > 0) {
            newConfluence.set(instrument, analyzeMTFConfluence(tfData));
          }
        }

        const errors = results.filter((r: any) => !r.success);
        const successes = results.filter((r: any) => r.success);

        return {
          data: newData,
          confluence: newConfluence,
          isFetching: false,
          lastFetchAt: now,
          fetchCount: prev.fetchCount + 1,
          errorCount: prev.errorCount + errors.length,
          lastError: errors.length > 0 ? errors[0].error : prev.lastError,
        };
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isFetching: false,
        errorCount: prev.errorCount + 1,
        lastError: err?.message ?? "Fetch failed",
      }));
    }
  }, [instruments.join(","), timeframes.join(","), enabled, fetchCandles]);

  // Initial fetch + periodic refresh
  useEffect(() => {
    if (!enabled || instruments.length === 0) return;

    fetchOHLCV();
    const interval = setInterval(fetchOHLCV, refreshMs);

    return () => clearInterval(interval);
  }, [fetchOHLCV, enabled, refreshMs]);

  return {
    ...state,
    refresh: fetchOHLCV,
  };
}
