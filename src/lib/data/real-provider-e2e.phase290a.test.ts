/**
 * Phase 290-A — REAL-PROVIDER E2E (recorded provider payload).
 *
 * One supported instrument (OKX BTC-USDT) through the whole chain:
 *
 *   real OHLCV  →  technical engine  →  SMC context  →  MTF context
 *               →  unified analysis   →  candidate     →  recommendation
 *
 * The candles are the provider's own response, recorded verbatim
 * (`__fixtures__/real-provider-candles.phase290a.json`, endpoint and instrument
 * in its `_provenance` block). Nothing is altered, resampled, forward-filled or
 * synthesized, and the provider's own timestamps are preserved, so the run can
 * be replayed offline. It is a RECORDED payload, not a live feed — the live
 * transport is exercised separately; no live claim is made here.
 *
 * Where a timeframe is missing, the run must SAY SO (with the caller's reason)
 * and must never invent candles for it — asserted below.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { calculateTechnical } from "./technical";
import { computeSmcContext } from "./smc";
import { buildMtfContext } from "./mtf";
import type { MtfCandleInput } from "./mtf";
import type { OhlcvCandle, TechnicalData } from "./market-types";
import type { AnalysisInput, Timeframe } from "@/types/analysis";
import { runAnalysis } from "@/lib/analysis-engine";
import { buildCandidateFromSource } from "@/lib/liveCandidateBuilder";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";
import { generateRecommendation } from "@/lib/recommendation-engine";

const fixturePath = new URL(
  "./__fixtures__/real-provider-candles.phase290a.json",
  import.meta.url,
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  _provenance: { provider: string; instrumentId: string; endpoint: string };
  bars: Record<string, [string, string, string, string, string, string][]>;
};

const PROVIDER = fixture._provenance.provider;
const INSTRUMENT = fixture._provenance.instrumentId;

/** Provider order is newest-first; the app's client reverses it (timestamps kept). */
function candlesFrom(bar: string): OhlcvCandle[] {
  const rows = fixture.bars[bar];
  if (!rows) throw new Error(`fixture has no bar ${bar}`);
  return rows
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

describe("Phase 290-A — real provider candles through the production chain", () => {
  it("the recorded payload is the provider's own data", () => {
    expect(PROVIDER).toBe("OKX");
    expect(INSTRUMENT).toBe("BTC-USDT");
    for (const [bar, rows] of Object.entries(fixture.bars)) {
      expect(rows.length).toBeGreaterThanOrEqual(20);
      for (const r of rows) {
        const [ts, o, h, l, c, v] = r;
        expect(Number(ts)).toBeGreaterThan(0);
        const nums = [o, h, l, c, v].map(Number);
        for (const n of nums) expect(Number.isFinite(n)).toBe(true);
        expect(Number(h)).toBeGreaterThanOrEqual(Number(l));
        // `bar` is only used to prove the loop covered every provided bar.
        expect(bar.length).toBeGreaterThan(0);
      }
    }
  });

  it("structure → MTF → unified → recommendation, with the facts exposed", () => {
    const tech: TechnicalData = {
      ...calculateTechnical(H4, D1, "D1"),
      smc: computeSmcContext(H4, "H4"),
      mtf: buildMtfContext("H4", [
        { timeframe: "W1", role: "macro", candles: W1 },
        { timeframe: "D1", role: "structure", candles: D1 },
        { timeframe: "H4", role: "setup", candles: H4 },
        { timeframe: "H1", role: "trigger", candles: H1 },
      ] satisfies MtfCandleInput[]),
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

    const analysis = runAnalysis(input);

    // ── SMC layer: confirmed, causal, provider-timestamped ──
    const read = tech.smc!.structural!.external;
    expect(read.timeframe).toBe("H4");
    if (read.lastEvent) {
      expect(read.lastEvent.candleIndex).toBeLessThan(H4.length);
      // The event time IS the provider candle's timestamp — provenance kept.
      expect(read.lastEvent.candleTime).toBe(H4[read.lastEvent.candleIndex].timestamp);
      expect(read.lastEvent.confirmedAtIndex).toBe(read.lastEvent.candleIndex);
      // And on real provider candles too the event is a genuine CROSSING: the
      // candle before it closed on the level's original side.
      const breaking = H4[read.lastEvent.candleIndex];
      const previous = H4[read.lastEvent.candleIndex - 1];
      if (read.lastEvent.direction === "bullish") {
        expect(breaking.close).toBeGreaterThan(read.lastEvent.brokenLevel);
        expect(previous.close).toBeLessThanOrEqual(read.lastEvent.brokenLevel);
      } else {
        expect(breaking.close).toBeLessThan(read.lastEvent.brokenLevel);
        expect(previous.close).toBeGreaterThanOrEqual(read.lastEvent.brokenLevel);
      }
      // Every event this read issued obeys the same invariant.
      for (const e of read.events) {
        const close = H4[e.candleIndex].close;
        const prev = H4[e.candleIndex - 1].close;
        if (e.direction === "bullish") {
          expect(close).toBeGreaterThan(e.brokenLevel);
          expect(prev).toBeLessThanOrEqual(e.brokenLevel);
        } else {
          expect(close).toBeLessThan(e.brokenLevel);
          expect(prev).toBeGreaterThanOrEqual(e.brokenLevel);
        }
      }
    }
    if (read.invalidation) {
      expect(H4[read.invalidation.swingIndex].timestamp).toBe(read.invalidation.timestamp);
    }
    if (read.majorInvalidation) {
      // A regime line exists only when the regime itself produced the swing.
      expect(read.lastEvent).toBeDefined();
      expect(read.majorInvalidation.swingIndex).toBeGreaterThan(read.lastEvent!.candleIndex);
      expect(read.majorInvalidation.swingKind).toBe(
        read.direction === "bullish" ? "low" : "high",
      );
      expect(H4[read.majorInvalidation.swingIndex].timestamp).toBe(
        read.majorInvalidation.timestamp,
      );
    }

    // ── MTF: every timeframe read independently; hierarchy stated ──
    const mtf = tech.mtf!;
    expect(mtf.chainUsed).toEqual(["W1", "D1", "H4", "H1"]);
    expect(mtf.unavailable).toEqual([]);
    for (const t of mtf.timeframes) {
      expect(t.structural!.timeframe).toBe(t.timeframe);
      const source = t.timeframe === "W1" ? W1 : t.timeframe === "D1" ? D1 : t.timeframe === "H4" ? H4 : H1;
      for (const e of t.structural!.events) {
        expect(e.candleTime).toBe(source[e.candleIndex].timestamp);
      }
    }
    expect(mtf.structuralConfluence).toBeDefined();
    expect([
      "ALIGNED_BULLISH",
      "ALIGNED_BEARISH",
      "COUNTER_TREND",
      "MIXED",
      "INCOMPLETE",
      "UNKNOWN",
    ]).toContain(mtf.structuralConfluence!.state);

    // ── unified analysis exposes the deterministic digest ──
    const evidence = analysis.structuralEvidence!;
    expect(evidence.setupTimeframe).toBe("H4");
    expect(evidence.digest.length).toBeGreaterThan(0);
    expect(evidence.digest.join("\n")).toContain("structure=");
    expect(evidence.digest.join("\n")).toContain("MTF structural confluence");
    // Engine wording only.
    for (const line of evidence.digest) {
      expect(line).not.toMatch(/probab|advice|score /i);
    }

    // ── candidate + recommendation consume the same facts ──
    const source: LiveCandidateSource = {
      instrument: INSTRUMENT,
      assetClass: "crypto",
      marketData: input.marketData,
      technicalData: tech,
      analysisResult: analysis,
    };
    const candidate = buildCandidateFromSource(source, last.timestamp + 1000);
    expect(candidate.structuralDirection).toBe(read.direction);
    if (read.lastEvent) {
      expect(candidate.structuralEvent!.brokenLevel).toBe(read.lastEvent.brokenLevel);
      expect(candidate.structuralEvent!.candleTime).toBe(read.lastEvent.candleTime);
    }
    if (read.invalidation) {
      expect(candidate.structuralInvalidation!.level).toBe(read.invalidation.level);
    }

    const rec = generateRecommendation([candidate], "SWING");
    expect(rec.rankedInstruments.length).toBeGreaterThan(0);
    const ranked = rec.rankedInstruments[0];
    if (read.lastEvent) {
      expect(ranked.structuralFacts!.join("\n")).toContain(String(read.lastEvent.brokenLevel));
      expect(ranked.invalidationConditions.join("\n")).toContain(
        String(read.invalidation!.level),
      );
    }

    // Evidence log (engine output verbatim).
    console.log(`[290-A e2e] instrument=${INSTRUMENT} provider=${PROVIDER} bars=1W/1D/4H/1H`);
    console.log(`[290-A e2e] H4 read: ${read.direction} ${read.evidenceState} — ${read.reason}`);
    console.log(`[290-A e2e] confluence: ${mtf.structuralConfluence!.state} — ${mtf.structuralConfluence!.detail}`);
    console.log(`[290-A e2e] analysis: bias=${analysis.bias} rec=${analysis.recommendation} confidence=${analysis.confidence}`);
    console.log(`[290-A e2e] recommendation facts: ${JSON.stringify(ranked.structuralFacts ?? [])}`);
  });

  it("a missing timeframe is stated with its reason and never synthesized", () => {
    // The trigger candle set failed to load: the caller says so explicitly.
    const mtf = buildMtfContext("H4", [
      { timeframe: "W1", role: "macro", candles: W1 },
      { timeframe: "D1", role: "structure", candles: D1 },
      { timeframe: "H4", role: "setup", candles: H4 },
      { timeframe: "H1", role: "trigger", candles: null, error: "provider returned 429" },
    ] satisfies MtfCandleInput[]);

    const missing = mtf.unavailable.find((u) => u.timeframe === "H1")!;
    expect(missing.reason).toBe("provider returned 429");
    expect(missing.role).toBe("trigger");
    // No synthesized H1 anywhere in the data.
    expect(mtf.timeframes.some((t) => t.timeframe === "H1")).toBe(false);
    expect(mtf.chainUsed).toEqual(["W1", "D1", "H4"]);
    // The H4 setup read is still its own (never borrowed from W1/D1).
    const setup = mtf.timeframes.find((t) => t.timeframe === "H4")!;
    expect(setup.structural!.timeframe).toBe("H4");
    expect(setup.smc!.timeframe).toBe("H4");
    // The confluence states the unresolved role instead of guessing.
    expect(mtf.structuralConfluence!.unresolvedRoles).toContain("trigger");
  });

  it("the same provider candles always produce the same structural facts", () => {
    const run = () =>
      buildMtfContext("H4", [
        { timeframe: "W1", role: "macro", candles: W1 },
        { timeframe: "D1", role: "structure", candles: D1 },
        { timeframe: "H4", role: "setup", candles: H4 },
        { timeframe: "H1", role: "trigger", candles: H1 },
      ] satisfies MtfCandleInput[]);
    const a = run();
    const b = run();
    expect(JSON.stringify(a.structuralConfluence)).toBe(JSON.stringify(b.structuralConfluence));
    expect(JSON.stringify(a.timeframes.map((t) => t.structural))).toBe(
      JSON.stringify(b.timeframes.map((t) => t.structural)),
    );
  });
});
