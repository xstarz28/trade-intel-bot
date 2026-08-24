import type {
  AnalysisInput,
  AnalysisResult,
  BiasBreakdown,
  ConvictionLevel,
  DirectionalBias,
  FactorScore,
  HtfAlignment,
  KeyLevels,
  MtfSummary,
  Recommendation,
  TradePlan,
} from "@/types/analysis";
import type { MarketData, MtfContext, TechnicalData, PriceSnapshot } from "@/lib/data/market-types";
import { resolveInstrumentSpec } from "@/lib/risk/spec-resolver";
import { computePositionSizing, type PositionSizingResult } from "@/lib/risk";
import { resolveStyle } from "@/lib/trading-style";
import {
  deriveMacroYieldEvidence,
  type TreasuryData,
} from "@/lib/data/treasury";
import {
  deriveCotEvidence,
  mapInstrumentToCot,
  type CotData,
} from "@/lib/data/cot";
import {
  detectMarketRegime,
  classifySetup,
  detectContradictions,
} from "@/lib/market-context";

export type { AnalysisInput, AnalysisResult, BiasBreakdown, DirectionalBias, FactorScore, KeyLevels, MtfSummary };
export type { InstrumentType, Timeframe, Recommendation, ConvictionLevel, TradePlan, HtfAlignment } from "@/types/analysis";

// ── Phase 1 decision-engine constants ─────────────────────────────
//
// Core directional bias is built ONLY from factors that reflect real
// market evidence available today: structure (trend), fundamentals and
// positioning/sentiment. RSI/MACD are NOT part of the weighted core —
// they exist only as a small secondary modifier that can never flip
// the bias on its own.
const CORE_WEIGHTS = {
  trend: 0.45,
  fundamental: 0.3,
  sentiment: 0.25,
} as const;

/** Max influence of the RSI/MACD modifier on the weighted average. */
const INDICATOR_MODIFIER_WEIGHT = 0.1;

/** Minimum projected R:R for a setup to be actionable. */
const MIN_RR = 1.5;

function clampScore(score: number): FactorScore {
  return Math.max(-2, Math.min(2, Math.round(score))) as FactorScore;
}

// ── Timeframe direction & HTF/LTF alignment ───────────────────────

type TfDirection = "long" | "short" | "none";

/** Directional read of one timeframe from its structure + CHoCH. */
function tfDirection(
  structure: "HH/HL" | "LH/LL" | "range" | "unknown" | undefined,
  choch: "bullish" | "bearish" | "none" | undefined,
): TfDirection {
  // A confirmed CHoCH overrides a stale structure label — it is the
  // earliest algorithmic signal of a character change.
  if (choch === "bullish") return "long";
  if (choch === "bearish") return "short";
  if (structure === "HH/HL") return "long";
  if (structure === "LH/LL") return "short";
  return "none";
}

function computeAlignment(input: AnalysisInput): HtfAlignment | undefined {
  const htf = input.technicalData?.htfContext;
  if (!htf || htf.dataPoints < 20) return undefined;

  const ltf = input.technicalData;
  const htfDir = tfDirection(htf.structure, htf.chochDirection);
  const ltfDir = tfDirection(ltf?.structure, ltf?.chochDirection);

  let state: HtfAlignment["state"];
  if (ltfDir === "none") {
    state = "ltf_unclear";
  } else if (htfDir === "none") {
    state = "htf_unknown";
  } else if (htfDir === ltfDir) {
    state = "aligned";
  } else {
    state = "counter_trend";
  }

  return {
    htfTimeframe: htf.timeframe,
    htfStructure: htf.structure,
    state,
  };
}

// ── Bias Calculation (structure + fundamental + positioning core) ─

function calculateBias(breakdown: BiasBreakdown): {
  bias: DirectionalBias;
  coreWeightedAvg: number;
} {
  const coreWeightedAvg =
    breakdown.trend * CORE_WEIGHTS.trend +
    breakdown.fundamental * CORE_WEIGHTS.fundamental +
    breakdown.sentiment * CORE_WEIGHTS.sentiment;

  // NOTE: breakdown.indicator (RSI/MACD) is deliberately EXCLUDED from
  // this weighted average. It is a capped secondary modifier used only
  // in conviction scoring — it can never create or flip the bias.

  // Bias is derived from the CORE average only.
  let bias: DirectionalBias = "Neutral";
  if (coreWeightedAvg > 0.25) bias = "Bullish";
  else if (coreWeightedAvg < -0.25) bias = "Bearish";

  return {
    bias,
    coreWeightedAvg: Math.round(coreWeightedAvg * 100) / 100,
  };
}

// ── Trend / Structure Scoring (structure-only, no MA crossover) ───

function scoreTrend(input: AnalysisInput): FactorScore {
  const tech = input.technicalData;

  // ── Auto-fetched data path (preferred) ──
  if (tech && tech.dataPoints >= 5) {
    let score = 0;
    const smc = tech.smc;

    if (smc) {
      // ── External/major structure drives the trend factor ──
      const ext = smc.internalExternal.external;
      if (ext.structure === "HH/HL") score += 1;
      else if (ext.structure === "LH/LL") score -= 1;

      // External BOS adds confirmation
      if (ext.bosDirection === "bullish") score += 1;
      else if (ext.bosDirection === "bearish") score -= 1;

      // External CHoCH reversal signal
      if (ext.chochDirection === "bullish") score += 1;
      if (ext.chochDirection === "bearish") score -= 1;

      // Internal/minor structure is a TRIGGER context, never a trend
      // change by itself. An opposing minor read is only an early-warning.
      const int = smc.internalExternal.internal;
      const extDir = tfDirection(ext.structure, ext.chochDirection);
      const intDir = tfDirection(int.structure, int.chochDirection);
      if (extDir !== "none" && intDir !== "none" && extDir !== intDir) score -= 1;
    } else {
      // Fallback: top-level fields (pre-SMC shape)
      if (tech.structure === "HH/HL") score += 1;
      else if (tech.structure === "LH/LL") score -= 1;

      if (tech.bosDirection === "bullish") score += 1;
      else if (tech.bosDirection === "bearish") score -= 1;

      if (tech.chochDirection === "bearish") score -= 1;
      if (tech.chochDirection === "bullish") score += 1;
    }

    return clampScore(score);
  }

  // ── Manual input fallback (user-supplied observed levels only) ──
  if (input.currentPrice && input.recentHigh && input.recentLow) {
    const price = parseFloat(input.currentPrice);
    const high = parseFloat(input.recentHigh);
    const low = parseFloat(input.recentLow);
    const range = high - low;
    if (range > 0) {
      const position = (price - low) / range;
      let score = 0;
      if (position > 0.65) score += 1;
      if (position > 0.8) score += 1;
      if (position < 0.35) score -= 1;
      if (position < 0.2) score -= 1;
      return clampScore(score);
    }
  }

  return 0;
}

// ── Indicator Scoring — SECONDARY ONLY ────────────────────────────
// RSI/MACD are computed and reported for context but carry no core
// weight. Their score can adjust conviction magnitude slightly; it can
// never establish or flip the directional bias (see calculateBias).

function scoreIndicators(input: AnalysisInput): FactorScore {
  const tech = input.technicalData;

  // ── Auto-fetched data path ──
  if (tech && tech.dataPoints >= 14) {
    let score = 0;

    // RSI — momentum context only
    if (tech.rsi14 !== undefined) {
      if (tech.rsi14 > 70) score -= 1;
      else if (tech.rsi14 < 30) score += 1;
      if (tech.rsiDivergence === "bullish") score += 1;
      if (tech.rsiDivergence === "bearish") score -= 1;
    }

    // MACD — momentum context only
    if (tech.macdHistogram !== undefined) {
      if (tech.macdHistogram > 0) score += 1;
      else if (tech.macdHistogram < 0) score -= 1;
    }

    return clampScore(score);
  }

  // ── Manual input fallback (news context keywords) ──
  const newsLower = (input.newsContext || "").toLowerCase();
  let score = 0;

  if (newsLower.includes("rally") || newsLower.includes("surge") || newsLower.includes("breakout")) {
    score += 1;
  }
  if (newsLower.includes("crash") || newsLower.includes("plunge") || newsLower.includes("breakdown")) {
    score -= 1;
  }
  if (newsLower.includes("bearish divergence")) {
    score -= 1;
  } else if (newsLower.includes("bullish divergence")) {
    score += 1;
  } else if (newsLower.includes("divergence")) {
    score += 1;
  }

  return clampScore(score);
}

// ── Fundamental Scoring (Phase 5: asset-class specific) ───────────

function scoreFundamentals(input: AnalysisInput): FactorScore {
  let score = 0;

  // ── Alpha Vantage intelligence data (preferred) ──
  const macro = input.macroData;
  const fund = input.fundamentalData;
  const sym = input.instrument.toUpperCase();

  if (macro && macro.confidence !== "unavailable" && macro.indicators.length > 0) {
    const bullish = macro.indicators.filter((ind) => ind.sentiment === "positive").length;
    const bearish = macro.indicators.filter((ind) => ind.sentiment === "negative").length;
    const total = macro.indicators.length;
    if (total > 0) {
      const ratio = (bullish - bearish) / total;
      if (ratio > 0.3) score += 1;
      if (ratio > 0.6) score += 1;
      if (ratio < -0.3) score -= 1;
      if (ratio < -0.6) score -= 1;
    }
    // USD-strength context — NEWS-DERIVED PROXY, not actual DXY price data.
    // Applies to forex AND USD-quoted commodities (gold inverse relationship
    // must be measured cross-asset; here we only reflect broad USD pressure).
    if ((input.instrumentType === "forex" || input.instrumentType === "commodity") && macro.dxyTrend) {
      if (macro.dxyTrend === "rising") score -= 1;
      if (macro.dxyTrend === "falling") score += 1;
    }
  } else if (fund && fund.available && input.instrumentType === "stock") {
    if (fund.peRatio !== undefined && fund.peRatio > 0) {
      if (fund.peRatio < 15) score += 1;
      if (fund.peRatio > 35) score -= 1;
    }
    if (fund.profitMargin !== undefined && fund.profitMargin > 0.2) score += 1;
    if (fund.earningsPerShare !== undefined && fund.earningsPerShare > 0) score += 1;
    // Sector context: stored but NO sector-benchmark provider exists —
    // deliberately unscored rather than synthetically ranked.
  }

  // ── Economic calendar data (released event surprises only) ──
  const cal = input.calendarData;
  if (cal && cal.confidence !== "unavailable" && cal.events.length > 0) {
    const released = cal.events.filter(
      (e) => e.status === "released" && e.actual !== undefined && e.forecast !== undefined && e.importance === 3,
    );
    for (const evt of released) {
      const actualNum = typeof evt.actual === "number" ? evt.actual : parseFloat(String(evt.actual));
      const forecastNum = typeof evt.forecast === "number" ? evt.forecast : parseFloat(String(evt.forecast));
      if (isNaN(actualNum) || isNaN(forecastNum)) continue;

      const surprise = actualNum - forecastNum;
      const pctSurprise = forecastNum !== 0 ? Math.abs(surprise / forecastNum) : 0;
      if (pctSurprise < 0.01 && Math.abs(surprise) < 0.2) continue;

      const eventLower = evt.event.toLowerCase();
      const isRateEvent = eventLower.includes("interest rate") || eventLower.includes("rate decision") || eventLower.includes("policy rate");
      const isEmployment = eventLower.includes("payroll") || eventLower.includes("unemployment") || eventLower.includes("employment");
      const isInflation = eventLower.includes("cpi") || eventLower.includes("inflation") || eventLower.includes("pce");

      if (isRateEvent) {
        if (input.instrumentType === "forex") {
          if (evt.currency === "USD" || evt.currency === "EUR" || evt.currency === "GBP") {
            score += surprise > 0 ? 1 : -1;
          }
        }
        if (input.instrumentType === "crypto") {
          score += surprise > 0 ? -1 : 1;
        }
        // Rate surprises also drive gold/indices via policy expectations —
        // same direction as crypto risk assets (hawkish = headwind).
        if (input.instrumentType === "commodity" || input.instrumentType === "indices") {
          if (evt.currency === "USD") score += surprise > 0 ? -1 : 1;
        }
      } else if (isEmployment) {
        if (input.instrumentType === "forex" && evt.currency === "USD") {
          score += surprise > 0 ? -1 : 1;
        }
        if (input.instrumentType === "crypto") {
          score += surprise > 0 ? -1 : 1;
        }
        if (input.instrumentType === "commodity" || input.instrumentType === "indices") {
          if (evt.currency === "USD") score += surprise > 0 ? -1 : 1;
        }
      } else if (isInflation) {
        if (input.instrumentType === "forex" && evt.currency === "USD") {
          score += surprise > 0 ? -1 : 1;
        }
        if (input.instrumentType === "crypto" && pctSurprise > 0.05) {
          score += surprise > 0 ? -1 : 1;
        }
        // Inflation surprise is gold-supportive (monetary hedge) but an
        // index headwind (rate-hike expectations).
        if (input.instrumentType === "commodity" && /XAU|XAG|GOLD|SILVER/.test(sym)) {
          if (evt.currency === "USD") score += surprise > 0 ? 1 : -1;
        }
        if (input.instrumentType === "indices" && evt.currency === "USD") {
          if (pctSurprise > 0.05) score += surprise > 0 ? -1 : 1;
        }
      }
    }
  }

  // ── Manual input fallback (asset-specific keywords, honestly labelled
  //    as NEWS-derived context — never treated as hard data) ──
  if (score === 0) {
    const events = (input.economicEvents || "").toLowerCase();
    const context = (input.newsContext || "").toLowerCase();
    const combined = `${events} ${context}`;

    if (input.instrumentType === "forex") {
      if (combined.includes("hawkish") || combined.includes("rate hike") || combined.includes("tightening")) score += 1;
      if (combined.includes("dovish") || combined.includes("rate cut") || combined.includes("easing")) score -= 1;
      if (combined.includes("strong gdp") || combined.includes("strong nfp") || combined.includes("strong employment")) score += 1;
      if (combined.includes("weak gdp") || combined.includes("weak nfp") || combined.includes("recession")) score -= 1;
    } else if (input.instrumentType === "crypto") {
      if (combined.includes("institutional") || combined.includes("etf approval") || combined.includes("adoption")) score += 1;
      if (combined.includes("regulation") || combined.includes("ban") || combined.includes("crackdown")) score -= 1;
      if (combined.includes("halving") || combined.includes("bullish catalyst")) score += 1;
    } else if (input.instrumentType === "commodity") {
      // Gold/precious metals: monetary + safe-haven context (NEWS keywords).
      if (/XAU|XAG|GOLD|SILVER/.test(sym)) {
        if (combined.includes("hawkish") || combined.includes("rate hike")) score -= 1;
        if (combined.includes("dovish") || combined.includes("rate cut")) score += 1;
        if (
          combined.includes("geopolitical") || combined.includes("war") ||
          combined.includes("conflict") || combined.includes("sanctions") ||
          combined.includes("escalation") || combined.includes("safe haven")
        ) score += 1;
        if (combined.includes("de-escalation") || combined.includes("peace deal")) score -= 1;
        if (combined.includes("inflation fear") || combined.includes("stagflation")) score += 1;
      } else {
        // Oil & other commodities: supply/inventory data UNAVAILABLE (no
        // provider). Only broad demand/risk and USD-proxy news are usable.
        if (combined.includes("supply cut") || combined.includes("production disruption") || combined.includes("opec cut")) score += 1;
        if (combined.includes("supply increase") || combined.includes("output hike") || combined.includes("demand destruction")) score -= 1;
        if (combined.includes("recession") || combined.includes("demand slowdown")) score -= 1;
        if (combined.includes("sanctions") || combined.includes("conflict")) score += 1;
      }
    } else if (input.instrumentType === "indices") {
      // Macro-driven, honest: risk regime words only.
      if (combined.includes("risk-on") || combined.includes("record high") || combined.includes("earnings beat")) score += 1;
      if (combined.includes("risk-off") || combined.includes("sell-off") || combined.includes("selloff") || combined.includes("recession fear")) score -= 1;
    }
  }

  return clampScore(score);
}

// ── Sentiment / Positioning Scoring ───────────────────────────────

function scoreSentiment(input: AnalysisInput): FactorScore {
  let score = 0;

  // ── Crypto derivatives data (CoinGlass) ──
  const deriv = input.derivativesData;
  const tech = input.technicalData;

  const structure = tech?.structure;

  if (deriv && deriv.confidence !== "unavailable" && input.instrumentType === "crypto") {
    if (deriv.fundingRate) {
      const fr = deriv.fundingRate.currentRate;
      if (fr > 0.001) score -= 1;
      if (fr < -0.001) score += 1;
      if (fr > 0.0005 && structure === "HH/HL") score += 1;
      if (fr > 0.0005 && structure === "LH/LL") score -= 1;
    }

    if (deriv.openInterest && deriv.openInterest.change1h !== undefined) {
      const oiChange = deriv.openInterest.change1h;
      if (oiChange > 2 && structure === "HH/HL") score += 1;
      if (oiChange > 2 && structure === "LH/LL") score -= 1;
      if (oiChange < -2 && structure === "LH/LL") score += 1;
    }

    if (deriv.longShort?.accountRatio !== undefined) {
      const ratio = deriv.longShort.accountRatio;
      if (ratio > 2.0) score -= 1;
      if (ratio < 0.5) score += 1;
    }

    if (deriv.liquidations?.dominantSide === "longs") {
      score += 1;
    } else if (deriv.liquidations?.dominantSide === "shorts") {
      score -= 1;
    }
  } else {
    // ── Alpha Vantage news sentiment ──
    const sentiment = input.sentimentData;
    if (sentiment && sentiment.confidence !== "unavailable" && sentiment.articleCount > 0) {
      const avScore = sentiment.averageScore;
      if (avScore > 0.25) score += 1;
      if (avScore > 0.5) score += 1;
      if (avScore < -0.25) score -= 1;
      if (avScore < -0.5) score -= 1;
      if (sentiment.breakdown.positive > sentiment.breakdown.negative * 2 && sentiment.articleCount >= 3) score += 1;
      if (sentiment.breakdown.negative > sentiment.breakdown.positive * 2 && sentiment.articleCount >= 3) score -= 1;
    }

    // Manual funding rate fallback
    if (input.fundingRate) {
      const fr = parseFloat(input.fundingRate);
      if (!isNaN(fr)) {
        if (fr > 0.05) score -= 1;
        if (fr < -0.05) score += 1;
      }
    }
  }

  // ── Volume as structure confirmation (NOT coupled to RSI/MACD) ──
  if (tech && tech.dataPoints >= 20 && tech.volumeTrend !== "unknown") {
    if (tech.volumeTrend === "increasing" && structure !== "range" && structure !== "unknown") score += 1;
    if (tech.volumeTrend === "decreasing" && structure !== "range" && structure !== "unknown") score -= 1;
  }

  // ── Manual input fallback ──
  const context = (input.newsContext || "").toLowerCase();
  if (context.includes("fear") || context.includes("panic") || context.includes("capitulation")) score += 1;
  if (context.includes("greed") || context.includes("euphoria") || context.includes("fomo")) score -= 1;

  return clampScore(score);
}

// ── Data Completeness ─────────────────────────────────────────────

function assessDataCompleteness(input: AnalysisInput): {
  completeness: "full" | "partial" | "limited";
  flags: string[];
} {
  const flags: string[] = [];
  let missing = 0;
  const hasMarketData = !!input.marketData;
  const hasTechnical = !!input.technicalData && input.technicalData.dataPoints > 0;

  if (!hasMarketData && !input.currentPrice) {
    flags.push("No price data available — scored neutral");
    missing++;
  }
  if (hasTechnical && input.technicalData!.dataPoints < 50) {
    flags.push(`Limited candle history (${input.technicalData!.dataPoints} candles) — indicators may be unreliable`);
  }
  const hasIntelligence = !!(input.sentimentData || input.fundamentalData || input.macroData);
  if (!input.newsContext && !hasIntelligence) {
    flags.push("No news context or intelligence data — fundamental analysis limited to technicals");
    missing++;
  }
  if (input.instrumentType === "forex" && !input.economicEvents && !input.calendarData) {
    flags.push("No economic calendar data — macro events not factored");
    missing++;
  }
  if (
    input.instrumentType === "crypto" &&
    !input.fundingRate &&
    !(input.derivativesData && input.derivativesData.confidence !== "unavailable")
  ) {
    flags.push("No funding rate data — sentiment analysis limited");
    missing++;
  }
  if (input.instrumentType === "commodity") {
    const realYieldActual = input.treasuryData?.available && !!input.treasuryData.latest.real;
    flags.push(
      realYieldActual
        ? "Supply/inventory data unavailable — commodity fundamentals limited to news-derived context plus ACTUAL Treasury yields"
        : "Supply/inventory and real-yield data unavailable — commodity fundamentals limited to news-derived context",
    );
  }
  if (input.technicalData?.crossAsset && !input.technicalData.crossAsset.available) {
    flags.push(
      `Cross-asset context unavailable (${input.technicalData.crossAsset.unavailableReason ?? "provider returned no comparable series"})`,
    );
  }
  if (input.treasuryData && !input.treasuryData.available) {
    flags.push(`Treasury yield context unavailable (${input.treasuryData.reason})`);
  }
  if (input.cotData && !input.cotData.available) {
    flags.push(`COT positioning context unavailable (${input.cotData.reason})`);
  }
  if (!input.technicalData?.htfContext) {
    flags.push("No higher-timeframe structural data — macro context unverified");
  }
  if (input.technicalData?.chainUnavailable?.length) {
    flags.push(
      `Timeframe chain unavailable: ${input.technicalData.chainUnavailable.join(", ")} — context not synthesized`,
    );
  }
  const smcFlag = input.technicalData?.smc;
  if (smcFlag && !smcFlag.volumeProfile.available && smcFlag.volumeProfile.unavailableReason) {
    flags.push(`Volume limitation: ${smcFlag.volumeProfile.unavailableReason}`);
  }

  let completeness: "full" | "partial" | "limited" = "full";
  if (hasMarketData && hasTechnical) completeness = "full";
  else if (hasMarketData || hasTechnical) completeness = "partial";
  else completeness = "limited";

  if (missing >= 3) completeness = "limited";

  return { completeness, flags };
}

// ── NO_TRADE gate + trade plan construction ───────────────────────

interface TradeDecision {
  recommendation: Recommendation;
  noTradeReasons: string[];
  tradePlan?: TradePlan;
  conviction?: ConvictionLevel;
  confidence: number;
  keyLevels: KeyLevels;
}

function parseLevel(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

function decideTrade(
  input: AnalysisInput,
  bias: DirectionalBias,
  breakdown: BiasBreakdown,
  coreWeightedAvg: number,
  completeness: "full" | "partial" | "limited",
  flags: string[],
  alignment: HtfAlignment | undefined,
  mtf?: MtfContext,
): TradeDecision {
  const reasons: string[] = [];
  const tech = input.technicalData;
  const md = input.marketData;
  // Phase 6 — style profile: decision-horizon parameters ONLY. It never
  // alters structure/liquidity/price facts, only requirements and weights.
  const styleProfile = resolveStyle(input.tradingStyle);

  const entry =
    md?.price.price ?? (input.currentPrice ? parseFloat(input.currentPrice) : undefined);

  // Structural levels — ONLY from real market swings or user-supplied
  // observed levels. No synthetic price×% fallbacks, ever.
  const price = entry ?? 0;
  const swingSupports = [
    ...(tech?.supportLevels ?? []),
    ...(tech?.swingLows ?? []),
  ]
    .filter((l) => l > 0 && l < price)
    .sort((a, b) => b - a); // nearest below first
  const swingResistances = [
    ...(tech?.resistanceLevels ?? []),
    ...(tech?.swingHighs ?? []),
  ]
    .filter((l) => l > price)
    .sort((a, b) => a - b); // nearest above first

  const userLow = parseLevel(input.recentLow);
  const userHigh = parseLevel(input.recentHigh);
  if (userLow !== undefined && userLow < price) swingSupports.push(userLow);
  if (userHigh !== undefined && userHigh > price) swingResistances.push(userHigh);

  // ── Gate 0: primary data validity (Phase 3B) ──
  // Old or known-invalid data must never back an executable plan.
  // "Missing data is uncertainty, not directional evidence."
  if (md && (md.dataFreshness === "stale" || md.dataFreshness === "unavailable")) {
    reasons.push(
      `Primary market data is flagged "${md.dataFreshness}" by the provider — it cannot be treated as live pricing for an executable plan.`,
    );
  }
  // Style-sensitive freshness policy (scalping strictest, swing most tolerant).
  const PRICE_STALE_MS = styleProfile.priceStaleMs;
  if (
    md &&
    Number.isFinite(md.price.timestamp) &&
    Date.now() - md.price.timestamp > PRICE_STALE_MS
  ) {
    reasons.push(
      `Price snapshot is older than ${PRICE_STALE_MS / 60000} minutes — treating it as stale rather than live.`,
    );
  }

  // ── Gate 1: live price required ──
  if (entry === undefined || entry <= 0) {
    reasons.push("No live market price available — cannot define entry or measure structural distance.");
  }

  // ── Gate 2: data completeness ──
  if (completeness === "limited") {
    reasons.push(`Data completeness is LIMITED for the data this thesis requires: ${flags.join(" ")}`);
  }

  // ── Gate 3: directional bias required ──
  if (bias === "Neutral") {
    reasons.push("Core bias is Neutral — structure, fundamentals and positioning do not agree on a direction.");
  }

  // ── Gate 4: confluence strength ──
  const dirSign = bias === "Bullish" ? 1 : bias === "Bearish" ? -1 : 0;
  const coreScores = [
    { name: "structure", score: breakdown.trend },
    { name: "fundamental", score: breakdown.fundamental },
    { name: "positioning", score: breakdown.sentiment },
  ];
  const agreeing = coreScores.filter((f) => f.score !== 0 && Math.sign(f.score) === dirSign);
  const opposing = coreScores.filter((f) => f.score !== 0 && Math.sign(f.score) === -dirSign);

  if (bias !== "Neutral" && agreeing.length < 2) {
    reasons.push(
      `Confluence too weak: only ${agreeing.length} core factor(s) support the ${bias.toLowerCase()} bias (need at least 2).`,
    );
  }

  // ── Gate 5: material opposing evidence ──
  const materialOpposition = opposing.filter((f) => Math.abs(f.score) >= 2);
  if (bias !== "Neutral" && materialOpposition.length > 0) {
    reasons.push(
      `Material conflict: ${materialOpposition.map((f) => f.name).join(", ")} strongly oppose the ${bias.toLowerCase()} bias.`,
    );
  }

  // ── Gate 6: HTF/LTF relationship ──
  if (alignment && bias !== "Neutral") {
    const ltfDir = tfDirection(tech?.structure, tech?.chochDirection);
    const ltfSign = ltfDir === "long" ? 1 : ltfDir === "short" ? -1 : 0;

    if (alignment.state === "counter_trend") {
      // Counter-trend is only valid with LTF confirmation (a CHoCH that
      // produced the LTF direction) AND at least one non-technical core
      // factor agreeing with the LTF direction.
      const ltfChochConfirms =
        (ltfDir === "long" && tech?.chochDirection === "bullish") ||
        (ltfDir === "short" && tech?.chochDirection === "bearish");
      const nonTechnicalAgrees =
        Math.sign(breakdown.fundamental) === ltfSign ||
        Math.sign(breakdown.sentiment) === ltfSign;

      if (!ltfChochConfirms || !nonTechnicalAgrees) {
        reasons.push(
          `HTF (${alignment.htfTimeframe} ${alignment.htfStructure}) conflicts with LTF direction without a valid counter-trend confirmation (needs LTF CHoCH + fundamental/positioning agreement).`,
        );
      }
    }
  }

  // ── Gate 6b: adaptive multi-timeframe hierarchy ──────────────────
  // HTF is CONTEXT; LTF is TRIGGER. An LTF signal never flips the HTF bias
  // by itself — only a genuine external BOS/CHoCH on the HTF can do that.
  if (mtf && bias !== "Neutral") {
    const biasDir = bias === "Bullish" ? "long" : "short";
    const biasSign = bias === "Bullish" ? 1 : -1;

    /** Fresh price-action evidence on one timeframe in the trade direction. */
    const hasEvidence = (tfLabel: string | undefined): boolean => {
      if (!tfLabel) return false;
      const entry = mtf.timeframes.find((t) => t.timeframe === tfLabel);
      const smc = entry?.smc;
      if (!smc) return false;
      const dirMatches = (d: "bullish" | "bearish") => (d === "bullish") === (biasSign === 1);
      return (
        (smc.displacement !== undefined && dirMatches(smc.displacement.direction)) ||
        smc.fvgs.some((f) => f.status === "fresh" && dirMatches(f.direction)) ||
        smc.orderBlocks.some((o) => o.status !== "invalidated" && dirMatches(o.direction)) ||
        (smc.recentSweep !== undefined &&
          ((biasSign === 1 && smc.recentSweep.side === "sell_side") ||
            (biasSign === -1 && smc.recentSweep.side === "buy_side")))
      );
    };

    if (mtf.alignment === "INSUFFICIENT_DATA") {
      reasons.push(
        `MTF context insufficient: no readable higher-timeframe structure available (${mtf.unavailable.map((u) => u.timeframe).join(", ") || "HTF chain"}) — macro context cannot be established from market data.`,
      );
    } else if (mtf.alignment === "COUNTER_TREND") {
      if (biasDir !== mtf.htfBias) {
        // Trading AGAINST the dominant HTF: requires a full confirmation
        // chain on the counter side — trigger confirmation + fresh evidence
        // + a non-technical factor agreeing. Otherwise NO_TRADE.
        const triggerConfirms = hasEvidence(mtf.triggerTimeframe);
        const setupChochConfirms =
          tech?.chochDirection != null &&
          ((biasDir === "long" && tech.chochDirection === "bullish") ||
            (biasDir === "short" && tech.chochDirection === "bearish"));
        const nonTechnicalAgrees =
          Math.sign(breakdown.fundamental) === biasSign ||
          Math.sign(breakdown.sentiment) === biasSign;

        if (!(setupChochConfirms && triggerConfirms && nonTechnicalAgrees)) {
          reasons.push(
            `Counter-trend setup against ${mtf.htfTimeframe} ${mtf.htfBias === "long" ? "bullish" : "bearish"} structure lacks the required confirmation chain (needs setup CHoCH + trigger-timeframe fresh evidence + fundamental/positioning agreement). LTF signals alone do not reverse HTF context.`,
          );
        }
      }
      // bias WITH the HTF while lower TFs pull back = buying/selling into
      // a retracement of the dominant trend — valid context.
    } else if (mtf.alignment === "MIXED") {
      // Mixed timeframes need strong remaining confluence to be accountable:
      // a non-technical core factor AND fresh execution evidence must agree.
      const nonTechnicalAgrees =
        Math.sign(breakdown.fundamental) === biasSign ||
        Math.sign(breakdown.sentiment) === biasSign;
      const executionEvidence = hasEvidence(mtf.triggerTimeframe) || hasEvidence(mtf.setupTimeframe);
      // SWING relaxation: when the thesis ALIGNS with the dominant HTF,
      // lower-timeframe disagreement is noise, not a veto (conviction
      // penalty already applies).
      const swingAlignedExemption =
        styleProfile.style === "swing" && biasDir === mtf.htfBias;
      if (!swingAlignedExemption && (!nonTechnicalAgrees || !executionEvidence)) {
        reasons.push(
          `MTF alignment MIXED without a clear trigger: higher and lower timeframes disagree and the remaining confluence (${nonTechnicalAgrees ? "fundamental/positional" : "no fundamental/positional"} support, ${executionEvidence ? "with" : "without"} fresh execution evidence) cannot justify an entry.`,
        );
      }
    }
  }

  // ── Gate 6c: style-specific requirements (Phase 6) ──
  // Horizon requirements reading EXISTING evidence only — no invented data.
  if (bias !== "Neutral") {
    if (styleProfile.requiresTriggerEvidence) {
      const dirMatches = (d: "bullish" | "bearish") => (d === "bullish") === (dirSign === 1);
      const freshExecution = (sm?: NonNullable<NonNullable<typeof tech>["smc"]>): boolean =>
        !!sm &&
        ((sm.displacement !== undefined && dirMatches(sm.displacement.direction)) ||
          sm.fvgs.some((f) => f.status === "fresh" && dirMatches(f.direction)) ||
          (sm.recentSweep !== undefined &&
            ((dirSign === 1 && sm.recentSweep!.side === "sell_side") ||
              (dirSign === -1 && sm.recentSweep!.side === "buy_side"))));
      const trigSmc = mtf?.timeframes.find((t) => t.role === "trigger")?.smc;
      if (!freshExecution(tech?.smc) && !freshExecution(trigSmc)) {
        reasons.push(
          "SCALPING horizon requires fresh execution evidence (displacement, fresh FVG, or a favorable liquidity sweep on the setup/trigger timeframe) — none present.",
        );
      }
    }
    if (styleProfile.eventRiskWindowHours !== null && input.calendarData?.events?.length) {
      const now = Date.now();
      const cutoff = now + styleProfile.eventRiskWindowHours! * 3600e3;
      const imminent = input.calendarData.events.some(
        (e) => e.status === "upcoming" && e.importance === 3 && e.datetime > now && e.datetime <= cutoff,
      );
      if (imminent) {
        reasons.push(
          `INTRADAY horizon: high-impact economic event within ${styleProfile.eventRiskWindowHours}h — event-risk window active.`,
        );
      }
    }
    if (styleProfile.requiresHtfContext) {
      if (!mtf || mtf.alignment === "INSUFFICIENT_DATA" || mtf.htfBias === "none") {
        reasons.push(
          "SWING horizon requires a readable higher-timeframe thesis — HTF context unavailable or unclear.",
        );
      } else if (
        breakdown.fundamental === 0 &&
        !(input.newsContext || input.economicEvents || input.macroData || input.calendarData)
      ) {
        reasons.push(
          "SWING horizon depends on fundamental/macro context — no such context is available for this instrument.",
        );
      }
    }
  }

  // ── Gate 7: structural invalidation & opposing target ──
  let stopLevel: number | undefined;
  let slBasis = "";
  let tpLevel: number | undefined;
  let tpBasis = "";

  if (entry !== undefined && entry > 0) {
    const smcPools = tech?.smc?.liquidityPools ?? [];
    // Higher-timeframe resting liquidity — used ONLY as fallback when the
    // setup timeframe has no pool, and always labeled with its timeframe.
    // Macro/structure roles only; trigger-role levels are too close to mix
    // with higher-timeframe significance.
    const htfPools = (mtf?.timeframes ?? [])
      .filter((t) => t.role === "structure" || t.role === "macro")
      .flatMap((t) =>
        (t.smc?.liquidityPools ?? []).map((p) => ({ ...p, tf: t.timeframe })),
      );

    if (bias === "Bullish") {
      stopLevel = swingSupports[0];
      slBasis = stopLevel !== undefined ? `nearest market swing low (structural${tech?.smc ? `, ${tech.smc.timeframe}` : ""})` : "";
      // Prefer a resting buy-side liquidity pool as target when available,
      // else an HTF pool, else the nearest swing resistance.
      const buyPoolAbove = smcPools
        .filter((p) => p.side === "buy_side" && !p.swept && !p.broken && p.level > price)
        .sort((a, b) => a.level - b.level)[0];
      const htfBuyPool = htfPools
        .filter((p) => p.side === "buy_side" && !p.swept && !p.broken && p.level > price)
        .sort((a, b) => a.level - b.level)[0];
      tpLevel = buyPoolAbove?.level ?? htfBuyPool?.level ?? swingResistances[0];
      tpBasis = buyPoolAbove
        ? `resting buy-side liquidity (${buyPoolAbove.source}, ${buyPoolAbove.touches} touch${buyPoolAbove.touches > 1 ? "es" : ""}${tech?.smc ? `, ${tech.smc.timeframe}` : ""})`
        : htfBuyPool
          ? `resting buy-side liquidity on ${htfBuyPool.tf} (${htfBuyPool.source}, ${htfBuyPool.touches} touch${htfBuyPool.touches > 1 ? "es" : ""}) — HTF target`
          : tpLevel !== undefined
            ? "nearest market swing high / resistance (structural)"
            : "";
    } else if (bias === "Bearish") {
      stopLevel = swingResistances[0];
      slBasis = stopLevel !== undefined ? `nearest market swing high (structural${tech?.smc ? `, ${tech.smc.timeframe}` : ""})` : "";
      const sellPoolBelow = smcPools
        .filter((p) => p.side === "sell_side" && !p.swept && !p.broken && p.level < price)
        .sort((a, b) => b.level - a.level)[0];
      const htfSellPool = htfPools
        .filter((p) => p.side === "sell_side" && !p.swept && !p.broken && p.level < price)
        .sort((a, b) => b.level - a.level)[0];
      tpLevel = sellPoolBelow?.level ?? htfSellPool?.level ?? swingSupports[0];
      tpBasis = sellPoolBelow
        ? `resting sell-side liquidity (${sellPoolBelow.source}, ${sellPoolBelow.touches} touch${sellPoolBelow.touches > 1 ? "es" : ""}${tech?.smc ? `, ${tech.smc.timeframe}` : ""})`
        : htfSellPool
          ? `resting sell-side liquidity on ${htfSellPool.tf} (${htfSellPool.source}, ${htfSellPool.touches} touch${htfSellPool.touches > 1 ? "es" : ""}) — HTF target`
          : tpLevel !== undefined
            ? "nearest market swing low / support (structural)"
            : "";
    }

    if (bias !== "Neutral" && stopLevel !== undefined && tpLevel !== undefined) {
      // Defensive side-validation: every level must sit on the correct side
      // of entry for this trade direction. A violation means the level is
      // not a usable market observation for this thesis.
      const stopValid = bias === "Bullish" ? stopLevel < entry! : stopLevel > entry!;
      const tpValid = bias === "Bullish" ? tpLevel > entry! : tpLevel < entry!;
      if (!stopValid) {
        reasons.push(
          `Invalid structural stop: ${stopLevel} is on the wrong side of entry for a ${bias.toLowerCase()} thesis.`,
        );
        stopLevel = undefined;
        slBasis = "";
      }
      if (!tpValid) {
        reasons.push(
          `Invalid target: ${tpLevel} is on the wrong side of entry for a ${bias.toLowerCase()} thesis.`,
        );
        tpLevel = undefined;
        tpBasis = "";
      }
    }

    if (bias !== "Neutral" && stopLevel === undefined) {
      reasons.push(
        `Insufficient structural confirmation: no market-derived swing ${bias === "Bullish" ? "low below price" : "high above price"} available to anchor the stop loss.`,
      );
    }
    if (bias !== "Neutral" && stopLevel !== undefined && tpLevel === undefined) {
      reasons.push(
        "No opposing structural level available to define a take profit — R:R cannot be computed from market data.",
      );
    }
    // Style target-horizon guard: the REAL level stays real — we simply
    // refuse horizons whose nearest valid target is unreachably far.
    if (
      bias !== "Neutral" &&
      tpLevel !== undefined &&
      styleProfile.targetMaxAtrMultiple !== null &&
      tech?.atr14 !== undefined &&
      tech.atr14 > 0 &&
      Math.abs(tpLevel - entry!) > styleProfile.targetMaxAtrMultiple * tech.atr14
    ) {
      reasons.push(
        `${styleProfile.style.toUpperCase()} target horizon: the nearest valid target is farther than ${styleProfile.targetMaxAtrMultiple}×ATR from entry — outside this horizon.`,
      );
    }
  }

  // ── Gate 8: R:R ──
  let tradePlan: TradePlan | undefined;
  if (
    bias !== "Neutral" &&
    entry !== undefined && entry > 0 &&
    stopLevel !== undefined && tpLevel !== undefined
  ) {
    const risk = Math.abs(entry - stopLevel);
    const reward = Math.abs(tpLevel - entry);
    if (risk <= 0) {
      reasons.push("Structural stop level equals entry price — invalid risk distance.");
    } else {
      const rr = Math.round((reward / risk) * 100) / 100;
      if (rr < MIN_RR) {
        reasons.push(
          `Projected R:R ${rr.toFixed(2)} is below the ${MIN_RR.toFixed(2)} minimum for actionable setups.`,
        );
      } else {
        // Small technical buffer beyond the structural level (ATR-based
        // when available). The buffer is disclosed — the invalidation
        // BASE remains the structural level, never a fixed percentage.
        const buffer = tech?.atr14 !== undefined ? tech.atr14 * 0.2 : 0;
        const sl = bias === "Bullish" ? stopLevel - buffer : stopLevel + buffer;
        const decimals = entry < 10 ? 5 : 2;
        const bufferNote =
          buffer > 0
            ? ` (incl. ${((buffer / entry) * 100).toFixed(3)}% technical ATR buffer beyond structural level)`
            : "";

        tradePlan = {
          direction: bias === "Bullish" ? "long" : "short",
          entry: entry.toString(),
          entryBasis: "live market price at analysis time",
          stopLoss: sl.toFixed(decimals),
          slBasis: `${slBasis}${bufferNote}`,
          takeProfit: tpLevel.toFixed(decimals),
          tpBasis,
          riskReward: rr,
          ...(mtf
            ? {
                htfBias: `${mtf.htfTimeframe ?? "HTF"} ${mtf.htfBias} external structure${mtf.htfReversal ? ` (genuine ${mtf.htfReversal.kind} ${mtf.htfReversal.direction})` : ""}`,
                setupTimeframe: mtf.setupTimeframe,
                ...(mtf.triggerTimeframe
                  ? { triggerTimeframe: mtf.triggerTimeframe }
                  : {}),
              }
            : {}),
        };
      }
    }
  }

  const recommendation: Recommendation =
    tradePlan && reasons.length === 0 ? (bias === "Bullish" ? "LONG" : "SHORT") : "NO_TRADE";

  // ── Phase 3B state integrity ──
  // NO_TRADE is a first-class state: it NEVER carries an executable plan.
  // Entry/SL/TP/R:R exist only for LONG and SHORT — never hidden, always
  // absent when the setup is rejected for any reason.
  const finalPlan = recommendation === "NO_TRADE" ? undefined : tradePlan;

  // ── Conviction — Phase 5 P1c: evidence LAYERS with per-layer caps ──
  // Conviction measures breadth + independence + directional agreement,
  // NOT raw signal count. Sub-signals derived from the same price-event
  // cluster (external structure + BOS from one swing sequence; or
  // displacement + FVG + OB from one candle run) earn graded partial
  // credit inside their layer and can never exceed the layer cap.
  let conviction: ConvictionLevel | undefined;
  let confidence = 0;

  if (recommendation !== "NO_TRADE") {
    let s = 30;
    const biasSign = bias === "Bullish" ? 1 : -1;
    const layerClamp = (v: number, cap: number) => Math.max(-cap, Math.min(cap, v));

    // ── LAYER: multi-timeframe context (cap ±15) ──
    // Alignment as EVIDENCE; unavailable timeframes add nothing.
    {
      let m = 0;
      if (mtf) {
        if (mtf.alignment === "ALIGNED_BULLISH" || mtf.alignment === "ALIGNED_BEARISH") m += 15;
        else if (mtf.alignment === "COUNTER_TREND") m -= 10;
        else if (mtf.alignment === "MIXED") m -= 8;
        // INSUFFICIENT_DATA: no adjustment — uncertainty ≠ strength.

        // A genuine external BOS/CHoCH on the HTF itself is high-value.
        if (mtf.htfReversal) {
          if ((mtf.htfReversal.direction === "bullish") === (biasSign === 1)) m += 6;
          else m -= 6;
        }

        // Trigger-timeframe execution evidence (real detected events only).
        const trig = mtf.timeframes.find((t) => t.role === "trigger")?.smc;
        if (trig) {
          const trigAligned =
            (trig.displacement !== undefined &&
              (trig.displacement.direction === "bullish") === (biasSign === 1)) ||
            trig.fvgs.some(
              (f) =>
                f.status === "fresh" &&
                f.direction === (biasSign === 1 ? "bullish" : "bearish"),
            );
          if (trigAligned) m += 4;
        }
      } else if (alignment?.state === "aligned") m += 15;
      else if (alignment?.state === "counter_trend") m -= 15;
      // legacy htf_unknown / ltf_unclear: no adjustment
      // Cap 18: high enough that a GENUINE HTF reversal (+6) still
      // differentiates within an aligned context, low enough that stacked
      // sub-signals can never masquerade as independent breadth.
      s += layerClamp(m, 18);
    }

    // ── LAYER: structure (cap ±12) — label, BOS and CHoCH usually share
    // one swing sequence, so they earn graded partial credit, capped.
    {
      let st = 0;
      const structDir = tfDirection(tech?.structure, tech?.chochDirection);
      if (structDir === "long" && biasSign === 1) st += 6;
      if (structDir === "short" && biasSign === -1) st += 6;
      if (tech?.bosDirection === "bullish" && biasSign === 1) st += 3;
      if (tech?.bosDirection === "bearish" && biasSign === -1) st += 3;
      if (tech?.chochDirection === "bullish" && biasSign === -1) st -= 6;
      if (tech?.chochDirection === "bearish" && biasSign === 1) st -= 6;
      if (tech?.smc?.internalExternal.internalConflict) st -= 3;
      s += layerClamp(st, 12);
    }

    // ── LAYER: liquidity (cap ±8) — sweep for or against the thesis.
    {
      const sweep = tech?.smc?.recentSweep;
      if (sweep) {
        if ((biasSign === 1 && sweep.side === "sell_side") || (biasSign === -1 && sweep.side === "buy_side")) s += 8;
        else s -= 8;
      }
    }

    // ── LAYER: location / imbalance (cap +8) — displacement, FVG and OB
    // frequently originate from the SAME candle cluster: capped together.
    {
      const smc = tech?.smc;
      if (smc) {
        let imb = 0;
        if (smc.displacement && (smc.displacement.direction === "bullish") === (biasSign === 1)) imb += 4;
        if (smc.fvgs.some((f) => f.status === "fresh" && f.direction === (biasSign === 1 ? "bullish" : "bearish"))) imb += 3;
        if (smc.orderBlocks.some((o) => o.status !== "invalidated" && o.direction === (biasSign === 1 ? "bullish" : "bearish"))) imb += 3;
        s += layerClamp(imb, 8);
      }
    }

    // ── LAYER: VWAP location context (cap +3) — never standalone.
    {
      const vw = tech?.smc?.vwap;
      if (
        vw?.available &&
        ((biasSign === 1 && vw.priceLocation === "above_vwap") ||
          (biasSign === -1 && vw.priceLocation === "below_vwap"))
      )
        s += 3;
    }

    // ── LAYER: fundamental (cap ±15 base) — style-scaled PRIORITY.
    // Intraday keeps exactly the Phase 5 behavior (multiplier 1).
    {
      let f = 0;
      if (Math.sign(breakdown.fundamental) === biasSign) f += 10;
      else if (breakdown.fundamental !== 0) f -= 15;
      f *= styleProfile.fundamentalLayerMultiplier;
      s += layerClamp(Math.round(f), styleProfile.fundamentalLayerCap);
    }

    // ── LAYER: positioning (cap ±12)
    if (Math.sign(breakdown.sentiment) === biasSign) s += 8;
    else if (breakdown.sentiment !== 0) s -= 12;

    // ── LAYER: cross-asset context (cap ±3) — measured correlation +
    // comparator momentum from ACTUAL candles; nothing hardcoded.
    {
      const xa = tech?.crossAsset;
      if (
        xa?.available &&
        xa.correlation !== undefined &&
        xa.directionalContext !== undefined &&
        xa.directionalContext !== "weak" &&
        xa.comparatorMomentum !== undefined &&
        xa.comparatorMomentum !== "flat"
      ) {
        const mom = xa.comparatorMomentum === "up" ? 1 : -1;
        const effectOnInstrumentLong = mom * Math.sign(xa.correlation);
        if ((biasSign === 1 && effectOnInstrumentLong > 0) || (biasSign === -1 && effectOnInstrumentLong < 0)) s += 3;
        else s -= 3;
      }
    }

    // ── LAYER: macro-yield (Phase 7B-1, style-scaled cap ±2/±8/±12) —
    // ACTUAL Treasury nominal/real yields as slow-moving MACRO context.
    // One provider observation = ONE layer (nominal + real + direction are
    // an internal breakdown, never three independent evidences). Zero
    // directional evidence (sub-threshold change / single observation /
    // missing curve) contributes NOTHING: availability ≠ confluence.
    {
      const td: TreasuryData | undefined = input.treasuryData;
      if (td?.available) {
        const ev = deriveMacroYieldEvidence(td);
        const cap = styleProfile.macroYieldLayerCap;
        const instrument = input.instrument.toUpperCase();
        const [rawBase, rawQuote] = instrument.split("/");
        const base = rawBase?.trim().toUpperCase();
        const quote = rawQuote?.trim().toUpperCase();
        const isGold = input.instrumentType === "commodity" && (base === "XAU" || instrument.includes("GOLD"));

        let effectOnLong = 0; // signed magnitude in [-cap..cap] units pre-clamp
        if (isGold) {
          effectOnLong = ev.goldLongEffect * cap;
        } else if (input.instrumentType === "forex" && base && quote) {
          // USD-strength convention as EVIDENCE with magnitude — not a rule:
          // USD/XXX longs benefit from rising USD (positive effect);
          // XXX/USD longs are opposed by it.
          if (base === "USD") effectOnLong = ev.usdStrengthEffect * cap;
          else if (quote === "USD") effectOnLong = -ev.usdStrengthEffect * cap;
        }
        // Crypto/oil/index instruments get NO yield scoring (no honest,
        // verified mapping — refusing to invent one).

        if (effectOnLong !== 0) {
          const contribution = biasSign === 1 ? effectOnLong : -effectOnLong;
          s += layerClamp(Math.round(contribution), cap);
        }
      }
    }

    // ── LAYER: positioning-COT (Phase 7B-2, style-scaled cap ±1/±5/±12).
    // ONE dataset = ONE layer: level + net + change are an internal breakdown,
    // never independent evidences. Directional evidence comes ONLY from the
    // change between two actual consecutive reports, scaled by OI. Level is
    // never scored directionally; crowding surfaces as context/contradiction.
    // Crypto spot has NO COT mapping by design — CoinGlass derivatives data
    // remains the separate crypto positioning source (no double-counting).
    {
      const cd: CotData | undefined = input.cotData;
      if (cd?.available) {
        const ev = deriveCotEvidence(cd);
        const cap = styleProfile.cotLayerCap;
        const side = mapInstrumentToCot(cd.requestedInstrument)?.contractSide ?? "base";
        let effectOnLong = ev.effectOnContractCurrency * cap;
        if (side === "quote") effectOnLong = -effectOnLong; // contract on QUOTE ccy inverts instrument direction
        if (effectOnLong !== 0) {
          const contribution = biasSign === 1 ? effectOnLong : -effectOnLong;
          s += layerClamp(Math.round(contribution), cap);
        }
      }
    }

    // RSI/MACD modifier — small, never decisive
    if (Math.sign(breakdown.indicator) === biasSign) s += 3;
    else if (breakdown.indicator !== 0) s -= 3;

    // Data completeness — CRITICAL gaps penalize conviction; purely
    // informational unavailability notes do NOT (missing data is
    // uncertainty, never negative evidence).
  const INFORMATIONAL_FLAGS = [
    "Volume limitation:",
    "Cross-asset context unavailable",
    "Treasury yield context unavailable",
    "COT positioning context unavailable",
    "Timeframe chain unavailable:",
    "No higher-timeframe structural data",
  ];
    const criticalFlags = flags.filter(
      (f) => !INFORMATIONAL_FLAGS.some((p) => f.startsWith(p)),
    );
    if (completeness === "full") s += 5;
    else if (completeness === "partial") s -= 3;
    s -= criticalFlags.length * 4;

    confidence = Math.round(Math.max(20, Math.min(88, s)));
    conviction = confidence >= 70 ? "High" : confidence >= 50 ? "Medium" : "Low";
  } else {
    // Informational evidence strength for NO_TRADE — NOT a trade conviction.
    const absAvg = Math.abs(coreWeightedAvg);
    confidence = Math.round(Math.max(20, Math.min(55, 30 + absAvg * 20)));
  }

  // ── Key levels output — real levels only, empty when unavailable ──
  const keyLevels: KeyLevels = {
    support: swingSupports[0]?.toString() ?? "",
    resistance: swingResistances[0]?.toString() ?? "",
    invalidation: finalPlan ? finalPlan.stopLoss : "",
  };

  return {
    recommendation,
    noTradeReasons: recommendation === "NO_TRADE" ? reasons : [],
    tradePlan: finalPlan,
    conviction,
    confidence,
    keyLevels,
  };
}

// ── Summary Generators ────────────────────────────────────────────

function generateTechnicalSummary(
  input: AnalysisInput,
  trendScore: FactorScore,
  indicatorScore: FactorScore,
  alignment: HtfAlignment | undefined,
  mtf?: MtfContext,
): string {
  const parts: string[] = [];
  const tech = input.technicalData;
  const md = input.marketData;

  if (tech && tech.dataPoints > 0) {
    // ── Phase 3A: adaptive MTF narrative (supersedes single-slot context) ──
    if (mtf) {
      parts.push(
        `MTF chain actually used: ${mtf.chainUsed.length > 0 ? mtf.chainUsed.join(" → ") : "(none)"} — requested setup: ${mtf.requestedTimeframe}.`,
      );
      if (mtf.unavailable.length > 0) {
        parts.push(
          `Timeframes unavailable (NOT synthesized): ${mtf.unavailable.map((u) => `${u.timeframe} (${u.reason})`).join("; ")}.`,
        );
      }
      const biasDesc =
        mtf.htfBias === "long" ? "bullish" : mtf.htfBias === "short" ? "bearish" : "unknown";
      parts.push(
        `Alignment: ${mtf.alignment} — HTF bias ${biasDesc}${mtf.htfTimeframe ? ` (${mtf.htfTimeframe})` : ""}, setup ${mtf.setupTimeframe}${mtf.triggerTimeframe ? `, trigger ${mtf.triggerTimeframe}` : ""}.`,
      );
      for (const t of mtf.timeframes) {
        const ext = t.smc!.internalExternal.external;
        const int = t.smc!.internalExternal.internal;
        parts.push(
          `${t.timeframe} (${t.role}): external ${ext.structure}, BOS ${ext.bosDirection}, CHoCH ${ext.chochDirection}; internal ${int.structure}${t.smc!.internalExternal.internalConflict ? " — WARNING: internal opposes external" : ""}.`,
        );
      }
      if (mtf.htfReversal) {
        parts.push(
          `Genuine HTF reversal: external ${mtf.htfReversal.kind} ${mtf.htfReversal.direction} on ${mtf.htfReversal.timeframe} — this can legitimately change macro context (LTF signals cannot).`,
        );
      }
    } else if (alignment) {
      const stateDesc =
        alignment.state === "aligned"
          ? "aligned with LTF"
          : alignment.state === "counter_trend"
            ? "CONFLICTS with LTF — counter-trend context"
            : alignment.state === "ltf_unclear"
              ? "LTF direction unclear"
              : "HTF structure unclear for comparison";
      parts.push(`${alignment.htfTimeframe} macro structure: ${alignment.htfStructure} (${stateDesc}).`);
    } else {
      parts.push("No higher-timeframe (D1) structural data available — macro context unverified.");
    }

    // LTF structure
    if (tech.structure === "HH/HL") {
      parts.push("LTF market structure is bullish (Higher Highs / Higher Lows).");
    } else if (tech.structure === "LH/LL") {
      parts.push("LTF market structure is bearish (Lower Highs / Lower Lows).");
    } else if (tech.structure === "range") {
      parts.push("LTF market is in a ranging/consolidation phase — no clear directional structure.");
    }

    // BOS / CHoCH
    if (tech.bosDirection === "bullish") parts.push("Bullish Break of Structure detected.");
    else if (tech.bosDirection === "bearish") parts.push("Bearish Break of Structure detected.");
    if (tech.chochDirection === "bullish") parts.push("Bullish Change of Character — potential reversal to upside.");
    else if (tech.chochDirection === "bearish") parts.push("Bearish Change of Character — potential reversal to downside.");

    // Support / Resistance from swings
    if (tech.supportLevels.length > 0) {
      parts.push(`Key support: ${tech.supportLevels.map((s) => s.toFixed(4)).join(", ")}.`);
    }
    if (tech.resistanceLevels.length > 0) {
      parts.push(`Key resistance: ${tech.resistanceLevels.map((r) => r.toFixed(4)).join(", ")}.`);
    }

    // Volume
    if (tech.volumeTrend !== "unknown") {
      parts.push(`Volume trend: ${tech.volumeTrend}.`);
    }

    // ATR
    if (tech.atr14 !== undefined) {
      parts.push(
        `ATR(14): ${tech.atr14.toFixed(4)} — volatility ${tech.atr14 > 0.02 * (md?.price.price ?? 1) ? "elevated" : "normal"}.`,
      );
    }

    // Cross-asset context (Phase 5) — measured from actual candles only.
    const xa = tech.crossAsset;
    if (xa) {
      if (xa.available && xa.correlation !== undefined) {
        parts.push(
          `Cross-asset: ${xa.comparatorSymbol} correlation ${(xa.correlation * 100).toFixed(0)}% over ${xa.sampleSize} returns (${xa.directionalContext ?? "weak"}) — computed from actual candles, not assumed.`,
        );
      } else if (xa.unavailableReason) {
        parts.push(`Cross-asset context unavailable: ${xa.unavailableReason}`);
      }
    }

    // ── Phase 2 liquidity / FVG / OB / VWAP / Volume Profile context ──
    const smcInfo = tech.smc;
    if (smcInfo) {
      // Liquidity pools
      const restingBuys = smcInfo.liquidityPools
        .filter((p) => p.side === "buy_side" && !p.swept && !p.broken)
        .sort((a, b) => a.level - b.level)
        .slice(0, 2);
      const restingSells = smcInfo.liquidityPools
        .filter((p) => p.side === "sell_side" && !p.swept && !p.broken)
        .sort((a, b) => b.level - a.level)
        .slice(0, 2);
      const fmtPool = (p: { level: number; source: string }) => `${p.level.toFixed(4)} (${p.source})`;
      if (restingBuys.length > 0 || restingSells.length > 0) {
        parts.push(
          `Resting liquidity — buy-side above: ${restingBuys.map(fmtPool).join(", ") || "none detected"}; sell-side below: ${restingSells.map(fmtPool).join(", ") || "none detected"}.`,
        );
      }
      if (smcInfo.recentSweep) {
        parts.push(
          `Recent sweep: ${smcInfo.recentSweep.side} ${smcInfo.recentSweep.source} at ${smcInfo.recentSweep.level.toFixed(4)} — wick pierced, close rejected back (sweep, not breakout).`,
        );
      }

      // Internal vs external structure note
      if (smcInfo.internalExternal.internalConflict) {
        parts.push("Internal structure currently opposes external structure — minor-degree warning only.");
      }

      // FVGs
      const freshFvgs = smcInfo.fvgs.filter((f) => f.status === "fresh").slice(0, 2);
      if (freshFvgs.length > 0) {
        parts.push(
          `Fresh FVGs: ${freshFvgs.map((f) => `${f.direction} ${f.lower.toFixed(4)}–${f.upper.toFixed(4)}`).join("; ")}.`,
        );
      }

      // Displacement
      if (smcInfo.displacement) {
        parts.push(
          `Displacement: ${smcInfo.displacement.direction} candle (${smcInfo.displacement.bodyRatio} body/ratio, ${smcInfo.displacement.rangeAtrMultiple}× ATR range).`,
        );
      }

      // Validated Order Blocks
      const obs = smcInfo.orderBlocks.slice(0, 2);
      if (obs.length > 0) {
        parts.push(
          `Validated order blocks: ${obs.map((o) => `${o.direction} ${o.lower.toFixed(4)}–${o.upper.toFixed(4)} (${o.status}, displacement ${o.evidence.displacementRangeAtr}× ATR)`).join("; ")}.`,
        );
      }

      // VWAP context
      if (smcInfo.vwap.available) {
        const v = smcInfo.vwap;
        let vwapLine = `Session VWAP: ${v.sessionVwap?.toFixed(4)} — price ${v.priceLocation.replace("_", " ")}.`;
        if (v.bands) {
          vwapLine += ` Bands ±1σ: ${v.bands.minus1.toFixed(4)}–${v.bands.plus1.toFixed(4)}.`;
        }
        if (v.anchoredVwap) {
          vwapLine += ` Anchored VWAP: ${v.anchoredVwap.value.toFixed(4)}.`;
        }
        vwapLine += " Context/location tool only — not a standalone signal.";
        parts.push(vwapLine);
      } else if (smcInfo.vwap.unavailableReason) {
        parts.push(`VWAP unavailable: ${smcInfo.vwap.unavailableReason}`);
      }

      // Volume profile
      if (smcInfo.volumeProfile.available) {
        const vp = smcInfo.volumeProfile;
        parts.push(
          `Volume profile — POC ${vp.poc?.toFixed(4)}, VAH ${vp.vah?.toFixed(4)}, VAL ${vp.val?.toFixed(4)}.`,
        );
      } else if (smcInfo.volumeProfile.unavailableReason) {
        parts.push(`Volume profile unavailable: ${smcInfo.volumeProfile.unavailableReason}`);
      }
    }

    // LTF trigger context
    if (tech.ltfTrigger) {
      parts.push(
        `LTF trigger (${tech.ltfTrigger.timeframe}): ${tech.ltfTrigger.structure}${tech.ltfTrigger.chochDirection !== "none" ? `, CHoCH ${tech.ltfTrigger.chochDirection}` : ""}.`,
      );
    }

    // Secondary momentum context — explicitly non-decisive
    if (tech.rsi14 !== undefined) {
      const rsiLabel = tech.rsi14 > 70 ? "overbought" : tech.rsi14 < 30 ? "oversold" : "neutral";
      parts.push(`RSI(14): ${tech.rsi14} (${rsiLabel}) — secondary context only.`);
    }
    if (tech.macdHistogram !== undefined) {
      parts.push(`MACD histogram: ${tech.macdHistogram > 0 ? "positive" : "negative"} — secondary context only.`);
    }
  } else if (input.currentPrice && input.recentHigh && input.recentLow) {
    if (trendScore >= 1) {
      parts.push("Price is positioned in the upper range near recent highs, suggesting bullish market structure.");
    } else if (trendScore <= -1) {
      parts.push("Price is positioned in the lower range near recent lows, suggesting bearish market structure.");
    } else {
      parts.push("Price is trading mid-range with no clear directional bias from structure alone.");
    }
  } else {
    parts.push("No technical data available for analysis.");
  }

  if (indicatorScore === 0 && (!tech || tech.dataPoints === 0)) {
    parts.push("Momentum indicators unavailable — scored neutral (secondary factor).");
  }

  return parts.join(" ");
}

function generateFundamentalSummary(input: AnalysisInput, fundamentalScore: FactorScore): string {
  const parts: string[] = [];
  const macro = input.macroData;
  const fund = input.fundamentalData;
  const sentiment = input.sentimentData;

  if (macro && macro.confidence !== "unavailable") {
    parts.push(`Macro context (${macro.confidence} confidence): ${macro.summary}`);
    if (macro.dxyTrend && (input.instrumentType === "forex" || input.instrumentType === "commodity")) {
      parts.push(`USD strength context: ${macro.dxyTrend} (NEWS-derived proxy, not actual DXY price data).`);
    }
  }

  // Honest unavailability notes for asset classes without real providers.
  if (input.instrumentType === "commodity") {
    const sym = input.instrument.toUpperCase();
    if (/XAU|XAG|GOLD|SILVER/.test(sym)) {
      parts.push("Real-yield context UNAVAILABLE — no yields provider integrated; gold fundamentals use news/calendar/USD-proxy context only.");
    } else {
      parts.push("Supply/inventory data UNAVAILABLE — no inventory provider integrated; commodity fundamentals use news-derived context only.");
    }
  }

  if (fund && fund.available && input.instrumentType === "stock") {
    parts.push(`Fundamentals — ${fund.name || fund.symbol}:`);
    if (fund.peRatio !== undefined) parts.push(`P/E: ${fund.peRatio.toFixed(1)}`);
    if (fund.earningsPerShare !== undefined) parts.push(`EPS: $${fund.earningsPerShare.toFixed(2)}`);
    if (fund.profitMargin !== undefined) parts.push(`Margin: ${(fund.profitMargin * 100).toFixed(1)}%`);
    if (fund.marketCap !== undefined) parts.push(`Mkt Cap: $${(fund.marketCap / 1e9).toFixed(1)}B`);
    if (fund.sector) parts.push(`Sector: ${fund.sector} (sector-relative strength UNAVAILABLE — no benchmark provider)`);
    if (fund.latestEarnings?.date) parts.push(`Latest earnings: ${fund.latestEarnings.date}`);
  } else if (fund && !fund.available && fund.unavailableReason) {
    parts.push(fund.unavailableReason);
  }

  if (sentiment && sentiment.confidence !== "unavailable") {
    parts.push(
      `News sentiment: ${sentiment.label} (${sentiment.averageScore > 0 ? "+" : ""}${sentiment.averageScore.toFixed(2)} avg, ${sentiment.articleCount} articles, ${sentiment.confidence} confidence).`,
    );
  }

  const cal = input.calendarData;
  if (cal && cal.confidence !== "unavailable" && cal.events.length > 0) {
    parts.push(`Macro risk: ${cal.macroRisk.level.toUpperCase()} — ${cal.macroRisk.explanation}`);

    const releasedHighImpact = cal.events.filter(
      (e) => e.status === "released" && e.importance === 3 && e.actual !== undefined && e.forecast !== undefined,
    );
    if (releasedHighImpact.length > 0) {
      const eventSummaries = releasedHighImpact.slice(0, 3).map((e) => {
        const actualNum = typeof e.actual === "number" ? e.actual : parseFloat(String(e.actual));
        const forecastNum = typeof e.forecast === "number" ? e.forecast : parseFloat(String(e.forecast));
        const surprise = !isNaN(actualNum) && !isNaN(forecastNum) ? actualNum - forecastNum : undefined;
        const surpriseStr = surprise !== undefined ? ` (surprise: ${surprise > 0 ? "+" : ""}${surprise})` : "";
        return `${e.event} [${e.currency}]: actual ${e.actual} vs forecast ${e.forecast}${surpriseStr}`;
      });
      parts.push(`Recent high-impact: ${eventSummaries.join("; ")}.`);
    }

    const upcomingHighImpact = cal.events.filter((e) => e.status === "upcoming" && e.importance === 3);
    if (upcomingHighImpact.length > 0) {
      const eventNames = upcomingHighImpact.slice(0, 3).map((e) => {
        const hrs = Math.round((e.datetime - Date.now()) / (1000 * 60 * 60));
        return `${e.event} [${e.currency}] in ${hrs}h`;
      });
      parts.push(`Upcoming high-impact: ${eventNames.join(", ")}.`);
    }
  }

  if (parts.length === 0) {
    if (input.instrumentType === "forex") {
      parts.push("Forex fundamental context: No economic calendar or news data available.");
    } else if (input.instrumentType === "crypto") {
      parts.push("Crypto fundamental context: No news or on-chain data available.");
    } else if (input.instrumentType === "stock") {
      parts.push("Stock fundamental data not available — analysis is technical/structure-based only.");
    } else {
      parts.push("Fundamental data not available — analysis is technical/structure-based only.");
    }
  }

  if (fundamentalScore === 0) {
    parts.push("Fundamental factors scored neutral — insufficient data to form a directional conviction.");
  }

  return parts.join(" ");
}

function generateRiskNote(
  recommendation: Recommendation,
  conviction: ConvictionLevel | undefined,
  confidence: number,
  tradePlan: TradePlan | undefined,
  noTradeReasons: string[],
  keyLevels: KeyLevels,
  positionSizing?: PositionSizingResult,
  /** Phase 7B-3: exact spec/conflict reason when sizing is blocked on a tradeable thesis. */
  sizingUnavailableReason?: string,
): string {
  const parts: string[] = [];

  if (recommendation === "NO_TRADE") {
    parts.push("NO TRADE — this setup does not meet the execution standard.");
    if (noTradeReasons.length > 0) {
      parts.push(`Reasons: ${noTradeReasons.join(" ")}`);
    }
    parts.push(
      "The setup becomes valid when: core factors align in one direction with at least two agreeing, a market-derived structural invalidation exists, an opposing structural level defines a target, and the projected R:R is at least 1.5.",
    );
    if (keyLevels.support || keyLevels.resistance) {
      parts.push(`Watch levels — support: ${keyLevels.support || "n/a"}, resistance: ${keyLevels.resistance || "n/a"}.`);
    }
  } else if (tradePlan) {
    parts.push(
      `${recommendation} plan — entry ${tradePlan.entry} (${tradePlan.entryBasis}), SL ${tradePlan.stopLoss} (${tradePlan.slBasis}), TP ${tradePlan.takeProfit} (${tradePlan.tpBasis}). R:R ${tradePlan.riskReward.toFixed(2)}.`,
    );
    if (positionSizing?.available) {
      const conv = positionSizing.conversion;
      const convStr =
        conv && conv.direction !== "same"
          ? ` (quote→account ${conv.from}→${conv.to} via ${conv.direction} rate ${conv.rate.toFixed(5)}, source: ${conv.source})`
          : "";
      parts.push(
        `Conviction ${conviction} at ${confidence}% evidence strength. Position size for the provided account inputs: ${positionSizing.quantity} ${positionSizing.quantityUnit ?? "units"} at ${(positionSizing.appliedRiskPercent! * 100).toFixed(2)}% risk — risking ≈${positionSizing.riskAmount?.toFixed(2)} ${positionSizing.denominationCurrency ?? ""} if the structural stop is hit${convStr}. Specification source: ${positionSizing.specificationSource ?? "user-provided"}. This reflects YOUR chosen risk, not a recommendation of what is optimal.`,
      );
    } else {
      parts.push(
        `Conviction ${conviction} at ${confidence}% evidence strength. Position sizing unavailable${sizingUnavailableReason ? ` (${sizingUnavailableReason})` : ""} — it requires your account equity, your own risk-per-trade choice, and a complete instrument specification (contract size, quote currency, quantity step); none are assumed on your behalf. As general guidance only, many traders risk 1–2% per trade, but that is not optimal for every account or instrument.`,
      );
    }
    parts.push(
      `Invalidation: thesis is void if price trades through ${tradePlan.stopLoss} or if structure/HTF context changes against the position.`,
    );
  }

  parts.push("This is NOT financial advice. Always verify with your own analysis and risk management rules.");

  return parts.join(" ");
}

// ── Main Analysis Function ────────────────────────────────────────

export function runAnalysis(input: AnalysisInput): AnalysisResult {
  const { completeness, flags } = assessDataCompleteness(input);
  const styleProfile = resolveStyle(input.tradingStyle);

  const trendScore = scoreTrend(input);
  const indicatorScore = scoreIndicators(input);
  const fundamentalScore = scoreFundamentals(input);
  const sentimentScore = scoreSentiment(input);

  const breakdown: BiasBreakdown = {
    trend: trendScore,
    indicator: indicatorScore,
    fundamental: fundamentalScore,
    sentiment: sentimentScore,
  };

  const { bias, coreWeightedAvg } = calculateBias(breakdown);
  const alignment = computeAlignment(input);
  const mtf = input.technicalData?.mtf;

  // ── Phase 5: market context (regime, setup class, contradictions) ──
  const marketRegime = detectMarketRegime({
    technicalData: input.technicalData,
    candles: input.marketData?.candles,
  });
  const setupClassification = classifySetup({
    mtf,
    technicalData: input.technicalData,
    regime: marketRegime.regime,
    ...(bias === "Bullish" ? { biasDir: "long" as const } : bias === "Bearish" ? { biasDir: "short" as const } : {}),
  });

  const decision = decideTrade(
    input,
    bias,
    breakdown,
    coreWeightedAvg,
    completeness,
    flags,
    alignment,
    mtf,
  );

  // Contradictions: DECISIVE severity is derived from the actual gates —
  // a triggered rejection reason marks its domain decisive.
  const keyContradictions = detectContradictions({
    mtf,
    technicalData: input.technicalData,
    breakdown,
    bias,
    regime: marketRegime.regime,
  }).map((c) => {
    if (decision.noTradeReasons.length === 0) return c;
    const decisiveDomains = decision.noTradeReasons.join(" ");
    if (c.severity === "MATERIAL" && /conflict|counter-trend|MIXED/i.test(decisiveDomains)) {
      return { ...c, severity: "DECISIVE" as const };
    }
    return c;
  });

  const biasSignOuter = bias === "Bullish" ? 1 : bias === "Bearish" ? -1 : 0;
  // Phase 7B-1 — macro-yield contradiction: ACTUAL Treasury evidence that
  // OPPOSES the thesis is surfaced explicitly (MINOR/MATERIAL by magnitude).
  // It never becomes DECISIVE on its own — only existing gates can force
  // NO_TRADE.
  if (biasSignOuter !== 0 && input.treasuryData?.available) {
    const evM = deriveMacroYieldEvidence(input.treasuryData);
    const instParts = input.instrument.toUpperCase().split("/");
    const baseCcy = instParts[0]?.trim().toUpperCase();
    const quoteCcy = instParts[1]?.trim().toUpperCase();
    const isGoldInstr =
      input.instrumentType === "commodity" &&
      (baseCcy === "XAU" || input.instrument.toUpperCase().includes("GOLD"));
    let yieldEffectOnLong = 0;
    if (isGoldInstr) yieldEffectOnLong = evM.goldLongEffect;
    else if (input.instrumentType === "forex" && baseCcy && quoteCcy) {
      if (baseCcy === "USD") yieldEffectOnLong = evM.usdStrengthEffect;
      else if (quoteCcy === "USD") yieldEffectOnLong = -evM.usdStrengthEffect;
    }
    if ((biasSignOuter === 1 && yieldEffectOnLong < 0) || (biasSignOuter === -1 && yieldEffectOnLong > 0)) {
      keyContradictions.push({
        description: `${bias!.toLowerCase()} thesis vs opposing Treasury yield context (${evM.notes.find((n) => /changed|REAL/.test(n)) ?? "macro-yield direction disagrees"})`,
        severity: Math.abs(yieldEffectOnLong) >= 0.6 ? "MATERIAL" : "MINOR",
      });
    }
  }

  // Phase 7B-2 — COT contradiction: opposing weekly futures positioning and
  // crowding are surfaced explicitly. COT alone can never be DECISIVE.
  if (biasSignOuter !== 0 && input.cotData?.available) {
    const evC = deriveCotEvidence(input.cotData);
    const side = mapInstrumentToCot(input.cotData.requestedInstrument)?.contractSide ?? "base";
    let cotEffectOnLong = evC.effectOnContractCurrency;
    if (side === "quote") cotEffectOnLong = -cotEffectOnLong;
    const crowdSuffix =
      evC.crowded && evC.crowdRatio !== undefined
        ? ` — crowded positioning (${Math.round(evC.crowdRatio * 100)}% of OI) may amplify reversal risk`
        : "";
    if (
      (cotEffectOnLong < 0 && input.cotData.changeFromPreviousReport !== undefined) ||
      (evC.crowded && biasSignOuter === 1 && input.cotData.netNonCommercial > 0)
    ) {
      keyContradictions.push({
        description: `${bias!.toLowerCase()} thesis vs CFTC futures positioning context${crowdSuffix}`,
        severity: Math.abs(cotEffectOnLong) >= 0.6 ? "MATERIAL" : "MINOR",
      });
    }
  }

  const technicalSummary = generateTechnicalSummary(
    input,
    trendScore,
    indicatorScore,
    alignment,
    mtf,
  );
  const fundamentalSummary = generateFundamentalSummary(input, fundamentalScore);

  // ── Phase 3B/4: position sizing — ONLY from complete real inputs ──
  // Never fabricated. Spec resolution is honest-partial: quote currency may
  // come from literal symbol structure; contract size / quantity step exist
  // ONLY when explicitly supplied. Currency conversion uses live provider FX
  // snapshots — never constants, never silent inversion.
  let positionSizing: PositionSizingResult | undefined;
  let specUnavailableReason: string | undefined;
  if (decision.recommendation !== "NO_TRADE" && decision.tradePlan) {
    // Phase 7B-3 — OKX contract metadata feeds the spec hierarchy
    // (explicit > verified OKX > unavailable). Conflicting values BLOCK
    // sizing rather than silently picking a side. Risk data only: this can
    // never influence bias, conviction, or the trade decision.
    const resolvedSpec = resolveInstrumentSpec({
      instrument: input.instrument,
      explicitSpec: input.instrumentSpec,
      okx: input.okxSpecData,
    });
    const specConflicted =
      resolvedSpec.status === "conflict" || (resolvedSpec.conflicts?.length ?? 0) > 0;
    if (resolvedSpec.status !== "available") {
      specUnavailableReason = resolvedSpec.unavailableReason;
    }
    const sizing = specConflicted
      ? ({ available: false, unavailableReason: resolvedSpec.unavailableReason ?? "specification conflict" } as PositionSizingResult)
      : computePositionSizing({
          equity: input.accountEquity ?? NaN,
          riskPercent: input.riskPercent ?? NaN,
          entry: parseFloat(decision.tradePlan.entry),
          stopLoss: parseFloat(decision.tradePlan.stopLoss),
          spec: resolvedSpec.status === "unavailable" ? undefined : resolvedSpec.spec,
          accountCurrency: input.accountCurrency,
          fxDirect: input.fxRates?.direct,
          fxInverse: input.fxRates?.inverse,
        });
    if (sizing.available) positionSizing = sizing;
  }

  const riskNote = generateRiskNote(
    decision.recommendation,
    decision.conviction,
    decision.confidence,
    decision.tradePlan,
    decision.noTradeReasons,
    decision.keyLevels,
    positionSizing,
    !positionSizing?.available && decision.recommendation !== "NO_TRADE"
      ? specUnavailableReason
      : undefined,
  );

  // Phase 3A — compact MTF transparency summary for the UI.
  const mtfSummary: MtfSummary | undefined = mtf
    ? {
        alignment: mtf.alignment,
        chainUsed: mtf.chainUsed,
        unavailable: mtf.unavailable.map((u) => ({
          timeframe: u.timeframe,
          reason: u.reason,
        })),
        htfBias: mtf.htfBias,
        setupTimeframe: mtf.setupTimeframe,
        triggerTimeframe: mtf.triggerTimeframe,
      }
    : undefined;

  return {
    id: `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instrument: input.instrument.toUpperCase(),
    instrumentType: input.instrumentType,
    timeframe: input.timeframe,
    bias,
    confidence: decision.confidence,
    recommendation: decision.recommendation,
    conviction: decision.conviction,
    noTradeReasons: decision.noTradeReasons,
    tradePlan: decision.tradePlan,
    htfAlignment: alignment,
    mtfSummary,
    marketRegime,
    setupClassification,
    keyContradictions,
    tradingStyle: styleProfile.style,
    styleInfo: {
      setupTimeframeUsed: input.timeframe,
      requestedTimeframe: input.requestedTimeframe,
      fallbackApplied:
        !!input.requestedTimeframe && input.requestedTimeframe !== input.timeframe,
      notes: input.styleNotes ?? [],
    },
    technicalSummary,
    fundamentalSummary,
    breakdown,
    keyLevels: decision.keyLevels,
    riskNote,
    positionSizing,
    dataCompleteness: completeness,
    dataFlags: flags,
    timestamp: Date.now(),
    priceSnapshot: input.marketData?.price,
    technicalData: input.technicalData,
    dataSource: input.marketData?.provider,
    sentimentData: input.sentimentData,
    fundamentalData: input.fundamentalData,
    macroData: input.macroData,
    derivativesData: input.derivativesData,
    calendarData: input.calendarData,
    treasuryContext: input.treasuryData?.available ? input.treasuryData : undefined,
    cotContext: input.cotData?.available ? input.cotData : undefined,
  };
}

// ── Presets ───────────────────────────────────────────────────────

export const POPULAR_INSTRUMENTS = [
  { symbol: "EUR/USD", type: "forex" as const, label: "Euro / US Dollar" },
  { symbol: "GBP/USD", type: "forex" as const, label: "British Pound / US Dollar" },
  { symbol: "USD/JPY", type: "forex" as const, label: "US Dollar / Japanese Yen" },
  { symbol: "BTC/USD", type: "crypto" as const, label: "Bitcoin" },
  { symbol: "ETH/USD", type: "crypto" as const, label: "Ethereum" },
  { symbol: "SOL/USD", type: "crypto" as const, label: "Solana" },
  { symbol: "XAU/USD", type: "commodity" as const, label: "Gold" },
  { symbol: "AAPL", type: "stock" as const, label: "Apple Inc." },
];

export const TIMEFRAMES: { value: string; label: string }[] = [
  { value: "M15", label: "15 Minutes" },
  { value: "H1", label: "1 Hour" },
  { value: "H4", label: "4 Hour" },
  { value: "D1", label: "Daily" },
  { value: "W1", label: "Weekly" },
];

export const MIN_RR_THRESHOLD = MIN_RR;
