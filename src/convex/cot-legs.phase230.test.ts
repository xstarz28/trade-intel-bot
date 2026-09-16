/**
 * Phase 230 — COT (CFTC Socrata) single-leg failure semantics.
 *
 * Before this phase the fetch threw a generic `CFTC endpoint returned HTTP
 * <status>` for every non-2xx and the outer catch returned it verbatim:
 * correct on caching (a throw never stored anything, Phase 178b) but with
 * NO fatal-class classification — a 429 did not read as RATE_LIMIT and a
 * 401/403 did not read as AUTH_ERROR anywhere in the taxonomy. The shared
 * leg classes now apply: 429 -> RATE_LIMIT, 401/403 -> AUTH_ERROR, other
 * non-2xx -> provider_error, non-JSON / non-array body -> malformed,
 * timeout / connection failure -> timeout / network. Every class reaches
 * the caller as an explicitly classified envelope with nothing cached.
 *
 * The answered-but-empty contract is unchanged: a valid `[]` row set is a
 * real answer ("no usable reports"), not an outage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderCache, getProviderCache } from "../lib/data/provider-cache-registry";
import { fetchCotPositioning } from "./cot";

type Handler = (
  ctx: unknown,
  args: { instrument: string },
) => Promise<{
  success: boolean;
  error?: string;
  errorCode?: string;
  data?: { available: boolean; latest?: { reportDate: string } };
  acquisition?: string;
}>;
const cot = (fetchCotPositioning as unknown as { _handler: Handler })._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } };
const EURUSD = { instrument: "EUR/USD" };
const KEY = {
  provider: "cftc",
  dataset: "cot",
  instrument: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
} as const;

const recentReportDate = () => new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
const ROWS = [
  {
    market_and_exchange_names: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: recentReportDate(),
    noncomm_positions_long_all: "150000",
    noncomm_positions_short_all: "100000",
    comm_positions_long_all: "200000",
    comm_positions_short_all: "250000",
    open_interest_all: "500000",
  },
  {
    market_and_exchange_names: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10),
    noncomm_positions_long_all: "140000",
    noncomm_positions_short_all: "110000",
    comm_positions_long_all: "190000",
    comm_positions_short_all: "240000",
    open_interest_all: "490000",
  },
];

type Route = { status?: number; body?: unknown; throws?: unknown; badJson?: boolean };
let route: Route = { body: ROWS };
const calls: string[] = [];
function timeoutError() {
  const e = new Error("The operation timed out");
  e.name = "TimeoutError";
  return e;
}

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  route = { body: ROWS };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (route.throws) throw route.throws;
      const status = route.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: `status-${status}`,
        json: async () => {
          if (route.badJson) throw new SyntaxError("Unexpected token <");
          return route.body;
        },
      } as unknown as Response;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

describe("230 COT — valid", () => {
  it("rows parse: success, cached", async () => {
    const r = await cot(ctx, EURUSD);
    expect(r.success).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.acquisition).toBe("observed-now");
    expect(getProviderCache().peek(KEY)).not.toBeNull();
  });
});

describe("230 COT — fatal classes", () => {
  it("HTTP 429 → RATE_LIMIT, nothing cached, provider recovers", async () => {
    route = { status: 429 };
    const r = await cot(ctx, EURUSD);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(r.error).toMatch(/429/);
    expect(r.data).toBeUndefined();
    expect(getProviderCache().peek(KEY)).toBeNull();

    route = { body: ROWS };
    const recovered = await cot(ctx, EURUSD);
    expect(recovered.success).toBe(true);
    expect(recovered.acquisition).toBe("observed-now");
  });

  it.each([401, 403])("HTTP %d → AUTH_ERROR, nothing cached", async (status) => {
    route = { status };
    const r = await cot(ctx, EURUSD);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(r.error).toMatch(new RegExp(`${status}`));
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
});

describe("230 COT — non-fatal classes are named, nothing cached", () => {
  it("HTTP 500 → API_UNAVAILABLE with the provider_error class", async () => {
    route = { status: 500 };
    const r = await cot(ctx, EURUSD);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/provider_error/);
    expect(r.error).toMatch(/500/);
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("non-JSON body → API_UNAVAILABLE with the malformed class", async () => {
    route = { badJson: true };
    const r = await cot(ctx, EURUSD);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/malformed/);
    expect(r.error).toMatch(/non-JSON/);
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("non-array body → API_UNAVAILABLE with the malformed class", async () => {
    route = { body: { error: "no such dataset" } };
    const r = await cot(ctx, EURUSD);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/malformed/);
    expect(r.error).toMatch(/non-array/);
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("timeout → API_UNAVAILABLE with the timeout class", async () => {
    route = { throws: timeoutError() };
    const r = await cot(ctx, EURUSD);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/timeout/);
  });

  it("network failure → API_UNAVAILABLE with the network class", async () => {
    route = { throws: new TypeError("fetch failed") };
    const r = await cot(ctx, EURUSD);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/network/);
  });
});

describe("230 COT — answered-but-empty contract (unchanged)", () => {
  it("an empty row set is a valid answer: unavailable with the pure-layer reason", async () => {
    route = { body: [] };
    const r = await cot(ctx, EURUSD);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBeUndefined(); // a real answer is not an outage
    expect(r.error).toMatch(/no usable reports/i);
  });
});
