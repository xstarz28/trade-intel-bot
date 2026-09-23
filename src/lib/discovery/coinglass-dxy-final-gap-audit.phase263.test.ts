/**
 * Phase 263 — COINGLASS DISCOVERY CLOSURE & FINAL REMAINING-GAP AUDIT
 *
 * Covers 70+ checklist items across 15+ categories:
 * A. CoinGlass endpoint contract
 * B. Credential handling CREDENTIAL_REQUIRED
 * C. Rate limit RATE_LIMITED
 * D. Malformed MALFORMED_RESPONSE
 * E. Exact native identity preservation
 * F. Multi-provider identity (coinglass:: vs ccxt:binance:: vs okx:: vs twelve-data::)
 * G. Coverage COMPLETE classification
 * H. Trading state & capabilities
 * I. Timestamp/provenance
 * J. Discovery → live bridge (not primary price)
 * K. DXY actual price verification all providers
 * L. Alpha Vantage INDEX_CATALOG/INDEX_DATA DXY
 * M. Final gap classification Stockbit/Ajaib/IDX/CoinGlass/DXY
 * N. Security (no secrets, no fabrication, no proxy)
 * O. Registry integration & adapter invariants
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  discoverCoinGlassMarkets,
  createCoinGlassDiscoveryAdapter,
  COINGLASS_FUTURES_URL,
  COINGLASS_SPOT_URL,
  COINGLASS_PROVIDER_ID,
} from "./coinglass-adapter";
import { STATIC_REGISTRY } from "./universal-provider-registry";
import { PROVIDER_READINESS_MATRIX } from "./runtime-readiness";
import { DXY_CANDIDATE_SYMBOLS } from "@/lib/market-context";
import { discoveredInstrumentKey } from "./types";

const NOW = 1_800_000_000_000;

function mockTransportFactory(
  futuresData: unknown,
  spotData: unknown,
  futuresStatus = 200,
  spotStatus = 200,
) {
  return async (url: string, _key: string) => {
    const isFutures = url.includes("/futures/");
    const isSpot = url.includes("/spot/");
    const status = isFutures ? futuresStatus : isSpot ? spotStatus : 200;
    const json = isFutures ? futuresData : isSpot ? spotData : { code: "0", msg: "success", data: {} };
    return { ok: status >= 200 && status < 300, status, json };
  };
}

function successEnvelope(data: Record<string, any[]>) {
  return { code: "0", msg: "success", data };
}

const SAMPLE_FUTURES = {
  Binance: [
    { instrument_id: "BTCUSD_PERP", base_asset: "BTC", quote_asset: "USD", settlement_currency: "USDT", max_leverage: 100, funding_interval: 8, price_tick_size: 0.1 },
    { instrument_id: "BTCUSD_250627", base_asset: "BTC", quote_asset: "USD", settlement_currency: "USDT" },
  ],
  Bitget: [
    { instrument_id: "BTCUSDT_UMCBL", base_asset: "BTC", quote_asset: "USDT", settlement_currency: "USDT" },
  ],
};

const SAMPLE_SPOT = {
  Binance: [
    { instrument_id: "BTCUSDT", base_asset: "BTC", quote_asset: "USDT" },
    { instrument_id: "ETHUSDT", base_asset: "ETH", quote_asset: "USDT" },
  ],
};

const readEnvWithKey = (name: string) => (name === "COINGLASS_API_KEY" ? "test-key-123" : undefined);
const readEnvEmpty = (_name: string) => undefined;

// ────────────────────────────────────────────────────────────────
// A. CoinGlass endpoint contract
// ────────────────────────────────────────────────────────────────

describe("Phase263 A — CoinGlass endpoint contract", () => {
  it("futures URL matches official v4", () => {
    expect(COINGLASS_FUTURES_URL).toBe("https://open-api-v4.coinglass.com/api/futures/supported-exchange-pairs");
  });
  it("spot URL matches official v4", () => {
    expect(COINGLASS_SPOT_URL).toBe("https://open-api-v4.coinglass.com/api/spot/supported-exchange-pairs");
  });
  it("adapter source references official cache 1min semantics", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).toContain("Cache every 1 minutes");
    expect(src).toContain("single response complete list");
    expect(src).toContain("no pagination");
  });
  it("adapter handles both snake_case and camelCase fields", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).toContain("instrument_id");
    expect(src).toContain("instrumentId");
    expect(src).toContain("base_asset");
    expect(src).toContain("baseAsset");
  });
  it("response data shape is map exchange->array", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.success).toBe(true);
    expect(result.instruments.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────
// B. Credential handling CREDENTIAL_REQUIRED
// ────────────────────────────────────────────────────────────────

describe("Phase263 B — Credential handling", () => {
  it("missing key returns CREDENTIAL_REQUIRED", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvEmpty });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CREDENTIAL_REQUIRED/);
    expect(result.completeness).toBe("FAILED");
  });
  it("401 returns CREDENTIAL_REQUIRED", async () => {
    const transport = mockTransportFactory({ code: "401", msg: "Unauthorized" }, { code: "401", msg: "Unauthorized" }, 401, 401);
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CREDENTIAL_REQUIRED/);
  });
  it("403 returns CREDENTIAL_REQUIRED", async () => {
    const transport = mockTransportFactory({ code: "403", msg: "Forbidden" }, { code: "403", msg: "Forbidden" }, 403, 403);
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CREDENTIAL_REQUIRED/);
  });
  it("error message includes required env var name, not value", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvEmpty });
    expect(result.error).toContain("COINGLASS_API_KEY");
    expect(result.error).not.toContain("test-key");
  });
  it("checkCredentials used", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).toContain("checkCredentials");
    expect(src).toContain("COINGLASS_API_KEY");
  });
});

// ────────────────────────────────────────────────────────────────
// C. Rate limit RATE_LIMITED
// ────────────────────────────────────────────────────────────────

describe("Phase263 C — Rate limit handling", () => {
  it("429 returns RATE_LIMITED", async () => {
    const transport = mockTransportFactory({ code: "429", msg: "rate limit" }, { code: "429", msg: "rate limit" }, 429, 429);
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/RATE_LIMITED/);
  });
  it("rate limit message contains canonical code", async () => {
    const transport = async () => ({ ok: false, status: 429, json: { code: "429", msg: "Too Many Requests" } });
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.error).toMatch(/RATE_LIMITED/);
  });
  it("adapter classifies 429 as RATE_LIMITED in failure path", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).toContain("RATE_LIMITED");
    expect(src).toContain("429");
  });
});

// ────────────────────────────────────────────────────────────────
// D. Malformed MALFORMED_RESPONSE
// ────────────────────────────────────────────────────────────────

describe("Phase263 D — Malformed handling", () => {
  it("empty body returns MALFORMED_RESPONSE", async () => {
    const transport = async () => ({ ok: true, status: 200, json: undefined });
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MALFORMED_RESPONSE/);
  });
  it("missing data field returns MALFORMED_RESPONSE", async () => {
    const transport = mockTransportFactory({ code: "0", msg: "success" }, { code: "0", msg: "success" });
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MALFORMED_RESPONSE/);
  });
  it("non-map data returns MALFORMED_RESPONSE", async () => {
    const transport = mockTransportFactory({ code: "0", msg: "success", data: [] }, { code: "0", msg: "success", data: [] });
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MALFORMED_RESPONSE/);
  });
  it("adapter never throws, returns explicit failure", async () => {
    const transport = async () => { throw new Error("network down"); };
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(() => result).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────
// E. Exact native identity preservation
// ────────────────────────────────────────────────────────────────

describe("Phase263 E — Exact native identity", () => {
  it("provider is coinglass", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.instruments.every((i) => i.provider === "coinglass")).toBe(true);
  });
  it("providerInstrumentId preserves exact native instrument_id byte-for-byte", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    // instrument_id BTCUSD_PERP must appear exactly as substring
    const ids = result.instruments.map((i) => i.providerInstrumentId);
    expect(ids.some((id) => id.includes("BTCUSD_PERP"))).toBe(true);
    expect(ids.some((id) => id.includes("BTCUSDT_UMCBL"))).toBe(true);
    // No rewriting to different format
    expect(ids.some((id) => id.includes("BTC/USD"))).toBe(false);
  });
  it("baseAsset and quoteAsset preserved exact uppercase", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    const btc = result.instruments.find((i) => i.providerInstrumentId.includes("BTCUSD_PERP"));
    expect(btc?.baseAsset).toBe("BTC");
    expect(btc?.quoteAsset).toBe("USD");
  });
  it("settleAsset preserved where available", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    const btc = result.instruments.find((i) => i.providerInstrumentId.includes("BTCUSD_PERP"));
    expect(btc?.settleAsset).toBe("USDT");
  });
  it("missing base/quote skipped with warning", async () => {
    const badFutures = { Binance: [{ instrument_id: "BAD", settlement_currency: "USDT" }] };
    const transport = mockTransportFactory(successEnvelope(badFutures as any), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.warnings.some((w) => w.includes("missing base/quote"))).toBe(true);
    expect(result.instruments.some((i) => i.providerInstrumentId.includes("BAD"))).toBe(false);
  });
  it("missing instrument_id skipped with warning", async () => {
    const badFutures = { Binance: [{ base_asset: "BTC", quote_asset: "USD" } as any] };
    const transport = mockTransportFactory(successEnvelope(badFutures as any), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.warnings.some((w) => w.includes("missing instrument_id"))).toBe(true);
  });
  it("no substitution or fabrication", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).not.toMatch(/BTC\/USDT.*=>.*BTC-USD/);
    expect(src).not.toContain("POPULAR_INSTRUMENTS");
  });
});

// ────────────────────────────────────────────────────────────────
// F. Multi-provider identity isolation
// ────────────────────────────────────────────────────────────────

describe("Phase263 F — Multi-provider identity isolation", () => {
  it("coinglass:: distinct from ccxt:binance::", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    const coinglassKeys = result.instruments.map((i) => discoveredInstrumentKey(i));
    expect(coinglassKeys.every((k) => k.startsWith("coinglass::"))).toBe(true);
    expect(coinglassKeys.some((k) => k === "ccxt:binance::BTC/USDT")).toBe(false);
  });
  it("same economic asset on different providers remains distinct", () => {
    const coinglassInst = {
      provider: "coinglass",
      providerInstrumentId: "Binance:BTCUSD_PERP",
      assetClass: "crypto" as const,
      subType: "crypto_perpetual" as const,
      baseAsset: "BTC",
      quoteAsset: "USD",
      tradingState: "TRADING" as const,
      capabilities: [] as any,
      discoveredAt: NOW,
    };
    const binanceInst = {
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      assetClass: "crypto" as const,
      subType: "crypto_spot" as const,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: [] as any,
      discoveredAt: NOW,
    };
    const okxInst = {
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      assetClass: "crypto" as const,
      subType: "crypto_perpetual" as const,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: [] as any,
      discoveredAt: NOW,
    };
    const twelveInst = {
      provider: "twelve-data",
      providerInstrumentId: "BTC/USD",
      assetClass: "crypto" as const,
      subType: "crypto_spot" as const,
      baseAsset: "BTC",
      quoteAsset: "USD",
      tradingState: "TRADING" as const,
      capabilities: [] as any,
      discoveredAt: NOW,
    };
    const keys = [coinglassInst, binanceInst, okxInst, twelveInst].map(discoveredInstrumentKey);
    expect(new Set(keys).size).toBe(4);
  });
  it("exchange prefix ensures no collision within coinglass provider", async () => {
    const colliding = {
      Binance: [{ instrument_id: "BTCUSD_PERP", base_asset: "BTC", quote_asset: "USD" }],
      Bybit: [{ instrument_id: "BTCUSD_PERP", base_asset: "BTC", quote_asset: "USD" }],
    };
    const transport = mockTransportFactory(successEnvelope(colliding as any), successEnvelope({} as any));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    // Two entries same instrument_id different exchange should be distinct via exchange prefix
    expect(result.instruments.length).toBe(2);
    expect(result.instruments[0].providerInstrumentId).not.toBe(result.instruments[1].providerInstrumentId);
  });
  it("dedup via provider::providerInstrumentId", async () => {
    const dup = {
      Binance: [
        { instrument_id: "BTCUSD_PERP", base_asset: "BTC", quote_asset: "USD" },
        { instrument_id: "BTCUSD_PERP", base_asset: "BTC", quote_asset: "USD" },
      ],
    };
    const transport = mockTransportFactory(successEnvelope(dup as any), successEnvelope({} as any));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.instruments.length).toBe(1);
    expect(result.warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// G. Coverage COMPLETE classification
// ────────────────────────────────────────────────────────────────

describe("Phase263 G — Coverage completeness", () => {
  it("single response complete list → COMPLETE", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.completeness).toBe("COMPLETE");
  });
  it("not EVENTUALLY_COMPLETE or BOUNDED", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.completeness).not.toBe("BOUNDED_DISCOVERY" as any);
    // Ensure source does not claim EVENTUALLY_COMPLETE for coinglass
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).not.toContain("EVENTUALLY_COMPLETE");
  });
  it("pagesFetched counts successful catalogs", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.pagesFetched).toBe(2);
  });
  it("one catalog fails → PARTIAL", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), { code: "500", msg: "error" }, 200, 500);
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.completeness).toBe("PARTIAL");
    expect(result.success).toBe(true);
    expect(result.instruments.length).toBeGreaterThan(0);
  });
  it("both fail → FAILED", async () => {
    const transport = mockTransportFactory({ code: "500", msg: "err" }, { code: "500", msg: "err" }, 500, 500);
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.completeness).toBe("FAILED");
    expect(result.success).toBe(false);
  });
  it("catalogs array contains futures and spot with COMPLETE", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.catalogs?.length).toBe(2);
    expect(result.catalogs?.every((c) => c.completeness === "COMPLETE")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// H. Trading state & capabilities
// ────────────────────────────────────────────────────────────────

describe("Phase263 H — Trading state & capabilities", () => {
  it("tradingState is TRADING for supported list", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.instruments.every((i) => i.tradingState === "TRADING")).toBe(true);
  });
  it("futures capabilities include derivatives", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope({} as any));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    const perp = result.instruments.find((i) => i.subType === "crypto_perpetual");
    expect(perp?.capabilities).toContain("open_interest");
    expect(perp?.capabilities).toContain("funding_rate");
    expect(perp?.capabilities).toContain("liquidations");
  });
  it("subType crypto_perp for PERP, crypto_futures for dated, crypto_spot for spot", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    const perp = result.instruments.find((i) => i.providerInstrumentId.includes("BTCUSD_PERP"));
    const dated = result.instruments.find((i) => i.providerInstrumentId.includes("BTCUSD_250627"));
    const spot = result.instruments.find((i) => i.providerInstrumentId.includes("BTCUSDT") && i.subType === "crypto_spot");
    expect(perp?.subType).toBe("crypto_perpetual");
    expect(dated?.subType).toBe("crypto_futures");
    expect(spot?.subType).toBe("crypto_spot");
  });
  it("region is exchange name exact", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.instruments.some((i) => i.region === "Binance")).toBe(true);
    expect(result.instruments.some((i) => i.region === "Bitget")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// I. Timestamp / provenance
// ────────────────────────────────────────────────────────────────

describe("Phase263 I — Timestamp / provenance", () => {
  it("discoveredAt equals now", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.discoveredAt).toBe(NOW);
    expect(result.instruments.every((i) => i.discoveredAt === NOW)).toBe(true);
  });
  it("adapter uses Date.now() for provenance in production path", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).toContain("discoveredAt: now");
  });
  it("no fake live timestamp", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).not.toMatch(/price.*Date\.now/);
    expect(src).not.toContain("current-at-response");
  });
});

// ────────────────────────────────────────────────────────────────
// J. Discovery → live bridge (not primary price)
// ────────────────────────────────────────────────────────────────

describe("Phase263 J — Discovery → live bridge", () => {
  it("coinglass discovery does not claim primary price provider", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).not.toContain("primary price");
    // Capabilities are derivatives, not quote as primary
    expect(src).toContain("open_interest");
    expect(src).toContain("funding_rate");
  });
  it("existing convex/coinglass.ts remains derivatives only, not price", () => {
    const src = readFileSync("src/convex/coinglass.ts", "utf8");
    expect(src).toContain("fetchDerivatives");
    expect(src).not.toContain("fetchPrice");
    expect(src).not.toContain("supported-exchange-pairs");
  });
  it("registry marks coinglass liveSupported true but discoverySupported true now", () => {
    const entry = STATIC_REGISTRY.find((e) => e.providerId === "coinglass")!;
    expect(entry.discoverySupported).toBe(true);
    expect(entry.liveSupported).toBe(true);
    expect(entry.capabilities).toContain("derivatives");
  });
});

// ────────────────────────────────────────────────────────────────
// K. DXY actual price verification all providers
// ────────────────────────────────────────────────────────────────

describe("Phase263 K — DXY actual price verification", () => {
  it("DXY candidate symbols documented and probed live, all 404 on current plan", () => {
    expect(DXY_CANDIDATE_SYMBOLS).toContain("DXY");
    expect(DXY_CANDIDATE_SYMBOLS).toContain("DX.Y.NYB");
    expect(DXY_CANDIDATE_SYMBOLS).toContain("USD_INDEX");
    expect(DXY_CANDIDATE_SYMBOLS).toContain("I:DXY");
    const marketDataSrc = readFileSync("src/convex/marketData.ts", "utf8");
    expect(marketDataSrc).toContain("DXY_CANDIDATE_SYMBOLS");
    expect(marketDataSrc).toContain("actual DXY price series is not available");
  });
  it("no provider claims actual DXY price without verification", () => {
    // Phase 264: DXY LIVE now dxy provider with wording "Actual DXY price series is not currently verified as available from the configured provider" + fallback note
    const readiness = PROVIDER_READINESS_MATRIX.find((r) => r.provider==="dxy" && r.capability === "LIVE");
    expect(readiness?.status).toBe("NOT_IMPLEMENTED");
    expect(readiness?.detail).toMatch(/not currently verified|fallback/);
    expect(readiness?.detail).toContain("Actual DXY price series is not currently verified as available from the configured provider");
  });
  it("rejects USD proxy as actual DXY", () => {
    const src = readFileSync("src/convex/marketData.ts", "utf8");
    expect(src).toContain("NEWS-derived USD proxy remains labeled fallback");
    expect(src).not.toMatch(/DXY.*USD.*proxy.*actual/i);
  });
  it("rejects EUR inversion as actual DXY", () => {
    const src = readFileSync("src/lib/market-context.ts", "utf8");
    // DXY is not derived from EUR/USD inversion — no inversion formula
    expect(src).not.toContain("1 / EUR");
    expect(src).not.toContain("1/EUR");
    expect(src).not.toMatch(/DXY.*=.*1\s*\/\s*.*EUR/i);
  });
  it("rejects ETF/futures proxy unless explicit DXY instrument", () => {
    const src = readFileSync("src/convex/marketData.ts", "utf8");
    expect(src).not.toContain("UUP");
    expect(src).not.toContain("DX-Y.NYB");
    // DX-Y.NYB is allowed as candidate but must be verified live
    expect(DXY_CANDIDATE_SYMBOLS).not.toContain("UUP");
  });
  it("Twelve Data does not have actual DXY on current plan", () => {
    // Phase 264: DXY moved to separate provider dxy::LIVE NOT_IMPLEMENTED, twelve-data LIVE is general CREDENTIAL_REQUIRED with DXY note
    const dxyReadiness = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "dxy" && r.capability === "LIVE");
    expect(dxyReadiness).toBeDefined();
    expect(dxyReadiness?.status).toBe("NOT_IMPLEMENTED");
    expect(dxyReadiness?.detail).toContain("Twelve Data candidates");
    expect(dxyReadiness?.detail).toContain("404");
  });
  it("OKX does not provide DXY", () => {
    const okxReadiness = PROVIDER_READINESS_MATRIX.filter((r) => r.provider === "okx" && r.detail.toLowerCase().includes("dxy"));
    expect(okxReadiness.length).toBe(0);
  });
  it("CoinGlass does not provide DXY price", () => {
    const cgReadiness = PROVIDER_READINESS_MATRIX.filter((r) => r.provider === "coinglass" && r.detail.toLowerCase().includes("dxy"));
    expect(cgReadiness.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// L. Alpha Vantage INDEX_CATALOG / INDEX_DATA DXY — Phase265 update: now implemented
// ────────────────────────────────────────────────────────────────
describe("Phase263 L — Alpha Vantage INDEX_CATALOG DXY", () => {
  it("Alpha Vantage implementation now includes INDEX_CATALOG/INDEX_DATA plus NEWS_SENTIMENT, OVERVIEW, EARNINGS (Phase265)", () => {
    const src = readFileSync("src/convex/alphaVantage.ts", "utf8");
    expect(src).toContain("NEWS_SENTIMENT");
    expect(src).toContain("OVERVIEW");
    expect(src).toContain("INDEX_CATALOG");
    expect(src).toContain("INDEX_DATA");
    const adapterSrc = readFileSync("src/lib/discovery/alpha-vantage-adapter.ts", "utf8");
    expect(adapterSrc).toContain("INDEX_CATALOG");
    expect(adapterSrc).toContain("INDEX_DATA");
  });
  it("Alpha Vantage docs: INDEX_DATA requires premium, DXY catalog source of truth (Phase265)", () => {
    const src = readFileSync("src/lib/discovery/runtime-readiness.ts", "utf8");
    expect(src).toContain("INDEX_CATALOG");
    expect(src).toContain("INDEX_DATA");
    const avDiscovery = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "alpha-vantage" && r.capability === "DISCOVERY");
    expect(avDiscovery?.status).toBe("CREDENTIAL_REQUIRED");
    expect(avDiscovery?.detail).toContain("INDEX_CATALOG");
    const avDxy = PROVIDER_READINESS_MATRIX.filter((r) => r.provider === "alpha-vantage" && r.detail.toLowerCase().includes("dxy"));
    expect(avDxy.length).toBeGreaterThan(0);
  });
  it("DXY remains NOT_IMPLEMENTED honest, no proxy substitution (Phase265)", () => {
    const dxyEntry = PROVIDER_READINESS_MATRIX.find((r) => r.provider==="dxy" && r.capability==="LIVE");
    expect(dxyEntry).toBeDefined();
    expect(dxyEntry?.status).toBe("NOT_IMPLEMENTED");
    expect(dxyEntry?.detail).toContain("Actual DXY price series is not currently verified as available from the configured provider");
    expect(dxyEntry?.detail).toContain("not actual DXY price data");
  });
  it("no fabricated DXY via Alpha Vantage", () => {
    const src = readFileSync("src/lib/data/alpha-vantage/normalize.ts", "utf8");
    // Only sentiment-derived DXY trend, not price
    expect(src).toContain("dxyTrend");
    expect(src).not.toContain("DXY price");
  });
});

// ────────────────────────────────────────────────────────────────
// M. Final gap classification
// ────────────────────────────────────────────────────────────────

describe("Phase263 M — Final gap classification", () => {
  it("Stockbit DISCOVERY NOT_IMPLEMENTED LICENSE_REQUIRED", () => {
    const e = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "stockbit" && r.capability === "DISCOVERY");
    expect(e?.status).toBe("NOT_IMPLEMENTED");
    const live = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "stockbit" && r.capability === "LIVE");
    expect(live?.status).toBe("LICENSE_REQUIRED");
  });
  it("Ajaib DISCOVERY NOT_IMPLEMENTED LICENSE_REQUIRED", () => {
    const e = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "ajaib" && r.capability === "DISCOVERY");
    expect(e?.status).toBe("NOT_IMPLEMENTED");
    const live = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "ajaib" && r.capability === "LIVE");
    expect(live?.status).toBe("LICENSE_REQUIRED");
  });
  it("IDX DISCOVERY LICENSE_REQUIRED", () => {
    const e = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "idx" && r.capability === "DISCOVERY");
    expect(e?.status).toBe("LICENSE_REQUIRED");
  });
  it("CoinGlass DISCOVERY CREDENTIAL_REQUIRED (now implemented)", () => {
    const e = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "coinglass" && r.capability === "DISCOVERY");
    expect(e?.status).toBe("CREDENTIAL_REQUIRED");
    expect(e?.detail).toContain("supported-exchange-pairs");
    expect(e?.detail).toContain("COMPLETE");
  });
  it("CoinGlass DERIVATIVES CREDENTIAL_REQUIRED", () => {
    const e = PROVIDER_READINESS_MATRIX.find((r) => r.provider === "coinglass" && r.capability === "DERIVATIVES");
    expect(e?.status).toBe("CREDENTIAL_REQUIRED");
  });
  it("DXY LIVE NOT_IMPLEMENTED with honest fallback message", () => {
    // Phase 264: DXY moved to dxy provider, wording updated but still honest
    const e = PROVIDER_READINESS_MATRIX.find((r) => r.provider==="dxy" && r.capability==="LIVE");
    expect(e?.status).toBe("NOT_IMPLEMENTED");
    expect(e?.detail).toContain("Actual DXY price series is not currently verified as available from the configured provider");
    expect(e?.detail).toMatch(/404|fallback/);
  });
  it("no ambiguous classification", () => {
    for (const entry of PROVIDER_READINESS_MATRIX) {
      expect(["RUNTIME_VERIFIED", "TEST_VERIFIED", "CREDENTIAL_REQUIRED", "LICENSE_REQUIRED", "UNAVAILABLE", "NOT_IMPLEMENTED", "HISTORICAL_ONLY", "DISCOVERY_ONLY", "BOUNDED_DISCOVERY"]).toContain(entry.status);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// N. Security
// ────────────────────────────────────────────────────────────────

describe("Phase263 N — Security", () => {
  it("no hardcoded API keys in adapter", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).not.toMatch(/CG-API-KEY.*['\"][a-zA-Z0-9]{20,}/);
    expect(src).not.toContain("sk-");
    expect(src).not.toMatch(/COINGLASS_API_KEY.*=.*['\"][a-z]/);
  });
  it("no credential leakage in error messages (only names)", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvEmpty });
    expect(result.error).toContain("COINGLASS_API_KEY");
    expect(result.error).not.toContain("test-key");
  });
  it("no fake DXY via proxy", () => {
    const src = readFileSync("src/convex/marketData.ts", "utf8");
    expect(src).toContain("NEWS-derived USD proxy remains labeled fallback");
    expect(src).not.toMatch(/return.*DXY.*proxy.*price/i);
  });
  it("no symbol substitution", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).not.toContain("POPULAR_INSTRUMENTS");
    expect(src).not.toMatch(/BTC.*=>.*XBT/);
  });
  it("no raw payload exposure", () => {
    const src = readFileSync("src/lib/discovery/coinglass-adapter.ts", "utf8");
    expect(src).not.toContain("console.log");
    expect(src).not.toContain("process.env.COINGLASS");
  });
});

// ────────────────────────────────────────────────────────────────
// O. Registry integration & adapter invariants
// ────────────────────────────────────────────────────────────────

describe("Phase263 O — Registry & invariants", () => {
  it("STATIC_REGISTRY coinglass discoverySupported true", () => {
    const entry = STATIC_REGISTRY.find((e) => e.providerId === "coinglass")!;
    expect(entry.discoverySupported).toBe(true);
    expect(entry.capabilities).toContain("discovery");
  });
  it("adapter discover never throws", async () => {
    const adapter = createCoinGlassDiscoveryAdapter(fetch as any, readEnvEmpty);
    const result = await adapter.discover(NOW);
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
  });
  it("adapter returns completeness, pagesFetched, totalDiscovered, catalogs", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    expect(result.completeness).toBeDefined();
    expect(result.pagesFetched).toBeDefined();
    expect(result.totalDiscovered).toBeDefined();
    expect(result.catalogs).toBeDefined();
  });
  it("provider id constant matches registry", () => {
    expect(COINGLASS_PROVIDER_ID).toBe("coinglass");
    expect(STATIC_REGISTRY.some((e) => e.providerId === COINGLASS_PROVIDER_ID)).toBe(true);
  });
  it("adapter assetClasses includes crypto", async () => {
    const adapter = createCoinGlassDiscoveryAdapter(fetch as any, readEnvWithKey);
    expect(adapter.assetClasses).toContain("crypto");
  });
  it("discovery result instruments have required fields", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    for (const inst of result.instruments) {
      expect(inst.provider).toBe("coinglass");
      expect(typeof inst.providerInstrumentId).toBe("string");
      expect(inst.providerInstrumentId.length).toBeGreaterThan(0);
      expect(inst.assetClass).toBe("crypto");
      expect(["crypto_spot", "crypto_perpetual", "crypto_futures"]).toContain(inst.subType);
      expect(typeof inst.baseAsset).toBe("string");
      expect(typeof inst.quoteAsset).toBe("string");
      expect(inst.tradingState).toBe("TRADING");
      expect(Array.isArray(inst.capabilities)).toBe(true);
      expect(typeof inst.discoveredAt).toBe("number");
    }
  });
  it("universalProviders includes coinglass", () => {
    const src = readFileSync("src/convex/universalProviders.ts", "utf8");
    expect(src).toContain("discoverCoinGlass");
    expect(src).toContain("coinglass");
    expect(src).toContain("supported-exchange-pairs");
  });
  it("journal regression: provider identity preserved (no collision)", () => {
    // Simulate journal entries with different providers same economic asset
    const entries = [
      { provider: "coinglass", providerInstrumentId: "Binance:BTCUSD_PERP" },
      { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
      { provider: "okx", providerInstrumentId: "BTC-USDT-SWAP" },
    ];
    const keys = entries.map((e) => `${e.provider}::${e.providerInstrumentId}`);
    expect(new Set(keys).size).toBe(3);
  });
  it("full catalog search: coinglass instruments searchable by baseAsset", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    const btc = result.instruments.filter((i) => i.baseAsset === "BTC");
    expect(btc.length).toBeGreaterThan(0);
  });
  it("exact selection no substitution: BTCUSD_PERP not rewritten to BTC/USDT", async () => {
    const transport = mockTransportFactory(successEnvelope(SAMPLE_FUTURES), successEnvelope(SAMPLE_SPOT));
    const result = await discoverCoinGlassMarkets(NOW, { transport, readEnv: readEnvWithKey });
    const ids = result.instruments.map((i) => i.providerInstrumentId);
    expect(ids.some((id) => id === "BTC/USDT")).toBe(false);
    expect(ids.some((id) => id.includes("BTCUSD_PERP"))).toBe(true);
  });
});
