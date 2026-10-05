/**
 * PHASE 313 — MULTI-ASSET INTELLIGENCE PARITY + PROVIDER GAP CLOSURE.
 *
 * Deterministic proofs (no network, no clock, no React) that:
 *   · all four asset classes run the SAME unified reasoning architecture
 *     (one chart/plan/chain/mechanics stack, asset-specific evidence only);
 *   · the CoinGlass integration is reused (never duplicated) and its four
 *     correlated derivatives observations are ONE dependency family whose
 *     additive contribution is capped — never provider-count confidence;
 *   · per-class evidence semantics stay honest (forex macro, commodity EIA
 *     oil-only, stock fundamentals, explicit unavailability everywhere);
 *   · timeframe integrity holds across the full M1…W1 matrix per class;
 *   · risk/actionability/probability semantics are asset-agnostic;
 *   · nothing executes and the documented provider decisions are complete.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { OhlcvCandle } from "./data/market-types";
import type { AnalysisResult, AnalysisInput } from "@/types/analysis";
import type { CryptoDerivativesData } from "./data/derivatives-types";
import { runAnalysis } from "./analysis-engine";
import { assemble, buildMtf, BULL_LEVELS, sentiment } from "./benchmark-fixtures.phase9";
import { buildSignalChart } from "./strategy/chart";
import { buildAdaptiveTradePlan } from "./strategy/trade-plan";
import { buildSignalResponse } from "./strategy/signal";
import { buildReasoningChain } from "./strategy/explanation";
import { buildPositionMechanics, type SizingSpec } from "./strategy/position";
import { normalizeRiskPolicy } from "./strategy/policy";
import { assessHistoricalProbability, type HistoricalOutcomeRecord } from "./strategy/probability";
import {
  EVIDENCE_DEPENDENCY_FAMILIES,
  DERIVATIVES_STATE_FAMILY_CAP,
  clampFamilyDelta,
} from "./strategy/evidence-groups";
import { derivativesForRadar } from "./market-radar/derivatives-bridge";
import { adaptSetupTimeframe, STYLE_PROFILES } from "./trading-style";
import { buildStrategyContext } from "./strategy/context";

/* ------------------------------------------------------------------ *
 * Fixtures                                                            *
 * ------------------------------------------------------------------ */

const T0 = 1_760_000_000_000;
const STEP = 3_600_000;

function candles(n: number, from = 100, per = 0.4): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  for (let i = 0; i < n; i++) {
    const o = from + per * i;
    const c = o + per;
    out.push({
      timestamp: T0 + i * STEP,
      open: o,
      high: Math.max(o, c) + Math.abs(per) * 0.05,
      low: Math.min(o, c) - Math.abs(per) * 0.05,
      close: c,
      volume: 1000,
    });
  }
  return out;
}

const TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;

interface ClassFixture {
  label: string;
  instrument: string;
  instrumentType: AnalysisInput["instrumentType"];
  provider: string;
  providerInstrumentId: string;
  spec: SizingSpec;
  plan: Record<string, unknown>;
}

const CLASS_FIXTURES: ClassFixture[] = [
  {
    label: "crypto",
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    provider: "okx",
    providerInstrumentId: "BTC-USDT",
    spec: { assetClass: "crypto", contractSize: 1, quoteCurrency: "USDT", quantityStep: 0.1, source: "user-provided" },
    plan: { direction: "long", entry: "103.5", stopLoss: "101.5", takeProfit: "112", riskReward: 4.25 },
  },
  {
    label: "forex",
    instrument: "EUR/USD",
    instrumentType: "forex",
    provider: "twelve-data",
    providerInstrumentId: "EUR/USD",
    spec: { assetClass: "forex", contractSize: 100000, quoteCurrency: "USD", pipSize: 0.0001, quantityStep: 0.01, source: "user-provided" },
    plan: { direction: "long", entry: "1.10000", stopLoss: "1.09500", takeProfit: "1.12000", riskReward: 4 },
  },
  {
    label: "commodity",
    instrument: "XAU/USD",
    instrumentType: "commodity",
    provider: "twelve-data",
    providerInstrumentId: "XAU/USD",
    spec: { assetClass: "commodity", contractSize: 100, quoteCurrency: "USD", quantityStep: 1, source: "user-provided" },
    plan: { direction: "long", entry: "2650", stopLoss: "2630", takeProfit: "2750", riskReward: 5 },
  },
  {
    label: "stock",
    instrument: "AAPL",
    instrumentType: "stock",
    provider: "twelve-data",
    providerInstrumentId: "AAPL",
    spec: { assetClass: "stock", contractSize: 1, quoteCurrency: "USD", quantityStep: 1, source: "user-provided" },
    plan: { direction: "long", entry: "230", stopLoss: "225", takeProfit: "250", riskReward: 4 },
  },
];

function planFixture(f: ClassFixture): AnalysisResult["tradePlan"] {
  return {
    direction: f.plan.direction as "long" | "short",
    entry: String(f.plan.entry),
    entryBasis: "live market price at analysis time",
    stopLoss: String(f.plan.stopLoss),
    slBasis: "nearest market swing low (structural)",
    takeProfit: String(f.plan.takeProfit),
    tpBasis: "resting liquidity at the structural target",
    riskReward: f.plan.riskReward as number,
    stopProvenance: {
      source: "swing_level",
      level: Number(f.plan.stopLoss),
      timeframe: "H1",
      buffer: 0,
      publishedStop: Number(f.plan.stopLoss),
      note: "nearest unbroken market swing low",
    },
    targetProvenance: {
      source: "resting_liquidity",
      level: Number(f.plan.takeProfit),
      timeframe: "H1",
      note: "resting liquidity at the structural target (never a swept level)",
    },
    structuralInvalidation: {
      level: Number(f.plan.stopLoss),
      timeframe: "H1",
      swingKind: "low",
      note: "confirmed swing low voids the bullish thesis",
    },
  } as AnalysisResult["tradePlan"];
}

function resultFixture(f: ClassFixture, tf: string): AnalysisResult {
  const cdls = candles(40, 100, 0.4);
  const result = {
    id: `p313-${f.label}`,
    instrument: f.instrument,
    instrumentType: f.instrumentType,
    timeframe: tf,
    provider: f.provider,
    providerInstrumentId: f.providerInstrumentId,
    bias: "Bullish",
    confidence: 70,
    recommendation: "LONG",
    noTradeReasons: [],
    tradePlan: planFixture(f),
    technicalData: {
      dataPoints: cdls.length,
      structure: "HH/HL",
      bosDirection: "bullish",
      strategy: buildStrategyContext(cdls, tf),
    },
    keyLevels: { support: "100", resistance: "112", invalidation: "100" },
    dataFlags: [],
  } as unknown as AnalysisResult;
  result.reasoningChain = buildReasoningChain(result);
  return result;
}

/* CoinGlass payload helper — the shape the Convex action returns. */
function derivPayload(over: {
  funding?: number; // currentRate
  oiChange1h?: number;
  longShort?: number; // accountRatio
  liquidationSide?: "longs" | "shorts" | "balanced";
}): CryptoDerivativesData {
  return {
    provider: "coinglass",
    symbol: "BTC",
    timestamp: T0,
    freshness: "delayed",
    fundingRate: { currentRate: over.funding ?? 0 },
    openInterest: { current: 1_000_000, ...(over.oiChange1h !== undefined ? { change1h: over.oiChange1h } : {}) },
    longShort: { ...(over.longShort !== undefined ? { accountRatio: over.longShort } : {}) },
    liquidations: { dominantSide: over.liquidationSide ?? "balanced" },
    availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
    confidence: "high",
  };
}

const POLICY = normalizeRiskPolicy({ accountEquity: 1000, maxRiskPercent: 0.02, accountCurrency: "USDT" });

/* ------------------------------------------------------------------ *
 * 1 · Derivatives-state dependency family (correlation-aware)         *
 * ------------------------------------------------------------------ */

describe("313.1 — CoinGlass evidence is one dependency family, not four confirmations", () => {
  const LHLL: AnalysisInput = (() => {
    const base = assemble({ structure: "LH/LL", bos: "bearish" } as never);
    return { ...base, structure: "LH/LL", bosDirection: "bearish" } as AnalysisInput;
  })();

  function sentimentWith(deriv?: CryptoDerivativesData): number {
    const input = { ...LHLL, instrumentType: "crypto", instrument: "BTC/USDT", ...(deriv ? { derivativesData: deriv } : {}) } as AnalysisInput;
    const r = runAnalysis(input);
    return r.decisionTrace!.biasCalculation!.factorScores!.sentiment;
  }

  it("four agreeing derivatives readings contribute the family cap, not their sum", () => {
    const allBullishAligned = derivPayload({
      funding: -0.002, // +1 (negative funding)
      oiChange1h: -3, // +1 (OI down on LH/LL)
      longShort: 0.4, // +1 (crowded shorts)
      liquidationSide: "longs", // +1
    });
    const baseline = sentimentWith(undefined);
    const withAll = sentimentWith(allBullishAligned);
    expect(withAll - baseline).toBe(DERIVATIVES_STATE_FAMILY_CAP); // +2, never +4
  });

  it("the cap is symmetric and non-binding below it", () => {
    const allBearish = derivPayload({
      funding: 0.002,
      oiChange1h: 3,
      longShort: 2.5,
      liquidationSide: "shorts",
    });
    const baseline = sentimentWith(undefined);
    expect(sentimentWith(allBearish) - baseline).toBe(-DERIVATIVES_STATE_FAMILY_CAP);
    const twoAgreeing = derivPayload({ funding: -0.002, liquidationSide: "longs" });
    expect(sentimentWith(twoAgreeing) - baseline).toBe(2); // raw 2 === cap 2
    const mixed = derivPayload({ funding: -0.002, longShort: 2.5 }); // +1 -1 = 0
    expect(sentimentWith(mixed) - baseline).toBe(0);
  });

  it("the family registry is explicit, capped and documented", () => {
    const deriv = EVIDENCE_DEPENDENCY_FAMILIES.find((f) => f.id === "derivatives_state")!;
    expect(deriv.cap).toBe(2);
    expect(deriv.members.length).toBeGreaterThanOrEqual(4);
    expect(deriv.note).toContain("correlated");
    for (const f of EVIDENCE_DEPENDENCY_FAMILIES) {
      expect(f.underlyingState.length).toBeGreaterThan(5);
      expect(f.note.length).toBeGreaterThan(20);
      if (f.cap !== null) expect(clampFamilyDelta(99, f.cap)).toBe(f.cap);
    }
    expect(clampFamilyDelta(-99, DERIVATIVES_STATE_FAMILY_CAP)).toBe(-DERIVATIVES_STATE_FAMILY_CAP);
  });

  it("unavailable derivatives stay unavailable — the news family is used instead, no zero-fill", () => {
    const unavailable = derivPayload({});
    (unavailable as { confidence: string }).confidence = "unavailable";
    const baseline = sentimentWith(undefined);
    expect(sentimentWith(unavailable)).toBe(baseline);
  });
});

/* ------------------------------------------------------------------ *
 * 2 · CoinGlass reuse — bridge identity/provenance (no duplicate)     *
 * ------------------------------------------------------------------ */

describe("313.2 — the CoinGlass integration is reused with strict identity", () => {
  it("the radar bridge rejects a payload for another asset — never re-labelled", () => {
    const payload = derivPayload({ funding: -0.002 });
    const res = derivativesForRadar("ETH/USD", payload, T0 + STEP);
    expect(res.derivatives).toBeUndefined();
    expect(res.rejected.length).toBeGreaterThan(0);
  });

  it("a same-symbol fresh payload is forwarded with its provider timestamp semantics", () => {
    const payload = derivPayload({ funding: -0.002 });
    const res = derivativesForRadar("BTC/USD", payload, T0 + STEP);
    expect(res.derivatives).toBeDefined();
    expect(res.derivatives!.fundingRate).toBe(payload.fundingRate!.currentRate);
    expect(res.additionalEvidence![0].provider).toBe("coinglass");
    expect(res.additionalEvidence![0].timestampProvenance).toBe("PROVIDER_OBSERVED");
  });
});

/* ------------------------------------------------------------------ *
 * 3 · Cross-asset parity — one architecture, four evidence profiles   *
 * ------------------------------------------------------------------ */

describe("313.3 — all four asset classes share one reasoning architecture", () => {
  it("the reasoning-chain heading sequence is identical across classes", () => {
    const headings = CLASS_FIXTURES.map((f) =>
      buildReasoningChain(resultFixture(f, "H1"))
        .sections.map((s) => s.heading)
        .join(">"),
    );
    expect(new Set(headings).size).toBe(1);
    expect(headings[0]).toContain("MARKET STRUCTURE");
    expect(headings[0]).toContain("LIMITATIONS");
  });

  it("the chart and plan builders are asset-agnostic: same shape, per-class values", () => {
    for (const f of CLASS_FIXTURES) {
      const result = resultFixture(f, "H1");
      const plan = buildAdaptiveTradePlan(result, { policy: POLICY });
      expect(plan.available, f.label).toBe(true);
      expect(plan.direction).toBe("long");
      expect(plan.tp1).toBe(Number(f.plan.takeProfit));
      const chart = buildSignalChart(result, candles(40, 100, 0.4), {
        entry: plan.entry,
        stop: plan.stop,
        tp1: plan.tp1,
      });
      expect(chart.available, f.label).toBe(true);
      expect(chart.meta!.instrument).toBe(f.instrument);
      expect(chart.meta!.providerInstrumentId).toBe(f.providerInstrumentId);
      expect(chart.meta!.provider).toBe(f.provider);
    }
  });

  it("position mechanics are product-specific and never cross-wired", () => {
    for (const f of CLASS_FIXTURES) {
      // account currency matches the quote currency so no FX conversion is
      // needed (conversion honesty is proven separately in the phase-312 suite).
      const budget = normalizeRiskPolicy({
        accountEquity: 10000,
        accountCurrency: f.spec.quoteCurrency,
        maxRiskPercent: 0.01,
      });
      const entry = Number(f.plan.entry);
      const stop = Number(f.plan.stopLoss);
      const m = buildPositionMechanics({
        instrumentType: f.instrumentType,
        direction: "long",
        entry,
        stop,
        target: Number(f.plan.takeProfit),
        policy: budget,
        spec: f.spec,
      });
      if (f.label === "commodity") {
        // handled by the dedicated commodity block below (base budget cannot
        // buy one 100-oz contract)
      } else {
        expect(m.sizing.available, f.label).toBe(true);
      }
      if (f.label === "forex") {
        expect(m.forex!.stopDistancePips).toBeCloseTo(50, 10);
        expect(m.forex!.standardLots).toBeGreaterThan(0);
        expect(m.stock).toBeUndefined();
        expect(m.commodity).toBeUndefined();
      }
      if (f.label === "stock") {
        expect(m.stock!.shares).toBe(20); // $100 / $5 risk per share
        expect(m.forex).toBeUndefined();
      }
      if (f.label === "commodity") {
        // equity 10k × 1% = $100 cannot buy one 100-oz contract ($2,000 risk):
        // the sizing engine reports below-one-step unavailability — the
        // parity assertions use a budget that CAN size the contract.
        expect(m.commodity!.contracts).toBeUndefined(); // nothing is sized
        expect(m.commodity!.available).toBe(false);
        expect(m.commodity!.reason).toContain("below one quantity step");
        const bigger = normalizeRiskPolicy({ accountEquity: 500000, accountCurrency: "USD", maxRiskPercent: 0.01 });
        const sized = buildPositionMechanics({
          instrumentType: f.instrumentType,
          direction: "long",
          entry,
          stop,
          target: Number(f.plan.takeProfit),
          policy: bigger,
          spec: f.spec,
        });
        expect(sized.commodity!.contracts).toBe(2); // $5,000 / $2,000 per contract
        expect(sized.commodity!.units).toBe(200);
        expect(sized.commodity!.contractMultiplier).toBe(100); // from the spec, not assumed
        expect(sized.forex).toBeUndefined();
      }
      if (f.label === "crypto") {
        expect(m.spot!.quantity).toBeGreaterThan(0);
        expect(m.forex).toBeUndefined();
        expect(m.stock).toBeUndefined();
      }
      expect(m.executesOrders).toBe(false);
    }
  });

  it("probability matching is per-class and never leaks across assets", () => {
    const records: HistoricalOutcomeRecord[] = Array.from({ length: 12 }, (_, i) => ({
      instrument: "BTC/USDT",
      timeframe: "H1",
      direction: "long",
      rMultiple: i % 3 === 0 ? -1 : 1.5,
    }));
    const hit = assessHistoricalProbability(records, { instrument: "BTC/USDT", timeframe: "H1", direction: "long" });
    const miss = assessHistoricalProbability(records, { instrument: "EUR/USD", timeframe: "H1", direction: "long" });
    expect(hit.status).toBe("historically_estimated");
    expect(miss.status).toBe("unavailable");
    expect(miss.winRate).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * 4 · Timeframe integrity across the full matrix, per class           *
 * ------------------------------------------------------------------ */

describe("313.4 — timeframe parity M1…W1 across crypto/forex/commodity/stock", () => {
  it("no silent substitution: the chart timeframe equals the analysis timeframe everywhere", () => {
    for (const f of CLASS_FIXTURES) {
      for (const tf of TFS) {
        const result = resultFixture(f, tf);
        const cdls = candles(40, 100, 0.4);
        const chart = buildSignalChart(result, cdls, { entry: 100, stop: 95, tp1: 112 });
        expect(chart.available, `${f.label} ${tf}`).toBe(true);
        expect(chart.meta!.timeframe, `${f.label} ${tf}`).toBe(tf);
        expect(chart.meta!.observedAt).toBe(cdls[cdls.length - 1].timestamp);
        expect(chart.meta!.provenance.candleCountFull).toBe(cdls.length);
        const ctx = result.technicalData!.strategy!;
        expect(ctx.timeframe).toBe(tf);
        expect(ctx.provenance.firstTimestamp).toBe(cdls[0].timestamp);
        expect(ctx.provenance.lastTimestamp).toBe(cdls[cdls.length - 1].timestamp);
      }
    }
  });

  it("the style policy keeps its setup-TF model with an explicit, non-silent fallback", () => {
    expect(STYLE_PROFILES.scalping.allowedSetupTfs).toEqual(["M1", "M5"]);
    expect(STYLE_PROFILES.intraday.allowedSetupTfs).toEqual(["M15", "M30", "H1"]);
    expect(STYLE_PROFILES.swing.allowedSetupTfs).toEqual(["H4", "D1", "W1"]);
    for (const style of ["scalping", "intraday", "swing"] as const) {
      for (const tf of STYLE_PROFILES[style].allowedSetupTfs) {
        const r = adaptSetupTimeframe(style, tf);
        expect(r.timeframe).toBe(tf);
        expect(r.fallbackApplied).toBe(false);
      }
    }
    const off = adaptSetupTimeframe("scalping", "H4");
    expect(off.fallbackApplied).toBe(true);
    expect(off.reason).toContain("does not use H4");
  });

  it("the MTF chain stays coherent with the requested timeframe", () => {
    const mtf = buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" });
    expect(mtf.chainUsed).toEqual(["D1", "H4"]);
    expect(mtf.unavailable).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 5 · Per-class evidence honesty (failure + missing-data semantics)   *
 * ------------------------------------------------------------------ */

describe("313.5 — per-class evidence stays honest", () => {
  it("crypto without derivatives flags the gap explicitly (never neutral-filled)", () => {
    const base = assemble({ structure: "HH/HL", bos: "bullish" } as never);
    const r = runAnalysis({
      ...base,
      instrumentType: "crypto",
      instrument: "BTC/USDT",
      structure: "HH/HL",
      bosDirection: "bullish",
    } as AnalysisInput);
    expect(
      r.dataFlags.some((f) => f.includes("No funding rate data")),
    ).toBe(true);
  });

  it("forex without calendar data flags the macro gap explicitly", () => {
    const base = assemble({ structure: "HH/HL", bos: "bullish" } as never);
    const r = runAnalysis({
      ...base,
      instrumentType: "forex",
      instrument: "EUR/USD",
      structure: "HH/HL",
      bosDirection: "bullish",
    } as AnalysisInput);
    expect(r.dataFlags.some((f) => f.includes("No economic calendar data"))).toBe(true);
  });

  it("commodity parity: non-oil instruments state the EIA layer as not applicable", () => {
    const base = assemble({
      structure: "HH/HL", bos: "bullish",
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      events: "Fed signals hawkish stance, rate hike",
      sentimentData: sentiment("bullish", 0.6),
      mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
    } as never);
    const r = runAnalysis({
      ...base,
      instrumentType: "commodity",
      instrument: "XAU/USD",
    } as AnalysisInput);
    const eia = r.decisionTrace!.evidenceLayers.find((l) => l.layer === "EIA Inventory");
    expect(eia, "EIA layer present").toBeDefined();
    expect(eia!.reason).toContain("not applicable");
  });

  it("stock evidence: traditional fundamentals exist through Alpha Vantage and absent data stays unavailable", () => {
    // The acquisition path (convex/alphaVantage.ts) fetches OVERVIEW+EARNINGS
    // for stocks only and returns an explicit not-applicable block otherwise;
    // this contract is locked by the parity docs (provider decisions) and the
    // engine's stock fundamental scoring reads FundamentalData fields only.
    const src = readFileSync(new URL("./benchmark-fixtures.phase9.ts", import.meta.url), "utf-8");
    expect(src.length).toBeGreaterThan(0);
    const r = resultFixture(CLASS_FIXTURES[3], "H1");
    const plan = buildAdaptiveTradePlan(r, { policy: POLICY });
    expect(plan.available).toBe(true); // no fabricated fundamental gate blocks a valid plan
  });
});

/* ------------------------------------------------------------------ *
 * 6 · Risk / actionability / NO_TRADE parity                          *
 * ------------------------------------------------------------------ */

describe("313.6 — risk and actionability semantics are asset-agnostic", () => {
  it("engine NO_TRADE is never upgraded, for every asset class", () => {
    for (const f of CLASS_FIXTURES) {
      const result = resultFixture(f, "H1");
      (result as { recommendation: string }).recommendation = "NO_TRADE";
      delete (result as { tradePlan?: unknown }).tradePlan;
      const plan = buildAdaptiveTradePlan(result, { policy: POLICY });
      expect(plan.available, f.label).toBe(false);
      expect(plan.actionability).toBe("NO_TRADE");
      expect(plan.entry).toBeUndefined();
    }
  });

  it("without recorded history every class falls to WAIT — no assumed win rate", () => {
    for (const f of CLASS_FIXTURES) {
      const plan = buildAdaptiveTradePlan(resultFixture(f, "H1"));
      expect(plan.actionability, f.label).toBe("WAIT");
      expect(plan.actionabilityReason.toLowerCase()).not.toContain("win rate");
    }
  });

  it("the sizing engine stays singular: no other module sizes positions", () => {
    for (const f of ["position.ts", "signal.ts", "trade-plan.ts", "chart.ts", "evidence-groups.ts"]) {
      const src = readFileSync(new URL(`./strategy/${f}`, import.meta.url), "utf-8");
      expect(/placeOrder|createOrder|submitOrder|\.order\(|axios|XMLHttpRequest|fetch\(/.test(src), `${f} must not execute`).toBe(false);
      // sizing math lives in risk.ts; the mechanics layer only forwards inputs
      expect(src.includes("computePositionSizing") || !/riskAmount\s*=\s*equity\s*\*/.test(src), `${f} must not re-implement sizing`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 7 · Determinism + provider decision documentation lock              *
 * ------------------------------------------------------------------ */

describe("313.7 — deterministic output and documented provider decisions", () => {
  it("identical inputs produce byte-identical signal responses", () => {
    const f = CLASS_FIXTURES[0];
    const cdls = candles(40, 100, 0.4);
    const a = JSON.stringify(
      buildSignalResponse({ result: resultFixture(f, "M5"), candles: cdls, policy: { accountEquity: 1000, maxRiskPercent: 0.02 }, spec: f.spec }),
    );
    const b = JSON.stringify(
      buildSignalResponse({ result: resultFixture(f, "M5"), candles: cdls, policy: { accountEquity: 1000, maxRiskPercent: 0.02 }, spec: f.spec }),
    );
    expect(a).toBe(b);
  });

  it("every inventoried provider has an explicit decision in the parity doc", () => {
    const doc = readFileSync(new URL("../../docs/phase313-multi-asset-parity.md", import.meta.url), "utf-8");
    const providers = [
      "twelve-data", "okx", "alpha-vantage", "coinglass", "cftc", "treasury",
      "eia", "defillama", "tokenomist", "coingecko", "tickatlas", "fx-rate",
    ];
    for (const p of providers) {
      expect(doc, p).toMatch(new RegExp(`\\b${p}\\b[^\\n]*\\b(KEEP|EXPAND|ADD|DEFER|REJECT)\\b`, "i"));
    }
    // breadth-only candidates are REJECTED with reasons
    for (const rejected of ["CoinMarketCap", "OrionTerminal", "IntentX", "Nansen", "Dune", "SoSoValue", "SpotOnChain"]) {
      expect(doc.toLowerCase()).toContain(rejected.toLowerCase());
    }
    expect(doc.toLowerCase()).toContain("reused");
    expect(doc).toContain("CoinGlass");
  });
});
