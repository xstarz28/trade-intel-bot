/**
 * Phase 75 — Live Protection Polling Hook
 *
 * Polls the Convex liveProtection.fetchLiveProtectionQuote action at a
 * configurable interval and feeds real market data into the existing
 * protection pipeline (bridgeQuoteToEvents → RealTimeEvent → ProtectionEngine).
 *
 * This is the REAL production activation — actual HTTP data, actual polling,
 * actual protection evaluation. Not simulated.
 *
 * NO AUTO-EXECUTION. INFORMATIONAL PROTECTION ONLY.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { LiveQuoteResult } from "../../convex/liveProtection";
import type { RealTimeEvent } from "./realtime-types";
import type { ProviderQuoteData } from "../market-stream/live-market-bridge";
import { bridgeQuoteToEvents, type LiveMarketBridgeState, createBridgeState } from "../market-stream/live-market-bridge";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface LiveInstrumentState {
  instrument: string;
  price: number;
  bid?: number;
  ask?: number;
  change24h?: number;
  volume24h?: number;
  provider: string;
  sourceMode: "LIVE" | "SIMULATED" | "STALE" | "UNAVAILABLE";
  lastUpdateAt: number;
  success: boolean;
  error?: string;
}

export interface UseLiveProtectionPollingResult {
  /** Current live prices for all monitored instruments. */
  livePrices: Map<string, LiveInstrumentState>;
  /** Whether polling is active. */
  isPolling: boolean;
  /** Last poll timestamp. */
  lastPollAt: number;
  /** Total polls executed. */
  totalPolls: number;
  /** Total successful polls. */
  successfulPolls: number;
  /** Total failed polls. */
  failedPolls: number;
  /** Last error, if any. */
  lastError: string | null;
  /** Start polling. */
  startPolling: () => void;
  /** Stop polling. */
  stopPolling: () => void;
  /** Force an immediate poll. */
  pollNow: () => Promise<void>;
  /** The bridge state (for diagnostics). */
  bridgeState: LiveMarketBridgeState;
}

// ═══════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════

const DEFAULT_POLL_INTERVAL_MS = 30_000; // 30 seconds for crypto (CoinGecko rate limit ~30/min)

export function useLiveProtectionPolling(
  instruments: string[],
  options?: {
    pollIntervalMs?: number;
    enabled?: boolean;
    onPriceUpdate?: (instrument: string, price: number, provider: string) => void;
    onEvent?: (events: RealTimeEvent[]) => void;
  },
): UseLiveProtectionPollingResult {
  const fetchLiveQuotes = useAction(api.liveProtection.fetchLiveProtectionQuote);
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const enabled = options?.enabled !== false;

  const [livePrices, setLivePrices] = useState<Map<string, LiveInstrumentState>>(new Map());
  // Keep the latest committed poll result available without side effects inside
  // a React state updater, which React may invoke more than once in development.
  const livePricesRef = useRef(livePrices);
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollAt, setLastPollAt] = useState(0);
  const [totalPolls, setTotalPolls] = useState(0);
  const [successfulPolls, setSuccessfulPolls] = useState(0);
  const [failedPolls, setFailedPolls] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bridgeState, setBridgeState] = useState<LiveMarketBridgeState>(createBridgeState);
  const bridgeStateRef = useRef(bridgeState);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const instrumentsRef = useRef(instruments);
  const callbacksRef = useRef(options?.onPriceUpdate);
  const eventsRef = useRef(options?.onEvent);

  // Keep refs synchronized after commit rather than mutating them during render.
  useEffect(() => {
    instrumentsRef.current = instruments;
    callbacksRef.current = options?.onPriceUpdate;
    eventsRef.current = options?.onEvent;
  }, [instruments, options?.onPriceUpdate, options?.onEvent]);

  // ─── Poll function ─────────────────────────────────────
  const doPoll = useCallback(async () => {
    const currentInstruments = instrumentsRef.current;
    // A slow provider response must not overlap the next interval and allow
    // older quotes to overwrite newer ones.
    if (currentInstruments.length === 0 || pollInFlightRef.current) return;

    pollInFlightRef.current = true;
    try {
      // Call the REAL Convex action that makes REAL HTTP requests
      const results: LiveQuoteResult[] = await fetchLiveQuotes({
        instruments: currentInstruments,
      });

      const now = Date.now();
      let anySuccess = false;

      const next = new Map(livePricesRef.current);
      const newEvents: RealTimeEvent[] = [];
      let currentBridge = bridgeStateRef.current;

      for (const result of results) {
        const quoteAgeMs = now - result.timestamp;
        const quoteIsFresh =
          Number.isFinite(result.timestamp) &&
          result.timestamp > 0 &&
          quoteAgeMs >= -30_000 &&
          quoteAgeMs <= Math.max(pollIntervalMs * 2, 60_000);

        // Only verified LIVE, finite, fresh quotes may enter the protection bridge.
        // Never promote simulated or stale provider data to fresh market evidence.
        if (
          result.success &&
          result.sourceMode === "LIVE" &&
          Number.isFinite(result.price) &&
          result.price > 0 &&
          quoteIsFresh
        ) {
          anySuccess = true;

          // Create ProviderQuoteData for the bridge
          const quoteData: ProviderQuoteData = {
            instrument: result.instrument,
            provider: result.provider,
            price: result.price,
            bid: result.bid,
            ask: result.ask,
            volume24h: result.volume24h,
            change24h: result.change24h,
            timestamp: result.timestamp,
            freshness: "FRESH",
          };

          // Bridge to RealTimeEvents
          const bridgeResult = bridgeQuoteToEvents(currentBridge, quoteData);
          currentBridge = bridgeResult.state;
          newEvents.push(...bridgeResult.events);

          next.set(result.instrument, {
            instrument: result.instrument,
            price: result.price,
            bid: result.bid,
            ask: result.ask,
            change24h: result.change24h,
            volume24h: result.volume24h,
            provider: result.provider,
            sourceMode: result.sourceMode,
            lastUpdateAt: now,
            success: true,
          });

          callbacksRef.current?.(result.instrument, result.price, result.provider);
        } else {
          const staleSuccessfulQuote =
            result.success &&
            Number.isFinite(result.price) &&
            result.price > 0 &&
            !quoteIsFresh;
          const simulatedQuote = result.sourceMode === "SIMULATED";
          next.set(result.instrument, {
            instrument: result.instrument,
            price: 0,
            provider: result.provider,
            sourceMode: staleSuccessfulQuote
              ? "STALE"
              : simulatedQuote
                ? "SIMULATED"
                : "UNAVAILABLE",
            lastUpdateAt: now,
            success: false,
            error: staleSuccessfulQuote
              ? "Quote rejected because its timestamp is stale or invalid"
              : simulatedQuote
                ? "Simulated quotes are not accepted by live position protection"
                : result.error,
          });
        }
      }

      // Keep React state updaters pure: callbacks and other state updates run here.
      livePricesRef.current = next;
      setLivePrices(next);
      bridgeStateRef.current = currentBridge;
      setBridgeState(currentBridge);

      if (newEvents.length > 0) {
        eventsRef.current?.(newEvents);
      }

      setTotalPolls((p) => p + 1);
      if (anySuccess) {
        setSuccessfulPolls((p) => p + 1);
      } else {
        setFailedPolls((p) => p + 1);
      }
      setLastPollAt(now);
      setLastError(anySuccess ? null : "All providers returned errors");
    } catch (err: unknown) {
      setTotalPolls((p) => p + 1);
      setFailedPolls((p) => p + 1);
      setLastPollAt(Date.now());
      setLastError(err instanceof Error ? err.message : "Unknown poll error");
    } finally {
      pollInFlightRef.current = false;
    }
  }, [fetchLiveQuotes]);

  // ─── Start/Stop ────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (isPollingRef.current) return; // prevent duplicates
    isPollingRef.current = true;
    setIsPolling(true);

    // Immediate first poll
    doPoll();

    // Then interval
    timerRef.current = setInterval(doPoll, pollIntervalMs);
  }, [doPoll, pollIntervalMs]);

  const stopPolling = useCallback(() => {
    isPollingRef.current = false;
    setIsPolling(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pollNow = useCallback(async () => {
    await doPoll();
  }, [doPoll]);

  // ─── Lifecycle ─────────────────────────────────────────
  useEffect(() => {
    if (enabled && instruments.length > 0) {
      startPolling();
    } else {
      // Stop external work without synchronously scheduling state from an effect.
      isPollingRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      isPollingRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, instruments.length, startPolling]);

  return {
    livePrices,
    isPolling: isPolling && enabled && instruments.length > 0,
    lastPollAt,
    totalPolls,
    successfulPolls,
    failedPolls,
    lastError,
    startPolling,
    stopPolling,
    pollNow,
    bridgeState,
  };
}
