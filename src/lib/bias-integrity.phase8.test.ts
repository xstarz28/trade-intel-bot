/**
 * Phase 8 P1 — VETO-MODEL bias integrity (adversarial integration fixtures).
 *
 * Policy under test:
 *   A directional LONG/SHORT thesis requires
 *     sign(structural trend) == sign(final bias)
 *   OR a genuine HTF external BOS/CHoCH reversal in the same direction.
 *
 * - Non-structural evidence (fundamental/positioning/macro/context) can NEVER
 *   create a directional thesis from neutral/range structure.
 * - Non-structural evidence can NEVER flip a structural thesis by itself.
 * - An LTF CHoCH alone is never reversal authority.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, MtfContext, TechnicalData } from "@/lib/data/market-types";
import type { MacroData, SentimentData } from "@/lib/data/intelligence-types";

// ── Fixtures ───────────────────────────────────────────────────────

function makeMarket(price: number): MarketData {
  return {
    instrument: "EUR/USD", instrumentType: "forex", provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

/** Structural levels bracket entry 100 with R:R ≥ 2 in BOTH directions
 *  (bullish: SL 95 / TP 112 → 2.4 · bearish: SL 105 / TP 88 → 2.4) so any
 *  NO_TRADE below is caused by the bias/state policy, not missing levels. */
function techBase(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [112], swingLows: [88],
    structure: "range", bosDirection: "none", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [105],
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

const bullishStruct = () =>
  techBase({
    structure: "HH/HL", bosDirection: "bullish",
    swingLows: [95], supportLevels: [95],
    swingHighs: [112], resistanceLevels: [112],
  });
const bearishStruct = () =>
  techBase({
    structure: "LH/LL", bosDirection: "bearish",
    swingHighs: [105], resistanceLevels: [105],
    swingLows: [88], supportLevels: [88],
  });

/** Maximum-strength bullish fundamental evidence (macro ratio → +2). */
const bullMacro = (): MacroData => ({
  provider: "alpha-vantage", timestamp: Date.now(),
  indicators: Array.from({ length: 6 }, (_, i) => ({
    name: `ind${i}`, relevance: "high" as const, sentiment: "positive" as const,
  })),
  summary: "", confidence: "high",
});

const bearMacro = (): MacroData => ({
  provider: "alpha-vantage", timestamp: Date.now(),
  indicators: Array.from({ length: 6 }, (_, i) => ({
    name: `ind${i}`, relevance: "high" as const, sentiment: "negative" as const,
  })),
  summary: "", confidence: "high",
});

/** Maximum-strength bullish positioning/sentiment evidence (→ +2 clamped). */
const bullSentiment = (): SentimentData => ({
  provider: "alpha-vantage", timestamp: Date.now(),
  averageScore: 0.8, articleCount: 10, label: "bullish",
  breakdown: { positive: 9, negative: 0, neutral: 1 },
  confidence: "high", articles: [],
});

const bearSentiment = (): SentimentData => ({
  provider: "alpha-vantage", timestamp: Date.now(),
  averageScore: -0.8, articleCount: 10, label: "bearish",
  breakdown: { positive: 0, negative: 9, neutral: 1 },
  confidence: "high", articles: [],
});

function input(over?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100),
    technicalData: techBase(),
    ...over,
  } as AnalysisInput;
}

/** Post-reversal MTF context: dominant HTF reads in the NEW direction. */
function mtfWith(direction: "bullish" | "bearish", reversal?: {
  timeframe: string; direction: "bullish" | "bearish"; kind: "bos" | "choch";
}): MtfContext {
  return {
    requestedTimeframe: "H4", chainUsed: ["D1", "H4", "H1"], unavailable: [],
    timeframes: [],
    alignment: direction === "bullish" ? "ALIGNED_BULLISH" : "ALIGNED_BEARISH",
    htfBias: direction === "bullish" ? "long" : "short",
    htfTimeframe: "D1", setupTimeframe: "H4", triggerTimeframe: "H1",
    ...(reversal ? { htfReversal: reversal } : {}),
  };
}

const stateOf = (r: ReturnType<typeof runAnalysis>) =>
  `${r.recommendation}/bias=${r.bias}`;

// ── Cases 1–3: non-structural evidence CANNOT create a thesis ──────

describe("P1: neutral/range structure — non-structural evidence cannot create a thesis", () => {
  it("case 1: very strong bullish fundamental alone → Neutral / NO_TRADE", () => {
    const r = runAnalysis(input({ macroData: bullMacro() }));
    // Fundamental +2 × 0.30 = +0.60 would have been Bullish before Phase 8.
    expect(r.bias).toBe("Neutral");
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.conviction).toBeUndefined();
  });

  it("case 2: very strong bullish positioning/sentiment alone → Neutral / NO_TRADE", () => {
    const r = runAnalysis(input({ sentimentData: bullSentiment() }));
    expect(r.bias).toBe("Neutral");
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
  });

  it("case 3: strong bullish fundamental + sentiment combined → Neutral / NO_TRADE", () => {
    const r = runAnalysis(input({ macroData: bullMacro(), sentimentData: bullSentiment() }));
    // Combined weight 0.55 far exceeds the old ±0.25 threshold — still vetoed.
    expect(r.breakdown.fundamental).toBeGreaterThanOrEqual(2);
    expect(r.breakdown.sentiment).toBeGreaterThanOrEqual(2);
    expect(r.bias).toBe("Neutral");
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
  });
});

// ── Cases 4–9: non-structural evidence cannot FLIP a structural thesis ──

describe("P1: structural thesis cannot be flipped by non-structural evidence", () => {
  it("case 4: bullish structure + strongly bearish fundamental + sentiment → never SHORT", () => {
    // Old behavior: 0.45·(+1..2) − 0.3·2 − 0.25·2 could go Bearish.
    const r = runAnalysis(input({
      technicalData: bullishStruct(),
      macroData: bearMacro(),
      sentimentData: bearSentiment(),
    }));
    expect(r.recommendation).not.toBe("SHORT");
    expect(["LONG", "NO_TRADE"]).toContain(r.recommendation);
  });

  it("case 5: bullish structure + strongly bearish sentiment → never SHORT", () => {
    const r = runAnalysis(input({
      technicalData: bullishStruct(),
      sentimentData: bearSentiment(),
    }));
    expect(r.recommendation).not.toBe("SHORT");
  });

  it("case 6: bullish structure + bearish fundamental + bearish sentiment → LONG or Neutral", () => {
    const r = runAnalysis(input({
      technicalData: bullishStruct(),
      macroData: bearMacro(),
      sentimentData: bearSentiment(),
    }));
    expect(["LONG", "NO_TRADE"]).toContain(r.recommendation);
    if (r.recommendation === "LONG") expect(r.bias).toBe("Bullish");
  });

  it("case 7: bearish structure + strongly bullish fundamental → never LONG", () => {
    const r = runAnalysis(input({
      technicalData: bearishStruct(),
      macroData: bullMacro(),
    }));
    expect(r.recommendation).not.toBe("LONG");
  });

  it("case 8: bearish structure + strongly bullish sentiment → never LONG", () => {
    const r = runAnalysis(input({
      technicalData: bearishStruct(),
      sentimentData: bullSentiment(),
    }));
    expect(r.recommendation).not.toBe("LONG");
  });

  it("case 9: bearish structure + bullish fundamental + sentiment → SHORT or Neutral", () => {
    const r = runAnalysis(input({
      technicalData: bearishStruct(),
      macroData: bullMacro(),
      sentimentData: bearSentiment().provider ? bullSentiment() : undefined,
    }));
    expect(["SHORT", "NO_TRADE"]).toContain(r.recommendation);
    if (r.recommendation === "SHORT") expect(r.bias).toBe("Bearish");
  });
});

// ── Cases 10–12: the ONLY reversal authority is a genuine HTF reversal ──

describe("P1: HTF external reversal is the sole legitimate reversal path", () => {
  /** Prior structure bearish; non-structural evidence bullish enough that the
   *  weighted core crosses the directional threshold ONLY with the fresh CHoCH. */
  const transitionInput = (withReversal: boolean) =>
    input({
      technicalData: techBase({
        structure: "LH/LL",           // prior external structure bearish
        bosDirection: "none",
        chochDirection: "bullish",    // primary-TF character change (trigger context)
        mtf: mtfWith("bullish", withReversal
          ? { timeframe: "D1", direction: "bullish", kind: "bos" }
          : undefined),
      }),
      macroData: bullMacro(),
      sentimentData: bullSentiment(),
    });

  it("case 10: valid bullish HTF external BOS reversal AGAINST bearish prior structure may create LONG", () => {
    const r = runAnalysis(transitionInput(true));
    // The reversal path is AUTHORIZED — whether it survives the remaining
    // gates (confluence ≥ 2 agreeing core factors) is separate policy; it
    // must never be blocked BY the structural-agreement veto itself.
    if (r.noTradeReasons.some((x) => x.includes("Structural agreement"))) {
      throw new Error("HTF-authorized reversal was vetoed by the structural-agreement rule");
    }
    if (r.recommendation !== "NO_TRADE") {
      expect(r.recommendation).toBe("LONG");
      expect(r.tradePlan?.direction).toBe("long");
    }
  });

  it("case 11: valid bearish HTF external BOS reversal against bullish prior structure mirrors", () => {
    const r = runAnalysis(input({
      technicalData: techBase({
        structure: "HH/HL",
        bosDirection: "none",
        chochDirection: "bearish",
        mtf: mtfWith("bearish", { timeframe: "D1", direction: "bearish", kind: "bos" }),
      }),
      macroData: bearMacro(),
      sentimentData: bearSentiment(),
    }));
    if (r.noTradeReasons.some((x) => x.includes("Structural agreement"))) {
      throw new Error("HTF-authorized reversal was vetoed by the structural-agreement rule");
    }
    if (r.recommendation !== "NO_TRADE") expect(r.recommendation).toBe("SHORT");
  });

  it("case 12: identical transition WITHOUT an HTF reversal → NO_TRADE (LTF CHoCH is not authority)", () => {
    const r = runAnalysis(transitionInput(false));
    expect(stateOf(r)).toBe("NO_TRADE/bias=Neutral");
    expect(r.tradePlan).toBeUndefined();
    // The refusal must be explainable in engine terms.
    expect(r.noTradeReasons.join(" ")).toContain("Structural agreement");
  });
});

// ── Control: the veto must not over-block legitimate aligned setups ──

describe("P1: control — structural agreement still produces trades", () => {
  it("bullish structure + bullish fundamental → LONG survives", () => {
    const r = runAnalysis(input({
      technicalData: bullishStruct(),
      macroData: bullMacro(),
    }));
    expect(r.recommendation).toBe("LONG");
    expect(r.tradePlan?.direction).toBe("long");
  });

  it("bearish structure + bearish fundamental → SHORT survives", () => {
    const r = runAnalysis(input({
      technicalData: bearishStruct(),
      macroData: bearMacro(),
    }));
    expect(r.recommendation).toBe("SHORT");
    expect(r.tradePlan?.direction).toBe("short");
  });

  it("veto reason is human-readable and names the actual evidence", () => {
    const r = runAnalysis(input({ macroData: bullMacro() }));
    expect(r.noTradeReasons.join(" ")).toContain("Structural agreement");
    expect(r.noTradeReasons.join(" ")).toContain("fundamental");
  });
});
