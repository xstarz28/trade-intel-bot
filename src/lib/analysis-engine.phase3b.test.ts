/**
 * Phase 3B — state machine & risk integrity.
 *
 * Proves the engine emits EXACTLY one of three consistent states:
 *   LONG  + valid TradePlan
 *   SHORT + valid TradePlan
 *   NO_TRADE + tradePlan === undefined  (plan NEVER present)
 * plus R:R edge cases, stale-data rejection, and honest position sizing.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";
import { computePositionSizing, type InstrumentSpec, specGaps } from "@/lib/risk";

// ── Fixtures ───────────────────────────────────────────────────────

const flat = (i: number, c: number) => ({
  timestamp: Date.now() - (210 - i) * 36e5,
  open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000,
});

function makeMarket(price: number, over?: Partial<MarketData>): MarketData {
  return {
    instrument: "EUR/USD", instrumentType: "forex", provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => flat(i, price)),
    timeframe: "H4", dataFreshness: "delayed", ...over,
  };
}

function tech(structure: "HH/HL" | "LH/LL" | "range", opts?: Partial<TechnicalData>): TechnicalData {
  const bullish = structure === "HH/HL";
  return {
    swingHighs: bullish ? [110] : structure === "LH/LL" ? [105] : [],
    swingLows: bullish ? [95] : [],
    structure,
    bosDirection: bullish ? "bullish" : structure === "LH/LL" ? "bearish" : "none",
    supportLevels: bullish || structure === "range" ? [95] : [90],
    resistanceLevels: bullish ? [110] : structure === "LH/LL" ? [105] : [],
    volumeTrend: "unknown",
    dataPoints: 210,
    ...opts,
  };
}

function input(over?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    economicEvents: "Fed signals hawkish stance, rate hike",
    marketData: makeMarket(100),
    technicalData: tech("HH/HL"),
    ...over,
  };
}

/** Invariant asserted on EVERY result in this suite. */
function assertStateConsistency(r: ReturnType<typeof runAnalysis>) {
  if (r.recommendation === "NO_TRADE") {
    expect(r.tradePlan).toBeUndefined();
    expect(r.conviction).toBeUndefined();
  } else {
    expect(["LONG", "SHORT"]).toContain(r.recommendation);
    expect(r.tradePlan).toBeDefined();
    expect(r.tradePlan!.entry).toBeTruthy();
    expect(r.tradePlan!.stopLoss).toBeTruthy();
    expect(r.tradePlan!.takeProfit).toBeTruthy();
    expect(r.tradePlan!.riskReward).toBeGreaterThanOrEqual(1.5);
    expect(r.tradePlan!.slBasis).toContain("structural");
    expect(r.conviction).toBeDefined();
    // Directional sanity: SL/TP on correct sides of entry.
    const e = parseFloat(r.tradePlan!.entry);
    const sl = parseFloat(r.tradePlan!.stopLoss);
    const tp = parseFloat(r.tradePlan!.takeProfit);
    if (r.recommendation === "LONG") {
      expect(sl).toBeLessThan(e);
      expect(tp).toBeGreaterThan(e);
    } else {
      expect(sl).toBeGreaterThan(e);
      expect(tp).toBeLessThan(e);
    }
  }
}

// ── LONG / SHORT valid states ──────────────────────────────────────

describe("state machine — tradeable states carry a full plan", () => {
  it("valid confluence + structural SL + TP + R:R ≥1.5 → LONG + plan", () => {
    const r = runAnalysis(input());
    assertStateConsistency(r);
    expect(r.recommendation).toBe("LONG");
  });

  it("bearish mirror → SHORT + plan with correct level sides", () => {
    const r = runAnalysis(input({
      economicEvents: "Fed signals dovish stance, rate cut",
      technicalData: tech("LH/LL"),
    }));
    assertStateConsistency(r);
    expect(r.recommendation).toBe("SHORT");
  });
});

// ── NO_TRADE states — plan must be undefined ───────────────────────

describe("state machine — every rejection yields NO_TRADE + no plan", () => {
  it("neutral bias", () => {
    const r = runAnalysis(input({ technicalData: tech("range"), economicEvents: "Mixed central bank commentary" }));
    expect(r.recommendation).toBe("NO_TRADE");
    assertStateConsistency(r);
  });

  it("weak confluence (only one core factor agrees)", () => {
    const r = runAnalysis(input({ technicalData: tech("range") }));
    expect(r.recommendation).toBe("NO_TRADE");
    assertStateConsistency(r);
    // PHASE 8 P1 behavior change:
    // OLD: bias stayed directional on a range structure and GATE 4 rejected
    //      with "Confluence too weak".
    // WHY CHANGED: the veto-model makes structure the only thesis authority —
    //      a range external structure vetoes the directional bias BEFORE
    //      confluence is evaluated.
    // NEW: rejection names the structural-agreement rule.
    // WHY CORRECT: non-structural factors cannot create a thesis from a
    //      neutral structure (F-5); "Confluence too weak" misdescribed that.
    expect(r.noTradeReasons.join(" ")).toContain("Structural agreement");
  });

  it("material conflict (core factor |score| ≥ 2 opposing)", () => {
    const r = runAnalysis(input({
      economicEvents: "hawkish rate hike strong gdp strong employment", // fundamental +2
      technicalData: tech("LH/LL"), // trend −2 → bias bearish, fundamental opposes materially
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    assertStateConsistency(r);
    expect(r.noTradeReasons.join(" ")).toContain("Material conflict");
  });

  it("no structural SL available (all candidate lows on the wrong side)", () => {
    // Bullish thesis but the only swing low sits ABOVE price → filtered out.
    const r = runAnalysis(input({ technicalData: tech("HH/HL", { swingLows: [], supportLevels: [] }) }));
    expect(r.recommendation).toBe("NO_TRADE");
    assertStateConsistency(r);
    expect(r.noTradeReasons.join(" ")).toMatch(/structural confirmation|take profit|R:R/i);
  });

  it("missing TP (no opposing level) → NO_TRADE without plan", () => {
    // Bearish setup whose only sell-side pool/support was removed.
    const t = tech("LH/LL", { supportLevels: [], swingLows: [] });
    const r = runAnalysis(input({
      economicEvents: "Fed signals dovish stance, rate cut",
      technicalData: t,
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    assertStateConsistency(r);
  });

  it("R:R < 1.5 rejected", () => {
    const r = runAnalysis(input({
      technicalData: tech("HH/HL", { resistanceLevels: [106] }), // reward 6 / risk 5 = 1.2
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    assertStateConsistency(r);
    expect(r.noTradeReasons.join(" ")).toContain("below the 1.50 minimum");
  });

  it("R:R exactly at the 1.5 threshold is acceptable", () => {
    const r = runAnalysis(input({
      technicalData: tech("HH/HL", { resistanceLevels: [107.5] }), // 7.5 / 5 = 1.5
    }));
    assertStateConsistency(r);
    expect(r.recommendation).toBe("LONG");
    expect(r.tradePlan?.riskReward).toBeCloseTo(1.5, 2);
  });

  it("stale primary data (provider flag) → NO_TRADE + no plan", () => {
    const r = runAnalysis(input({ marketData: makeMarket(100, { dataFreshness: "stale" }) }));
    expect(r.recommendation).toBe("NO_TRADE");
    assertStateConsistency(r);
    expect(r.noTradeReasons.join(" ")).toContain("stale");
  });

  it("old price snapshot (>30 min) treated as stale → NO_TRADE", () => {
    const old = Date.now() - 31 * 60 * 1000;
    const md = makeMarket(100);
    md.price = { ...md.price, timestamp: old };
    md.fetchTimestamp = old;
    const r = runAnalysis(input({ marketData: md }));
    expect(r.recommendation).toBe("NO_TRADE");
    assertStateConsistency(r);
    expect(r.noTradeReasons.join(" ")).toContain("stale rather than live");
  });
});

// ── Position sizing integration ────────────────────────────────────

const FULL_SPEC: InstrumentSpec = {
  assetClass: "forex",
  contractSize: 100000,
  quoteCurrency: "USD",
  tickSize: 0.00001,
  quantityStep: 0.01,
  minQuantity: 0.01,
};

describe("position sizing — computed only from complete real inputs", () => {
  it("complete inputs but sub-minimum budget → sizing honestly unavailable", () => {
    // $10k × 1% = $100 risk; 5-point stop × 100k contract = $500k/unit
    // → 0.0002 lots is BELOW the 0.01 minimum. Engine must NOT fabricate a
    // quantity — the sizing stays explicitly unavailable.
    const r = runAnalysis(input({ accountEquity: 10000, riskPercent: 0.01, instrumentSpec: FULL_SPEC }));
    expect(r.recommendation).toBe("LONG");
    expect(r.positionSizing).toBeUndefined();
    expect(r.riskNote).toContain("Position sizing unavailable");
  });

  it("without a spec, sizing stays unavailable even for a valid LONG", () => {
    const r = runAnalysis(input({ accountEquity: 1000000, riskPercent: 0.02 }));
    expect(r.recommendation).toBe("LONG");
    expect(r.positionSizing).toBeUndefined();
    expect(r.riskNote).toContain("Position sizing unavailable");
  });

  it("NO_TRADE never carries sizing even when inputs are complete", () => {
    const r = runAnalysis(input({
      accountEquity: 10000, riskPercent: 0.01, instrumentSpec: FULL_SPEC,
      technicalData: tech("range"),
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.positionSizing).toBeUndefined();
  });

  it("realistic sizing: large equity computes an exact stepped quantity", () => {
    const s = computePositionSizing({
      equity: 1_000_000, riskPercent: 0.01,
      entry: 100, stopLoss: 95,
      spec: { ...FULL_SPEC, contractSize: 1 }, // unit-style instrument
    });
    expect(s.available).toBe(true);
    expect(s.riskAmount).toBe(10000);
    expect(s.riskPerUnit).toBe(5);
    expect(s.quantity).toBe(2000); // exact, on step
  });
});

// ── computePositionSizing unit edges ───────────────────────────────

describe("computePositionSizing — refuses fabrication", () => {
  const base = { equity: 10000, riskPercent: 0.01, entry: 100, stopLoss: 99 };

  it("missing spec → explicit unavailable listing gaps", () => {
    const s = computePositionSizing(base);
    expect(s.available).toBe(false);
    expect(s.unavailableReason).toContain("instrument specification not provided");
    expect(specGaps(undefined)).toContain("instrument specification not provided");
  });

  it("partial spec lists exactly what is missing", () => {
    expect(specGaps({ assetClass: "forex" })).toEqual(
      expect.arrayContaining(["contract size", "quote currency", "quantity step"]),
    );
  });

  it("invalid equity refused", () => {
    const s = computePositionSizing({ ...base, equity: 0, spec: FULL_SPEC });
    expect(s.available).toBe(false);
    expect(s.unavailableReason).toContain("equity");
  });

  it("riskPercent outside the guard band refused (never assumed)", () => {
    const s = computePositionSizing({ ...base, riskPercent: 0.25, spec: FULL_SPEC });
    expect(s.available).toBe(false);
    expect(s.unavailableReason).toContain("guard band");
  });

  it("zero risk distance refused", () => {
    const s = computePositionSizing({ ...base, stopLoss: 100, spec: FULL_SPEC });
    expect(s.available).toBe(false);
    expect(s.unavailableReason).toContain("no risk distance");
  });

  it("quantity rounds DOWN to the step and respects minQuantity", () => {
    const s = computePositionSizing({
      equity: 10000, riskPercent: 0.01, entry: 100, stopLoss: 99.7,
      spec: { ...FULL_SPEC, contractSize: 1, quantityStep: 0.5, minQuantity: 1 },
    });
    // riskAmount 100; riskPerUnit 0.3 → raw 333.33 → floor to step → 333
    expect(s.available).toBe(true);
    expect(s.quantity).toBe(333);
    const small = computePositionSizing({
      equity: 10, riskPercent: 0.01, entry: 100, stopLoss: 90,
      spec: { ...FULL_SPEC, contractSize: 1, quantityStep: 1, minQuantity: 1 },
    });
    // riskAmount 0.1 / 10 per unit = 0.01 units < min 1 → unavailable
    expect(small.available).toBe(false);
    expect(small.unavailableReason).toContain("minimum");
  });
});
