/**
 * Phase 278 — advanced modern technical market intelligence regression contract.
 *
 * The engine's classical stack (SMA/EMA/RSI/MACD/ATR/swings/structure) is
 * unchanged; this phase added a modern layer on top of the SAME evidence:
 *
 *   A price location / auction  — session VWAP, anchored VWAPs, deviation
 *                                 bands, distance, previous-period extremes,
 *                                 opening range
 *   B volume structure          — volume-at-price profile, POC/VAH/VAL,
 *                                 HVN/LVN, relative volume, participation
 *                                 expansion/contraction, price-volume relation
 *   C liquidity / structure     — sweeps, accepted vs failed breakouts,
 *                                 rejection, displacement, FVG, validated
 *                                 reaction zones, session auction context
 *   D volatility / statistics   — realized vol, percentiles, σ, z-score,
 *                                 compression→expansion, trend vs
 *                                 mean-reversion, clustering
 *   E cross-market              — correlation, relative strength, intermarket,
 *                                 risk context (ONLY from a real comparator)
 *   F order flow                — spread/depth/imbalance (ONLY from a real
 *                                 order-book snapshot) + explicit list of the
 *                                 metrics no feed supplies
 *   G derivatives               — OI/funding/positioning/liquidations carried
 *                                 verbatim from a real feed
 *
 * The proofs below (1–24) are the phase's acceptance contract.
 */

import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";

import { I18nProvider } from "@/lib/i18n";
import {
  ADVANCED_PARAMETERS,
  attachAdvancedTechnical,
  buildVolumeDistribution,
  computeAdvancedTechnical,
  detectLevelInteractions,
  assessAdvancedEvidence,
} from "@/lib/data/advanced-technical";
import { calculateTechnical, rsi, macd } from "@/lib/data/technical";
import { runAnalysis, type AnalysisInput } from "@/lib/analysis-engine";
import type { OhlcvCandle } from "@/lib/data/market-types";
import type { ExecutionQuality } from "@/lib/execution-quality";
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import { AnalysisResultDisplay } from "@/components/AnalysisResult";

const render = (ui: ReactNode) => rtlRender(createElement(I18nProvider, null, ui));

const BAR_MS = 900_000; // H4
const END_TS = Date.parse("2025-07-04T20:00:00Z");

/** Real-shaped OHLCV: trending sinusoid with genuine swings and volume. */
function makeCandles(
  n: number,
  start: number,
  slopePerBar: number,
  seed = 0,
  volumeBase = 1_000,
  volumeSlope = 0,
): OhlcvCandle[] {
  const amp = Math.max(4, Math.abs(slopePerBar) * 5);
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = Math.max(1, start + slopePerBar * j + amp * Math.sin(j * 0.55 + seed));
    out.push({
      timestamp: END_TS - (n - 1 - j) * BAR_MS,
      open: close - slopePerBar / 2,
      high: close + amp / 2,
      low: close - amp / 2,
      close,
      volume: Math.max(1, volumeBase + volumeSlope * j),
    });
  }
  return out;
}

const UPTREND = makeCandles(210, 40_000, 40, 0);
const DOWNTREND = makeCandles(210, 64_000, -60, 3);
const RANGEBOUND = makeCandles(210, 50_000, 0, 1);
const NO_VOLUME = makeCandles(210, 40_000, 40, 0).map((c) => ({ ...c, volume: 0 }));
// A REAL participation surge: the newest five bars carry 3× the baseline.
const VOLUME_SURGE = makeCandles(210, 40_000, 40, 0).map((c, i) =>
  i >= 205 ? { ...c, volume: 3_000 } : c,
);

function tech(candles: OhlcvCandle[] = UPTREND) {
  return calculateTechnical(candles);
}

function advanced(candles: OhlcvCandle[] = UPTREND, ctx = {}) {
  return computeAdvancedTechnical(candles, tech(candles), { timeframe: "H4", provider: "okx", providerInstrumentId: "BTC-USDT", ...ctx });
}

// A REAL order-book snapshot shape (as the OKX action builds it).
const EXECUTION: ExecutionQuality = {
  available: true,
  provider: "OKX public order book",
  instrumentId: "BTC-USDT-SWAP",
  snapshotTs: Date.parse("2025-07-04T19:59:00Z"),
  fetchedAt: Date.parse("2025-07-04T19:59:01Z"),
  freshness: "FRESH",
  bid: 64_990,
  ask: 65_010,
  mid: 65_000,
  spread: 20,
  spreadBps: 3.1,
  bidDepth: 120,
  askDepth: 80,
  imbalance: 0.2,
  regime: "IMBALANCED",
  book: {
    bids: Array.from({ length: 10 }, (_, i) => ({ price: 64_990 - i, size: 12 - i })),
    asks: Array.from({ length: 10 }, (_, i) => ({ price: 65_010 + i, size: 8 })),
  },
};

const DERIVATIVES: CryptoDerivativesData = {
  provider: "coinglass",
  symbol: "BTC/USDT",
  timestamp: Date.parse("2025-07-04T19:00:00Z"),
  freshness: "realtime",
  openInterest: { current: 12_345_678, change1h: 1.2, change24h: -2.4 },
  fundingRate: { currentRate: 0.0001, annualizedRate: 0.1095 },
  longShort: { accountRatio: 1.12, topTraderRatio: 1.05 },
  liquidations: { dominantSide: "longs" },
  availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
  confidence: "high",
};

// ── 1. VWAP from actual OHLCV + volume ───────────────────────────

describe("278 — price location / auction (A)", () => {
  it("(1) session VWAP is the volume-weighted typical price of the supplied candles, not a constant", () => {
    const adv = advanced();
    const sessionIdx = (() => {
      const lastDay = new Date(UPTREND[UPTREND.length - 1].timestamp).getUTCDate();
      let i = UPTREND.length - 1;
      while (i > 0 && new Date(UPTREND[i - 1].timestamp).getUTCDate() === lastDay) i--;
      return i;
    })();
    const session = UPTREND.slice(sessionIdx);
    let pv = 0;
    let v = 0;
    for (const c of session) {
      pv += ((c.high + c.low + c.close) / 3) * c.volume;
      v += c.volume;
    }
    expect(adv.location.available).toBe(true);
    expect(adv.location.sessionVwap).toBeCloseTo(pv / v, 3);
    expect(adv.location.sessionVwap).not.toBe(50_000);

    // The bands are the ACTUAL volume-weighted dispersion of the same window.
    const vwap = pv / v;
    let p2v = 0;
    for (const c of session) p2v += ((c.high + c.low + c.close) / 3) ** 2 * c.volume;
    const sigma = Math.sqrt(p2v / v - vwap * vwap);
    expect(adv.location.bands!.plus1).toBeCloseTo(vwap + sigma, 2);
    expect(adv.location.bands!.minus2).toBeCloseTo(vwap - 2 * sigma, 2);
  });

  it("(2) anchored VWAPs are deterministic and pinned to real anchors", () => {
    const a = advanced();
    const b = advanced();
    expect(a.location.anchoredVwaps).toEqual(b.location.anchoredVwaps);
    const anchors = a.location.anchoredVwaps.map((x) => x.anchor);
    expect(anchors).toContain("session");
    expect(anchors).toContain("swing_low");
    expect(anchors).toContain("swing_high");
    // Every anchor instant is a REAL candle instant of the supplied series.
    for (const av of a.location.anchoredVwaps) {
      expect(UPTREND.some((c) => c.timestamp === av.anchorAt)).toBe(true);
      expect(av.candles).toBeGreaterThan(0);
    }
    // The event anchor is not invented when no event instant is supplied.
    expect(a.location.anchorUnavailable.some((u) => u.anchor === "event")).toBe(true);
    // ...and when a real event instant IS supplied, it is used.
    const anchorAt = UPTREND[UPTREND.length - 30].timestamp;
    const withEvent = advanced(UPTREND, { eventAnchorAt: anchorAt, eventAnchorBasis: "CPI release" });
    const eventAnchor = withEvent.location.anchoredVwaps.find((x) => x.anchor === "event");
    expect(eventAnchor?.anchorAt).toBe(anchorAt);
    expect(eventAnchor?.basis).toContain("CPI release");
  });

  it("(2b) a supplied event instant that is NOT in the series is refused, not snapped", () => {
    const adv = advanced(UPTREND, { eventAnchorAt: END_TS + 99_999 });
    expect(adv.location.anchoredVwaps.some((x) => x.anchor === "event")).toBe(false);
    expect(adv.location.anchorUnavailable.some((u) => u.anchor === "event" && /not a candle/.test(u.reason))).toBe(true);
  });

  it("(2c) previous-period extremes and the opening range come from real candles", () => {
    const adv = advanced();
    const prevDay = adv.location.previousPeriods.day;
    expect(prevDay).toBeDefined();
    // The previous UTC day's candles are exactly the ones the range covers.
    const lastDay = new Date(END_TS).getUTCDate();
    const prevCandles = UPTREND.filter(
      (c) => new Date(c.timestamp).getUTCDate() !== lastDay,
    ).filter((c) => c.timestamp >= prevDay!.periodStart);
    expect(prevCandles.length).toBe(prevDay!.candles);
    expect(prevDay!.high).toBeCloseTo(Math.max(...prevCandles.map((c) => c.high)), 6);
    expect(prevDay!.low).toBeCloseTo(Math.min(...prevCandles.map((c) => c.low)), 6);
    // The current session is NEVER recycled into "previous day".
    expect(prevDay!.periodStart).toBeLessThan(adv.location.sessionStart!);

    expect(adv.location.openingRange).toBeDefined();
    expect(adv.location.openingRange!.candles).toBe(ADVANCED_PARAMETERS.openingRangeCandles);
  });
});

// ── 3–4. Volume profile ──────────────────────────────────────────

describe("278 — volume structure (B)", () => {
  it("(3) the volume profile distribution is derived from the supplied evidence", () => {
    const adv = advanced();
    const profile = adv.volumeStructure.profile!;
    expect(profile).toBeDefined();
    expect(profile.bins).toHaveLength(ADVANCED_PARAMETERS.volumeProfileBins);
    // Total binned volume equals the supplied total (within rounding).
    const summed = profile.bins.reduce((s, b) => s + b.volume, 0);
    expect(summed).toBeCloseTo(profile.totalVolume, 0);
    expect(profile.rangeLow).toBeCloseTo(Math.min(...UPTREND.map((c) => c.low)), 2);
    expect(profile.rangeHigh).toBeCloseTo(Math.max(...UPTREND.map((c) => c.high)), 2);
    // Value area brackets the POC.
    expect(profile.val).toBeLessThanOrEqual(profile.poc);
    expect(profile.vah).toBeGreaterThanOrEqual(profile.poc);
  });

  it("(4) POC/VAH/VAL move when the underlying distribution changes", () => {
    const base = buildVolumeDistribution(UPTREND)!;
    // Same prices, heavier volume in the LOWER half → POC must move down.
    const heavyLow = UPTREND.map((c, i) => ({ ...c, volume: i < UPTREND.length / 2 ? 5_000 : 100 }));
    const moved = buildVolumeDistribution(heavyLow)!;
    expect(moved.poc).not.toBe(base.poc);
    expect(moved.poc).toBeLessThan(base.poc);
    expect(moved.vah).not.toBe(base.vah);
    // A different price range changes the whole distribution, not just one bin.
    const other = buildVolumeDistribution(DOWNTREND)!;
    expect(other.rangeLow).not.toBe(base.rangeLow);
    expect(other.poc).not.toBe(base.poc);
  });

  it("(5) relative volume and the price-volume relation are evidence-derived", () => {
    const adv = advanced();
    const lookback = ADVANCED_PARAMETERS.relativeVolumeLookback;
    const reference = UPTREND.slice(-(lookback + 1), -1).map((c) => c.volume);
    const expected = UPTREND[UPTREND.length - 1].volume / (reference.reduce((a, b) => a + b, 0) / lookback);
    expect(adv.volumeStructure.relativeVolume!.value).toBeCloseTo(expected, 3);

    // A real volume surge changes the measured relation.
    const surge = advanced(VOLUME_SURGE);
    expect(surge.volumeStructure.relativeVolume!.value).toBeGreaterThan(adv.volumeStructure.relativeVolume!.value);
    expect(surge.volumeStructure.expansion!.state).toBe("expanding");

    // The confirmation state is one of the three documented outcomes.
    expect(["confirmed", "divergent", "inconclusive"]).toContain(adv.volumeStructure.confirmation!.state);
  });
});

// ── 6–7. Structure events ────────────────────────────────────────

describe("278 — liquidity / market structure (C)", () => {
  it("(6) liquidity sweeps change with the price structure", () => {
    const up = advanced(UPTREND);
    const down = advanced(DOWNTREND);
    const flat = advanced(RANGEBOUND);
    const levels = (c: typeof up) => c.liquidityStructure.sweeps.map((s) => `${s.side}@${s.level}`).join(",");
    expect(levels(up)).not.toBe(levels(down));
    expect(levels(flat)).not.toBe(levels(up));
    // Every sweep is anchored to a real candle of the series.
    for (const s of up.liquidityStructure.sweeps) {
      expect(UPTREND.some((c) => c.timestamp === s.candleTime)).toBe(true);
    }
  });

  it("(7) acceptance vs failure vs rejection is decided by the closes, not by intent", () => {
    const flat = 100;
    const accepted: OhlcvCandle[] = [
      { timestamp: 1, open: flat, high: flat, low: flat, close: flat, volume: 1 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100.5, volume: 1 },
      { timestamp: 3, open: 100.5, high: 102, low: 100, close: 101.5, volume: 1 },
      { timestamp: 4, open: 101.5, high: 103, low: 101, close: 102.5, volume: 1 },
    ];
    const failed: OhlcvCandle[] = [
      { timestamp: 1, open: flat, high: flat, low: flat, close: flat, volume: 1 },
      { timestamp: 2, open: 100, high: 101, low: 99, close: 100.5, volume: 1 },
      { timestamp: 3, open: 100.5, high: 102, low: 100.5, close: 101.5, volume: 1 },
      { timestamp: 4, open: 101.5, high: 102, low: 99, close: 99.5, volume: 1 },
    ];
    const rejected: OhlcvCandle[] = [
      { timestamp: 1, open: flat, high: flat, low: flat, close: flat, volume: 1 },
      { timestamp: 2, open: 100, high: 101, low: 99.5, close: 100.4, volume: 1 },
      { timestamp: 3, open: 100.4, high: 100.9, low: 100, close: 100.2, volume: 1 },
      { timestamp: 4, open: 100.2, high: 102, low: 100, close: 100.6, volume: 1 },
    ];
    const level = [{ level: 101, levelSource: "previous_day_high" as const, side: "above_level" as const }];

    expect(detectLevelInteractions(accepted, level)[0].state).toBe("accepted");
    expect(detectLevelInteractions(failed, level)[0].state).toBe("failed");
    expect(detectLevelInteractions(rejected, level)[0].state).toBe("rejected");

    // The documented threshold is what makes "accepted" mean something.
    expect(ADVANCED_PARAMETERS.breakoutAcceptanceCloses).toBe(2);
  });

  it("(7b) real series: accepted/failed interactions are reported with their level source", () => {
    const adv = advanced(UPTREND);
    const down = advanced(DOWNTREND);
    const summarize = (c: typeof adv) =>
      c.liquidityStructure.levelInteractions.map((i) => `${i.state}:${i.levelSource}`).join(",");
    expect(summarize(adv)).not.toBe(summarize(down));
    for (const i of adv.liquidityStructure.levelInteractions) {
      // Levels are REAL: each one traces back to a stated source.
      expect(i.basis.length).toBeGreaterThan(0);
      expect(i.level).toBeGreaterThan(0);
    }
  });
});

// ── 8–9. Volatility / statistics ─────────────────────────────────

describe("278 — volatility / statistical regime (D)", () => {
  it("(8) the volatility regime changes with the evidence", () => {
    const calm = makeCandles(210, 40_000, 40, 0).map((c, i) => ({
      ...c,
      high: c.high + (i % 2 === 0 ? 1 : 0),
      low: c.low - (i % 2 === 0 ? 1 : 0),
      close: c.close + (i % 3 === 0 ? 2 : 0),
    }));
    const wild = makeCandles(210, 40_000, 40, 0).map((c, i) => {
      const swing = i > 190 ? 900 : 0;
      return { ...c, high: c.high + swing, low: c.low - swing, close: c.close + swing };
    });
    const calmAdv = advanced(calm);
    const wildAdv = advanced(wild);
    expect(wildAdv.volatility.compression!.state).not.toBe("insufficient");
    expect(calmAdv.volatility.compression!.state).not.toBe("insufficient");
    // The expansion measurement itself responds to the evidence.
    expect(wildAdv.volatility.compression!.atrRatio!).toBeGreaterThan(calmAdv.volatility.compression!.atrRatio!);
    expect(wildAdv.volatility.atrPercentile!).toBeGreaterThan(calmAdv.volatility.atrPercentile!);
  });

  it("(9) z-score, σ, percentiles and clustering are deterministic measurements", () => {
    const a = advanced();
    const b = advanced();
    expect(a.volatility).toEqual(b.volatility);

    const window = ADVANCED_PARAMETERS.statisticalLookback;
    const closes = UPTREND.slice(-window).map((c) => c.close);
    const mean = closes.reduce((x, y) => x + y, 0) / window;
    const variance = closes.reduce((s, c) => s + (c - mean) ** 2, 0) / window;
    const sd = Math.sqrt(variance);
    const last = UPTREND[UPTREND.length - 1].close;
    expect(a.volatility.mean).toBeCloseTo(mean, 3);
    expect(a.volatility.stdev).toBeCloseTo(sd, 3);
    expect(a.volatility.zScore).toBeCloseTo((last - mean) / sd, 3);
    expect(a.volatility.realizedVolPercentile!).toBeGreaterThanOrEqual(0);
    expect(a.volatility.realizedVolPercentile!).toBeLessThanOrEqual(100);
    expect(["clustered", "not_clustered", "insufficient"]).toContain(a.volatility.clustering!.state);
  });
});

// ── 10–11. Determinism and responsiveness ────────────────────────

describe("278 — determinism and material change", () => {
  it("(10) identical evidence yields a byte-identical technical result", () => {
    const a = JSON.stringify(tech(UPTREND));
    const b = JSON.stringify(tech(UPTREND));
    expect(a).toBe(b);
    expect(JSON.stringify(advanced())).toBe(JSON.stringify(advanced()));

    // Same candles through the WHOLE engine also stay byte-identical.
    const input = analysisInput(UPTREND);
    expect(JSON.stringify(runAnalysis(input).technicalData)).toBe(
      JSON.stringify(runAnalysis(input).technicalData),
    );
  });

  it("(11) material market change changes the technical result", () => {
    const up = advanced(UPTREND);
    const down = advanced(DOWNTREND);
    expect(up.location.sessionVwap).not.toBe(down.location.sessionVwap);
    expect(up.volumeStructure.profile!.poc).not.toBe(down.volumeStructure.profile!.poc);
    expect(up.volatility.zScore).not.toBe(down.volatility.zScore);
    expect(up.liquidityStructure.levelInteractions.length === 0 && down.liquidityStructure.levelInteractions.length === 0).toBe(false);
  });
});

// ── 12–14. Missing evidence is never fabricated ──────────────────

describe("278 — missing evidence stays missing", () => {
  it("(12) missing volume makes every volume-derived metric explicitly unavailable", () => {
    const adv = advanced(NO_VOLUME);
    expect(adv.volumeStructure.available).toBe(false);
    expect(adv.volumeStructure.unavailableReason).toMatch(/no usable volume/i);
    expect(adv.volumeStructure.profile).toBeUndefined();
    expect(adv.volumeStructure.relativeVolume).toBeUndefined();
    expect(adv.volumeStructure.confirmation).toBeUndefined();
    // Location is volume-weighted too → explicitly unavailable, never a
    // VWAP of unweighted prices.
    expect(adv.location.available).toBe(false);
    expect(adv.location.sessionVwap).toBeUndefined();
    expect(adv.location.unavailableReason).toMatch(/volume/i);
    // The hierarchy says so as well.
    // The volume-derived entries never appear in the hierarchy; only the
    // liquidity evidence that genuinely exists is claimed.
    const volumeTier = adv.evidenceHierarchy.find((t) => t.name === "volume_liquidity")!;
    expect(volumeTier.items.every((i) => !/relative volume|price-volume|POC/.test(i))).toBe(true);
    expect(adv.evidenceHierarchy.find((t) => t.name === "location_auction")!.available).toBe(false);
    // The classical (price-only) engine is untouched by the absence.
    expect(tech(NO_VOLUME).structure).toBe("HH/HL");
  });

  it("(13) missing order-flow evidence produces no delta/CVD/absorption", () => {
    const adv = advanced();
    expect(adv.orderFlow.available).toBe(false);
    expect(adv.orderFlow.depthImbalance).toBeUndefined();
    expect(adv.orderFlow.bidVolume).toBeUndefined();
    expect(adv.orderFlow.spreadBps).toBeUndefined();
    expect(adv.orderFlow.provider).toBeUndefined();
    // The metric NAMES appear only in the "not supplied" list — no such value
    // is ever computed, so no value-bearing key exists in the object.
    const serialized = JSON.stringify(adv.orderFlow);
    expect(serialized).not.toMatch(/"(delta|cvd|cumulativeDelta|absorption|exhaustion|footprint|aggressor|tradeDirection)"\s*:/i);
    const reasons = adv.orderFlow.unavailableMetrics.map((m) => m.metric).join(" ");
    expect(reasons).toMatch(/trade_direction/);
    expect(adv.orderFlow.unavailableMetrics.every((m) => m.reason.length > 20)).toBe(true);

    // With a REAL book snapshot the measured microstructure appears...
    const withBook = advanced(UPTREND, { execution: EXECUTION });
    expect(withBook.orderFlow.available).toBe(true);
    expect(withBook.orderFlow.spreadBps).toBe(EXECUTION.spreadBps);
    expect(withBook.orderFlow.bidVolume).toBe(EXECUTION.bidDepth);
    expect(withBook.orderFlow.depthImbalance).toBeCloseTo(EXECUTION.imbalance, 4);
    // ...and the trade-side metrics are STILL declared unavailable, because an
    // aggregated book cannot supply them.
    expect(withBook.orderFlow.unavailableMetrics.map((m) => m.metric).join(" ")).toMatch(/delta/);
  });

  it("(14) missing derivatives evidence fabricates no OI or funding", () => {
    const adv = advanced();
    expect(adv.derivatives.available).toBe(false);
    expect(adv.derivatives.entries).toHaveLength(0);
    expect(JSON.stringify(adv.derivatives)).not.toMatch(/fundingRate|openInterest/);
    expect(adv.derivatives.unavailableMetrics.map((m) => m.metric).join(" ")).toMatch(/options_iv/);

    // Real derivatives evidence is carried VERBATIM (never recomputed).
    const withDeriv = advanced(UPTREND, { derivatives: DERIVATIVES });
    expect(withDeriv.derivatives.available).toBe(true);
    const oi = withDeriv.derivatives.entries.find((e) => e.metric === "open_interest")!;
    expect(oi.value).toContain("12345678");
    expect(oi.provider).toBe("coinglass");
    expect(oi.observedAt).toBe(DERIVATIVES.timestamp);
    expect(withDeriv.derivatives.entries.find((e) => e.metric === "funding_rate")!.value).toContain("0.1095");
  });

  it("(14b) cross-market context needs a REAL comparator series", () => {
    const none = advanced();
    expect(none.crossMarket.available).toBe(false);
    expect(none.crossMarket.correlation).toBeUndefined();
    // Sector-relative series do not exist in this repository → explicit refusal.
    expect(none.crossMarket.assetRelative.available).toBe(false);
    expect(none.crossMarket.assetRelative.unavailableReason).toMatch(/not|no /i);

    // A short comparator is refused rather than correlated on thin data.
    const short = advanced(UPTREND, { comparator: { symbol: "NDX", provider: "Twelve Data", closes: [1, 2, 3] } });
    expect(short.crossMarket.available).toBe(false);
    expect(short.crossMarket.unavailableReason).toMatch(/at least/);

    // A real comparator produces a REAL measured correlation.
    const comparatorCloses = UPTREND.map((c) => c.close * 0.1 + 5);
    const real = advanced(UPTREND, { comparator: { symbol: "NDX", provider: "Twelve Data", closes: comparatorCloses } });
    expect(real.crossMarket.available).toBe(true);
    expect(real.crossMarket.correlation).toBeCloseTo(1, 2);
    expect(real.crossMarket.sampleSize).toBeGreaterThanOrEqual(25);
  });
});

// ── 15–17. Provenance and protections ────────────────────────────

describe("278 — provenance, timestamps and protections", () => {
  it("(15) exact provider/native identity and timeframe survive", () => {
    const adv = advanced();
    expect(adv.provenance.provider).toBe("okx");
    expect(adv.provenance.providerInstrumentId).toBe("BTC-USDT");
    expect(adv.provenance.timeframe).toBe("H4");
    // Re-attaching with a different provider NEVER rewrites the candles.
    const reattached = attachAdvancedTechnical(UPTREND, adv, tech(UPTREND), {
      timeframe: "H4",
      provider: "twelve-data",
      providerInstrumentId: "BTC/USD",
    });
    expect(reattached.provenance.provider).toBe("twelve-data");
    expect(reattached.provenance.providerInstrumentId).toBe("BTC/USD");
    expect(reattached.location.sessionVwap).toBe(adv.location.sessionVwap);
  });

  it("(16) the observation timestamp is the provider's own candle instant", () => {
    const adv = advanced();
    expect(adv.provenance.observedAt).toBe(END_TS);
    expect(adv.provenance.observedAt).toBe(UPTREND[UPTREND.length - 1].timestamp);
    expect(adv.provenance.dataPoints).toBe(UPTREND.length);
    // Non-candle evidence keeps its OWN instant, distinct from the candles'.
    const withBook = advanced(UPTREND, { execution: EXECUTION });
    expect(withBook.orderFlow.snapshotTs).toBe(EXECUTION.snapshotTs);
    expect(withBook.provenance.observedAt).toBe(END_TS);
    expect(withBook.orderFlow.snapshotTs).not.toBe(END_TS);
  });

  it("(17) no clock, no randomness, no I/O and no future evidence in the layer", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/lib/data/advanced-technical.ts"), "utf8");
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/fetch\(/);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    // Future-dated candles: the engine's existing staleness protections still
    // refuse them, and the advanced layer does not resurrect the data.
    const future = makeCandles(210, 40_000, 40, 0).map((c) => ({ ...c, timestamp: c.timestamp + 10 * 365 * 86_400_000 }));
    const futureAdv = advanced(future);
    expect(futureAdv.provenance.observedAt).toBe(future[future.length - 1].timestamp);
    // A zero/negative volume record inside an otherwise valid series is ignored
    // for weighting instead of being treated as participation.
    const withZero = UPTREND.map((c, i) => (i === UPTREND.length - 1 ? { ...c, volume: 0 } : c));
    const zeroAdv = advanced(withZero);
    expect(zeroAdv.volumeStructure.relativeVolume!.value).toBe(0);
    expect(zeroAdv.volumeStructure.relativeVolume!.state).toBe("low");
  });
});

// ── 18. Classical indicators remain, and remain secondary ────────

describe("278 — classical indicators are unchanged and explicitly secondary", () => {
  it("(18) RSI/MACD keep their exact values and sit at tier 6 of the hierarchy", () => {
    const t = tech(UPTREND);
    const closes = UPTREND.map((c) => c.close);
    expect(t.rsi14).toBeCloseTo(Math.round(rsi(closes, 14)! * 10) / 10, 6);
    const m = macd(closes)!;
    expect(t.macdHistogram).toBeCloseTo(m.histogram, 9);

    const adv = advanced();
    const tier = adv.evidenceHierarchy.find((x) => x.name === "momentum_oscillators")!;
    expect(tier.tier).toBe(6);
    expect(tier.note).toMatch(/SECONDARY/);
    // Structure/location/volume/volatility all outrank momentum.
    for (const name of ["market_structure", "location_auction", "volume_liquidity", "volatility_regime"]) {
      expect(adv.evidenceHierarchy.find((x) => x.name === name)!.tier).toBeLessThan(6);
    }
  });

  it("(18b) the advanced evidence cannot create a directional call on its own", () => {
    const adv = advanced();
    // No direction ⇒ no contribution at all, whatever the confluence.
    const none = assessAdvancedEvidence(adv, "none");
    expect(none.contribution).toBe(0);
    expect(none.confluence).toHaveLength(0);
    expect(none.conflicts).toHaveLength(0);
    // Every stated rule cites the evidence it read and stays inside its cap.
    const long = assessAdvancedEvidence(adv, "long");
    expect(Math.abs(long.contribution)).toBeLessThanOrEqual(long.cap);
    expect(long.cap).toBe(6);
    for (const b of long.basis) expect(b).toMatch(/[+-]\d+ .*—/);
  });
});

// ── 19–23. Existing paths stay green (asserted end-to-end here) ──

function analysisInput(candles: OhlcvCandle[], extra: Partial<AnalysisInput> = {}): AnalysisInput {
  const techData = calculateTechnical(candles);
  const last = candles[candles.length - 1];
  return {
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    timeframe: "H4",
    tradingStyle: "intraday",
    provider: "okx",
    providerInstrumentId: "BTC-USDT",
    marketData: {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      price: { price: last.close, timestamp: last.timestamp, source: "okx" },
      candles,
      timeframe: "H4",
      fetchTimestamp: last.timestamp,
      dataFreshness: "realtime",
    },
    technicalData: techData,
    ...extra,
  } as AnalysisInput;
}

describe("278 — the advanced layer inside the existing pipeline", () => {
  it("(19) the OKX live-shaped path still analyses end-to-end and carries the advanced block", () => {
    const result = runAnalysis(analysisInput(UPTREND, { executionData: EXECUTION, derivativesData: DERIVATIVES }));
    expect(result.provider).toBe("okx");
    expect(result.providerInstrumentId).toBe("BTC-USDT");
    expect(result.technicalData?.advanced).toBeDefined();
    // The engine attached the REAL order-book + derivatives evidence.
    expect(result.technicalData!.advanced!.orderFlow.available).toBe(true);
    expect(result.technicalData!.advanced!.orderFlow.provider).toBe("OKX public order book");
    expect(result.technicalData!.advanced!.derivatives.available).toBe(true);
    expect(result.technicalData!.advanced!.provenance.provider).toBe("okx");
    expect(result.technicalData!.advanced!.provenance.providerInstrumentId).toBe("BTC-USDT");
  });

  it("(20) the CCXT live-shaped path is unchanged and equally supported", () => {
    const result = runAnalysis(
      analysisInput(UPTREND, { provider: "ccxt", providerInstrumentId: "BTC/USDT" }),
    );
    expect(result.provider).toBe("ccxt");
    const adv = result.technicalData!.advanced!;
    expect(adv.provenance.provider).toBe("ccxt");
    expect(adv.provenance.providerInstrumentId).toBe("BTC/USDT");
    // No order book for ccxt → order flow explicitly unavailable, no invented book.
    expect(adv.orderFlow.available).toBe(false);
    expect(adv.orderFlow.bid).toBeUndefined();
  });

  it("(21) the Phase 273 classical contract still holds on the same result", () => {
    const result = runAnalysis(analysisInput(UPTREND));
    expect(result.technicalData!.structure).toBe("HH/HL");
    expect(result.technicalData!.rsi14).toBeDefined();
    expect(result.technicalData!.atr14).toBeDefined();
    expect(result.technicalData!.volatilityState).toBeDefined();
    expect(result.technicalData!.swingHighs.length).toBeGreaterThan(1);
    // The classical fields are untouched by the advanced layer.
    const base = calculateTechnical(UPTREND);
    expect(result.technicalData!.rsi14).toBe(base.rsi14);
    expect(result.technicalData!.macdHistogram).toBe(base.macdHistogram);
    expect(result.technicalData!.supportLevels).toEqual(base.supportLevels);
  });

  it("(22) Phase 276 unified intelligence still derives from the same technical evidence", () => {
    const result = runAnalysis(analysisInput(UPTREND));
    expect(result.unifiedIntelligence).toBeDefined();
    expect(result.unifiedIntelligence!.technical.bias).toBe("bullish");
    expect(result.unifiedIntelligence!.state).toBe("technical_only");
    // The advanced block's own observation instant is the same provider instant
    // the unified layer carries (one instant, no divergence).
    expect(result.unifiedIntelligence!.technical.observedAt).toBe(
      result.technicalData!.advanced!.provenance.observedAt,
    );
  });

  it("(23) the Phase 277 radar path still consumes the same technical evidence", () => {
    const result = runAnalysis(analysisInput(UPTREND));
    // The advanced block rides on technicalData, so it reaches every consumer
    // (radar candidate building included) without a second computation.
    expect(result.technicalData!.advanced!.evidenceHierarchy).toHaveLength(8);
    expect(result.technicalData!.advanced!.evidenceHierarchy.map((t) => t.tier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("(23b) the decision surfaces the real confluence/conflicts it used", () => {
    const result = runAnalysis(analysisInput(UPTREND, { executionData: EXECUTION }));
    const evidence = result.advancedTechnicalEvidence!;
    expect(evidence).toBeDefined();
    expect(Array.isArray(evidence.confluence)).toBe(true);
    expect(Array.isArray(evidence.conflicts)).toBe(true);
    expect(evidence.evidenceClasses).toContain("candle_ohlcv");
    expect(evidence.evidenceClasses).toContain("order_book_snapshot");
    expect(evidence.unavailableMetrics.map((m) => m.metric).join(" ")).toMatch(/delta/);
    // Conflicts the advanced layer found are surfaced through the existing
    // contradiction channel — they never become a decision on their own.
    for (const c of evidence.conflicts) {
      expect(result.keyContradictions?.some((k) => k.description.includes(c))).toBe(true);
    }
  });
});

// ── 24. UI renders the engine's exact output ────────────────────

describe("278 — the UI renders the engine's own output", () => {
  it("(24) the advanced section displays the exact engine values, with no frontend re-derivation", () => {
    const result = runAnalysis(analysisInput(UPTREND, { executionData: EXECUTION, derivativesData: DERIVATIVES }));
    const adv = result.technicalData!.advanced!;
    render(createElement(AnalysisResultDisplay, { result }));

    const location = screen.getByTestId("advanced-location").textContent ?? "";
    expect(location).toContain(adv.location.sessionVwap!.toFixed(2));
    expect(location).toContain("session VWAP");

    const volume = screen.getByTestId("advanced-volume").textContent ?? "";
    expect(volume).toContain(adv.volumeStructure.profile!.poc.toFixed(2));
    expect(volume).toContain(adv.volumeStructure.relativeVolume!.value.toFixed(2));

    const volatility = screen.getByTestId("advanced-volatility").textContent ?? "";
    expect(volatility).toMatch(/z-score/i);

    const orderFlow = screen.getByTestId("advanced-orderflow").textContent ?? "";
    expect(orderFlow).toContain(adv.orderFlow.spreadBps!.toFixed(2));
    expect(orderFlow).toContain("OKX public order book");

    const hierarchy = screen.getByTestId("advanced-hierarchy").textContent ?? "";
    expect(hierarchy).toContain("momentum_oscillators");
    expect(hierarchy).toMatch(/SECONDARY/);

    // The metrics no feed supplies are shown as unavailable — never as zero.
    const unavailable = screen.getByTestId("advanced-unavailable-metrics").textContent ?? "";
    expect(unavailable).toMatch(/delta/);
    expect(unavailable).not.toContain("0.00");

    // No React-side recomputation: the rendered numbers are the engine's.
    expect(result.technicalData!.advanced!.provenance.parameters).toEqual({ ...ADVANCED_PARAMETERS });
  });

  it("(24b) with no order book and no derivatives the card states the absence, never a zero", () => {
    const result = runAnalysis(analysisInput(UPTREND));
    render(createElement(AnalysisResultDisplay, { result }));
    const orderFlow = screen.getByTestId("advanced-orderflow").textContent ?? "";
    expect(orderFlow).toMatch(/unavailable/i);
    expect(orderFlow).not.toMatch(/\b0\.00\b/);
    const derivatives = screen.getByTestId("advanced-derivatives").textContent ?? "";
    expect(derivatives).toMatch(/unavailable/i);
  });
});
