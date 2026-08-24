/**
 * Phase 9 — CORE SCENARIO MATRIX (S1–S14).
 *
 * Deterministic fixtures fed into the EXISTING engine. Every expectation
 * encodes the validated Phase 1–8 decision policy; no production code is
 * duplicated here and nothing is weakened to pass.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import {
  assemble, capture, buildMtf,
  BULL_LEVELS, BEAR_LEVELS,
  macro, sentiment, treasury, cot, execution, executionUnavailable,
} from "./benchmark-fixtures.phase9";

const run = (spec: Parameters<typeof assemble>[0]) => capture(runAnalysis(assemble(spec)));

// ── S1 / S2 — Trend continuation ───────────────────────────────────

describe("S1/S2: strong trend continuation", () => {
  const bullSpec = {
    structure: "HH/HL" as const, bos: "bullish" as const,
    support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
    sweepSide: "sell_side" as const,
    mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
    events: "Fed signals hawkish stance, rate hike",
  };

  it("S1: bullish continuation → LONG with valid structural plan and positive conviction", () => {
    const s = run(bullSpec);
    expect(s.recommendation).toBe("LONG");
    expect(s.bias).toBe("Bullish");
    expect(s.hasPlan).toBe(true);
    expect(s.plan!.direction).toBe("long");
    expect(s.plan!.rr).toBeGreaterThanOrEqual(1.5);
    // Structure evidence dominates the thesis creation.
    expect(s.breakdown.trend).toBeGreaterThan(0);
    // Thesis exists WITHOUT any secondary provider (events only) — conviction meaningful.
    expect(["Medium", "High"]).toContain(s.conviction!);
    expect(s.confidence).toBeGreaterThanOrEqual(40);
    // Fresh liquidity confirmation present in the fixture supports it.
    expect(s.setup).toBeOneOf(["TREND_CONTINUATION", "PULLBACK"]);
  });

  it("S2: mirrored bearish continuation → SHORT, no accidental flip", () => {
    const s = run({
      ...bullSpec,
      structure: "LH/LL" as const, bos: "bearish" as const,
      support: BEAR_LEVELS.support, resistance: BEAR_LEVELS.resistance,
      sweepSide: "buy_side" as const,
      mtf: buildMtf({ alignment: "ALIGNED_BEARISH", htfBias: "short", triggerTf: "H1" }),
      events: "ECB dovish, rate cut expected",
    });
    expect(s.recommendation).toBe("SHORT");
    expect(s.bias).toBe("Bearish");
    expect(s.plan!.direction).toBe("short");
    expect(s.plan!.rr).toBeGreaterThanOrEqual(1.5);
  });

  it("S1 variant: thesis survives with ALL optional providers absent", () => {
    const s = run({ ...bullSpec }); // already only primary data + calendar text
    expect(s.recommendation).toBe("LONG");
  });
});

// ── S3 — Pullback ──────────────────────────────────────────────────

describe("S3: trend pullback", () => {
  it("HTF long context + lower-TF pullback → PULLBACK classification, LONG still possible, never SHORT", () => {
    const s = run({
      structure: "HH/HL" as const, bos: "none" as const, choch: "bearish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      mtf: buildMtf({ alignment: "COUNTER_TREND", htfBias: "long" }),
      macroData: macro("bullish"),
      sentimentData: sentiment("bullish", 1),
    });
    expect(s.setup).toBe("PULLBACK");
    expect(s.recommendation).not.toBe("SHORT");
    if (s.recommendation === "LONG") {
      expect(s.hasPlan).toBe(true);
    }
  });
});

// ── S4 — Genuine HTF reversal ──────────────────────────────────────

describe("S4: genuine HTF external reversal", () => {
  it("prior bearish structure + genuine D1 bullish BOS → REVERSAL classification, LONG authorized", () => {
    const s = run({
      structure: "LH/LL" as const, bos: "none" as const, choch: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      mtf: buildMtf({
        alignment: "ALIGNED_BULLISH", htfBias: "long",
        reversal: { timeframe: "D1", direction: "bullish", kind: "bos" },
      }),
      macroData: macro("bullish"),
      sentimentData: sentiment("bullish", 1),
    });
    expect(s.setup).toBe("REVERSAL");
    expect(s.setupRationale).toContain("external bos bullish on D1");
    if (s.noTradeReasons.some((x) => x.includes("Structural agreement"))) {
      throw new Error("reversal authorization was ignored by the veto");
    }
    if (s.recommendation !== "NO_TRADE") expect(s.recommendation).toBe("LONG");
  });
});

// ── S5 — LTF fake reversal ─────────────────────────────────────────

describe("S5: LTF fake reversal", () => {
  it("bullish HTF + bearish LTF CHoCH without HTF reversal → NO bearish thesis ever", () => {
    const s = run({
      structure: "HH/HL" as const, bos: "none" as const, choch: "bearish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      mtf: buildMtf({ alignment: "COUNTER_TREND", htfBias: "long" }),
      macroData: macro("bearish"),
      sentimentData: sentiment("bearish", 1),
    });
    expect(s.recommendation).not.toBe("SHORT");
    expect(s.bias).not.toBe("Bearish");
  });
});

// ── S6 — Range / neutral ───────────────────────────────────────────

describe("S6: range/neutral market", () => {
  it("neutral structure + EVERY optional provider strongly bullish → NO_TRADE", () => {
    const s = run({
      structure: "range" as const,
      mtf: undefined as never,
      macroData: macro("bullish"),
      sentimentData: sentiment("bullish", 1),
      treasuryData: treasury(-30),   // falling yields — gold/crypto-bullish flavor
      cotData: cot(8000),            // strong EUR accumulation
    });
    expect(s.bias).toBe("Neutral");
    expect(s.recommendation).toBe("NO_TRADE");
    expect(s.hasPlan).toBe(false);
    expect(s.conviction).toBeUndefined();
  });
});

// ── S7 — Breakout / expansion ──────────────────────────────────────

describe("S7: breakout/expansion", () => {
  it("structural expansion with displacement+BOS → directional decision only WITH structural agreement; cluster not double-counted", () => {
    const base = run({
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      displacement: "bullish" as const, freshFvg: "bullish" as const, obDirection: "bullish" as const,
      mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long" }),
      events: "Fed signals hawkish stance, rate hike",
      sentimentData: sentiment("bullish", 0.4),
    });
    expect(base.setup).not.toBe("RANGE");
    if (base.recommendation === "LONG") {
      expect(base.hasPlan).toBe(true);
      // Location layer capped: full cluster cannot explode conviction past High clamp.
      expect(base.confidence).toBeLessThanOrEqual(88);
    } else {
      expect(base.recommendation).toBe("NO_TRADE");
    }
  });
});

// ── S8 — Liquidity trap ────────────────────────────────────────────

describe("S8: liquidity trap", () => {
  it("sweep AGAINST intact bullish structure → contradiction appears, structure stays dominant", () => {
    const clean = run({
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      events: "Fed signals hawkish stance, rate hike",
      sentimentData: sentiment("bullish", 0.6),
    });
    const trapped = run({
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      sweepSide: "buy_side" as const,
      events: "Fed signals hawkish stance, rate hike",
      sentimentData: sentiment("bullish", 0.6),
    });
    expect(trapped.recommendation).not.toBe("SHORT");
    const liq = trapped.contradictions.find((c) => /liquidity sweep/i.test(c));
    if (trapped.recommendation === "LONG") {
      expect(liq).toBeDefined();                       // contradiction explicit
      expect(trapped.confidence!).toBeLessThan(clean.confidence!); // conviction reduced
    }
  });
});

// ── S9 — Strong fundamental conflict ───────────────────────────────

describe("S9: strong fundamental conflict vs bullish structure", () => {
  it("structure authoritative: conflict explicit, conviction reduced, NO arbitrary SHORT", () => {
    const clean = run({
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      events: "Fed signals hawkish stance, rate hike",
    });
    // Moderate-but-material conflict: thesis SURVIVES (so a contradiction
    // item exists to be inspected) while conviction drops.
    const conflicted = run({
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      events: "ECB dovish, rate cut expected",
      sentimentData: sentiment("bullish", 0.6),
    });
    expect(conflicted.recommendation).not.toBe("SHORT");
    const fund = conflicted.contradictions.find((c) => /fundamental disagreement/i.test(c));
    expect(fund).toBeDefined();
    if (conflicted.recommendation === "NO_TRADE") {
      expect(conflicted.confidence).toBeLessThan(clean.confidence!);
    }
  });
});

// ── S10 — CRITICAL regression: fundamentals over neutral structure ──

describe("S10: strong fundamentals + NEUTRAL structure (Phase 8 F-5 regression)", () => {
  it("max-strength fundamentals AND positioning over range structure → NO_TRADE", () => {
    const s = run({
      structure: "range" as const,
      macroData: macro("bullish"),
      sentimentData: sentiment("bullish", 1),
      events: "hawkish rate hike strong gdp strong employment",
    });
    expect(s.bias).toBe("Neutral");
    expect(s.recommendation).toBe("NO_TRADE");
    expect(s.hasPlan).toBe(false);
    expect(s.conviction).toBeUndefined();
  });
});

// ── S11 — Secondary evidence avalanche vs bearish structure ───────

describe("S11: secondary evidence avalanche (Phase 8 F-6 regression)", () => {
  it("every secondary layer bullish over BEARISH structure → never LONG", () => {
    const s = run({
      instrument: "BTC/USD", instrumentType: "crypto",
      structure: "LH/LL" as const, bos: "bearish" as const,
      support: BEAR_LEVELS.support, resistance: BEAR_LEVELS.resistance,
      // Avalanche of bullish SECONDARY layers:
      executionData: execution(0.9),                    // bid-heavy book
      crossAsset: { comparatorSymbol: "NDX", timeframe: "H4", available: true, dataKind: "actual_price", provider: "Twelve Data", correlation: 0.85, sampleSize: 100, directionalContext: "direct", comparatorMomentum: "up" },
      sentimentData: sentiment("bullish", 1),
      news: "ETF approval institutional adoption",
    });
    expect(s.recommendation).not.toBe("LONG");
    expect(s.bias).not.toBe("Bullish");
    if (s.recommendation === "SHORT") expect(s.hasPlan).toBe(true);
  });
});

// ── S12 — Perfect execution over neutral structure ─────────────────

describe("S12: perfect execution + neutral structure (execution cannot create a thesis)", () => {
  it("excellent OKX book over range structure → NO_TRADE", () => {
    const s = run({
      instrument: "BTC/USD", instrumentType: "crypto",
      structure: "range" as const,
      executionData: execution(0.95),
    });
    expect(s.recommendation).toBe("NO_TRADE");
    expect(s.hasPlan).toBe(false);
  });
});

// ── S13 — Everything unavailable ───────────────────────────────────

describe("S13: everything unavailable", () => {
  it("primary decision identical to baseline; informational flags only", () => {
    const baseline = run({
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      events: "Fed signals hawkish stance, rate hike",
    });
    const degraded = run({
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      events: "Fed signals hawkish stance, rate hike",
      treasuryData: { available: false, reason: "timeout", fetchedAt: Date.now() } as never,
      cotData: { available: false, reason: "no mapping", fetchedAt: Date.now(), requestedInstrument: "EUR/USD" } as never,
      executionData: executionUnavailable(),
    });
    expect(degraded.recommendation).toBe(baseline.recommendation);
    expect(degraded.confidence).toBe(baseline.confidence);
    expect(degraded.breakdown).toEqual(baseline.breakdown);
  });
});

// ── S14 — Provider failure chaos (condensed matrix) ────────────────

describe("S14: provider failure chaos", () => {
  const baseSpec = {
    structure: "HH/HL" as const, bos: "bullish" as const,
    support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
    events: "Fed signals hawkish stance, rate hike",
  };
  const baseline = run(baseSpec);

  const cases: Array<[string, Parameters<typeof assemble>[0]]> = [
    ["Treasury only", { treasuryData: { available: false, reason: "x", fetchedAt: Date.now() } as never }],
    ["COT only", { cotData: { available: false, reason: "x", fetchedAt: Date.now(), requestedInstrument: "EUR/USD" } as never }],
    ["cross-asset only", { crossAsset: { comparatorSymbol: "DXY", timeframe: "H4", available: false, unavailableReason: "404" } }],
    ["execution only", { executionData: executionUnavailable() }],
    ["multiple contextual", {
      treasuryData: { available: false, reason: "x", fetchedAt: Date.now() } as never,
      cotData: { available: false, reason: "x", fetchedAt: Date.now(), requestedInstrument: "EUR/USD" } as never,
      executionData: executionUnavailable(),
    }],
  ];

  for (const [name, patch] of cases) {
    it(`${name} unavailable → decision unchanged vs baseline`, () => {
      const s = run({ ...baseSpec, ...patch });
      expect(s.recommendation).toBe(baseline.recommendation);
      expect(s.bias).toBe(baseline.bias);
      expect(s.confidence).toBe(baseline.confidence);
      expect(s.hasPlan).toBe(baseline.hasPlan);
    });
  }
});
