/**
 * Phase 228 — typed projection of a persisted `analyses` row onto the UI's
 * `AnalysisResult`.
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

export function fromDbRecord(record: AnalysisRow): AnalysisResult {
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
