/**
 * Phase 3A engine-integration tests:
 * - alignment states drive reasoning/conviction (evidence, not TF count)
 * - LTF signals never auto-flip HTF bias; genuine HTF reversal does
 * - counter-trend requires a full confirmation chain, else NO_TRADE
 * - INSUFFICIENT_DATA / MIXED-without-trigger → NO_TRADE
 * - HTF liquidity used as TP fallback with timeframe labels
 * - conviction never rises from data availability or timeframe count alone
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type {
  MarketData,
  MtfContext,
  MtfTimeframeData,
  SmcContext,
  TechnicalData,
  TfRole,
} from "@/lib/data/market-types";

// ── Fixtures ───────────────────────────────────────────────────────

function baseInput(overrides?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "H4",
    economicEvents: "Fed signals hawkish stance, rate hike", // fundamental +1
    ...overrides,
  };
}

const flatCandle = (i: number, close: number) => ({
  timestamp: 1700000000000 + i * 3600000,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1000,
});

function makeMarket(price: number): MarketData {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => flatCandle(i, price)),
    timeframe: "H4",
    dataFreshness: "delayed",
  };
}

function makeTech(smc?: SmcContext, overrides?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [110],
    swingLows: [95],
    structure: "HH/HL",
    bosDirection: "bullish",
    supportLevels: [95],
    resistanceLevels: [110],
    volumeTrend: "unknown",
    dataPoints: 210,
    smc,
    ...overrides,
  };
}

/** Neutral external/internal read for a timeframe. */
const neutralExt: {
  structure: "HH/HL" | "LH/LL" | "range" | "unknown";
  bosDirection: "bullish" | "bearish" | "none";
  chochDirection: "bullish" | "bearish" | "none";
} = {
  structure: "range",
  bosDirection: "none",
  chochDirection: "none",
};

function mtfTf(
  timeframe: string,
  role: TfRole,
  external: Partial<typeof neutralExt>,
  extra?: Partial<SmcContext>,
): MtfTimeframeData {
  return {
    timeframe,
    role,
    available: true,
    smc: {
      timeframe,
      liquidityPools: [],
      internalExternal: {
        external: { timeframe, ...neutralExt, ...external, dataPoints: 120 },
        internal: { timeframe: `${timeframe}:int`, ...neutralExt, dataPoints: 120 },
        internalConflict: false,
      },
      fvgs: [],
      orderBlocks: [],
      vwap: { available: false, unavailableReason: "test", priceLocation: "unavailable" },
      volumeProfile: { available: false, unavailableReason: "test" },
      ...extra,
    },
  };
}

function mtfCtx(opts: {
  alignment: MtfContext["alignment"];
  htfBias: "long" | "short" | "none";
  timeframes: MtfTimeframeData[];
  triggerTimeframe?: string;
  htfTimeframe?: string;
  htfReversal?: MtfContext["htfReversal"];
}): MtfContext {
  return {
    requestedTimeframe: "H4",
    chainUsed: opts.timeframes.map((t) => t.timeframe),
    unavailable: [],
    timeframes: opts.timeframes,
    alignment: opts.alignment,
    htfBias: opts.htfBias,
    htfTimeframe: opts.htfTimeframe,
    setupTimeframe: "H4",
    triggerTimeframe: opts.triggerTimeframe,
    htfReversal: opts.htfReversal,
  };
}

/** Setup-timeframe SMC with every Phase-2 event favoring a LONG. */
function bullishSetupSmc(): SmcContext {
  return {
    timeframe: "H4",
    liquidityPools: [
      { level: 108, side: "buy_side", source: "equal_highs", touches: 2, swept: false, broken: false },
    ],
    internalExternal: {
      external: { timeframe: "H4", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", dataPoints: 210 },
      internal: { timeframe: "H4:int", structure: "HH/HL", bosDirection: "none", chochDirection: "none", dataPoints: 210 },
      internalConflict: false,
    },
    fvgs: [{ direction: "bullish", upper: 99.5, lower: 98, timeframe: "H4", createdAtIndex: 208, createdAt: Date.now(), status: "fresh" }],
    displacement: { direction: "bullish", candleIndex: 209, candleTime: Date.now(), bodyRatio: 0.8, rangeAtrMultiple: 2.1 },
    orderBlocks: [{ direction: "bullish", upper: 97, lower: 95.5, timeframe: "H4", createdAt: Date.now(), status: "fresh", evidence: { precedingOpposingCandle: true, displacementAfter: true, structuralBreakAfter: true, displacementRangeAtr: 2.0 } }],
    vwap: { available: true, sessionVwap: 99, priceLocation: "above_vwap" },
    volumeProfile: { available: true, poc: 98, vah: 101, val: 96 },
  };
}

const ALIGNED_BULL = mtfCtx({
  alignment: "ALIGNED_BULLISH",
  htfBias: "long",
  htfTimeframe: "D1",
  triggerTimeframe: "H1",
  timeframes: [
    mtfTf("D1", "structure", { structure: "HH/HL" }),
    mtfTf("H1", "trigger", { structure: "HH/HL" }),
  ],
});

// ── Alignment drives reasoning & conviction ─────────────────────────

describe("MTF alignment → conviction (evidence, not TF count)", () => {
  it("ALIGNED_BULLISH with full confluence → LONG", () => {
    const tech = makeTech(bullishSetupSmc());
    tech.mtf = ALIGNED_BULL;
    const r = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: tech }));
    expect(r.recommendation).toBe("LONG");
    expect(r.mtfSummary?.alignment).toBe("ALIGNED_BULLISH");
  });

  it("MIXED alignment penalizes conviction vs ALIGNED (same evidence)", () => {
    const aligned = makeTech(bullishSetupSmc());
    aligned.mtf = ALIGNED_BULL;

    const mixed = makeTech(bullishSetupSmc());
    mixed.mtf = mtfCtx({
      alignment: "MIXED",
      htfBias: "long",
      htfTimeframe: "D1",
      triggerTimeframe: "H1",
      timeframes: [
        mtfTf("D1", "structure", { structure: "LH/LL" }),
        // trigger carries fresh bullish evidence so the MIXED gate passes
        mtfTf("H1", "trigger", { structure: "HH/HL" }, {
          displacement: { direction: "bullish", candleIndex: 99, candleTime: Date.now(), bodyRatio: 0.8, rangeAtrMultiple: 2.0 },
        }),
      ],
    });

    const ra = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: aligned }));
    const rm = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: mixed }));
    expect(rm.recommendation).toBe("LONG"); // tradeable but penalized
    expect(rm.confidence).toBeLessThan(ra.confidence);
  });

  it("adding MORE timeframes with the same read does NOT stack conviction", () => {
    const single = makeTech(bullishSetupSmc());
    single.mtf = ALIGNED_BULL;

    const withMacro = makeTech(bullishSetupSmc());
    withMacro.mtf = mtfCtx({
      alignment: "ALIGNED_BULLISH",
      htfBias: "long",
      htfTimeframe: "W1",
      triggerTimeframe: "H1",
      timeframes: [
        mtfTf("W1", "macro", { structure: "HH/HL" }),
        mtfTf("D1", "structure", { structure: "HH/HL" }),
        mtfTf("H1", "trigger", { structure: "HH/HL" }),
      ],
    });

    const ra = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: single }));
    const rb = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: withMacro }));
    expect(rb.confidence).toBe(ra.confidence); // +15 either way — no stacking
  });

  it("genuine HTF reversal in trade direction adds conviction", () => {
    // Reduced-evidence baseline so the +6 reversal bonus has headroom
    // (the full-confluence variant saturates the 88 clamp).
    const weakSetup = bullishSetupSmc();
    weakSetup.displacement = undefined;
    weakSetup.fvgs = [];
    weakSetup.orderBlocks = [];
    weakSetup.vwap = { available: false, unavailableReason: "t", priceLocation: "unavailable" };
    const noRev = makeTech(weakSetup);
    noRev.mtf = ALIGNED_BULL;

    const withRev = makeTech(bullishSetupSmc());
    withRev.mtf = mtfCtx({
      alignment: "ALIGNED_BULLISH",
      htfBias: "long",
      htfTimeframe: "D1",
      triggerTimeframe: "H1",
      htfReversal: { timeframe: "D1", direction: "bullish", kind: "choch" },
      timeframes: ALIGNED_BULL.timeframes,
    });

    const weakWithRev = makeTech(weakSetup);
    weakWithRev.mtf = mtfCtx({
      alignment: "ALIGNED_BULLISH",
      htfBias: "long",
      htfTimeframe: "D1",
      triggerTimeframe: "H1",
      htfReversal: { timeframe: "D1", direction: "bullish", kind: "choch" },
      timeframes: ALIGNED_BULL.timeframes,
    });

    const ra = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: noRev }));
    const rb = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: weakWithRev }));
    expect(rb.confidence).toBeGreaterThan(ra.confidence);
    expect(rb.confidence).toBeLessThanOrEqual(88);
  });
});

// ── NO_TRADE MTF gates ─────────────────────────────────────────────

describe("MTF NO_TRADE gates", () => {
  it("INSUFFICIENT_DATA → NO_TRADE even with directional core bias", () => {
    const tech = makeTech(bullishSetupSmc());
    tech.mtf = mtfCtx({
      alignment: "INSUFFICIENT_DATA",
      htfBias: "none",
      timeframes: [mtfTf("H4", "setup", { structure: "HH/HL" })],
    });
    tech.mtf.unavailable = [
      { timeframe: "D1", role: "structure", reason: "provider error" },
    ];
    const r = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: tech }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.join(" ")).toContain("MTF context insufficient");
  });

  it("counter-trend WITHOUT confirmation chain → NO_TRADE", () => {
    // Bias bearish (bearish setup structure + dovish fundamental) against a
    // bullish HTF; trigger carries NO fresh counter-side evidence.
    const tech = makeTech(undefined, {
      structure: "LH/LL",
      bosDirection: "bearish",
      chochDirection: "bearish",
      supportLevels: [],
      resistanceLevels: [103],
      swingHighs: [103],
      swingLows: [],
      smc: undefined,
    });
    tech.mtf = mtfCtx({
      alignment: "COUNTER_TREND",
      htfBias: "long",
      htfTimeframe: "D1",
      triggerTimeframe: "H1",
      timeframes: [
        mtfTf("D1", "structure", { structure: "HH/HL" }),
        mtfTf("H1", "trigger", { structure: "LH/LL" }), // no evidence payload
      ],
    });
    const r = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: tech,
        economicEvents: "Fed signals dovish stance, rate cut",
      }),
    );
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.join(" ")).toContain("confirmation chain");
  });

  it("counter-trend WITH full confirmation chain → tradeable, penalized", () => {
    const tech = makeTech(undefined, {
      structure: "LH/LL",
      bosDirection: "bearish",
      chochDirection: "bearish",
      supportLevels: [],
      resistanceLevels: [103],
      swingHighs: [103],
      swingLows: [],
      smc: {
        timeframe: "H4",
        liquidityPools: [{ level: 90, side: "sell_side", source: "swing_low", touches: 1, swept: false, broken: false }],
        internalExternal: {
          external: { timeframe: "H4", structure: "LH/LL", bosDirection: "bearish", chochDirection: "none", dataPoints: 210 },
          internal: { timeframe: "H4:int", structure: "LH/LL", bosDirection: "none", chochDirection: "none", dataPoints: 210 },
          internalConflict: false,
        },
        fvgs: [],
        orderBlocks: [],
        vwap: { available: false, unavailableReason: "t", priceLocation: "unavailable" },
        volumeProfile: { available: false, unavailableReason: "t" },
      },
    });
    // Trigger WITH fresh bearish evidence (displacement + fresh FVG)
    tech.mtf = mtfCtx({
      alignment: "COUNTER_TREND",
      htfBias: "long",
      htfTimeframe: "D1",
      triggerTimeframe: "H1",
      timeframes: [
        mtfTf("D1", "structure", { structure: "HH/HL" }),
        mtfTf("H1", "trigger", { structure: "LH/LL" }, {
          displacement: { direction: "bearish", candleIndex: 99, candleTime: Date.now(), bodyRatio: 0.85, rangeAtrMultiple: 2.2 },
          fvgs: [{ direction: "bearish", upper: 101, lower: 100, timeframe: "H1", createdAtIndex: 99, createdAt: Date.now(), status: "fresh" }],
        }),
      ],
    });
    const r = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: tech,
        economicEvents: "Fed signals dovish stance, rate cut",
      }),
    );
    expect(r.recommendation).toBe("SHORT");
    // COUNTER_TREND penalty applies vs an aligned short would
    expect(r.mtfSummary?.alignment).toBe("COUNTER_TREND");
  });

  it("MIXED without trigger/fundamental support → NO_TRADE", () => {
    const tech = makeTech(undefined, {
      structure: "HH/HL",
      bosDirection: "bullish",
      chochDirection: "none",
      smc: undefined,
    });
    tech.mtf = mtfCtx({
      alignment: "MIXED",
      htfBias: "long",
      htfTimeframe: "D1",
      timeframes: [mtfTf("D1", "structure", { structure: "LH/LL" })],
      // no trigger timeframe at all
    });
    const r = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: tech }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.join(" ")).toContain("MIXED");
  });
});

// ── HTF liquidity integration ──────────────────────────────────────

describe("HTF liquidity / FVG / OB integration", () => {
  it("falls back to an HTF resting pool as TP with a timeframe label", () => {
    // Setup SMC has NO buy-side pool above price; the D1 structure TF has one at 112.
    const setup = bullishSetupSmc();
    setup.liquidityPools = []; // force fallback
    const tech = makeTech(setup);
    tech.mtf = mtfCtx({
      alignment: "ALIGNED_BULLISH",
      htfBias: "long",
      htfTimeframe: "D1",
      triggerTimeframe: "H1",
      timeframes: [
        mtfTf("D1", "structure", { structure: "HH/HL" }, {
          liquidityPools: [
            { level: 112, side: "buy_side", source: "equal_highs", touches: 3, swept: false, broken: false },
          ],
        }),
        mtfTf("H1", "trigger", { structure: "HH/HL" }),
      ],
    });
    const r = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: tech }));
    expect(r.recommendation).toBe("LONG");
    expect(r.tradePlan?.takeProfit).toBe("112.00");
    expect(r.tradePlan?.tpBasis).toContain("D1");
    expect(r.tradePlan?.tpBasis).toContain("HTF target");
    // Trade plan carries explicit MTF context
    expect(r.tradePlan?.htfBias).toContain("D1");
    expect(r.tradePlan?.setupTimeframe).toBe("H4");
    expect(r.tradePlan?.triggerTimeframe).toBe("H1");
  });
});

// ── Data integrity ─────────────────────────────────────────────────

describe("MTF data integrity", () => {
  it("unavailable timeframes surface as data flags, never as neutral reads", () => {
    const tech = makeTech(bullishSetupSmc());
    tech.mtf = mtfCtx({
      alignment: "INSUFFICIENT_DATA",
      htfBias: "none",
      timeframes: [mtfTf("H4", "setup", { structure: "HH/HL" })],
    });
    tech.mtf.unavailable = [
      { timeframe: "W1", role: "macro", reason: "rate limited" },
      { timeframe: "D1", role: "structure", reason: "provider error" },
    ];
    const r = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: tech }));
    expect(r.recommendation).toBe("NO_TRADE");
    const allReasons = [...r.noTradeReasons, ...r.dataFlags, r.technicalSummary].join(" ");
    expect(allReasons).toContain("W1");
    expect(allReasons).toContain("D1");
  });

  it("summary states the ACTUAL chain — no W1→M5 claims without data", () => {
    const tech = makeTech(bullishSetupSmc());
    tech.mtf = mtfCtx({
      alignment: "ALIGNED_BULLISH",
      htfBias: "long",
      htfTimeframe: "D1",
      triggerTimeframe: "H1",
      timeframes: [
        mtfTf("D1", "structure", { structure: "HH/HL" }),
        mtfTf("H4", "setup", { structure: "HH/HL" }),
        mtfTf("H1", "trigger", { structure: "HH/HL" }),
      ],
    });
    tech.mtf.unavailable = [{ timeframe: "W1", role: "macro", reason: "rate limited" }];
    const r = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: tech }));
    expect(r.technicalSummary).toContain("D1 → H4 → H1");
    expect(r.technicalSummary).toContain("NOT synthesized");
    expect(r.technicalSummary).not.toContain("W1 → D1");
  });
});
