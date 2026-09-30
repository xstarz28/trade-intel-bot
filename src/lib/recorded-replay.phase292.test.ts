/**
 * Phase 292 — RECORDED REAL-PROVIDER REPLAY (§13).
 *
 * Two halves, one rule: the risk layer may only publish what the evidence in
 * front of it supports.
 *
 *   1. The RECORDED OKX payload (real timestamps, unaltered) is pushed through
 *      structure → Phase 291 setup context → the decision gates. At the wall
 *      clock the recorded snapshot is older than every trading style's
 *      freshness window, so the honest outcome is NO_TRADE — and the stop is
 *      that NOTHING is fabricated to escape it: no plan, no R:R, no size, while
 *      the Phase 291 evidence the risk layer would have consumed stays intact
 *      and visible. The read is explicitly historical; it never claims LIVE.
 *
 *   2. A DESIGNED series (test-only, labelled) exercises the full publishable
 *      chain under a current observation instant: entry → published stop (with
 *      its invalidation level and buffer) → target → R:R → position size from
 *      real user inputs and a complete spec → slippage from the real book,
 *      ending in the recommendation layer reading the published ratio verbatim.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import { buildExecutionData } from "@/lib/execution-quality";
import type { ParsedOrderBook } from "@/lib/execution-quality";
import { buildCandidateFromSource } from "@/lib/liveCandidateBuilder";
import type { InstrumentSpec } from "@/lib/risk";
import type { AnalysisInput, AnalysisResult, Timeframe } from "@/types/analysis";

// ════════ 1. RECORDED PROVIDER REPLAY ════════

const RECORDED = JSON.parse(
  fs.readFileSync(
    new URL("./data/__fixtures__/real-provider-candles.phase290a.json", import.meta.url),
    "utf8",
  ),
) as { _provenance: Record<string, string>; bars: Record<string, string[][]> };

const loadRecorded = (tf: string): OhlcvCandle[] =>
  RECORDED.bars[tf]
    .map((r) => ({
      timestamp: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .reverse();

const REC = { W1: loadRecorded("1W"), D1: loadRecorded("1D"), H4: loadRecorded("4H"), H1: loadRecorded("1H") };

function runRecorded(tf: "W1" | "D1" | "H4" | "H1"): AnalysisResult {
  const candles = REC[tf];
  const htf = tf === "W1" ? REC.D1 : REC.W1;
  const chain: MtfCandleInput[] =
    tf === "H4"
      ? [
          { timeframe: "W1", role: "macro", candles: REC.W1 },
          { timeframe: "D1", role: "structure", candles: REC.D1 },
          { timeframe: "H4", role: "setup", candles: REC.H4 },
          { timeframe: "H1", role: "trigger", candles: REC.H1 },
        ]
      : [
          { timeframe: "W1", role: "macro", candles: REC.W1 },
          { timeframe: tf, role: "setup", candles },
        ];
  const base = calculateTechnical(candles, htf, "W1");
  const tech: TechnicalData = {
    ...base,
    smc: computeSmcContext(candles, tf),
    mtf: buildMtfContext(tf, chain),
  };
  const last = candles[candles.length - 1];
  return runAnalysis({
    instrument: "BTC-USDT",
    instrumentType: "crypto",
    timeframe: tf as Timeframe,
    provider: "okx",
    providerInstrumentId: "BTC-USDT",
    marketData: {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      fetchTimestamp: last.timestamp,
      price: { price: last.close, timestamp: last.timestamp, source: "okx" },
      candles,
      timeframe: tf,
      dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech,
    accountEquity: 25_000,
    riskPercent: 0.01,
    instrumentSpec: { assetClass: "crypto", contractSize: 1, quoteCurrency: "USDT", quantityStep: 0.01, source: "recorded-spec" },
  } as AnalysisInput);
}

const RECORDED_RUNS = {
  W1: runRecorded("W1"),
  D1: runRecorded("D1"),
  H4: runRecorded("H4"),
  H1: runRecorded("H1"),
} as const;

describe("Phase 292 — recorded provider replay stays historical and honest", () => {
  it("keeps the recorded payload's provenance and its real timestamps", () => {
    expect(RECORDED._provenance.provider).toBe("OKX");
    expect(RECORDED._provenance.instrumentId).toBe("BTC-USDT");
    for (const [tf, bars] of Object.entries(RECORDED.bars)) {
      expect(bars).toHaveLength(32);
      const times = bars.map((r) => Number(r[0]));
      // Real instants, oldest-first after the documented reverse, all in the past.
      const oldestFirst = [...times].reverse();
      for (let i = 1; i < oldestFirst.length; i++) expect(oldestFirst[i]).toBeGreaterThan(oldestFirst[i - 1]);
      expect(oldestFirst[oldestFirst.length - 1]).toBeLessThan(Date.now());
      void tf;
    }
  });

  it("the recorded snapshot is genuinely older than every freshness window", () => {
    for (const candles of Object.values(REC)) {
      const last = candles[candles.length - 1].timestamp;
      expect(Date.now() - last).toBeGreaterThan(60 * 60_000);
    }
  });

  it("publishes no executable plan and no size from a stale snapshot", () => {
    for (const [tf, r] of Object.entries(RECORDED_RUNS)) {
      expect(r.recommendation).toBe("NO_TRADE");
      expect(r.tradePlan).toBeUndefined();
      expect(r.positionSizing).toBeUndefined();
      expect(r.noTradeReasons.join(" ")).toMatch(/older than/);
      // The risk-note path never invents levels for a non-thesis.
      expect(r.riskNote).toMatch(/NO TRADE/);
      void tf;
    }
  });

  it("keeps the Phase 291 evidence the risk layer would have consumed", () => {
    // One timeframe's full picture, then the pinned verdicts of the others.
    const h4 = RECORDED_RUNS.H4.tradeLocation!;
    expect(h4.context.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(h4.location).toBe("inside_ob");
    expect(h4.invalidationEvidence.map((e) => `${e.source}:${e.level}`)).toContain(
      "structural_invalidation:85199.8",
    );
    const evidenceSources = new Set(h4.invalidationEvidence.map((e) => e.source));
    expect(evidenceSources.has("structural_invalidation")).toBe(true);
    expect(evidenceSources.has("order_block")).toBe(true);
    expect(evidenceSources.has("fair_value_gap")).toBe(true);

    expect(RECORDED_RUNS.W1.tradeLocation!.context.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(RECORDED_RUNS.W1.tradeLocation!.location).toBe("outside_zones");
    expect(RECORDED_RUNS.D1.tradeLocation!.context.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(RECORDED_RUNS.D1.tradeLocation!.location).toBe("inside_fvg");
    expect(RECORDED_RUNS.H1.tradeLocation!.context.state).toBe("LOCATION_ONLY");
  });

  it("never labels the recorded read as live", () => {
    for (const r of Object.values(RECORDED_RUNS)) {
      const json = JSON.stringify(r);
      expect(json).not.toMatch(/"LIVE"/);
      expect(json).not.toMatch(/liveVerified/);
      // The observation instant is the recorded provider instant, not now.
      expect(r.priceSnapshot!.timestamp).toBeLessThan(Date.now() - 60 * 60_000);
      expect(r.dataSource).toBe("okx");
    }
  });

  it("the analysis clock is not passed off as the provider instant", () => {
    const r = RECORDED_RUNS.H4;
    const lastBarTime = REC.H4[REC.H4.length - 1].timestamp;
    // The provider's recorded instant is preserved verbatim...
    expect(r.priceSnapshot!.timestamp).toBe(lastBarTime);
    // ...while the analysis clock is the wall clock, and the two are never
    // conflated into a claim that this read is current.
    expect(r.timestamp).toBeGreaterThan(Date.now() - 5 * 60_000);
    expect(r.timestamp - r.priceSnapshot!.timestamp).toBeGreaterThan(60 * 60_000);
    expect(r.noTradeReasons.join(" ")).toMatch(/older than .* stale rather than live/);
  });
});

// ════════ 2. DESIGNED CHAIN — publishable plan → size ════════

const INTERVAL_MS = 4 * 3600_000;
const T0 = Date.now() - 199 * INTERVAL_MS;
const TS = (i: number) => T0 + i * INTERVAL_MS;

function designedSeries(): OhlcvCandle[] {
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

const DES = designedSeries();
const DES_LAST = DES[DES.length - 1];

const SPEC: InstrumentSpec = {
  assetClass: "forex",
  contractSize: 100000,
  quoteCurrency: "USD",
  tickSize: 0.00001,
  quantityStep: 0.01,
  minQuantity: 0.01,
  source: "test-broker specification",
};

const BOOK: ParsedOrderBook = {
  ok: true,
  instrumentId: "TEST/USD",
  snapshotTs: Date.now(),
  bids: [
    { price: 163.4, size: 20 },
    { price: 163.3, size: 200 },
  ],
  asks: [
    { price: 163.7, size: 20 },
    { price: 163.8, size: 200 },
  ],
};

function designedRun(executionData?: MarketData extends never ? never : ReturnType<typeof buildExecutionData>): AnalysisResult {
  const smc = computeSmcContext(DES, "H4");
  const tech: TechnicalData = {
    ...calculateTechnical(DES, DES, "D1"),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc,
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles: DES },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles: DES } satisfies MtfCandleInput)),
    ]),
  };
  return runAnalysis({
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
      fetchTimestamp: DES_LAST.timestamp,
      price: { price: DES_LAST.close, timestamp: DES_LAST.timestamp, source: "fixture" },
      candles: DES,
      timeframe: "H4",
      dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech,
    economicEvents: "Fed signals hawkish stance, rate hike",
    accountEquity: 10_000_000,
    riskPercent: 0.01,
    instrumentSpec: SPEC,
    executionData,
  } as AnalysisInput);
}

const CHAIN = designedRun(buildExecutionData(BOOK, Date.now(), Date.now()));

describe("Phase 292 — the publishable chain is one consistent market-derived set", () => {
  it("entry, stop, target and R:R agree exactly", () => {
    const p = CHAIN.tradePlan!;
    const entry = parseFloat(p.entry);
    const stop = parseFloat(p.stopLoss);
    const target = parseFloat(p.takeProfit);
    expect(stop).toBeLessThan(entry);
    expect(target).toBeGreaterThan(entry);
    expect(p.riskReward).toBeCloseTo(Math.round((Math.abs(target - entry) / Math.abs(entry - stop)) * 100) / 100, 10);
    // Every level is traceable to a named market object.
    expect(p.stopProvenance!.level).toBeGreaterThan(0);
    expect(p.targetProvenance!.level).toBeGreaterThan(0);
    expect(p.structuralInvalidation!.level).toBe(p.stopProvenance!.level);
  });

  it("the size is derived from the PUBLISHED stop and the published entry", () => {
    const p = CHAIN.tradePlan!;
    const s = CHAIN.positionSizing!;
    const distance = Math.abs(parseFloat(p.entry) - parseFloat(p.stopLoss));
    expect(s.available).toBe(true);
    expect(s.riskAmount).toBeCloseTo(100_000, 6);
    expect(s.riskPerUnit).toBeCloseTo(distance * 100000, 6);
    expect(s.quantity).toBeCloseTo(Math.floor(s.riskAmount! / s.riskPerUnit! / 0.01) * 0.01, 9);
  });

  it("the slippage estimate uses that exact size", () => {
    const s = CHAIN.positionSizing!;
    const slip = CHAIN.slippageEstimate!;
    expect(slip.quantityUsed).toBe(s.quantity);
    expect(slip.contractsUsed).toBeCloseTo(s.quantity! / 100000, 12);
    expect(slip.unavailableReason).toBeUndefined();
    expect(Number.isFinite(slip.slippageBps!)).toBe(true);
  });

  it("the recommendation layer reads the published ratio verbatim", () => {
    const candidate = buildCandidateFromSource(
      {
        instrument: "TEST/USD",
        assetClass: "forex",
        marketData: CHAIN.technicalData
          ? ({
              instrument: "TEST/USD",
              instrumentType: "forex",
              provider: "fixture",
              providerInstrumentId: "TEST/USD",
              fetchTimestamp: DES_LAST.timestamp,
              price: CHAIN.priceSnapshot!,
              candles: DES,
              timeframe: "H4",
              dataFreshness: "delayed",
            } as MarketData)
          : undefined,
        technicalData: CHAIN.technicalData,
        analysisResult: CHAIN,
      },
      Date.now(),
    );
    expect(candidate.riskReward).toBe(CHAIN.tradePlan!.riskReward);
    expect(candidate.setupContextState).toBe(CHAIN.tradeLocation!.context.state);
  });

  it("states the plan as a market reference, with its setup verdict, not a fill", () => {
    const ctx = CHAIN.tradePlan!.entryContext!;
    const p = CHAIN.tradePlan!;
    expect(ctx.triggerConfirmed).toBe(ctx.setupState === "CONFIRMED_SETUP_CONTEXT");
    expect(ctx.note).toContain("market reference");
    expect(CHAIN.riskNote).toContain(String(p.stopProvenance!.level));
    expect(CHAIN.riskNote).toContain(p.stopLoss);
  });
});
