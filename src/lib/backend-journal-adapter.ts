import type { BackendJournalRecord } from "@/lib/backend-api";
import type { AnalysisSnapshot, JournalEntry, TradeOutcome, TradeStatus } from "@/types/journal";

const TRADE_STATUSES = new Set<TradeStatus>([
  "PLANNED", "OPEN", "CLOSED", "CANCELLED", "INVALIDATED", "NO_TRADE", "WAITING",
]);
const TRADE_OUTCOMES = new Set<TradeOutcome>(["WIN", "LOSS", "BREAKEVEN", "PARTIAL", "UNKNOWN"]);

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid backend journal snapshot: ${field} must be a string`);
  return value;
}

function toAnalysisSnapshot(value: Record<string, unknown>): AnalysisSnapshot {
  const confidence = value.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw new Error("Invalid backend journal snapshot: confidence must be a finite number");
  }

  let keyLevels: AnalysisSnapshot["keyLevels"];
  if (value.keyLevels !== undefined && value.keyLevels !== null) {
    if (typeof value.keyLevels !== "object" || Array.isArray(value.keyLevels)) {
      throw new Error("Invalid backend journal snapshot: keyLevels must be an object");
    }
    const levels = value.keyLevels as Record<string, unknown>;
    keyLevels = {
      support: requiredString(levels.support, "keyLevels.support"),
      resistance: requiredString(levels.resistance, "keyLevels.resistance"),
      invalidation: requiredString(levels.invalidation, "keyLevels.invalidation"),
    };
  }

  return {
    analysisId: requiredString(value.analysisId, "analysisId"),
    decision: requiredString(value.decision, "decision"),
    bias: requiredString(value.bias, "bias"),
    conviction: optionalString(value.conviction),
    confidence,
    scenario: optionalString(value.scenario),
    marketRegime: optionalString(value.marketRegime),
    marketPhase: optionalString(value.marketPhase),
    continuationQuality: optionalString(value.continuationQuality),
    fundamentalAlignment: optionalString(value.fundamentalAlignment),
    actionability: optionalString(value.actionability),
    forwardPrimaryPath: optionalString(value.forwardPrimaryPath),
    forwardAlternatePath: optionalString(value.forwardAlternatePath),
    keyLevels,
    technicalSummary: requiredString(value.technicalSummary, "technicalSummary"),
    fundamentalSummary: requiredString(value.fundamentalSummary, "fundamentalSummary"),
    dataCompleteness: requiredString(value.dataCompleteness, "dataCompleteness"),
    decisionFingerprint: optionalString(value.decisionFingerprint),
  };
}

/**
 * Converts the self-hosted API representation into the domain model consumed
 * by the existing Journal UI. Null database values become absent optional
 * fields; malformed snapshots/statuses fail closed instead of being guessed.
 */
export function backendJournalToEntry(record: BackendJournalRecord): JournalEntry {
  if (!TRADE_STATUSES.has(record.status as TradeStatus)) {
    throw new Error(`Invalid backend journal status: ${record.status}`);
  }

  const outcome = record.outcome == null
    ? undefined
    : TRADE_OUTCOMES.has(record.outcome as TradeOutcome)
      ? record.outcome as TradeOutcome
      : undefined;

  return {
    id: record._id,
    createdAt: record.timestamps?.createdAt ?? record._creationTime,
    updatedAt: record.timestamps?.updatedAt ?? record._creationTime,
    instrument: record.instrument,
    instrumentType: record.instrumentType,
    timeframe: record.timeframe,
    style: record.style,
    analysisSnapshot: toAnalysisSnapshot(record.analysisSnapshot),
    status: record.status as TradeStatus,
    entry: optionalNumber(record.entry),
    stopLoss: optionalNumber(record.stopLoss),
    takeProfit: optionalNumber(record.takeProfit),
    riskReward: optionalNumber(record.riskReward),
    positionSize: optionalNumber(record.positionSize),
    notionalValue: optionalNumber(record.notionalValue),
    exitPrice: optionalNumber(record.exitPrice),
    pnl: optionalNumber(record.pnl),
    pnlPercent: optionalNumber(record.pnlPercent),
    outcome,
    closedAt: optionalNumber(record.closedAt),
    entryReason: optionalString(record.entryReason),
    thesisAtEntry: optionalString(record.thesisAtEntry),
    confirmationObserved: optionalString(record.confirmationObserved),
    invalidationObserved: optionalString(record.invalidationObserved),
    whatWentRight: optionalString(record.whatWentRight),
    whatWentWrong: optionalString(record.whatWentWrong),
    lessons: optionalString(record.lessons),
    notes: optionalString(record.notes),
  };
}
