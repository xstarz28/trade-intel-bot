/**
 * Phase 292 — POSITION SIZING / FX / EXECUTION-QUALITY INTEGRITY.
 *
 * The published plan feeds risk. These tests pin that:
 *
 *   · sizing is computed from the PUBLISHED (buffered) stop, never from a raw
 *     invalidation level the user is not being shown;
 *   · sizing is available ONLY with real equity + a chosen risk percent + a
 *     complete, verified instrument specification + an FX rate when the quote
 *     and account currencies differ — otherwise it is explicitly unavailable
 *     with the reason, and NO quantity is invented;
 *   · contract size / step / minimum quantity are never inferred from an asset
 *     class (forex 100000, gold 100 oz, crypto 1 coin, stock 1 share);
 *   · FX conversion needs a real, fresh provider snapshot (direct or inverse,
 *     direction disclosed) — never a constant, never a silent inversion;
 *   · slippage walks the real book with the REAL calculated quantity only.
 */
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { calculateTechnical } from "@/lib/data/technical";
import { computeSmcContext } from "@/lib/data/smc";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import { computePositionSizing, specGaps } from "@/lib/risk";
import type { InstrumentSpec } from "@/lib/risk";
import { DEFAULT_FX_MAX_AGE_MS, resolveConversionRate } from "@/lib/risk/fx";
import { resolveInstrumentSpec, parseSymbolCurrencies } from "@/lib/risk/spec-resolver";
import { buildExecutionData, estimateSlippage } from "@/lib/execution-quality";
import type { ParsedOrderBook } from "@/lib/execution-quality";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

// ── Designed fixture (test-only series) ───────────────────────────
const T0 = Date.now() - 199 * 4 * 3600_000;
const TS = (i: number) => T0 + i * 4 * 3600_000;

function designedUptrendSeries(): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  const push = (i: number, o: number, h: number, l: number, c: number) =>
    out.push({ timestamp: TS(i), open: o, high: h, low: l, close: c, volume: 1000 });
  for (let i = 0; i < 121; i++) { const p = 100 + i * 0.5; push(i, p - 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 121; i < 125; i++) { const p = 160 + (i - 120) * 2.1; push(i, p - 0.5, p + 0.5, p - 1, p); }
  push(125, 169, 169.5, 167, 168);
  for (let i = 126; i < 138; i++) { const p = 168 - (i - 125) * 0.65; push(i, p + 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 138; i < 152; i++) { const p = 160 + (i - 138) * 1.15; push(i, p - 0.3, p + 0.5, p - 0.9, p); }
  for (let i = 152; i < 169; i++) { const p = 176 - (i - 151) * 0.82; push(i, p + 0.3, p + 0.7, p - 0.7, p); }
  for (let i = 169; i < 200; i++) { const p = 162 + (i - 168) * 0.05; push(i, p - 0.2, p + 0.4, p - 0.5, p); }
  return out;
}

const SERIES = designedUptrendSeries();
const LAST = SERIES[SERIES.length - 1];

function techFor(candles: OhlcvCandle[]): TechnicalData {
  const smc = computeSmcContext(candles, "H4");
  return {
    ...calculateTechnical(candles, candles, "D1"),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc,
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles } satisfies MtfCandleInput)),
    ]),
  };
}

function inputFor(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    instrument: "TEST/USD",
    instrumentType: "forex",
    timeframe: "H4" as Timeframe,
    provider: "fixture",
    providerInstrumentId: "TEST/USD",
    marketData: {
      instrument: "TEST/USD",
      instrumentType: "forex",
      provider: "fixture",
      providerInstrumentId: "TEST/USD",
      fetchTimestamp: LAST.timestamp,
      price: { price: LAST.close, timestamp: LAST.timestamp, source: "fixture" },
      candles: SERIES,
      timeframe: "H4",
      dataFreshness: "delayed",
    } as MarketData,
    technicalData: techFor(SERIES),
    economicEvents: "Fed signals hawkish stance, rate hike",
    ...overrides,
  } as AnalysisInput;
}

/** A COMPLETE spec — supplied explicitly, exactly as the engine requires. */
const COMPLETE_SPEC: InstrumentSpec = {
  assetClass: "forex",
  contractSize: 100000,
  quoteCurrency: "USD",
  tickSize: 0.00001,
  quantityStep: 0.01,
  minQuantity: 0.01,
  source: "test-broker specification",
};

const BASE = runAnalysis(inputFor());
const PLAN = BASE.tradePlan!;
const ENTRY = parseFloat(PLAN.entry);
const PUBLISHED_STOP = parseFloat(PLAN.stopLoss);
const RAW_LEVEL = PLAN.stopProvenance!.level;

// ── A. Sizing uses the PUBLISHED plan ─────────────────────────────

describe("Phase 292 — sizing is built on the published plan", () => {
  it("computes the quantity from the published (buffered) stop, not the raw level", () => {
    const r = runAnalysis(
      inputFor({ accountEquity: 10_000_000, riskPercent: 0.01, instrumentSpec: COMPLETE_SPEC }),
    );
    expect(r.recommendation).toBe("LONG");
    const s = r.positionSizing!;
    expect(s.available).toBe(true);

    const distance = Math.abs(ENTRY - PUBLISHED_STOP);
    expect(s.riskAmount).toBeCloseTo(100_000, 6);
    expect(s.riskPerUnit).toBeCloseTo(distance * 100000, 6);
    // Quantity follows floor(riskAmount / riskPerUnit / step) × step.
    const expected = Math.floor(100_000 / (distance * 100000) / 0.01) * 0.01;
    expect(s.quantity).toBeCloseTo(expected, 9);

    // If the engine had sized off the RAW level the distance would be smaller
    // (2.19 vs the published 2.37) and the quantity larger — pin the difference.
    const rawDistance = Math.abs(ENTRY - RAW_LEVEL);
    expect(rawDistance).toBeLessThan(distance);
    const ifRaw = Math.floor(100_000 / (rawDistance * 100000) / 0.01) * 0.01;
    expect(s.quantity).not.toBeCloseTo(ifRaw, 9);

    // The risk note quotes the PUBLISHED stop as the level that costs money.
    expect(r.riskNote).toContain(PLAN.stopLoss);
    expect(r.riskNote).toContain(`${s.quantity}`);
  });

  it("keeps the provenance of the specification and the applied risk visible", () => {
    const r = runAnalysis(
      inputFor({ accountEquity: 10_000_000, riskPercent: 0.005, instrumentSpec: COMPLETE_SPEC }),
    );
    const s = r.positionSizing!;
    expect(s.specificationSource).toBe("test-broker specification");
    expect(s.appliedRiskPercent).toBe(0.005);
    expect(s.denominationCurrency).toBe("USD");
    expect(s.riskAmount).toBeCloseTo(50_000, 6);
  });
});

// ── B. Availability rules — never a guessed number ────────────────

describe("Phase 292 — sizing availability is explicit, never guessed", () => {
  it("is unavailable without equity, with the reason surfaced", () => {
    const r = runAnalysis(inputFor({ riskPercent: 0.01, instrumentSpec: COMPLETE_SPEC }));
    expect(r.positionSizing).toBeUndefined();
    expect(r.riskNote).toMatch(/sizing unavailable|account equity/i);
  });

  it("is unavailable without the user's chosen risk percent", () => {
    const r = runAnalysis(inputFor({ accountEquity: 10_000_000, instrumentSpec: COMPLETE_SPEC }));
    expect(r.positionSizing).toBeUndefined();
    expect(r.riskNote).toMatch(/risk percent/i);
  });

  it("is unavailable when the specification is incomplete, naming the gaps", () => {
    const r = runAnalysis(
      inputFor({
        accountEquity: 10_000_000,
        riskPercent: 0.01,
        instrumentSpec: { assetClass: "forex", quoteCurrency: "USD", source: "partial" },
      }),
    );
    expect(r.positionSizing).toBeUndefined();
    expect(r.riskNote).toMatch(/incomplete instrument specification/);
    expect(r.riskNote).toMatch(/contract size/);
    expect(r.riskNote).toMatch(/quantity step/);
  });

  it("is unavailable — not zero — when the risk budget is below the instrument minimum", () => {
    const r = runAnalysis(
      inputFor({ accountEquity: 10_000, riskPercent: 0.01, instrumentSpec: COMPLETE_SPEC }),
    );
    expect(r.tradePlan).toBeDefined(); // the plan still stands
    expect(r.positionSizing).toBeUndefined();
    expect(r.riskNote).toMatch(/below the instrument minimum/);
    expect(r.riskNote).not.toMatch(/quantity 0\b/);
  });

  it("never infers a contract size from the asset class", () => {
    for (const assetClass of ["forex", "crypto", "stock", "commodity", "indices"]) {
      const gaps = specGaps({ assetClass, quoteCurrency: "USD" });
      expect(gaps).toContain("contract size");
      expect(gaps).toContain("quantity step");
      const r = runAnalysis(
        inputFor({
          accountEquity: 10_000_000,
          riskPercent: 0.01,
          instrumentSpec: { assetClass, quoteCurrency: "USD" },
        }),
      );
      expect(r.positionSizing).toBeUndefined();
    }
  });

  it("rounds DOWN to the quantity step and rejects sub-step quantities", () => {
    const step = computePositionSizing({
      equity: 10_000_000,
      riskPercent: 0.01,
      entry: ENTRY,
      stopLoss: ENTRY - 2.37,
      spec: COMPLETE_SPEC,
    });
    expect(step.available).toBe(true);
    // On the step grid (float residue in the quotient is not a sizing error).
    expect(Math.abs(step.quantity! * 100 - Math.round(step.quantity! * 100))).toBeLessThan(1e-6);

    const tooCoarse = computePositionSizing({
      equity: 10_000_000,
      riskPercent: 0.01,
      entry: ENTRY,
      stopLoss: ENTRY - 2.37,
      spec: { ...COMPLETE_SPEC, quantityStep: 1000, minQuantity: 1000 },
    });
    expect(tooCoarse.available).toBe(false);
    expect(tooCoarse.unavailableReason).toMatch(/below the instrument minimum/);
  });

  it("spec/index/size metadata can never change the direction or the plan", () => {
    const withoutSpec = runAnalysis(inputFor());
    const withSpec = runAnalysis(
      inputFor({ accountEquity: 10_000_000, riskPercent: 0.01, instrumentSpec: COMPLETE_SPEC }),
    );
    expect(withSpec.bias).toBe(withoutSpec.bias);
    expect(withSpec.recommendation).toBe(withoutSpec.recommendation);
    expect(withSpec.confidence).toBe(withoutSpec.confidence);
    // Levels and R:R are byte-identical — risk metadata is downstream only.
    expect(JSON.stringify(withSpec.tradePlan)).toBe(JSON.stringify(withoutSpec.tradePlan));
    // Only the risk layer's own outputs differ.
    expect(withoutSpec.positionSizing).toBeUndefined();
    expect(withSpec.positionSizing?.available).toBe(true);
  });

  it("refuses a zero risk distance", () => {
    const flat = computePositionSizing({
      equity: 10_000,
      riskPercent: 0.01,
      entry: 100,
      stopLoss: 100,
      spec: COMPLETE_SPEC,
    });
    expect(flat.available).toBe(false);
    expect(flat.unavailableReason).toMatch(/no risk distance/);
  });
});

// ── C. FX conversion ──────────────────────────────────────────────

describe("Phase 292 — FX conversion integrity", () => {
  const NOW = Date.now();
  const fresh = (pair: string, rate: number) => ({ pair, rate, timestamp: NOW - 60_000, source: "provider fx" });

  it("same currency needs no rate and discloses no conversion", () => {
    const r = resolveConversionRate("USD", "USD", { now: NOW });
    expect(r).toEqual({ available: true, rate: 1, direction: "same", source: "identical-currency" });
    const s = computePositionSizing({
      equity: 10_000_000,
      riskPercent: 0.01,
      entry: ENTRY,
      stopLoss: ENTRY - 2.37,
      spec: COMPLETE_SPEC,
      accountCurrency: "USD",
      now: NOW,
    });
    expect(s.available).toBe(true);
    expect(s.denominationCurrency).toBe("USD");
  });

  it("uses a real direct snapshot and discloses source and direction", () => {
    const r = resolveConversionRate("USD", "EUR", { now: NOW, direct: fresh("USD/EUR", 0.92) });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.direction).toBe("direct");
    expect(r.rate).toBe(0.92);
    expect(r.source).toBe("provider fx");

    const s = computePositionSizing({
      equity: 10_000_000,
      riskPercent: 0.01,
      entry: ENTRY,
      stopLoss: ENTRY - 2.37,
      spec: COMPLETE_SPEC,
      accountCurrency: "EUR",
      fxDirect: fresh("USD/EUR", 0.92),
      now: NOW,
    });
    expect(s.available).toBe(true);
    expect(s.denominationCurrency).toBe("EUR");
    expect(s.riskPerUnit).toBeCloseTo(2.37 * 100000 * 0.92, 4);
    expect(s.conversion!.direction).toBe("direct");
    expect(s.conversion!.source).toBe("provider fx");
  });

  it("inverts a real inverse snapshot and says so", () => {
    const r = resolveConversionRate("USD", "EUR", { now: NOW, inverse: fresh("EUR/USD", 1.09) });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.direction).toBe("inverse");
    expect(r.rate).toBeCloseTo(1 / 1.09, 12);
    expect(r.source).toContain("inverse of EUR/USD");

    const s = computePositionSizing({
      equity: 10_000_000,
      riskPercent: 0.01,
      entry: ENTRY,
      stopLoss: ENTRY - 2.37,
      spec: COMPLETE_SPEC,
      accountCurrency: "EUR",
      fxInverse: fresh("EUR/USD", 1.09),
      now: NOW,
    });
    expect(s.available).toBe(true);
    expect(s.conversion!.direction).toBe("inverse");
  });

  it("rejects a stale direct snapshot instead of using it", () => {
    const stale = { pair: "USD/EUR", rate: 0.92, timestamp: NOW - DEFAULT_FX_MAX_AGE_MS - 1, source: "provider fx" };
    const r = resolveConversionRate("USD", "EUR", { now: NOW, direct: stale });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/FX_RATE_STALE/);
    expect(r.reason).toContain("USD/EUR");
  });

  it("rejects a stale inverse snapshot too", () => {
    const stale = { pair: "EUR/USD", rate: 1.09, timestamp: NOW - DEFAULT_FX_MAX_AGE_MS - 1, source: "provider fx" };
    const r = resolveConversionRate("USD", "EUR", { now: NOW, inverse: stale });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/FX_RATE_STALE/);
    expect(r.reason).toContain("inverse EUR/USD");
  });

  it("stays unavailable when no snapshot exists or the rate is malformed", () => {
    const none = resolveConversionRate("USD", "EUR", { now: NOW });
    expect(none.available).toBe(false);

    for (const bad of [
      { pair: "USD/EUR", rate: Number.NaN, timestamp: NOW, source: "x" },
      { pair: "USD/EUR", rate: 0, timestamp: NOW, source: "x" },
      { pair: "USD/EUR", rate: -1, timestamp: NOW, source: "x" },
      { pair: "USD/EUR", rate: Number.POSITIVE_INFINITY, timestamp: NOW, source: "x" },
      { pair: "USDEUR", rate: 1, timestamp: NOW, source: "x" },
      { pair: "USD/EUR", rate: 1, timestamp: Number.NaN, source: "x" },
    ]) {
      const r = resolveConversionRate("USD", "EUR", { now: NOW, direct: bad });
      expect(r.available).toBe(false);
    }
  });

  it("never invents a rate when the engine is not given one", () => {
    const r = runAnalysis(
      inputFor({
        accountEquity: 10_000_000,
        riskPercent: 0.01,
        instrumentSpec: COMPLETE_SPEC,
        accountCurrency: "EUR",
      }),
    );
    expect(r.positionSizing).toBeUndefined();
    expect(r.riskNote).toMatch(/ACCOUNT_CURRENCY_CONVERSION_UNAVAILABLE|FX/i);
  });

  it("carries a supplied fresh rate through the engine into the published sizing", () => {
    const r = runAnalysis(
      inputFor({
        accountEquity: 10_000_000,
        riskPercent: 0.01,
        instrumentSpec: COMPLETE_SPEC,
        accountCurrency: "EUR",
        fxRates: { direct: { pair: "USD/EUR", rate: 0.92, timestamp: Date.now(), source: "provider fx" } },
      }),
    );
    const s = r.positionSizing!;
    expect(s.available).toBe(true);
    expect(s.conversion!.direction).toBe("direct");
    expect(s.denominationCurrency).toBe("EUR");
  });
});

// ── D. Specification resolver — no convention assumptions ─────────

describe("Phase 292 — instrument specification provenance", () => {
  it("derives only the quote currency from the literal symbol structure", () => {
    expect(parseSymbolCurrencies("EUR/USD")).toEqual({ base: "EUR", quote: "USD" });
    // Only literal three-letter quote currencies are parseable — a four-letter
    // quote (USDT) is NOT assumed to be a currency and must come from provider
    // metadata instead.
    expect(parseSymbolCurrencies("BTC/USDT")).toEqual({});
    expect(parseSymbolCurrencies("XAU/USD")).toEqual({ base: "XAU", quote: "USD" });
    expect(parseSymbolCurrencies("AAPL")).toEqual({});
    expect(parseSymbolCurrencies("XAU")).toEqual({});
  });

  it("marks a spec with only a derived quote currency as partial, never complete", () => {
    const r = resolveInstrumentSpec({ instrument: "XAU/USD" });
    expect(r.status).toBe("partial");
    expect(r.spec.contractSize).toBeUndefined();
    expect(r.spec.quantityStep).toBeUndefined();
    expect(r.missingForSizing).toEqual(["contract size", "quantity step"]);
    expect(r.sources.quoteCurrency).toContain("symbol structure");
  });

  it("has a stable gap list for spec-less symbols of every asset class", () => {
    for (const s of ["AAPL", "XAU", "SPX", "BTC/USDT"]) {
      const r = resolveInstrumentSpec({ instrument: s });
      // No derivable quote and no explicit spec ⇒ outright unavailable — the
      // resolver never reaches for a market convention to fill the gap.
      expect(r.status).toBe("unavailable");
      expect(r.spec.contractSize).toBeUndefined();
      expect(r.missingForSizing.length).toBeGreaterThan(0);
    }
    expect(resolveInstrumentSpec({ instrument: "XAU/USD" }).status).toBe("partial");
    // A provider-returned currency is real metadata and IS usable for the quote.
    const viaProvider = resolveInstrumentSpec({ instrument: "BTC/USDT", providerCurrency: "USDT" });
    expect(viaProvider.status).toBe("partial");
    expect(viaProvider.spec.quoteCurrency).toBe("USDT");
    expect(viaProvider.sources.quoteCurrency).toBe("provider currency metadata");
  });

  it("keeps explicit input authoritative and records it as the source", () => {
    const r = resolveInstrumentSpec({ instrument: "XAU/USD", explicitSpec: COMPLETE_SPEC });
    expect(r.status).toBe("available");
    expect(r.spec.contractSize).toBe(100000);
    expect(r.sources.contractSize).toBe("user-provided");
    expect(r.missingForSizing).toEqual([]);
  });
});

// ── E. Execution-quality handoff ──────────────────────────────────

describe("Phase 292 — execution quality consumes the real quantity only", () => {
  const book: ParsedOrderBook = {
    ok: true,
    instrumentId: "TEST/USD",
    snapshotTs: Date.now(),
    bids: [
      { price: 163.5, size: 5 },
      { price: 163.4, size: 50 },
    ],
    asks: [
      { price: 163.6, size: 5 },
      { price: 163.7, size: 50 },
    ],
  };

  it("is unavailable without a calculated quantity — no synthetic size", () => {
    const s = estimateSlippage(book, "long", { contractSize: 100000 });
    expect(s.unavailableReason).toMatch(/position size unavailable/);
    expect(s.slippageBps).toBeUndefined();
    expect(s.quantityUsed).toBeUndefined();
  });

  it("refuses the base-quantity mapping without a contract size", () => {
    const s = estimateSlippage(book, "long", { quantityBase: 0.42 });
    expect(s.unavailableReason).toMatch(/contract size unavailable/);
    expect(s.quantityUsed).toBe(0.42);
    expect(s.slippageBps).toBeUndefined();
  });

  it("walks the real book with the real quantity and reports it back", () => {
    const s = estimateSlippage(book, "long", { quantityBase: 0.42, contractSize: 0.1 });
    expect(s.quantityUsed).toBe(0.42);
    expect(s.contractsUsed).toBeCloseTo(4.2, 9);
    expect(Number.isFinite(s.slippageBps!)).toBe(true);
    expect(s.estimatedSlippage).toBeGreaterThanOrEqual(0);
  });

  it("the engine's slippage estimate uses the sizing quantity it published", () => {
    const executionData = buildExecutionData(book, Date.now(), Date.now());
    expect(executionData.available).toBe(true);
    const r = runAnalysis(
      inputFor({
        accountEquity: 10_000_000,
        riskPercent: 0.01,
        instrumentSpec: COMPLETE_SPEC,
        executionData,
      }),
    );
    const s = r.positionSizing!;
    const slip = r.slippageEstimate!;
    expect(slip.quantityUsed).toBe(s.quantity);
    expect(slip.contractsUsed).toBeCloseTo(s.quantity! / 100000, 12);
  });

  it("without sizing there is no slippage figure, and the warning says why", () => {
    const executionData = buildExecutionData(book, Date.now(), Date.now());
    const r = runAnalysis(inputFor({ executionData }));
    // The thesis is actionable; the RISK layer refuses. No size ⇒ no impact
    // estimate: the engine reports the refusal rather than an assumed size.
    // (The crypto-class warning wording built on top of this state is pinned by
    // execution-engine.phase7; here the risk handoff itself is the subject.)
    expect(r.recommendation).not.toBe("NO_TRADE");
    expect(r.positionSizing).toBeUndefined();
    expect(r.slippageEstimate?.slippageBps).toBeUndefined();
    expect(r.slippageEstimate?.unavailableReason).toMatch(/position size unavailable/);
  });

  it("an unavailable book never becomes a fabricated slippage value", () => {
    const bad = buildExecutionData(
      { ok: false, reason: "crossed book" },
      Date.now(),
      Date.now(),
    );
    expect(bad.available).toBe(false);
    const r = runAnalysis(
      inputFor({
        instrumentType: "crypto",
        accountEquity: 10_000_000,
        riskPercent: 0.01,
        instrumentSpec: COMPLETE_SPEC,
        executionData: bad,
      }),
    );
    expect(r.slippageEstimate?.slippageBps).toBeUndefined();
    // The unusable book is exposed as an unavailable context, never as data.
    expect(r.executionContext).toBeUndefined();
  });
});
