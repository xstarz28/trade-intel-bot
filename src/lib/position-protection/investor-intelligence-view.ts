/**
 * Phase 139 — Investor Intelligence View Helpers
 *
 * Pure presentation plumbing that joins registered positions with their OWN
 * PositionIntelligence record for the investor workspace.
 *
 * The intelligence map is produced by usePositionIntelligence (the single
 * derivation path shared with PositionProtectionDashboard). These helpers
 * never calculate intelligence themselves — they only associate existing
 * records with the correct position, strictly by position.positionId.
 *
 * Position isolation guarantees:
 * - A position is NEVER matched by array order or by instrument alone.
 * - If a position has no record in the map, the row exposes intel: null and
 *   the UI must render an explicit unavailable state (never another
 *   position's intelligence).
 */

import type { MonitoredPositionState } from "./use-position-protection";
import type { PositionIntelligence } from "./market-intelligence-analyzer";

/** One investor-facing row: protection state + the position's own thesis intel. */
export interface InvestorIntelRow {
  /** Stable position identifier — the ONLY key used for association. */
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  horizon: string;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: number;
  /** Protection severity — never displayed as thesis health. */
  severity: string;
  /** Thesis health from the protection engine — distinct from severity. */
  thesisHealth: string;
  thesisHealthScore: number;
  /**
   * The position's OWN intelligence record (same object instance produced by
   * the intelligence engine — never recalculated here), or null when no
   * record exists for this exact positionId.
   */
  intel: PositionIntelligence | null;
}

/**
 * Associates each registered position with its own intelligence record.
 *
 * Lookup is strictly `intelligenceMap.get(position.positionId)`. A record
 * that does not belong to the position (wrong key) can never leak into the
 * row — the position simply shows `intel: null`.
 */
export function associateInvestorIntelligence(
  positions: readonly MonitoredPositionState[],
  intelligenceMap: ReadonlyMap<string, PositionIntelligence>,
): InvestorIntelRow[] {
  return positions.map((p) => {
    const { position, alert } = p;
    return {
      positionId: position.positionId,
      instrument: position.instrument,
      side: position.side,
      horizon: position.horizon,
      entryPrice: position.entryPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      openedAt: position.openedAt,
      severity: alert?.severity ?? "NONE",
      thesisHealth: alert?.thesisHealth ?? "UNKNOWN",
      thesisHealthScore: alert?.thesisHealthScore ?? 50,
      intel: intelligenceMap.get(position.positionId) ?? null,
    };
  });
}

/**
 * Data-availability classification for an investor row's intelligence.
 *
 * Keeps UNAVAILABLE (no record), LIMITED, INSUFFICIENT and AVAILABLE
 * distinct. Missing or unknown quality is NEVER promoted to AVAILABLE —
 * it degrades to INSUFFICIENT at worst.
 */
export type IntelDataAvailability =
  | "AVAILABLE"
  | "LIMITED"
  | "INSUFFICIENT"
  | "UNAVAILABLE";

export function classifyIntelAvailability(
  intel: PositionIntelligence | null,
): IntelDataAvailability {
  if (!intel) return "UNAVAILABLE";
  const quality = intel.dataQuality;
  if (quality === "SUFFICIENT") return "AVAILABLE";
  if (quality === "LIMITED") return "LIMITED";
  // "INSUFFICIENT" or any unknown/future value — conservative by design.
  return "INSUFFICIENT";
}
