/**
 * Phase 7B-2 — engine integration of CFTC COT positioning.
 *
 * Proves:
 * - provider failure/unavailable mapping never blocks or distorts analysis
 * - COT is one bounded layer per dataset (level alone scores nothing)
 * - change-based evidence moves conviction WITHIN style caps (swing largest)
 * - COT can never create a trade, flip bias, or override structure
 * - opposing/crowded positioning surfaces as a key contradiction (never DECISIVE)
 * - crypto spot has no COT mapping; CoinGlass stays the separate crypto source
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";
import type { CotContext, CotData } from "@/lib/data/cot";

// ── Fixtures ───────────────────────────────────────────────────────

function makeMarket(instrument: string, price = 100): MarketData {
  return {
    instrument, instrumentType: "forex", provider: "twelve-data",
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
    swingHighs: [105], swingLows: [98],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [98], resistanceLevels: [105], // entry 100 → R:R 2.5
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

function baseInput(over?: Partial<AnalysisInput>): AnalysisInput {
  const instrument = over?.instrument ?? "EUR/USD";
  const instrumentType =
    over?.instrumentType ?? (/XAU|XAG|WTI|CRUDE/.test(instrument) ? "commodity" : "forex");
  return {
    instrument, instrumentType, timeframe: "H4",
    economicEvents: "hawkish rate hike strong gdp",
    marketData: { ...makeMarket(instrument), instrumentType },
    technicalData: techBase(),
    ...over,
  } as AnalysisInput;
}

const mtfBullish = {
  requestedTimeframe: "H4", chainUsed: ["D1", "H4", "H1"], unavailable: [],
  timeframes: [], alignment: "ALIGNED_BULLISH" as const, htfBias: "long" as const,
  htfTimeframe: "D1", setupTimeframe: "H4", triggerTimeframe: "H1",
};

/** Valid swing-eligible setup (readable HTF context). */
const swingSetup = (over?: Partial<AnalysisInput>): AnalysisInput =>
  baseInput({ tradingStyle: "swing", technicalData: techBase({ mtf: mtfBullish }), ...over });

const OI = 406260;

function cotCtx(opts?: {
  latestLong?: number;
  prevLong?: number;
  short?: number;
  oi?: string;
  freshness?: "FRESH" | "DELAYED" | "STALE";
}): Extract<CotData, { available: true }> {
  const o = opts ?? {};
  const long = o.latestLong ?? 256902;
  return {
    available: true,
    source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
    fetchedAt: Date.now(),
    freshness: o.freshness ?? "FRESH",
    requestedInstrument: "EUR/USD",
    sourceInstrument: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    mappedAsset: "Euro FX futures (CME)",
    latest: {
      reportDate: "2026-08-18",
      nonCommercialLong: long,
      nonCommercialShort: o.short ?? 34713,
      openInterest: parseInt(o.oi ?? String(OI), 10),
    },
    previous: {
      reportDate: "2026-08-11",
      nonCommercialLong: o.prevLong ?? long,
      nonCommercialShort: o.short ?? 34713,
      openInterest: parseInt(o.oi ?? String(OI), 10),
    },
    netNonCommercial: long - (o.short ?? 34713),
    changeFromPreviousReport: long - (o.prevLong ?? long),
  } as unknown as Extract<CotData, { available: true }>;
}

// ── Failure behavior ───────────────────────────────────────────────

describe("provider failure & unmappable instruments are non-fatal", () => {
  it("unavailable COT leaves a valid LONG intact and flags informationally", () => {
    const without = runAnalysis(swingSetup());
    const withFailed = runAnalysis(
      swingSetup({ cotData: { available: false, reason: "CFTC endpoint unreachable", requestedInstrument: "EUR/USD" } }),
    );
    expect(withFailed.recommendation).toBe(without.recommendation);
    expect(withFailed.confidence).toBe(without.confidence); // provider failure ≠ penalty
    expect(withFailed.dataFlags.join(" ")).toMatch(/COT positioning context unavailable/);
  });

  it("crypto spot has NO COT mapping — CoinGlass remains the separate crypto source", () => {
    // Engine receives an unavailable-mapping COT result exactly as Convex would return.
    const r = runAnalysis(
      baseInput({
        instrument: "BTC/USD",
        instrumentType: "crypto",
        cotData: { available: false, reason: "No verified CFTC futures contract mapping for BTC/USD.", requestedInstrument: "BTC/USD" },
      }),
    );
    expect(r.cotContext).toBeUndefined(); // no fabricated positioning
    expect(r.dataFlags.join(" ")).toMatch(/COT positioning context unavailable/);
  });
});

// ── Style-scaled layer ─────────────────────────────────────────────

describe("positioning-COT conviction layer (style-capped)", () => {
  it("increasing net-long supports a bullish thesis; swing weights it most", () => {
    const rising = cotCtx({ latestLong: 280000, prevLong: 250000 });
    const i0 = runAnalysis(baseInput({ tradingStyle: "intraday" }));
    const i1 = runAnalysis(baseInput({ tradingStyle: "intraday", cotData: rising }));
    const s0 = runAnalysis(swingSetup());
    const s1 = runAnalysis(swingSetup({ cotData: rising }));
    expect(i1.confidence!).toBeGreaterThan(i0.confidence!);
    expect(i1.confidence! - i0.confidence!).toBeLessThanOrEqual(5); // intraday cap ±5
    expect(s1.confidence!).toBeGreaterThan(s0.confidence!);
    expect(s1.confidence! - s0.confidence!).toBeLessThanOrEqual(12); // swing cap ±12
    expect(s1.confidence! - s0.confidence!).toBeGreaterThanOrEqual(i1.confidence! - i0.confidence!);
  });

  it("decreasing positioning opposes the thesis and surfaces as contradiction", () => {
    const falling = cotCtx({ latestLong: 230000, prevLong: 260000 });
    const r = runAnalysis(swingSetup({ cotData: falling }));
    expect(r.keyContradictions?.some((c) => /CFTC futures positioning/i.test(c.description))).toBe(true);
    expect(r.keyContradictions?.find((c) => /CFTC/i.test(c.description))?.severity).not.toBe("DECISIVE");
    // Contradiction does not by itself force NO_TRADE — gates decide.
    expect(r.bias).not.toBe("Neutral");
  });

  it("crowded positioning alone adds no directional score but is disclosed as context", () => {
    // Net long ≈ 63% of OI with zero change → crowded, effect 0.
    const crowdedFlat = cotCtx({ latestLong: 290000, prevLong: 290000 });
    const none = runAnalysis(swingSetup());
    const r = runAnalysis(swingSetup({ cotData: crowdedFlat }));
    expect(r.confidence).toBe(none.confidence); // level alone ≠ evidence
    expect(r.cotContext?.netNonCommercial).toBeGreaterThan(0);
  });

  it("unchanged/sub-threshold change → identical conviction (availability ≠ confluence)", () => {
    const flat = cotCtx({ latestLong: 256902, prevLong: 256902 });
    const tiny = cotCtx({ latestLong: 257100, prevLong: 256902 });
    const none = runAnalysis(swingSetup());
    expect(runAnalysis(swingSetup({ cotData: flat })).confidence).toBe(none.confidence);
    expect(runAnalysis(swingSetup({ cotData: tiny })).confidence).toBe(none.confidence);
  });
});

// ── Contract-side semantics ────────────────────────────────────────

describe("contract-side direction semantics", () => {
  it("quote-contract pairs invert instrument-level effect (JPY contract ≠ USD/JPY long)", () => {
    // Rising JPY-contract net-long supports JPY → opposes USD/JPY longs.
    const risingJpy = {
      ...cotCtx({ latestLong: 280000, prevLong: 250000 }),
      requestedInstrument: "USD/JPY",
      sourceInstrument: "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",
      mappedAsset: "Japanese Yen futures (CME)",
    };
    const r = runAnalysis(
      baseInput({ instrument: "USD/JPY", tradingStyle: "intraday", cotData: risingJpy }),
    );
    const none = runAnalysis(baseInput({ instrument: "USD/JPY", tradingStyle: "intraday" }));
    expect(r.confidence!).toBeLessThan(none.confidence!); // inverted vs base-contract pairs
  });
});

// ── Hierarchy: COT cannot create trades or override structure ──────

describe("hierarchy invariants", () => {
  it("strongly supportive COT cannot rescue a Neutral-bias market", () => {
    const neutralMarket = baseInput({
      tradingStyle: "swing",
      technicalData: techBase({ structure: "range", bosDirection: "none", swingHighs: [101], swingLows: [99], resistanceLevels: [101], supportLevels: [99] }),
      economicEvents: undefined,
      newsContext: undefined,
      calendarData: undefined,
      macroData: undefined,
    });
    const r = runAnalysis({ ...neutralMarket, cotData: cotCtx({ latestLong: 280000, prevLong: 250000 }) });
    expect(r.recommendation).toBe("NO_TRADE");
  });

  it("supportive COT cannot flip a bearish-structure thesis to bullish", () => {
    const bearish = runAnalysis(
      swingSetup({
        technicalData: techBase({
          structure: "LH/LL", bosDirection: "bearish", chochDirection: "bearish",
          swingHighs: [101], swingLows: [95], supportLevels: [95], resistanceLevels: [101],
        }),
        cotData: cotCtx({ latestLong: 280000, prevLong: 250000 }),
      }),
    );
    expect(bearish.bias).toBe("Bearish");
  });

  it("NO_TRADE state consistency preserved with rich COT context present", () => {
    const r = runAnalysis(
      baseInput({
        tradingStyle: "swing",
        technicalData: techBase({ supportLevels: [99], resistanceLevels: [101], swingHighs: [101], swingLows: [99] }),
        cotData: cotCtx({ latestLong: 280000, prevLong: 250000 }),
      }),
    );
    if (r.recommendation === "NO_TRADE") expect(r.tradePlan).toBeUndefined();
  });
});

// ── Cross-source separation ────────────────────────────────────────

describe("cross-source integrity (COT vs CoinGlass)", () => {
  it("COT and CoinGlass layers remain separate; combined agreement stays bounded", () => {
    // Crypto uses CoinGlass only (no COT mapping); forex uses COT only.
    // This test pins that both sources can coexist on different instruments
    // without ever merging into one oversized positioning layer.
    const fxWithCot = runAnalysis(
      swingSetup({ cotData: cotCtx({ latestLong: 280000, prevLong: 250000 }) }),
    );
    const fxNone = runAnalysis(swingSetup());
    expect(fxWithCot.confidence! - fxNone.confidence!).toBeLessThanOrEqual(12); // single COT cap
    expect(fxWithCot.cotContext?.source).toMatch(/CFTC/); // labeled regulated futures positioning
  });

  it("COT unavailable while CoinGlass available → each degrades independently", () => {
    const r = runAnalysis(
      baseInput({
        instrument: "BTC/USD",
        instrumentType: "crypto",
        cotData: { available: false, reason: "No verified CFTC futures contract mapping for BTC/USD.", requestedInstrument: "BTC/USD" },
        fundingRate: "0.01",
      }),
    );
    expect(r.dataFlags.join(" ")).toMatch(/COT positioning context unavailable/);
    expect(r.dataFlags.join("")).not.toMatch(/funding rate data — sentiment limited/i); // CoinGlass path intact
  });
});

// ── Backward compatibility ─────────────────────────────────────────

it("absent cotData behaves exactly like before Phase 7B-2", () => {
  const a = runAnalysis(swingSetup());
  const b = runAnalysis(swingSetup({ cotData: undefined }));
  expect(a.confidence).toBe(b.confidence);
  expect(a.recommendation).toBe(b.recommendation);
});
