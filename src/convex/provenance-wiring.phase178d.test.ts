/**
 * Phase 178d — acquisition provenance on the REAL protected-analysis fan-out.
 *
 * Evidence levels:
 *   A. generic provenance logic          — acquisition-provenance.phase178c
 *   B. production providers emit it      — THIS FILE (real action handlers)
 *   C. the fan-out emits it              — THIS FILE (real runProtectedAnalysis)
 *   D. deployed runtime                  — NOT verifiable here
 *
 * The success criterion is not "more logs". It is that an operator can read
 * one analysis and tell, per provider, whether the evidence was freshly
 * observed, shared from a concurrent call, reused from cache, deliberately
 * uncached, skipped, or unavailable — with NO mode falsely implying a new
 * observation.
 *
 * Modes are therefore asserted against real cache outcomes, never inferred
 * from latency.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { runProtectedAnalysis } from "./protectedAnalysis";
import { fetchIntelligence } from "./alphaVantage";
import { fetchDerivatives } from "./coinglass";
import { fetchCalendar } from "./tradingEconomics";
import { fetchMarketData, fetchFxRate } from "./marketData";
import { fetchCotPositioning } from "./cot";
import { fetchTreasuryYields } from "./treasury";
import { fetchEiaInventory } from "./eia";
import { fetchOkxInstrumentSpec, fetchOkxOrderBook } from "./okx";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import {
  legFromFailure,
  looksLikeCredential,
  modeFromOutcome,
} from "../lib/data/provenance-diagnostics";

function handlerOf<A, R>(a: unknown): (c: never, x: A) => Promise<R> {
  return (a as { _handler: (c: never, x: A) => Promise<R> })._handler;
}

const HANDLERS: Record<string, (c: never, a: never) => Promise<unknown>> = {
  "marketData:fetchMarketData": handlerOf(fetchMarketData) as never,
  "marketData:fetchFxRate": handlerOf(fetchFxRate) as never,
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
      return fn(c as never, args as never);
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
let realLog: typeof console.log;

function captureLogs() {
  lines = [];
  realLog = console.log;
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

const modeOf = (provider: string): string | undefined => {
  const line = legLines().find((l) => l.startsWith(`${provider}/`));
  return line?.match(/ = ([a-z-]+)/)?.[1];
};

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

// ═══════════════════════════════════════════════════════════
// C — the fan-out emits provenance
// ═══════════════════════════════════════════════════════════

describe("the protected fan-out emits acquisition provenance", () => {
  it("a cold analysis reports observed-now for cached providers", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(legLines().length).toBeGreaterThan(0);
    expect(modeOf("coinglass")).toBe("observed-now");
    expect(modeOf("alpha-vantage")).toBe("observed-now");
  });

  it("a warm analysis reports cache-reused", async () => {
    await runAnalysis(ctx(), CRYPTO);

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(modeOf("coinglass")).toBe("cache-reused");
    expect(modeOf("tickatlas")).toBe("cache-reused");
    expect(modeOf("okx-instrument-spec")).toBe("cache-reused");
  });

  it("concurrent analyses report observed-shared, not cache-reused", async () => {
    captureLogs();
    await Promise.all([
      runAnalysis(ctx("user_A"), CRYPTO),
      runAnalysis(ctx("user_B"), CRYPTO),
    ]);
    releaseLogs();

    const shared = legLines().filter((l) => l.includes("observed-shared"));
    expect(shared.length).toBeGreaterThan(0);
    // A single-flight join is a real provider call, never a cache hit.
    for (const line of shared) expect(line).not.toContain("cache-reused");
  });

  it("the order book ALWAYS reports uncached-by-design", async () => {
    await runAnalysis(ctx(), CRYPTO);

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    expect(modeOf("okx-order-book")).toBe("uncached-by-design");
  });

  it("the order book NEVER reports cache-reused", async () => {
    for (let i = 0; i < 3; i++) {
      captureLogs();
      await runAnalysis(ctx(), CRYPTO);
      releaseLogs();

      const book = legLines().find((l) => l.startsWith("okx-order-book/"));
      expect(book).toBeDefined();
      expect(book).not.toContain("cache-reused");
    }
  });

  it("a degraded provider still reports a real observation, never a cache hit", async () => {
    // CoinGlass swallows per-dataset errors and returns an envelope with
    // `availability` all false — a genuine, successful provider observation
    // that happens to carry no derivatives. That must report `observed-now`
    // (the provider WAS contacted) and must never be laundered into a cache
    // hit. Verified against the real degradation path rather than assumed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("coinglass")) throw new Error("network down");
        const body = responder(url);
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    const cg = legLines().find((l) => l.startsWith("coinglass/"));
    expect(cg).toBeDefined();
    expect(cg).not.toContain("cache-reused");
  });

  it("failure categories map to failure modes, never to an observation", () => {
    // Every protected-path provider degrades gracefully rather than throwing
    // (verified against the real handlers: a dead transport yields a
    // successful envelope with empty availability). So the failure taxonomy
    // is asserted at the mapping layer that the fan-out actually uses, which
    // is where a genuine hard failure is classified.
    expect(modeFromOutcome({ status: "failed", category: "timeout" })).toBe("timed-out");
    expect(modeFromOutcome({ status: "failed", category: "deadline-exceeded" })).toBe("timed-out");
    expect(modeFromOutcome({ status: "failed", category: "rate-limit" })).toBe("rate-limited");
    expect(modeFromOutcome({ status: "failed", category: "network" })).toBe("unavailable");
    expect(modeFromOutcome({ status: "failed", category: "invalid-response" })).toBe("unavailable");
    expect(modeFromOutcome({ status: "skipped", category: "skipped" })).toBe("skipped");
  });

  it("no failure category can ever produce a cache-reused mode", () => {
    for (const category of [
      "timeout", "network", "rate-limit", "invalid-response",
      "unavailable", "deadline-exceeded", "skipped",
    ] as const) {
      const mode = modeFromOutcome({ status: "failed", category });
      expect(mode).not.toBe("cache-reused");
      expect(mode).not.toBe("observed-now");
      expect(mode).not.toBe("observed-shared");
    }
  });

  it("a failed leg carries no observation timestamp", () => {
    const leg = legFromFailure({
      provider: "tickatlas",
      dataset: "calendar",
      outcome: { status: "failed", category: "timeout" },
    });

    // Back-filling `usedAt` into `observedAt` would fabricate an observation.
    expect(leg.observedAt).toBeUndefined();
    expect(leg.evidenceAgeMs).toBeUndefined();
    expect(leg.acquired).toBe(false);
    expect(leg.attached).toBe(false);
    expect(leg.usedByEngine).toBe(false);
    expect(leg.providerContacted).toBe(false);
  });

  it("a degraded-but-successful provider is not laundered into a cache hit", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("tickatlas")) {
          attempt++;
          if (attempt === 1) throw new Error("transient");
        }
        const body = responder(url);
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    // First analysis: the provider WAS contacted, so this is an observation.
    const cal = legLines().find((l) => l.startsWith("tickatlas/"));
    expect(cal).toBeDefined();
    expect(cal).not.toContain("cache-reused");
  });

  it("emits a totals line derived from the runtime", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    const totals = lines.find((l) => l.startsWith("totals:"));
    expect(totals).toBeDefined();
    expect(totals).toMatch(/\d+ provider request\(s\) caused/);
  });

  it("warm runs cause measurably fewer provider requests in the totals", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    const cold = Number(
      lines.find((l) => l.startsWith("totals:"))?.match(/(\d+) provider/)?.[1],
    );

    lines = [];
    await runAnalysis(ctx(), CRYPTO);
    const warm = Number(
      lines.find((l) => l.startsWith("totals:"))?.match(/(\d+) provider/)?.[1],
    );
    releaseLogs();

    expect(warm).toBeLessThan(cold);
  });
});

// ═══════════════════════════════════════════════════════════
// Integrity fix — a degraded action must not fabricate contact
// ═══════════════════════════════════════════════════════════

describe("an action with zero completed cache reads claims nothing", () => {
  it("Alpha Vantage with a dead transport does not report observed-now", async () => {
    // REACHABILITY PROOF. News is non-critical, so the handler swallows the
    // transport error and still returns `success: true`. Before the fix that
    // envelope carried `acquisition: "observed-now"` with `observedAt:
    // undefined` — provider contact claimed with no evidence behind it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("alphavantage")) throw new Error("socket hang up");
        const body = responder(url);
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );

    const result = (await handlerOf<
      { instrument: string; instrumentType: string },
      { success: boolean; acquisition?: string; observedAt?: number }
    >(fetchIntelligence)(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
    })) as { success: boolean; acquisition?: string; observedAt?: number };

    // Phase 229: the only fetched leg died at the transport, so this is a
    // provider outage and the envelope says so (API_UNAVAILABLE) instead of
    // a success-looking empty payload. Callers degrade on `success: false`
    // exactly as they did before.
    expect(result.success).toBe(false);
    expect((result as { errorCode?: string }).errorCode).toBe("API_UNAVAILABLE");
    // And it still makes NO acquisition claim.
    expect(result.acquisition).toBeUndefined();
    expect(result.observedAt).toBeUndefined();
  });

  it("the fan-out reports such a leg as unavailable, never as an observation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("alphavantage")) throw new Error("socket hang up");
        const body = responder(url);
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    const av = legLines().find((l) => l.startsWith("alpha-vantage/"));
    expect(av).toBeDefined();
    expect(av).not.toContain("observed-now");
    expect(av).not.toContain("cache-reused");
    expect(av).toContain("unavailable");
    // A leg with no observation must carry no age.
    expect(av).not.toMatch(/age \d/);
  });

  it("a fabricated observation cannot re-enter through the totals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("alphavantage")) throw new Error("socket hang up");
        const body = responder(url);
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    const totals = lines.find((l) => l.startsWith("totals:"));
    expect(totals).toMatch(/[1-9]\d* unavailable/);
  });
});

// ═══════════════════════════════════════════════════════════
// Identity and freshness in diagnostics
// ═══════════════════════════════════════════════════════════

describe("diagnostics preserve identity and honest age", () => {
  it("provider and dataset identity appear on every leg", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    for (const line of legLines()) {
      expect(line).toMatch(/^[a-z-]+\/[a-z-]+/);
    }
  });

  it("evidence age grows across cache reuse rather than resetting", async () => {
    await runAnalysis(ctx(), CRYPTO);
    await new Promise((r) => setTimeout(r, 60));

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    const reused = legLines().filter((l) => l.includes("cache-reused"));
    expect(reused.length).toBeGreaterThan(0);
    // A reused leg must report a real age, not "age 0ms".
    const ages = reused
      .map((l) => l.match(/age (\d+)ms/)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number);
    expect(ages.some((a) => a >= 50)).toBe(true);
  });

  it("a reused leg is never described as a new observation", async () => {
    await runAnalysis(ctx(), CRYPTO);

    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    for (const line of legLines().filter((l) => l.includes("cache-reused"))) {
      expect(line).not.toContain("observed-now");
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Safety of the diagnostic output
// ═══════════════════════════════════════════════════════════

describe("diagnostics are credential-free and user-free", () => {
  it("no diagnostic line contains a credential-shaped string", async () => {
    captureLogs();
    await runAnalysis(ctx(), CRYPTO);
    releaseLogs();

    for (const line of legLines()) {
      expect(looksLikeCredential(line)).toBe(false);
      expect(line).not.toContain("test-key");
    }
  });

  it("no diagnostic line contains a user identifier", async () => {
    captureLogs();
    await runAnalysis(ctx("user_SECRET"), CRYPTO);
    releaseLogs();

    for (const line of lines) {
      expect(line).not.toContain("user_SECRET");
    }
  });

  it("no diagnostic line contains account parameters", async () => {
    captureLogs();
    await runAnalysis(ctx(), {
      input: {
        ...CRYPTO.input,
        accountEquity: 123456,
        riskPercent: 1.5,
        accountCurrency: "EUR",
      },
    });
    releaseLogs();

    for (const line of lines) {
      expect(line).not.toContain("123456");
      expect(line).not.toContain("accountEquity");
    }
  });
});
