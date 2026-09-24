/**
 * Phase 240 — the meanings did not move.
 *
 * Phase 238 separated three ideas that a single `Date.now()` had been blurring:
 *
 *   receivedAt  — when the CLIENT received/completed the exchange
 *   observedAt  — when the PROVIDER says the market was observed (its data)
 *   latencyMs   — how long the client's request took (a duration)
 *
 * This phase made the first and third come from one reading. The risk of that
 * edit is semantic drift, so these tests pin all three meanings, including the
 * one that is easiest to break by accident: replacing a provider timestamp with
 * the client's receipt time.
 *
 * Everything here is measured, not asserted from the code's shape: the clock is
 * the Phase 238 counting clock, so "the receipt is real and recent" and "the
 * provider's timestamp is untouched" are both visible in the values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCountingClock, type CountingClock } from "../../../../test-counting-clock";
import { executeLiveRequest, resetLiveState, type Transport } from "./client";
import { resetCache } from "../cache";
import { resetProviderHealth } from "../routing-engine";
import { acquireProviderNativeLiveData } from "@/lib/market-radar/provider-registry";

const BASE = 1_800_000_000_000;
/** The provider's own candle time: ten minutes before the client's clock. */
const PROVIDER_TS = BASE - 600_000;
/** A second, older candle so the series has an order and nothing is "fixed up". */
const PROVIDER_TS_OLDER = BASE - 4_200_000;

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

/** OKX rows are newest-first, so the newest candle is the provider's latest. */
function okxBody() {
  return {
    code: "0",
    data: [
      [String(PROVIDER_TS), "100", "105", "95", "102", "1000"],
      [String(PROVIDER_TS_OLDER), "98", "101", "97", "100", "900"],
    ],
  };
}

const NATIVE_OKX = {
  provider: "okx",
  providerInstrumentId: "BTC-USDT-SWAP",
  assetClass: "crypto" as const,
};

function okxTransport(onCall?: (startRead: number) => void): Transport {
  return async () => {
    onCall?.(clock.reads[clock.reads.length - 1]);
    return { ok: true, status: 200, json: okxBody() };
  };
}

describe("240 — receivedAt is still client receipt time", () => {
  it("is a real clock reading taken when the exchange completed, not a provider value", async () => {
    let start = -1;
    const result = await executeLiveRequest({
      instrument: "BTC-USDT-SWAP",
      capability: "ohlcv",
      providerNative: NATIVE_OKX,
      transport: okxTransport((s) => (start = s)),
      readEnv: () => undefined,
      now: BASE,
    });

    expect(result.status).toBe("LIVE_VERIFIED");
    // A reading this clock produced...
    expect(clock.reads).toContain(result.receivedAt);
    // ...at or after the request start, and independent of provider data.
    expect(result.receivedAt).toBeGreaterThan(start);
    expect(result.receivedAt).not.toBe(PROVIDER_TS);
    expect(result.receivedAt).not.toBe(result.requestedAt);
  });

  it("stays a receipt even when the payload carries no timestamps at all", async () => {
    // A quote has no provider time. `receivedAt` must still be a real reading —
    // the receipt is not derived from the payload, and the payload is not given
    // a fabricated time to match it.
    const result = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "tokenomics",
      transport: async () => ({ ok: true, status: 200, json: { bitcoin: { usd: 100_000 } } }),
      readEnv: () => undefined,
      now: BASE,
    });

    expect(result.status).toBe("LIVE_VERIFIED");
    expect(clock.reads).toContain(result.receivedAt);
    expect(result.receivedAt).toBeGreaterThan(BASE);
  });
});

describe("240 — provider observation timestamps remain provider-owned", () => {
  it("candle timestamps are carried through byte-exact", async () => {
    const result = await executeLiveRequest({
      instrument: "BTC-USDT-SWAP",
      capability: "ohlcv",
      providerNative: NATIVE_OKX,
      transport: okxTransport(),
      readEnv: () => undefined,
      now: BASE,
    });

    expect(result.candles?.map((c) => c.timestamp)).toEqual([
      PROVIDER_TS_OLDER,
      PROVIDER_TS,
    ]);
    // Nothing was rewritten to the client's instant, and the client's instant
    // was not taken from the provider's data.
    for (const candle of result.candles ?? []) {
      expect(candle.timestamp).not.toBe(result.receivedAt);
    }
  });

  it("the acquisition record keeps the provider's observation time beside the client's receipt", async () => {
    /*
      The cross-layer claim, and the reason this pair matters at all: the
      market-radar registry reads the client's single instant for BOTH
      `fetchedAt` and the end of its latency, while the snapshot's `observedAt`
      stays the provider's own candle time. Two different instants, each owned by
      the layer that knows it.
    */
    let start = -1;
    const acquisition = await acquireProviderNativeLiveData(
      {
        instrument: "BTC-USDT-SWAP",
        provider: "okx",
        providerInstrumentId: "BTC-USDT-SWAP",
        assetClass: "crypto",
      },
      () => undefined,
      okxTransport((s) => (start = s)),
    );

    expect(acquisition.success).toBe(true);
    expect(acquisition.snapshot?.observedAt).toBe(PROVIDER_TS);

    /*
      The receipt is the client's SINGLE completion reading, and it travelled
      through the registry unchanged: `fetchedAt` is the very next reading after
      the request start, which is the instant the transport completed. Had the
      registry taken its own completion reading (or the client a second one), the
      value would be a later reading and this would fail.
    */
    const completionIndex = clock.reads.indexOf(start) + 1;
    expect(completionIndex).toBeGreaterThan(0);
    expect(acquisition.fetchedAt).toBe(clock.reads[completionIndex]);
    // The registry's own duration is that same exchange, not a second one...
    expect(acquisition.latencyMs).toBe(acquisition.fetchedAt - start);
    // ...and the client's receipt is not the provider's observation.
    expect(acquisition.fetchedAt).not.toBe(acquisition.snapshot?.observedAt);
  });

  it("a stale observation is still judged STALE, not re-dated to look fresh", async () => {
    // The provider's newest candle is an hour old: freshness must be judged from
    // the provider's instant, so re-dating `fetchedAt` (a real risk when the two
    // concepts drift) would show up here as a fresher verdict.
    const old = BASE - 4 * 3_600_000;
    const acquisition = await acquireProviderNativeLiveData(
      {
        instrument: "BTC-USDT-SWAP",
        provider: "okx",
        providerInstrumentId: "BTC-USDT-SWAP",
        assetClass: "crypto",
      },
      () => undefined,
      async () => ({
        ok: true,
        status: 200,
        json: { code: "0", data: [[String(old), "100", "105", "95", "102", "1000"]] },
      }),
    );

    expect(acquisition.snapshot?.observedAt).toBe(old);
    expect(acquisition.snapshot?.freshness).not.toBe("FRESH");
  });
});

describe("240 — latencyMs is a duration, not an instant", () => {
  it("measures the exchange and nothing else", async () => {
    let start = -1;
    const result = await executeLiveRequest({
      instrument: "BTC-USDT-SWAP",
      capability: "ohlcv",
      providerNative: NATIVE_OKX,
      transport: okxTransport((s) => (start = s)),
      readEnv: () => undefined,
      now: BASE,
    });

    const receivedAt = result.receivedAt;
    expect(receivedAt).not.toBeNull();
    expect(result.latencyMs).toBe((receivedAt ?? 0) - start);
    // A duration is small and cannot be mistaken for a wall-clock instant.
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.latencyMs).toBeLessThan(1_000);
    expect(result.latencyMs).not.toBe(receivedAt);
    expect(result.latencyMs).not.toBe(result.requestedAt);
    // The health record carries the SAME duration, not a second measurement.
    expect(result.diagnostic.latencyMs).toBe(result.latencyMs);
  });

  it("travels on to the acquisition record as the same duration", async () => {
    const acquisition = await acquireProviderNativeLiveData(
      {
        instrument: "BTC-USDT-SWAP",
        provider: "okx",
        providerInstrumentId: "BTC-USDT-SWAP",
        assetClass: "crypto",
      },
      () => undefined,
      okxTransport(),
    );

    expect(acquisition.latencyMs).toBeGreaterThan(0);
    expect(acquisition.latencyMs).toBeLessThan(1_000);
    expect(acquisition.fetchedAt - acquisition.latencyMs).toBeGreaterThan(0);
    // A duration, not the timestamp it was derived from.
    expect(acquisition.latencyMs).toBeLessThan(acquisition.fetchedAt);
  });
});
