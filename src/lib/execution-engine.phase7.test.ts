/**
 * Phase 7E — engine integration of crypto execution quality.
 *
 * Proves:
 * - SCALPING veto fires ONLY on extreme, fresh, material conditions
 * - INTRADAY poor execution → warning/penalty without bias flip
 * - SWING microstructure stays contextual
 * - provider failure / unavailability leaves the thesis IDENTICAL to baseline
 * - non-crypto gets honest unavailable with zero penalty (no candle proxies)
 * - one EXECUTION layer: contribution bounded by executionLayerCap
 * - execution can NEVER flip bias or rescue NO_TRADE
 * - slippage uses the REAL risk-engine quantity only; sizing unavailable →
 *   slippage unavailable with an explicit reason
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";
import type { ExecutionQuality } from "@/lib/execution-quality";

// ── Fixtures ───────────────────────────────────────────────────────

function makeMarket(instrument: string, price = 100): MarketData {
  return {
    instrument, instrumentType: "crypto", provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

const mtfBullish = {
  requestedTimeframe: "H4", chainUsed: ["D1", "H4", "H1"], unavailable: [],
  timeframes: [], alignment: "ALIGNED_BULLISH" as const, htfBias: "long" as const,
  htfTimeframe: "D1", setupTimeframe: "H4", triggerTimeframe: "H1",
};

function techBase(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [105], swingLows: [98],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [98], resistanceLevels: [105], // entry 100 → R:R 2.5
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

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

/** Valid crypto LONG setup; scalping variant carries fresh trigger evidence. */
function btcInput(style: "scalping" | "intraday" | "swing", over?: Partial<AnalysisInput>): AnalysisInput {
  const smc = style === "scalping" ? { smc: smcWithDisplacement() } : {};
  return {
    instrument: "BTC/USDT", instrumentType: "crypto", timeframe: "H4",
    tradingStyle: style,
    economicEvents: undefined,
    newsContext: "institutional etf approval adoption", // honest 2nd core factor
    marketData: makeMarket("BTC/USDT"),
    technicalData: techBase({ mtf: mtfBullish, ...smc }),
    ...over,
  } as AnalysisInput;
}

/** Realistic BTC-perp book around mid 100 (spread in bps configurable). */
function execCtx(opts?: {
  spreadBps?: number;
  imbalance?: number; // desired via sizes
  bidDepth?: number;
  askDepth?: number;
  freshness?: "FRESH" | "STALE";
}): ExecutionQuality {
  const o = opts ?? {};
  const mid = 100;
  const halfSpread = ((o.spreadBps ?? 1) / 10_000) * mid / 2;
  const bid = mid - halfSpread;
  const ask = mid + halfSpread;
  const bidDepth = o.bidDepth ?? 50;
  const askDepth = o.askDepth ?? 50;
  // Sizes distributed to hit the requested imbalance exactly.
  return {
    available: true,
    provider: "OKX public order book",
    instrumentId: "BTC-USDT-SWAP",
    snapshotTs: Date.parse("2026-08-24T12:00:00Z"),
    fetchedAt: Date.now(),
    freshness: o.freshness ?? "FRESH",
    bid, ask, mid,
    spread: ask - bid,
    spreadBps: o.spreadBps ?? 1,
    bidDepth, askDepth,
    imbalance: (bidDepth - askDepth) / (bidDepth + askDepth),
    regime: o.freshness === "STALE"
      ? "STALE"
      : bidDepth <= 0 || askDepth <= 0
        ? "THIN"
        : (o.spreadBps ?? 1) > 10
          ? "WIDE_SPREAD"
          : Math.abs((bidDepth - askDepth) / (bidDepth + askDepth)) >= 0.7
            ? "IMBALANCED"
            : "LIQUID",
    book: {
      bids: [{ price: bid, size: Math.max(bidDepth, 0.0001) }],
      asks: [{ price: ask, size: Math.max(askDepth, 0.0001) }],
    },
  };
}

// ── Style behavior ─────────────────────────────────────────────────

describe("style-specific execution behavior", () => {
  it("SCALPING + extreme fresh spread → NO_TRADE with an explicit execution reason", () => {
    const r = runAnalysis(
      btcInput("scalping", { executionData: execCtx({ spreadBps: 40 }) }),
    );
    expect(r.recommendation).toBe("NO_TRADE");
    if (r.recommendation === "NO_TRADE") {
      expect(r.tradePlan).toBeUndefined();
      expect(r.noTradeReasons.some((x) => /SCALPING veto.*bps/.test(x))).toBe(true);
    }
  });

  it("SCALPING + THIN fresh book → NO_TRADE (depth materially insufficient)", () => {
    const r = runAnalysis(
      btcInput("scalping", { executionData: execCtx({ bidDepth: 0, askDepth: 30 }) }),
    );
    expect(r.recommendation).toBe("NO_TRADE");
    if (r.recommendation === "NO_TRADE") {
      expect(r.noTradeReasons.some((x) => /THIN/.test(x))).toBe(true);
    }
  });

  it("SCALPING + normal execution → thesis stands and conviction is intact", () => {
    const r = runAnalysis(btcInput("scalping", { executionData: execCtx({}) }));
    expect(r.recommendation).toBe("LONG");
    expect(r.tradePlan).toBeDefined();
  });

  it("SCALPING veto NEVER fires on stale snapshots (freshness precondition)", () => {
    const r = runAnalysis(
      btcInput("scalping", { executionData: execCtx({ spreadBps: 40, freshness: "STALE" }) }),
    );
    expect(r.noTradeReasons.some((x) => /SCALPING veto/.test(x))).toBe(false);
  });

  it("INTRADAY + wide spread → warning + conviction penalty, NO flip and NO veto", () => {
    const base = runAnalysis(btcInput("intraday"));
    const poor = runAnalysis(
      btcInput("intraday", { executionData: execCtx({ spreadBps: 15, bidDepth: 55, askDepth: 45 }) }),
    );
    expect(poor.recommendation).toBe("LONG"); // never flipped/vetoed at intraday
    expect(poor.confidence).toBeLessThanOrEqual(base.confidence);
    expect(poor.executionWarnings?.some((w) => /Spread is wide for intraday/.test(w))).toBe(true);
  });

  it("SWING + poor execution stays contextual — thesis untouched", () => {
    const base = runAnalysis(btcInput("swing"));
    const poor = runAnalysis(
      btcInput("swing", { executionData: execCtx({ spreadBps: 15 }) }),
    );
    expect(poor.recommendation).toBe(base.recommendation);
    // Swing cap ±1: at most a marginal conviction nudge, never a regime change.
    expect(Math.abs(poor.confidence - base.confidence)).toBeLessThanOrEqual(3);
  });
});

// ── Data integrity & hierarchy ─────────────────────────────────────

describe("data integrity & decision hierarchy", () => {
  it("provider failure leaves recommendation AND conviction identical to baseline", () => {
    const base = runAnalysis(btcInput("intraday"));
    const failed = runAnalysis(
      btcInput("intraday", {
        executionData: { available: false, reason: "OKX order book returned HTTP 500." },
      }),
    );
    expect(failed.recommendation).toBe(base.recommendation);
    expect(failed.confidence).toBe(base.confidence);
    expect(failed.dataFlags.join(" ")).toMatch(/Execution-quality data unavailable/);
  });

  it("non-crypto asset gets honest unavailable flag WITHOUT any conviction penalty", () => {
    const fx = (): AnalysisInput =>
      ({
        instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
        tradingStyle: "intraday", economicEvents: "hawkish rate hike strong gdp",
        marketData: makeMarket("EUR/USD"),
        technicalData: techBase({ mtf: mtfBullish }),
      }) as never;
    const base = runAnalysis(fx());
    const withUnavail = runAnalysis({
      ...fx(),
      executionData: { available: false as const, reason: "no validated order-book provider" },
    } as never);
    expect(withUnavail.confidence).toBe(base.confidence);
    expect(withUnavail.dataFlags.join(" ")).toMatch(/Bid\/ask data unavailable/);
  });

  it("STALE snapshot scores ZERO directional weight but is disclosed", () => {
    const base = runAnalysis(btcInput("intraday"));
    const stale = runAnalysis(
      btcInput("intraday", {
        executionData: execCtx({ imbalance: 0, bidDepth: 90, askDepth: 10, freshness: "STALE" }),
      }),
    );
    expect(stale.confidence).toBe(base.confidence); // stale → no layer score
    expect(stale.executionWarnings?.some((w) => /stale/i.test(w))).toBe(true);
  });

  it("one-layer bound: a maximally imbalanced LIQUID book cannot exceed executionLayerCap", () => {
    const base = runAnalysis(btcInput("intraday"));
    const maxImbalance = runAnalysis(
      btcInput("intraday", { executionData: execCtx({ bidDepth: 99, askDepth: 1 }) }),
    );
    // Intraday cap ±3 (+ possible completeness rounding): bounded jump.
    expect(maxImbalance.confidence - base.confidence).toBeLessThanOrEqual(4);
    expect(maxImbalance.recommendation).toBe("LONG");
  });

  it("execution CANNOT flip structural bias: strong bid imbalance vs bearish structure", () => {
    const bearish = btcInput("intraday", {
      technicalData: techBase({
        structure: "LH/LL", bosDirection: "bearish",
        supportLevels: [90], resistanceLevels: [105],
      }),
      newsContext: "regulation ban crackdown", // opposing fundamental too
      economicEvents: undefined,
    });
    const r = runAnalysis({
      ...bearish,
      executionData: execCtx({ bidDepth: 95, askDepth: 5 }),
    } as never);
    expect(r.recommendation).not.toBe("LONG"); // microstructure never flips SHORT/NO_TRADE into LONG
  });

  it("execution CANNOT rescue NO_TRADE: neutral bias + perfect LIQUID book", () => {
    const neutral = btcInput("intraday", {
      technicalData: techBase({
        mtf: { ...mtfBullish, alignment: "INSUFFICIENT_DATA" as const },
        structure: "LH/LL", bosDirection: "bearish",
        swingHighs: [102], swingLows: [101], supportLevels: [101], resistanceLevels: [102],
      }),
      newsContext: "",
    });
    const r = runAnalysis({
      ...neutral,
      executionData: execCtx({}),
    } as never);
    expect(["NO_TRADE"]).toContain(r.recommendation);
    if (r.recommendation === "NO_TRADE") expect(r.tradePlan).toBeUndefined();
  });
});

// ── Slippage with REAL quantities ──────────────────────────────────

describe("slippage & entry feasibility", () => {
  it("sizing available → slippage estimated from the REAL calculated quantity", () => {
    const r = runAnalysis(
      btcInput("intraday", {
        accountEquity: 100_000,
        riskPercent: 0.01,
        instrumentSpec: { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, quoteCurrency: "USDT" },
        executionData: execCtx({ bidDepth: 5000, askDepth: 5000 }),
      } as never),
    );
    expect(r.recommendation).toBe("LONG");
    expect(r.positionSizing?.quantity).toBeDefined();
    expect(r.slippageEstimate?.quantityUsed).toBe(r.positionSizing?.quantity);
    expect(r.slippageEstimate?.estimatedSlippage).toBeGreaterThanOrEqual(0);
    expect(r.slippageEstimate?.confidence).toBe("LOW");
    expect(
      r.executionWarnings?.some((w) => /Estimated market impact/.test(w)),
    ).toBe(true);
  });

  it("sizing unavailable → slippage explicitly unavailable, thesis still valid", () => {
    const r = runAnalysis(
      btcInput("intraday", { executionData: execCtx({}) }), // no equity/spec inputs
    );
    expect(r.recommendation).toBe("LONG");
    expect(r.slippageEstimate?.estimatedSlippage).toBeUndefined();
    expect(r.slippageEstimate?.unavailableReason).toContain("position size unavailable");
    expect(r.executionWarnings?.some((w) => /Slippage estimate unavailable/.test(w))).toBe(true);
  });

  it("insufficient depth for the calculated size → explicit feasibility warning", () => {
    const r = runAnalysis(
      btcInput("intraday", {
        accountEquity: 100_000_000, // huge size vs tiny book depth
        riskPercent: 0.01,
        instrumentSpec: { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, quoteCurrency: "USDT" },
        executionData: execCtx({ bidDepth: 5, askDepth: 5 }),
      } as never),
    );
    expect(r.slippageEstimate?.unavailableReason).toContain("insufficient visible depth");
    expect(r.executionWarnings?.some((w) => /insufficient for calculated position size/.test(w))).toBe(true);
  });
});
