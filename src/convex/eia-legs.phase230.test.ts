/**
 * Phase 230 — EIA per-product leg failure semantics.
 *
 * Before this phase every failure was folded into a per-leg `reason` string
 * and the fetcher ALWAYS returned the legs as a normal payload — so a full
 * EIA outage (3/3 legs down) or a 403 from an invalid key was CACHED for 6h
 * and replayed as an acquisition record. The shared leg taxonomy now
 * governs all three legs:
 *
 *  - HTTP 429 -> RATE_LIMIT, HTTP 401/403 -> AUTH_ERROR (EIA answers 403
 *    for a missing/invalid key — verified live): fatal from ANY leg,
 *    NOTHING cached (Phase 178b), explicit envelope.
 *  - ALL legs failing for transport/provider reasons -> API_UNAVAILABLE,
 *    NOTHING cached — the pre-phase defect (outage cached 6h) is closed.
 *  - SOME legs failing -> partial: surviving legs cached; each failed leg
 *    keeps `${class}: ${reason}` on the payload and replays it verbatim
 *    through `failedLegs` on a cache hit.
 *  - An EIA error body ({error: ...}) or an empty-but-valid dataset keeps
 *    the existing per-leg answered contract — a real answer is not an
 *    outage (§227).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderCache, getProviderCache } from "../lib/data/provider-cache-registry";
import { fetchEiaInventory } from "./eia";

type Handler = (
  ctx: unknown,
  args: Record<string, never>,
) => Promise<{
  success: boolean;
  error?: string;
  errorCode?: string;
  data?: { available: boolean; failedLegs?: { productId: string; reason: string }[] };
  acquisition?: string;
  observedAt?: number;
}>;
const eia = (fetchEiaInventory as unknown as { _handler: Handler })._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } };
const KEY = { provider: "eia", dataset: "eia", qualifier: "EPC0,EPM0,EPD0" } as const;

const periodOf = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
function rowsFor(product: string, name: string) {
  return {
    response: {
      data: [
        { period: periodOf(3), value: "420.5", product, "product-name": name, units: "MBB" },
        { period: periodOf(10), value: "418.2", product, "product-name": name, units: "MBB" },
      ],
    },
  };
}
const OK: Record<string, unknown> = {
  EPC0: rowsFor("EPC0", "Crude Oil"),
  EPM0: rowsFor("EPM0", "Gasoline"),
  EPD0: rowsFor("EPD0", "Distillate"),
};

type Route = { status?: number; body?: unknown; throws?: unknown; badJson?: boolean };
/** Per-product routes keyed by facet product id. */
let routes: Record<string, Route> = {};
const calls: string[] = [];
const productOf = (url: string) => /facets%5Bproduct%5D%5B%5D=([A-Z0-9]+)/.exec(url)?.[1] ?? "?";
function setAll(route: Route) {
  routes = { EPC0: route, EPM0: route, EPD0: route };
}
function timeoutError() {
  const e = new Error("The operation timed out");
  e.name = "TimeoutError";
  return e;
}

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  process.env.EIA_API_KEY = "test-key";
  routes = { EPC0: { body: OK.EPC0 }, EPM0: { body: OK.EPM0 }, EPD0: { body: OK.EPD0 } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const r = routes[productOf(url)] ?? { status: 500 };
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

describe("230 EIA — valid wave", () => {
  it("all three products parse: success, no failed legs, cached", async () => {
    const r = await eia(ctx, {});
    expect(r.success).toBe(true);
    expect(r.data?.failedLegs).toEqual([]);
    expect(r.acquisition).toBe("observed-now");
    expect(calls.length).toBe(3);
    expect(getProviderCache().peek(KEY)).not.toBeNull();
  });
});

describe("230 EIA — fatal classes from ANY leg", () => {
  it("HTTP 429 on ONE leg → RATE_LIMIT, nothing cached, provider recovers", async () => {
    routes.EPM0 = { status: 429 };
    const r = await eia(ctx, {});
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(r.data).toBeUndefined();
    expect(getProviderCache().peek(KEY)).toBeNull();

    routes.EPM0 = { body: OK.EPM0 };
    const recovered = await eia(ctx, {});
    expect(recovered.success).toBe(true);
    expect(recovered.acquisition).toBe("observed-now");
  });

  it.each([401, 403])("HTTP %d on ONE leg → AUTH_ERROR, nothing cached", async (status) => {
    routes.EPC0 = { status };
    const r = await eia(ctx, {});
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("the api key never appears in any envelope", async () => {
    process.env.EIA_API_KEY = "SECRET-VALUE-XYZ";
    routes.EPC0 = { status: 403, body: { error: "API_KEY_INVALID" } };
    const r = await eia(ctx, {});
    expect(JSON.stringify(r)).not.toContain("SECRET-VALUE-XYZ");
    // The provider's OWN error text may surface; our credential may not.
    expect(r.errorCode).toBe("AUTH_ERROR");
  });
});

describe("230 EIA — the outage loop-hole is closed", () => {
  it.each<[string, Route]>([
    ["timeout", { throws: timeoutError() }],
    ["network", { throws: new TypeError("fetch failed") }],
    ["provider_error", { status: 503 }],
    ["malformed", { badJson: true }],
  ])("ALL legs fail (%s) → API_UNAVAILABLE, NOTHING cached (the 6h poison is gone)", async (_kind, route) => {
    setAll(route);
    const r = await eia(ctx, {});
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/every leg failed/);
    expect(getProviderCache().peek(KEY)).toBeNull();

    // The very next attempt re-acquires (nothing was stored).
    const after = calls.length;
    await eia(ctx, {});
    expect(calls.length).toBe(after + 3);
  });
});

describe("230 EIA — partial waves", () => {
  it("two legs ok + one 5xx → success with the failed leg classified, cached, replayed verbatim", async () => {
    routes.EPD0 = { status: 500 };
    const r = await eia(ctx, {});
    expect(r.success).toBe(true);
    const failed = r.data?.failedLegs ?? [];
    expect(failed).toHaveLength(1);
    expect(failed[0].productId).toBe("EPD0");
    expect(failed[0].reason).toMatch(/^provider_error:/);
    expect(failed[0].reason).toMatch(/HTTP 500/);
    expect(getProviderCache().peek(KEY)).not.toBeNull();

    const after = calls.length;
    const second = await eia(ctx, {});
    expect(calls.length).toBe(after); // pure cache hit
    expect(second.acquisition).toBe("cache-reused");
    expect(second.data?.failedLegs).toEqual(failed); // true acquisition record replays
    expect(second.observedAt).toBe(r.observedAt);
  });

  it("a timeout leg reports the timeout class", async () => {
    routes.EPC0 = { throws: timeoutError() };
    const r = await eia(ctx, {});
    expect(r.success).toBe(true);
    expect(r.data?.failedLegs?.[0]?.reason).toMatch(/^timeout:/);
  });

  it("a malformed leg reports the malformed class", async () => {
    routes.EPM0 = { badJson: true };
    const r = await eia(ctx, {});
    expect(r.success).toBe(true);
    expect(r.data?.failedLegs?.[0]?.reason).toMatch(/^malformed:/);
  });

  it("an EIA error body keeps the ANSWERED per-leg contract (mixed with transport failure is not an outage)", async () => {
    routes.EPC0 = { body: { error: "invalid facet code" } }; // valid answer: parse-level fact
    routes.EPD0 = { status: 500 }; // transport failure
    const r = await eia(ctx, {});
    expect(r.success).toBe(true);
    const reasons = (r.data?.failedLegs ?? []).map((l) => `${l.productId}:${l.reason}`).join("|");
    expect(reasons).toMatch(/EPC0:provider error: invalid facet code/);
    expect(reasons).toMatch(/EPD0:provider_error/);
    // Answered legs mean the wave was not an outage: the partial is cached.
    expect(getProviderCache().peek(KEY)).not.toBeNull();
  });
});

describe("230 EIA — missing key contract (unchanged)", () => {
  it("no EIA_API_KEY → the documented local configuration envelope", async () => {
    delete process.env.EIA_API_KEY;
    const r = await eia(ctx, {});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/EIA_API_KEY is missing/);
    expect(calls.length).toBe(0);
  });
});
