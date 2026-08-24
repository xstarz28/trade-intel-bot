/**
 * Phase 4 — instrument specification resolution & currency-aware risk.
 *
 * NON-NEGOTIABLE invariants proven here:
 *   - contract specs come ONLY from explicit input (never broker conventions)
 *   - quote currency derives only from literal symbol structure / explicit spec
 *   - FX conversion uses live provider snapshots: direct, disclosed inverse,
 *     same-currency = 1; stale/invalid/missing → explicit unavailable
 *   - quantity always rounds DOWN; below minimum → unavailable
 *   - sizing unavailability NEVER changes the trade decision itself
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";
import {
  computePositionSizing,
  type FxRateSnapshot,
  type InstrumentSpec,
} from "@/lib/risk";
import { resolveConversionRate, DEFAULT_FX_MAX_AGE_MS } from "@/lib/risk/fx";
import {
  parseSymbolCurrencies,
  resolveInstrumentSpec,
} from "@/lib/risk/spec-resolver";

const NOW = 1_800_000_000_000;

// ── Instrument specification resolution ────────────────────────────

describe("resolveInstrumentSpec", () => {
  it("returns available for a complete explicit spec", () => {
    const r = resolveInstrumentSpec({
      instrument: "EUR/USD",
      explicitSpec: {
        assetClass: "forex",
        contractSize: 100000,
        quoteCurrency: "USD",
        quantityStep: 0.01,
        source: "broker-portal",
      },
    });
    expect(r.status).toBe("available");
    expect(r.missingForSizing).toEqual([]);
    expect(r.spec.contractSize).toBe(100000);
  });

  it("returns partial — never invents contract size for forex", () => {
    const r = resolveInstrumentSpec({ instrument: "EUR/USD" });
    expect(r.status).toBe("partial");
    expect(r.spec.quoteCurrency).toBe("USD");
    expect(r.spec.contractSize).toBeUndefined();
    expect(r.missingForSizing).toContain("contract size");
    expect(r.sources.quoteCurrency).toBe("symbol structure (EUR/USD)");
  });

  it("derives quote currency for commodity symbol structure", () => {
    const r = resolveInstrumentSpec({ instrument: "XAU/USD" });
    expect(r.spec.quoteCurrency).toBe("USD");
  });

  it("is unavailable when no spec and no parseable quote currency", () => {
    const r = resolveInstrumentSpec({ instrument: "AAPL" });
    expect(r.status).toBe("unavailable");
    expect(r.unavailableReason).toBeTruthy();
    expect(r.spec.contractSize).toBeUndefined();
  });

  it("explicit user spec always wins over derived values", () => {
    const r = resolveInstrumentSpec({
      instrument: "EUR/USD",
      explicitSpec: {
        assetClass: "forex",
        contractSize: 1000, // deliberately non-conventional CFD size
        quoteCurrency: "EUR", // deliberately overrides the USD parse
        quantityStep: 1,
      },
    });
    expect(r.spec.quoteCurrency).toBe("EUR");
    expect(r.spec.contractSize).toBe(1000);
    expect(r.sources.quoteCurrency).toBe("user-provided");
  });
});

describe("parseSymbolCurrencies", () => {
  it("parses literal BASE/QUOTE structures only", () => {
    expect(parseSymbolCurrencies("BTC/USD")).toEqual({ base: "BTC", quote: "USD" });
    expect(parseSymbolCurrencies("eur/jpy")).toEqual({ base: "EUR", quote: "JPY" });
    // Single symbols carry no derivable quote currency.
    expect(parseSymbolCurrencies("AAPL")).toEqual({});
    expect(parseSymbolCurrencies("")).toEqual({});
  });
});

// ── Currency conversion ────────────────────────────────────────────

const snap = (pair: string, rate: number, ageMs = 0): FxRateSnapshot => ({
  pair,
  rate,
  timestamp: NOW - ageMs,
  source: "twelve-data-test",
});

describe("resolveConversionRate", () => {
  it("same currency → factor 1, no provider needed", () => {
    const r = resolveConversionRate("usd", "USD", { now: NOW });
    expect(r).toMatchObject({ available: true, rate: 1, direction: "same" });
  });

  it("uses a fresh direct pair as-is", () => {
    const r = resolveConversionRate("EUR", "USD", {
      now: NOW,
      direct: snap("EUR/USD", 1.08),
    });
    expect(r).toMatchObject({ available: true, rate: 1.08, direction: "direct" });
  });

  it("inverts an inverse-only pair with DISCLOSED inversion", () => {
    const r = resolveConversionRate("EUR", "USD", {
      now: NOW,
      inverse: snap("USD/EUR", 0.9),
    });
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.direction).toBe("inverse");
      expect(r.rate).toBeCloseTo(1 / 0.9, 12);
      expect(r.source).toContain("inverse of USD/EUR");
    }
  });

  it("rejects a stale direct snapshot with a precise reason", () => {
    const r = resolveConversionRate("EUR", "USD", {
      now: NOW,
      direct: snap("EUR/USD", 1.08, DEFAULT_FX_MAX_AGE_MS + 1),
    });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toContain("FX_RATE_STALE");
  });

  it("rejects invalid rates instead of using them silently", () => {
    const r1 = resolveConversionRate("EUR", "USD", {
      now: NOW,
      direct: snap("EUR/USD", 0),
    });
    expect(r1.available).toBe(false);
    if (!r1.available) expect(r1.reason).toBe("ACCOUNT_CURRENCY_CONVERSION_UNAVAILABLE");

    const r2 = resolveConversionRate("EUR", "USD", {
      now: NOW,
      direct: snap("EUR/USD", NaN),
    });
    expect(r2.available).toBe(false);
  });

  it("unavailable when nothing usable is supplied", () => {
    const r = resolveConversionRate("EUR", "USD", { now: NOW });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe("ACCOUNT_CURRENCY_CONVERSION_UNAVAILABLE");
  });

  it("ignores a snapshot for the WRONG pair rather than guessing", () => {
    const r = resolveConversionRate("EUR", "USD", {
      now: NOW,
      direct: snap("GBP/USD", 1.27), // wrong pair
    });
    expect(r.available).toBe(false);
  });
});

// ── Position sizing with account currency ──────────────────────────

const fullSpec: InstrumentSpec = {
  assetClass: "forex",
  contractSize: 10000, // mini-lot-style CFD — explicitly provided, not assumed
  quoteCurrency: "USD",
  quantityStep: 0.01,
  minQuantity: 0.01,
};

describe("computePositionSizing — currency awareness", () => {
  it("same account currency → no conversion applied", () => {
    const r = computePositionSizing({
      equity: 100000,
      riskPercent: 0.01,
      entry: 100,
      stopLoss: 99,
      spec: { ...fullSpec, contractSize: 100 },
      accountCurrency: "USD",
      now: NOW,
    });
    expect(r.available).toBe(true);
    expect(r.denominationCurrency).toBe("USD");
    expect(r.conversion?.direction).toBe("same");
    // riskPerUnit = |100-99| × 100 = 100
    expect(r.riskPerUnit).toBeCloseTo(100, 8);
    // quantity = floor(1000/100 / 0.01)×0.01 = 10
    expect(r.quantity).toBe(10);
  });

  it("direct conversion scales risk per unit into the account currency", () => {
    const r = computePositionSizing({
      equity: 100000,
      riskPercent: 0.01,
      entry: 100,
      stopLoss: 99,
      spec: { ...fullSpec, quoteCurrency: "EUR" },
      accountCurrency: "USD",
      fxDirect: snap("EUR/USD", 1.1),
      now: NOW,
    });
    expect(r.available).toBe(true);
    expect(r.conversion).toMatchObject({ from: "EUR", to: "USD", direction: "direct" });
    // riskPerUnitQuote = 1 × 10000 = 10000 EUR → ×1.1 = 11000 USD
    expect(r.riskPerUnit).toBeCloseTo(11000, 6);
  });

  it("inverse conversion is mathematically correct (quote USD, account EUR)", () => {
    const r = computePositionSizing({
      equity: 100000,
      riskPercent: 0.01,
      entry: 200,
      stopLoss: 199,
      spec: { ...fullSpec, quoteCurrency: "USD" },
      accountCurrency: "EUR",
      fxInverse: snap("EUR/USD", 1.1), // only the inverse-direction pair exists
      now: NOW,
    });
    expect(r.available).toBe(true);
    expect(r.conversion?.direction).toBe("inverse");
    expect(r.riskPerUnit).toBeCloseTo(10000 / 1.1, 6); // USD → EUR
    expect(r.denominationCurrency).toBe("EUR");
  });

  it("missing FX rate → explicit unavailable, reason ACCOUNT_CURRENCY_CONVERSION_UNAVAILABLE", () => {
    const r = computePositionSizing({
      equity: 100000,
      riskPercent: 0.01,
      entry: 100,
      stopLoss: 99,
      spec: { ...fullSpec, quoteCurrency: "EUR" },
      accountCurrency: "JPY",
      now: NOW,
    });
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("ACCOUNT_CURRENCY_CONVERSION_UNAVAILABLE");
  });

  it("stale FX rate → unavailable, never used silently", () => {
    const r = computePositionSizing({
      equity: 100000,
      riskPercent: 0.01,
      entry: 100,
      stopLoss: 99,
      spec: { ...fullSpec, quoteCurrency: "EUR" },
      accountCurrency: "USD",
      fxDirect: snap("EUR/USD", 1.1, DEFAULT_FX_MAX_AGE_MS * 5),
      now: NOW,
    });
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("FX_RATE_STALE");
  });

  it("no account currency → Phase 3B behavior preserved (quote denomination)", () => {
    const r = computePositionSizing({
      equity: 100000,
      riskPercent: 0.01,
      entry: 100,
      stopLoss: 99,
      spec: fullSpec,
      now: NOW,
    });
    expect(r.available).toBe(true);
    expect(r.denominationCurrency).toBe("USD");
    expect(r.conversion).toBeUndefined();
  });
});

describe("computePositionSizing — quantity rounding integrity", () => {
  const stepCases = [
    { name: "exact step stays exact", raw: 10, expected: 10 },
    { name: "fractional rounds DOWN, never up past intended risk", raw: 9.999, expected: 9.99 },
    { name: "very small above minimum survives float residue", raw: 0.0100001, expected: 0.01 },
  ];
  for (const c of stepCases) {
    it(c.name, () => {
      // Construct inputs so theoretical quantity ≈ c.raw:
      // riskAmount = 100000×0.01 = 1000; riskPerUnit = distance×cs
      const cs = 100;
      const distance = 1000 / (c.raw * cs);
      const r = computePositionSizing({
        equity: 100000,
        riskPercent: 0.01,
        entry: 100 + distance,
        stopLoss: 100,
        spec: { ...fullSpec, contractSize: cs, minQuantity: 0.01, quantityStep: 0.01 },
        now: NOW,
      });
      expect(r.quantity).toBe(c.expected);
    });
  }

  it("just below minimum → unavailable with honest explanation", () => {
    const r = computePositionSizing({
      equity: 100,
      riskPercent: 0.001,
      entry: 101,
      stopLoss: 100,
      spec: { ...fullSpec, minQuantity: 0.5 },
      now: NOW,
    });
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("below the instrument minimum of 0.5");
  });

  it("zero risk distance → unavailable", () => {
    const r = computePositionSizing({
      equity: 100000,
      riskPercent: 0.01,
      entry: 100,
      stopLoss: 100,
      spec: fullSpec,
      now: NOW,
    });
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("no risk distance");
  });
});

// ── Engine integration — decision independence ─────────────────────

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

function techBullish(): TechnicalData {
  return {
    swingHighs: [110], swingLows: [95], structure: "HH/HL",
    bosDirection: "bullish", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [110],
    volumeTrend: "unknown", dataPoints: 210,
  };
}

function baseInput(): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    economicEvents: "hawkish rate hike strong gdp",
    marketData: makeMarket(100),
    technicalData: techBullish(),
  };
}

describe("runAnalysis — Phase 4 integration", () => {
  it("computes sizing WITH live-FX conversion metadata end-to-end", () => {
    const result = runAnalysis({
      ...baseInput(),
      accountEquity: 100000,
      riskPercent: 0.01,
      instrumentSpec: fullSpec,
      accountCurrency: "USD",
    });
    expect(result.recommendation).toBe("LONG"); // decision unaffected by risk layer
    expect(result.positionSizing?.available).toBe(true);
    expect(result.positionSizing?.denominationCurrency).toBe("USD");
    expect(result.positionSizing?.specificationSource).toBe("user-provided");
  });

  it("conversion failure does NOT veto the thesis — sizing just becomes unavailable", () => {
    const result = runAnalysis({
      ...baseInput(),
      accountEquity: 100000,
      riskPercent: 0.01,
      instrumentSpec: { ...fullSpec, quoteCurrency: "EUR" },
      accountCurrency: "JPY",
      fxRates: {}, // provider gave us nothing
    });
    // Trade thesis stands on its own evidence…
    expect(result.recommendation).toBe("LONG");
    // …but position sizing is honestly absent, not fabricated.
    expect(result.positionSizing).toBeUndefined();
    expect(result.riskNote).not.toContain("Position size for the provided");
  });

  it("without any spec, sizing stays undefined — no synthetic fallback ever", () => {
    const result = runAnalysis({
      ...baseInput(),
      accountEquity: 50000,
      riskPercent: 0.02,
      // NO instrumentSpec — even though symbol parses to quote USD.
    });
    expect(result.recommendation).toBe("LONG");
    expect(result.positionSizing).toBeUndefined();
  });

  it("partial spec (symbol-derived quote + explicit contract fields missing) → no sizing", () => {
    const result = runAnalysis({
      ...baseInput(),
      accountEquity: 50000,
      riskPercent: 0.02,
      instrumentSpec: { assetClass: "forex" }, // no contract size / step
    });
    expect(result.positionSizing).toBeUndefined();
  });
});
