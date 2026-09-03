/**
 * Phase 139 — Shared Position Intelligence Hook
 *
 * Single source of truth for deriving per-position PositionIntelligence.
 *
 * Previously this derivation lived inline inside PositionProtectionDashboard,
 * which meant sibling surfaces (e.g. InvestorWorkspace) had no safe way to
 * show the SAME intelligence without re-implementing the association logic.
 *
 * This hook owns the ONLY derivation path:
 *
 *   registered positions (usePositionProtection state)
 *   → live price polling (useLiveProtectionPolling)
 *   → OHLCV confluence (useOHLCVData)
 *   → price observations (per instrument)
 *   → generatePositionIntelligence (single engine function)
 *   → Map<positionId, PositionIntelligence>
 *
 * Every intelligence entry is keyed strictly by its own position.positionId —
 * never by array order, never by instrument alone — so a position can only
 * ever receive its own intelligence record.
 *
 * Callers may pass side-effect callbacks (live-event ingestion into the
 * protection pipeline, OHLCV health events) that the original dashboard
 * wiring performed; the derivation itself stays pure.
 *
 * INFORMATIONAL_ONLY — never executes trades.
 */

import { useEffect, useMemo, useState } from "react";
import type { MonitoredPositionState } from "./use-position-protection";
import {
  useLiveProtectionPolling,
  type LiveInstrumentState,
} from "./use-live-protection-polling";
import {
  useOHLCVData,
  type OHLCVHealthEvent,
  type UseOHLCVResult,
} from "./use-ohlcv-data";
import {
  generatePositionIntelligence,
  type PositionIntelligence,
} from "./market-intelligence-analyzer";
import {
  addObservation,
  createObservationState,
  type PriceObservationState,
} from "./price-observation-engine";
import type { RealTimeEvent } from "./realtime-types";

// ─── Macro instruments tracked for context (Yahoo Finance — free, no key) ─
const CONTEXT_INSTRUMENTS = ["VIX", "DXY", "US10Y", "WTI"] as const;

export interface UsePositionIntelligenceOptions {
  /**
   * Forward live price events into the protection pipeline (position alerts
   * are evaluated from these events exactly as the protection dashboard does).
   */
  onLiveEvent?: (events: RealTimeEvent[]) => void;
  /** Forward OHLCV provider health events (runtime health recording). */
  onOHLCVHealthEvent?: (event: OHLCVHealthEvent) => void;
}

export interface UsePositionIntelligenceResult {
  /** Unique instruments being monitored (positions + context instruments). */
  monitoredInstruments: string[];
  /**
   * Per-position intelligence, keyed by position.positionId.
   * A position only ever maps to its own intelligence record.
   */
  intelligenceMap: Map<string, PositionIntelligence>;
  /** Latest live prices per instrument. */
  livePrices: Map<string, LiveInstrumentState>;
  /** Price observations per instrument (feeds the intelligence engine). */
  priceObservations: Map<string, PriceObservationState>;
  /** OHLCV state incl. MTF confluence per instrument. */
  ohlcv: UseOHLCVResult;
  /** Whether live polling is active. */
  isPolling: boolean;
  /** Last poll timestamp. */
  lastPollAt: number;
  /** Total polls executed. */
  totalPolls: number;
  /** Total successful polls. */
  successfulPolls: number;
  /** Total failed polls. */
  failedPolls: number;
  /** Last polling error, if any. */
  lastError: string | null;
}

/**
 * Derives the per-position intelligence map for the given registered
 * positions. Callers supply their own protection state (from
 * usePositionProtection) so exactly one protection store exists per surface.
 */
export function usePositionIntelligence(
  positions: MonitoredPositionState[],
  options?: UsePositionIntelligenceOptions,
): UsePositionIntelligenceResult {
  // ─── Live Market Polling ─────────────────────────────────
  // Derive unique instruments from registered positions + context instruments
  const monitoredInstruments = useMemo(
    () => [...new Set([
      ...positions.map((p) => p.position.instrument),
      ...CONTEXT_INSTRUMENTS,
    ])],
    [positions],
  );

  const {
    livePrices,
    isPolling,
    lastPollAt,
    totalPolls,
    successfulPolls,
    failedPolls,
    lastError,
  } = useLiveProtectionPolling(monitoredInstruments, {
    enabled: monitoredInstruments.length > 0,
    pollIntervalMs: 30_000,
    onEvent: options?.onLiveEvent,
  });

  // ─── OHLCV Data (MTF candles) ────────────────────────────
  const ohlcv = useOHLCVData(monitoredInstruments, {
    enabled: monitoredInstruments.length > 0,
    timeframes: ["M5", "M15", "H1"],
    refreshIntervalMs: 120_000,
    onHealthEvent: options?.onOHLCVHealthEvent,
  });

  // ─── Price Observations (per instrument) ─────────────────
  const [priceObservations, setPriceObservations] = useState<Map<string, PriceObservationState>>(new Map());

  // Update observations whenever fresh live prices arrive.
  useEffect(() => {
    if (livePrices.size === 0) return;

    setPriceObservations((prev) => {
      const next = new Map(prev);
      const now = Date.now();

      for (const [instrument, state] of livePrices) {
        if (state.sourceMode !== "LIVE" || state.price <= 0) continue;

        const obs = next.get(instrument) ?? createObservationState(instrument);
        next.set(instrument, addObservation(obs, state.price, now));
      }

      return next;
    });
  }, [livePrices]);

  // ─── Generate Intelligence per Position ───────────────────
  const intelligenceMap = useMemo(() => {
    const map = new Map<string, PositionIntelligence>();

    for (const pos of positions) {
      const obs = priceObservations.get(pos.position.instrument);
      const alert = pos.alert;
      const live = livePrices.get(pos.position.instrument);

      const currentPrice = live?.sourceMode === "LIVE" && live.price > 0
        ? live.price
        : pos.position.entryPrice;

      const intelligence = generatePositionIntelligence({
        position: {
          instrument: pos.position.instrument,
          side: pos.position.side,
          entryPrice: pos.position.entryPrice,
          currentPrice,
          stopLoss: pos.position.stopLoss,
          takeProfit: pos.position.takeProfit,
          leverage: pos.position.leverage,
          horizon: pos.position.horizon,
        },
        observationState: obs ?? createObservationState(pos.position.instrument),
        thesisHealth: alert?.thesisHealth ?? "UNKNOWN",
        thesisHealthScore: alert?.thesisHealthScore ?? 50,
        severity: alert?.severity ?? "NONE",
        actionRecommendation: alert?.actionRecommendation ?? "Hold and monitor.",
        givebackPct: pos.giveback?.givebackPct,
        sourceMode: live?.sourceMode ?? "UNAVAILABLE",
        provider: live?.provider ?? "—",
        mtfConfluence: ohlcv.confluence.get(pos.position.instrument),
      });

      // Strict per-position association: keyed by this position's own ID.
      map.set(pos.position.positionId, intelligence);
    }

    return map;
  }, [positions, priceObservations, livePrices, ohlcv.confluence]);

  return {
    monitoredInstruments,
    intelligenceMap,
    livePrices,
    priceObservations,
    ohlcv,
    isPolling,
    lastPollAt,
    totalPolls,
    successfulPolls,
    failedPolls,
    lastError,
  };
}
