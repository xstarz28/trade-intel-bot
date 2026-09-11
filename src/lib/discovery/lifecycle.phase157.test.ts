/**
 * Phase 157 — Live Discovery Lifecycle Hardening
 *
 * The invariant under test is the one that matters most in production:
 *
 *   A FAILED ACQUISITION MUST NEVER DESTROY VALID LIVE DATA.
 *
 * Data may only leave the scanner by genuinely expiring (aging out) or by
 * being positively delisted by a SUCCESSFUL provider discovery.
 */

import { describe, expect, it } from "vitest";
import {
  applyAcquisitionOutcomes,
  expireStaleInstruments,
  keysToEvict,
  liveEligibleInstruments,
  reconcileDiscovery,
  DEFAULT_LIFECYCLE_CONFIG,
  type TrackedInstrument,
} from "./lifecycle";
import { discoveredInstrumentKey, type DiscoveredInstrument } from "./types";

const NOW = 1_800_000_000_000;

function makeInstrument(
  provider: string,
  providerInstrumentId: string,
): DiscoveredInstrument {
  return {
    provider,
    providerInstrumentId,
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: providerInstrumentId.split("-")[0] ?? "BTC",
    quoteAsset: "USDT",
    tradingState: "TRADING",
    capabilities: ["ohlcv"],
    discoveredAt: NOW,
  };
}

function trackedLive(
  instrument: DiscoveredInstrument,
  lastLiveAt: number,
): TrackedInstrument {
  return {
    instrument,
    state: "LIVE",
    lastLiveAt,
    lastSuccessAt: lastLiveAt,
    lastFailureAt: null,
    consecutiveFailures: 0,
    lastSeenInDiscoveryAt: lastLiveAt,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. FAILURE MUST NOT DESTROY DATA
// ═══════════════════════════════════════════════════════════════

describe("A — acquisition failure never deletes valid data", () => {
  it("retains live data and its timestamp after a failed refresh", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);
    const tracked = new Map([[key, trackedLive(instrument, NOW - 60_000)]]);

    const next = applyAcquisitionOutcomes(
      tracked,
      [{ key, success: false }],
      NOW,
    );

    const entry = next.get(key)!;
    expect(entry.state).toBe("REFRESH_FAILED");
    expect(entry.lastLiveAt).toBe(NOW - 60_000);
    expect(entry.consecutiveFailures).toBe(1);
  });

  it("keeps a refresh-failed instrument eligible for scanning", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);
    const tracked = applyAcquisitionOutcomes(
      new Map([[key, trackedLive(instrument, NOW - 60_000)]]),
      [{ key, success: false }],
      NOW,
    );

    expect(liveEligibleInstruments(tracked)).toHaveLength(1);
    expect(keysToEvict(tracked)).toEqual([]);
  });

  it("survives many consecutive failures while data is still within retention", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);
    let tracked = new Map([[key, trackedLive(instrument, NOW - 60_000)]]);

    for (let i = 0; i < 25; i++) {
      tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW);
    }

    const entry = tracked.get(key)!;
    expect(entry.consecutiveFailures).toBe(25);
    expect(entry.lastLiveAt).toBe(NOW - 60_000);
    expect(keysToEvict(tracked)).toEqual([]);
  });

  it("recovers to LIVE and resets failures after a success", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);
    let tracked = new Map([[key, trackedLive(instrument, NOW - 60_000)]]);

    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW);
    tracked = applyAcquisitionOutcomes(
      tracked,
      [{ key, success: true, observedAt: NOW }],
      NOW,
    );

    const entry = tracked.get(key)!;
    expect(entry.state).toBe("LIVE");
    expect(entry.consecutiveFailures).toBe(0);
    expect(entry.lastLiveAt).toBe(NOW);
  });

  it("never moves the observation timestamp backwards", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);
    const tracked = new Map([[key, trackedLive(instrument, NOW)]]);

    const next = applyAcquisitionOutcomes(
      tracked,
      [{ key, success: true, observedAt: NOW - 600_000 }],
      NOW,
    );

    expect(next.get(key)!.lastLiveAt).toBe(NOW);
  });

  it("a never-acquired instrument stays DISCOVERED after failure, not live", () => {
    const instrument = makeInstrument("okx", "NEW-USDT");
    const key = discoveredInstrumentKey(instrument);
    const tracked = new Map<string, TrackedInstrument>([
      [
        key,
        {
          instrument,
          state: "DISCOVERED",
          lastLiveAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          consecutiveFailures: 0,
          lastSeenInDiscoveryAt: NOW,
        },
      ],
    ]);

    const next = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW);
    expect(next.get(key)!.state).toBe("DISCOVERED");
    expect(liveEligibleInstruments(next)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. EXPIRY IS AGE-BASED ONLY
// ═══════════════════════════════════════════════════════════════

describe("B — expiry driven by data age, not failure count", () => {
  it("expires data older than the retention window", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);
    const old = NOW - DEFAULT_LIFECYCLE_CONFIG.retentionMs - 1;
    const tracked = new Map([[key, trackedLive(instrument, old)]]);

    const next = expireStaleInstruments(tracked, NOW);
    expect(next.get(key)!.state).toBe("EXPIRED");
    expect(keysToEvict(next)).toEqual([key]);
  });

  it("does not expire data inside the retention window", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);
    const tracked = new Map([
      [key, trackedLive(instrument, NOW - DEFAULT_LIFECYCLE_CONFIG.retentionMs + 1000)],
    ]);

    expect(expireStaleInstruments(tracked, NOW).get(key)!.state).toBe("LIVE");
  });

  it("expired data drops out of the live-eligible set", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);
    const old = NOW - DEFAULT_LIFECYCLE_CONFIG.retentionMs - 1;
    const next = expireStaleInstruments(
      new Map([[key, trackedLive(instrument, old)]]),
      NOW,
    );

    expect(liveEligibleInstruments(next)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. DELISTING REQUIRES A SUCCESSFUL DISCOVERY
// ═══════════════════════════════════════════════════════════════

describe("C — delisting requires a positive signal", () => {
  it("retires an instrument absent from a SUCCESSFUL discovery", () => {
    const gone = makeInstrument("okx", "OLD-USDT");
    const key = discoveredInstrumentKey(gone);

    const next = reconcileDiscovery({
      tracked: new Map([[key, trackedLive(gone, NOW - 1000)]]),
      discovered: [],
      succeededProviders: ["okx"],
      now: NOW,
    });

    expect(next.get(key)!.state).toBe("DELISTED");
    expect(keysToEvict(next)).toEqual([key]);
  });

  it("a FAILED discovery never retires anything", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);

    const next = reconcileDiscovery({
      tracked: new Map([[key, trackedLive(instrument, NOW - 1000)]]),
      discovered: [],
      // okx failed this cycle → absence proves nothing.
      succeededProviders: [],
      now: NOW,
    });

    expect(next.get(key)!.state).toBe("LIVE");
    expect(keysToEvict(next)).toEqual([]);
  });

  it("one provider's success never retires another provider's instruments", () => {
    const okx = makeInstrument("okx", "BTC-USDT");
    const other = makeInstrument("other", "BTC-USD");
    const okxKey = discoveredInstrumentKey(okx);
    const otherKey = discoveredInstrumentKey(other);

    const next = reconcileDiscovery({
      tracked: new Map([
        [okxKey, trackedLive(okx, NOW - 1000)],
        [otherKey, trackedLive(other, NOW - 1000)],
      ]),
      discovered: [okx],
      // Only okx answered; "other" is untouched.
      succeededProviders: ["okx"],
      now: NOW,
    });

    expect(next.get(okxKey)!.state).toBe("LIVE");
    expect(next.get(otherKey)!.state).toBe("LIVE");
  });

  it("re-lists a previously delisted instrument when it returns", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);

    const delisted = reconcileDiscovery({
      tracked: new Map([[key, trackedLive(instrument, NOW - 1000)]]),
      discovered: [],
      succeededProviders: ["okx"],
      now: NOW,
    });
    expect(delisted.get(key)!.state).toBe("DELISTED");

    const relisted = reconcileDiscovery({
      tracked: delisted,
      discovered: [instrument],
      succeededProviders: ["okx"],
      now: NOW + 1000,
    });
    expect(relisted.get(key)!.state).toBe("LIVE");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. NEW DISCOVERIES ARE NOT LIVE
// ═══════════════════════════════════════════════════════════════

describe("D — newly discovered instruments are metadata only", () => {
  it("adds new instruments as DISCOVERED with no live data", () => {
    const instrument = makeInstrument("okx", "NEW-USDT");
    const key = discoveredInstrumentKey(instrument);

    const next = reconcileDiscovery({
      tracked: new Map(),
      discovered: [instrument],
      succeededProviders: ["okx"],
      now: NOW,
    });

    const entry = next.get(key)!;
    expect(entry.state).toBe("DISCOVERED");
    expect(entry.lastLiveAt).toBeNull();
    expect(liveEligibleInstruments(next)).toEqual([]);
  });

  it("refreshes metadata without disturbing live state", () => {
    const instrument = makeInstrument("okx", "BTC-USDT");
    const key = discoveredInstrumentKey(instrument);

    const next = reconcileDiscovery({
      tracked: new Map([[key, trackedLive(instrument, NOW - 1000)]]),
      discovered: [{ ...instrument, precision: { tickSize: 0.5 } }],
      succeededProviders: ["okx"],
      now: NOW,
    });

    const entry = next.get(key)!;
    expect(entry.state).toBe("LIVE");
    expect(entry.lastLiveAt).toBe(NOW - 1000);
    expect(entry.instrument.precision?.tickSize).toBe(0.5);
  });

  it("discovers new instruments without a ceiling", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      makeInstrument("okx", `T${i}-USDT`),
    );

    const next = reconcileDiscovery({
      tracked: new Map(),
      discovered: many,
      succeededProviders: ["okx"],
      now: NOW,
    });

    expect(next.size).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. FULL CYCLE
// ═══════════════════════════════════════════════════════════════

describe("E — full lifecycle cycle", () => {
  it("keeps old valid instruments while adding newly discovered ones", () => {
    const existing = makeInstrument("okx", "BTC-USDT");
    const fresh = makeInstrument("okx", "NEWCOIN-USDT");
    const existingKey = discoveredInstrumentKey(existing);
    const freshKey = discoveredInstrumentKey(fresh);

    let tracked = reconcileDiscovery({
      tracked: new Map([[existingKey, trackedLive(existing, NOW - 60_000)]]),
      discovered: [existing, fresh],
      succeededProviders: ["okx"],
      now: NOW,
    });

    // New one acquires successfully; the existing one fails to refresh.
    tracked = applyAcquisitionOutcomes(
      tracked,
      [
        { key: freshKey, success: true, observedAt: NOW },
        { key: existingKey, success: false },
      ],
      NOW,
    );
    tracked = expireStaleInstruments(tracked, NOW);

    expect(tracked.get(freshKey)!.state).toBe("LIVE");
    // The failure did NOT destroy the old instrument.
    expect(tracked.get(existingKey)!.state).toBe("REFRESH_FAILED");
    expect(liveEligibleInstruments(tracked)).toHaveLength(2);
    expect(keysToEvict(tracked)).toEqual([]);
  });

  it("evicts only genuinely expired or delisted instruments", () => {
    const live = makeInstrument("okx", "BTC-USDT");
    const stale = makeInstrument("okx", "OLD-USDT");
    const liveKey = discoveredInstrumentKey(live);
    const staleKey = discoveredInstrumentKey(stale);

    let tracked = new Map([
      [liveKey, trackedLive(live, NOW - 60_000)],
      [
        staleKey,
        trackedLive(stale, NOW - DEFAULT_LIFECYCLE_CONFIG.retentionMs - 1),
      ],
    ]);

    tracked = expireStaleInstruments(tracked, NOW);

    expect(keysToEvict(tracked)).toEqual([staleKey]);
    expect(liveEligibleInstruments(tracked).map((e) => e.instrument.providerInstrumentId))
      .toEqual(["BTC-USDT"]);
  });
});
