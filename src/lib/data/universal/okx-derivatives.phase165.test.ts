/**
 * Phase 165 — OKX derivative discovery coverage.
 *
 * Defect found by runtime verification: `toDiscoveredInstrument` rejected any
 * row without `baseCcy` AND `quoteCcy`. Per the OKX v5 docs those two fields
 * are populated for SPOT only — for SWAP/FUTURES they are empty and the pair
 * is carried by `uly` (the underlying index). The discovery call fetched
 * SPOT, SWAP and FUTURES but then silently discarded 100% of the derivatives,
 * so perpetuals and futures could never reach the scanner.
 *
 * These tests pin the derivation to fields OKX actually reports, so no
 * instrument identity is ever invented.
 */

import { describe, expect, it } from "vitest";
import { discoverOkxInstruments } from "./okx-discovery";

const NOW = 1_700_000_000_000;

function transportReturning(rows: Record<string, unknown>[]) {
  return async () =>
    new Response(JSON.stringify({ code: "0", data: rows }), { status: 200 });
}

async function discover(rows: Record<string, unknown>[]) {
  return discoverOkxInstruments(transportReturning(rows), NOW);
}

describe("OKX derivative discovery", () => {
  it("keeps SPOT rows that declare baseCcy/quoteCcy", async () => {
    const res = await discover([
      {
        instId: "BTC-USDT",
        instType: "SPOT",
        baseCcy: "BTC",
        quoteCcy: "USDT",
        state: "live",
      },
    ]);

    const spot = res.instruments.find((i) => i.instId === "BTC-USDT");
    expect(spot).toBeDefined();
    expect(spot!.baseAsset).toBe("BTC");
    expect(spot!.quoteAsset).toBe("USDT");
    expect(spot!.subType).toBe("crypto_spot");
  });

  it("no longer drops SWAP rows that omit baseCcy/quoteCcy", async () => {
    const res = await discover([
      {
        instId: "ETH-USDT-SWAP",
        instType: "SWAP",
        uly: "ETH-USDT",
        settleCcy: "USDT",
        ctValCcy: "ETH",
        state: "live",
      },
    ]);

    expect(res.instruments).toHaveLength(1);
    const swap = res.instruments[0];
    expect(swap.instId).toBe("ETH-USDT-SWAP");
    expect(swap.baseAsset).toBe("ETH");
    expect(swap.quoteAsset).toBe("USDT");
    expect(swap.subType).toBe("crypto_perpetual");
    expect(swap.settleAsset).toBe("USDT");
  });

  it("derives the pair for FUTURES from the underlying index", async () => {
    const res = await discover([
      {
        instId: "BTC-USD-241227",
        instType: "FUTURES",
        uly: "BTC-USD",
        settleCcy: "BTC",
        state: "live",
      },
    ]);

    expect(res.instruments).toHaveLength(1);
    expect(res.instruments[0].baseAsset).toBe("BTC");
    expect(res.instruments[0].quoteAsset).toBe("USD");
    expect(res.instruments[0].subType).toBe("crypto_futures");
  });

  it("falls back to the native instId when uly is absent", async () => {
    const res = await discover([
      { instId: "SOL-USDT-SWAP", instType: "SWAP", state: "live" },
    ]);

    expect(res.instruments).toHaveLength(1);
    expect(res.instruments[0].baseAsset).toBe("SOL");
    expect(res.instruments[0].quoteAsset).toBe("USDT");
  });

  it("carries the native instId through byte-for-byte", async () => {
    const res = await discover([
      { instId: "ETH-USDT-SWAP", instType: "SWAP", uly: "ETH-USDT", state: "live" },
    ]);

    // No normalization, no rewriting to "ETH/USDT" or similar.
    expect(res.instruments[0].instId).toBe("ETH-USDT-SWAP");
  });

  it("rejects rows whose pair cannot be resolved from provider fields", async () => {
    const res = await discover([
      // Single-segment id, no uly, no ccy fields: nothing to derive from.
      { instId: "WEIRD", instType: "SWAP", state: "live" },
    ]);

    expect(res.instruments).toHaveLength(0);
  });

  it("still rejects unsupported instrument types", async () => {
    const res = await discover([
      {
        instId: "BTC-USD-241227-60000-C",
        instType: "OPTION",
        uly: "BTC-USD",
        state: "live",
      },
    ]);

    expect(res.instruments).toHaveLength(0);
  });

  it("admits only live derivatives and preserves the reported state", async () => {
    const res = await discover([
      { instId: "A-USDT-SWAP", instType: "SWAP", uly: "A-USDT", state: "live" },
      { instId: "B-USDT-SWAP", instType: "SWAP", uly: "B-USDT", state: "suspend" },
      { instId: "C-USDT-SWAP", instType: "SWAP", uly: "C-USDT", state: "preopen" },
    ]);

    // Widening derivative coverage must not widen which states are tradable:
    // suspended and pre-launch instruments are still excluded here, and the
    // surviving row keeps the state OKX reported.
    expect(res.instruments.map((i) => i.instId)).toEqual(["A-USDT-SWAP"]);
    expect(res.instruments[0].state).toBe("live");
  });

  it("discovers spot and derivatives together in one pass", async () => {
    const res = await discover([
      {
        instId: "BTC-USDT",
        instType: "SPOT",
        baseCcy: "BTC",
        quoteCcy: "USDT",
        state: "live",
      },
      { instId: "BTC-USDT-SWAP", instType: "SWAP", uly: "BTC-USDT", state: "live" },
      {
        instId: "BTC-USD-241227",
        instType: "FUTURES",
        uly: "BTC-USD",
        state: "live",
      },
    ]);

    expect(res.instruments.map((i) => i.subType).sort()).toEqual([
      "crypto_futures",
      "crypto_perpetual",
      "crypto_spot",
    ]);
  });
});
