import type { SentimentData, FundamentalData, MacroData } from "@/lib/data/intelligence-types";
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import type { EconomicCalendarData } from "@/lib/data/calendar-types";

export type InstrumentType = "forex" | "crypto" | "stock" | "commodity" | "indices";

export type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1";

export type DirectionalBias = "Bullish" | "Bearish" | "Neutral";

export type FactorScore = -2 | -1 | 0 | 1 | 2;

/** Actionable recommendation. The engine may actively refuse to trade. */
export type Recommendation = "LONG" | "SHORT" | "NO_TRADE";

/** Qualitative conviction — reflects actual confluence strength, NOT accuracy.
 *  Only present when recommendation is LONG or SHORT. */
export type ConvictionLevel = "High" | "Medium" | "Low";

/** A trade plan whose every level is market-derived. Absent for NO_TRADE. */
export interface TradePlan {
  direction: "long" | "short";
  entry: string;
  entryBasis: string;
  stopLoss: string;
  /** Where the stop comes from — e.g. "nearest swing low (structural)" */
  slBasis: string;
  takeProfit: string;
  tpBasis: string;
  riskReward: number;
  // ── Phase 3A multi-timeframe context (present when MTF data exists) ──
  /** Direction of the highest available HTF, e.g. "D1 bullish external structure". */
  htfBias?: string;
  /** Timeframe whose structure produced the setup. */
  setupTimeframe?: string;
  /** Timeframe whose trigger refined the entry. */
  triggerTimeframe?: string;
  // ── Phase 292 — risk & trade-plan integrity ─────────────────────────────
  /**
   * What the entry reference actually IS. The published entry is a market
   * observation, not a filled order and not a confirmed trigger: this states the
   * reference price/time and the engine's setup verdict at that instant.
   */
  entryContext?: {
    /** Deterministic factual line: price, observation time, provider source. */
    reference: string;
    /** Phase 291 location of the price inside its own timeframe's zones. */
    location: string;
    /** Phase 291 setup-context state — omitted when no usable location exists. */
    setupState?: string;
    /** True only when the engine's own setup verdict is CONFIRMED_SETUP_CONTEXT. */
    triggerConfirmed: boolean;
    /** Deterministic digest of the above (engine wording, never decorative). */
    note: string;
  };
  /**
   * Where the PUBLISHED stop comes from, and the raw market-derived level it was
   * derived from. The published stop and the invalidation level are separately
   * named so a protective buffer can never hide the level that actually voids
   * the thesis.
   */
  stopProvenance?: {
    /** Which market object supplied the level. */
    source: "structural_invalidation" | "swing_level";
    /** The raw level: confirmed swing / market swing / user-observed level. */
    level: number;
    timeframe: string;
    /** Absolute protective buffer applied on top of `level` (0 = none). */
    buffer: number;
    /** The documented rule that produced the buffer, when one was applied. */
    bufferRule?: string;
    /** The exact stop that is published (level ± buffer). */
    publishedStop: number;
    /** Deterministic provenance line. */
    note: string;
  };
  /**
   * Where the published target comes from. Only resting liquidity (never a
   * swept or closed-through level) or a real opposing swing qualifies.
   */
  targetProvenance?: {
    source: "resting_liquidity" | "htf_resting_liquidity" | "structural_swing";
    level: number;
    timeframe: string;
    note: string;
  };
  /**
   * The confirmed Phase 290-A structural invalidation for THIS thesis, when the
   * engine published one on the correct side of entry. It is the level whose
   * confirmed breach voids the thesis — independent of the stop that was chosen.
   */
  structuralInvalidation?: {
    level: number;
    timeframe: string;
    swingKind: "high" | "low";
    note: string;
  };
  /**
   * Reward/risk measured to the RAW structural invalidation instead of the
   * published stop. Published only when it differs from `riskReward`, so the two
   * numbers can never be confused: `riskReward` always matches the published
   * entry / stopLoss / takeProfit.
   */
  structuralRiskReward?: number;
  /**
   * Phase 291 — the invalidation references the risk layer may consume, with
   * full provenance. The stop level itself is never chosen by how attractive the
   * reward/risk ratio looks: these are the levels the analysis actually
   * established (confirmed swing, validated zone boundary, swept/broken
   * liquidity). Empty when no such level exists — never invented.
   */
  invalidationReferences?: {
    source: string;
    level: number;
    timeframe: string;
    note: string;
  }[];
  /** Phase 291 — the invalidation boundary of the zone carrying the setup. */
  zoneInvalidation?: {
    kind: string;
    level: number;
    timeframe: string;
    basis: string;
  };
}

/** Higher-timeframe vs lower-timeframe relationship. */
export interface HtfAlignment {
  htfTimeframe: string;
  htfStructure: "HH/HL" | "LH/LL" | "range" | "unknown";
  state:
    | "aligned"
    | "counter_trend"
    | "htf_unknown"
    | "ltf_unclear";
}

/** Compact MTF summary surfaced on the result for UI transparency. */
export interface MtfSummary {
  alignment:
    | "ALIGNED_BULLISH"
    | "ALIGNED_BEARISH"
    | "MIXED"
    | "COUNTER_TREND"
    | "INSUFFICIENT_DATA";
  /** Timeframes actually used, highest first. */
  chainUsed: string[];
  /** Chain slots that could not be fetched — never synthesized. */
  unavailable: { timeframe: string; reason: string }[];
  /** Highest available HTF direction. */
  htfBias: "long" | "short" | "none";
  setupTimeframe: string;
  triggerTimeframe?: string;
}

/**
 * Phase 290-A — the confirmed structural evidence the decision actually used.
 * Deterministic facts only: which swing level broke, on which candle, in which
 * direction, where the invalidation sits and what the across-timeframe state is.
 * No scores, no probabilities, no decorative language.
 */
export interface StructuralEvidenceSummary {
  setupTimeframe: string;
  timeframes: {
    timeframe: string;
    role: string;
    direction: "bullish" | "bearish" | "none";
    evidenceState: string;
    regime: string;
    event?: {
      kind: "BOS" | "CHOCH";
      direction: "bullish" | "bearish";
      brokenLevel: number;
      candleIndex: number;
      candleTime: number;
    };
    invalidation?: {
      level: number;
      swingKind: "high" | "low";
      swingIndex: number;
      timestamp: number;
    };
    reason: string;
  }[];
  confluence?: {
    state: string;
    htfDirection: string;
    htfTimeframe?: string;
    setupDirection: string;
    triggerDirection: string;
    triggerPullback: boolean;
    detail: string;
  };
  /** Deterministic fact lines (engine style). */
  digest: string[];
}

/**
 * Phase 291 — TRADE LOCATION & SETUP CONTEXT.
 *
 * Plain deterministic facts: where the latest provider observation sits against
 * the REAL zone bounds, which liquidity event is current, and the setup-context
 * state that the evidence names. No scores, no probabilities, and every zone
 * belongs to the timeframe that produced it.
 */
export interface TradeLocationSummary {
  setupTimeframe: string;
  /** The observation the location was described against. */
  price: number;
  atTime: number;
  location: string;
  flags: {
    insideFvg: boolean;
    atFvgBoundary: boolean;
    insideOb: boolean;
    atObBoundary: boolean;
    nearLiquidity: boolean;
    afterSweep: boolean;
    displacedAway: boolean;
    outsideZones: boolean;
  };
  context: {
    state: string;
    direction: "bullish" | "bearish" | "none";
    reasons: string[];
  };
  /** The setup timeframe's own zones, nearest to price first. */
  zones: {
    kind: string;
    direction: "bullish" | "bearish";
    upper: number;
    lower: number;
    status: string;
    position: string;
    createdAtIndex: number;
    createdAt: number;
    knownAtIndex: number;
    ageCandles: number;
  }[];
  liquidity: {
    sweep?: {
      side: string;
      level: number;
      candleIndex: number;
      candleTime: number;
      ageCandles: number;
      poolFormedAtIndex: number;
    };
    nearestBuySide?: { level: number; distance: number };
    nearestSellSide?: { level: number; distance: number };
    atLiquidityLevel: boolean;
    afterSweep: boolean;
    brokenLevels: number[];
  };
  /**
   * Every available timeframe's OWN structure, zones and liquidity event — each
   * computed from that timeframe's candles, never copied up or down the chain.
   */
  timeframes: {
    timeframe: string;
    role: string;
    externalStructure: string;
    internalStructure: string;
    pairState: string;
    location: string;
    setupState: string;
    fvg?: { direction: string; lower: number; upper: number; status: string; position: string };
    ob?: { direction: string; lower: number; upper: number; status: string; position: string };
    sweep?: { side: string; level: number; candleIndex: number };
    /** This timeframe's own deterministic fact lines. */
    facts?: string[];
  }[];
  /** Levels the existing risk layer may consume, with their provenance. */
  invalidationEvidence: {
    source: string;
    level: number;
    timeframe: string;
    note: string;
  }[];
  /** The setup timeframe's own deterministic fact lines. */
  setupFacts: string[];
  /** Deterministic fact lines (engine style), setup timeframe first. */
  digest: string[];
}

export interface BiasBreakdown {
  trend: FactorScore;
  indicator: FactorScore;
  fundamental: FactorScore;
  sentiment: FactorScore;
}

export interface KeyLevels {
  support: string;
  resistance: string;
  invalidation: string;
}

export interface AnalysisInput {
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  /**
   * Phase 295 — the ONE instant this analysis claims to be made at.
   * Absent (or `LIVE_WALL_CLOCK`) = live transport: freshness uses the real wall
   * clock, exactly as before. A recorded replay supplies `HISTORICAL_AS_OF`
   * (the historical evaluation instant) or a deterministic test clock; an
   * unusable deterministic clock fails closed instead of using today's time.
   * Never a substitute for the provider's own candle/observation timestamps.
   */
  decisionClock?: import("@/lib/decision-clock").DecisionClock;
  /**
   * Provider that established the native identity (discovery). Routing only —
   * not market evidence. A forged value cannot invent prices; acquisition
   * still talks to the named provider with the named id.
   */
  provider?: string;
  /** Exact provider-native instrument id. Never a substituted symbol. */
  providerInstrumentId?: string;
  // Optional user-supplied data (fallback when auto-fetch is unavailable)
  currentPrice?: string;
  recentHigh?: string;
  recentLow?: string;
  newsContext?: string;
  economicEvents?: string;
  fundingRate?: string;
  openInterest?: string;
  // Auto-fetched market data (preferred over manual inputs)
  marketData?: import("@/lib/data/market-types").MarketData;
  technicalData?: import("@/lib/data/market-types").TechnicalData;
  // Secondary intelligence layer (Alpha Vantage)
  sentimentData?: SentimentData;
  fundamentalData?: FundamentalData;
  macroData?: MacroData;
  // Crypto derivatives layer (CoinGlass)
  derivativesData?: CryptoDerivativesData;
  // Economic calendar layer (Trading Economics)
  calendarData?: EconomicCalendarData;
  // ── Phase 7B-1: US Treasury yield / real-yield macro context ──
  // Pure typed model from src/lib/data/treasury.ts. Absent or
  // available:false is informational — NEVER a directional signal and
  // never a NO_TRADE reason on its own.
  treasuryData?: import("@/lib/data/treasury").TreasuryData;
  // ── Phase 7B-2: CFTC Commitments of Traders positioning ──
  // Weekly regulated-futures positioning with explicit contract mapping.
  // NEVER live/exchange/retail positioning; unavailable for unmappable
  // instruments (e.g. crypto spot) by design.
  cotData?: import("@/lib/data/cot").CotData;
  eiaData?: import("@/lib/data/eia").EiaData;
  executionData?: import("@/lib/execution-quality").ExecutionData;
  // ── Phase 7B-3: OKX public instrument metadata (risk/spec data ONLY) ──
  // Static contract metadata for position sizing. Never directional
  // evidence; never presented as live market data.
  okxSpecData?: import("@/lib/risk/okx-spec").OkxSpecData;
  // ── Phase 41: Crypto intelligence context (derivatives, DeFi fundamentals, tokenomics).
  // Informational only: does not modify bias, conviction, gates, trade plan, recommendation,
  // or actionability. Absent for non-crypto instruments.
  cryptoIntelligenceContext?: import("@/lib/data/crypto/types").CryptoIntelligenceContext;
  // ── Phase 44: Universal multi-asset intelligence context.
  // Informational only: does not modify bias, conviction, gates, trade plan, recommendation,
  // or actionability. Wraps asset-class-specific intelligence (forex, equity, commodity, cross-asset)
  // into a common interface for the analysis engine.
  universalIntelligenceContext?: import("@/lib/data/universal/types").UniversalIntelligenceContext;
  // ── Phase 3B: risk model inputs (all optional; sizing stays unavailable
  // unless every required piece is genuinely provided) ──
  /** Account equity in account currency, user-provided. */
  accountEquity?: number;
  /** Risk per trade as a fraction of equity (e.g. 0.01 = 1%). User-chosen. */
  riskPercent?: number;
  /** Provider/broker instrument specification. Sizing is impossible without it. */
  instrumentSpec?: import("@/lib/risk").InstrumentSpec;
  /** Explicit account currency (e.g. "USD", "EUR"). Never assumed.
   *  When omitted, sizing stays denominated in the quote currency. */
  accountCurrency?: string;
  /** Phase 6 — trading style. Changes decision HORIZON and opportunity
   *  requirements only — never market facts. Default: intraday. */
  tradingStyle?: import("@/lib/trading-style").TradingStyle;
  /** Original user-requested timeframe when a style fallback was applied. */
  requestedTimeframe?: string;
  /** Style/timeframe adaptation notes surfaced to the UI. */
  styleNotes?: string[];
  /** Live provider FX snapshots for quote→account conversion (Phase 4).
   *  direct = QUOTE/ACCOUNT pair, inverse = ACCOUNT/QUOTE pair. */
  fxRates?: {
    direct?: import("@/lib/risk").FxRateSnapshot;
    inverse?: import("@/lib/risk").FxRateSnapshot;
  };
}

export interface AnalysisResult {
  id: string;
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  /**
   * Provider that established the native identity (discovery). Optional for backward compat
   * with old persisted rows — Phase252/253/255 history additions remain safe.
   * Never fabricated for old records.
   */
  provider?: string;
  /** Exact provider-native instrument id. Never a substituted symbol. Optional for old rows. */
  providerInstrumentId?: string;
  bias: DirectionalBias;
  confidence: number; // 0-100 — evidence strength score
  /** Actionable decision — may be NO_TRADE even when bias is directional. */
  recommendation: Recommendation;
  /** Qualitative conviction; undefined for NO_TRADE (never forced into Low). */
  conviction?: ConvictionLevel;
  /** Explicit reasons why the setup was rejected. Empty for valid setups. */
  noTradeReasons: string[];
  /** Market-derived trade plan; ALWAYS undefined for NO_TRADE (state integrity). */
  tradePlan?: TradePlan;
  /** HTF vs LTF relationship used in the decision. */
  htfAlignment?: HtfAlignment;
  /** Adaptive multi-timeframe summary (Phase 3A) when MTF data exists. */
  mtfSummary?: MtfSummary;
  /** Phase 290-A — confirmed event-based structural evidence behind the decision. */
  structuralEvidence?: StructuralEvidenceSummary;
  /** Phase 291 — trade location, zone context and setup validity. */
  tradeLocation?: TradeLocationSummary;
  /** Phase 5 — multi-evidence market regime (UNKNOWN when evidence is thin). */
  marketRegime?: import("@/lib/market-context").MarketRegimeInfo;
  /** Phase 5 — explicit setup classification (context/evidence, not a UI label). */
  setupClassification?: import("@/lib/market-context").SetupClassificationInfo;
  /** Phase 5 — cross-layer contradictions with severity. */
  keyContradictions?: import("@/lib/market-context").ContradictionItem[];
  /** Phase 6 — the style actually applied (defaults to intraday). */
  tradingStyle: import("@/lib/trading-style").TradingStyle;
  /** Phase 6 — horizon transparency: TFs used per role + adaptation notes. */
  styleInfo?: {
    setupTimeframeUsed: string;
    requestedTimeframe?: string;
    fallbackApplied: boolean;
    notes: string[];
  };
  /** Position sizing — present ONLY for LONG/SHORT AND fully computable
   *  from real user inputs + a complete InstrumentSpec. Never fabricated. */
  positionSizing?: import("@/lib/risk").PositionSizingResult;
  /** Phase 11 — full explainability trace. Optional/additive: legacy records
   *  without it remain valid (backward compatibility, no destructive migration). */
  decisionTrace?: import("@/lib/decision-trace").DecisionTrace;
  /** Phase 11 — deterministic fingerprint of the decision-relevant state. */
  decisionFingerprint?: string;
  technicalSummary: string;
  fundamentalSummary: string;
  breakdown: BiasBreakdown;
  keyLevels: KeyLevels;
  riskNote: string;
  dataCompleteness: "full" | "partial" | "limited";
  dataFlags: string[];
  timestamp: number;
  // Market data metadata
  priceSnapshot?: import("@/lib/data/market-types").PriceSnapshot;
  technicalData?: import("@/lib/data/market-types").TechnicalData;
  dataSource?: string;
  // Intelligence layer metadata
  sentimentData?: SentimentData;
  fundamentalData?: FundamentalData;
  // Phase 276 — deterministic fundamental assessment derived from
  // `fundamentalData` alone (payload-only, no clock). An informational
  // section that sits ALONGSIDE technical evidence: it never overwrites
  // technical values, and technical values never masquerade as it.
  fundamentalAssessment?: import("@/lib/fundamental-engine").FundamentalAssessment;
  // Phase 312 — the structured factual reasoning chain (MARKET STRUCTURE →
  // … → LIMITATIONS), built from this result's own fields; every layer
  // without evidence says so explicitly.
  reasoningChain?: import("@/lib/strategy/explanation").ReasoningChain;
  /**
   * Phase 312 addendum — the coherent signal response (chart + adaptive plan +
   * position mechanics + probability status + invalidation + limitations),
   * built from the SAME finished result and OHLCV snapshot. Read-only,
   * non-scoring; absent when no candle evidence existed.
   */
  signal?: import("@/lib/strategy/signal").SignalResponse;
  // Phase 310 — the runtime's own per-provider acquisition provenance
  // (protectedAnalysis attaches these legs to every result since phase 288;
  // see LegDiagnostic). The type previously omitted the field the runtime
  // sets, which made the Dashboard unable to read provider state type-safely.
  providerDiagnostics?: import("@/lib/data/provenance-diagnostics").LegDiagnostic[];
  macroData?: MacroData;
  // Crypto derivatives metadata
  derivativesData?: CryptoDerivativesData;
  // Economic calendar metadata
  calendarData?: EconomicCalendarData;
  // Phase 7B-1: Treasury provenance — observation dates, freshness, actual yields.
  treasuryContext?: import("@/lib/data/treasury").TreasuryContext;
  // Phase 7B-2: COT provenance — source contract, report date, net/change, freshness.
  cotContext?: import("@/lib/data/cot").CotContext;
  eiaContext?: import("@/lib/data/eia").EiaContext;
  executionContext?: import("@/lib/execution-quality").ExecutionQuality;
  slippageEstimate?: import("@/lib/execution-quality").SlippageEstimate;
  executionWarnings?: string[];
  // Phase 25 — explicit data-quality transparency for analyst display.
  // Informational only: never modifies bias, conviction, or decision.
  dataQualityContext?: import("@/lib/data-quality").DataQualityContext;
  // Phase 26 — structured analyst thesis: purely derived presentation metadata.
  // Cannot modify recommendation, conviction, gates, trade plan, or sizing.
  analystThesis?: import("@/lib/analyst-thesis").AnalystThesis;
  // Phase 27 — continuation vs reversal scenario context.
  // Pure derivation: does not modify bias, conviction, gates, or trade plan.
  marketScenario?: import("@/lib/market-scenario").MarketScenarioContext;
  // Phase 28 — professional market regime + fundamental thesis.
  // Pure derivation: does not modify bias, conviction, gates, or trade plan.
  marketRegimeContext?: import("@/lib/market-regime").MarketRegimeContext;
  fundamentalThesis?: import("@/lib/fundamental-thesis").FundamentalThesis;
  professionalThesis?: import("@/lib/professional-thesis").ProfessionalThesis;
  // Phase 29 — forward market path: professional forward-looking scenario planning.
  // Pure derivation: does not modify bias, conviction, gates, or trade plan.
  forwardMarketPath?: import("@/lib/forward-market-path").ForwardMarketPathContext;
  // Phase 35 — long-horizon market & investment thesis.
  // Pure derivation: does not modify bias, conviction, gates, trade plan, or recommendation.
  longHorizonThesis?: import("@/lib/long-horizon-thesis").LongHorizonThesis;
  // Phase 36 — evidence & thesis challenge audit.
  // Informational only: does not modify bias, conviction, gates, trade plan, or recommendation.
  evidenceChallenge?: import("@/lib/evidence-challenge").EvidenceChallengeContext;
  // Phase 276 — unified technical + fundamental intelligence: ONE deterministic
  // layer derived from the finished results of BOTH engines. It rewrites
  // neither evidence set, states explicitly when a class is missing, and only
  // offers a combined conclusion when both classes genuinely supply evidence.
  // Informational only: modifies nothing in the decision.
  unifiedIntelligence?: import("@/lib/unified-intelligence").UnifiedIntelligence;
  // Phase 278 — the advanced (modern) technical evidence the decision used:
  // the rule outputs that supported or opposed the thesis, which real evidence
  // classes were present, and which microstructure metrics the configured
  // feeds genuinely do NOT supply. Informational: it never rewrites the
  // decision, and it is the SAME object the UI renders (no recomputation).
  advancedTechnicalEvidence?: {
    confluence: string[];
    conflicts: string[];
    evidenceClasses: string[];
    unavailableMetrics: { metric: string; reason: string }[];
  };
  // ── Phase 41: Crypto intelligence context.
  // Informational only: does not modify bias, conviction, gates, trade plan, recommendation,
  // or actionability. Absent for non-crypto instruments.
  cryptoIntelligenceContext?: import("@/lib/data/crypto/types").CryptoIntelligenceContext;
  // ── Phase 44: Universal multi-asset intelligence context.
  // Informational only: does not modify bias, conviction, gates, trade plan, recommendation,
  // or actionability. Wraps asset-class-specific intelligence into a common interface.
  universalIntelligenceContext?: import("@/lib/data/universal/types").UniversalIntelligenceContext;
}
