/**
 * Phase 83 — Trader Intelligence Tests
 */

import { describe, it, expect } from "vitest";
import {
  generateMarketContext,
  generatePositionThesis,
  detectChanges,
  extractKeyLevels,
  generateAnalyticalSummary,
  addToTimeline,
  type TimelineEntry,
} from "./trader-intelligence";
import {
  createTimeframeData,
  analyzeMTFConfluence,
  type TimeframeData,
  type MTFConfluence,
} from "./multi-timeframe-engine";
import type { Candle } from "./technical-indicators";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeCandles(count: number, startPrice: number, direction: "up" | "down" | "flat" = "up", vol = 0.01): Candle[] {
  const now = Date.now();
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const change = direction === "up" ? vol : direction === "down" ? -vol : Math.sin(i) * vol / 2;
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + vol * 0.3);
    const low = Math.min(open, close) * (1 - vol * 0.3);
    candles.push({ timestamp: now + i * 300_000, open, high, low, close, volume: 1000 });
    price = close;
  }
  return candles;
}

function makeConfluence(upOrDown: "up" | "down" | "mixed" = "up"): MTFConfluence {
  if (upOrDown === "mixed") {
    const tfData = [
      createTimeframeData("H1", makeCandles(50, 100, "down", 0.02)),
      createTimeframeData("M15", makeCandles(50, 96, "up", 0.015)),
      createTimeframeData("M5", makeCandles(50, 97, "up", 0.01)),
    ];
    return analyzeMTFConfluence(tfData);
  }
  const tfData = [
    createTimeframeData("H1", makeCandles(50, 100, upOrDown, 0.02)),
    createTimeframeData("M15", makeCandles(50, 100, upOrDown, 0.015)),
    createTimeframeData("M5", makeCandles(50, 100, upOrDown, 0.01)),
  ];
  return analyzeMTFConfluence(tfData);
}

// ═══════════════════════════════════════════════════════════════
// A. MARKET CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("A. Market Context", () => {
  it("generates context for trending up", () => {
    const confluence = makeConfluence("up");
    const ctx = generateMarketContext(confluence);
    expect(ctx.narrative).toBeTruthy();
    expect(ctx.regime).toBe("TRENDING_UP");
    expect(ctx.h1Summary).toContain("H1");
    expect(ctx.alignment).toBeTruthy();
  });

  it("generates context for trending down", () => {
    const confluence = makeConfluence("down");
    const ctx = generateMarketContext(confluence);
    expect(["TRENDING_DOWN", "RECOVERY"]).toContain(ctx.regime);
  });

  it("handles mixed/uncertain data", () => {
    const confluence = makeConfluence("mixed");
    const ctx = generateMarketContext(confluence);
    expect(ctx.narrative).toBeTruthy();
    expect(ctx.alignment).toBeTruthy();
  });

  it("describes insufficient data", () => {
    const confluence = analyzeMTFConfluence([]);
    const ctx = generateMarketContext(confluence);
    expect(ctx.narrative).toContain("Insufficient");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. POSITION THESIS
// ═══════════════════════════════════════════════════════════════

describe("B. Position Thesis", () => {
  it("LONG in bullish market → has supporting evidence", () => {
    const confluence = makeConfluence("up");
    const thesis = generatePositionThesis("LONG", confluence);
    expect(thesis.supporting.length).toBeGreaterThan(0);
    expect(thesis.invalidationConditions.length).toBeGreaterThan(0);
    expect(thesis.watchNext.length).toBeGreaterThan(0);
  });

  it("SHORT in bearish market → has supporting evidence", () => {
    const confluence = makeConfluence("down");
    const thesis = generatePositionThesis("SHORT", confluence);
    expect(thesis.supporting.length).toBeGreaterThan(0);
  });

  it("LONG in bearish market → has conflicting evidence", () => {
    const confluence = makeConfluence("down");
    const thesis = generatePositionThesis("LONG", confluence);
    expect(thesis.conflicting.length).toBeGreaterThan(0);
    expect(thesis.verdict).not.toBe("HEALTHY");
  });

  it("SHORT in bullish market → has conflicting evidence", () => {
    const confluence = makeConfluence("up");
    const thesis = generatePositionThesis("SHORT", confluence);
    expect(thesis.conflicting.length).toBeGreaterThan(0);
    expect(thesis.verdict).not.toBe("HEALTHY");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("C. LONG/SHORT Symmetry", () => {
  it("same bullish data: LONG supporting ≠ SHORT supporting", () => {
    const confluence = makeConfluence("up");
    const longThesis = generatePositionThesis("LONG", confluence);
    const shortThesis = generatePositionThesis("SHORT", confluence);

    // LONG has supporting evidence from bullish data
    expect(longThesis.supporting.length).toBeGreaterThan(0);
    // SHORT has conflicting evidence from bullish data
    expect(shortThesis.conflicting.length).toBeGreaterThan(0);
    // They should not be the same
    expect(longThesis.verdict).not.toBe(shortThesis.verdict);
  });

  it("same bearish data: SHORT supporting ≠ LONG supporting", () => {
    const confluence = makeConfluence("down");
    const longThesis = generatePositionThesis("LONG", confluence);
    const shortThesis = generatePositionThesis("SHORT", confluence);

    expect(shortThesis.supporting.length).toBeGreaterThan(0);
    expect(longThesis.conflicting.length).toBeGreaterThan(0);
    expect(longThesis.verdict).not.toBe(shortThesis.verdict);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. CHANGE DETECTION
// ═══════════════════════════════════════════════════════════════

describe("D. Change Detection", () => {
  it("detects regime change", () => {
    const prev = makeConfluence("up");
    const curr = makeConfluence("down");
    const changes = detectChanges(prev, curr);
    expect(changes.changed).toBe(true);
    expect(changes.changes.length).toBeGreaterThan(0);
  });

  it("no change when same data", () => {
    const data = makeConfluence("up");
    const changes = detectChanges(data, data);
    // Same object — no regime/trend changes
    expect(changes.changed).toBe(false);
  });

  it("initial analysis produces no false changes", () => {
    const curr = makeConfluence("up");
    const changes = detectChanges(undefined, curr);
    expect(changes.changed).toBe(false);
    expect(changes.changes[0]).toContain("Initial");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. KEY LEVELS
// ═══════════════════════════════════════════════════════════════

describe("E. Key Levels", () => {
  it("extracts levels from H1 analysis", () => {
    const h1Data = createTimeframeData("H1", makeCandles(50, 100, "up", 0.02));
    const h1 = analyzeMTFConfluence([h1Data]).timeframes[0];
    const levels = extractKeyLevels(h1, 102);

    // At least swing levels should be available
    if (levels.swingHigh !== null) {
      expect(levels.swingHigh).toBeGreaterThan(100);
    }
  });

  it("handles missing H1", () => {
    const levels = extractKeyLevels(undefined, 100);
    expect(levels.nearestSupport).toBeNull();
    expect(levels.nearestResistance).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// F. ANALYTICAL SUMMARY
// ═══════════════════════════════════════════════════════════════

describe("F. Analytical Summary", () => {
  it("generates complete summary", () => {
    const confluence = makeConfluence("up");
    const thesis = generatePositionThesis("LONG", confluence);
    const summary = generateAnalyticalSummary("LONG", confluence, thesis);

    expect(summary.market).toBeTruthy();
    expect(summary.position).toBe("LONG");
    expect(summary.why.length).toBeGreaterThan(0);
    expect(summary.watchNext.length).toBeGreaterThan(0);
  });

  it("conflicting evidence appears in summary", () => {
    const confluence = makeConfluence("down");
    const thesis = generatePositionThesis("LONG", confluence);
    const summary = generateAnalyticalSummary("LONG", confluence, thesis);

    expect(summary.conflict.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. EVIDENCE TIMELINE
// ═══════════════════════════════════════════════════════════════

describe("G. Evidence Timeline", () => {
  it("adds entries to timeline", () => {
    const entry: TimelineEntry = {
      timestamp: Date.now(),
      instrument: "BTC/USD",
      side: "LONG",
      observation: "M15 trend shifted bearish",
      category: "TECHNICAL",
      direction: "CONFLICTING",
      strength: "MODERATE",
    };
    const timeline = addToTimeline([], entry);
    expect(timeline.length).toBe(1);
  });

  it("bounds timeline at 50 entries", () => {
    let timeline: TimelineEntry[] = [];
    for (let i = 0; i < 60; i++) {
      timeline = addToTimeline(timeline, {
        timestamp: Date.now() + i,
        instrument: "BTC/USD",
        side: "LONG",
        observation: `Event ${i}`,
        category: "TECHNICAL",
        direction: "CONFLICTING",
        strength: "MODERATE",
      });
    }
    expect(timeline.length).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("H. Safety Invariants", () => {
  it("no probability claims in any output", () => {
    const confluence = makeConfluence("up");
    const thesis = generatePositionThesis("LONG", confluence);
    const summary = generateAnalyticalSummary("LONG", confluence, thesis);
    const allText = JSON.stringify(summary) + JSON.stringify(thesis);
    expect(allText).not.toMatch(/\d+%/);
    expect(allText).not.toMatch(/probability/i);
    expect(allText).not.toMatch(/chance/i);
  });

  it("deterministic: same inputs → same outputs", () => {
    const confluence = makeConfluence("up");
    const t1 = generatePositionThesis("LONG", confluence);
    const t2 = generatePositionThesis("LONG", confluence);
    expect(t1.verdict).toBe(t2.verdict);
    expect(t1.supporting.length).toBe(t2.supporting.length);
    expect(t1.conflicting.length).toBe(t2.conflicting.length);
  });

  it("no auto-execution in any output", () => {
    const confluence = makeConfluence("up");
    const thesis = generatePositionThesis("LONG", confluence);
    const summary = generateAnalyticalSummary("LONG", confluence, thesis);
    const allText = JSON.stringify(summary) + JSON.stringify(thesis);
    expect(allText).not.toMatch(/execute|auto.?sell|auto.?buy|place order|close position/i);
  });
});
