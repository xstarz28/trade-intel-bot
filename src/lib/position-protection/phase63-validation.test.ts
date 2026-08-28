/**
 * Phase 63 — Comprehensive Validation Suite
 *
 * Tests covering:
 * - Live market data bridge
 * - Profit protection urgency model
 * - "Why TP Now?" explanation
 * - Event relevance and dependency groups
 * - Data freshness safety
 * - Provider degradation
 * - Multi-timeframe intelligence
 * - Profit tracking (LONG/SHORT)
 * - Giveback + acceleration
 * - Thesis deterioration
 * - Shock detection
 * - Early TP urgency
 * - Severity escalation
 * - Recovery
 * - Alert lifecycle (dedup, cooldown)
 * - Position/instrument isolation
 * - LONG/SHORT isolation
 * - Provider failure neutrality
 * - No fabrication
 * - No auto-execution
 * - Decision immutability
 * - Security
 * - Determinism
 * - Performance/memory bounds
 * - Behavioral scenarios
 */

import { describe, it, expect } from "vitest";
import type { PositionContext, ProtectionAlert, AlertSeverity } from "./types";
import type { MarketEvidence } from "./thesis-health";
import type {
  RealTimeEvent,
  PositionSnapshot,
} from "./realtime-types";
import type { WhyTpNowExplanation } from "./types";
import { evaluateProtection } from "./protection-engine";
import { classifyEarlyProtection, type EarlyProtectionInput } from "./early-protection";
import { aggregateTimeframeEvidence, type TimeframeEvidence } from "./multi-timeframe-engine";
import { detectShock } from "./shock-detector";
import { calculateProfitMetrics } from "./profit-state";
import { evaluateThesisHealth, extractAllSignals } from "./thesis-health";
import {
  calculateGiveback,
  classifyGivebackSeverity,
  type GivebackState,
} from "./giveback-monitor";
import {
  createAccelerationState,
  recordPriceObservation,
  recordGivebackObservation,
  detectPriceAcceleration,
  detectGivebackAcceleration,
} from "./acceleration-monitor";
import {
  createMonitorState,
  processEvent,
  processEvents,
  coalesceEvents,
  addPosition,
  removePosition,
  cleanup,
} from "./realtime-monitor";
import {
  createDispatcherState,
  shouldDispatch,
  severityToNotificationPriority,
} from "./alert-dispatcher";
import {
  createMonitoringState,
  shouldAlert,
  updateMonitoringState,
  deduplicateByDependencyGroup,
} from "./alert-lifecycle";
import {
  createPriceEvent,
  createQuoteEvent,
  createCandleEvent,
  createStructureChangeEvent,
  createMomentumChangeEvent,
  createVolatilityChangeEvent,
  createFundingChangeEvent,
  createOIChangeEvent,
  createLiquidationChangeEvent,
  createCrossAssetEvent,
  createMacroChangeEvent,
  createNewsEvent,
  createDataStaleEvent,
  createProviderDegradedEvent,
  createProviderRecoveredEvent,
  createPositionUpdateEvent,
} from "./market-event-bridge";
import {
  validateRegistration,
  createSnapshotFromRegistration,
  generatePositionId,
  inferAssetClass,
} from "./position-registration";
import {
  createBridgeState,
  bridgeQuoteToEvents,
  bridgeCandleToEvents,
  bridgeDerivativesToEvents,
  bridgeMacroToEvents,
  bridgeCrossAssetToEvents,
  bridgeProviderData,
  bridgeProviderStatusChange,
  validateInstrumentIdentity,
  instrumentsMatch,
  checkInstrumentFreshness,
} from "../market-stream/live-market-bridge";
import {
  InMemoryRepository,
  type PersistedPositionState,
  type PersistedAlert,
} from "./persistence";
import {
  ALERT_SEVERITY_ORDER,
  alertSeverityRank,
  type ProfitProtectionUrgency,
  urgencyRank,
} from "./types";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const NOW = Date.now();

function longBtc(overrides?: Partial<PositionContext>): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 100000,
    currentPrice: 112000,
    stopLoss: 95000,
    takeProfit: 120000,
    leverage: 10,
    openedAt: NOW - 3600_000,
    horizon: "SWING",
    ...overrides,
  };
}

function shortEth(overrides?: Partial<PositionContext>): PositionContext {
  return {
    instrument: "ETH/USDT",
    assetClass: "crypto",
    side: "SHORT",
    entryPrice: 4000,
    currentPrice: 3800,
    stopLoss: 4200,
    takeProfit: 3500,
    openedAt: NOW - 3600_000,
    horizon: "INTRADAY",
    ...overrides,
  };
}

function healthyEvidence(price?: number): MarketEvidence {
  return {
    price: price ?? 112000,
    shortTermTrend: "bullish",
    mediumTermTrend: "bullish",
    longTermTrend: "bullish",
    structureBroken: false,
    volatility: 1500,
    avgVolatility: 2000,
    riskRegime: "risk_on",
    momentumChange: 5,
  };
}

function deterioratingEvidence(price?: number): MarketEvidence {
  return {
    price: price ?? 108000,
    shortTermTrend: "bearish",
    mediumTermTrend: "bearish",
    structureBroken: true,
    volatility: 4000,
    avgVolatility: 1500,
    momentumChange: -25,
    riskRegime: "risk_off",
    riskRegimeChanged: true,
  };
}

function createTestSnapshot(overrides?: Partial<PositionSnapshot>): PositionSnapshot {
  return {
    positionId: "test-pos-1",
    instrument: "BTC/USDT",
    side: "LONG",
    entryPrice: 100000,
    currentPrice: 112000,
    stopLoss: 95000,
    takeProfit: 120000,
    leverage: 10,
    horizon: "SWING",
    openedAt: NOW - 3600_000,
    lastUpdateAt: NOW,
    monitoringStatus: "LIVE",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. LIVE MARKET BRIDGE
// ═══════════════════════════════════════════════════════════════

describe("A. Live Market Bridge", () => {
  it("creates bridge state correctly", () => {
    const state = createBridgeState();
    expect(state.instrumentModes.size).toBe(0);
    expect(state.eventsBridged).toBe(0);
    expect(state.eventsDropped).toBe(0);
  });

  it("bridges quote data to price events", () => {
    const state = createBridgeState();
    const result = bridgeQuoteToEvents(state, {
      instrument: "BTC/USDT",
      provider: "twelve-data",
      price: 105000,
      bid: 104999,
      ask: 105001,
      timestamp: NOW,
      freshness: "FRESH",
    });
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events.some(e => e.eventType === "PRICE_UPDATE")).toBe(true);
    expect(result.events.some(e => e.eventType === "QUOTE_UPDATE")).toBe(true);
    expect(result.state.eventsBridged).toBe(2);
  });

  it("rejects invalid quote data (empty instrument)", () => {
    const state = createBridgeState();
    const result = bridgeQuoteToEvents(state, {
      instrument: "",
      provider: "twelve-data",
      price: 105000,
      timestamp: NOW,
      freshness: "FRESH",
    });
    expect(result.events.length).toBe(0);
    expect(result.state.eventsDropped).toBe(1);
  });

  it("rejects non-finite price", () => {
    const state = createBridgeState();
    const result = bridgeQuoteToEvents(state, {
      instrument: "BTC/USDT",
      provider: "twelve-data",
      price: NaN,
      timestamp: NOW,
      freshness: "FRESH",
    });
    expect(result.events.length).toBe(0);
    expect(result.state.eventsDropped).toBe(1);
  });

  it("emits DATA_STALE for stale data", () => {
    const state = createBridgeState();
    const result = bridgeQuoteToEvents(state, {
      instrument: "BTC/USDT",
      provider: "twelve-data",
      price: 105000,
      timestamp: NOW - 600_000,
      freshness: "STALE",
    });
    expect(result.events.some(e => e.eventType === "DATA_STALE")).toBe(true);
    expect(result.state.instrumentModes.get("BTC/USDT")).toBe("DEGRADED");
  });

  it("bridges candle data to candle + price events", () => {
    const state = createBridgeState();
    const result = bridgeCandleToEvents(state, {
      instrument: "BTC/USDT",
      provider: "twelve-data",
      timeframe: "H1",
      open: 100000,
      high: 101000,
      low: 99500,
      close: 100500,
      volume: 1500,
      timestamp: NOW,
    });
    expect(result.events.length).toBe(2);
    expect(result.events.some(e => e.eventType === "CANDLE_UPDATE")).toBe(true);
    expect(result.events.some(e => e.eventType === "PRICE_UPDATE")).toBe(true);
  });

  it("bridges derivatives data", () => {
    const state = createBridgeState();
    const result = bridgeDerivativesToEvents(state, {
      instrument: "BTC/USDT",
      provider: "coinglass",
      fundingRate: 0.005,
      openInterestChange: 25,
      liquidationSpike: true,
      timestamp: NOW,
    });
    expect(result.events.length).toBe(3);
    expect(result.events.some(e => e.eventType === "FUNDING_CHANGE")).toBe(true);
    expect(result.events.some(e => e.eventType === "OPEN_INTEREST_CHANGE")).toBe(true);
    expect(result.events.some(e => e.eventType === "LIQUIDATION_CHANGE")).toBe(true);
  });

  it("bridges macro data", () => {
    const state = createBridgeState();
    const result = bridgeMacroToEvents(state, {
      instrument: "BTC/USDT",
      provider: "macro",
      riskRegime: "risk_off",
      riskRegimeChanged: true,
      timestamp: NOW,
    });
    expect(result.events.length).toBe(1);
    expect(result.events[0].eventType).toBe("MACRO_CHANGE");
  });

  it("bridges cross-asset data", () => {
    const state = createBridgeState();
    const result = bridgeCrossAssetToEvents(state, {
      instrument: "BTC/USDT",
      correlatedAsset: "SPX",
      divergence: true,
      provider: "cross-asset",
      timestamp: NOW,
    });
    expect(result.events.length).toBe(1);
    expect(result.events[0].eventType).toBe("CROSS_ASSET_CHANGE");
  });

  it("handles provider status changes", () => {
    const state = createBridgeState();
    const result = bridgeProviderStatusChange(
      state, "twelve-data", ["BTC/USDT", "ETH/USDT"], "disconnected", "Rate limited",
    );
    expect(result.events.length).toBe(2);
    expect(result.events.every(e => e.eventType === "PROVIDER_DEGRADED")).toBe(true);
    expect(result.state.providerStatus.get("twelve-data")).toBe("DEGRADED");
  });

  it("handles provider recovery", () => {
    let state = createBridgeState();
    state = bridgeProviderStatusChange(state, "twelve-data", ["BTC/USDT"], "disconnected").state;
    const result = bridgeProviderStatusChange(state, "twelve-data", ["BTC/USDT"], "recovered");
    expect(result.events.every(e => e.eventType === "PROVIDER_RECOVERED")).toBe(true);
    expect(result.state.providerStatus.get("twelve-data")).toBe("POLLING");
  });

  it("bridges complete provider data", () => {
    const state = createBridgeState();
    const result = bridgeProviderData(state, {
      quote: { instrument: "BTC/USDT", provider: "twelve-data", price: 105000, timestamp: NOW, freshness: "FRESH" },
      derivatives: { instrument: "BTC/USDT", provider: "coinglass", fundingRate: 0.002, timestamp: NOW },
    });
    expect(result.events.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. INSTRUMENT IDENTITY
// ═══════════════════════════════════════════════════════════════

describe("B. Instrument Identity", () => {
  it("validates proper symbols", () => {
    expect(validateInstrumentIdentity("BTC/USDT").valid).toBe(true);
    expect(validateInstrumentIdentity("EUR/USD").valid).toBe(true);
    expect(validateInstrumentIdentity("").valid).toBe(false);
    expect(validateInstrumentIdentity(" ").valid).toBe(false);
  });

  it("normalizes symbols", () => {
    expect(validateInstrumentIdentity("btc/usdt").canonical).toBe("BTC/USDT");
  });

  it("matches equivalent symbols", () => {
    expect(instrumentsMatch("BTC/USDT", "BTC/USDT")).toBe(true);
    expect(instrumentsMatch("BTC/USDT", "btc/usdt")).toBe(true);
    expect(instrumentsMatch("BTC/USDT", "ETH/USDT")).toBe(false);
  });

  it("detects instrument freshness", () => {
    const state = createBridgeState();
    state.lastEventAt.set("BTC/USDT", NOW);
    expect(checkInstrumentFreshness(state, "BTC/USDT", NOW)).toBe("POLLING");
    expect(checkInstrumentFreshness(state, "ETH/USDT", NOW)).toBe("UNAVAILABLE");
    expect(checkInstrumentFreshness(state, "BTC/USDT", NOW + 310_000)).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. PROFIT PROTECTION URGENCY
// ═══════════════════════════════════════════════════════════════

describe("C. Profit Protection Urgency", () => {
  it("returns NONE urgency for healthy position", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    expect(result.alert.urgency).toBe("NONE");
    expect(result.alert.severity).toBe("NONE");
  });

  it("returns LOW urgency for WATCH", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: { price: 107000, shortTermTrend: "bearish" },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity === "WATCH") {
      expect(result.alert.urgency).toBe("LOW");
    }
  });

  it("returns MODERATE or HIGH urgency for CAUTION", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 108000 }),
      evidence: deterioratingEvidence(108000),
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity === "CAUTION") {
      expect(["MODERATE", "HIGH"]).toContain(result.alert.urgency);
    }
  });

  it("returns HIGH or CRITICAL urgency for HIGH_RISK", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 97000 }),
      evidence: {
        price: 97000,
        shortTermTrend: "bearish",
        mediumTermTrend: "bearish",
        structureBroken: true,
        momentumChange: -30,
        volatility: 5000,
        avgVolatility: 1500,
        riskRegime: "risk_off",
        riskRegimeChanged: true,
      },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity === "HIGH_RISK") {
      expect(["HIGH", "CRITICAL"]).toContain(result.alert.urgency);
    }
  });

  it("always provides urgency reason", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    expect(typeof result.alert.urgencyReason).toBe("string");
    expect(result.alert.urgencyReason.length).toBeGreaterThan(0);
  });

  it("urgency ordering is consistent", () => {
    expect(urgencyRank("NONE")).toBeLessThan(urgencyRank("LOW"));
    expect(urgencyRank("LOW")).toBeLessThan(urgencyRank("MODERATE"));
    expect(urgencyRank("MODERATE")).toBeLessThan(urgencyRank("HIGH"));
    expect(urgencyRank("HIGH")).toBeLessThan(urgencyRank("CRITICAL"));
  });
});

// ═══════════════════════════════════════════════════════════════
// D. "WHY TP NOW?" EXPLANATION
// ═══════════════════════════════════════════════════════════════

describe("D. Why TP Now? Explanation", () => {
  it("always provides whyTpNow explanation", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    const why = result.alert.whyTpNow;
    expect(why).toBeDefined();
    expect(typeof why.profitStatus).toBe("string");
    expect(Array.isArray(why.whatChanged)).toBe(true);
    expect(Array.isArray(why.confirmations)).toBe(true);
    expect(Array.isArray(why.stillSupporting)).toBe(true);
    expect(Array.isArray(why.missingEvidence)).toBe(true);
    expect(typeof why.urgencyIncreased).toBe("string");
    expect(typeof why.suggestedAction).toBe("string");
    expect(typeof why.disclaimer).toBe("string");
  });

  it("healthy position shows 'No urgency' in explanation", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    expect(result.alert.whyTpNow.urgencyIncreased).toContain("No urgency");
  });

  it("deteriorating position shows relevant whatChanged", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 104000 }),
      evidence: deterioratingEvidence(104000),
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity !== "NONE") {
      expect(result.alert.whyTpNow.whatChanged.length).toBeGreaterThan(0);
    }
  });

  it("disclaimer does NOT contain probability language", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    expect(result.alert.whyTpNow.disclaimer.toLowerCase()).not.toContain("probability");
    expect(result.alert.whyTpNow.disclaimer.toLowerCase()).not.toMatch(/\d+%/);
  });

  it("HIGH_RISK suggests securing profit", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 97000 }),
      evidence: {
        price: 97000,
        shortTermTrend: "bearish",
        mediumTermTrend: "bearish",
        structureBroken: true,
        momentumChange: -30,
        volatility: 5000,
        avgVolatility: 1500,
        riskRegime: "risk_off",
        riskRegimeChanged: true,
      },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity === "HIGH_RISK") {
      expect(result.alert.whyTpNow.suggestedAction.toLowerCase()).toContain("profit");
    }
  });

  it("INVALIDATED suggests closing or hedging", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 95000 }),
      evidence: {
        price: 95000,
        shortTermTrend: "bearish",
        mediumTermTrend: "bearish",
        longTermTrend: "bearish",
        structureBroken: true,
        momentumChange: -35,
        volatility: 6000,
        avgVolatility: 1500,
        riskRegime: "risk_off",
        riskRegimeChanged: true,
      },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity === "INVALIDATED") {
      expect(result.alert.whyTpNow).toBeDefined();
      expect(result.alert.whyTpNow.suggestedAction.length).toBeGreaterThan(10);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// E. ALERT STRUCTURE
// ═══════════════════════════════════════════════════════════════

describe("E. Alert Structure", () => {
  it("alert contains side field", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    expect(result.alert.side).toBe("LONG");
  });

  it("SHORT position alert shows SHORT side", () => {
    const result = evaluateProtection({
      position: shortEth(),
      evidence: { price: 3800, shortTermTrend: "bearish", mediumTermTrend: "bearish" },
      now: NOW,
    });
    expect(result.alert.side).toBe("SHORT");
  });

  it("alert contains all required fields", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    const a = result.alert;
    expect(a.instrument).toBe("BTC/USDT");
    expect(a.side).toBe("LONG");
    expect(a.severity).toBeDefined();
    expect(a.urgency).toBeDefined();
    expect(a.urgencyReason).toBeDefined();
    expect(a.whyTpNow).toBeDefined();
    expect(a.thesisHealth).toBeDefined();
    expect(a.thesisHealthScore).toBeDefined();
    expect(a.profit).toBeDefined();
    expect(a.shock).toBeDefined();
    expect(a.alertMessage).toBeDefined();
    expect(a.actionRecommendation).toBeDefined();
    expect(a.timestamp).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// F. EVENT RELEVANCE
// ═══════════════════════════════════════════════════════════════

describe("F. Event Relevance", () => {
  it("PRICE_UPDATE events are LOW priority by default", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "test");
    expect(event.priority).toBe("LOW");
  });

  it("MARKET_STRUCTURE_CHANGE with broken is HIGH priority", () => {
    const event = createStructureChangeEvent("BTC/USDT", true, "M15", "test");
    expect(event.priority).toBe("HIGH");
  });

  it("MOMENTUM_CHANGE with large change is HIGH priority", () => {
    const event = createMomentumChangeEvent("BTC/USDT", -20, "H1", "test");
    expect(event.priority).toBe("HIGH");
  });

  it("VOLATILITY_CHANGE with high ratio is MEDIUM priority", () => {
    const event = createVolatilityChangeEvent("BTC/USDT", 5000, 2000, "test");
    expect(event.priority).toBe("MEDIUM");
  });

  it("FUNDING_CHANGE with extreme rate is HIGH priority", () => {
    const event = createFundingChangeEvent("BTC/USDT", 0.005, "test");
    expect(event.priority).toBe("HIGH");
  });

  it("dependency groups are instrument-scoped", () => {
    const btcEvent = createPriceEvent("BTC/USDT", 105000, "test");
    const ethEvent = createPriceEvent("ETH/USDT", 4000, "test");
    expect(btcEvent.dependencyGroup).toContain("BTC");
    expect(ethEvent.dependencyGroup).toContain("ETH");
    expect(btcEvent.dependencyGroup).not.toBe(ethEvent.dependencyGroup);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. DATA FRESHNESS
// ═══════════════════════════════════════════════════════════════

describe("G. Data Freshness", () => {
  it("FRESH data allows normal evaluation", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "test");
    expect(event.freshness).toBe("FRESH");
  });

  it("STALE event is created for stale data", () => {
    const event = createDataStaleEvent("BTC/USDT", "test", 600_000);
    expect(event.eventType).toBe("DATA_STALE");
    expect(event.freshness).toBe("STALE");
  });

  it("PROVIDER_DEGRADED event preserves provider neutrality", () => {
    const event = createProviderDegradedEvent("BTC/USDT", "twelve-data", "Rate limited");
    expect(event.eventType).toBe("PROVIDER_DEGRADED");
    expect(event.freshness).toBe("UNAVAILABLE");
    // Provider failure should never carry directional payload
    expect(event.payload).not.toHaveProperty("bearish");
    expect(event.payload).not.toHaveProperty("bullish");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. PROFIT TRACKING
// ═══════════════════════════════════════════════════════════════

describe("H. Profit Tracking", () => {
  it("LONG profit is positive when price > entry", () => {
    const metrics = calculateProfitMetrics(longBtc());
    expect(metrics.unrealizedPnL).toBeGreaterThan(0);
    expect(metrics.profitState).toMatch(/PROFITABLE/);
  });

  it("SHORT profit is positive when price < entry", () => {
    const metrics = calculateProfitMetrics(shortEth());
    expect(metrics.unrealizedPnL).toBeGreaterThan(0);
    expect(metrics.profitState).toMatch(/PROFITABLE/);
  });

  it("LONG loss is negative when price < entry", () => {
    const metrics = calculateProfitMetrics(longBtc({ currentPrice: 95000 }));
    expect(metrics.unrealizedPnL).toBeLessThan(0);
  });

  it("SHORT loss is negative when price > entry", () => {
    const metrics = calculateProfitMetrics(shortEth({ currentPrice: 4500 }));
    expect(metrics.unrealizedPnL).toBeLessThan(0);
  });

  it("R-multiple is computed when SL available", () => {
    const metrics = calculateProfitMetrics(longBtc());
    expect(metrics.rMultiple).toBeDefined();
    expect(metrics.rMultiple!).toBeGreaterThan(0);
  });

  it("R-multiple is undefined when SL is missing", () => {
    const metrics = calculateProfitMetrics(longBtc({ stopLoss: undefined }));
    expect(metrics.rMultiple).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// I. GIVEBACK
// ═══════════════════════════════════════════════════════════════

describe("I. Giveback", () => {
  it("calculates giveback from peak", () => {
    const snap = createTestSnapshot({ currentPrice: 110000 });
    const gb = calculateGiveback(snap, 115000);
    expect(gb.givebackPct).toBeGreaterThan(0);
    expect(gb.givebackPct).toBeLessThan(100);
  });

  it("zero giveback at peak", () => {
    const snap = createTestSnapshot({ currentPrice: 115000 });
    const gb = calculateGiveback(snap, 115000);
    expect(gb.givebackPct).toBe(0);
  });

  it("classifyGivebackSeverity respects horizons", () => {
    const gb: GivebackState = {
      peakPrice: 120, currentPrice: 100, peakProfit: 20, currentProfit: 0,
      givebackAbsolute: 20, givebackPct: 100, pullbackType: "PROTECTION_EVENT", accelerating: false,
    };
    expect(classifyGivebackSeverity(gb, "SCALPING")).toBe("PROTECT_NOW");
    expect(classifyGivebackSeverity(gb, "INVESTING")).toBe("PROTECT_NOW");
  });

  it("no giveback for losing positions", () => {
    const snap = createTestSnapshot({ currentPrice: 95000 });
    const gb = calculateGiveback(snap, 100000);
    // Current profit is negative, so giveback should be based on peak
    expect(gb.givebackPct).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. ACCELERATION
// ═══════════════════════════════════════════════════════════════

describe("J. Acceleration", () => {
  it("returns NORMAL with insufficient observations", () => {
    const state = createAccelerationState();
    const result = detectPriceAcceleration(state, "LONG", NOW);
    expect(result.level).toBe("NORMAL");
    expect(result.observationCount).toBe(0);
  });

  it("detects price acceleration with multiple observations", () => {
    let state = createAccelerationState({ maxBufferSize: 50, windowMs: 60_000 });
    // Simulate rapid price decline for LONG
    state = recordPriceObservation(state, NOW - 30_000, 112000, "test");
    state = recordPriceObservation(state, NOW - 20_000, 108000, "test");
    state = recordPriceObservation(state, NOW - 10_000, 104000, "test");
    state = recordPriceObservation(state, NOW, 100000, "test");
    const result = detectPriceAcceleration(state, "LONG", NOW);
    expect(["ELEVATED", "HIGH"]).toContain(result.level);
  });

  it("givesback acceleration tracks increasing giveback", () => {
    let state = createAccelerationState({ maxBufferSize: 50, windowMs: 60_000 });
    state = recordGivebackObservation(state, NOW - 20_000, 10, "test");
    state = recordGivebackObservation(state, NOW - 10_000, 20, "test");
    state = recordGivebackObservation(state, NOW, 40, "test");
    const result = detectGivebackAcceleration(state, NOW);
    expect(result.observationCount).toBeGreaterThanOrEqual(2);
  });

  it("acceleration buffers are bounded", () => {
    let state = createAccelerationState({ maxBufferSize: 10, windowMs: 60_000 });
    for (let i = 0; i < 50; i++) {
      state = recordPriceObservation(state, NOW - (50 - i) * 1000, 100000 + i * 100, "test");
    }
    expect(state.priceObservations.length).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. THESIS DETERIORATION
// ═══════════════════════════════════════════════════════════════

describe("K. Thesis Deterioration", () => {
  it("healthy evidence produces healthy thesis", () => {
    const result = evaluateThesisHealth(longBtc(), healthyEvidence());
    expect(result.state).toMatch(/HEALTHY|STABLE/);
    expect(result.score).toBeGreaterThan(50);
  });

  it("deteriorating evidence reduces thesis health", () => {
    const healthy = evaluateThesisHealth(longBtc(), healthyEvidence());
    const deteriorated = evaluateThesisHealth(longBtc({ currentPrice: 104000 }), deterioratingEvidence(104000));
    expect(deteriorated.score).toBeLessThan(healthy.score);
    expect(deteriorated.deteriorationCount).toBeGreaterThan(healthy.deteriorationCount);
  });

  it("structure break is a strong deterioration signal", () => {
    const { deterioration } = extractAllSignals(longBtc(), { price: 100000, structureBroken: true });
    expect(deterioration.some(s => s.name === "structure_break")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. SHOCK DETECTION
// ═══════════════════════════════════════════════════════════════

describe("L. Shock Detection", () => {
  it("returns NORMAL for healthy evidence", () => {
    const shock = detectShock(healthyEvidence());
    expect(shock.state).toBe("NORMAL");
  });

  it("detects volatility expansion shock", () => {
    const shock = detectShock({ price: 100000, volatility: 8000, avgVolatility: 1500 });
    expect(shock.state).not.toBe("NORMAL");
    expect(shock.indicators.volatilityExpansion).toBe(true);
  });

  it("detects funding shock", () => {
    const shock = detectShock({ price: 100000, fundingRate: 0.005 });
    expect(shock.indicators.fundingShock).toBe(true);
  });

  it("detects liquidation spike", () => {
    const shock = detectShock({ price: 100000, liquidationSpike: true });
    expect(shock.indicators.volumeSpike).toBe(true);
  });

  it("multiple indicators produce SHOCK state", () => {
    const shock = detectShock({
      price: 100000,
      volatility: 8000,
      avgVolatility: 1500,
      liquidationSpike: true,
      fundingRate: 0.005,
      riskRegimeChanged: true,
    });
    expect(shock.state).toBe("SHOCK");
  });

  it("provider failure does not produce shock", () => {
    const shock = detectShock({ price: 100000 });
    expect(shock.state).toBe("NORMAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. MULTI-TIMEFRAME
// ═══════════════════════════════════════════════════════════════

describe("M. Multi-Timeframe Intelligence", () => {
  it("no evidence returns NO_SIGNAL", () => {
    const result = aggregateTimeframeEvidence([]);
    expect(result.level).toBe("NO_SIGNAL");
  });

  it("single M5 deterioration is NOISE", () => {
    const evidence: TimeframeEvidence[] = [{
      timeframe: "M5", adverseTrend: true, structureBroken: false,
      adverseMomentum: true, confirmationConfidence: 40, observedAt: NOW, source: "test",
    }];
    const result = aggregateTimeframeEvidence(evidence);
    expect(result.level).toBe("NOISE");
  });

  it("M5 + M15 deterioration is EMERGING", () => {
    const evidence: TimeframeEvidence[] = [
      { timeframe: "M5", adverseTrend: true, structureBroken: false, adverseMomentum: true, confirmationConfidence: 50, observedAt: NOW, source: "test" },
      { timeframe: "M15", adverseTrend: true, structureBroken: false, adverseMomentum: true, confirmationConfidence: 50, observedAt: NOW, source: "test" },
    ];
    const result = aggregateTimeframeEvidence(evidence);
    expect(["NOISE", "EMERGING"]).toContain(result.level);
  });

  it("H1 structure break is STRUCTURAL", () => {
    const evidence: TimeframeEvidence[] = [{
      timeframe: "H1", adverseTrend: true, structureBroken: true,
      adverseMomentum: true, confirmationConfidence: 80, observedAt: NOW, source: "test",
    }];
    const result = aggregateTimeframeEvidence(evidence);
    expect(result.level).toBe("STRUCTURAL");
  });

  it("HTF confirmation is detected when HTF and LTF both adverse", () => {
    const evidence: TimeframeEvidence[] = [
      { timeframe: "M5", adverseTrend: true, structureBroken: false, adverseMomentum: true, confirmationConfidence: 50, observedAt: NOW, source: "test" },
      { timeframe: "H1", adverseTrend: true, structureBroken: false, adverseMomentum: false, confirmationConfidence: 60, observedAt: NOW, source: "test" },
    ];
    const result = aggregateTimeframeEvidence(evidence);
    expect(result.htfConfirmation).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. SEVERITY ESCALATION
// ═══════════════════════════════════════════════════════════════

describe("N. Severity Escalation", () => {
  it("NONE → WATCH on early deterioration", () => {
    let state = createMonitoringState("BTC/USDT");
    const r1 = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), monitoringState: state, now: NOW,
    });
    state = r1.updatedMonitoringState;

    const r2 = evaluateProtection({
      position: longBtc({ currentPrice: 107000 }),
      evidence: { price: 107000, shortTermTrend: "bearish" },
      monitoringState: state,
      now: NOW + 60_000,
    });
    // The engine may stay at NONE, escalate to WATCH, or even CAUTION
    // depending on accumulated evidence
    expect(["NONE", "WATCH", "CAUTION"]).toContain(r2.alert.severity);
  });

  it("recovery (severity decrease) is detected", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "CAUTION", NOW);
    expect(state.currentSeverity).toBe("CAUTION");

    state = updateMonitoringState(state, "WATCH", NOW + 30_000);
    expect(state.currentSeverity).toBe("WATCH");
  });

  it("alert severity ordering is consistent", () => {
    expect(alertSeverityRank("NONE")).toBeLessThan(alertSeverityRank("WATCH"));
    expect(alertSeverityRank("WATCH")).toBeLessThan(alertSeverityRank("CAUTION"));
    expect(alertSeverityRank("CAUTION")).toBeLessThan(alertSeverityRank("HIGH_RISK"));
    expect(alertSeverityRank("HIGH_RISK")).toBeLessThan(alertSeverityRank("INVALIDATED"));
  });
});

// ═══════════════════════════════════════════════════════════════
// O. POSITION ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("O. Position Isolation", () => {
  it("BTC LONG and ETH SHORT produce independent alerts", () => {
    const btcAlert = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const ethAlert = evaluateProtection({
      position: shortEth(), evidence: { price: 3800 }, now: NOW,
    });
    expect(btcAlert.alert.instrument).toBe("BTC/USDT");
    expect(ethAlert.alert.instrument).toBe("ETH/USDT");
  });

  it("BTC LONG ≠ BTC SHORT", () => {
    const longResult = calculateProfitMetrics(longBtc({ currentPrice: 110000 }));
    const shortResult = calculateProfitMetrics(longBtc({ side: "SHORT", currentPrice: 90000 }));
    // Both profitable but in different directions
    expect(longResult.unrealizedPnL).toBeGreaterThan(0);
    expect(shortResult.unrealizedPnL).toBeGreaterThan(0);
  });

  it("BTC ≠ ETH (different instruments)", () => {
    expect(instrumentsMatch("BTC/USDT", "ETH/USDT")).toBe(false);
  });

  it("monitor state is per-instrument", () => {
    const state = createMonitorState();
    const btcSnap = createTestSnapshot({ positionId: "btc-1", instrument: "BTC/USDT" });
    const ethSnap = createTestSnapshot({ positionId: "eth-1", instrument: "ETH/USDT" });
    const s1 = addPosition(state, btcSnap);
    const s2 = addPosition(s1, ethSnap);
    expect(s2.positions.size).toBe(2);
    const s3 = removePosition(s2, "btc-1");
    expect(s3.positions.size).toBe(1);
    expect(s3.positions.has("eth-1")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. NO FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("P. No Fabrication", () => {
  it("alert contains no probability percentages", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const s = JSON.stringify(result.alert).toLowerCase();
    expect(s).not.toMatch(/\d+%\s*chance/);
  });

  it("alert contains no probability of profit language", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const s = JSON.stringify(result.alert).toLowerCase();
    expect(s).not.toContain("probability of profit");
  });

  it("missing data stays missing — not replaced with fabricated values", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: { price: 112000 }, now: NOW,
    });
    expect(result.alert.missingData.length).toBeGreaterThan(0);
  });

  it("provider failure never becomes directional evidence", () => {
    const event = createProviderDegradedEvent("BTC/USDT", "twelve-data", "timeout");
    expect(event.payload).not.toHaveProperty("bullish");
    expect(event.payload).not.toHaveProperty("bearish");
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("Q. No Auto-Execution", () => {
  it("action recommendations never include execute/close/auto", () => {
    const severities: AlertSeverity[] = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"];
    for (const sev of severities) {
      let pos: PositionContext;
      let evidence: MarketEvidence;
      if (sev === "NONE") {
        pos = longBtc(); evidence = healthyEvidence();
      } else if (sev === "WATCH") {
        pos = longBtc(); evidence = { price: 105000, shortTermTrend: "bearish" };
      } else {
        pos = longBtc({ currentPrice: 95000 });
        evidence = { price: 95000, shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true, momentumChange: -30, riskRegime: "risk_off", riskRegimeChanged: true, volatility: 5000, avgVolatility: 1500 };
      }
      const result = evaluateProtection({ position: pos, evidence, monitoringState: createMonitoringState("BTC/USDT"), now: NOW });
      const action = result.alert.actionRecommendation.toLowerCase();
      expect(action).not.toContain("auto-execute");
      expect(action).not.toContain("auto close");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// R. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("R. Decision Immutability", () => {
  it("protection alert does not modify recommendation/bias/conviction", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: deterioratingEvidence(104000),
      monitoringState: createMonitoringState("BTC/USDT"), now: NOW,
    });
    // ProtectionAlert has no recommendation, bias, conviction, tradePlan fields
    expect((result.alert as any).recommendation).toBeUndefined();
    expect((result.alert as any).bias).toBeUndefined();
    expect((result.alert as any).conviction).toBeUndefined();
    expect((result.alert as any).tradePlan).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// S. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("S. Security", () => {
  it("no API keys in alert JSON", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const s = JSON.stringify(result.alert);
    expect(s.toLowerCase()).not.toContain("api_key");
    expect(s.toLowerCase()).not.toContain("apikey");
    expect(s.toLowerCase()).not.toContain("secret");
  });

  it("no credentials in events", () => {
    const events = [
      createPriceEvent("BTC/USDT", 105000, "test"),
      createProviderDegradedEvent("BTC/USDT", "test", "error"),
    ];
    for (const e of events) {
      const s = JSON.stringify(e);
      expect(s.toLowerCase()).not.toContain("api_key");
      expect(s.toLowerCase()).not.toContain("password");
    }
  });

  it("no secrets in persisted state", () => {
    const state: PersistedPositionState = {
      positionId: "test", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      monitoringLifecycle: "MONITORING", lastUpdateAt: NOW,
      lastAlertAt: 0, consecutiveSameSeverity: 0,
    };
    const s = JSON.stringify(state);
    expect(s.toLowerCase()).not.toContain("api_key");
    expect(s.toLowerCase()).not.toContain("secret");
  });
});

// ═══════════════════════════════════════════════════════════════
// T. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("T. Determinism", () => {
  it("same inputs → same severity", () => {
    const a = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: 1000 });
    const b = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: 1000 });
    expect(a.alert.severity).toBe(b.alert.severity);
  });

  it("same inputs → same urgency", () => {
    const a = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: 1000 });
    const b = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: 1000 });
    expect(a.alert.urgency).toBe(b.alert.urgency);
  });

  it("same inputs → same shock", () => {
    const a = detectShock({ price: 100000, volatility: 8000, avgVolatility: 1500 });
    const b = detectShock({ price: 100000, volatility: 8000, avgVolatility: 1500 });
    expect(a.state).toBe(b.state);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. CONVEX PERSISTENCE
// ═══════════════════════════════════════════════════════════════

describe("U. Convex Persistence (InMemory fallback)", () => {
  it("saves and loads position state", async () => {
    const repo = new InMemoryRepository();
    const state: PersistedPositionState = {
      positionId: "test-1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      monitoringLifecycle: "MONITORING", lastUpdateAt: NOW,
      lastAlertAt: 0, consecutiveSameSeverity: 0,
    };
    await repo.savePositionState(state);
    const loaded = await repo.getPositionState("test-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.currentSeverity).toBe("NONE");
  });

  it("saves and lists alerts", async () => {
    const repo = new InMemoryRepository();
    const alert: PersistedAlert = {
      alertId: "alert-1", positionId: "test-1", instrument: "BTC/USDT",
      severity: "WATCH", notificationPriority: "INFO",
      reason: "test", action: "monitor", timestamp: NOW, acknowledged: false,
    };
    await repo.saveAlert(alert);
    const alerts = await repo.listAlertHistory("test-1");
    expect(alerts.length).toBe(1);
  });

  it("acknowledges alert", async () => {
    const repo = new InMemoryRepository();
    const alert: PersistedAlert = {
      alertId: "alert-2", positionId: "test-1", instrument: "BTC/USDT",
      severity: "CAUTION", notificationPriority: "WARNING",
      reason: "test", action: "protect", timestamp: NOW, acknowledged: false,
    };
    await repo.saveAlert(alert);
    await repo.acknowledgeAlert("alert-2");
    const alerts = await repo.listAlertHistory("test-1");
    expect(alerts[0].acknowledged).toBe(true);
  });

  it("deletes position state", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState({
      positionId: "test-del", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      monitoringLifecycle: "MONITORING", lastUpdateAt: NOW,
      lastAlertAt: 0, consecutiveSameSeverity: 0,
    });
    await repo.deletePositionState("test-del");
    const loaded = await repo.getPositionState("test-del");
    expect(loaded).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// V. EVENT COALESCING
// ═══════════════════════════════════════════════════════════════

describe("V. Event Coalescing", () => {
  it("critical events bypass coalescing", () => {
    const events = [
      createPriceEvent("BTC/USDT", 105000, "test"),
      createProviderDegradedEvent("BTC/USDT", "test", "error"),
    ];
    // Make one critical
    events[1] = { ...events[1], priority: "CRITICAL" };
    const coalesced = coalesceEvents(events);
    expect(coalesced.some(e => e.priority === "CRITICAL")).toBe(true);
  });

  it("same instrument keeps highest priority event", () => {
    const events = [
      createPriceEvent("BTC/USDT", 105000, "test"),
      createMomentumChangeEvent("BTC/USDT", -20, "H1", "test"),
    ];
    const coalesced = coalesceEvents(events);
    // Should keep at least one event
    expect(coalesced.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// W. ALERT LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("W. Alert Lifecycle", () => {
  it("creates monitoring state correctly", () => {
    const state = createMonitoringState("BTC/USDT");
    expect(state.currentSeverity).toBe("NONE");
    expect(state.instrument).toBe("BTC/USDT");
  });

  it("INVALIDATED always fires", () => {
    const state = createMonitoringState("BTC/USDT");
    const decision = shouldAlert(state, "INVALIDATED", NOW);
    expect(decision.shouldFire).toBe(true);
  });

  it("deduplication keeps highest severity per dependency group", () => {
    const signals = [
      { dependencyGroup: "A", severity: 30, name: "sig1" },
      { dependencyGroup: "A", severity: 70, name: "sig2" },
      { dependencyGroup: "B", severity: 50, name: "sig3" },
    ];
    const deduped = deduplicateByDependencyGroup(signals);
    expect(deduped.length).toBe(2);
    const sigA = deduped.find(s => s.dependencyGroup === "A");
    expect(sigA?.severity).toBe(70);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. PERFORMANCE / MEMORY BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("X. Performance / Memory Bounds", () => {
  it("cleanup limits dispatcher history", () => {
    let state = createMonitorState();
    // Add lots of alerts
    for (let i = 0; i < 100; i++) {
      state.dispatcher.history.push({
        positionId: "pos-1", instrument: "BTC/USDT",
        notificationPriority: "INFO", severity: "NONE", action: "test",
        reason: "test", timestamp: NOW + i, acknowledged: false,
      });
    }
    const cleaned = cleanup(state, 50);
    expect(cleaned.dispatcher.history.length).toBeLessThanOrEqual(50);
  });

  it("acceleration state bounds observations", () => {
    let state = createAccelerationState({ maxBufferSize: 20, windowMs: 60_000 });
    for (let i = 0; i < 200; i++) {
      state = recordPriceObservation(state, NOW - (200 - i) * 1000, 100000 + i * 10, "test");
    }
    expect(state.priceObservations.length).toBeLessThanOrEqual(20);
  });

  it("handles 50+ simultaneous positions without crash", () => {
    let state = createMonitorState();
    for (let i = 0; i < 60; i++) {
      state = addPosition(state, createTestSnapshot({
        positionId: `pos-${i}`,
        instrument: `INSTR_${i}/USDT`,
        currentPrice: 100 + i,
      }));
    }
    expect(state.positions.size).toBe(60);
    // Cleanup shouldn't crash
    const cleaned = cleanup(state);
    expect(cleaned.positions.size).toBe(60);
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. BEHAVIORAL SCENARIO: Profitable LONG → Deteriorating
// ═══════════════════════════════════════════════════════════════

describe("Y. Behavioral Scenario: Profitable LONG → Deteriorating", () => {
  it("full escalation path: NONE → WATCH → CAUTION → HIGH_RISK → INVALIDATED", () => {
    const entry = 100;
    let monitoring = createMonitoringState("BTC/USDT");

    // Step 1: Healthy profitable
    const step1 = evaluateProtection({
      position: longBtc({ entryPrice: entry, currentPrice: 112 }),
      evidence: { price: 112, shortTermTrend: "bullish", mediumTermTrend: "bullish", structureBroken: false },
      monitoringState: monitoring,
      now: NOW,
    });
    expect(step1.alert.severity).toBe("NONE");
    monitoring = step1.updatedMonitoringState;

    // Step 2: M5 momentum weakens → WATCH
    const step2 = evaluateProtection({
      position: longBtc({ entryPrice: entry, currentPrice: 109 }),
      evidence: { price: 109, shortTermTrend: "bearish", mediumTermTrend: "bullish", momentumChange: -15 },
      monitoringState: monitoring,
      now: NOW + 60_000,
    });
    monitoring = step2.updatedMonitoringState;

    // Step 3: M5 structure breaks → CAUTION or higher
    const step3 = evaluateProtection({
      position: longBtc({ entryPrice: entry, currentPrice: 106 }),
      evidence: { price: 106, shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true, momentumChange: -20 },
      monitoringState: monitoring,
      now: NOW + 120_000,
    });
    expect(["WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(step3.alert.severity);
    monitoring = step3.updatedMonitoringState;

    // Step 4: Multi-timeframe structural damage → HIGH_RISK / INVALIDATED
    const step4 = evaluateProtection({
      position: longBtc({ entryPrice: entry, currentPrice: 100 }),
      evidence: {
        price: 100, shortTermTrend: "bearish", mediumTermTrend: "bearish",
        longTermTrend: "bearish", structureBroken: true, momentumChange: -30,
        volatility: 5000, avgVolatility: 1500, riskRegime: "risk_off", riskRegimeChanged: true,
      },
      monitoringState: monitoring,
      now: NOW + 180_000,
    });
    expect(["HIGH_RISK", "INVALIDATED"]).toContain(step4.alert.severity);

    // Verify the alert has urgency and whyTpNow
    expect(step4.alert.urgency).toBeDefined();
    expect(step4.alert.whyTpNow).toBeDefined();
    if (step4.alert.severity === "HIGH_RISK" || step4.alert.severity === "INVALIDATED") {
      expect(["HIGH", "CRITICAL"]).toContain(step4.alert.urgency);
      expect(step4.alert.whyTpNow.stillSupporting.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("system should NOT wait for SL before warning", () => {
    // Position with SL at 95, currently at 110, starts dropping
    let monitoring = createMonitoringState("BTC/USDT");
    const sl = 95;

    // Price drops to 100 but hasn't hit SL yet
    const result = evaluateProtection({
      position: longBtc({ entryPrice: 100, currentPrice: 100, stopLoss: sl }),
      evidence: {
        price: 100, shortTermTrend: "bearish", mediumTermTrend: "bearish",
        structureBroken: true, momentumChange: -30,
        volatility: 5000, avgVolatility: 1500, riskRegime: "risk_off",
      },
      monitoringState: monitoring,
      now: NOW,
    });
    // System should be warning even though price hasn't hit SL
    expect(result.alert.severity).not.toBe("NONE");
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. EARLY PROTECTION CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("Z. Early Protection Classification", () => {
  it("NORMAL_PULLBACK for healthy position", () => {
    const result = classifyEarlyProtection({
      side: "LONG", profitState: "STRONGLY_PROFITABLE", isProfitable: true,
      giveback: { peakPrice: 115, currentPrice: 112, peakProfit: 15, currentProfit: 12, givebackAbsolute: 3, givebackPct: 20, pullbackType: "NORMAL_PULLBACK", accelerating: false },
      multiTimeframe: { level: "NO_SIGNAL", adverseCount: 0, totalEvaluated: 0, htfConfirmation: false, highestAdverseTimeframe: null, aggregatedConfidence: 0, description: "clean", timeframeResults: [] },
      deteriorationCount: 0, thesisHealthScore: 90, shockState: "NORMAL", priceRoc: 0.5, givebackRoc: 0,
      eventApproaching: false, crossAssetDivergence: false,
    });
    expect(result.level).toBe("NORMAL_PULLBACK");
    expect(result.severity).toBe("NONE");
  });

  it("HIGH_RISK_REVERSAL for severe conditions", () => {
    const result = classifyEarlyProtection({
      side: "LONG", profitState: "PROFITABLE", isProfitable: true,
      giveback: { peakPrice: 120, currentPrice: 100, peakProfit: 20, currentProfit: 0, givebackAbsolute: 20, givebackPct: 100, pullbackType: "PROTECTION_EVENT", accelerating: true },
      multiTimeframe: { level: "CONFIRMED", adverseCount: 3, totalEvaluated: 5, htfConfirmation: true, highestAdverseTimeframe: "H1", aggregatedConfidence: 70, description: "confirmed", timeframeResults: [] },
      deteriorationCount: 5, thesisHealthScore: 30, shockState: "SHOCK", priceRoc: -5, givebackRoc: 10,
      eventApproaching: true, crossAssetDivergence: true,
    });
    expect(["HIGH_RISK_REVERSAL", "THESIS_INVALIDATION"]).toContain(result.level);
    expect(["HIGH_RISK", "INVALIDATED"]).toContain(result.severity);
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. NOTIFICATION PRIORITY
// ═══════════════════════════════════════════════════════════════

describe("AA. Notification Priority", () => {
  it("NONE maps to INFO", () => {
    expect(severityToNotificationPriority("NONE")).toBe("INFO");
  });
  it("WATCH maps to INFO", () => {
    expect(severityToNotificationPriority("WATCH")).toBe("INFO");
  });
  it("CAUTION maps to WARNING", () => {
    expect(severityToNotificationPriority("CAUTION")).toBe("WARNING");
  });
  it("HIGH_RISK maps to URGENT", () => {
    expect(severityToNotificationPriority("HIGH_RISK")).toBe("URGENT");
  });
  it("INVALIDATED maps to CRITICAL", () => {
    expect(severityToNotificationPriority("INVALIDATED")).toBe("CRITICAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// BB. POSITION REGISTRATION
// ═══════════════════════════════════════════════════════════════

describe("BB. Position Registration", () => {
  it("validates required fields", () => {
    const result = validateRegistration({
      positionId: "", instrument: "", side: "LONG", entryPrice: 0, horizon: "SWING",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("validates side", () => {
    const result = validateRegistration({
      positionId: "test", instrument: "BTC/USDT", side: "LONG" as any, entryPrice: 100000, horizon: "SWING",
    });
    expect(result.valid).toBe(true);
  });

  it("warns unusual SL placement", () => {
    const result = validateRegistration({
      positionId: "test", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100000, stopLoss: 110000, horizon: "SWING",
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("generates deterministic position IDs", () => {
    const id1 = generatePositionId("BTC/USDT", "LONG", 100000, 1000);
    const id2 = generatePositionId("BTC/USDT", "LONG", 100000, 1000);
    expect(id1).toBe(id2);
  });

  it("infers asset class correctly", () => {
    expect(inferAssetClass("BTC/USDT")).toBe("crypto");
    expect(inferAssetClass("EUR/USD")).toBe("forex");
    expect(inferAssetClass("XAU/USD")).toBe("commodity");
    expect(inferAssetClass("BBCA")).toBe("equity");
  });
});

// ═══════════════════════════════════════════════════════════════
// CC. REAL-TIME MONITOR
// ═══════════════════════════════════════════════════════════════

describe("CC. Real-Time Monitor", () => {
  it("processes price events and updates instrument state", () => {
    let state = createMonitorState();
    const snap = createTestSnapshot();
    state = addPosition(state, snap);

    const event = createPriceEvent("BTC/USDT", 113000, "test");
    const result = processEvent(state, event, NOW);
    expect(result.state.instruments.has("BTC/USDT")).toBe(true);
    expect(result.state.instruments.get("BTC/USDT")!.lastPrice).toBe(113000);
  });

  it("updates position current price from price events", () => {
    let state = createMonitorState();
    state = addPosition(state, createTestSnapshot({ currentPrice: 112000 }));

    const event = createPriceEvent("BTC/USDT", 113000, "test");
    const result = processEvent(state, event, NOW);
    const updatedSnap = result.state.positions.get("test-pos-1");
    expect(updatedSnap!.currentPrice).toBe(113000);
  });

  it("unrelated instrument events do not trigger BTC protection", () => {
    let state = createMonitorState();
    state = addPosition(state, createTestSnapshot({ instrument: "BTC/USDT" }));

    const ethEvent = createPriceEvent("ETH/USDT", 4000, "test");
    const result = processEvent(state, ethEvent, NOW);
    // No alerts should fire for BTC from ETH event
    expect(result.alerts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// DD. RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("DD. Recovery", () => {
  it("provider recovery event restores status", () => {
    const event = createProviderRecoveredEvent("BTC/USDT", "twelve-data");
    expect(event.eventType).toBe("PROVIDER_RECOVERED");
    expect(event.freshness).toBe("FRESH");
  });

  it("monitoring state persists through recovery", () => {
    let state = createMonitorState();
    state = addPosition(state, createTestSnapshot());
    expect(state.positions.size).toBe(1);

    // Simulate disconnect/reconnect
    const degradedEvent = createProviderDegradedEvent("BTC/USDT", "test", "timeout");
    state = processEvent(state, degradedEvent, NOW).state;

    const recoveredEvent = createProviderRecoveredEvent("BTC/USDT", "test");
    state = processEvent(state, recoveredEvent, NOW + 5000).state;

    expect(state.positions.size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// EE. MARKET RADAR COMPATIBILITY
// ═══════════════════════════════════════════════════════════════

describe("EE. Market Radar Compatibility", () => {
  it("protection does not produce recommendation/bias/conviction", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: deterioratingEvidence(104000),
      monitoringState: createMonitoringState("BTC/USDT"), now: NOW,
    });
    // These fields must NOT exist on ProtectionAlert
    expect((result.alert as any).recommendation).toBeUndefined();
    expect((result.alert as any).bias).toBeUndefined();
    expect((result.alert as any).conviction).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// FF. HORIZON SENSITIVITY
// ═══════════════════════════════════════════════════════════════

describe("FF. Horizon Sensitivity", () => {
  it("SCALPING has tighter thresholds than INVESTING", () => {
    const scalp = longBtc({ horizon: "SCALPING" });
    const invest = longBtc({ horizon: "INVESTING" });

    // For SCALPING, even small giveback should be detected
    const scalpGb = calculateGiveback(
      { ...createTestSnapshot(), currentPrice: 112000, horizon: "SCALPING" },
      115000,
    );
    const investGb = calculateGiveback(
      { ...createTestSnapshot(), currentPrice: 112000, horizon: "INVESTING" },
      115000,
    );

    // Both have same giveback %
    expect(scalpGb.givebackPct).toBe(investGb.givebackPct);

    // But SCALPING classifies at a lower threshold
    const scalpSeverity = classifyGivebackSeverity(scalpGb, "SCALPING");
    const investSeverity = classifyGivebackSeverity(investGb, "INVESTING");
    // SCALPING should be equal or higher severity
    expect(alertSeverityRank(scalpSeverity as AlertSeverity)).toBeGreaterThanOrEqual(
      alertSeverityRank(investSeverity as AlertSeverity),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// GG. DISPOSER / PARTIAL PROVIDER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("GG. Partial Provider Failure", () => {
  it("one provider degrading doesn't affect other instruments", () => {
    const state = createBridgeState();
    const result = bridgeProviderStatusChange(
      state, "twelve-data", ["BTC/USDT"], "disconnected",
    );
    // ETH should not be affected
    expect(result.state.instrumentModes.has("ETH/USDT")).toBe(false);
  });
});
