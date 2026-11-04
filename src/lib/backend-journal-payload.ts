import type { CreateBackendJournalEntry } from "@/lib/backend-api";
import type { JournalEntry } from "@/types/journal";

/**
 * Converts the existing Journal domain model into the self-hosted API create
 * contract. Server-owned identity, IDs and timestamps are intentionally omitted.
 */
export function journalEntryToBackendCreate(
  entry: JournalEntry,
): CreateBackendJournalEntry {
  return {
    instrument: entry.instrument,
    instrumentType: entry.instrumentType,
    timeframe: entry.timeframe,
    style: entry.style,
    analysisSnapshot: { ...entry.analysisSnapshot },
    status: entry.status,
    entry: entry.entry,
    stopLoss: entry.stopLoss,
    takeProfit: entry.takeProfit,
    riskReward: entry.riskReward,
    positionSize: entry.positionSize,
    notionalValue: entry.notionalValue,
    entryReason: entry.entryReason,
    thesisAtEntry: entry.thesisAtEntry,
    notes: entry.notes,
  };
}
