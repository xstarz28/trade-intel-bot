/**
 * Normalized market data types shared between Convex backend and frontend.
 * Every provider response is mapped into these types before reaching the
 * analysis engine.
 */

export interface OhlcvCandle {
  timestamp: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** The primary price snapshot with freshness metadata. */
export interface PriceSnapshot {
  price: number;
  timestamp: number; // Unix ms — when the price was last updated
  source: string; // e.g. "twelve-data"
  bid?: number;
  ask?: number;
}

/** Normalized market data returned by any provider. */
export interface MarketData {
  instrument: string; // Normalized symbol, e.g. "EUR/USD"
  instrumentType: "forex" | "crypto" | "stock" | "commodity" | "indices";
  provider: string;
  fetchTimestamp: number; // When this data was fetched
  price: PriceSnapshot;
  candles: OhlcvCandle[];
  timeframe: string;
  higherTimeframeCandles?: OhlcvCandle[]; // D1 for structural context
  higherTimeframe?: string;
  dataFreshness: "realtime" | "delayed" | "stale" | "unavailable";
  error?: string; // If something went partial
}

/** Structural summary of one timeframe, used for HTF/LTF comparison. */
export interface TimeframeStructureContext {
  timeframe: string;
  structure: "HH/HL" | "LH/LL" | "range" | "unknown";
  bosDirection: "bullish" | "bearish" | "none";
  chochDirection: "bullish" | "bearish" | "none";
  lastSwingHigh?: number;
  lastSwingLow?: number;
  dataPoints: number;
}

// ── Phase 2: liquidity / structure / confluence types ─────────────

export type LiquiditySide = "buy_side" | "sell_side";
export type LiquiditySource =
  | "equal_highs"
  | "equal_lows"
  | "swing_high"
  | "swing_low";

/** A resting liquidity pool detected from real swing/equal levels. */
export interface LiquidityPool {
  level: number;
  side: LiquiditySide; // buy_side = above price (stop of shorts), sell_side = below
  source: LiquiditySource;
  touches: number; // how many swings formed this level
  /** true = wick pierced and close returned (sweep). false = still resting. */
  swept: boolean;
  sweptAtIndex?: number;
  sweptAtTime?: number;
  /** true = price closed through the level (breakout, no longer liquidity). */
  broken: boolean;
}

export interface LiquiditySweepEvent {
  level: number;
  side: LiquiditySide;
  source: LiquiditySource;
  candleIndex: number;
  candleTime: number;
  timeframe: string;
}

/** Minor (internal) vs major (external) structural read. */
export interface InternalExternalStructure {
  external: TimeframeStructureContext;
  internal: TimeframeStructureContext;
  /** true when internal direction opposes external — early warning. */
  internalConflict: boolean;
}

export type FvgStatus = "fresh" | "mitigated" | "invalidated";

/** Three-candle Fair Value Gap from actual OHLC data. */
export interface FairValueGap {
  direction: "bullish" | "bearish";
  upper: number;
  lower: number;
  timeframe: string;
  createdAtIndex: number;
  createdAt: number;
  status: FvgStatus;
}

export interface DisplacementEvent {
  direction: "bullish" | "bearish";
  candleIndex: number;
  candleTime: number;
  bodyRatio: number; // body / range
  rangeAtrMultiple: number; // range / ATR14
}

export type ObStatus = "fresh" | "mitigated" | "invalidated";

/** Order Block validated by displacement + structural break evidence. */
export interface OrderBlock {
  direction: "bullish" | "bearish"; // bullish OB supports longs
  upper: number;
  lower: number;
  timeframe: string;
  createdAt: number;
  status: ObStatus;
  /** Traceable evidence for why this zone qualifies as an OB. */
  evidence: {
    precedingOpposingCandle: boolean;
    displacementAfter: boolean;
    structuralBreakAfter: boolean;
    displacementRangeAtr: number;
  };
}

export interface VwapBand {
  minus2: number;
  minus1: number;
  vwap: number;
  plus1: number;
  plus2: number;
}

export interface VwapContext {
  available: boolean;
  unavailableReason?: string;
  sessionVwap?: number;
  anchoredVwap?: { anchorTime: number; value: number };
  bands?: VwapBand; // volume-weighted deviation bands around session VWAP
  priceLocation: "above_vwap" | "below_vwap" | "at_vwap" | "unavailable";
}

export interface VolumeProfileContext {
  available: boolean;
  unavailableReason?: string;
  poc?: number;
  vah?: number;
  val?: number;
  hvn?: number[]; // high-volume node midpoints
  lvn?: number[]; // low-volume node midpoints
}

/** Everything Phase 2 derives from raw candles on one timeframe. */
export interface SmcContext {
  timeframe: string;
  liquidityPools: LiquidityPool[];
  recentSweep?: LiquiditySweepEvent;
  internalExternal: InternalExternalStructure;
  fvgs: FairValueGap[]; // most recent first
  displacement?: DisplacementEvent;
  orderBlocks: OrderBlock[]; // most recent first
  vwap: VwapContext;
  volumeProfile: VolumeProfileContext;
}

// ── Phase 3A: adaptive multi-timeframe architecture ───────────────

/** Role of a timeframe inside the top-down analysis hierarchy. */
export type TfRole = "macro" | "structure" | "setup" | "trigger";

/** One slot of the timeframe chain — available or explicitly not. */
export interface MtfTimeframeData {
  timeframe: string;
  role: TfRole;
  available: boolean;
  /** Why this timeframe is absent — provider failure, rate limit, etc. */
  unavailableReason?: string;
  /** Full Phase-2 SMC context for THIS timeframe (never copied from another). */
  smc?: SmcContext;
}

export type MtfAlignmentState =
  | "ALIGNED_BULLISH"
  | "ALIGNED_BEARISH"
  | "MIXED"
  | "COUNTER_TREND"
  | "INSUFFICIENT_DATA";

/** Adaptive multi-timeframe context — single source of truth for MTF state. */
export interface MtfContext {
  requestedTimeframe: string;
  /** Timeframes actually used (in analysis order, highest first). */
  chainUsed: string[];
  /** Requested-chain slots that could NOT be fetched — never synthesized. */
  unavailable: { timeframe: string; role: TfRole; reason: string }[];
  timeframes: MtfTimeframeData[];
  alignment: MtfAlignmentState;
  /** Dominant higher-timeframe direction. "none" when unknown. */
  htfBias: "long" | "short" | "none";
  /** Highest available HTF timeframe label. */
  htfTimeframe?: string;
  setupTimeframe: string;
  triggerTimeframe?: string;
  /** A genuine external BOS/CHoCH on a HTF — can legitimately flip context. */
  htfReversal?: {
    timeframe: string;
    direction: "bullish" | "bearish";
    kind: "bos" | "choch";
  };
}

/** Technical indicators derived from OHLCV data. */
export interface TechnicalData {
  // Moving averages
  sma50?: number;
  sma100?: number;
  sma200?: number;

  // RSI
  rsi14?: number;
  rsiDivergence?: "bullish" | "bearish" | "none";

  // MACD
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;

  // Market structure
  swingHighs: number[];
  swingLows: number[];
  structure: "HH/HL" | "LH/LL" | "range" | "unknown";
  bosDirection?: "bullish" | "bearish" | "none";
  chochDirection?: "bullish" | "bearish" | "none";

  // Support / Resistance from swing points
  supportLevels: number[];
  resistanceLevels: number[];

  // Fibonacci retracement from last major swing
  fibLevels?: {
    level236: number;
    level382: number;
    level500: number;
    level618: number;
    level786: number;
  };

  // Volume analysis
  avgVolume20?: number;
  volumeTrend: "increasing" | "decreasing" | "stable" | "unknown";

  // Volatility
  atr14?: number;
  dailyRange?: number; // High - Low of latest candle
  dataPoints: number; // How many candles were used

  // Higher-timeframe structural context (e.g. D1 when analyzing H4)
  htfContext?: TimeframeStructureContext;

  // Lower-timeframe trigger context (e.g. H1 when analyzing H4), if fetched
  ltfTrigger?: TimeframeStructureContext;

  // Timeframes in the HTF→primary→LTF chain that could not be fetched
  chainUnavailable?: string[];

  // Phase 2 liquidity/structure/confluence context (null-safe optional)
  smc?: SmcContext;

  // Phase 3A adaptive multi-timeframe context (null-safe optional).
  // When present it supersedes the legacy single-slot htfContext/ltfTrigger.
  mtf?: MtfContext;
}

/** What the Convex action returns. */
export interface MarketDataResult {
  success: boolean;
  data?: MarketData;
  technical?: TechnicalData;
  error?: string;
  errorCode?: "API_UNAVAILABLE" | "UNSUPPORTED_INSTRUMENT" | "INSUFFICIENT_DATA" | "RATE_LIMIT" | "AUTH_ERROR";
}
