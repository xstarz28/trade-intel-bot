/**
 * Phase 9 — deterministic benchmark fixtures (TEST-ONLY helpers).
 *
 * These builders assemble AnalysisInput objects for the EXISTING engine
 * (runAnalysis). They contain ZERO decision logic — no thresholds, scoring,
 * gates, or classification are duplicated here. Every market fact is an
 * explicit fixture value; nothing is synthesized at analysis time.
 */
import type { AnalysisInput } from "@/types/analysis";
import type {
  MarketData,
  MtfContext,
  SmcContext,
  TechnicalData,
} from "@/lib/data/market-types";
import type { MacroData, SentimentData } from "@/lib/data/intelligence-types";
import type { TreasuryData } from "@/lib/data/treasury";
import type { CotData } from "@/lib/data/cot";
import type { ExecutionData } from "@/lib/execution-quality";

// ── Market data ────────────────────────────────────────────────────

export function makeMarket(
  instrument: string,
  instrumentType: AnalysisInput["instrumentType"],
  price: number,
): MarketData {
  return {
    instrument, instrumentType, provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

// ── SMC builder (explicit facts only) ──────────────────────────────

export interface SmcSpec {
  structure?: "HH/HL" | "LH/LL" | "range";
  bos?: "bullish" | "bearish" | "none";
  choch?: "bullish" | "bearish" | "none";
  sweepSide?: "buy_side" | "sell_side";
  displacement?: "bullish" | "bearish";
  freshFvg?: "bullish" | "bearish";
  obDirection?: "bullish" | "bearish";
}

export function buildSmc(spec: SmcSpec = {}): SmcContext {
  return {
    timeframe: "H4",
    liquidityPools: [],
    internalExternal: {
      external: {
        structure: spec.structure ?? "range",
        bosDirection: spec.bos ?? "none",
        chochDirection: spec.choch ?? "none",
        lastSwingHigh: undefined,
        lastSwingLow: undefined,
        dataPoints: 210,
      },
      internal: {
        structure: spec.structure === "range" ? "range" : (spec.structure ?? "range"),
        bosDirection: "none",
        chochDirection: "none",
        lastSwingHigh: undefined,
        lastSwingLow: undefined,
        dataPoints: 60,
      },
      internalConflict: false,
    },
    recentSweep: spec.sweepSide
      ? { side: spec.sweepSide, level: 100, source: "swing_highs" as const, candleIndex: 205, candleTime: Date.now() - 36e5, timeframe: "H4" }
      : undefined,
    displacement: spec.displacement
      ? { direction: spec.displacement, candleIndex: 201, candleTime: Date.now() - 36e5, bodyRatio: 0.85, rangeAtrMultiple: 1.8 }
      : undefined,
    fvgs: spec.freshFvg
      ? [{ direction: spec.freshFvg, status: "fresh", upper: 101, lower: 99.5, timeframe: "H4", createdAtIndex: 201, createdAt: Date.now() - 2 * 36e5 }] as never
      : [],
    orderBlocks: spec.obDirection
      ? [{
          direction: spec.obDirection, status: "fresh", upper: 101, lower: 99.5,
          timeframe: "H4", createdAt: Date.now() - 3 * 36e5,
          evidence: { precedingOpposingCandle: true, displacementAfter: true, structuralBreakAfter: true, displacementRangeAtr: 1.8 },
        }] as never
      : [],
    vwap: { available: false, unavailableReason: "no session data" },
    volumeProfile: { available: false, unavailableReason: "zero-volume series" },
  } as unknown as SmcContext;
}

// ── Technical base ─────────────────────────────────────────────────

export interface TechSpec extends SmcSpec {
  /** Structural swing levels bracketing entry 100 with R:R ≥ 2 both ways. */
  support?: number;
  resistance?: number;
  mtf?: MtfContext;
}

export function techFrom(spec: TechSpec = {}): TechnicalData {
  return {
    swingHighs: [spec.resistance ?? 105],
    swingLows: [spec.support ?? 95],
    structure: spec.structure ?? "range",
    bosDirection: spec.bos ?? "none",
    chochDirection: spec.choch ?? "none",
    supportLevels: [spec.support ?? 95],
    resistanceLevels: [spec.resistance ?? 105],
    volumeTrend: "unknown",
    dataPoints: 210,
    smc: buildSmc(spec),
    ...(spec.mtf ? { mtf: spec.mtf } : {}),
  };
}

/** Bullish levels: SL 95 / TP 112 → RR 2.4 · Bearish: SL 105 / TP 88 → RR 2.4. */
export const BULL_LEVELS = { support: 95, resistance: 112 };
export const BEAR_LEVELS = { support: 88, resistance: 105 };

// ── MTF builder ────────────────────────────────────────────────────

export function buildMtf(opts: {
  alignment: MtfContext["alignment"];
  htfBias: "long" | "short" | "none";
  reversal?: { timeframe: string; direction: "bullish" | "bearish"; kind: "bos" | "choch" };
  triggerTf?: string;
}): MtfContext {
  return {
    requestedTimeframe: "H4", chainUsed: ["D1", "H4"], unavailable: [],
    timeframes: opts.triggerTf
      ? [{ timeframe: opts.triggerTf, role: "trigger", available: true, smc: buildSmc() }]
      : [],
    alignment: opts.alignment,
    htfBias: opts.htfBias,
    htfTimeframe: "D1", setupTimeframe: "H4", triggerTimeframe: opts.triggerTf,
    ...(opts.reversal ? { htfReversal: opts.reversal } : {}),
  };
}

// ── Provider evidence builders (all explicit fixture values) ───────

export function macro(direction: "bullish" | "bearish"): MacroData {
  return {
    provider: "alpha-vantage", timestamp: Date.now(),
    indicators: Array.from({ length: 6 }, (_, i) => ({
      name: `ind${i}`, relevance: "high" as const,
      sentiment: direction === "bullish" ? ("positive" as const) : ("negative" as const),
    })),
    summary: "", confidence: "high",
  };
}

export function sentiment(direction: "bullish" | "bearish", strength: number): SentimentData {
  const pos = direction === "bullish";
  return {
    provider: "alpha-vantage", timestamp: Date.now(),
    averageScore: pos ? 0.8 * strength : -0.8 * strength,
    articleCount: Math.max(3, Math.round(10 * strength)),
    label: pos ? "bullish" : "bearish",
    breakdown: { positive: pos ? 9 : 0, negative: pos ? 0 : 9, neutral: 1 },
    confidence: "high", articles: [],
  };
}

export function treasury(netYieldChangeBp: number): Extract<TreasuryData, { available: true }> {
  const y = 4.63;
  return {
    available: true,
    source: "US Treasury (home.treasury.gov XML feed)",
    fetchedAt: Date.now(),
    freshness: "FRESH",
    latest: { nominal: { observationDate: "2026-08-21", nominal: { "2Y": 4.2, "10Y": y + netYieldChangeBp / 10000 } } },
    previous: { nominal: { observationDate: "2026-08-20", nominal: { "2Y": 4.2, "10Y": y } } },
  };
}

export function cot(netChange: number): Extract<CotData, { available: true }> {
  return {
    available: true,
    source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
    fetchedAt: Date.now(),
    freshness: "FRESH",
    requestedInstrument: "EUR/USD",
    sourceInstrument: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    mappedAsset: "EUR (euro)",
    latest: { reportDate: "2026-08-18", nonCommercialLong: 60000 + netChange / 2, nonCommercialShort: 50000 - netChange / 2, openInterest: 200000 },
    previous: { reportDate: "2026-08-11", nonCommercialLong: 60000, nonCommercialShort: 50000, openInterest: 200000 },
    netNonCommercial: 10000 + netChange,
    changeFromPreviousReport: netChange,
  };
}

/** Crypto order book with configurable imbalance (positive = bid-heavy). */
export function execution(imbalance: number): ExecutionData {
  const bidDepth = imbalance >= 0 ? 1000 : 300;
  const askDepth = imbalance >= 0 ? 1000 * (1 - imbalance) / (1 + imbalance) : 1000;
  return {
    available: true,
    provider: "OKX public order book",
    instrumentId: "BTC-USDT-SWAP",
    snapshotTs: Date.now(),
    fetchedAt: Date.now(),
    freshness: "FRESH",
    bid: 99.95, ask: 100.05, mid: 100,
    spread: 0.1, spreadBps: 10 * 0.1, // 1 bps — tight
    bidDepth, askDepth,
    imbalance,
    regime: "LIQUID",
    book: { bids: [["99.95", "1000"]], asks: [["100.05", `${askDepth}`]] } as never,
  } as unknown as ExecutionData;
}

export const executionUnavailable = (): ExecutionData =>
  ({ available: false, reason: "books unreachable", instrumentId: null }) as unknown as ExecutionData;

// ── Input assembly ─────────────────────────────────────────────────

export interface InputSpec extends TechSpec {
  instrument?: string;
  instrumentType?: AnalysisInput["instrumentType"];
  style?: string;
  events?: string;
  news?: string;
  macroData?: MacroData;
  sentimentData?: SentimentData;
  treasuryData?: TreasuryData;
  cotData?: CotData;
  executionData?: ExecutionData;
  crossAsset?: TechnicalData["crossAsset"];
  calendarEvents?: AnalysisInput["calendarData"];
}

export function assemble(spec: InputSpec = {}): AnalysisInput {
  const instrument = spec.instrument ?? "EUR/USD";
  const instrumentType = spec.instrumentType ?? "forex";
  return {
    instrument, instrumentType, timeframe: "H4",
    tradingStyle: spec.style,
    marketData: makeMarket(instrument, instrumentType, 100),
    technicalData: techFrom(spec),
    economicEvents: spec.events,
    newsContext: spec.news,
    macroData: spec.macroData,
    sentimentData: spec.sentimentData,
    treasuryData: spec.treasuryData,
    cotData: spec.cotData,
    executionData: spec.executionData,
    calendarData: spec.calendarEvents,
  } as AnalysisInput;
}

/** Compact decision snapshot for benchmark reporting/assertions. */
export function capture(r: ReturnType<typeof import("./analysis-engine").runAnalysis>) {
  return {
    bias: r.bias,
    recommendation: r.recommendation,
    confidence: r.confidence,
    conviction: r.conviction,
    regime: r.marketRegime?.regime,
    setup: r.setupClassification?.setupClass,
    setupRationale: r.setupClassification?.rationale ?? "",
    contradictions: (r.keyContradictions ?? []).map((c) => `${c.severity}: ${c.description}`),
    noTradeReasons: r.noTradeReasons,
    hasPlan: r.tradePlan !== undefined,
    plan: r.tradePlan
      ? {
          direction: r.tradePlan.direction,
          entry: r.tradePlan.entry,
          sl: r.tradePlan.stopLoss,
          tp: r.tradePlan.takeProfit,
          rr: r.tradePlan.riskReward,
          tpBasis: r.tradePlan.tpBasis,
          slBasis: r.tradePlan.slBasis,
        }
      : undefined,
    breakdown: r.breakdown,
    style: r.tradingStyle,
    sizingAvailable: r.positionSizing?.available === true,
  };
}
export type Snapshot = ReturnType<typeof capture>;
