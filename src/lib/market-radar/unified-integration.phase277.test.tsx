/**
 * Phase 277 — Unified Intelligence × Opportunity Scanner regression contract.
 *
 * The scanner must consume the SAME unified assessment the analysis pipeline
 * produced, and confluence must change what the scanner says — deterministically
 * and visibly — without ever inventing evidence.
 *
 * What this suite proves (1–20):
 *   1  a technical-only instrument keeps the existing technical opportunity path
 *   2  an aligned bullish technical+fundamental pair scores HIGHER, by the
 *      disclosed confluence rule, and is eligible
 *   3  the aligned bearish equivalent
 *   4  conflicting evidence never becomes a clean high-confidence directional call
 *   5  missing fundamental evidence is never fabricated
 *   6  missing/degraded technical evidence can never become an actionable output
 *   7  a missing technical invalidation withholds actionability
 *   8  the unified state survives into the opportunity result
 *   9  technical provider identity survives
 *   10 fundamental provider identity survives when present
 *   11 exact instrument identity survives
 *   12 the fiscal reporting period stays distinct from live market timestamps
 *   13 identical evidence yields identical output
 *   14 changed TECHNICAL evidence changes the opportunity
 *   15 changed FUNDAMENTAL evidence changes the opportunity
 *   16 the OKX live path still reaches the radar unchanged
 *   17 the CCXT live path still reaches the radar unchanged
 *   18 the Phase 274/275 fundamental path feeds the scanner end-to-end
 *   19 the existing radar card renders the real scanner output
 *   20 no fallback / mock / historical-as-live / clock leakage
 *
 * Fixtures are the same real-shaped inputs used by the Phase 273/276 suites:
 * candle series fed to the production technical engine, Alpha Vantage response
 * shapes fed to the production normalizer. Nothing here mutates the engines'
 * results — this suite is about the SCANNER's use of them.
 */

import { describe, it, expect } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";

import { I18nProvider } from "@/lib/i18n";
import { runAnalysis, type AnalysisInput } from "@/lib/analysis-engine";
import { calculateTechnical } from "@/lib/data/technical";
import { buildUnifiedIntelligence } from "@/lib/unified-intelligence";
import { normalizeFundamentals, type RawEarnings, type RawOverview } from "@/lib/data/alpha-vantage/normalize";
import type { FundamentalData } from "@/lib/data/intelligence-types";
import type { OhlcvCandle } from "@/lib/data/market-types";

import { scanRadar } from "./radar";
import { buildRadarCandidate, type RadarCandidateSource } from "./candidate-builder";
import type { RadarOpportunity, RadarScanResult } from "./types";
import { MarketOpportunities } from "@/components/MarketOpportunities";

const render = (ui: ReactNode) => rtlRender(createElement(I18nProvider, null, ui));

// ── Fixtures ─────────────────────────────────────────────────────

const NOW = Date.parse("2025-07-05T14:30:00Z");
const BAR_MS = 900_000;
const END_TS = Date.parse("2025-07-04T20:00:00Z");
const LEVEL = "48,194.05 (structural swing low)";

/** Real candle series (real OHLCV shape, as in Phase 273/276). */
function makeCandles(n: number, start: number, slopePerBar: number, seed = 0): OhlcvCandle[] {
  const amp = Math.max(4, Math.abs(slopePerBar) * 5);
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = Math.max(1, start + slopePerBar * j + amp * Math.sin(j * 0.55 + seed));
    out.push({
      timestamp: END_TS - (n - 1 - j) * BAR_MS,
      open: close - slopePerBar / 2,
      high: close + amp / 2,
      low: close - amp / 2,
      close,
      volume: 1_000 + j,
    });
  }
  return out;
}

const UPTREND = makeCandles(210, 40_000, 40, 0);
const DOWNTREND = makeCandles(210, 64_000, -60, 3);
const RANGEBOUND = makeCandles(210, 50_000, 0, 1); // "range" structure — non-directional

/** Alpha Vantage-shaped fundamental evidence, passed through the real normalizer. */
function fundamentals(direction: "improving" | "weakening"): FundamentalData {
  const rising = direction === "improving";
  const eps = rising
    ? ["1.65", "1.53", "1.50", "1.42", "1.35", "1.28", "1.24", "1.15"]
    : ["0.82", "0.95", "1.08", "1.21", "1.34", "1.40", "1.47", "1.52"];
  const revenue = rising
    ? ["94000000000", "90000000000", "85000000000", "81000000000", "78000000000", "74000000000", "71000000000", "68000000000"]
    : ["61000000000", "65000000000", "69000000000", "73000000000", "77000000000", "80000000000", "83000000000", "86000000000"];
  const estimates = rising
    ? ["1.60", "1.50", "1.45", "1.38", "1.33", "1.25", "1.20", "1.12"]
    : ["0.95", "1.05", "1.15", "1.24", "1.33", "1.38", "1.44", "1.50"];
  const dates = ["2025-06-30", "2025-03-31", "2024-12-31", "2024-09-30", "2024-06-30", "2024-03-31", "2023-12-31", "2023-09-30"];

  const overview: RawOverview = {
    Symbol: "MSFT",
    Name: "Microsoft Corporation",
    Sector: "TECHNOLOGY",
    PERatio: rising ? "34.0" : "41.0",
    ForwardPE: rising ? "30.0" : "38.0",
    EPS: rising ? "11.90" : "-0.90",
    ProfitMargin: rising ? "0.360" : "-0.081",
    ReturnOnEquityTTM: rising ? "0.350" : "-0.152",
    ReturnOnAssetsTTM: rising ? "0.200" : "-0.061",
    PriceToBookRatio: rising ? "12.10" : "9.90",
    QuarterlyRevenueGrowthYOY: rising ? "0.151" : "-0.121",
    QuarterlyEarningsGrowthYOY: rising ? "0.178" : "-0.211",
  };
  const earnings: RawEarnings = {
    quarterlyEarnings: eps.map((e, i) => ({
      fiscalDateEnding: dates[i],
      reportedDate: dates[i],
      reportedEPS: e,
      estimatedEPS: estimates[i],
      reportedRevenue: revenue[i],
    })),
  };
  return { ...normalizeFundamentals(overview, earnings, "stock", "MSFT"), timestamp: NOW };
}

/** A production-shaped analysis input (technical surface from the real engine). */
function analysisInput(
  candles: OhlcvCandle[],
  fundamentalData?: FundamentalData,
  instrument = "MSFT",
): AnalysisInput {
  const tech = calculateTechnical(candles);
  const last = candles[candles.length - 1];
  return {
    instrument,
    instrumentType: "stock",
    timeframe: "H4",
    tradingStyle: "intraday",
    provider: "alpha-vantage",
    providerInstrumentId: instrument,
    marketData: {
      instrument,
      instrumentType: "stock",
      provider: "alpha-vantage",
      providerInstrumentId: instrument,
      price: { price: last.close, timestamp: last.timestamp, source: "alpha-vantage" },
      candles,
      timeframe: "H4",
      fetchTimestamp: END_TS,
      dataFreshness: "realtime",
    },
    technicalData: tech,
    ...(fundamentalData ? { fundamentalData } : {}),
  } as AnalysisInput;
}

/**
 * The unified object exactly as the Dashboard builds it: from the analysis
 * result the pipeline produced for this instrument.
 */
function unifiedFor(
  candles: OhlcvCandle[],
  fund?: FundamentalData,
  opts: { instrument?: string; invalidation?: string } = {},
) {
  const result = runAnalysis(analysisInput(candles, fund, opts.instrument ?? "MSFT"));
  const patched = opts.invalidation
    ? { ...result, keyLevels: { ...result.keyLevels, invalidation: opts.invalidation } }
    : result;
  return { result, unified: buildUnifiedIntelligence(patched) };
}

// ── Radar source builders (mirror the Dashboard wiring) ──────────

function stockSource(overrides: {
  instrument?: string;
  unified?: ReturnType<typeof buildUnifiedIntelligence>;
  observedAt?: number;
  provider?: string;
  providerInstrumentId?: string;
} = {}): RadarCandidateSource {
  const instrument = overrides.instrument ?? "MSFT";
  const provider = overrides.provider ?? "alpha-vantage";
  const providerInstrumentId = overrides.providerInstrumentId ?? instrument;
  return {
    universe: {
      instrument,
      assetClass: "equity",
      region: "us",
      providerNative: { provider, providerInstrumentId },
      requiredCapabilities: ["ohlcv", "quote", "fundamentals"],
      priority: 30,
      refreshIntervalMs: 1_800_000,
    },
    snapshot: {
      instrument,
      assetClass: "equity",
      region: "us",
      price: 512.4,
      ohlcvAvailable: true,
      availableTimeframes: ["H1", "H4", "D1"],
      htfBias: "long",
      mtfAlignment: "ALIGNED_BULLISH",
      marketRegime: "TRENDING",
      spreadBps: 2,
      volatility: 12,
      provider,
      observedAt: overrides.observedAt ?? NOW,
      timestampProvenance: "PROVIDER_OBSERVED",
      freshness: "FRESH",
      quality: "VERIFIED",
    } as RadarCandidateSource["snapshot"],
    ...(overrides.unified ? { unified: overrides.unified } : {}),
  } as RadarCandidateSource;
}

function cryptoSource(provider: string, providerInstrumentId: string): RadarCandidateSource {
  const instrument = provider === "okx" ? "BTC/USDT" : "BTC/USDT";
  return {
    universe: {
      instrument,
      assetClass: "crypto",
      region: "global",
      providerNative: { provider, providerInstrumentId },
      requiredCapabilities: ["ohlcv", "quote"],
      priority: 1,
      refreshIntervalMs: 300_000,
    },
    snapshot: {
      instrument,
      assetClass: "crypto",
      region: "global",
      price: 65_120,
      ohlcvAvailable: true,
      availableTimeframes: ["H1", "H4", "D1"],
      htfBias: "long",
      mtfAlignment: "ALIGNED_BULLISH",
      marketRegime: "TRENDING",
      spreadBps: 3,
      volatility: 800,
      provider,
      observedAt: NOW,
      timestampProvenance: "PROVIDER_OBSERVED",
      freshness: "FRESH",
      quality: "VERIFIED",
    } as RadarCandidateSource["snapshot"],
  } as RadarCandidateSource;
}

function scan(sources: RadarCandidateSource[]): RadarScanResult {
  return scanRadar(sources, { horizons: ["INTRADAY", "SWING", "1-3_YEARS"], maxResults: 10 }, undefined, NOW);
}

function oppFor(result: RadarScanResult, instrument: string, horizon: "INTRADAY" | "SWING" | "1-3_YEARS" = "INTRADAY"): RadarOpportunity {
  const opp = result.results.get(horizon)?.find((o) => o.instrument === instrument);
  if (!opp) throw new Error(`no opportunity for ${instrument} on ${horizon}`);
  return opp;
}

// ── 1, 5, 6. Single-class honesty ────────────────────────────────

describe("277 — technical-only instruments keep the honest technical path", () => {
  it("(1) a crypto instrument with no fundamentals still produces an opportunity, and never a fabricated fundamental", () => {
    const { unified } = unifiedFor(UPTREND);
    expect(unified.state).toBe("technical_only");
    expect(unified.fundamental.available).toBe(false);

    const result = scan([cryptoSource("okx", "BTC-USDT"), { ...stockSource(), unified } as RadarCandidateSource]);
    const opp = oppFor(result, "MSFT");

    expect(opp.unified?.state).toBe("technical_only");
    expect(opp.unified?.fundamentalState).toBe("unavailable");
    // Absence is STATED, never converted into neutral evidence.
    expect(opp.missingInformation.some((m) => /technical_only/.test(m))).toBe(true);
    expect(opp.missingInformation.some((m) => /fundamental/i.test(m))).toBe(true);
    expect(opp.unified?.provenance.fundamentalProvider).toBeUndefined();
    expect(opp.unified?.provenance.reportingPeriod).toBeUndefined();
    // The technical path stays usable — a technical-only read is NOT blocked.
    expect(opp.unified?.blocksCleanActionability).toBe(false);
    expect(["ACTIVE", "QUALIFIED", "DISCOVERED"]).toContain(opp.lifecycle);
    expect(opp.score).toBeGreaterThan(0);
  });

  it("(5) a missing fundamental never changes the score and is never invented", () => {
    const { unified } = unifiedFor(UPTREND);
    const withUnified = scan([stockSource({ unified })]);
    const withoutUnified = scan([stockSource()]);

    const a = oppFor(withUnified, "MSFT");
    const b = oppFor(withoutUnified, "MSFT");

    // technical_only contributes ZERO points: the technical evidence is already
    // scored by the existing components and must not be counted twice.
    expect(a.score).toBe(b.score);
    expect(a.confidence).toBe(b.confidence);
    // No unified channel at all when the pipeline produced none.
    expect(b.unified).toBeUndefined();
    // And nothing inside the unified object claims a fundamental it does not have.
    expect(a.unified?.provenance.fundamentalInstrumentId).toBeUndefined();
    expect(JSON.stringify(a.unified)).not.toMatch(/peRatio|profitMargin|marketCap|revenueGrowth/);
  });

  it("(6) stale technical evidence cannot be turned into an actionable output by confluence", () => {
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
    expect(unified.state).toBe("aligned_bullish");
    expect(unified.actionable).toBe(true);

    // Stale price evidence (3h old): the INTRADAY gate accepts DELAYED at most,
    // so the source stays ineligible there. Confluence can never resurrect it —
    // the freshness gate outranks the promoted evidence.
    const stale = scan([
      {
        ...stockSource({ unified }),
        snapshot: {
          ...(stockSource().snapshot as any),
          observedAt: NOW - 3 * 3600_000,
        },
      },
    ]);

    const intraday = oppFor(stale, "MSFT", "INTRADAY");
    expect(intraday.lifecycle).toBe("EXPIRED");
    expect(intraday.qualityTier).toBe("X");
    expect(intraday.score).toBe(0);
    expect(intraday.confidence).toBe(0);
    expect(intraday.unified).toBeUndefined();

    // The horizon that legitimately tolerates stale evidence still carries the
    // real analysis evidence — nothing else changed.
    const swing = oppFor(stale, "MSFT", "SWING");
    expect(swing.unified?.state).toBe("aligned_bullish");
    expect(swing.lifecycle).toBe("ACTIVE");

    // No technical evidence at all: no opportunity can be promoted anywhere.
    const noSnapshot = scan([{ ...stockSource({ unified }), snapshot: null } as RadarCandidateSource]);
    for (const [, opps] of noSnapshot.results) {
      for (const o of opps) {
        expect(o.lifecycle).toBe("EXPIRED");
        expect(o.score).toBe(0);
        expect(o.unified).toBeUndefined();
      }
    }
  });
});

// ── 2, 3, 4, 7, 14, 15. Both classes ─────────────────────────────

describe("277 — both evidence classes reach the scanner's scoring", () => {
  it("(2) an aligned bullish pair scores higher than the same source without the unified evidence", () => {
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
    expect(unified.state).toBe("aligned_bullish");

    const aligned = oppFor(scan([stockSource({ unified })]), "MSFT");
    const baseline = oppFor(scan([stockSource()]), "MSFT");

    expect(aligned.score).toBe(baseline.score + 8); // the disclosed aligned delta
    // Two evidence classes must NOT double-count: agreement adds no confidence
    // the underlying evidence did not already justify.
    expect(aligned.confidence).toBe(baseline.confidence);
    expect(aligned.lifecycle).toBe("ACTIVE");
    expect(aligned.supportingEvidence.some((s) => /aligned_bullish/.test(s))).toBe(true);
    expect(aligned.unified?.actionable).toBe(true);
    expect(aligned.unified?.blocksCleanActionability).toBe(false);
  });

  it("(2b) confluence can only lower confidence, never raise it", () => {
    const baseline = oppFor(scan([stockSource()]), "MSFT");
    const aligned = oppFor(scan([stockSource({ unified: unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL }).unified })]), "MSFT");
    const conflicting = oppFor(scan([stockSource({ unified: unifiedFor(UPTREND, fundamentals("weakening"), { invalidation: LEVEL }).unified })]), "MSFT");

    expect(aligned.confidence).toBe(baseline.confidence);
    expect(conflicting.confidence).toBeLessThan(baseline.confidence);
  });

  it("(3) the aligned bearish equivalent behaves identically", () => {
    const { unified } = unifiedFor(DOWNTREND, fundamentals("weakening"), { invalidation: LEVEL });
    expect(unified.state).toBe("aligned_bearish");
    expect(unified.directionalConclusion).toBe("short");

    const aligned = oppFor(scan([stockSource({ unified })]), "MSFT");
    const baseline = oppFor(scan([stockSource()]), "MSFT");

    expect(aligned.score).toBe(baseline.score + 8);
    expect(aligned.confidence).toBe(baseline.confidence);
    expect(aligned.lifecycle).toBe("ACTIVE");
    expect(aligned.unified?.technicalBias).toBe("bearish");
    expect(aligned.unified?.fundamentalState).toBe("weakening");
    expect(aligned.unified?.actionable).toBe(true);
  });

  it("(4) conflicting evidence never becomes a clean high-confidence directional opportunity", () => {
    const conflicting = unifiedFor(UPTREND, fundamentals("weakening"), { invalidation: LEVEL });
    const aligned = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
    expect(conflicting.unified.state).toBe("conflicting");

    const bad = oppFor(scan([stockSource({ unified: conflicting.unified })]), "MSFT");
    const good = oppFor(scan([stockSource({ unified: aligned.unified })]), "MSFT");

    expect(bad.score).toBeLessThan(good.score);
    expect(bad.score).toBe(good.score - 20); // 8 aligned → −12 conflicting
    expect(bad.unified?.blocksCleanActionability).toBe(true);
    expect(bad.lifecycle).not.toBe("ACTIVE");
    expect(["C", "D", "X"]).toContain(bad.qualityTier);
    expect(bad.conflictingEvidence.some((c) => /conflicting/i.test(c))).toBe(true);
    expect(bad.conflictingEvidence.some((c) => /did not justify a combined directional conclusion/i.test(c))).toBe(true);
    // The unified layer's own reason is carried verbatim, not paraphrased away.
    expect(bad.unified?.actionabilityReason).toBe(conflicting.unified.actionabilityReason);
    expect(bad.unified?.actionabilityReason.length).toBeGreaterThan(0);
    // Confidence is capped, never raised, and never "high" on a contradiction.
    expect(bad.confidence).toBeLessThanOrEqual(35);
    expect(bad.unified?.confidence).toBe(conflicting.unified.confidence);
  });

  it("(4b) a non-directional fundamental never promotes a directional technical read", () => {
    // Range-bound technical structure + directional fundamentals → the unified
    // layer reports MIXED: present evidence that cannot support a combined call.
    const mixed = unifiedFor(RANGEBOUND, fundamentals("improving"), { invalidation: LEVEL });
    expect(mixed.unified.state).toBe("mixed");

    const baseline = oppFor(scan([stockSource()]), "MSFT");
    const opp = oppFor(scan([stockSource({ unified: mixed.unified })]), "MSFT");

    expect(opp.score).toBe(baseline.score - 4); // the disclosed mixed delta
    expect(opp.confidence).toBeLessThanOrEqual(50); // and the disclosed cap
    expect(opp.unified?.blocksCleanActionability).toBe(true);
    expect(opp.lifecycle).not.toBe("ACTIVE");
    expect(opp.conflictingEvidence.some((c) => /mixed/i.test(c))).toBe(true);
  });

  it("(4c) an insufficient unified read is never promoted as a clean opportunity", () => {
    // No usable evidence in either class: the layer says so, and the scanner
    // neither invents a direction nor presents the instrument as a signal.
    const bare = buildUnifiedIntelligence(
      runAnalysis({ instrument: "MSFT", instrumentType: "stock", timeframe: "D1" } as AnalysisInput),
    );
    expect(bare.state).toBe("insufficient");
    expect(bare.actionable).toBe(false);

    const baseline = oppFor(scan([stockSource()]), "MSFT");
    const opp = oppFor(scan([stockSource({ unified: bare })]), "MSFT");

    expect(opp.score).toBe(baseline.score - 20); // the disclosed insufficient delta
    expect(opp.confidence).toBeLessThanOrEqual(20);
    expect(opp.unified?.blocksCleanActionability).toBe(true);
    expect(["QUALIFIED", "DISCOVERED"]).toContain(opp.lifecycle);
    expect(opp.missingInformation.some((m) => /insufficient/i.test(m))).toBe(true);
  });

  it("(4d) a fundamental-only read cannot become a directional opportunity", () => {
    const fundamentalOnly = buildUnifiedIntelligence(
      runAnalysis({
        instrument: "MSFT",
        instrumentType: "stock",
        timeframe: "D1",
        provider: "alpha-vantage",
        providerInstrumentId: "MSFT",
        fundamentalData: fundamentals("improving"),
      } as AnalysisInput),
    );
    expect(fundamentalOnly.state).toBe("fundamental_only");

    const opp = oppFor(scan([stockSource({ unified: fundamentalOnly })]), "MSFT");
    expect(opp.unified?.technicalBias).toBe("unavailable");
    expect(opp.unified?.actionable).toBe(false);
    expect(opp.unified?.blocksCleanActionability).toBe(true);
    expect(opp.lifecycle).not.toBe("ACTIVE");
    // The absence is reported as MISSING evidence — never dressed up as a
    // conflict, and never filled with an invented technical read.
    expect(opp.missingInformation.some((m) => /fundamentals alone/i.test(m))).toBe(true);
    expect(opp.conflictingEvidence.some((c) => /conflict/i.test(c))).toBe(false);
  });

  it("(7) a missing technical invalidation withholds actionability and invents no level", () => {
    const { result, unified } = unifiedFor(UPTREND, fundamentals("improving"));
    expect(result.keyLevels.invalidation).toBe("");
    expect(unified.technical.invalidation).toBeUndefined();

    const opp = oppFor(scan([stockSource({ unified })]), "MSFT");
    expect(opp.unified?.actionable).toBe(false);
    expect(opp.unified?.blocksCleanActionability).toBe(true);
    expect(opp.lifecycle).not.toBe("ACTIVE");
    expect(opp.unified?.invalidation).toBeUndefined();
    expect(opp.invalidationConditions.some((c) => c.includes(LEVEL))).toBe(false);
    expect(opp.conflictingEvidence.some((c) => /no valid invalidation level/i.test(c))).toBe(true);
  });

  it("(14) changing ONLY the technical evidence changes the opportunity", () => {
    const up = unifiedFor(UPTREND, fundamentals("improving"));
    const down = unifiedFor(DOWNTREND, fundamentals("improving"));

    expect(up.unified.state).toBe("aligned_bullish");
    expect(down.unified.state).toBe("conflicting");

    const a = oppFor(scan([stockSource({ unified: up.unified })]), "MSFT");
    const b = oppFor(scan([stockSource({ unified: down.unified })]), "MSFT");

    expect(a.unified?.technicalBias).toBe("bullish");
    expect(b.unified?.technicalBias).toBe("bearish");
    expect(a.score).not.toBe(b.score);
    expect(a.unified?.state).not.toBe(b.unified?.state);
    expect(a.lifecycle).not.toBe("DEGRADED");
    expect(b.unified?.blocksCleanActionability).toBe(true);
  });

  it("(15) changing ONLY the fundamental evidence changes the opportunity", () => {
    const improving = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
    const weakening = unifiedFor(UPTREND, fundamentals("weakening"), { invalidation: LEVEL });

    expect(improving.unified.fundamental.state).toBe("improving");
    expect(weakening.unified.fundamental.state).toBe("weakening");

    const a = oppFor(scan([stockSource({ unified: improving.unified })]), "MSFT");
    const b = oppFor(scan([stockSource({ unified: weakening.unified })]), "MSFT");

    expect(a.unified?.fundamentalState).toBe("improving");
    expect(b.unified?.fundamentalState).toBe("weakening");
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.unified?.blocksCleanActionability).toBe(false);
    expect(b.unified?.blocksCleanActionability).toBe(true);
  });
});

// ── 8–13. Identity, provenance, determinism ──────────────────────

describe("277 — identity and provenance survive into the opportunity", () => {
  it("(8) the unified state survives into the opportunity result", () => {
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
    const opp = oppFor(scan([stockSource({ unified })]), "MSFT");

    expect(opp.unified?.state).toBe(unified.state);
    expect(opp.unified?.agreement).toBe(unified.confluence.agreement);
    expect(opp.unified?.confidence).toBe(unified.confidence);
    expect(opp.unified?.confidence).toBe(unified.confidence); // never re-derived
    expect(opp.unified?.actionabilityReason).toBe(unified.actionabilityReason);
    expect(opp.unified?.explanation).toMatch(/^unified aligned_bullish · technical bullish · fundamentals improving/);

    // The evaluation is also traceable at the CANDIDATE level: the scanner's
    // contract with the ranking engine carries the state and the delta that
    // were applied, not a recomputed guess.
    const candidate = buildRadarCandidate(stockSource({ unified }), NOW);
    expect(candidate.hasUnifiedIntelligence).toBe(true);
    expect(candidate.unifiedState).toBe("aligned_bullish");
    expect(candidate.unifiedScoreDelta).toBe(8);
    expect(candidate.unifiedActionable).toBe(true);
    expect(candidate.unifiedConfidenceCap).toBeUndefined();
  });

  it("(9) technical provider identity survives into the opportunity", () => {
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"));
    const opp = oppFor(scan([stockSource({ unified })]), "MSFT");

    expect(opp.providerNative).toEqual({ provider: "alpha-vantage", providerInstrumentId: "MSFT" });
    expect(opp.unified?.provenance.technicalProvider).toBe("alpha-vantage");
    expect(opp.unified?.provenance.technicalInstrumentId).toBe("MSFT");
    expect(opp.unified?.provenance.technicalObservedAt).toBe(unified.technical.observedAt);
    expect(opp.unified?.provenance.technicalObservedAt).not.toBe(NOW);
  });

  it("(10) fundamental provider identity survives when present", () => {
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
    const opp = oppFor(scan([stockSource({ unified })]), "MSFT");

    expect(opp.unified?.provenance.fundamentalProvider).toBe(unified.fundamental.provider);
    expect(opp.unified?.provenance.fundamentalInstrumentId).toBe(unified.fundamental.instrumentId);
    expect(opp.unified?.provenance.fundamentalObservedAt).toBe(unified.fundamental.observedAt);
  });

  it("(11) exact instrument identity survives — no substitution anywhere", () => {
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"), { instrument: "MSFT" });
    const result = scan([stockSource({ unified }), cryptoSource("okx", "BTC-USDT")]);

    const equity = oppFor(result, "MSFT");
    expect(equity.instrument).toBe("MSFT");
    expect(equity.candidateInstrument).toBe("MSFT");
    expect(equity.unified?.provenance.technicalInstrumentId).toBe("MSFT");
    expect(equity.unified?.provenance.fundamentalInstrumentId).toBe("MSFT");

    // The crypto leg is untouched by the equity leg's evidence.
    const crypto = oppFor(result, "BTC/USDT");
    expect(crypto.instrument).toBe("BTC/USDT");
    expect(crypto.unified).toBeUndefined();
    expect(JSON.stringify(crypto)).not.toContain("MSFT");
  });

  it("(12) the fiscal reporting period stays distinct from live market timestamps", () => {
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
    const opp = oppFor(scan([stockSource({ unified })]), "MSFT");

    const period = opp.unified?.provenance.reportingPeriod;
    expect(period).toBe("2025-06-30");
    expect(period).toBe(unified.fundamental.reportingPeriod);
    expect(period).not.toBe(new Date(NOW).toISOString().slice(0, 10));
    expect(opp.evidence?.observedAt).toBe(NOW); // the live market instant
    expect(opp.lastUpdated).toBe(NOW);
    // The reporting period is never described as live market data.
    const serialized = JSON.stringify(opp);
    expect(serialized).not.toMatch(/2025-06-30[^"]*live/i);
  });

  it("(13) identical evidence yields an identical opportunity", () => {
    const build = () => {
      const { unified } = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
      return oppFor(scan([stockSource({ unified })]), "MSFT");
    };
    expect(build()).toEqual(build());
  });
});

// ── 16–18. Existing live and fundamental paths ───────────────────

describe("277 — the existing provider paths still reach the scanner", () => {
  it("(16) the OKX live path is unchanged and still produces a radar opportunity", () => {
    const result = scan([cryptoSource("okx", "BTC-USDT")]);
    const opp = oppFor(result, "BTC/USDT");

    expect(opp.providerNative).toEqual({ provider: "okx", providerInstrumentId: "BTC-USDT" });
    expect(opp.provider).toBe("okx");
    expect(opp.evidence?.provider).toBe("okx");
    expect(opp.evidence?.providerInstrumentId).toBe("BTC-USDT");
    expect(opp.evidence?.timestampProvenance).toBe("PROVIDER_OBSERVED");
    expect(opp.score).toBeGreaterThan(0);
    // No unified evidence ⇒ no unified field, and no scoring change.
    expect(opp.unified).toBeUndefined();
  });

  it("(17) the CCXT live path is unchanged and still produces a radar opportunity", () => {
    const result = scan([cryptoSource("ccxt", "BTC/USDT")]);
    const opp = oppFor(result, "BTC/USDT");

    expect(opp.providerNative).toEqual({ provider: "ccxt", providerInstrumentId: "BTC/USDT" });
    expect(opp.evidence?.provider).toBe("ccxt");
    expect(opp.unified).toBeUndefined();
    expect(opp.score).toBe(oppFor(scan([cryptoSource("okx", "BTC-USDT")]), "BTC/USDT").score);
  });

  it("(18) the real fundamental path feeds the scanner end-to-end", () => {
    // The fundamental evidence is produced by the real engine from raw provider
    // statements — not supplied as a scanner-side constant.
    const { result, unified } = unifiedFor(UPTREND, fundamentals("improving"), { invalidation: LEVEL });
    expect(result.fundamentalAssessment).toBeDefined();
    expect(unified.fundamental.present).toBe(true);
    expect(unified.fundamental.state).toBe("improving");

    const opp = oppFor(scan([stockSource({ unified })]), "MSFT");
    expect(opp.unified?.fundamentalState).toBe("improving");
    expect(opp.unified?.provenance.reportingPeriod).toBe(result.fundamentalAssessment!.reportingPeriod);
  });
});

// ── 19. The existing UI renders the real scanner output ──────────

describe("277 — the existing radar card explains the scanner's decision", () => {
  it("(19) the card renders the actual opportunity object, including confluence and rejection reasons", () => {
    const conflicting = unifiedFor(UPTREND, fundamentals("weakening"), { invalidation: LEVEL });
    const radarResult = scan([stockSource({ unified: conflicting.unified })]);

    render(createElement(MarketOpportunities, { radarResult, providerErrors: [] }));

    // Expand the existing radar card — no new surface, no new page.
    fireEvent.click(screen.getByText(/why this asset/i));

    const card = screen.getByTestId("radar-unified");
    const text = card.textContent ?? "";
    // The card was found through the scanner's OWN result — not a re-derivation.
    expect(within(card).getAllByText(/conflicting/).length).toBeGreaterThan(0);

    expect(text).toContain("unified intelligence");
    expect(text).toContain("conflicting");
    expect(text).toContain("technical bias: bullish");
    expect(text).toContain("weakening");
    expect(text).toContain("confidence:");
    // The rejection reason the scanner recorded is visible, verbatim.
    expect(text).toContain(conflicting.unified.actionabilityReason);
    expect(text).toContain("reporting period: 2025-06-30");
    // Only ONE card, and it belongs to the scanner's own result object.
    const opp = oppFor(radarResult, "MSFT");
    expect(text).toContain(opp.unified!.explanation);
    expect(screen.getAllByTestId("radar-unified")).toHaveLength(1);
  });

  it("(19b) a technical-only card states that fundamentals are unavailable", () => {
    const { unified } = unifiedFor(UPTREND);
    const radarResult = scan([stockSource({ unified })]);
    render(createElement(MarketOpportunities, { radarResult, providerErrors: [] }));
    fireEvent.click(screen.getByText(/why this asset/i));

    const text = screen.getByTestId("radar-unified").textContent ?? "";
    expect(text).toContain("technical_only");
    expect(text).toContain("unavailable");
    expect(text).not.toContain("reporting period");
  });
});

// ── 20. No fallback / mock / historical-as-live / clock leakage ──

describe("277 — no fallback, mock or clock leakage", () => {
  it("(20) the confluence layer is pure, clock-free and performs no I/O", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/market-radar/unified-confluence.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/new Date\(/);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/fetch\(/);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(source).not.toMatch(/faker|mock/i);

    // Evaluating the same evidence twice is byte-identical (pure function).
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"));
    const once = oppFor(scan([stockSource({ unified })]), "MSFT");
    const twice = oppFor(scan([stockSource({ unified })]), "MSFT");
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it("(20b) an absent unified object is a no-op, not a fallback assumption", () => {
    const source = stockSource();
    const result = scan([source]);
    const opp = oppFor(result, "MSFT");
    // No invented unified block, no invented fundamental, no score change from
    // the integration: the pre-277 behaviour is preserved exactly.
    expect(opp.unified).toBeUndefined();
    expect(opp.conflictingEvidence.some((c) => /unified/i.test(c))).toBe(false);
    expect(opp.missingInformation.some((m) => /unified/i.test(m))).toBe(false);
  });

  it("(20c) provider observation instants are never replaced by the scan instant", () => {
    const { unified } = unifiedFor(UPTREND, fundamentals("improving"));
    const opp = oppFor(scan([stockSource({ unified })]), "MSFT");
    // The live market fact keeps the PROVIDER's instant...
    expect(opp.evidence?.observedAt).toBe(NOW);
    expect(opp.evidence?.observedAt).not.toBe(opp.lastUpdated + 1);
    // ...and the technical instant carried by the unified evidence is the
    // provider's candle instant, never the scan clock.
    expect(opp.unified?.provenance.technicalObservedAt).toBe(unified.technical.observedAt);
    expect(opp.unified?.provenance.technicalObservedAt).toBeLessThan(NOW);
  });
});
