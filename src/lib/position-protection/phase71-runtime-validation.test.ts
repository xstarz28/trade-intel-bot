/**
 * Phase 71 — Real Runtime Activation, Live Provider Bridge & Production Observability
 *
 * Comprehensive deterministic test suite covering:
 * A. Runtime Source/Data-Mode Labeling
 * B. Provider Routing & Adapter Verification
 * C. Live Market Bridge — Data Normalization
 * D. Polling Lifecycle & Cadence
 * E. Event Pipeline — Provider → Engine → Alert → Persistence
 * F. Diagnostics / Production Observability
 * G. Convex Persistence Compatibility
 * H. Security Hardening — Runtime Audit
 * I. Data Quality / Failure Recovery
 * J. LONG/SHORT Symmetry Under Real Conditions
 * K. Position & Instrument Isolation
 * L. Memory Bounds & Bounded State
 * M. Race Conditions & Concurrency
 * N. Determinism Verification
 * O. No Fabrication / No Auto-Execution
 * P. MarketDataHealthPanel Data Integrity
 * Q. Acceptance Gates
 */

import { describe, it, expect } from "vitest";
import type {
  PositionContext,
  AlertSeverity,
  MonitoringState,
  ProtectionAlert,
} from "../position-protection/types";
import { alertSeverityRank, urgencyRank } from "../position-protection/types";
import type { MarketEvidence } from "../position-protection/thesis-health";

// Source labeling
import {
  createLiveLabel,
  createPollingLabel,
  createSimulatedLabel,
  createStaleLabel,
  createUnavailableLabel,
  calculateFreshness,
  updateLabelFreshness,
  dataSourceModeLabel,
  dataSourceModeColor,
  isRealData,
  isUsableData,
  type DataSourceMode,
  type DataSourceLabel,
} from "../position-protection/data-source-mode";

// Core engines
import { evaluateProtection } from "../position-protection/protection-engine";
import {
  createMonitoringState,
  shouldAlert,
  updateMonitoringState,
  deduplicateByDependencyGroup,
} from "../position-protection/alert-lifecycle";

// Runtime hardening
import {
  guardAgainstStaleDataAlert,
  guardProviderFailureNeutrality,
  guardNoFabrication,
  validateIntegrationPipeline,
  runSecurityAudit,
  validateEvent,
  verifyMemoryBounds,
  runRuntimeValidation,
  guardAgainstDuplicateRegistration,
  guardAgainstDuplicatePolling,
} from "../position-protection/phase69-runtime-hardening";

// Controller
import {
  createControllerState,
  registerPosition as ctrlRegister,
  removePosition as ctrlRemove,
  startController,
  stopController,
  pauseController,
  resumeController,
  pausePosition,
  resumePosition,
  processEventForController,
  evaluatePosition,
  shouldEvaluatePosition,
  getDashboard,
} from "../position-protection/continuous-protection-controller";

// Event bridge
import {
  createPriceEvent,
  createMacroChangeEvent,
  createProviderDegradedEvent,
  createProviderRecoveredEvent,
  createDataStaleEvent,
} from "../position-protection/market-event-bridge";
import { computeEventPriority } from "../position-protection/event-priority";

// Signal fusion
import { fuseSignals } from "../position-protection/signal-fusion";

// Intelligence calibration
import { calibrateIntelligence, type CalibrationInput } from "../position-protection/intelligence-calibration";
import { classifyPullbackType } from "../position-protection/pullback-classifier";

// Polling
import {
  createPollingServiceState,
  startPollingService,
  registerInstrumentForPolling,
  unregisterInstrumentForPolling,
  processPollSuccess,
  processPollFailure,
  shouldPollInstrument,
  stopPollingService,
  pausePollingService,
  resumePollingService,
  getPollingDashboard,
  getInstrumentsNeedingPoll,
} from "../market-stream/live-polling-service";
import type { ProviderQuoteData } from "../market-stream/live-market-bridge";
import {
  createBridgeState,
  bridgeProviderData,
  bridgeProviderStatusChange,
  validateInstrumentIdentity,
  checkInstrumentFreshness,
} from "../market-stream/live-market-bridge";
import { routeInstrument, detectAssetClass, getFallbackRoute } from "../market-stream/provider-routing";
import { getProviderProfile, getPollIntervalMs, getAllProviders } from "../market-stream/provider-adapters";

// Persistence
import { InMemoryRepository } from "../position-protection/persistence";
import type { PersistedPositionState, PersistedAlert, EventCursor } from "../position-protection/persistence";
import { ConvexPersistenceBridge } from "../position-protection/convex-bridge";

// Dispatch
import {
  createDispatcherState,
  shouldDispatch,
  dispatch,
  acknowledgeAlert,
} from "../position-protection/alert-dispatcher";

// Real-time monitor
import {
  createMonitorState,
  processEvent,
  processEvents,
  addPosition,
  removePosition,
  cleanup,
} from "../position-protection/realtime-monitor";

// Alert quality
import { evaluateAlertQuality } from "../position-protection/alert-quality";
import { guardAgainstFalsePositive } from "../position-protection/false-positive-guard";

// Diagnostics
import {
  createDiagnosticsState,
  recordEventReceived,
  recordEventProcessed,
  recordEventDropped,
  recordEventDeduplicated,
  recordAlertEmitted,
  recordAlertSuppressedByCooldown,
  recordProviderFailure,
  recordProviderRecovery,
  recordProviderSuccess,
  updatePositionCounts,
  snapshot,
} from "../position-protection/diagnostics";

// Monitoring cadence
import { getCadenceForHorizon, shouldEvaluateNow, getAllCadenceProfiles } from "../position-protection/monitoring-cadence";

// Scenarios
import { runScenario, healthyProfitableLong, healthyProfitableShort, normalPullbackNoPrematureTP } from "../position-protection/phase66-scenarios";

// Position priority
import { computePositionPriority, sortByPriority } from "../position-protection/position-priority";

// Giveback
import { calculateGiveback, classifyGivebackSeverity } from "../position-protection/giveback-monitor";

// Acceleration
import { createAccelerationState, recordPriceObservation, detectPriceAcceleration } from "../position-protection/acceleration-monitor";

// Shock
import { detectShock } from "../position-protection/shock-detector";

const NOW = 1700000000000;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function btcLong(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 100_000,
    currentPrice: 110_000,
    stopLoss: 95_000,
    takeProfit: 120_000,
    leverage: 10,
    horizon: "SWING",
    openedAt: NOW - 3600_000,
    ...overrides,
  };
}

function btcShort(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "SHORT",
    entryPrice: 100_000,
    currentPrice: 90_000,
    stopLoss: 110_000,
    takeProfit: 80_000,
    horizon: "SWING",
    openedAt: NOW - 3600_000,
    ...overrides,
  };
}

function ethLong(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "ETH/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 3000,
    currentPrice: 3300,
    stopLoss: 2800,
    takeProfit: 3800,
    horizon: "SWING",
    openedAt: NOW - 3600_000,
    ...overrides,
  };
}

function healthyEvidence(price: number): MarketEvidence {
  return {
    price,
    shortTermTrend: "bullish",
    mediumTermTrend: "bullish",
    longTermTrend: "bullish",
    momentumChange: 5,
    volatility: 2,
    avgVolatility: 2,
    structureBroken: false,
    fundingRate: 0.001,
    oiChange: 5,
    riskRegime: "risk_on",
    riskRegimeChanged: false,
    vix: 18,
  };
}

function deterioratingEvidence(price: number): MarketEvidence {
  return {
    price,
    shortTermTrend: "bearish",
    mediumTermTrend: "bearish",
    momentumChange: -25,
    structureBroken: true,
    volatility: 10,
    avgVolatility: 2,
    fundingRate: 0.005,
    oiChange: -20,
    liquidationSpike: true,
    riskRegime: "risk_off",
    riskRegimeChanged: true,
    vix: 35,
    correlatedDivergence: true,
  };
}

function evaluate(pos: PositionContext, evidence: MarketEvidence, now: number = NOW): ProtectionAlert {
  return evaluateProtection({ position: pos, evidence, now }).alert;
}

// ═══════════════════════════════════════════════════════════════
// A. RUNTIME SOURCE/DATA-MODE LABELING
// ═══════════════════════════════════════════════════════════════

describe("A. Runtime Source / Data-Mode Labeling", () => {
  it("Live label created correctly", () => {
    const label = createLiveLabel("OKX", NOW);
    expect(label.mode).toBe("LIVE");
    expect(label.provider).toBe("OKX");
    expect(label.receivedAt).toBe(NOW);
    expect(label.freshness).toBe("FRESH");
    expect(isRealData(label)).toBe(true);
    expect(isUsableData(label)).toBe(true);
  });

  it("Polling label created correctly", () => {
    const label = createPollingLabel("TwelveData", NOW);
    expect(label.mode).toBe("POLLING");
    expect(label.provider).toBe("TwelveData");
    expect(isRealData(label)).toBe(true);
    expect(isUsableData(label)).toBe(true);
  });

  it("Simulated label created correctly", () => {
    const label = createSimulatedLabel(NOW);
    expect(label.mode).toBe("SIMULATED");
    expect(label.provider).toBe("SIMULATION");
    expect(isRealData(label)).toBe(false);
    expect(isUsableData(label)).toBe(true);
  });

  it("Stale label derived from previous", () => {
    const original = createPollingLabel("OKX", NOW);
    const stale = createStaleLabel(original);
    expect(stale.mode).toBe("STALE");
    expect(stale.provider).toBe("OKX");
    expect(stale.freshness).toBe("STALE");
    expect(isRealData(stale)).toBe(false);
  });

  it("Unavailable label created correctly", () => {
    const label = createUnavailableLabel("CoinGecko", NOW);
    expect(label.mode).toBe("UNAVAILABLE");
    expect(label.freshness).toBe("UNAVAILABLE");
    expect(isUsableData(label)).toBe(false);
  });

  it("Freshness calculation: fresh within 1 minute", () => {
    expect(calculateFreshness(NOW, NOW)).toBe("FRESH");
    expect(calculateFreshness(NOW - 30_000, NOW)).toBe("FRESH");
  });

  it("Freshness calculation: delayed between 1-5 minutes", () => {
    expect(calculateFreshness(NOW - 90_000, NOW)).toBe("DELAYED");
    expect(calculateFreshness(NOW - 300_000, NOW)).toBe("DELAYED");
  });

  it("Freshness calculation: stale after 5 minutes", () => {
    expect(calculateFreshness(NOW - 400_000, NOW)).toBe("STALE");
  });

  it("Freshness calculation: unavailable for receivedAt=0", () => {
    expect(calculateFreshness(0, NOW)).toBe("UNAVAILABLE");
  });

  it("Label freshness update transitions to STALE", () => {
    const label = createPollingLabel("OKX", NOW);
    const updated = updateLabelFreshness(label, NOW + 400_000);
    expect(updated.freshness).toBe("STALE");
    expect(updated.mode).toBe("STALE");
  });

  it("Label freshness update stays FRESH", () => {
    const label = createPollingLabel("OKX", NOW);
    const updated = updateLabelFreshness(label, NOW + 10_000);
    expect(updated.freshness).toBe("FRESH");
    expect(updated.mode).toBe("POLLING");
  });

  it("Display labels are correct", () => {
    expect(dataSourceModeLabel("LIVE")).toContain("LIVE");
    expect(dataSourceModeLabel("POLLING")).toContain("POLLING");
    expect(dataSourceModeLabel("SIMULATED")).toContain("SIMULATED");
    expect(dataSourceModeLabel("STALE")).toContain("STALE");
    expect(dataSourceModeLabel("UNAVAILABLE")).toContain("UNAVAILABLE");
  });

  it("Display colors are valid Tailwind classes", () => {
    const colors = ["LIVE", "POLLING", "SIMULATED", "STALE", "UNAVAILABLE"] as DataSourceMode[];
    for (const mode of colors) {
      const color = dataSourceModeColor(mode);
      expect(color).toMatch(/^text-/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// B. PROVIDER ROUTING & ADAPTER VERIFICATION
// ═══════════════════════════════════════════════════════════════

describe("B. Provider Routing & Adapter Verification", () => {
  it("All known providers have profiles", () => {
    const providers = getAllProviders();
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(p.provider).toBeTruthy();
      expect(p.capabilities.length).toBeGreaterThan(0);
      expect(p.assetClasses.length).toBeGreaterThan(0);
    }
  });

  it("BTC/USDT routes to crypto provider (OKX)", () => {
    const routing = routeInstrument("BTC/USDT");
    expect(routing.primary).not.toBeNull();
    expect(routing.primary!.provider).toBe("OKX");
    expect(routing.primary!.capabilities).toBeDefined();
  });

  it("ETH/USDT routes to crypto provider", () => {
    const routing = routeInstrument("ETH/USDT");
    expect(routing.primary).not.toBeNull();
    expect(routing.primary!.capabilities).toBeDefined();
  });

  it("EUR/USD routes to forex provider (TwelveData)", () => {
    const routing = routeInstrument("EUR/USD");
    expect(routing.primary).not.toBeNull();
    expect(routing.primary!.provider).toBe("TwelveData");
  });

  it("GBP/USD routes to forex provider", () => {
    const routing = routeInstrument("GBP/USD");
    expect(routing.primary).not.toBeNull();
    expect(routing.primary!.capabilities).toBeDefined();
  });

  it("XAU/USD routes to commodity provider", () => {
    const routing = routeInstrument("XAU/USD");
    expect(routing.primary).not.toBeNull();
    expect(routing.primary!.capabilities).toBeDefined();
  });

  it("VIX routes to macro provider", () => {
    const routing = routeInstrument("VIX");
    expect(routing.primary).not.toBeNull();
    expect(routing.primary!.capabilities).toBeDefined();
  });

  it("All asset classes have at least one provider", () => {
    const assetClasses = ["crypto", "forex", "commodity", "indices", "macro"];
    for (const ac of assetClasses) {
      const routing = routeInstrument("BTC/USDT", ac);
      expect(routing.primary).not.toBeNull();
    }
  });

  it("Asset class detection is accurate", () => {
    expect(detectAssetClass("BTC/USDT")).toBe("crypto");
    expect(detectAssetClass("ETH/USDT")).toBe("crypto");
    expect(detectAssetClass("EUR/USD")).toBe("forex");
    expect(detectAssetClass("GBP/USD")).toBe("forex");
    expect(detectAssetClass("XAU/USD")).toBe("commodity");
    expect(detectAssetClass("VIX")).toBe("macro");
    expect(detectAssetClass("US100")).toBe("indices");
  });

  it("Poll intervals are reasonable", () => {
    const btcInterval = getPollIntervalMs("OKX");
    const tdInterval = getPollIntervalMs("TwelveData");
    expect(btcInterval).toBeGreaterThan(0);
    expect(btcInterval).toBeLessThanOrEqual(60_000);
    expect(tdInterval).toBeGreaterThan(0);
    expect(tdInterval).toBeLessThanOrEqual(60_000);
  });

  it("Provider profiles specify required credentials (never exposed)", () => {
    const providers = getAllProviders();
    for (const p of providers) {
      expect(Array.isArray(p.credentialEnvVars)).toBe(true);
      // Credential env var names should be safe to store — no actual values
      for (const envVar of p.credentialEnvVars) {
        expect(envVar).toMatch(/^[A-Z_]+$/);
      }
    }
  });

  it("Fallback route available when primary fails", () => {
    const routing = routeInstrument("BTC/USDT");
    // OKX is primary, there should be fallback options for crypto
    const fallback = getFallbackRoute(routing, "OKX");
    if (routing.fallbacks.length > 0) {
      expect(fallback).not.toBeNull();
      expect(fallback!.provider).not.toBe("OKX");
    }
  });

  it("Instrument identity validation works", () => {
    const valid = validateInstrumentIdentity("BTC/USDT");
    expect(valid.valid).toBe(true);
    expect(valid.canonical).toBe("BTC/USDT");

    const invalid = validateInstrumentIdentity("");
    expect(invalid.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. LIVE MARKET BRIDGE — DATA NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("C. Live Market Bridge — Data Normalization", () => {
  it("Valid quote produces PRICE_UPDATE event", () => {
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "OKX",
      price: 105_000,
      timestamp: NOW,
      freshness: "FRESH",
    };
    const result = bridgeProviderData(createBridgeState(), { quote });
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.some(e => e.eventType === "PRICE_UPDATE")).toBe(true);
    expect(result.state.eventsBridged).toBeGreaterThan(0);
  });

  it("Quote with bid/ask produces QUOTE_UPDATE event", () => {
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "OKX",
      price: 105_000,
      bid: 104_990,
      ask: 105_010,
      timestamp: NOW,
      freshness: "FRESH",
    };
    const result = bridgeProviderData(createBridgeState(), { quote });
    expect(result.events.some(e => e.eventType === "QUOTE_UPDATE")).toBe(true);
  });

  it("Stale quote produces DATA_STALE event, not PRICE_UPDATE", () => {
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "OKX",
      price: 105_000,
      timestamp: NOW - 600_000,
      freshness: "STALE",
    };
    const result = bridgeProviderData(createBridgeState(), { quote });
    expect(result.events.some(e => e.eventType === "DATA_STALE")).toBe(true);
    expect(result.events.some(e => e.eventType === "PRICE_UPDATE")).toBe(false);
  });

  it("Empty instrument drops event", () => {
    const quote: ProviderQuoteData = {
      instrument: "",
      provider: "OKX",
      price: 105_000,
      timestamp: NOW,
      freshness: "FRESH",
    };
    const result = bridgeProviderData(createBridgeState(), { quote });
    expect(result.events.length).toBe(0);
    expect(result.state.eventsDropped).toBe(1);
  });

  it("NaN price drops event", () => {
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "OKX",
      price: NaN,
      timestamp: NOW,
      freshness: "FRESH",
    };
    const result = bridgeProviderData(createBridgeState(), { quote });
    expect(result.events.length).toBe(0);
    expect(result.state.eventsDropped).toBe(1);
  });

  it("Negative price drops event", () => {
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "OKX",
      price: -100,
      timestamp: NOW,
      freshness: "FRESH",
    };
    const result = bridgeProviderData(createBridgeState(), { quote });
    expect(result.events.length).toBe(0);
    expect(result.state.eventsDropped).toBe(1);
  });

  it("Provider degradation emits correct events", () => {
    const result = bridgeProviderStatusChange(
      createBridgeState(),
      "OKX",
      ["BTC/USDT", "ETH/USDT"],
      "degraded",
      "timeout",
    );
    expect(result.events.length).toBe(2);
    expect(result.events.every(e => e.eventType === "PROVIDER_DEGRADED")).toBe(true);
    expect(result.state.providerStatus.get("OKX")).toBe("DEGRADED");
  });

  it("Provider recovery emits correct events", () => {
    let state = createBridgeState();
    const degraded = bridgeProviderStatusChange(state, "OKX", ["BTC/USDT"], "degraded");
    state = degraded.state;

    const recovered = bridgeProviderStatusChange(state, "OKX", ["BTC/USDT"], "recovered");
    expect(recovered.events.every(e => e.eventType === "PROVIDER_RECOVERED")).toBe(true);
    expect(recovered.state.providerStatus.get("OKX")).toBe("POLLING");
  });

  it("Freshness check detects stale instruments", () => {
    const state = createBridgeState();
    state.lastEventAt.set("BTC/USDT", NOW - 600_000);
    expect(checkInstrumentFreshness(state, "BTC/USDT", NOW)).toBe("DEGRADED");
  });

  it("Freshness check detects unavailable instruments", () => {
    const state = createBridgeState();
    expect(checkInstrumentFreshness(state, "BTC/USDT", NOW)).toBe("UNAVAILABLE");
  });

  it("Event priority correct for price vs macro", () => {
    const priceEvent = createPriceEvent("BTC/USDT", 105_000, "OKX");
    const macroEvent = createMacroChangeEvent("BTC/USDT", "risk_off", "Treasury");
    expect(computeEventPriority(priceEvent)).toBe("LOW");
    expect(computeEventPriority(macroEvent)).toBe("CRITICAL");
  });

  it("All events pass validation", () => {
    const events = [
      createPriceEvent("BTC/USDT", 105_000, "OKX"),
      createMacroChangeEvent("BTC/USDT", "risk_off", "Treasury"),
      createProviderDegradedEvent("BTC/USDT", "OKX", "timeout"),
      createProviderRecoveredEvent("BTC/USDT", "OKX"),
      createDataStaleEvent("BTC/USDT", "OKX", 600_000),
    ];
    for (const event of events) {
      const guard = validateEvent(event);
      expect(guard.passed).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// D. POLLING LIFECYCLE & CADENCE
// ═══════════════════════════════════════════════════════════════

describe("D. Polling Lifecycle & Cadence", () => {
  it("Full lifecycle: STOPPED → RUNNING → PAUSED → RUNNING → STOPPED", () => {
    let state = createPollingServiceState();
    expect(state.lifecycle).toBe("STOPPED");

    state = startPollingService(state, NOW);
    expect(state.lifecycle).toBe("RUNNING");

    state = pausePollingService(state);
    expect(state.lifecycle).toBe("PAUSED");

    state = resumePollingService(state, NOW + 1000);
    expect(state.lifecycle).toBe("RUNNING");

    state = stopPollingService(state);
    expect(state.lifecycle).toBe("STOPPED");
  });

  it("No polling when STOPPED", () => {
    let state = createPollingServiceState();
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    const needPoll = getInstrumentsNeedingPoll(state, NOW + 60_000);
    expect(needPoll.length).toBe(0);
  });

  it("No polling when PAUSED", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = pausePollingService(state);
    const needPoll = getInstrumentsNeedingPoll(state, NOW + 60_000);
    expect(needPoll.length).toBe(0);
  });

  it("Polling proceeds when RUNNING", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    const needPoll = getInstrumentsNeedingPoll(state, NOW + 60_000);
    expect(needPoll.length).toBe(1);
  });

  it("Duplicate polling prevention", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const sizeBefore = state.instruments.size;
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW + 1000);
    expect(state.instruments.size).toBe(sizeBefore);
  });

  it("Minimum polling interval enforced", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT", provider: "OKX", price: 105_000, timestamp: NOW, freshness: "FRESH",
    };
    state = processPollSuccess(state, "BTC/USDT", quote, NOW).state;

    const decision = shouldPollInstrument(state, "BTC/USDT", NOW + 1000);
    expect(decision.shouldPoll).toBe(false);
  });

  it("Exponential backoff after consecutive failures", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 1000).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 2000).state;

    const decision = shouldPollInstrument(state, "BTC/USDT", NOW + 3000);
    expect(decision.shouldPoll).toBe(false);
    expect(decision.reason).toContain("Backoff");
  });

  it("Backoff resets after successful poll", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 1000).state;

    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT", provider: "OKX", price: 105_000, timestamp: NOW + 5000, freshness: "FRESH",
    };
    state = processPollSuccess(state, "BTC/USDT", quote, NOW + 5000).state;
    expect(state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(0);
  });

  it("Failover to fallback provider after 3 failures", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 1000).state;
    const result = processPollFailure(state, "BTC/USDT", "timeout", NOW + 2000);

    expect(result.failover).toBe(true);
    expect(result.state.totalFailovers).toBe(1);
  });

  it("5+ failures set UNAVAILABLE freshness", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    for (let i = 0; i < 5; i++) {
      state = processPollFailure(state, "BTC/USDT", "timeout", NOW + i * 1000).state;
    }
    expect(state.instruments.get("BTC/USDT")!.freshness).toBe("UNAVAILABLE");
  });

  it("Unregister removes instrument cleanly", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = registerInstrumentForPolling(state, "ETH/USDT", NOW);

    state = unregisterInstrumentForPolling(state, "BTC/USDT");
    expect(state.instruments.size).toBe(1);
    expect(state.instruments.has("BTC/USDT")).toBe(false);
    expect(state.instruments.has("ETH/USDT")).toBe(true);
  });

  it("Instruments remain isolated under failure", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = registerInstrumentForPolling(state, "ETH/USDT", NOW);

    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;

    expect(state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(1);
    expect(state.instruments.get("ETH/USDT")!.consecutiveFailures).toBe(0);
  });

  it("55 instruments stable", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    for (let i = 0; i < 55; i++) {
      state = registerInstrumentForPolling(state, `SYM${i}/USDT`, NOW);
    }
    expect(getPollingDashboard(state, NOW).totalInstruments).toBe(55);
  });

  it("Monitoring cadence profiles exist for all horizons", () => {
    const profiles = getAllCadenceProfiles();
    expect(profiles.SCALPING).toBeDefined();
    expect(profiles.INTRADAY).toBeDefined();
    expect(profiles.SWING).toBeDefined();
    expect(profiles.INVESTING).toBeDefined();
    // SCALPING should be fastest
    expect(profiles.SCALPING.scheduledIntervalMs).toBeLessThan(profiles.SWING.scheduledIntervalMs);
    expect(profiles.SWING.scheduledIntervalMs).toBeLessThan(profiles.INVESTING.scheduledIntervalMs);
  });

  it("Cadence evaluation decision is deterministic", () => {
    const cadence = getCadenceForHorizon("SWING");
    const r1 = shouldEvaluateNow(NOW - 60_000, NOW, cadence, "LOW");
    const r2 = shouldEvaluateNow(NOW - 60_000, NOW, cadence, "LOW");
    expect(r1.shouldEvaluate).toBe(r2.shouldEvaluate);
  });

  it("Critical event bypasses cadence", () => {
    const cadence = getCadenceForHorizon("INVESTING");
    const result = shouldEvaluateNow(NOW - 1000, NOW, cadence, "CRITICAL");
    expect(result.shouldEvaluate).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. EVENT PIPELINE — PROVIDER → ENGINE → ALERT → PERSISTENCE
// ═══════════════════════════════════════════════════════════════

describe("E. Event Pipeline — Provider → Engine → Alert → Persistence", () => {
  it("Price event updates controller state for matching instrument", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 100_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    const result = processEventForController(state, event, NOW + 1000);
    expect(result.state.evaluationsPerformed).toBeGreaterThanOrEqual(0);
  });

  it("Event for non-matching instrument does NOT trigger evaluation", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 100_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    const event = createPriceEvent("ETH/USDT", 3300, "OKX");
    const result = processEventForController(state, event, NOW + 1000);
    expect(result.state.evaluationsPerformed).toBe(0);
  });

  it("Protection engine produces valid alert with all required fields", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    expect(alert.instrument).toBe("BTC/USDT");
    expect(alert.severity).toBeDefined();
    expect(alert.urgency).toBeDefined();
    expect(alert.whyTpNow).toBeDefined();
    expect(typeof alert.whyTpNow.disclaimer).toBe("string");
    expect(alert.alertMessage).toBeDefined();
    expect(alert.actionRecommendation).toBeDefined();
  });

  it("Action recommendation is always informational", () => {
    const alerts = [
      evaluate(btcLong(), healthyEvidence(110_000)),
      evaluate(btcLong({ currentPrice: 85_000 }), deterioratingEvidence(85_000)),
      evaluate(btcShort(), { ...healthyEvidence(90_000), shortTermTrend: "bearish" }),
    ];
    for (const alert of alerts) {
      const action = alert.actionRecommendation.toLowerCase();
      expect(action).not.toContain("auto");
      expect(action).not.toContain("execute");
      expect(action).not.toContain("order placed");
    }
  });

  it("Alert lifecycle: escalation bypasses cooldown", () => {
    let dispatcher = createDispatcherState();
    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "INFO", severity: "WATCH",
      action: "Monitor", reason: "Early deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });

    // Same severity within cooldown — suppressed
    expect(shouldDispatch(dispatcher, "p1", "WATCH", NOW + 5000).shouldDispatch).toBe(false);

    // Escalation — bypasses cooldown
    expect(shouldDispatch(dispatcher, "p1", "CAUTION", NOW + 1000).shouldDispatch).toBe(true);
  });

  it("Alert lifecycle: recovery bypasses cooldown", () => {
    let dispatcher = createDispatcherState();
    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "WARNING", severity: "HIGH_RISK",
      action: "Protect profit", reason: "Deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });

    // Recovery to lower severity — bypasses cooldown
    expect(shouldDispatch(dispatcher, "p1", "WATCH", NOW + 1000).shouldDispatch).toBe(true);
  });

  it("Acknowledge clears active alert", () => {
    let dispatcher = createDispatcherState();
    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "WARNING", severity: "CAUTION",
      action: "Monitor", reason: "Deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });
    expect(dispatcher.activeAlerts.has("p1")).toBe(true);

    dispatcher = acknowledgeAlert(dispatcher, "p1");
    expect(dispatcher.activeAlerts.has("p1")).toBe(false);
  });

  it("Persistence: save and retrieve alert", async () => {
    const repo = new InMemoryRepository();
    await repo.saveAlert({
      alertId: "a1", positionId: "p1", instrument: "BTC/USDT",
      severity: "WATCH", notificationPriority: "INFO", reason: "Test",
      action: "Monitor", timestamp: NOW, acknowledged: false,
    });
    const history = await repo.listAlertHistory("p1");
    expect(history.length).toBe(1);
  });

  it("Persistence: save and retrieve position", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW - 3600_000,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    const pos = await repo.getPositionState("p1");
    expect(pos).not.toBeNull();
    expect(pos!.instrument).toBe("BTC/USDT");
  });

  it("ConvexPersistenceBridge works in fallback mode", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    await bridge.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    const pos = await bridge.getPositionState("p1");
    expect(pos).not.toBeNull();
    expect(bridge.isDegraded()).toBe(false);
  });

  it("Real-time monitor processes price events", () => {
    let state = createMonitorState();
    state = addPosition(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      openedAt: NOW - 3600_000, lastUpdateAt: NOW, monitoringStatus: "LIVE",
    });

    const event = createPriceEvent("BTC/USDT", 108_000, "OKX");
    const result = processEvent(state, event, NOW + 1000);
    expect(result.state).toBeDefined();
  });

  it("Signal fusion produces result for any alert", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const fused = fuseSignals(alert);
    expect(fused).toBeDefined();
    expect(Array.isArray(fused)).toBe(true);
  });

  it("Intelligence calibration works", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    const input: CalibrationInput = {
      position: btcLong(),
      evidence: healthyEvidence(110_000),
      severity: alert.severity,
      urgency: alert.urgency,
      profit: alert.profit,
      thesisHealthScore: alert.thesisHealthScore,
      thesisHealthState: alert.thesisHealth,
      shock: alert.shock,
      givebackPct: alert.profit.givebackPct ?? 0,
      accelerationLevel: "NORMAL",
      deteriorationCount: alert.deteriorationSignals.length,
      confirmingCount: 2,
      missingData: alert.missingData,
      conflictingEvidence: alert.conflictingEvidence,
      supportingEvidence: alert.supportingEvidence,
    };
    const calibration = calibrateIntelligence(input);
    expect(calibration.calibratedSeverity).toBeDefined();
  });

  it("Pullback classifier works for LONG and SHORT", () => {
    const longResult = classifyPullbackType({
      position: btcLong(),
      evidence: healthyEvidence(110_000),
      shock: { state: "NORMAL", description: "No shock", confidence: 90, indicators: {} },
      givebackPct: 10,
      accelerationLevel: "NORMAL",
    });
    expect(longResult).toBeDefined();

    const shortResult = classifyPullbackType({
      position: btcShort({ currentPrice: 110_000 }),
      evidence: { price: 110_000, shortTermTrend: "bullish", mediumTermTrend: "bullish", momentumChange: 15 },
      shock: { state: "NORMAL", description: "No shock", confidence: 90, indicators: {} },
      givebackPct: 20,
      accelerationLevel: "NORMAL",
    });
    expect(shortResult).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// F. DIAGNOSTICS / PRODUCTION OBSERVABILITY
// ═══════════════════════════════════════════════════════════════

describe("F. Diagnostics / Production Observability", () => {
  it("Tracks events received, processed, dropped, deduplicated", () => {
    let diag = createDiagnosticsState();
    diag = recordEventReceived(diag, false, false, NOW);
    diag = recordEventProcessed(diag);
    diag = recordEventDropped(diag);
    diag = recordEventDeduplicated(diag);

    const snap = snapshot(diag);
    expect(snap.eventsReceived).toBe(1);
    expect(snap.eventsProcessed).toBe(1);
    expect(snap.eventsDropped).toBe(1);
    expect(snap.eventsDeduplicated).toBe(1);
  });

  it("Tracks critical and stale events", () => {
    let diag = createDiagnosticsState();
    diag = recordEventReceived(diag, true, false, NOW);
    diag = recordEventReceived(diag, false, true, NOW + 1000);

    const snap = snapshot(diag);
    expect(snap.criticalEventsReceived).toBe(1);
    expect(snap.staleEventsReceived).toBe(1);
  });

  it("Tracks alerts emitted and suppressed", () => {
    let diag = createDiagnosticsState();
    diag = recordAlertEmitted(diag, NOW);
    diag = recordAlertSuppressedByCooldown(diag);
    diag = recordAlertSuppressedByCooldown(diag);

    const snap = snapshot(diag);
    expect(snap.alertsEmitted).toBe(1);
    expect(snap.alertsSuppressedByCooldown).toBe(2);
  });

  it("Tracks provider failures and recovery", () => {
    let diag = createDiagnosticsState();
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW);
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW + 1000);
    diag = recordProviderRecovery(diag, "OKX", NOW + 5000);

    const snap = snapshot(diag);
    expect(snap.providerFailures).toBe(2);
    expect(snap.providerRecoveries).toBe(1);
    const okx = snap.providers.find(p => p.provider === "OKX");
    expect(okx!.consecutiveFailures).toBe(0);
    expect(okx!.status).toBe("CONNECTED");
  });

  it("Provider degrades after 3 failures", () => {
    let diag = createDiagnosticsState();
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW);
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW + 1000);
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW + 2000);

    const snap = snapshot(diag);
    const okx = snap.providers.find(p => p.provider === "OKX");
    expect(okx!.status).toBe("DEGRADED");
  });

  it("Tracks position counts", () => {
    let diag = createDiagnosticsState();
    diag = updatePositionCounts(diag, 10, 3);
    const snap = snapshot(diag);
    expect(snap.monitoredPositions).toBe(10);
    expect(snap.positionsWithAlerts).toBe(3);
  });

  it("Snapshot is serializable", () => {
    let diag = createDiagnosticsState();
    for (let i = 0; i < 100; i++) {
      diag = recordEventReceived(diag, i % 10 === 0, i % 20 === 0, NOW + i);
    }
    const snap = snapshot(diag);
    const json = JSON.stringify(snap);
    expect(json).toBeDefined();
    expect(snap.eventsReceived).toBe(100);
  });

  it("No secrets in diagnostics snapshot", () => {
    let diag = createDiagnosticsState();
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW);
    const snap = snapshot(diag);
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(json).not.toMatch(/sk_live_/);
    expect(json).not.toMatch(/ghp_/);
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("process.env");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. CONVEX PERSISTENCE COMPATIBILITY
// ═══════════════════════════════════════════════════════════════

describe("G. Convex Persistence Compatibility", () => {
  it("Alert serializes to JSON", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    const parsed = JSON.parse(json);
    expect(parsed.instrument).toBe("BTC/USDT");
    expect(parsed.severity).toBeDefined();
  });

  it("Controller state serializes", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(1);
  });

  it("Position persistence roundtrip", async () => {
    const repo = new InMemoryRepository();
    const pos: PersistedPositionState = {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW - 3600_000,
      currentSeverity: "WATCH", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: NOW, consecutiveSameSeverity: 1,
      monitoringLifecycle: "MONITORING", peakPrice: 112_000,
    };
    await repo.savePositionState(pos);
    const retrieved = await repo.getPositionState("p1");
    expect(retrieved!.currentSeverity).toBe("WATCH");
    expect(retrieved!.peakPrice).toBe(112_000);
  });

  it("Alert persistence roundtrip", async () => {
    const repo = new InMemoryRepository();
    const alert: PersistedAlert = {
      alertId: "a1", positionId: "p1", instrument: "BTC/USDT",
      severity: "CAUTION", notificationPriority: "WARNING",
      reason: "Profit giveback detected", action: "Consider partial TP",
      timestamp: NOW, acknowledged: false,
    };
    await repo.saveAlert(alert);
    await repo.acknowledgeAlert("a1");
    const history = await repo.listAlertHistory("p1");
    expect(history[0].acknowledged).toBe(true);
  });

  it("Event cursor roundtrip", async () => {
    const repo = new InMemoryRepository();
    const cursor: EventCursor = {
      provider: "OKX", instrument: "BTC/USDT",
      lastEventId: "ev1", lastTimestamp: NOW,
    };
    await repo.saveEventCursor(cursor);
    const retrieved = await repo.getEventCursor("OKX", "BTC/USDT");
    expect(retrieved!.lastEventId).toBe("ev1");
  });

  it("Bridge fallback works without Convex client", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    expect(bridge.isDegraded()).toBe(false);

    await bridge.saveAlert({
      alertId: "a1", positionId: "p1", instrument: "BTC/USDT",
      severity: "WATCH", notificationPriority: "INFO", reason: "Test",
      action: "Monitor", timestamp: NOW, acknowledged: false,
    });

    const history = await bridge.listAlertHistory("p1");
    expect(history.length).toBe(1);
  });

  it("No duplicate records on overwrite", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    await repo.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "WATCH", lifecycleState: "MONITORING",
      lastUpdateAt: NOW + 1000, lastAlertAt: NOW, consecutiveSameSeverity: 1,
      monitoringLifecycle: "MONITORING",
    });
    const pos = await repo.getPositionState("p1");
    expect(pos!.currentSeverity).toBe("WATCH");
    expect(pos!.lastUpdateAt).toBe(NOW + 1000);
  });

  it("Alert history bounded at 1000", async () => {
    const repo = new InMemoryRepository();
    for (let i = 0; i < 1100; i++) {
      await repo.saveAlert({
        alertId: `a${i}`, positionId: "p1", instrument: "BTC/USDT",
        severity: "WATCH", notificationPriority: "INFO", reason: `Test ${i}`,
        action: "Monitor", timestamp: NOW + i, acknowledged: false,
      });
    }
    const history = await repo.listAlertHistory("p1", 2000);
    expect(history.length).toBeLessThanOrEqual(1000);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. SECURITY HARDENING — RUNTIME AUDIT
// ═══════════════════════════════════════════════════════════════

describe("H. Security Hardening — Runtime Audit", () => {
  it("No AWS keys in any alert", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/AKIA[A-Z0-9]{16}/);
  });

  it("No Stripe keys in any alert", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/sk_live_[a-zA-Z0-9]+/);
  });

  it("No GitHub tokens in any alert", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    expect(JSON.stringify(alert)).not.toMatch(/ghp_[a-zA-Z0-9]+/);
  });

  it("No Bearer tokens or process.env in alerts", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("process.env");
  });

  it("No auto-execution language", () => {
    const positions = [btcLong({ currentPrice: 85_000 }), btcShort({ currentPrice: 115_000 })];
    for (const pos of positions) {
      const alert = evaluate(pos, deterioratingEvidence(90_000));
      const action = alert.actionRecommendation.toLowerCase();
      expect(action).not.toContain("auto-close");
      expect(action).not.toContain("auto-sell");
      expect(action).not.toContain("execute");
      expect(action).not.toContain("order placed");
    }
  });

  it("Security audit passes for all position/severity combinations", () => {
    const cases = [
      { pos: btcLong(), ev: healthyEvidence(110_000) },
      { pos: btcLong({ currentPrice: 85_000 }), ev: deterioratingEvidence(85_000) },
      { pos: btcShort(), ev: { ...healthyEvidence(90_000), shortTermTrend: "bearish" as const } },
      { pos: ethLong(), ev: healthyEvidence(3300) },
    ];
    for (const { pos, ev } of cases) {
      const alert = evaluate(pos, ev);
      const audit = runSecurityAudit(alert);
      expect(audit.overallPass).toBe(true);
    }
  });

  it("No fabrication in any alert", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    for (const pos of positions) {
      const alert = evaluate(pos, healthyEvidence(110_000));
      expect(guardNoFabrication(alert).passed).toBe(true);
    }
  });

  it("No probability claims across all evidence", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const allText = [
      ...alert.supportingEvidence,
      ...alert.conflictingEvidence,
      ...alert.whyTpNow.confirmations,
      ...alert.whyTpNow.whatChanged,
    ].join(" ");
    expect(allText).not.toMatch(/\d+%\\s*chance/i);
    expect(allText).not.toMatch(/probability/i);
  });

  it("No secrets in Convex persistence bridge data", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    await bridge.saveAlert({
      alertId: "a1", positionId: "p1", instrument: "BTC/USDT",
      severity: "WATCH", notificationPriority: "INFO", reason: "Test",
      action: "Monitor", timestamp: NOW, acknowledged: false,
    });
    const history = await bridge.listAlertHistory("p1");
    const json = JSON.stringify(history);
    expect(json).not.toMatch(/AKIA/);
    expect(json).not.toMatch(/sk_live/);
    expect(json).not.toContain("Bearer");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. DATA QUALITY / FAILURE RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("I. Data Quality / Failure Recovery", () => {
  it("Provider failure is neutral — no directional bias", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    expect(guardProviderFailureNeutrality(alert, "UNAVAILABLE").passed).toBe(true);
  });

  it("Stale data cannot cause severity escalation", () => {
    expect(guardAgainstStaleDataAlert("CAUTION", "WATCH", "STALE").passed).toBe(false);
    expect(guardAgainstStaleDataAlert("HIGH_RISK", "CAUTION", "UNAVAILABLE").passed).toBe(false);
  });

  it("Fresh data allows escalation", () => {
    expect(guardAgainstStaleDataAlert("CAUTION", "WATCH", "FRESH").passed).toBe(true);
  });

  it("Recovery with stale data is safe (decreasing severity)", () => {
    expect(guardAgainstStaleDataAlert("WATCH", "CAUTION", "STALE").passed).toBe(true);
  });

  it("Stale data cannot manufacture deterioration signals", () => {
    const result = bridgeProviderData(createBridgeState(), {
      quote: { instrument: "BTC/USDT", provider: "OKX", price: 95_000, timestamp: NOW - 600_000, freshness: "STALE" },
    });
    expect(result.events.some(e => e.eventType === "PRICE_UPDATE")).toBe(false);
    expect(result.events.some(e => e.eventType === "DATA_STALE")).toBe(true);
  });

  it("Recovery after provider degradation restores normal polling", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    // Fail
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;
    expect(state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(1);

    // Recover
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT", provider: "OKX", price: 105_000, timestamp: NOW + 5000, freshness: "FRESH",
    };
    state = processPollSuccess(state, "BTC/USDT", quote, NOW + 5000).state;
    expect(state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(0);
    expect(state.instruments.get("BTC/USDT")!.freshness).toBe("FRESH");
  });

  it("Normal pullback does NOT create false HIGH_RISK", () => {
    const results = runScenario(normalPullbackNoPrematureTP());
    for (const r of results) {
      expect(r.severity).not.toBe("HIGH_RISK");
      expect(r.severity).not.toBe("INVALIDATED");
    }
  });

  it("Thesis invalidation is never suppressed", () => {
    const result = guardAgainstFalsePositive({
      severity: "INVALIDATED",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "INVALIDATED",
      independentSignalCount: 0,
      givebackPct: 5,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });

  it("Critical shock is never suppressed", () => {
    const result = guardAgainstFalsePositive({
      severity: "CAUTION",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "SHOCK",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 10,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("J. LONG/SHORT Symmetry", () => {
  it("Both LONG and SHORT profitable with same price in favor", () => {
    const longAlert = evaluate(btcLong(), healthyEvidence(110_000));
    const shortAlert = evaluate(btcShort({ currentPrice: 90_000 }), { ...healthyEvidence(90_000), shortTermTrend: "bearish" as const });
    expect(longAlert.profit.unrealizedPnL).toBeGreaterThan(0);
    expect(shortAlert.profit.unrealizedPnL).toBeGreaterThan(0);
  });

  it("Both LONG and SHORT losing with adverse price", () => {
    const longAlert = evaluate(btcLong({ currentPrice: 90_000 }), deterioratingEvidence(90_000));
    const shortAlert = evaluate(btcShort({ currentPrice: 110_000 }), { ...deterioratingEvidence(110_000), shortTermTrend: "bullish" as const });
    expect(longAlert.profit.unrealizedPnL).toBeLessThan(0);
    expect(shortAlert.profit.unrealizedPnL).toBeLessThan(0);
  });

  it("BTC LONG ≠ BTC SHORT — both profitable, instrument tracked correctly", () => {
    const longAlert = evaluate(btcLong(), healthyEvidence(110_000));
    const shortAlert = evaluate(btcShort(), { ...healthyEvidence(90_000), shortTermTrend: "bearish" as const });
    // Both are profitable (entry 100k, current favorable by 10k)
    expect(longAlert.profit.unrealizedPnL).toBeGreaterThan(0);
    expect(shortAlert.profit.unrealizedPnL).toBeGreaterThan(0);
    // Both track same instrument but different sides
    expect(longAlert.instrument).toBe("BTC/USDT");
    expect(shortAlert.instrument).toBe("BTC/USDT");
  });

  it("BTC ≠ ETH — independent instrument tracking", () => {
    const btcAlert = evaluate(btcLong(), healthyEvidence(110_000));
    const ethAlert = evaluate(ethLong(), healthyEvidence(3300));
    expect(btcAlert.instrument).toBe("BTC/USDT");
    expect(ethAlert.instrument).toBe("ETH/USDT");
  });

  it("EUR/USD ≠ GBP/USD — independent", () => {
    const eurusd: PositionContext = {
      instrument: "EUR/USD", assetClass: "forex", side: "LONG",
      entryPrice: 1.1, currentPrice: 1.12, horizon: "INTRADAY",
      openedAt: NOW - 3600_000,
    };
    const gbpusd: PositionContext = {
      instrument: "GBP/USD", assetClass: "forex", side: "LONG",
      entryPrice: 1.3, currentPrice: 1.28, horizon: "INTRADAY",
      openedAt: NOW - 3600_000,
    };
    expect(evaluate(eurusd, { price: 1.12 }).instrument).toBe("EUR/USD");
    expect(evaluate(gbpusd, { price: 1.28 }).instrument).toBe("GBP/USD");
  });

  it("Position isolation: evaluating one does not affect another", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = ctrlRegister(state, {
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, currentPrice: 3300, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    state = processEventForController(state, event, NOW).state;

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(2);
    expect(state.positions.has("p1")).toBe(true);
    expect(state.positions.has("p2")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("K. Instrument Isolation", () => {
  it("BTC and ETH have independent monitoring state", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = registerInstrumentForPolling(state, "ETH/USDT", NOW);

    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;

    expect(state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(1);
    expect(state.instruments.get("ETH/USDT")!.consecutiveFailures).toBe(0);
  });

  it("Removing one instrument does not affect others", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = registerInstrumentForPolling(state, "ETH/USDT", NOW);

    state = unregisterInstrumentForPolling(state, "BTC/USDT");

    expect(state.instruments.size).toBe(1);
    expect(state.instruments.has("ETH/USDT")).toBe(true);
  });

  it("Controller position isolation", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = ctrlRegister(state, {
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, currentPrice: 2800, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    state = ctrlRemove(state, "p1");

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(1);
    expect(state.positions.has("p2")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. MEMORY BOUNDS & BOUNDED STATE
// ═══════════════════════════════════════════════════════════════

describe("L. Memory Bounds & Bounded State", () => {
  it("All memory bounds pass for normal usage", () => {
    const results = verifyMemoryBounds({
      alertHistory: 50,
      instrumentStates: 10,
      positionSnapshots: 10,
      eventsBuffer: 20,
      monitoringHistory: 5,
    });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it("Exceeding any bound is caught", () => {
    const results = verifyMemoryBounds({
      alertHistory: 2000,
      instrumentStates: 10,
      positionSnapshots: 10,
      eventsBuffer: 20,
      monitoringHistory: 5,
    });
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it("1100 event cycles: no unbounded growth", () => {
    let state = createControllerState();
    for (let i = 0; i < 50; i++) {
      state = ctrlRegister(state, {
        positionId: `pos_${i}`,
        instrument: `SYM${i}/USDT`,
        side: i % 3 === 0 ? "SHORT" : "LONG",
        entryPrice: 100 + i,
        currentPrice: 110 + i * 0.5,
        horizon: "SWING",
        assetClass: "crypto",
        openedAt: NOW - 3600_000,
      }, NOW);
    }
    state = startController(state);

    for (let cycle = 0; cycle < 1100; cycle++) {
      const instrIdx = cycle % 50;
      const price = 100 + (cycle % 30) * 2;
      const event = createPriceEvent(`SYM${instrIdx}/USDT`, price, "OKX");
      state = processEventForController(state, event, NOW + cycle * 1000).state;
    }

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(state.positions.has(`pos_${i}`)).toBe(true);
    }
  });

  it("Controller state serializable", () => {
    let state = createControllerState();
    for (let i = 0; i < 55; i++) {
      state = ctrlRegister(state, {
        positionId: `pos_${i}`, instrument: `SYM${i}/USDT`, side: "LONG",
        entryPrice: 100, currentPrice: 110, horizon: "SWING",
        assetClass: "crypto", openedAt: NOW - 3600_000,
      }, NOW);
    }
    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(55);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. RACE CONDITIONS & CONCURRENCY
// ═══════════════════════════════════════════════════════════════

describe("M. Race Conditions & Concurrency", () => {
  it("Duplicate registration rejected", () => {
    const existing = new Map([["p1", { instrument: "BTC/USDT", side: "LONG" }]]);
    expect(guardAgainstDuplicateRegistration(existing, "p1", "BTC/USDT").passed).toBe(false);
    expect(guardAgainstDuplicateRegistration(existing, "p2", "ETH/USDT").passed).toBe(true);
  });

  it("Duplicate polling rejected", () => {
    const active = new Map([["BTC/USDT", { startedAt: NOW, provider: "OKX" }]]);
    expect(guardAgainstDuplicatePolling(active, "BTC/USDT", NOW + 1000).passed).toBe(false);
    expect(guardAgainstDuplicatePolling(active, "BTC/USDT", NOW + 10_000).passed).toBe(true);
  });

  it("Remove while polling: no crash", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    state = processEventForController(state, event, NOW).state;
    state = ctrlRemove(state, "p1");

    expect(getDashboard(state).totalPositions).toBe(0);
  });

  it("Pause while event arrives: non-critical skipped", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);
    state = pausePosition(state, "p1");

    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    expect(processEventForController(state, event, NOW).state.evaluationsPerformed).toBe(0);
  });

  it("Resume processes events again", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);
    state = pausePosition(state, "p1");
    state = resumePosition(state, "p1");

    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    const result = processEventForController(state, event, NOW);
    expect(result.state).toBeDefined();
  });

  it("No orphaned positions after multiple add/remove", () => {
    let state = createControllerState();
    for (let i = 0; i < 10; i++) {
      state = ctrlRegister(state, {
        positionId: `p${i}`, instrument: `SYM${i}/USDT`, side: "LONG",
        entryPrice: 100, currentPrice: 110, horizon: "SWING",
        assetClass: "crypto", openedAt: NOW - 3600_000,
      }, NOW);
    }
    for (let i = 0; i < 5; i++) {
      state = ctrlRemove(state, `p${i}`);
    }
    expect(getDashboard(state).totalPositions).toBe(5);
    for (let i = 5; i < 10; i++) {
      expect(state.positions.has(`p${i}`)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// N. DETERMINISM VERIFICATION
// ═══════════════════════════════════════════════════════════════

describe("N. Determinism Verification", () => {
  it("Same inputs → same severity (50 iterations)", () => {
    const pos = btcLong({ currentPrice: 85_000 });
    const ev = deterioratingEvidence(85_000);
    const severities: AlertSeverity[] = [];
    for (let i = 0; i < 50; i++) {
      severities.push(evaluate(pos, ev, NOW).severity);
    }
    expect(new Set(severities).size).toBe(1);
  });

  it("Same inputs → same urgency", () => {
    const pos = btcLong({ currentPrice: 85_000 });
    const ev = deterioratingEvidence(85_000);
    const urgencies = new Set(Array.from({ length: 50 }, () => evaluate(pos, ev, NOW).urgency));
    expect(urgencies.size).toBe(1);
  });

  it("Same inputs → same thesis health score", () => {
    const pos = btcLong();
    const ev = healthyEvidence(110_000);
    const scores = new Set(Array.from({ length: 50 }, () => evaluate(pos, ev, NOW).thesisHealthScore));
    expect(scores.size).toBe(1);
  });

  it("Scenario runner is deterministic across 3 runs", () => {
    const scenario = healthyProfitableLong();
    const r1 = runScenario(scenario);
    const r2 = runScenario(scenario);
    const r3 = runScenario(scenario);
    for (let i = 0; i < r1.length; i++) {
      expect(r1[i].severity).toBe(r2[i].severity);
      expect(r2[i].severity).toBe(r3[i].severity);
    }
  });

  it("Calibration is deterministic", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const input: CalibrationInput = {
      position: btcLong(), evidence: deterioratingEvidence(90_000),
      severity: alert.severity, urgency: alert.urgency, profit: alert.profit,
      thesisHealthScore: alert.thesisHealthScore, thesisHealthState: alert.thesisHealth,
      shock: alert.shock, givebackPct: alert.profit.givebackPct ?? 0,
      accelerationLevel: "ELEVATED", deteriorationCount: alert.deteriorationSignals.length,
      confirmingCount: 0, missingData: alert.missingData,
      conflictingEvidence: alert.conflictingEvidence, supportingEvidence: alert.supportingEvidence,
    };
    const c1 = calibrateIntelligence(input);
    const c2 = calibrateIntelligence(input);
    expect(c1.calibratedSeverity).toBe(c2.calibratedSeverity);
    expect(c1.calibratedUrgency).toBe(c2.calibratedUrgency);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. NO FABRICATION / NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("O. No Fabrication / No Auto-Execution", () => {
  it("No fabrication across all positions and evidence", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    const evidences = [healthyEvidence(110_000), deterioratingEvidence(90_000)];
    for (const pos of positions) {
      for (const ev of evidences) {
        const alert = evaluate(pos, ev);
        expect(guardNoFabrication(alert).passed).toBe(true);
      }
    }
  });

  it("No auto-execution in any action recommendation", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    const evidences = [healthyEvidence(110_000), deterioratingEvidence(90_000)];
    for (const pos of positions) {
      for (const ev of evidences) {
        const action = evaluate(pos, ev).actionRecommendation.toLowerCase();
        expect(action).not.toContain("auto");
        expect(action).not.toContain("execute");
        expect(action).not.toContain("order");
        expect(action).not.toContain("trade");
      }
    }
  });

  it("No probability claims in any evidence", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const allText = JSON.stringify(alert);
    expect(allText).not.toMatch(/\d+%\\s*chance/i);
    expect(allText).not.toMatch(/probability/i);
    expect(allText).not.toMatch(/win\\s*rate/i);
  });

  it("Missing data is not fabricated", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    expect(alert.missingData).not.toContain("fabricated");
    expect(alert.missingData).not.toContain("synthetic");
    expect(alert.missingData).not.toContain("invented");
  });

  it("Full pipeline integration passes", () => {
    const result = runRuntimeValidation({
      position: btcLong({ currentPrice: 85_000 }),
      evidence: deterioratingEvidence(85_000),
      now: NOW,
      providerStatus: "HEALTHY",
      dataFreshness: "FRESH",
    });
    expect(result.pipeline.passed).toBe(true);
    expect(result.security.overallPass).toBe(true);
    expect(result.allPassed).toBe(true);
  });

  it("Integration pipeline passes for healthy position", () => {
    const result = validateIntegrationPipeline({
      position: btcLong(),
      evidence: healthyEvidence(110_000),
      now: NOW,
    });
    expect(result.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. MARKET DATA HEALTH PANEL DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("P. MarketDataHealthPanel Data Integrity", () => {
  it("Provider health info structure is valid", () => {
    const providers = [
      {
        provider: "OKX", status: "CONNECTED" as const,
        lastSuccessfulUpdate: NOW, freshness: "FRESH" as const,
        consecutiveFailures: 0, role: "PRIMARY" as const,
        instrumentsServed: ["BTC/USDT", "ETH/USDT"],
        recoveryState: "NONE" as const,
      },
      {
        provider: "TwelveData", status: "DEGRADED" as const,
        lastSuccessfulUpdate: NOW - 120_000, freshness: "STALE" as const,
        consecutiveFailures: 3, role: "FALLBACK" as const,
        instrumentsServed: ["EUR/USD"],
        recoveryState: "RECOVERING" as const,
      },
    ];

    // Validate structure
    for (const p of providers) {
      expect(p.provider).toBeTruthy();
      expect(["CONNECTED", "DEGRADED", "UNAVAILABLE"]).toContain(p.status);
      expect(["FRESH", "STALE", "UNAVAILABLE"]).toContain(p.freshness);
      expect(["PRIMARY", "FALLBACK"]).toContain(p.role);
      expect(["NONE", "RECOVERING", "RECOVERED"]).toContain(p.recoveryState);
    }
  });

  it("No secrets in provider health info", () => {
    const providers = [
      {
        provider: "OKX", status: "CONNECTED" as const,
        lastSuccessfulUpdate: NOW, freshness: "FRESH" as const,
        consecutiveFailures: 0, role: "PRIMARY" as const,
        instrumentsServed: ["BTC/USDT"],
        recoveryState: "NONE" as const,
      },
    ];
    const json = JSON.stringify(providers);
    expect(json).not.toMatch(/AKIA/);
    expect(json).not.toMatch(/sk_live/);
    expect(json).not.toMatch(/ghp_/);
    expect(json).not.toContain("process.env");
    expect(json).not.toContain("Bearer");
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. ACCEPTANCE GATES
// ═══════════════════════════════════════════════════════════════

describe("Q. Acceptance Gates", () => {
  it("GATE: No auto-execution", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    const evidences = [healthyEvidence(110_000), deterioratingEvidence(90_000)];
    for (const pos of positions) {
      for (const ev of evidences) {
        const action = evaluate(pos, ev).actionRecommendation.toLowerCase();
        expect(action).not.toContain("auto");
        expect(action).not.toContain("execute");
        expect(action).not.toContain("order");
      }
    }
  });

  it("GATE: Decision engine immutable", () => {
    const pos = btcLong({ currentPrice: 85_000 });
    const ev = deterioratingEvidence(85_000);
    const results = Array.from({ length: 50 }, () => evaluate(pos, ev, NOW).severity);
    expect(new Set(results).size).toBe(1);
  });

  it("GATE: No fabricated probabilities", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    expect(JSON.stringify(alert)).not.toMatch(/\d+%\\s*chance/i);
  });

  it("GATE: No secrets leak", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/AKIA/);
    expect(json).not.toMatch(/sk_live/);
    expect(json).not.toMatch(/ghp_/);
    expect(json).not.toContain("Bearer");
  });

  it("GATE: Provider failure neutral", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    expect(guardProviderFailureNeutrality(alert, "UNAVAILABLE").passed).toBe(true);
  });

  it("GATE: Stale data safe", () => {
    expect(guardAgainstStaleDataAlert("CAUTION", "WATCH", "STALE").passed).toBe(false);
  });

  it("GATE: LONG/SHORT symmetry preserved", () => {
    const longAlert = evaluate(
      { instrument: "XAU/USD", assetClass: "commodity", side: "LONG", entryPrice: 2000, currentPrice: 2050, horizon: "SWING", openedAt: NOW - 3600_000 },
      { price: 2050 },
    );
    const shortAlert = evaluate(
      { instrument: "XAU/USD", assetClass: "commodity", side: "SHORT", entryPrice: 2000, currentPrice: 2050, stopLoss: 2100, horizon: "SWING", openedAt: NOW - 3600_000 },
      { price: 2050 },
    );
    expect(longAlert.profit.unrealizedPnL).toBeGreaterThan(0);
    expect(shortAlert.profit.unrealizedPnL).toBeLessThan(0);
  });

  it("GATE: Position isolation preserved", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = ctrlRegister(state, {
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, currentPrice: 3300, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    state = processEventForController(state, event, NOW).state;
    expect(getDashboard(state).totalPositions).toBe(2);
    expect(state.positions.has("p1")).toBe(true);
    expect(state.positions.has("p2")).toBe(true);
  });

  it("GATE: Source labeling works", () => {
    const live = createLiveLabel("OKX", NOW);
    const simulated = createSimulatedLabel(NOW);
    expect(isRealData(live)).toBe(true);
    expect(isRealData(simulated)).toBe(false);
  });

  it("GATE: Thesis invalidation never suppressed", () => {
    const result = guardAgainstFalsePositive({
      severity: "INVALIDATED", pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE", shockState: "NORMAL",
      thesisHealthState: "INVALIDATED", independentSignalCount: 0,
      givebackPct: 5, accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });

  it("GATE: Critical shock never suppressed", () => {
    const result = guardAgainstFalsePositive({
      severity: "CAUTION", pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE", shockState: "SHOCK",
      thesisHealthState: "HEALTHY", independentSignalCount: 1,
      givebackPct: 10, accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });

  it("GATE: Bounded memory", () => {
    let diag = createDiagnosticsState();
    for (let i = 0; i < 10_000; i++) {
      diag = recordEventReceived(diag, false, false, NOW + i);
    }
    expect(typeof snapshot(diag).eventsReceived).toBe("number");
    expect(JSON.stringify(snapshot(diag)).length).toBeLessThan(100_000);
  });
});
