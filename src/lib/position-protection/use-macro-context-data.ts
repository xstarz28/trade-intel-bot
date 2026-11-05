/**
 * Phase 140 — Shared Macro Context Data Hook
 *
 * Single data-access path for portfolio-level macro context used by the
 * protection dashboard AND the investor workspace:
 *
 * - US Treasury yields (nominal + real/TIPS) — one fetch, slow-moving daily data
 * - Economic calendar (macro events) — one fetch, keyed by the first
 *   registered position (shared macro data, exactly as the dashboard did)
 * - user positions (extraction from registered positions) — reused by the
 *   dashboard's news feed derivation
 *
 * Callers are mutually exclusive tabs of Dashboard.tsx (protection /
 * intelligence tab vs investor portfolio tab), so at most one instance is
 * mounted at any time — no duplicate fetches, no duplicate polling.
 *
 * Provider calls use the authenticated self-hosted backend. Nothing here
 * calculates intelligence — it only fetches and holds state.
 */

import { useEffect, useMemo, useState } from "react";
import { fetchBackendCalendar, fetchBackendTreasuryYields } from "@/lib/backend-api";
import type { MonitoredPositionState } from "./use-position-protection";
import type { TreasuryData } from "../data/treasury";
import type { EconomicCalendarData } from "../data/calendar-types";
import { extractUserPositions, type UserPosition } from "./user-intelligence-feed";

export interface UseMacroContextDataResult {
  /** Treasury yields (nominal + real). null while fetching/unavailable. */
  treasuryData: TreasuryData | null;
  /** Economic calendar (macro events). null while fetching/unavailable. */
  calendarData: EconomicCalendarData | null;
  /** Positions reduced to (instrument, side) for feed/context derivation. */
  userPositions: UserPosition[];
}

/**
 * Fetches and holds the shared macro context inputs for the given registered
 * positions. Provider fetches happen at most once per mounted instance.
 */
export function useMacroContextData(
  positions: readonly MonitoredPositionState[],
): UseMacroContextDataResult {
  // Same extraction the dashboard performed for its news feed.
  const userPositions = useMemo(
    () => extractUserPositions(
      positions.map((p) => ({
        instrument: p.position.instrument,
        side: p.position.side as "LONG" | "SHORT",
      })),
    ),
    [positions],
  );

  // ─── Treasury yields (nominal + real/TIPS) — slow-moving daily data ──
  const [treasuryData, setTreasuryData] = useState<TreasuryData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchBackendTreasuryYields()
      .then((result) => {
        if (!cancelled && result.success) setTreasuryData(result.data);
      })
      .catch(() => { /* provider failure → treasuryData stays null */ });
    return () => { cancelled = true; };
  }, []);

  // ─── Economic calendar (TickAtlas) — shared across positions ────────
  const [calendarData, setCalendarData] = useState<EconomicCalendarData | null>(null);
  useEffect(() => {
    if (userPositions.length === 0) return;
    let cancelled = false;
    // Use first position's instrument/type for calendar fetch (shared macro data)
    const firstPos = userPositions[0];
    fetchBackendCalendar(firstPos.instrument, firstPos.assetClass)
      .then((result) => {
        if (!cancelled && result.success) {
          setCalendarData(result.data ?? null);
        }
      })
      .catch(() => { /* provider failure → calendarData stays null */ });
    return () => { cancelled = true; };
  }, [
    userPositions.length > 0 ? userPositions[0]?.instrument : null,
    userPositions.length > 0 ? userPositions[0]?.assetClass : null,
  ]);

  return { treasuryData, calendarData, userPositions };
}
