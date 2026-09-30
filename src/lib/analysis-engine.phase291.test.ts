/**
 * Phase 291 — the unified analysis result carries the TRADE LOCATION.
 *
 * The suite runs the recorded OKX chain (real provider candles, real timestamps)
 * through `runAnalysis` and asserts what the new layer contributes:
 *
 *   · one location/setup verdict for the setup timeframe, built from THIS
 *     timeframe's own objects;
 *   · every other timeframe keeps its OWN zones — nothing is copied up or down
 *     the chain, and a timeframe without a recorded observation is reported as
 *     such instead of being synthesized;
 *   · the digest lines are traceable to actual candles and levels;
 *   · the invalidation handoff exposes the real levels, each with provenance;
 *   · repeated identical calls produce identical output.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { buildChain } from "@/lib/data/mtf";
import { calculateTechnical } from "@/lib/data/technical";
import type { OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import type { AnalysisInput, AnalysisResult, Timeframe } from "@/types/analysis";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("./data/__fixtures__/real-provider-candles.phase290a.json", import.meta.url),
    "utf8",
  ),
) as {
  _provenance: { provider: string; instrumentId: string };
  bars: Record<string, [string, string, string, string, string, string][]>;
};

const PROVIDER = fixture._provenance.provider;
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

const chain = (): MtfCandleInput[] =>
  [
    { timeframe: "W1", role: "macro", candles: W1 },
    { timeframe: "D1", role: "structure", candles: D1 },
    { timeframe: "H4", role: "setup", candles: H4 },
    { timeframe: "H1", role: "trigger", candles: H1 },
  ] satisfies MtfCandleInput[];

function buildAnalysis(mtfInputs: MtfCandleInput[] = chain()): AnalysisResult {
  const tech: TechnicalData = {
    ...calculateTechnical(H4, D1, "D1"),
    smc: computeSmcContext(H4, "H4"),
    mtf: buildMtfContext("H4", mtfInputs),
  };
  const last = H4[H4.length - 1];
  const input: AnalysisInput = {
    instrument: INSTRUMENT,
    instrumentType: "crypto",
    timeframe: "H4" as Timeframe,
    provider: PROVIDER.toLowerCase(),
    providerInstrumentId: INSTRUMENT,
    marketData: {
      instrument: INSTRUMENT,
      instrumentType: "crypto",
      provider: PROVIDER.toLowerCase(),
      providerInstrumentId: INSTRUMENT,
      fetchTimestamp: last.timestamp,
      price: { price: last.close, timestamp: last.timestamp, source: PROVIDER.toLowerCase() },
      candles: H4,
      timeframe: "H4",
      dataFreshness: "delayed",
    },
    technicalData: tech,
  };
  return runAnalysis(input);
}

// ── Risk handoff fixture ──────────────────────────────────────────
// A DESIGNED candle series (test fixture, never presented as market data) that
// reaches the risk layer: confirmed structure, zones, an aligned higher-timeframe
// chain and a reward/risk ratio the gates accept. It exists so the handoff can be
// asserted end to end instead of only in the negative.

function designedUptrendSeries(): OhlcvCandle[] {
  const t0 = Date.now() - 199 * 4 * 3600_000;
  const out: OhlcvCandle[] = [];
  const push = (i: number, o: number, h: number, l: number, c: number) =>
    out.push({ timestamp: t0 + i * 4 * 3600_000, open: o, high: h, low: l, close: c, volume: 1000 });
  for (let i = 0; i < 121; i++) { const p = 100 + i * 0.5; push(i, p - 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 121; i < 125; i++) { const p = 160 + (i - 120) * 2.1; push(i, p - 0.5, p + 0.5, p - 1, p); }
  push(125, 169, 169.5, 167, 168);
  for (let i = 126; i < 138; i++) { const p = 168 - (i - 125) * 0.65; push(i, p + 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 138; i < 152; i++) { const p = 160 + (i - 138) * 1.15; push(i, p - 0.3, p + 0.5, p - 0.9, p); }
  for (let i = 152; i < 169; i++) { const p = 176 - (i - 151) * 0.82; push(i, p + 0.3, p + 0.7, p - 0.7, p); }
  for (let i = 169; i < 200; i++) { const p = 162 + (i - 168) * 0.05; push(i, p - 0.2, p + 0.4, p - 0.5, p); }
  return out;
}

function runDesignedFixture(): { result: AnalysisResult; candles: OhlcvCandle[]; smc: ReturnType<typeof computeSmcContext> } {
  const candles = designedUptrendSeries();
  const smc = computeSmcContext(candles, "H4");
  const base = calculateTechnical(candles, candles, "D1");
  const tech: TechnicalData = {
    ...base,
    // The legacy structural label the decision gates read, set exactly as the
    // Phase 1 gate fixtures do. The SMC read below stays the engine's own.
    structure: "HH/HL",
    bosDirection: "bullish",
    smc,
  };
  tech.mtf = buildMtfContext("H4", [
    { timeframe: "H4", role: "setup", candles },
    ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles } satisfies MtfCandleInput)),
  ]);
  const last = candles[candles.length - 1];
  const input: AnalysisInput = {
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
      fetchTimestamp: last.timestamp,
      price: { price: last.close, timestamp: last.timestamp, source: "fixture" },
      candles,
      timeframe: "H4",
      dataFreshness: "delayed",
    },
    technicalData: tech,
    economicEvents: "Fed signals hawkish stance, rate hike",
  } as AnalysisInput;
  return { result: runAnalysis(input), candles, smc };
}

describe("Phase 291 — the trade plan hands the risk layer its invalidation evidence", () => {
  const { result, smc } = runDesignedFixture();

  it("an actionable thesis carries the references it was derived from", () => {
    expect(result.recommendation).toBe("LONG");
    expect(result.tradePlan).toBeDefined();
    const refs = result.tradePlan!.invalidationReferences;
    expect(refs).toBeDefined();
    expect(refs!.length).toBeGreaterThan(0);
    // Exactly the engine's evidence — the plan never selects a subset by how the
    // reward/risk ratio looks.
    expect(refs).toEqual(result.tradeLocation!.invalidationEvidence);
    // Every level is a real object of this timeframe.
    const structural = refs!.find((r) => r.source === "structural_invalidation")!;
    expect(smc.structural!.external.invalidation!.level).toBe(structural.level);
    for (const ref of refs!.filter((r) => r.source === "fair_value_gap")) {
      const match = smc.fvgs.some(
        (f) => (f.direction === "bullish" ? f.lower : f.upper) === ref.level,
      );
      expect(match).toBe(true);
    }
    for (const ref of refs!.filter((r) => r.source === "order_block")) {
      const match = smc.orderBlocks.some((o) => (o.direction === "bullish" ? o.lower : o.upper) === ref.level);
      expect(match).toBe(true);
    }
    const swept = refs!.find((r) => r.source === "swept_liquidity");
    if (swept) expect(swept.level).toBe(smc.recentSweep!.level);
  });

  it("never publishes an opposing zone as the invalidation of the thesis", () => {
    const supporting = result.tradeLocation!.context.direction === "none"
      ? undefined
      : result.tradeLocation!.zones.find((z) => z.direction === result.tradeLocation!.context.direction);
    if (result.tradePlan!.zoneInvalidation) {
      expect(supporting).toBeDefined();
      expect(result.tradePlan!.zoneInvalidation!.kind).toBe(supporting!.kind);
      // The far side of the zone in the thesis direction.
      expect(result.tradePlan!.zoneInvalidation!.level).toBe(supporting!.lower);
      expect(result.tradePlan!.zoneInvalidation!.timeframe).toBe("H4");
    } else {
      expect(supporting).toBeUndefined();
    }
  });

  it("the stop level itself is unchanged by the handoff (no risk redesign)", () => {
    const stop = parseFloat(result.tradePlan!.stopLoss);
    const structural = result.tradePlan!.invalidationReferences!.find((r) => r.source === "structural_invalidation")!;
    // The stop sits beyond the structural level by the disclosed ATR buffer.
    expect(stop).toBeLessThan(structural.level);
    expect(Math.abs(structural.level - stop)).toBeLessThan(Math.abs(structural.level) * 0.01);
  });
});

describe("Phase 291 — trade location in the unified analysis (recorded OKX chain)", () => {
  const analysis = buildAnalysis();
  const location = analysis.tradeLocation!;

  it("describes the latest provider observation of the setup timeframe", () => {
    expect(location).toBeDefined();
    expect(location.setupTimeframe).toBe("H4");
    expect(location.price).toBe(H4[H4.length - 1].close);
    expect(location.atTime).toBe(H4[H4.length - 1].timestamp);
    expect(location.location).toBe("inside_ob");
    expect(location.flags.insideOb).toBe(true);
  });

  it("states the setup verdict with its components, never a probability", () => {
    expect(location.context.direction).toBe("bearish");
    expect(location.context.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(location.context.reasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(location)).not.toMatch(/probability|winRate|confidence/i);
  });

  it("quotes fact lines that are traceable to actual candles and levels", () => {
    const digest = location.setupFacts.join("\n");
    expect(digest).toContain("Price inside bearish OB 84339.5–84860.1");
    expect(digest).toContain("FVG bullish 83624.7–83760.1 (fresh, created candle 30");
    expect(digest).toContain("Confirmed BOS bearish at 83174.7 (candle 23");
    expect(digest).toContain("Setup context CONFIRMED_SETUP_CONTEXT");
    // The setup timeframe's facts are also part of the combined digest.
    expect(location.digest.slice(0, location.setupFacts.length)).toEqual(location.setupFacts);
  });

  it("keeps every timeframe on its OWN zones — nothing is copied up or down", () => {
    const rows = Object.fromEntries(location.timeframes.map((t) => [t.timeframe, t]));
    expect(Object.keys(rows).sort()).toEqual(["D1", "H1", "H4", "W1"]);
    expect(rows.H4.role).toBe("setup");
    // Each row's zone bounds come from that timeframe's own candles.
    for (const tf of ["W1", "D1", "H4"]) {
      const smc = computeSmcContext(tf === "W1" ? W1 : tf === "D1" ? D1 : H4, tf);
      const own = smc.fvgs.find((f) => f.status !== "invalidated") ?? smc.orderBlocks.find((o) => o.status !== "invalidated");
      const row = rows[tf];
      const reported = row.fvg ?? row.ob;
      if (own && reported) {
        const matchesOwn =
          (row.fvg !== undefined &&
            smc.fvgs.some((f) => f.upper === row.fvg!.upper && f.lower === row.fvg!.lower)) ||
          (row.ob !== undefined &&
            smc.orderBlocks.some((o) => o.upper === row.ob!.upper && o.lower === row.ob!.lower));
        expect(matchesOwn).toBe(true);
      }
      expect(row.externalStructure).toBe(smc.structural?.external.direction ?? "none");
    }
    // The macro and structure rows are NOT described with the H4 price.
    expect(rows.W1.location).not.toBe(rows.H4.location);
  });

  it("reports a timeframe with no recorded observation as unavailable, never synthesized", () => {
    const withoutTrigger = buildAnalysis(
      chain().map((t) => (t.timeframe === "H1" ? { ...t, candles: null, error: "provider returned 429" } : t)),
    );
    const rows = withoutTrigger.tradeLocation!.timeframes.map((t) => t.timeframe);
    expect(rows).not.toContain("H1");
    expect(rows).toContain("H4");
    // The analysis names the roles it did resolve and never mentions a
    // synthesized trigger timeframe.
    const digest = withoutTrigger.tradeLocation!.digest.join("\n");
    expect(digest).toContain("W1 (macro)");
    expect(digest).toContain("D1 (structure)");
    expect(digest).not.toContain("H1 (trigger)");
  });

  it("exposes the invalidation levels with provenance for the existing risk layer", () => {
    const evidence = location.invalidationEvidence;
    const structural = evidence.find((e) => e.source === "structural_invalidation")!;
    const obRef = evidence.find((e) => e.source === "order_block")!;
    const fvgRef = evidence.find((e) => e.source === "fair_value_gap")!;
    expect(structural.level).toBe(85199.8);
    expect(structural.note).toContain("H4 confirmed structural high");
    expect(obRef.level).toBe(84860.1);
    expect(obRef.note).toContain("84339.5–84860.1");
    expect(fvgRef.level).toBe(83624.7);
    for (const item of evidence) expect(item.timeframe).toBe("H4");
  });

  it("does not fabricate a trade plan or risk references when the decision is NO_TRADE", () => {
    expect(analysis.recommendation).toBe("NO_TRADE");
    expect(analysis.tradePlan).toBeUndefined();
  });

  it("is deterministic: the same candles produce byte-identical location output", () => {
    const again = buildAnalysis();
    expect(JSON.stringify(again.tradeLocation)).toBe(JSON.stringify(location));
  });
});
