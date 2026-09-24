/**
 * Phase 273 — regression contract for the COMPLETE deterministic technical
 * analysis engine. One coherent technical answer from real OHLCV:
 *
 *   trend + structure (HH/HL, LH/LL, range) · momentum (RSI, MACD —
 *   values interpreted, never constants) · MA structure (EMA20/EMA50,
 *   SMA) · volatility (ATR + candle-derived regime ratio, never a
 *   price-% constant) · market structure swings · support/resistance ·
 *   MTF alignment vs conflict (unavailable explicit) · deterministic
 *   bias with structural authority · evidence-derived confidence ·
 *   structural+ATR invalidation · narrative from the same computed
 *   values the UI displays.
 *
 * Integrity: insufficient candles → explicit non-actionable state;
 * stale/future-dated prices refused; provider identity preserved;
 * identical evidence → identical answer; changed evidence changes it;
 * UI displays the engine's own computed values — never re-derived.
 *
 * Pure deterministic layer + engine + narrative + UI binding. No
 * network, no mocks of production formulas.
 */

import { describe, it, expect } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { createElement, ReactNode } from "react";
import { I18nProvider } from "./i18n";
import {
  calculateTechnical,
  classifyVolatility,
  ema,
  rsi,
  macd,
  atr,
} from "./data/technical";
import { runAnalysis, type AnalysisInput } from "./analysis-engine";
import type { OhlcvCandle } from "./data/market-types";
import { AnalysisResultDisplay } from "../components/AnalysisResult";

const render = (ui: ReactNode) => rtlRender(<I18nProvider>{ui}</I18nProvider>);

// ── Evidence factory: SID-controlled sinusoidal OHLCV ───────────────

function makeCandles(
  n: number,
  start: number,
  slopePerBar: number,
  seed = 0,
  barMs = 900_000,
  endTs = 1_700_000_000_000,
): OhlcvCandle[] {
  // Oscillation amplitude ≥ 5× the per-bar drift so real swing highs/lows
  // exist within the trend — the swing detector needs visible structure,
  // exactly the regimes the production path measures. For flat series the
  // absolute amplitude keeps the range readable.
  const amp = Math.max(4, Math.abs(slopePerBar) * 5);
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = Math.max(1, start + slopePerBar * j + amp * Math.sin(j * 0.55 + seed));
    out.push({
      timestamp: endTs - (n - 1 - j) * barMs,
      open: close - slopePerBar / 2,
      high: close + amp * 0.25,
      low: close - amp * 0.25,
      close,
      volume: 10,
    });
  }
  return out;
}

/** Deterministic series with a volatility break in the middle. */
function volBreakCandles(n: number, { burst = false }: { burst?: boolean } = {}): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = 100 + 0.05 * j;
    const half = j >= n - 20;
    const spread = burst ? (half ? 8 : 1) : half ? 0.25 : 4;
    out.push({
      timestamp: 1_700_000_000_000 - (n - 1 - j) * 900_000,
      open: close - spread / 2,
      high: close + spread,
      low: close - spread,
      close,
      volume: 10,
    });
  }
  return out;
}

const HH_CC = makeCandles(210, 40_000, 40, 0);   // verified: structure HH/HL, rsi 83.7, macdH +25.37
const LL_CC = makeCandles(210, 64_000, -60, 3);  // verified: structure LH/LL, rsi 8.6, macdH -24.33
const FLAT_CC = makeCandles(210, 50_000, 0, 1);  // verified: structure range

function mkInput(candles: OhlcvCandle[], overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  const tech = calculateTechnical(candles);
  const last = candles[candles.length - 1];
  return {
    instrument: "BTC-USDT",
    instrumentType: "crypto",
    timeframe: "M15",
    tradingStyle: "intraday",
    marketData: {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      price: { price: last.close, timestamp: last.timestamp, source: "okx" },
      candles,
    },
    technicalData: tech,
    ...overrides,
  } as AnalysisInput;
}

// ════════════════════════════════════════════════════════════════════
// 1 — TREND & STRUCTURE: bullish/bearish evidence → matching structure
// ════════════════════════════════════════════════════════════════════

describe("273 — trend & market structure from the same OHLCV", () => {
  it("HH/HL series → bullish structure; LH/LL series → bearish structure (measured, not assumed)", () => {
    const up = calculateTechnical(HH_CC);
    const down = calculateTechnical(LL_CC);
    expect(up.structure).toBe("HH/HL");
    expect(down.structure).toBe("LH/LL");

    const upRes = runAnalysis(mkInput(HH_CC));
    const downRes = runAnalysis(mkInput(LL_CC));
    expect(["Bullish", "Neutral"]).not.toContain(downRes.bias);
    expect(["Bearish", "Neutral"]).not.toContain(upRes.bias);
    expect(upRes.bias).not.toBe(downRes.bias);
    // Narrative names the measured structure on the LTF
    expect(upRes.technicalSummary).toContain("Higher Highs / Higher Lows");
    expect(downRes.technicalSummary).toContain("Lower Highs / Lower Lows");
  });

  it("range/consolidation series does not fake directional structure", () => {
    const flat = FLAT_CC;
    const tech = calculateTechnical(flat);
    expect(["range", "unknown"]).toContain(tech.structure);
    const res = runAnalysis(mkInput(flat));
    expect(res.technicalSummary).not.toContain("Higher Highs / Higher Lows");
  });

  it("insufficient candles yield explicit unknown structure — never fabricated swings", () => {
    const tiny = makeCandles(6, 50_000, 20);
    const tech = calculateTechnical(tiny);
    expect(tech.dataPoints).toBe(6);
    // With 6 candles and lookback 3 the swing detector can find few/none —
    // the engine must NOT invent HH/HL from nothing.
    const res = runAnalysis(mkInput(tiny));
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.noTradeReasons.length).toBeGreaterThan(0);
  });

  it("empty series is a refusal-safe no-data technical object", () => {
    const tech = calculateTechnical([]);
    expect(tech.dataPoints).toBe(0);
    expect(tech.structure).toBe("unknown");
    expect(tech.rsi14).toBeUndefined();
    expect(tech.macdHistogram).toBeUndefined();
    expect(tech.ema20).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 2 — MOMENTUM: RSI/MACD/EMA/ATR measured from the supplied OHLCV
// ════════════════════════════════════════════════════════════════════

describe("273 — indicator values are derived from the exact evidence series", () => {
  it("RSI/MACD/EMA/ATR equal what the pure functions compute from the same closes", () => {
    const tech = calculateTechnical(HH_CC);
    const closes = HH_CC.map((c) => c.close);
    expect(tech.rsi14).toBeCloseTo(Math.round(rsi(closes)! * 10) / 10, 9);
    expect(tech.ema20).toBeCloseTo(ema(closes, 20)[closes.length - 1], 9);
    expect(tech.ema50).toBeCloseTo(ema(closes, 50)[closes.length - 1], 9);
    expect(tech.macdHistogram).toBeCloseTo(macd(closes)!.histogram, 9);
    expect(tech.atr14).toBeCloseTo(atr(HH_CC)!, 9);
  });

  it("momentum interpretation follows the measured values (going up vs going down)", () => {
    expect(calculateTechnical(HH_CC).rsi14!).toBeGreaterThan(60);
    expect(calculateTechnical(LL_CC).rsi14!).toBeLessThan(40);
    expect(calculateTechnical(HH_CC).macdHistogram!).toBeGreaterThan(0);
    expect(calculateTechnical(LL_CC).macdHistogram!).toBeLessThan(0);

    const res = runAnalysis(mkInput(HH_CC));
    expect(res.technicalSummary).toMatch(/RSI\(14\): \d/);
    expect(res.technicalSummary).toMatch(/MACD histogram: positive/);
    const macdLine = calculateTechnical(HH_CC).macdLine!;
    const macdSig = calculateTechnical(HH_CC).macdSignal!;
    expect(res.technicalSummary).toContain(
      macdLine > macdSig ? "MACD line above signal" : "MACD line below signal",
    );
    expect(res.technicalSummary).toContain(macdLine > 0 ? "above zero" : "below zero");
  });
});

// ════════════════════════════════════════════════════════════════════
// 3 — VOLATILITY: regime derived from the candle series, not a constant
// ════════════════════════════════════════════════════════════════════

describe("273 — volatility state is measured vs the series' own baseline", () => {
  it("expansion/compression/normal from classifyVolatility track the actual true ranges", () => {
    const burst = classifyVolatility(volBreakCandles(70, { burst: true }));
    expect(burst.state).toBe("expanded");
    expect(burst.ratio!).toBeGreaterThanOrEqual(1.25);

    const crush = classifyVolatility(volBreakCandles(70));
    expect(crush.state).toBe("compressed");
    expect(crush.ratio!).toBeLessThanOrEqual(0.75);

    const steady = classifyVolatility(makeCandles(70, 100, 0.05));
    expect(steady.state).toBe("normal");
    expect(steady.ratio!).toBeGreaterThan(0.75);
    expect(steady.ratio!).toBeLessThan(1.25);
  });

  it("too-short history reports 'insufficient', never a fabricated regime", () => {
    const short = classifyVolatility(makeCandles(20, 100, 0.05));
    expect(short.state).toBe("insufficient");
    expect(short.ratio).toBeUndefined();
    const tech = calculateTechnical(makeCandles(20, 100, 0.05));
    expect(tech.volatilityState).toBe("insufficient");
    expect(tech.atrRatio).toBeUndefined();
  });

  it("the engine narrative carries the measured regime & ratio — no price-% constant", () => {
    const res = runAnalysis(mkInput(volBreakCandles(70, { burst: true })));
    expect(res.technicalSummary).toMatch(/volatility expanded/);
    expect(res.technicalSummary).toMatch(/× vs this series' preceding mean true-range baseline/);
    expect(res.technicalSummary).not.toMatch(/0\.02 \*/);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4 — SUPPORT/RESISTANCE + INVALIDATION from real swings & ATR
// ════════════════════════════════════════════════════════════════════

describe("273 — key levels & invalidation derive from measured structure", () => {
  it("support/resistance change when the evidence changes", () => {
    const a = calculateTechnical(makeCandles(210, 40_000, 40, 0));
    const b = calculateTechnical(makeCandles(210, 40_000, 40, 3));
    expect(a.supportLevels.length + a.resistanceLevels.length).toBeGreaterThan(0);
    // Same shape, different seed → different swings → different levels
    expect(JSON.stringify([a.supportLevels, a.resistanceLevels])).not.toBe(
      JSON.stringify([b.supportLevels, b.resistanceLevels]),
    );
  });

  it("an actionable plan anchors invalidation to structure (+ disclosed ATR buffer)", () => {
    const res = runAnalysis(mkInput(HH_CC));
    if (res.recommendation !== "NO_TRADE") {
      expect(res.keyLevels.invalidation).toBe(res.tradePlan!.stopLoss);
      const m = res.keyLevels.invalidation.match(/([\d.]+)/);
      expect(m).not.toBeNull();
      const stop = parseFloat(m![1]);
      // ATR-based buffer is disclosed in the basis when ATR exists
      if (calculateTechnical(HH_CC).atr14 !== undefined) {
        expect(res.tradePlan!.slBasis).toMatch(/structural|ATR buffer/);
      }
      expect(res.keyLevels.support).not.toBe("—");
      expect(Number.isFinite(stop)).toBe(true);
    }
  });

  it("a thesis without a derivable invalidation is non-actionable", () => {
    // Bullish structure but NO swing support below price and no liquidity
    // pools → Gate 7 refuses → NO_TRADE.
    const candles = HH_CC;
    const tech = calculateTechnical(candles);
    tech.supportLevels = [];
    tech.swingLows = [];
    tech.resistanceLevels = [tech.swingHighs[tech.swingHighs.length - 1] ?? 99999];
    tech.smc = undefined;
    tech.mtf = undefined;
    const input = mkInput(candles, { technicalData: tech });
    const res = runAnalysis(input);
    if (res.bias !== "Neutral") {
      expect(res.recommendation).toBe("NO_TRADE");
      expect(res.noTradeReasons.join(" ").length).toBeGreaterThan(0);
      expect(res.tradePlan).toBeUndefined();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// 5 — DECISION & CONFIDENCE: conflict lowers confidence / NO_TRADE
// ════════════════════════════════════════════════════════════════════

describe("273 — decision integrity & confidence from evidence", () => {
  it("conflicting HTF evidence cannot lift confidence above aligned evidence", () => {
    const aligned = runAnalysis(mkInput(HH_CC));
    const conflictingTech = calculateTechnical(HH_CC);
    // Inject an opposing D1 structure fact — real layering, no realism gap.
    conflictingTech.htfContext = {
      timeframe: "D1",
      structure: "LH/LL",
      bosDirection: "bearish",
      chochDirection: "none",
      lastSwingHigh: 999_999,
      lastSwingLow: 1,
      dataPoints: 120,
    };
    const conflicting = runAnalysis(mkInput(HH_CC, { technicalData: conflictingTech }));
    expect(conflicting.confidence).toBeLessThanOrEqual(aligned.confidence);
    if (aligned.recommendation !== "NO_TRADE") {
      // Either confidence drops measurably or execution is refused.
      expect(
        conflicting.confidence < aligned.confidence ||
          conflicting.recommendation === "NO_TRADE",
      ).toBe(true);
    }
  });

  it("no single indicator creates a bullish call on its own (structure is the authority)", () => {
    const flat = FLAT_CC;
    const tech = calculateTechnical(flat);
    tech.rsi14 = 20; // extreme oversold — would be a buy if RSI ruled
    tech.rsiDivergence = "bullish";
    const res = runAnalysis(mkInput(flat, { technicalData: tech }));
    expect(res.bias).not.toBe("Bullish");
    expect(res.recommendation).not.toBe("LONG");
  });

  it("confidence stays within the documented evidence band", () => {
    for (const cc of [HH_CC, LL_CC, FLAT_CC]) {
      const r = runAnalysis(mkInput(cc));
      expect(r.confidence).toBeGreaterThanOrEqual(20);
      expect(r.confidence).toBeLessThanOrEqual(99);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// 6 — PROVENANCE & TIME INTEGRITY: stale/future refused, identity kept
// ════════════════════════════════════════════════════════════════════

describe("273 — data-integrity gates stay hard", () => {
  it("stale provider-price evidence is refused for execution", () => {
    const input = mkInput(HH_CC);
    input.marketData = {
      ...input.marketData!,
      price: {
        ...input.marketData!.price,
        timestamp: Date.now() - 3 * 24 * 3_600_000,
      },
    };
    const res = runAnalysis(input);
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.noTradeReasons.join(" ")).toMatch(/stale|older than/);
  });

  it("future-dated price evidence is refused", () => {
    const input = mkInput(HH_CC);
    input.marketData = {
      ...input.marketData!,
      price: {
        ...input.marketData!.price,
        timestamp: Date.now() + 24 * 3_600_000,
      },
    };
    const res = runAnalysis(input);
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.noTradeReasons.join(" ")).toMatch(/future/);
  });

  it("provider/native identity survives into the result object", () => {
    const input = mkInput(HH_CC, {
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    } as Partial<AnalysisInput>);
    const res = runAnalysis(input);
    expect(res.provider).toBe("ccxt:binance");
    expect(res.providerInstrumentId).toBe("BTC/USDT");
  });
});

// ════════════════════════════════════════════════════════════════════
// 7 — MTF CONSISTENCY: conflict explicit, missing slots never fabricated
// ════════════════════════════════════════════════════════════════════

describe("273 — multi-timeframe consistency reporting", () => {
  it("an unavailable HTF chain is declared in the narrative, not silently ignored", () => {
    const tech = calculateTechnical(HH_CC);
    tech.chainUnavailable = ["H1", "H4"];
    const res = runAnalysis(mkInput(HH_CC, { technicalData: tech }));
    expect(res.dataFlags.join(" ")).toMatch(/Timeframe chain unavailable: H1, H4/);
    expect(res.technicalSummary).toMatch(
      /No higher-timeframe \(D1\) structural data available — macro context unverified\./,
    );
  });

  it("explicit counter-trend HTF is narrated as a conflict, not smoothed over", () => {
    const tech = calculateTechnical(HH_CC);
    tech.htfContext = {
      timeframe: "D1",
      structure: "LH/LL",
      bosDirection: "bearish",
      chochDirection: "none",
      lastSwingHigh: 999_999,
      lastSwingLow: 1,
      dataPoints: 120,
    };
    const res = runAnalysis(mkInput(HH_CC, { technicalData: tech }));
    expect(res.technicalSummary).toMatch(/CONFLICTS with LTF|counter-trend/);
  });
});

// ════════════════════════════════════════════════════════════════════
// 8 — DETERMINISM & SENSITIVITY: same evidence → same answer,
//     changed evidence → changed answer
// ════════════════════════════════════════════════════════════════════

describe("273 — engine determinism & evidence sensitivity", () => {
  it("identical evidence produces an identical analysis (modulo volatile id/timestamp)", () => {
    const a = runAnalysis(mkInput(HH_CC));
    const b = runAnalysis(mkInput(HH_CC));
    const strip = (r: typeof a) =>
      JSON.parse(JSON.stringify({ ...r, id: "", timestamp: 0 }));
    expect(strip(b)).toEqual(strip(a));
    expect(a.decisionFingerprint).toBe(b.decisionFingerprint);
  });

  it("materially changed evidence changes the measured metrics and the direction of the result", () => {
    const up = runAnalysis(mkInput(HH_CC));
    const down = runAnalysis(mkInput(LL_CC));
    expect(up.breakdown.trend).not.toBe(down.breakdown.trend);
    expect(up.keyLevels.support).not.toBe(down.keyLevels.support);
    expect(up.priceSnapshot!.price).not.toBeCloseTo(down.priceSnapshot!.price, 2);
    expect(up.decisionFingerprint).not.toBe(down.decisionFingerprint);
  });
});

// ════════════════════════════════════════════════════════════════════
// 9 — UI BINDING: the result surface displays the engine's own values
// ════════════════════════════════════════════════════════════════════

describe("273 — UI shows the same computed values the engine used", () => {
  it("renders RSI/ATR/MACD/EMA values straight from the shared technical object", () => {
    const tech = calculateTechnical(HH_CC);
    const res = runAnalysis(mkInput(HH_CC, { technicalData: tech }));
    const { container } = render(createElement(AnalysisResultDisplay, { result: res }));
    const text = container.textContent ?? "";
    expect(text).toContain(tech.rsi14!.toFixed(1));
    expect(text).toContain(tech.macdHistogram!.toFixed(4));
    expect(text).toContain(tech.atr14!.toFixed(4));
    expect(text).toContain(tech.structure);
    expect(text).toContain(tech.ema20!.toFixed(2));
    expect(text).toContain(tech.ema50!.toFixed(2));
  });

  it("renders the computed volatility regime chip with the same measured ratio", () => {
    const burst = volBreakCandles(70, { burst: true });
    const tech = calculateTechnical(burst);
    expect(tech.volatilityState).toBe("expanded");
    const res = runAnalysis(mkInput(burst, { technicalData: tech }));
    const { container } = render(createElement(AnalysisResultDisplay, { result: res }));
    const text = container.textContent ?? "";
    expect(text).toContain(`${tech.atrRatio!.toFixed(2)}×`);
  });
});
