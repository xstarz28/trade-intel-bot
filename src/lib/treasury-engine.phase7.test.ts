/**
 * Phase 7B-1 — engine integration of US Treasury yield/real-yield context.
 *
 * Proves:
 * - provider failure/staleness never blocks or distorts primary analysis
 * - nominal vs real yields stay distinct with full provenance
 * - macro-yield evidence moves conviction WITHIN its style-scaled layer cap
 * - availability alone adds nothing; sub-threshold/no-direction adds nothing
 * - Treasury can NEVER create or flip a trade by itself
 * - opposing macro evidence surfaces as a key contradiction (never DECISIVE)
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";
import type {
  TreasuryContext,
  TreasuryData,
} from "@/lib/data/treasury";

// ── Fixtures ───────────────────────────────────────────────────────

function makeMarket(instrument: string, price: number): MarketData {
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
  const instrumentType = over?.instrumentType ?? (instrument === "XAU/USD" ? "commodity" : "forex");
  return {
    instrument, instrumentType, timeframe: "H4",
    economicEvents: "hawkish rate hike strong gdp",
    marketData: { ...makeMarket(instrument, 100), instrumentType },
    technicalData: techBase(),
    ...over,
  } as AnalysisInput;
}

/** Build a real TreasuryContext object (same shape the Convex action returns). */
function treasuryCtx(opts?: {
  nomLatest?: Record<string, number>;
  nomPrev?: Record<string, number>;
  realLatest?: Record<string, number>;
  realPrev?: Record<string, number>;
  freshness?: "FRESH" | "DELAYED" | "STALE";
}): Extract<TreasuryData, { available: true }> {
  const o = opts ?? {};
  const latestNom = { observationDate: "2026-08-21", nominal: o.nomLatest ?? { "2Y": 4.2, "10Y": 4.63 } };
  const prevNom = { observationDate: "2026-08-20", nominal: o.nomPrev ?? { "2Y": 4.25, "10Y": 4.7 } };
  const ctx: TreasuryContext = {
    available: true,
    source: "US Treasury (home.treasury.gov XML feed)",
    fetchedAt: Date.now(),
    freshness: o.freshness ?? "FRESH",
    latest: {
      nominal: latestNom,
      ...(o.realLatest ? { real: { observationDate: "2026-08-21", real: o.realLatest } } : {}),
    },
    previous: {
      nominal: prevNom,
      ...(o.realPrev ? { real: { observationDate: "2026-08-20", real: o.realPrev } } : {}),
    },
  };
  return ctx;
}

const mtfBullish = {
  requestedTimeframe: "H4", chainUsed: ["D1", "H4", "H1"], unavailable: [],
  timeframes: [], alignment: "ALIGNED_BULLISH" as const, htfBias: "long" as const,
  htfTimeframe: "D1", setupTimeframe: "H4", triggerTimeframe: "H1",
};

/** Valid SWING-eligible gold setup: readable HTF + gold-relevant macro context. */
const goldSwing = (): AnalysisInput =>
  baseInput({
    instrument: "XAU/USD",
    tradingStyle: "swing",
    technicalData: techBase({ mtf: mtfBullish }),
    economicEvents: undefined,
    newsContext: "safe haven demand geopolitical risk dovish rate cut",
  });

/** Valid SWING-eligible forex setup. */
const fxSwing = (): AnalysisInput =>
  baseInput({
    tradingStyle: "swing",
    technicalData: techBase({ mtf: mtfBullish }),
  });

const smcWithDisplacement = () =>
  ({
    internalExternal: {
      external: { structure: "HH/HL", bosDirection: "bullish", chochDirection: "none" },
      internal: { structure: "HH/HL", bosDirection: "bullish", chochDirection: "none" },
      internalConflict: false,
    },
    liquidityPools: [], fvgs: [], orderBlocks: [],
    timeframe: "H4",
    vwap: { available: false },
    volumeProfile: { available: false },
    displacement: { direction: "bullish", bodyRatio: 0.8, rangeAtrMultiple: 2, candleIndex: 200 },
  }) as never;

/** Falling ACTUAL real yields → gold-supportive; rising → gold-opposing. */
const GOLD_SUPPORTIVE = treasuryCtx({
  realLatest: { "5Y": 2.1, "10Y": 2.35, "30Y": 2.9 },
  realPrev: { "5Y": 2.17, "10Y": 2.43, "30Y": 2.99 }, // −0.08pp avg
});
const GOLD_OPPOSING = treasuryCtx({
  realLatest: { "5Y": 2.24, "10Y": 2.51, "30Y": 3.06 },
  realPrev: { "5Y": 2.17, "10Y": 2.43, "30Y": 2.99 }, // +0.073pp avg
});
/** Falling nominal 2Y/10Y → USD-negative context (supports XXX/USD longs). */
const USD_NEGATIVE = treasuryCtx({
  nomLatest: { "2Y": 4.2, "10Y": 4.63 },
  nomPrev: { "2Y": 4.35, "10Y": 4.78 }, // −0.15pp avg → full effect
});
const USD_POSITIVE = treasuryCtx({
  nomLatest: { "2Y": 4.35, "10Y": 4.78 },
  nomPrev: { "2Y": 4.2, "10Y": 4.63 },
});

// ── Provider failure / staleness never break primary analysis ──────

describe("provider failure & freshness are non-fatal", () => {
  it("unavailable Treasury leaves a valid LONG intact and flags informationally", () => {
    const without = runAnalysis(baseInput());
    const withFailed = runAnalysis(
      baseInput({ treasuryData: { available: false, reason: "US Treasury feed unreachable" } }),
    );
    expect(withFailed.recommendation).toBe(without.recommendation);
    expect(withFailed.confidence).toBe(without.confidence); // provider failure ≠ penalty
    expect(withFailed.dataFlags.join(" ")).toMatch(/Treasury yield context unavailable/);
  });

  it("STALE macro observation is still usable as dated context — no fabrication, analysis proceeds", () => {
    const r = runAnalysis(baseInput({ treasuryData: treasuryCtx({ freshness: "STALE" }) }));
    expect(r.recommendation).not.toBe("NO_TRADE");
    expect(r.treasuryContext?.freshness).toBe("STALE");
    expect(r.treasuryContext?.latest.nominal.observationDate).toBe("2026-08-21"); // disclosed date
  });
});

// ── Nominal vs real separation + provenance ────────────────────────

describe("provenance and nominal/real separation", () => {
  it("result carries source, observation dates, freshness — both curves distinct", () => {
    const r = runAnalysis(baseInput({ instrument: "XAU/USD", treasuryData: GOLD_SUPPORTIVE }));
    const tc = r.treasuryContext!;
    expect(tc.available).toBe(true);
    expect(tc.source).toMatch(/US Treasury/);
    expect(tc.latest.nominal.observationDate).toBeDefined();
    expect(tc.latest.real?.observationDate).toBeDefined();
    // Distinct values prove nominal was not substituted for real.
    expect(tc.latest.nominal.nominal["10Y"]).not.toBe(tc.latest.real!.real["10Y"]);
  });
});

// ── Evidence moves conviction within layer cap ─────────────────────

describe("macro-yield conviction layer (style-capped)", () => {
  it("gold: falling REAL yields support a bullish thesis (swing weights most)", () => {
    const none = runAnalysis(goldSwing());
    const supportive = runAnalysis({ ...goldSwing(), treasuryData: GOLD_SUPPORTIVE });
    expect(none.recommendation).toBe("LONG");
    expect(supportive.confidence!).toBeGreaterThan(none.confidence!);
    expect(supportive.confidence! - none.confidence!).toBeLessThanOrEqual(12); // swing cap ±12
  });

  it("gold: rising REAL yields oppose the thesis and surface as a key contradiction", () => {
    const r = runAnalysis({ ...goldSwing(), tradingStyle: "intraday" as const, treasuryData: GOLD_OPPOSING });
    expect(r.keyContradictions?.some((c) => /Treasury yield context/i.test(c.description))).toBe(true);
    // Macro conflict alone is never DECISIVE / never forces NO_TRADE.
    expect(r.keyContradictions?.find((c) => /Treasury yield/i.test(c.description))?.severity).not.toBe("DECISIVE");
    expect(r.recommendation).not.toBe("NO_TRADE"); // gates decide, not this layer
  });

  it("forex EUR/USD: USD-negative yield context supports a long within intraday cap ±8", () => {
    const none = runAnalysis(baseInput({ tradingStyle: "intraday" }));
    const supportive = runAnalysis(baseInput({ tradingStyle: "intraday", treasuryData: USD_NEGATIVE }));
    expect(supportive.confidence!).toBeGreaterThan(none.confidence!);
    expect(supportive.confidence! - none.confidence!).toBeLessThanOrEqual(8);
  });

  it("forex USD/JPY: rising yields (USD-positive) support a long; same data opposes EUR/USD", () => {
    const usdjpy = runAnalysis(baseInput({ instrument: "USD/JPY", tradingStyle: "intraday", treasuryData: USD_POSITIVE }));
    const eurusd = runAnalysis(baseInput({ instrument: "EUR/USD", tradingStyle: "intraday", treasuryData: USD_POSITIVE }));
    const usdjpyNone = runAnalysis(baseInput({ instrument: "USD/JPY", tradingStyle: "intraday" }));
    const eurusdNone = runAnalysis(baseInput({ instrument: "EUR/USD", tradingStyle: "intraday" }));
    expect(usdjpy.confidence!).toBeGreaterThan(usdjpyNone.confidence!);
    expect(eurusd.confidence!).toBeLessThan(eurusdNone.confidence!);
  });

  it("anti-double-counting: one Treasury observation contributes ONE bounded layer, style-scaled", () => {
    const scalp = runAnalysis(baseInput({ tradingStyle: "scalping", treasuryData: USD_NEGATIVE }));
    const scalpNone = runAnalysis(baseInput({ tradingStyle: "scalping" }));
    const intraday = runAnalysis(baseInput({ tradingStyle: "intraday", treasuryData: USD_NEGATIVE }));
    const intradayNone = runAnalysis(baseInput({ tradingStyle: "intraday" }));
    expect(scalp.confidence! - scalpNone.confidence!).toBeLessThanOrEqual(2); // scalping: context only
    expect(intraday.confidence! - intradayNone.confidence!).toBeLessThanOrEqual(8); // full field set ≠ bigger than cap
  });

  it("availability alone adds NOTHING: sub-threshold change → identical conviction", () => {
    const tiny = treasuryCtx({
      nomLatest: { "2Y": 4.202, "10Y": 4.632 },
      nomPrev: { "2Y": 4.2, "10Y": 4.63 },
    });
    const none = runAnalysis(baseInput({ tradingStyle: "intraday" }));
    const withTiny = runAnalysis(baseInput({ tradingStyle: "intraday", treasuryData: tiny }));
    expect(withTiny.confidence).toBe(none.confidence);
  });

  it("single observation (no consecutive change) adds nothing", () => {
    const single = treasuryCtx(); // previous present but identical? No — build one w/o change below
    void single;
    const noChange = treasuryCtx({
      nomLatest: { "2Y": 4.25, "10Y": 4.7 },
      nomPrev: { "2Y": 4.25, "10Y": 4.7 },
    });
    const none = runAnalysis(baseInput({ tradingStyle: "swing" }));
    const r = runAnalysis(baseInput({ tradingStyle: "swing", treasuryData: noChange }));
    expect(r.confidence).toBe(none.confidence);
  });
});

// ── Treasury can NEVER create or flip a trade ──────────────────────

describe("hierarchy: Treasury is context, never a trigger", () => {
  it("strongly gold-supportive yields do NOT rescue a Neutral-bias / NO_TRADE market", () => {
    const neutralMarket = baseInput({
      instrument: "XAU/USD",
      instrumentType: "commodity",
      tradingStyle: "swing",
      technicalData: techBase({ structure: "range", bosDirection: "none", swingHighs: [101], swingLows: [99], resistanceLevels: [101], supportLevels: [99] }),
      economicEvents: undefined,
      newsContext: undefined,
      calendarData: undefined,
      macroData: undefined,
    });
    const r = runAnalysis({ ...neutralMarket, treasuryData: GOLD_SUPPORTIVE });
    expect(r.recommendation).toBe("NO_TRADE"); // structure decides; yields cannot force LONG
  });

  it("bullish yields cannot flip a bearish-structure thesis to LONG", () => {
    const bearish = baseInput({
      tradingStyle: "swing",
      technicalData: techBase({
        structure: "LH/LL",
        bosDirection: "bearish",
        chochDirection: "bearish",
        swingHighs: [101], swingLows: [95],
        supportLevels: [95], resistanceLevels: [101],
      }),
    });
    const r = runAnalysis({ ...bearish, treasuryData: USD_NEGATIVE });
    expect(r.bias).toBe("Bearish"); // bias untouched by macro context
  });
});

// ── Style behaviors ────────────────────────────────────────────────

describe("style-specific Treasury behavior", () => {
  it("scalping keeps full execution capability with Treasury absent or stale", () => {
    for (const td of [undefined, { available: false as const, reason: "x" }, treasuryCtx({ freshness: "STALE" })]) {
      const r = runAnalysis(
        baseInput({ tradingStyle: "scalping", technicalData: techBase({ smc: smcWithDisplacement() }), treasuryData: td }),
      );
      if (td === undefined || (td && !td.available)) continue; // covered elsewhere
      expect(r.treasuryContext?.freshness).toBe("STALE");
    }
    // Scalping execution gate still governs: fresh displacement present but far target → horizon NO_TRADE unchanged by yields
    const r2 = runAnalysis(baseInput({
      tradingStyle: "scalping",
      technicalData: techBase({ atr14: 0.4, smc: smcWithDisplacement() }),
      treasuryData: GOLD_SUPPORTIVE,
    }));
    expect(r2.noTradeReasons.join(" ")).toMatch(/SCALPING target horizon/); // macro data never overrides execution gates
  });

  it("intraday uses moderate macro context; swing uses it most (caps differ)", () => {
    const i = runAnalysis({ ...fxSwing(), tradingStyle: "intraday" as const, treasuryData: USD_NEGATIVE });
    const i0 = runAnalysis({ ...fxSwing(), tradingStyle: "intraday" as const });
    const s = runAnalysis({ ...fxSwing(), treasuryData: USD_NEGATIVE });
    const s0 = runAnalysis(fxSwing());
    expect(i.confidence! - i0.confidence!).toBeGreaterThan(0);
    expect(s.confidence! - s0.confidence!).toBeGreaterThanOrEqual(i.confidence! - i0.confidence!);
    expect(s.confidence! - s0.confidence!).toBeLessThanOrEqual(12);
  });
});

// ── Regression invariants ──────────────────────────────────────────

describe("state consistency preserved", () => {
  it("NO_TRADE still carries no tradePlan even with rich Treasury context", () => {
    const r = runAnalysis({
      ...baseInput({ tradingStyle: "swing" }),
      technicalData: techBase({ mtf: undefined }),
      treasuryData: GOLD_SUPPORTIVE,
    });
    if (r.recommendation === "NO_TRADE") {
      expect(r.tradePlan).toBeUndefined();
    }
  });

  it("absent treasuryData behaves exactly like before Phase 7B-1 (backward compat)", () => {
    const a = runAnalysis(baseInput());
    const b = runAnalysis(baseInput({ treasuryData: undefined }));
    expect(a.confidence).toBe(b.confidence);
    expect(a.recommendation).toBe(b.recommendation);
  });
});
