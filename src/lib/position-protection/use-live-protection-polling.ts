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
import { errorMessage } from "../data/json/narrow";

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
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollAt, setLastPollAt] = useState(0);
  const [totalPolls, setTotalPolls] = useState(0);
  const [successfulPolls, setSuccessfulPolls] = useState(0);
  const [failedPolls, setFailedPolls] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bridgeState, setBridgeState] = useState<LiveMarketBridgeState>(createBridgeState);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);
  const instrumentsRef = useRef(instruments);
  instrumentsRef.current = instruments;

  const callbacksRef = useRef(options?.onPriceUpdate);
  callbacksRef.current = options?.onPriceUpdate;

  const eventsRef = useRef(options?.onEvent);
  eventsRef.current = options?.onEvent;

  // ─── Poll function ─────────────────────────────────────
  const doPoll = useCallback(async () => {
    const currentInstruments = instrumentsRef.current;
    if (currentInstruments.length === 0) return;

    try {
      // Call the REAL Convex action that makes REAL HTTP requests
      const results: LiveQuoteResult[] = await fetchLiveQuotes({
        instruments: currentInstruments,
      });

      const now = Date.now();
      let anySuccess = false;

      setLivePrices((prev) => {
        const next = new Map(prev);
        const newEvents: RealTimeEvent[] = [];

        let currentBridge = createBridgeState();

        for (const result of results) {
          if (result.success && result.price > 0) {
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

            // Update live prices state
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

            // Fire callback
            callbacksRef.current?.(result.instrument, result.price, result.provider);
          } else {
            next.set(result.instrument, {
              instrument: result.instrument,
              price: 0,
              provider: result.provider,
              sourceMode: "UNAVAILABLE",
              lastUpdateAt: now,
              success: false,
              error: result.error,
            });
          }
        }

        // Emit events to the protection pipeline
        if (newEvents.length > 0) {
          eventsRef.current?.(newEvents);
        }

        setBridgeState(currentBridge);
        return next;
      });

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
      setLastError(errorMessage(err) || "Unknown poll error");
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
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [enabled, instruments.length, startPolling, stopPolling]);

  return {
    livePrices,
    isPolling,
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
