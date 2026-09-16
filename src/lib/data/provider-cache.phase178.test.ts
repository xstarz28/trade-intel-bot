/**
 * Phase 178 — cache, quota and freshness integrity.
 *
 * The clock is INJECTED rather than frozen. Advancing an injected clock models
 * genuine elapsed time: freshness must decay because time passed, not because
 * a test forced a label. Concurrency tests use real promises and real
 * scheduling so single-flight is proven, not simulated.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ProviderCacheKey,
  DATASET_FRESH_MS,
  DATASET_TTL_MS,
  ProviderCache,
  assertNoUserData,
  deriveFreshness,
  serializeKey,
} from "./provider-cache";

/** Controllable clock — models elapsed time honestly. */
function clock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (v: number) => {
      t = v;
    },
  };
}

const OHLCV: ProviderCacheKey = {
  provider: "twelve-data",
  dataset: "ohlcv",
  instrument: "EUR/USD",
  instrumentType: "forex",
  timeframe: "H4",
};

// ═══════════════════════════════════════════════════════════
// 1 — cache-key uniqueness
// ═══════════════════════════════════════════════════════════

describe("cache-key uniqueness", () => {
  it("distinguishes timeframes on the same instrument", () => {
    expect(serializeKey({ ...OHLCV, timeframe: "H1" })).not.toBe(
      serializeKey({ ...OHLCV, timeframe: "H4" }),
    );
  });

  it("distinguishes BTC spot from the OKX perpetual swap", () => {
    const spot = serializeKey({
      provider: "coinglass",
      dataset: "derivatives",
      instrument: "BTC/USDT",
    });
    const swap = serializeKey({
      provider: "coinglass",
      dataset: "derivatives",
      instrument: "BTC-USDT-SWAP",
    });

    expect(spot).not.toBe(swap);
  });

  it("distinguishes different quote currencies", () => {
    // The pre-178 CoinGlass key mapped BTC/USDT and BTC/USD both to `deriv:BTC`.
    const usdt = serializeKey({
      provider: "coinglass",
      dataset: "derivatives",
      instrument: "BTC/USDT",
    });
    const usd = serializeKey({
      provider: "coinglass",
      dataset: "derivatives",
      instrument: "BTC/USD",
    });

    expect(usdt).not.toBe(usd);
  });

  it("distinguishes datasets from the same provider", () => {
    const news = serializeKey({
      provider: "alpha-vantage",
      dataset: "news-sentiment",
      instrument: "AAPL",
    });
    const fund = serializeKey({
      provider: "alpha-vantage",
      dataset: "fundamentals",
      instrument: "AAPL",
    });

    expect(news).not.toBe(fund);
  });

  it("distinguishes providers serving the same dataset", () => {
    expect(
      serializeKey({ provider: "okx", dataset: "ohlcv", instrument: "BTC-USDT" }),
    ).not.toBe(
      serializeKey({
        provider: "twelve-data",
        dataset: "ohlcv",
        instrument: "BTC-USDT",
      }),
    );
  });

  it("distinguishes FX conversion directions", () => {
    expect(
      serializeKey({ provider: "twelve-data", dataset: "fx-rate", qualifier: "USD>EUR" }),
    ).not.toBe(
      serializeKey({ provider: "twelve-data", dataset: "fx-rate", qualifier: "EUR>USD" }),
    );
  });

  it("distinguishes calendar currency sets", () => {
    expect(
      serializeKey({ provider: "tickatlas", dataset: "calendar", qualifier: "EUR,USD" }),
    ).not.toBe(
      serializeKey({ provider: "tickatlas", dataset: "calendar", qualifier: "GBP,JPY" }),
    );
  });

  it("preserves exact OKX native identity in the key", () => {
    for (const id of ["BTC-USDT-SWAP", "ETH-USD-240628", "BTC-USDT-241227"]) {
      expect(
        serializeKey({ provider: "okx", dataset: "order-book", instrument: id }),
      ).toContain(id);
    }
  });

  it("does not lowercase the instrument (identity is byte-exact)", () => {
    expect(
      serializeKey({ provider: "okx", dataset: "order-book", instrument: "BTC-USDT-SWAP" }),
    ).not.toContain("btc-usdt-swap");
  });

  it("normalises only case-insensitive dimensions", () => {
    expect(serializeKey({ ...OHLCV, timeframe: "h4" })).toBe(
      serializeKey({ ...OHLCV, timeframe: "H4" }),
    );
    expect(serializeKey({ ...OHLCV, instrumentType: "FOREX" })).toBe(
      serializeKey({ ...OHLCV, instrumentType: "forex" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════
// 2 — timestamp preservation (the core invariant)
// ═══════════════════════════════════════════════════════════

describe("a cache hit preserves the provider observation time", () => {
  let c: ReturnType<typeof clock>;
  let cache: ProviderCache;

  beforeEach(() => {
    c = clock();
    cache = new ProviderCache(c.now);
  });

  it("observedAt is not rewritten on a hit", async () => {
    const observedAt = c.now();
    const first = await cache.fetch(OHLCV, async () => ({
      data: { price: 100 },
      observedAt,
    }));

    c.advance(30_000);
    const second = await cache.fetch(OHLCV, async () => {
      throw new Error("must not refetch inside TTL");
    });

    expect(first!.observedAt).toBe(observedAt);
    expect(second!.observedAt).toBe(observedAt);
  });

  it("age is readAt - observedAt, not readAt - cachedAt", async () => {
    const observedAt = c.now() - 45_000; // provider observed 45s before caching
    await cache.fetch(OHLCV, async () => ({ data: {}, observedAt }));

    c.advance(10_000);
    const hit = await cache.fetch(OHLCV, async () => {
      throw new Error("no refetch");
    });

    // 45s pre-existing age + 10s elapsed = 55s. NOT 10s.
    expect(hit!.ageMs).toBe(55_000);
  });

  it("a cache hit is flagged as such", async () => {
    await cache.fetch(OHLCV, async () => ({ data: {}, observedAt: c.now() }));
    const hit = await cache.fetch(OHLCV, async () => {
      throw new Error("no refetch");
    });

    expect(hit!.fromCache).toBe(true);
  });

  it("a fresh acquisition is not flagged as cached", async () => {
    const miss = await cache.fetch(OHLCV, async () => ({
      data: {},
      observedAt: c.now(),
    }));

    expect(miss!.fromCache).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// 3 — freshness decays with real elapsed time
// ═══════════════════════════════════════════════════════════

describe("freshness is derived, never stored", () => {
  it("the same entry decays without any refetch", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    const observedAt = c.now();

    await cache.fetch(
      { provider: "p", dataset: "cot", instrument: "EUR/USD" },
      async () => ({ data: {}, observedAt }),
    );

    const readings: string[] = [];
    for (const jump of [0, 8 * 864e5, 25 * 864e5, 120 * 864e5]) {
      c.set(observedAt + jump);
      const peek = cache.peek({
        provider: "p",
        dataset: "cot",
        instrument: "EUR/USD",
      });
      readings.push(peek?.freshness ?? "EXPIRED");
    }

    // FRESH -> DELAYED -> STALE -> HISTORICAL, purely from elapsed time.
    expect(readings[0]).toBe("FRESH");
    expect(new Set(readings).size).toBeGreaterThan(1);
  });

  it("classifies each band from age alone", () => {
    const fresh = DATASET_FRESH_MS.ohlcv;
    expect(deriveFreshness("ohlcv", 0)).toBe("FRESH");
    expect(deriveFreshness("ohlcv", fresh)).toBe("FRESH");
    expect(deriveFreshness("ohlcv", fresh * 2)).toBe("DELAYED");
    expect(deriveFreshness("ohlcv", fresh * 6)).toBe("STALE");
    expect(deriveFreshness("ohlcv", fresh * 100)).toBe("HISTORICAL");
  });

  it("rejects impossible ages instead of guessing", () => {
    expect(deriveFreshness("ohlcv", -1)).toBe("UNAVAILABLE");
    expect(deriveFreshness("ohlcv", NaN)).toBe("UNAVAILABLE");
  });

  it("a stale cached value is never labelled FRESH", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    // Provider observed this a long time ago; caching happens now.
    const observedAt = c.now() - 40 * 60_000;

    const got = await cache.fetch(
      { provider: "p", dataset: "quote", instrument: "EUR/USD" },
      async () => ({ data: {}, observedAt }),
    );

    expect(got!.freshness).not.toBe("FRESH");
  });

  it("historical data cannot become realtime through a cache hit", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    const observedAt = c.now() - 30 * 864e5; // 30 days old

    await cache.fetch(
      { provider: "p", dataset: "ohlcv", instrument: "EUR/USD" },
      async () => ({ data: {}, observedAt }),
    );
    const hit = cache.peek({
      provider: "p",
      dataset: "ohlcv",
      instrument: "EUR/USD",
    });

    expect(hit!.freshness).toBe("HISTORICAL");
    expect(hit!.observedAt).toBe(observedAt);
  });
});

// ═══════════════════════════════════════════════════════════
// 4 — TTL expiry triggers reacquisition
// ═══════════════════════════════════════════════════════════

describe("TTL governs reuse", () => {
  it("an expired entry triggers a real provider call", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    const fetcher = vi.fn(async () => ({ data: { n: 1 }, observedAt: c.now() }));

    await cache.fetch(OHLCV, fetcher);
    c.advance(DATASET_TTL_MS.ohlcv + 1);
    await cache.fetch(OHLCV, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("an entry inside TTL causes no provider call", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    const fetcher = vi.fn(async () => ({ data: { n: 1 }, observedAt: c.now() }));

    await cache.fetch(OHLCV, fetcher);
    c.advance(DATASET_TTL_MS.ohlcv - 1);
    await cache.fetch(OHLCV, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("each dataset has its own cadence, not one global TTL", () => {
    expect(DATASET_TTL_MS["order-book"]).toBeLessThan(DATASET_TTL_MS.ohlcv);
    expect(DATASET_TTL_MS.ohlcv).toBeLessThan(DATASET_TTL_MS.calendar);
    expect(DATASET_TTL_MS.calendar).toBeLessThan(DATASET_TTL_MS.cot);
    expect(DATASET_TTL_MS.cot).toBeLessThan(DATASET_TTL_MS.fundamentals);
    expect(new Set(Object.values(DATASET_TTL_MS)).size).toBeGreaterThan(5);
  });

  it("the freshness window is never shorter than the reuse window", () => {
    for (const ds of Object.keys(DATASET_TTL_MS) as Array<
      keyof typeof DATASET_TTL_MS
    >) {
      expect(DATASET_FRESH_MS[ds]).toBeGreaterThanOrEqual(DATASET_TTL_MS[ds]);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// 5 — single-flight
// ═══════════════════════════════════════════════════════════

describe("concurrent misses are deduplicated", () => {
  it("20 concurrent identical requests cause ONE provider call", async () => {
    const cache = new ProviderCache();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { data: { v: calls }, observedAt: Date.now() };
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => cache.fetch(OHLCV, fetcher)),
    );

    expect(calls).toBe(1);
    expect(results.every((r) => (r!.data as { v: number }).v === 1)).toBe(true);
  });

  it("distinct keys are NOT deduplicated together", async () => {
    const cache = new ProviderCache();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { data: {}, observedAt: Date.now() };
    };

    await Promise.all([
      cache.fetch({ ...OHLCV, timeframe: "H1" }, fetcher),
      cache.fetch({ ...OHLCV, timeframe: "H4" }, fetcher),
      cache.fetch({ ...OHLCV, instrument: "GBP/USD" }, fetcher),
    ]);

    expect(calls).toBe(3);
  });

  it("a failed in-flight request does not poison unrelated keys", async () => {
    const cache = new ProviderCache();
    const failing = cache
      .fetch({ ...OHLCV, instrument: "BAD" }, async () => {
        throw new Error("provider down");
      })
      .catch(() => "failed");

    const healthy = await cache.fetch(OHLCV, async () => ({
      data: { ok: true },
      observedAt: Date.now(),
    }));

    expect(await failing).toBe("failed");
    expect(healthy!.data).toEqual({ ok: true });
  });

  it("a failure is not cached — the next attempt retries cleanly", async () => {
    const cache = new ProviderCache();
    let attempt = 0;
    const flaky = async () => {
      attempt++;
      if (attempt === 1) throw new Error("transient");
      return { data: { recovered: true }, observedAt: Date.now() };
    };

    await expect(cache.fetch(OHLCV, flaky)).rejects.toThrow("transient");
    const second = await cache.fetch(OHLCV, flaky);

    expect(attempt).toBe(2);
    expect(second!.data).toEqual({ recovered: true });
  });

  it("concurrent callers sharing a flight are not mislabelled as cache hits", async () => {
    const cache = new ProviderCache();
    const fetcher = async () => {
      await new Promise((r) => setTimeout(r, 15));
      return { data: {}, observedAt: Date.now() };
    };

    const [a, b] = await Promise.all([
      cache.fetch(OHLCV, fetcher),
      cache.fetch(OHLCV, fetcher),
    ]);

    // Both came from ONE provider call; neither is a stored-cache read.
    expect(a!.fromCache).toBe(false);
    expect(b!.fromCache).toBe(false);
  });

  it("quota use drops measurably under repeated analysis", async () => {
    const cache = new ProviderCache();
    const fetcher = vi.fn(async () => ({ data: {}, observedAt: Date.now() }));

    for (let i = 0; i < 10; i++) await cache.fetch(OHLCV, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.getStats().hits).toBe(9);
    expect(cache.getStats().providerCalls).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// 6 — failures and rate limits are never cached as evidence
// ═══════════════════════════════════════════════════════════

describe("no negative caching of evidence", () => {
  it("a null result is not stored", async () => {
    const cache = new ProviderCache();
    await cache.fetch(OHLCV, async () => null);

    expect(cache.peek(OHLCV)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("a rate-limit failure leaves no cached entry", async () => {
    const cache = new ProviderCache();
    await expect(
      cache.fetch(OHLCV, async () => {
        throw new Error("RATE_LIMIT: 429");
      }),
    ).rejects.toThrow();

    expect(cache.peek(OHLCV)).toBeNull();
  });

  it("a cache hit consumes no provider quota", async () => {
    const cache = new ProviderCache();
    const fetcher = vi.fn(async () => ({ data: {}, observedAt: Date.now() }));

    await cache.fetch(OHLCV, fetcher);
    await cache.fetch(OHLCV, fetcher);
    await cache.fetch(OHLCV, fetcher);

    expect(cache.getStats().providerCalls).toBe(1);
  });

  it("an expired entry is never served as current", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    await cache.fetch(OHLCV, async () => ({ data: {}, observedAt: c.now() }));

    c.advance(DATASET_TTL_MS.ohlcv + 1);

    expect(cache.peek(OHLCV)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// 7 — provider identity
// ═══════════════════════════════════════════════════════════

describe("provider identity survives caching", () => {
  it("a cache hit reports the original provider", async () => {
    const cache = new ProviderCache();
    await cache.fetch(
      { provider: "twelve-data", dataset: "ohlcv", instrument: "EUR/USD" },
      async () => ({ data: {}, observedAt: Date.now() }),
    );

    const hit = cache.peek({
      provider: "twelve-data",
      dataset: "ohlcv",
      instrument: "EUR/USD",
    });

    expect(hit!.provider).toBe("twelve-data");
  });

  it("exact OKX native identity round-trips through the cache", async () => {
    const cache = new ProviderCache();
    const key: ProviderCacheKey = {
      provider: "okx",
      dataset: "order-book",
      instrument: "BTC-USDT-SWAP",
    };

    await cache.fetch(key, async () => ({
      data: { instId: "BTC-USDT-SWAP" },
      observedAt: Date.now(),
    }));

    const hit = cache.peek<{ instId: string }>(key);
    expect(hit!.data.instId).toBe("BTC-USDT-SWAP");
    // A lossy key would collide with the spot pair.
    expect(cache.peek({ ...key, instrument: "BTC/USDT" })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// 8 — cross-user isolation
// ═══════════════════════════════════════════════════════════

describe("user-owned data can never enter a shared cache", () => {
  const CASES = [
    { accountEquity: 50_000 },
    { riskPercent: 0.02 },
    { accountCurrency: "EUR" },
    { instrumentSpec: { contractSize: 1 } },
    { nested: { deep: { userId: "user_123" } } },
  ];

  for (const payload of CASES) {
    it(`rejects ${Object.keys(payload)[0]}`, () => {
      expect(() => assertNoUserData(payload, "test")).toThrow(
        /refusing to cache user-owned field/,
      );
    });
  }

  it("public provider data is accepted", () => {
    expect(() =>
      assertNoUserData({ price: 100, provider: "okx", candles: [] }, "test"),
    ).not.toThrow();
  });

  it("the cache refuses to store a payload carrying risk parameters", async () => {
    const cache = new ProviderCache();

    await expect(
      cache.fetch(OHLCV, async () => ({
        data: { price: 100, accountEquity: 10_000 },
        observedAt: Date.now(),
      })),
    ).rejects.toThrow(/user-owned field/);

    expect(cache.size).toBe(0);
  });

  it("cache keys contain no user dimension", () => {
    const key = serializeKey(OHLCV);
    for (const field of ["accountEquity", "riskPercent", "userId", "email"]) {
      expect(key).not.toContain(field);
    }
  });

  it("two users requesting the same instrument share only public evidence", async () => {
    const cache = new ProviderCache();
    const userA = await cache.fetch(OHLCV, async () => ({
      data: { price: 100, provider: "twelve-data" },
      observedAt: Date.now(),
    }));
    const userB = await cache.fetch(OHLCV, async () => {
      throw new Error("should hit cache");
    });

    expect(userB!.data).toEqual(userA!.data);
    expect(JSON.stringify(userB!.data)).not.toContain("account");
  });
});

// ═══════════════════════════════════════════════════════════
// 9 — the four properties stay distinct
// ═══════════════════════════════════════════════════════════

describe("cached / fresh / live / observed are separate properties", () => {
  it("a value can be cached AND fresh", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    await cache.fetch(OHLCV, async () => ({ data: {}, observedAt: c.now() }));
    c.advance(1_000);

    const hit = cache.peek(OHLCV)!;
    expect(hit.fromCache).toBe(true);
    expect(hit.freshness).toBe("FRESH");
  });

  it("a value can be cached AND stale", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    // Long-TTL dataset observed long ago.
    await cache.fetch(
      { provider: "p", dataset: "fundamentals", instrument: "AAPL" },
      async () => ({ data: {}, observedAt: c.now() - 60 * 864e5 }),
    );

    const hit = cache.peek({
      provider: "p",
      dataset: "fundamentals",
      instrument: "AAPL",
    })!;

    expect(hit.fromCache).toBe(true);
    expect(["STALE", "HISTORICAL"]).toContain(hit.freshness);
  });

  it("a cache hit is never proof of a new provider observation", async () => {
    const c = clock();
    const cache = new ProviderCache(c.now);
    const observedAt = c.now();
    await cache.fetch(OHLCV, async () => ({ data: {}, observedAt }));

    c.advance(30_000);
    const hit = cache.peek(OHLCV)!;

    expect(hit.readAt).toBeGreaterThan(hit.observedAt);
    expect(hit.observedAt).toBe(observedAt);
  });
});
