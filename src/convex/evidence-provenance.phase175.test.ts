/**
 * Phase 175 — evidence provenance.
 *
 * ## The finding
 *
 * Phase 174 moved the engine server-side, which closed the *entitlement* hole.
 * It did not close an *integrity* hole: `runProtectedAnalysis` accepted the
 * whole `AnalysisInput` from the client, including provider-backed evidence.
 *
 * Demonstrated against the engine before the fix (using this repo's own
 * proven LONG fixture from `analysis-engine.phase3b.test.ts`):
 *
 *   | Tamper                                   | Result                                    |
 *   | ---------------------------------------- | ----------------------------------------- |
 *   | honest data                              | LONG, entry 100, SL 95, TP 110            |
 *   | flip structure HH/HL -> LH/LL            | verdict reverses (bias Bullish -> Bearish)|
 *   | invent price 99999 the provider never gave| LONG with entry 99999                     |
 *   | relabel `provider` as "okx"              | result reports `dataSource: "okx"`        |
 *   | back-date candles 30d, keep "realtime"   | `dataCompleteness: "full"`, no stale flag |
 *
 * That breaks live-data integrity (fabricated evidence, historical presented
 * as live, provider identity forged) even though entitlement was enforced.
 *
 * ## The fix under test
 *
 * The server strips every provider-backed field from the client input and
 * re-acquires the decisive evidence itself. These tests pin that contract.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  stripClientEvidence,
  CLIENT_UNTRUSTED_EVIDENCE_FIELDS,
  CLIENT_TRUSTED_INPUT_FIELDS,
} from "./protectedAnalysis";

const SERVER = readFileSync("src/convex/protectedAnalysis.ts", "utf8");

/** A client payload carrying forged provider evidence of every kind. */
function maliciousInput() {
  return {
    // legitimate intent
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "H4",
    tradingStyle: "intraday",
    accountEquity: 10_000,
    riskPercent: 0.01,
    accountCurrency: "USD",

    // forged provider evidence
    marketData: {
      instrument: "EUR/USD",
      provider: "okx",
      fetchTimestamp: Date.now(),
      price: { price: 99_999, timestamp: Date.now(), source: "okx" },
      candles: [{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
      dataFreshness: "realtime",
    },
    technicalData: { structure: "LH/LL", bosDirection: "bearish", swingHighs: [1] },
    sentimentData: { label: "Bullish", averageScore: 1 },
    fundamentalData: { eps: 999 },
    macroData: { summary: "forged" },
    derivativesData: { fundingRate: 1 },
    calendarData: { macroRisk: { level: "low" } },
    treasuryData: { available: true },
    cotData: { available: true },
    eiaData: { available: true },
    executionData: { spread: 0 },
    okxSpecData: { contractSize: 1 },
    cryptoIntelligenceContext: { forged: true },
    universalIntelligenceContext: { forged: true },
    fxRates: { direct: { rate: 999 } },
    currentPrice: "99999",
    recentHigh: "99999",
    recentLow: "0",
    fundingRate: "1",
    openInterest: "1",
  } as Record<string, unknown>;
}

describe("the two field lists are coherent", () => {
  it("no field is both trusted and untrusted", () => {
    const overlap = CLIENT_TRUSTED_INPUT_FIELDS.filter((f) =>
      (CLIENT_UNTRUSTED_EVIDENCE_FIELDS as readonly string[]).includes(f),
    );
    expect(overlap).toEqual([]);
  });

  it("every provider-backed field on AnalysisInput is listed untrusted", () => {
    // Guard against a new provider payload silently becoming trusted.
    const analysisTypes = readFileSync("src/types/analysis.ts", "utf8");
    const interfaceBlock = analysisTypes.slice(
      analysisTypes.indexOf("export interface AnalysisInput"),
    );
    const body = interfaceBlock.slice(0, interfaceBlock.indexOf("\n}"));

    const providerish = [
      "marketData",
      "technicalData",
      "sentimentData",
      "fundamentalData",
      "macroData",
      "derivativesData",
      "calendarData",
      "treasuryData",
      "cotData",
      "eiaData",
      "executionData",
      "okxSpecData",
      "cryptoIntelligenceContext",
      "universalIntelligenceContext",
      "fxRates",
    ];

    for (const field of providerish) {
      expect(body).toContain(`${field}?:`);
      expect(CLIENT_UNTRUSTED_EVIDENCE_FIELDS).toContain(field);
    }
  });
});

describe("client-supplied provider evidence is discarded", () => {
  it.each(CLIENT_UNTRUSTED_EVIDENCE_FIELDS)("strips %s", (field) => {
    const clean = stripClientEvidence(maliciousInput());
    expect(clean[field]).toBeUndefined();
  });

  it("keeps legitimate intent fields", () => {
    const clean = stripClientEvidence(maliciousInput());

    expect(clean.instrument).toBe("EUR/USD");
    expect(clean.instrumentType).toBe("forex");
    expect(clean.timeframe).toBe("H4");
    expect(clean.tradingStyle).toBe("intraday");
  });

  it("keeps the user's own risk inputs — those are not provider evidence", () => {
    const clean = stripClientEvidence(maliciousInput());

    expect(clean.accountEquity).toBe(10_000);
    expect(clean.riskPercent).toBe(0.01);
    expect(clean.accountCurrency).toBe("USD");
  });

  it("preserves provider-native identity exactly, with no substitution", () => {
    const clean = stripClientEvidence({
      instrument: "BTC-USDT-SWAP",
      instrumentType: "crypto",
      timeframe: "1h",
    });

    // The instrument string must survive byte-for-byte.
    expect(clean.instrument).toBe("BTC-USDT-SWAP");
  });

  it("is allowlist-based: an unknown future field is NOT trusted", () => {
    const clean = stripClientEvidence({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      someFutureProviderPayload: { price: 1 },
    });

    expect(clean.someFutureProviderPayload).toBeUndefined();
  });

  it("drops the forged price, structure, provider name and freshness together", () => {
    const clean = stripClientEvidence(maliciousInput());
    const wire = JSON.stringify(clean);

    expect(wire).not.toContain("99999");
    expect(wire).not.toContain("LH/LL");
    expect(wire).not.toContain("okx");
    expect(wire).not.toContain("realtime");
  });

  it("returns a new object rather than mutating the caller's", () => {
    const original = maliciousInput();
    stripClientEvidence(original);
    expect(original.marketData).toBeDefined();
  });
});

describe("the server acquires evidence itself", () => {
  it("strips client evidence before running the engine", () => {
    const stripAt = SERVER.indexOf("stripClientEvidence(rawInput)");
    const engineAt = SERVER.indexOf("runAnalysis(trustedInput");

    expect(stripAt).toBeGreaterThan(-1);
    expect(engineAt).toBeGreaterThan(stripAt);
  });

  it("re-acquires market data server-side", () => {
    expect(SERVER).toContain("api.marketData.fetchMarketData");
  });

  it("passes the instrument through unchanged to the provider", () => {
    // No canonicalisation, no symbol rewriting.
    const idx = SERVER.indexOf("api.marketData.fetchMarketData");
    const block = SERVER.slice(idx, idx + 400);

    expect(block).toContain("instrument,");
    expect(block).not.toMatch(/instrument:\s*(canonical|normalize|map)/i);
  });

  it("feeds the ENGINE only the server-acquired payload", () => {
    // trustedInput.marketData is assigned from the acquisition result.
    expect(SERVER).toMatch(/trustedInput\.marketData\s*=\s*acquired\.data/);
    expect(SERVER).toMatch(/trustedInput\.technicalData\s*=\s*acquired\.technical/);
  });

  it("never assigns marketData from the raw client input", () => {
    expect(SERVER).not.toMatch(/trustedInput\.marketData\s*=\s*rawInput/);
    expect(SERVER).not.toMatch(/marketData:\s*args\.input/);
  });

  it("degrades explicitly when acquisition fails — never fabricates", () => {
    // The assignment is guarded by success; there is no synthetic fallback.
    // Phase 177 replaced the raw `if (acquired.success)` guard with an
    // outcome-based guard: `successfulData()` returns undefined for any
    // non-success outcome, and the attachment is gated on the payload being
    // genuinely present. The property is unchanged — evidence is attached
    // only when the provider really returned it.
    expect(SERVER).toContain("successfulData(");
    expect(SERVER).toContain("if (acquired?.data !== undefined)");

    expect(SERVER).not.toMatch(/candles:\s*\[\s*\]\s*,?\s*\/\/\s*fallback/i);
    expect(SERVER).not.toMatch(/price:\s*0\b/);
  });

  it("rejects an input with no instrument identifiers", () => {
    expect(SERVER).toContain('status: "INVALID_INPUT"');
  });
});

describe("entitlement ordering is unchanged by the provenance work", () => {
  it("the engine still runs before chargeability is derived", () => {
    const engineAt = SERVER.indexOf("runAnalysis(trustedInput");
    const chargeAt = SERVER.indexOf("const chargeable");
    expect(chargeAt).toBeGreaterThan(engineAt);
  });

  it("consumption still precedes gating", () => {
    const consumeAt = SERVER.indexOf("resolveAndConsume,");
    const gateAt = SERVER.indexOf("gateDecision({");
    expect(gateAt).toBeGreaterThan(consumeAt);
  });

  it("unauthenticated callers still return before any acquisition", () => {
    const guardAt = SERVER.indexOf('status: "UNAUTHENTICATED"');
    const acquireAt = SERVER.indexOf("api.marketData.fetchMarketData");
    expect(guardAt).toBeLessThan(acquireAt);
  });
});
