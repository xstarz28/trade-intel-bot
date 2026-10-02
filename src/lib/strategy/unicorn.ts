/**
 * Phase 312 — ICT Unicorn Model: PARTIAL composition, honestly labelled.
 *
 * SOURCE BOUNDARY: the source document does not specify the Unicorn model's
 * full deterministic rules (which candle creates the gap, exact sweep relation,
 * session conditions, etc.). This module therefore reports only the
 * EXPLICITLY SUPPORTED components — a validated Order Block whose range
 * overlaps a same-direction Fair Value Gap created within the OB's formation
 * window — and marks every result `completeness: "PARTIAL"` with an exact
 * limitation string. It is NEVER labelled a complete Unicorn detector, and it
 * contributes no score anywhere.
 */

import type { OrderBlock, SmcContext, FairValueGap } from "../data/market-types";

/** ENGINE-DEFINED composition window (documented in the header). */
export const UNICORN_FVG_WINDOW = 5;

export interface UnicornObservation {
  direction: "bullish" | "bearish";
  orderBlock: { sourceIndex: number; createdAt: number; upper: number; lower: number; status: OrderBlock["status"] };
  fvg: { createdAtIndex: number; createdAt: number; upper: number; lower: number };
  /** The overlapping price band of the two components. */
  overlapUpper: number;
  overlapLower: number;
  timeframe: string;
}

export interface UnicornEvaluation {
  available: boolean;
  unavailableReason?: string;
  /** Always "PARTIAL" when available — never presented as a complete model. */
  completeness: "PARTIAL";
  observations: UnicornObservation[];
  /**
   * The exact, stable limitation sentence rendered wherever this is shown.
   */
  limitation: string;
  timeframe: string;
}

export const UNICORN_LIMITATION =
  'The Unicorn Model is reported as PARTIAL: only the overlapping geometry of a validated Order Block and a same-direction Fair Value Gap (gap created within the block\'s formation window) is deterministic here; the supplied source document does not specify the model\'s full rules, so this is contextual evidence and NOT a completed Unicorn detector.';

function overlaps(aLower: number, aUpper: number, bLower: number, bUpper: number): boolean {
  return Math.max(aLower, bLower) < Math.min(aUpper, bUpper);
}

/**
 * Compose the supported Unicorn components from an existing SmcContext.
 * Pure, additive, descriptive — contributes no score anywhere.
 */
export function evaluateUnicornModel(smc: SmcContext): UnicornEvaluation {
  const obs: UnicornObservation[] = [];

  for (const ob of smc.orderBlocks) {
    if (ob.status === "invalidated") continue;
    const fvgs: FairValueGap[] = smc.fvgs;
    for (const fvg of fvgs) {
      if (fvg.direction !== ob.direction) continue;
      if (fvg.createdAtIndex < ob.sourceIndex) continue;
      if (fvg.createdAtIndex > ob.sourceIndex + UNICORN_FVG_WINDOW) continue;
      if (!overlaps(ob.lower, ob.upper, fvg.lower, fvg.upper)) continue;
      obs.push({
        direction: ob.direction,
        orderBlock: {
          sourceIndex: ob.sourceIndex,
          createdAt: ob.createdAt,
          upper: ob.upper,
          lower: ob.lower,
          status: ob.status,
        },
        fvg: {
          createdAtIndex: fvg.createdAtIndex,
          createdAt: fvg.createdAt,
          upper: fvg.upper,
          lower: fvg.lower,
        },
        overlapUpper: Math.min(ob.upper, fvg.upper),
        overlapLower: Math.max(ob.lower, fvg.lower),
        timeframe: smc.timeframe,
      });
    }
  }

  if (obs.length === 0) {
    return {
      available: false,
      unavailableReason:
        "no validated Order Block overlaps a same-direction Fair Value Gap created within its formation window",
      completeness: "PARTIAL",
      observations: [],
      limitation: UNICORN_LIMITATION,
      timeframe: smc.timeframe,
    };
  }

  return {
    available: true,
    completeness: "PARTIAL",
    observations: obs,
    limitation: UNICORN_LIMITATION,
    timeframe: smc.timeframe,
  };
}
