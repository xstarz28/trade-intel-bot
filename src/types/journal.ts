/**
 * Phase 31 — JOURNAL ENTRY TYPES.
 *
 * Typed model for the trade/investment journal.
 * Journal records consume analysis output — they never modify it.
 * Historical journal entries remain immutable in their analysis snapshot.
 */

// ── Trade Lifecycle ──────────────────────────────────────────────

export type TradeStatus =
  | "PLANNED"
  | "OPEN"
  | "CLOSED"
  | "CANCELLED"
  | "INVALIDATED"
  | "NO_TRADE"
  | "WAITING";

export type TradeOutcome = "WIN" | "LOSS" | "BREAKEVEN" | "PARTIAL" | "UNKNOWN";

// ── Analysis Snapshot (immutable copy at journal creation time) ──

export interface AnalysisSnapshot {
  /** Reference to the original analysis result id. */
  analysisId: string;
  /** Engine decision at time of journaling. */
  decision: string;
  /** Structural bias. */
  bias: string;
  /** Conviction level. */
  conviction?: string;
  /** Confidence score. */
  confidence: number;
  /** Market scenario classification. */
  scenario?: string;
  /** Market regime. */
  marketRegime?: string;
  /** Market phase. */
  marketPhase?: string;
  /** Continuation quality. */
  continuationQuality?: string;
  /** Fundamental alignment. */
  fundamentalAlignment?: string;
  /** Professional actionability. */
  actionability?: string;
  /** Forward path primary. */
  forwardPrimaryPath?: string;
  /** Forward path alternate. */
  forwardAlternatePath?: string;
  /** Key structural levels. */
  keyLevels?: { support: string; resistance: string; invalidation: string };
  /** Technical summary text. */
  technicalSummary: string;
  /** Fundamental summary text. */
  fundamentalSummary: string;
  /** Data completeness level. */
  dataCompleteness: string;
  /** Decision fingerprint. */
  decisionFingerprint?: string;
}

// ── Journal Entry ────────────────────────────────────────────────

export interface JournalEntry {
  /** Unique identifier. */
  id: string;
  /** Creation timestamp. */
  createdAt: number;
  /** Last update timestamp. */
  updatedAt: number;

  // ── Market ──
  /** Instrument symbol. */
  instrument: string;
  /** Instrument type. */
  instrumentType: string;
  /** Timeframe used. */
  timeframe: string;
  /** Trading style. */
  style: string;

  // ── Phase 262 — provider-native identity preservation ──
  /** Provider id, e.g. okx, ccxt:binance, twelve-data */
  provider?: string;
  /** Provider-native instrument id, e.g. BTC-USDT, BTC/USDT, XAU/USD */
  providerInstrumentId?: string;
  /** Asset class crypto|forex|commodity|equity|indices */
  assetClass?: string;
  /** Optional human title/heading */
  title?: string;

  // ── Analysis Snapshot (immutable) ──
  /** Snapshot of the analysis at journal creation time. */
  analysisSnapshot: AnalysisSnapshot;

  // ── Trade Information (mutable by user) ──
  /** Current trade status. */
  status: TradeStatus;
  /** Entry price. */
  entry?: number;
  /** Stop loss. */
  stopLoss?: number;
  /** Take profit. */
  takeProfit?: number;
  /** Risk/reward ratio. */
  riskReward?: number;
  /** Position size (contracts/units). */
  positionSize?: number;
  /** Position notional value. */
  notionalValue?: number;

  // ── Outcome (mutable by user) ──
  /** Exit price. */
  exitPrice?: number;
  /** P/L in account currency. */
  pnl?: number;
  /** P/L percentage. */
  pnlPercent?: number;
  /** Trade outcome classification. */
  outcome?: TradeOutcome;
  /** When the trade was closed. */
  closedAt?: number;

  // ── Professional Review (mutable by user) ──
  /** Why did the user enter this trade? */
  entryReason?: string;
  /** What was the thesis at entry? */
  thesisAtEntry?: string;
  /** Was the confirmation condition observed? */
  confirmationObserved?: string;
  /** Was the invalidation condition observed? */
  invalidationObserved?: string;
  /** What went right? */
  whatWentRight?: string;
  /** What went wrong? */
  whatWentWrong?: string;
  /** Lessons learned. */
  lessons?: string;
  /** Additional notes. */
  notes?: string;
}

// ── Valid Lifecycle Transitions ───────────────────────────────────

/** Allowed source → target transitions. */
export const VALID_TRANSITIONS: Record<TradeStatus, TradeStatus[]> = {
  PLANNED: ["OPEN", "CANCELLED", "INVALIDATED"],
  OPEN: ["CLOSED", "INVALIDATED"],
  CLOSED: [], // terminal
  CANCELLED: [], // terminal
  INVALIDATED: [], // terminal
  NO_TRADE: [], // terminal observation
  WAITING: ["PLANNED", "CANCELLED"], // can transition to planned or cancelled
};

// ── Creation Input ───────────────────────────────────────────────

export interface CreateJournalEntryInput {
  /** Instrument from the analysis. */
  instrument: string;
  /** Instrument type. */
  instrumentType: string;
  /** Timeframe. */
  timeframe: string;
  /** Trading style. */
  style: string;
  /** Analysis result to snapshot. */
  analysisSnapshot: AnalysisSnapshot;
  /** Initial status. Defaults to PLANNED. */
  status?: TradeStatus;
  /** User-provided entry price. */
  entry?: number;
  /** User-provided stop loss. */
  stopLoss?: number;
  /** User-provided take profit. */
  takeProfit?: number;
  /** Risk/reward ratio. */
  riskReward?: number;
  /** Position size (contracts/units). */
  positionSize?: number;
  /** Position notional value. */
  notionalValue?: number;
  /** User-provided entry reason. */
  entryReason?: string;
  /** User-provided thesis. */
  thesisAtEntry?: string;
  /** User-provided notes. */
  notes?: string;
  /** Provider id */
  provider?: string;
  /** Provider-native instrument id */
  providerInstrumentId?: string;
  /** Asset class */
  assetClass?: string;
  /** Optional title */
  title?: string;
}
