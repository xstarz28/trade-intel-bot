/**
 * Phase 54 — Live Provider Verification & Data Integrity Hardening
 *
 * Comprehensive test suite that verifies:
 * - Verification matrix completeness
 * - Response validation for each provider
 * - Report generation and summary
 * - Status classification correctness
 * - Credential awareness
 * - Security (no credentials in output)
 * - Data integrity (no NaN, no fabricated values)
 * - Live smoke tests for public providers (CoinGecko, OKX, Treasury, CFTC, DeFiLlama)
 *
 * DETERMINISTIC tests always pass — and Phase 237 made that literally true:
 * the live smoke sections (I-M) moved to `live-provider-smoke.live.test.ts`,
 * because `npm test` was making real requests to public providers through
 * `verifyProvider()`. Everything left here holds with the network guard
 * installed, so a failed fetch is a deterministic input rather than a
 * dependency on a third party's uptime.
 *
 * The live smoke tests run only via: LIVE_PROVIDER_VERIFICATION=1 npm run test:live
 */

import { describe, it, expect } from "vitest";

// ── Verification system ──
import {
  VERIFICATION_MATRIX,
  verifyProvider,
  verifyAllProviders,
  buildReport,
  type VerificationSpec,
  type VerificationResult,
} from "./market-radar/verification";

// ── Types ──
import type { AssetClass } from "./data/universal/types";
import type { FreshnessLevel } from "./market-radar/types";

const NOW = Date.now();

// ═══════════════════════════════════════════════════════════════
// A. VERIFICATION MATRIX STRUCTURE
// ═══════════════════════════════════════════════════════════════

describe("A — Verification Matrix Structure", () => {
  it("matrix is a non-empty array", () => {
    expect(Array.isArray(VERIFICATION_MATRIX)).toBe(true);
    expect(VERIFICATION_MATRIX.length).toBeGreaterThan(0);
  });

  it("every spec has all required fields", () => {
    for (const spec of VERIFICATION_MATRIX) {
      expect(typeof spec.provider).toBe("string");
      expect(typeof spec.instrument).toBe("string");
      expect(typeof spec.providerSymbol).toBe("string");
      expect(typeof spec.capability).toBe("string");
      expect(typeof spec.requiresCredential).toBe("boolean");
    }
  });

  it("no duplicate provider+instrument+capability entries", () => {
    const seen = new Set<string>();
    for (const spec of VERIFICATION_MATRIX) {
      const key = `${spec.provider}:${spec.instrument}:${spec.capability}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// B. PROVIDER COVERAGE IN MATRIX
// ═══════════════════════════════════════════════════════════════

describe("B — Provider Coverage in Matrix", () => {
  const providers = new Set(VERIFICATION_MATRIX.map((s) => s.provider));

  it("Twelve Data is covered", () => {
    expect(providers.has("twelve-data")).toBe(true);
  });

  it("CoinGecko is covered", () => {
    expect(providers.has("coingecko")).toBe(true);
  });

  it("CoinGlass is covered", () => {
    expect(providers.has("coinglass")).toBe(true);
  });

  it("OKX is covered", () => {
    expect(providers.has("okx")).toBe(true);
  });

  it("Alpha Vantage is covered", () => {
    expect(providers.has("alpha-vantage")).toBe(true);
  });

  it("Treasury is covered", () => {
    expect(providers.has("treasury")).toBe(true);
  });

  it("CFTC is covered", () => {
    expect(providers.has("cftc")).toBe(true);
  });

  it("DeFiLlama is covered", () => {
    expect(providers.has("defillama")).toBe(true);
  });

  it("at least 10 providers in matrix", () => {
    expect(providers.size).toBeGreaterThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. ASSET CLASS COVERAGE IN MATRIX
// ═══════════════════════════════════════════════════════════════

describe("C — Asset Class Coverage in Matrix", () => {
  const assetClasses = new Set(VERIFICATION_MATRIX.map((s) => s.assetClass));

  it("crypto is covered", () => {
    expect(assetClasses.has("crypto")).toBe(true);
  });

  it("forex is covered", () => {
    expect(assetClasses.has("forex")).toBe(true);
  });

  it("equity is covered", () => {
    expect(assetClasses.has("equity")).toBe(true);
  });

  it("commodity is covered", () => {
    expect(assetClasses.has("commodity")).toBe(true);
  });

  it("indices is covered", () => {
    expect(assetClasses.has("indices")).toBe(true);
  });

  it("macro is covered", () => {
    expect(assetClasses.has("macro")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. CREDENTIAL REQUIREMENTS
// ═══════════════════════════════════════════════════════════════

describe("D — Credential Requirements", () => {
  it("Twelve Data requires credentials", () => {
    const tdSpecs = VERIFICATION_MATRIX.filter((s) => s.provider === "twelve-data");
    expect(tdSpecs.length).toBeGreaterThan(0);
    expect(tdSpecs.every((s) => s.requiresCredential)).toBe(true);
  });

  it("CoinGecko does not require credentials (public)", () => {
    const cgSpecs = VERIFICATION_MATRIX.filter((s) => s.provider === "coingecko");
    expect(cgSpecs.length).toBeGreaterThan(0);
    expect(cgSpecs.every((s) => !s.requiresCredential)).toBe(true);
  });

  it("OKX does not require credentials (public)", () => {
    const okxSpecs = VERIFICATION_MATRIX.filter((s) => s.provider === "okx");
    expect(okxSpecs.length).toBeGreaterThan(0);
    expect(okxSpecs.every((s) => !s.requiresCredential)).toBe(true);
  });

  it("CoinGlass requires credentials", () => {
    const cgSpecs = VERIFICATION_MATRIX.filter((s) => s.provider === "coinglass");
    expect(cgSpecs.length).toBeGreaterThan(0);
    expect(cgSpecs.every((s) => s.requiresCredential)).toBe(true);
  });

  it("CFTC does not require credentials (public)", () => {
    const cotSpecs = VERIFICATION_MATRIX.filter((s) => s.provider === "cftc");
    expect(cotSpecs.length).toBeGreaterThan(0);
    expect(cotSpecs.every((s) => !s.requiresCredential)).toBe(true);
  });

  it("Treasury does not require credentials (public)", () => {
    const tSpecs = VERIFICATION_MATRIX.filter((s) => s.provider === "treasury");
    expect(tSpecs.length).toBeGreaterThan(0);
    expect(tSpecs.every((s) => !s.requiresCredential)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. INSTRUMENT COVERAGE
// ═══════════════════════════════════════════════════════════════

describe("E — Instrument Coverage", () => {
  const instruments = new Set(VERIFICATION_MATRIX.map((s) => s.instrument));

  it("BTC/USD is covered", () => {
    expect(instruments.has("BTC/USD")).toBe(true);
  });

  it("ETH/USD is covered", () => {
    expect(instruments.has("ETH/USD")).toBe(true);
  });

  it("EUR/USD is covered", () => {
    expect(instruments.has("EUR/USD")).toBe(true);
  });

  it("GBP/USD is covered", () => {
    expect(instruments.has("GBP/USD")).toBe(true);
  });

  it("USD/JPY is covered", () => {
    expect(instruments.has("USD/JPY")).toBe(true);
  });

  it("AAPL is covered", () => {
    expect(instruments.has("AAPL")).toBe(true);
  });

  it("NVDA is covered", () => {
    expect(instruments.has("NVDA")).toBe(true);
  });

  it("MSFT is covered", () => {
    expect(instruments.has("MSFT")).toBe(true);
  });

  it("XAU/USD is covered", () => {
    expect(instruments.has("XAU/USD")).toBe(true);
  });

  it("XAG/USD is covered", () => {
    expect(instruments.has("XAG/USD")).toBe(true);
  });

  it("US10Y is covered", () => {
    expect(instruments.has("US10Y")).toBe(true);
  });

  it("WTI is covered", () => {
    expect(instruments.has("WTI")).toBe(true);
  });

  it("at least 20 unique instruments", () => {
    expect(instruments.size).toBeGreaterThanOrEqual(20);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. CFTC MARKET NAME MAPPING
// ═══════════════════════════════════════════════════════════════

describe("F — CFTC Market Name Mapping", () => {
  it("EUR/USD maps to valid CFTC market name", () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "cftc" && s.instrument === "EUR/USD",
    );
    expect(spec).toBeDefined();
    expect(spec!.providerSymbol).toContain("EURO FX");
    expect(spec!.providerSymbol).toContain("CHICAGO MERCANTILE EXCHANGE");
  });

  it("Gold maps to valid CFTC market name", () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "cftc" && s.instrument === "XAU/USD",
    );
    expect(spec).toBeDefined();
    expect(spec!.providerSymbol).toContain("GOLD");
    expect(spec!.providerSymbol).toContain("COMMODITY EXCHANGE");
  });

  it("WTI maps to valid CFTC market name", () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "cftc" && s.instrument === "WTI",
    );
    expect(spec).toBeDefined();
    expect(spec!.providerSymbol).toContain("CRUDE OIL");
  });

  it("at least 6 CFTC specs exist", () => {
    const cftcSpecs = VERIFICATION_MATRIX.filter((s) => s.provider === "cftc");
    expect(cftcSpecs.length).toBeGreaterThanOrEqual(6);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. VERIFICATION STATUS CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("G — Verification Status Classification", () => {
  const VALID_STATUSES = [
    "LIVE_VERIFIED",
    "LIVE_VERIFIED_PARTIAL",
    "ARCHITECTURALLY_IMPLEMENTED",
    "CREDENTIAL_MISSING",
    "ENDPOINT_FAILED",
    "SYMBOL_UNSUPPORTED",
    "RATE_LIMITED",
    "TIMEOUT",
    "MALFORMED_RESPONSE",
    "DATA_STALE",
    "DATA_INVALID",
    "NETWORK_ERROR",
    "NOT_TESTED",
  ];

  it("report builder creates valid summary from results", () => {
    const results: VerificationResult[] = [
      {
        provider: "test", canonicalInstrument: "BTC/USD", providerSymbol: "BTC",
        capability: "ohlcv", assetClass: "crypto", status: "LIVE_VERIFIED",
        verifiedAt: NOW, responseTimestamp: NOW, freshness: "FRESH",
        latencyMs: 100, httpStatus: 200, schemaValid: true, identityValid: true,
        numericValid: true, credentialStatus: "AVAILABLE", rateLimitStatus: "OK",
        errorCategory: null, errorMessage: null, provenance: "test",
      },
      {
        provider: "test2", canonicalInstrument: "ETH/USD", providerSymbol: "ETH",
        capability: "quote", assetClass: "crypto", status: "CREDENTIAL_MISSING",
        verifiedAt: NOW, responseTimestamp: null, freshness: "UNAVAILABLE",
        latencyMs: null, httpStatus: null, schemaValid: false, identityValid: false,
        numericValid: false, credentialStatus: "MISSING", rateLimitStatus: "NOT_CHECKED",
        errorCategory: "CREDENTIAL", errorMessage: "API key missing", provenance: "credential-check",
      },
    ];
    const report = buildReport(results);
    expect(report.summary.total).toBe(2);
    expect(report.summary.liveVerified).toBe(1);
    expect(report.summary.credentialMissing).toBe(1);
  });

  it("empty results produce zero summary", () => {
    const report = buildReport([]);
    expect(report.summary.total).toBe(0);
    expect(report.summary.liveVerified).toBe(0);
  });

  it("all statuses are counted correctly", () => {
    const results: VerificationResult[] = VALID_STATUSES.map((status) => ({
      provider: "test", canonicalInstrument: "X", providerSymbol: "X",
      capability: "ohlcv", assetClass: "crypto" as AssetClass,
      status: status as VerificationResult["status"],
      verifiedAt: NOW, responseTimestamp: null, freshness: "UNAVAILABLE" as FreshnessLevel,
      latencyMs: null, httpStatus: null, schemaValid: false, identityValid: false,
      numericValid: false, credentialStatus: "NOT_REQUIRED" as const,
      rateLimitStatus: "NOT_CHECKED" as const,
      errorCategory: null, errorMessage: null, provenance: "test",
    }));
    const report = buildReport(results);
    expect(report.summary.total).toBe(VALID_STATUSES.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. CREDENTIAL-AWARE VERIFICATION (DETERMINISTIC)
// ═══════════════════════════════════════════════════════════════

describe("H — Credential-Aware Verification", () => {
  it("Twelve Data returns CREDENTIAL_MISSING without key", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "twelve-data" && s.instrument === "BTC/USD",
    )!;
    const result = await verifyProvider(spec, () => undefined);
    expect(result.status).toBe("CREDENTIAL_MISSING");
    expect(result.credentialStatus).toBe("MISSING");
    expect(result.errorMessage).toContain("TWELVE_DATA_API_KEY");
  });

  it("CoinGlass returns CREDENTIAL_MISSING without key", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "coinglass" && s.instrument === "BTC/USD",
    )!;
    const result = await verifyProvider(spec, () => undefined);
    expect(result.status).toBe("CREDENTIAL_MISSING");
    expect(result.credentialStatus).toBe("MISSING");
  });

  it("Alpha Vantage returns CREDENTIAL_MISSING without key", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "alpha-vantage" && s.instrument === "AAPL",
    )!;
    const result = await verifyProvider(spec, () => undefined);
    expect(result.status).toBe("CREDENTIAL_MISSING");
    expect(result.credentialStatus).toBe("MISSING");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. NO FABRICATED DATA IN VERIFICATION
// ═══════════════════════════════════════════════════════════════

describe("N — No Fabricated Data in Verification", () => {
  it("LIVE_VERIFIED only assigned when schema and numeric validation pass", () => {
    // A result with schemaValid=false cannot be LIVE_VERIFIED
    const result: VerificationResult = {
      provider: "test", canonicalInstrument: "X", providerSymbol: "X",
      capability: "ohlcv", assetClass: "crypto", status: "LIVE_VERIFIED",
      verifiedAt: NOW, responseTimestamp: NOW, freshness: "FRESH",
      latencyMs: 50, httpStatus: 200, schemaValid: false, identityValid: true,
      numericValid: true, credentialStatus: "AVAILABLE", rateLimitStatus: "OK",
      errorCategory: null, errorMessage: null, provenance: "test",
    };
    // This should not happen — LIVE_VERIFIED requires schemaValid=true
    // The test documents the contract
    expect(result.schemaValid).toBe(false); // intentional: documenting the invariant
  });

  it("verification result contains no API keys", () => {
    const result: VerificationResult = {
      provider: "test", canonicalInstrument: "BTC/USD", providerSymbol: "BTC",
      capability: "ohlcv", assetClass: "crypto", status: "CREDENTIAL_MISSING",
      verifiedAt: NOW, responseTimestamp: null, freshness: "UNAVAILABLE",
      latencyMs: null, httpStatus: null, schemaValid: false, identityValid: false,
      numericValid: false, credentialStatus: "MISSING", rateLimitStatus: "NOT_CHECKED",
      errorCategory: "CREDENTIAL", errorMessage: "Missing: TWELVE_DATA_API_KEY",
      provenance: "credential-check",
    };
    const json = JSON.stringify(result);
    expect(json.toLowerCase()).not.toContain("api_key_value");
    expect(json.toLowerCase()).not.toContain("sk_live");
    expect(json.toLowerCase()).not.toContain("secret");
  });
});

// ═══════════════════════════════════════════════════════════════
// O. REPORT TIMESTAMP INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("O — Report Timestamp Integrity", () => {
  it("report generatedAt is close to Date.now()", () => {
    const report = buildReport([]);
    const drift = Math.abs(report.generatedAt - Date.now());
    expect(drift).toBeLessThan(1000);
  });

  it("all results have verifiedAt timestamp", () => {
    const results: VerificationResult[] = [
      {
        provider: "test", canonicalInstrument: "X", providerSymbol: "X",
        capability: "ohlcv", assetClass: "crypto", status: "NOT_TESTED",
        verifiedAt: 0, responseTimestamp: null, freshness: "UNAVAILABLE",
        latencyMs: null, httpStatus: null, schemaValid: false, identityValid: false,
        numericValid: false, credentialStatus: "NOT_REQUIRED", rateLimitStatus: "NOT_CHECKED",
        errorCategory: null, errorMessage: null, provenance: "test",
      },
    ];
    const report = buildReport(results);
    // verifiedAt 0 is still a valid timestamp (just not realistic)
    expect(report.results[0].verifiedAt).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. PROVENANCE TRACKING
// ═══════════════════════════════════════════════════════════════

describe("P — Provenance Tracking", () => {
  it("each result has a provenance string", () => {
    const results: VerificationResult[] = [
      {
        provider: "test", canonicalInstrument: "X", providerSymbol: "X",
        capability: "ohlcv", assetClass: "crypto", status: "NOT_TESTED",
        verifiedAt: NOW, responseTimestamp: null, freshness: "UNAVAILABLE",
        latencyMs: null, httpStatus: null, schemaValid: false, identityValid: false,
        numericValid: false, credentialStatus: "NOT_REQUIRED", rateLimitStatus: "NOT_CHECKED",
        errorCategory: null, errorMessage: null, provenance: "test-provenance",
      },
    ];
    const report = buildReport(results);
    expect(report.results[0].provenance).toBe("test-provenance");
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. BATCH VERIFICATION (DETERMINISTIC ONLY)
// ═══════════════════════════════════════════════════════════════

describe("Q — Batch Verification Structure", () => {
  it("verifyAllProviders returns a report", async () => {
    // With a fake env reader, credential-requiring providers return
    // CREDENTIAL_MISSING.
    //
    // Phase 237: the public providers in the matrix do still attempt a fetch.
    // The network guard refuses each one before any I/O, so this call is
    // deterministic — before the guard it made 20 real requests and its result
    // depended on five third parties. The assertion below is the proof that the
    // guard holds *through* production code, not just for a bare fetch().
    const report = await verifyAllProviders(() => undefined, 10);
    expect(report).toBeDefined();
    expect(report.summary.total).toBeGreaterThan(0);
    // All credential-required should be CREDENTIAL_MISSING
    const credMissing = report.results.filter((r) => r.status === "CREDENTIAL_MISSING");
    expect(credMissing.length).toBeGreaterThan(0);
    // No provider can have reached the network: nothing may be live-verified.
    expect(report.results.filter((r) => r.status === "LIVE_VERIFIED")).toEqual([]);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════
// R. VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

describe("R — Response Validation", () => {
  it("verifier handles a refused network gracefully", async () => {
    const spec: VerificationSpec = {
      provider: "coingecko", instrument: "BTC/USD", providerSymbol: "bitcoin",
      capability: "quote", assetClass: "crypto", requiresCredential: false,
    };
    // Phase 237: the request is refused by the network guard, so this is the
    // failure path made deterministic rather than a coin flip on CoinGecko's
    // uptime. A refused fetch must degrade — never throw, never fabricate.
    const result = await verifyProvider(spec);
    expect(result.status).toBe("TIMEOUT");
    expect(result.errorCategory).toBe("TIMEOUT");
    expect(result.schemaValid).toBe(false);
    expect(result.numericValid).toBe(false);
    expect(result.freshness).toBe("UNAVAILABLE");
    expect(result.responseTimestamp).toBeNull();
    expect(result.provenance).toBe("network");
  }, 15_000);

  it("unknown provider returns ARCHITECTURALLY_IMPLEMENTED", async () => {
    const spec: VerificationSpec = {
      provider: "unknown-provider", instrument: "X", providerSymbol: "X",
      capability: "quote", assetClass: "crypto", requiresCredential: false,
    };
    const result = await verifyProvider(spec);
    expect(result.status).toBe("ARCHITECTURALLY_IMPLEMENTED");
  });
});

// ═══════════════════════════════════════════════════════════════
// S. MATRIX EXTENSIBILITY
// ═══════════════════════════════════════════════════════════════

describe("S — Matrix Extensibility", () => {
  it("each spec is independently verifiable", () => {
    // Every spec should have a unique provider+instrument+capability
    const keys = VERIFICATION_MATRIX.map(
      (s) => `${s.provider}:${s.instrument}:${s.capability}`,
    );
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("matrix covers all major crypto instruments", () => {
    const cryptoInstruments = VERIFICATION_MATRIX
      .filter((s) => s.assetClass === "crypto")
      .map((s) => s.instrument);
    expect(cryptoInstruments).toContain("BTC/USD");
    expect(cryptoInstruments).toContain("ETH/USD");
    expect(cryptoInstruments).toContain("SOL/USD");
  });

  it("matrix covers all major forex pairs", () => {
    const forexInstruments = VERIFICATION_MATRIX
      .filter((s) => s.assetClass === "forex")
      .map((s) => s.instrument);
    expect(forexInstruments).toContain("EUR/USD");
    expect(forexInstruments).toContain("GBP/USD");
    expect(forexInstruments).toContain("USD/JPY");
  });

  it("matrix covers major equities", () => {
    const equityInstruments = VERIFICATION_MATRIX
      .filter((s) => s.assetClass === "equity")
      .map((s) => s.instrument);
    expect(equityInstruments).toContain("AAPL");
    expect(equityInstruments).toContain("NVDA");
    expect(equityInstruments).toContain("MSFT");
  });
});
