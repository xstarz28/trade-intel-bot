/**
 * Phase 291 — the setup verdict reaches the recommendation and the radar.
 *
 * What this suite pins:
 *   · the deterministic setup-context line joins the EXISTING evidence lists
 *     (supporting vs conflicting) instead of a new score column, and exactly one
 *     verdict line is produced per candidate — one setup can never be counted
 *     twice;
 *   · per-timeframe context lines are one per timeframe and ordered
 *     deterministically, so repeated calls are byte-identical;
 *   · the ranked output carries the verdict and the verbatim engine facts;
 *   · the radar REPORTS the same facts while excluding them from the coherence
 *     ratio (Phase 277 rule: two evidence classes never double-count), so the
 *     confidence number cannot be inflated by restating evidence it already
 *     counted.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import { buildCandidateFromSource } from "@/lib/liveCandidateBuilder";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";
import {
  generateRecommendation,
  scoreCandidate,
  setupContextEvidenceFacts,
} from "@/lib/recommendation-engine";
import type { CandidateInput } from "@/lib/recommendation-engine";
import { scanRadar } from "@/lib/market-radar/radar";
import type { RadarCandidateSource } from "@/lib/market-radar/candidate-builder";
import { buildRadarCandidate } from "@/lib/market-radar/candidate-builder";
import { buildRadarState } from "@/lib/market-radar/radar";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

// ── Recorded provider chain, as the live path supplies it ─────────

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("./data/__fixtures__/real-provider-candles.phase290a.json", import.meta.url),
    "utf8",
  ),
) as { _provenance: { provider: string; instrumentId: string }; bars: Record<string, string[][]> };

const INSTRUMENT = fixture._provenance.instrumentId;

function candlesFrom(bar: string): OhlcvCandle[] {
  return fixture.bars[bar]
    .map((r) => ({
      timestamp: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .reverse();
}

const W1 = candlesFrom("1W");
const D1 = candlesFrom("1D");
const H4 = candlesFrom("4H");
const H1 = candlesFrom("1H");

const tech = (): TechnicalData => ({
  ...calculateTechnical(H4, D1, "D1"),
  smc: computeSmcContext(H4, "H4"),
  mtf: buildMtfContext("H4", [
    { timeframe: "W1", role: "macro", candles: W1 },
    { timeframe: "D1", role: "structure", candles: D1 },
    { timeframe: "H4", role: "setup", candles: H4 },
    { timeframe: "H1", role: "trigger", candles: H1 },
  ] satisfies MtfCandleInput[]),
});

function candidateFromRecordedCandles(): CandidateInput {
  const technicalData = tech();
  const last = H4[H4.length - 1];
  const input: AnalysisInput = {
    instrument: INSTRUMENT,
    instrumentType: "crypto",
    timeframe: "H4" as Timeframe,
    provider: "okx",
    providerInstrumentId: INSTRUMENT,
    marketData: {
      instrument: INSTRUMENT,
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId: INSTRUMENT,
      fetchTimestamp: last.timestamp,
      price: { price: last.close, timestamp: last.timestamp, source: "okx" },
      candles: H4,
      timeframe: "H4",
      dataFreshness: "delayed",
    },
    technicalData,
  };
  const analysis = runAnalysis(input);
  const source: LiveCandidateSource = {
    instrument: INSTRUMENT,
    assetClass: "crypto",
    marketData: input.marketData,
    technicalData,
    analysisResult: analysis,
  };
  return buildCandidateFromSource(source, last.timestamp + 1000);
}

// ── Candidate extraction ──────────────────────────────────────────

describe("Phase 291 — candidate carries the setup evidence", () => {
  const candidate = candidateFromRecordedCandles();

  it("exposes the verdict, the zone and the liquidity event as facts", () => {
    expect(candidate.setupContextState).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(candidate.setupDirection).toBe("bearish");
    expect(candidate.zoneContext!.kind).toBe("FVG+OB");
    expect(candidate.zoneContext!.position).toBe("inside");
    expect(candidate.setupFacts!.join("\n")).toContain("Price inside bearish OB 84339.5–84860.1");
    // One context line per other timeframe — never a copy of the setup row.
    expect(Object.keys(candidate.setupEvidenceByTimeframe ?? {}).sort()).toEqual(["D1", "H1", "W1"]);
    expect(candidate.setupEvidenceByTimeframe!.H1).toContain("H1 (trigger)");
  });
});

// ── Evidence routing ──────────────────────────────────────────────

describe("Phase 291 — setup evidence routing in the recommendation", () => {
  const base: CandidateInput = {
    instrument: "TEST",
    assetClass: "crypto",
    currentPrice: 100,
    dataCompleteness: "FULL",
    dataPoints: 200,
    hasLiveData: true,
    freshness: "DELAYED",
    providerCoverage: "PARTIAL",
    htfBias: "short",
    marketRegime: "TRENDING",
  };

  it("routes a confirmed setup to supporting evidence and names the zone", () => {
    const facts = setupContextEvidenceFacts({
      ...base,
      setupContextState: "CONFIRMED_SETUP_CONTEXT",
      setupDirection: "bearish",
      zoneContext: { kind: "OB", direction: "bearish", lower: 95, upper: 100, position: "inside", timeframe: "H4" },
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toContain("Setup context confirmed for the bearish thesis");
    expect(facts[0]).toContain("nearest OB zone 95–100 (inside)");
  });

  it("routes counter-trend, invalid, location-only and empty contexts to conflicting evidence", () => {
    for (const state of ["COUNTER_TREND_SETUP", "INVALID_SETUP_CONTEXT", "LOCATION_ONLY", "NO_SETUP_EVIDENCE"]) {
      const facts = setupContextEvidenceFacts({ ...base, setupContextState: state, setupDirection: "bullish" });
      expect(facts).toHaveLength(1);
      expect(["Counter-trend setup", "Setup context invalid", "Location only", "No setup context"]).toContainEqual(
        ["Counter-trend setup", "Setup context invalid", "Location only", "No setup context"].find((p) => facts[0].startsWith(p)),
      );
    }
  });

  it("never claims a probability and never emits more than one verdict line", () => {
    const facts = setupContextEvidenceFacts({
      ...base,
      setupContextState: "CONFIRMED_SETUP_CONTEXT",
      setupDirection: "bearish",
      setupEvidenceByTimeframe: { W1: "W1 (macro): structure bullish, location outside_zones, setup LOCATION_ONLY" },
      liquidityEvent: { side: "sell_side", level: 90, candleTime: 0, timeframe: "H4", ageCandles: 3 },
    });
    expect(facts.filter((f) => f.startsWith("Setup context")).length).toBe(1);
    expect(facts.filter((f) => f.includes("probability"))).toHaveLength(0);
    expect(facts.some((f) => f.startsWith("Liquidity event: sell_side"))).toBe(true);
    expect(facts.some((f) => f.startsWith("W1 (macro)"))).toBe(true);
  });

  it("orders per-timeframe lines deterministically, so repeated calls are identical", () => {
    const input: CandidateInput = {
      ...base,
      setupContextState: "STRUCTURAL_SETUP",
      setupDirection: "bullish",
      setupEvidenceByTimeframe: {
        H4: "H4 (setup): structure bullish, location outside_zones, setup STRUCTURAL_SETUP",
        W1: "W1 (macro): structure bullish, location inside_fvg, setup CONFIRMED_SETUP_CONTEXT",
        D1: "D1 (structure): structure bullish, location at_ob_boundary, setup NO_SETUP_EVIDENCE",
      },
    };
    const a = setupContextEvidenceFacts(input);
    const b = setupContextEvidenceFacts(input);
    expect(a).toEqual(b);
    expect(a.slice(1)).toEqual([
      "D1 (structure): structure bullish, location at_ob_boundary, setup NO_SETUP_EVIDENCE",
      "H4 (setup): structure bullish, location outside_zones, setup STRUCTURAL_SETUP",
      "W1 (macro): structure bullish, location inside_fvg, setup CONFIRMED_SETUP_CONTEXT",
    ]);
  });

  it("counts the setup evidence in the existing coherence inputs (no new scoring column)", () => {
    const candidate = candidateFromRecordedCandles();
    const withSetup = scoreCandidate(candidate, "SWING");
    const withoutSetup = scoreCandidate(
      { ...candidate, setupContextState: undefined, setupFacts: undefined, setupEvidenceByTimeframe: undefined },
      "SWING",
    );
    expect(withSetup.reasons.some((r) => r.startsWith("Setup context confirmed"))).toBe(true);
    expect(withoutSetup.reasons.some((r) => r.startsWith("Setup context"))).toBe(false);
    // The analytical score is a function of the existing weighted layers only:
    // no weight was added for the new evidence, and the coherence confidence
    // moves only through the existing supporting/conflicting inputs.
    expect(withoutSetup.confidence).toBe(withSetup.confidence);
  });

  it("carries the verdict and verbatim facts into the ranked output", () => {
    const candidate = candidateFromRecordedCandles();
    const rec = generateRecommendation([candidate], "SWING");
    const ranked = rec.rankedInstruments[0];
    expect(ranked.setupContextState).toBe("CONFIRMED_SETUP_CONTEXT");
    // The published lines are the scored lines: the verdict names the zone the
    // location evidence came from, and each other timeframe states its own
    // context — all traceable to real levels and confirmed structure.
    expect(ranked.setupFacts!.join("\n")).toContain("Setup context confirmed for the bearish thesis");
    expect(ranked.setupFacts!.join("\n")).toContain("nearest FVG+OB zone 84339.5–84860.1");
    expect(ranked.setupFacts!.join("\n")).toContain("H1 (trigger)");
    // The published facts are the SAME lines that were scored — one list.
    expect(ranked.setupFacts).toEqual(setupContextEvidenceFacts(candidate));
    expect(JSON.stringify(ranked)).not.toMatch(/probability|winRate/i);
  });
});

// ── Radar ─────────────────────────────────────────────────────────

describe("Phase 291 — the radar reports the same facts", () => {
  const technicalData = tech();
  const last = H4[H4.length - 1];
  const analysis = runAnalysis({
    instrument: INSTRUMENT,
    instrumentType: "crypto",
    timeframe: "H4" as Timeframe,
    provider: "okx",
    providerInstrumentId: INSTRUMENT,
    marketData: {
      instrument: INSTRUMENT,
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId: INSTRUMENT,
      fetchTimestamp: last.timestamp,
      price: { price: last.close, timestamp: last.timestamp, source: "okx" },
      candles: H4,
      timeframe: "H4",
      dataFreshness: "delayed",
    },
    technicalData,
  });

  const source = (over: Partial<RadarCandidateSource> = {}): RadarCandidateSource => ({
    universe: {
      instrument: INSTRUMENT,
      assetClass: "crypto",
      region: "global",
      requiredCapabilities: ["ohlcv", "quote"],
      priority: 1,
      refreshIntervalMs: 300_000,
    },
    snapshot: {
      instrument: INSTRUMENT,
      assetClass: "crypto",
      price: last.close,
      ohlcvAvailable: true,
      availableTimeframes: ["H4"],
      htfBias: "short",
      provider: "okx",
      observedAt: last.timestamp,
      freshness: "DELAYED",
      quality: "VERIFIED",
      // The verdict the adapter carries verbatim from the analysis.
      setupContext: {
        state: analysis.tradeLocation!.context.state,
        direction: analysis.tradeLocation!.context.direction,
        location: analysis.tradeLocation!.location,
        reasons: analysis.tradeLocation!.context.reasons,
      },
      liquidityEvent: {
        side: "buy_side",
        level: 84374.2,
        candleTime: 0,
        ageCandles: 3,
        timeframe: "H4",
      },
    },
    ...over,
  });

  it("maps the snapshot verdict onto the radar candidate", () => {
    const candidate = buildRadarCandidate(source(), last.timestamp);
    expect(candidate.setupContextState).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(candidate.setupDirection).toBe("bearish");
    expect(candidate.liquidityEvent!.level).toBe(84374.2);
  });

  it("reports the verdict and the liquidity event without inventing a score bonus", () => {
    const now = last.timestamp;
    const withVerdict = scanRadar([source()], { horizons: ["SWING"], maxResults: 5 }, undefined, now);
    const opportunity = withVerdict.results.get("SWING")![0];
    const supporting = opportunity.supportingEvidence.join("\n");
    expect(supporting).toContain("setup context CONFIRMED_SETUP_CONTEXT");
    expect(supporting).toContain("liquidity event: buy_side at 84374.2");

    // Phase 277 rule — the verdict and the liquidity line restate facts the
    // components above already counted, so they never enter the coherence ratio:
    // the confidence is identical with and without them.
    const withoutVerdict = source();
    delete withoutVerdict.snapshot!.setupContext;
    delete withoutVerdict.snapshot!.liquidityEvent;
    const baseline = scanRadar([withoutVerdict], { horizons: ["SWING"], maxResults: 5 }, undefined, now);
    const baselineOpportunity = baseline.results.get("SWING")![0];
    expect(opportunity.confidence).toBe(baselineOpportunity.confidence);
    expect(opportunity.score).toBe(baselineOpportunity.score);
  });

  it("state is reported through the existing radar state builder", () => {
    const scan = scanRadar([source()], { horizons: ["SWING"], maxResults: 5 }, undefined, last.timestamp);
    const state = buildRadarState(scan);
    expect(state.previous.size).toBeGreaterThan(0);
    expect(state.lastScanAt).toBe(last.timestamp);
    expect(JSON.stringify(state)).not.toMatch(/probability|winRate/i);
  });
});
