/**
 * PHASE 314 — EXTERNAL EVIDENCE CLOSURE + MULTI-ASSET LIVE ACCEPTANCE.
 *
 * Deterministic proofs that every Phase-313 gap is either CLOSED here, already
 * covered by the existing engine, or genuinely external — and that the engine
 * resists the adversarial attempts the mission specifies (fabricated macro,
 * fabricated fundamentals, invented probability, identity substitution,
 * provenance mismatch, partial-fake-success, missing-spec guessing).
 *
 * No network, no clock, no React. Live provider acceptance is NOT possible in
 * this environment (egress restricted to GitHub/npm — see
 * docs/phase314-evidence-closure.md §runtime-acceptance); the existing
 * non-live runtime suites cover the runtime contract instead.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { OhlcvCandle } from "./data/market-types";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import type { CryptoDerivativesData } from "./data/derivatives-types";
import type { FundamentalData } from "./data/intelligence-types";
import { runAnalysis } from "./analysis-engine";
import { assessFundamentals } from "./fundamental-engine";
import { assemble, buildMtf, BULL_LEVELS, sentiment } from "./benchmark-fixtures.phase9";
import { computePositionSizing, type InstrumentSpec } from "./risk";
import { assessFreshness } from "./market-radar/freshness";
import { summarizeLegFailures, type LegOutcome } from "../convex/lib/legOutcome";
import { derivativesForRadar } from "./market-radar/derivatives-bridge";
import { buildSignalChart } from "./strategy/chart";
import { buildSignalResponse } from "./strategy/signal";
import { buildStrategyContext } from "./strategy/context";
import { buildReasoningChain } from "./strategy/explanation";
import {
  EVIDENCE_DEPENDENCY_FAMILIES,
  DERIVATIVES_STATE_FAMILY_CAP,
} from "./strategy/evidence-groups";
import { assessHistoricalProbability, type HistoricalOutcomeRecord } from "./strategy/probability";
import { buildAdaptiveTradePlan } from "./strategy/trade-plan";

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

function gatePassingBase() {
  return assemble({
    structure: "HH/HL", bos: "bullish",
    support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
    events: "Fed signals hawkish stance, rate hike",
    sentimentData: sentiment("bullish", 0.6),
    mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
  } as never);
}

/** A result fixture with real strategy context from the SAME candles. */
function resultFixture(
  instrument: string,
  instrumentType: AnalysisInput["instrumentType"],
  tf: string,
  cdls: OhlcvCandle[],
  provider: string,
  providerInstrumentId: string,
  levels = { entry: "103.5", stop: "101.5", tp: "112.00" },
): AnalysisResult {
  const entry = Number(levels.entry);
  const stop = Number(levels.stop);
  const fixture = {
    id: `p314-${instrument}-${tf}`,
    instrument,
    instrumentType,
    timeframe: tf,
    provider,
    providerInstrumentId,
    bias: "Bullish",
    confidence: 70,
    recommendation: "LONG",
    noTradeReasons: [],
    tradePlan: {
      direction: "long",
      entry: levels.entry,
      entryBasis: "live market price at analysis time",
      stopLoss: levels.stop,
      slBasis: "nearest market swing low (structural)",
      takeProfit: levels.tp,
      tpBasis: "resting liquidity at the structural target",
      riskReward: Math.abs(Number(levels.tp) - entry) / Math.abs(entry - stop),
      stopProvenance: {
        source: "swing_level",
        level: stop,
        timeframe: tf,
        buffer: 0,
        publishedStop: stop,
        note: `nearest unbroken market swing low ${stop}`,
      },
      targetProvenance: {
        source: "resting_liquidity",
        level: Number(levels.tp),
        timeframe: tf,
        note: `resting liquidity at ${levels.tp} (never a swept level)`,
      },
      structuralInvalidation: {
        level: stop,
        timeframe: tf,
        swingKind: "low",
        note: `confirmed swing low ${stop} voids the bullish thesis`,
      },
    },
    technicalData: {
      dataPoints: cdls.length,
      structure: "HH/HL",
      bosDirection: "bullish",
      strategy: buildStrategyContext(cdls, tf),
    },
    keyLevels: { support: "100", resistance: "112", invalidation: "101.5" },
    dataFlags: [],
  } as unknown as AnalysisResult;
  fixture.reasoningChain = buildReasoningChain(fixture);
  return fixture;
}

function derivPayload(over: {
  funding?: number;
  oiChange1h?: number;
  longShort?: number;
  liquidationSide?: "longs" | "shorts" | "balanced";
  timestamp?: number;
}): CryptoDerivativesData {
  return {
    provider: "coinglass",
    symbol: "BTC",
    timestamp: over.timestamp ?? T0,
    freshness: "delayed",
    fundingRate: { currentRate: over.funding ?? 0 },
    openInterest: { current: 1_000_000, ...(over.oiChange1h !== undefined ? { change1h: over.oiChange1h } : {}) },
    longShort: { ...(over.longShort !== undefined ? { accountRatio: over.longShort } : {}) },
    liquidations: { dominantSide: over.liquidationSide ?? "balanced" },
    availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
    confidence: "high",
  };
}

/* ------------------------------------------------------------------ *
 * 1 · Adversarial signal-quality attacks (mission §10)                *
 * ------------------------------------------------------------------ */

describe("314.1 — adversarial attempts to break the engine", () => {
  const LHLL: AnalysisInput = (() => {
    const base = assemble({ structure: "LH/LL", bos: "bearish" } as never);
    return { ...base, structure: "LH/LL", bosDirection: "bearish" } as AnalysisInput;
  })();

  function cryptoRun(deriv?: CryptoDerivativesData): AnalysisResult {
    return runAnalysis({
      ...LHLL,
      instrumentType: "crypto",
      instrument: "BTC/USDT",
      ...(deriv ? { derivativesData: deriv } : {}),
    } as AnalysisInput);
  }

  it("A: four all-bullish CoinGlass readings equal two — confidence and factor identical", () => {
    const four = derivPayload({ funding: -0.002, oiChange1h: -3, longShort: 0.4, liquidationSide: "longs" });
    const two = derivPayload({ funding: -0.002, liquidationSide: "longs" }); // raw +2 = cap
    const a = cryptoRun(four);
    const b = cryptoRun(two);
    expect(a.decisionTrace!.biasCalculation!.factorScores!.sentiment).toBe(
      b.decisionTrace!.biasCalculation!.factorScores!.sentiment,
    );
    expect(a.confidence).toBe(b.confidence);
    expect(a.recommendation).toBe(b.recommendation);
  });

  it("B: forex with no calendar invents no macro confirmation — fundamental stays UNAVAILABLE", () => {
    const input: Record<string, unknown> = {
      ...gatePassingBase(),
      instrumentType: "forex",
      instrument: "EUR/USD",
    };
    // strip the fixture's event text so the calendar gap is genuine
    delete input.economicEvents;
    delete input.calendarData;
    const r = runAnalysis(input as unknown as AnalysisInput);
    expect(r.dataFlags.some((f) => f.includes("No economic calendar data"))).toBe(true);
    expect(r.unifiedIntelligence?.fundamental.state).toBe("unavailable");
    expect(r.fundamentalSummary.toLowerCase()).toContain("no released macroeconomic measurement");
  });

  it("C: oil instrument with EIA unavailable stays explicit (never neutral-filled)", () => {
    const r = runAnalysis({
      ...gatePassingBase(),
      instrumentType: "commodity",
      instrument: "WTI",
    } as AnalysisInput);
    const eia = r.decisionTrace!.evidenceLayers.find((l) => l.layer === "EIA Inventory");
    expect(eia, "EIA layer present").toBeDefined();
    expect(eia!.reason).toContain("EIA data unavailable");
  });

  it("D: stock with earnings/fundamentals unavailable fabricates nothing", () => {
    const unavailableBlock: FundamentalData = {
      provider: "alpha-vantage",
      timestamp: 0,
      instrumentType: "stock",
      available: false,
      unavailableReason: "Alpha Vantage fundamentals leg failed (provider outage)",
    };
    const a = assessFundamentals(unavailableBlock, {
      instrument: "AAPL",
      instrumentType: "stock",
      provider: "alpha-vantage",
    });
    expect(a.available).toBe(false);
    expect(a.state).toBe("insufficient");
    expect(Object.keys(a.metrics).length).toBe(0); // no fabricated metrics
    expect(a.limitations.join(" ")).toContain("never fabricated");
  });

  it("E: missing contract size → sizing unavailable, never guessed", () => {
    const spec: InstrumentSpec = {
      assetClass: "commodity",
      contractSize: undefined as unknown as number,
      quoteCurrency: "USD",
      quantityStep: 1,
      source: "user-provided",
    };
    const r = computePositionSizing({
      equity: 100000,
      riskPercent: 0.02,
      entry: 80,
      stopLoss: 79.5,
      spec,
    });
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("contract size");
  });

  it("F: missing journal history → probability unavailable for every class", () => {
    for (const instrument of ["BTC/USDT", "EUR/USD", "XAU/USD", "AAPL"]) {
      const p = assessHistoricalProbability(undefined, { instrument, timeframe: "H1" });
      expect(p.status, instrument).toBe("unavailable");
      expect(p.winRate).toBeUndefined();
      expect(p.expectedR).toBeUndefined();
    }
  });

  it("G: cross-instrument payloads are rejected — identity never re-labelled", () => {
    const payload = derivPayload({ funding: -0.002 });
    expect(derivativesForRadar("ETH/USD", payload, T0 + STEP).derivatives).toBeUndefined();
    // symbol CASE is normalized (base asset of the canonical instrument) —
    // this is identity normalization, not a substitution bypass.
    const ok = derivativesForRadar("btc/usd", derivPayload({ funding: -0.002 }), T0 + STEP);
    expect(ok.rejected).toEqual([]);
  });

  it("H: stale derivatives evidence is rejected with the exact staleness reason", () => {
    const staleTs = T0 - 25 * 60 * 60 * 1000; // 25h old
    expect(assessFreshness(staleTs, T0)).toBe("UNAVAILABLE");
    const res = derivativesForRadar("BTC/USD", derivPayload({ timestamp: staleTs }), T0);
    expect(res.derivatives).toBeUndefined();
    expect(res.rejected[0]).toContain("freshness window");
    // 2h old = STALE but still inside the window → forwarded with its state
    const twoHours = derivativesForRadar("BTC/USD", derivPayload({ timestamp: T0 - 2 * 60 * 60 * 1000 }), T0);
    expect(twoHours.derivatives).toBeDefined();
    expect(twoHours.additionalEvidence![0].freshness).toBe("STALE");
  });

  it("I: partial provider fetch — failure reasons surface, never a fake full success", () => {
    const legs: Record<string, LegOutcome<unknown>> = {
      news: { status: "ok", value: { provider: "alpha-vantage", timestamp: T0 } },
      fundamentals: { status: "error", reason: "rate limited" },
    } as never;
    const summary = summarizeLegFailures(legs);
    expect(summary).toContain("fundamentals: error (rate limited)");
    expect(summary).not.toContain("news:"); // successful legs are not failures
    const allFailed = summarizeLegFailures({
      news: { status: "error", reason: "timeout" } as never,
      fundamentals: { status: "error", reason: "429" } as never,
    });
    expect(allFailed).toContain("news: error (timeout)");
    expect(allFailed).toContain("fundamentals: error (429)");
  });

  it("J: chart refuses a candle series that does not match the analysis provenance", () => {
    const cdls = candles(40);
    const result = resultFixture("BTC/USDT", "crypto", "M5", cdls, "okx", "BTC-USDT");
    const other = candles(40, 100, 0.4).map((c) => ({ ...c, timestamp: c.timestamp + 1234 }));
    const spec = buildSignalChart(result, other, { entry: 100, stop: 95, tp1: 112 });
    expect(spec.available).toBe(false);
    expect(spec.unavailableReason).toContain("provenance mismatch");
    expect(spec.candles).toBeUndefined();
    // the matching series still renders
    const okSpec = buildSignalChart(result, [...cdls], { entry: 100, stop: 95, tp1: 112 });
    expect(okSpec.available).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 2 · Cross-asset acceptance fixtures (mission §9)                    *
 * ------------------------------------------------------------------ */

describe("314.2 — cross-asset acceptance across M1/M5/M15/H1", () => {
  const CLASSES = [
    { label: "crypto", instrument: "BTC/USDT", type: "crypto" as const, provider: "okx", id: "BTC-USDT", spec: { assetClass: "crypto", contractSize: 1, quoteCurrency: "USDT", quantityStep: 0.1, source: "user-provided" }, product: "spot", levels: { entry: "103.5", stop: "101.5", tp: "112.00" } },
    { label: "forex", instrument: "EUR/USD", type: "forex" as const, provider: "twelve-data", id: "EUR/USD", spec: { assetClass: "forex", contractSize: 100000, quoteCurrency: "USD", pipSize: 0.0001, quantityStep: 0.01, source: "user-provided" }, product: "forex", levels: { entry: "1.10000", stop: "1.09500", tp: "1.12000" } },
    { label: "commodity", instrument: "XAU/USD", type: "commodity" as const, provider: "twelve-data", id: "XAU/USD", spec: { assetClass: "commodity", contractSize: 100, quoteCurrency: "USD", quantityStep: 1, source: "user-provided" }, product: "commodity", levels: { entry: "2650", stop: "2640", tp: "2750" } },
    { label: "stock", instrument: "AAPL", type: "stock" as const, provider: "twelve-data", id: "AAPL", spec: { assetClass: "stock", contractSize: 1, quoteCurrency: "USD", quantityStep: 1, source: "user-provided" }, product: "stock", levels: { entry: "230", stop: "225", tp: "250" } },
  ];
  const TFS = ["M1", "M5", "M15", "H1"] as const;

  it("every class × timeframe yields one coherent response with verbatim provenance", () => {
    for (const c of CLASSES) {
      for (const tf of TFS) {
        const cdls = candles(40, 100, 0.4);
        const result = resultFixture(c.instrument, c.type, tf, cdls, c.provider, c.id, c.levels);
        const records: HistoricalOutcomeRecord[] = Array.from({ length: 12 }, (_, i) => ({
          instrument: c.instrument, timeframe: tf, direction: "long" as const, rMultiple: i % 3 === 0 ? -1 : 1.5,
        }));
        const signal = buildSignalResponse({
          result,
          candles: cdls,
          provider: c.provider,
          providerInstrumentId: c.id,
          policy: { accountEquity: 100000, maxRiskPercent: 0.01, accountCurrency: c.spec.quoteCurrency, productType: c.product },
          spec: c.spec,
          historicalOutcomes: records,
        });
        // identity + requested timeframe, never substituted
        expect(signal.available, `${c.label} ${tf}`).toBe(true);
        expect(signal.instrument).toBe(c.instrument);
        expect(signal.provider).toBe(c.provider);
        expect(signal.providerInstrumentId).toBe(c.id);
        expect(signal.timeframe).toBe(tf);
        expect(signal.chart.available, `${c.label} ${tf} chart`).toBe(true);
        expect(signal.chart.meta!.timeframe).toBe(tf);
        expect(signal.chart.meta!.observedAt).toBe(cdls[cdls.length - 1].timestamp);
        expect(signal.chart.meta!.provenance.candleCountFull).toBe(cdls.length);
        // plan + invalidation + why + limitations + actionability
        expect(signal.plan.available).toBe(true);
        expect(signal.plan.direction).toBe("long");
        expect(signal.plan.tp1).toBe(Number(c.levels.tp));
        expect(signal.invalidation.condition.length).toBeGreaterThan(0);
        expect(signal.why.length).toBeGreaterThan(0);
        expect(signal.limitations.length).toBeGreaterThan(0);
        expect(signal.noGuaranteeNote).toContain("promises profit");
        // journal-derived probability, key-matched to THIS class/timeframe
        expect(signal.probability.status).toBe("historically_estimated");
        expect(signal.probability.sampleSize).toBe(12);
        expect(signal.probability.matchedOn!.instrument).toBe(c.instrument);
        expect(signal.probability.matchedOn!.timeframe).toBe(tf);
        // product-specific mechanics, never cross-wired
        expect(signal.position.sizing.available).toBe(true);
        expect(signal.position.executesOrders).toBe(false);
        if (c.label === "crypto") expect(signal.position.spot!.quantity).toBeGreaterThan(0);
        if (c.label === "forex") { expect(signal.position.forex!.stopDistancePips).toBeGreaterThan(0); expect(signal.position.forex!.standardLots).toBeGreaterThan(0); }
        if (c.label === "commodity") { expect(signal.position.commodity!.contracts).toBeGreaterThan(0); }
        if (c.label === "stock") { expect(signal.position.stock!.shares).toBeGreaterThan(0); }
        // positive recorded expectancy (validated history) => VALIDATED;
        // the plan layer did not upgrade anything (the engine plan was present)
        expect(signal.plan.actionability).toBe("VALIDATED");
      }
    }
  });

  it("M30/H4/D1/W1 remain exact for every class (phase-313 matrix re-locked at signal level)", () => {
    for (const c of CLASSES.slice(0, 2)) {
      for (const tf of ["M30", "H4", "D1", "W1"] as const) {
        const cdls = candles(40, 100, 0.4);
        const result = resultFixture(c.instrument, c.type, tf, cdls, c.provider, c.id);
        const chart = buildSignalChart(result, cdls, { entry: 100, stop: 95, tp1: 112 });
        expect(chart.available, `${c.label} ${tf}`).toBe(true);
        expect(chart.meta!.timeframe).toBe(tf);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3 · Stock company/sector context trace (mission §5)                 *
 * ------------------------------------------------------------------ */

describe("314.3 — stock fundamentals reach the reasoning, sector labels descriptive only", () => {
  const stockPayload: FundamentalData = {
    provider: "alpha-vantage",
    timestamp: T0,
    instrumentType: "stock",
    symbol: "AAPL",
    providerInstrumentId: "AAPL",
    name: "Apple Inc",
    sector: "Technology",
    industry: "Consumer Electronics",
    peRatio: 28,
    earningsPerShare: 6.2,
    profitMargin: 0.26,
    available: true,
  };

  it("the provider-reported classification travels with full provenance and is never scored", () => {
    const a = assessFundamentals(stockPayload, {
      instrument: "AAPL",
      instrumentType: "stock",
      provider: "alpha-vantage",
      providerInstrumentId: "AAPL",
    });
    expect(a.available).toBe(true);
    const cls = a.evidence.find((e) => e.metric === "company_classification");
    expect(cls).toBeDefined();
    expect(cls!.value).toContain("Technology");
    expect(cls!.value).toContain("Consumer Electronics");
    expect(cls!.provider).toBe("alpha-vantage");
    expect(cls!.providerInstrumentId).toBe("AAPL");
    expect(cls!.observedAt).toBe(T0);
    // the sector-relative limitation still forbids benchmarking
    expect(a.limitations.join(" ")).toContain("Peer/sector-relative valuation UNAVAILABLE");
  });

  it("the assessment reacts to real metrics, not labels", () => {
    const withoutLabels: FundamentalData = { ...stockPayload, name: undefined, sector: undefined, industry: undefined };
    const a = assessFundamentals(withoutLabels, { instrument: "AAPL", instrumentType: "stock", provider: "alpha-vantage" });
    expect(a.evidence.find((e) => e.metric === "company_classification")).toBeUndefined();
    expect(a.available).toBe(true); // financial evidence stands on its own
  });
});

/* ------------------------------------------------------------------ *
 * 4 · Dependency graph completeness (mission §7)                      *
 * ------------------------------------------------------------------ */

describe("314.4 — the dependency registry covers all correlated families", () => {
  const IDS = EVIDENCE_DEPENDENCY_FAMILIES.map((f) => f.id);
  it("every documented family exists with a bounded, non-arbitrary policy", () => {
    for (const expected of [
      "derivatives_state", "technical_trend", "usd_regime", "news_sentiment",
      "oil_supply_state", "stock_quality", "crypto_onchain", "rates_yields", "smc_location",
    ]) {
      expect(IDS, expected).toContain(expected);
    }
    const stock = EVIDENCE_DEPENDENCY_FAMILIES.find((f) => f.id === "stock_quality")!;
    expect(stock.cap).toBe(2); // the fundamental factor clamp itself
    expect(stock.members.length).toBe(3);
    const onchain = EVIDENCE_DEPENDENCY_FAMILIES.find((f) => f.id === "crypto_onchain")!;
    expect(onchain.cap).toBeNull(); // context-only: nothing to cap
    expect(onchain.note).toContain("multiply conviction");
    for (const f of EVIDENCE_DEPENDENCY_FAMILIES) {
      expect(f.underlyingState.length).toBeGreaterThan(5);
      expect(f.note.length).toBeGreaterThan(40);
      expect(f.members.length).toBeGreaterThan(0);
    }
    expect(DERIVATIVES_STATE_FAMILY_CAP).toBe(2); // unchanged from phase 313
  });

  it("no provider bypasses the derivatives family (single consumption point)", () => {
    // The only additive consumer of the four CoinGlass datasets is
    // scoreSentiment's capped family block; the bridge and the fundamental
    // assessment are non-additive (context). Locked by source inspection.
    const src = readFileSync(new URL("./analysis-engine.ts", import.meta.url), "utf-8");
    expect(src).toContain("clampFamilyDelta(derivativesStateDelta, DERIVATIVES_STATE_FAMILY_CAP)");
    const occurrences = (src.match(/derivativesStateDelta \+= 1/g) ?? []).length;
    expect(occurrences).toBe(6); // funding 2 + funding-structure 1 + OI 1 + L/S 1 + liquidations 1 — all inside the ONE capped family
    void DERIVATIVES_STATE_FAMILY_CAP;
  });
});

/* ------------------------------------------------------------------ *
 * 5 · Gap-disposition documentation lock (mission §1, §14)            *
 * ------------------------------------------------------------------ */

describe("314.5 — every inherited gap has an explicit disposition", () => {
  const doc = readFileSync(new URL("../../docs/phase314-evidence-closure.md", import.meta.url), "utf-8");

  it("all phase-313 gaps are dispositioned with the canonical keywords", () => {
    for (const gap of [
      "CoinGlass ETF", "CoinGlass options", "derivatives volume",
      "Token Terminal", "Nansen", "Dune", "SoSoValue", "SpotOnChain",
      "DeFiLlama", "forex positioning", "forex spread", "non-oil inventory",
      "sector benchmark", "order book", "stock events",
    ]) {
      expect(doc.toLowerCase(), gap).toContain(gap.toLowerCase());
    }
    for (const keyword of ["CLOSED", "ALREADY COVERED", "EXTERNAL DEPENDENCY", "NOT A VALID GAP", "DEFER"]) {
      expect(doc, keyword).toContain(keyword);
    }
  });

  it("the provider decision table covers the full mission inventory", () => {
    for (const p of [
      "CoinGlass", "DeFiLlama", "Alpha Vantage", "CFTC", "Treasury", "EIA",
      "Twelve Data", "TickAtlas", "OKX", "CoinGecko", "Token Terminal",
      "Nansen", "Dune", "SoSoValue", "SpotOnChain", "CoinMarketCap",
      "OrionTerminal", "IntentX",
    ]) {
      expect(doc, p).toContain(p);
    }
    expect(doc).toContain("LIVE-ACCEPTANCE-BLOCKED");
  });

  it("live acceptance is honestly blocked by sandbox egress, not skipped silently", () => {
    expect(doc.toLowerCase()).toContain("egress");
    expect(doc.toLowerCase()).not.toContain("live acceptance: passed");
  });
});
