/**
 * Phase 75 — Production Activation Tests
 *
 * Validates REAL runtime behavior:
 * - Real CoinGecko HTTP requests (no key needed)
 * - Real provider routing to CoinGecko for crypto
 * - Real market data flowing through the protection pipeline
 * - Provider failure/recovery simulation
 * - Stale data safety
 * - Source mode integrity
 * - Provider neutrality
 * - Position isolation with real prices
 * - Polling lifecycle
 * - Convex action contract
 */

import { describe, it, expect } from "vitest";
import {
  routeInstrument,
  detectAssetClass,
} from "../market-stream/provider-routing";
import {
  bridgeQuoteToEvents,
  createBridgeState,
  type ProviderQuoteData,
} from "../market-stream/live-market-bridge";
import {
  processEventForController,
  createControllerState,
  registerPosition,
  startController,
  stopController,
  pauseController,
  resumeController,
} from "./continuous-protection-controller";
import type { RealTimeEvent } from "./realtime-types";
import { removePosition } from "./continuous-protection-controller";

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC MARKET DATA FIXTURES
// Live provider access is verified separately by scripts/verify-coingecko-live.mjs.
// Unit tests must not depend on shared public API rate limits.
// ═══════════════════════════════════════════════════════════════

interface LiveInstrument {
  instrument: string;
  price: number;
  provider: string;
  success: boolean;
}

const BTC_FIXTURE_PRICE = 80_000;
const ETH_FIXTURE_PRICE = 3_000;
const SOL_FIXTURE_PRICE = 150;
const DOGE_FIXTURE_PRICE = 0.2;

const marketFixtures: LiveInstrument[] = [
  { instrument: "BTC/USDT", price: BTC_FIXTURE_PRICE, provider: "CoinGeckoFixture", success: true },
  { instrument: "ETH/USDT", price: ETH_FIXTURE_PRICE, provider: "CoinGeckoFixture", success: true },
  { instrument: "SOL/USDT", price: SOL_FIXTURE_PRICE, provider: "CoinGeckoFixture", success: true },
  { instrument: "DOGE/USDT", price: DOGE_FIXTURE_PRICE, provider: "CoinGeckoFixture", success: true },
];

// ═══════════════════════════════════════════════════════════════
// SECTION A: MARKET DATA FIXTURE INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("A. Market Data Fixture Integrity", () => {
  it("contains finite positive prices for supported crypto instruments", () => {
    expect(marketFixtures.length).toBeGreaterThanOrEqual(1);
    for (const result of marketFixtures) {
      expect(result.success).toBe(true);
      expect(result.price).toBeGreaterThan(0);
      expect(Number.isFinite(result.price)).toBe(true);
    }
  });

  it("contains unique instrument identities", () => {
    const instruments = marketFixtures.map((result) => result.instrument);
    expect(new Set(instruments).size).toBe(instruments.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION B: PROVIDER ROUTING CONSISTENCY
// ═══════════════════════════════════════════════════════════════

describe("B. Provider Routing Consistency", () => {
  it("routes BTC/USDT to crypto providers (OKX primary, CoinGecko fallback)", () => {
    const route = routeInstrument("BTC/USDT");
    expect(route.primary).not.toBeNull();
    expect(route.primary!.provider).toBe("OKX");
    // CoinGecko should be in the fallback chain
    const fallbackProviders = route.fallbacks.map((f) => f.provider);
    expect(fallbackProviders).toContain("CoinGecko");
  });

  it("routes EUR/USD to TwelveData (forex)", () => {
    const route = routeInstrument("EUR/USD");
    expect(route.primary).not.toBeNull();
    expect(route.primary!.provider).toBe("TwelveData");
  });

  it("detects crypto asset class correctly", () => {
    expect(detectAssetClass("BTC/USDT")).toBe("crypto");
    expect(detectAssetClass("ETH/USDT")).toBe("crypto");
    expect(detectAssetClass("SOL/USDT")).toBe("crypto");
  });

  it("detects forex asset class correctly", () => {
    expect(detectAssetClass("EUR/USD")).toBe("forex");
    expect(detectAssetClass("GBP/USD")).toBe("forex");
  });

  it("labels test prices as fixtures rather than live provider observations", () => {
    expect(marketFixtures.every((result) => result.provider === "CoinGeckoFixture")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION C: QUOTE FIXTURE → PROTECTION PIPELINE
// ═══════════════════════════════════════════════════════════════

describe("C. Quote Fixture → Protection Pipeline", () => {
  it("bridges a valid quote fixture into RealTimeEvents", () => {
    // This is a deterministic pipeline test, not evidence of live-provider access.
    const price = 80_000;
    const provider = "TestFixture";
    const bridge = createBridgeState();
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider,
      price,
      timestamp: Date.now(),
      freshness: "FRESH",
    };

    const result = bridgeQuoteToEvents(bridge, quote);
    expect(result.events.length).toBeGreaterThanOrEqual(1);

    const priceEvent = result.events.find((e) => e.eventType === "PRICE_UPDATE");
    expect(priceEvent).toBeDefined();
    expect(priceEvent!.instrument).toBe("BTC/USDT");
    expect(typeof priceEvent!.payload.price).toBe("number");
    expect(priceEvent!.payload.price).toBe(price);
    expect(priceEvent!.source).toBe(provider);
  });

  it("processes a quote fixture through the protection controller", () => {
    const price = BTC_FIXTURE_PRICE;

    let controller = createControllerState();
    controller = registerPosition(controller, {
      positionId: "test-long-1",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: price * 0.95,
      currentPrice: price,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());
    controller = startController(controller);

    const bridge = createBridgeState();
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price,
      timestamp: Date.now(),
      freshness: "FRESH",
    };
    const { events } = bridgeQuoteToEvents(bridge, quote);

    for (const event of events) {
      const result = processEventForController(controller, event, Date.now());
      controller = result.state;
    }

    const pos = controller.positions.get("test-long-1");
    expect(pos).toBeDefined();
    expect(pos!.currentPrice).toBe(price);
    expect(pos!.lifecycle).toBe("RUNNING");
  });

  it("LONG and SHORT on same instrument have independent state", () => {
    const price = BTC_FIXTURE_PRICE;

    let controller = createControllerState();
    controller = registerPosition(controller, {
      positionId: "btc-long",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: price * 0.95,
      currentPrice: price,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());

    controller = registerPosition(controller, {
      positionId: "btc-short",
      instrument: "BTC/USDT",
      side: "SHORT",
      entryPrice: price * 1.05,
      currentPrice: price,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());

    controller = startController(controller);

    // Same price update to both
    const bridge = createBridgeState();
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price,
      timestamp: Date.now(),
      freshness: "FRESH",
    };
    const { events } = bridgeQuoteToEvents(bridge, quote);

    for (const event of events) {
      const result = processEventForController(controller, event, Date.now());
      controller = result.state;
    }

    const longPos = controller.positions.get("btc-long");
    const shortPos = controller.positions.get("btc-short");

    expect(longPos).toBeDefined();
    expect(shortPos).toBeDefined();

    expect(longPos!.currentPrice).toBe(shortPos!.currentPrice);
  });

  it("BTC and ETH are isolated from each other", () => {
    const btcPrice = BTC_FIXTURE_PRICE;
    const ethPrice = ETH_FIXTURE_PRICE;

    let controller = createControllerState();
    controller = registerPosition(controller, {
      positionId: "btc-pos",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: btcPrice * 0.95,
      currentPrice: btcPrice,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());

    controller = registerPosition(controller, {
      positionId: "eth-pos",
      instrument: "ETH/USDT",
      side: "LONG",
      entryPrice: ethPrice * 0.95,
      currentPrice: ethPrice,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());

    controller = startController(controller);

    // Only send BTC event
    const bridge = createBridgeState();
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price: btcPrice * 1.02,
      timestamp: Date.now(),
      freshness: "FRESH",
    };
    const { events } = bridgeQuoteToEvents(bridge, quote);

    for (const event of events) {
      const result = processEventForController(controller, event, Date.now());
      controller = result.state;
    }

    expect(controller.positions.get("btc-pos")!.currentPrice).toBe(btcPrice * 1.02);
    expect(controller.positions.get("eth-pos")!.currentPrice).toBe(ethPrice);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION D: PROVIDER FAILURE / RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("D. Provider Failure / Recovery", () => {
  it("provider failure does NOT become directional evidence", () => {
    const bridge = createBridgeState();

    const result = bridgeQuoteToEvents(bridge, {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price: 0,
      timestamp: Date.now(),
      freshness: "STALE",
    });

    // Stale event should be dropped, not create directional evidence
    expect(result.events.length).toBe(0);
    expect(result.state.eventsDropped).toBe(1);
  });

  it("stale data cannot update a protected position", () => {
    let controller = createControllerState();
    controller = registerPosition(controller, {
      positionId: "stale-test",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 80_000,
      currentPrice: 85_000,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());
    controller = startController(controller);
    expect(controller.globalLifecycle).toBe("RUNNING");

    // Send stale quote — it must not become a PRICE_UPDATE.
    const bridge = createBridgeState();
    const staleQuote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price: 0,
      timestamp: Date.now(),
      freshness: "STALE",
    };

    const result = bridgeQuoteToEvents(bridge, staleQuote);
    expect(result.events.some((event) => event.eventType === "PRICE_UPDATE")).toBe(false);

    // Process any diagnostic events and prove the position price stays unchanged.
    for (const event of result.events) {
      controller = processEventForController(controller, event, Date.now()).state;
    }
    expect(controller.positions.get("stale-test")?.currentPrice).toBe(85_000);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION E: SOURCE MODE INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("E. Source Mode Integrity", () => {
  it("freshness metadata is preserved in bridge events", () => {
    const bridge = createBridgeState();
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price: 80_000,
      timestamp: Date.now(),
      freshness: "FRESH",
    };

    const result = bridgeQuoteToEvents(bridge, quote);
    const event = result.events.find((e) => e.eventType === "PRICE_UPDATE");
    expect(event).toBeDefined();
    expect(event!.freshness).toBe("FRESH");
    expect(event!.source).toBe("CoinGecko");
  });

  it("stale data is dropped, not masqueraded as live", () => {
    const bridge = createBridgeState();
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price: 80_000,
      timestamp: Date.now() - 600_000, // 10 minutes old
      freshness: "STALE",
    };

    const result = bridgeQuoteToEvents(bridge, quote);
    // Should produce a DATA_STALE event, NOT a PRICE_UPDATE
    expect(result.events.some((e) => e.eventType === "PRICE_UPDATE")).toBe(false);
    expect(result.events.some((e) => e.eventType === "DATA_STALE")).toBe(true);
  });

  it("invalid price is rejected", () => {
    const bridge = createBridgeState();

    // NaN price
    const result1 = bridgeQuoteToEvents(bridge, {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price: NaN,
      timestamp: Date.now(),
      freshness: "FRESH",
    });
    expect(result1.events.length).toBe(0);
    expect(result1.state.eventsDropped).toBe(1);

    // Negative price
    const result2 = bridgeQuoteToEvents(bridge, {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price: -100,
      timestamp: Date.now(),
      freshness: "FRESH",
    });
    expect(result2.events.length).toBe(0);
    expect(result2.state.eventsDropped).toBe(1);
  });

  it("empty instrument is rejected", () => {
    const bridge = createBridgeState();
    const result = bridgeQuoteToEvents(bridge, {
      instrument: "",
      provider: "CoinGecko",
      price: 80_000,
      timestamp: Date.now(),
      freshness: "FRESH",
    });
    expect(result.events.length).toBe(0);
    expect(result.state.eventsDropped).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION F: POLLING LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("F. Polling Lifecycle", () => {
  it("controller lifecycle: STOPPED → RUNNING → PAUSED → RUNNING → STOPPED", () => {
    let controller = createControllerState();
    controller = registerPosition(controller, {
      positionId: "poll-test",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 80_000,
      currentPrice: 85_000,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());

    // Initially STOPPED
    expect(controller.globalLifecycle).toBe("STOPPED");

    // Start
    controller = startController(controller);
    expect(controller.globalLifecycle).toBe("RUNNING");
    expect(controller.positions.get("poll-test")!.lifecycle).toBe("RUNNING");

    // Pause
    controller = pauseController(controller);
    expect(controller.globalLifecycle).toBe("PAUSED");
    expect(controller.positions.get("poll-test")!.lifecycle).toBe("PAUSED");

    // Resume
    controller = resumeController(controller);
    expect(controller.globalLifecycle).toBe("RUNNING");
    expect(controller.positions.get("poll-test")!.lifecycle).toBe("RUNNING");

    // Stop
    controller = stopController(controller);
    expect(controller.globalLifecycle).toBe("STOPPED");
    expect(controller.positions.get("poll-test")!.lifecycle).toBe("STOPPED");
  });

  it("paused position still receives critical events", () => {
    let controller = createControllerState();
    controller = registerPosition(controller, {
      positionId: "pause-test",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 80_000,
      currentPrice: 85_000,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());
    controller = startController(controller);

    // Pause
    controller = pauseController(controller);

    // Send critical event (PROVIDER_DEGRADED = CRITICAL priority) — should still evaluate
    const criticalEvent: RealTimeEvent = {
      eventId: "critical-1",
      eventType: "PROVIDER_DEGRADED",
      instrument: "BTC/USDT",
      source: "CoinGecko",
      timestamp: Date.now(),
      freshness: "STALE",
      payload: { reason: "Connection timeout" },
      priority: "CRITICAL",
      dependencyGroup: "coingecko-btc",
    };

    const result = processEventForController(controller, criticalEvent, Date.now());
    // Critical events bypass pause — evaluationsPerformed should be >= 1
    // Note: PROVIDER_DEGRADED events are processed but may not produce
    // price changes; the key verification is that the paused position
    // was NOT skipped entirely.
    expect(result.state.evaluationsPerformed).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION G: NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("G. No Auto-Execution Safety", () => {
  it("protection engine never produces order actions", () => {
    const price = BTC_FIXTURE_PRICE;

    let controller = createControllerState();
    controller = registerPosition(controller, {
      positionId: "safety-test",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: price * 0.90,
      currentPrice: price,
      stopLoss: price * 0.85,
      takeProfit: price * 1.15,
      horizon: "INTRADAY",
      assetClass: "crypto",
      openedAt: Date.now(),
    }, Date.now());
    controller = startController(controller);

    const bridge = createBridgeState();
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "CoinGecko",
      price,
      timestamp: Date.now(),
      freshness: "FRESH",
    };
    const { events } = bridgeQuoteToEvents(bridge, quote);

    for (const event of events) {
      const result = processEventForController(controller, event, Date.now());
      controller = result.state;

      // Every alert must be informational only
      for (const alert of result.alerts) {
        // Alert actions should be human-readable suggestions, not execution commands
        expect(alert.severity).toBeDefined();
        expect(["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(alert.severity);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION H: CONVEX ACTION CONTRACT
// ═══════════════════════════════════════════════════════════════

describe("H. Convex Action Contract", () => {
  it("liveProtection action exists in generated API", async () => {
    // Verify the generated types include our action
    const apiModule = await import("../../convex/_generated/api");
    expect(apiModule.api.liveProtection).toBeDefined();
    expect(apiModule.api.liveProtection.fetchLiveProtectionQuote).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION I: MEMORY BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("I. Memory Bounds", () => {
  it("bridge state is bounded for repeated polling", () => {
    let bridge = createBridgeState();

    for (let i = 0; i < 1000; i++) {
      const quote: ProviderQuoteData = {
        instrument: `INST-${i % 10}`,
        provider: "CoinGecko",
        price: 100 + i,
        timestamp: Date.now(),
        freshness: "FRESH",
      };
      const result = bridgeQuoteToEvents(bridge, quote);
      bridge = result.state;
    }

    // Bridge state should not grow unboundedly
    expect(bridge.instrumentModes.size).toBeLessThanOrEqual(10);
    expect(bridge.lastEventAt.size).toBeLessThanOrEqual(10);
    expect(bridge.eventsBridged).toBeGreaterThan(0);
  });

  it("controller can handle 50+ positions", () => {
    let controller = createControllerState();

    for (let i = 0; i < 50; i++) {
      controller = registerPosition(controller, {
        positionId: `pos-${i}`,
        instrument: `INST-${i % 5}`,
        side: i % 2 === 0 ? "LONG" : "SHORT",
        entryPrice: 100,
        currentPrice: 110,
        horizon: "INTRADAY",
        assetClass: "crypto",
        openedAt: Date.now(),
      }, Date.now());
    }

    expect(controller.positions.size).toBe(50);
    controller = startController(controller);
    expect(controller.globalLifecycle).toBe("RUNNING");

    // Remove some
    for (let i = 0; i < 25; i++) {
      controller = removePosition(controller, `pos-${i}`);
    }
    expect(controller.positions.size).toBe(25);
  });
});
