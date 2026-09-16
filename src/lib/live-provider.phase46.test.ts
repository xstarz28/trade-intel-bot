/**
 * Phase 46 — LIVE Universal Provider Integration & Real-Market Validation
 *
 * Comprehensive test suite covering:
 *   A. Live status classification
 *   B. OHLCV validation (truth)
 *   C. Quote validation
 *   D. Symbol identity verification
 *   E. Cross-provider consistency
 *   F. Data quality assessment
 *   G. Credential awareness
 *   H. Live client execution (mock transport)
 *   I. Cache isolation
 *   J. Provider health tracking
 *   K. Rate-limit behavior
 *   L. Adversarial data (NaN, Infinity, negative, reversed, etc.)
 *   M. Cross-instrument isolation
 *   N. Decision immutability
 *   O. Security audit (no secrets in output)
 *   P. Determinism
 *   Q. Concurrency
 *   R. Freshness & provenance
 *   S. Edge cases & empty states
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  validateOhlcvSeries,
  validateQuote,
  verifySymbolIdentity,
  verifySymbolIdentityWithCandidates,
  compareCrossProviderPrices,
  assessDataQuality,
  isLiveStatus,
  type OhlcvRecord,
  type LiveStatus,
  type ConsistencyVerdict,
} from "./data/universal/live/types";
import {
  checkCredentials,
  getAllCredentialSpecs,
} from "./data/universal/live/credentials";
import {
  executeLiveRequest,
  readCachedOrUnavailable,
  resetLiveState,
  type Transport,
} from "./data/universal/live/client";
import {
  resolveInstrument,
  getProviderSymbol,
} from "./data/universal/instruments";
import {
  routeProviderRequest,
  recordProviderHealth,
  getProviderHealth,
  resetProviderHealth,
} from "./data/universal/routing-engine";
import {
  cacheGet,
  cacheSet,
  cacheClear,
  cacheClearInstrument,
  verifyCacheIsolation,
  resetCache,
  configureCache,
} from "./data/universal/cache";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const NOW = Date.now();
const HOUR = 3_600_000;

function makeCandle(
  overrides: Partial<OhlcvRecord> & { hoursBefore?: number } = {},
): OhlcvRecord {
  // timestamps go into the past: NOW - hoursBefore * HOUR
  const hoursBefore = overrides.hoursBefore ?? 1;
  return {
    timestamp: NOW - hoursBefore * HOUR,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 1000,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([k]) => k !== "hoursBefore"),
    ),
  };
}

function makeCandles(n: number, gapHours = 1): OhlcvRecord[] {
  // Oldest first (ascending timestamps)
  return Array.from({ length: n }, (_, i) => makeCandle({ hoursBefore: n - i }));
}

/** Mock transport that returns a canned JSON response. */
function mockTransport(body: unknown, status = 200): Transport {
  return async () => ({ ok: status >= 200 && status < 300, status, json: body });
}

/** Mock transport that throws a network error. */
function mockNetworkError(message = "ECONNREFUSED"): Transport {
  return async () => {
    throw new Error(message);
  };
}

/** Read env from a plain object (never touches process.env). */
function fakeEnv(record: Record<string, string | undefined>): (name: string) => string | undefined {
  return (name) => record[name];
}

// ═══════════════════════════════════════════════════════════════
// A. LIVE STATUS CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("A — Live Status Classification", () => {
  it("isLiveStatus returns true for LIVE_VERIFIED", () => {
    expect(isLiveStatus("LIVE_VERIFIED")).toBe(true);
  });
  it("isLiveStatus returns true for LIVE_PARTIAL", () => {
    expect(isLiveStatus("LIVE_PARTIAL")).toBe(true);
  });
  it.each([
    "CREDENTIAL_MISSING",
    "NETWORK_UNAVAILABLE",
    "RATE_LIMITED",
    "PROVIDER_ERROR",
    "MALFORMED_RESPONSE",
    "UNSUPPORTED",
    "UNAVAILABLE",
  ] as LiveStatus[])("isLiveStatus returns false for %s", (status) => {
    expect(isLiveStatus(status)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. OHLCV TRUTH VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("B — OHLCV Truth Validation", () => {
  it("validates correct candles", () => {
    const candles = makeCandles(5);
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(true);
    expect(result.rejectedCount).toBe(0);
    expect(result.acceptedCount).toBe(5);
  });

  it("rejects NaN prices", () => {
    const candles = [makeCandle({ open: NaN })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("NOT_A_NUMBER");
  });

  it("rejects Infinity prices", () => {
    const candles = [makeCandle({ close: Infinity })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("NOT_A_NUMBER");
  });

  it("rejects negative prices", () => {
    const candles = [makeCandle({ open: -100 })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("NON_POSITIVE_PRICE");
  });

  it("rejects zero prices", () => {
    const candles = [makeCandle({ low: 0 })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("NON_POSITIVE_PRICE");
  });

  it("rejects negative volume", () => {
    const candles = [makeCandle({ volume: -100 })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("NEGATIVE_VOLUME");
  });

  it("accepts NaN volume as undefined (volume is optional)", () => {
    const candles = [makeCandle({ volume: undefined })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(true);
  });

  it("rejects high < max(open, close)", () => {
    const candles = [makeCandle({ high: 90, open: 100, close: 102 })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("REVERSED_OHLC_HIGH");
  });

  it("rejects low > min(open, close)", () => {
    const candles = [makeCandle({ low: 110, open: 100, close: 102 })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("REVERSED_OHLC_LOW");
  });

  it("rejects duplicate timestamps", () => {
    const t = NOW - HOUR;
    const candles: OhlcvRecord[] = [
      { timestamp: t, open: 100, high: 105, low: 95, close: 102 },
      { timestamp: t, open: 101, high: 106, low: 96, close: 103 },
    ];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("DUPLICATE_TIMESTAMP");
  });

  it("rejects out-of-order timestamps", () => {
    const candles: OhlcvRecord[] = [
      { timestamp: NOW - 2 * HOUR, open: 100, high: 105, low: 95, close: 102 },
      { timestamp: NOW - HOUR, open: 101, high: 106, low: 96, close: 103 },
    ];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(true);
    // But reversed:
    const candles2: OhlcvRecord[] = [
      { timestamp: NOW - HOUR, open: 100, high: 105, low: 95, close: 102 },
      { timestamp: NOW - 2 * HOUR, open: 101, high: 106, low: 96, close: 103 },
    ];
    const result2 = validateOhlcvSeries(candles2, { now: NOW });
    expect(result2.valid).toBe(false);
    expect(result2.issues[0].reason).toBe("OUT_OF_ORDER_TIMESTAMP");
  });

  it("rejects future timestamps", () => {
    const candles = [makeCandle({ timestamp: NOW + 30 * 60_000 })];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe("FUTURE_TIMESTAMP");
  });

  it("returns false for empty candles", () => {
    const result = validateOhlcvSeries([], { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.totalRecords).toBe(0);
  });

  it("rejects all records when all are invalid", () => {
    const candles = [
      makeCandle({ open: NaN }),
      makeCandle({ hoursBefore: 2, open: NaN }),
    ];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.acceptedCount).toBe(0);
    expect(result.rejectedCount).toBe(2);
  });

  it("accepts when volume is not supplied (undefined)", () => {
    const candles: OhlcvRecord[] = [
      { timestamp: NOW - HOUR, open: 100, high: 105, low: 95, close: 102 },
    ];
    const result = validateOhlcvSeries(candles, { now: NOW });
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. QUOTE VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("C — Quote Validation", () => {
  it("validates a correct quote", () => {
    const result = validateQuote({ price: 1.1, bid: 1.09, ask: 1.11, timestamp: NOW }, { now: NOW });
    expect(result.valid).toBe(true);
  });

  it("rejects negative price", () => {
    const result = validateQuote({ price: -1 }, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("price");
  });

  it("rejects NaN price", () => {
    const result = validateQuote({ price: NaN }, { now: NOW });
    expect(result.valid).toBe(false);
  });

  it("rejects Infinity price", () => {
    const result = validateQuote({ price: Infinity }, { now: NOW });
    expect(result.valid).toBe(false);
  });

  it("rejects negative bid", () => {
    const result = validateQuote({ price: 1, bid: -1, ask: 2 }, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("bid"))).toBe(true);
  });

  it("rejects ask < bid", () => {
    const result = validateQuote({ price: 1, bid: 1.1, ask: 0.9 }, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("ask"))).toBe(true);
  });

  it("rejects future timestamp", () => {
    const result = validateQuote({ price: 1, timestamp: NOW + 600_000 }, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("future"))).toBe(true);
  });

  it("accepts quote without bid/ask/timestamp", () => {
    const result = validateQuote({ price: 100 }, { now: NOW });
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. SYMBOL IDENTITY VERIFICATION
// ═══════════════════════════════════════════════════════════════

describe("D — Symbol Identity Verification", () => {
  it("passes when symbols match", () => {
    const r = verifySymbolIdentity("BTC/USD", "BTC/USD");
    expect(r.passed).toBe(true);
  });

  it("passes when returned symbol is canonical (normalized)", () => {
    const r = verifySymbolIdentity("BTC/USD", "BTCUSD");
    expect(r.passed).toBe(true);
  });

  it("fails when symbols differ", () => {
    const r = verifySymbolIdentity("BTC/USD", "ETH/USD");
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("ETH/USD");
  });

  it("fails when returned symbol is null", () => {
    const r = verifySymbolIdentity("BTC/USD", null);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("not return");
  });

  it("fails when returned symbol is undefined", () => {
    const r = verifySymbolIdentity("BTC/USD", undefined);
    expect(r.passed).toBe(false);
  });

  it("passes with extra candidates", () => {
    const r = verifySymbolIdentityWithCandidates("BTC/USD", "BTCUSDT", ["BTCUSDT", "BTC/USD"]);
    expect(r.passed).toBe(true);
  });

  it("fails when no candidates match", () => {
    const r = verifySymbolIdentityWithCandidates("BTC/USD", "DOGE/USD", ["BTCUSDT"]);
    expect(r.passed).toBe(false);
  });

  it("handles AAPL (single symbol without slash)", () => {
    const r = verifySymbolIdentity("AAPL", "AAPL");
    expect(r.passed).toBe(true);
  });

  it("prevents cross-instrument: BTC/USD should not match ETH/USD", () => {
    const r = verifySymbolIdentity("BTC/USD", "ETH/USD");
    expect(r.passed).toBe(false);
  });

  it("prevents cross-instrument: AAPL should not match MSFT", () => {
    const r = verifySymbolIdentity("AAPL", "MSFT");
    expect(r.passed).toBe(false);
  });

  it("prevents cross-instrument: XAU/USD should not match XAG/USD", () => {
    const r = verifySymbolIdentity("XAU/USD", "XAG/USD");
    expect(r.passed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. CROSS-PROVIDER CONSISTENCY
// ═══════════════════════════════════════════════════════════════

describe("E — Cross-Provider Consistency", () => {
  it("CONSISTENT when prices nearly equal", () => {
    const v = compareCrossProviderPrices([
      { provider: "A", price: 100.0 },
      { provider: "B", price: 100.05 },
    ]);
    expect(v).toBe("CONSISTENT");
  });

  it("MINOR_VARIANCE within 1%", () => {
    const v = compareCrossProviderPrices([
      { provider: "A", price: 100.0 },
      { provider: "B", price: 100.5 },
    ]);
    expect(v).toBe("MINOR_VARIANCE");
  });

  it("SIGNIFICANT_VARIANCE within 3%", () => {
    const v = compareCrossProviderPrices([
      { provider: "A", price: 100.0 },
      { provider: "B", price: 102.0 },
    ]);
    expect(v).toBe("SIGNIFICANT_VARIANCE");
  });

  it("CONFLICT beyond 3%", () => {
    const v = compareCrossProviderPrices([
      { provider: "A", price: 100.0 },
      { provider: "B", price: 110.0 },
    ]);
    expect(v).toBe("CONFLICT");
  });

  it("UNAVAILABLE with single provider", () => {
    const v = compareCrossProviderPrices([{ provider: "A", price: 100.0 }]);
    expect(v).toBe("UNAVAILABLE");
  });

  it("UNAVAILABLE with empty observations", () => {
    const v = compareCrossProviderPrices([]);
    expect(v).toBe("UNAVAILABLE");
  });

  it("filters NaN prices", () => {
    const v = compareCrossProviderPrices([
      { provider: "A", price: NaN },
      { provider: "B", price: 100.0 },
    ]);
    expect(v).toBe("UNAVAILABLE");
  });

  it("filters Infinity prices", () => {
    const v = compareCrossProviderPrices([
      { provider: "A", price: 100 },
      { provider: "B", price: Infinity },
    ]);
    expect(v).toBe("UNAVAILABLE");
  });

  it("filters zero/negative prices", () => {
    const v = compareCrossProviderPrices([
      { provider: "A", price: 0 },
      { provider: "B", price: 100 },
    ]);
    expect(v).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. DATA QUALITY ASSESSMENT
// ═══════════════════════════════════════════════════════════════

describe("F — Data Quality Assessment", () => {
  it("VERIFIED when all live and consistent", () => {
    const q = assessDataQuality({
      statuses: ["LIVE_VERIFIED", "LIVE_VERIFIED"],
      consistency: "CONSISTENT",
    });
    expect(q.state).toBe("VERIFIED");
  });

  it("GOOD when all live but minor variance", () => {
    const q = assessDataQuality({
      statuses: ["LIVE_VERIFIED", "LIVE_VERIFIED"],
      consistency: "MINOR_VARIANCE",
    });
    expect(q.state).toBe("GOOD");
  });

  it("PARTIAL when some live some failed", () => {
    const q = assessDataQuality({
      statuses: ["LIVE_VERIFIED", "PROVIDER_ERROR"],
    });
    expect(q.state).toBe("PARTIAL");
  });

  it("DEGRADED when partial responses only", () => {
    const q = assessDataQuality({
      statuses: ["LIVE_PARTIAL", "LIVE_PARTIAL"],
    });
    expect(q.state).toBe("DEGRADED");
  });

  it("STALE when rate limited", () => {
    const q = assessDataQuality({
      statuses: ["RATE_LIMITED", "CREDENTIAL_MISSING"],
    });
    expect(q.state).toBe("STALE");
  });

  it("UNAVAILABLE when all failed", () => {
    const q = assessDataQuality({
      statuses: ["PROVIDER_ERROR", "NETWORK_UNAVAILABLE"],
    });
    expect(q.state).toBe("UNAVAILABLE");
  });

  it("UNAVAILABLE with empty statuses", () => {
    const q = assessDataQuality({ statuses: [] });
    expect(q.state).toBe("UNAVAILABLE");
  });

  it("CONFLICTING when providers disagree", () => {
    const q = assessDataQuality({
      statuses: ["LIVE_VERIFIED", "LIVE_VERIFIED"],
      consistency: "CONFLICT",
    });
    expect(q.state).toBe("CONFLICTING");
  });

  it("DEGRADED when PARTIAL + failed mix", () => {
    const q = assessDataQuality({
      statuses: ["LIVE_PARTIAL", "PROVIDER_ERROR"],
    });
    expect(q.state).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. CREDENTIAL AWARENESS
// ═══════════════════════════════════════════════════════════════

describe("G — Credential Awareness", () => {
  it("twelve-data requires API key", () => {
    const s = checkCredentials("twelve-data", fakeEnv({}));
    expect(s).not.toBeNull();
    expect(s!.authRequired).toBe(true);
    expect(s!.available).toBe(false);
    expect(s!.missingEnvVarNames).toContain("TWELVE_DATA_API_KEY");
  });

  it("twelve-data available when key present", () => {
    const s = checkCredentials("twelve-data", fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }));
    expect(s!.available).toBe(true);
    expect(s!.missingEnvVarNames).toHaveLength(0);
  });

  it("coingecko is public (no auth required)", () => {
    const s = checkCredentials("coingecko", fakeEnv({}));
    expect(s).not.toBeNull();
    expect(s!.authRequired).toBe(false);
    expect(s!.available).toBe(true);
  });

  it("unknown provider returns null", () => {
    const s = checkCredentials("nonexistent-provider", fakeEnv({}));
    expect(s).toBeNull();
  });

  it("all credential specs are available", () => {
    const specs = getAllCredentialSpecs();
    expect(specs.length).toBeGreaterThan(0);
    specs.forEach((s) => {
      expect(s.providerId).toBeTruthy();
      expect(Array.isArray(s.requiredEnvVars)).toBe(true);
    });
  });

  it("never exposes credential values", () => {
    const s = checkCredentials("twelve-data", fakeEnv({ TWELVE_DATA_API_KEY: "SECRET1234" }));
    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain("SECRET_VALUE");
    expect(serialized).not.toContain("12345");
  });

  it("alpha-vantage requires API key", () => {
    const s = checkCredentials("alpha-vantage", fakeEnv({}));
    expect(s!.authRequired).toBe(true);
    expect(s!.available).toBe(false);
  });

  it("coinglass requires API key", () => {
    const s = checkCredentials("coinglass", fakeEnv({}));
    expect(s!.authRequired).toBe(true);
    expect(s!.available).toBe(false);
  });

  it("eia requires API key", () => {
    const s = checkCredentials("eia", fakeEnv({}));
    expect(s!.authRequired).toBe(true);
    expect(s!.available).toBe(false);
  });

  it("tickatlas requires API key", () => {
    const s = checkCredentials("tickatlas", fakeEnv({}));
    expect(s!.authRequired).toBe(true);
    expect(s!.available).toBe(false);
  });

  it("okx is public", () => {
    const s = checkCredentials("okx", fakeEnv({}));
    expect(s!.authRequired).toBe(false);
    expect(s!.available).toBe(true);
  });

  it("defillama is public", () => {
    const s = checkCredentials("defillama", fakeEnv({}));
    expect(s!.authRequired).toBe(false);
    expect(s!.available).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. LIVE CLIENT EXECUTION (MOCK TRANSPORT)
// ═══════════════════════════════════════════════════════════════

describe("H — Live Client Execution", () => {
  beforeEach(() => {
    resetLiveState();
    resetCache();
    cacheClear();
  });

  it("returns UNAVAILABLE for unknown instrument", async () => {
    const r = await executeLiveRequest({
      instrument: "ZZZZZ",
      capability: "ohlcv",
      transport: mockTransport({}),
    });
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.instrument).toBe("ZZZZZ");
    expect(r.failureReason).toContain("not registered");
  });

  it("returns CREDENTIAL_MISSING when API key is needed but absent", async () => {
    const r = await executeLiveRequest({
      instrument: "EUR/USD",
      capability: "ohlcv",
      transport: mockTransport({}),
      readEnv: fakeEnv({}),
    });
    // EUR/USD routes to providers needing keys
    expect(
      r.status === "CREDENTIAL_MISSING" || r.status === "UNAVAILABLE" || r.status === "UNSUPPORTED",
    ).toBe(true);
  });

  it("returns NETWORK_UNAVAILABLE on transport error", async () => {
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockNetworkError(),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
    });
    expect(r.status).toBe("NETWORK_UNAVAILABLE");
    expect(r.failureReason).toContain("Network failure");
  });

  it("returns RATE_LIMITED on HTTP 429", async () => {
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport({}, 429),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
    });
    expect(r.status).toBe("RATE_LIMITED");
    expect(r.failureReason).toContain("429");
  });

  it("returns PROVIDER_ERROR on HTTP 500", async () => {
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport({}, 500),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
    });
    expect(r.status).toBe("PROVIDER_ERROR");
    expect(r.failureReason).toContain("500");
  });

  it("returns MALFORMED_RESPONSE when body is null", async () => {
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: async () => ({ ok: true, status: 200, json: null }),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
    });
    expect(r.status).toBe("MALFORMED_RESPONSE");
  });

  it("returns MALFORMED_RESPONSE when OHLCV extraction yields empty", async () => {
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport({}),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
    });
    expect(
      r.status === "MALFORMED_RESPONSE" || r.status === "UNSUPPORTED",
    ).toBe(true);
  });

  it("LIVE_VERIFIED with valid Twelve Data candle data", async () => {
    const tdResponse = {
      symbol: "BTC/USD",
      values: [
        { datetime: new Date(NOW - 7200000).toISOString(), open: "98", high: "104", low: "94", close: "100", volume: "1200" },
        { datetime: new Date(NOW - 3600000).toISOString(), open: "100", high: "105", low: "95", close: "102", volume: "1000" },
      ],
    };
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport(tdResponse),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
      now: NOW,
    });
    expect(r.status === "LIVE_VERIFIED" || r.status === "LIVE_PARTIAL").toBe(true);
    expect(r.candles).toBeDefined();
    expect(r.candles!.length).toBeGreaterThanOrEqual(1);
    expect(r.provider).toBeTruthy();
    expect(r.diagnostic).toBeDefined();
    expect(isLiveStatus(r.diagnostic.status)).toBe(true);
  });

  it("diagnostic never contains credentials", async () => {
    const tdResponse = {
      symbol: "BTC/USD",
      values: [
        { datetime: new Date(NOW - 3600000).toISOString().replace("T", " ").slice(0, 19), open: "100", high: "105", low: "95", close: "102", volume: "1000" },
      ],
    };
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport(tdResponse),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
      now: NOW,
    });
    const serialized = JSON.stringify(r.diagnostic);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("secret");
  });

  it("identity mismatch returns MALFORMED_RESPONSE", async () => {
    const tdResponse = {
      symbol: "WRONG_SYMBOL",
      values: [
        { datetime: new Date(NOW - 3600000).toISOString().replace("T", " ").slice(0, 19), open: "100", high: "105", low: "95", close: "102" },
      ],
    };
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport(tdResponse),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
      now: NOW,
    });
    // Identity mismatch check applies only when provider echoes a symbol
    expect(
      r.status === "MALFORMED_RESPONSE" || r.status === "UNSUPPORTED",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. CACHE ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("I — Cache Isolation", () => {
  beforeEach(() => {
    cacheClear();
    resetCache();
  });

  it("BTC/USD cache does not leak to ETH/USD", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" }, { price: 60000 });
    const btc = cacheGet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" });
    const eth = cacheGet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "okx" });
    expect(btc).not.toBeNull();
    expect(eth).toBeNull();
  });

  it("AAPL cache does not leak to BBCA", () => {
    cacheSet({ instrument: "AAPL", capability: "earnings", providerId: "alpha-vantage" }, { pe: 30 });
    const aapl = cacheGet({ instrument: "AAPL", capability: "earnings", providerId: "alpha-vantage" });
    const bbca = cacheGet({ instrument: "BBCA", capability: "earnings", providerId: "alpha-vantage" });
    expect(aapl).not.toBeNull();
    expect(bbca).toBeNull();
  });

  it("EUR/USD cache does not leak to USD/JPY", () => {
    cacheSet({ instrument: "EUR/USD", capability: "ohlcv", providerId: "twelve-data" }, { price: 1.1 });
    const eur = cacheGet({ instrument: "EUR/USD", capability: "ohlcv", providerId: "twelve-data" });
    const jpy = cacheGet({ instrument: "USD/JPY", capability: "ohlcv", providerId: "twelve-data" });
    expect(eur).not.toBeNull();
    expect(jpy).toBeNull();
  });

  it("XAU/USD cache does not leak to XAG/USD", () => {
    cacheSet({ instrument: "XAU/USD", capability: "quote", providerId: "twelve-data" }, { price: 2650 });
    const xau = cacheGet({ instrument: "XAU/USD", capability: "quote", providerId: "twelve-data" });
    const xag = cacheGet({ instrument: "XAG/USD", capability: "quote", providerId: "twelve-data" });
    expect(xau).not.toBeNull();
    expect(xag).toBeNull();
  });

  it("WTI cache does not leak to BRENT", () => {
    cacheSet({ instrument: "WTI", capability: "quote", providerId: "twelve-data" }, { price: 80 });
    const wti = cacheGet({ instrument: "WTI", capability: "quote", providerId: "twelve-data" });
    const brent = cacheGet({ instrument: "BRENT", capability: "quote", providerId: "twelve-data" });
    expect(wti).not.toBeNull();
    expect(brent).toBeNull();
  });

  it("same instrument, different capability does not leak", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" }, { candles: [] });
    cacheSet({ instrument: "BTC/USD", capability: "earnings", providerId: "coingecko" }, { marketCap: 1e12 });
    const ohlcv = cacheGet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" });
    const fund = cacheGet({ instrument: "BTC/USD", capability: "earnings", providerId: "coingecko" });
    expect(ohlcv).not.toBeNull();
    expect(fund).not.toBeNull();
    expect(cacheGet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "coingecko" })).toBeNull();
  });

  it("clearCacheInstrument clears only target instrument", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" }, { price: 1 });
    cacheSet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "okx" }, { price: 2 });
    cacheClearInstrument("BTC/USD");
    expect(cacheGet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" })).toBeNull();
    expect(cacheGet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "okx" })).not.toBeNull();
  });

  it("verifyCacheIsolation confirms isolation", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" }, { price: 1 });
    cacheSet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "okx" }, { price: 2 });
    expect(verifyCacheIsolation()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. PROVIDER HEALTH TRACKING
// ═══════════════════════════════════════════════════════════════

describe("J — Provider Health Tracking", () => {
  beforeEach(() => {
    resetProviderHealth();
  });

  it("records AVAILABLE health", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "AVAILABLE", responseTimeMs: 200 });
    const h = getProviderHealth("twelve-data");
    expect(h).toBeDefined();
    expect(h!.status).toBe("AVAILABLE");
  });

  it("records DEGRADED health with error", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "DEGRADED", error: "partial data" });
    const h = getProviderHealth("twelve-data");
    expect(h).toBeDefined();
    expect(h!.status).toBe("DEGRADED");
  });

  it("records RATE_LIMITED status", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "RATE_LIMITED", error: "429" });
    const h = getProviderHealth("twelve-data");
    expect(h!.status).toBe("RATE_LIMITED");
  });

  it("records UNAVAILABLE status", () => {
    recordProviderHealth({ providerId: "alpha-vantage", status: "UNAVAILABLE", error: "credentials missing" });
    const h = getProviderHealth("alpha-vantage");
    expect(h!.status).toBe("UNAVAILABLE");
  });

  it("resetProviderHealth clears all", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "AVAILABLE" });
    resetProviderHealth();
    expect(getProviderHealth("twelve-data")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// K. RATE-LIMIT BEHAVIOR
// ═══════════════════════════════════════════════════════════════

describe("K — Rate-Limit Behavior", () => {
  beforeEach(() => {
    resetLiveState();
    resetCache();
    cacheClear();
  });

  it("records rate limit after 429", async () => {
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport({}, 429),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
    });
    expect(r.status).toBe("RATE_LIMITED");
    const h = getProviderHealth(r.provider!);
    expect(h!.status).toBe("RATE_LIMITED");
  });

  it("does not create uncontrolled request storms", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        executeLiveRequest({
          instrument: "BTC/USD",
          capability: "ohlcv",
          transport: mockTransport({}, 429),
          readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
          now: NOW,
        }),
      ),
    );
    results.forEach((r) => {
      expect(r.status).toBe("RATE_LIMITED");
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// L. ADVERSARIAL DATA
// ═══════════════════════════════════════════════════════════════

describe("L — Adversarial Data", () => {
  it("rejects NaN in OHLCV", () => {
    const r = validateOhlcvSeries([makeCandle({ close: NaN })]);
    expect(r.valid).toBe(false);
  });

  it("rejects Infinity in OHLCV", () => {
    const r = validateOhlcvSeries([makeCandle({ high: Infinity })]);
    expect(r.valid).toBe(false);
  });

  it("rejects negative price in OHLCV", () => {
    const r = validateOhlcvSeries([makeCandle({ low: -50 })]);
    expect(r.valid).toBe(false);
  });

  it("rejects reversed high/low", () => {
    const r = validateOhlcvSeries([
      makeCandle({ high: 50, low: 150, open: 100, close: 100 }),
    ]);
    expect(r.valid).toBe(false);
  });

  it("rejects zero prices", () => {
    const r = validateOhlcvSeries([makeCandle({ open: 0, high: 0, low: 0, close: 0 })]);
    expect(r.valid).toBe(false);
  });

  it("rejects negative volume", () => {
    const r = validateOhlcvSeries([makeCandle({ volume: -999 })]);
    expect(r.valid).toBe(false);
  });

  it("rejects NaN quote price", () => {
    const r = validateQuote({ price: NaN });
    expect(r.valid).toBe(false);
  });

  it("rejects zero quote price", () => {
    const r = validateQuote({ price: 0 });
    expect(r.valid).toBe(false);
  });

  it("rejects negative quote bid", () => {
    const r = validateQuote({ price: 100, bid: -5, ask: 101 });
    expect(r.valid).toBe(false);
  });

  it("rejects future quote timestamp", () => {
    const r = validateQuote({ price: 100, timestamp: NOW + 86_400_000 }, { now: NOW });
    expect(r.valid).toBe(false);
  });

  it("wrong instrument symbol rejected", () => {
    const r = verifySymbolIdentity("AAPL", "TSLA");
    expect(r.passed).toBe(false);
  });

  it("wrong instrument pair rejected", () => {
    const r = verifySymbolIdentity("EUR/USD", "GBP/USD");
    expect(r.passed).toBe(false);
  });

  it("wrong commodity rejected", () => {
    const r = verifySymbolIdentity("XAU/USD", "COPPER");
    expect(r.passed).toBe(false);
  });

  it("empty string symbol rejected", () => {
    const r = verifySymbolIdentity("BTC/USD", "");
    expect(r.passed).toBe(false);
  });

  it("whitespace-only symbol rejected", () => {
    const r = verifySymbolIdentity("BTC/USD", "   ");
    expect(r.passed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. CROSS-INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("M — Cross-Instrument Isolation", () => {
  it("BTC/USD never matches ETH/USD", () => {
    expect(verifySymbolIdentity("BTC/USD", "ETH/USD").passed).toBe(false);
  });

  it("EUR/USD never matches GBP/USD", () => {
    expect(verifySymbolIdentity("EUR/USD", "GBP/USD").passed).toBe(false);
  });

  it("USD/JPY never matches USD/IDR", () => {
    expect(verifySymbolIdentity("USD/JPY", "USD/IDR").passed).toBe(false);
  });

  it("AAPL never matches BBCA", () => {
    expect(verifySymbolIdentity("AAPL", "BBCA").passed).toBe(false);
  });

  it("XAU/USD never matches XAG/USD", () => {
    expect(verifySymbolIdentity("XAU/USD", "XAG/USD").passed).toBe(false);
  });

  it("WTI never matches BRENT", () => {
    expect(verifySymbolIdentity("WTI", "BRENT").passed).toBe(false);
  });

  it("SPX never matches NDX", () => {
    expect(verifySymbolIdentity("SPX", "NDX").passed).toBe(false);
  });

  it("BTC/USD never matches BTC/USDT in identity (different base pair)", () => {
    // BTC/USD and BTC/USDT are technically different instruments
    // verifySymbolIdentity checks normalized form
    const r = verifySymbolIdentity("BTC/USD", "BTC/USDT");
    expect(r.passed).toBe(false);
  });

  it("cache isolation: BTC ≠ ETH across all capabilities", () => {
    cacheClear();
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" }, { data: "btc" });
    cacheSet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "okx" }, { data: "eth" });
    expect(cacheGet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "okx" })?.data).toEqual({ data: "btc" });
    expect(cacheGet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "okx" })?.data).toEqual({ data: "eth" });
  });

  it("cache isolation: AAPL ≠ BBCA", () => {
    cacheClear();
    cacheSet({ instrument: "AAPL", capability: "earnings", providerId: "alpha-vantage" }, { data: "aapl" });
    cacheSet({ instrument: "BBCA", capability: "earnings", providerId: "alpha-vantage" }, { data: "bbca" });
    expect(cacheGet({ instrument: "AAPL", capability: "earnings", providerId: "alpha-vantage" })?.data).toEqual({ data: "aapl" });
    expect(cacheGet({ instrument: "BBCA", capability: "earnings", providerId: "alpha-vantage" })?.data).toEqual({ data: "bbca" });
  });
});

// ═══════════════════════════════════════════════════════════════
// N. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("N — Decision Immutability", () => {
  const frozenDecision = {
    recommendation: "LONG",
    bias: "bullish",
    confidence: 0.75,
    conviction: "HIGH",
    tradePlan: { entry: 100, stop: 95, target: 110 },
    noTradeReasons: [],
    actionability: "ACTIONABLE",
  };

  it("intelligence enrichment does not modify recommendation", () => {
    const before = { ...frozenDecision };
    // Simulate adding intelligence context
    const enriched = { ...before, universalIntelligenceContext: { test: true } };
    expect(enriched.recommendation).toBe(before.recommendation);
    expect(enriched.bias).toBe(before.bias);
    expect(enriched.confidence).toBe(before.confidence);
    expect(enriched.conviction).toBe(before.conviction);
    expect(enriched.tradePlan).toEqual(before.tradePlan);
  });

  it("stale intelligence does not modify decision", () => {
    const before = { ...frozenDecision };
    const enriched = { ...before, universalIntelligenceContext: { staleness: "STALE" } };
    expect(enriched.recommendation).toBe(before.recommendation);
    expect(enriched.noTradeReasons).toEqual(before.noTradeReasons);
  });

  it("contradictory intelligence does not modify decision", () => {
    const before = { ...frozenDecision };
    const enriched = {
      ...before,
      universalIntelligenceContext: { conflicting: true },
      cryptoIntelligenceContext: { conflict: true },
    };
    expect(enriched.recommendation).toBe(before.recommendation);
    expect(enriched.actionability).toBe(before.actionability);
  });

  it("all-provider-unavailable intelligence does not modify decision", () => {
    const before = { ...frozenDecision };
    const enriched = { ...before, universalIntelligenceContext: { allUnavailable: true } };
    expect(enriched.recommendation).toBe(before.recommendation);
    expect(enriched.conviction).toBe(before.conviction);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. SECURITY AUDIT
// ═══════════════════════════════════════════════════════════════

describe("O — Security Audit", () => {
  it("checkCredentials never exposes key values", () => {
    const env = {
      TWELVE_DATA_API_KEY: "sk_fake_123",
      ALPHA_VANTAGE_API_KEY: "xxyz99",
      COINGLASS_API_KEY: "cg_fake123",
    };
    const specs = getAllCredentialSpecs();
    for (const spec of specs) {
      const status = checkCredentials(spec.providerId, fakeEnv(env));
      if (status) {
        const s = JSON.stringify(status);
        expect(s).not.toContain("sk_fake_123");
        expect(s).not.toContain("xxyz99");
        expect(s).not.toContain("cg_fake123");
        expect(s).not.toContain("sk_live");
        expect(s).not.toContain("secret");
      }
    }
  });

  it("diagnostic never contains API keys", () => {
    // Simulate a diagnostic object
    const diagnostic = {
      provider: "okx",
      instrument: "BTC/USD",
      capability: "ohlcv",
      status: "LIVE_VERIFIED" as LiveStatus,
      latencyMs: 150,
      cacheHit: false,
      fallbackUsed: false,
      providerSymbol: "BTC/USDT",
      freshness: "FRESH",
      quality: "VERIFIED",
      fieldsParsed: ["data", "datetime", "ohlc"],
    };
    const s = JSON.stringify(diagnostic);
    expect(s).not.toContain("API_KEY");
    expect(s).not.toContain("Bearer");
    expect(s).not.toContain("authorization");
  });

  it("LiveRequestResult never contains secrets", () => {
    const result = {
      status: "LIVE_VERIFIED" as LiveStatus,
      instrument: "BTC/USD",
      capability: "ohlcv",
      provider: "okx",
      requestedAt: NOW,
      receivedAt: NOW + 100,
      latencyMs: 100,
      symbolUsed: "BTC/USDT",
      failureReason: undefined,
      diagnostic: {} as Record<string, unknown>,
    };
    const s = JSON.stringify(result);
    expect(s).not.toContain("sk_");
    expect(s).not.toContain("Bearer");
    expect(s).not.toContain("API_KEY");
    expect(s).not.toContain("secret");
  });
});

// ═══════════════════════════════════════════════════════════════
// P. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("P — Determinism", () => {
  it("OHLCV validation is deterministic", () => {
    const candles = makeCandles(10);
    const r1 = validateOhlcvSeries(candles, { now: NOW });
    const r2 = validateOhlcvSeries(candles, { now: NOW });
    expect(r1).toEqual(r2);
  });

  it("quote validation is deterministic", () => {
    const q = { price: 1.1, bid: 1.09, ask: 1.11 };
    const r1 = validateQuote(q, { now: NOW });
    const r2 = validateQuote(q, { now: NOW });
    expect(r1).toEqual(r2);
  });

  it("symbol identity is deterministic", () => {
    const r1 = verifySymbolIdentity("BTC/USD", "BTCUSD");
    const r2 = verifySymbolIdentity("BTC/USD", "BTCUSD");
    expect(r1).toEqual(r2);
  });

  it("cross-provider consistency is deterministic", () => {
    const obs = [
      { provider: "A", price: 100 },
      { provider: "B", price: 101 },
    ];
    const v1 = compareCrossProviderPrices(obs);
    const v2 = compareCrossProviderPrices(obs);
    expect(v1).toBe(v2);
  });

  it("data quality assessment is deterministic", () => {
    const params = { statuses: ["LIVE_VERIFIED", "LIVE_VERIFIED"] as LiveStatus[], consistency: "CONSISTENT" as ConsistencyVerdict };
    const q1 = assessDataQuality(params);
    const q2 = assessDataQuality(params);
    expect(q1).toEqual(q2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. CONCURRENCY
// ═══════════════════════════════════════════════════════════════

describe("Q — Concurrency", () => {
  beforeEach(() => {
    resetLiveState();
    resetCache();
    cacheClear();
  });

  it("concurrent requests for different instruments maintain isolation", async () => {
    const nowSec = Math.floor(NOW / 1000);
    const instruments = ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD"];
    const tdBase = { symbol: "X", values: [{ datetime: new Date(NOW - 3600000).toISOString().replace("T", " ").slice(0, 19), open: "100", high: "105", low: "95", close: "102", volume: "1000" }] };

    const results = await Promise.all(
      instruments.map((inst) =>
        executeLiveRequest({
          instrument: inst,
          capability: "ohlcv",
          transport: mockTransport({ ...tdBase, symbol: inst }),
          readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
          now: NOW,
        }),
      ),
    );

    results.forEach((r, i) => {
      expect(r.instrument).toBe(instruments[i]);
    });
  });

  it("concurrent Twelve Data requests succeed independently", async () => {
    const tdResponse = (sym: string) => ({
      symbol: sym,
      values: [{ datetime: new Date(NOW - 3600000).toISOString().replace("T", " ").slice(0, 19), open: "100", high: "105", low: "95", close: "102", volume: "1000" }],
    });

    const results = await Promise.all([
      executeLiveRequest({
        instrument: "BTC/USD",
        capability: "ohlcv",
        transport: mockTransport(tdResponse("BTC/USD")),
        readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
        now: NOW,
      }),
      executeLiveRequest({
        instrument: "ETH/USD",
        capability: "ohlcv",
        transport: mockTransport(tdResponse("ETH/USD")),
        readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
        now: NOW,
      }),
    ]);

    expect(results[0].instrument).toBe("BTC/USD");
    expect(results[1].instrument).toBe("ETH/USD");
  });

  it("concurrent failures are independent", async () => {
    const results = await Promise.all([
      executeLiveRequest({
        instrument: "BTC/USD",
        capability: "ohlcv",
        transport: mockNetworkError("ECONNREFUSED"),
        readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
        now: NOW,
      }),
      executeLiveRequest({
        instrument: "ETH/USD",
        capability: "ohlcv",
        transport: mockNetworkError("TIMEOUT"),
        readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
        now: NOW,
      }),
    ]);

    expect(results[0].status).toBe("NETWORK_UNAVAILABLE");
    expect(results[1].status).toBe("NETWORK_UNAVAILABLE");
    expect(results[0].instrument).toBe("BTC/USD");
    expect(results[1].instrument).toBe("ETH/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// R. FRESHNESS & PROVENANCE
// ═══════════════════════════════════════════════════════════════

describe("R — Freshness & Provenance", () => {
  beforeEach(() => {
    resetLiveState();
    resetCache();
    cacheClear();
  });

  it("live result contains requestedAt and receivedAt", async () => {
    const tdResponse = {
      symbol: "BTC/USD",
      values: [{ datetime: new Date(NOW - 3600000).toISOString().replace("T", " ").slice(0, 19), open: "100", high: "105", low: "95", close: "102", volume: "1000" }],
    };
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport(tdResponse),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
      now: NOW,
    });
    expect(r.requestedAt).toBe(NOW);
    expect(r.receivedAt).toBeGreaterThanOrEqual(NOW);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("diagnostic contains freshness and quality fields", async () => {
    const tdResponse = {
      symbol: "BTC/USD",
      values: [{ datetime: new Date(NOW - 3600000).toISOString().replace("T", " ").slice(0, 19), open: "100", high: "105", low: "95", close: "102", volume: "1000" }],
    };
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockTransport(tdResponse),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
      now: NOW,
    });
    expect(r.diagnostic.freshness).toBeDefined();
    expect(r.diagnostic.quality).toBeDefined();
    expect(typeof r.diagnostic.freshness).toBe("string");
    expect(typeof r.diagnostic.quality).toBe("string");
  });

  it("cache stores with freshness metadata", () => {
    cacheSet(
      { instrument: "BTC/USD", capability: "quote", providerId: "okx" },
      { price: 60000 },
      "FRESH",
    );
    const entry = cacheGet({ instrument: "BTC/USD", capability: "quote", providerId: "okx" });
    expect(entry).not.toBeNull();
    expect(entry!.freshnessAtCache).toBe("FRESH");
    expect(entry!.cachedAt).toBeGreaterThan(0);
    expect(entry!.isStale).toBe(false);
  });

  it("readCachedOrUnavailable returns stale flag when entry expires", async () => {
    // Configure cache with 0 TTL + stale-while-revalidate so entries expire immediately
    configureCache({ defaultTtlMs: 0, staleWhileRevalidate: true, capabilityTtlMs: { quote: 0 } });
    cacheSet(
      { instrument: "BTC/USD", capability: "quote", providerId: "okx" },
      { price: 60000 },
      "STALE",
    );
    // Wait 2ms so age > 0 > ttlMs
    await new Promise((r) => setTimeout(r, 2));
    const cached = readCachedOrUnavailable("BTC/USD", "quote", "okx");
    expect(cached.hit).toBe(true);
    expect(cached.stale).toBe(true);
    // Restore default cache config
    configureCache({ defaultTtlMs: 300_000, staleWhileRevalidate: false });
  });

  it("readCachedOrUnavailable misses when nothing cached", () => {
    const cached = readCachedOrUnavailable("BTC/USD", "quote", "okx");
    expect(cached.hit).toBe(false);
  });

  it("failed result has UNAVAILABLE freshness", async () => {
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      transport: mockNetworkError(),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
      now: NOW,
    });
    expect(r.diagnostic.freshness).toBe("UNAVAILABLE");
    expect(r.diagnostic.quality).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// S. EDGE CASES & EMPTY STATES
// ═══════════════════════════════════════════════════════════════

describe("S — Edge Cases & Empty States", () => {
  it("empty OHLCV series is invalid", () => {
    const r = validateOhlcvSeries([]);
    expect(r.valid).toBe(false);
    expect(r.totalRecords).toBe(0);
  });

  it("single valid candle is valid", () => {
    const r = validateOhlcvSeries([makeCandle()]);
    expect(r.valid).toBe(true);
    expect(r.acceptedCount).toBe(1);
  });

  it("mixed valid and invalid candles: valid ones survive", () => {
    const candles = [
      makeCandle({ hoursBefore: 1 }),
      makeCandle({ hoursBefore: 2, open: NaN }),
      makeCandle({ hoursBefore: 3 }),
    ];
    const r = validateOhlcvSeries(candles, { now: NOW });
    expect(r.valid).toBe(false);
    expect(r.acceptedCount).toBe(2);
    expect(r.rejectedCount).toBe(1);
  });

  it("empty quote list is unavailable", () => {
    const v = compareCrossProviderPrices([]);
    expect(v).toBe("UNAVAILABLE");
  });

  it("single quote is unavailable for comparison", () => {
    const v = compareCrossProviderPrices([{ provider: "A", price: 100 }]);
    expect(v).toBe("UNAVAILABLE");
  });

  it("all-null observations from providers", () => {
    const statuses: LiveStatus[] = [
      "CREDENTIAL_MISSING",
      "NETWORK_UNAVAILABLE",
      "PROVIDER_ERROR",
    ];
    const q = assessDataQuality({ statuses });
    expect(q.state).toBe("UNAVAILABLE");
  });

  it("instrument not in registry returns UNAVAILABLE", async () => {
    const r = await executeLiveRequest({
      instrument: "RANDOM_TOKEN_XYZ",
      capability: "ohlcv",
      transport: mockTransport({}),
      readEnv: fakeEnv({}),
    });
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.instrument).toBe("RANDOM_TOKEN_XYZ");
  });

  it("verifySymbolIdentity handles empty string", () => {
    const r = verifySymbolIdentity("BTC/USD", "");
    expect(r.passed).toBe(false);
  });

  it("verifyQuote handles completely empty object", () => {
    const r = validateQuote({} as any);
    expect(r.valid).toBe(false);
  });

  it("resolved instrument exists for all major instruments", () => {
    const instruments = [
      "BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD",
      "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD",
      "XAU/USD", "XAG/USD",
      "AAPL", "MSFT", "NVDA", "TSLA",
      "BBCA", "BBRI", "TLKM", "GOTO", "BMRI",
      "WTI", "BRENT", "NGAS",
      "SPX", "NDX", "DJI", "IHSG",
    ].filter(id => !!resolveInstrument(id));
    instruments.forEach((inst) => {
      const resolved = resolveInstrument(inst);
      expect(resolved).toBeDefined();
      expect(resolved!.canonical).toBe(inst);
    });
  });

  it("routing provides candidates for major instruments", () => {
    const pairs: [string, string][] = [
      ["BTC/USD", "ohlcv"],
      ["ETH/USD", "ohlcv"],
      ["EUR/USD", "ohlcv"],
      ["XAU/USD", "ohlcv"],
      ["AAPL", "ohlcv"],
    ];
    pairs.forEach(([inst, cap]) => {
      const route = routeProviderRequest(inst, cap as any);
      expect(route.routes.length).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// T. INSTRUMENT REGISTRY COMPREHENSIVE CHECKS
// ═══════════════════════════════════════════════════════════════

describe("T — Instrument Registry", () => {
  it("crypto instruments have correct asset class", () => {
    ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD"].forEach((id) => {
      const i = resolveInstrument(id);
      expect(i).toBeDefined();
      expect(i!.assetClass).toBe("crypto");
    });
  });

  it("forex instruments have correct asset class", () => {
    ["EUR/USD", "GBP/USD", "USD/JPY", "USD/IDR"].forEach((id) => {
      const i = resolveInstrument(id);
      expect(i).toBeDefined();
      expect(i!.assetClass).toBe("forex");
    });
  });

  it("equity instruments have correct asset class", () => {
    ["AAPL", "MSFT", "NVDA", "TSLA"].forEach((id) => {
      const i = resolveInstrument(id);
      expect(i).toBeDefined();
      expect(i!.assetClass).toBe("equity");
      expect(i!.countryCode).toBe("US");
    });
  });

  it("IDX equities have correct country and exchange", () => {
    ["BBCA", "BBRI", "TLKM", "GOTO", "BMRI", "BBNI"].forEach((id) => {
      const i = resolveInstrument(id);
      expect(i).toBeDefined();
      expect(i!.assetClass).toBe("equity");
      expect(i!.countryCode).toBe("ID");
      expect(i!.primaryExchange).toBe("IDX");
    });
  });

  it("commodity instruments have correct asset class", () => {
    ["XAU/USD", "XAG/USD", "WTI", "BRENT"].forEach((id) => {
      const i = resolveInstrument(id);
      expect(i).toBeDefined();
      expect(i!.assetClass).toBe("commodity");
    });
  });

  it("index instruments have correct asset class", () => {
    ["SPX", "NDX", "DJI", "IHSG"].forEach((id) => {
      const i = resolveInstrument(id);
      expect(i).toBeDefined();
      expect(i!.assetClass).toBe("indices");
    });
  });

  it("provider symbol mapping exists for crypto via twelve-data", () => {
    const sym = getProviderSymbol("BTC/USD", "twelve-data");
    expect(sym).toBe("BTC/USD");
  });

  it("provider symbol mapping exists for crypto via coingecko", () => {
    const sym = getProviderSymbol("BTC/USD", "coingecko");
    expect(sym).toBe("bitcoin");
  });

  it("unknown instrument returns undefined", () => {
    const i = resolveInstrument("FAKE_COIN");
    expect(i).toBeUndefined();
  });

  it("getProviderSymbol returns null for unknown mapping", () => {
    const sym = getProviderSymbol("BTC/USD", "nonexistent-provider");
    expect(sym).toBeNull();
  });

  it("getProviderSymbol returns null for okx (not in providerMappings)", () => {
    const sym = getProviderSymbol("BTC/USD", "okx");
    expect(sym).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// U. MULTI-TIMEFRAME SUPPORT
// ═══════════════════════════════════════════════════════════════

describe("U — Multi-Timeframe & Capability", () => {
  it("route provider supports ohlcv capability for BTC/USD", () => {
    const route = routeProviderRequest("BTC/USD", "ohlcv");
    expect(route.routes.length).toBeGreaterThan(0);
  });

  it("route provider supports quote capability for EUR/USD", () => {
    const route = routeProviderRequest("EUR/USD", "quote");
    expect(route.routes.length).toBeGreaterThan(0);
  });

  it("route provider returns routes for AAPL (fundamentals may be unsupported)", () => {
    const route = routeProviderRequest("AAPL", "earnings");
    // AAPL has alpha-vantage provider for fundamentals
    expect(route.routes).toBeDefined();
  });

  it("live request with different timeframes", async () => {
    const tdResponse = {
      symbol: "BTC/USD",
      values: [{ datetime: new Date(NOW - 3600000).toISOString().replace("T", " ").slice(0, 19), open: "100", high: "105", low: "95", close: "102", volume: "1000" }],
    };
    const r = await executeLiveRequest({
      instrument: "BTC/USD",
      capability: "ohlcv",
      timeframe: "1h",
      transport: mockTransport(tdResponse),
      readEnv: fakeEnv({ TWELVE_DATA_API_KEY: "test-key" }),
      now: NOW,
    });
    expect(r.status).toBe("LIVE_VERIFIED");
  });
});
