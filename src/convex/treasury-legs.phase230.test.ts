/**
 * Phase 230 — Treasury single-leg failure semantics.
 *
 * Before this phase `fetchFeed` ended in `catch { return undefined }` with
 * no 429/401/403 classification: a quota/access rejection became a silent
 * absent leg, an all-legs rejection read as an ordinary "no yield curve"
 * miss, and a timeout/network/5xx failure was indistinguishable from the
 * legitimate "not published yet" empty feed. The shared leg taxonomy
 * (lib/legOutcome.ts) now governs all four XML legs.
 *
 * What must hold:
 *  - HTTP 429 -> RATE_LIMIT, 401/403 -> AUTH_ERROR: fatal from ANY leg,
 *    nothing cached (Phase 178b), explicit envelope (Convex re-wraps
 *    thrown errors, so the class can only survive as envelope text).
 *  - timeout/network/5xx/malformed on SOME legs -> partial: surviving legs
 *    cached, `error` metadata on the payload (survives a cache hit), no
 *    fabricated placeholders.
 *  - ALL legs failing for transport/provider reasons -> API_UNAVAILABLE,
 *    nothing cached — an outage is never a "no data" miss.
 *  - All four feeds answering 200 with no <entry> -> the legitimate
 *    "not published yet" contract: NO_DATA, nothing cached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderCache, getProviderCache } from "../lib/data/provider-cache-registry";
import { fetchTreasuryYields } from "./treasury";

type Handler = (
  ctx: unknown,
  args: Record<string, never>,
) => Promise<{
  success: boolean;
  error?: string;
  errorCode?: string;
  data?: { available: boolean };
  acquisition?: string;
  observedAt?: number;
}>;
const treasury = (fetchTreasuryYields as unknown as { _handler: Handler })._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } };

const now = new Date();
const mk = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const thisMonth = mk(now);
const prevMonth = mk(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
const KEY = {
  provider: "us-treasury",
  dataset: "treasury",
  qualifier: `${thisMonth},${prevMonth}`,
} as const;

const XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <content type="application/xml">
      <m:properties xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
        <d:NEW_DATE>${new Date(Date.now() - 864e5).toISOString()}</d:NEW_DATE>
        <d:BC_2YEAR>4.10</d:BC_2YEAR>
        <d:BC_10YEAR>4.25</d:BC_10YEAR>
        <d:BC_30YEAR>4.40</d:BC_30YEAR>
        <d:TC_10YEAR>1.95</d:TC_10YEAR>
      </m:properties>
    </content>
  </entry>
</feed>`;
const EMPTY_XML = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

type Route = { status?: number; body?: string; throws?: unknown };
/** Per-leg routes keyed "<feed>@<yyyymm>". */
let routes: Record<string, Route> = {};
const calls: string[] = [];
const legKey = (url: string) => {
  const data = /[?&]data=([^&]+)/.exec(url)?.[1] ?? "?";
  const month = /field_tdr_date_value_month=(\d+)/.exec(url)?.[1] ?? "?";
  return `${data}@${month}`;
};
const ALL_LEGS = [
  `daily_treasury_yield_curve@${thisMonth}`,
  `daily_treasury_yield_curve@${prevMonth}`,
  `daily_treasury_real_yield_curve@${thisMonth}`,
  `daily_treasury_real_yield_curve@${prevMonth}`,
];
function setAll(route: Route) {
  routes = Object.fromEntries(ALL_LEGS.map((k) => [k, route]));
}
function timeoutError() {
  const e = new Error("The operation timed out");
  e.name = "TimeoutError";
  return e;
}

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  setAll({ body: XML });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const r = routes[legKey(url)] ?? { status: 500 };
      if (r.throws) throw r.throws;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: `status-${status}`,
        text: async () => r.body ?? EMPTY_XML,
      } as unknown as Response;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

describe("230 Treasury — valid wave", () => {
  it("all four legs parse: success, no error metadata, cached", async () => {
    const r = await treasury(ctx, {});
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.acquisition).toBe("observed-now");
    expect(calls.length).toBe(4);
    expect(getProviderCache().peek(KEY)).not.toBeNull();
  });
});

describe("230 Treasury — fatal classes from ANY leg", () => {
  it("HTTP 429 on ONE leg → RATE_LIMIT, nothing cached, provider recovers", async () => {
    routes[`daily_treasury_real_yield_curve@${prevMonth}`] = { status: 429 };
    const r = await treasury(ctx, {});
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(r.error).toMatch(/429/);
    expect(r.data).toBeUndefined();
    expect(getProviderCache().peek(KEY)).toBeNull();

    setAll({ body: XML });
    const recovered = await treasury(ctx, {});
    expect(recovered.success).toBe(true);
    expect(recovered.acquisition).toBe("observed-now");
  });

  it.each([401, 403])("HTTP %d on ONE leg → AUTH_ERROR, nothing cached", async (status) => {
    routes[`daily_treasury_yield_curve@${thisMonth}`] = { status };
    const r = await treasury(ctx, {});
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
});

describe("230 Treasury — non-fatal leg failures are partial, never laundered", () => {
  it("one 5xx leg: success with per-leg class on the cached payload, replayed verbatim", async () => {
    routes[`daily_treasury_yield_curve@${prevMonth}`] = { status: 500 };
    const r = await treasury(ctx, {});
    expect(r.success).toBe(true);
    expect(r.error).toMatch(/nominalPrevious: provider_error/);
    expect(r.error).toMatch(/HTTP 500/);
    expect(getProviderCache().peek(KEY)).not.toBeNull();

    const callsAfterFirst = calls.length;
    const second = await treasury(ctx, {});
    expect(calls.length).toBe(callsAfterFirst); // pure cache hit
    expect(second.acquisition).toBe("cache-reused");
    expect(second.error).toBe(r.error); // failure metadata survives the hit
    expect(second.observedAt).toBe(r.observedAt);
  });

  it("one timeout leg: same partial contract with the timeout class", async () => {
    routes[`daily_treasury_real_yield_curve@${thisMonth}`] = { throws: timeoutError() };
    const r = await treasury(ctx, {});
    expect(r.success).toBe(true);
    expect(r.error).toMatch(/realCurrent: timeout/);
  });

  it("one network leg: partial with the network class", async () => {
    routes[`daily_treasury_real_yield_curve@${prevMonth}`] = { throws: new TypeError("fetch failed") };
    const r = await treasury(ctx, {});
    expect(r.success).toBe(true);
    expect(r.error).toMatch(/realPrevious: network/);
  });

  it("mixed transport failure + legitimate empty prev month stays a normal partial", async () => {
    routes[`daily_treasury_yield_curve@${prevMonth}`] = { status: 503 };
    routes[`daily_treasury_real_yield_curve@${prevMonth}`] = { body: EMPTY_XML };
    const r = await treasury(ctx, {});
    expect(r.success).toBe(true);
    expect(r.error).toMatch(/nominalPrevious: provider_error/);
    expect(r.error).not.toMatch(/realPrevious/); // answered-empty is not a failure
  });
});

describe("230 Treasury — outage is an outage, not 'no data'", () => {
  it.each<[string, Route]>([
    ["timeout", { throws: timeoutError() }],
    ["network", { throws: new TypeError("fetch failed") }],
    ["provider_error", { status: 503 }],
  ])("all four legs fail (%s) → API_UNAVAILABLE naming the class, nothing cached", async (_kind, route) => {
    setAll(route);
    const r = await treasury(ctx, {});
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/every leg failed/);
    expect(r.error).toMatch(/timeout|network|provider_error/);
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
});

describe("230 Treasury — answered-but-empty contract", () => {
  it("all feeds answer 200 with no <entry> → NO_DATA miss, nothing cached, next call refetches", async () => {
    setAll({ body: EMPTY_XML });
    const r = await treasury(ctx, {});
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("NO_DATA");
    expect(r.error).toMatch(/no yield curve/);
    expect(getProviderCache().peek(KEY)).toBeNull();

    const after = calls.length;
    await treasury(ctx, {});
    expect(calls.length).toBe(after + 4); // a miss caches nothing
  });
});
