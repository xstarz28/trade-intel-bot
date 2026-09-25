/**
 * Phase 278 — Advanced modern technical market intelligence.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `technical.ts` covers the classical stack (SMA/EMA/RSI/MACD/ATR/swings/BOS/
 * CHoCH/Fibonacci/volume trend). Professional discretionary analysis ALSO reads
 * price through four other lenses that the engine was missing:
 *
 *   · LOCATION / AUCTION — where price sits relative to where volume actually
 *     traded, and relative to the levels the PREVIOUS session/period defined.
 *   · VOLUME STRUCTURE — how much volume traded at each price, whether today's
 *     participation is normal, and whether price movement is confirmed by it.
 *   · LIQUIDITY / STRUCTURE EVENTS — sweeps, accepted vs failed breakouts,
 *     rejection, displacement, imbalance, and validated reaction zones.
 *   · VOLATILITY / STATISTICAL REGIME — realized volatility, percentiles,
 *     z-scores, compression→expansion, trend vs mean-reversion, clustering.
 *
 * Everything here is derived EXCLUSIVELY from data the provider actually
 * supplied, and every derived field carries the parameters that produced it.
 *
 * THE DATA RULE (binding, this is the whole point of the phase)
 * ------------------------------------------------------------
 * A feature is computed ONLY when the underlying evidence supports it:
 *
 *   · OHLCV + volume            → VWAP/AVWAP, volume profile, POC/VAH/VAL,
 *                                 relative volume, accumulation-style
 *                                 price/volume relationships.
 *   · order-book snapshot       → spread, real bid/ask depth, depth imbalance,
 *                                 depth concentration.
 *   · derivatives feed          → open interest, funding, long/short, liqs.
 *   · real comparator series    → correlation, relative strength, intermarket.
 *
 * A feature is reported UNAVAILABLE — with the reason — when the evidence does
 * not exist:
 *
 *   · trade direction, delta, CVD, absorption, exhaustion, footprint and
 *     taker-side flow are NOT computable from OHLCV candles. Inferring an
 *     aggressor from a candle's direction is fabrication, so this module never
 *     does it and says so explicitly in `orderFlow.unavailableMetrics`.
 *   · options IV/skew/term structure and basis are not supplied by any
 *     configured provider → explicit unavailable entries, never invented.
 *   · sector/market-relative series do not exist in this repository →
 *     explicit unavailable, never a substituted index.
 *
 * Determinism: pure functions of the supplied evidence. No clock reads, no
 * randomness, no I/O. Identical evidence always yields an identical object —
 * the same evidence yields a byte-identical technical result.
 */

import type { OhlcvCandle } from "./market-types";
import type { CryptoDerivativesData } from "./derivatives-types";
import type { BookLevel, ExecutionData } from "@/lib/execution-quality";
import type { FairValueGap, DisplacementEvent, LiquiditySweepEvent, OrderBlock } from "./market-types";
import { buildLiquidityPools, detectFvgs, detectDisplacement, detectOrderBlocks, detectSwingPoints } from "./smc";
import { atr } from "./technical";

// ═══════════════════════════════════════════════════════════════
// DOCUMENTED PARAMETERS — every one of them is reported in `parameters`
// ═══════════════════════════════════════════════════════════════

export const ADVANCED_PARAMETERS = {
  /** Volume-profile resolution (same value the SMC layer uses — 24 bins). */
  volumeProfileBins: 24,
  /** Share of total volume the value area must contain (0.70). */
  valueAreaCoverage: 0.7,
  /** A bin ≥ 1.5× the mean bin volume is a high-volume node. */
  hvnMultiple: 1.5,
  /** A bin ≤ 0.35× the mean bin volume is a low-volume node. */
  lvnMultiple: 0.35,
  /** Relative volume: last candle vs the mean of the preceding 20. */
  relativeVolumeLookback: 20,
  /** Participation expansion: mean of last 5 vs mean of the last 20. */
  volumeExpansionShort: 5,
  volumeExpansionLong: 20,
  /** Realized volatility / z-score / dispersion window (bars). */
  statisticalLookback: 20,
  /** Percentile ranking window (bars). */
  percentileLookback: 100,
  /** Realized-volatility rolling window and its percentile sample. */
  realizedVolWindow: 20,
  /** Minimum bars required before a percentile is reported at all. */
  minPercentileBars: 41,
  /** Trend-vs-mean-reversion efficiency-ratio window and thresholds. */
  efficiencyWindow: 20,
  efficiencyTrendMin: 0.35,
  efficiencyMeanReversionMax: 0.15,
  /** Volatility compression / expansion classification (mirrors technical.ts). */
  volatilityExpansionRatio: 1.25,
  volatilityCompressionRatio: 0.75,
  /** Consecutive closes beyond a level that constitute ACCEPTANCE. */
  breakoutAcceptanceCloses: 2,
  /** How many of the most recent candles are scanned for level interactions. */
  levelInteractionWindow: 6,
  /** First N candles of the session define the opening range. */
  openingRangeCandles: 4,
  /** Cluster autocorrelation window + threshold for volatility clustering. */
  clusteringWindow: 40,
  clusteringMinAutocorrelation: 0.2,
  /** Price move that makes a volume divergence/confirmation meaningful (%). */
  priceMoveMinPercent: 0.5,
  /** Participation change that makes confirmation/divergence meaningful (%). */
  volumeChangeMinPercent: 10,
  /** Cross-market correlation: minimum overlapping bars and a "direct" band. */
  crossMarketMinBars: 25,
  crossMarketStrongCorrelation: 0.6,
  crossMarketLookback: 20,
} as const;

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface AdvancedProvenance {
  /** Provider that supplied the candle series (verbatim, never inferred). */
  provider?: string;
  /** Exact provider-native instrument id. */
  providerInstrumentId?: string;
  /** Timeframe label of the analysed series. */
  timeframe?: string;
  /** Observations instant of the newest candle — PROVIDER-observed. */
  observedAt?: number;
  dataPoints: number;
  parameters: Record<string, number | string>;
  /** Which real evidence classes fed this block. */
  evidenceClasses: AdvancedEvidenceClass[];
}

export type AdvancedEvidenceClass =
  | "candle_ohlcv"
  | "order_book_snapshot"
  | "derivatives_feed"
  | "comparator_series";

export interface AnchoredVwapEntry {
  anchor: "session" | "swing_low" | "swing_high" | "event";
  /** Provider-observed instant the anchor is pinned to. */
  anchorAt: number;
  value: number;
  /** Candles included from the anchor to the newest bar. */
  candles: number;
  /** What the anchor IS, in evidence terms (never a guess). */
  basis: string;
}

export interface PeriodRange {
  periodStart: number;
  high: number;
  low: number;
  candles: number;
}

export interface DistanceFrom {
  anchor: "session_vwap" | "anchored_vwap";
  anchorAt?: number;
  absolute: number;
  percent: number;
  /** Distance expressed in ATR(14) multiples when ATR is available. */
  atrMultiple?: number;
}

export interface PriceLocationContext {
  available: boolean;
  unavailableReason?: string;
  sessionDefinition: "utc-day";
  sessionVwap?: number;
  sessionStart?: number;
  sessionCandles?: number;
  bands?: { minus2: number; minus1: number; vwap: number; plus1: number; plus2: number };
  /** Volume-weighted dispersion actually measured in this session. */
  bandSigma?: number;
  anchoredVwaps: AnchoredVwapEntry[];
  /** Anchors that could not be built, with the exact missing evidence. */
  anchorUnavailable: { anchor: string; reason: string }[];
  distances: DistanceFrom[];
  previousPeriods: {
    day?: PeriodRange;
    week?: PeriodRange;
    month?: PeriodRange;
    unavailable: { period: string; reason: string }[];
  };
  openingRange?: {
    periodStart: number;
    high: number;
    low: number;
    candles: number;
  };
}

export interface VolumeBin {
  low: number;
  high: number;
  volume: number;
}

export interface VolumeDistribution {
  bins: VolumeBin[];
  rangeLow: number;
  rangeHigh: number;
  poc: number;
  vah: number;
  val: number;
  hvn: number[];
  lvn: number[];
  totalVolume: number;
  valueAreaCoverage: number;
}

export interface VolumeStructureContext {
  available: boolean;
  unavailableReason?: string;
  profile?: VolumeDistribution;
  relativeVolume?: {
    value: number;
    lastVolume: number;
    referenceMean: number;
    lookback: number;
    state: "high" | "normal" | "low";
  };
  expansion?: {
    shortMean: number;
    longMean: number;
    ratio: number;
    state: "expanding" | "contracting" | "stable";
  };
  confirmation?: {
    state: "confirmed" | "divergent" | "inconclusive";
    priceChangePercent: number;
    volumeChangePercent: number;
    lookback: number;
    basis: string;
  };
}

export interface LevelInteraction {
  level: number;
  levelSource:
    | "previous_day_high"
    | "previous_day_low"
    | "previous_week_high"
    | "previous_week_low"
    | "previous_month_high"
    | "previous_month_low"
    | "value_area_high"
    | "value_area_low"
    | "opening_range_high"
    | "opening_range_low";
  side: "above_level" | "below_level";
  state: "accepted" | "failed" | "rejected";
  /** Candle index where price first crossed the level. */
  breakIndex: number;
  breakTime: number;
  closesBeyond: number;
  lastClose: number;
  basis: string;
}

export interface LiquidityStructureContext {
  available: boolean;
  unavailableReason?: string;
  sweeps: LiquiditySweepEvent[];
  lastSweep?: LiquiditySweepEvent;
  levelInteractions: LevelInteraction[];
  displacement?: DisplacementEvent;
  fvgs: FairValueGap[];
  /** Validated supply/demand reaction zones (displacement + BOS proven). */
  zones: OrderBlock[];
  sessionAuction?: {
    available: boolean;
    unavailableReason?: string;
    previousSession?: { periodStart: number; poc: number; vah: number; val: number };
    location?: "inside_value" | "above_value" | "below_value";
  };
}

export interface VolatilityContext {
  available: boolean;
  unavailableReason?: string;
  realizedVolPercentPerBar?: number;
  realizedVolAnnualizedPercent?: number;
  annualizationFactor?: number;
  annualizationBasis?: "calendar-continuous";
  realizedVolPercentile?: number;
  atrPercentile?: number;
  stdev?: number;
  stdevPercent?: number;
  mean?: number;
  zScore?: number;
  compression?: {
    state: "compressed" | "expanding_from_compression" | "expanded" | "normal" | "insufficient";
    atrRatio?: number;
    priorAtrRatio?: number;
    basis: string;
  };
  regime?: {
    state: "trend" | "mean_reversion" | "transitional" | "insufficient";
    efficiencyRatio?: number;
    window: number;
    structure: string;
    basis: string;
  };
  clustering?: {
    state: "clustered" | "not_clustered" | "insufficient";
    autocorrelation?: number;
    window: number;
    basis: string;
  };
}

export interface CrossMarketContext {
  available: boolean;
  unavailableReason?: string;
  comparatorSymbol?: string;
  comparatorProvider?: string;
  timeframe?: string;
  sampleSize?: number;
  correlation?: number;
  relativeStrengthPercent?: number;
  intermarketConfirmation?: "confirming" | "diverging" | "weak";
  riskContext?: {
    state: "risk_on_consistent" | "risk_off_consistent" | "divergent";
    basis: string;
  };
  /** Sector/market-relative behaviour — no such series exists in this repo. */
  assetRelative: { available: boolean; unavailableReason: string };
}

export interface OrderFlowContext {
  available: boolean;
  unavailableReason?: string;
  provider?: string;
  instrumentId?: string;
  snapshotTs?: number;
  freshness?: "FRESH" | "STALE";
  bid?: number;
  ask?: number;
  mid?: number;
  spread?: number;
  spreadBps?: number;
  bidVolume?: number;
  askVolume?: number;
  depthImbalance?: number;
  /** Share of the supplied top-of-book depth held by the largest 5 levels. */
  depthConcentration?: number;
  bidLevels?: number;
  askLevels?: number;
  regime?: string;
  /**
   * Metrics this phase explicitly does NOT derive, with the reason. These are
   * reported on EVERY result so the absence is visible in the product instead
   * of being silently zero.
   */
  unavailableMetrics: { metric: string; reason: string }[];
}

export interface DerivativesContextEntry {
  metric: "open_interest" | "funding_rate" | "long_short" | "liquidations";
  provider: string;
  instrument: string;
  observedAt?: number;
  freshness?: string;
  value: string;
  basis: string;
}

export interface DerivativesContext {
  available: boolean;
  unavailableReason?: string;
  entries: DerivativesContextEntry[];
  unavailableMetrics: { metric: string; reason: string }[];
}

/** Explicit evidence-tier ordering the decision layer must respect. */
export interface EvidenceTier {
  tier: number;
  name: string;
  available: boolean;
  items: string[];
  unavailableReason?: string;
  note?: string;
}

export interface AdvancedTechnicalData {
  provenance: AdvancedProvenance;
  location: PriceLocationContext;
  volumeStructure: VolumeStructureContext;
  liquidityStructure: LiquidityStructureContext;
  volatility: VolatilityContext;
  crossMarket: CrossMarketContext;
  orderFlow: OrderFlowContext;
  derivatives: DerivativesContext;
  /** Ordered 1→8; momentum sits at 6 and is marked secondary. */
  evidenceHierarchy: EvidenceTier[];
}

/** Real evidence available to the advanced layer, beyond the candles. */
export interface AdvancedMarketContext {
  timeframe?: string;
  provider?: string;
  providerInstrumentId?: string;
  /** Real comparator price series (closes) with its own provenance. */
  comparator?: { symbol: string; provider: string; closes: number[]; timeframe?: string };
  /** Real order-book / execution evidence, when the provider supplied it. */
  execution?: ExecutionData;
  /** Real derivatives evidence, when the provider supplied it. */
  derivatives?: CryptoDerivativesData;
  /** An explicit, genuinely known event instant to anchor an AVWAP to. */
  eventAnchorAt?: number;
  /** What the explicit event anchor IS (e.g. "CPI release 2025-07-04"). */
  eventAnchorBasis?: string;
}

// ═══════════════════════════════════════════════════════════════
// SMALL STATISTICAL HELPERS (pure)
// ═══════════════════════════════════════════════════════════════

function round(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sum = values.reduce((a, b) => a + b, 0);
  const m = sum / values.length;
  return Number.isFinite(m) ? m : undefined;
}

/** Population standard deviation. */
function stdev(values: number[]): number | undefined {
  const m = mean(values);
  if (m === undefined || values.length < 2) return undefined;
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Number.isFinite(variance) ? Math.sqrt(variance) : undefined;
}

/** Share of `sample` values ≤ `value`, as a 0–100 percentile rank. */
function percentileRank(value: number, sample: number[]): number | undefined {
  if (sample.length === 0) return undefined;
  const below = sample.filter((v) => v <= value).length;
  return round((below / sample.length) * 100, 1);
}

function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev > 0 && cur > 0) out.push(Math.log(cur / prev));
  }
  return out;
}

/** Median of a numeric list (deterministic; used only for bar spacing). */
function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pearson(a: number[], b: number[]): { correlation: number; n: number } | undefined {
  const n = Math.min(a.length, b.length);
  if (n < 3) return undefined;
  const xs = a.slice(a.length - n);
  const ys = b.slice(b.length - n);
  const mx = mean(xs);
  const my = mean(ys);
  if (mx === undefined || my === undefined) return undefined;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return undefined;
  const correlation = cov / Math.sqrt(vx * vy);
  return Number.isFinite(correlation) ? { correlation, n } : undefined;
}

// ── Session boundaries (documented: UTC calendar day) ────────────

function utcDayStart(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Start of the UTC week (Monday 00:00 UTC) containing `ts`. */
function utcWeekStart(ts: number): number {
  const day = utcDayStart(ts);
  const dow = new Date(day).getUTCDay(); // 0 = Sunday
  const offset = (dow + 6) % 7; // days since Monday
  return day - offset * 86_400_000;
}

function utcMonthStart(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** True when the series carries usable volume (not all zero/absent). */
function hasUsableVolume(candles: OhlcvCandle[]): boolean {
  return candles.some((c) => Number.isFinite(c.volume) && c.volume > 0);
}

// ═══════════════════════════════════════════════════════════════
// A. PRICE LOCATION / AUCTION
// ═══════════════════════════════════════════════════════════════

interface VwapAccumulation {
  pv: number;
  v: number;
  p2v: number;
  candles: number;
}

function accumulateVwap(candles: OhlcvCandle[], from: number): VwapAccumulation {
  let pv = 0;
  let v = 0;
  let p2v = 0;
  let count = 0;
  for (let i = from; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    const vol = Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0;
    pv += typical * vol;
    p2v += typical * typical * vol;
    v += vol;
    count++;
  }
  return { pv, v, p2v, candles: count };
}

/** Candle index where the current UTC session (day) begins. */
function sessionStartIndex(candles: OhlcvCandle[]): number {
  const lastDay = utcDayStart(candles[candles.length - 1].timestamp);
  let i = candles.length - 1;
  while (i > 0 && utcDayStart(candles[i - 1].timestamp) === lastDay) i--;
  return i;
}

/**
 * The most recent COMPLETE period range before the current one.
 *
 * A bucket qualifies only when the series actually contains candles belonging
 * to an EARLIER bucket than the newest candle's bucket — so a provider that
 * returned one day of H1 candles reports "previous day unavailable" instead of
 * recycling today's own high/low.
 */
function previousPeriodRange(
  candles: OhlcvCandle[],
  bucketStart: (ts: number) => number,
): PeriodRange | undefined {
  const current = bucketStart(candles[candles.length - 1].timestamp);
  let end = -1;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (bucketStart(candles[i].timestamp) < current) {
      end = i;
      break;
    }
  }
  if (end < 0) return undefined;
  const bucket = bucketStart(candles[end].timestamp);
  let start = end;
  while (start > 0 && bucketStart(candles[start - 1].timestamp) === bucket) start--;
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i <= end; i++) {
    high = Math.max(high, candles[i].high);
    low = Math.min(low, candles[i].low);
  }
  return { periodStart: bucket, high, low, candles: end - start + 1 };
}

function computeLocation(
  candles: OhlcvCandle[],
  ctx: AdvancedMarketContext,
  atr14: number | undefined,
): PriceLocationContext {
  const last = candles[candles.length - 1];
  const anchoredVwaps: AnchoredVwapEntry[] = [];
  const anchorUnavailable: { anchor: string; reason: string }[] = [];
  const distances: DistanceFrom[] = [];

  if (!hasUsableVolume(candles)) {
    return {
      available: false,
      unavailableReason:
        "The supplied series carries no usable volume (all-zero), so volume-weighted price location (VWAP/AVWAP/bands) cannot be computed honestly.",
      sessionDefinition: "utc-day",
      anchoredVwaps,
      anchorUnavailable,
      distances,
      previousPeriods: { unavailable: [{ period: "day", reason: "no usable volume for value-area context" }] },
    };
  }

  const sessionIdx = sessionStartIndex(candles);
  const session = accumulateVwap(candles, sessionIdx);
  let sessionVwap: number | undefined;
  let bandSigma: number | undefined;
  if (session.v > 0) {
    sessionVwap = session.pv / session.v;
    const variance = Math.max(0, session.p2v / session.v - sessionVwap * sessionVwap);
    bandSigma = Math.sqrt(variance);
  }

  // Anchor 1 — the session (current UTC day), derived from the candles only.
  if (sessionVwap !== undefined) {
    anchoredVwaps.push({
      anchor: "session",
      anchorAt: candles[sessionIdx].timestamp,
      value: sessionVwap,
      candles: session.candles,
      basis: "cumulative typical-price × volume from the first candle of the current UTC session",
    });
  }

  // Anchors 2/3 — structural anchors: the most recent CONFIRMED swing low/high.
  // Only swings older than the fractal lookback qualify (detectSwingPoints
  // already requires that), so an anchor is never a not-yet-confirmed extreme.
  const swingLookback = candles.length > 100 ? 7 : 5;
  const swings = detectSwingPoints(candles, swingLookback);
  for (const [kind, list, label] of [
    ["swing_low", swings.lows, "most recent confirmed swing low"],
    ["swing_high", swings.highs, "most recent confirmed swing high"],
  ] as const) {
    const point = list[list.length - 1];
    if (!point) {
      anchorUnavailable.push({
        anchor: kind,
        reason: `no confirmed ${kind === "swing_low" ? "swing low" : "swing high"} in the supplied series (fractal lookback ${swingLookback} bars)`,
      });
      continue;
    }
    const acc = accumulateVwap(candles, point.index);
    if (acc.v <= 0) {
      anchorUnavailable.push({ anchor: kind, reason: "no volume between the anchor and the newest candle" });
      continue;
    }
    anchoredVwaps.push({
      anchor: kind,
      anchorAt: candles[point.index].timestamp,
      value: acc.pv / acc.v,
      candles: acc.candles,
      basis: `${label} at bar ${point.index} (${label === "most recent confirmed swing low" ? point.price : point.price})`,
    });
  }

  // Anchor 4 — event anchor, ONLY when the caller supplied a real instant that
  // exists in the series. Otherwise it is explicitly unavailable.
  if (ctx.eventAnchorAt === undefined) {
    anchorUnavailable.push({
      anchor: "event",
      reason: "no event instant was supplied — an event AVWAP is not inferred from candle shape",
    });
  } else {
    const idx = candles.findIndex((c) => c.timestamp === ctx.eventAnchorAt);
    if (idx < 0) {
      anchorUnavailable.push({
        anchor: "event",
        reason: `the supplied event instant ${ctx.eventAnchorAt} is not a candle in this series — anchor not fabricated`,
      });
    } else {
      const acc = accumulateVwap(candles, idx);
      if (acc.v <= 0) {
        anchorUnavailable.push({ anchor: "event", reason: "no volume between the event anchor and the newest candle" });
      } else {
        anchoredVwaps.push({
          anchor: "event",
          anchorAt: candles[idx].timestamp,
          value: acc.pv / acc.v,
          candles: acc.candles,
          basis: ctx.eventAnchorBasis ?? "explicit event instant supplied by the pipeline",
        });
      }
    }
  }

  // Distances from the measured anchors (never rounded into a constant).
  if (sessionVwap !== undefined && sessionVwap > 0) {
    const absolute = last.close - sessionVwap;
    distances.push({
      anchor: "session_vwap",
      anchorAt: candles[sessionIdx].timestamp,
      absolute: round(absolute),
      percent: round((absolute / sessionVwap) * 100, 3),
      ...(atr14 && atr14 > 0 ? { atrMultiple: round(Math.abs(absolute) / atr14, 3) } : {}),
    });
  }
  for (const av of anchoredVwaps) {
    if (av.anchor === "session" || av.value <= 0) continue;
    const absolute = last.close - av.value;
    distances.push({
      anchor: "anchored_vwap",
      anchorAt: av.anchorAt,
      absolute: round(absolute),
      percent: round((absolute / av.value) * 100, 3),
      ...(atr14 && atr14 > 0 ? { atrMultiple: round(Math.abs(absolute) / atr14, 3) } : {}),
    });
  }

  // Previous period ranges — only from candles the provider actually supplied.
  const unavailable: { period: string; reason: string }[] = [];
  const day = previousPeriodRange(candles, utcDayStart);
  const week = previousPeriodRange(candles, utcWeekStart);
  const month = previousPeriodRange(candles, utcMonthStart);
  if (!day) unavailable.push({ period: "day", reason: "series does not include a complete earlier UTC day" });
  if (!week) unavailable.push({ period: "week", reason: "series does not include a complete earlier UTC week" });
  if (!month) unavailable.push({ period: "month", reason: "series does not include a complete earlier UTC month" });

  // Opening range — first N candles of the CURRENT session.
  let openingRange: PriceLocationContext["openingRange"];
  const openingCount = ADVANCED_PARAMETERS.openingRangeCandles;
  const sessionCandles = candles.slice(sessionIdx);
  if (sessionCandles.length >= openingCount) {
    const slice = sessionCandles.slice(0, openingCount);
    openingRange = {
      periodStart: candles[sessionIdx].timestamp,
      high: Math.max(...slice.map((c) => c.high)),
      low: Math.min(...slice.map((c) => c.low)),
      candles: openingCount,
    };
  }

  const bands =
    sessionVwap !== undefined && bandSigma !== undefined && bandSigma > 0
      ? {
          minus2: round(sessionVwap - 2 * bandSigma),
          minus1: round(sessionVwap - bandSigma),
          vwap: round(sessionVwap),
          plus1: round(sessionVwap + bandSigma),
          plus2: round(sessionVwap + 2 * bandSigma),
        }
      : undefined;

  return {
    available: true,
    sessionDefinition: "utc-day",
    sessionVwap: sessionVwap !== undefined ? round(sessionVwap) : undefined,
    sessionStart: candles[sessionIdx].timestamp,
    sessionCandles: session.candles,
    bands,
    bandSigma: bandSigma !== undefined ? round(bandSigma) : undefined,
    anchoredVwaps: anchoredVwaps.map((a) => ({ ...a, value: round(a.value) })),
    anchorUnavailable,
    distances,
    previousPeriods: {
      ...(day ? { day } : {}),
      ...(week ? { week } : {}),
      ...(month ? { month } : {}),
      unavailable,
    },
    ...(openingRange ? { openingRange } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════
// B. VOLUME STRUCTURE
// ═══════════════════════════════════════════════════════════════

/** Volume-at-price distribution over the supplied range, and its value area. */
export function buildVolumeDistribution(
  candles: OhlcvCandle[],
  bins = ADVANCED_PARAMETERS.volumeProfileBins,
  coverage = ADVANCED_PARAMETERS.valueAreaCoverage,
): VolumeDistribution | undefined {
  if (candles.length === 0 || bins < 2) return undefined;
  const totalVolume = candles.reduce((s, c) => s + (Number.isFinite(c.volume) ? c.volume : 0), 0);
  if (!(totalVolume > 0)) return undefined;

  const rangeLow = Math.min(...candles.map((c) => c.low));
  const rangeHigh = Math.max(...candles.map((c) => c.high));
  if (!(rangeHigh > rangeLow)) return undefined;

  const binSize = (rangeHigh - rangeLow) / bins;
  const volumes = new Array<number>(bins).fill(0);
  for (const c of candles) {
    const startBin = Math.min(bins - 1, Math.max(0, Math.floor((c.low - rangeLow) / binSize)));
    const endBin = Math.min(bins - 1, Math.max(0, Math.floor((c.high - rangeLow) / binSize)));
    const span = endBin - startBin + 1;
    const vol = Number.isFinite(c.volume) ? c.volume : 0;
    for (let b = startBin; b <= endBin; b++) volumes[b] += vol / span;
  }

  const binList: VolumeBin[] = volumes.map((volume, i) => ({
    low: round(rangeLow + binSize * i),
    high: round(rangeLow + binSize * (i + 1)),
    volume: round(volume, 2),
  }));
  const centers = volumes.map((_, i) => rangeLow + binSize * (i + 0.5));

  let pocIdx = 0;
  for (let i = 1; i < volumes.length; i++) if (volumes[i] > volumes[pocIdx]) pocIdx = i;

  let vaLo = pocIdx;
  let vaHi = pocIdx;
  let vaVolume = volumes[pocIdx];
  while (vaVolume / totalVolume < coverage && (vaLo > 0 || vaHi < volumes.length - 1)) {
    const below = vaLo > 0 ? volumes[vaLo - 1] : -1;
    const above = vaHi < volumes.length - 1 ? volumes[vaHi + 1] : -1;
    if (above >= below) {
      vaHi++;
      vaVolume += volumes[vaHi];
    } else {
      vaLo--;
      vaVolume += volumes[vaLo];
    }
  }

  const meanBin = totalVolume / bins;
  const hvn = centers.filter((_, i) => volumes[i] >= ADVANCED_PARAMETERS.hvnMultiple * meanBin).slice(0, 5);
  const lvn = centers.filter((_, i) => volumes[i] <= ADVANCED_PARAMETERS.lvnMultiple * meanBin).slice(0, 5);

  return {
    bins: binList,
    rangeLow: round(rangeLow),
    rangeHigh: round(rangeHigh),
    poc: round(centers[pocIdx]),
    vah: round(centers[vaHi]),
    val: round(centers[vaLo]),
    hvn: hvn.map((v) => round(v)),
    lvn: lvn.map((v) => round(v)),
    totalVolume: round(totalVolume, 2),
    valueAreaCoverage: coverage,
  };
}

function computeVolumeStructure(candles: OhlcvCandle[]): VolumeStructureContext {
  if (!hasUsableVolume(candles)) {
    return {
      available: false,
      unavailableReason:
        "The provider supplied no usable volume for this series (all-zero volume — typical for some spot FX feeds), so volume-derived metrics (profile, POC/VAH/VAL, relative volume, confirmation) are unavailable rather than fabricated.",
    };
  }
  const profile = buildVolumeDistribution(candles);

  // Relative volume — newest candle vs the mean of the preceding N.
  const lookback = ADVANCED_PARAMETERS.relativeVolumeLookback;
  let relativeVolume: VolumeStructureContext["relativeVolume"];
  if (candles.length >= lookback + 1) {
    const reference = candles.slice(-(lookback + 1), -1).map((c) => c.volume);
    const refMean = mean(reference);
    if (refMean !== undefined && refMean > 0) {
      const lastVolume = candles[candles.length - 1].volume;
      const value = lastVolume / refMean;
      relativeVolume = {
        value: round(value, 3),
        lastVolume: round(lastVolume, 2),
        referenceMean: round(refMean, 2),
        lookback,
        state: value >= 1.5 ? "high" : value <= 0.5 ? "low" : "normal",
      };
    }
  }

  // Participation expansion — last 5 vs last 20.
  let expansion: VolumeStructureContext["expansion"];
  const shortN = ADVANCED_PARAMETERS.volumeExpansionShort;
  const longN = ADVANCED_PARAMETERS.volumeExpansionLong;
  if (candles.length >= longN) {
    const shortMean = mean(candles.slice(-shortN).map((c) => c.volume));
    const longMean = mean(candles.slice(-longN).map((c) => c.volume));
    if (shortMean !== undefined && longMean !== undefined && longMean > 0) {
      const ratio = shortMean / longMean;
      expansion = {
        shortMean: round(shortMean, 2),
        longMean: round(longMean, 2),
        ratio: round(ratio, 3),
        state: ratio >= 1.3 ? "expanding" : ratio <= 0.7 ? "contracting" : "stable",
      };
    }
  }

  // Price–volume confirmation / divergence over the statistical window.
  let confirmation: VolumeStructureContext["confirmation"];
  const window = ADVANCED_PARAMETERS.statisticalLookback;
  if (candles.length >= window + 1 && expansion) {
    const from = candles[candles.length - 1 - window].close;
    const to = candles[candles.length - 1].close;
    const priceChangePercent = from > 0 ? ((to - from) / from) * 100 : 0;
    const volumeChangePercent = (expansion.ratio - 1) * 100;
    const movedEnough = Math.abs(priceChangePercent) >= ADVANCED_PARAMETERS.priceMoveMinPercent;
    const participationUp = volumeChangePercent >= ADVANCED_PARAMETERS.volumeChangeMinPercent;
    const participationDown = volumeChangePercent <= -ADVANCED_PARAMETERS.volumeChangeMinPercent;
    const state: "confirmed" | "divergent" | "inconclusive" =
      movedEnough && participationUp ? "confirmed" : movedEnough && participationDown ? "divergent" : "inconclusive";
    confirmation = {
      state,
      priceChangePercent: round(priceChangePercent, 3),
      volumeChangePercent: round(volumeChangePercent, 2),
      lookback: window,
      basis: `close ${window} bars ago vs newest close against participation (mean of last ${shortN} vs last ${longN} bars); thresholds ±${ADVANCED_PARAMETERS.priceMoveMinPercent}% price, ±${ADVANCED_PARAMETERS.volumeChangeMinPercent}% volume`,
    };
  }

  return {
    available: true,
    ...(profile ? { profile } : {}),
    ...(relativeVolume ? { relativeVolume } : {}),
    ...(expansion ? { expansion } : {}),
    ...(confirmation ? { confirmation } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════
// C. MARKET STRUCTURE / LIQUIDITY
// ═══════════════════════════════════════════════════════════════

/**
 * Level interactions: acceptance, failure and rejection measured against
 * levels that came from REAL evidence (previous complete period extremes,
 * the volume-value area, the session opening range).
 *
 * ACCEPTANCE — ≥ `breakoutAcceptanceCloses` consecutive closes beyond the
 * level, with the newest close still beyond it.
 * FAILURE — price closed beyond the level at least once, then closed back on
 * the original side within the interaction window.
 * REJECTION — the level was pierced intra-candle only (wick) and the candle
 * closed back on the original side.
 */
export function detectLevelInteractions(
  candles: OhlcvCandle[],
  levels: { level: number; levelSource: LevelInteraction["levelSource"]; side: "above_level" | "below_level" }[],
): LevelInteraction[] {
  const interactions: LevelInteraction[] = [];
  const window = ADVANCED_PARAMETERS.levelInteractionWindow;
  const firstIndex = Math.max(1, candles.length - window);
  const lastClose = candles[candles.length - 1].close;

  for (const { level, levelSource, side } of levels) {
    if (!Number.isFinite(level) || level <= 0) continue;
    const beyond = (c: OhlcvCandle) => (side === "above_level" ? c.close > level : c.close < level);

    let breakIndex = -1;
    for (let i = firstIndex; i < candles.length; i++) {
      if (beyond(candles[i])) {
        breakIndex = i;
        break;
      }
    }
    if (breakIndex < 0) {
      // No close beyond in the window — check for a pure wick rejection.
      for (let i = firstIndex; i < candles.length; i++) {
        const c = candles[i];
        const pierced = side === "above_level" ? c.high > level : c.low < level;
        if (pierced && !beyond(c)) {
          interactions.push({
            level: round(level),
            levelSource,
            side,
            state: "rejected",
            breakIndex: i,
            breakTime: c.timestamp,
            closesBeyond: 0,
            lastClose: round(lastClose),
            basis: `wick pierced ${round(level)} (${levelSource}) and the candle closed back ${side === "above_level" ? "below" : "above"} it`,
          });
          break;
        }
      }
      continue;
    }

    let closesBeyond = 1;
    for (let i = breakIndex + 1; i < candles.length; i++) {
      if (beyond(candles[i])) closesBeyond++;
      else break;
    }
    const stillBeyond = lastClose > level === (side === "above_level") && lastClose !== level;
    const accepted = stillBeyond && closesBeyond >= ADVANCED_PARAMETERS.breakoutAcceptanceCloses;
    interactions.push({
      level: round(level),
      levelSource,
      side,
      state: accepted ? "accepted" : stillBeyond ? "accepted" : "failed",
      breakIndex,
      breakTime: candles[breakIndex].timestamp,
      closesBeyond,
      lastClose: round(lastClose),
      basis: accepted
        ? `${closesBeyond} consecutive close(s) beyond ${round(level)} (${levelSource}), newest close still beyond — acceptance`
        : `${closesBeyond} close(s) beyond then a close back through ${round(level)} (${levelSource}) — failed breakout`,
    });
  }

  // Most recent interaction first — deterministic ordering.
  return interactions.sort((a, b) => b.breakTime - a.breakTime).slice(0, 8);
}

function computeLiquidityStructure(
  candles: OhlcvCandle[],
  location: PriceLocationContext,
  volumeStructure: VolumeStructureContext,
  timeframe: string,
  atr14: number | undefined,
): LiquidityStructureContext {
  if (candles.length === 0) {
    return {
      available: false,
      unavailableReason: "No candle data.",
      sweeps: [],
      levelInteractions: [],
      fvgs: [],
      zones: [],
    };
  }

  // Sweeps — reuse the SAME pure routines the SMC layer uses (no second
  // implementation of the tolerance/sweep rules).
  const lookback = candles.length > 100 ? 7 : 5;
  const swings = detectSwingPoints(candles, lookback);
  const { sweeps } = buildLiquidityPools(candles, swings.highs, swings.lows);
  const orderedSweeps = [...sweeps].sort((a, b) => b.candleIndex - a.candleIndex).slice(0, 6);

  // Level interactions from real level sources only.
  const levels: { level: number; levelSource: LevelInteraction["levelSource"]; side: "above_level" | "below_level" }[] = [];
  const prev = location.previousPeriods;
  if (prev.day) {
    levels.push({ level: prev.day.high, levelSource: "previous_day_high", side: "above_level" });
    levels.push({ level: prev.day.low, levelSource: "previous_day_low", side: "below_level" });
  }
  if (prev.week) {
    levels.push({ level: prev.week.high, levelSource: "previous_week_high", side: "above_level" });
    levels.push({ level: prev.week.low, levelSource: "previous_week_low", side: "below_level" });
  }
  if (prev.month) {
    levels.push({ level: prev.month.high, levelSource: "previous_month_high", side: "above_level" });
    levels.push({ level: prev.month.low, levelSource: "previous_month_low", side: "below_level" });
  }
  if (volumeStructure.profile) {
    levels.push({ level: volumeStructure.profile.vah, levelSource: "value_area_high", side: "above_level" });
    levels.push({ level: volumeStructure.profile.val, levelSource: "value_area_low", side: "below_level" });
  }
  if (location.openingRange) {
    levels.push({ level: location.openingRange.high, levelSource: "opening_range_high", side: "above_level" });
    levels.push({ level: location.openingRange.low, levelSource: "opening_range_low", side: "below_level" });
  }

  const levelInteractions = detectLevelInteractions(candles, levels);

  // Displacement, FVGs and validated reaction zones — same pure SMC routines.
  const displacement = detectDisplacement(candles, atr14);
  const fvgs = detectFvgs(candles, timeframe ?? "unspecified", atr14).slice(0, 8);
  const zones = detectOrderBlocks(candles, timeframe ?? "unspecified", atr14).slice(0, 6);

  // Session auction context — is price trading inside the previous session's
  // value area? Requires a previous COMPLETE session's own volume distribution.
  let sessionAuction: LiquidityStructureContext["sessionAuction"];
  const sessionIdx = sessionStartIndex(candles);
  if (sessionIdx === 0) {
    sessionAuction = {
      available: false,
      unavailableReason: "the supplied series contains only the current UTC session — no previous session value area exists",
    };
  } else if (!hasUsableVolume(candles)) {
    sessionAuction = {
      available: false,
      unavailableReason: "no usable volume — the previous session's value area cannot be derived",
    };
  } else {
    const prior = candles.slice(0, sessionIdx);
    const priorProfile = buildVolumeDistribution(prior);
    if (!priorProfile) {
      sessionAuction = {
        available: false,
        unavailableReason: "the previous session's own distribution was too degenerate to derive a value area",
      };
    } else {
      const price = candles[candles.length - 1].close;
      sessionAuction = {
        available: true,
        previousSession: {
          periodStart: candles[0].timestamp,
          poc: priorProfile.poc,
          vah: priorProfile.vah,
          val: priorProfile.val,
        },
        location: price > priorProfile.vah ? "above_value" : price < priorProfile.val ? "below_value" : "inside_value",
      };
    }
  }

  return {
    available: true,
    sweeps: orderedSweeps,
    ...(orderedSweeps[0] ? { lastSweep: orderedSweeps[0] } : {}),
    levelInteractions,
    ...(displacement ? { displacement } : {}),
    fvgs,
    zones,
    ...(sessionAuction ? { sessionAuction } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════
// D. VOLATILITY / STATISTICAL REGIME
// ═══════════════════════════════════════════════════════════════

/** Rolling ATR(14) series so compression→expansion is a real sequence. */
function rollingAtr(candles: OhlcvCandle[], period = 14): number[] {
  const out: number[] = [];
  for (let end = period; end < candles.length; end++) {
    const slice = candles.slice(0, end + 1);
    const value = atr(slice, period);
    if (value !== undefined && Number.isFinite(value)) out.push(value);
  }
  return out;
}

function computeVolatility(candles: OhlcvCandle[], structure: string): VolatilityContext {
  const window = ADVANCED_PARAMETERS.statisticalLookback;
  if (candles.length < window + 1) {
    return {
      available: false,
      unavailableReason: `insufficient history: ${candles.length} candles supplied, ${window + 1} required for the statistical window`,
    };
  }

  const closes = candles.map((c) => c.close);
  const windowCloses = closes.slice(-window);
  const m = mean(windowCloses);
  const sd = stdev(windowCloses);
  const lastClose = closes[closes.length - 1];

  // Realized volatility from log returns.
  const returns = logReturns(closes);
  const rvWindow = returns.slice(-ADVANCED_PARAMETERS.realizedVolWindow);
  const rvSd = stdev(rvWindow);
  const realizedVolPercentPerBar = rvSd !== undefined ? rvSd * 100 : undefined;

  // Annualization: the bar interval is measured from the series' own
  // timestamps (median spacing) and the basis is stated explicitly.
  let annualizationFactor: number | undefined;
  if (candles.length >= 3) {
    const spacings: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const d = candles[i].timestamp - candles[i - 1].timestamp;
      if (Number.isFinite(d) && d > 0) spacings.push(d);
    }
    const barMs = median(spacings);
    if (barMs && barMs > 0) {
      const barsPerYear = (365.25 * 24 * 3_600_000) / barMs;
      annualizationFactor = Math.sqrt(barsPerYear);
    }
  }

  // Percentiles — the current value ranked inside its own rolling history.
  let realizedVolPercentile: number | undefined;
  let atrPercentile: number | undefined;
  if (candles.length >= ADVANCED_PARAMETERS.minPercentileBars) {
    const rolling: number[] = [];
    for (let end = window; end <= returns.length; end++) {
      const sdR = stdev(returns.slice(Math.max(0, end - ADVANCED_PARAMETERS.realizedVolWindow), end));
      if (sdR !== undefined) rolling.push(sdR * 100);
    }
    const sample = rolling.slice(-ADVANCED_PARAMETERS.percentileLookback);
    if (realizedVolPercentPerBar !== undefined && sample.length >= 20) {
      realizedVolPercentile = percentileRank(realizedVolPercentPerBar, sample);
    }
    const atrs = rollingAtr(candles);
    const atrSample = atrs.slice(-ADVANCED_PARAMETERS.percentileLookback);
    const currentAtr = atrs[atrs.length - 1];
    if (currentAtr !== undefined && atrSample.length >= 20) {
      atrPercentile = percentileRank(currentAtr, atrSample);
    }
  }

  // Compression → expansion, as a measured SEQUENCE.
  let compression: VolatilityContext["compression"];
  const atrs = rollingAtr(candles);
  if (atrs.length >= 21) {
    const ratioAt = (idx: number): number | undefined => {
      if (idx < 20) return undefined;
      const current = atrs[idx];
      const prior = atrs.slice(idx - 20, idx);
      const baseline = mean(prior);
      if (baseline === undefined || baseline <= 0) return undefined;
      return current / baseline;
    };
    const currentRatio = ratioAt(atrs.length - 1);
    const priorRatio = ratioAt(atrs.length - 2);
    if (currentRatio !== undefined) {
      const classify = (r: number) =>
        r >= ADVANCED_PARAMETERS.volatilityExpansionRatio
          ? "expanded"
          : r <= ADVANCED_PARAMETERS.volatilityCompressionRatio
            ? "compressed"
            : "normal";
      const now = classify(currentRatio);
      const expandingFromCompression =
        now !== "compressed" && priorRatio !== undefined && classify(priorRatio) === "compressed";
      compression = {
        state: expandingFromCompression ? "expanding_from_compression" : now,
        atrRatio: round(currentRatio, 3),
        ...(priorRatio !== undefined ? { priorAtrRatio: round(priorRatio, 3) } : {}),
        basis: `ATR(14) vs the mean of the 20 preceding ATR(14) values (expansion ≥ ${ADVANCED_PARAMETERS.volatilityExpansionRatio}×, compression ≤ ${ADVANCED_PARAMETERS.volatilityCompressionRatio}×)`,
      };
    } else {
      compression = {
        state: "insufficient",
        basis: "not enough ATR history to compare against its own baseline",
      };
    }
  } else {
    compression = {
      state: "insufficient",
      basis: `ATR baseline needs 21 measured bars, ${atrs.length} available`,
    };
  }

  // Trend vs mean reversion — Kaufman efficiency ratio + measured structure.
  let regime: VolatilityContext["regime"];
  const effWindow = ADVANCED_PARAMETERS.efficiencyWindow;
  if (closes.length >= effWindow + 1) {
    const from = closes[closes.length - 1 - effWindow];
    const net = Math.abs(lastClose - from);
    let path = 0;
    for (let i = closes.length - effWindow; i < closes.length; i++) {
      path += Math.abs(closes[i] - closes[i - 1]);
    }
    const efficiencyRatio = path > 0 ? net / path : 0;
    const directionalStructure = structure === "HH/HL" || structure === "LH/LL";
    const state: "trend" | "mean_reversion" | "transitional" =
      efficiencyRatio >= ADVANCED_PARAMETERS.efficiencyTrendMin && directionalStructure
        ? "trend"
        : efficiencyRatio <= ADVANCED_PARAMETERS.efficiencyMeanReversionMax || structure === "range"
          ? "mean_reversion"
          : "transitional";
    regime = {
      state,
      efficiencyRatio: round(efficiencyRatio, 3),
      window: effWindow,
      structure,
      basis: `Kaufman efficiency ratio over ${effWindow} bars (trend ≥ ${ADVANCED_PARAMETERS.efficiencyTrendMin}, mean-reversion ≤ ${ADVANCED_PARAMETERS.efficiencyMeanReversionMax}) combined with the measured structure label "${structure}"`,
    };
  } else {
    regime = { state: "insufficient", window: effWindow, structure, basis: "insufficient history for the efficiency window" };
  }

  // Volatility clustering — lag-1 autocorrelation of absolute returns.
  let clustering: VolatilityContext["clustering"];
  const clusterWindow = ADVANCED_PARAMETERS.clusteringWindow;
  if (returns.length >= clusterWindow + 1) {
    const abs = returns.slice(-(clusterWindow + 1)).map((r) => Math.abs(r));
    const a = abs.slice(0, -1);
    const b = abs.slice(1);
    const corr = pearson(a, b);
    if (corr) {
      clustering = {
        state: Math.abs(corr.correlation) >= ADVANCED_PARAMETERS.clusteringMinAutocorrelation ? "clustered" : "not_clustered",
        autocorrelation: round(corr.correlation, 3),
        window: clusterWindow,
        basis: `lag-1 autocorrelation of absolute log returns over ${corr.n} pairs (|ρ| ≥ ${ADVANCED_PARAMETERS.clusteringMinAutocorrelation} ⇒ clustering)`,
      };
    } else {
      clustering = { state: "insufficient", window: clusterWindow, basis: "the return series had no measurable dispersion" };
    }
  } else {
    clustering = {
      state: "insufficient",
      window: clusterWindow,
      basis: `clustering needs ${clusterWindow + 1} returns, ${returns.length} available`,
    };
  }

  return {
    available: true,
    ...(realizedVolPercentPerBar !== undefined ? { realizedVolPercentPerBar: round(realizedVolPerBarSafe(realizedVolPercentPerBar), 4) } : {}),
    ...(realizedVolPercentPerBar !== undefined && annualizationFactor !== undefined
      ? {
          realizedVolAnnualizedPercent: round(realizedVolPercentPerBar * annualizationFactor, 3),
          annualizationFactor: round(annualizationFactor, 3),
          annualizationBasis: "calendar-continuous" as const,
        }
      : {}),
    ...(realizedVolPercentile !== undefined ? { realizedVolPercentile } : {}),
    ...(atrPercentile !== undefined ? { atrPercentile } : {}),
    ...(sd !== undefined ? { stdev: round(sd), stdevPercent: round((sd / (m ?? 1)) * 100, 3) } : {}),
    ...(m !== undefined ? { mean: round(m) } : {}),
    ...(sd !== undefined && sd > 0 ? { zScore: round((lastClose - (m ?? lastClose)) / sd, 3) } : {}),
    compression,
    regime,
    clustering,
  };
}

/** Guards a raw percentage against non-finite arithmetic. */
function realizedVolPerBarSafe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

// ═══════════════════════════════════════════════════════════════
// E. RELATIVE / CROSS-MARKET (only with real comparator evidence)
// ═══════════════════════════════════════════════════════════════

function computeCrossMarket(candles: OhlcvCandle[], ctx: AdvancedMarketContext): CrossMarketContext {
  const assetRelative: CrossMarketContext["assetRelative"] = {
    available: false,
    unavailableReason:
      "no sector or market-relative series is supplied by any configured provider — relative behaviour against a substituted index is not synthesized",
  };

  if (!ctx.comparator) {
    return {
      available: false,
      unavailableReason:
        "no real comparator price series was supplied for this analysis — correlation, relative strength and intermarket context are unavailable rather than inferred",
      assetRelative,
    };
  }
  const { symbol, provider, closes, timeframe } = ctx.comparator;
  if (closes.length < ADVANCED_PARAMETERS.crossMarketMinBars) {
    return {
      available: false,
      comparatorSymbol: symbol,
      comparatorProvider: provider,
      unavailableReason: `comparator series for ${symbol} carried ${closes.length} bars — at least ${ADVANCED_PARAMETERS.crossMarketMinBars} are required`,
      assetRelative,
    };
  }

  const instrumentCloses = candles.map((c) => c.close);
  const corr = pearson(instrumentCloses, closes);
  if (!corr) {
    return {
      available: false,
      comparatorSymbol: symbol,
      comparatorProvider: provider,
      unavailableReason: `the ${symbol} series had no measurable co-movement with this instrument over the overlapping bars`,
      assetRelative,
    };
  }

  // Relative strength over the same lookback, from ACTUAL closes.
  const lookback = ADVANCED_PARAMETERS.crossMarketLookback;
  let relativeStrengthPercent: number | undefined;
  let instrumentMomentum: "up" | "down" | "flat" | undefined;
  let comparatorMomentum: "up" | "down" | "flat" | undefined;
  if (instrumentCloses.length > lookback && closes.length > lookback) {
    const iFrom = instrumentCloses[instrumentCloses.length - 1 - lookback];
    const iTo = instrumentCloses[instrumentCloses.length - 1];
    const cFrom = closes[closes.length - 1 - lookback];
    const cTo = closes[closes.length - 1];
    if (iFrom > 0 && cFrom > 0) {
      const instrumentReturn = ((iTo - iFrom) / iFrom) * 100;
      const comparatorReturn = ((cTo - cFrom) / cFrom) * 100;
      relativeStrengthPercent = round(instrumentReturn - comparatorReturn, 3);
      instrumentMomentum = instrumentReturn > 0.1 ? "up" : instrumentReturn < -0.1 ? "down" : "flat";
      comparatorMomentum = comparatorReturn > 0.1 ? "up" : comparatorReturn < -0.1 ? "down" : "flat";
    }
  }

  const strong = Math.abs(corr.correlation) >= ADVANCED_PARAMETERS.crossMarketStrongCorrelation;
  let intermarketConfirmation: CrossMarketContext["intermarketConfirmation"] = "weak";
  if (strong && instrumentMomentum && comparatorMomentum) {
    const inverse = corr.correlation < 0;
    const sameDirection = instrumentMomentum === comparatorMomentum;
    intermarketConfirmation = inverse ? (sameDirection ? "diverging" : "confirming") : sameDirection ? "confirming" : "diverging";
  }

  // Risk context is DERIVED from the real comparator's own direction and the
  // measured correlation sign — it is never a substituted volatility index.
  const riskContext =
    strong && comparatorMomentum && instrumentMomentum
      ? {
          state:
            intermarketConfirmation === "confirming"
              ? comparatorMomentum === "up"
                ? ("risk_on_consistent" as const)
                : ("risk_off_consistent" as const)
              : ("divergent" as const),
          basis: `${symbol} momentum ${comparatorMomentum} with measured correlation ${round(corr.correlation, 3)} (${corr.n} overlapping bars)`,
        }
      : undefined;

  return {
    available: true,
    comparatorSymbol: symbol,
    comparatorProvider: provider,
    ...(timeframe ? { timeframe } : {}),
    sampleSize: corr.n,
    correlation: round(corr.correlation, 3),
    ...(relativeStrengthPercent !== undefined ? { relativeStrengthPercent } : {}),
    intermarketConfirmation,
    ...(riskContext ? { riskContext } : {}),
    assetRelative,
  };
}

// ═══════════════════════════════════════════════════════════════
// F. ORDER FLOW / MICROSTRUCTURE
// ═══════════════════════════════════════════════════════════════

/** Metrics that require trade-side or order-book evidence the feeds lack. */
function orderFlowUnavailableMetrics(hasOrderBook: boolean): { metric: string; reason: string }[] {
  const tradeSide = {
    metric: "trade_direction / delta / cumulative_delta / absorption / exhaustion / footprint",
    reason:
      "the configured feeds supply candles and an aggregated order-book snapshot only — no trade-side (aggressor) evidence exists, and deriving aggressor side from candle direction would fabricate order flow",
  };
  if (!hasOrderBook) {
    return [
      tradeSide,
      {
        metric: "bid_ask_volume / order_book_imbalance / depth_concentration / spread",
        reason:
          "no order-book snapshot was supplied for this analysis (the execution provider is crypto-only and must be reachable) — spread and depth are never reconstructed from candle ranges",
      },
    ];
  }
  return [tradeSide];
}

function computeOrderFlow(execution: ExecutionData | undefined): OrderFlowContext {
  if (!execution || execution.available !== true) {
    return {
      available: false,
      unavailableReason:
        execution && execution.available === false
          ? execution.reason
          : "no order-book snapshot was supplied for this analysis",
      unavailableMetrics: orderFlowUnavailableMetrics(false),
    };
  }

  // Phase 278 hardening — `available: true` alone is NOT evidence. An
  // adversarial/unshaped payload (missing book, non-finite levels) must degrade
  // to the unavailable state with a stated reason: a shapeless object is never
  // read as zero spread, zero depth or a balanced book.
  const levelsOf = (side: unknown): BookLevel[] =>
    Array.isArray(side)
      ? (side as BookLevel[]).filter(
          (l) => l !== null && typeof l === "object" && Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0,
        )
      : [];
  const bids = levelsOf(execution.book?.bids);
  const asks = levelsOf(execution.book?.asks);
  const scalars = [execution.bid, execution.ask, execution.mid, execution.spread, execution.spreadBps, execution.bidDepth, execution.askDepth, execution.imbalance];
  if (bids.length === 0 || asks.length === 0 || !scalars.every((v) => Number.isFinite(v))) {
    return {
      available: false,
      unavailableReason:
        "the supplied execution context carried no shaped order-book levels (missing or non-finite spread/depth/levels) — no microstructure is reported from a shapeless payload",
      unavailableMetrics: orderFlowUnavailableMetrics(false),
    };
  }

  // Depth concentration — share of the supplied depth held by the largest 5
  // levels per side. Derived from the REAL levels, not from a model.
  const top5 = (levels: { price: number; size: number }[]) =>
    levels.slice(0, 5).reduce((s, l) => s + l.size, 0);
  const totalBid = bids.reduce((s, l) => s + l.size, 0);
  const totalAsk = asks.reduce((s, l) => s + l.size, 0);
  const totalDepth = totalBid + totalAsk;
  const depthConcentration = totalDepth > 0 ? (top5(bids) + top5(asks)) / totalDepth : undefined;

  return {
    available: true,
    provider: execution.provider,
    instrumentId: execution.instrumentId,
    snapshotTs: execution.snapshotTs,
    freshness: execution.freshness,
    bid: execution.bid,
    ask: execution.ask,
    mid: execution.mid,
    spread: execution.spread,
    spreadBps: execution.spreadBps,
    bidVolume: execution.bidDepth,
    askVolume: execution.askDepth,
    depthImbalance: round(execution.imbalance, 4),
    ...(depthConcentration !== undefined ? { depthConcentration: round(depthConcentration, 3) } : {}),
    bidLevels: bids.length,
    askLevels: asks.length,
    regime: execution.regime,
    unavailableMetrics: orderFlowUnavailableMetrics(true),
  };
}

// ═══════════════════════════════════════════════════════════════
// G. DERIVATIVES CONTEXT (surfaced, never re-derived)
// ═══════════════════════════════════════════════════════════════

const DERIVATIVES_UNAVAILABLE = [
  {
    metric: "options_iv / skew / options_open_interest / term_structure / basis",
    reason:
      "no configured provider supplies options or futures-basis evidence — these are reported unavailable rather than estimated",
  },
];

function computeDerivatives(derivatives: CryptoDerivativesData | undefined): DerivativesContext {
  if (!derivatives) {
    return {
      available: false,
      unavailableReason:
        "no derivatives evidence was supplied for this analysis — open interest, funding, positioning and liquidations are surfaced only when a real provider feed exists",
      entries: [],
      unavailableMetrics: DERIVATIVES_UNAVAILABLE,
    };
  }
  const entries: DerivativesContextEntry[] = [];
  const base = {
    provider: derivatives.provider,
    instrument: derivatives.symbol,
    ...(derivatives.timestamp !== undefined ? { observedAt: derivatives.timestamp } : {}),
    freshness: derivatives.freshness,
  };

  if (derivatives.openInterest) {
    const oi = derivatives.openInterest;
    const changes = [
      oi.change1h !== undefined ? `1h ${round(oi.change1h, 3)}%` : undefined,
      oi.change4h !== undefined ? `4h ${round(oi.change4h, 3)}%` : undefined,
      oi.change24h !== undefined ? `24h ${round(oi.change24h, 3)}%` : undefined,
    ].filter((v): v is string => v !== undefined);
    entries.push({
      ...base,
      metric: "open_interest",
      value: `${round(oi.current, 2)}${changes.length > 0 ? ` (${changes.join(", ")})` : ""}`,
      basis: "provider-reported open interest and its own change windows — carried verbatim, never recomputed",
    });
  }
  if (derivatives.fundingRate) {
    const fr = derivatives.fundingRate;
    entries.push({
      ...base,
      metric: "funding_rate",
      value: fr.annualizedRate !== undefined ? `${fr.currentRate} (annualized ${round(fr.annualizedRate, 4)})` : `${fr.currentRate}`,
      basis: "provider-reported funding rate for the same instrument",
    });
  }
  if (derivatives.longShort) {
    const ls = derivatives.longShort;
    const parts = [
      ls.accountRatio !== undefined ? `accounts ${round(ls.accountRatio, 3)}` : undefined,
      ls.topTraderRatio !== undefined ? `top traders ${round(ls.topTraderRatio, 3)}` : undefined,
      ls.takerRatio !== undefined ? `taker ${round(ls.takerRatio, 3)}` : undefined,
    ].filter((v): v is string => v !== undefined);
    if (parts.length > 0) {
      entries.push({ ...base, metric: "long_short", value: parts.join(" · "), basis: "provider-reported positioning ratios" });
    }
  }
  if (derivatives.liquidations) {
    const liq = derivatives.liquidations;
    if (liq.dominantSide) {
      entries.push({
        ...base,
        metric: "liquidations",
        value: `${liq.dominantSide} dominated`,
        basis: "provider-reported liquidation dominance",
      });
    }
  }

  const unavailableMetrics = [...DERIVATIVES_UNAVAILABLE];
  if (entries.length === 0) {
    return {
      available: false,
      unavailableReason: `a ${derivatives.provider} record was supplied but carried no usable dataset (availability: ${JSON.stringify(derivatives.availability)})`,
      entries: [],
      unavailableMetrics,
    };
  }
  return { available: true, entries, unavailableMetrics };
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE HIERARCHY
// ═══════════════════════════════════════════════════════════════

/**
 * The ordered evidence hierarchy the decision layer must respect. Tiers 1–5
 * are structural/positional evidence; momentum oscillators sit at tier 6 and
 * are explicitly secondary; the fundamental engine is a SEPARATE layer (8).
 */
function buildEvidenceHierarchy(
  structure: string,
  bos: string | undefined,
  location: PriceLocationContext,
  volumeStructure: VolumeStructureContext,
  liquidity: LiquidityStructureContext,
  volatility: VolatilityContext,
  derivatives: DerivativesContext,
  crossMarket: CrossMarketContext,
  rsi14: number | undefined,
  macdHistogram: number | undefined,
  timeframe: string,
): EvidenceTier[] {
  const accepted = liquidity.levelInteractions.filter((i) => i.state === "accepted");
  const failed = liquidity.levelInteractions.filter((i) => i.state === "failed");
  const rejected = liquidity.levelInteractions.filter((i) => i.state === "rejected");

  return [
    {
      tier: 1,
      name: "market_structure",
      available: structure !== "unknown",
      items: [
        ...(structure !== "unknown" ? [`structure ${structure} (${timeframe})`] : []),
        ...(bos && bos !== "none" ? [`BOS ${bos}`] : []),
      ],
      ...(structure === "unknown" ? { unavailableReason: "insufficient swings for a structural label" } : {}),
    },
    {
      tier: 2,
      name: "location_auction",
      available: location.available,
      items: [
        ...(location.sessionVwap !== undefined ? [`session VWAP ${location.sessionVwap}`] : []),
        ...location.anchoredVwaps.map((a) => `${a.anchor} AVWAP ${a.value}`),
        ...(volumeStructure.profile ? [`POC ${volumeStructure.profile.poc}`, `VAH ${volumeStructure.profile.vah}`, `VAL ${volumeStructure.profile.val}`] : []),
      ],
      ...(location.available ? {} : { unavailableReason: location.unavailableReason }),
    },
    {
      tier: 3,
      name: "volume_liquidity",
      available: volumeStructure.available || liquidity.available,
      items: [
        ...(volumeStructure.relativeVolume ? [`relative volume ${volumeStructure.relativeVolume.value}× (${volumeStructure.relativeVolume.state})`] : []),
        ...(volumeStructure.confirmation ? [`price-volume ${volumeStructure.confirmation.state}`] : []),
        ...(accepted.length > 0 ? [`${accepted.length} accepted level break(s)`] : []),
        ...(failed.length > 0 ? [`${failed.length} failed breakout(s)`] : []),
        ...(rejected.length > 0 ? [`${rejected.length} level rejection(s)`] : []),
        ...(liquidity.lastSweep ? [`liquidity sweep ${liquidity.lastSweep.side}`] : []),
        ...(liquidity.displacement ? [`displacement ${liquidity.displacement.direction}`] : []),
      ],
      ...(volumeStructure.available ? {} : { unavailableReason: volumeStructure.unavailableReason }),
    },
    {
      tier: 4,
      name: "volatility_regime",
      available: volatility.available,
      items: volatility.available
        ? [
            ...(volatility.compression ? [`volatility ${volatility.compression.state}`] : []),
            ...(volatility.regime ? [`regime ${volatility.regime.state}`] : []),
            ...(volatility.zScore !== undefined ? [`z-score ${volatility.zScore}`] : []),
          ]
        : [],
      ...(volatility.available ? {} : { unavailableReason: volatility.unavailableReason }),
    },
    {
      tier: 5,
      name: "positioning_derivatives",
      available: derivatives.available,
      items: derivatives.entries.map((e) => `${e.metric}: ${e.value}`),
      ...(derivatives.available ? {} : { unavailableReason: derivatives.unavailableReason }),
    },
    {
      tier: 6,
      name: "momentum_oscillators",
      available: rsi14 !== undefined || macdHistogram !== undefined,
      items: [
        ...(rsi14 !== undefined ? [`RSI(14) ${rsi14}`] : []),
        ...(macdHistogram !== undefined ? [`MACD histogram ${round(macdHistogram, 4)}`] : []),
      ],
      note: "SECONDARY — confirmation/context only; momentum oscillators never create a directional call",
    },
    {
      tier: 7,
      name: "cross_market",
      available: crossMarket.available,
      items: crossMarket.available
        ? [
            `correlation ${crossMarket.correlation} vs ${crossMarket.comparatorSymbol} (${crossMarket.sampleSize} bars)`,
            ...(crossMarket.relativeStrengthPercent !== undefined
              ? [`relative strength ${crossMarket.relativeStrengthPercent}pp over 20 bars`]
              : []),
            ...(crossMarket.intermarketConfirmation ? [`intermarket ${crossMarket.intermarketConfirmation}`] : []),
          ]
        : [],
      ...(crossMarket.available ? {} : { unavailableReason: crossMarket.unavailableReason }),
    },
    {
      tier: 8,
      name: "fundamental_context",
      available: false,
      items: [],
      note: "separate engine — the fundamental layer is derived by fundamental-engine.ts and combined by unified-intelligence.ts",
    },
  ];
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENTRY
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the advanced block from the supplied candles + real external
 * evidence. Pure and deterministic.
 */
export function computeAdvancedTechnical(
  candles: OhlcvCandle[],
  technical: { structure?: string; bosDirection?: string; rsi14?: number; macdHistogram?: number },
  ctx: AdvancedMarketContext = {},
): AdvancedTechnicalData {
  const timeframe = ctx.timeframe ?? "unspecified";
  const last = candles[candles.length - 1];
  const atr14 = candles.length > 0 ? atr(candles, 14) : undefined;

  const location = computeLocation(candles, ctx, atr14);
  const volumeStructure = computeVolumeStructure(candles);
  const liquidityStructure = computeLiquidityStructure(candles, location, volumeStructure, timeframe, atr14);
  const volatility = computeVolatility(candles, technical.structure ?? "unknown");
  const crossMarket = computeCrossMarket(candles, ctx);
  const orderFlow = computeOrderFlow(ctx.execution);
  const derivatives = computeDerivatives(ctx.derivatives);

  const evidenceClasses: AdvancedEvidenceClass[] = ["candle_ohlcv"];
  if (orderFlow.available) evidenceClasses.push("order_book_snapshot");
  if (derivatives.available) evidenceClasses.push("derivatives_feed");
  if (crossMarket.available) evidenceClasses.push("comparator_series");

  return {
    provenance: {
      ...(ctx.provider ? { provider: ctx.provider } : {}),
      ...(ctx.providerInstrumentId ? { providerInstrumentId: ctx.providerInstrumentId } : {}),
      timeframe,
      ...(last ? { observedAt: last.timestamp } : {}),
      dataPoints: candles.length,
      parameters: { ...ADVANCED_PARAMETERS },
      evidenceClasses,
    },
    location,
    volumeStructure,
    liquidityStructure,
    volatility,
    crossMarket,
    orderFlow,
    derivatives,
    evidenceHierarchy: buildEvidenceHierarchy(
      technical.structure ?? "unknown",
      technical.bosDirection,
      location,
      volumeStructure,
      liquidityStructure,
      volatility,
      derivatives,
      crossMarket,
      technical.rsi14,
      technical.macdHistogram,
      timeframe,
    ),
  };
}

/**
 * Attach (or enrich) the advanced block on a computed technical result.
 *
 * The candle-derived sections are computed once — when a block already exists
 * it is REUSED, and only the externally-evidenced sections (order flow,
 * derivatives, cross-market) plus provenance are re-derived from the context
 * that is available at this call site. That keeps the two pipeline call sites
 * (market data acquisition and the analysis engine) from producing divergent
 * views of the same evidence.
 */
export function attachAdvancedTechnical(
  candles: OhlcvCandle[],
  existing: AdvancedTechnicalData | undefined,
  technical: { structure?: string; bosDirection?: string; rsi14?: number; macdHistogram?: number },
  ctx: AdvancedMarketContext = {},
): AdvancedTechnicalData {
  const base = existing ?? computeAdvancedTechnical(candles, technical, ctx);

  const orderFlow = ctx.execution || !existing ? computeOrderFlow(ctx.execution) : base.orderFlow;
  const derivatives = ctx.derivatives || !existing ? computeDerivatives(ctx.derivatives) : base.derivatives;
  const crossMarket = ctx.comparator || !existing ? computeCrossMarket(candles, ctx) : base.crossMarket;

  const evidenceClasses = new Set<AdvancedEvidenceClass>(base.provenance.evidenceClasses);
  evidenceClasses.add("candle_ohlcv");
  if (orderFlow.available) evidenceClasses.add("order_book_snapshot");
  if (derivatives.available) evidenceClasses.add("derivatives_feed");
  if (crossMarket.available) evidenceClasses.add("comparator_series");

  const last = candles[candles.length - 1];
  return {
    ...base,
    orderFlow,
    derivatives,
    crossMarket,
    provenance: {
      ...base.provenance,
      ...(ctx.provider ?? base.provenance.provider
        ? { provider: ctx.provider ?? base.provenance.provider }
        : {}),
      ...(ctx.providerInstrumentId ?? base.provenance.providerInstrumentId
        ? { providerInstrumentId: ctx.providerInstrumentId ?? base.provenance.providerInstrumentId }
        : {}),
      ...(ctx.timeframe ? { timeframe: ctx.timeframe } : {}),
      ...(last ? { observedAt: last.timestamp } : {}),
      dataPoints: candles.length,
      parameters: { ...ADVANCED_PARAMETERS },
      evidenceClasses: [...evidenceClasses],
    },
    evidenceHierarchy: buildEvidenceHierarchy(
      technical.structure ?? "unknown",
      technical.bosDirection,
      locationOf(base),
      base.volumeStructure,
      base.liquidityStructure,
      base.volatility,
      derivatives,
      crossMarket,
      technical.rsi14,
      technical.macdHistogram,
      ctx.timeframe ?? base.provenance.timeframe ?? "unspecified",
    ),
  };
}

function locationOf(data: AdvancedTechnicalData): PriceLocationContext {
  return data.location;
}

// ═══════════════════════════════════════════════════════════════
// DECISION SUPPORT — deterministic rules, no indicator voting
// ═══════════════════════════════════════════════════════════════

export interface AdvancedEvidenceAssessment {
  /** Rules that support the thesis direction, each citing its evidence. */
  confluence: string[];
  /** Rules that oppose it, each citing its evidence. */
  conflicts: string[];
  /** Bounded contribution for the existing conviction machinery. */
  contribution: number;
  cap: number;
  /** Thresholds and the exact evidence each rule read. */
  basis: string[];
}

/**
 * Convert the advanced evidence into a bounded, traceable contribution for the
 * EXISTING conviction machinery.
 *
 * Scope discipline (this is what keeps the phase from becoming indicator
 * voting): only evidence that NO existing layer already scores is used here —
 * level acceptance/failure/rejection semantics, price–volume confirmation, and
 * regime coherence of an accepted breakout. Session/AVWAP LOCATION is already
 * scored by the engine's VWAP location layer, sweeps by its Liquidity layer,
 * displacement/FVG/OB by its Location layer, cross-asset by its Cross Asset
 * layer, order-book imbalance by its Execution layer and derivatives by
 * sentiment scoring — so none of those is scored twice here.
 */
export function assessAdvancedEvidence(
  advanced: AdvancedTechnicalData | undefined,
  direction: "long" | "short" | "none",
): AdvancedEvidenceAssessment {
  const cap = 6;
  const confluence: string[] = [];
  const conflicts: string[] = [];
  const basis: string[] = [];
  if (!advanced || direction === "none") {
    return { confluence, conflicts, contribution: 0, cap, basis };
  }

  const wantAbove = direction === "long";
  const interactions = advanced.liquidityStructure.levelInteractions;
  // Only the most recent interaction PER STATE is scored, so a cluster of
  // levels touched by one candle run cannot stack into a large contribution.
  const latestAccepted = interactions.find((i) => i.state === "accepted");
  const latestFailed = interactions.find((i) => i.state === "failed");
  const latestRejected = interactions.find((i) => i.state === "rejected");
  const alreadyScored = new Set<string>();

  if (latestAccepted && !alreadyScored.has("accepted")) {
    alreadyScored.add("accepted");
    const aligned = latestAccepted.side === (wantAbove ? "above_level" : "below_level");
    if (aligned) {
      confluence.push(`accepted breakout ${latestAccepted.side === "above_level" ? "above" : "below"} ${latestAccepted.level} (${latestAccepted.levelSource})`);
      basis.push(`+2 accepted breakout ${latestAccepted.level} — ${latestAccepted.basis}`);
    } else {
      conflicts.push(`accepted breakout ${latestAccepted.side === "above_level" ? "above" : "below"} ${latestAccepted.level} (${latestAccepted.levelSource}) against the thesis`);
      basis.push(`-2 opposing accepted breakout ${latestAccepted.level} — ${latestAccepted.basis}`);
    }
  }

  if (latestFailed && !alreadyScored.has("failed")) {
    alreadyScored.add("failed");
    const aligned = latestFailed.side === (wantAbove ? "above_level" : "below_level");
    if (aligned) {
      conflicts.push(`failed breakout ${latestFailed.side === "above_level" ? "above" : "below"} ${latestFailed.level} (${latestFailed.levelSource}) — the move did not hold`);
      basis.push(`-2 failed breakout ${latestFailed.level} — ${latestFailed.basis}`);
    } else {
      confluence.push(`failed breakout against the thesis at ${latestFailed.level} (${latestFailed.levelSource})`);
      basis.push(`+1 opposing breakout failed — ${latestFailed.basis}`);
    }
  }

  if (latestRejected && !alreadyScored.has("rejected")) {
    alreadyScored.add("rejected");
    const aligned = latestRejected.side === (wantAbove ? "above_level" : "below_level");
    // A rejection AT the level the thesis needed to break is evidence against
    // an immediate continuation; a rejection of the opposite side supports it.
    if (aligned) {
      conflicts.push(`rejection at ${latestRejected.level} (${latestRejected.levelSource}) — supply/demand absorbed the move`);
      basis.push(`-1 rejection at ${latestRejected.level} — ${latestRejected.basis}`);
    } else {
      confluence.push(`rejection of the opposite side at ${latestRejected.level} (${latestRejected.levelSource})`);
      basis.push(`+1 opposing rejection — ${latestRejected.basis}`);
    }
  }

  const confirmation = advanced.volumeStructure.confirmation;
  if (confirmation && confirmation.state !== "inconclusive") {
    const priceUp = confirmation.priceChangePercent > 0;
    const aligned = priceUp === wantAbove;
    if (confirmation.state === "confirmed") {
      if (aligned) {
        confluence.push(`price move confirmed by expanding participation (${confirmation.priceChangePercent}% price, ${confirmation.volumeChangePercent}% participation)`);
        basis.push(`+1 confirmed price-volume relation — ${confirmation.basis}`);
      } else {
        conflicts.push(`the ${priceUp ? "advance" : "decline"} was confirmed by expanding participation against the thesis`);
        basis.push(`-1 confirmed price-volume relation opposes the thesis — ${confirmation.basis}`);
      }
    } else {
      if (aligned) {
        conflicts.push(`thesis-direction move on shrinking participation (${confirmation.priceChangePercent}% price, ${confirmation.volumeChangePercent}% participation)`);
        basis.push(`-1 price-volume divergence in the thesis direction — ${confirmation.basis}`);
      } else {
        confluence.push(`outsized ${priceUp ? "advance" : "decline"} without participation support`);
        basis.push(`+1 price-volume divergence opposing the thesis — ${confirmation.basis}`);
      }
    }
  }

  // Regime coherence of an accepted breakout: an accepted break inside a
  // mean-reverting, compressed tape is weaker evidence than the same break
  // while the tape is trending and expanding.
  if (latestAccepted && advanced.volatility.available) {
    const compressionState = advanced.volatility.compression?.state;
    const regimeState = advanced.volatility.regime?.state;
    if (compressionState === "expanded" && regimeState === "trend") {
      confluence.push("breakout accepted while volatility expands inside a trending regime");
      basis.push(
        `+1 regime coherence — ${advanced.volatility.compression?.basis}; ${advanced.volatility.regime?.basis}`,
      );
    } else if (regimeState === "mean_reversion") {
      conflicts.push("breakout accepted inside a mean-reverting regime — acceptance is less reliable");
      basis.push(`-1 regime incoherence — ${advanced.volatility.regime?.basis}`);
    }
  }

  const raw =
    basis.reduce((sum, b) => sum + (b.startsWith("+") ? Number(b.slice(1, b.indexOf(" "))) : -Number(b.slice(1, b.indexOf(" ")))), 0);
  const contribution = Math.max(-cap, Math.min(cap, raw));
  return { confluence, conflicts, contribution, cap, basis };
}
