/**
 * Phase 232 — market-data envelope `acquisition` / `observedAt` passthrough.
 *
 * ─── The defect ────────────────────────────────────────────────────
 * `fetchMarketData` has always derived a real acquisition mode and a real
 * observation time from its own cache reads and returned them on its success
 * envelope. `runProviderLeg` has always forwarded both verbatim, and never
 * invents one. The fan-out's provenance builder has always honoured them.
 *
 * Exactly ONE leg on the protected path dropped them in transit: the
 * market-data leg (`acquiredLeg` in `protectedAnalysis.ts`). Every other leg —
 * alpha-vantage, tickatlas, coinglass, okx, treasury, eia — forwarded both.
 *
 * The consequence was an active lie in the diagnostics. Because `ohlcv` is a
 * CACHED dataset, a successful market-data leg arrived at the builder with
 * neither a mode nor an observation timestamp, which is indistinguishable
 * from "the action degraded internally while still reporting success". The
 * builder therefore took its no-completed-cache-read branch and emitted:
 *
 *     market-data/ohlcv = unavailable          <- acquisition had completed
 *
 * That inflated `unavailableCount` in the totals line, and — because
 * `legFromFailure` reports `acquired: false` — it also suppressed the `used`
 * marker on the single most important leg of the analysis, i.e. the one leg
 * the engine cannot run without.
 *
 * ─── Evidence levels ───────────────────────────────────────────────
 *   A. the provider derives it      — marketData.ts (asserted here, real handler)
 *   B. the leg forwards it          — THIS FILE (source pin + real fan-out)
 *   C. the builder renders it       — THIS FILE (real runProtectedAnalysis)
 *   D. deployed runtime             — NOT verifiable here
 *
 * ─── What must NOT change ──────────────────────────────────────────
 * The fix is a passthrough, so the whole phase is really a set of negative
 * assertions. An envelope that legitimately carries NEITHER field must still
 * be reported `unavailable` — that is the Phase 178d integrity property, and
 * the tempting "fix" (stamping `observedAt: Date.now()`) would destroy it by
 * laundering a degraded leg into a claimed fresh observation. Both directions
 * are pinned below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getFunctionName } from "convex/server";
import { runProtectedAnalysis } from "./protectedAnalysis";
import { fetchMarketData } from "./marketData";
import { fetchIntelligence } from "./alphaVantage";
import { fetchDerivatives } from "./coinglass";
import { fetchCalendar } from "./tradingEconomics";
import { fetchCotPositioning } from "./cot";
import { fetchTreasuryYields } from "./treasury";
import { fetchEiaInventory } from "./eia";
import { fetchOkxInstrumentSpec, fetchOkxOrderBook } from "./okx";
import { resetProviderCache } from "../lib/data/provider-cache-registry";

const SERVER = readFileSync("src/convex/protectedAnalysis.ts", "utf8");

function handlerOf<A, R>(a: unknown): (c: never, x: A) => Promise<R> {
  return (a as { _handler: (c: never, x: A) => Promise<R> })._handler;
}

const HANDLERS: Record<string, (c: never, a: never) => Promise<unknown>> = {
  "marketData:fetchMarketData": handlerOf(fetchMarketData) as never,
  "alphaVantage:fetchIntelligence": handlerOf(fetchIntelligence) as never,
  "coinglass:fetchDerivatives": handlerOf(fetchDerivatives) as never,
  "tradingEconomics:fetchCalendar": handlerOf(fetchCalendar) as never,
  "cot:fetchCotPositioning": handlerOf(fetchCotPositioning) as never,
  "treasury:fetchTreasuryYields": handlerOf(fetchTreasuryYields) as never,
  "eia:fetchEiaInventory": handlerOf(fetchEiaInventory) as never,
  "okx:fetchOkxInstrumentSpec": handlerOf(fetchOkxInstrumentSpec) as never,
  "okx:fetchOkxOrderBook": handlerOf(fetchOkxOrderBook) as never,
};

const runAnalysis = handlerOf<Record<string, unknown>, { status?: string }>(
  runProtectedAnalysis,
);

/**
 * Optional per-test wrapper around the REAL market-data envelope.
 *
 * Used to drive states the live providers cannot be coaxed into on demand
 * (a fixed old observation, a degraded envelope with no acquisition claim)
 * without stubbing the provider itself — the handler still runs for real, so
 * the envelope under test keeps its production shape.
 */
let wrapMarketData: ((env: Record<string, unknown>) => Record<string, unknown>) | undefined;

/** Args the fan-out actually sent to the market-data action. */
let marketDataArgs: Record<string, unknown> | undefined;

function ctx(subject = "user_A") {
  const c: Record<string, unknown> = {
    auth: { getUserIdentity: async () => ({ subject, issuer: "test" }) },
    runMutation: async () => "user_stub",
    runQuery: async () => null,
    runAction: async (ref: unknown, args: unknown) => {
      let name = "";
      try {
        name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      } catch {
        return { success: false, error: "unresolvable" };
      }
      const fn = HANDLERS[name];
      if (!fn) return { success: false, error: "not wired" };
      const out = (await fn(c as never, args as never)) as Record<string, unknown>;
      if (name === "marketData:fetchMarketData") {
        marketDataArgs = args as Record<string, unknown>;
        if (wrapMarketData) return wrapMarketData(out);
      }
      return out;
    },
  };
  return c as never;
}

const CANDLES = Array.from({ length: 210 }, (_, i) => ({
  datetime: new Date(Date.now() - (210 - i) * 36e5).toISOString(),
  open: "100",
  high: "100.5",
  low: "99.5",
  close: "100",
  volume: "1000",
}));

function responder(url: string): unknown {
  if (url.includes("time_series")) return { values: [...CANDLES].reverse(), status: "ok" };
  if (url.includes("market/books")) {
    return {
      code: "0",
      data: [{ bids: [["100", "5", "0", "1"]], asks: [["100.1", "5", "0", "1"]], ts: String(Date.now()) }],
    };
  }
  if (url.includes("public/instruments")) {
    return {
      code: "0",
      data: [{ instId: "BTC-USDT-SWAP", instType: "SWAP", ctVal: "0.01", ctValCcy: "BTC", tickSz: "0.1", lotSz: "1", minSz: "1", state: "live" }],
    };
  }
  if (url.includes("twelvedata")) return { close: "1.085" };
  if (url.includes("alphavantage")) return { feed: [] };
  if (url.includes("coinglass")) return { code: "0", data: [{ openInterest: "1000" }] };
  if (url.includes("tickatlas")) return [];
  return {};
}

/** Captured diagnostic lines from one analysis. */
let lines: string[] = [];
/**
 * The real logger, captured ONCE at module load.
 *
 * Seeding this eagerly matters: several tests run a warm-up analysis before
 * they start capturing, and `releaseLogs()` runs unconditionally in
 * `afterEach`. Reading `console.log` inside `captureLogs()` would leave this
 * `undefined` for any test that never captured, and the restore would then
 * replace the logger with `undefined` and break every later test in the file.
 */
const realLog = console.log;

function captureLogs() {
  lines = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
}

function releaseLogs() {
  console.log = realLog;
}

/** Only the per-leg provenance lines. */
const legLines = () =>
  lines.filter((l) => /^[a-z-]+\/[a-z-]+.* = /.test(l));

const legLine = (provider: string): string | undefined =>
  legLines().find((l) => l.startsWith(`${provider}/`));

const modeOf = (provider: string): string | undefined =>
  legLine(provider)?.match(/ = ([a-z-]+)/)?.[1];

const totalsLine = () => lines.find((l) => l.startsWith("totals:"));

const unavailableCount = (): number =>
  Number(totalsLine()?.match(/(\d+) unavailable/)?.[1]);

/** Rendered evidence age in ms, or undefined when no age is shown. */
function ageMsOf(provider: string): number | undefined {
  const raw = legLine(provider)?.match(/age (\d+)(ms|s|m|h)/);
  if (!raw) return undefined;
  const n = Number(raw[1]);
  return { ms: n, s: n * 1_000, m: n * 60_000, h: n * 3_600_000 }[raw[2]]!;
}

const CRYPTO = {
  input: {
    instrument: "BTC/USDT",
    instrumentType: "crypto" as const,
    timeframe: "M5",
    tradingStyle: "scalping" as const,
  },
};

beforeEach(() => {
  resetProviderCache();
  wrapMarketData = undefined;
  marketDataArgs = undefined;
  for (const k of [
    "TWELVE_DATA_API_KEY",
    "ALPHA_VANTAGE_API_KEY",
    "COINGLASS_API_KEY",
    "TICKATLAS_API_KEY",
    "EIA_API_KEY",
  ]) {
    process.env[k] = "test-key";
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = responder(url);
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  releaseLogs();
  vi.unstubAllGlobals();
  resetProviderCache();
});

// ═══════════════════════════════════════════════════════════════
// B — the wire pin: the leg forwards what the envelope carries
// ═══════════════════════════════════════════════════════════════

describe("the market-data leg is wired to forward the envelope", () => {
  const rawBlock = (() => {
    const start = SERVER.indexOf("const acquiredLeg = runProviderLeg<");
    const end = SERVER.indexOf("const intelligenceLeg =", start);
    return start === -1 || end === -1 ? "" : SERVER.slice(start, end);
  })();

  /**
   * The same slice with comments removed.
   *
   * Every assertion below is about CODE. This phase's whole point is a
   * passthrough whose failure mode is a *fabricated* value, so the comments
   * documenting that failure mode necessarily name `Date.now()` — asserting
   * on the raw text would flag the documentation instead of the behaviour.
   */
  const block = rawBlock
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("the block was located (guards the pin itself against a rename)", () => {
    // If this fails the other assertions below are vacuous, so it is asserted
    // explicitly rather than left implied.
    expect(rawBlock.length).toBeGreaterThan(200);
    expect(rawBlock).toContain("fetchMarketData");
    // And the stripping above must not have eaten the code we pin.
    expect(block).toContain("fetchMarketData");
  });

  it("it forwards the acquisition mode", () => {
    expect(block).toMatch(/acquisition:\s*\(r as \{/);
    // The cast must name all three modes the envelope can carry, so a typo
    // cannot silently widen or narrow the accepted contract.
    expect(block).toContain('"observed-now"');
    expect(block).toContain('"observed-shared"');
    expect(block).toContain('"cache-reused"');
  });

  it("it forwards the observation time", () => {
    expect(block).toMatch(/observedAt:\s*\(r as \{ observedAt\?: number \}\)\.observedAt/);
  });

  it("it forwards them VERBATIM — no fallback can be substituted", () => {
    // The whole phase is a passthrough. A `?? Date.now()` (or any coalesce)
    // here would fabricate an observation for a leg that has none, which is
    // precisely the failure mode the tests in the last describe() block pin.
    expect(block).not.toContain("Date.now()");
    expect(block).not.toMatch(/observedAt:[^,]*\?\?/);
    expect(block).not.toMatch(/acquisition:[^,]*\?\?/);
  });

  it("no other leg on the protected path is missing the passthrough", () => {
    // The original defect was a single omitted leg. Assert the property
    // globally so a future leg cannot reintroduce it unnoticed: every
    // `runProviderLeg` whose run() returns a provider envelope must forward
    // both fields.
    const legStarts = [...SERVER.matchAll(/runProviderLeg</g)].map((m) => m.index!);
    expect(legStarts.length).toBeGreaterThanOrEqual(4);

    for (const start of legStarts) {
      const chunk = SERVER.slice(start, SERVER.indexOf("});", start));
      // Skip helpers that only delegate to another leg.
      if (!chunk.includes("runAction")) continue;
      expect(chunk).toMatch(/acquisition:/);
      expect(chunk).toMatch(/observedAt:/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// A + C — the envelope is real, and the builder renders it
// ═══════════════════════════════════════════════════════════════

describe("the provider derives the metadata the leg forwards", () => {
  it("a cold fetchMarketData returns a mode and an observation time", async () => {
    const env = (await handlerOf<Record<string, unknown>, Record<string, unknown>>(
      fetchMarketData,
    )(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M5",
    })) as {
      success: boolean;
      acquisition?: string;
      observedAt?: number;
      data?: unknown;
      technical?: unknown;
    };

    expect(env.success).toBe(true);
    // Phase 232 contract: unchanged in shape from before this phase.
    expect(env.data).toBeDefined();
    expect(env.technical).toBeDefined();
    expect(["observed-now", "observed-shared", "cache-reused"]).toContain(env.acquisition);
    expect(typeof env.observedAt).toBe("number");
    // A real observation is not in the future, and is not the epoch.
    expect(env.observedAt!).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(env.observedAt!).toBeGreaterThan(Date.now() - 60_000);
  });

  it("a completed market-data acquisition is never reported unavailable", async () => {
    // THE REGRESSION. Pre-fix this line read `market-data/ohlcv = unavailable`
    // while the fan-out summary on the same run said `market-data=success`.
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(legLine("market-data")).toBeDefined();
    expect(modeOf("market-data")).not.toBe("unavailable");
    expect(modeOf("market-data")).toBe("observed-now");
  });

  it("the pre-fix signature is gone exactly", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    for (const line of legLines()) {
      expect(line).not.toBe("market-data/ohlcv = unavailable");
    }
  });

  it("the leg is reported as used, not merely acquired", async () => {
    // `legFromFailure` reports acquired:false, which suppressed the `used`
    // marker on the leg the engine depends on most.
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(legLine("market-data")).toContain("used");
    expect(legLine("market-data")).toMatch(/age \d/);
  });

  it("it no longer inflates the unavailable count", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    // A leg that DELIVERED may never be counted unavailable — that was the
    // regression. Phase 283 additionally established that an empty provider
    // body is not a delivered dataset, so the one feed this fixture does not
    // serve (the crypto-native fundamental leg) is now honestly counted. The
    // count must therefore equal exactly the legs that reported no delivery.
    const counted = legLines().filter((l) => l.includes("= unavailable"));
    for (const line of counted) {
      expect(line.startsWith("crypto-fundamentals/")).toBe(true);
    }
    expect(unavailableCount()).toBe(counted.length);
    // The leg the original regression was about is not among them.
    expect(modeOf("market-data")).toBe("observed-now");
  });

  it("the same run's fan-out summary and provenance agree", async () => {
    // The two diagnostic surfaces must not contradict each other: the fan-out
    // said `success` while provenance said `unavailable`.
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    const fanout = lines.find((l) => l.startsWith("fanout "));
    expect(fanout).toContain("market-data=success");
    expect(modeOf("market-data")).toBe("observed-now");
  });
});

// ═══════════════════════════════════════════════════════════════
// Cache hits preserve the ORIGINAL observation
// ═══════════════════════════════════════════════════════════════

describe("a cached market-data read reports the original observation", () => {
  it("a warm analysis reports cache-reused for the ohlcv dataset", async () => {
    await runAnalysis(ctx(), CRYPTO);
    await new Promise((r) => setTimeout(r, 60));

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    // `ohlcv` TTL is 60s, so the candle reads are genuinely reused here.
    expect(modeOf("market-data")).toBe("cache-reused");
  });

  it("the reuse carries the ORIGINAL observedAt — the age grows, it does not reset", async () => {
    await runAnalysis(ctx(), CRYPTO);
    await new Promise((r) => setTimeout(r, 80));

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(modeOf("market-data")).toBe("cache-reused");
    const age = ageMsOf("market-data");
    expect(age).toBeDefined();
    // Re-stamping with the read clock would render ~0ms here. The cache never
    // rewrites `observedAt`, and the leg must not either.
    expect(age!).toBeGreaterThanOrEqual(70);
  });

  it("a cached leg is never described as a new observation", async () => {
    await runAnalysis(ctx(), CRYPTO);

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    const line = legLine("market-data")!;
    expect(line).toContain("cache-reused");
    expect(line).not.toContain("observed-now");
  });

  it("a cache hit is not counted as a provider request caused by this caller", async () => {
    await runAnalysis(ctx(), CRYPTO);
    await new Promise((r) => setTimeout(r, 40));

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    // A reuse implies no provider contact and no quota charge.
    expect(legLine("market-data")).toContain("cache-reused");
    const reused = Number(totalsLine()?.match(/(\d+) reused from cache/)?.[1]);
    expect(reused).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Verbatim passthrough — no fabrication, no degradation laundering
// ═══════════════════════════════════════════════════════════════

describe("observedAt is forwarded verbatim, never re-stamped", () => {
  it("an old observation is reported with its true age", async () => {
    // REACHABILITY PROOF for the fabrication guard. The handler runs for real;
    // only its envelope's observation time is pinned to a known past instant.
    // If the leg stamped `Date.now()` the age below would render `0ms`.
    const fiveSecondsAgo = Date.now() - 5_000;
    wrapMarketData = (env) => ({
      ...env,
      acquisition: "cache-reused",
      observedAt: fiveSecondsAgo,
    });

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(modeOf("market-data")).toBe("cache-reused");
    const age = ageMsOf("market-data");
    expect(age).toBeDefined();
    expect(age!).toBeGreaterThanOrEqual(4_900);
    expect(age!).toBeLessThan(7_000);
  });

  it("the reported age tracks the forwarded value, not the request clock", async () => {
    // Same wiring, two different pinned observations: the rendered age must
    // move with the envelope rather than staying pinned near zero.
    const readAge = async (offsetMs: number) => {
      resetProviderCache();
      wrapMarketData = (env) => ({
        ...env,
        acquisition: "cache-reused",
        observedAt: Date.now() - offsetMs,
      });
      captureLogs();
      await runAnalysis(ctx(), CRYPTO);
      releaseLogs();
      return ageMsOf("market-data");
    };

    const a = await readAge(2_000);
    const b = await readAge(8_000);

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b!).toBeGreaterThan(a!);
  });

  it("an envelope with NO acquisition claim is still reported unavailable", async () => {
    // THE OTHER DIRECTION. An action that returned `success: true` without
    // completing a single cache read must keep making no claim. This is the
    // Phase 178d integrity property, and the tempting "fix" (defaulting to
    // `observed-now` / `Date.now()`) would break it here.
    wrapMarketData = (env) => {
      const { acquisition: _a, observedAt: _o, ...rest } = env as {
        acquisition?: unknown;
        observedAt?: unknown;
      };
      return rest;
    };

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(modeOf("market-data")).toBe("unavailable");
    // No observation happened, so no age may be rendered.
    expect(legLine("market-data")).not.toMatch(/age \d/);
    expect(legLine("market-data")).not.toContain("observed-now");
    expect(legLine("market-data")).not.toContain("cache-reused");
  });

  it("that degraded leg is not attached or used, and is counted unavailable", async () => {
    wrapMarketData = (env) => {
      const { acquisition: _a, observedAt: _o, ...rest } = env as {
        acquisition?: unknown;
        observedAt?: unknown;
      };
      return rest;
    };

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(legLine("market-data")).not.toContain("used");
    expect(legLine("market-data")).not.toContain("attached");
    expect(unavailableCount()).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Identity — no symbol substitution
// ═══════════════════════════════════════════════════════════════

describe("identity is preserved verbatim", () => {
  it("the provider and dataset are not rewritten to the underlying vendor", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    // The envelope internally names `twelve-data`; the leg identity is
    // `market-data`/`ohlcv` and must stay that way.
    expect(legLine("market-data")).toBeDefined();
    expect(legLine("twelve-data")).toBeUndefined();
  });

  it("the requested instrument reaches the action unchanged", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(marketDataArgs?.instrument).toBe("BTC/USDT");
    expect(marketDataArgs?.timeframe).toBe("M5");
    expect(marketDataArgs?.instrumentType).toBe("crypto");
  });

  it("a failed market-data leg is still reported as a failure, not as data", async () => {
    // The passthrough must not resurrect a leg that genuinely produced
    // nothing: with the transport dead the action returns success:false and
    // the leg must read as a failure with no observation.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    );

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    const line = legLine("market-data");
    expect(line).toBeDefined();
    expect(line).not.toMatch(/age \d/);
    expect(line).not.toContain("observed-now");
    expect(line).not.toContain("cache-reused");
  });
});
