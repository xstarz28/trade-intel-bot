/**
 * Phase 13 P10/P4/P5 — adversarial production scenarios and determinism
 * gaps not covered by earlier suites:
 *   · Infinity-valued provider payloads (beyond the Phase-12 NaN fixes)
 *   · shape-drifted / empty-object optional contexts
 *   · reversal authority vs unanimous bearish secondaries
 *   · fetchedAt-only variation and input key-order invariance
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import {
  assemble,
  buildMtf,
  BULL_LEVELS,
  macro,
  sentiment,
  treasury,
  cot,
  execution,
} from "./benchmark-fixtures.phase9";

const run = (spec: Parameters<typeof assemble>[0] = {}) =>
  runAnalysis({ ...assemble(spec), ...spec } as never);

const BULL = {
  structure: "HH/HL" as const,
  bos: "bullish" as const,
  support: BULL_LEVELS.support,
  resistance: BULL_LEVELS.resistance,
  sweepSide: "sell_side" as const,
  mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
  events: "Fed signals hawkish stance, rate hike",
};
const NEUTRAL = {};

describe("adversarial payload shapes", () => {
  it("Treasury with INFINITY values → finite confidence, no directional leak", () => {
    const base = run(BULL);
    const inf = JSON.parse(JSON.stringify(treasury(500)));
    inf.latest.nominal.nominal["10Y"] = Infinity;
    const r = run({ ...BULL, treasuryData: inf });
    expect(Number.isFinite(r.confidence)).toBe(true);
    expect(r.decisionTrace!.convictionBreakdown.layers.find((l) => l.layer === "Macro Yield")!.contribution).toBe(0);
    expect(r.confidence).toBe(base.confidence); // I5: malformed ≠ penalty/bonus
    expect(r.decisionFingerprint).toBe(base.decisionFingerprint);
  });

  it("COT with INFINITY open interest → zero evidence path", () => {
    const base = run(BULL);
    const bad = JSON.parse(JSON.stringify(cot(400)));
    bad.latest.openInterest = Infinity;
    const r = run({ ...BULL, cotData: bad });
    expect(Number.isFinite(r.confidence)).toBe(true);
    expect(r.decisionFingerprint).toBe(base.decisionFingerprint);
  });

  it("optional context reduced to an EMPTY OBJECT → no crash, no evidence", () => {
    for (const extra of [
      { treasuryData: {} },
      { cotData: {} },
      { eiaData: {} },
      { executionData: {} },
      { macroData: {} },
      { sentimentData: {} },
    ]) {
      const input = { ...assemble(BULL), ...extra };
      expect(() => runAnalysis(input as never)).not.toThrow();
      const r = runAnalysis(input as never);
      expect(["LONG", "SHORT", "NO_TRADE"]).toContain(r.recommendation);
    }
  });

  it("execution context available-but-shapeless contributes nothing", () => {
    const base = run(BULL);
    const r = run({ ...BULL, executionData: { available: true } as never });
    expect(r.recommendation).toBe(base.recommendation);
    expect(Number.isFinite(r.confidence)).toBe(true);
  });
});

describe("hierarchy under unanimous secondary pressure", () => {
  const maxBullishSecondaries = {
    macroData: macro("bullish"),
    sentimentData: sentiment("bullish", 1),
    treasuryData: treasury(60),
    cotData: cot(2000),
    executionData: execution(0.95),
  };

  it("neutral structure + EVERY optional provider maximally bullish → NO_TRADE", () => {
    const r = run({ ...NEUTRAL, ...maxBullishSecondaries });
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.positionSizing).toBeUndefined();
    expect(r.bias).toBe("Neutral");
  });

  it("genuine bullish HTF reversal + opposing secondaries → LONG or NO_TRADE, never SHORT-flip", () => {
    // Validated S4 framing: prior bearish EXTERNAL label, early bullish CHoCH,
    // genuine D1 external BOS reversal authorizes a LONG thesis. Secondaries
    // may dampen conviction but can neither revoke the authorization nor
    // manufacture an opposing SHORT.
    const r = run({
      structure: "LH/LL" as const,
      bos: "none" as const,
      choch: "bullish" as const,
      support: BULL_LEVELS.support,
      resistance: BULL_LEVELS.resistance,
      sweepSide: "buy_side" as const,
      mtf: buildMtf({
        alignment: "ALIGNED_BULLISH",
        htfBias: "long",
        triggerTf: "H1",
        reversal: { timeframe: "D1", direction: "bullish", kind: "bos" },
      }),
      events: "ECB dovish, rate cut expected",
      macroData: macro("bearish"),
      sentimentData: sentiment("bearish", 1),
      treasuryData: treasury(-60), // bearish-for-risk context
    });
    expect(["LONG", "NO_TRADE"]).toContain(r.recommendation);
    if (r.recommendation === "LONG") {
      expect(r.tradePlan!.direction).toBe("long");
      expect(r.tradePlan!.riskReward).toBeGreaterThanOrEqual(1.5);
      expect(r.decisionTrace!.failedGates).toEqual([]);
    } else {
      expect(r.tradePlan).toBeUndefined();
    }
  });
});

describe("determinism gaps", () => {
  it("fetchedAt-only change → identical decision AND fingerprint", () => {
    const a = run({ ...BULL, treasuryData: treasury(20) });
    const b = run({ ...BULL, treasuryData: { ...treasury(20), fetchedAt: treasury(20).fetchedAt + 555_555 } });
    expect(b.confidence).toBe(a.confidence);
    expect(b.decisionFingerprint).toBe(a.decisionFingerprint);
  });

  it("input object KEY ORDER does not affect decision or fingerprint", () => {
    const plain = { ...assemble(BULL), ...{ instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish") } };
    const reordered: Record<string, unknown> = {};
    for (const k of Object.keys(plain).reverse()) reordered[k] = (plain as Record<string, unknown>)[k];
    const a = runAnalysis(plain as never);
    const b = runAnalysis(reordered as never);
    expect(b.recommendation).toBe(a.recommendation);
    expect(b.confidence).toBe(a.confidence);
    expect(b.decisionFingerprint).toBe(a.decisionFingerprint);
  });

  it("provider metadata additions (parseWarnings etc.) cannot drift the decision", () => {
    const base = run(BULL);
    const noisyCot = { ...cot(300), parseWarnings: ["unknown field ignored"], sourceNote: "x" };
    const r = run({
      ...BULL,
      cotData: noisyCot as never,
    });
    // The unknown metadata fields are dropped by typed parsing — decision stable.
    expect(r.decisionFingerprint).toBe(
      run({ ...BULL, cotData: cot(300) }).decisionFingerprint,
    );
    void base;
  });
});
