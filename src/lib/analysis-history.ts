import type { HistoricalContextSummaries } from "@/types/analysis";

interface StoredAnalysisContext {
  sentimentSummary?: unknown;
  sentimentScore?: unknown;
  macroSummary?: unknown;
  derivativesSummary?: unknown;
  calendarSummary?: unknown;
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Historical rows store narrative summaries, not raw provider payloads.
 * Keep these as summaries instead of reconstructing synthetic provider data.
 */
export function buildHistoricalContextSummaries(
  record: StoredAnalysisContext,
): HistoricalContextSummaries | undefined {
  const sentimentSummary = nonEmptyText(record.sentimentSummary);
  const sentimentScore =
    typeof record.sentimentScore === "number" && Number.isFinite(record.sentimentScore)
      ? record.sentimentScore
      : undefined;
  const sentiment =
    sentimentSummary !== undefined || sentimentScore !== undefined
      ? {
          ...(sentimentSummary !== undefined ? { summary: sentimentSummary } : {}),
          ...(sentimentScore !== undefined ? { score: sentimentScore } : {}),
        }
      : undefined;

  const macro = nonEmptyText(record.macroSummary);
  const derivatives = nonEmptyText(record.derivativesSummary);
  const calendar = nonEmptyText(record.calendarSummary);

  if (!sentiment && !macro && !derivatives && !calendar) return undefined;

  return {
    ...(sentiment ? { sentiment } : {}),
    ...(macro ? { macro } : {}),
    ...(derivatives ? { derivatives } : {}),
    ...(calendar ? { calendar } : {}),
  };
}
