/**
 * Phase 300 runtime-integration fix — Market Opportunities ranking runs on
 * ACTUAL evidence, per horizon.
 *
 * Production finding being locked down: every pre-analysis crypto candidate
 * collapsed to the identical score=60 / confidence=52 / DELAYED / PARTIAL /
 * "HTF bias: neutral" row, because the Dashboard adapter encoded ABSENT
 * analysis as a default "neutral" HTF bias. "neutral" is a real engine
 * verdict; absent analysis must stay "unknown" (no bonus, no completeness
 * credit, explicit missing-evidence line). This suite locks:
 *
 *   - missing HTF analysis never becomes "neutral" (and never scores like it);
 *   - a genuine engine "Neutral" verdict is still real neutral evidence;
 *   - a trading-mode horizon no longer pays structure/MTF credit to a generic
 *     snapshot whose verified timeframes sit outside that horizon's chain;
 *   - candidates differentiate by the evidence they actually hold;
 *   - identical baseline candidates cannot masquerade as differentiated
 *     analysis (no per-ticker variance, no popularity bonus);
 *   - the radar stays NON-DIRECTIONAL: long and short bias carry identical
 *     weight; provider availability never becomes directional evidence.
 *
 * The radar remains informational only — nothing here touches the decision
 * engine, its gates or its thresholds.
 */

import { describe, expect, it } from "vitest";

import { scanRadar, type RadarScanResult } from "./radar";
import type { RadarCandidateSource } from "./candidate-builder";
import type { RadarOpportunity } from "./types";

const NOW = 1_759_273_600_000; // fixed decision-free ranking clock
const FRESH_AT = NOW - 60_000; // < 5 min → FRESH
const DELAYED_AT = NOW - 20 * 60_000; // < 1 h → DELAYED

function sourceOf(overrides: {
  instrument: string;
  observedAt?: number;
  availableTimeframes?: string[];
  htfBias?: "long" | "short" | "neutral" | "unknown";
  mtfAlignment?: string;
  derivatives?: { fundingRate: number; openInterest: number };
  spreadBps?: number;
}): RadarCandidateSource {
  return {
    universe: {
      instrument: overrides.instrument,
      assetClass: "crypto",
      region: "global",
      requiredCapabilities: ["ohlcv", "quote"],
      priority: 1,
      refreshIntervalMs: 300_000,
    },
    snapshot: {
      instrument: overrides.instrument,
      assetClass: "crypto",
      price: 123.45,
      ohlcvAvailable: (overrides.availableTimeframes?.length ?? 0) > 0,
      availableTimeframes: overrides.availableTimeframes ?? [],
      ...(overrides.htfBias !== undefined ? { htfBias: overrides.htfBias } : {}),
      ...(overrides.mtfAlignment !== undefined ? { mtfAlignment: overrides.mtfAlignment } : {}),
      ...(overrides.spreadBps !== undefined ? { spreadBps: overrides.spreadBps } : {}),
      provider: "ccxt:apex",
      observedAt: overrides.observedAt ?? DELAYED_AT,
      freshness: (overrides.observedAt ?? DELAYED_AT) === FRESH_AT ? "FRESH" : "DELAYED",
      quality: "VERIFIED",
    },
    ...(overrides.derivatives ? { derivatives: overrides.derivatives } : {}),
  };
}

function resultsOf(sources: RadarCandidateSource[], horizons: ("SCALPING" | "INTRADAY" | "SWING")[]): RadarScanResult {
  return scanRadar(
    sources,
    { horizons: [...horizons, "1-3_YEARS" as const], maxResults: 25 },
    undefined,
    NOW,
  );
}

function oppOf(result: RadarScanResult, instrument: string, horizon: string): RadarOpportunity {
  const opps = result.results.get(horizon as never) ?? [];
  const opp = opps.find((o) => o.instrument === instrument);
  expect(opp, `no ${horizon} opportunity for ${instrument}`).toBeDefined();
  return opp as RadarOpportunity;
}

describe("Phase 300b — absent HTF analysis is unknown, never neutral", () => {
  it("a pre-analysis candidate gets NO HTF-bias credit and carries an explicit missing line", () => {
    // Production shape: generic scanner snapshot, no analysis result at all.
    const result = resultsOf(
      [sourceOf({ instrument: "0G/USDT:USDT", observedAt: DELAYED_AT, availableTimeframes: ["H1"] })],
      ["INTRADAY"],
    );
    const opp = oppOf(result, "0G/USDT:USDT", "INTRADAY");
    // The manufactured row was exactly score=60 (50 + 5 DELAYED + 5 fake neutral).
    // Without the fake neutral the DELAYED quote-only candidate is 55.
    expect(opp.score).toBe(55);
    expect(opp.supportingEvidence.join(" | ")).not.toContain("HTF bias:");
    expect(opp.missingInformation).toContain("HTF structure");
  });

  it("a genuine engine Neutral verdict IS neutral evidence (+5, disclosed as such)", () => {
    const result = resultsOf(
      [
        sourceOf({
          instrument: "RANGE/USDT:USDT",
          observedAt: DELAYED_AT,
          availableTimeframes: ["H1"],
          htfBias: "neutral",
        }),
      ],
      ["INTRADAY"],
    );
    const opp = oppOf(result, "RANGE/USDT:USDT", "INTRADAY");
    expect(opp.score).toBe(60);
    expect(opp.supportingEvidence).toContain("HTF bias: neutral");
  });

  it("the Dashboard and live-source adapters encode absent analysis as unknown (source contract)", async () => {
    const { readFileSync } = await import("node:fs");
    const dashboard = readFileSync("src/pages/Dashboard.tsx", "utf8");
    // The mapping must pass a real "Neutral" verdict through as neutral and
    // everything else (no analysis) to "unknown" — never a bare neutral else.
    expect(dashboard).toContain('ar?.bias === "Neutral"');
    const adapter = readFileSync("src/lib/market-radar/live-source-adapter.ts", "utf8");
    expect(adapter).toContain('analysis?.bias === "Neutral"');
  });
});

describe("Phase 300b — ranking is horizon-chain aware", () => {
  const biasSources = (availableTimeframes: string[]) => [
    sourceOf({
      instrument: "DAILYBIAS/USDT:USDT",
      observedAt: FRESH_AT,
      availableTimeframes,
      htfBias: "long",
      mtfAlignment: "ALIGNED_BULLISH",
    }),
  ];

  it("a D1-only snapshot earns NO structure/MTF credit in the SCALPING ranking — and says why", () => {
    // D1 is outside the whole scalping chain (M1/M5 setups, M15/H1 context):
    // the +5 bias and +8 alignment cannot be earned by it in this ranking.
    const result = resultsOf(biasSources(["D1"]), ["SCALPING"]);
    const opp = oppOf(result, "DAILYBIAS/USDT:USDT", "SCALPING");
    expect(opp.supportingEvidence.join(" | ")).not.toContain("HTF bias:");
    expect(opp.supportingEvidence.join(" | ")).not.toContain("MTF aligned:");
    expect(
      opp.missingInformation.some((m) => m.includes("outside the scalping chain")),
    ).toBe(true);
    expect(
      opp.missingInformation.some((m) => m.includes("no verified OHLCV on the scalping chain")),
    ).toBe(true);
  });

  it("the same D1 evidence DOES earn structure credit in the SWING ranking (D1 is a swing setup)", () => {
    const result = resultsOf(biasSources(["D1"]), ["SCALPING", "SWING"]);
    const scalping = oppOf(result, "DAILYBIAS/USDT:USDT", "SCALPING");
    const swing = oppOf(result, "DAILYBIAS/USDT:USDT", "SWING");
    expect(swing.supportingEvidence).toContain("HTF bias: long");
    expect(swing.supportingEvidence.join(" | ")).toContain("inside the swing chain");
    expect(swing.score).toBeGreaterThan(scalping.score);
  });

  it("structure credit applies when the verified timeframes sit INSIDE the horizon chain", () => {
    // M5 is a scalping SETUP timeframe; H1 is scalping CONTEXT — both in
    // the chain, so the bias and alignment are chain-relevant for SCALPING.
    const inChain = resultsOf(biasSources(["M5", "H1"]), ["SCALPING"]);
    const scalping = oppOf(inChain, "DAILYBIAS/USDT:USDT", "SCALPING");
    expect(scalping.supportingEvidence).toContain("HTF bias: long");
    expect(scalping.supportingEvidence).toContain("MTF aligned: ALIGNED_BULLISH");
    expect(scalping.supportingEvidence.join(" | ")).toContain("inside the scalping chain");
    // The same M5-verified evidence is OUTSIDE the intraday chain (its
    // setups are M15/M30/H1): no structure credit there.
    const m5Only = resultsOf(biasSources(["M5"]), ["INTRADAY"]);
    const intraday = oppOf(m5Only, "DAILYBIAS/USDT:USDT", "INTRADAY");
    expect(
      intraday.missingInformation.some((m) => m.includes("outside the intraday chain")),
    ).toBe(true);
    expect(intraday.supportingEvidence.join(" | ")).not.toContain("HTF bias:");
  });

  it("a generic live quote alone never earns structure points in any trading-mode ranking", () => {
    const result = resultsOf(
      [sourceOf({ instrument: "QUOTEONLY/USDT:USDT", observedAt: FRESH_AT, availableTimeframes: [] })],
      ["SCALPING", "INTRADAY", "SWING"],
    );
    for (const horizon of ["SCALPING", "INTRADAY", "SWING"]) {
      const opp = oppOf(result, "QUOTEONLY/USDT:USDT", horizon);
      expect(opp.supportingEvidence.join(" | ")).not.toContain("HTF bias:");
      expect(opp.supportingEvidence.join(" | ")).not.toContain("MTF aligned:");
      expect(opp.missingInformation).toContain("HTF structure");
      expect(opp.missingInformation).toContain("MTF alignment");
    }
  });
});

describe("Phase 300b — differentiation from actual evidence", () => {
  const baseline = (instrument: string) =>
    sourceOf({ instrument, observedAt: DELAYED_AT, availableTimeframes: ["H1"] });

  it("two identical quote-only baselines score identically — no per-ticker variance, no popularity bonus", () => {
    const result = resultsOf(
      [baseline("AAA/USDT:USDT"), baseline("ZZZ/USDT:USDT"), baseline("PEPE/USDT:USDT")],
      ["INTRADAY"],
    );
    const scores = ["AAA/USDT:USDT", "ZZZ/USDT:USDT", "PEPE/USDT:USDT"].map(
      (i) => oppOf(result, i, "INTRADAY").score,
    );
    expect(new Set(scores).size).toBe(1);
    const confidences = ["AAA/USDT:USDT", "ZZZ/USDT:USDT", "PEPE/USDT:USDT"].map(
      (i) => oppOf(result, i, "INTRADAY").confidence,
    );
    expect(new Set(confidences).size).toBe(1);
  });

  it("real evidence differentiates: derivatives, execution spread and freshness move the score", () => {
    const rich = sourceOf({
      instrument: "RICH/USDT:USDT",
      observedAt: FRESH_AT,
      availableTimeframes: ["M5"],
      derivatives: { fundingRate: 0.0001, openInterest: 1_000_000 },
      spreadBps: 2,
    });
    const result = resultsOf([baseline("POOR/USDT:USDT"), rich], ["SCALPING"]);
    const poor = oppOf(result, "POOR/USDT:USDT", "SCALPING");
    const wealthy = oppOf(result, "RICH/USDT:USDT", "SCALPING");
    expect(wealthy.score).toBeGreaterThan(poor.score);
    expect(wealthy.supportingEvidence).toContain("funding rate available");
    expect(wealthy.supportingEvidence).toContain("tight spread");
    expect(wealthy.confidence).toBeGreaterThan(poor.confidence);
  });

  it("missing evidence reduces confidence but never fabricates direction or neutrality", () => {
    const result = resultsOf(
      [sourceOf({ instrument: "BARE/USDT:USDT", observedAt: DELAYED_AT, availableTimeframes: ["H1"] })],
      ["INTRADAY"],
    );
    const opp = oppOf(result, "BARE/USDT:USDT", "INTRADAY");
    expect(opp.missingInformation.length).toBeGreaterThan(0);
    for (const line of [...opp.supportingEvidence, ...opp.conflictingEvidence]) {
      expect(line).not.toMatch(/no data|neutral market|direction: neutral/i);
    }
  });
});

describe("Phase 300b — the radar stays non-directional", () => {
  it("long and short HTF bias carry IDENTICAL weight", () => {
    const long = sourceOf({
      instrument: "LONG/USDT:USDT",
      observedAt: FRESH_AT,
      availableTimeframes: ["M5"],
      htfBias: "long",
    });
    const short = sourceOf({
      instrument: "SHORT/USDT:USDT",
      observedAt: FRESH_AT,
      availableTimeframes: ["M5"],
      htfBias: "short",
    });
    const result = resultsOf([long, short], ["SCALPING"]);
    const longOpp = oppOf(result, "LONG/USDT:USDT", "SCALPING");
    const shortOpp = oppOf(result, "SHORT/USDT:USDT", "SCALPING");
    expect(longOpp.score).toBe(shortOpp.score);
    expect(longOpp.confidence).toBe(shortOpp.confidence);
  });

  it("provider availability alone never becomes directional evidence", () => {
    const result = resultsOf(
      [sourceOf({ instrument: "PROV/USDT:USDT", observedAt: FRESH_AT, availableTimeframes: ["M15"] })],
      ["INTRADAY"],
    );
    const opp = oppOf(result, "PROV/USDT:USDT", "INTRADAY");
    const joined = [...opp.supportingEvidence, ...opp.conflictingEvidence].join(" | ");
    // Nothing may claim bull/bear from availability facts.
    expect(joined).not.toMatch(/bullish|bearish/);
  });
});
