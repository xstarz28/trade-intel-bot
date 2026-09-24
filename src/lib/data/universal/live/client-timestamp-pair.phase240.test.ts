/**
 * Phase 240 — one completion reading per live acquisition.
 *
 * The residual Phase 238-G recorded: `src/lib/data/universal/live/client.ts`
 * emitted a `latencyMs` measured from one clock read and a `receivedAt` taken
 * from ANOTHER — in 21 branches the second read was written out literally, and
 * in 6 of them (the success and partial branches) the branch supplied only
 * `latencyMs` while `receivedAt` fell back to a fresh `Date.now()` inside the
 * envelope builder. Two reads for one completion event: the pair could disagree
 * by however long the parse took, and nothing in the suite could see it, because
 * on an idle machine the two reads usually land in the same millisecond.
 *
 * That is the same shape Phase 238 removed from the market-radar adapters, so it
 * is measured the same way: a clock that advances 1 ms per READ. With it, a
 * second consultation is not invisible — it is a visibly different instant, and
 * these assertions fail loudly rather than passing on a fast machine.
 *
 * The invariant under test, stated once:
 *
 *   for ONE completed live acquisition,
 *     one completion reading is taken,
 *     that reading IS `receivedAt`,
 *     `latencyMs === receivedAt - (the request-start reading)`,
 *     and `receivedAt` is a value the clock actually returned.
 *
 * The request-start reading is identified without guessing: `t0` is the last
 * clock read before the transport is invoked, so the transport captures it on
 * entry. Nothing runs between the two.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCountingClock, type CountingClock } from "../../../../test-counting-clock";
import { executeLiveRequest, resetLiveState, type LiveRequestResult, type Transport } from "./client";
import { resetCache } from "../cache";
import { getProviderHealth, resetProviderHealth } from "../routing-engine";

/** A synthetic present: every read is `BASE + n`, and provider data sits before it. */
const BASE = 1_800_000_000_000;
/** A provider-supplied candle time, deliberately far from any client reading. */
const PROVIDER_TS = 1_799_999_000_000;

let clock: CountingClock;

beforeEach(() => {
  resetLiveState();
  resetProviderHealth();
  resetCache();
  clock = createCountingClock(BASE);
  vi.spyOn(Date, "now").mockImplementation(clock.now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A transport that reports the request-start reading on entry.
 *
 * `t0` is read immediately before the transport is called, so the last reading
 * at entry IS the start instant — the test never has to assume which read it was.
 */
function instrumentedTransport(body: unknown, status = 200): { transport: Transport; start: () => number } {
  let start = -1;
  const transport: Transport = async () => {
    start = clock.reads[clock.reads.length - 1];
    return { ok: status >= 200 && status < 300, status, json: body };
  };
  return { transport, start: () => start };
}

/**
 * The pair invariant, asserted the same way for every branch.
 *
 * `latencyMs === receivedAt - start` is the load-bearing line: a second read for
 * either field makes the two sides disagree.
 */
function expectPair(result: LiveRequestResult, start: number) {
  const receivedAt = result.receivedAt;
  // Every outcome in this suite carries a receipt — including the pre-flight
  // refusals. A null one would mean the pair silently lost a field.
  expect(receivedAt).not.toBeNull();
  if (receivedAt === null) throw new Error("the acquisition carried no receipt to pair with");
  // The receipt is a value the clock really returned — not a constant, not a
  // fabricated instant, not a back-filled copy of the request start.
  expect(clock.reads).toContain(receivedAt);
  // ...and it is the completion, so strictly after the request start.
  expect(receivedAt).toBeGreaterThan(start);

  if (result.latencyMs === null) return;
  expect(result.latencyMs).toBe(receivedAt - start);
  // The diagnostic is the same measurement, not a second one.
  expect(result.diagnostic.latencyMs).toBe(result.latencyMs);
  // A duration, not a wall-clock instant wearing a duration's name.
  expect(result.latencyMs).toBeLessThan(1_000);
}

/** Twelve Data OHLCV payload — the provider the canonical route picks for BTC/USD. */
function twelveDataBody(ts = PROVIDER_TS) {
  return {
    symbol: "BTC/USD",
    values: [
      {
        datetime: new Date(ts).toISOString().replace("T", " ").slice(0, 19),
        open: "100",
        high: "105",
        low: "95",
        close: "102",
        volume: "1000",
      },
    ],
  };
}

// The value is irrelevant to credential checking (only the NAME matters) and
// is deliberately short: the static hygiene scan in
// `production.phase12.test.ts` flags credential-SHAPED literals, and a
// realistic-looking fake key would be indistinguishable from a real one.
const TD_ENV = { TWELVE_DATA_API_KEY: "td-fixture" };
const readEnvFrom = (record: Record<string, string | undefined>) => (name: string) => record[name];

/** OKX candle rows, newest-first as the provider returns them. */
function okxBody(ts = PROVIDER_TS) {
  return { code: "0", data: [[String(ts), "100", "105", "95", "102", "1000"]] };
}

const NATIVE_OKX = {
  provider: "okx",
  providerInstrumentId: "BTC-USDT-SWAP",
  assetClass: "crypto" as const,
};

describe("240 — one completion reading, every branch", () => {
  it("2xx success (LIVE_VERIFIED, candles): the receipt IS the duration's end", async () => {
    const { transport, start } = instrumentedTransport(twelveDataBody());
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("LIVE_VERIFIED");
    expect(result.latencyMs).toBeGreaterThan(0);
    expectPair(result, start());
    // Provider health reports the SAME duration: re-measuring it here would put
    // a second value beside the pair, describing the same exchange.
    expect(getProviderHealth("twelve-data")?.avgResponseTimeMs).toBe(result.latencyMs);

    // Exact consultation count for this path: routing(1) + start(1) +
    // completion(1) + provider health(1) + cache write(1). A single extra
    // consultation — even one that would not change the recorded pair — fails
    // here, which is the Phase 238 lesson applied to this pair.
    expect(clock.reads.length).toBe(5);
  });

  it("2xx success (LIVE_VERIFIED, quote): the branch that used to omit the receipt entirely", async () => {
    // CoinGecko wins `tokenomics` for a crypto instrument, and its extractor is
    // the only one that yields a quote — i.e. the exact branch where the old
    // code supplied `latencyMs` and let `receivedAt` be read separately.
    const { transport, start } = instrumentedTransport({ bitcoin: { usd: 100_000 } });
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "tokenomics",
      transport,
      readEnv: readEnvFrom({}),
      now: BASE,
    });

    expect(result.status).toBe("LIVE_VERIFIED");
    expect(result.quote?.price).toBe(100_000);
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start());
    // routing(1) + start(1) + completion(1) + health(1) + cache(1)
    expect(clock.reads.length).toBe(5);
  });

  it("HTTP 429 (RATE_LIMITED)", async () => {
    const { transport, start } = instrumentedTransport({}, 429);
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("RATE_LIMITED");
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start());
    // routing(1) + start(1) + completion(1) + health(1)
    expect(clock.reads.length).toBe(4);
  });

  it("HTTP non-2xx (PROVIDER_ERROR)", async () => {
    const { transport, start } = instrumentedTransport({ error: "upstream" }, 503);
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("PROVIDER_ERROR");
    expect(result.failureReason).toContain("503");
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start());
    // routing(1) + start(1) + completion(1) + health(1)
    expect(clock.reads.length).toBe(4);
  });

  it("transport rejection (NETWORK_UNAVAILABLE)", async () => {
    let start = -1;
    const transport: Transport = async () => {
      start = clock.reads[clock.reads.length - 1];
      throw new Error("ECONNREFUSED");
    };
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("NETWORK_UNAVAILABLE");
    expect(result.failureReason).toContain("ECONNREFUSED");
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start);
    // routing(1) + start(1) + completion(1) + health(1)
    expect(clock.reads.length).toBe(4);
  });

  it("timeout/abort: an aborted transport lands on the same envelope, pair intact", async () => {
    /*
      This helper has no timer of its own: there is no AbortController, no
      timeout option and no retry loop in the file. A timeout is therefore
      surfaced by the transport as a rejection, and it must reach the caller with
      the same pair integrity as any other network failure — including the
      interruption reason, which is not swallowed.
    */
    let start = -1;
    const transport: Transport = async () => {
      start = clock.reads[clock.reads.length - 1];
      throw new DOMException("The operation was aborted.", "AbortError");
    };
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("NETWORK_UNAVAILABLE");
    expect(result.failureReason).toContain("The operation was aborted.");
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start);
  });

  it("provider-native transport rejection: the measured pair survives (NETWORK_UNAVAILABLE)", async () => {
    /*
      The provider-native path has its own network-failure branch. It was the one
      hole the Phase 240 mutation pass found: passing the NULL completion there
      (a fresh receipt read, no duration) left every other test green, because
      only the canonical branch was covered. A measured exchange must report a
      measured duration on both paths.
    */
    let start = -1;
    const transport: Transport = async () => {
      start = clock.reads[clock.reads.length - 1];
      throw new Error("socket hang up");
    };
    const result = await executeLiveRequest({
      instrument: "BTC-USDT-SWAP",
      capability: "ohlcv",
      providerNative: NATIVE_OKX,
      transport,
      readEnv: readEnvFrom({}),
      now: BASE,
    });

    expect(result.status).toBe("NETWORK_UNAVAILABLE");
    expect(result.failureReason).toContain("socket hang up");
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start);
  });

  it("provider-native HTTP error and empty body keep the pair", async () => {
    for (const [body, status, expected] of [
      [{}, 500, "PROVIDER_ERROR"],
      [undefined, 200, "PROVIDER_ERROR"], // empty body is a provider error on this path
    ] as const) {
      const { transport, start } = instrumentedTransport(body, status);
      const result = await executeLiveRequest({
        instrument: "BTC-USDT-SWAP",
        capability: "ohlcv",
        providerNative: NATIVE_OKX,
        transport,
        readEnv: readEnvFrom({}),
        now: BASE,
      });
      expect(result.status).toBe(expected);
      expect(result.latencyMs).not.toBeNull();
      expectPair(result, start());
    }
  });

  it("parse failure — empty body (MALFORMED_RESPONSE)", async () => {
    const { transport, start } = instrumentedTransport(undefined);
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("MALFORMED_RESPONSE");
    expectPair(result, start());
    expect(result.latencyMs).not.toBeNull();
    // routing(1) + start(1) + completion(1)
    expect(clock.reads.length).toBe(3);
  });

  it("normalization failure — the extractor throws (MALFORMED_RESPONSE)", async () => {
    const { transport, start } = instrumentedTransport({ symbol: "BTC/USD", values: 42 });
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("MALFORMED_RESPONSE");
    expect(result.failureReason).toContain("Failed to extract");
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start());
    // routing(1) + start(1) + completion(1)
    expect(clock.reads.length).toBe(3);
  });

  it("all records rejected (MALFORMED_RESPONSE)", async () => {
    const future = BASE + 10_000_000; // rejected as a future timestamp
    const { transport, start } = instrumentedTransport(twelveDataBody(future));
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("MALFORMED_RESPONSE");
    expectPair(result, start());
  });

  it("identity mismatch (MALFORMED_RESPONSE) — no substitution, pair intact", async () => {
    const { transport, start } = instrumentedTransport({
      ...twelveDataBody(),
      symbol: "ETH/USD", // the provider answered about a different instrument
    });
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport,
      readEnv: readEnvFrom(TD_ENV),
      now: BASE,
    });

    expect(result.status).toBe("MALFORMED_RESPONSE");
    expect(result.failureReason).toContain("Identity mismatch");
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start());
    // routing(1) + start(1) + completion(1) — no health, no cache
    expect(clock.reads.length).toBe(3);
  });

  it("provider-native path: same invariant, no registry route involved", async () => {
    const { transport, start } = instrumentedTransport(okxBody());
    const result = await executeLiveRequest({
      instrument: "BTC-USDT-SWAP",
      capability: "ohlcv",
      providerNative: NATIVE_OKX,
      transport,
      readEnv: readEnvFrom({}),
      now: BASE,
    });

    expect(result.status).toBe("LIVE_VERIFIED");
    expect(result.provider).toBe("okx");
    expect(result.latencyMs).not.toBeNull();
    expectPair(result, start());
    expect(getProviderHealth("okx")?.avgResponseTimeMs).toBe(result.latencyMs);
    // start(1) + completion(1) + health(1) + cache(1): the native path does not
    // consult the routing clock at all.
    expect(clock.reads.length).toBe(4);
  });

  it("no HTTP exchange: one reading, a null duration, and no borrowed `now`", async () => {
    // Pre-flight refusal — nothing was requested, so there is no duration to
    // report. The old shape still read the clock for `receivedAt`; the point of
    // this test is that it stays ONE reading and is never the caller's `now`.
    const result = await executeLiveRequest({
      instrument: "NOT-REGISTERED-AT-ALL",
      capability: "ohlcv",
      transport: async () => {
        throw new Error("the transport must never be reached");
      },
      readEnv: readEnvFrom({}),
      now: BASE,
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.latencyMs).toBeNull();
    expect(result.requestedAt).toBe(BASE);
    expect(clock.reads).toContain(result.receivedAt);
    expect(result.receivedAt).toBeGreaterThan(result.requestedAt);
    // exactly one consultation: the receipt itself
    expect(clock.reads.length).toBe(1);
  });

  it("credentials missing: no request, no fabricated duration", async () => {
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: async () => {
        throw new Error("the transport must never be reached");
      },
      readEnv: readEnvFrom({}), // twelve-data is the best route, and it needs a key
      now: BASE,
    });

    expect(result.status).toBe("CREDENTIAL_MISSING");
    expect(result.latencyMs).toBeNull();
    expect(clock.reads).toContain(result.receivedAt);
    // routing(1) + the receipt(1) + provider health(1). The routing read is the
    // route decision's own reasoning about rate-limit windows; the pairing
    // invariant is about the TWO completion fields below it, and `latencyMs` is
    // null here precisely because no exchange took place to measure.
    expect(clock.reads.length).toBe(3);
  });
});
