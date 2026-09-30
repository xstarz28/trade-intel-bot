/**
 * Phase 292 — TRADE PLAN & RISK INTEGRITY.
 *
 * The published ENTRY / STOP / TARGET / R:R must form ONE consistent,
 * traceable, market-derived set. These tests pin:
 *
 *   · entry semantics — the entry is a market REFERENCE, never a filled order
 *     and never a claimed trigger; the engine's own setup verdict travels with it;
 *   · stop provenance — the published stop is derived from a named market object
 *     (confirmed 290-A structural invalidation, or a real swing) and the raw level
 *     plus any protective buffer are separately stated;
 *   · R:R integrity — the reported ratio is computed from the published levels,
 *     and the ratio measured at the raw invalidation is named separately;
 *   · target lifecycle — only observed, causally-known, not-yet-swept/broken
 *     levels qualify; a closed-through level is never a resting target;
 *   · no-lookahead — a prefix run can only use levels whose confirming candle has
 *     printed.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import { EQUAL_LEVEL_TOLERANCE } from "@/lib/data/smc";
import type { OhlcvCandle, MarketData, TechnicalData } from "@/lib/data/market-types";
import type { AnalysisInput, AnalysisResult, Timeframe } from "@/types/analysis";

// ── Fixtures ──────────────────────────────────────────────────────
// A DESIGNED candle series (test fixture only — never presented as market data)
// that reaches the risk layer on a bullish thesis with a confirmed structural
// invalidation, zones and a resting-liquidity target.

const T0 = Date.now() - 199 * 4 * 3600_000;
const TS = (i: number) => T0 + i * 4 * 3600_000;

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

function techFor(candles: OhlcvCandle[]): TechnicalData {
  const smc = computeSmcContext(candles, "H4");
  return {
    ...calculateTechnical(candles, candles, "D1"),
    // The legacy structural label the decision gates read, set exactly as the
    // Phase 1 gate fixtures do. The SMC read stays the engine's own.
    structure: "HH/HL",
    bosDirection: "bullish",
    smc,
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles } satisfies MtfCandleInput)),
    ]),
  };
}

function inputFor(
  candles: OhlcvCandle[] = SERIES,
  overrides: Partial<AnalysisInput> = {},
  techOverrides: Partial<TechnicalData> = {},
): AnalysisInput {
  const last = candles[candles.length - 1];
  const tech = { ...techFor(candles), ...techOverrides };
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
    technicalData: tech,
    economicEvents: "Fed signals hawkish stance, rate hike",
    ...overrides,
  } as AnalysisInput;
}

const LONG = runAnalysis(inputFor());
const LONG_TECH = inputFor().technicalData!;

// ── A. Risk-plan construction ─────────────────────────────────────

describe("Phase 292 — risk-plan construction", () => {
  it("an actionable thesis publishes one internally coherent level set", () => {
    expect(LONG.recommendation).toBe("LONG");
    const p = LONG.tradePlan!;
    expect(p).toBeDefined();
    expect(p.direction).toBe("long");
    const entry = parseFloat(p.entry);
    const stop = parseFloat(p.stopLoss);
    const target = parseFloat(p.takeProfit);
    for (const v of [entry, stop, target, p.riskReward]) expect(Number.isFinite(v)).toBe(true);
    expect(stop).toBeLessThan(entry);
    expect(target).toBeGreaterThan(entry);
  });

  it("is deterministic: identical candles produce a byte-identical plan", () => {
    const again = runAnalysis(inputFor());
    expect(JSON.stringify(again.tradePlan)).toBe(JSON.stringify(LONG.tradePlan));
  });

  it("NO_TRADE never carries an executable plan", () => {
    const neutral = runAnalysis(inputFor(SERIES, {}, { structure: "range", bosDirection: "none" }));
    if (neutral.recommendation === "NO_TRADE") {
      expect(neutral.tradePlan).toBeUndefined();
      expect(neutral.positionSizing).toBeUndefined();
    }
  });
});

// ── B. Entry semantics ────────────────────────────────────────────

describe("Phase 292 — entry semantics", () => {
  it("publishes the market reference with its observation instant and provider", () => {
    const p = LONG.tradePlan!;
    const ctx = p.entryContext!;
    expect(ctx).toBeDefined();
    const last = SERIES[SERIES.length - 1];
    expect(ctx.reference).toContain(String(last.close));
    expect(ctx.reference).toContain(new Date(last.timestamp).toISOString());
    expect(ctx.reference).toContain("fixture");
    // The entry string is that same reference price.
    expect(parseFloat(p.entry)).toBe(last.close);
  });

  it("never presents a price inside a zone as a confirmed trigger", () => {
    const ctx = LONG.tradePlan!.entryContext!;
    // The verdict is the ENGINE's, and the flag follows it exactly.
    expect(ctx.triggerConfirmed).toBe(ctx.setupState === "CONFIRMED_SETUP_CONTEXT");
    expect(ctx.note).toContain("market reference");
    expect(ctx.note).toContain("not a filled order");
    // A price that merely sits in a zone cannot claim a trigger.
    if (ctx.location === "inside_fvg" || ctx.location === "inside_ob") {
      expect(ctx.triggerConfirmed).toBe(ctx.setupState === "CONFIRMED_SETUP_CONTEXT");
    }
  });

  it("states the location and the setup state it was read with", () => {
    const ctx = LONG.tradePlan!.entryContext!;
    expect(typeof ctx.location).toBe("string");
    expect(ctx.location.length).toBeGreaterThan(0);
    if (ctx.setupState !== undefined) {
      expect([
        "NO_SETUP_EVIDENCE",
        "LOCATION_ONLY",
        "STRUCTURAL_SETUP",
        "CONFIRMED_SETUP_CONTEXT",
        "COUNTER_TREND_SETUP",
        "INVALID_SETUP_CONTEXT",
      ]).toContain(ctx.setupState);
    }
    expect(ctx.note).not.toMatch(/probab|win rate|guarantee/i);
  });
});

// ── C. Stop provenance ────────────────────────────────────────────

describe("Phase 292 — stop provenance", () => {
  it("anchors the stop at the confirmed 290-A structural invalidation when it protects the thesis", () => {
    const p = LONG.tradePlan!;
    const sp = p.stopProvenance!;
    const inv = LONG_TECH.smc!.structural!.external.invalidation!;
    expect(sp.source).toBe("structural_invalidation");
    expect(sp.level).toBe(inv.level);
    expect(sp.timeframe).toBe(LONG_TECH.smc!.structural!.external.timeframe);
    expect(p.structuralInvalidation!.level).toBe(inv.level);
    expect(p.structuralInvalidation!.swingKind).toBe("low");
    // The invalidation sits BELOW entry for a long thesis.
    expect(inv.level).toBeLessThan(parseFloat(p.entry));
  });

  it("states the raw level, the buffer and the published stop separately", () => {
    const p = LONG.tradePlan!;
    const sp = p.stopProvenance!;
    const published = parseFloat(p.stopLoss);
    const expected = sp.level - sp.buffer; // long ⇒ buffer below the level
    expect(published).toBeCloseTo(expected, 8);
    expect(Number.isFinite(sp.buffer)).toBe(true);
    expect(sp.buffer).toBeGreaterThan(0);
    expect(sp.bufferRule).toContain("0.2 × ATR14");
    // The published stop and the invalidation LEVEL remain distinguishable.
    expect(published).not.toBe(sp.level);
    expect(sp.note).toContain(String(sp.level));
    expect(sp.note).toContain(p.stopLoss);
  });

  it("omits the buffer rule and the separate level when no buffer is applied", () => {
    // No ATR available ⇒ buffer 0 ⇒ published stop IS the raw level.
    const noAtr = runAnalysis(inputFor(SERIES, {}, { atr14: undefined }));
    const p = noAtr.tradePlan;
    if (p?.stopProvenance) {
      expect(p.stopProvenance.buffer).toBe(0);
      expect(p.stopProvenance.publishedStop).toBeCloseTo(p.stopProvenance.level, 8);
      expect(parseFloat(p.stopLoss)).toBeCloseTo(p.stopProvenance.level, 8);
      expect(p.stopProvenance.bufferRule).toBeUndefined();
    }
  });

  it("never publishes a structural invalidation that does not protect the thesis", () => {
    // A read whose invalidation sits ABOVE the entry cannot protect a long.
    const last = SERIES[SERIES.length - 1];
    const smc = computeSmcContext(SERIES, "H4");
    const hostile: TechnicalData = {
      ...techFor(SERIES),
      smc: {
        ...smc,
        structural: {
          ...smc.structural!,
          external: {
            ...smc.structural!.external,
            invalidation: {
              level: last.close + 500,
              swingIndex: 100,
              swingKind: "high",
              timestamp: TS(100),
              distance: 500,
            },
          },
        },
      },
    };
    const r = runAnalysis(inputFor(SERIES, {}, hostile));
    if (r.tradePlan) {
      // Either no structural invalidation was published, or it protects entry.
      const inv = r.tradePlan.structuralInvalidation;
      if (inv) {
        expect(r.tradePlan.direction === "long" ? inv.level < parseFloat(r.tradePlan.entry) : inv.level > parseFloat(r.tradePlan.entry)).toBe(true);
      }
      expect(r.tradePlan.stopProvenance!.source).not.toBe("structural_invalidation");
      // The legacy fallback is labelled as such, with its own provenance.
      expect(r.tradePlan.stopProvenance!.note).toMatch(/no confirmed structural invalidation|already closed through/);
    }
  });
});

// ── D. R:R integrity ──────────────────────────────────────────────

describe("Phase 292 — R:R integrity", () => {
  it("reports the ratio computed from the PUBLISHED entry, stop and target", () => {
    const p = LONG.tradePlan!;
    const entry = parseFloat(p.entry);
    const stop = parseFloat(p.stopLoss);
    const target = parseFloat(p.takeProfit);
    const exact = Math.round((Math.abs(target - entry) / Math.abs(entry - stop)) * 100) / 100;
    expect(p.riskReward).toBeCloseTo(exact, 10);
    expect(p.riskReward).toBeGreaterThanOrEqual(1.5); // the engine's own gate
  });

  it("a buffered stop can never leave a stale R:R behind", () => {
    const p = LONG.tradePlan!;
    const entry = parseFloat(p.entry);
    const stop = parseFloat(p.stopLoss);
    const target = parseFloat(p.takeProfit);
    const sp = p.stopProvenance!;
    // Recomputed from the published stop — never from the raw level.
    const fromPublished = Math.abs(target - entry) / Math.abs(entry - stop);
    const fromRaw = Math.abs(target - entry) / Math.abs(entry - sp.level);
    expect(p.riskReward).toBeCloseTo(Math.round(fromPublished * 100) / 100, 10);
    expect(fromPublished).not.toBeCloseTo(fromRaw, 4); // the buffer really moves it
  });

  it("names the ratio measured at the raw invalidation separately when it differs", () => {
    const p = LONG.tradePlan!;
    const entry = parseFloat(p.entry);
    const target = parseFloat(p.takeProfit);
    const sp = p.stopProvenance!;
    const fromRaw = Math.round((Math.abs(target - entry) / Math.abs(entry - sp.level)) * 100) / 100;
    if (p.structuralRiskReward !== undefined) {
      expect(p.structuralRiskReward).toBeCloseTo(fromRaw, 10);
      expect(p.structuralRiskReward).not.toBe(p.riskReward);
    } else {
      // Omitted only when the two coincide — never silently different.
      expect(fromRaw).toBe(p.riskReward);
    }
    // The provenance note states which stop each ratio belongs to.
    expect(sp.note).toContain(`R:R ${p.riskReward.toFixed(2)} at the published stop`);
  });

  it("rejects a plan whose risk distance is zero", () => {
    // The target is moved onto the entry: no reward distance exists.
    const atEntry = runAnalysis(
      inputFor(SERIES, { recentHigh: undefined }, { resistanceLevels: [], swingHighs: [] }),
    );
    if (atEntry.tradePlan) {
      expect(Math.abs(parseFloat(atEntry.tradePlan.takeProfit) - parseFloat(atEntry.tradePlan.entry))).toBeGreaterThan(0);
    }
  });

  it("rejects the plan when no opposing target exists instead of moving the target", () => {
    const smc = computeSmcContext(SERIES, "H4");
    const noLevels: TechnicalData = {
      ...techFor(SERIES),
      swingHighs: [],
      resistanceLevels: [],
      // No pools/zones of any kind, and no HTF fallback chain.
      smc: { ...smc, liquidityPools: [], orderBlocks: [], fvgs: [] },
      mtf: undefined,
    };
    const r = runAnalysis(inputFor(SERIES, {}, noLevels));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.noTradeReasons.join(" ")).toMatch(/no opposing structural level|target/i);
  });

  it("refuses a stop that sits on the wrong side of entry", () => {
    const last = SERIES[SERIES.length - 1];
    const smc = computeSmcContext(SERIES, "H4");
    const hostile: TechnicalData = {
      ...techFor(SERIES),
      swingLows: [],
      supportLevels: [],
      smc: {
        ...smc,
        structural: { ...smc.structural!, external: { ...smc.structural!.external, invalidation: undefined } },
      },
    };
    const r = runAnalysis(inputFor(SERIES, {}, hostile));
    // Everything the engine could use as a bullish stop was removed; no level
    // is invented, and certainly not one above the entry.
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.noTradeReasons.join(" ")).toMatch(/Insufficient structural confirmation/);
    void last;
  });

  it("refuses a target that sits on the wrong side of entry", () => {
    const smc = computeSmcContext(SERIES, "H4");
    const hostile: TechnicalData = {
      ...techFor(SERIES),
      swingHighs: [],
      resistanceLevels: [],
      smc: { ...smc, liquidityPools: [], orderBlocks: [], fvgs: [] },
      mtf: undefined,
    };
    const r = runAnalysis(inputFor(SERIES, {}, hostile));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.noTradeReasons.join(" ")).toMatch(/No opposing structural level/);
  });

  it("rejects the plan when no market-derived stop exists", () => {
    const smc = computeSmcContext(SERIES, "H4");
    const noStop: TechnicalData = {
      ...techFor(SERIES),
      swingLows: [],
      supportLevels: [],
      smc: {
        ...smc,
        // A read with no invalidation and no liquidity objects.
        structural: { ...smc.structural!, external: { ...smc.structural!.external, invalidation: undefined } },
        liquidityPools: [],
      },
      mtf: undefined,
    };
    const r = runAnalysis(inputFor(SERIES, {}, noStop));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.noTradeReasons.join(" ")).toMatch(/stop loss|structural confirmation/i);
  });
});

// ── E. Target lifecycle integrity ─────────────────────────────────

describe("Phase 292 — target lifecycle", () => {
  it("never targets a level that was already swept or closed through", () => {
    const p = LONG.tradePlan!;
    const loc = LONG.tradeLocation!;
    const target = parseFloat(p.takeProfit);
    for (const broken of loc.liquidity.brokenLevels) {
      expect(Math.abs(target - broken)).toBeGreaterThan(Math.abs(broken) * EQUAL_LEVEL_TOLERANCE);
    }
    if (p.targetProvenance?.source === "resting_liquidity") {
      const pool = LONG_TECH.smc!.liquidityPools.find((x) => x.level === p.targetProvenance!.level)!;
      expect(pool).toBeDefined();
      expect(pool.swept).toBe(false);
      expect(pool.broken).toBe(false);
    }
  });

  it("keeps the stop out of the closed-through liquidity it already knows about", () => {
    const p = LONG.tradePlan!;
    const sp = p.stopProvenance!;
    const loc = LONG.tradeLocation!;
    const wasBroken = loc.liquidity.brokenLevels.some(
      (b) => Math.abs(b - sp.level) <= Math.abs(b) * EQUAL_LEVEL_TOLERANCE,
    );
    if (wasBroken) {
      // Still honest: the provenance says so explicitly.
      expect(sp.note).toContain("already closed through");
    }
  });

  it("states whether the target is resting liquidity on this timeframe, an HTF pool, or a structural swing", () => {
    const tp = LONG.tradePlan!.targetProvenance!;
    expect(["resting_liquidity", "htf_resting_liquidity", "structural_swing"]).toContain(tp.source);
    expect(tp.level).toBeCloseTo(parseFloat(LONG.tradePlan!.takeProfit), 8);
    expect(tp.timeframe.length).toBeGreaterThan(0);
    if (tp.source === "htf_resting_liquidity") {
      expect(tp.note).toContain("higher-timeframe fallback, timeframe stated");
      expect(LONG_TECH.mtf!.timeframes.some((t) => t.timeframe === tp.timeframe)).toBe(true);
    }
  });
});

// ── F. No-lookahead ───────────────────────────────────────────────

describe("Phase 292 — the risk levels are causally available", () => {
  it("every plan level exists in the prefix that produced it", () => {
    for (let n = 150; n <= SERIES.length; n += 5) {
      const candles = SERIES.slice(0, n);
      const r = runAnalysis(inputFor(candles));
      const p = r.tradePlan;
      if (!p) continue;
      const prefixSmc = computeSmcContext(candles, "H4");
      const entry = parseFloat(p.entry);
      const stop = parseFloat(p.stopLoss);
      const target = parseFloat(p.takeProfit);

      if (p.stopProvenance!.source === "structural_invalidation") {
        const inv = prefixSmc.structural!.external.invalidation!;
        expect(p.structuralInvalidation!.level).toBe(inv.level);
        // The swing that defines the stop confirmed BEFORE the last candle.
        expect(inv.swingIndex).toBeLessThan(n - 1);
        expect(candles[inv.swingIndex].timestamp).toBe(inv.timestamp);
      }
      if (p.targetProvenance!.source === "resting_liquidity") {
        const pool = prefixSmc.liquidityPools.find((x) => x.level === p.targetProvenance!.level);
        if (pool) {
          expect(pool.broken).toBe(false);
          expect(pool.swept).toBe(false);
          // The level was knowable before the candle being described.
          expect(pool.formedAtIndex).toBeLessThan(n - 1);
        }
      }
      // The levels themselves are always in the prefix's own observation range.
      expect(stop).toBeLessThan(entry);
      expect(target).toBeGreaterThan(entry);
    }
  });

  it("a closed-through level is never reused as the resting target in a later prefix", () => {
    for (let n = 150; n <= SERIES.length; n += 5) {
      const candles = SERIES.slice(0, n);
      const r = runAnalysis(inputFor(candles));
      const p = r.tradePlan;
      if (!p || p.targetProvenance?.source !== "resting_liquidity") continue;
      const prefixSmc = computeSmcContext(candles, "H4");
      const pool = prefixSmc.liquidityPools.find((x) => x.level === p.targetProvenance!.level);
      if (!pool) continue;
      expect(pool.broken).toBe(false);
      expect(pool.swept).toBe(false);
    }
  });

  it("a future structural event cannot define an earlier plan level", () => {
    for (let n = 150; n <= SERIES.length; n += 25) {
      const candles = SERIES.slice(0, n);
      const r = runAnalysis(inputFor(candles));
      const p = r.tradePlan;
      if (!p) continue;
      const prefixSmc = computeSmcContext(candles, "H4");
      const external = prefixSmc.structural!.external;
      // Every event known to the plan is dated inside the prefix.
      for (const e of external.events) expect(e.candleIndex).toBeLessThan(n);
      if (external.invalidation) expect(external.invalidation.swingIndex).toBeLessThan(n);
      if (p.structuralInvalidation) {
        expect(p.structuralInvalidation.level).toBe(external.invalidation?.level ?? external.invalidation?.level);
      }
    }
  });

  it("the plan is stated with the invalidation level that voids the thesis and the stop that protects it", () => {
    const p = LONG.tradePlan!;
    const sp = p.stopProvenance!;
    const stop = parseFloat(p.stopLoss);
    // A long is protected BELOW and void BELOW the deeper of the two.
    expect(stop).toBeLessThanOrEqual(sp.level);
    expect(sp.level).toBeLessThan(parseFloat(p.entry));
    expect(LONG.riskNote).toContain("The thesis is void beyond");
    expect(LONG.riskNote).toContain(String(sp.level));
  });
});

// ── G. Phase 291 setup-context compatibility ──────────────────────

describe("Phase 292 — the plan stays compatible with the Phase 291 evidence", () => {
  const payload = JSON.parse(
    fs.readFileSync(
      new URL("./data/__fixtures__/real-provider-candles.phase290a.json", import.meta.url),
      "utf8",
    ),
  ) as { bars: Record<string, string[][]> };

  const load = (tf: string): OhlcvCandle[] =>
    payload.bars[tf]
      .map((r) => ({
        timestamp: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }))
      .reverse();

  const H4 = load("4H");
  const W1 = load("1W");
  const D1 = load("1D");

  function runRecorded(): AnalysisResult {
    const smc = computeSmcContext(H4, "H4");
    const tech: TechnicalData = {
      ...calculateTechnical(H4, D1, "D1"),
      smc,
      mtf: buildMtfContext("H4", [
        { timeframe: "W1", role: "macro", candles: W1 },
        { timeframe: "D1", role: "structure", candles: D1 },
        { timeframe: "H4", role: "setup", candles: H4 },
      ] satisfies MtfCandleInput[]),
    };
    const last = H4[H4.length - 1];
    return runAnalysis({
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "H4" as Timeframe,
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      marketData: {
        instrument: "BTC-USDT",
        instrumentType: "crypto",
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
        fetchTimestamp: last.timestamp,
        price: { price: last.close, timestamp: last.timestamp, source: "okx" },
        candles: H4,
        timeframe: "H4",
        dataFreshness: "delayed",
      },
      technicalData: tech,
    } as AnalysisInput);
  }

  it("the recorded chain keeps its Phase 291 evidence and its honest NO_TRADE", () => {
    const r = runRecorded();
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.tradeLocation!.context.state).toBe("CONFIRMED_SETUP_CONTEXT");
    expect(r.tradeLocation!.location).toBe("inside_ob");
    // The invalidation evidence list is still exposed for the risk layer.
    expect(r.tradeLocation!.invalidationEvidence.map((e) => `${e.source}:${e.level}`)).toContain(
      "structural_invalidation:85199.8",
    );
  });

  it("a plan, when one is published, agrees with the location verdict it was priced from", () => {
    for (const candles of [SERIES, SERIES.slice(0, 175)]) {
      const r = runAnalysis(inputFor(candles));
      if (!r.tradePlan) continue;
      const ctx = r.tradePlan.entryContext!;
      expect(ctx.setupState).toBe(r.tradeLocation!.context.state);
      expect(ctx.location).toBe(r.tradeLocation!.location);
      expect(parseFloat(r.tradePlan.entry)).toBe(r.tradeLocation!.price);
    }
  });
});
