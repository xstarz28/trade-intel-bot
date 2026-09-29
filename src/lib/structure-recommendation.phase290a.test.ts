/**
 * Phase 290-A — the confirmed structural evidence as the RECOMMENDATION and
 * RADAR layers consume it.
 *
 * The structural engine's own semantics live in `data/structure.phase290a.test.ts`
 * and the pipeline wiring in `data/structure.integration.phase290a.test.ts`.
 * This file pins the last mile: candidate extraction, evidence assembly,
 * ranking output and radar reporting — deterministic facts only, no invented
 * probability and no new score weights.
 */
import { describe, expect, it } from "vitest";

import { buildCandidatesFromSources } from "./liveCandidateBuilder";
import type { LiveCandidateSource } from "./liveCandidateBuilder";
import { generateRecommendation, scoreCandidate } from "./recommendation-engine";
import type { CandidateInput } from "./recommendation-engine";
import { buildRadarCandidate } from "./market-radar/candidate-builder";
import { scanRadar } from "./market-radar/radar";
import type { RadarCandidateSource } from "./market-radar/candidate-builder";
import type { TechnicalData } from "./data/market-types";
import { computeSmcContext } from "./data/smc";
import type { OhlcvCandle } from "./data/market-types";

const NOW = 1_800_000_000_000;

function candles(specs: { len: number; step: number }[]): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  let price = 100;
  let t = NOW - 3_600_000 * 48;
  for (const s of specs) {
    for (let i = 0; i < s.len; i++) {
      const open = price;
      price += s.step;
      out.push({
        timestamp: t,
        open,
        high: Math.max(open, price) + 0.15,
        low: Math.min(open, price) - 0.15,
        close: price,
        volume: 1000,
      });
      t += 3_600_000;
    }
  }
  return out;
}

const TREND_UP = candles([
  { len: 12, step: 1 },
  { len: 6, step: -0.5 },
  { len: 12, step: 1 },
  { len: 6, step: -0.5 },
  { len: 12, step: 1 },
]);

function techWithStructure(): TechnicalData {
  return {
    swingHighs: [],
    swingLows: [],
    // A stale label the engine must NOT trust over the confirmed event record.
    structure: "range",
    supportLevels: [],
    resistanceLevels: [],
    volumeTrend: "unknown",
    dataPoints: TREND_UP.length,
    smc: computeSmcContext(TREND_UP, "H1"),
  };
}

const structural = computeSmcContext(TREND_UP, "H1").structural!;

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  const e = structural.external.lastEvent!;
  return {
    instrument: "BTC-USDT",
    assetClass: "crypto",
    currentPrice: TREND_UP[TREND_UP.length - 1].close,
    dataCompleteness: "FULL",
    dataPoints: TREND_UP.length,
    hasLiveData: true,
    freshness: "FRESH",
    providerCoverage: "PARTIAL",
    atr: 1.2,
    htfBias: "long",
    mtfAlignment: "ALIGNED_BULLISH",
    structuralDirection: structural.external.direction,
    structuralEvent: {
      kind: e.kind,
      direction: e.direction,
      brokenLevel: e.brokenLevel,
      candleTime: e.candleTime,
      timeframe: "H1",
    },
    structuralInvalidation: {
      level: structural.external.invalidation!.level,
      timeframe: "H1",
      swingKind: structural.external.invalidation!.swingKind,
    },
    structuralPairState: structural.state,
    ...overrides,
  };
}

describe("Phase 290-A — candidate extraction", () => {
  it("carries the confirmed read and prefers it over the stale label", () => {
    const source: LiveCandidateSource = {
      instrument: "BTC-USDT",
      assetClass: "crypto",
      technicalData: techWithStructure(),
    };
    const [out] = buildCandidatesFromSources([source]);
    expect(out.structuralDirection).toBe("bullish");
    expect(out.structuralEvent!.kind).toBe("BOS");
    expect(out.structuralEvent!.brokenLevel).toBe(structural.external.lastEvent!.brokenLevel);
    expect(out.structuralEvent!.candleTime).toBe(structural.external.lastEvent!.candleTime);
    expect(out.structuralInvalidation!.level).toBe(structural.external.invalidation!.level);
    expect(out.structuralPairState).toBe(structural.state);
    // Event direction wins over the "range" label.
    expect(out.htfBias).toBe("long");
  });

  it("falls back to the label when no structural read exists", () => {
    const source: LiveCandidateSource = {
      instrument: "BTC-USDT",
      assetClass: "crypto",
      technicalData: { ...techWithStructure(), smc: undefined, structure: "LH/LL" },
    };
    const [out] = buildCandidatesFromSources([source]);
    expect(out.structuralEvent).toBeUndefined();
    expect(out.htfBias).toBe("short");
  });
});

describe("Phase 290-A — recommendation evidence assembly", () => {
  it("quotes the event, the broken level and the invalidation level", () => {
    const c = candidate();
    const scored = scoreCandidate(c, "INTRADAY");
    const facts = scored.structuralFacts.join("\n");
    expect(facts).toContain("Structure bullish: confirmed BOS");
    expect(facts).toContain(String(c.structuralEvent!.brokenLevel));
    expect(facts).toContain(
      `Structural invalidation ${c.structuralInvalidation!.level} (H1 confirmed swing low)`,
    );
    expect(scored.reasons.join("\n")).toContain("confirmed BOS");
  });

  it("does not change the analytical score — facts are not a hidden weight", () => {
    const withFacts = scoreCandidate(candidate(), "SWING");
    const withoutFacts = scoreCandidate(
      candidate({
        structuralDirection: undefined,
        structuralEvent: undefined,
        structuralInvalidation: undefined,
        structuralPairState: undefined,
      }),
      "SWING",
    );
    expect(withFacts.analyticalScore).toBe(withoutFacts.analyticalScore);
    expect(withoutFacts.structuralFacts).toEqual([]);
  });

  it("an internal counter-trend is stated as a conflict, never a re-rating", () => {
    const scored = scoreCandidate(
      candidate({ structuralPairState: "INTERNAL_COUNTERTREND" }),
      "SWING",
    );
    expect(scored.conflicts.join("\n")).toContain("counter-trend");
    expect(scored.reasons.join("\n")).not.toContain("counter-trend");
  });

  it("the ranking names the invalidation level and the facts", () => {
    const rec = generateRecommendation([candidate()], "INTRADAY");
    const ranked = rec.rankedInstruments[0];
    expect(ranked.structuralFacts!.join("\n")).toContain("Structure bullish: confirmed BOS");
    expect(ranked.invalidationConditions.join("\n")).toContain(
      String(structural.external.invalidation!.level),
    );
    // The generic condition stays for continuity.
    expect(ranked.invalidationConditions).toContain("structural reversal on HTF");
  });

  it("says nothing structural when there is nothing structural", () => {
    const rec = generateRecommendation(
      [
        candidate({
          structuralDirection: undefined,
          structuralEvent: undefined,
          structuralInvalidation: undefined,
          structuralPairState: undefined,
        }),
      ],
      "INTRADAY",
    );
    expect(rec.rankedInstruments[0].structuralFacts).toBeUndefined();
  });
});

describe("Phase 290-A — radar reporting", () => {
  function radarSource(): RadarCandidateSource {
    const e = structural.external.lastEvent!;
    const inv = structural.external.invalidation!;
    return {
      universe: {
        instrument: "BTC/USDT",
        assetClass: "crypto",
        region: "global",
        requiredCapabilities: ["ohlcv", "quote"],
        priority: 1,
        refreshIntervalMs: 300_000,
      },
      snapshot: {
        instrument: "BTC/USDT",
        assetClass: "crypto",
        region: "global",
        price: TREND_UP[TREND_UP.length - 1].close,
        ohlcvAvailable: true,
        availableTimeframes: ["H1", "H4"],
        htfBias: "long",
        mtfAlignment: "ALIGNED_BULLISH",
        marketRegime: "TRENDING",
        spreadBps: 3,
        volatility: 12,
        provider: "okx",
        observedAt: NOW,
        freshness: "FRESH",
        quality: "VERIFIED",
        structuralEvent: {
          kind: e.kind,
          direction: e.direction,
          brokenLevel: e.brokenLevel,
          candleTime: e.candleTime,
          timeframe: "H1",
        },
        structuralInvalidation: {
          level: inv.level,
          timeframe: "H1",
          swingKind: inv.swingKind,
        },
        structuralPairState: structural.state,
      } as RadarCandidateSource["snapshot"],
    };
  }

  it("quotes the confirmed event verbatim and names the invalidation level", () => {
    const e = structural.external.lastEvent!;
    const inv = structural.external.invalidation!;
    const candidateBuilt = buildRadarCandidate(radarSource(), NOW);
    // The facts travel into the candidate the recommendation would consume.
    expect(candidateBuilt.structuralEvent?.brokenLevel).toBe(e.brokenLevel);
    expect(candidateBuilt.structuralInvalidation?.level).toBe(inv.level);

    const scan = scanRadar([radarSource()], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    const opp = scan.results.get("INTRADAY")![0];
    expect(opp.supportingEvidence.join("\n")).toContain(
      `confirmed ${e.kind} ${e.direction} through ${e.brokenLevel} on H1`,
    );
    expect(opp.invalidationConditions.join("\n")).toContain(
      `confirmed close beyond ${inv.level} (H1 confirmed swing ${inv.swingKind})`,
    );
  });

  it("an internal counter-trend appears as conflicting radar evidence", () => {
    const source = radarSource();
    source.snapshot!.structuralPairState = "INTERNAL_COUNTERTREND";
    const scan = scanRadar([source], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    const opp = scan.results.get("INTRADAY")![0];
    expect(opp.conflictingEvidence.join("\n")).toContain("counter-trend");
  });
});
