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
import {
  structuralConfluence,
  type StructuralConfluence,
  type StructuralConfluencePart,
} from "./structure";
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

/**
 * Directional read of ONE timeframe from its OWN external structure.
 *
 * Phase 290-A: the direction now comes from the confirmed structural EVENT
 * record (the last BOS/CHoCH that actually closed beyond a confirmed swing
 * level). The legacy label path — a CHoCH label overriding a structure label —
 * remains only for SMC contexts built without the event layer.
 */
function tfExternalDirection(smc: NonNullable<MtfTimeframeData["smc"]>): "long" | "short" | "none" {
  const evidence = smc.structural?.external;
  if (evidence) {
    if (evidence.direction === "bullish") return "long";
    if (evidence.direction === "bearish") return "short";
    return "none";
  }
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
        // This timeframe's OWN confirmed structural read — never borrowed.
        ...(smc.structural ? { structural: smc.structural.external } : {}),
        ...(smc.structural ? { structuralPair: smc.structural } : {}),
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

  // Highest available HTF drives macro bias; macro outranks structure. A slot
  // that produced NO confirmed direction (no event yet) contributes no
  // direction — the next readable slot below it does, and the unreadable slot's
  // own state stays exposed per timeframe. If nothing is readable the topmost
  // slot is kept so its reason is preserved and the alignment stays explicit.
  const speaks = (t: MtfTimeframeData | undefined) =>
    t?.structural !== undefined && t.structural.direction !== "none";
  const htfEntry = [macro, structure].find(speaks) ?? macro ?? structure;
  const htfBias = htfEntry?.smc ? tfExternalDirection(htfEntry.smc) : "none";

  // ── Genuine HTF reversal detection ──────────────────────────────
  // An external BOS/CHoCH ON the HTF itself can legitimately change the
  // context — unlike LTF noise, which never flips HTF bias by itself.
  let htfReversal: MtfContext["htfReversal"];
  if (htfEntry?.smc) {
    const ext = htfEntry.smc.internalExternal.external;
    const choch = htfEntry.smc.structural?.external.lastChoch;
    if (choch) {
      // A confirmed CHoCH on the HTF itself: the first valid close beyond a
      // confirmed swing level AGAINST the regime that was established on that
      // timeframe. That is the only event that changes character — a
      // trend-continuing BOS is NOT reported as a reversal, and the legacy
      // label path (price merely sitting beyond a stale label) cannot raise one.
      htfReversal = {
        timeframe: htfEntry.timeframe,
        direction: choch.direction,
        kind: "choch",
      };
    } else if (!htfEntry.smc.structural && ext.chochDirection !== "none") {
      // SMC contexts without the event layer keep their label behaviour.
      htfReversal = {
        timeframe: htfEntry.timeframe,
        direction: ext.chochDirection,
        kind: "choch",
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

  // ── Phase 290-A — deterministic structural confluence ────────────
  // Built from the ACTUAL per-timeframe structural states (no weighted score).
  // Roles with no confirmed event stay in the list with direction "none" so the
  // confluence can say INCOMPLETE rather than silently dropping the slot; roles
  // that were never fetched are simply absent (unavailable[] already names them).
  const structuralParts: StructuralConfluencePart[] = timeframes
    .filter((t) => t.structural !== undefined)
    .map((t) => ({ role: t.role, read: t.structural! }));
  // Roles the chain EXPECTED (including slots that never produced a read) are
  // passed so an unavailable role is stated as unresolved rather than dropped.
  const expectedRoles = [...new Set(inputs.map((i) => i.role))];
  const confluence: StructuralConfluence | undefined =
    structuralParts.length > 0
      ? structuralConfluence(structuralParts, expectedRoles)
      : undefined;

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
    ...(confluence ? { structuralConfluence: confluence } : {}),
  };
}

