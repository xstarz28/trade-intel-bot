import { describe, it, expect } from "vitest";
import {
  runAnalysis,
  type AnalysisInput,
} from "./analysis-engine";

function base(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "D1",
    ...overrides,
  };
}

// ── Bias calculation ──────────────────────────────────────────────

describe("runAnalysis — bias calculation", () => {
  it("returns Neutral with all-zero breakdown", () => {
    const r = runAnalysis(base());
    expect(r.bias).toBe("Neutral");
    expect(r.breakdown).toEqual({ trend: 0, indicator: 0, fundamental: 0, sentiment: 0 });
  });

  it("returns Bullish when all factors are positive", () => {
    const r = runAnalysis(
      base({
        currentPrice: "1.10",
        recentHigh: "1.12",
        recentLow: "1.05",
        newsContext: "rally surge breakout bullish divergence",
        economicEvents: "hawkish rate hike strong gdp",
      }),
    );
    expect(r.bias).toBe("Bullish");
    expect(r.confidence).toBeGreaterThan(50);
  });

  it("returns Bearish when all factors are negative", () => {
    const r = runAnalysis(
      base({
        currentPrice: "1.05",
        recentHigh: "1.12",
        recentLow: "1.04",
        newsContext: "crash plunge breakdown bearish divergence fear",
        economicEvents: "dovish rate cut weak gdp recession",
      }),
    );
    expect(r.bias).toBe("Bearish");
    expect(r.confidence).toBeGreaterThan(50);
  });
});

// ── Trend scoring ─────────────────────────────────────────────────

describe("trend scoring via price position", () => {
  it("scores bullish when price is near the high", () => {
    const r = runAnalysis(
      base({ currentPrice: "1.118", recentHigh: "1.12", recentLow: "1.05" }),
    );
    expect(r.breakdown.trend).toBeGreaterThanOrEqual(1);
  });

  it("scores bearish when price is near the low", () => {
    const r = runAnalysis(
      base({ currentPrice: "1.052", recentHigh: "1.12", recentLow: "1.05" }),
    );
    expect(r.breakdown.trend).toBeLessThanOrEqual(-1);
  });

  it("scores neutral when price is mid-range", () => {
    const r = runAnalysis(
      base({ currentPrice: "1.085", recentHigh: "1.12", recentLow: "1.05" }),
    );
    expect(r.breakdown.trend).toBe(0);
  });
});

// ── Indicator scoring / bearish divergence fix ────────────────────

describe("indicator scoring", () => {
  it("scores bullish on 'rally' keyword", () => {
    const r = runAnalysis(base({ newsContext: "strong rally continuation" }));
    expect(r.breakdown.indicator).toBeGreaterThanOrEqual(1);
  });

  it("scores bearish on 'crash' keyword", () => {
    const r = runAnalysis(base({ newsContext: "market crash underway" }));
    expect(r.breakdown.indicator).toBeLessThanOrEqual(-1);
  });

  it("scores -1 for 'bearish divergence' (the fixed bug)", () => {
    const r = runAnalysis(base({ newsContext: "bearish divergence on RSI" }));
    expect(r.breakdown.indicator).toBe(-1);
  });

  it("scores +1 for 'bullish divergence'", () => {
    const r = runAnalysis(base({ newsContext: "bullish divergence forming" }));
    expect(r.breakdown.indicator).toBe(1);
  });

  it("scores +1 for bare 'divergence' without directional qualifier", () => {
    const r = runAnalysis(base({ newsContext: "divergence visible on MACD" }));
    expect(r.breakdown.indicator).toBe(1);
  });

  it("scores 0 with no news context", () => {
    const r = runAnalysis(base());
    expect(r.breakdown.indicator).toBe(0);
  });
});

// ── Fundamental scoring ───────────────────────────────────────────

describe("fundamental scoring", () => {
  it("forex: hawkish + strong gdp → positive", () => {
    const r = runAnalysis(
      base({
        instrumentType: "forex",
        economicEvents: "hawkish rate hike",
        newsContext: "strong gdp beat",
      }),
    );
    expect(r.breakdown.fundamental).toBeGreaterThanOrEqual(1);
  });

  it("forex: dovish + recession → negative", () => {
    const r = runAnalysis(
      base({
        instrumentType: "forex",
        economicEvents: "dovish rate cut easing",
        newsContext: "recession fears deepening",
      }),
    );
    expect(r.breakdown.fundamental).toBeLessThanOrEqual(-1);
  });

  it("crypto: institutional + etf approval → positive", () => {
    const r = runAnalysis(
      base({
        instrument: "BTC/USD",
        instrumentType: "crypto",
        newsContext: "institutional adoption etf approval",
      }),
    );
    expect(r.breakdown.fundamental).toBeGreaterThanOrEqual(1);
  });

  it("crypto: regulation + crackdown → negative", () => {
    const r = runAnalysis(
      base({
        instrument: "BTC/USD",
        instrumentType: "crypto",
        newsContext: "regulation crackdown ban",
      }),
    );
    expect(r.breakdown.fundamental).toBeLessThanOrEqual(-1);
  });
});

// ── Sentiment scoring ─────────────────────────────────────────────

describe("sentiment scoring", () => {
  it("contrarian bullish on fear/panic", () => {
    const r = runAnalysis(base({ newsContext: "extreme fear in market" }));
    expect(r.breakdown.sentiment).toBeGreaterThanOrEqual(1);
  });

  it("contrarian bearish on greed/euphoria", () => {
    const r = runAnalysis(base({ newsContext: "greed euphoria fomo" }));
    expect(r.breakdown.sentiment).toBeLessThanOrEqual(-1);
  });

  it("crypto: high funding rate → bearish contrarian", () => {
    const r = runAnalysis(
      base({
        instrument: "BTC/USD",
        instrumentType: "crypto",
        fundingRate: "0.08",
      }),
    );
    expect(r.breakdown.sentiment).toBeLessThanOrEqual(-1);
  });

  it("crypto: negative funding rate → bullish contrarian", () => {
    const r = runAnalysis(
      base({
        instrument: "BTC/USD",
        instrumentType: "crypto",
        fundingRate: "-0.06",
      }),
    );
    expect(r.breakdown.sentiment).toBeGreaterThanOrEqual(1);
  });
});

// ── Data completeness ─────────────────────────────────────────────

describe("data completeness", () => {
  it("full data when all fields provided", () => {
    const r = runAnalysis(
      base({
        currentPrice: "1.10",
        recentHigh: "1.12",
        recentLow: "1.05",
        newsContext: "some news",
        economicEvents: "some events",
      }),
    );
    expect(r.dataCompleteness).toBe("full");
    expect(r.dataFlags.length).toBe(0);
  });

  it("limited data when nothing is provided", () => {
    const r = runAnalysis(base());
    expect(r.dataCompleteness).toBe("limited");
    expect(r.dataFlags.length).toBeGreaterThanOrEqual(4);
  });

  it("partial data when some fields are missing", () => {
    const r = runAnalysis(
      base({ currentPrice: "1.10", newsContext: "some context" }),
    );
    expect(r.dataCompleteness).toBe("partial");
  });
});

// ── Key levels ────────────────────────────────────────────────────

describe("key levels", () => {
  it("uses provided high/low as resistance/support", () => {
    const r = runAnalysis(
      base({ recentHigh: "1.1500", recentLow: "1.0800" }),
    );
    expect(r.keyLevels.resistance).toBe("1.1500");
    expect(r.keyLevels.support).toBe("1.0800");
  });

  it("derives levels from price when high/low not provided", () => {
    const r = runAnalysis(base({ currentPrice: "1.1000" }));
    expect(r.keyLevels.support).toMatch(/^\d+\.\d+$/);
    expect(r.keyLevels.resistance).toMatch(/^\d+\.\d+$/);
  });
});

// ── Instrument uppercasing ────────────────────────────────────────

describe("instrument formatting", () => {
  it("uppercases the instrument name", () => {
    const r = runAnalysis(base({ instrument: "eur/usd" }));
    expect(r.instrument).toBe("EUR/USD");
  });
});

// ── Confidence bounds ─────────────────────────────────────────────

describe("confidence", () => {
  it("stays within 20-95 range", () => {
    const r = runAnalysis(base());
    expect(r.confidence).toBeGreaterThanOrEqual(20);
    expect(r.confidence).toBeLessThanOrEqual(95);
  });

  it("caps at 95 for maximum conviction", () => {
    const r = runAnalysis(
      base({
        currentPrice: "1.119",
        recentHigh: "1.12",
        recentLow: "1.05",
        newsContext: "rally surge breakout bullish divergence",
        economicEvents: "hawkish rate hike strong gdp",
      }),
    );
    expect(r.confidence).toBeLessThanOrEqual(95);
  });
});
