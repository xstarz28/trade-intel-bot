/**
 * Phase 7B-3 — engine integration of OKX instrument specification.
 *
 * Proves:
 * - OKX metadata enables honest crypto position sizing when complete
 * - metadata NEVER influences bias, conviction, or trade decisions
 * - explicit-vs-OKX conflicts block sizing (thesis stays valid)
 * - FX-unavailable → sizing unavailable, LONG remains valid
 * - NO_TRADE still carries no tradePlan regardless of OKX data
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";
import type { OkxSpecData } from "@/lib/risk/okx-spec";

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
  return {
    instrument: "BTC-USDT-SWAP", instrumentType: "crypto", timeframe: "H4",
    newsContext: "institutional adoption etf approval", // second agreeing core factor
    economicEvents: undefined,
    marketData: makeMarket("BTC-USDT-SWAP"),
    technicalData: techBase(),
    ...over,
  } as AnalysisInput;
}

const okxData = (): OkxSpecData => ({
  fetchedAt: Date.now(),
  source: "OKX public instruments",
  freshness: "static",
  instruments: [
    {
      instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live", ctType: "linear",
      ctVal: 0.01, ctValCcy: "BTC", settleCcy: "USDT", lotSz: 0.01, minSz: 0.01, tickSz: 0.1,
    },
  ],
  parseWarnings: [],
});

const fxUsdtUsd = { rate: 1.0001, timestamp: Date.now(), source: "provider-test", pair: "USDT/USD" };

// ── Sizing enabled by OKX metadata ────────────────────────────────

describe("position sizing with OKX contract metadata", () => {
  it("computes honest crypto sizing from ctVal/settleCcy/lotSz/minSz + account inputs", () => {
    const r = runAnalysis(baseInput({
      accountEquity: 100_000,
      riskPercent: 0.01, // riskAmount = 1000
      accountCurrency: "USD",
      fxRates: { direct: fxUsdtUsd },
      okxSpecData: okxData(),
    }));
    expect(r.recommendation).toBe("LONG");
    expect(r.positionSizing?.available).toBe(true);
    expect(r.positionSizing?.specificationSource).toMatch(/OKX/);
    // riskPerUnit = |100−98| × 0.01 BTC × 1.0001 = 0.020002 USDT→USD per contract
    expect(r.positionSizing!.riskPerUnit!).toBeCloseTo(2 * 0.01 * 1.0001, 6);
    // quantity = floor((1000 / 0.020002)/0.01)*0.01 — rounded DOWN to lotSz
    const expectedQty = Math.floor(1000 / 0.020002 / 0.01) * 0.01;
    expect(r.positionSizing!.quantity).toBeCloseTo(expectedQty, 6);
    expect((r.positionSizing!.quantity! / 0.01) % 1).toBeCloseTo(0, 6); // respects quantityStep (float-safe)
  });

  it("non-USD account uses inverse FX path when direct pair is absent", () => {
    const r = runAnalysis(baseInput({
      accountEquity: 100_000,
      riskPercent: 0.01,
      accountCurrency: "EUR",
      fxRates: { inverse: { rate: 0.92, timestamp: Date.now(), source: "provider-test", pair: "EUR/USDT" } },
      okxSpecData: okxData(),
    }));
    expect(r.positionSizing?.available).toBe(true);
    expect(r.positionSizing!.conversion?.direction).toBe("inverse");
    expect(r.positionSizing!.denominationCurrency).toBe("EUR");
  });

  it("FX unavailable with non-matching account currency → sizing unavailable, thesis stays LONG", () => {
    const r = runAnalysis(baseInput({
      accountEquity: 100_000,
      riskPercent: 0.01,
      accountCurrency: "JPY", // no USDT/JPY snapshot provided
      okxSpecData: okxData(),
    }));
    expect(r.recommendation).toBe("LONG"); // thesis untouched
    expect(r.positionSizing).toBeUndefined();
  });
});

// ── Conflicts block sizing, not the thesis ────────────────────────

describe("explicit-vs-OKX conflicts block sizing only", () => {
  it("conflicting explicit contractSize blocks sizing but keeps the valid LONG", () => {
    const r = runAnalysis(baseInput({
      instrumentSpec: { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, quoteCurrency: "USDT" },
      accountEquity: 100_000,
      riskPercent: 0.01,
      accountCurrency: "USDT", // same as quote → no FX needed
      okxSpecData: okxData(),
    }));
    expect(r.recommendation).toBe("LONG");
    expect(r.positionSizing).toBeUndefined(); // blocked
  });

  it("complete explicit spec is used without conflict when consistent", () => {
    const r = runAnalysis(baseInput({
      instrumentSpec: { assetClass: "crypto", contractSize: 0.01, quantityStep: 0.01, quoteCurrency: "USDT" },
      accountEquity: 100_000,
      riskPercent: 0.01,
      accountCurrency: "USDT",
      okxSpecData: okxData(),
    }));
    expect(r.positionSizing?.available).toBe(true);
    expect(r.positionSizing!.quantity).toBeGreaterThan(0);
  });
});

// ── Decision-engine isolation ──────────────────────────────────────

describe("OKX metadata never touches the decision engine", () => {
  it("bias, breakdown and conviction are identical with and without OKX data", () => {
    const without = runAnalysis(baseInput({ accountEquity: 100_000, riskPercent: 0.01, accountCurrency: "USDT" }));
    const withOkx = runAnalysis(baseInput({ accountEquity: 100_000, riskPercent: 0.01, accountCurrency: "USDT", okxSpecData: okxData() }));
    expect(without.breakdown).toEqual(withOkx.breakdown);
    expect(without.confidence).toBe(withOkx.confidence);
    expect(without.conviction).toBe(withOkx.conviction);
    expect(without.keyContradictions).toEqual(withOkx.keyContradictions);
  });

  it("OKX cannot turn a Neutral-bias market into a tradeable one", () => {
    const neutral = baseInput({
      technicalData: techBase({ structure: "range", bosDirection: "none", swingHighs: [101], swingLows: [99], resistanceLevels: [101], supportLevels: [99] }),
      okxSpecData: okxData(),
      accountEquity: 100_000,
      riskPercent: 0.01,
      accountCurrency: "USDT",
    });
    const r = runAnalysis(neutral);
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
  });

  it("NO_TRADE still carries no tradePlan even with rich OKX + FX inputs", () => {
    const r = runAnalysis(baseInput({
      technicalData: techBase({ supportLevels: [99], resistanceLevels: [101], swingHighs: [101], swingLows: [99] }), // R:R 1.0
      okxSpecData: okxData(),
      accountEquity: 100_000,
      riskPercent: 0.01,
      accountCurrency: "USDT",
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.noTradeReasons.join(" ")).toMatch(/R:R/);
  });
});

// ── Failure behavior ──────────────────────────────────────────────

it("OKX unavailable/failure leaves analysis fully intact (backward compatible)", () => {
  const a = runAnalysis(baseInput());
  const b = runAnalysis(baseInput({ okxSpecData: { fetchedAt: Date.now(), source: "OKX public instruments", freshness: "static", instruments: [], parseWarnings: ["response is not a JSON object"] } }));
  expect(a.recommendation).toBe(b.recommendation);
  expect(a.confidence).toBe(b.confidence);
});
