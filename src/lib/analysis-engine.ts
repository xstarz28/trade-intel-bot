import type {
  AnalysisInput,
  AnalysisResult,
  BiasBreakdown,
  DirectionalBias,
  FactorScore,
  KeyLevels,
} from "@/types/analysis";

export type { AnalysisInput, AnalysisResult, BiasBreakdown, DirectionalBias, FactorScore, KeyLevels };
export type { InstrumentType, Timeframe } from "@/types/analysis";

// Weights from the methodology
const WEIGHTS = {
  trend: 0.3,
  indicator: 0.25,
  fundamental: 0.25,
  sentiment: 0.2,
} as const;

/**
 * Clamps a factor score to the valid range [-2, 2].
 */
function clampScore(score: number): FactorScore {
  return Math.max(-2, Math.min(2, Math.round(score))) as FactorScore;
}

/**
 * Calculates the weighted bias from factor scores.
 */
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

  // Confidence based on score magnitude and agreement
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

/**
 * Score the trend/structure factor based on user inputs.
 */
function scoreTrend(input: AnalysisInput): FactorScore {
  let score: FactorScore = 0;

  // If price data available, do simple high/low analysis
  if (input.currentPrice && input.recentHigh && input.recentLow) {
    const price = parseFloat(input.currentPrice);
    const high = parseFloat(input.recentHigh);
    const low = parseFloat(input.recentLow);
    const range = high - low;
    if (range > 0) {
      const position = (price - low) / range;
      if (position > 0.65) score += 1;
      if (position > 0.8) score += 1;
      if (position < 0.35) score -= 1;
      if (position < 0.2) score -= 1;
    }
  } else {
    // No price data — neutral with uncertainty flag
    score = clampScore(score);
  }

  return clampScore(score);
}

/**
 * Score indicator confirmation — relies on user-supplied context or flags as incomplete.
 */
function scoreIndicators(input: AnalysisInput): FactorScore {
  // Without real-time data, score neutral and flag
  const newsLower = (input.newsContext || "").toLowerCase();
  let score: FactorScore = 0;

  if (newsLower.includes("rally") || newsLower.includes("surge") || newsLower.includes("breakout")) {
    score += 1;
  }
  if (newsLower.includes("crash") || newsLower.includes("plunge") || newsLower.includes("breakdown")) {
    score -= 1;
  }
  if (newsLower.includes("divergence") || newsLower.includes("bullish divergence")) {
    score += 1;
  }
  if (newsLower.includes("bearish divergence")) {
    score -= 1;
  }

  return clampScore(score);
}

/**
 * Score fundamentals based on context clues.
 */
function scoreFundamentals(input: AnalysisInput): FactorScore {
  let score: FactorScore = 0;
  const events = (input.economicEvents || "").toLowerCase();
  const context = (input.newsContext || "").toLowerCase();
  const combined = `${events} ${context}`;

  if (input.instrumentType === "forex") {
    // Hawkish = bullish for currency
    if (combined.includes("hawkish") || combined.includes("rate hike") || combined.includes("tightening")) {
      score += 1;
    }
    if (combined.includes("dovish") || combined.includes("rate cut") || combined.includes("easing")) {
      score -= 1;
    }
    if (combined.includes("strong gdp") || combined.includes("strong nfp") || combined.includes("strong employment")) {
      score += 1;
    }
    if (combined.includes("weak gdp") || combined.includes("weak nfp") || combined.includes("recession")) {
      score -= 1;
    }
  } else if (input.instrumentType === "crypto") {
    if (combined.includes("institutional") || combined.includes("etf approval") || combined.includes("adoption")) {
      score += 1;
    }
    if (combined.includes("regulation") || combined.includes("ban") || combined.includes("crackdown")) {
      score -= 1;
    }
    if (combined.includes("halving") || combined.includes("bullish catalyst")) {
      score += 1;
    }
  }

  return clampScore(score);
}

/**
 * Score sentiment/positioning.
 */
function scoreSentiment(input: AnalysisInput): FactorScore {
  let score: FactorScore = 0;

  if (input.fundingRate) {
    const fr = parseFloat(input.fundingRate);
    if (!isNaN(fr)) {
      // Positive funding = longs paying shorts = overcrowded long = bearish contrarian
      if (fr > 0.05) score -= 1;
      if (fr < -0.05) score += 1;
    }
  }

  const context = (input.newsContext || "").toLowerCase();
  if (context.includes("fear") || context.includes("panic") || context.includes("capitulation")) {
    score += 1; // Contrarian bullish
  }
  if (context.includes("greed") || context.includes("euphoria") || context.includes("fomo")) {
    score -= 1; // Contrarian bearish
  }

  return clampScore(score);
}

/**
 * Determine data completeness flags.
 */
function assessDataCompleteness(input: AnalysisInput): {
  completeness: "full" | "partial" | "limited";
  flags: string[];
} {
  const flags: string[] = [];
  let missing = 0;

  if (!input.currentPrice) {
    flags.push("No current price data — marked low confidence");
    missing++;
  }
  if (!input.newsContext) {
    flags.push("No news context provided — fundamental analysis limited");
    missing++;
  }
  if (!input.economicEvents && input.instrumentType === "forex") {
    flags.push("No economic calendar data — macro events not factored");
    missing++;
  }
  if (input.instrumentType === "crypto" && !input.fundingRate) {
    flags.push("No funding rate / open interest data — sentiment limited");
    missing++;
  }
  if (!input.recentHigh || !input.recentLow) {
    flags.push("No recent price range — structure analysis limited");
    missing++;
  }

  let completeness: "full" | "partial" | "limited" = "full";
  if (missing >= 4) completeness = "limited";
  else if (missing >= 2) completeness = "partial";

  return { completeness, flags };
}

/**
 * Generate a human-readable technical summary.
 */
function generateTechnicalSummary(
  input: AnalysisInput,
  trendScore: FactorScore,
  indicatorScore: FactorScore,
): string {
  const parts: string[] = [];

  if (!input.currentPrice) {
    parts.push("Technical data not provided — analysis based on available inputs only.");
  } else {
    if (trendScore >= 1) {
      parts.push(`Price is positioned in the upper range near recent highs, suggesting bullish market structure.`);
    } else if (trendScore <= -1) {
      parts.push(`Price is positioned in the lower range near recent lows, suggesting bearish market structure.`);
    } else {
      parts.push(`Price is trading mid-range with no clear directional bias from structure alone.`);
    }

    if (input.recentHigh && input.recentLow) {
      parts.push(
        `Key range: ${input.recentLow} — ${input.recentHigh}. ` +
        `Without multi-timeframe OHLCV data, detailed BOS/CHoCH, order block, and FVG analysis requires manual confirmation.`
      );
    }
  }

  if (indicatorScore === 0) {
    parts.push("Indicator confirmation: No RSI, MACD, or MA data supplied — scored neutral. For full scoring, provide indicator readings.");
  } else if (indicatorScore >= 1) {
    parts.push("News/price action context suggests momentum aligned with bullish continuation.");
  } else if (indicatorScore <= -1) {
    parts.push("News/price action context suggests momentum aligned with bearish continuation.");
  }

  return parts.join(" ");
}

/**
 * Generate a human-readable fundamental summary.
 */
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
      parts.push("No economic calendar data supplied. For full analysis, provide upcoming NFP, CPI, rate decisions, and geopolitical headlines.");
    }
    if (input.newsContext) {
      parts.push(`Market news: ${input.newsContext}`);
    }
  } else if (input.instrumentType === "crypto") {
    parts.push("Crypto fundamental context:");
    if (input.newsContext) {
      parts.push(`News/catalysts: ${input.newsContext}`);
    } else {
      parts.push("No on-chain or regulatory news supplied. For full analysis, provide ETF flows, regulatory developments, or protocol upgrades.");
    }
  } else {
    parts.push("Fundamental data not provided — analysis is technical/structure-based only.");
  }

  if (fundamentalScore === 0) {
    parts.push("Fundamental factors scored neutral — insufficient data to form a directional conviction.");
  }

  return parts.join(" ");
}

/**
 * Generate risk note with R:R guidance.
 */
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

  parts.push(
    "This is NOT financial advice. Always verify with your own analysis and risk management rules."
  );

  return parts.join(" ");
}

/**
 * Main analysis function — takes user input, returns structured analysis.
 */
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

  // Derive key levels from available price data or use placeholders
  const price = input.currentPrice ? parseFloat(input.currentPrice) : 0;
  const high = input.recentHigh ? parseFloat(input.recentHigh) : price * 1.02;
  const low = input.recentLow ? parseFloat(input.recentLow) : price * 0.98;

  const keyLevels: KeyLevels = {
    support: input.recentLow || `${(low).toFixed(4)}`,
    resistance: input.recentHigh || `${(high).toFixed(4)}`,
    invalidation:
      bias === "Bullish"
        ? `${(low * 0.995).toFixed(4)}`
        : bias === "Bearish"
          ? `${(high * 1.005).toFixed(4)}`
          : `${(low * 0.99).toFixed(4)} — ${(high * 1.01).toFixed(4)}`,
  };

  const technicalSummary = generateTechnicalSummary(input, trendScore, indicatorScore);
  const fundamentalSummary = generateFundamentalSummary(input, fundamentalScore);
  const riskNote = generateRiskNote(bias, confidence, keyLevels);

  return {
    id: `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instrument: input.instrument.toUpperCase(),
    instrumentType: input.instrumentType,
    timeframe: input.timeframe,
    bias,
    confidence,
    technicalSummary,
    fundamentalSummary,
    breakdown,
    keyLevels,
    riskNote,
    dataCompleteness: completeness,
    dataFlags: flags,
    timestamp: Date.now(),
  };
}

/**
 * Quick presets for popular instruments.
 */
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
