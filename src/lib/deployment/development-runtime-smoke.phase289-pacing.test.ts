/**
 * Phase 289 quota-audit — the harness's Twelve Data MINUTE-WINDOW PACING.
 *
 * Why this exists: run 36164289791 reached the provider's per-minute credit wall
 * before the energy-gate probe could reach the provider-native energy instrument
 * (`WTI/USD`, provider position #7), and the resulting 429 opened the provider
 * circuit and ended the scan at candidate #1. The audit
 * (`/home/user/phase289/RUN-289-QUOTA-AUDIT.md`) proved the spend came from the
 * run's OWN composition — the harness's five-catalog discovery (6 credits) plus
 * the domains analysed before commodity — not from the deployed analysis path,
 * which issues no catalog requests at all.
 *
 * So the fix is scheduling, on the harness side only. What these tests pin:
 *   · the wall-clock window arithmetic (a fake clock, never the real one);
 *   · the probe waiting for the provider's NEXT window when the local model says
 *     the current one is exhausted — and issuing nothing when the pacing budget
 *     cannot cover that wait (bounded, no infinite wait possible);
 *   · that a provider which ACTUALLY answered 429 is never waited out or retried
 *     (the circuit check stays ahead of the pacing gate);
 *   · that pacing changes neither the candidate list, the provider order, the
 *     identities, nor the domain ceiling, and injects no symbol;
 *   · that the pacing is REPORTED as its own thing (a local model), so "waited
 *     for the next minute" can never be read as "the provider refused".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MAX_ATTEMPTS,
  ENERGY_PROBE_CANDIDATE_LIMIT,
  ENERGY_PROBE_MAX_CANDIDATE_LIMIT,
  MAX_CANDIDATE_ATTEMPTS,
  PACING_DEFAULT_MAX_WAIT_MS,
  PACING_MAX_WAIT_MS_CAP,
  PACING_NOT_APPLIED,
  PACING_WINDOW_MS_CAP,
  TWELVE_DATA_ANALYSIS_MAX_CREDITS,
  TWELVE_DATA_MINUTE_CREDITS,
  TWELVE_DATA_WINDOW_MS,
  createProviderCircuit,
  createTwelveDataQuotaPacer,
  discoveryCreditSpend,
  nextTwelveDataWindowStart,
  pacingDelta,
  pacingSummary,
  probeEnergyGate,
  renderSummary,
  reserveAnalysisSlot,
  resolvePacingConfig,
  selectCandidates,
} from "../../../scripts/development-runtime-smoke.mjs";

const SMOKE = readFileSync("scripts/development-runtime-smoke.mjs", "utf8");

/** Exactly on a 60 s wall-clock boundary: 1_699_999_980_000 = 60_000 × 28_333_333. */
const T0 = 1_699_999_980_000;

function fakeClock(start: number) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    at: () => t,
    set: (value: number) => {
      t = value;
    },
  };
}

const COMMODITY_SPEC = {
  domain: "commodity",
  label: "COMMODITY",
  discovery: "twelve-data",
  assetClass: "commodity",
};

/** Raw runtime envelopes, shaped exactly like the deployed action's answers. */
const NON_ENERGY_RESULT = {
  provider: "twelve-data",
  providerInstrumentId: "GAU/EUR",
  priceSnapshot: { price: 1_234.5, timestamp: 1_790_000_000_000, source: "twelve-data" },
  fundamentalSummary: "Commodity physical evidence is limited to macro drivers.",
  fundamentalAssessment: {
    present: true,
    available: true,
    domain: "commodity",
    provider: "twelve-data",
    state: "insufficient",
    commodityProfile: {
      group: "unclassified",
      classificationSource:
        '"GAU/EUR" is not in the canonical instrument registry — generic physical-first commodity hierarchy applied',
    },
    commodityMetrics: null,
    dimensions: [
      { name: "inventories", status: "unavailable", role: "supporting", evidence: [] },
      {
        name: "macro-drivers",
        status: "negative",
        role: "supporting",
        evidence: [{ provider: "US Treasury" }],
      },
    ],
    evidenceProviders: ["US Treasury"],
    limitations: [
      "Inventory UNAVAILABLE — the only configured inventory feed is the U.S. EIA Weekly Petroleum Status Report (US petroleum stocks), which is out of scope for this unclassified instrument.",
    ],
  },
};

const ENERGY_RESULT = {
  provider: "twelve-data",
  providerInstrumentId: "WTI/USD",
  priceSnapshot: { price: 71.2, timestamp: 1_790_000_000_000, source: "twelve-data" },
  fundamentalSummary: "Inventory build: US crude stocks fell 2,600 thousand barrels.",
  fundamentalAssessment: {
    present: true,
    available: true,
    domain: "commodity",
    provider: "twelve-data",
    state: "improving",
    commodityProfile: {
      group: "energy",
      classificationSource: 'canonical registry entry "WTI" (WTI Crude Oil), tags [energy, futures]',
    },
    commodityMetrics: { inventoryLatest: 412_500 },
    dimensions: [
      {
        name: "inventories",
        status: "positive",
        role: "primary",
        evidence: [{ provider: "U.S. Energy Information Administration" }],
      },
    ],
    evidenceProviders: ["U.S. Energy Information Administration"],
    limitations: [],
  },
};

function transportReturning(results: Record<string, unknown>, calls: string[]) {
  return {
    state: { calls: 0, lastError: null, blocked: false },
    action: async (_path: string, args: unknown) => {
      const id = (args as { input: { providerInstrumentId: string } }).input.providerInstrumentId;
      calls.push(id);
      // The runtime's market leg echoes the EXACT provider-native id it priced;
      // the fixtures follow that, so nothing here can look like a substitution.
      const result = results[id];
      return {
        ok: true,
        httpStatus: 200,
        appError: null,
        value: {
          status: "DELIVERED",
          result: result ? { ...(result as Record<string, unknown>), providerInstrumentId: id } : {},
        },
      };
    },
    query: async () => ({ ok: true, httpStatus: 200, appError: null, value: {} }),
  };
}

describe("phase 289 quota-audit — wall-clock window arithmetic", () => {
  it("finds the next provider window boundary (never the current one)", () => {
    expect(nextTwelveDataWindowStart(T0, 60_000)).toBe(T0 + 60_000);
    expect(nextTwelveDataWindowStart(T0 + 1, 60_000)).toBe(T0 + 60_000);
    expect(nextTwelveDataWindowStart(T0 + 20_000, 60_000)).toBe(T0 + 60_000);
    expect(nextTwelveDataWindowStart(T0 + 59_999, 60_000)).toBe(T0 + 60_000);
    // A second boundary is a fresh window, not a zero-length wait.
    expect(nextTwelveDataWindowStart(T0 + 60_000, 60_000)).toBe(T0 + 120_000);
    // Other widths are supported (the spawned-process tests use a tiny one).
    expect(nextTwelveDataWindowStart(T0 + 250, 1_000)).toBe(T0 + 1_000);
    // An unusable width falls back to the documented provider minute.
    expect(nextTwelveDataWindowStart(T0 + 250, 0)).toBe(T0 + 60_000);
    expect(nextTwelveDataWindowStart(T0 + 250, Number.NaN)).toBe(T0 + 60_000);
  });

  it("does not wait while the modelled window can still serve the request", async () => {
    const clock = fakeClock(T0 + 20_000);
    const pacer = createTwelveDataQuotaPacer({ now: clock.now, sleep: clock.sleep });
    const gate = await pacer.reserve({ cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label: "first" });
    expect(gate).toMatchObject({ waitedMs: 0, deferred: false, exhausted: false });
    expect(clock.sleeps).toEqual([]);
    expect(pacer.snapshot().modelledCredits).toBe(TWELVE_DATA_ANALYSIS_MAX_CREDITS);
  });

  it("waits for the NEXT minute window once the current one cannot serve the request", async () => {
    const clock = fakeClock(T0 + 20_000);
    const pacer = createTwelveDataQuotaPacer({ now: clock.now, sleep: clock.sleep });
    // The catalog walk (as the audited run modelled it: 6 credits) already spent
    // most of the minute; a full worst-case analysis does not fit next to it.
    pacer.charge(6, "discovery");
    const gate = await pacer.reserve({ cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label: "COMMODITY probe GAU/EUR" });
    expect(gate.deferred).toBe(true);
    expect(gate.exhausted).toBe(false);
    // 20 s into the minute ⇒ 40 s to the boundary, and the clock lands ON it.
    expect(gate.waitedMs).toBe(40_000);
    expect(clock.sleeps).toEqual([40_000]);
    expect(clock.at() % TWELVE_DATA_WINDOW_MS).toBe(0);
    const snapshot = pacer.snapshot();
    expect(snapshot.waitsCount).toBe(1);
    expect(snapshot.waits[0]).toMatchObject({ label: "COMMODITY probe GAU/EUR", waitedMs: 40_000 });
    // The charge carried into the previous window is gone; the new one holds the
    // analysis that is about to be issued.
    expect(snapshot.modelledCredits).toBe(TWELVE_DATA_ANALYSIS_MAX_CREDITS);
    // And a SECOND analysis cannot ride along in the same window: the model is
    // deliberately worst-case, so at most one analysis leaves per minute.
    const second = await pacer.reserve({ cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label: "second" });
    expect(second.waitedMs).toBe(TWELVE_DATA_WINDOW_MS);
    expect(clock.sleeps).toEqual([40_000, TWELVE_DATA_WINDOW_MS]);
  });

  it("resets the model at the boundary instead of carrying spend across it", async () => {
    const clock = fakeClock(T0 + 20_000);
    const pacer = createTwelveDataQuotaPacer({ now: clock.now, sleep: clock.sleep });
    pacer.charge(4, "discovery");
    clock.set(T0 + 61_000);
    pacer.charge(2, "FOREX EUR/USD");
    const snapshot = pacer.snapshot();
    expect(snapshot.modelledCredits).toBe(2);
    expect(snapshot.charges.map((c: { windowStartAt: number | null }) => c.windowStartAt)).toEqual([
      T0,
      T0 + 60_000,
    ]);
  });

  it("refuses to wait beyond its budget — no request is issued and no infinite wait is possible", async () => {
    const clock = fakeClock(T0 + 20_000);
    const pacer = createTwelveDataQuotaPacer({
      now: clock.now,
      sleep: clock.sleep,
      maxTotalWaitMs: 30_000,
    });
    pacer.charge(8, "discovery");
    const gate = await pacer.reserve({ cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label: "first" });
    expect(gate.exhausted).toBe(true);
    expect(gate.waitedMs).toBe(0);
    expect(gate.reason).toContain("pacing budget");
    expect(clock.sleeps).toEqual([]);
    // Deterministic: the same verdict again, still without sleeping.
    const again = await pacer.reserve({ cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label: "second" });
    expect(again.exhausted).toBe(true);
    expect(again.reason).toBe(gate.reason);
    expect(clock.sleeps).toEqual([]);
    // The budget bounds WAITING, not requesting: once a fresh window has room on
    // its own, the next request is served without any wait at all.
    clock.set(T0 + 60_000);
    const later = await pacer.reserve({ cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label: "third" });
    expect(later).toMatchObject({ exhausted: false, deferred: false, waitedMs: 0 });
  });

  it("bounds every wait to one window and the total to the budget", async () => {
    const clock = fakeClock(T0 + 1);
    const pacer = createTwelveDataQuotaPacer({
      limit: 1,
      now: clock.now,
      sleep: clock.sleep,
      maxTotalWaitMs: 2 * TWELVE_DATA_WINDOW_MS + 500,
    });
    const gates = [];
    for (let i = 0; i < 10; i += 1) {
      gates.push(await pacer.reserve({ cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label: `analysis ${i}` }));
    }
    // Never more than one window per wait, never a sleep of zero, and the run
    // stops on its own budget instead of looping.
    expect(clock.sleeps.length).toBeGreaterThan(0);
    for (const ms of clock.sleeps) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(TWELVE_DATA_WINDOW_MS);
    }
    expect(clock.sleeps.reduce((n, ms) => n + ms, 0)).toBeLessThanOrEqual(2 * TWELVE_DATA_WINDOW_MS + 500);
    expect(gates.some((g: { exhausted: boolean }) => g.exhausted)).toBe(true);
    expect(pacer.snapshot().exhaustedReason).toContain("pacing budget");
  });

  it("is inert when pacing is switched off (window 0), for spawned-process tests", async () => {
    const clock = fakeClock(T0 + 20_000);
    const pacer = createTwelveDataQuotaPacer({ windowMs: 0, now: clock.now, sleep: clock.sleep });
    expect(pacer.enabled).toBe(false);
    expect(pacer.charge(9, "discovery")).toBe(0);
    const gate = await pacer.reserve({ cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label: "x" });
    expect(gate).toMatchObject({ waitedMs: 0, deferred: false, exhausted: false });
    expect(clock.sleeps).toEqual([]);
    expect(pacer.snapshot().modelledCredits).toBe(0);
  });

  it("treats a missing pacer as not-applied rather than as a zero-cost model", async () => {
    expect(await reserveAnalysisSlot(null, { cost: 8, label: "x" })).toEqual({ ...PACING_NOT_APPLIED });
    expect(await reserveAnalysisSlot(undefined)).toEqual({ ...PACING_NOT_APPLIED });
  });
});

describe("phase 289 quota-audit — the knobs are bounded and the model is not a meter", () => {
  it("reads the flag first, the environment second, and defaults to the provider minute", () => {
    expect(resolvePacingConfig({})).toEqual({
      windowMs: TWELVE_DATA_WINDOW_MS,
      limit: TWELVE_DATA_MINUTE_CREDITS,
      maxTotalWaitMs: PACING_DEFAULT_MAX_WAIT_MS,
    });
    expect(resolvePacingConfig({ env: { XSTARZ_SMOKE_PACING_WINDOW_MS: "30000" } }).windowMs).toBe(30_000);
    expect(
      resolvePacingConfig({
        argv: ["--pacing-window-ms", "1000"],
        env: { XSTARZ_SMOKE_PACING_WINDOW_MS: "30000" },
      }).windowMs,
    ).toBe(1_000);
    expect(resolvePacingConfig({ argv: ["--pacing-limit", "12"] }).limit).toBe(12);
    expect(resolvePacingConfig({ env: { XSTARZ_SMOKE_PACING_MAX_WAIT_MS: "0" } }).maxTotalWaitMs).toBe(0);
  });

  it("clamps every knob, so no configuration can widen the provider's minute", () => {
    const huge = resolvePacingConfig({
      env: {
        XSTARZ_SMOKE_PACING_WINDOW_MS: String(10 ** 9),
        XSTARZ_SMOKE_PACING_LIMIT: String(10 ** 9),
        XSTARZ_SMOKE_PACING_MAX_WAIT_MS: String(10 ** 9),
      },
    });
    expect(huge.windowMs).toBe(PACING_WINDOW_MS_CAP);
    expect(huge.maxTotalWaitMs).toBe(PACING_MAX_WAIT_MS_CAP);
    expect(huge.limit).toBeLessThanOrEqual(1_000);
    expect(resolvePacingConfig({ env: { XSTARZ_SMOKE_PACING_LIMIT: "0" } }).limit).toBe(1);
    expect(resolvePacingConfig({ env: { XSTARZ_SMOKE_PACING_WINDOW_MS: "-5" } }).windowMs).toBe(0);
    expect(resolvePacingConfig({ argv: ["--pacing-limit", "not-a-number"] }).limit).toBe(
      TWELVE_DATA_MINUTE_CREDITS,
    );
  });

  it("charges the run's own catalog walk from the provider's report — never a guess", () => {
    // The audited run 36164289791, exactly as its own catalog report reads:
    // five catalogs, six requests (the third page of `/stocks` never answered,
    // `/cryptocurrencies` page 2 did).
    expect(
      discoveryCreditSpend({
        pagesFetched: 5,
        catalogs: [
          { path: "/forex_pairs", pagesFetched: 1, failedPage: null },
          { path: "/stocks", pagesFetched: 0, failedPage: null },
          { path: "/commodities", pagesFetched: 1 },
          { path: "/indices", pagesFetched: 1 },
          { path: "/cryptocurrencies", pagesFetched: 2, failedPage: 2 },
        ],
      }),
    ).toBe(6);
    // A refusal on a first page is one attempted request, even though no page
    // answered; and a report with nothing to count is still one attempt.
    expect(
      discoveryCreditSpend({
        pagesFetched: 0,
        catalogs: [{ path: "/commodities", pagesFetched: 0, failedPage: 1 }],
      }),
    ).toBe(1);
    expect(discoveryCreditSpend(null)).toBe(1);
  });

  it("reports the pacing as a LOCAL model, never as the provider's credit counter", () => {
    const pacer = createTwelveDataQuotaPacer({ now: () => T0 + 1_000, sleep: async () => {} });
    pacer.charge(6, "discovery");
    const snapshot = pacer.snapshot();
    expect(snapshot.model).toContain("LOCAL");
    expect(snapshot.model).toContain("NOT the provider's counter");
    expect(snapshot.model).toContain("api-credits-used");
    expect(snapshot.charges).toEqual([{ label: "discovery", credits: 6, windowStartAt: T0 }]);
    expect(pacingSummary(snapshot)).toBe("waits:0,waited:~0s,modelled-credits:6");
    expect(pacingSummary(null)).toBe("not-configured");
    expect(pacingSummary({ enabled: false, windowMs: 0, maxTotalWaitMs: 0 })).toContain("disabled");
  });

  it("reports the probe's own waits as a delta over the shared pacer", () => {
    const before = { enabled: true, waitsCount: 1, totalWaitMs: 40_000, waits: [{ label: "discovery-ish" }] };
    const after = {
      enabled: true,
      waitsCount: 3,
      totalWaitMs: 100_000,
      waits: [{ label: "discovery-ish" }, { label: "WTI/USD" }, { label: "WTI/USD" }],
    };
    expect(pacingDelta(before, after)).toEqual({
      enabled: true,
      waits: 2,
      waitedMs: 60_000,
      deferred: ["WTI/USD", "WTI/USD"],
    });
    // "No pacer" is reported as absent, never as "waited 0".
    expect(pacingDelta(null, after)).toBeNull();
    expect(pacingDelta(before, null)).toBeNull();
  });
});

describe("phase 289 quota-audit — pacing defers, the probe still decides WHO", () => {
  it("waits before the next candidate, and keeps the provider's own order and identities", async () => {
    const clock = fakeClock(T0 + 10_000);
    const pacer = createTwelveDataQuotaPacer({ now: clock.now, sleep: clock.sleep });
    // The run's own discovery already spent this minute (as in the audited run).
    pacer.charge(6, "discovery");
    const calls: string[] = [];
    const probe = await probeEnergyGate({
      spec: COMMODITY_SPEC as never,
      candidates: [
        { providerInstrumentId: "GAU/EUR", provider: "twelve-data" },
        { providerInstrumentId: "URALS/USD", provider: "twelve-data" },
        { providerInstrumentId: "WTI/USD", provider: "twelve-data" },
        { providerInstrumentId: "XAG/AUD", provider: "twelve-data" },
      ] as never,
      transport: transportReturning(
        {
          "GAU/EUR": NON_ENERGY_RESULT,
          "URALS/USD": NON_ENERGY_RESULT,
          "WTI/USD": ENERGY_RESULT,
        },
        calls,
      ) as never,
      circuit: createProviderCircuit() as never,
      sessionFor: async () => ({ ok: true, token: "t" }),
      seeds: [],
      pauseMs: 0,
      pacer: pacer as never,
    });

    // Provider order preserved, verbatim, and nothing injected: the probe asked
    // exactly the discovered identities, in the order they were discovered, and
    // stopped as soon as both directions were represented.
    expect(calls).toEqual(["GAU/EUR", "URALS/USD", "WTI/USD"]);
    expect(probe.candidatesConsidered).toEqual(["GAU/EUR", "URALS/USD", "WTI/USD", "XAG/AUD"]);
    expect(probe.samples.map((s) => s.instrument)).toEqual(["GAU/EUR", "URALS/USD", "WTI/USD"]);
    expect(probe.samples.map((s) => s.group)).toEqual(["unclassified", "unclassified", "energy"]);
    expect(probe.verdict).toBe("PASS");

    // And every one of those three analyses was DEFERRED to a later minute
    // window than the discovery that preceded it: waiting is what the pacing
    // does, and it is reported as its own thing.
    expect(probe.pacing!.waits).toBe(3);
    expect(probe.pacing!.deferred).toEqual([
      "COMMODITY probe GAU/EUR",
      "COMMODITY probe URALS/USD",
      "COMMODITY probe WTI/USD",
    ]);
    expect(probe.pacing!.waitedMs).toBe(3 * TWELVE_DATA_WINDOW_MS - 10_000);
    expect(pacer.snapshot().waitsCount).toBe(3);
  });

  it("does not wait before a candidate that the deployed runtime already classified (the seed)", async () => {
    const clock = fakeClock(T0 + 10_000);
    const pacer = createTwelveDataQuotaPacer({ now: clock.now, sleep: clock.sleep });
    pacer.charge(6, "discovery");
    const calls: string[] = [];
    const probe = await probeEnergyGate({
      spec: COMMODITY_SPEC as never,
      candidates: [
        { providerInstrumentId: "GAU/EUR", provider: "twelve-data" },
        { providerInstrumentId: "WTI/USD", provider: "twelve-data" },
      ] as never,
      transport: transportReturning({ "WTI/USD": ENERGY_RESULT }, calls) as never,
      circuit: createProviderCircuit() as never,
      sessionFor: async () => ({ ok: true, token: "t" }),
      seeds: [
        {
          instrument: "GAU/EUR",
          provider: "twelve-data",
          runtimeStatus: "DELIVERED",
          verdict: "UNAVAILABLE",
          reason: null,
          group: "unclassified",
          classificationSource: null,
          inventories: "unavailable",
          inventoryLatest: null,
          eiaEvidenceItems: 0,
          petroleumFeedScopeText: true,
        },
      ],
      pauseMs: 0,
      pacer: pacer as never,
    });
    // The seed cost nothing (its analysis already happened), so the only request
    // is the energy candidate — which was deferred, not skipped.
    expect(calls).toEqual(["WTI/USD"]);
    expect(probe.pacing!.waits).toBe(1);
    expect(probe.verdict).toBe("PASS");
  });

  it("never waits out or retries a provider that ACTUALLY answered 429", async () => {
    const clock = fakeClock(T0 + 10_000);
    const pacer = createTwelveDataQuotaPacer({ now: clock.now, sleep: clock.sleep });
    const calls: string[] = [];
    const rateLimited = {
      state: { calls: 0, lastError: null, blocked: false },
      action: async (_path: string, args: unknown) => {
        const id = (args as { input: { providerInstrumentId: string } }).input.providerInstrumentId;
        calls.push(id);
        return {
          ok: true,
          httpStatus: 200,
          appError: null,
          value: {
            status: "DELIVERED",
            result: {
              providerInstrumentId: id,
              technicalSummary:
                "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
              providerDiagnostics: [
                {
                  provider: "market-data",
                  dataset: "ohlcv",
                  acquired: false,
                  attached: false,
                  usedByEngine: false,
                  reason:
                    "Rate limited: [429] You have run out of API credits for the current minute. 10 API credits were used, with the current limit being 8.",
                },
              ],
            },
          },
        };
      },
      query: async () => ({ ok: true, httpStatus: 200, appError: null, value: {} }),
    };
    const probe = await probeEnergyGate({
      spec: COMMODITY_SPEC as never,
      candidates: [
        { providerInstrumentId: "GAU/EUR", provider: "twelve-data" },
        { providerInstrumentId: "WTI/USD", provider: "twelve-data" },
      ] as never,
      transport: rateLimited as never,
      circuit: createProviderCircuit() as never,
      sessionFor: async () => ({ ok: true, token: "t" }),
      seeds: [],
      pauseMs: 0,
      pacer: pacer as never,
    });
    // One request, the provider's own refusal, then the circuit decides: the
    // second candidate is skipped WITHOUT any wait — a refusal is never "waited
    // out", and pacing must not look like a retry.
    expect(calls).toEqual(["GAU/EUR"]);
    expect(probe.stopReason).toContain("provider circuit open");
    expect(probe.stopReason).toContain("RATE_LIMITED");
    expect(clock.sleeps).toEqual([]);
    expect(pacer.snapshot().waitsCount).toBe(0);
    expect(probe.pacing!.waits).toBe(0);
  });

  it("stops — issuing nothing — when its own pacing budget cannot cover the wait", async () => {
    const clock = fakeClock(T0 + 10_000);
    const pacer = createTwelveDataQuotaPacer({ now: clock.now, sleep: clock.sleep, maxTotalWaitMs: 5_000 });
    pacer.charge(8, "discovery");
    const calls: string[] = [];
    const probe = await probeEnergyGate({
      spec: COMMODITY_SPEC as never,
      candidates: [{ providerInstrumentId: "GAU/EUR", provider: "twelve-data" }] as never,
      transport: transportReturning({ "GAU/EUR": NON_ENERGY_RESULT }, calls) as never,
      circuit: createProviderCircuit() as never,
      sessionFor: async () => ({ ok: true, token: "t" }),
      seeds: [],
      pauseMs: 0,
      pacer: pacer as never,
    });
    expect(calls).toEqual([]);
    expect(probe.stopReason).toContain("pacing budget");
    expect(probe.stopReason).toContain("GAU/EUR");
    expect(probe.classified).toBe(0);
    expect(probe.verdict).toBe("UNAVAILABLE");
    expect(clock.sleeps).toEqual([]);
  });

  it("leaves the probe byte-for-byte unchanged when no pacer is supplied", async () => {
    const calls: string[] = [];
    const probe = await probeEnergyGate({
      spec: COMMODITY_SPEC as never,
      candidates: [
        { providerInstrumentId: "GAU/EUR", provider: "twelve-data" },
        { providerInstrumentId: "WTI/USD", provider: "twelve-data" },
      ] as never,
      transport: transportReturning({ "GAU/EUR": NON_ENERGY_RESULT, "WTI/USD": ENERGY_RESULT }, calls) as never,
      circuit: createProviderCircuit() as never,
      sessionFor: async () => ({ ok: true, token: "t" }),
      seeds: [],
      pauseMs: 0,
    });
    expect(calls).toEqual(["GAU/EUR", "WTI/USD"]);
    expect(probe.pacing).toBeNull();
    expect(probe.verdict).toBe("PASS");
  });

  it("keeps the domain ceiling at 3 and the probe's own disclosed scan depth", () => {
    expect(MAX_CANDIDATE_ATTEMPTS).toBe(3);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(ENERGY_PROBE_CANDIDATE_LIMIT).toBe(12);
    expect(ENERGY_PROBE_MAX_CANDIDATE_LIMIT).toBe(40);
    const discovery = {
      success: true,
      instruments: Array.from({ length: 40 }, (_v, i) => ({
        providerInstrumentId: `P${String(i + 1).padStart(2, "0")}/USD`,
        assetClass: "commodity",
        subType: "commodity_spot",
        tradingState: "TRADING",
      })),
    };
    // The domain loop's ceiling is unchanged...
    expect(selectCandidates(COMMODITY_SPEC as never, discovery as never, 12)).toHaveLength(3);
    // ...while the probe's disclosed depth is its own bound, in provider order.
    expect(
      selectCandidates(COMMODITY_SPEC as never, discovery as never, 12, 12).map(
        (c: { providerInstrumentId?: string }) => c.providerInstrumentId,
      ),
    ).toEqual(discovery.instruments.slice(0, 12).map((i) => i.providerInstrumentId));
    // Pacing is invisible to selection: the same inputs give the same output.
    expect(selectCandidates(COMMODITY_SPEC as never, discovery as never, 3)).toEqual(
      selectCandidates(COMMODITY_SPEC as never, discovery as never, 3),
    );
  });

  it("is reachable from a dispatch, with the existing inputs untouched", () => {
    const workflow = readFileSync(".github/workflows/development-runtime-smoke.yml", "utf8");
    // The three pacing knobs travel as workflow inputs -> env -> CLI defaults.
    for (const name of [
      "pacing_window_ms",
      "pacing_limit",
      "pacing_max_wait_ms",
      "XSTARZ_SMOKE_PACING_WINDOW_MS",
      "XSTARZ_SMOKE_PACING_LIMIT",
      "XSTARZ_SMOKE_PACING_MAX_WAIT_MS",
    ]) {
      expect(workflow).toContain(name);
    }
    // Phase 289C-audit's own input and the fixed target are unchanged.
    expect(workflow).toContain("XSTARZ_SMOKE_PROBE_LIMIT: ${{ inputs.probe_limit }}");
    expect(workflow).toContain("XSTARZ_SMOKE_URL: https://tough-goose-455.convex.cloud");
    expect(workflow).toContain("timeout-minutes: 30");
    // An empty input must not become a value: the script falls back to its bound.
    expect(SMOKE).toContain('read("--pacing-window-ms", "XSTARZ_SMOKE_PACING_WINDOW_MS")');
    expect(resolvePacingConfig({ env: { XSTARZ_SMOKE_PACING_WINDOW_MS: "" } }).windowMs).toBe(
      TWELVE_DATA_WINDOW_MS,
    );
    expect(resolvePacingConfig({ env: { XSTARZ_SMOKE_PACING_LIMIT: "" } }).limit).toBe(
      TWELVE_DATA_MINUTE_CREDITS,
    );
    expect(PACING_DEFAULT_MAX_WAIT_MS).toBeLessThan(30 * 60_000);
    expect(PACING_MAX_WAIT_MS_CAP).toBeLessThan(30 * 60_000);
  });

  it("wires the pacer into the run without touching selection, order or the circuit", () => {
    expect(SMOKE).toContain("const pacing = resolvePacingConfig({ argv, env: process.env });");
    expect(SMOKE).toContain("const pacer = createTwelveDataQuotaPacer(pacing);");
    expect(SMOKE).toContain('pacer.charge(discoveryCreditSpend(found), "discovery");');
    expect(SMOKE).toContain("await reserveAnalysisSlot(pacer, {");
    expect(SMOKE).toContain("candidateLimit: probeLimit,\n      pacer,");
    expect(SMOKE).toContain("pacing: pacer.snapshot(),");
    expect(SMOKE).toContain("pacing=${pacingSummary(");
    // The probe checks the circuit BEFORE the pacing gate, so a real 429 can
    // never be deferred into a retry.
    const probeSource = SMOKE.slice(
      SMOKE.indexOf("export async function probeEnergyGate"),
      SMOKE.indexOf("/* ------------------------------------------------------------------ *\n * The run"),
    );
    expect(probeSource.indexOf("circuit.isTripped(provider)")).toBeGreaterThan(-1);
    expect(probeSource.indexOf("circuit.isTripped(provider)")).toBeLessThan(
      probeSource.indexOf("reserveAnalysisSlot(pacer"),
    );
    // And the run-level gate is applied only to Twelve Data candidates.
    expect(SMOKE).toContain('spec.discovery === "twelve-data"\n          ? await reserveAnalysisSlot(pacer, {');
    // Nothing in the pacing code names an instrument: no whitelist, no
    // substitution, no re-ranking — it knows only credits, windows and labels.
    const pacingSource = SMOKE.slice(
      SMOKE.indexOf("Phase 289 quota-audit - Twelve Data minute-window pacing"),
      SMOKE.indexOf("The commodity energy-gate probe"),
    );
    expect(pacingSource.length).toBeGreaterThan(1_000);
    // Comments may cite the audited run (and therefore an instrument); the CODE
    // may not: it knows only credits, windows and labels.
    const pacingCode = pacingSource
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    expect(pacingCode).not.toMatch(/\b(WTI|BRENT|URALS|GAU|XAU|XAG|HG1)\b/);
  });

  it("says the pacing out loud in the summary, as a local model", () => {
    const summary = renderSummary({
      target: { origin: "https://tough-goose-455.convex.cloud", version: "v", versionSemantics: "x" },
      source: { harnessCommit: "a".repeat(40), harnessCommitSource: "override", dispatchRefSha: "b".repeat(40) },
      policy: { clientEvidenceSent: false },
      domains: [],
      pacing: {
        enabled: true,
        windowMs: 60_000,
        limit: 8,
        maxTotalWaitMs: PACING_DEFAULT_MAX_WAIT_MS,
        modelledCredits: 14,
        windowStartAt: T0,
        charges: [],
        waits: [{ label: "COMMODITY probe GAU/EUR", waitedMs: 40_000, windowStartAt: T0 + 60_000 }],
        waitsCount: 1,
        totalWaitMs: 40_000,
        exhaustedReason: null,
        model: "LOCAL",
      },
    });
    expect(summary).toContain("td pacing     : waits:1,waited:~40s,modelled-credits:14");
    expect(summary).toContain("provider minute window 60000 ms");
    expect(summary).toContain("waited 40000 ms before COMMODITY probe GAU/EUR");
  });
});
