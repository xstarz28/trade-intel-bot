/**
 * Phase 7D — engine integration of EIA WPSR inventory context.
 *
 * Proves:
 * - oil instruments receive bounded EIA evidence; non-oil assets get NOTHING
 * - provider failure / staleness / sub-threshold changes never distort
 *   primary analysis (availability ≠ confluence)
 * - news-derived supply keywords become REDUNDANT when actual EIA data is
 *   directional (anti-double-counting), but stay the honest fallback without it
 * - EIA can NEVER flip structural bias or rescue NO_TRADE
 * - opposing inventory data surfaces as a contradiction (never DECISIVE)
 * - style-scaled caps: swing ≥ intraday ≥ scalping influence
 * - NO_TRADE state integrity is untouched
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";
import type { EiaContext, EiaData, EiaSeriesPoint } from "@/lib/data/eia";

// ── Fixtures ───────────────────────────────────────────────────────

function makeMarket(instrument: string, instrumentType: AnalysisInput["instrumentType"], price = 80): MarketData {
  return {
    instrument, instrumentType, provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

function techBase(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [85], swingLows: [78],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [78], resistanceLevels: [85], // entry 80 → R:R 2.5
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

const mtfBullish = {
  requestedTimeframe: "H4", chainUsed: ["D1", "H4", "H1"], unavailable: [],
  timeframes: [], alignment: "ALIGNED_BULLISH" as const, htfBias: "long" as const,
  htfTimeframe: "D1", setupTimeframe: "H4", triggerTimeframe: "H1",
};

function oilInput(over?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "WTI", instrumentType: "commodity", timeframe: "H4",
    tradingStyle: "intraday",
    economicEvents: undefined,
    // Geopolitical risk words are DISTINCT from inventories (counted alongside
    // EIA by design) and give the fixture its second core factor honestly.
    newsContext: "sanctions conflict",
    marketData: makeMarket("WTI", "commodity"),
    technicalData: techBase({ mtf: mtfBullish }),
    ...over,
  } as AnalysisInput;
}

/** Realistic crude series (~420M bbl). Draw/build sized to clear thresholds. */
function eiaCtx(
  opts?: {
    crudeLatest?: number; crudePrev?: number;
    gasLatest?: number; gasPrev?: number;
    distLatest?: number; distPrev?: number;
    freshness?: "FRESH" | "DELAYED" | "STALE";
  },
): EiaContext {
  const o = opts ?? {};
  const mk = (
    productId: string,
    latest?: number,
    prev?: number,
  ): EiaSeriesPoint => {
    const p: EiaSeriesPoint = {
      productId,
      productName: productId,
      observationDate: "2026-08-18",
      latestValue: latest ?? 0,
      unit: "million barrels",
    };
    if (prev !== undefined) {
      p.previousObservationDate = "2026-08-11";
      p.previousValue = prev;
      p.change = (latest ?? 0) - prev;
      p.changePercent = (p.change / prev) * 100;
    }
    return p;
  };
  const series: EiaSeriesPoint[] = [mk("EPC0", o.crudeLatest ?? 420, o.crudePrev)];
  if (o.gasLatest !== undefined) series.push(mk("EPM0", o.gasLatest, o.gasPrev));
  if (o.distLatest !== undefined) series.push(mk("EPD0", o.distLatest, o.distPrev));
  return {
    available: true,
    source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)",
    fetchedAt: Date.now(),
    freshness: o.freshness ?? "FRESH",
    series,
    failedLegs: [],
  };
}

const CRUDE_DRAW = () => eiaCtx({ crudeLatest: 410, crudePrev: 420 }); // −10M bbl ≈ −2.4%
const CRUDE_BUILD = () => eiaCtx({ crudeLatest: 430, crudePrev: 420 }); // +10M bbl
const CRUDE_NOISE = () => eiaCtx({ crudeLatest: 420.3, crudePrev: 420 }); // sub-threshold

// ── Oil receives evidence; non-oil does not ────────────────────────

describe("oil scope & layer behavior", () => {
  it("bullish draw raises conviction for a bullish oil thesis WITHIN bounds", () => {
    const base = runAnalysis(oilInput());
    const withDraw = runAnalysis(oilInput({ eiaData: CRUDE_DRAW() }));
    expect(withDraw.recommendation).toBe("LONG");
    expect(withDraw.confidence).toBeGreaterThan(base.confidence);
    // Bounded by the intraday cap (±4): never a huge jump from one dataset.
    expect(withDraw.confidence - base.confidence).toBeLessThanOrEqual(6);
  });

  it("bearish build lowers conviction and surfaces an explicit contradiction", () => {
    const base = runAnalysis(oilInput());
    const withBuild = runAnalysis(oilInput({ eiaData: CRUDE_BUILD() }));
    expect(withBuild.recommendation).toBe("LONG"); // structure still wins — no flip
    expect(withBuild.confidence).toBeLessThan(base.confidence);
    expect(
      withBuild.keyContradictions?.some((c) => /EIA inventory/i.test(c.description)),
    ).toBe(true);
  });

  it("non-oil assets receive ZERO effect even when EIA data is present", () => {
    const gold = (): AnalysisInput =>
      ({
        instrument: "XAU/USD", instrumentType: "commodity", timeframe: "H4",
        tradingStyle: "swing",
        marketData: makeMarket("XAU/USD", "commodity"),
        technicalData: techBase({ mtf: mtfBullish }),
      }) as never;
    const base = runAnalysis(gold());
    const goldWithEia = { ...gold(), eiaData: CRUDE_BUILD() } as never;
    const withEia = runAnalysis(goldWithEia);
    expect(withEia.confidence).toBe(base.confidence); // not applicable ≠ neutral vote
    expect(withEia.keyContradictions?.some((c) => /EIA/i.test(c.description))).toBe(false);
  });
});

// ── Availability ≠ confluence ─────────────────────────────────────

describe("data integrity & non-fatal failure", () => {
  it("sub-threshold weekly change contributes NOTHING", () => {
    const base = runAnalysis(oilInput());
    const withNoise = runAnalysis(oilInput({ eiaData: CRUDE_NOISE() }));
    expect(withNoise.confidence).toBe(base.confidence);
    expect(withNoise.recommendation).toBe(base.recommendation);
  });

  it("STALE inventory data contributes nothing directional but stays disclosed", () => {
    const stale = eiaCtx({ crudeLatest: 410, crudePrev: 420, freshness: "STALE" });
    const r = runAnalysis(oilInput({ eiaData: stale }));
    const base = runAnalysis(oilInput());
    expect(r.eiaContext?.freshness).toBe("STALE");
    expect(r.eiaContext?.series[0].observationDate).toBe("2026-08-18");
    expect(r.confidence).toBe(base.confidence); // stale → zero directional weight
  });

  it("provider failure leaves conviction IDENTICAL to baseline + informational flag", () => {
    const base = runAnalysis(oilInput());
    const failed = runAnalysis(
      oilInput({ eiaData: { available: false, reason: "HTTP 500" } }),
    );
    expect(failed.confidence).toBe(base.confidence);
    expect(failed.recommendation).toBe(base.recommendation);
    expect(failed.dataFlags.join(" ")).toMatch(/EIA inventory context unavailable \(HTTP 500\)/);
  });

  it("provenance is complete: source, observation date, unit, freshness", () => {
    const r = runAnalysis(oilInput({ eiaData: CRUDE_DRAW() }));
    expect(r.eiaContext?.source).toContain("Energy Information Administration");
    expect(r.eiaContext?.series[0].observationDate).toBe("2026-08-18");
    expect(r.eiaContext?.series[0].unit).toBe("million barrels");
  });
});

// ── Anti-double-counting vs news ──────────────────────────────────

describe("news anti-double-counting", () => {
  it("supply-keyword news counts WITHOUT EIA but becomes redundant WITH directional EIA data", () => {
    const newsSupply = "opec supply cut production disruption";
    // A: no EIA, supply news → keyword counted.
    const a = runAnalysis(oilInput({ economicEvents: undefined, newsContext: newsSupply }));
    // C: directional EIA draw, neutral news.
    const c = runAnalysis(oilInput({ economicEvents: undefined, newsContext: "" }));
    // B: directional EIA draw AND supply news → keyword must be SKIPPED.
    const b = runAnalysis(oilInput({ economicEvents: undefined, newsContext: newsSupply, eiaData: CRUDE_DRAW() }));

    expect(a.breakdown.fundamental).toBeGreaterThan(0); // fallback works honestly
    expect(b.breakdown.fundamental).toBe(c.breakdown.fundamental); // no double-count
  });

  it("geopolitical keywords remain counted alongside EIA (distinct phenomenon)", () => {
    const withGeoNoEia = runAnalysis(oilInput({ economicEvents: undefined, newsContext: "sanctions conflict" }));
    const withGeoAndEia = runAnalysis(
      oilInput({ economicEvents: undefined, newsContext: "sanctions conflict", eiaData: CRUDE_DRAW() }),
    );
    // EIA layer adds on top of still-counted geopolitical context.
    expect(withGeoAndEia.confidence).toBeGreaterThanOrEqual(withGeoNoEia.confidence);
  });
});

// ── Style behavior & decision integrity ───────────────────────────

describe("style-scaled caps & decision integrity", () => {
  it("swing influence ≥ intraday ≥ scalping from identical market+EIA facts", () => {
    const diffFor = (style: "scalping" | "intraday" | "swing") => {
      const base = runAnalysis(oilInput({ tradingStyle: style }));
      const boosted = runAnalysis(oilInput({ tradingStyle: style, eiaData: CRUDE_DRAW() }));
      return boosted.confidence - base.confidence;
    };
    expect(diffFor("swing")).toBeGreaterThanOrEqual(diffFor("intraday"));
    expect(diffFor("intraday")).toBeGreaterThanOrEqual(diffFor("scalping"));
  });

  it("Neutral structural bias stays NO_TRADE regardless of a large inventory draw", () => {
    const neutral = oilInput({
      technicalData: techBase({
        mtf: { ...mtfBullish, alignment: "INSUFFICIENT_DATA" as const },
        structure: "LH/LL", bosDirection: "bearish",
        swingHighs: [82], swingLows: [81], supportLevels: [81], resistanceLevels: [82],
      }),
      eiaData: CRUDE_DRAW(),
    });
    const r = runAnalysis(neutral);
    expect(["NO_TRADE"]).toContain(r.recommendation);
    if (r.recommendation === "NO_TRADE") expect(r.tradePlan).toBeUndefined();
  });

  it("opposing EIA can weaken but never DECISIVELY force NO_TRADE on its own", () => {
    const r = runAnalysis(oilInput({ eiaData: CRUDE_BUILD() }));
    // A valid structural LONG survives opposing slow-data context.
    expect(r.recommendation).not.toBe("NO_TRADE");
    expect(r.tradePlan).toBeDefined();
    expect(r.keyContradictions?.some((c) => c.severity === "DECISIVE" && /EIA/i.test(c.description))).toBe(false);
  });
});
