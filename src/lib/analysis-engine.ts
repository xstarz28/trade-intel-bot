import type {
  AnalysisInput,
  AnalysisResult,
  BiasBreakdown,
  DirectionalBias,
  FactorScore,
  KeyLevels,
} from "@/types/analysis";
import type { MarketData, TechnicalData, PriceSnapshot } from "@/lib/data/market-types";

export type { AnalysisInput, AnalysisResult, BiasBreakdown, DirectionalBias, FactorScore, KeyLevels };
export type { InstrumentType, Timeframe } from "@/types/analysis";

// ── Weights from the methodology ──────────────────────────────────

const WEIGHTS = {
  trend: 0.3,
  indicator: 0.25,
  fundamental: 0.25,
  sentiment: 0.2,
} as const;

function clampScore(score: number): FactorScore {
  return Math.max(-2, Math.min(2, Math.round(score))) as FactorScore;
}

// ── Bias Calculation ──────────────────────────────────────────────

function calculateBias(breakdown: BiasBreakdown): {
  bias: DirectionalBias;
  weightedAvg: number;
  confidence: number;
} {
  const weightedAvg =
    breakdown.trend * WEIGHTS.trend +
    breakdown.indicator * WEIGHTS.indicator +
    breakdown.fundamental * WEIGHTS.fundamental +
    breakdown.sentiment * WEIGHTS.sentiment;

  let bias: DirectionalBias = "Neutral";
  if (weightedAvg > 0.25) bias = "Bullish";
  else if (weightedAvg < -0.25) bias = "Bearish";

  const scores = [breakdown.trend, breakdown.indicator, breakdown.fundamental, breakdown.sentiment];
  const absAvg = Math.abs(weightedAvg);
  const allSameDirection = scores.every((s) => s >= 0) || scores.every((s) => s <= 0);
  const hasStrongScores = scores.some((s) => Math.abs(s) === 2);

  let confidence = Math.min(95, 40 + absAvg * 25);
  if (allSameDirection) confidence += 10;
  if (hasStrongScores) confidence += 5;
  if (bias === "Neutral") confidence = Math.min(confidence, 55);

  return {
    bias,
    weightedAvg: Math.round(weightedAvg * 100) / 100,
    confidence: Math.round(Math.min(95, Math.max(20, confidence))),
  };
}

// ── Trend / Structure Scoring ─────────────────────────────────────

function scoreTrend(input: AnalysisInput): FactorScore {
  const tech = input.technicalData;
  const md = input.marketData;

  // ── Auto-fetched data path (preferred) ──
  if (tech && tech.dataPoints >= 5) {
    let score = 0;

    // Market structure: HH/HL → bullish, LH/LL → bearish
    if (tech.structure === "HH/HL") score += 1;
    else if (tech.structure === "LH/LL") score -= 1;

    // BOS adds confirmation
    if (tech.bosDirection === "bullish") score += 1;
    else if (tech.bosDirection === "bearish") score -= 1;

    // CHoCH reversal signal
    if (tech.chochDirection === "bearish") score -= 1;
    if (tech.chochDirection === "bullish") score += 1;

    // Price relative to moving averages
    const price = md?.price.price ?? 0;
    if (price > 0) {
      if (tech.sma50 && tech.sma200) {
        if (price > tech.sma50 && tech.sma50 > tech.sma200) score += 1;
        if (price < tech.sma50 && tech.sma50 < tech.sma200) score -= 1;
      }
    }

    return clampScore(score);
  }

  // ── Manual input fallback ──
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

// ── Indicator Confirmation Scoring ────────────────────────────────

function scoreIndicators(input: AnalysisInput): FactorScore {
  const tech = input.technicalData;

  // ── Auto-fetched data path ──
  if (tech && tech.dataPoints >= 14) {
    let score = 0;

    // RSI
    if (tech.rsi14 !== undefined) {
      if (tech.rsi14 > 70) score -= 1; // Overbought → bearish
      else if (tech.rsi14 < 30) score += 1; // Oversold → bullish
      // Divergence overrides
      if (tech.rsiDivergence === "bullish") score += 1;
      if (tech.rsiDivergence === "bearish") score -= 1;
    }

    // MACD
    if (tech.macdHistogram !== undefined) {
      if (tech.macdHistogram > 0) score += 1;
      else if (tech.macdHistogram < 0) score -= 1;
    }

    // Volume confirmation
    if (tech.volumeTrend === "increasing") {
      // Increasing volume confirms the direction
      if (score > 0) score += 1;
      else if (score < 0) score -= 1;
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

// ── Fundamental Scoring ───────────────────────────────────────────

function scoreFundamentals(input: AnalysisInput): FactorScore {
  let score = 0;
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
  }

  return clampScore(score);
}

// ── Sentiment / Positioning Scoring ───────────────────────────────

function scoreSentiment(input: AnalysisInput): FactorScore {
  let score = 0;

  if (input.fundingRate) {
    const fr = parseFloat(input.fundingRate);
    if (!isNaN(fr)) {
      if (fr > 0.05) score -= 1; // Overcrowded long → contrarian bearish
      if (fr < -0.05) score += 1; // Overcrowded short → contrarian bullish
    }
  }

  // Volume as a sentiment proxy from auto-fetched data
  const tech = input.technicalData;
  if (tech && tech.dataPoints >= 20) {
    // High volume during a downtrend can indicate capitulation (bullish)
    if (tech.volumeTrend === "increasing" && tech.structure === "LH/LL") score += 1;
    // High volume during uptrend can indicate euphoria (bearish)
    if (tech.volumeTrend === "increasing" && tech.structure === "HH/HL") score -= 1;
  }

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
  if (!input.newsContext) {
    flags.push("No news context — fundamental analysis limited to technicals");
    missing++;
  }
  if (!input.economicEvents && input.instrumentType === "forex") {
    flags.push("No economic calendar data — macro events not factored");
    missing++;
  }
  if (input.instrumentType === "crypto" && !input.fundingRate) {
    flags.push("No funding rate data — sentiment analysis limited");
    missing++;
  }

  let completeness: "full" | "partial" | "limited" = "full";
  if (hasMarketData && hasTechnical) completeness = "full";
  else if (hasMarketData || hasTechnical) completeness = "partial";
  else completeness = "limited";

  if (missing >= 3) completeness = "limited";

  return { completeness, flags };
}

// ── Summary Generators ────────────────────────────────────────────

function generateTechnicalSummary(
  input: AnalysisInput,
  trendScore: FactorScore,
  indicatorScore: FactorScore,
): string {
  const parts: string[] = [];
  const tech = input.technicalData;
  const md = input.marketData;

  if (tech && tech.dataPoints > 0) {
    // Structure
    if (tech.structure === "HH/HL") {
      parts.push("Market structure is bullish (Higher Highs / Higher Lows).");
    } else if (tech.structure === "LH/LL") {
      parts.push("Market structure is bearish (Lower Highs / Lower Lows).");
    } else if (tech.structure === "range") {
      parts.push("Market is in a ranging/consolidation phase — no clear directional structure.");
    }

    // BOS / CHoCH
    if (tech.bosDirection === "bullish") parts.push("Bullish Break of Structure detected.");
    else if (tech.bosDirection === "bearish") parts.push("Bearish Break of Structure detected.");
    if (tech.chochDirection === "bullish") parts.push("Bullish Change of Character — potential reversal to upside.");
    else if (tech.chochDirection === "bearish") parts.push("Bearish Change of Character — potential reversal to downside.");

    // Moving averages
    if (tech.sma50 && tech.sma100 && tech.sma200) {
      if (tech.sma50 > tech.sma200) {
        parts.push(`MA alignment bullish: SMA50 (${tech.sma50.toFixed(4)}) > SMA200 (${tech.sma200.toFixed(4)}).`);
      } else {
        parts.push(`MA alignment bearish: SMA50 (${tech.sma50.toFixed(4)}) < SMA200 (${tech.sma200.toFixed(4)}).`);
      }
    }

    // RSI
    if (tech.rsi14 !== undefined) {
      const rsiLabel = tech.rsi14 > 70 ? "overbought" : tech.rsi14 < 30 ? "oversold" : "neutral";
      parts.push(`RSI(14): ${tech.rsi14} (${rsiLabel}).`);
      if (tech.rsiDivergence === "bullish") parts.push("Bullish RSI divergence detected.");
      if (tech.rsiDivergence === "bearish") parts.push("Bearish RSI divergence detected.");
    }

    // MACD
    if (tech.macdHistogram !== undefined) {
      parts.push(`MACD histogram: ${tech.macdHistogram > 0 ? "positive (bullish)" : "negative (bearish)"}.`);
    }

    // Support / Resistance
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
      parts.push(`ATR(14): ${tech.atr14.toFixed(4)} — volatility ${tech.atr14 > 0.02 * (md?.price.price ?? 1) ? "elevated" : "normal"}.`);
    }
  } else if (input.currentPrice && input.recentHigh && input.recentLow) {
    // Manual fallback
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
    parts.push("Indicator confirmation unavailable — scored neutral.");
  }

  return parts.join(" ");
}

function generateFundamentalSummary(
  input: AnalysisInput,
  fundamentalScore: FactorScore,
): string {
  const parts: string[] = [];

  if (input.instrumentType === "forex") {
    parts.push("Forex fundamental context:");
    if (input.economicEvents) {
      parts.push(`Economic events: ${input.economicEvents}`);
    } else {
      parts.push("No economic calendar data supplied. For full analysis, provide upcoming NFP, CPI, rate decisions.");
    }
    if (input.newsContext) {
      parts.push(`Market news: ${input.newsContext}`);
    }
  } else if (input.instrumentType === "crypto") {
    parts.push("Crypto fundamental context:");
    if (input.newsContext) {
      parts.push(`News/catalysts: ${input.newsContext}`);
    } else {
      parts.push("No on-chain or regulatory news supplied. For full analysis, provide ETF flows, regulatory developments.");
    }
  } else {
    parts.push("Fundamental data not provided — analysis is technical/structure-based only.");
  }

  if (fundamentalScore === 0) {
    parts.push("Fundamental factors scored neutral — insufficient data to form a directional conviction.");
  }

  return parts.join(" ");
}

function generateRiskNote(bias: DirectionalBias, confidence: number, keyLevels: KeyLevels): string {
  const parts: string[] = [];

  parts.push(
    `With a ${bias.toLowerCase()} bias at ${confidence}% confidence, ` +
    `use conservative position sizing (1-2% account risk per trade).`
  );

  if (bias === "Bullish") {
    parts.push(
      `Consider entries near support at ${keyLevels.support} with a stop below ${keyLevels.invalidation}. ` +
      `First target at ${keyLevels.resistance}.`
    );
  } else if (bias === "Bearish") {
    parts.push(
      `Consider entries near resistance at ${keyLevels.resistance} with a stop above ${keyLevels.invalidation}. ` +
      `First target at ${keyLevels.support}.`
    );
  } else {
    parts.push(
      `No clear directional edge — wait for a catalyst or breakout above ${keyLevels.resistance} / below ${keyLevels.support} before committing.`
    );
  }

  if (confidence < 50) {
    parts.push("⚠️ Low confidence — reduce position size or wait for higher-conviction setup.");
  }

  parts.push("This is NOT financial advice. Always verify with your own analysis and risk management rules.");

  return parts.join(" ");
}

// ── Main Analysis Function ────────────────────────────────────────

export function runAnalysis(input: AnalysisInput): AnalysisResult {
  const { completeness, flags } = assessDataCompleteness(input);

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

  const { bias, confidence } = calculateBias(breakdown);

  // Derive key levels from technical data or fallback to manual input
  const tech = input.technicalData;
  const md = input.marketData;
  const currentPrice = md?.price.price ?? (input.currentPrice ? parseFloat(input.currentPrice) : 0);

  let keyLevels: KeyLevels;
  if (tech && tech.supportLevels.length > 0 && tech.resistanceLevels.length > 0) {
    const nearestSupport = tech.supportLevels[tech.supportLevels.length - 1];
    const nearestResistance = tech.resistanceLevels[0];
    keyLevels = {
      support: nearestSupport.toFixed(4),
      resistance: nearestResistance.toFixed(4),
      invalidation:
        bias === "Bullish"
          ? `${(nearestSupport * 0.995).toFixed(4)}`
          : bias === "Bearish"
            ? `${(nearestResistance * 1.005).toFixed(4)}`
            : `${(nearestSupport * 0.99).toFixed(4)} — ${(nearestResistance * 1.01).toFixed(4)}`,
    };
  } else {
    const high = input.recentHigh ? parseFloat(input.recentHigh) : currentPrice * 1.02;
    const low = input.recentLow ? parseFloat(input.recentLow) : currentPrice * 0.98;
    keyLevels = {
      support: input.recentLow || low.toFixed(4),
      resistance: input.recentHigh || high.toFixed(4),
      invalidation:
        bias === "Bullish"
          ? `${(low * 0.995).toFixed(4)}`
          : bias === "Bearish"
            ? `${(high * 1.005).toFixed(4)}`
            : `${(low * 0.99).toFixed(4)} — ${(high * 1.01).toFixed(4)}`,
    };
  }

  const technicalSummary = generateTechnicalSummary(input, trendScore, indicatorScore);
  const fundamentalSummary = generateFundamentalSummary(input, fundamentalScore);
  const riskNote = generateRiskNote(bias, confidence, keyLevels);

  // Boost confidence slightly for auto-fetched data
  let adjustedConfidence = confidence;
  if (md && tech && tech.dataPoints >= 100) {
    adjustedConfidence = Math.min(95, adjustedConfidence + 5);
  }

  return {
    id: `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instrument: input.instrument.toUpperCase(),
    instrumentType: input.instrumentType,
    timeframe: input.timeframe,
    bias,
    confidence: adjustedConfidence,
    technicalSummary,
    fundamentalSummary,
    breakdown,
    keyLevels,
    riskNote,
    dataCompleteness: completeness,
    dataFlags: flags,
    timestamp: Date.now(),
    priceSnapshot: md?.price,
    technicalData: tech,
    dataSource: md?.provider,
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
