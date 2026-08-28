/**
 * Phase 66 — Scenario Simulation Engine
 *
 * Deterministic test harness for realistic profitable-position scenarios.
 * Simulates sequences of market events, not just isolated snapshots.
 *
 * Pure functions — no side effects.
 */

import type { PositionContext, AlertSeverity } from "./types";
import type { MarketEvidence } from "./thesis-health";
import type { RealTimeEvent } from "./realtime-types";
import { evaluateProtection } from "./protection-engine";
import {
  createMonitoringState,
  updateMonitoringState,
  shouldAlert,
} from "./alert-lifecycle";
import type { MonitoringState } from "./types";
import { detectShock } from "./shock-detector";
import {
  calculateGiveback,
  classifyGivebackSeverity,
  type GivebackState,
} from "./giveback-monitor";
import { classifyEarlyProtection } from "./early-protection";
import {
  createAccelerationState,
  recordPriceObservation,
  detectPriceAcceleration,
  type AccelerationState,
} from "./acceleration-monitor";
import {
  computeEventPriority,
  type EventPriorityLevel,
} from "./event-priority";
import { createPriceEvent, createMacroChangeEvent, createProviderDegradedEvent } from "./market-event-bridge";

// ═══════════════════════════════════════════════════════════════
// SIMULATION TYPES
// ═══════════════════════════════════════════════════════════════

export interface SimStep {
  timestamp: number;
  price: number;
  evidence: Partial<MarketEvidence>;
  label: string;
}

export interface SimResult {
  step: number;
  label: string;
  price: number;
  severity: AlertSeverity;
  urgency: string;
  profitState: string;
  thesisHealthScore: number;
  deteriorationSignals: number;
  givebackPct: number;
  shouldAlert: boolean;
  alertReason: string;
}

export interface ScenarioDefinition {
  name: string;
  position: PositionContext;
  steps: SimStep[];
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION RUNNER
// ═══════════════════════════════════════════════════════════════

export function runScenario(scenario: ScenarioDefinition): SimResult[] {
  const results: SimResult[] = [];
  let monitoringState: MonitoringState = createMonitoringState(scenario.position.instrument);
  let prevSeverity: AlertSeverity = "NONE";

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const position: PositionContext = {
      ...scenario.position,
      currentPrice: step.price,
    };
    const evidence: MarketEvidence = {
      price: step.price,
      ...step.evidence,
    };

    const protection = evaluateProtection({
      position,
      evidence,
      monitoringState,
      now: step.timestamp,
    });

    const alertDecision = shouldAlert(
      monitoringState,
      protection.alert.severity,
      step.timestamp,
    );

    results.push({
      step: i,
      label: step.label,
      price: step.price,
      severity: protection.alert.severity,
      urgency: protection.alert.urgency,
      profitState: protection.alert.profit.profitState,
      thesisHealthScore: protection.alert.thesisHealthScore,
      deteriorationSignals: protection.alert.deteriorationSignals.length,
      givebackPct: protection.alert.profit.givebackPct ?? 0,
      shouldAlert: alertDecision.shouldFire,
      alertReason: alertDecision.reason,
    });

    if (alertDecision.shouldFire && protection.alert.severity !== prevSeverity) {
      monitoringState = updateMonitoringState(
        monitoringState,
        protection.alert.severity,
        step.timestamp,
      );
      prevSeverity = protection.alert.severity;
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// PRE-BUILT SCENARIOS
// ═══════════════════════════════════════════════════════════════

export function healthyProfitableLong(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Healthy profitable LONG",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Entry" },
      { timestamp: base + 60_000, price: 103, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Rising" },
      { timestamp: base + 120_000, price: 106, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Stronger" },
      { timestamp: base + 180_000, price: 108, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Healthy profit" },
    ],
  };
}

export function healthyProfitableShort(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Healthy profitable SHORT",
    position: {
      instrument: "ETH/USDT", assetClass: "crypto", side: "SHORT",
      entryPrice: 4000, currentPrice: 4000, stopLoss: 4200, takeProfit: 3500,
      openedAt: base - 3600_000, horizon: "INTRADAY",
    },
    steps: [
      { timestamp: base, price: 4000, evidence: { shortTermTrend: "bearish" }, label: "Entry" },
      { timestamp: base + 60_000, price: 3950, evidence: { shortTermTrend: "bearish" }, label: "Falling" },
      { timestamp: base + 120_000, price: 3900, evidence: { shortTermTrend: "bearish", mediumTermTrend: "bearish" }, label: "Stronger" },
      { timestamp: base + 180_000, price: 3870, evidence: { shortTermTrend: "bearish", mediumTermTrend: "bearish" }, label: "Healthy profit" },
    ],
  };
}

export function gradualMomentumDeterioration(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Gradual momentum deterioration",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish", momentumChange: 10 }, label: "Entry" },
      { timestamp: base + 60_000, price: 110, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish", momentumChange: 5 }, label: "Peak" },
      { timestamp: base + 120_000, price: 108, evidence: { shortTermTrend: "neutral", momentumChange: -5 }, label: "Momentum weakening" },
      { timestamp: base + 180_000, price: 106, evidence: { shortTermTrend: "bearish", momentumChange: -15 }, label: "Momentum negative" },
      { timestamp: base + 240_000, price: 104, evidence: { shortTermTrend: "bearish", mediumTermTrend: "bearish", momentumChange: -20 }, label: "Deterioration" },
    ],
  };
}

export function suddenStructureBreak(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Sudden structure break",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish", structureBroken: false }, label: "Healthy" },
      { timestamp: base + 60_000, price: 110, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish", structureBroken: false }, label: "Profit" },
      { timestamp: base + 120_000, price: 100, evidence: { shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true, momentumChange: -30 }, label: "Structure break" },
    ],
  };
}

export function suddenVolatilityExpansion(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Sudden volatility expansion",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish", volatility: 2, avgVolatility: 2 }, label: "Normal volatility" },
      { timestamp: base + 60_000, price: 110, evidence: { shortTermTrend: "bullish", volatility: 2, avgVolatility: 2 }, label: "Profit" },
      { timestamp: base + 120_000, price: 107, evidence: { shortTermTrend: "bearish", volatility: 10, avgVolatility: 2 }, label: "Volatility spike" },
    ],
  };
}

export function vixShock(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "VIX shock",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish", riskRegime: "risk_on", riskRegimeChanged: false }, label: "Risk-on" },
      { timestamp: base + 60_000, price: 110, evidence: { shortTermTrend: "bullish" }, label: "Profit" },
      { timestamp: base + 120_000, price: 106, evidence: { shortTermTrend: "bearish", volatility: 8, avgVolatility: 2, riskRegime: "risk_off", riskRegimeChanged: true }, label: "VIX shock" },
    ],
  };
}

export function liquidationShock(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Crypto liquidation shock",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish" }, label: "Entry" },
      { timestamp: base + 60_000, price: 110, evidence: { shortTermTrend: "bullish" }, label: "Profit" },
      { timestamp: base + 120_000, price: 104, evidence: { shortTermTrend: "bearish", liquidationSpike: true }, label: "Liquidation spike" },
    ],
  };
}

export function normalPullbackNoPrematureTP(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Normal pullback — must NOT trigger premature TP",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Entry" },
      { timestamp: base + 60_000, price: 110, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Peak" },
      { timestamp: base + 120_000, price: 108, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Small pullback" },
      { timestamp: base + 180_000, price: 107, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Continue pullback" },
      { timestamp: base + 240_000, price: 109, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Recovery" },
    ],
  };
}

export function fastReversalShouldTriggerEarlyProtection(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Fast reversal — SHOULD trigger early protection",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish", longTermTrend: "bullish" }, label: "Entry" },
      { timestamp: base + 60_000, price: 115, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish", longTermTrend: "bullish" }, label: "Peak profit" },
      { timestamp: base + 120_000, price: 108, evidence: { shortTermTrend: "bearish", momentumChange: -25, structureBroken: true }, label: "Structure break" },
      { timestamp: base + 180_000, price: 103, evidence: { shortTermTrend: "bearish", mediumTermTrend: "bearish", momentumChange: -30, structureBroken: true, volatility: 8, avgVolatility: 2 }, label: "Full deterioration" },
    ],
  };
}

export function profitGivebackRecoveryCycle(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Profit increases, gives back, then recovers",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish" }, label: "Entry" },
      { timestamp: base + 60_000, price: 115, evidence: { shortTermTrend: "bullish", mediumTermTrend: "bullish" }, label: "Peak" },
      { timestamp: base + 120_000, price: 108, evidence: { shortTermTrend: "bearish", momentumChange: -15 }, label: "Giveback" },
      { timestamp: base + 180_000, price: 105, evidence: { shortTermTrend: "bearish", momentumChange: -20 }, label: "Deep giveback" },
      { timestamp: base + 240_000, price: 110, evidence: { shortTermTrend: "bullish", momentumChange: 10 }, label: "Recovery" },
    ],
  };
}

export function providerUnavailableThenRecovery(): ScenarioDefinition {
  const base = Date.now();
  return {
    name: "Provider unavailable then recovery",
    position: {
      instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, openedAt: base - 3600_000, horizon: "SWING",
    },
    steps: [
      { timestamp: base, price: 100, evidence: { shortTermTrend: "bullish" }, label: "Entry" },
      { timestamp: base + 60_000, price: 110, evidence: { shortTermTrend: "bullish" }, label: "Profit" },
      { timestamp: base + 120_000, price: 110, evidence: { shortTermTrend: "bullish" }, label: "Provider down" },
      { timestamp: base + 180_000, price: 112, evidence: { shortTermTrend: "bullish" }, label: "Recovery" },
    ],
  };
}
