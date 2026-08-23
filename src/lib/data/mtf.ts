/**
 * Phase 3A — Adaptive Multi-Timeframe Market Structure Engine.
 *
 * Pure calculation layer shared by the Convex action and the client side,
 * so both paths produce IDENTICAL MTF structures (single source of truth).
 *
 * Principles:
 * - Every timeframe's structure is computed INDEPENDENTLY from its own
 *   candles via computeSmcContext. Nothing is copied between timeframes.
 * - Timeframes that fail to fetch are marked unavailable with a reason —
 *   never synthesized, never treated as neutral/bullish/bearish.
 * - The chain adapts to what actually exists: if only D1→H1→M15 is
 *   available, that is the chain. No claims about W1→M5 without data.
 */

import type {
  MtfAlignmentState,
  MtfContext,
  MtfTimeframeData,
  TfRole,
} from "./market-types";
import { computeSmcContext } from "./smc";
import type { OhlcvCandle } from "./market-types";

/** Standard ladder from execution to macro timeframes. */
export const TF_LADDER = ["M15", "H1", "H4", "D1", "W1"] as const;

export interface ChainSlot {
  timeframe: string;
  role: TfRole;
}

/**
 * Adaptive chain for a requested (setup) timeframe:
 * - setup: the requested timeframe itself
 * - structure: one rung above (primary higher-timeframe context)
 * - macro: two rungs above (when it exists)
 * - trigger: one rung below (execution refinement)
 *
 * Requested timeframes outside the ladder (M1/M5) get no derived slots —
 * they are analyzed standalone rather than inventing relationships.
 */
export function buildChain(requestedTf: string): ChainSlot[] {
  const idx = TF_LADDER.indexOf(requestedTf as (typeof TF_LADDER)[number]);
  const slots: ChainSlot[] = [];
  if (idx >= 0) {
    if (idx + 2 < TF_LADDER.length) slots.push({ timeframe: TF_LADDER[idx + 2], role: "macro" });
    if (idx + 1 < TF_LADDER.length) slots.push({ timeframe: TF_LADDER[idx + 1], role: "structure" });
    if (idx > 0) slots.push({ timeframe: TF_LADDER[idx - 1], role: "trigger" });
  }
  return slots;
}

/** Minimum candles for an independent structural read on any timeframe. */
const MIN_TF_DATAPOINTS = 20;

/** Directional read of one timeframe from its own external structure. */
function tfExternalDirection(smc: NonNullable<MtfTimeframeData["smc"]>): "long" | "short" | "none" {
  const ext = smc.internalExternal.external;
  // A confirmed external CHoCH overrides a stale structure label.
  if (ext.chochDirection === "bullish") return "long";
  if (ext.chochDirection === "bearish") return "short";
  if (ext.structure === "HH/HL") return "long";
  if (ext.structure === "LH/LL") return "short";
  return "none";
}

export interface MtfCandleInput {
  timeframe: string;
  role: TfRole;
  /** Candles fetched for this timeframe; null/undefined when unavailable. */
  candles?: OhlcvCandle[] | null;
  /** Provider failure reason when candles could not be fetched. */
  error?: string;
}

/**
 * Assemble the full MTF context from per-timeframe candle sets.
 * Structure is computed independently per timeframe; alignment is derived
 * from actual structure reads, never forced.
 */
export function buildMtfContext(
  requestedTf: string,
  inputs: MtfCandleInput[],
): MtfContext {
  const timeframes: MtfTimeframeData[] = [];
  const unavailable: MtfContext["unavailable"] = [];

  for (const input of inputs) {
    if (!input.candles || input.candles.length < MIN_TF_DATAPOINTS) {
      const reason =
        input.error ??
        (input.candles && input.candles.length > 0
          ? `Only ${input.candles.length} candles returned — below the ${MIN_TF_DATAPOINTS} needed for an independent structural read.`
          : "No candle data available.");
      unavailable.push({ timeframe: input.timeframe, role: input.role, reason });
      continue;
    }
    try {
      const smc = computeSmcContext(input.candles, input.timeframe);
      timeframes.push({
        timeframe: input.timeframe,
        role: input.role,
        available: true,
        smc,
      });
    } catch (err) {
      unavailable.push({
        timeframe: input.timeframe,
        role: input.role,
        reason: err instanceof Error ? err.message : "structure computation failed",
      });
    }
  }

  const byRole = (role: TfRole) => timeframes.find((t) => t.role === role);
  const structure = byRole("structure");
  const macro = byRole("macro");
  const trigger = byRole("trigger");

  // Highest available HTF drives macro bias; macro outranks structure.
  const htfEntry = macro ?? structure;
  const htfBias = htfEntry?.smc ? tfExternalDirection(htfEntry.smc) : "none";

  // ── Genuine HTF reversal detection ──────────────────────────────
  // An external BOS/CHoCH ON the HTF itself can legitimately change the
  // context — unlike LTF noise, which never flips HTF bias by itself.
  let htfReversal: MtfContext["htfReversal"];
  if (htfEntry?.smc) {
    const ext = htfEntry.smc.internalExternal.external;
    if (ext.chochDirection !== "none") {
      htfReversal = {
        timeframe: htfEntry.timeframe,
        direction: ext.chochDirection,
        kind: "choch",
      };
    } else if (
      ext.bosDirection !== "none" &&
      ((ext.bosDirection === "bullish" && ext.structure === "HH/HL") ||
        (ext.bosDirection === "bearish" && ext.structure === "LH/LL"))
    ) {
      htfReversal = {
        timeframe: htfEntry.timeframe,
        direction: ext.bosDirection,
        kind: "bos",
      };
    }
  }

  const setupDir = (() => {
    const s = byRole("setup");
    return s?.smc ? tfExternalDirection(s.smc) : "none";
  })();
  const triggerDir = trigger?.smc ? tfExternalDirection(trigger.smc) : "none";

  // ── Alignment matrix ────────────────────────────────────────────
  let alignment: MtfAlignmentState;
  if (!htfEntry || htfBias === "none") {
    // Without a readable HTF there is no context — do NOT force one.
    alignment = "INSUFFICIENT_DATA";
  } else if (macro?.smc) {
    const macroDir = tfExternalDirection(macro.smc);
    const structDir = structure?.smc ? tfExternalDirection(structure.smc) : "none";
    if (macroDir !== "none" && structDir !== "none" && macroDir !== structDir) {
      alignment = "MIXED"; // higher timeframes disagree among themselves
    } else if (setupDir === "none" || setupDir === htfBias) {
      alignment =
        triggerDir === "none" || triggerDir === htfBias
          ? htfBias === "long"
            ? "ALIGNED_BULLISH"
            : "ALIGNED_BEARISH"
          : "COUNTER_TREND"; // only the trigger opposes → normal pullback
    } else {
      // Setup opposes the HTF
      alignment =
        triggerDir === htfBias || triggerDir === "none"
          ? "MIXED"
          : "COUNTER_TREND"; // deeper retracement against dominant trend
    }
  } else {
    // Single-HTF chain (no macro): compare setup/trigger against it.
    if (setupDir === "none" || setupDir === htfBias) {
      alignment =
        triggerDir === "none" || triggerDir === htfBias
          ? htfBias === "long"
            ? "ALIGNED_BULLISH"
            : "ALIGNED_BEARISH"
          : "COUNTER_TREND";
    } else {
      alignment =
        triggerDir === htfBias || triggerDir === "none" ? "MIXED" : "COUNTER_TREND";
    }
  }

  const chainUsed = timeframes.map((t) => t.timeframe);

  return {
    requestedTimeframe: requestedTf,
    chainUsed,
    unavailable,
    timeframes,
    alignment,
    htfBias,
    htfTimeframe: htfEntry?.timeframe,
    setupTimeframe: requestedTf,
    triggerTimeframe: trigger?.timeframe,
    htfReversal,
  };
}
