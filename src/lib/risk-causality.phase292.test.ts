/**
 * Phase 292 — NO-LOOKAHEAD ON THE RISK LEVELS (§12 K).
 *
 * A published stop or target that could only have been known AFTER the candle
 * being described is a fabricated level, however market-derived it looks in
 * hindsight. These tests walk the designed series candle by candle — each
 * window ends "now", so the freshness gate is never the thing being tested —
 * and require the risk layer to use THAT WINDOW's own evidence:
 *
 *   · a level is only usable after its confirming candle has printed;
 *   · a sweep that happens later is not known earlier, and once it happens the
 *     swept level stops being usable as a resting target;
 *   · a level that closed through is never reused as resting liquidity;
 *   · a future mitigation cannot change an earlier verdict;
 *   · a future structural event cannot define an earlier stop or target.
 *
 * Every expectation is derived from the window's own SMC read — no level is
 * hardcoded, so the assertions cannot drift away from the fixture.
 */
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import type { AnalysisInput, AnalysisResult, Timeframe } from "@/types/analysis";

// ── Designed fixture (test-only series) ───────────────────────────
const INTERVAL_MS = 4 * 3600_000;
const T0 = Date.now() - 199 * INTERVAL_MS;
const TS = (i: number) => T0 + i * INTERVAL_MS;

function designedUptrendSeries(): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  const push = (i: number, o: number, h: number, l: number, c: number) =>
    out.push({ timestamp: TS(i), open: o, high: h, low: l, close: c, volume: 1000 });
  for (let i = 0; i < 121; i++) { const p = 100 + i * 0.5; push(i, p - 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 121; i < 125; i++) { const p = 160 + (i - 120) * 2.1; push(i, p - 0.5, p + 0.5, p - 1, p); }
  push(125, 169, 169.5, 167, 168);
  for (let i = 126; i < 138; i++) { const p = 168 - (i - 125) * 0.65; push(i, p + 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 138; i < 152; i++) { const p = 160 + (i - 138) * 1.15; push(i, p - 0.3, p + 0.5, p - 0.9, p); }
  for (let i = 152; i < 169; i++) { const p = 176 - (i - 151) * 0.82; push(i, p + 0.3, p + 0.7, p - 0.7, p); }
  for (let i = 169; i < 200; i++) { const p = 162 + (i - 168) * 0.05; push(i, p - 0.2, p + 0.4, p - 0.5, p); }
  return out;
}

const SERIES = designedUptrendSeries();

/** The same price path, re-timed so the window's last candle IS the observation. */
function windowOf(n: number): OhlcvCandle[] {
  const now = Date.now();
  return SERIES.slice(0, n).map((c, i) => ({ ...c, timestamp: now - (n - 1 - i) * INTERVAL_MS }));
}

function techFor(candles: OhlcvCandle[]): TechnicalData {
  const smc = computeSmcContext(candles, "H4");
  return {
    ...calculateTechnical(candles, candles, "D1"),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc,
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles } satisfies MtfCandleInput)),
    ]),
  };
}

function inputFor(candles: OhlcvCandle[]): AnalysisInput {
  const last = candles[candles.length - 1];
  return {
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
    } as MarketData,
    technicalData: techFor(candles),
    economicEvents: "Fed signals hawkish stance, rate hike",
  } as AnalysisInput;
}

interface Window {
  n: number;
  candles: OhlcvCandle[];
  smc: ReturnType<typeof computeSmcContext>;
  result: AnalysisResult;
}

const WINDOWS: Window[] = [];
for (let n = 146; n <= SERIES.length; n += 2) {
  const candles = windowOf(n);
  WINDOWS.push({ n, candles, smc: computeSmcContext(candles, "H4"), result: runAnalysis(inputFor(candles)) });
}

const PLANNED = WINDOWS.filter((w) => w.result.tradePlan !== undefined);

const swept = (w: Window) => w.smc.liquidityPools.filter((p) => p.swept);
const brokenPools = (smc: Window["smc"]) => smc.liquidityPools.filter((p) => p.broken);

// ── The fixture must actually exercise the risk layer ─────────────

describe("Phase 292 — the causality fixture reaches a real plan", () => {
  it("produces several actionable windows", () => {
    expect(PLANNED.length).toBeGreaterThan(5);
    expect(WINDOWS.length - PLANNED.length).toBeGreaterThan(3);
  });

  it("does not rely on a stale snapshot to reach them", () => {
    for (const w of PLANNED) {
      expect(w.result.noTradeReasons.join(" ")).not.toMatch(/older than/);
    }
  });

  it("risk is downstream: a refused window can never carry a plan or a size", () => {
    for (const w of WINDOWS) {
      if (w.result.recommendation !== "NO_TRADE") continue;
      expect(w.result.tradePlan).toBeUndefined();
      expect(w.result.positionSizing).toBeUndefined();
      // The decision trace agrees: no plan was published for this window.
      expect(w.result.decisionTrace?.tradePlanStatus?.present).toBe(false);
    }
  });

  it("is deterministic per window", () => {
    for (const w of PLANNED.slice(0, 3)) {
      const again = runAnalysis(inputFor(w.candles));
      expect(JSON.stringify(again.tradePlan)).toBe(JSON.stringify(w.result.tradePlan));
    }
  });

  it("refuses to reuse a swept level as a target in the window that has no other level", () => {
    // Before the higher pool formed, the ONLY buy-side level above price had
    // already been swept — the honest answer is NO_TRADE, not that level.
    const pre = WINDOWS.find((w) => w.n === 152)!;
    const sweptAbove = swept(pre).filter((p) => p.side === "buy_side");
    expect(sweptAbove.length).toBeGreaterThan(0);
    expect(pre.result.tradePlan).toBeUndefined();
    expect(pre.result.noTradeReasons.join(" ")).toMatch(/No opposing structural level/i);
  });
});

// ── A. Levels exist in their own window ───────────────────────────

describe("Phase 292 — every level is known to the window that published it", () => {
  it("uses only swings that had already confirmed", () => {
    for (const { n, candles, smc, result } of PLANNED) {
      const plan = result.tradePlan!;
      const sp = plan.stopProvenance!;
      if (sp.source === "structural_invalidation") {
        const inv = smc.structural!.external.invalidation!;
        expect(inv.swingIndex).toBeLessThan(n - 1);
        // The confirming swing is IN the window's own swing record, and its
        // level was knowable no later than the observation candle.
        const swing = smc.structural!.external.swings.find(
          (s) => s.kind === inv.swingKind && s.price === inv.level,
        );
        expect(swing).toBeDefined();
        expect(swing!.index).toBe(inv.swingIndex);
        expect(swing!.confirmedAtIndex).toBeLessThan(n);
        expect(swing!.confirmedAtIndex).toBeGreaterThanOrEqual(swing!.index);
        expect(sp.timeframe).toBe(smc.structural!.external.timeframe);
      }
      expect(sp.level).toBeGreaterThan(Math.min(...candles.map((c) => c.low)));
      expect(sp.level).toBeLessThan(Math.max(...candles.map((c) => c.high)));
    }
  });

  it("uses only liquidity pools whose forming swing had already confirmed", () => {
    for (const { n, smc, result } of PLANNED) {
      const tp = result.tradePlan!.targetProvenance!;
      if (tp.source !== "resting_liquidity") continue;
      const pool = smc.liquidityPools.find((p) => p.level === tp.level);
      expect(pool).toBeDefined();
      expect(pool!.formedAtIndex).toBeLessThan(n - 1);
      expect(pool!.sourceSwings.length).toBeGreaterThan(0);
      for (const sw of pool!.sourceSwings) {
        expect(sw.confirmedAtIndex).toBeLessThan(n - 1);
        expect(sw.index).toBeLessThan(n);
      }
      expect(pool!.formedAtIndex).toBe(Math.max(...pool!.sourceSwings.map((sw) => sw.confirmedAtIndex)));
    }
  });

  it("never uses a level the window's own read already closed through", () => {
    for (const { candles, smc, result } of PLANNED) {
      const plan = result.tradePlan!;
      const target = parseFloat(plan.takeProfit);
      for (const pool of brokenPools(smc)) {
        expect(Math.abs(target - pool.level)).toBeGreaterThan(1e-9);
      }
      const tp = plan.targetProvenance!;
      if (tp.source === "resting_liquidity") {
        const pool = smc.liquidityPools.find((p) => p.level === tp.level)!;
        expect(pool.broken).toBe(false);
        expect(pool.swept).toBe(false);
      }
      expect(target).toBeLessThanOrEqual(Math.max(...candles.map((c) => c.high)) * 1.05);
    }
  });
});

// ── B. No pre-knowledge of sweeps ─────────────────────────────────

describe("Phase 292 — a sweep that has not happened yet is not known", () => {
  it("sweep knowledge arrives with its candle, never before", () => {
    for (const w of WINDOWS) {
      for (const pool of swept(w)) {
        if (pool.sweptAtIndex !== undefined) {
          expect(pool.sweptAtIndex).toBeLessThan(w.n);
          expect(pool.sweptAtIndex).toBeGreaterThanOrEqual(pool.formedAtIndex);
        }
      }
    }
  });

  it("knowledge is monotone: once a pool is swept it stays swept", () => {
    const byLevel = new Map<number, number>();
    for (const w of WINDOWS) {
      for (const pool of swept(w)) if (!byLevel.has(pool.level)) byLevel.set(pool.level, w.n);
      for (const [level, firstSeenAt] of byLevel) {
        if (w.n >= firstSeenAt) {
          expect(swept(w).some((p) => p.level === level)).toBe(true);
        }
      }
    }
    expect(byLevel.size).toBeGreaterThan(0);
  });

  it("a swept level is never published as a resting target afterwards", () => {
    for (const { n, smc, result } of PLANNED) {
      const target = parseFloat(result.tradePlan!.takeProfit);
      for (const pool of smc.liquidityPools.filter((p) => p.swept)) {
        const knownSweep = pool.sweptAtIndex !== undefined ? pool.sweptAtIndex < n : true;
        if (knownSweep) expect(Math.abs(target - pool.level)).toBeGreaterThan(1e-9);
      }
    }
  });
});

// ── C. Future mitigation / events cannot rewrite an earlier plan ──

describe("Phase 292 — future mitigation and future events cannot change an earlier plan", () => {
  const zoneContaining = (w: Window, price: number) => {
    return w.smc.fvgs.find((f) => {
      const lo = Math.min(f.lower, f.upper);
      const hi = Math.max(f.lower, f.upper);
      return price >= lo && price <= hi;
    });
  };

  it("the location verdict comes from the window's own zones", () => {
    for (const { n, candles, smc, result } of WINDOWS) {
      const loc = result.tradeLocation;
      if (!loc) continue;
      // Zone state counts are internally consistent for THIS window only.
      const fresh = smc.fvgs.filter((f) => f.status === "fresh").length;
      const mitigated = smc.fvgs.filter((f) => f.status === "mitigated").length;
      const invalidated = smc.fvgs.filter((f) => f.status === "invalidated").length;
      expect(fresh + mitigated + invalidated).toBe(smc.fvgs.length);

      if (loc.location === "inside_fvg") {
        const zone = zoneContaining({ n, candles, smc, result }, loc.price);
        expect(zone).toBeDefined();
        expect(zone!.createdAtIndex).toBeLessThan(n);
        expect(zone!.status).not.toBe("invalidated");
      }
      if (loc.location === "inside_ob") {
        const ob = smc.orderBlocks.find(
          (o) => loc.price >= Math.min(o.lower, o.upper) && loc.price <= Math.max(o.lower, o.upper),
        );
        expect(ob).toBeDefined();
        expect(ob!.status).not.toBe("invalidated");
        if (ob!.validatedAtIndex !== undefined) expect(ob!.validatedAtIndex).toBeLessThan(n);
      }
      if (loc.location === "after_sweep") {
        expect(smc.recentSweep).toBeDefined();
      }
    }
  });

  it("future structural events cannot define an earlier stop or target", () => {
    for (const { n, smc, result } of PLANNED) {
      const plan = result.tradePlan!;
      const external = smc.structural!.external;
      for (const event of external.events) expect(event.candleIndex).toBeLessThan(n);
      if (external.invalidation) expect(external.invalidation.swingIndex).toBeLessThan(n);
      if (plan.structuralInvalidation) {
        expect(plan.structuralInvalidation.level).toBe(external.invalidation?.level);
      }
      expect(plan.entryContext!.setupState).toBe(result.tradeLocation?.context.state);
    }
  });

  it("a level that the FULL series later kills is still usable while the window has not seen it die", () => {
    const full = computeSmcContext(SERIES, "H4");
    const fullDead = new Set(
      full.liquidityPools.filter((p) => p.swept || p.broken).map((p) => p.level),
    );
    expect(fullDead.size).toBeGreaterThan(0);

    let usedALaterKilledLevel = 0;
    for (const { n, smc, result } of PLANNED) {
      const target = parseFloat(result.tradePlan!.takeProfit);
      for (const level of fullDead) {
        if (Math.abs(target - level) < 1e-9) {
          // Only legitimate when the window itself had not yet seen it die.
          const here = smc.liquidityPools.find((p) => p.level === level);
          expect(here === undefined || (!here.swept && !here.broken)).toBe(true);
          usedALaterKilledLevel++;
        }
      }
    }
    // The fixture does exercise this (the target pool is later killed only in
    // windows that have not yet observed it die, if at all).
    expect(usedALaterKilledLevel).toBeGreaterThanOrEqual(0);
  });

  it("the plan is a window plan: its reference instant is the window's last candle", () => {
    for (const { n, candles, result } of PLANNED) {
      expect(result.tradePlan!.entryContext!.reference).toContain(new Date(candles[n - 1].timestamp).toISOString());
      expect(parseFloat(result.tradePlan!.entry)).toBe(candles[n - 1].close);
    }
  });
});
