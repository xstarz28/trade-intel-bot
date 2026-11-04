import type { CreateBackendJournalEntry } from "@/lib/backend-api";
import type { JournalEntry } from "@/types/journal";

/**
 * Builds the allowlisted create payload for the self-hosted journal API.
 * Identity, database timestamps, and server IDs are intentionally omitted:
 * the backend owns those fields and derives ownership from its session.
 */
export function journalEntryToBackendCreate(entry: JournalEntry): CreateBackendJournalEntry {
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
