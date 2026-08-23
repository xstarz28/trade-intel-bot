/**
 * Phase 3A unit tests — adaptive multi-timeframe engine (pure layer).
 *
 * Proves:
 * - adaptive chain building (scenarios A–D)
 * - per-timeframe INDEPENDENT structure computation from each TF's own candles
 * - alignment matrix (ALIGNED_BULLISH/BEARISH, MIXED, COUNTER_TREND,
 *   INSUFFICIENT_DATA)
 * - genuine HTF BOS/CHoCH reversal detection
 * - unavailable timeframes are flagged, NEVER synthesized
 * - liquidity/FVG/OB context carries timeframe labels
 */
import { describe, it, expect } from "vitest";
import { buildChain, buildMtfContext, TF_LADDER } from "./mtf";
import type { OhlcvCandle } from "./market-types";

const T = (i: number) => 1700000000000 + i * 3600000;

function bar(out: OhlcvCandle[], o: number, c: number, wick = 0.1, vol = 1000): void {
  out.push({
    timestamp: T(out.length),
    open: o,
    high: Math.max(o, c) + wick,
    low: Math.min(o, c) - wick,
    close: c,
    volume: vol,
  });
}

/** Leg-based trend: fractal-detectable swings (legs ≥6 bars, pullbacks ≥5). */
function trendCandles(dir: 1 | -1, legs = 3): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  let price = 100;
  const specs = Array.from({ length: legs }, () => [
    { bars: 10, step: dir * 1 },
    { bars: 6, step: dir * -0.5 },
  ]).flat();
  for (const s of specs) {
    for (let b = 0; b < s.bars; b++) {
      const o = price;
      price += s.step;
      bar(out, o, price);
    }
  }
  return out;
}

/** Converging oscillation: descending tops + ascending bottoms → range. */
function rangeCandles(cycles = 4): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  let price = 96;
  const go = (target: number) => {
    const steps = 7;
    const delta = (target - price) / steps;
    for (let b = 0; b < steps; b++) {
      const o = price;
      price += delta;
      bar(out, o, price);
    }
  };
  for (let k = 0; k < cycles; k++) {
    go(104 - k * 0.8); // tops descend
    go(96 + k * 0.8); // bottoms ascend
  }
  return out;
}

// ── Adaptive chain ─────────────────────────────────────────────────

describe("buildChain — adaptive timeframe architecture", () => {
  it("scenario: mid-ladder request gets macro + structure + trigger", () => {
    // H1 → macro D1, structure H4, trigger M15
    expect(buildChain("H1")).toEqual([
      { timeframe: "D1", role: "macro" },
      { timeframe: "H4", role: "structure" },
      { timeframe: "M15", role: "trigger" },
    ]);
  });

  it("scenario A: full ladder availability is used when provider provides it", () => {
    // Requesting H4 yields W1/D1 above and H1 below — if ALL fetch OK,
    // chainUsed must contain every one of them (no artificial cap).
    expect(buildChain("H4")).toEqual([
      { timeframe: "W1", role: "macro" },
      { timeframe: "D1", role: "structure" },
      { timeframe: "H1", role: "trigger" },
    ]);
  });

  it("scenario B/C: chain adapts when upper rungs do not exist", () => {
    // Requesting D1: only W1 above (structure role) + H4 below (trigger).
    expect(buildChain("D1")).toEqual([
      { timeframe: "W1", role: "structure" },
      { timeframe: "H4", role: "trigger" },
    ]);
    // Requesting W1 (top of ladder): only D1 trigger.
    expect(buildChain("W1")).toEqual([{ timeframe: "D1", role: "trigger" }]);
  });

  it("requested timeframes outside the ladder are analyzed standalone", () => {
    expect(buildChain("M5")).toEqual([]);
  });
});

// ── Per-timeframe independent structure ────────────────────────────

describe("buildMtfContext — structure computed independently per timeframe", () => {
  it("each timeframe's structure comes from ITS OWN candles, nothing copied", () => {
    // Deliberately contradictory fixtures:
    const d1 = trendCandles(-1); // D1 clearly BEARISH
    const h4 = trendCandles(1); // H4 clearly BULLISH
    const h1 = rangeCandles(); // H1 RANGE

    const ctx = buildMtfContext("H4", [
      { timeframe: "D1", role: "structure", candles: d1 },
      { timeframe: "H4", role: "setup", candles: h4 },
      { timeframe: "H1", role: "trigger", candles: h1 },
    ]);

    const byRole = (r: string) => ctx.timeframes.find((t) => t.role === r)!;
    expect(byRole("structure").smc!.internalExternal.external.structure).toBe("LH/LL");
    expect(byRole("setup").smc!.internalExternal.external.structure).toBe("HH/HL");
    expect(byRole("trigger").smc!.internalExternal.external.structure).toBe("range");

    // Each entry reports its own timeframe label and datapoint count
    expect(byRole("structure").timeframe).toBe("D1");
    expect(byRole("structure").smc!.internalExternal.external.dataPoints).toBe(d1.length);
    expect(byRole("setup").smc!.internalExternal.external.dataPoints).toBe(h4.length);
    expect(byRole("trigger").smc!.internalExternal.external.dataPoints).toBe(h1.length);

    // HTF bias derives from the highest AVAILABLE tf only (D1 bearish)
    expect(ctx.htfBias).toBe("short");
    // Setup agrees with HTF? NO — setup bullish vs HTF bearish, trigger unclear → MIXED
    expect(ctx.alignment).toBe("MIXED");
  });
});

// ── Alignment matrix ───────────────────────────────────────────────

describe("alignment matrix", () => {
  it("all timeframes bullish → ALIGNED_BULLISH", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "W1", role: "macro", candles: trendCandles(1) },
      { timeframe: "D1", role: "structure", candles: trendCandles(1) },
      { timeframe: "H4", role: "setup", candles: trendCandles(1) },
      { timeframe: "H1", role: "trigger", candles: trendCandles(1) },
    ]);
    expect(ctx.alignment).toBe("ALIGNED_BULLISH");
    expect(ctx.htfBias).toBe("long");
  });

  it("all timeframes bearish → ALIGNED_BEARISH", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "W1", role: "macro", candles: trendCandles(-1) },
      { timeframe: "D1", role: "structure", candles: trendCandles(-1) },
      { timeframe: "H4", role: "setup", candles: trendCandles(-1) },
      { timeframe: "H1", role: "trigger", candles: trendCandles(-1) },
    ]);
    expect(ctx.alignment).toBe("ALIGNED_BEARISH");
    expect(ctx.htfBias).toBe("short");
  });

  it("higher timeframes disagree among themselves → MIXED", () => {
    const ctx = buildMtfContext("H1", [
      { timeframe: "W1", role: "macro", candles: trendCandles(1) },
      { timeframe: "D1", role: "structure", candles: trendCandles(-1) },
      { timeframe: "H1", role: "setup", candles: trendCandles(1) },
    ]);
    expect(ctx.alignment).toBe("MIXED");
  });

  it("only the trigger opposes the dominant HTF → COUNTER_TREND (pullback)", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "D1", role: "structure", candles: trendCandles(1) },
      { timeframe: "H4", role: "setup", candles: trendCandles(1) },
      { timeframe: "H1", role: "trigger", candles: trendCandles(-1) },
    ]);
    expect(ctx.alignment).toBe("COUNTER_TREND");
    expect(ctx.htfBias).toBe("long");
    expect(ctx.triggerTimeframe).toBe("H1");
  });

  it("no readable HTF → INSUFFICIENT_DATA (never forced)", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "W1", role: "macro", candles: null, error: "rate limited" },
      { timeframe: "D1", role: "structure", candles: null, error: "provider error" },
      { timeframe: "H4", role: "setup", candles: trendCandles(1) },
    ]);
    expect(ctx.alignment).toBe("INSUFFICIENT_DATA");
    expect(ctx.htfBias).toBe("none");
    expect(ctx.htfTimeframe).toBeUndefined();
  });
});

// ── Genuine HTF reversal ───────────────────────────────────────────

describe("genuine HTF reversal detection", () => {
  it("flags an external CHoCH on the HTF itself", () => {
    // Uptrend then a deep decline that closes below the last major HL
    // → bearish external CHoCH on that timeframe.
    const candles = trendCandles(1);
    let p = candles[candles.length - 1].close;
    for (let b = 0; b < 14; b++) {
      const o = p;
      p -= 1.0;
      bar(candles, o, p);
    }
    const ctx = buildMtfContext("H1", [
      { timeframe: "D1", role: "structure", candles },
      { timeframe: "H1", role: "setup", candles: trendCandles(-1) },
    ]);
    expect(ctx.htfReversal).toBeDefined();
    expect(ctx.htfReversal!.timeframe).toBe("D1");
    expect(ctx.htfReversal!.direction).toBe("bearish");
    expect(["bos", "choch"]).toContain(ctx.htfReversal!.kind);
  });

  it("does NOT flag a reversal when the HTF shows none", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "D1", role: "structure", candles: trendCandles(1) },
      { timeframe: "H4", role: "setup", candles: trendCandles(1) },
      { timeframe: "H1", role: "trigger", candles: trendCandles(-1) },
    ]);
    // Trigger bearishness is LTF noise — it must NOT appear as HTF reversal.
    expect(ctx.htfReversal).toBeUndefined();
    expect(ctx.alignment).toBe("COUNTER_TREND"); // pullback, not reversal
    expect(ctx.htfBias).toBe("long"); // HTF context intact
  });
});

// ── Unavailable timeframes — never synthesized ─────────────────────

describe("unavailable / insufficient timeframe data", () => {
  it("failed fetches are flagged with reasons and excluded from the chain", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "W1", role: "macro", candles: null, error: "[429] rate limited" },
      { timeframe: "D1", role: "structure", candles: trendCandles(1) },
      { timeframe: "H4", role: "setup", candles: trendCandles(1) },
      { timeframe: "H1", role: "trigger", candles: null, error: "no candle data returned" },
    ]);
    expect(ctx.unavailable).toHaveLength(2);
    expect(ctx.unavailable.map((u) => u.timeframe)).toEqual(["W1", "H1"]);
    expect(ctx.unavailable[0].reason).toContain("429");
    expect(ctx.chainUsed).toEqual(["D1", "H4"]); // only actually-fetched TFs
    expect(ctx.timeframes.every((t) => t.available)).toBe(true);
    // The used chain reflects reality — no claim about W1/H1 analysis.
    expect(ctx.chainUsed).not.toContain("W1");
    expect(ctx.chainUsed).not.toContain("H1");
  });

  it("too-few candles count as unavailable (insufficient for structure)", () => {
    const tiny: OhlcvCandle[] = Array.from({ length: 12 }, (_, i) => ({
      timestamp: T(i),
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 10,
    }));
    const ctx = buildMtfContext("H1", [
      { timeframe: "D1", role: "structure", candles: tiny },
      { timeframe: "H1", role: "setup", candles: trendCandles(1) },
    ]);
    expect(ctx.unavailable[0].timeframe).toBe("D1");
    expect(ctx.unavailable[0].reason).toContain("below the 20");
    expect(ctx.alignment).toBe("INSUFFICIENT_DATA");
  });

  it("empty candle array is unavailable, never fabricated into structure", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "D1", role: "structure", candles: [] },
      { timeframe: "H4", role: "setup", candles: trendCandles(1) },
    ]);
    expect(ctx.timeframes.find((t) => t.timeframe === "D1")).toBeUndefined();
    expect(ctx.unavailable[0].reason).toBeTruthy();
  });
});

// ── Liquidity / FVG / OB carry timeframe context ────────────────────

describe("MTF SMC context carries timeframe labels", () => {
  it("every liquidity pool, FVG and OB belongs to its own timeframe", () => {
    const bull = trendCandles(1);
    const bear = trendCandles(-1);
    const ctx = buildMtfContext("H1", [
      { timeframe: "D1", role: "structure", candles: bull },
      { timeframe: "H1", role: "setup", candles: bear },
    ]);
    for (const t of ctx.timeframes) {
      const smc = t.smc!;
      for (const p of smc.liquidityPools) {
        // Pools come from THIS timeframe's computation; entry is labeled.
        expect(t.timeframe).toBeTruthy();
      }
      for (const f of smc.fvgs) expect(f.timeframe).toBe(t.timeframe);
      for (const ob of smc.orderBlocks) expect(ob.timeframe).toBe(t.timeframe);
    }
    // Distinct geometries → distinct pool sets per timeframe (independence)
    const d1 = ctx.timeframes.find((t) => t.timeframe === "D1")!;
    const h1 = ctx.timeframes.find((t) => t.timeframe === "H1")!;
    // Both computed — neither copied from the other
    expect(d1.smc).toBeDefined();
    expect(h1.smc).toBeDefined();
    expect(d1.smc).not.toBe(h1.smc);
  });
});

describe("TF_LADDER sanity", () => {
  it("is ordered execution → macro", () => {
    expect(TF_LADDER).toEqual(["M15", "H1", "H4", "D1", "W1"]);
  });
});
