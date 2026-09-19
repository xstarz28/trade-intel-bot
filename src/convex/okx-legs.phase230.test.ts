/**
 * Phase 230 — OKX single-leg failure semantics (instrument spec + order book).
 *
 * OKX keeps the Phase 211 D10 contract: failure envelopes are FREE-TEXT
 * `error` strings with the HTTP status inside (the downstream classifiers
 * match on that text; okx.ts deliberately has NO `errorCode` field). What
 * this phase changes is the classification SOURCE: named classes from the
 * shared taxonomy are thrown at the point of failure — 429 -> RATE_LIMIT,
 * 401/403 -> AUTH_ERROR, other non-2xx -> ProviderHttpError, non-JSON body
 * -> ProviderMalformedError — and every failure still throws out of the
 * instrument-spec cache fetcher (Phase 178b: nothing cached).
 *
 * The order-book action (UNCACHED BY DESIGN) keeps its pinned literals:
 * `OKX order book returned HTTP <status>.` and `network failure: …`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resetProviderCache, getProviderCache } from "../lib/data/provider-cache-registry";
import { fetchOkxInstrumentSpec, fetchOkxOrderBook } from "./okx";
import { classifyFailure } from "../lib/data/provider-resilience";

type Envelope = {
  success: boolean;
  error?: string;
  data?: { available?: boolean; freshness?: string; instruments?: unknown[] };
  acquisition?: string;
};
const spec = (fetchOkxInstrumentSpec as unknown as {
  _handler: (c: unknown, a: { instrument: string }) => Promise<Envelope>;
})._handler;
const book = (fetchOkxOrderBook as unknown as {
  _handler: (c: unknown, a: { instrument: string }) => Promise<Envelope>;
})._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } };
const BTC = { instrument: "BTC/USDT" };
const KEY = { provider: "okx", dataset: "instrument-spec", instrument: "BTC-USDT-SWAP" } as const;

const SPEC_OK = {
  code: "0",
  data: [
    {
      instId: "BTC-USDT-SWAP",
      instType: "SWAP",
      ctVal: "0.01",
      ctValCcy: "BTC",
      tickSz: "0.1",
      lotSz: "1",
      minSz: "1",
      state: "live",
    },
  ],
};
const BOOK_OK = {
  code: "0",
  data: [
    {
      instId: "BTC-USDT-SWAP",
      asks: [
        ["100.5", "10", "0", "2"],
        ["100.6", "12", "0", "2"],
      ],
      bids: [
        ["100.4", "11", "0", "2"],
        ["100.3", "9", "0", "2"],
      ],
      ts: String(Date.now()),
    },
  ],
};

type Route = { status?: number; body?: unknown; throws?: unknown; badJson?: boolean };
let specRoute: Route = { body: SPEC_OK };
let bookRoute: Route = { body: BOOK_OK };
const calls: string[] = [];

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  specRoute = { body: SPEC_OK };
  bookRoute = { body: BOOK_OK };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const r = url.includes("market/books") ? bookRoute : specRoute;
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

describe("230 OKX spec — valid", () => {
  it("specs parse: success, cached; a hit replays the original acquisition", async () => {
    const r = await spec(ctx, BTC);
    expect(r.success).toBe(true);
    expect(r.acquisition).toBe("observed-now");
    expect(getProviderCache().peek(KEY)).not.toBeNull();
    const after = calls.length;
    const second = await spec(ctx, BTC);
    expect(calls.length).toBe(after);
    expect(second.acquisition).toBe("cache-reused");
  });
});

describe("230 OKX spec — fatal classes, nothing cached", () => {
  it("HTTP 429 → RATE_LIMIT named in the envelope, nothing cached, provider recovers", async () => {
    specRoute = { status: 429 };
    const r = await spec(ctx, BTC);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/RATE_LIMIT/);
    expect(r.error).toMatch(/429/);
    expect(classifyFailure(r.error).category).toBe("rate-limit");
    expect(getProviderCache().peek(KEY)).toBeNull();

    specRoute = { body: SPEC_OK };
    const recovered = await spec(ctx, BTC);
    expect(recovered.success).toBe(true);
    expect(recovered.acquisition).toBe("observed-now");
  });

  it.each([401, 403])("HTTP %d → AUTH_ERROR named in the envelope, nothing cached", async (status) => {
    specRoute = { status };
    const r = await spec(ctx, BTC);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/AUTH_ERROR/);
    expect(r.error).toMatch(new RegExp(`${status}`));
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
});

describe("230 OKX spec — non-fatal classes, nothing cached", () => {
  it("HTTP 500 → the provider_error class text, nothing cached", async () => {
    specRoute = { status: 500 };
    const r = await spec(ctx, BTC);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/OKX request failed: OKX HTTP 500/);
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("non-JSON body → the pinned malformed message, nothing cached", async () => {
    specRoute = { badJson: true };
    const r = await spec(ctx, BTC);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/OKX returned malformed JSON\./);
    expect(classifyFailure(r.error).category).toBe("invalid-response");
    expect(getProviderCache().peek(KEY)).toBeNull();
  });

  it("network failure → the transport class is preserved in text", async () => {
    specRoute = { throws: new TypeError("fetch failed") };
    const r = await spec(ctx, BTC);
    expect(r.success).toBe(false);
    expect(classifyFailure(r.error).category).toBe("network");
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
});

describe("230 OKX order book — Phase 211 D10 contract preserved", () => {
  it("429 keeps the pinned literal and still classifies downstream as a rate limit", async () => {
    bookRoute = { status: 429 };
    const r = await book(ctx, BTC);
    expect(r.success).toBe(false);
    expect(r.error).toBe("OKX order book returned HTTP 429.");
    expect(classifyFailure(r.error).category).toBe("rate-limit");
  });

  it("another non-2xx keeps the pinned literal and stays a conservative provider HTTP failure", async () => {
    bookRoute = { status: 503 };
    const r = await book(ctx, BTC);
    expect(r.success).toBe(false);
    expect(r.error).toBe("OKX order book returned HTTP 503.");
    expect(classifyFailure(r.error).category).not.toBe("rate-limit");
  });

  it("a non-JSON body keeps the pinned malformed message", async () => {
    bookRoute = { badJson: true };
    const r = await book(ctx, BTC);
    expect(r.success).toBe(false);
    expect(r.error).toBe("OKX returned malformed JSON.");
    expect(classifyFailure(r.error).category).toBe("invalid-response");
  });

  it("a network failure keeps the pinned literal and classifies as transport", async () => {
    bookRoute = { throws: new TypeError("fetch failed") };
    const r = await book(ctx, BTC);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^network failure:/);
    expect(classifyFailure(r.error).category).toBe("network");
  });

  it("okx.ts still emits no `errorCode` on either action (D10 taxonomy pin)", async () => {
    expect(readFileSync("src/convex/okx.ts", "utf8")).not.toMatch(/errorCode/);
    bookRoute = { status: 500 };
    specRoute = { status: 500 };
    const rb = await book(ctx, BTC);
    const rs = await spec(ctx, BTC);
    expect("errorCode" in rb).toBe(false);
    expect("errorCode" in rs).toBe(false);
  });
});

describe("230 OKX order book — valid path unchanged", () => {
  it("a real book snapshot still builds execution data and is never cached", async () => {
    const r = await book(ctx, BTC);
    expect(r.success).toBe(true);
    expect(r.data?.available).toBe(true);
    const after = calls.length;
    await book(ctx, BTC);
    expect(calls.length).toBe(after + 1); // UNCACHED BY DESIGN
  });
});
