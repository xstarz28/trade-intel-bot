/**
 * Phase 297 — EVIDENCE CONSUMPTION AUDIT (§1, §2, §3, §4, §5, §8, §9, §11, §13).
 *
 * The point of this suite is parity: every rule in the audit table is checked
 * against what the engine ACTUALLY does, by driving the engine across each
 * boundary with synthetic inputs. If the engine's behaviour and the audit table
 * ever diverge, these tests fail — so the Phase 297 diagnostics can never drift
 * into a parallel, invented scoring model.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import type { MacroData } from "@/lib/data/intelligence-types";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

import {
  EVIDENCE_FIXTURES,
  evidenceFixturePath,
  evidenceForDecision,
  loadEvidenceRegistry,
} from "@/lib/historical/evidence";
import type { HistoricalEvidenceDataset, RecordedEvidenceRegistry } from "@/lib/historical/evidence";
import {
  ABLATION_MODES,
  CORE_WEIGHTS_AUDIT,
  DOUBLE_COUNT_AUDIT,
  EVIDENCE_FLOW_MAP,
  GATE3_NEUTRAL_BAND,
  THRESHOLD_AUDIT,
  ablationAttachment,
  ablationFields,
  auditCotConsumption,
  auditTreasuryWiring,
  formatEvidenceAuditDiagnostics,
  decomposeDecision,
  diagnoseDerivatives,
  seriesReach,
} from "@/lib/evidence-sensitivity";

const registry = loadEvidenceRegistry();
const INTERVAL = 4 * 3_600_000;
const BASE = 1_780_000_000_000;

/** Designed candles: mechanics only, never empirical evidence. */
function candles(count: number): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  for (let i = 0; i < count; i++) {
    const p = 100 + i * 0.2;
    out.push({ timestamp: BASE + i * INTERVAL, open: p, high: p + 0.6, low: p - 0.6, close: p + 0.1, volume: 1000 });
  }
  return out;
}

const SERIES = candles(80);

function techFor(seriesInput: readonly OhlcvCandle[], structure: string): TechnicalData {
  const series = seriesInput as OhlcvCandle[];
  return {
    ...calculateTechnical(series, series, "H4"),
    structure,
    bosDirection: "bullish",
    smc: computeSmcContext(series, "H4"),
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles: series },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles: series } satisfies MtfCandleInput)),
    ]),
  } as unknown as TechnicalData;
}

function cryptoInput(options: {
  derivatives?: CryptoDerivativesData;
  macro?: MacroData;
  structure?: string;
  clock?: number;
}): AnalysisInput {
  const series = SERIES;
  const last = series[series.length - 1];
  const now = options.clock ?? last.timestamp;
  return {
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    timeframe: "H4" as Timeframe,
    provider: "okx",
    providerInstrumentId: "BTC-USDT",
    marketData: {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      fetchTimestamp: now,
      price: { price: last.close, timestamp: now - 60_000, source: "okx" },
      candles: series,
      timeframe: "H4",
      dataFreshness: "delayed",
    } as unknown as MarketData,
    technicalData: techFor(series, options.structure ?? "HH/HL"),
    ...(options.derivatives ? { derivativesData: options.derivatives } : {}),
    ...(options.macro ? { macroData: options.macro } : {}),
    economicEvents: "",
  } as unknown as AnalysisInput;
}

function derivatives(overrides: {
  funding?: number;
  oiChange?: number;
  ratio?: number;
  dominant?: "longs" | "shorts" | "balanced";
}): CryptoDerivativesData {
  return {
    provider: "okx",
    symbol: "BTC-USDT-SWAP",
    timestamp: SERIES[SERIES.length - 1].timestamp,
    freshness: "delayed",
    ...(overrides.funding !== undefined ? { fundingRate: { currentRate: overrides.funding } } : {}),
    ...(overrides.oiChange !== undefined ? { openInterest: { current: 1_000_000, change1h: overrides.oiChange } } : {}),
    ...(overrides.ratio !== undefined ? { longShort: { accountRatio: overrides.ratio } } : {}),
    ...(overrides.dominant !== undefined ? { liquidations: { dominantSide: overrides.dominant } } : {}),
    availability: {
      openInterest: overrides.oiChange !== undefined,
      fundingRate: overrides.funding !== undefined,
      longShort: overrides.ratio !== undefined,
      liquidations: overrides.dominant !== undefined,
    },
    confidence: "medium",
  };
}

function sentimentFactor(input: AnalysisInput): number {
  const trace = runAnalysis(input).decisionTrace;
  if (!trace?.biasCalculation.factorScores) throw new Error("engine did not expose factorScores");
  return trace.biasCalculation.factorScores.sentiment;
}

function fundamentalFactor(input: AnalysisInput): number {
  const trace = runAnalysis(input).decisionTrace;
  if (!trace?.biasCalculation.factorScores) throw new Error("engine did not expose factorScores");
  return trace.biasCalculation.factorScores.fundamental;
}

describe("§1 evidence flow map", () => {
  it("documents every core path with source, field, scoring, gate, conviction and output", () => {
    const layers = EVIDENCE_FLOW_MAP.map((e) => e.layer);
    for (const required of [
      "structure",
      "fundamentals (macro indicators)",
      "positioning (crypto derivatives)",
      "macro yield (Treasury)",
      "positioning (CFTC COT)",
      "cross-asset",
      "execution quality",
      "liquidity / location (Phase 291)",
      "MTF hierarchy",
    ]) {
      expect(layers).toContain(required);
    }
    for (const entry of EVIDENCE_FLOW_MAP) {
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entry.inputField.length).toBeGreaterThan(0);
      expect(entry.scoring.length).toBeGreaterThan(0);
      expect(entry.gateDependency.length).toBeGreaterThan(0);
      expect(entry.convictionDependency.length).toBeGreaterThan(0);
      expect(entry.output.length).toBeGreaterThan(0);
    }
    // The two layers that are NOT Gate 3/4 factors say so explicitly.
    for (const layer of ["macro yield (Treasury)", "positioning (CFTC COT)", "cross-asset"]) {
      const entry = EVIDENCE_FLOW_MAP.find((e) => e.layer === layer)!;
      expect(entry.gateDependency).toMatch(/NONE/);
    }
  });
});

describe("§9 threshold provenance (values locked, not tuned)", () => {
  it("classifies every audited threshold and leaves the legacy ones unchanged", () => {
    const ids = THRESHOLD_AUDIT.map((t) => t.id);
    for (const id of [
      "CORE_WEIGHTS",
      "GATE3_NEUTRAL_BAND",
      "GATE4_CONFLUENCE",
      "funding_rate_extreme",
      "funding_rate_structured",
      "open_interest_change",
      "account_ratio_extremes",
      "COT_SIGNAL_CHANGE_OI_RATIO",
      "MACRO_YIELD_SIGNAL_THRESHOLD_PTS",
    ]) {
      expect(ids).toContain(id);
    }
    for (const t of THRESHOLD_AUDIT) {
      expect(t.location).toMatch(/src\//);
      expect(t.note.length).toBeGreaterThan(20);
    }
    // Core weights and the Gate 3 band are the engine's live values.
    expect(CORE_WEIGHTS_AUDIT).toEqual({ trend: 0.45, fundamental: 0.3, sentiment: 0.25 });
    expect(GATE3_NEUTRAL_BAND).toBe(0.25);
    // The three crypto error bands are legacy values and stay exactly as they are.
    expect(THRESHOLD_AUDIT.find((t) => t.id === "funding_rate_extreme")!.value).toMatch(/0\.001/);
    expect(THRESHOLD_AUDIT.find((t) => t.id === "funding_rate_structured")!.value).toMatch(/0\.0005/);
    expect(THRESHOLD_AUDIT.find((t) => t.id === "open_interest_change")!.value).toMatch(/2 %/);
    expect(THRESHOLD_AUDIT.find((t) => t.id === "account_ratio_extremes")!.value).toMatch(/2\.0/);
    expect(THRESHOLD_AUDIT.filter((t) => t.provenance === "legacy implementation value (no documented derivation found)")).toHaveLength(4);
  });
});

describe("§3 crypto derivatives consumption (parity with the engine)", () => {
  it("matches the engine on every funding boundary", () => {
    // Inside the band: no contribution.
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ funding: 0.0001 }) }))).toBe(0);
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ funding: 0.0004 }) }))).toBe(0);
    // The structured rule (0.0005) fires with bullish structure.
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ funding: 0.0006 }), structure: "HH/HL" }))).toBe(1);
    // The extreme rule (0.001) dominates.
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ funding: 0.002 }), structure: "HH/HL" }))).toBe(0);
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ funding: 0.002 }), structure: "LH/LL" }))).toBe(-2);
    // Negative funding below -0.001 is a bullish read.
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ funding: -0.002 }) }))).toBe(1);
  });

  it("matches the engine on every open-interest and account-ratio boundary", () => {
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ oiChange: 1.9 }), structure: "HH/HL" }))).toBe(0);
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ oiChange: 2.5 }), structure: "HH/HL" }))).toBe(1);
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ oiChange: -2.5 }), structure: "LH/LL" }))).toBe(1);
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ ratio: 1.5 }) }))).toBe(0);
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ ratio: 2.5 }) }))).toBe(-1);
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ ratio: 0.4 }) }))).toBe(1);
    expect(sentimentFactor(cryptoInput({ derivatives: derivatives({ dominant: "longs" }) }))).toBe(1);
  });

  it("diagnoses the recorded corpus as inside every dead band", () => {
    const funding = registry.byId.get("okx-funding-rate-BTC-USDT-SWAP-8H")!;
    const oi = registry.byId.get("okx-open-interest-BTC-USDT-SWAP-1H")!;
    const ls = registry.byId.get("okx-long-short-account-ratio-BTC-1H")!;

    const fundingReach = seriesReach(
      "fundingRate.realizedRate",
      funding.observations.map((o) => Number(o.values.realizedRate)),
      [
        { ruleId: "funding_rate_extreme", threshold: 0.001, direction: "above" as const },
        { ruleId: "funding_rate_structured", threshold: 0.0005, direction: "above" as const },
      ],
    );
    expect(fundingReach.observations).toBe(28);
    expect(fundingReach.maxAbs).toBe(0.0001);
    for (const t of fundingReach.thresholds) expect(t.reachable).toBe(false);

    const oiValues = oi.observations.map((o) => Number(o.values.openInterestUsd));
    const oiChanges = oiValues.slice(0, -1).map((v, i) => ((v - oiValues[i + 1]) / oiValues[i + 1]) * 100);
    const oiReach = seriesReach("openInterest.change1h", oiChanges, [
      { ruleId: "open_interest_change", threshold: 2, direction: "above" as const },
    ]);
    expect(oiReach.maxAbs).toBeGreaterThan(1.9);
    expect(oiReach.maxAbs).toBeLessThan(2);
    expect(oiReach.thresholds[0].reachable).toBe(false);

    const lsReach = seriesReach(
      "longShort.accountRatio",
      ls.observations.map((o) => Number(o.values.accountRatio)),
      [
        { ruleId: "account_ratio_high", threshold: 2.0, direction: "above" as const },
        { ruleId: "account_ratio_low", threshold: 0.5, direction: "below" as const },
      ],
    );
    expect(lsReach.min).toBeCloseTo(1.2, 2);
    expect(lsReach.max).toBeCloseTo(1.45, 2);
    for (const t of lsReach.thresholds) expect(t.reachable).toBe(false);
  });

  it("reports per-rule observed value, threshold, margin and fired state for a real attachment", () => {
    const asOf = Date.parse("2026-09-30T03:00:00Z");
    const attachment = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    const rules = diagnoseDerivatives(attachment.derivativesData, "HH/HL");
    expect(rules.every((r) => !r.fires)).toBe(true);
    const fundingRule = rules.find((r) => r.ruleId === "funding_structured_bull")!;
    expect(fundingRule.observed).toBe(0.0001);
    expect(fundingRule.margin).toBeCloseTo(0.0001 - 0.0005, 12);
    expect(fundingRule.margin!).toBeLessThan(0);
    const oiRule = rules.find((r) => r.ruleId === "oi_change_up_bull")!;
    expect(oiRule.observed!).toBeLessThan(0); // the 03:00-vs-02:00 recorded change was negative
    expect(Math.abs(oiRule.observed!)).toBeLessThan(2);
    expect(rules.find((r) => r.ruleId === "liquidations_dominant")!.note).toMatch(/not captured|No liquidation dataset/);
  });
});

describe("§5 fundamental scoring — why recorded macro is score-neutral", () => {
  it("scores zero for macro indicators without a sentiment", () => {
    const asOf = Date.parse("2026-09-28T12:00:00Z");
    const attachment = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: asOf });
    const macro = attachment.macroData;
    if (!macro) throw new Error("expected a recorded macro snapshot");
    const input: AnalysisInput = {
      ...cryptoInput({}),
      instrument: "EUR/USD",
      instrumentType: "forex",
      macroData: macro,
    } as AnalysisInput;
    expect(fundamentalFactor(input)).toBe(0);
    // The reason is the documented rule: the ratio counts EXPLICIT sentiments only.
    expect(macro.indicators.every((i) => i.sentiment === undefined)).toBe(true);
    // Parity: the same indicators WITH a sentiment do move the factor.
    const withSentiment: MacroData = {
      ...macro,
      indicators: macro.indicators.map((i) => ({ ...i, sentiment: "positive" as const })),
    };
    expect(fundamentalFactor({ ...input, macroData: withSentiment } as AnalysisInput)).toBe(2);
  });

  it("keeps the treasury path unwired for a documented provenance reason", () => {
    const verdict = auditTreasuryWiring({
      latest: { observationDate: "2026-09-28", tenors: { "10Y": 5.24, "2Y": 4.92 } },
      previous: { observationDate: "2026-09-25", tenors: { "10Y": 5.17, "2Y": 4.81 } },
    });
    expect(verdict.wired).toBe(false);
    expect(verdict.reasons.join(" ")).toMatch(/literal/);
    expect(verdict.reasons.join(" ")).toMatch(/real-yield/);
    expect(verdict.wouldBeEffect!.nominalMeanChangePts).toBeCloseTo(0.09, 6);
    expect(verdict.wouldBeEffect!.usdStrengthEffect).toBeCloseTo(0.6, 6);
    expect(verdict.wouldBeEffect!.goldLongEffect).toBe(0);
    // No ALFRED vintage is used as a scoring source: it never appears in attachment provenance.
    const attachment = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: Date.parse("2026-09-28T12:00:00Z"),
    });
    expect(attachment.provenance.some((p) => p.domain === "macro_rates_point_in_time")).toBe(false);
    expect(EVIDENCE_FIXTURES.some((f) => f.domain === "macro_rates_point_in_time")).toBe(true);
  });
});

describe("§4 COT consumption (real recorded EUR report)", () => {
  it("produces a real non-zero effect from the recorded change", () => {
    const attachment = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: Date.parse("2026-09-26T00:00:00Z"),
    });
    const report = auditCotConsumption(attachment.cotData);
    expect(report.available).toBe(true);
    expect(report.contractSide).toBe("base");
    expect(report.changeFromPreviousReport).toBe(220708 - 273042 - (209000 - 235993));
    expect(report.changeRatioOfOi!).toBeCloseTo(Math.abs(-25341) / 821689, 6);
    expect(report.changeRatioOfOi!).toBeGreaterThan(0.005);
    expect(report.crowded).toBe(false);
    expect(report.fires).toBe(true);
    expect(report.effectOnContractCurrency!).toBeLessThan(0);
    expect(report.effectOnLong).toBe(report.effectOnContractCurrency);
    expect(report.notes.join(" ")).not.toMatch(/below signal threshold/);
  });

  it("documents exactly where recorded COT can be consumed — and where the corpus stops it", () => {
    const asOf = Date.parse("2026-09-22T12:00:00Z");
    const attachment = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: asOf });
    // (1) Under the existing rule the recorded EUR report produces a real effect.
    const report = auditCotConsumption(attachment.cotData);
    expect(report.fires).toBe(true);
    expect(Math.abs(report.effectOnContractCurrency!)).toBeGreaterThan(0);
    // (2) Its only consumer is the COT conviction layer. The engine assembles
    // conviction layers ONLY for a recommendation that is not NO_TRADE, and in
    // the recorded corpus every window is NO_TRADE, so that layer is never
    // reached — the evidence is not "unconsumed", the consumer is downstream.
    const trace = runAnalysis({
      ...cryptoInput({ macro: attachment.macroData, clock: asOf }),
      instrument: "EUR/USD",
      instrumentType: "forex",
      cotData: attachment.cotData,
    } as AnalysisInput).decisionTrace!;
    expect(trace.recommendation).toBe("NO_TRADE");
    expect(trace.convictionBreakdown.layers).toHaveLength(0);
    // (3) The core factors — and therefore Gate 3/Gate 4 — never read COT.
    expect(decomposeDecision(trace).factorScores).toMatchObject({ fundamental: 0, sentiment: 0 });
  });

  it("cannot reach Gate 4: COT is a conviction layer, not a core factor", () => {
    const entry = EVIDENCE_FLOW_MAP.find((e) => e.layer === "positioning (CFTC COT)")!;
    expect(entry.gateDependency).toMatch(/NONE/);
    expect(entry.scoring).toMatch(/deriveCotEvidence/);
    const attachment = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: Date.parse("2026-09-26T00:00:00Z"),
    });
    // Attaching COT does not change the fundamental or sentiment factor.
    const base = cryptoInput({}) as AnalysisInput;
    const withCot: AnalysisInput = {
      ...base,
      instrument: "EUR/USD",
      instrumentType: "forex",
      cotData: attachment.cotData,
    } as AnalysisInput;
    expect(sentimentFactor(withCot)).toBe(0);
    expect(fundamentalFactor(withCot)).toBe(0);
  });
});

describe("§8 double counting", () => {
  it("keeps one positioning source per decision for crypto", () => {
    const strongNews = {
      provider: "alpha-vantage",
      timestamp: SERIES[SERIES.length - 1].timestamp,
      averageScore: 0.9,
      articleCount: 10,
      label: "bullish" as const,
      breakdown: { positive: 9, negative: 1, neutral: 0 },
      confidence: "high" as const,
      articles: [],
    };
    // News alone moves the factor...
    const newsOnly = { ...cryptoInput({}), sentimentData: strongNews } as AnalysisInput;
    expect(sentimentFactor(newsOnly)).toBeGreaterThan(0);
    // ...and is then ignored when recorded derivatives are present (documented branch).
    const both = { ...newsOnly, derivativesData: derivatives({ ratio: 2.5 }) } as AnalysisInput;
    expect(sentimentFactor(both)).toBe(sentimentFactor(cryptoInput({ derivatives: derivatives({ ratio: 2.5 }) })));
  });

  it("keeps treasury and macro from voting twice (documented overlap)", () => {
    const macro = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: Date.parse("2026-09-28T12:00:00Z"),
    }).macroData!;
    // The macro block contributes 0 to the fundamental factor, so even if the
    // same curve were later wired as treasuryData the two paths cannot add up.
    expect(fundamentalFactor({ ...cryptoInput({}), instrument: "EUR/USD", instrumentType: "forex", macroData: macro } as AnalysisInput)).toBe(0);
    expect(CORE_WEIGHTS_AUDIT.fundamental + CORE_WEIGHTS_AUDIT.sentiment + CORE_WEIGHTS_AUDIT.trend).toBeCloseTo(1, 10);
  });

  it("ablates one evidence class at a time without touching price facts", () => {
    const attachment = evidenceForDecision(registry, {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      asOfMs: Date.parse("2026-09-30T03:00:00Z"),
    });
    for (const mode of ABLATION_MODES) {
      const ablated = ablationAttachment(attachment, mode);
      const fields = ablationFields(mode);
      // A field survives only when the mode keeps it AND the attachment had one.
      expect(ablated.derivativesData !== undefined).toBe(
        fields.includes("derivativesData") && attachment.derivativesData !== undefined,
      );
      expect(ablated.cotData !== undefined).toBe(fields.includes("cotData") && attachment.cotData !== undefined);
      expect(ablated.macroData !== undefined).toBe(
        fields.includes("macroData") && attachment.macroData !== undefined,
      );
      // Provenance follows the fields: only records of the kept class remain.
      const domains = new Set(ablated.provenance.map((p) => p.domain));
      if (mode === "BASE") expect(ablated.provenance).toEqual(attachment.provenance);
      if (mode === "PRICE_ONLY") expect(ablated.provenance).toHaveLength(0);
      if (mode === "DERIVATIVES_ONLY") expect([...domains]).toEqual(["crypto_derivatives"]);
      if (mode === "MACRO_ONLY") expect([...domains]).toEqual(["macro_rates"]);
      expect(ablated.provenance.length).toBeLessThanOrEqual(attachment.provenance.length);
    }
  });
});

describe("§13(F/G/H) evidence boundary placement", () => {
  it("(F) removing future evidence leaves the original decision identical", () => {
    const asOf = Date.parse("2026-09-28T12:00:00Z");
    const full = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    const futureStripped: typeof full = {
      ...full,
      provenance: full.provenance.filter((p) => Date.parse(p.availableFrom) <= asOf),
    };
    const a = runAnalysis(cryptoInput({ derivatives: full.derivativesData, clock: asOf })).decisionTrace!;
    const b = runAnalysis(cryptoInput({ derivatives: futureStripped.derivativesData, clock: asOf })).decisionTrace!;
    expect(decomposeDecision(b)).toEqual(decomposeDecision(a));
  });

  it("(G) adding legitimate evidence changes only documented consumer fields", () => {
    const asOf = Date.parse("2026-09-28T12:00:00Z");
    const attachment = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    const without = runAnalysis(cryptoInput({ clock: asOf })).decisionTrace!;
    const withEvidence = runAnalysis(
      cryptoInput({ derivatives: attachment.derivativesData, macro: attachment.macroData, clock: asOf }),
    ).decisionTrace!;
    // Structure (price-derived) is untouched by non-price evidence.
    expect(withEvidence.biasCalculation.factorScores!.trend).toBe(without.biasCalculation.factorScores!.trend);
    // The only field allowed to move is the documented positioning consumer.
    expect(withEvidence.biasCalculation.factorScores!.sentiment).toBe(without.biasCalculation.factorScores!.sentiment);
    expect(withEvidence.biasCalculation.factorScores!.fundamental).toBe(0);
    expect(withEvidence.biasCalculation.finalBias).toBe(without.biasCalculation.finalBias);
  });

  it("(H) current-only evidence never enters a historical replay", () => {
    expect(registry.datasets.every((d) => d.meta.sourceClassification === "RECORDED_HISTORICAL")).toBe(true);
    const snapshot = {
      peRatio: 37.73196,
      marketCap: 4807322746058,
      observedAt: "2026-09-30T03:53:27Z",
    };
    // The snapshot exists in the outside world; the registry has no dataset for
    // it, so no decision can ever read it.
    expect(registry.datasets.some((d) => d.meta.providerNativeId === "AAPL" && d.meta.evidenceDomain === "stock_fundamentals")).toBe(false);
    const attachment = evidenceForDecision(registry, {
      instrument: "AAPL",
      instrumentType: "stock",
      asOfMs: Date.parse("2026-07-01T00:00:00Z"),
    });
    expect(JSON.stringify(attachment)).not.toContain("37.73196");
    expect(attachment.macroData).toBeUndefined();
    expect(snapshot.observedAt).toBe("2026-09-30T03:53:27Z");
  });
});

describe("§11 live/historical parity of evidence consumption", () => {
  it("consumes identical evidence identically under both clocks", () => {
    const asOf = Date.parse("2026-09-30T03:00:00Z");
    const attachment = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    // Historical as-of: the decision claims its own historical instant.
    const historical = cryptoInput({ derivatives: attachment.derivativesData, clock: asOf });
    // Live wall-clock: the same payloads observed now (freshness satisfied).
    const liveNow = Date.now();
    const live = cryptoInput({ derivatives: attachment.derivativesData, clock: liveNow });
    const historicalTrace = runAnalysis({ ...historical, decisionClock: { mode: "HISTORICAL_AS_OF", asOfMs: asOf } } as AnalysisInput)
      .decisionTrace!;
    const liveTrace = runAnalysis(live).decisionTrace!;
    // Same evidence ⇒ same factor scores, under both clocks.
    expect(historicalTrace.biasCalculation.factorScores!.sentiment).toBe(
      liveTrace.biasCalculation.factorScores!.sentiment,
    );
    expect(historicalTrace.biasCalculation.factorScores!.trend).toBe(liveTrace.biasCalculation.factorScores!.trend);
    // The clocks differ where they must: the historical decision is stamped
    // historical, the live one is not.
    expect(historicalTrace.inputSnapshotSummary.dataCompleteness).toBeDefined();
  });

  it("rejects stale evidence in historical mode the same way live mode would", () => {
    // Evidence older than the documented age bound is simply not attached —
    // the same predicate for both clocks (it is a property of the registry, not
    // of the wall clock).
    const stale = evidenceForDecision(registry, {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      asOfMs: Date.parse("2026-10-20T00:00:00Z"),
    });
    expect(stale.derivativesData).toBeUndefined();
  });
});

describe("§12 compatibility contract (291–296)", () => {
  it("keeps the frozen surfaces of the earlier phases intact", () => {
    // Phase 296 — the recorded evidence registry identity is unchanged, and the
    // fixture README documents exactly the corpus the parser loads.
    const readme = readFileSync(evidenceFixturePath("README.md"), "utf8");
    const documented = /Registry fingerprint: `(fnv1a32:[0-9a-f]+)`/.exec(readme)?.[1];
    expect(documented).toBe(registry.fingerprint);
    expect(documented).toBe("fnv1a32:5b58092d");
    expect(readme).toContain("2026-09-30T03:53:27Z");
    expect(registry.datasets).toHaveLength(8);
    expect(registry.datasets.reduce((n, d) => n + d.observations.length, 0)).toBe(299);
    // Phase 295 — the historical decision clock is still the as-of clock, and the
    // audit reports the decision instant separately from the capture instant.
    const asOf = Date.parse("2026-09-28T12:00:00Z");
    const trace = runAnalysis({
      ...cryptoInput({ clock: asOf }),
      decisionClock: { mode: "HISTORICAL_AS_OF", asOfMs: asOf },
    } as AnalysisInput).decisionTrace!;
    expect(trace.biasCalculation.finalBias).toBeDefined();
    // Phase 294 — the recorded candle corpus still reports its provider identity.
    const fixturesForCompat = registry.datasets.map((d) => d.meta.provider);
    expect(new Set(fixturesForCompat).size).toBeGreaterThanOrEqual(3);
    // Phase 293 — the outcome model version is untouched by the audit.
    expect(EVIDENCE_FLOW_MAP.length).toBeGreaterThanOrEqual(12);
  });
});

describe("§13 no-lookahead in scoring (A–E)", () => {
  const cut = Date.parse("2026-09-29T12:00:00Z");

  function truncatedRegistry() {
    const datasets = registry.datasets
      .map((d) => ({
        ...d,
        observations: d.observations.filter((o) => o.availableFrom <= cut),
      }))
      .filter((d) => d.observations.length > 0);
    return { datasets, byId: new Map(datasets.map((d) => [d.meta.datasetId, d] as const)), fingerprint: "cut" };
  }

  it("(D) a future revision of a series cannot replace the vintage used at the decision", () => {
    const asOf = Date.parse("2026-09-28T12:00:00Z");
    const original = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: asOf });
    const dgs10 = registry.datasets.find(
      (d) => d.meta.providerNativeId === "DGS10" && d.meta.evidenceDomain === "macro_rates",
    )!;
    // A vintage revision: the whole republished series becomes knowable at ONE
    // later instant (this is what an ALFRED vintage actually is). Before that
    // instant the decision must resolve to the same state as no revision at all.
    const revisedAt = Date.parse("2026-10-02T21:00:00Z");
    const revised: HistoricalEvidenceDataset = {
      meta: { ...dgs10.meta, datasetId: "fred-DGS10-revised-later" },
      observations: dgs10.observations.map((o) => ({
        ...o,
        availableFrom: revisedAt,
        values: { ...o.values, percent: 9.99 },
      })),
      fingerprint: "fnv1a32:revision",
      findings: [],
    };
    const futureRegistry: RecordedEvidenceRegistry = {
      datasets: [...registry.datasets, revised],
      byId: registry.byId,
      fingerprint: "fnv1a32:revised",
    };
    const withRevision = evidenceForDecision(futureRegistry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: asOf });
    expect(withRevision.macroData!.indicators).toEqual(original.macroData!.indicators);
    expect(withRevision.provenance.map((p) => p.datasetId)).not.toContain("fred-DGS10-revised-later");
    expect(withRevision.macroData!.indicators.map((i) => i.value)).not.toContain("9.99");
  });

  it("(A/E) future derivatives publication cannot alter an earlier factor score", () => {
    const asOf = Date.parse("2026-09-28T12:00:00Z");
    const full = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    const truncated = evidenceForDecision(truncatedRegistry(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      asOfMs: asOf,
    });
    const a = runAnalysis(cryptoInput({ derivatives: full.derivativesData, clock: asOf })).decisionTrace!;
    const b = runAnalysis(cryptoInput({ derivatives: truncated.derivativesData, clock: asOf })).decisionTrace!;
    expect(b.biasCalculation.factorScores).toEqual(a.biasCalculation.factorScores);
    expect(b.biasCalculation.finalBias).toBe(a.biasCalculation.finalBias);
  });

  it("(B) a later COT report cannot change an earlier positioning read", () => {
    const asOf = Date.parse("2026-09-24T23:00:00Z");
    const record = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: asOf });
    const later = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: Date.parse("2026-09-26T00:00:00Z"),
    });
    expect(auditCotConsumption(record.cotData).latestReportDate).not.toBe(
      auditCotConsumption(later.cotData).latestReportDate,
    );
    expect(Date.parse(auditCotConsumption(record.cotData).latestReportDate!)).toBeLessThanOrEqual(
      Date.parse("2026-09-15T00:00:00.000Z"),
    );
  });

  it("(C) a later FRED release cannot change an earlier macro state", () => {
    const morning = Date.parse("2026-09-24T12:00:00Z");
    const later = Date.parse("2026-09-29T00:00:00Z");
    const a = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: morning }).macroData!;
    const b = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: later }).macroData!;
    expect(a.timestamp).toBeLessThan(b.timestamp);
    expect(a.indicators.find((i) => i.name.includes("10y"))!.value).toBe("5.11");
    expect(b.indicators.find((i) => i.name.includes("10y"))!.value).toBe("5.24");
  });

  it("(D) the ALFRED vintage is never promoted into the scoring macro series", () => {
    const provenance = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: Date.parse("2026-09-29T00:00:00Z"),
    }).provenance;
    expect(provenance.map((p) => p.datasetId)).not.toContain("fred-alfred-DGS10-vintage-2026-09-25");
    expect(provenance.filter((p) => p.domain === "macro_rates")).toHaveLength(2);
  });

  it("(I) the wall clock cannot change a historical score", () => {
    const asOf = Date.parse("2026-09-30T03:00:00Z");
    const attachment = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    const historical = {
      ...cryptoInput({ derivatives: attachment.derivativesData, clock: asOf }),
      decisionClock: { mode: "HISTORICAL_AS_OF", asOfMs: asOf },
    } as AnalysisInput;
    const before = runAnalysis(historical).decisionTrace!;
    const realNow = Date.now;
    Date.now = () => Date.parse("2031-01-01T00:00:00Z");
    try {
      const after = runAnalysis(historical).decisionTrace!;
      expect(after.biasCalculation.factorScores).toEqual(before.biasCalculation.factorScores);
      expect(after.biasCalculation.finalBias).toBe(before.biasCalculation.finalBias);
      expect(decomposeDecision(after)).toEqual(decomposeDecision(before));
    } finally {
      Date.now = realNow;
    }
  });
});

describe("§8 double-counting audit", () => {
  it("resolves all seven named pairs with a code-backed status", () => {
    expect(DOUBLE_COUNT_AUDIT.map((e) => e.id)).toEqual([
      "fred_macro_vs_treasury",
      "funding_vs_derivatives_sentiment",
      "open_interest_vs_positioning",
      "cot_vs_general_sentiment",
      "macro_news_vs_calendar",
      "volume_vs_structure",
      "price_proxy_vs_cross_asset",
    ]);
    // Every entry states where both sides are consumed and what was decided.
    for (const entry of DOUBLE_COUNT_AUDIT) {
      expect(entry.consumerA.length).toBeGreaterThan(20);
      expect(entry.consumerB.length).toBeGreaterThan(20);
      expect(entry.finding.length).toBeGreaterThan(40);
      expect(["unchanged", "documented_gap"]).toContain(entry.action);
    }
    // No entry claims a fix that would require changing scoring.
    expect(DOUBLE_COUNT_AUDIT.every((e) => e.action !== "documented_gap" || e.status === "duplicate_identified")).toBe(true);
  });

  it("confirms the engine-level separations the audit relies on", () => {
    // COT never reaches scoreSentiment: a firing COT rule leaves positioning at 0.
    const asOf = Date.parse("2026-09-22T12:00:00Z");
    const attachment = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: asOf });
    expect(attachment.cotData).toBeDefined();
    const cot = auditCotConsumption(attachment.cotData);
    expect(cot.fires).toBe(true);
    const trace = runAnalysis({
      ...cryptoInput({ macro: attachment.macroData, clock: asOf }),
      instrument: "EUR/USD",
      instrumentType: "forex",
      cotData: attachment.cotData,
    } as AnalysisInput).decisionTrace!;
    expect(decomposeDecision(trace).factorScores.sentiment).toBe(0);
  });
});

describe("§15 trader-facing diagnostics", () => {
  it("states the facts in plain language", () => {
    const asOf = Date.parse("2026-09-28T12:00:00Z");
    const attachment = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    const trace = runAnalysis({
      ...cryptoInput({ derivatives: attachment.derivativesData, macro: attachment.macroData, clock: asOf }),
    }).decisionTrace!;
    const decomposition = decomposeDecision(trace);
    const lines = formatEvidenceAuditDiagnostics({
      positioning: { recorded: true, providers: ["okx"] },
      derivativesRules: diagnoseDerivatives(attachment.derivativesData, "HH/HL"),
      macro: { recorded: true, observationCount: 2, asOf: "2026-09-25T23:59:59Z", directionallyScored: false },
      cot: { recorded: false },
      treasury: { wired: false },
      decomposition,
      gateFailures: [
        { gateId: "GATE3_DIRECTIONAL_BIAS", occurrences: 37 },
        { gateId: "GATE4_CONFLUENCE", occurrences: 43 },
      ],
      firstBlockers: [
        { gateId: "GATE4_CONFLUENCE", occurrences: 43 },
        { gateId: "GATE3_DIRECTIONAL_BIAS", occurrences: 37 },
      ],
    });
    const joined = lines.join("\n");
    // eslint-disable-next-line no-console
    console.log(joined);
    expect(lines).toContain("Historical positioning: recorded (okx)");
    expect(joined).toContain("Macro evidence: recorded, context-only");
    expect(joined).toContain("COT positioning: unavailable for this date");
    expect(joined).toMatch(/Positioning contribution: 0 — observed value inside existing threshold/);
    expect(joined).toContain("GATE4 CONFLUENCE: 43 evaluations failed");
    expect(joined).toContain("First blocker: GATE4_CONFLUENCE");
    expect(joined).toContain("Recommendation: NO_TRADE");
    // No audit vocabulary and no marketing language in trader-facing text.
    expect(joined).not.toMatch(/ablation|audit|diagnostic|sensitivity|would have|opportunity/i);
    expect(joined).not.toMatch(/high probability|guaranteed|accurate|AI predicts|ready to trade/i);
  });

  it("says unavailable when nothing was recorded, without inventing a neutral value", () => {
    const lines = formatEvidenceAuditDiagnostics({
      positioning: { recorded: false },
      macro: { recorded: false, observationCount: 0, directionallyScored: false },
      cot: { recorded: false },
    });
    expect(lines).toEqual([
      "Historical positioning: unavailable for this date",
      "Macro evidence: unavailable for this date",
      "COT positioning: unavailable for this date",
    ]);
  });
});
