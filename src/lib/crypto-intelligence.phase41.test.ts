/**
 * PHASE 41 — Crypto Intelligence & Fundamental Data Architecture
 *
 * Comprehensive validation of the crypto intelligence layer:
 * provider adapters, symbol mapping, response parsing, data normalization,
 * freshness, missing data, evidence derivation, double-counting detection,
 * decision immutability, instrument isolation, and no fabrication.
 *
 * CRITICAL DESIGN:
 *   1. Crypto intelligence is INFORMATIONAL_ONLY — it cannot modify
 *      bias, conviction, gates, trade plan, or recommendation.
 *   2. Provider availability NEVER becomes directional evidence.
 *   3. Missing data remains neutral.
 *   4. No synthetic fundamentals.
 */
import { describe, it, expect } from "vitest";

// ─── Imports ──────────────────────────────────────────────────────
import {
  toCoinGlassSymbol,
  toDefiLlamaId,
  toTokenomistSymbol,
  isCryptoInstrument,
  getSupportedCryptoInstruments,
} from "./data/crypto/symbols";
import {
  CoinGlassAdapter,
  parseCoinGlassResult,
} from "./data/crypto/coinglass-adapter";
import {
  DeFiLlamaAdapter,
  parseDeFiLlamaResult,
} from "./data/crypto/defillama-adapter";
import {
  TokenomistAdapter,
  parseTokenomistResult,
} from "./data/crypto/tokenomist-adapter";
import {
  deriveDerivativesEvidence,
  deriveDeFiEvidence,
  deriveTokenomicsEvidence,
  detectDoubleCounting,
} from "./data/crypto/evidence";
import { buildCryptoIntelligenceContext } from "./data/crypto/intelligence";
import type {
  CryptoIntelligenceContext,
  DerivativesIntelligence,
  DeFiIntelligence,
  TokenomicsIntelligence,
} from "./data/crypto/types";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";
import { buildMtfContext } from "./data/mtf";

// ─── Fixture Helpers ──────────────────────────────────────────────
function bullCandles(startPrice = 100, interval = 1, count = 210) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: Date.now() - (count - i) * 60_000,
    open: startPrice + i * interval,
    high: startPrice + i * interval + interval * 0.5,
    low: startPrice + i * interval - interval * 0.3,
    close: startPrice + i * interval + interval * 0.2,
    volume: 1000 + i * 10,
  }));
}

function buildInput(instrument: string, instrumentType: "forex" | "crypto" | "commodity" | "stock", extra?: Partial<AnalysisInput>): AnalysisInput {
  const c = bullCandles();
  const technical = calculateTechnical(c);
  technical.smc = computeSmcContext(c, "D1");
  technical.mtf = buildMtfContext("D1", [{ timeframe: "D1", role: "setup" as const, candles: c }]);
  return { instrument, instrumentType, timeframe: "D1", tradingStyle: "swing", candles: c, technicalData: technical, ...extra } as AnalysisInput;
}

// ═══════════════════════════════════════════════════════════════════
// A. Provider Adapters
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Provider Adapters", () => {
  it("CoinGlassAdapter exists and is constructable", () => {
    const adapter = new CoinGlassAdapter();
    expect(adapter.name).toBe("CoinGlass");
  });

  it("DeFiLlamaAdapter exists and is constructable", () => {
    const adapter = new DeFiLlamaAdapter();
    expect(adapter.name).toBe("DeFiLlama");
  });

  it("TokenomistAdapter exists and is constructable", () => {
    const adapter = new TokenomistAdapter();
    expect(adapter.name).toBe("Tokenomist");
  });

  it("all adapters implement CryptoIntelligenceProvider interface", () => {
    const cg = new CoinGlassAdapter();
    const dl = new DeFiLlamaAdapter();
    const tm = new TokenomistAdapter();
    for (const adapter of [cg, dl, tm]) {
      expect(typeof adapter.name).toBe("string");
      expect(typeof adapter.supportsInstrument).toBe("function");
      expect(typeof adapter.fetch).toBe("function");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Symbol Mapping
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Symbol Mapping", () => {
  describe("CoinGlass", () => {
    it("BTC/USD → BTC", () => { expect(toCoinGlassSymbol("BTC/USD")).toBe("BTC"); });
    it("ETH/USD → ETH", () => { expect(toCoinGlassSymbol("ETH/USD")).toBe("ETH"); });
    it("SOL/USD → SOL", () => { expect(toCoinGlassSymbol("SOL/USD")).toBe("SOL"); });
    it("DOGE/USD → DOGE", () => { expect(toCoinGlassSymbol("DOGE/USD")).toBe("DOGE"); });
    it("EUR/USD → null (not crypto)", () => { expect(toCoinGlassSymbol("EUR/USD")).toBeNull(); });
    it("AAPL → null (not crypto)", () => { expect(toCoinGlassSymbol("AAPL")).toBeNull(); });
    it("XAU/USD → null (not crypto)", () => { expect(toCoinGlassSymbol("XAU/USD")).toBeNull(); });
    it("case insensitive", () => { expect(toCoinGlassSymbol("btc/usd")).toBe("BTC"); });
  });

  describe("DeFiLlama", () => {
    it("BTC/USD → bitcoin/chain", () => { const m = toDefiLlamaId("BTC/USD"); expect(m).toBeDefined(); expect(m!.slug).toBe("bitcoin"); expect(m!.level).toBe("chain"); });
    it("ETH/USD → ethereum/chain", () => { const m = toDefiLlamaId("ETH/USD"); expect(m).toBeDefined(); expect(m!.slug).toBe("ethereum"); });
    it("SOL/USD → solana/chain", () => { const m = toDefiLlamaId("SOL/USD"); expect(m).toBeDefined(); expect(m!.slug).toBe("solana"); });
    it("EUR/USD → null", () => { expect(toDefiLlamaId("EUR/USD")).toBeNull(); });
    it("AAPL → null", () => { expect(toDefiLlamaId("AAPL")).toBeNull(); });
  });

  describe("Tokenomist", () => {
    it("BTC/USD → BTC", () => { expect(toTokenomistSymbol("BTC/USD")).toBe("BTC"); });
    it("ETH/USD → ETH", () => { expect(toTokenomistSymbol("ETH/USD")).toBe("ETH"); });
    it("EUR/USD → null", () => { expect(toTokenomistSymbol("EUR/USD")).toBeNull(); });
    it("AAPL → null", () => { expect(toTokenomistSymbol("AAPL")).toBeNull(); });
  });

  describe("isCryptoInstrument", () => {
    it("BTC/USD → true", () => { expect(isCryptoInstrument("BTC/USD")).toBe(true); });
    it("ETH/USD → true", () => { expect(isCryptoInstrument("ETH/USD")).toBe(true); });
    it("EUR/USD → false", () => { expect(isCryptoInstrument("EUR/USD")).toBe(false); });
    it("XAU/USD → false", () => { expect(isCryptoInstrument("XAU/USD")).toBe(false); });
    it("AAPL → false", () => { expect(isCryptoInstrument("AAPL")).toBe(false); });
  });

  describe("getSupportedCryptoInstruments", () => {
    it("returns array", () => { const list = getSupportedCryptoInstruments(); expect(Array.isArray(list)).toBe(true); expect(list.length).toBeGreaterThan(0); });
    it("includes BTC/USD", () => { expect(getSupportedCryptoInstruments()).toContain("BTC/USD"); });
    it("does not include EUR/USD", () => { expect(getSupportedCryptoInstruments()).not.toContain("EUR/USD"); });
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Response Parsing
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Response Parsing", () => {
  describe("parseCoinGlassResult", () => {
    it("full data → verified quality", () => {
      const data = {
        openInterest: { current: 1e6, change1h: 3.5 },
        fundingRate: { currentRate: 0.0005, annualizedRate: 0.55 },
        liquidations: { totalVolume: 5e6, dominantSide: "longs" as const },
        longShort: { accountRatio: 1.3 },
        availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
        confidence: "high",
        freshness: "delayed",
      };
      const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
      expect(result.available).toBe(true);
      expect(result.quality).toBe("VERIFIED");
      expect(result.openInterest?.current).toBe(1e6);
      expect(result.fundingRate?.currentRate).toBe(0.0005);
      expect(result.liquidation?.dominantSide).toBe("longs");
      expect(result.positioning?.accountRatio).toBe(1.3);
      expect(result.availableDatasets).toBe(4);
    });

    it("partial data → degraded quality", () => {
      const data = {
        openInterest: { current: 500000 },
        availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
        confidence: "low",
        freshness: "delayed",
      };
      const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
      expect(result.available).toBe(true);
      expect(result.quality).toBe("DEGRADED");
      expect(result.availableDatasets).toBe(1);
    });

    it("no data → unavailable", () => {
      const data = {
        availability: { openInterest: false, fundingRate: false, longShort: false, liquidations: false },
        confidence: "unavailable",
        freshness: "unavailable",
      };
      const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
      expect(result.available).toBe(false);
      expect(result.quality).toBe("UNAVAILABLE");
      expect(result.availableDatasets).toBe(0);
    });

    it("extreme funding detected", () => {
      const data = {
        fundingRate: { currentRate: 0.005, annualizedRate: 5.5 },
        availability: { openInterest: false, fundingRate: true, longShort: false, liquidations: false },
        confidence: "medium",
        freshness: "delayed",
      };
      const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
      expect(result.fundingRate?.isExtreme).toBe(true);
    });

    it("normal funding not extreme", () => {
      const data = {
        fundingRate: { currentRate: 0.0001, annualizedRate: 0.11 },
        availability: { openInterest: false, fundingRate: true, longShort: false, liquidations: false },
        confidence: "low",
        freshness: "delayed",
      };
      const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
      expect(result.fundingRate?.isExtreme).toBe(false);
    });
  });

  describe("parseDeFiLlamaResult", () => {
    it("full data → verified", () => {
      const data = {
        tvl: { current: 50e9, change7d: 5.2, change30d: 15.3 },
        fees: { dailyFees: 2e6, dailyRevenue: 200000 },
        availableDatasets: 2,
        totalDatasets: 2,
      };
      const result = parseDeFiLlamaResult(data, "ETH/USD", Date.now());
      expect(result.available).toBe(true);
      expect(result.quality).toBe("VERIFIED");
      expect(result.tvl?.current).toBe(50e9);
      expect(result.tvl?.change7d).toBe(5.2);
      expect(result.fees?.dailyFees).toBe(2e6);
    });

    it("partial data → degraded", () => {
      const data = {
        tvl: { current: 1e9 },
        availableDatasets: 1,
        totalDatasets: 2,
      };
      const result = parseDeFiLlamaResult(data, "ETH/USD", Date.now());
      expect(result.quality).toBe("DEGRADED");
    });

    it("no data → unavailable", () => {
      const data = { availableDatasets: 0, totalDatasets: 2 };
      const result = parseDeFiLlamaResult(data, "ETH/USD", Date.now());
      expect(result.available).toBe(false);
      expect(result.quality).toBe("UNAVAILABLE");
    });
  });

  describe("parseTokenomistResult", () => {
    it("full data → verified", () => {
      const data = {
        supply: { circulatingSupply: 1e9, totalSupply: 2e9, circulatingPercent: 50 },
        unlocks: { upcomingCount30d: 3, upcomingValue30d: 5e6, summary: "3 unlocks" },
        availableDatasets: 2,
        totalDatasets: 2,
      };
      const result = parseTokenomistResult(data, "SOL/USD", Date.now());
      expect(result.available).toBe(true);
      expect(result.quality).toBe("VERIFIED");
      expect(result.supply?.circulatingSupply).toBe(1e9);
      expect(result.unlocks?.upcomingCount30d).toBe(3);
    });

    it("no data → unavailable", () => {
      const data = { availableDatasets: 0, totalDatasets: 2 };
      const result = parseTokenomistResult(data, "SOL/USD", Date.now());
      expect(result.available).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. Data Normalization
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Data Normalization", () => {
  it("parseCoinGlassResult normalizes reliability flags", () => {
    const data = {
      openInterest: { current: 0 },
      fundingRate: { currentRate: NaN },
      availability: { openInterest: true, fundingRate: true, longShort: false, liquidations: false },
      confidence: "low",
      freshness: "delayed",
    };
    const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
    expect(result.openInterest?.reliable).toBe(false); // current=0 → not reliable
    expect(result.fundingRate?.reliable).toBe(false); // NaN → not reliable
  });

  it("parseCoinGlassResult preserves timestamps", () => {
    const ts = Date.now();
    const data = {
      openInterest: { current: 1e6 },
      availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
      confidence: "high",
      freshness: "delayed",
    };
    const result = parseCoinGlassResult(data, "BTC/USD", ts);
    expect(result.observedAt).toBe(ts);
  });

  it("parseDeFiLlamaResult normalizes TVL", () => {
    const data = {
      tvl: { current: 100e9, change7d: -2.5 },
      availableDatasets: 1,
      totalDatasets: 2,
    };
    const result = parseDeFiLlamaResult(data, "ETH/USD", Date.now());
    expect(result.tvl?.reliable).toBe(true);
    expect(result.tvl?.change7d).toBe(-2.5);
  });

  it("parseTokenomistResult normalizes unlock percent", () => {
    const data = {
      supply: { circulatingSupply: 1e9, totalSupply: 2e9, circulatingPercent: 50 },
      unlocks: { upcomingCount30d: 5, upcomingValue30d: 10e6 },
      availableDatasets: 2,
      totalDatasets: 2,
    };
    const result = parseTokenomistResult(data, "SOL/USD", Date.now());
    expect(result.unlocks?.unlockPercentOfCirculating).toBeCloseTo(1.0, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. Freshness
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Freshness", () => {
  it("CoinGlass FRESH", () => {
    const data = {
      openInterest: { current: 1e6 },
      availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
      confidence: "high",
      freshness: "realtime",
    };
    expect(parseCoinGlassResult(data, "BTC/USD", Date.now()).freshness).toBe("FRESH");
  });

  it("CoinGlass DELAYED", () => {
    const data = {
      openInterest: { current: 1e6 },
      availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
      confidence: "medium",
      freshness: "delayed",
    };
    expect(parseCoinGlassResult(data, "BTC/USD", Date.now()).freshness).toBe("DELAYED");
  });

  it("CoinGlass STALE", () => {
    const data = {
      openInterest: { current: 1e6 },
      availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
      confidence: "low",
      freshness: "stale",
    };
    expect(parseCoinGlassResult(data, "BTC/USD", Date.now()).freshness).toBe("STALE");
  });

  it("CoinGlass UNAVAILABLE when no freshness", () => {
    const data = {
      openInterest: { current: 1e6 },
      availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
      confidence: "low",
    };
    expect(parseCoinGlassResult(data, "BTC/USD", Date.now()).freshness).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. Missing Data
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Missing Data", () => {
  it("CoinGlass with no openInterest → undefined", () => {
    const data = {
      availability: { openInterest: false, fundingRate: false, longShort: false, liquidations: false },
      confidence: "unavailable",
      freshness: "unavailable",
    };
    const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
    expect(result.openInterest).toBeUndefined();
    expect(result.fundingRate).toBeUndefined();
    expect(result.liquidation).toBeUndefined();
    expect(result.positioning).toBeUndefined();
  });

  it("DeFiLlama with no TVL → undefined", () => {
    const data = { availableDatasets: 0, totalDatasets: 2 };
    const result = parseDeFiLlamaResult(data, "ETH/USD", Date.now());
    expect(result.tvl).toBeUndefined();
    expect(result.fees).toBeUndefined();
  });

  it("Tokenomist with no supply → undefined", () => {
    const data = { availableDatasets: 0, totalDatasets: 2 };
    const result = parseTokenomistResult(data, "SOL/USD", Date.now());
    expect(result.supply).toBeUndefined();
    expect(result.unlocks).toBeUndefined();
  });

  it("missing data does not become directional evidence", () => {
    const evidence = deriveDerivativesEvidence({
      provider: "CoinGlass",
      observedAt: Date.now(),
      freshness: "UNAVAILABLE",
      quality: "UNAVAILABLE",
      available: false,
      failureReason: "API key missing",
      availableDatasets: 0,
      totalDatasets: 4,
    });
    expect(evidence).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. Malformed Data
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Malformed Data", () => {
  it("CoinGlass with NaN values → not reliable", () => {
    const data = {
      openInterest: { current: NaN, change1h: Infinity },
      fundingRate: { currentRate: "not-a-number" },
      availability: { openInterest: true, fundingRate: true, longShort: false, liquidations: false },
      confidence: "low",
      freshness: "delayed",
    };
    const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
    expect(result.openInterest?.reliable).toBe(false);
    expect(result.fundingRate?.reliable).toBe(false);
  });

  it("CoinGlass with negative OI → not reliable", () => {
    const data = {
      openInterest: { current: -100 },
      availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
      confidence: "low",
      freshness: "delayed",
    };
    const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
    expect(result.openInterest?.reliable).toBe(false);
  });

  it("DeFiLlama with negative TVL → not reliable", () => {
    const data = {
      tvl: { current: -100 },
      availableDatasets: 1,
      totalDatasets: 2,
    };
    const result = parseDeFiLlamaResult(data, "ETH/USD", Date.now());
    expect(result.tvl?.reliable).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. Rate Limiting
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Rate Limiting", () => {
  it("CoinGlass rate limit → graceful degradation", async () => {
    const adapter = new CoinGlassAdapter(async () => ({
      success: false,
      provider: "CoinGlass",
      observedAt: Date.now(),
      error: "CoinGlass rate limit exceeded",
      errorCode: "RATE_LIMIT",
    }));
    const result = await adapter.fetch("BTC/USD");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.errorCode).toBe("RATE_LIMIT");
  });
});

// ═══════════════════════════════════════════════════════════════════
// I. Timeout
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Timeout", () => {
  it("CoinGlass timeout → graceful degradation", async () => {
    const adapter = new CoinGlassAdapter(async () => {
      throw new Error("ETIMEDOUT");
    });
    const result = await adapter.fetch("BTC/USD");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.errorCode).toBe("NETWORK_ERROR");
  });

  it("DeFiLlama timeout → graceful degradation", async () => {
    const adapter = new DeFiLlamaAdapter(async () => {
      throw new Error("ETIMEDOUT");
    });
    const result = await adapter.fetch("ETH/USD");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.errorCode).toBe("NETWORK_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════
// J. Partial Provider Success
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Partial Provider Success", () => {
  it("CoinGlass with partial datasets → degraded", async () => {
    const adapter = new CoinGlassAdapter(async () => ({
      success: true,
      provider: "CoinGlass",
      observedAt: Date.now(),
      data: {
        openInterest: { current: 1e6 },
        availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
        confidence: "low",
        freshness: "delayed",
      },
    }));
    const result = await adapter.fetch("BTC/USD");
    expect(result!.success).toBe(true);
    const parsed = parseCoinGlassResult(result!.data as Record<string, any>, "BTC/USD", result!.observedAt);
    expect(parsed.quality).toBe("DEGRADED");
    expect(parsed.availableDatasets).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// K. Cross-Instrument Isolation
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Cross-Instrument Isolation", () => {
  it("CoinGlass only supports crypto", () => {
    const adapter = new CoinGlassAdapter();
    expect(adapter.supportsInstrument("BTC/USD")).toBe(true);
    expect(adapter.supportsInstrument("EUR/USD")).toBe(false);
    expect(adapter.supportsInstrument("XAU/USD")).toBe(false);
    expect(adapter.supportsInstrument("AAPL")).toBe(false);
  });

  it("DeFiLlama only supports crypto", () => {
    const adapter = new DeFiLlamaAdapter();
    expect(adapter.supportsInstrument("BTC/USD")).toBe(true);
    expect(adapter.supportsInstrument("EUR/USD")).toBe(false);
    expect(adapter.supportsInstrument("AAPL")).toBe(false);
  });

  it("Tokenomist only supports crypto", () => {
    const adapter = new TokenomistAdapter();
    expect(adapter.supportsInstrument("BTC/USD")).toBe(true);
    expect(adapter.supportsInstrument("EUR/USD")).toBe(false);
  });

  it("non-crypto fetch returns null", async () => {
    const cg = new CoinGlassAdapter(async () => ({ success: true, provider: "CG", observedAt: Date.now(), data: {} }));
    const dl = new DeFiLlamaAdapter(async () => ({ ok: true, json: async () => ({}) } as any));
    const tm = new TokenomistAdapter(async () => ({ ok: true, json: async () => ({}) } as any));
    expect(await cg.fetch("EUR/USD")).toBeNull();
    expect(await dl.fetch("EUR/USD")).toBeNull();
    expect(await tm.fetch("EUR/USD")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// L. Crypto/Non-Crypto Separation
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Crypto/Non-Crypto Separation", () => {
  it("buildCryptoIntelligenceContext returns null for non-crypto", () => {
    expect(buildCryptoIntelligenceContext("EUR/USD")).toBeNull();
    expect(buildCryptoIntelligenceContext("XAU/USD")).toBeNull();
    expect(buildCryptoIntelligenceContext("AAPL")).toBeNull();
  });

  it("buildCryptoIntelligenceContext returns context for crypto", () => {
    const ctx = buildCryptoIntelligenceContext("BTC/USD");
    expect(ctx).not.toBeNull();
    expect(ctx!.instrument).toBe("BTC/USD");
    expect(ctx!.instrumentType).toBe("crypto");
  });
});

// ═══════════════════════════════════════════════════════════════════
// M. Evidence Classification
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Evidence Classification", () => {
  it("derives evidence from derivatives", () => {
    const derivatives: DerivativesIntelligence = {
      provider: "CoinGlass",
      observedAt: Date.now(),
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      openInterest: { current: 1e6, change1h: 5.0, reliable: true },
      fundingRate: { currentRate: 0.002, isExtreme: true, reliable: true },
      liquidation: { totalVolume: 10e6, dominantSide: "longs", reliable: true },
      positioning: { accountRatio: 1.8, reliable: true },
      availableDatasets: 4,
      totalDatasets: 4,
    };
    const evidence = deriveDerivativesEvidence(derivatives);
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) {
      expect(["SUPPORTING", "CONFLICTING", "NEUTRAL", "UNAVAILABLE"]).toContain(e.direction);
      expect(["STRONG", "MODERATE", "WEAK", "UNKNOWN"]).toContain(e.strength);
      expect(["VERIFIED", "DEGRADED", "STALE", "INSUFFICIENT", "UNAVAILABLE"]).toContain(e.quality);
      expect(["DERIVATIVES", "DEFI_FUNDAMENTAL", "TOKENOMICS", "ON_CHAIN", "LIQUIDITY", "SUPPLY_DYNAMICS"]).toContain(e.category);
    }
  });

  it("derives evidence from DeFi", () => {
    const defi: DeFiIntelligence = {
      provider: "DeFiLlama",
      observedAt: Date.now(),
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      tvl: { current: 50e9, change7d: 10, reliable: true },
      fees: { dailyFees: 1e6, reliable: true },
      availableDatasets: 2,
      totalDatasets: 2,
    };
    const evidence = deriveDeFiEvidence(defi);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.some((e) => e.dependencyGroup === "DEFI_TVL")).toBe(true);
  });

  it("derives evidence from tokenomics", () => {
    const tokenomics: TokenomicsIntelligence = {
      provider: "Tokenomist",
      observedAt: Date.now(),
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      unlocks: { upcomingCount30d: 5, reliable: true, summary: "5 unlocks" },
      availableDatasets: 1,
      totalDatasets: 2,
    };
    const evidence = deriveTokenomicsEvidence(tokenomics);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.some((e) => e.dependencyGroup === "TOKENOMICS_UNLOCK")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// N. Dependency Groups
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Dependency Groups", () => {
  it("each evidence item has a dependency group", () => {
    const derivatives: DerivativesIntelligence = {
      provider: "CoinGlass", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      openInterest: { current: 1e6, reliable: true },
      fundingRate: { currentRate: 0.001, isExtreme: false, reliable: true },
      availableDatasets: 2, totalDatasets: 4,
    };
    const evidence = deriveDerivativesEvidence(derivatives);
    for (const e of evidence) {
      expect(typeof e.dependencyGroup).toBe("string");
      expect(e.dependencyGroup.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// O. Double-Counting Detection
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Double-Counting Detection", () => {
  it("no double-counting with unique groups", () => {
    const evidence = [
      { dependencyGroup: "DERIVATIVES_OI" as const, source: "CG", category: "DERIVATIVES" as const, direction: "SUPPORTING" as const, strength: "MODERATE" as const, quality: "VERIFIED" as const, freshness: "FRESH" as const, explanation: "test", providerAvailable: true },
      { dependencyGroup: "DERIVATIVES_FUNDING" as const, source: "CG", category: "DERIVATIVES" as const, direction: "CONFLICTING" as const, strength: "WEAK" as const, quality: "VERIFIED" as const, freshness: "FRESH" as const, explanation: "test", providerAvailable: true },
    ];
    const warnings = detectDoubleCounting(evidence);
    expect(warnings).toHaveLength(0);
  });

  it("detects double-counting in same group", () => {
    const evidence = [
      { dependencyGroup: "DERIVATIVES_OI" as const, source: "CG", category: "DERIVATIVES" as const, direction: "SUPPORTING" as const, strength: "MODERATE" as const, quality: "VERIFIED" as const, freshness: "FRESH" as const, explanation: "test1", providerAvailable: true },
      { dependencyGroup: "DERIVATIVES_OI" as const, source: "CG", category: "DERIVATIVES" as const, direction: "CONFLICTING" as const, strength: "WEAK" as const, quality: "VERIFIED" as const, freshness: "FRESH" as const, explanation: "test2", providerAvailable: true },
    ];
    const warnings = detectDoubleCounting(evidence);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].dependencyGroup).toBe("DERIVATIVES_OI");
    expect(warnings[0].count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// P. Token Unlock Neutrality
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Token Unlock Neutrality", () => {
  it("upcoming unlock → NEUTRAL direction (not bearish)", () => {
    const tokenomics: TokenomicsIntelligence = {
      provider: "Tokenomist", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      unlocks: { upcomingCount30d: 10, upcomingValue30d: 100e6, unlockPercentOfCirculating: 5, reliable: true, summary: "10 unlocks" },
      availableDatasets: 1, totalDatasets: 2,
    };
    const evidence = deriveTokenomicsEvidence(tokenomics);
    const unlockEvidence = evidence.find((e) => e.dependencyGroup === "TOKENOMICS_UNLOCK");
    expect(unlockEvidence).toBeDefined();
    expect(unlockEvidence!.direction).toBe("NEUTRAL");
  });

  it("no upcoming unlock → NEUTRAL direction (not bullish)", () => {
    const tokenomics: TokenomicsIntelligence = {
      provider: "Tokenomist", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      unlocks: { upcomingCount30d: 0, reliable: true, summary: "No unlocks" },
      availableDatasets: 1, totalDatasets: 2,
    };
    const evidence = deriveTokenomicsEvidence(tokenomics);
    const unlockEvidence = evidence.find((e) => e.dependencyGroup === "TOKENOMICS_UNLOCK");
    expect(unlockEvidence).toBeDefined();
    expect(unlockEvidence!.direction).toBe("NEUTRAL");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Q. Derivatives Neutrality
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Derivatives Neutrality", () => {
  it("positive funding → context, not automatic bearish", () => {
    const derivatives: DerivativesIntelligence = {
      provider: "CoinGlass", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      fundingRate: { currentRate: 0.003, isExtreme: true, reliable: true },
      availableDatasets: 1, totalDatasets: 4,
    };
    const evidence = deriveDerivativesEvidence(derivatives);
    const fundingEvidence = evidence.find((e) => e.dependencyGroup === "DERIVATIVES_FUNDING");
    expect(fundingEvidence).toBeDefined();
    // Extreme positive funding is conflicting (overcrowded longs), not bullish
    expect(fundingEvidence!.direction).toBe("CONFLICTING");
  });

  it("normal funding → NEUTRAL", () => {
    const derivatives: DerivativesIntelligence = {
      provider: "CoinGlass", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      fundingRate: { currentRate: 0.0001, isExtreme: false, reliable: true },
      availableDatasets: 1, totalDatasets: 4,
    };
    const evidence = deriveDerivativesEvidence(derivatives);
    const fundingEvidence = evidence.find((e) => e.dependencyGroup === "DERIVATIVES_FUNDING");
    expect(fundingEvidence!.direction).toBe("NEUTRAL");
  });

  it("rising OI → context, not automatic bullish", () => {
    const derivatives: DerivativesIntelligence = {
      provider: "CoinGlass", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      openInterest: { current: 1e6, change1h: 5.0, reliable: true },
      availableDatasets: 1, totalDatasets: 4,
    };
    const evidence = deriveDerivativesEvidence(derivatives);
    const oiEvidence = evidence.find((e) => e.dependencyGroup === "DERIVATIVES_OI");
    expect(oiEvidence).toBeDefined();
    // Rising OI is "supporting" only in context — it's a positioning signal, not a directional one
    expect(["SUPPORTING", "NEUTRAL"]).toContain(oiEvidence!.direction);
  });
});

// ═══════════════════════════════════════════════════════════════════
// R. Fundamental Neutrality
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Fundamental Neutrality", () => {
  it("rising TVL → context, not guaranteed bullish", () => {
    const defi: DeFiIntelligence = {
      provider: "DeFiLlama", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      tvl: { current: 50e9, change7d: 15, reliable: true },
      availableDatasets: 1, totalDatasets: 2,
    };
    const evidence = deriveDeFiEvidence(defi);
    const tvlEvidence = evidence.find((e) => e.dependencyGroup === "DEFI_TVL");
    expect(tvlEvidence).toBeDefined();
    expect(["SUPPORTING", "NEUTRAL"]).toContain(tvlEvidence!.direction);
  });

  it("no TVL data → no evidence (not fabricated)", () => {
    const defi: DeFiIntelligence = {
      provider: "DeFiLlama", observedAt: Date.now(), freshness: "UNAVAILABLE", quality: "UNAVAILABLE", available: false,
      availableDatasets: 0, totalDatasets: 2,
    };
    const evidence = deriveDeFiEvidence(defi);
    expect(evidence).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// S. Futures vs Investor View Consistency
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Futures vs Investor View Consistency", () => {
  it("same instrument produces consistent context for both views", () => {
    const derivatives: DerivativesIntelligence = {
      provider: "CoinGlass", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      openInterest: { current: 1e6, change1h: 3.0, reliable: true },
      fundingRate: { currentRate: 0.001, isExtreme: false, reliable: true },
      availableDatasets: 2, totalDatasets: 4,
    };
    const defi: DeFiIntelligence = {
      provider: "DeFiLlama", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true,
      tvl: { current: 50e9, change7d: 5.0, reliable: true },
      availableDatasets: 1, totalDatasets: 2,
    };
    const ctx = buildCryptoIntelligenceContext("BTC/USD", derivatives, defi);
    expect(ctx).not.toBeNull();
    // Both views reference the same underlying facts
    expect(ctx!.derivatives?.openInterest?.current).toBe(1e6);
    expect(ctx!.defi?.tvl?.current).toBe(50e9);
  });
});

// ═══════════════════════════════════════════════════════════════════
// T. Determinism
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Determinism", () => {
  it("parseCoinGlassResult is deterministic for same input", () => {
    const data = {
      openInterest: { current: 1e6, change1h: 3.5 },
      fundingRate: { currentRate: 0.0005 },
      availability: { openInterest: true, fundingRate: true, longShort: false, liquidations: false },
      confidence: "medium",
      freshness: "delayed",
    };
    const ts = 12345;
    const r1 = parseCoinGlassResult(data, "BTC/USD", ts);
    const r2 = parseCoinGlassResult(data, "BTC/USD", ts);
    expect(r1.available).toBe(r2.available);
    expect(r1.quality).toBe(r2.quality);
    expect(r1.openInterest?.current).toBe(r2.openInterest?.current);
    expect(r1.fundingRate?.currentRate).toBe(r2.fundingRate?.currentRate);
    expect(r1.availableDatasets).toBe(r2.availableDatasets);
  });

  it("evidence derivation is deterministic", () => {
    const derivatives: DerivativesIntelligence = {
      provider: "CoinGlass", observedAt: 100, freshness: "FRESH", quality: "VERIFIED", available: true,
      openInterest: { current: 1e6, change1h: 5.0, reliable: true },
      availableDatasets: 1, totalDatasets: 4,
    };
    const e1 = deriveDerivativesEvidence(derivatives);
    const e2 = deriveDerivativesEvidence(derivatives);
    expect(e1.length).toBe(e2.length);
    for (let i = 0; i < e1.length; i++) {
      expect(e1[i].direction).toBe(e2[i].direction);
      expect(e1[i].strength).toBe(e2[i].strength);
      expect(e1[i].dependencyGroup).toBe(e2[i].dependencyGroup);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// U. No Fabrication
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — No Fabrication", () => {
  it("unavailable provider → zero evidence", () => {
    const evidence = deriveDerivativesEvidence({
      provider: "CoinGlass", observedAt: Date.now(), freshness: "UNAVAILABLE", quality: "UNAVAILABLE",
      available: false, availableDatasets: 0, totalDatasets: 4,
    });
    expect(evidence).toHaveLength(0);
  });

  it("no fabricated OI values", () => {
    const data = { availability: { openInterest: false, fundingRate: false, longShort: false, liquidations: false }, confidence: "unavailable" };
    const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
    expect(result.openInterest).toBeUndefined();
    expect(result.fundingRate).toBeUndefined();
  });

  it("no fabricated TVL", () => {
    const data = { availableDatasets: 0, totalDatasets: 2 };
    const result = parseDeFiLlamaResult(data, "ETH/USD", Date.now());
    expect(result.tvl).toBeUndefined();
  });

  it("no fabricated unlock data", () => {
    const data = { availableDatasets: 0, totalDatasets: 2 };
    const result = parseTokenomistResult(data, "SOL/USD", Date.now());
    expect(result.unlocks).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// V. No Secrets
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — No Secrets", () => {
  it("CoinGlass adapter output contains no API keys", () => {
    const data = {
      openInterest: { current: 1e6 },
      availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false },
      confidence: "medium",
      freshness: "delayed",
    };
    const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
    const json = JSON.stringify(result);
    expect(json).not.toContain("api_key");
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("COINGLASS_API_KEY");
  });

  it("context output contains no secrets", () => {
    const ctx = buildCryptoIntelligenceContext("BTC/USD");
    if (ctx) {
      const json = JSON.stringify(ctx);
      expect(json).not.toContain("api_key");
      expect(json).not.toContain("secret");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// W. Decision Immutability
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Decision Immutability", () => {
  it("crypto intelligence does not change recommendation", () => {
    const baseInput = buildInput("BTC/USD", "crypto");
    const baseResult = runAnalysis(baseInput);
    const enrichedInput = buildInput("BTC/USD", "crypto", {
      cryptoIntelligenceContext: buildCryptoIntelligenceContext("BTC/USD")!,
    });
    const enrichedResult = runAnalysis(enrichedInput);
    expect(enrichedResult.recommendation).toBe(baseResult.recommendation);
    expect(enrichedResult.bias).toBe(baseResult.bias);
    expect(enrichedResult.confidence).toBe(baseResult.confidence);
  });

  it("crypto intelligence does not change conviction", () => {
    const baseInput = buildInput("BTC/USD", "crypto");
    const baseResult = runAnalysis(baseInput);
    const enrichedInput = buildInput("BTC/USD", "crypto", {
      cryptoIntelligenceContext: buildCryptoIntelligenceContext("BTC/USD")!,
    });
    const enrichedResult = runAnalysis(enrichedInput);
    expect(enrichedResult.conviction).toBe(baseResult.conviction);
  });

  it("crypto intelligence does not change trade plan", () => {
    const baseInput = buildInput("BTC/USD", "crypto");
    const baseResult = runAnalysis(baseInput);
    const enrichedInput = buildInput("BTC/USD", "crypto", {
      cryptoIntelligenceContext: buildCryptoIntelligenceContext("BTC/USD")!,
    });
    const enrichedResult = runAnalysis(enrichedInput);
    expect(enrichedResult.tradePlan).toEqual(baseResult.tradePlan);
  });

  it("crypto intelligence does not change decision fingerprint", () => {
    const baseInput = buildInput("BTC/USD", "crypto");
    const baseResult = runAnalysis(baseInput);
    const enrichedInput = buildInput("BTC/USD", "crypto", {
      cryptoIntelligenceContext: buildCryptoIntelligenceContext("BTC/USD")!,
    });
    const enrichedResult = runAnalysis(enrichedInput);
    expect(enrichedResult.decisionFingerprint).toBe(baseResult.decisionFingerprint);
  });

  it("non-crypto instrument: no crypto intelligence context", () => {
    const result = runAnalysis(buildInput("EUR/USD", "forex"));
    expect(result.cryptoIntelligenceContext).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// X. Journal Compatibility
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Journal Compatibility", () => {
  it("analysis result with crypto intelligence is serializable", () => {
    const input = buildInput("BTC/USD", "crypto", {
      cryptoIntelligenceContext: buildCryptoIntelligenceContext("BTC/USD")!,
    });
    const result = runAnalysis(input);
    const json = JSON.stringify(result);
    expect(json.length).toBeGreaterThan(0);
    // Can be parsed back
    const parsed = JSON.parse(json);
    expect(parsed.instrument).toBe("BTC/USD");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Y. Long-Horizon Thesis Compatibility
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Long-Horizon Thesis Compatibility", () => {
  it("long-horizon thesis still present with crypto intelligence", () => {
    const input = buildInput("BTC/USD", "crypto", {
      cryptoIntelligenceContext: buildCryptoIntelligenceContext("BTC/USD")!,
    });
    const result = runAnalysis(input);
    expect(result.longHorizonThesis).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Z. Evidence Challenge Compatibility
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Evidence Challenge Compatibility", () => {
  it("evidence challenge still present with crypto intelligence", () => {
    const input = buildInput("BTC/USD", "crypto", {
      cryptoIntelligenceContext: buildCryptoIntelligenceContext("BTC/USD")!,
    });
    const result = runAnalysis(input);
    expect(result.evidenceChallenge).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// AA. Adversarial Cases
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Adversarial Cases", () => {
  it("empty string instrument → not crypto", () => {
    expect(isCryptoInstrument("")).toBe(false);
    expect(toCoinGlassSymbol("")).toBeNull();
    expect(toDefiLlamaId("")).toBeNull();
  });

  it("undefined/null inputs handled gracefully", () => {
    const evidence = deriveDerivativesEvidence({
      provider: "CG", observedAt: Date.now(), freshness: "UNAVAILABLE", quality: "UNAVAILABLE",
      available: false, availableDatasets: 0, totalDatasets: 4,
    });
    expect(evidence).toHaveLength(0);
  });

  it("extreme values do not crash", () => {
    const data = {
      openInterest: { current: Number.MAX_SAFE_INTEGER, change1h: 1000 },
      fundingRate: { currentRate: 1.0, annualizedRate: 365 },
      liquidations: { totalVolume: Number.MAX_SAFE_INTEGER, dominantSide: "longs" as const },
      longShort: { accountRatio: 100 },
      availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
      confidence: "high",
      freshness: "delayed",
    };
    const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
    expect(result.available).toBe(true);
    expect(Number.isFinite(result.openInterest!.current)).toBe(true);
  });

  it("all zeros → not reliable but not crashed", () => {
    const data = {
      openInterest: { current: 0 },
      fundingRate: { currentRate: 0 },
      liquidations: { totalVolume: 0 },
      longShort: { accountRatio: 0 },
      availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
      confidence: "low",
      freshness: "delayed",
    };
    const result = parseCoinGlassResult(data, "BTC/USD", Date.now());
    expect(result.openInterest?.reliable).toBe(false);
    expect(result.fundingRate?.reliable).toBe(true);
    expect(result.liquidation?.reliable).toBe(false);
    expect(result.positioning?.reliable).toBe(true);
  });

  it("provider failure does not become directional evidence", async () => {
    const adapter = new CoinGlassAdapter(async () => { throw new Error("crash"); });
    const result = await adapter.fetch("BTC/USD");
    expect(result!.success).toBe(false);
    // No evidence should be derived from a failed fetch
    const parsed = parseCoinGlassResult(
      { availability: { openInterest: false, fundingRate: false, longShort: false, liquidations: false }, confidence: "unavailable" },
      "BTC/USD", Date.now(),
    );
    const evidence = deriveDerivativesEvidence(parsed);
    expect(evidence).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BB. Context Builder
// ═══════════════════════════════════════════════════════════════════
describe("Phase 41 — Context Builder", () => {
  it("all providers → FULL availability", () => {
    const ctx = buildCryptoIntelligenceContext(
      "BTC/USD",
      { provider: "CG", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 4, totalDatasets: 4 },
      { provider: "DL", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 2, totalDatasets: 2 },
      { provider: "TM", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 2, totalDatasets: 2 },
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.overallAvailability).toBe("FULL");
  });

  it("one provider → MINIMAL availability", () => {
    const ctx = buildCryptoIntelligenceContext(
      "BTC/USD",
      { provider: "CG", observedAt: Date.now(), freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 4, totalDatasets: 4 },
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.overallAvailability).toBe("MINIMAL");
  });

  it("no providers → UNAVAILABLE", () => {
    const ctx = buildCryptoIntelligenceContext("BTC/USD");
    expect(ctx).not.toBeNull();
    expect(ctx!.overallAvailability).toBe("UNAVAILABLE");
  });

  it("non-crypto → null", () => {
    expect(buildCryptoIntelligenceContext("EUR/USD")).toBeNull();
    expect(buildCryptoIntelligenceContext("AAPL")).toBeNull();
  });

  it("includes missing information", () => {
    const ctx = buildCryptoIntelligenceContext("BTC/USD");
    expect(ctx!.missingInformation.length).toBeGreaterThan(0);
    expect(ctx!.missingInformation.some((m) => m.includes("CoinGlass"))).toBe(true);
  });

  it("includes analyst summary", () => {
    const ctx = buildCryptoIntelligenceContext("BTC/USD");
    expect(typeof ctx!.analystSummary).toBe("string");
    expect(ctx!.analystSummary.length).toBeGreaterThan(0);
  });
});
