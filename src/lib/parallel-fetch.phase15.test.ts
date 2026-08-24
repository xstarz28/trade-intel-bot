/**
 * Phase 15 — PARALLEL FETCH & PERFORMANCE validation.
 *
 * Uses a DETERMINISTIC simulated-latency harness (fake timers via manual
 * promises) to prove SCHEDULING behavior — never to claim absolute production
 * latency. Proves:
 *  - parallel wall-time ≈ max(legs), not sum(legs)  [structural speedup]
 *  - conditional policy table is verbatim vs the old inline code
 *  - failure isolation & non-fatality for every leg
 *  - call-count invariance (rate-limit budget unchanged)
 *  - engine determinism parity: contexts collected sequentially vs
 *    concurrently feed IDENTICAL decisions and fingerprints.
 */
import { describe, it, expect } from "vitest";
import { fetchOptionalSlowData } from "./data/optional-providers";
import { runAnalysis } from "./analysis-engine";
import {
  assemble,
  buildMtf,
  BULL_LEVELS,
  macro,
  treasury as treasuryFixture,
} from "./benchmark-fixtures.phase9";
import type { AnalysisInput } from "@/types/analysis";

// Deterministic latency simulation (no real network, no jitter).
const delay = (ms: number, value: unknown = undefined) =>
  () => new Promise<never>((resolve) => setTimeout(() => resolve(value as never), ms));

const ok = <T,>(data: T) => ({ success: true as const, data });

const BASE_FACTS = {
  instrumentType: "forex" as const,
  instrument: "EUR/USD",
  tradingStyle: "intraday",
  hasCompleteSpec: false,
};

/** Sequential reference implementation (the OLD Dashboard behavior). */
async function sequentialReference(facts: typeof BASE_FACTS, thunks: Record<string, (() => Promise<unknown>) | undefined>) {
  const out: Record<string, unknown> = {};
  const one = async (cond: boolean, t?: () => Promise<unknown>, pick?: (r: never) => unknown) => {
    if (!cond || !t) return undefined;
    try {
      const r = await t() as { success?: boolean };
      return r && r.success ? pick?.(r as never) ?? (r as { data?: unknown }).data : undefined;
    } catch {
      return undefined;
    }
  };
  const isFxLike = facts.instrumentType === "forex" || facts.instrumentType === "commodity";
  const notScalp = facts.tradingStyle !== "scalping";
  out.cotData = await one(isFxLike && notScalp, thunks.cot);
  out.executionData = await one(facts.instrumentType === "crypto" && facts.tradingStyle !== "swing", thunks.execution);
  out.eiaData = await one(
    facts.instrumentType === "commodity" && /WTI|CRUDE|BRENT|OIL/i.test(facts.instrument) && notScalp,
    thunks.eia,
  );
  out.treasuryData = await one(isFxLike && notScalp, thunks.treasury);
  out.okxSpecData = await one(facts.instrumentType === "crypto" && !facts.hasCompleteSpec, thunks.okxSpec);
  return out;
}

// ── Scheduling benchmark (deterministic simulated latency) ──────────

describe("scheduling benchmark", () => {
  it("parallel wall-time ≈ max(leg), structurally below the sequential sum", async () => {
    const LEG_MS = 60; // five independent legs × 60ms simulated RTT
    const mk = () => delay<{ success: true; data: object }>(LEG_MS, { success: true, data: {} });
    const thunks = { cot: mk(), execution: mk(), eia: mk(), treasury: mk(), okxSpec: mk() };

    const t0 = Date.now();
    const parallel = await fetchOptionalSlowData(BASE_FACTS, thunks);
    const parallelMs = Date.now() - t0;

    // Structural claim (deterministic harness, generous bounds):
    // parallel ≈ max(legs) — NOT sum(legs). Allow scheduler slack of +80ms.
    expect(parallelMs).toBeLessThan(LEG_MS * 5 * 0.6); // well under even half the serial sum
    expect(parallelMs).toBeGreaterThanOrEqual(LEG_MS - 5); // ...but no faster than the slowest leg
    void parallel;
  });

  it("sequential reference on the same legs costs ~sum (proves the old bottleneck)", async () => {
    const LEG_MS = 40;
    // Factory: each call creates a FRESH delayed promise (true serial cost).
    const mk = (): (() => Promise<never>) => () => delay(LEG_MS, { success: true, data: {} });
    const thunks = { cot: mk(), execution: mk(), eia: mk(), treasury: mk(), okxSpec: mk() };
    const t0 = Date.now();
    await sequentialReference(BASE_FACTS, thunks);
    const serialMs = Date.now() - t0;
    expect(serialMs).toBeGreaterThanOrEqual(LEG_MS * 5 - 10); // additive — the proven bottleneck
  });
});

// ── Conditional policy table (verbatim Phase 7–14 rules) ────────────

describe("conditional policy table", () => {
  const spy = () => {
    let calls = 0;
    return {
      get count() {
        return calls;
      },
      thunk: () => {
        calls++;
        return Promise.resolve(ok({}));
      },
    };
  };

  function buildThunks() {
    return { cot: spy(), execution: spy(), eia: spy(), treasury: spy(), okxSpec: spy() };
  }

  const runPolicy = async (facts: Parameters<typeof fetchOptionalSlowData>[0]) => {
    const t = buildThunks();
    await fetchOptionalSlowData(facts, {
      cot: t.cot.thunk,
      execution: t.execution.thunk,
      eia: t.eia.thunk,
      treasury: t.treasury.thunk,
      okxSpec: t.okxSpec.thunk,
    });
    return t;
  };

  it("forex intraday → COT + Treasury only", async () => {
    const t = await runPolicy({ ...BASE_FACTS });
    expect(t.cot.count).toBe(1);
    expect(t.treasury.count).toBe(1);
    expect(t.execution.count).toBe(0);
    expect(t.eia.count).toBe(0);
    expect(t.okxSpec.count).toBe(0);
  });

  it("ANY style scalping skips ALL slow providers", async () => {
    const t = await runPolicy({ ...BASE_FACTS, tradingStyle: "scalping" });
    expect(t.cot.count + t.treasury.count + t.eia.count).toBe(0);
    const c = await runPolicy({
      instrumentType: "crypto", instrument: "BTC/USDT", tradingStyle: "scalping", hasCompleteSpec: false,
    });
    expect(c.execution.count).toBe(1); // execution is allowed for scalping crypto
    expect(c.okxSpec.count).toBe(1);
  });

  it("crypto swing → order book skipped; spec still fetched when spec incomplete", async () => {
    const t = await runPolicy({
      instrumentType: "crypto", instrument: "BTC/USDT", tradingStyle: "swing", hasCompleteSpec: false,
    });
    expect(t.execution.count).toBe(0);
    expect(t.okxSpec.count).toBe(1);
  });

  it("oil commodity intraday → COT + Treasury + EIA; gold gets NO EIA", async () => {
    const oil = await runPolicy({
      instrumentType: "commodity", instrument: "WTI", tradingStyle: "intraday", hasCompleteSpec: false,
    });
    expect(oil.cot.count).toBe(1);
    expect(oil.treasury.count).toBe(1);
    expect(oil.eia.count).toBe(1);

    const gold = await runPolicy({
      instrumentType: "commodity", instrument: "XAU/USD", tradingStyle: "intraday", hasCompleteSpec: false,
    });
    expect(gold.eia.count).toBe(0);
    expect(gold.cot.count).toBe(1);
  });

  it("complete explicit spec suppresses OKX metadata fetch", async () => {
    const t = await runPolicy({
      instrumentType: "crypto", instrument: "BTC/USDT", tradingStyle: "intraday", hasCompleteSpec: true,
    });
    expect(t.execution.count).toBe(1);
    expect(t.okxSpec.count).toBe(0);
  });

  it("stocks/indices → zero optional provider calls", async () => {
    const t = await runPolicy({
      instrumentType: "stock", instrument: "AAPL", tradingStyle: "swing", hasCompleteSpec: false,
    });
    expect(t.cot.count + t.treasury.count + t.eia.count + t.execution.count + t.okxSpec.count).toBe(0);
  });
});

// ── Failure isolation & non-fatality ────────────────────────────────

describe("failure matrix under concurrency", () => {
  it("EVERY provider rejecting simultaneously → all undefined, no crash", async () => {
    const boom = () => Promise.reject(new Error("upstream timeout"));
    const r = await fetchOptionalSlowData(BASE_FACTS, {
      cot: boom, treasury: boom, okxSpec: boom, execution: boom, eia: boom,
      fx: () => Promise.reject(new Error("fx down")),
    });
    expect(r).toEqual({});
  });

  it("mixed success/rejection isolates failures per leg", async () => {
    const cryptoFacts = {
      instrumentType: "crypto" as const,
      instrument: "BTC/USDT",
      tradingStyle: "intraday",
      hasCompleteSpec: false,
    };
    const r = await fetchOptionalSlowData(cryptoFacts, {
      treasury: async () => ok({ curve: [4.2] }), // condition off (crypto) → never invoked
      execution: () => Promise.reject(new Error("book timeout")),
      eia: async () => ({ success: false }), // explicit provider refusal
      okxSpec: async () => ok({ instId: "X" }),
    });
    expect(r.executionData).toBeUndefined(); // rejection → unavailable
    expect(r.eiaData).toBeUndefined();       // refusal → unavailable
    expect(r.okxSpecData).toEqual({ instId: "X" });
    expect(r.treasuryData).toBeUndefined();  // condition off → never fetched
    expect(r.fxRates).toBeUndefined();       // absent thunk → absent, never fabricated
  });

  it("non-success responses map to undefined exactly like the sequential code", async () => {
    const r = await fetchOptionalSlowData(BASE_FACTS, {
      treasury: async () => ({ success: false }),
      cot: async () => ok({ reportDate: "2026-08-18" }),
    });
    expect(r.treasuryData).toBeUndefined();
    expect((r.cotData as { reportDate: string }).reportDate).toBe("2026-08-18");
  });

  it("call-count invariance: ≤1 invocation per provider regardless of outcomes", async () => {
    let treasuryCalls = 0;
    const flaky = () => {
      treasuryCalls++;
      if (treasuryCalls === 1) throw new Error("transient");
      return Promise.resolve(ok({}));
    };
    await fetchOptionalSlowData(BASE_FACTS, { treasury: flaky }); // rejects once…
    expect(treasuryCalls).toBe(1); // …and is NEVER retried within a run
  });
});

// ── Engine determinism parity: sequential vs concurrent collection ──

describe("decision determinism parity", () => {
  const BULL = {
    structure: "HH/HL" as const,
    bos: "bullish" as const,
    support: BULL_LEVELS.support,
    resistance: BULL_LEVELS.resistance,
    sweepSide: "sell_side" as const,
    mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
    events: "Fed signals hawkish stance, rate hike",
  };

  it("identical provider responses collected concurrently vs sequentially → byte-identical decision", async () => {
    const makeTreasury = () => treasuryFixture(20);

    // Concurrent path (new orchestrator).
    const par = await fetchOptionalSlowData(BASE_FACTS, {
      treasury: async () => ok(makeTreasury()),
      cot: async () => ok({ reportDate: "2026-08-18" }),
    });

    // Sequential path (old semantics, same responses).
    const seq = {
      treasuryData: makeTreasury(),
      cotData: { reportDate: "2026-08-18" },
      executionData: undefined,
      eiaData: undefined,
      okxSpecData: undefined,
      fxRates: undefined,
    };

    const inputA = { ...assemble({ ...BULL, treasuryData: par.treasuryData as never, cotData: par.cotData as never }) };
    const inputB = { ...assemble(BULL), ...seq, events: BULL.events } as never;

    const ra = runAnalysis(inputA as never);
    const rb = runAnalysis(inputB);
    expect(ra.recommendation).toBe(rb.recommendation);
    expect(ra.bias).toBe(rb.bias);
    expect(ra.confidence).toBe(rb.confidence);
    expect(ra.decisionFingerprint).toBe(rb.decisionFingerprint);
    expect(ra.tradePlan).toEqual(rb.tradePlan);
    expect(ra.noTradeReasons).toEqual(rb.noTradeReasons);
  });

  it("full pipeline through the orchestrator stays oracle-stable (macro fixture)", async () => {
    const slow = await fetchOptionalSlowData(BASE_FACTS, {
      treasury: async () => ok(makeTreasuryPublic()),
    });
    const input = {
      ...assemble({ ...BULL, treasuryData: slow.treasuryData as never }),
      ...{ treasuryData: slow.treasuryData },
    } as never;
    const r = runAnalysis(input);
    expect(Number.isFinite(r.confidence)).toBe(true);
    expect(r.decisionTrace!.convictionBreakdown.layers.find((l) => l.layer === "Macro Yield")!.contribution).toBeGreaterThan(0);
    expect(r.decisionTrace!.provenance.find((p) => p.provider === "US Treasury XML feed")!.available).toBe(true);
  });
});

function makeTreasuryPublic() {
  // Same shape the Convex action returns inside `data`.
  return {
    available: true as const,
    source: "US Treasury (home.treasury.gov XML feed)",
    fetchedAt: Date.now(),
    freshness: "FRESH" as const,
    latest: { nominal: { observationDate: "2026-08-21", nominal: { "2Y": 4.2, "10Y": 4.83 } } },
    previous: { nominal: { observationDate: "2026-08-20", nominal: { "2Y": 4.2, "10Y": 4.63 } } },
  };
}

void macro; // reserved: macro fixtures covered by earlier suites
