/**
 * Phase 290-A — integration of the structural engine into the real pipeline.
 *
 * These tests drive the PRODUCTION modules (smc → mtf → technical →
 * analysis-engine → recommendation) with hand-built candles. They assert the
 * properties the phase requires and that the wiring never changes the old
 * behaviour when the new evidence is absent.
 */
import { describe, expect, it } from "vitest";

import { computeSmcContext, externalLookbackFor, INTERNAL_LOOKBACK } from "./smc";
import { buildMtfContext, buildChain } from "./mtf";
import { calculateTechnical } from "./technical";
import { readStructure, structureDigest } from "./structure";
import type { MtfCandleInput } from "./mtf";
import type { OhlcvCandle, TechnicalData } from "./market-types";
import { runAnalysis } from "@/lib/analysis-engine";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import { generateRecommendation, scoreCandidate } from "@/lib/recommendation-engine";
import { buildRadarSourcesFromLiveSources } from "@/lib/market-radar/live-source-adapter";
import { scanRadar } from "@/lib/market-radar/radar";
import type { CandidateInput } from "@/lib/recommendation-engine";

// ── Candle builders ────────────────────────────────────────────────

interface Leg {
  len: number;
  step: number;
}

/** Deterministic candle series built from price legs (no randomness). */
function series(legs: Leg[], start = 100, startTime = 1_800_000_000_000): OhlcvCandle[] {
  const candles: OhlcvCandle[] = [];
  let price = start;
  let t = startTime;
  for (const leg of legs) {
    for (let i = 0; i < leg.len; i++) {
      const open = price;
      price += leg.step;
      candles.push({
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
  return candles;
}

const TREND_UP = () =>
  series([
    { len: 12, step: 1 },
    { len: 6, step: -0.5 },
    { len: 12, step: 1 },
    { len: 6, step: -0.5 },
    { len: 12, step: 1 },
  ]);

const TREND_DOWN = () =>
  series([
    { len: 12, step: -1 },
    { len: 6, step: 0.5 },
    { len: 12, step: -1 },
    { len: 6, step: 0.5 },
    { len: 12, step: -1 },
  ]);

function baseTech(candles: OhlcvCandle[], tf: string): TechnicalData {
  const tech = calculateTechnical(candles, undefined, tf);
  return {
    ...tech,
    smc: computeSmcContext(candles, tf),
  };
}

function chainInputs(
  setup: OhlcvCandle[],
  opts: {
    macro?: OhlcvCandle[] | null;
    structure?: OhlcvCandle[] | null;
    trigger?: OhlcvCandle[] | null;
    macroError?: string;
  },
): MtfCandleInput[] {
  return [
    { timeframe: "W1", role: "macro", candles: opts.macro ?? null },
    { timeframe: "D1", role: "structure", candles: opts.structure ?? null },
    { timeframe: "H1", role: "setup", candles: setup },
    { timeframe: "M15", role: "trigger", candles: opts.trigger ?? null },
  ];
}

function analysisInput(tech: TechnicalData, candles: OhlcvCandle[]): AnalysisInput {
  const last = candles[candles.length - 1];
  return {
    instrument: "BTC-USDT",
    instrumentType: "crypto",
    timeframe: "H1",
    marketData: {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      fetchTimestamp: last.timestamp,
      price: { price: last.close, timestamp: last.timestamp, source: "okx" },
      candles,
      timeframe: "H1",
      dataFreshness: "realtime",
    },
    technicalData: tech,
  };
}

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    instrument: "BTC-USDT",
    assetClass: "crypto",
    currentPrice: 104.2,
    dataCompleteness: "FULL",
    dataPoints: 48,
    hasLiveData: true,
    freshness: "FRESH",
    providerCoverage: "PARTIAL",
    atr: 1.5,
    ...overrides,
  } as CandidateInput;
}

// ── smc.ts wiring ──────────────────────────────────────────────────

describe("Phase 290-A — SMC context carries the structural pair", () => {
  const candles = TREND_UP();
  const smc = computeSmcContext(candles, "H1");

  it("exposes both reads with the wired lookbacks", () => {
    expect(smc.structural).toBeDefined();
    const pair = smc.structural!;
    expect(pair.external.timeframe).toBe("H1");
    // The internal read is explicitly labelled as the internal half of H1.
    expect(pair.internal.timeframe).toBe("H1:internal");
    expect(pair.external.lookback).toBe(externalLookbackFor(candles.length));
    expect(pair.internal.lookback).toBe(INTERNAL_LOOKBACK);
    expect(pair.state).toBe("ALIGNED");
  });

  it("is byte-identical to a direct read with the same windows (single algorithm)", () => {
    const direct = readStructure(candles, "H1", {
      lookback: externalLookbackFor(candles.length),
    });
    expect(JSON.stringify(smc.structural!.external)).toBe(JSON.stringify(direct));
  });

  it("keeps the legacy label fields untouched for old readers", () => {
    expect(smc.internalExternal).toBeDefined();
    expect(smc.internalExternal.external.structure).toBeDefined();
    expect(smc.internalExternal.internal.structure).toBeDefined();
  });

  it("every event was confirmable with candles that existed at the time", () => {
    for (const read of [smc.structural!.external, smc.structural!.internal]) {
      for (const e of read.events) {
        expect(e.candleIndex).toBeLessThan(candles.length);
        expect(e.confirmedAtIndex).toBe(e.candleIndex);
      }
      if (read.invalidation) {
        expect(read.invalidation.swingIndex).toBeLessThan(candles.length - read.lookback + 1);
      }
    }
  });
});

// ── mtf.ts wiring ──────────────────────────────────────────────────

describe("Phase 290-A — MTF context exposes per-timeframe structural evidence", () => {
  it("each available timeframe keeps its OWN read and the chain states a confluence", () => {
    const ctx = buildMtfContext(
      "H1",
      chainInputs(TREND_UP(), {
        macro: TREND_UP(),
        structure: TREND_UP(),
        trigger: TREND_UP(),
      }),
    );
    expect(ctx.timeframes).toHaveLength(4);
    for (const t of ctx.timeframes) {
      expect(t.structural).toBeDefined();
      expect(t.structural!.timeframe).toBe(t.timeframe);
      expect(t.structuralPair).toBeDefined();
      expect(t.structuralPair!.state).toBe("ALIGNED");
    }
    expect(ctx.structuralConfluence).toBeDefined();
    expect(ctx.structuralConfluence!.state).toBe("ALIGNED_BULLISH");
    expect(ctx.structuralConfluence!.htfDirection).toBe("bullish");
    expect(ctx.structuralConfluence!.htfTimeframe).toBe("W1");
    expect(ctx.structuralConfluence!.triggerPullback).toBe(false);
    expect(ctx.htfBias).toBe("long");
  });

  it("a counter-trend setup is COUNTER_TREND, never silently re-aligned", () => {
    const ctx = buildMtfContext(
      "H1",
      chainInputs(TREND_DOWN(), {
        macro: TREND_UP(),
        structure: TREND_UP(),
        trigger: TREND_DOWN(),
      }),
    );
    expect(ctx.htfBias).toBe("long");
    expect(ctx.structuralConfluence!.state).toBe("COUNTER_TREND");
    expect(ctx.structuralConfluence!.setupDirection).toBe("bearish");
    expect(["MIXED", "COUNTER_TREND"]).toContain(ctx.alignment);
  });

  it("disagreeing higher timeframes are MIXED — the direction is never forced", () => {
    const ctx = buildMtfContext(
      "H1",
      chainInputs(TREND_UP(), {
        macro: TREND_UP(),
        structure: TREND_DOWN(),
        trigger: TREND_UP(),
      }),
    );
    expect(ctx.alignment).toBe("MIXED");
    expect(ctx.structuralConfluence!.state).toBe("MIXED");
  });

  it("an unavailable timeframe keeps its reason and is never replaced", () => {
    const ctx = buildMtfContext(
      "H1",
      chainInputs(TREND_UP(), {
        macro: null,
        structure: series([{ len: 5, step: 1 }]),
        trigger: TREND_UP(),
      }),
    );
    const reasons = ctx.unavailable.map((u) => `${u.timeframe}:${u.reason}`);
    expect(reasons.some((r) => r.startsWith("W1:"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("D1:") && r.includes("below the 20"))).toBe(true);
    // Only the timeframes that actually produced a read appear in the confluence.
    expect(ctx.timeframes.map((t) => t.timeframe)).toEqual(["H1", "M15"]);
    expect(ctx.chainUsed).toEqual(["H1", "M15"]);
    // With no macro/structure read there is no HTF evidence: the confluence
    // states that instead of promoting the setup to HTF authority.
    expect(ctx.structuralConfluence!.htfDirection).toBe("none");
    expect(ctx.structuralConfluence!.state).toBe("UNKNOWN");
    expect(ctx.structuralConfluence!.htfTimeframe).toBeUndefined();
    expect(ctx.structuralConfluence!.detail).toContain("No higher-timeframe structure");
  });

  it("the adaptive chain is unchanged by the structural layer", () => {
    expect(buildChain("H1").map((s) => `${s.role}:${s.timeframe}`)).toEqual([
      "macro:D1",
      "structure:H4",
      "trigger:M15",
    ]);
    const ctx = buildMtfContext("H1", chainInputs(TREND_UP(), { trigger: TREND_UP() }));
    expect(ctx.unavailable.map((u) => u.timeframe)).toEqual(["W1", "D1"]);
  });
});

// ── technical.ts + analysis-engine ─────────────────────────────────

describe("Phase 290-A — the analysis output carries deterministic structural facts", () => {
  const h1 = TREND_UP();
  const d1 = TREND_UP();
  const tech = {
    ...baseTech(h1, "H1"),
    htfContext: calculateTechnical(d1, undefined, "D1").htfContext,
    mtf: buildMtfContext(
      "H1",
      chainInputs(h1, { structure: d1, trigger: TREND_UP() }),
    ),
  };
  // The HTF structural evidence comes from the htfContext builder itself.
  const htfEvidence = calculateTechnical(d1, TREND_UP(), "W1").htfContext!.structuralEvidence;

  it("htfContext exposes the confirmed evidence for the HTF candles", () => {
    expect(htfEvidence).toBeDefined();
    expect(htfEvidence!.direction).toBe("bullish");
    expect(htfEvidence!.evidenceState).toBe("confirmed_event");
    expect(htfEvidence!.lastEvent!.kind).toBe("BOS");
    expect(htfEvidence!.lastEvent!.candleIndex).toBeLessThan(d1.length);
  });

  it("runAnalysis attaches the setup/chain evidence and a digest", () => {
    const result = runAnalysis(analysisInput(tech, h1));
    const evidence = result.structuralEvidence!;
    expect(evidence).toBeDefined();
    expect(evidence.setupTimeframe).toBe("H1");
    expect(evidence.timeframes.map((t) => t.role)).toEqual(["setup", "structure", "trigger"]);
    expect(evidence.confluence!.state).toBe("ALIGNED_BULLISH");
    expect(evidence.digest.join("\n")).toContain("structure=");
    expect(evidence.digest.join("\n")).toContain("structural confluence");
  });

  it("the structural evidence is facts only — no probability, no confidence field", () => {
    const result = runAnalysis(analysisInput(tech, h1));
    const serialized = JSON.stringify(result.structuralEvidence);
    expect(serialized).not.toMatch(/probab/i);
    expect(serialized).not.toMatch(/confidence/i);
    expect(serialized).not.toMatch(/%/);
  });

  it("adding the structural layer does not change the decision", () => {
    const without = runAnalysis(analysisInput(baseTech(h1, "H1"), h1));
    const withLayer = runAnalysis(analysisInput(tech, h1));
    expect(withLayer.bias).toBe(without.bias);
    expect(withLayer.recommendation).toBe(without.recommendation);
    expect(withLayer.breakdown).toEqual(without.breakdown);
  });

  it("repeated runs produce identical results (deterministic)", () => {
    const a = runAnalysis(analysisInput(tech, h1));
    const b = runAnalysis(analysisInput(tech, h1));
    expect(JSON.stringify(a.structuralEvidence)).toBe(JSON.stringify(b.structuralEvidence));
    expect(a.decisionFingerprint).toBe(b.decisionFingerprint);
  });

  it("when the engine has no read, the field is simply absent (never fabricated)", () => {
    const flat = series([{ len: 40, step: 0 }]);
    const result = runAnalysis(analysisInput(baseTech(flat, "H1"), flat));
    // A flat series cannot confirm a swing; the read is explicit, never invented.
    const read = computeSmcContext(flat, "H1").structural!.external;
    // Equal highs/lows are swing candidates but nothing closes beyond them:
    // the engine reports no event (or no confirmed swings) — never a break.
    expect(["no_event", "no_confirmed_swings"]).toContain(read.evidenceState);
    expect(read.lastEvent).toBeUndefined();
    expect(read.direction).toBe("none");
    expect(read.reason.length).toBeGreaterThan(0);
    if (result.structuralEvidence) {
      const setup = result.structuralEvidence.timeframes.find((t) => t.role === "setup")!;
      expect(setup.event).toBeUndefined();
      expect(setup.evidenceState).toBe(read.evidenceState);
      expect(setup.reason.length).toBeGreaterThan(0);
    }
  });
});

// ── recommendation / radar evidence assembly ───────────────────────

describe("Phase 290-A — recommendation consumes the structural evidence", () => {
  const withStructure = candidate({
    htfBias: "long",
    mtfAlignment: "ALIGNED_BULLISH",
    structuralDirection: "bullish",
    structuralEvent: {
      kind: "BOS",
      direction: "bullish",
      brokenLevel: 103.0,
      candleTime: 1_800_000_000_000,
      timeframe: "H1",
    },
    structuralInvalidation: { level: 100.0, timeframe: "H1", swingKind: "low" },
    structuralPairState: "ALIGNED",
  });

  it("scores identically to the label-only candidate (no invented weighting)", () => {
    const labelOnly = candidate({ htfBias: "long", mtfAlignment: "ALIGNED_BULLISH" });
    const a = scoreCandidate(labelOnly, "INTRADAY");
    const b = scoreCandidate(withStructure, "INTRADAY");
    expect(b.analyticalScore).toBe(a.analyticalScore);
  });

  it("surfaces the facts in engine wording, with the event time", () => {
    const scored = scoreCandidate(withStructure, "INTRADAY");
    const facts = scored.structuralFacts.join("\n");
    expect(facts).toContain("confirmed BOS at 103");
    expect(facts).toContain("Structural invalidation 100");
    expect(facts).toContain("2027-01-15T08:00:00.000Z");
    expect(scored.reasons.join("\n")).toContain("confirmed BOS at 103");
  });

  it("an internal counter-trend is a conflict, never a silent re-rating", () => {
    const scored = scoreCandidate(
      candidate({ ...withStructure, structuralPairState: "INTERNAL_COUNTERTREND" }),
      "INTRADAY",
    );
    expect(scored.conflicts.join("\n")).toContain("counter-trend");
    expect(scored.analyticalScore).toBe(scoreCandidate(withStructure, "INTRADAY").analyticalScore);
  });

  it("the ranking names the structural invalidation level", () => {
    const rec = generateRecommendation([withStructure], "INTRADAY");
    const ranked = rec.rankedInstruments[0];
    expect(ranked.structuralFacts!.join("\n")).toContain("confirmed BOS at 103");
    expect(ranked.invalidationConditions.join("\n")).toContain("100");
    expect(ranked.invalidationConditions).toContain("structural reversal on HTF");
  });

  it("the radar reports the confirmed facts and names the invalidation level", () => {
    const candles = TREND_UP();
    const localTech: TechnicalData = {
      ...baseTech(candles, "H1"),
      htfContext: calculateTechnical(candles, undefined, "D1").htfContext,
      mtf: buildMtfContext("H1", chainInputs(candles, { structure: candles, trigger: candles })),
    };
    const marketData = analysisInput(localTech, candles).marketData!;
    const analysis = runAnalysis(analysisInput(localTech, candles));
    const [source] = buildRadarSourcesFromLiveSources([
      {
        instrument: "BTC-USDT",
        assetClass: "crypto",
        marketData,
        technicalData: localTech,
        analysisResult: analysis,
      },
    ]);
    const setupRead = analysis.structuralEvidence!.timeframes.find((t) => t.role === "setup")!;
    expect(setupRead.event).toBeDefined();
    expect(source.snapshot!.structuralEvent!.brokenLevel).toBe(setupRead.event!.brokenLevel);
    expect(source.snapshot!.structuralInvalidation!.level).toBe(setupRead.invalidation!.level);

    // Evaluated just after the provider's last candle — never before it, or the
    // snapshot would read as future-dated and be ineligible.
    const evalNow = candles[candles.length - 1].timestamp + 60_000;
    const scan = scanRadar(
      [source],
      { horizons: ["INTRADAY"], maxResults: 10 },
      undefined,
      evalNow,
    );
    const opp = scan.results.get("INTRADAY")![0];
    expect(opp.supportingEvidence.join("\n")).toContain(
      `confirmed ${setupRead.event!.kind} ${setupRead.event!.direction} through ${setupRead.event!.brokenLevel}`,
    );
    expect(opp.invalidationConditions.join("\n")).toContain(
      `confirmed close beyond ${setupRead.invalidation!.level}`,
    );
  });

  it("a candidate without structural evidence keeps the old output shape", () => {
    const rec = generateRecommendation(
      [candidate({ htfBias: "long", mtfAlignment: "MIXED" })],
      "INTRADAY",
    );
    const ranked = rec.rankedInstruments[0];
    expect(ranked.structuralFacts).toBeUndefined();
    expect(ranked.invalidationConditions).toContain("structural reversal on HTF");
  });
});

// ── causality / lookahead regression ───────────────────────────────

describe("Phase 290-A — causality across the whole pipeline", () => {
  const full = TREND_UP();

  it("past events never change when later candles are appended", () => {
    const prefixEvents = readStructure(full.slice(0, 26), "H1", { lookback: 5 }).events;
    const fullEvents = readStructure(full, "H1", { lookback: 5 }).events;
    const past = fullEvents.filter((e) => e.candleIndex < 26);
    expect(JSON.stringify(past)).toBe(JSON.stringify(prefixEvents));
  });

  it("the MTF chain is causal per timeframe", () => {
    const short = buildMtfContext(
      "H1",
      chainInputs(full.slice(0, 30), { structure: TREND_UP().slice(0, 30) }),
    );
    const long = buildMtfContext("H1", chainInputs(full, { structure: TREND_UP() }));
    const shortRead = short.timeframes.find((t) => t.timeframe === "H1")!.structural!;
    const longRead = long.timeframes.find((t) => t.timeframe === "H1")!.structural!;
    for (const e of shortRead.events) {
      const same = longRead.events.find((x) => x.candleIndex === e.candleIndex);
      expect(same).toBeDefined();
      expect(JSON.stringify(same)).toBe(JSON.stringify(e));
    }
  });

  it("digests are stable strings whose timestamps come from the event candle", () => {
    const read = readStructure(full, "H1", { lookback: 5 });
    expect(structureDigest(read)).toEqual(structureDigest(read));
    const event = read.lastEvent!;
    const iso = structureDigest(read).find((line) => line.includes("latest BOS"))!;
    // The timestamp is the EVENT CANDLE's own time — never a clock read.
    expect(iso).toContain(new Date(event.candleTime).toISOString());
    expect(full[event.candleIndex].timestamp).toBe(event.candleTime);
  });
});

// ── end-to-end helper used by the real-candle run ──────────────────

export function runPipelineForRealCandles(
  setup: OhlcvCandle[],
  higher: OhlcvCandle[],
): { analysis: AnalysisResult; recommendation: ReturnType<typeof generateRecommendation> } {
  const tech: TechnicalData = {
    ...baseTech(setup, "H1"),
    htfContext: calculateTechnical(higher, undefined, "D1").htfContext,
    mtf: buildMtfContext(
      "H1",
      chainInputs(setup, { structure: higher, trigger: series([{ len: 24, step: 0.2 }]) }),
    ),
  };
  const analysis = runAnalysis(analysisInput(tech, setup));
  const recommendation = generateRecommendation(
    [
      candidate({
        structuralEvent: tech.smc?.structural?.external.lastEvent
          ? {
              kind: tech.smc.structural.external.lastEvent.kind,
              direction: tech.smc.structural.external.lastEvent.direction,
              brokenLevel: tech.smc.structural.external.lastEvent.brokenLevel,
              candleTime: tech.smc.structural.external.lastEvent.candleTime,
              timeframe: "H1",
            }
          : undefined,
        structuralInvalidation: tech.smc?.structural?.external.invalidation
          ? {
              level: tech.smc.structural.external.invalidation.level,
              timeframe: "H1",
              swingKind: tech.smc.structural.external.invalidation.swingKind,
            }
          : undefined,
        structuralPairState: tech.smc?.structural?.state,
        htfBias: analysis.structuralEvidence?.confluence?.htfDirection === "bullish" ? "long" : "short",
        mtfAlignment: analysis.mtfSummary?.alignment,
        currentPrice: setup[setup.length - 1].close,
      }),
    ],
    "INTRADAY",
  );
  return { analysis, recommendation };
}
