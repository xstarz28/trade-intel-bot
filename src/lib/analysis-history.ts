import type { HistoricalContextSummaries, Recommendation } from "@/types/analysis";

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
  if (normalized.length === 0) return undefined;
  // Drop a known legacy placeholder written when sentimentData was absent.
  if (/^(?:undefined|null)\\s*\\(\\s*0 articles?\\s*\\)$/i.test(normalized)) return undefined;
  return normalized;
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

export interface PersistedContextSummaries {
  sentimentSummary?: string;
  sentimentScore?: number;
  macroSummary?: string;
  derivativesSummary?: string;
  calendarSummary?: string;
}

interface CurrentAnalysisContext {
  sentimentData?: {
    confidence: string;
    label: string;
    articleCount: number;
    averageScore: number;
  };
  macroData?: { confidence: string; summary: string };
  derivativesData?: { confidence: string; interpretation?: string };
  calendarData?: {
    confidence: string;
    macroRisk: { level: string; explanation: string };
  };
}

/**
 * Serialize only context objects that were actually available in the analysis.
 * In particular, absent optional data must not become strings such as
 * "undefined (0 articles)" in history.
 */
export function buildPersistedContextSummaries(
  result: CurrentAnalysisContext,
): PersistedContextSummaries {
  const saved: PersistedContextSummaries = {};
  const sentiment = result.sentimentData;
  if (sentiment && sentiment.confidence !== "unavailable") {
    const label = nonEmptyText(sentiment.label);
    if (label) {
      saved.sentimentSummary =
        Number.isFinite(sentiment.articleCount) && sentiment.articleCount >= 0
          ? `${label} (${sentiment.articleCount} articles)`
          : label;
    }
    if (Number.isFinite(sentiment.averageScore)) {
      saved.sentimentScore = sentiment.averageScore;
    }
  }

  const macro = result.macroData;
  if (macro && macro.confidence !== "unavailable") {
    const summary = nonEmptyText(macro.summary);
    if (summary) saved.macroSummary = summary;
  }

  const derivatives = result.derivativesData;
  if (derivatives && derivatives.confidence !== "unavailable") {
    const summary = nonEmptyText(derivatives.interpretation);
    if (summary) saved.derivativesSummary = summary;
  }

  const calendar = result.calendarData;
  if (calendar && calendar.confidence !== "unavailable") {
    const level = nonEmptyText(calendar.macroRisk.level);
    const explanation = nonEmptyText(calendar.macroRisk.explanation);
    if (level && explanation) {
      saved.calendarSummary = `Macro risk: ${level} — ${explanation}`;
    }
  }

  return saved;
}

export interface ResolvedHistoricalDecision {
  recommendation: Recommendation;
  noTradeReasons: string[];
}

/**
 * A bias is not a trade permission. If an old row has no valid saved decision,
 * fail closed to NO_TRADE rather than infer LONG/SHORT from Bullish/Bearish bias.
 */
export function resolveHistoricalDecision(
  recommendation: unknown,
  reasons: unknown,
): ResolvedHistoricalDecision {
  const savedReasons = Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
    : [];
  if (recommendation === "LONG" || recommendation === "SHORT" || recommendation === "NO_TRADE") {
    return { recommendation, noTradeReasons: savedReasons };
  }

  const unresolvedReason = "Historical trade decision was not stored; this result cannot be treated as an actionable trade.";
  return {
    recommendation: "NO_TRADE",
    noTradeReasons: [...savedReasons, unresolvedReason],
  };
}
