/**
 * Phase 159 — Multi-provider failover under the no-substitution rule.
 *
 * The rule being defended:
 *   provider B may serve the request ONLY if it lists the SAME instrument.
 *   Otherwise the correct answer is an explicit failure, not a swap.
 */

import { describe, expect, it } from "vitest";
import {
  areEquivalentInstruments,
  explainEquivalenceMismatch,
  instrumentEquivalenceKey,
} from "./equivalence";
import {
  acquireWithFailover,
  auditSubstitution,
  buildEquivalenceIndex,
  findFailoverCandidates,
} from "./failover";
import type { DiscoveredInstrument } from "./types";

const NOW = 1_800_000_000_000;

function inst(
  overrides: Partial<DiscoveredInstrument> & {
    provider: string;
    providerInstrumentId: string;
  },
): DiscoveredInstrument {
  return {
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    tradingState: "TRADING",
    capabilities: ["ohlcv"],
    discoveredAt: NOW,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. EQUIVALENCE IS STRICT
// ═══════════════════════════════════════════════════════════════

describe("A — strict equivalence", () => {
  const okx = inst({ provider: "okx", providerInstrumentId: "BTC-USDT" });

  it("matches the same instrument on a different provider", () => {
    const other = inst({ provider: "other", providerInstrumentId: "BTCUSDT" });
    expect(areEquivalentInstruments(okx, other)).toBe(true);
  });

  it("rejects a different quote asset (USDT is not USD)", () => {
    const usd = inst({
      provider: "other",
      providerInstrumentId: "BTC-USD",
      quoteAsset: "USD",
    });
    expect(areEquivalentInstruments(okx, usd)).toBe(false);
    expect(explainEquivalenceMismatch(okx, usd)).toContain("quote asset");
  });

  it("rejects spot vs perpetual", () => {
    const perp = inst({
      provider: "other",
      providerInstrumentId: "BTC-USDT-SWAP",
      subType: "crypto_perpetual",
    });
    expect(areEquivalentInstruments(okx, perp)).toBe(false);
    expect(explainEquivalenceMismatch(okx, perp)).toContain("subtype");
  });

  it("rejects a different base asset", () => {
    const eth = inst({
      provider: "other",
      providerInstrumentId: "ETH-USDT",
      baseAsset: "ETH",
    });
    expect(areEquivalentInstruments(okx, eth)).toBe(false);
  });

  it("rejects a different asset class", () => {
    const equity = inst({
      provider: "other",
      providerInstrumentId: "BTC",
      assetClass: "equity",
      subType: "equity_common",
    });
    expect(areEquivalentInstruments(okx, equity)).toBe(false);
  });

  it("rejects conflicting settlement assets", () => {
    const linear = inst({
      provider: "a",
      providerInstrumentId: "BTC-USDT-SWAP",
      subType: "crypto_perpetual",
      settleAsset: "USDT",
    });
    const inverse = inst({
      provider: "b",
      providerInstrumentId: "BTC-USD-SWAP",
      subType: "crypto_perpetual",
      settleAsset: "BTC",
      quoteAsset: "USDT",
    });
    expect(areEquivalentInstruments(linear, inverse)).toBe(false);
  });

  it("produces a provider-independent identity key", () => {
    const other = inst({ provider: "other", providerInstrumentId: "BTCUSDT" });
    expect(instrumentEquivalenceKey(okx)).toBe(instrumentEquivalenceKey(other));
  });
});

// ═══════════════════════════════════════════════════════════════
// B. CANDIDATE SELECTION
// ═══════════════════════════════════════════════════════════════

describe("B — failover candidate selection", () => {
  const target = inst({ provider: "okx", providerInstrumentId: "BTC-USDT" });

  it("finds an equivalent instrument on another provider", () => {
    const index = buildEquivalenceIndex([
      target,
      inst({ provider: "other", providerInstrumentId: "BTCUSDT" }),
    ]);
    const candidates = findFailoverCandidates(target, index);
    expect(candidates.map((c) => c.provider)).toEqual(["other"]);
  });

  it("never proposes the same provider as its own failover", () => {
    const index = buildEquivalenceIndex([
      target,
      inst({ provider: "okx", providerInstrumentId: "BTC-USDT-ALT" }),
    ]);
    expect(findFailoverCandidates(target, index)).toEqual([]);
  });

  it("never proposes a non-equivalent instrument", () => {
    const index = buildEquivalenceIndex([
      target,
      inst({
        provider: "other",
        providerInstrumentId: "BTC-USD",
        quoteAsset: "USD",
      }),
    ]);
    expect(findFailoverCandidates(target, index)).toEqual([]);
  });

  it("skips candidates that are not trading", () => {
    const index = buildEquivalenceIndex([
      target,
      inst({
        provider: "other",
        providerInstrumentId: "BTCUSDT",
        tradingState: "SUSPENDED",
      }),
    ]);
    expect(findFailoverCandidates(target, index)).toEqual([]);
  });

  it("skips candidates lacking the required capability", () => {
    const index = buildEquivalenceIndex([
      target,
      inst({
        provider: "other",
        providerInstrumentId: "BTCUSDT",
        capabilities: ["quote"],
      }),
    ]);
    expect(findFailoverCandidates(target, index, "ohlcv")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. FAILOVER EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("C — failover execution", () => {
  const target = inst({ provider: "okx", providerInstrumentId: "BTC-USDT" });
  const equivalent = inst({ provider: "other", providerInstrumentId: "BTCUSDT" });

  it("uses the primary provider when it succeeds", async () => {
    const index = buildEquivalenceIndex([target, equivalent]);
    const outcome = await acquireWithFailover(target, index, async (i) => ({
      success: true,
      value: i.provider,
    }));

    expect(outcome.success).toBe(true);
    expect(outcome.servedBy).toBe("okx");
    expect(outcome.attempts).toHaveLength(1);
  });

  it("falls over to an equivalent instrument on another provider", async () => {
    const index = buildEquivalenceIndex([target, equivalent]);
    const outcome = await acquireWithFailover(target, index, async (i) =>
      i.provider === "okx"
        ? { success: false, error: "HTTP 503" }
        : { success: true, value: i.provider },
    );

    expect(outcome.success).toBe(true);
    expect(outcome.servedBy).toBe("other");
    expect(outcome.servedInstrument!.providerInstrumentId).toBe("BTCUSDT");
    expect(outcome.attempts).toHaveLength(2);
  });

  it("FAILS rather than substituting a different instrument", async () => {
    const wrong = inst({
      provider: "other",
      providerInstrumentId: "BTC-USD",
      quoteAsset: "USD",
    });
    const index = buildEquivalenceIndex([target, wrong]);

    const attempted: string[] = [];
    const outcome = await acquireWithFailover(target, index, async (i) => {
      attempted.push(i.providerInstrumentId);
      return i.provider === "okx"
        ? { success: false, error: "down" }
        : { success: true, value: i.provider };
    });

    // The non-equivalent instrument must never even be attempted.
    expect(attempted).toEqual(["BTC-USDT"]);
    expect(outcome.success).toBe(false);
    expect(outcome.servedBy).toBeUndefined();
  });

  it("reports explicit failure when every provider fails", async () => {
    const index = buildEquivalenceIndex([target, equivalent]);
    const outcome = await acquireWithFailover(target, index, async () => ({
      success: false,
      error: "down",
    }));

    expect(outcome.success).toBe(false);
    expect(outcome.value).toBeUndefined();
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.error).toContain("failed");
  });

  it("records every attempt for auditability", async () => {
    const index = buildEquivalenceIndex([target, equivalent]);
    const outcome = await acquireWithFailover(target, index, async (i) =>
      i.provider === "okx"
        ? { success: false, error: "timeout" }
        : { success: true, value: 1 },
    );

    expect(outcome.attempts[0]).toMatchObject({
      provider: "okx",
      success: false,
      error: "timeout",
    });
    expect(outcome.attempts[1]).toMatchObject({ provider: "other", success: true });
  });

  it("treats a thrown attempt as a failure and continues", async () => {
    const index = buildEquivalenceIndex([target, equivalent]);
    const outcome = await acquireWithFailover(target, index, async (i) => {
      if (i.provider === "okx") throw new Error("socket hang up");
      return { success: true, value: i.provider };
    });

    expect(outcome.success).toBe(true);
    expect(outcome.servedBy).toBe("other");
    expect(outcome.attempts[0].error).toContain("socket hang up");
  });

  it("respects the provider attempt cap", async () => {
    const index = buildEquivalenceIndex([
      target,
      inst({ provider: "b", providerInstrumentId: "BTCUSDT" }),
      inst({ provider: "c", providerInstrumentId: "BTC_USDT" }),
    ]);

    const outcome = await acquireWithFailover(
      target,
      index,
      async () => ({ success: false, error: "down" }),
      { maxProviders: 2 },
    );

    expect(outcome.attempts).toHaveLength(2);
  });

  it("never launders provider identity on success", async () => {
    const index = buildEquivalenceIndex([target, equivalent]);
    const outcome = await acquireWithFailover(target, index, async (i) =>
      i.provider === "okx"
        ? { success: false, error: "down" }
        : { success: true, value: i.provider },
    );

    // The served instrument reports the provider that actually answered.
    expect(outcome.servedInstrument!.provider).toBe("other");
    expect(outcome.servedInstrument!.provider).not.toBe(target.provider);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. SUBSTITUTION AUDIT
// ═══════════════════════════════════════════════════════════════

describe("D — substitution audit", () => {
  const requested = inst({ provider: "okx", providerInstrumentId: "BTC-USDT" });

  it("permits an equivalent swap", () => {
    const served = inst({ provider: "other", providerInstrumentId: "BTCUSDT" });
    expect(auditSubstitution(requested, served)).toBeNull();
  });

  it("refuses a non-equivalent swap with a reason", () => {
    const served = inst({
      provider: "other",
      providerInstrumentId: "ETH-USDT",
      baseAsset: "ETH",
    });
    const verdict = auditSubstitution(requested, served);
    expect(verdict).toContain("refused substitution");
    expect(verdict).toContain("base asset");
  });
});
