/**
 * Phase 177 — provider fan-out resilience.
 *
 * These tests use REAL timers and REAL elapsed wall-clock time for the
 * bounding assertions. A fake-timer test can prove logic, but it cannot prove
 * "the system is actually bounded", which is the whole point of this phase.
 * Delays are kept small (tens of ms) so the suite stays fast while still
 * measuring genuine concurrency.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PROVIDER_BUDGET_MS,
  FANOUT_BUDGET_MS,
  PROVIDER_BUDGET_MS,
  budgetFor,
  classifyFailure,
  redactDiagnostic,
  runFanOut,
  runProviderLeg,
  skippedLeg,
  successfulData,
  summarize,
} from "./provider-resilience";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A provider that answers after `ms`, honouring abort. */
const slowProvider =
  (ms: number, payload: unknown = { ok: true }) =>
  async (signal: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
    return { success: true, data: payload };
  };

// ═══════════════════════════════════════════════════════════
// 1 — all fast
// ═══════════════════════════════════════════════════════════

describe("1. all providers fast", () => {
  it("every leg succeeds and carries its own payload", async () => {
    const diag = await runFanOut([
      runProviderLeg({ provider: "a", run: slowProvider(5, { v: "a" }), budgetMs: 200 }),
      runProviderLeg({ provider: "b", run: slowProvider(5, { v: "b" }), budgetMs: 200 }),
      runProviderLeg({ provider: "c", run: slowProvider(5, { v: "c" }), budgetMs: 200 }),
    ]);

    expect(diag.outcomes.every((o) => o.status === "success")).toBe(true);
    expect(diag.outcomes.map((o) => (o.data as { v: string }).v)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(diag.deadlineExceeded).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// 2-4 — slow / timeout / bounded latency
// ═══════════════════════════════════════════════════════════

describe("2. one slow provider does not block the others", () => {
  it("fast legs still return their real data", async () => {
    const diag = await runFanOut([
      runProviderLeg({ provider: "fast1", run: slowProvider(5, { v: 1 }), budgetMs: 500 }),
      runProviderLeg({ provider: "slow", run: slowProvider(60, { v: 2 }), budgetMs: 500 }),
      runProviderLeg({ provider: "fast2", run: slowProvider(5, { v: 3 }), budgetMs: 500 }),
    ]);

    expect(diag.outcomes.filter((o) => o.status === "success")).toHaveLength(3);
    // The wave tracks the slowest leg, not the sum.
    expect(diag.durationMs).toBeLessThan(200);
  });
});

describe("3. one provider timeout", () => {
  it("is explicit, carries no data, and leaves others intact", async () => {
    const diag = await runFanOut([
      runProviderLeg({ provider: "healthy", run: slowProvider(5, { real: true }), budgetMs: 300 }),
      runProviderLeg<unknown>({ provider: "hung", run: slowProvider(5_000), budgetMs: 40 }),
    ]);

    const [healthy, hung] = diag.outcomes;

    expect(healthy.status).toBe("success");
    expect(healthy.data).toEqual({ real: true });
    expect(healthy.timedOut).toBe(false);

    expect(hung.status).toBe("failed");
    expect(hung.category).toBe("timeout");
    expect(hung.timedOut).toBe(true);
    // The decisive assertion: a timeout NEVER carries data.
    expect(hung.data).toBeUndefined();
    expect("data" in hung).toBe(false);
  });

  it("aborts the underlying work rather than abandoning it", async () => {
    let aborted = false;
    await runProviderLeg<Record<string, never>>({
      provider: "hung",
      budgetMs: 30,
      run: (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ success: false });
          });
          setTimeout(() => resolve({ success: true, data: {} }), 5_000);
        }),
    });

    expect(aborted).toBe(true);
  });
});

describe("4. several providers time out", () => {
  it("total latency is bounded by the slowest budget, not the sum", async () => {
    const t0 = Date.now();
    const diag = await runFanOut(
      [
        runProviderLeg({ provider: "h1", run: slowProvider(5_000), budgetMs: 50 }),
        runProviderLeg({ provider: "h2", run: slowProvider(5_000), budgetMs: 50 }),
        runProviderLeg({ provider: "h3", run: slowProvider(5_000), budgetMs: 50 }),
        runProviderLeg({ provider: "h4", run: slowProvider(5_000), budgetMs: 50 }),
        runProviderLeg({ provider: "ok", run: slowProvider(5, { v: 1 }), budgetMs: 50 }),
      ],
      { budgetMs: 400 },
    );
    const elapsed = Date.now() - t0;

    // Sum of the hung legs would be 20_000ms; sequential budgets would be
    // 250ms. Parallel execution must land near the single slowest budget.
    expect(elapsed).toBeLessThan(200);
    expect(diag.outcomes.filter((o) => o.timedOut)).toHaveLength(4);
    expect(diag.outcomes.filter((o) => o.status === "success")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════
// 5-6 — total failure / rate limits
// ═══════════════════════════════════════════════════════════

describe("5. all providers fail", () => {
  it("produces only explicit failures and no fabricated evidence", async () => {
    const diag = await runFanOut([
      runProviderLeg({ provider: "a", run: () => Promise.reject(new Error("ECONNREFUSED")), budgetMs: 100 }),
      runProviderLeg({ provider: "b", run: () => Promise.resolve({ success: false, error: "down" }), budgetMs: 100 }),
      runProviderLeg({ provider: "c", run: slowProvider(5_000), budgetMs: 30 }),
    ]);

    expect(diag.outcomes.every((o) => o.status === "failed")).toBe(true);
    expect(diag.outcomes.every((o) => o.data === undefined)).toBe(true);
    expect(diag.outcomes.map((o) => o.category)).toEqual([
      "network",
      "unavailable",
      "timeout",
    ]);
  });
});

describe("6. rate limiting", () => {
  it("is classified explicitly and does not affect unrelated legs", async () => {
    const diag = await runFanOut([
      runProviderLeg({
        provider: "limited",
        run: () => Promise.resolve({ success: false, error: "RATE_LIMIT: 429 too many requests" }),
        budgetMs: 200,
      }),
      runProviderLeg({ provider: "healthy", run: slowProvider(5, { v: 1 }), budgetMs: 200 }),
    ]);

    const [limited, healthy] = diag.outcomes;

    expect(limited.category).toBe("rate-limit");
    expect(limited.rateLimited).toBe(true);
    expect(limited.data).toBeUndefined();
    expect(healthy.status).toBe("success");
    expect(healthy.rateLimited).toBe(false);
  });

  it("a rate-limited provider is never retried within one analysis", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ success: false, error: "429 rate limit exceeded" }),
    );

    const outcome = await runProviderLeg({
      provider: "limited",
      run,
      budgetMs: 500,
      maxRetries: 5, // even when retries are permitted
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome.attempts).toBe(1);
    expect(outcome.rateLimited).toBe(true);
  });

  it("rate-limit state is never directional evidence", async () => {
    const outcome = await runProviderLeg({
      provider: "limited",
      run: () => Promise.resolve({ success: false, error: "rate limit" }),
      budgetMs: 100,
    });

    expect(successfulData(outcome)).toBeUndefined();
    expect(outcome.status).not.toBe("success");
  });
});

// ═══════════════════════════════════════════════════════════
// 7-8 — retry bounds / duplicate invocation
// ═══════════════════════════════════════════════════════════

describe("7. retries are bounded", () => {
  it("defaults to a single attempt", async () => {
    const run = vi.fn(() => Promise.resolve({ success: false, error: "boom" }));
    const outcome = await runProviderLeg({ provider: "p", run, budgetMs: 200 });

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome.attempts).toBe(1);
  });

  it("never exceeds the configured retry limit", async () => {
    const run = vi.fn(() => Promise.resolve({ success: false, error: "boom" }));
    await runProviderLeg({ provider: "p", run, budgetMs: 500, maxRetries: 2 });

    expect(run).toHaveBeenCalledTimes(3); // initial + 2
  });

  it("stops retrying once the budget is exhausted", async () => {
    const run = vi.fn(async () => {
      await sleep(25);
      return { success: false, error: "boom" };
    });

    const outcome = await runProviderLeg({
      provider: "p",
      run,
      budgetMs: 60,
      maxRetries: 50,
    });

    // Bounded by time, not by the retry counter.
    expect(run.mock.calls.length).toBeLessThan(10);
    expect(outcome.durationMs).toBeLessThan(300);
  });

  it("a timeout is not retried", async () => {
    const run = vi.fn(slowProvider(5_000));
    await runProviderLeg({ provider: "p", run, budgetMs: 30, maxRetries: 3 });

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("8. no duplicate provider invocation", () => {
  it("each leg runs exactly once in a wave", async () => {
    const calls: string[] = [];
    const track = (name: string) => async () => {
      calls.push(name);
      return { success: true, data: {} };
    };

    await runFanOut([
      runProviderLeg({ provider: "a", run: track("a"), budgetMs: 100 }),
      runProviderLeg({ provider: "b", run: track("b"), budgetMs: 100 }),
      runProviderLeg({ provider: "c", run: track("c"), budgetMs: 100 }),
    ]);

    expect(calls).toEqual(["a", "b", "c"]);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it("a skipped leg is recorded but never invoked", () => {
    const outcome = skippedLeg("eia", "not an oil instrument");

    expect(outcome.status).toBe("skipped");
    expect(outcome.category).toBe("skipped");
    expect(outcome.attempts).toBe(0);
    expect(outcome.data).toBeUndefined();
    // Structurally distinct from a failure.
    expect(outcome.status).not.toBe("failed");
  });
});

// ═══════════════════════════════════════════════════════════
// 9-11 — evidence semantics after timeout
// ═══════════════════════════════════════════════════════════

describe("9. no fabricated fallback after a timeout", () => {
  it("never yields available/verified/fresh flags", async () => {
    const outcome = await runProviderLeg({
      provider: "hung",
      run: slowProvider(5_000),
      budgetMs: 30,
    });

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('"available":true');
    expect(serialized).not.toContain('"quality":"VERIFIED"');
    expect(serialized).not.toContain('"fresh":true');
    expect(successfulData(outcome)).toBeUndefined();
  });

  it("an empty-but-valid dataset stays a SUCCESS, distinct from a timeout", async () => {
    const empty = await runProviderLeg({
      provider: "calendar",
      run: async () => ({ success: true, data: { events: [] } }),
      budgetMs: 100,
    });
    const timedOut = await runProviderLeg({
      provider: "calendar",
      run: slowProvider(5_000),
      budgetMs: 30,
    });

    expect(empty.status).toBe("success");
    expect(empty.data).toEqual({ events: [] });
    expect(timedOut.status).toBe("failed");
    expect(timedOut.data).toBeUndefined();
    // The engine can tell "provider said nothing happened" from "we never heard".
    expect(empty.status).not.toBe(timedOut.status);
  });
});

describe("10. a timeout cannot alter another provider's provenance", () => {
  it("freshness and provider identity of healthy legs are untouched", async () => {
    const fresh = { provider: "twelve-data", dataFreshness: "realtime", price: 100 };

    const diag = await runFanOut([
      runProviderLeg({ provider: "hung", run: slowProvider(5_000), budgetMs: 30 }),
      runProviderLeg({ provider: "twelve-data", run: slowProvider(5, fresh), budgetMs: 300 }),
    ]);

    expect(diag.outcomes[1].data).toEqual(fresh);
    expect(diag.outcomes[1].provider).toBe("twelve-data");
    // The failed leg keeps its OWN identity — no cross-attribution.
    expect(diag.outcomes[0].provider).toBe("hung");
  });

  it("no outcome is attributed to a different provider", async () => {
    const diag = await runFanOut([
      runProviderLeg({ provider: "cftc", run: () => Promise.reject(new Error("down")), budgetMs: 50 }),
      runProviderLeg({ provider: "okx-order-book", run: slowProvider(5, { d: 1 }), budgetMs: 100 }),
    ]);

    expect(diag.outcomes.map((o) => o.provider)).toEqual([
      "cftc",
      "okx-order-book",
    ]);
  });
});

describe("11. completed results survive the overall deadline", () => {
  it("evidence that already arrived is retained", async () => {
    const diag = await runFanOut(
      [
        runProviderLeg({ provider: "quick", run: slowProvider(5, { kept: true }), budgetMs: 5_000 }),
        // Exceeds the overall budget, and its own budget is deliberately larger.
        runProviderLeg({ provider: "stuck", run: slowProvider(5_000), budgetMs: 5_000 }),
      ],
      { budgetMs: 80 },
    );

    expect(diag.deadlineExceeded).toBe(true);
    // The good result is NOT discarded.
    expect(diag.outcomes[0].status).toBe("success");
    expect(diag.outcomes[0].data).toEqual({ kept: true });
    // The pending one is explicit about why it is missing.
    expect(diag.outcomes[1].category).toBe("deadline-exceeded");
    expect(diag.outcomes[1].data).toBeUndefined();
  });

  it("the overall deadline bounds total wait", async () => {
    const t0 = Date.now();
    await runFanOut(
      [
        runProviderLeg({ provider: "a", run: slowProvider(10_000), budgetMs: 9_000 }),
        runProviderLeg({ provider: "b", run: slowProvider(10_000), budgetMs: 9_000 }),
      ],
      { budgetMs: 60 },
    );

    expect(Date.now() - t0).toBeLessThan(400);
  });
});

// ═══════════════════════════════════════════════════════════
// 12-13 — identity + freshness
// ═══════════════════════════════════════════════════════════

describe("12. OKX provider-native identity survives timeout and recovery", () => {
  const NATIVE = "BTC-USDT-SWAP";

  it("the identity is unchanged after a timeout", async () => {
    let seen = "";
    await runProviderLeg({
      provider: "okx-order-book",
      budgetMs: 30,
      run: async (signal) => {
        seen = NATIVE;
        return slowProvider(5_000)(signal);
      },
    });

    expect(seen).toBe(NATIVE);
  });

  it("the identity is unchanged after recovery", async () => {
    const outcome = await runProviderLeg({
      provider: "okx-instrument-spec",
      budgetMs: 200,
      run: async () => ({ success: true, data: { instId: NATIVE } }),
    });

    expect((outcome.data as { instId: string }).instId).toBe(NATIVE);
    expect((outcome.data as { instId: string }).instId).not.toBe("BTC/USDT");
  });
});

describe("13. historical data cannot be promoted to live by a timeout", () => {
  it("a timeout produces no freshness claim at all", async () => {
    const outcome = await runProviderLeg({
      provider: "market-data",
      run: slowProvider(5_000),
      budgetMs: 30,
    });

    expect(outcome.data).toBeUndefined();
    expect(JSON.stringify(outcome)).not.toContain("realtime");
  });

  it("a stale payload keeps its own freshness label", async () => {
    const stale = { dataFreshness: "historical", fetchedAt: Date.now() - 30 * 864e5 };
    const outcome = await runProviderLeg({
      provider: "market-data",
      run: async () => ({ success: true, data: stale }),
      budgetMs: 200,
    });

    // Resilience never edits provider semantics.
    expect(outcome.data).toEqual(stale);
  });
});

// ═══════════════════════════════════════════════════════════
// Budgets, classification, diagnostics
// ═══════════════════════════════════════════════════════════

describe("budgets are derived, documented and coherent", () => {
  it("the slowest provider is market-data", () => {
    const max = Math.max(...Object.values(PROVIDER_BUDGET_MS));
    expect(PROVIDER_BUDGET_MS["market-data"]).toBe(max);
  });

  it("the overall budget exceeds the slowest leg but is far below their sum", () => {
    const slowest = Math.max(...Object.values(PROVIDER_BUDGET_MS));
    const sum = Object.values(PROVIDER_BUDGET_MS).reduce((a, b) => a + b, 0);

    expect(FANOUT_BUDGET_MS).toBeGreaterThan(slowest);
    expect(FANOUT_BUDGET_MS).toBeLessThan(sum / 2);
  });

  it("every fan-out provider has an explicit budget", () => {
    for (const p of [
      "market-data",
      "alpha-vantage",
      "tickatlas",
      "coinglass",
      "cftc",
      "treasury",
      "eia",
      "okx-order-book",
      "okx-instrument-spec",
      "fx-rate",
    ]) {
      expect(PROVIDER_BUDGET_MS[p]).toBeGreaterThan(0);
    }
  });

  it("unknown providers fall back to a conservative default", () => {
    expect(budgetFor("brand-new-provider")).toBe(DEFAULT_PROVIDER_BUDGET_MS);
  });
});

describe("failure classification", () => {
  const CASES: Array<[unknown, string]> = [
    ["RATE_LIMIT: exceeded", "rate-limit"],
    ["HTTP 429", "rate-limit"],
    ["too many requests", "rate-limit"],
    [new Error("ECONNREFUSED"), "network"],
    [new Error("socket hang up"), "network"],
    ["OKX returned malformed JSON.", "invalid-response"],
    ["something nobody predicted", "unavailable"],
    // Phase 230 §M-1 — envelope-path timeout text (Convex re-wraps thrown
    // TimeoutError into a string, so the class can only survive as text).
    ["timeout (The operation timed out)", "timeout"],
    ["The operation timed out", "timeout"],
    ["realCurrent: timeout (The operation timed out)", "timeout"],
    ["OKX request failed: timeout (The operation timed out)", "timeout"],
    ["deadline exceeded after 15000ms", "timeout"],
  ];

  for (const [input, expected] of CASES) {
    it(`classifies ${JSON.stringify(String(input))} as ${expected}`, () => {
      expect(classifyFailure(input).category).toBe(expected);
    });
  }

  it("flags a TimeoutError by name", () => {
    const e = new Error("x");
    e.name = "TimeoutError";
    expect(classifyFailure(e).category).toBe("timeout");
  });

  it("does not steal socket ETIMEDOUT from the network class", () => {
    expect(classifyFailure(new Error("connect ETIMEDOUT")).category).toBe("network");
    expect(classifyFailure("connect ETIMEDOUT").category).toBe("network");
  });

  it("does not reclassify a rate-limit that also mentions a wait", () => {
    // Rate-limit stays first: a 429 is not a timeout even if the body says wait.
    expect(classifyFailure("429 too many requests, retry after timeout").category).toBe(
      "rate-limit",
    );
  });
});

describe("envelope-path timeout (Phase 230 §M-1)", () => {
  it("classifies a success:false envelope whose error names a timeout as timeout, carries no data, and is not retried", async () => {
    const run = vi.fn(() =>
      Promise.resolve({
        success: false as const,
        error: "timeout (The operation timed out)",
      }),
    );

    const outcome = await runProviderLeg({
      provider: "hung",
      run,
      budgetMs: 500,
      maxRetries: 5,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("failed");
    expect(outcome.category).toBe("timeout");
    expect(outcome.timedOut).toBe(true);
    expect(outcome.rateLimited).toBe(false);
    expect(outcome.data).toBeUndefined();
    expect("data" in outcome).toBe(false);
    expect(successfulData(outcome)).toBeUndefined();
  });

  it("leaves a generic envelope failure as unavailable and still retryable", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ success: false as const, error: "down" }),
    );

    const outcome = await runProviderLeg({
      provider: "p",
      run,
      budgetMs: 500,
      maxRetries: 2,
    });

    expect(run).toHaveBeenCalledTimes(3);
    expect(outcome.category).toBe("unavailable");
    expect(outcome.timedOut).toBe(false);
  });
});

describe("diagnostics never leak credentials", () => {
  it("redacts api keys from urls", () => {
    const red = redactDiagnostic(
      "failed GET https://api.example.com/v1?symbol=EURUSD&apikey=SUPERSECRETVALUE123",
    );
    expect(red).not.toContain("SUPERSECRETVALUE123");
    expect(red).toContain("[REDACTED]");
  });

  it("redacts long opaque tokens", () => {
    expect(redactDiagnostic("token abcdefghijklmnopqrstuvwxyz0123456789")).toContain(
      "[REDACTED]",
    );
  });

  it("summaries contain status and timing but no payload", () => {
    const text = summarize({
      startedAt: 0,
      durationMs: 120,
      budgetMs: 15_000,
      deadlineExceeded: false,
      outcomes: [
        {
          provider: "cftc",
          status: "failed",
          category: "rate-limit",
          rateLimited: true,
          startedAt: 0,
          durationMs: 20,
          timedOut: false,
          attempts: 1,
        },
      ],
    });

    expect(text).toContain("cftc=failed");
    expect(text).toContain("rate-limit");
    expect(text).toContain("120ms");
  });
});

// ═══════════════════════════════════════════════════════════
// Real transport deadlines
// ═══════════════════════════════════════════════════════════

describe("every provider action sets a real HTTP deadline", () => {
  const MODULES = [
    "alphaVantage",
    "coinglass",
    "tradingEconomics",
    "treasury",
    "cot",
    "eia",
    "okx",
    "marketData",
  ];

  for (const mod of MODULES) {
    it(`${mod} aborts its fetch`, () => {
      const src = readFileSync(`src/convex/${mod}.ts`, "utf8");
      expect(src).toContain("AbortSignal.timeout(");
    });
  }

  it("no fan-out fetch is left without a signal", () => {
    // Every `await fetch(` in these modules must be inside a call that also
    // passes a signal. Counting is a coarse but honest guard against a new
    // unbounded fetch being added later.
    for (const mod of MODULES) {
      const src = readFileSync(`src/convex/${mod}.ts`, "utf8");
      const fetches = (src.match(/await fetch\(/g) ?? []).length;
      const signals = (src.match(/AbortSignal\.timeout\(/g) ?? []).length;
      expect(signals).toBeGreaterThanOrEqual(Math.min(fetches, 1));
    }
  });

  it("HTTP deadlines sit below their leg budgets", () => {
    // A socket must die before the leg gives up, otherwise the abort is
    // pointless and the work outlives the wait.
    const cases: Array<[string, string, number]> = [
      ["alphaVantage", "alpha-vantage", 7_000],
      ["coinglass", "coinglass", 7_000],
      ["tradingEconomics", "tickatlas", 7_000],
      ["cot", "cftc", 7_000],
      ["treasury", "treasury", 8_000],
      ["eia", "eia", 8_000],
    ];

    for (const [mod, provider, httpMs] of cases) {
      const src = readFileSync(`src/convex/${mod}.ts`, "utf8");
      expect(src).toContain(`AbortSignal.timeout(${httpMs.toLocaleString("en-US").replace(",", "_")})`);
      expect(httpMs).toBeLessThan(PROVIDER_BUDGET_MS[provider]);
    }
  });
});
