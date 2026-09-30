/**
 * Phase 291 — TRADE LOCATION & SETUP CONTEXT.
 *
 * These tests pin the semantics that did not exist before this phase:
 *
 *   · zone position is read from the REAL bounds of the REAL objects (inside /
 *     at boundary / outside) and no zone is ever invented to fit the price;
 *   · the location description only ever uses objects that were KNOWABLE at the
 *     candle being described (FVG: the third candle; OB: its validation candle;
 *     pool: the last participating swing's confirmation);
 *   · the setup-context state machine is deterministic, exposes every component
 *     separately, and can never turn a liquidity sweep alone into a setup nor
 *     let an internal (minor) read silently flip an intact external regime;
 *   · the invalidation handoff names real levels with real provenance.
 */
import { describe, it, expect } from "vitest";
import {
  anchorFromCandles,
  invalidationEvidence,
  newestSwings,
  readSetupContext,
  readZoneLocation,
  SWEEP_RECENCY_CANDLES,
  ZONE_BOUNDARY_TOLERANCE,
  type LocationAnchor,
  type TradeLocation,
} from "./trade-location";
import { EQUAL_LEVEL_TOLERANCE, type SwingPoint } from "./smc";
import type {
  FairValueGap,
  LiquidityPool,
  LiquiditySweepEvent,
  OrderBlock,
  SmcContext,
} from "./market-types";
import type { StructurePair } from "./structure";

// ── Fixtures ──────────────────────────────────────────────────────
// Unit fixtures for the state machine. They are typed engine objects with the
// exact fields the SMC layer produces — no market data is fabricated anywhere
// (the real-candle causality tests live in trade-location.phase291.causal.test.ts).

const NOW_INDEX = 40;
const T = (i: number) => 1700000000000 + i * 3600000;

function anchor(price: number, lastIndex = NOW_INDEX): LocationAnchor {
  return { price, lastIndex, atTime: T(lastIndex) };
}

function fvg(over: Partial<FairValueGap> = {}): FairValueGap {
  return {
    direction: "bullish",
    upper: 105,
    lower: 100,
    timeframe: "H4",
    createdAtIndex: 10,
    createdAt: T(10),
    status: "fresh",
    ...over,
  };
}

function ob(over: Partial<OrderBlock> = {}): OrderBlock {
  return {
    direction: "bullish",
    upper: 95,
    lower: 90,
    timeframe: "H4",
    createdAt: T(5),
    status: "fresh",
    sourceIndex: 5,
    displacementIndex: 6,
    displacementTime: T(6),
    validatedAtIndex: 7,
    validatedAt: T(7),
    evidence: {
      precedingOpposingCandle: true,
      displacementAfter: true,
      structuralBreakAfter: true,
      displacementRangeAtr: 2,
      validationMethod: "confirmed_structural_event",
      preWindowExtreme: 94,
    },
    ...over,
  };
}

function pool(over: Partial<LiquidityPool> = {}): LiquidityPool {
  return {
    side: "buy_side",
    level: 110,
    source: "swing_high",
    touches: 1,
    swept: false,
    broken: false,
    formedAtIndex: 12,
    formedAtTime: T(12),
    sourceSwings: [{ price: 110, index: 9, confirmedAtIndex: 12, timestamp: T(12) }],
    ...over,
  };
}

function sweep(over: Partial<LiquiditySweepEvent> = {}): LiquiditySweepEvent {
  return {
    side: "buy_side",
    level: 110,
    source: "swing_high",
    timeframe: "H4",
    candleIndex: 38,
    candleTime: T(38),
    poolFormedAtIndex: 12,
    poolFormedAtTime: T(12),
    ...over,
  };
}

function smcOf(over: Partial<SmcContext> = {}): SmcContext {
  return {
    timeframe: "H4",
    fvgs: [],
    orderBlocks: [],
    liquidityPools: [],
    sweeps: [],
    equalHighs: [],
    equalLows: [],
    ...over,
  } as SmcContext;
}

function pair(external: "bullish" | "bearish" | "none", internal: "bullish" | "bearish" | "none"): StructurePair {
  const read = (d: "bullish" | "bearish" | "none") => ({
    direction: d,
    events: [],
    lastEvent: undefined,
    invalidation: undefined,
    points: { highs: [], lows: [] },
  });
  return {
    external: read(external),
    internal: read(internal),
    state: external === "none" || internal === "none" ? "BOTH_UNKNOWN" : external === internal ? "ALIGNED" : "INTERNAL_COUNTERTREND",
    reason: "fixture",
  } as unknown as StructurePair;
}

// ── Zone location ─────────────────────────────────────────────────

describe("Phase 291 — readZoneLocation", () => {
  it("reads position from the real bounds: inside, at boundary, outside", () => {
    const context = smcOf({ fvgs: [fvg()] }); // 100–105

    expect(readZoneLocation("H4", context, anchor(102)).location).toBe("inside_fvg");
    expect(readZoneLocation("H4", context, anchor(102)).flags.insideFvg).toBe(true);

    // Just above the upper bound but inside the repository's equal-level tolerance.
    const justAbove = 105 * (1 + ZONE_BOUNDARY_TOLERANCE / 2);
    const atBoundary = readZoneLocation("H4", context, anchor(justAbove));
    expect(atBoundary.location).toBe("at_fvg_boundary");
    expect(atBoundary.flags.atFvgBoundary).toBe(true);
    expect(atBoundary.zones[0].distanceToBoundary).toBeGreaterThan(0);

    const far = readZoneLocation("H4", context, anchor(120));
    expect(far.location).toBe("outside_zones");
    expect(far.flags.outsideZones).toBe(true);
  });

  it("uses the repository's existing equal-level tolerance and no invented distance", () => {
    expect(ZONE_BOUNDARY_TOLERANCE).toBe(EQUAL_LEVEL_TOLERANCE);
    const context = smcOf({ fvgs: [fvg()] });
    const insideTolerance = 105 * (1 + ZONE_BOUNDARY_TOLERANCE * 0.9);
    const outsideTolerance = 105 * (1 + ZONE_BOUNDARY_TOLERANCE * 1.1);
    expect(readZoneLocation("H4", context, anchor(insideTolerance)).location).toBe("at_fvg_boundary");
    expect(readZoneLocation("H4", context, anchor(outsideTolerance)).location).toBe("outside_zones");
  });

  it("never invents a zone: an empty context stays outside with an explicit fact", () => {
    const location = readZoneLocation("H4", smcOf(), anchor(102));
    expect(location.zones).toHaveLength(0);
    expect(location.location).toBe("outside_zones");
    expect(location.flags.outsideZones).toBe(true);
    expect(location.facts).toContain("No qualifying zone on this timeframe");
  });

  it("an old FVG far from price is reported by its real status, never as fresh location", () => {
    const location = readZoneLocation("H4", smcOf({ fvgs: [fvg({ status: "mitigated" })] }), anchor(150));
    expect(location.zones[0].status).toBe("mitigated");
    expect(location.zones[0].position).toBe("outside");
    expect(location.location).toBe("outside_zones");
    // Age is measured from the candle that created it — not from "now".
    expect(location.zones[0].ageCandles).toBe(NOW_INDEX - 10);
  });

  it("drops invalidated zones and reports their levels as dead, not as location", () => {
    const location = readZoneLocation(
      "H4",
      smcOf({ fvgs: [fvg({ status: "invalidated", invalidatedAtIndex: 20, invalidatedAt: T(20) })] }),
      anchor(102),
    );
    expect(location.zones).toHaveLength(0);
  });

  it("uses each object's own knowledge time: FVG at creation, OB at validation", () => {
    const location = readZoneLocation(
      "H4",
      smcOf({ fvgs: [fvg({ createdAtIndex: 10 })], orderBlocks: [ob({ validatedAtIndex: 25, validatedAt: T(25) })] }),
      anchor(92),
    );
    const fvgView = location.zones.find((z) => z.kind === "FVG")!;
    const obView = location.zones.find((z) => z.kind === "OB")!;
    expect(fvgView.knownAtIndex).toBe(10);
    expect(obView.knownAtIndex).toBe(25);
    expect(obView.ageCandles).toBe(NOW_INDEX - 25);
    // Nothing may claim knowledge from a candle that has not printed yet.
    for (const zone of location.zones) expect(zone.knownAtIndex).toBeLessThanOrEqual(NOW_INDEX);
    expect(obView.knownAtIndex).toBeLessThanOrEqual(obView.createdAtIndex + 20);
  });

  it("describes price inside the nearest OB and at its boundary", () => {
    const context = smcOf({ orderBlocks: [ob()] }); // 90–95
    expect(readZoneLocation("H4", context, anchor(93)).location).toBe("inside_ob");
    expect(readZoneLocation("H4", context, anchor(95.05)).location).toBe("at_ob_boundary");
    const inside = readZoneLocation("H4", context, anchor(93));
    expect(inside.facts).toContain("Price inside bullish OB 90–95");
  });
});

// ── Liquidity location ────────────────────────────────────────────

describe("Phase 291 — liquidity location", () => {
  it("reports a recent sweep as the current story and an old one as history", () => {
    const recent = readZoneLocation("H4", smcOf({ liquidityPools: [pool()], recentSweep: sweep() }), anchor(108));
    expect(recent.location).toBe("after_sweep");
    expect(recent.flags.afterSweep).toBe(true);
    expect(recent.liquidity.sweep!.ageCandles).toBe(NOW_INDEX - 38);

    const oldIndex = NOW_INDEX - SWEEP_RECENCY_CANDLES - 1;
    const old = readZoneLocation(
      "H4",
      smcOf({ liquidityPools: [pool()], recentSweep: sweep({ candleIndex: oldIndex, candleTime: T(oldIndex) }) }),
      anchor(108),
    );
    expect(old.flags.afterSweep).toBe(false);
    expect(old.location).toBe("outside_zones");
    // The event is still reported — it is simply no longer the current story.
    expect(old.liquidity.sweep).toBeDefined();
  });

  it("keeps every sweep tied to the candle its pool became knowable", () => {
    const location = readZoneLocation("H4", smcOf({ liquidityPools: [pool()], recentSweep: sweep() }), anchor(108));
    expect(location.liquidity.sweep!.poolFormedAtIndex).toBe(12);
    expect(location.liquidity.sweep!.poolFormedAtIndex).toBeLessThan(location.liquidity.sweep!.candleIndex);
  });

  it("separates resting liquidity from levels that were closed through (breakouts)", () => {
    const context = smcOf({
      liquidityPools: [
        pool({ level: 110, side: "buy_side" }),
        pool({ level: 80, side: "sell_side" }),
        pool({ level: 130, side: "buy_side", broken: true }),
      ],
    });
    const location = readZoneLocation("H4", context, anchor(100));
    expect(location.liquidity.nearestBuySide!.level).toBe(110);
    expect(location.liquidity.nearestSellSide!.level).toBe(80);
    expect(location.liquidity.brokenLevels).toEqual([130]);
    expect(location.facts.some((f) => f.includes("breakout"))).toBe(true);
  });

  it("reports proximity to a resting level without inventing a signal", () => {
    const context = smcOf({ liquidityPools: [pool({ level: 110 })] });
    expect(readZoneLocation("H4", context, anchor(110)).flags.nearLiquidity).toBe(true);
    expect(readZoneLocation("H4", context, anchor(110)).location).toBe("at_liquidity_level");
    expect(readZoneLocation("H4", context, anchor(100)).flags.nearLiquidity).toBe(false);
  });

  it("marks sweep favour by direction convention (sell-side sweep favours longs)", () => {
    const sellSweep = smcOf({ recentSweep: sweep({ side: "sell_side", level: 90 }) });
    expect(readZoneLocation("H4", sellSweep, anchor(100), "bullish").liquidity.sweep!.favorable).toBe(true);
    expect(readZoneLocation("H4", sellSweep, anchor(100), "bearish").liquidity.sweep!.favorable).toBe(false);
    expect(readZoneLocation("H4", sellSweep, anchor(100)).liquidity.sweep!.favorable).toBeUndefined();
  });
});

// ── Setup context state machine ───────────────────────────────────

describe("Phase 291 — readSetupContext state machine", () => {
  const emptyLocation = (over: Partial<TradeLocation> = {}): TradeLocation => ({
    ...readZoneLocation("H4", smcOf(), anchor(100)),
    ...over,
  });

  it("NO_SETUP_EVIDENCE when nothing at all is available", () => {
    const context = readSetupContext({ timeframe: "H4", pair: pair("none", "none"), location: emptyLocation() });
    expect(context.state).toBe("NO_SETUP_EVIDENCE");
    expect(context.evidence.externalStructure).toBe("none");
  });

  it("LOCATION_ONLY when a zone exists but no structure can be read", () => {
    const location = readZoneLocation("H4", smcOf({ fvgs: [fvg()] }), anchor(102));
    const context = readSetupContext({ timeframe: "H4", pair: pair("none", "none"), location });
    expect(context.state).toBe("LOCATION_ONLY");
    expect(context.evidence.supportingZone).toBeUndefined();
  });

  it("LOCATION_ONLY for a sweep alone — a sweep is never a directional setup", () => {
    const location = readZoneLocation("H4", smcOf({ recentSweep: sweep({ side: "sell_side", level: 90 }) }), anchor(100));
    const context = readSetupContext({ timeframe: "H4", pair: pair("none", "none"), location, direction: "bullish" });
    expect(context.state).toBe("LOCATION_ONLY");
    expect(context.evidence.favorableSweep).toBeDefined();
    expect(context.evidence.externalStructure).toBe("none");
  });

  it("STRUCTURAL_SETUP when the structure agrees but no qualifying zone is engaged", () => {
    const context = readSetupContext({
      timeframe: "H4",
      pair: pair("bullish", "bullish"),
      location: readZoneLocation("H4", smcOf(), anchor(100)),
      direction: "bullish",
    });
    expect(context.state).toBe("STRUCTURAL_SETUP");
    expect(context.evidence.zoneEngaged).toBe(false);
  });

  it("CONFIRMED_SETUP_CONTEXT requires structure + a qualifying zone in the thesis direction", () => {
    const location = readZoneLocation("H4", smcOf({ fvgs: [fvg({ direction: "bullish" })] }), anchor(102));
    const context = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bullish"), location, direction: "bullish" });
    expect(context.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(context.evidence.supportingZone!.kind).toBe("FVG");
    expect(context.evidence.zoneEngaged).toBe(true);
  });

  it("CONFIRMED_SETUP_CONTEXT also holds when aligned displacement or a favourable sweep confirms a zone price has left", () => {
    const withDisplacement = readZoneLocation("H4", smcOf({ fvgs: [fvg({ direction: "bullish" })] }), anchor(120));
    const displacementLocation: TradeLocation = {
      ...withDisplacement,
      displacement: { direction: "bullish", candleIndex: 30, candleTime: T(30), ageCandles: 10 },
    };
    expect(
      readSetupContext({ timeframe: "H4", pair: pair("bullish", "bullish"), location: displacementLocation, direction: "bullish" }).state,
    ).toBe("CONFIRMED_SETUP_CONTEXT");

    const sweepLocation = readZoneLocation(
      "H4",
      smcOf({ fvgs: [fvg({ direction: "bullish" })], recentSweep: sweep({ side: "sell_side", level: 90 }) }),
      anchor(120),
    );
    const ctx = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bullish"), location: sweepLocation, direction: "bullish" });
    expect(ctx.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(ctx.evidence.favorableSweep).toBeDefined();
  });

  it("COUNTER_TREND_SETUP only when the internal leg has turned while the external regime has not", () => {
    const location = readZoneLocation("H4", smcOf({ fvgs: [fvg({ direction: "bullish" })] }), anchor(102));
    const context = readSetupContext({ timeframe: "H4", pair: pair("bearish", "bullish"), location, direction: "bullish" });
    expect(context.state).toBe("COUNTER_TREND_SETUP");
    // The external regime is REPORTED unchanged — internal evidence never flips it.
    expect(context.evidence.externalStructure).toBe("bearish");
    expect(context.evidence.internalStructure).toBe("bullish");
    expect(context.reasons.join(" ")).toContain("regime is unchanged");
  });

  it("INVALID_SETUP_CONTEXT when the external regime opposes and the internal leg does not agree", () => {
    const location = readZoneLocation("H4", smcOf({ fvgs: [fvg({ direction: "bullish" })] }), anchor(102));
    expect(
      readSetupContext({ timeframe: "H4", pair: pair("bearish", "bearish"), location, direction: "bullish" }).state,
    ).toBe("INVALID_SETUP_CONTEXT");
    expect(
      readSetupContext({ timeframe: "H4", pair: pair("bearish", "none"), location, direction: "bullish" }).state,
    ).toBe("INVALID_SETUP_CONTEXT");
  });

  it("an opposing zone containing price contradicts a confirmation (INVALID, not confirmed)", () => {
    const location = readZoneLocation(
      "H4",
      smcOf({ fvgs: [fvg({ direction: "bullish", lower: 100, upper: 105 }), fvg({ direction: "bearish", lower: 95, upper: 100, createdAtIndex: 11, createdAt: T(11) })] }),
      anchor(100),
    );
    const context = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bullish"), location, direction: "bullish" });
    expect(context.state).toBe("INVALID_SETUP_CONTEXT");
    expect(context.evidence.opposingZone).toBeDefined();
  });

  it("exposes every component separately so the verdict can be audited", () => {
    const location = readZoneLocation("H4", smcOf({ fvgs: [fvg()], recentSweep: sweep({ side: "sell_side", level: 90 }) }), anchor(102));
    const context = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bearish"), location, direction: "bullish" });
    expect(context.evidence.externalStructure).toBe("bullish");
    expect(context.evidence.internalStructure).toBe("bearish");
    expect(context.evidence.pairState).toBe("INTERNAL_COUNTERTREND");
    expect(context.evidence.supportingZone).toBeDefined();
    expect(context.evidence.zoneEngaged).toBe(true);
    expect(context.evidence.favorableSweep).toBeDefined();
    expect(context.evidence.displacementAligned).toBe(false);
    expect(context.facts).toContain("Setup context CONFIRMED_SETUP_CONTEXT");
    expect(context.facts).toContain("Internal leg runs against the external regime (trigger context only)");
  });

  it("is deterministic: identical inputs produce identical verdicts", () => {
    const location = readZoneLocation("H4", smcOf({ fvgs: [fvg()] }), anchor(102));
    const a = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bullish"), location, direction: "bullish" });
    const b = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bullish"), location, direction: "bullish" });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("agreeing liquidity and structure reinforce each other (sell-side sweep + bullish internal leg)", () => {
    const location = readZoneLocation(
      "H4",
      smcOf({ fvgs: [fvg()], recentSweep: sweep({ side: "sell_side", level: 90 }) }),
      anchor(102),
    );
    const bullish = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bullish"), location, direction: "bullish" });
    expect(bullish.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(bullish.evidence.favorableSweep).toBeDefined();
    expect(bullish.facts).toContain("Liquidity swept at 90 on the thesis side before the move");

    // The SAME sweep inside a bearish structure is counter-liquidity: it never
    // turns the structure around on its own, it is reported against the thesis.
    const bearish = readSetupContext({ timeframe: "H4", pair: pair("bearish", "bearish"), location, direction: "bearish" });
    expect(bearish.state).toBe("STRUCTURAL_SETUP");
    expect(bearish.evidence.opposingSweep).toBeDefined();
    expect(bearish.evidence.externalStructure).toBe("bearish");
    expect(bearish.facts).toContain("Liquidity swept at 90 on the opposite side — not a signal on its own");
  });

  it("buy-side sweep + bearish internal leg is counter-trend, and the regime stays external", () => {
    const location = readZoneLocation(
      "H4",
      smcOf({ orderBlocks: [ob({ direction: "bearish", upper: 125, lower: 120 })], recentSweep: sweep({ side: "buy_side", level: 130 }) }),
      anchor(122),
    );
    const context = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bearish"), location, direction: "bearish" });
    expect(context.state).toBe("COUNTER_TREND_SETUP");
    expect(context.evidence.externalStructure).toBe("bullish");
    expect(context.evidence.internalStructure).toBe("bearish");
    expect(context.evidence.supportingZone!.kind).toBe("OB");
  });

  it.each([
    ["FVG" as const, "fvgs" as const],
    ["OB" as const, "orderBlocks" as const],
  ])("a %s zone in the thesis direction confirms the setup exactly like any other", (kind, field) => {
    const zone = kind === "FVG" ? fvg({ direction: "bearish", lower: 95, upper: 100 }) : ob({ direction: "bearish", lower: 95, upper: 100 });
    const context = smcOf({ [field]: [zone] } as Partial<SmcContext>);
    const location = readZoneLocation("H4", context, anchor(97));
    const setup = readSetupContext({ timeframe: "H4", pair: pair("bearish", "bearish"), location, direction: "bearish" });
    expect(setup.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(setup.evidence.supportingZone!.kind).toBe(kind);
    expect(setup.facts).toContain("Qualifying " + kind + " zone bearish 95–100 (fresh)");
  });

  it("never emits a probability or a score — only states and facts", () => {
    const location = readZoneLocation("H4", smcOf({ fvgs: [fvg()] }), anchor(102));
    const context = readSetupContext({ timeframe: "H4", pair: pair("bullish", "bullish"), location, direction: "bullish" });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toMatch(/probability|winRate|score/i);
  });
});

// ── Invalidation handoff ──────────────────────────────────────────

describe("Phase 291 — invalidationEvidence", () => {
  it("names the structural, OB, FVG and swept-liquidity levels with provenance", () => {
    const context = smcOf({
      fvgs: [fvg({ direction: "bullish", lower: 100, upper: 105 })],
      orderBlocks: [ob({ direction: "bearish", lower: 120, upper: 125 })],
      recentSweep: sweep({ side: "sell_side", level: 90 }),
    });
    const evidence = invalidationEvidence("H4", context);
    const bySource = Object.fromEntries(evidence.map((e) => [e.source, e]));
    expect(bySource.fair_value_gap.level).toBe(100); // bullish ⇒ far side is the lower bound
    expect(bySource.order_block.level).toBe(125); // bearish ⇒ far side is the upper bound
    expect(bySource.swept_liquidity.level).toBe(90);
    for (const item of evidence) {
      expect(item.timeframe).toBe("H4");
      expect(item.note.length).toBeGreaterThan(0);
    }
  });

  it("omits invalidated objects and never invents a level", () => {
    const context = smcOf({
      fvgs: [fvg({ status: "invalidated" })],
      orderBlocks: [ob({ status: "invalidated" })],
    });
    expect(invalidationEvidence("H4", context)).toHaveLength(0);
  });
});

// ── Anchoring & swing convenience ─────────────────────────────────

describe("Phase 291 — anchors", () => {
  it("anchors on the last candle of the series — the observation being described", () => {
    const candles = [
      { timestamp: T(0), close: 1 },
      { timestamp: T(1), close: 2 },
      { timestamp: T(2), close: 3 },
    ];
    expect(anchorFromCandles(candles)).toEqual({ price: 3, lastIndex: 2, atTime: T(2) });
    expect(anchorFromCandles([])).toEqual({ price: 0, lastIndex: 0, atTime: 0 });
  });

  it("newestSwings returns the most recent swings first", () => {
    const swings: SwingPoint[] = [
      { price: 1, index: 5, confirmedAtIndex: 7 },
      { price: 2, index: 20, confirmedAtIndex: 22 },
      { price: 3, index: 12, confirmedAtIndex: 14 },
    ];
    expect(newestSwings(swings, 2).map((s) => s.index)).toEqual([20, 12]);
    expect(newestSwings(swings, 10)).toHaveLength(3);
  });
});
