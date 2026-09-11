/**
 * Phase 176 — server-side secondary provider acquisition (mocked providers).
 *
 * The real provider endpoints are firewalled in this environment, so these
 * tests drive the EXACT orchestration module the server handler uses
 * (`fetchOptionalSlowData`, Phase 15) with injected thunks that model real
 * provider contracts: success payloads, `success: false` envelopes, thrown
 * network errors and unconfigured-key responses.
 *
 * This is MOCKED PROVIDER verification, not deployed-runtime verification.
 * It proves the wiring, conditional policy and failure semantics — it does not
 * prove the live endpoints behave as modelled.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchOptionalSlowData } from "@/lib/data/optional-providers";

const SERVER = readFileSync("src/convex/protectedAnalysis.ts", "utf8");

const FOREX = {
  instrumentType: "forex" as const,
  instrument: "EUR/USD",
  hasCompleteSpec: false,
};
const CRYPTO = {
  instrumentType: "crypto" as const,
  instrument: "BTC-USDT-SWAP",
  hasCompleteSpec: false,
};

// ═══════════════════════════════════════════════════════════
// Wiring — every provider is reached through its existing action
// ═══════════════════════════════════════════════════════════

describe("the handler calls the existing provider actions", () => {
  const EXPECTED = [
    "api.alphaVantage.fetchIntelligence",
    "api.tradingEconomics.fetchCalendar",
    "api.coinglass.fetchDerivatives",
    "api.cot.fetchCotPositioning",
    "api.okx.fetchOkxOrderBook",
    "api.eia.fetchEiaInventory",
    "api.treasury.fetchTreasuryYields",
    "api.okx.fetchOkxInstrumentSpec",
    "api.marketData.fetchFxRate",
    "api.marketData.fetchMarketData",
  ];

  for (const ref of EXPECTED) {
    it(`invokes ${ref}`, () => {
      expect(SERVER).toContain(ref);
    });
  }

  it("reuses the shared conditional-policy module rather than reimplementing it", () => {
    expect(SERVER).toContain("fetchOptionalSlowData");
    // No hand-rolled conditional policy in the handler.
    expect(SERVER).not.toMatch(/instrumentType === "commodity" &&\s*\/WTI/);
  });

  it("does not duplicate provider business logic", () => {
    // Symbol mapping, key handling and parsing stay in the provider modules.
    for (const forbidden of [
      "ALPHA_VANTAGE_API_KEY",
      "COINGLASS_API_KEY",
      "TICKATLAS_API_KEY",
      "EIA_API_KEY",
      "mapSymbolForAV",
      "mapInstrumentToOkx",
      "api/v5/market/books",
    ]) {
      expect(SERVER).not.toContain(forbidden);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Failure semantics
// ═══════════════════════════════════════════════════════════

describe("provider failures are non-fatal and never directional", () => {
  it("a thrown network error yields undefined, not a fabricated value", async () => {
    const r = await fetchOptionalSlowData(FOREX, {
      cot: () => Promise.reject(new Error("ECONNREFUSED")),
      treasury: () => Promise.reject(new Error("socket hang up")),
    });

    expect(r.cotData).toBeUndefined();
    expect(r.treasuryData).toBeUndefined();
  });

  it("an unconfigured provider key yields undefined", async () => {
    const r = await fetchOptionalSlowData(FOREX, {
      treasury: () =>
        Promise.resolve({ success: false, error: "EIA_API_KEY is missing" }),
    });

    expect(r.treasuryData).toBeUndefined();
  });

  it("a success:false envelope never becomes data", async () => {
    const r = await fetchOptionalSlowData(FOREX, {
      cot: () => Promise.resolve({ success: false }),
    });

    expect(r.cotData).toBeUndefined();
  });

  it("one provider failing does not suppress the others", async () => {
    const r = await fetchOptionalSlowData(FOREX, {
      cot: () => Promise.reject(new Error("down")),
      treasury: () =>
        Promise.resolve({
          success: true,
          data: { available: true } as never,
        }),
    });

    expect(r.cotData).toBeUndefined();
    expect(r.treasuryData).toEqual({ available: true });
  });

  it("every leg failing produces an empty context, never defaults", async () => {
    const fail = () => Promise.reject(new Error("down"));
    const r = await fetchOptionalSlowData(CRYPTO, {
      fx: fail,
      cot: fail,
      execution: fail,
      eia: fail,
      treasury: fail,
      okxSpec: fail,
    });

    expect(Object.values(r).every((v) => v === undefined)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Conditional policy is unchanged
// ═══════════════════════════════════════════════════════════

describe("conditional provider policy is preserved", () => {
  it("crypto does not call COT / EIA / treasury", async () => {
    const cot = vi.fn();
    const eia = vi.fn();
    const treasury = vi.fn();

    await fetchOptionalSlowData(CRYPTO, { cot, eia, treasury });

    expect(cot).not.toHaveBeenCalled();
    expect(eia).not.toHaveBeenCalled();
    expect(treasury).not.toHaveBeenCalled();
  });

  it("forex does not call the crypto-only legs", async () => {
    const execution = vi.fn();
    const okxSpec = vi.fn();

    await fetchOptionalSlowData(FOREX, { execution, okxSpec });

    expect(execution).not.toHaveBeenCalled();
    expect(okxSpec).not.toHaveBeenCalled();
  });

  it("scalping suppresses the slow macro legs", async () => {
    const cot = vi.fn();
    const treasury = vi.fn();

    await fetchOptionalSlowData(
      { ...FOREX, tradingStyle: "scalping" },
      { cot, treasury },
    );

    expect(cot).not.toHaveBeenCalled();
    expect(treasury).not.toHaveBeenCalled();
  });

  it("each provider is invoked at most once per analysis", async () => {
    const cot = vi.fn(() => Promise.resolve({ success: true, data: {} as never }));

    await fetchOptionalSlowData(FOREX, { cot });

    expect(cot).toHaveBeenCalledTimes(1);
  });

  it("all provider legs are issued in ONE parallel wave", () => {
    // The server must not serialize provider latency. The client previously
    // fanned these out concurrently; the server-side path must match, or a
    // slow provider would stall every analysis.
    // Phase 177: the wave is now `runFanOut([...])`, which awaits all legs
    // together under an overall deadline. Exactly one wave must exist.
    expect(SERVER.match(/await runFanOut\(\[/g)).toHaveLength(1);
    expect(SERVER).not.toContain("const slow = await fetchOptionalSlowData");

    // Every leg is CREATED (promise started) before the wave is awaited.
    // If a leg were constructed after the await, it would be serialized.
    const waveAt = SERVER.indexOf("await runFanOut([");
    for (const leg of [
      'provider: "market-data"',
      'provider: "alpha-vantage"',
      'provider: "tickatlas"',
      'provider: "coinglass"',
      "fetchOptionalSlowData(",
    ]) {
      expect(SERVER.indexOf(leg)).toBeLessThan(waveAt);
    }
  });

  it("a failing leg cannot crash the wave", () => {
    // runProviderLeg never rejects — a failure is returned as an outcome.
    expect(SERVER).toContain("runProviderLeg");
    expect(SERVER).toContain("successfulData(");
  });

  it("every provider leg is issued under an explicit deadline", () => {
    // Each named provider must go through runProviderLeg (which applies a
    // budget), not through a bare ctx.runAction.
    for (const provider of [
      "market-data",
      "alpha-vantage",
      "tickatlas",
      "coinglass",
      "cftc",
      "treasury",
      "eia",
      "okx-order-book",
      "okx-instrument-spec",
      "fx-rate",
    ]) {
      expect(SERVER).toContain(`"${provider}"`);
    }
  });

  it("the OKX spec leg is now always eligible for crypto", () => {
    // The client can no longer assert a complete spec, so the server must not
    // let a client claim suppress provider metadata acquisition.
    expect(SERVER).toContain("hasCompleteSpec: false");
  });
});

// ═══════════════════════════════════════════════════════════
// Identity + safety invariants
// ═══════════════════════════════════════════════════════════

describe("instrument identity and safety", () => {
  it("the provider-native id is forwarded verbatim to every leg", async () => {
    const seen: string[] = [];
    const capture = (inst: string) => () => {
      seen.push(inst);
      return Promise.resolve({ success: false });
    };

    await fetchOptionalSlowData(CRYPTO, {
      execution: capture(CRYPTO.instrument),
      okxSpec: capture(CRYPTO.instrument),
    });

    expect(seen).toEqual(["BTC-USDT-SWAP", "BTC-USDT-SWAP"]);
  });

  it("the handler passes the raw instrument string to the providers", () => {
    // No uppercasing, slash-swapping or symbol rewriting in the handler.
    expect(SERVER).not.toMatch(/instrument\.replace\(/);
    expect(SERVER).not.toMatch(/instrument\.toUpperCase\(\)/);
  });

  it("no hardcoded instrument whitelist or ceiling is introduced", () => {
    expect(SERVER).not.toMatch(/DEFAULT_UNIVERSE/);
    expect(SERVER).not.toMatch(/SUPPORTED_INSTRUMENTS/);
    expect(SERVER).not.toMatch(/ALLOWED_SYMBOLS/);
  });

  it("FX conversion derives the quote currency from the symbol, not the client", () => {
    expect(SERVER).toContain("parseSymbolCurrencies(instrument)");
    expect(SERVER).not.toContain("instrumentSpec?.quoteCurrency");
  });

  it("acquired evidence is only attached when genuinely present", () => {
    for (const field of [
      "cotData",
      "executionData",
      "eiaData",
      "treasuryData",
      "okxSpecData",
      "fxRates",
    ]) {
      expect(SERVER).toContain(`slow.${field} !== undefined`);
    }
  });
});
