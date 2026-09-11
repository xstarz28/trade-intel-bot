/**
 * Phase 174 — the decision-delivery boundary (pure logic).
 *
 * ## Why this exists
 *
 * Phase 169 built a server-authoritative *counter*. It did not build a
 * server-authoritative *boundary*. Those are different things, and the gap
 * between them was the whole vulnerability:
 *
 *   - `runAnalysis()` executed in the browser, so the directional decision
 *     (LONG/SHORT + entry/stop/target) existed on the client the instant it
 *     was computed.
 *   - `consumeProfitSignal({ recommendation })` asked the *client* to report
 *     what the engine had produced.
 *
 * A client that reported `"WAIT"` received `NOT_CHARGEABLE`, spent nothing,
 * and still held the LONG. A client that skipped the call entirely was not
 * charged either. Neither is a "cheat" requiring special tooling — the
 * mutation is callable from the console.
 *
 * The fix is architectural: **the protected payload must never be produced on
 * the client at all.** The engine runs server-side, and this module decides
 * what may cross back. Nothing here reads client state.
 *
 * ## What is protected
 *
 * Only the *actionable* part of a decision is monetised. Analytical context,
 * data-quality disclosure, and explicit refusals stay free, because charging
 * for refusals would push the engine toward manufacturing recommendations —
 * exactly what the analysis-integrity rules forbid.
 *
 * ## What this module deliberately does NOT do
 *
 * It never rewrites a locked LONG/SHORT into WAIT or NO_TRADE. A locked
 * result is marked `locked`, and the direction is *absent*, not replaced.
 * Substituting a refusal would corrupt the decision record and lie to the
 * user about what the engine actually concluded.
 */

import { isProfitSignal, type EntitlementDecision } from "./entitlement";

/**
 * Fields that carry, or can be trivially inverted into, the actionable
 * direction. A locked payload must contain none of them.
 *
 * This is an allowlist-by-omission on purpose: the redactor below *builds* a
 * new object from known-safe fields rather than deleting from the full one.
 * Deleting is fragile — a field added upstream would leak by default. Building
 * means an unlisted field is withheld by default, which is the safe direction
 * to fail in.
 */
export const PROTECTED_DECISION_FIELDS = [
  "recommendation",
  "conviction",
  "tradePlan",
  "positionSizing",
  "bias",
  "confidence",
  "analystThesis",
  "professionalThesis",
  "marketScenario",
  "forwardMarketPath",
  "longHorizonThesis",
  "evidenceChallenge",
  "decisionTrace",
  "decisionFingerprint",
  "keyLevels",
  "technicalSummary",
  "fundamentalSummary",
  "riskNote",
] as const;

/** Minimal non-directional shape returned when a signal is withheld. */
export interface LockedDecisionPayload {
  locked: true;
  reason: "FREE_ALLOWANCE_EXHAUSTED";
  upgradeRequired: true;
  /** Which instrument was analysed — not itself a signal. */
  instrument: string;
  instrumentType?: string;
  timeframe?: string;
  timestamp?: number;
  /** Data-quality disclosure stays visible so nothing looks healthier than it is. */
  dataCompleteness?: string;
  dataFlags?: string[];
  /**
   * True when the withheld decision was actionable. The user is told a signal
   * exists; they are not told which way it points.
   */
  hadActionableSignal: true;
}

export interface GateInput {
  /** The engine's verbatim output. Server-computed — never client-supplied. */
  result: Record<string, unknown>;
  /** The server's entitlement decision for this caller. */
  entitlement: Pick<EntitlementDecision, "allowed">;
}

export type GateOutcome =
  | { status: "DELIVERED"; chargeable: boolean; result: Record<string, unknown> }
  | { status: "LOCKED"; chargeable: true; result: LockedDecisionPayload };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Decide what may be delivered to the caller.
 *
 * Chargeability is derived from the engine's own output, never from anything
 * the caller asserted. A non-actionable result is delivered in full and costs
 * nothing; an actionable one is delivered only when entitlement allows, and is
 * otherwise reduced to {@link LockedDecisionPayload}.
 */
export function gateDecision({ result, entitlement }: GateInput): GateOutcome {
  const recommendation = str(result.recommendation);
  const chargeable = isProfitSignal(recommendation);

  // WAIT / NO_TRADE / insufficient evidence: always free, always complete.
  if (!chargeable) {
    return { status: "DELIVERED", chargeable: false, result };
  }

  if (entitlement.allowed) {
    return { status: "DELIVERED", chargeable: true, result };
  }

  // Actionable, but not entitled. Build the locked payload from safe fields
  // only — never by stripping the full object.
  const locked: LockedDecisionPayload = {
    locked: true,
    reason: "FREE_ALLOWANCE_EXHAUSTED",
    upgradeRequired: true,
    instrument: str(result.instrument) ?? "",
    instrumentType: str(result.instrumentType),
    timeframe: str(result.timeframe),
    timestamp: typeof result.timestamp === "number" ? result.timestamp : undefined,
    dataCompleteness: str(result.dataCompleteness),
    dataFlags: Array.isArray(result.dataFlags)
      ? result.dataFlags.filter((f): f is string => typeof f === "string")
      : undefined,
    hadActionableSignal: true,
  };

  return { status: "LOCKED", chargeable: true, result: locked };
}

/**
 * Assert a payload carries no protected field. Exported so both the server
 * and the test-suite can check the same invariant against the same list.
 */
export function findLeakedFields(payload: unknown): string[] {
  if (payload === null || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  return PROTECTED_DECISION_FIELDS.filter(
    (f) => obj[f] !== undefined && obj[f] !== null,
  );
}
