/**
 * Phase 238 — one provider record, one clock read (market-radar adapters).
 *
 * The OKX candles adapter consulted the clock TWICE in a single record: once
 * for the `observedAt` fallback used when the exchange gave no candle time,
 * and once for the instant its own freshness label was judged against. Two
 * reads are two different claims about one record, and the second one is not
 * even visible in the output: with a fallback instant equal to "now", a read
 * one millisecond later yields the same label, so the disagreement cannot be
 * seen in the values — only in how many times the clock was consulted.
 *
 * That is what this file measures. `createCountingClock` advances 1 ms per
 * READ, so the number of consultations is an exact, deterministic observable
 * — and the count is pinned RELATIVELY (invalid-timestamp path vs valid-
 * timestamp path) so it stays meaningful if unrelated bookkeeping changes.
 *
 * Phase 238 also SWEPT the rest of the registry, because the same shape was
 * everywhere: every adapter dated its record with its own read of the clock,
 * and then `acquireLiveData` dated the result with a second read taken
 * afterwards. For a provider that reports no observation time those two dates
 * describe ONE event, so the sweep gave the record an `acquiredAt` — the read
 * the record's freshness was judged at — and made the acquisition result reuse
 * it. The tests below cover that sweep: every adapter that receives no
 * observation time, the provider-stamped case placed exactly on a freshness
 * boundary, the result/snapshot coupling, the health record's own two instants,
 * and the provider-native path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCountingClock } from "../../test-counting-clock";
import { acquireLiveData, acquireProviderNativeLiveData, getAdapters, resetAdapters } from "./provider-registry";
import { executeLiveRequest } from "../data/universal/live/client";
import { assessFreshness } from "./freshness";

import type { Transport } from "../data/universal/live/client";

const BASE = 1_700_000_000_000;
/** OKX candles rows are [ts(ms), open, high, low, close, vol]. */
const candleRow = (ts: string | number) => [String(ts), "60000", "61000", "59000", "60500", "123"];

let rows: unknown[][] = [];

beforeEach(() => {
  rows = [candleRow(BASE - 60_000)];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      // DeFiLlama is the CONTROL adapter below: it also goes through the shared
      // health wrapper and also reads the clock exactly once per record. The
      // remaining branches are the payloads of the adapters swept below; each
      // one deliberately carries NO observation time (except OKX's candles).
      const body =
        url.includes("llama.fi") ? [{ tvl: 12_345 }] :
        url.includes("coingecko") ? { bitcoin: { usd: 60_000, usd_24h_change: 1.2 }, btc: { usd: 60_000, usd_24h_change: 1.2 } } :
        url.includes("tokenomist") ? { unlocks: [] } :
        url.includes("cftc.gov") ? {} :
        url.includes("fiscaldata") ? { data: [{ avg_interest_rate_amt: "4.1" }] } :
        url.includes("eia.gov") ? {} :
        url.includes("alphavantage.co") ? { "50DayMovingAverage": "150.5" } :
        { data: rows };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function installClock(base = BASE) {
  const clock = createCountingClock(base);
  clockReads = clock.reads;
  vi.spyOn(Date, "now").mockImplementation(clock.now);
  return clock;
}

/** The most recent reading of the installed counting clock. */
let clockReads: number[] = [];
const startReadOfLastRead = () => clockReads[clockReads.length - 1];

const adapterOf = (id: string) => {
  const adapter = getAdapters().find((a) => a.id === id);
  if (!adapter) throw new Error(`the ${id} adapter is not registered`);
  return adapter;
};
const okxAdapter = () => adapterOf("okx");

/**
 * Drive the provider-native acquisition with a candle stamped at `ts`.
 *
 * `onTransport` receives the live client's request-start reading: `t0` is taken
 * immediately before the transport is invoked, so the last reading at entry is
 * the start instant. Phase 240 uses it to locate the completion reading without
 * assuming which read it is.
 */
async function acquireNative(ts: number, onTransport?: (startRead: number) => void) {
  const transport: Transport = async () => {
    onTransport?.(startReadOfLastRead());
    return {
      ok: true,
      status: 200,
      json: { data: [[String(ts), "60000", "61000", "59000", "60500", "123"]] },
    } as never;
  };
  return acquireProviderNativeLiveData(
    {
      instrument: "BTC-USDT-SWAP",
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      assetClass: "crypto",
    },
    undefined,
    transport,
  );
}

describe("238 — adapter records consult the clock once per record", () => {
  it("one record costs one read: OKX matches the DeFiLlama control through the SAME health wrapper", async () => {
    const clock = installClock();

    const beforeOkx = clock.reads.length;
    const okxSnapshot = await okxAdapter().fetch("BTC/USD", "crypto");
    const okxCost = clock.reads.length - beforeOkx;

    const beforeControl = clock.reads.length;
    const controlSnapshot = await adapterOf("defillama").fetch("arbitrum/ETH", "crypto");
    const controlCost = clock.reads.length - beforeControl;

    expect(okxSnapshot).not.toBeNull();
    expect(controlSnapshot).not.toBeNull();
    // Both adapters perform exactly one clock read for their record (the OKX
    // freshness basis, DeFiLlama's `observedAt`); the health bookkeeping they
    // share cancels out. A second read in EITHER record shows up as a
    // difference of 1 — this is the assertion a relative comparison inside one
    // adapter cannot make, because it cancels in both of that adapter's arms.
    expect(okxCost - controlCost).toBe(0);
  });

  it("a missing candle time costs NO extra clock read, because the fallback IS the recorded instant", async () => {
    // Valid exchange timestamp: the record uses the provider's instant, and
    // the only read is the one its freshness is judged at.
    const valid = installClock();
    const withProviderTime = await okxAdapter().fetch("BTC/USD", "crypto");
    const validCost = valid.reads.length;

    vi.restoreAllMocks();

    // Invalid exchange timestamp: `observedAt` falls back to the clock, and
    // that fallback is the record's instant — so it must be the SAME read the
    // freshness used. Before Phase 238 this path consulted the clock one extra
    // time (the record dated itself at read N and graded itself at read N+1),
    // making this difference exactly 1.
    rows = [candleRow("not-a-number")];
    const invalid = installClock();
    const withFallback = await okxAdapter().fetch("BTC/USD", "crypto");
    const invalidCost = invalid.reads.length;

    expect(withProviderTime).not.toBeNull();
    expect(withFallback).not.toBeNull();
    expect(invalidCost - validCost).toBe(0);
  });

  it("with a provider timestamp the record claims the PROVIDER's instant, never the clock", async () => {
    const providerTs = BASE - 60_000;
    const clock = installClock();

    const snapshot = await okxAdapter().fetch("BTC/USD", "crypto");

    expect(snapshot?.observedAt).toBe(providerTs);
    // A clock value here would mean the record asserted an observation the
    // provider never made (Phase 220's rule, re-asserted for this adapter).
    expect(clock.reads).not.toContain(providerTs);
  });

  it("without a provider timestamp the recorded instant IS a real clock read", async () => {
    // Phase 238 — OKX missing candle time: observedAt must NOT be fabricated from clock.
    // It becomes undefined with provenance UNKNOWN, while acquiredAt IS the clock read.
    rows = [candleRow("not-a-number")];
    const clock = installClock();

    const snapshot = await okxAdapter().fetch("BTC/USD", "crypto");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.observedAt).toBeUndefined();
    expect(snapshot?.timestampProvenance).toBe("UNKNOWN");
    expect(clock.reads).toContain(snapshot?.acquiredAt);
    expect(snapshot?.freshness).toBe("UNAVAILABLE");
  });

  it("the record's fetchedAt IS the instant its snapshot's freshness was judged at", async () => {
    // Discovery: under a counting clock, where does the record's `fetchedAt`
    // come from? Its position in the read log tells us how many reads precede
    // it, which is what lets the assertion below place a candle exactly on the
    // FRESH/DELAYED boundary of that read.
    const discovery = installClock();
    const first = await acquireNative(BASE - 60_000);
    const index = discovery.reads.indexOf(first.fetchedAt);
    expect(index).toBeGreaterThanOrEqual(0);
    const fetchedAtValue = discovery.reads[index];

    vi.restoreAllMocks();

    // Assertion: the candle is 299_999 ms older than the read that produced
    // `fetchedAt`. Judged AT that read the age is 299_999 → FRESH; judged one
    // millisecond later it is exactly 300_000 → DELAYED. So the label reveals
    // whether the verdict used the recorded instant or a second read.
    const clock = installClock();
    const boundaryTs = fetchedAtValue - 299_999;
    const second = await acquireNative(boundaryTs);

    // The assertion run performs the same reads in the same order, so the
    // record's `fetchedAt` must be the read at the SAME position — the instant
    // whose boundary the candle was placed on.
    expect(second.fetchedAt).toBe(clock.reads[index]);
    expect(boundaryTs).toBe((second.fetchedAt ?? 0) - 299_999);
    expect(second.snapshot?.observedAt).toBe(boundaryTs);
    expect(second.snapshot?.freshness).toBe("FRESH");
    expect(second.snapshot?.freshness).toBe(
      assessFreshness(second.snapshot?.observedAt, second.fetchedAt),
    );
  });

  it("a provider-stamped record keeps the provider's instant and is graded by this call", async () => {
    const clock = installClock();

    const snapshot = await okxAdapter().fetch("BTC/USD", "crypto");

    // The candle is 60 seconds old: inside `assessFreshness`'s five-minute
    // FRESH band. A second read one millisecond later cannot move that label —
    // which is exactly why the READ COUNT in the first test, not this label,
    // is the observable that catches a doubled read.
    expect(snapshot?.observedAt).toBe(BASE - 60_000);
    expect(snapshot?.freshness).toBe("FRESH");
    expect(clock.reads.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// THE SWEEP — every adapter, one instant per record
//
// A record has exactly one acquisition instant. Which read that is differs
// per provider (the exchange's own timestamp when the payload carries one,
// our clock when it does not), but there is only ever ONE, and every field
// that describes the acquisition is derived from it.
// ═══════════════════════════════════════════════════════════════

describe("238 — the sweep: adapters date one record with one read", () => {
  /** Adapters whose payload carries no observation time at all. */
  const NO_PROVIDER_TIME: [string, string, string, Record<string, string> | undefined][] = [
    ["coingecko", "BTC/USD", "crypto", undefined],
    ["defillama", "arbitrum/ETH", "crypto", undefined],
    ["tokenomist", "BTC/USD", "crypto", undefined],
    ["alpha-vantage", "AAPL", "equity", { ALPHA_VANTAGE_API_KEY: "phase238-key" }],
    ["cftc", "EUR/USD", "forex", undefined],
    ["treasury", "UST10Y", "macro", undefined],
    ["eia", "WTI", "commodity", { EIA_API_KEY: "phase238-key" }],
  ];

  it.each(NO_PROVIDER_TIME)(
    "%s: with no provider observation time, observedAt IS the acquisition instant",
    async (id, instrument, assetClass, env) => {
      const clock = installClock();
      const snapshot = await adapterOf(id).fetch(instrument, assetClass as never, env ? (k) => env[k] : undefined);

      expect(snapshot).not.toBeNull();
      // Phase 238 — for providers with no observation time, observedAt == acquiredAt
      // is intentional receipt-time-by-policy with explicit provenance, not silent promotion.
      // coingecko = PROVIDER_RESPONSE (current-at-response), others = APPLICATION_RECEIPT.
      // This is documented and not PROVIDER_OBSERVED.
      expect(snapshot?.observedAt).toBe(snapshot?.acquiredAt);
      expect(snapshot?.timestampProvenance).not.toBe("PROVIDER_OBSERVED");
      expect(["PROVIDER_RESPONSE", "APPLICATION_RECEIPT"]).toContain(snapshot?.timestampProvenance);
      // ...and it is a read this acquisition really took, not a value chosen
      // to look plausible.
      expect(clock.reads).toContain(snapshot?.acquiredAt);
    },
  );

  it("twelve-data: the freshness verdict is judged at the instant the record carries", async () => {
    const clock = installClock();

    /*
      The transport itself takes one read and stamps the provider's time one
      millisecond below the adapter's own read. That places the stamp exactly
      on `assessFreshness`'s 300_000 ms FRESH/DELAYED boundary AT THE ADAPTER'S
      READ: judged there the age is 299_999 → FRESH, judged one millisecond
      later it is exactly 300_000 → DELAYED. The label therefore reveals
      whether the verdict used the instant the record carries.
    */
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const stamp = clock.now() - 299_998;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            values: [{ datetime: new Date(stamp).toISOString(), close: "150.5" }],
          }),
        } as unknown as Response;
      }),
    );

    const snapshot = await adapterOf("twelve-data").fetch("AAPL", "equity", (k) =>
      k === "TWELVE_DATA_API_KEY" ? "phase238-key" : "",
    );

    if (!snapshot || snapshot.acquiredAt === undefined) {
      throw new Error("twelve-data returned no record to grade");
    }
    // The provider's instant is preserved (Phase 191/220: we never overwrite
    // it with our own), while the verdict belongs to the acquisition read.
    expect(snapshot.observedAt).toBe(snapshot.acquiredAt - 299_999);
    expect(snapshot.freshness).toBe("FRESH");
    expect(snapshot.freshness).toBe(assessFreshness(snapshot.observedAt, snapshot.acquiredAt));
  });

  it("acquireLiveData dates its result with the snapshot's OWN instant, not a second read", async () => {
    // Reset rows and adapters — previous tests pollute shared singleton state
    rows = [candleRow(BASE - 60_000)];
    resetAdapters();
    const clock = installClock();

    const result = await acquireLiveData("BTC/USD", "crypto");
    if (!result.success) {
      console.log("acquireLiveData failed:", result.error, "provider:", result.provider, "reads:", clock.reads.length);
    }

    expect(result.success).toBe(true);
    // Pinned so a change in selection order is a loud failure rather than a
    // test that silently stops covering the provider it was written for.
    expect(result.provider).toBe("coingecko");
    expect(result.snapshot?.acquiredAt).toBeDefined();
    // One acquisition, one date: the result reuses the read the snapshot's
    // freshness was judged at. A second read here is a difference of exactly
    // 1 ms under the counting clock.
    expect(result.fetchedAt).toBe(result.snapshot?.acquiredAt);
    // CoinGecko's payload carries no observation time, so the price's date and
    // the record's date are the same event — hence the same number.
    expect(result.snapshot?.observedAt).toBe(result.fetchedAt);
    // The instant is a real read of this acquisition.
    expect(clock.reads).toContain(result.fetchedAt);
  });

  it("a result with no provider still costs ONE read, and that read is its instant", async () => {
    // With no credentials only the keyless adapters stay available, and none
    // of them serves forex quotes: the acquisition ends before any transport
    // is reached. That is the one result shape that carries no snapshot and no
    // provider at all, so it is the shape that pins this branch.
    const clock = installClock();
    const first = clock.reads.length;
    const result = await acquireLiveData("EUR/USD", "forex", () => "");

    expect(result.provider).toBe("none");
    expect(result.success).toBe(false);
    expect(result.snapshot).toBeNull();
    // The start read opens the acquisition, and the record's instant is the
    // LAST read of it: nothing consults the clock after the record is dated,
    // and the latency is measured to that same instant rather than to a
    // third one taken beside it.
    expect(result.fetchedAt).toBe(clock.reads[clock.reads.length - 1]);
    expect(result.latencyMs).toBe(result.fetchedAt - clock.reads[first]);
  });

  it("the health record measures latency between the two instants it reports", async () => {
    const clock = installClock();
    const adapter = adapterOf("okx");
    const before = adapter.getHealth();

    await adapter.fetch("BTC/USD", "crypto");

    const health = adapter.getHealth();
    const requests = before.totalRequests + 1;
    const reportedLatency = (health.lastSuccessAt ?? 0) - health.lastRequestAt;

    expect(health.totalRequests).toBe(requests);
    expect(clock.reads).toContain(health.lastRequestAt);
    // The closing read is the last one: `lastSuccessAt`, `cooldownUntil` and
    // the average below are all derived from it instead of from further reads.
    expect(health.lastSuccessAt).toBe(clock.reads[clock.reads.length - 1]);
    // The average the adapter publishes is built from the latency between ITS
    // OWN two instants — not from a third read taken alongside them.
    expect(health.avgLatencyMs).toBe(
      (before.avgLatencyMs * before.totalRequests + reportedLatency) / requests,
    );
  });

  it("the provider-native record's instant IS the live client's completion reading", async () => {
    const clock = installClock();
    let clientStart = -1;

    const result = await acquireNative(BASE - 60_000, (startRead) => (clientStart = startRead));

    expect(result.success).toBe(true);
    expect(clock.reads).toContain(result.fetchedAt);

    /*
      Phase 240 re-anchored this assertion; it was NOT relaxed.

      Phase 238 pinned the record's instant to the acquisition's LAST clock read,
      which held while the live client read its receipt at the very end of the
      request. Phase 240 moved that reading to the moment the transport settled —
      the honest meaning of "receipt", and the reason the pair no longer
      disagrees — so provider-health and cache bookkeeping legitimately read the
      clock AFTER it. "Last read" would now be satisfied only by an accident of
      ordering.

      The invariant Phase 238 cared about is that the record is not dated by a
      read of its own. It is enforced more directly here: `fetchedAt` must be the
      reading immediately after the client's request start — the completion — and
      the latency must be measured between exactly those two instants. A second
      read taken to date the record would be a later value and fails both lines.
    */
    const completionIndex = clock.reads.indexOf(clientStart) + 1;
    expect(clientStart).toBeGreaterThan(0);
    expect(result.fetchedAt).toBe(clock.reads[completionIndex]);
    expect(result.latencyMs).toBe(result.fetchedAt - clientStart);
  });

  it("the native path adds exactly ONE read of its own: the acquisition start", async () => {
    /*
      Phase 240 replacement for a "the record's instant is the LAST clock read"
      anchor, which the phase legitimately invalidated by capturing the receipt
      where it means something — at transport completion, not at the end of
      parsing — so that the receipt and the duration cannot disagree.

      The property that anchor existed to protect is narrower and survives: the
      registry must not consult the clock after the live client has returned.
      Measured RELATIVELY, so it stays meaningful if the client's own bookkeeping
      changes: run the identical exchange straight through the live client to
      establish its cost, then run it through the acquisition, and the difference
      must be exactly the one start read the acquisition takes before delegating.
      A stray read in the registry — the shape of mutation M25 — makes it two.
    */
    const clock = installClock();

    const direct = await executeLiveRequest({
      instrument: "BTC-USDT-SWAP",
      capability: "ohlcv",
      providerNative: { provider: "okx", providerInstrumentId: "BTC-USDT-SWAP", assetClass: "crypto" },
      transport: async () =>
        ({
          ok: true,
          status: 200,
          json: { data: [[String(BASE - 60_000), "60000", "61000", "59000", "60500", "123"]] },
        }) as never,
      readEnv: () => "",
    });
    const clientCost = clock.reads.length;

    const before = clock.reads.length;
    const result = await acquireNative(BASE - 60_000);
    const acquisitionCost = clock.reads.length - before;

    expect(direct.status).toBe("LIVE_VERIFIED");
    expect(result.success).toBe(true);
    expect(acquisitionCost - clientCost).toBe(1);
  });

  it("with no transport report, the latency ends at the record's own instant", async () => {
    // An unsupported provider is the one live path where the transport reports
    // no latency and no received time: the acquisition must take ONE read and
    // use it for both, so `fetchedAt` and `latencyMs` describe one measurement.
    const clock = installClock();
    const first = clock.reads.length;

    const result = await acquireProviderNativeLiveData(
      {
        instrument: "BTC-USDT-SWAP",
        provider: "provider-with-no-live-endpoint",
        providerInstrumentId: "BTC-USDT-SWAP",
        assetClass: "crypto",
      },
      undefined,
      async () => ({ ok: true, status: 200, json: {} }) as never,
    );

    expect(result.success).toBe(false);
    expect(clock.reads).toContain(result.fetchedAt);
    expect(result.latencyMs).toBe(result.fetchedAt - clock.reads[first]);
  });
});
