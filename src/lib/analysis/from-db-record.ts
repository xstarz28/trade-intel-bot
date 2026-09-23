/**
 * Phase 228 — typed projection of a persisted `analyses` row onto the UI's
 * `AnalysisResult`.
 *
 * Phase 239 — an UNREADABLE row now returns `null` instead of a lie.
 *
 * `analyses.list` returns raw documents (`ctx.db.query("analyses")`), and
 * Convex validates a document when it is WRITTEN, not when it is read: a row
 * stored before a field existed is still returned. This projection read
 * `record.breakdown.trend` unguarded, so one such row threw a `TypeError`
 * during the Dashboard's render — measured (Phase 239), the whole application
 * was replaced by the crash panel and could not be navigated out of. The
 * missing-`keyLevels` case was worse than a missing `breakdown`: the row was
 * projected into an `AnalysisResult` whose type PROMISED `keyLevels`, and the
 * consumer crashed later, further from the cause.
 *
 * The rule for an uninterpretable row is the same rule the rest of the code
 * follows for unavailable data: do not render it and do not invent a value for
 * it. `null` means exactly that, the caller drops it, and the drop is recorded
 * as a data-integrity diagnostic rather than disappearing silently.
 *
 * Note what is NOT done here: no neutral/zero substitution for a missing
 * `support`/`resistance`/`invalidation`. A fabricated "0" is a market claim.
 *
 * The Convex schema stores the enum-like columns as plain strings
 * (`bias`, `recommendation`, `instrumentType`, …). Previously the page read
 * the row as `any`, so a drifted value (e.g. a legacy "Long") flowed straight
 * into `AnalysisResult` and every consumer's `switch`. Here each string is
 * checked against the domain union; an out-of-union value maps to the
 * *conservative* member (NO_TRADE / Neutral / partial / undefined) — never a
 * fabricated directional call.
 */
import type { Doc } from "@/convex/_generated/dataModel";
import type {
  AnalysisResult,
  ConvictionLevel,
  DirectionalBias,
  FactorScore,
  InstrumentType,
  Recommendation,
  Timeframe,
} from "@/types/analysis";
import { TRADING_STYLES, type TradingStyle } from "@/lib/trading-style";

const INSTRUMENT_TYPES: readonly InstrumentType[] = ["forex", "crypto", "stock", "commodity", "indices"];
const TIMEFRAMES: readonly Timeframe[] = ["M1", "M5", "M15", "H1", "H4", "D1", "W1"];
const BIASES: readonly DirectionalBias[] = ["Bullish", "Bearish", "Neutral"];
const RECOMMENDATIONS: readonly Recommendation[] = ["LONG", "SHORT", "NO_TRADE"];
const CONVICTIONS: readonly ConvictionLevel[] = ["High", "Medium", "Low"];
const COMPLETENESS = ["full", "partial", "limited"] as const;
const FACTOR_SCORES: readonly FactorScore[] = [-2, -1, 0, 1, 2];

function oneOf<T extends string>(allowed: readonly T[], v: unknown): T | undefined {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : undefined;
}
function factor(v: number): FactorScore {
  return (FACTOR_SCORES as readonly number[]).includes(v) ? (v as FactorScore) : 0;
}

/** The persisted row shape, as generated from the schema. */
export type AnalysisRow = Doc<"analyses">;

/** Required nested objects a row must carry to be interpretable at all. */
function hasBreakdown(value: unknown): value is { trend: number; indicator: number; fundamental: number; sentiment: number } {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return [b.trend, b.indicator, b.fundamental, b.sentiment].every(
    (n) => typeof n === "number" && Number.isFinite(n),
  );
}

function hasKeyLevels(value: unknown): value is { support: string; resistance: string; invalidation: string } {
  if (typeof value !== "object" || value === null) return false;
  const k = value as Record<string, unknown>;
  return [k.support, k.resistance, k.invalidation].every((v) => typeof v === "string");
}

/**
 * Whether a persisted row can be projected at all.
 *
 * Exported so the reason a row was dropped can be named in a diagnostic
 * without duplicating the rules.
 */
export function uninterpretableRowReason(record: unknown): string | null {
  if (typeof record !== "object" || record === null) return "row is not an object";
  const r = record as Record<string, unknown>;
  if (!hasBreakdown(r.breakdown)) return "row has no usable breakdown";
  if (!hasKeyLevels(r.keyLevels)) return "row has no usable key levels";
  return null;
}

export function fromDbRecord(record: AnalysisRow): AnalysisResult | null {
  /*
    Phase 239 — refuse an unreadable row. Returning a value here is what put a
    `TypeError` inside the Dashboard's render, one malformed row away from a
    blank application.
  */
  if (uninterpretableRowReason(record) !== null) return null;

  const bias = oneOf(BIASES, record.bias) ?? "Neutral";
  // A stored recommendation wins; otherwise derive from bias exactly as the
  // pre-typed code did. An unrecognised stored value is NO_TRADE, not a trade.
  const recommendation: Recommendation =
    record.recommendation !== undefined
      ? (oneOf(RECOMMENDATIONS, record.recommendation) ?? "NO_TRADE")
      : bias === "Bullish" ? "LONG" : bias === "Bearish" ? "SHORT" : "NO_TRADE";
  const tradingStyle: TradingStyle = oneOf(TRADING_STYLES, record.tradingStyle) ?? "intraday";
  const sentimentScore = record.sentimentScore ?? 0;

  return {
    id: record._id,
    instrument: record.instrument,
    // Legacy rows may hold a non-canonical type/timeframe string; the UI's
    // own detection re-derives these on next analysis, so falling back to
    // the most generic members here does not invent market facts.
    instrumentType: oneOf(INSTRUMENT_TYPES, record.instrumentType) ?? "forex",
    timeframe: oneOf(TIMEFRAMES, record.timeframe) ?? "H1",
    bias,
    confidence: record.confidence,
    recommendation,
    tradingStyle,
    conviction: oneOf(CONVICTIONS, record.conviction),
    noTradeReasons: record.noTradeReasons ?? [],
    technicalSummary: record.technicalSummary,
    fundamentalSummary: record.fundamentalSummary,
    breakdown: {
      trend: factor(record.breakdown.trend),
      indicator: factor(record.breakdown.indicator),
      fundamental: factor(record.breakdown.fundamental),
      sentiment: factor(record.breakdown.sentiment),
    },
    keyLevels: record.keyLevels,
    riskNote: record.riskNote,
    dataCompleteness: oneOf(COMPLETENESS, record.dataCompleteness) ?? "partial",
    dataFlags: record.dataFlags,
    timestamp: record.timestamp,
    // Phase 252 — preserve exact provider-native identity from persisted history
    ...((record as any).provider ? { provider: (record as any).provider as string } : {}),
    ...((record as any).providerInstrumentId ? { providerInstrumentId: (record as any).providerInstrumentId as string } : {}),
    ...(record.price != null
      ? { priceSnapshot: { price: record.price, timestamp: record.timestamp, source: record.dataSource || "unknown" } }
      : {}),
    ...(record.dataSource ? { dataSource: record.dataSource } : {}),
    ...(record.sentimentSummary
      ? {
          sentimentData: {
            provider: "alpha-vantage",
            timestamp: record.timestamp,
            averageScore: sentimentScore,
            articleCount: 0,
            label: sentimentScore > 0.15 ? "bullish" : sentimentScore < -0.15 ? "bearish" : "neutral",
            breakdown: { positive: 0, negative: 0, neutral: 0 },
            confidence: "medium" as const,
            articles: [],
          },
        }
      : {}),
    ...(record.macroSummary
      ? { macroData: { provider: "alpha-vantage", timestamp: record.timestamp, indicators: [], summary: record.macroSummary, confidence: "medium" as const } }
      : {}),
    ...(record.derivativesSummary
      ? {
          derivativesData: {
            provider: "coinglass",
            symbol: record.instrument,
            timestamp: record.timestamp,
            freshness: "delayed" as const,
            availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
            confidence: "medium" as const,
            interpretation: record.derivativesSummary,
          },
        }
      : {}),
    ...(record.calendarSummary
      ? {
          calendarData: {
            provider: "tickatlas" as const,
            events: [],
            macroRisk: { level: "medium" as const, explanation: record.calendarSummary, highImpact24h: 0, highImpact72h: 0 },
            timestamp: record.timestamp,
            freshness: "recent" as const,
            confidence: "medium" as const,
            availability: { upcoming24h: false, upcoming72h: false, recentReleased: false },
          },
        }
      : {}),
  };
}
