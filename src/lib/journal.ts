/**
 * Phase 31 — JOURNAL PURE LOGIC.
 *
 * Isolated journal module that consumes analysis output and manages
 * trade lifecycle. This module NEVER modifies AnalysisResult data.
 *
 * Key invariants:
 * - Analysis snapshots are immutable at creation time
 * - Journal records never rewrite historical AnalysisResult data
 * - Missing values remain absent (null/undefined), never fabricated
 * - WAIT/NO_TRADE can be journaled as observations, not trades
 * - Lifecycle transitions are validated
 */

import type { AnalysisResult } from "@/types/analysis";
import type {
  JournalEntry,
  AnalysisSnapshot,
  CreateJournalEntryInput,
  TradeStatus,
  TradeOutcome,
  VALID_TRANSITIONS,
} from "@/types/journal";
import { VALID_TRANSITIONS as TRANSITIONS } from "@/types/journal";

// ── Snapshot Creation ────────────────────────────────────────────

/**
 * Extract an immutable analysis snapshot from an AnalysisResult.
 * This captures the state at journal creation time and must never change.
 */
export function createAnalysisSnapshot(result: AnalysisResult): AnalysisSnapshot {
  return {
    analysisId: result.id,
    decision: result.recommendation,
    bias: result.bias,
    conviction: result.conviction,
    confidence: result.confidence,
    scenario: result.marketScenario?.scenario,
    marketRegime: result.marketRegimeContext?.regime,
    marketPhase: result.marketRegimeContext?.marketPhase,
    continuationQuality: result.marketRegimeContext?.continuationQuality,
    fundamentalAlignment: result.fundamentalThesis?.alignment,
    actionability: result.professionalThesis?.actionability,
    forwardPrimaryPath: result.forwardMarketPath?.primaryPath,
    forwardAlternatePath: result.forwardMarketPath?.alternatePath,
    keyLevels: result.keyLevels
      ? { ...result.keyLevels }
      : undefined,
    technicalSummary: result.technicalSummary,
    fundamentalSummary: result.fundamentalSummary,
    dataCompleteness: result.dataCompleteness,
    decisionFingerprint: result.decisionFingerprint,
  };
}

// ── Journal Entry Creation ───────────────────────────────────────

let journalIdCounter = 0;

/**
 * Create a new journal entry from analysis data and user input.
 * Returns a complete JournalEntry with immutable snapshot.
 */
export function createJournalEntry(input: CreateJournalEntryInput): JournalEntry {
  const now = Date.now();
  const initialStatus = input.status ?? "PLANNED";

  // Validate initial status
  if (initialStatus !== "PLANNED" && initialStatus !== "WAITING" && initialStatus !== "NO_TRADE") {
    throw new Error(`Invalid initial status: ${initialStatus}. New entries must start as PLANNED, WAITING, or NO_TRADE.`);
  }

  journalIdCounter++;
  const id = `journal-${now}-${journalIdCounter}`;

  return {
    id,
    createdAt: now,
    updatedAt: now,
    instrument: input.instrument,
    instrumentType: input.instrumentType,
    timeframe: input.timeframe,
    style: input.style,
    analysisSnapshot: { ...input.analysisSnapshot }, // immutable copy
    status: initialStatus,
    entry: input.entry,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    riskReward: input.riskReward,
    positionSize: input.positionSize,
    notionalValue: input.notionalValue,
    entryReason: input.entryReason,
    thesisAtEntry: input.thesisAtEntry,
    notes: input.notes,
  };
}

/**
 * Create a journal entry directly from an AnalysisResult.
 * Convenience wrapper that extracts the snapshot automatically.
 */
export function journalFromAnalysis(
  result: AnalysisResult,
  overrides: Partial<CreateJournalEntryInput> = {},
): JournalEntry {
  const snapshot = createAnalysisSnapshot(result);
  return createJournalEntry({
    instrument: result.instrument,
    instrumentType: result.instrumentType,
    timeframe: result.timeframe,
    style: result.tradingStyle,
    analysisSnapshot: snapshot,
    ...overrides,
  });
}

// ── Lifecycle Transitions ────────────────────────────────────────

/**
 * Validate whether a lifecycle transition is allowed.
 */
export function isValidTransition(from: TradeStatus, to: TradeStatus): boolean {
  const allowed = TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Transition a journal entry to a new status.
 * Returns a new entry (immutable update) or throws if transition is invalid.
 */
export function transitionEntry(
  entry: JournalEntry,
  newStatus: TradeStatus,
  additionalFields: Partial<Pick<JournalEntry, "exitPrice" | "pnl" | "pnlPercent" | "outcome" | "closedAt">> = {},
): JournalEntry {
  if (!isValidTransition(entry.status, newStatus)) {
    throw new Error(
      `Invalid transition: ${entry.status} → ${newStatus}. ` +
      `Allowed: ${TRANSITIONS[entry.status]?.join(", ") || "none (terminal)"}`
    );
  }

  const now = Date.now();
  const updated: JournalEntry = {
    ...entry,
    status: newStatus,
    updatedAt: now,
  };

  // Apply outcome fields
  if (newStatus === "CLOSED") {
    updated.closedAt = additionalFields.closedAt ?? now;
    if (additionalFields.exitPrice !== undefined) updated.exitPrice = additionalFields.exitPrice;
    if (additionalFields.pnl !== undefined) updated.pnl = additionalFields.pnl;
    if (additionalFields.pnlPercent !== undefined) updated.pnlPercent = additionalFields.pnlPercent;
    if (additionalFields.outcome !== undefined) updated.outcome = additionalFields.outcome;
  }

  return updated;
}

// ── Review Update ────────────────────────────────────────────────

/**
 * Update professional review fields on a journal entry.
 * Returns a new entry (immutable update).
 */
export function updateReview(
  entry: JournalEntry,
  review: Partial<Pick<JournalEntry, "entryReason" | "thesisAtEntry" | "confirmationObserved" | "invalidationObserved" | "whatWentRight" | "whatWentWrong" | "lessons" | "notes">>,
): JournalEntry {
  return {
    ...entry,
    ...review,
    updatedAt: Date.now(),
  };
}

// ── Trade Information Update ─────────────────────────────────────

/**
 * Update trade information on a journal entry.
 * Returns a new entry (immutable update).
 */
export function updateTradeInfo(
  entry: JournalEntry,
  tradeInfo: Partial<Pick<JournalEntry, "entry" | "stopLoss" | "takeProfit" | "riskReward" | "positionSize" | "notionalValue">>,
): JournalEntry {
  return {
    ...entry,
    ...tradeInfo,
    updatedAt: Date.now(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Check if a journal entry is terminal (no more transitions allowed).
 */
export function isTerminal(entry: JournalEntry): boolean {
  return TRANSITIONS[entry.status]?.length === 0;
}

/**
 * Get the list of valid next statuses for a journal entry.
 */
export function getValidTransitions(entry: JournalEntry): TradeStatus[] {
  return TRANSITIONS[entry.status] ?? [];
}

/**
 * Check if an analysis result can be opened as a trade (not WAIT/NO_TRADE).
 */
export function canCreateTrade(result: AnalysisResult): boolean {
  return result.recommendation !== "NO_TRADE";
}

/**
 * Check if an analysis result is suitable for observation journaling.
 */
export function canJournalAsObservation(result: AnalysisResult): boolean {
  // Any result can be journaled as an observation
  return true;
}

/**
 * Compute P/L from entry and exit prices given trade direction.
 * Returns undefined if inputs are insufficient.
 */
export function computePnl(
  entry: number | undefined,
  exit: number | undefined,
  direction: "long" | "short" | undefined,
  positionSize: number | undefined,
): { pnl: number | undefined; pnlPercent: number | undefined } {
  if (entry === undefined || exit === undefined || direction === undefined) {
    return { pnl: undefined, pnlPercent: undefined };
  }

  const priceDiff = direction === "long" ? exit - entry : entry - exit;
  const pnl = positionSize !== undefined ? priceDiff * positionSize : priceDiff;
  const pnlPercent = entry !== 0 ? (priceDiff / entry) * 100 : undefined;

  return {
    pnl: isFinite(pnl) ? pnl : undefined,
    pnlPercent: pnlPercent !== undefined && isFinite(pnlPercent) ? pnlPercent : undefined,
  };
}

/**
 * Determine trade outcome from P/L.
 */
export function classifyOutcome(pnl: number | undefined): TradeOutcome {
  if (pnl === undefined || pnl === null) return "UNKNOWN";
  if (pnl === 0) return "BREAKEVEN";
  if (pnl > 0) return "WIN";
  return "LOSS";
}

/**
 * Create a snapshot-only observation entry (no trade intent).
 */
export function createObservationEntry(
  result: AnalysisResult,
  notes?: string,
): JournalEntry {
  return journalFromAnalysis(result, {
    status: "NO_TRADE",
    notes: notes ?? "Observation entry — no trade taken",
  });
}
