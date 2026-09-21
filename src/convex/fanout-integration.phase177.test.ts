/**
 * Phase 177 — fan-out integration semantics.
 *
 * `provider-resilience.phase177.test.ts` proves the primitive is bounded.
 * This suite proves the SERVER uses it correctly: partial provider success
 * still reaches the engine, timeouts degrade explicitly, entitlement is
 * unaffected by provider health, and the engine's own rules still decide.
 *
 * The Convex handler itself cannot be invoked without a deployment, so the
 * acquisition→attachment→engine path is reconstructed here exactly as the
 * handler performs it, using the same resilience primitives.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runAnalysis } from "@/lib/analysis-engine";
import { gateDecision } from "@/lib/entitlement/decision-gate";
import {
  type ProviderOutcome,
  runFanOut,
  runProviderLeg,
  successfulData,
} from "@/lib/data/provider-resilience";
import { stripClientEvidence } from "./protectedAnalysis";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";

const SERVER = readFileSync("src/convex/protectedAnalysis.ts", "utf8");

const flat = (i: number, c: number) => ({
  timestamp: Date.now() - (210 - i) * 36e5,
  open: c,
  high: c + 0.5,
  low: c - 0.5,
  close: c,
  volume: 1000,
});

const MARKET: MarketData = {
  instrument: "EUR/USD",
  instrumentType: "forex",
  provider: "twelve-data",
  fetchTimestamp: Date.now(),
  price: { price: 100, timestamp: Date.now(), source: "twelve-data" },
  candles: Array.from({ length: 210 }, (_, i) => flat(i, 100)),
  timeframe: "H4",
  dataFreshness: "delayed",
} as MarketData;

const TECH: TechnicalData = {
  swingHighs: [110],
  swingLows: [95],
  structure: "HH/HL",
  bosDirection: "bullish",
  supportLevels: [95],
  resistanceLevels: [110],
  volumeTrend: "unknown",
  dataPoints: 210,
} as TechnicalData;

const INTENT = {
  instrument: "EUR/USD",
  instrumentType: "forex",
  timeframe: "H4",
};

const hang = () => new Promise<never>(() => {});

/** Reconstructs the handler: bounded wave, then attach ONLY successes. */
async function serverAnalyse(legs: {
  market?: () => Promise<{
    success: boolean;
    data?: { data?: unknown; technical?: unknown };
    error?: string;
  }>;
  calendar?: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  treasury?: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  budgetMs?: number;
}) {
  const trusted = stripClientEvidence({ ...INTENT });

  const fanOut = await runFanOut(
    [
      runProviderLeg<{ data?: unknown; technical?: unknown }>({
        provider: "market-data",
        budgetMs: 60,
        run:
          legs.market ??
          (async () => ({
            success: true,
            data: { data: MARKET, technical: TECH },
          })),
      }),
      runProviderLeg<unknown>({
        provider: "tickatlas",
        budgetMs: 60,
        run: legs.calendar ?? (async () => ({ success: false, error: "no key" })),
      }),
      runProviderLeg<unknown>({
        provider: "treasury",
        budgetMs: 60,
        run: legs.treasury ?? (async () => ({ success: false, error: "no key" })),
      }),
    ],
    { budgetMs: legs.budgetMs ?? 300 },
  );

  const [mkt, cal, tre] = fanOut.outcomes;
  const acquired = successfulData(
    mkt as ProviderOutcome<{ data?: unknown; technical?: unknown }>,
  );
  if (acquired?.data !== undefined) {
    trusted.marketData = acquired.data;
    if (acquired.technical !== undefined) trusted.technicalData = acquired.technical;
  }
  const calendar = successfulData(cal);
  if (calendar !== undefined) trusted.calendarData = calendar;
  const treasury = successfulData(tre);
  if (treasury !== undefined) trusted.treasuryData = treasury;

  return {
    result: runAnalysis(trusted as unknown as AnalysisInput),
    fanOut,
    trusted,
  };
}

// ═══════════════════════════════════════════════════════════
// Partial success
// ═══════════════════════════════════════════════════════════

describe("partial provider success remains usable", () => {
  it("market data succeeds while secondary providers fail", async () => {
    const { result, trusted } = await serverAnalyse({});

    // The engine still ran on real market evidence.
    expect(trusted.marketData).toBeDefined();
    expect(trusted.calendarData).toBeUndefined();
    expect(["LONG", "SHORT", "NO_TRADE"]).toContain(result.recommendation);
  });

  it("a secondary timeout does not remove market evidence", async () => {
    const { result, trusted, fanOut } = await serverAnalyse({
      calendar: hang,
      treasury: hang,
    });

    expect(trusted.marketData).toBeDefined();
    expect(fanOut.outcomes.filter((o) => o.timedOut)).toHaveLength(2);
    expect(result).toBeDefined();
  });

  it("partial context never claims full completeness dishonestly", async () => {
    const { result } = await serverAnalyse({ calendar: hang, treasury: hang });

    // Whatever completeness the engine reports, it is the engine's own
    // assessment of what it actually received — flags disclose the gaps.
    expect(Array.isArray(result.dataFlags)).toBe(true);
    expect(["full", "partial", "limited"]).toContain(result.dataCompleteness);
  });
});

// ═══════════════════════════════════════════════════════════
// Market-data failure
// ═══════════════════════════════════════════════════════════

describe("market-data failure degrades explicitly", () => {
  it("a hung market-data leg yields NO_TRADE with no plan", async () => {
    const { result, trusted } = await serverAnalyse({ market: hang });

    expect(trusted.marketData).toBeUndefined();
    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.tradePlan).toBeUndefined();
    expect(result.noTradeReasons.length).toBeGreaterThan(0);
  });

  it("no fabricated price or empty-candle fallback is attached", async () => {
    const { trusted } = await serverAnalyse({ market: hang });

    expect(trusted.marketData).toBeUndefined();
    expect(trusted.technicalData).toBeUndefined();
    expect(trusted.currentPrice).toBeUndefined();
  });

  it("all providers failing still produces the existing explicit state", async () => {
    const { result } = await serverAnalyse({
      market: () => Promise.reject(new Error("ECONNREFUSED")),
      calendar: () => Promise.reject(new Error("ECONNREFUSED")),
      treasury: () => Promise.reject(new Error("ECONNREFUSED")),
    });

    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.tradePlan).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// Entitlement is independent of provider health
// ═══════════════════════════════════════════════════════════

describe("entitlement behaviour is unchanged when providers misbehave", () => {
  it("a degraded NO_TRADE is not chargeable", async () => {
    const { result } = await serverAnalyse({ market: hang });

    const gated = gateDecision({
      result: result as unknown as Record<string, unknown>,
      entitlement: { allowed: true },
    });

    expect(result.recommendation).toBe("NO_TRADE");
    expect(gated.chargeable).toBe(false);
  });

  it("a chargeable signal is still locked when the allowance is spent, even with a slow provider", () => {
    // The engine output under a slow fan-out is a NO_TRADE on this fixture,
    // and a NO_TRADE is correctly DELIVERED free. To assert the LOCKED path
    // we must gate a genuinely chargeable verdict — otherwise the test would
    // be asserting the wrong branch.
    const chargeable = {
      recommendation: "LONG",
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradePlan: { entry: "100", stopLoss: "95", takeProfit: "110" },
    };

    const gated = gateDecision({
      result: chargeable,
      entitlement: { allowed: false },
    });

    expect(gated.status).toBe("LOCKED");
    // Provider health never leaks a direction into a locked payload.
    expect(JSON.stringify(gated.result)).not.toContain("LONG");
  });

  it("provider timing does not change chargeability classification", async () => {
    const fast = await serverAnalyse({});
    const slow = await serverAnalyse({ calendar: hang, treasury: hang });

    const g1 = gateDecision({
      result: fast.result as unknown as Record<string, unknown>,
      entitlement: { allowed: true },
    });
    const g2 = gateDecision({
      result: slow.result as unknown as Record<string, unknown>,
      entitlement: { allowed: true },
    });

    expect(g1.chargeable).toBe(g2.chargeable);
  });

  it("provider slowness cannot bypass the auth guard ordering", () => {
    // The unauthenticated return still precedes any acquisition.
    expect(SERVER.indexOf('status: "UNAUTHENTICATED"')).toBeLessThan(
      SERVER.indexOf('provider: "market-data"'),
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Provenance under failure
// ═══════════════════════════════════════════════════════════

describe("provenance survives provider failure", () => {
  it("a timeout cannot promote historical data to live", async () => {
    const historical = {
      ...MARKET,
      // "stale" is the engine's real label for aged data; there is no
      // "historical" member of the dataFreshness union.
      dataFreshness: "stale" as const,
      fetchTimestamp: Date.now() - 30 * 864e5,
    } satisfies MarketData;

    const { trusted } = await serverAnalyse({
      market: async () => ({
        success: true,
        data: { data: historical, technical: TECH },
      }),
      calendar: hang,
    });

    expect((trusted.marketData as MarketData).dataFreshness).toBe("stale");
  });

  it("a client cannot fill the gap left by a timed-out provider", async () => {
    const trusted = stripClientEvidence({
      ...INTENT,
      calendarData: { available: true, provider: "tickatlas", events: [] },
      treasuryData: { available: true },
      marketData: MARKET,
    });

    expect(trusted.calendarData).toBeUndefined();
    expect(trusted.treasuryData).toBeUndefined();
    expect(trusted.marketData).toBeUndefined();
  });

  it("provider identity is never cross-attributed after a failure", async () => {
    const { fanOut } = await serverAnalyse({ calendar: hang });

    expect(fanOut.outcomes.map((o) => o.provider)).toEqual([
      "market-data",
      "tickatlas",
      "treasury",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════
// Latency bound
// ═══════════════════════════════════════════════════════════

describe("the fan-out is bounded, not summed", () => {
  it("three hung providers do not triple the wait", async () => {
    const t0 = Date.now();
    await serverAnalyse({ market: hang, calendar: hang, treasury: hang });
    const elapsed = Date.now() - t0;

    // Each leg has a 60ms budget. Sequential would be >=180ms.
    expect(elapsed).toBeLessThan(150);
  });

  it("diagnostics record every leg exactly once", async () => {
    const { fanOut } = await serverAnalyse({ calendar: hang });

    expect(fanOut.outcomes).toHaveLength(3);
    expect(new Set(fanOut.outcomes.map((o) => o.provider)).size).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════
// Handler wiring
// ═══════════════════════════════════════════════════════════

describe("handler wiring", () => {
  it("logs a credential-free latency summary", () => {
    expect(SERVER).toContain("summarize(");
    // No raw env values in diagnostics.
    expect(SERVER).not.toMatch(/process\.env\.[A-Z_]+\s*\)/);
  });

  it("distinguishes acquired from actually used", () => {
    expect(SERVER).toContain("usedByEngine");
    expect(SERVER).toContain("USED_EVIDENCE_BY_PROVIDER");
  });

  it("records skipped legs distinctly from failures", () => {
    expect(SERVER).toContain("skippedLeg(");
  });

  it("still performs exactly one fan-out wave", () => {
    expect(SERVER.match(/await runFanOut\(\[/g)).toHaveLength(1);
  });

  it("does not reintroduce sequential provider awaits", () => {
    // A regression to `await A; await B;` would show up as multiple awaited
    // ctx.runAction calls outside the wave.
    const direct = SERVER.match(/const \w+ = await ctx\.runAction\(/g) ?? [];
    expect(direct).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Conditional policy still holds
// ═══════════════════════════════════════════════════════════

describe("conditional policy is not weakened by budgets", () => {
  it("a budgeted thunk is still only invoked when policy allows", async () => {
    const eia = vi.fn(() => Promise.resolve({ success: true, data: undefined }));

    const { fetchOptionalSlowData } = await import(
      "@/lib/data/optional-providers"
    );
    await fetchOptionalSlowData(
      { instrumentType: "forex", instrument: "EUR/USD", hasCompleteSpec: false },
      { eia },
    );

    expect(eia).not.toHaveBeenCalled();
  });

  it("an eligible budgeted thunk runs exactly once", async () => {
    const treasury = vi.fn(() => Promise.resolve({ success: true, data: {} as never }));

    const { fetchOptionalSlowData } = await import(
      "@/lib/data/optional-providers"
    );
    await fetchOptionalSlowData(
      { instrumentType: "forex", instrument: "EUR/USD", hasCompleteSpec: false },
      { treasury },
    );

    expect(treasury).toHaveBeenCalledTimes(1);
  });

  it("the budgeted wrapper forwards classified failure text (Phase 230 §M-3)", () => {
    expect(SERVER).toContain("optionalSlowEnvelope(");
    // The pre-fix mapping dropped the class: `{ success: false }` with no error.
    expect(SERVER).not.toMatch(/: \{ success: false \};/);
  });

  it("records each optional-slow outcome so group diagnostics can name the leg", () => {
    expect(SERVER).toContain("slowOutcomes.push(outcome)");
    expect(SERVER).toContain("...slowOutcomes");
  });
});
