/**
 * Phase 230 — FX quote leg failure semantics (fetchFxRate).
 *
 * Before this phase `fetchPair` ended in `catch { return null }` and folded
 * EVERY answer shape into `null`: a 429 (HTTP or Twelve Data JSON `code`),
 * a 401/403, a 5xx, a malformed body and a real "no such conversion" were
 * indistinguishable, all reported as "no FX quote available". And because
 * both legs returned null, the fetcher just stored nothing — the RATE_LIMIT
 * never surfaced. The leg is now an explicit tri-state:
 *
 *  - 429 -> RATE_LIMIT, 401/403 -> AUTH_ERROR (HTTP status AND JSON `code`):
 *    THROWN from the fetcher (both legs share one API key), nothing cached,
 *    explicit envelope.
 *  - transport/provider fault on a leg -> `failed` with a class; BOTH legs
 *    failed -> API_UNAVAILABLE with both classes, nothing cached — an
 *    outage is never "no quote exists".
 *  - answered-but-no-quote stays the existing "no FX quote available"
 *    contract; partial waves (one leg ok) keep the surviving leg cached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderCache, getProviderCache } from "../lib/data/provider-cache-registry";
import { fetchFxRate } from "./marketData";

type Envelope = {
  success: boolean;
  error?: string;
  errorCode?: string;
  direct?: { rate: number; timestamp: number } | null;
  inverse?: { rate: number; timestamp: number } | null;
  acquisition?: string;
  observedAt?: number;
};
const fx = (fetchFxRate as unknown as {
  _handler: (c: unknown, a: { from: string; to: string }) => Promise<Envelope>;
})._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } };
const USD_EUR = { from: "USD", to: "EUR" };
const KEY = { provider: "twelve-data", dataset: "fx-rate", qualifier: "USD>EUR" } as const;

const QUOTE = { close: "1.0850", symbol: "USD/EUR", timestamp: Math.floor(Date.now() / 1000) };
type Route = { status?: number; body?: unknown; throws?: unknown; badJson?: boolean };
let direct: Route = { body: QUOTE };
let inverse: Route = { body: { ...QUOTE, symbol: "EUR/USD" } };
const calls: string[] = [];
const pairOf = (url: string) => decodeURIComponent(/[?&]symbol=([^&]+)/.exec(url)?.[1] ?? "?");

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  process.env.TWELVE_DATA_API_KEY = "test-key";
  direct = { body: QUOTE };
  inverse = { body: { ...QUOTE, symbol: "EUR/USD" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const r = pairOf(url) === "USD/EUR" ? direct : inverse;
      if (r.throws) throw r.throws;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: `status-${status}`,
        json: async () => {
          if (r.badJson) throw new SyntaxError("Unexpected token <");
          return r.body;
        },
      } as unknown as Response;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

describe("230 FX — valid", () => {
  it("both legs quote: success with direct + inverse, cached, hit replays the original observation", async () => {
    const r = await fx(ctx, USD_EUR);
    expect(r.success).toBe(true);
    expect(r.direct?.rate).toBe(1.085);
    expect(r.inverse?.rate).toBe(1.085);
    expect(r.acquisition).toBe("observed-now");
    expect(calls.length).toBe(2);
    expect(getProviderCache().peek(KEY)).not.toBeNull();

    const second = await fx(ctx, USD_EUR);
    expect(calls.length).toBe(2); // pure hit
    expect(second.acquisition).toBe("cache-reused");
    expect(second.observedAt).toBe(r.observedAt);
  });
});

describe("230 FX — fatal classes, thrown out of the cache fetcher", () => {
  it("JSON code 429 on one leg → RATE_LIMIT, nothing cached, provider recovers", async () => {
    direct = { body: { code: 429, message: "You have exceeded your API credits" } };
    const r = await fx(ctx, USD_EUR);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(r.direct).toBeUndefined();
    expect(getProviderCache().peek(KEY)).toBeNull();

    direct = { body: QUOTE };
    const recovered = await fx(ctx, USD_EUR);
    expect(recovered.success).toBe(true);
    expect(recovered.acquisition).toBe("observed-now");
  });

  it("HTTP 429 status on one leg → RATE_LIMIT", async () => {
    inverse = { status: 429, body: {} };
    const r = await fx(ctx, USD_EUR);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it.each([
    ["json", { body: { code: 401, message: "invalid api key" } } as Route],
    ["json", { body: { code: 403, message: "forbidden" } } as Route],
    ["http", { status: 401, body: {} } as Route],
    ["http", { status: 403, body: {} } as Route],
  ])("%s-level auth rejection → AUTH_ERROR, nothing cached", async (_kind, route) => {
    direct = route;
    const r = await fx(ctx, USD_EUR);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("the api key never appears in any envelope", async () => {
    process.env.TWELVE_DATA_API_KEY = "SECRET-VALUE-XYZ";
    direct = { body: { code: 401, message: "invalid api key" } };
    expect(JSON.stringify(await fx(ctx, USD_EUR))).not.toContain("SECRET-VALUE-XYZ");
  });
});

describe("230 FX — outage vs 'no quote'", () => {
  it("BOTH legs network-failed → API_UNAVAILABLE naming both classes, nothing cached", async () => {
    direct = { throws: new TypeError("fetch failed") };
    inverse = { throws: new TypeError("fetch failed") };
    const r = await fx(ctx, USD_EUR);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/every leg failed/);
    expect(r.error).toMatch(/direct: network/);
    expect(r.error).toMatch(/inverse: network/);
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("BOTH legs malformed → API_UNAVAILABLE with the malformed class", async () => {
    direct = { badJson: true };
    inverse = { badJson: true };
    const r = await fx(ctx, USD_EUR);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/malformed/);
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("BOTH legs answer with no quote → the existing no-quote contract (uncached miss, not an outage)", async () => {
    direct = { body: {} };
    inverse = { body: {} };
    const r = await fx(ctx, USD_EUR);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBeUndefined();
    expect(r.error).toMatch(/no FX quote available for USD\/EUR/);
    expect(getProviderCache().peek(KEY)).toBeNull();

    const after = calls.length;
    await fx(ctx, USD_EUR);
    expect(calls.length).toBe(after + 2); // a miss caches nothing
  });

  it("one leg ok + one leg network-failed → partial success with the surviving leg cached", async () => {
    inverse = { throws: new TypeError("fetch failed") };
    const r = await fx(ctx, USD_EUR);
    expect(r.success).toBe(true);
    expect(r.direct?.rate).toBe(1.085);
    expect(r.inverse).toBeNull();
    expect(getProviderCache().peek(KEY)).not.toBeNull();
  });
});
