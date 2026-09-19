/**
 * Phase 64 — Continuous Protection Controller
 *
 * Orchestrates all Phase 57-63 components into a unified monitoring lifecycle.
 * Supports START/PAUSE/RESUME/STOP per position and globally.
 *
 * Reuses existing engines — no duplication.
 * Pure-function state transitions — no side effects in evaluation logic.
 */

import type {
  PositionContext,
  ProtectionAlert,
  AlertSeverity,
  MonitoringState,
  ProfitProtectionUrgency,
} from "./types";
import type { MarketEvidence } from "./thesis-health";
import type {
  RealTimeEvent,
} from "./realtime-types";
import { evaluateProtection } from "./protection-engine";
import { createMonitoringState } from "./alert-lifecycle";
import { classifyEarlyProtection, type EarlyProtectionInput } from "./early-protection";
import { aggregateTimeframeEvidence } from "./multi-timeframe-engine";
import { detectShock } from "./shock-detector";
import { calculateGiveback } from "./giveback-monitor";
import {
  createAccelerationState,
  type AccelerationState,
} from "./acceleration-monitor";
import { computeEventPriority, type EventPriorityLevel } from "./event-priority";
import { fuseSignals, type FusedSignal } from "./signal-fusion";
import { computePositionPriority, type PositionPriorityRank } from "./position-priority";
import {
  getCadenceForHorizon,
  shouldEvaluateNow,
} from "./monitoring-cadence";

// ═══════════════════════════════════════════════════════════════
// CONTROLLER STATE
// ═══════════════════════════════════════════════════════════════

export type ControllerLifecycle = "STOPPED" | "STARTING" | "RUNNING" | "PAUSING" | "PAUSED";

export interface PositionControllerState {
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage?: number;
  horizon: "SCALPING" | "INTRADAY" | "SWING" | "INVESTING";
  assetClass: "crypto" | "forex" | "equity" | "commodity" | "indices" | "macro";
  openedAt: number;
  peakPrice?: number;
  lifecycle: ControllerLifecycle;
  monitoringState: MonitoringState;
  accelerationState: AccelerationState;
  lastEvaluationAt: number;
  lastAlertSeverity: AlertSeverity;
  alertCount: number;
  fusedSignals: FusedSignal[];
  earlyProtectionResult: string | null;
}

export interface ContinuousControllerState {
  /** Per-position controller states. */
  positions: Map<string, PositionControllerState>;
  /** Global lifecycle. */
  globalLifecycle: ControllerLifecycle;
  /** Total evaluations performed. */
  evaluationsPerformed: number;
  /** Total alerts generated. */
  alertsGenerated: number;
  /** Total critical events processed. */
  criticalEventsProcessed: number;
}

const RISK_REGIMES = ["risk_on", "risk_off", "transition", "unknown"] as const;
type RiskRegimeValue = (typeof RISK_REGIMES)[number];
function asRiskRegime(v: unknown): RiskRegimeValue | undefined {
  return (RISK_REGIMES as readonly unknown[]).includes(v) ? (v as RiskRegimeValue) : undefined;
}

export function createControllerState(): ContinuousControllerState {
  return {
    positions: new Map(),
    globalLifecycle: "STOPPED",
    evaluationsPerformed: 0,
    alertsGenerated: 0,
    criticalEventsProcessed: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION REGISTRATION
// ═══════════════════════════════════════════════════════════════

export function registerPosition(
  state: ContinuousControllerState,
  position: {
    positionId: string;
    instrument: string;
    side: "LONG" | "SHORT";
    entryPrice: number;
    currentPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    leverage?: number;
    horizon: "SCALPING" | "INTRADAY" | "SWING" | "INVESTING";
    assetClass: "crypto" | "forex" | "equity" | "commodity" | "indices" | "macro";
    openedAt: number;
  },
  _now: number,
): ContinuousControllerState {
  const updated = new Map(state.positions);
  updated.set(position.positionId, {
    positionId: position.positionId,
    instrument: position.instrument,
    side: position.side,
    entryPrice: position.entryPrice,
    currentPrice: position.currentPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    leverage: position.leverage,
    horizon: position.horizon,
    assetClass: position.assetClass,
    openedAt: position.openedAt,
    lifecycle: "RUNNING",
    monitoringState: createMonitoringState(position.instrument),
    accelerationState: createAccelerationState(),
    lastEvaluationAt: 0,
    lastAlertSeverity: "NONE",
    alertCount: 0,
    fusedSignals: [],
    earlyProtectionResult: null,
  });
  return { ...state, positions: updated };
}

export function removePosition(
  state: ContinuousControllerState,
  positionId: string,
): ContinuousControllerState {
  const updated = new Map(state.positions);
  updated.delete(positionId);
  return { ...state, positions: updated };
}

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE CONTROLS
// ═══════════════════════════════════════════════════════════════

export function startController(state: ContinuousControllerState): ContinuousControllerState {
  const positions = new Map(state.positions);
  for (const [id, pos] of positions) {
    positions.set(id, { ...pos, lifecycle: "RUNNING" });
  }
  return { ...state, positions, globalLifecycle: "RUNNING" };
}

export function stopController(state: ContinuousControllerState): ContinuousControllerState {
  const positions = new Map(state.positions);
  for (const [id, pos] of positions) {
    positions.set(id, { ...pos, lifecycle: "STOPPED" });
  }
  return { ...state, positions, globalLifecycle: "STOPPED" };
}

export function pauseController(state: ContinuousControllerState): ContinuousControllerState {
  const positions = new Map(state.positions);
  for (const [id, pos] of positions) {
    positions.set(id, { ...pos, lifecycle: "PAUSED" });
  }
  return { ...state, positions, globalLifecycle: "PAUSED" };
}

export function resumeController(state: ContinuousControllerState): ContinuousControllerState {
  const positions = new Map(state.positions);
  for (const [id, pos] of positions) {
    positions.set(id, { ...pos, lifecycle: "RUNNING" });
  }
  return { ...state, positions, globalLifecycle: "RUNNING" };
}

export function pausePosition(
  state: ContinuousControllerState,
  positionId: string,
): ContinuousControllerState {
  const pos = state.positions.get(positionId);
  if (!pos) return state;
  const positions = new Map(state.positions);
  positions.set(positionId, { ...pos, lifecycle: "PAUSED" });
  return { ...state, positions };
}

export function resumePosition(
  state: ContinuousControllerState,
  positionId: string,
): ContinuousControllerState {
  const pos = state.positions.get(positionId);
  if (!pos) return state;
  const positions = new Map(state.positions);
  positions.set(positionId, { ...pos, lifecycle: "RUNNING" });
  return { ...state, positions };
}

// ═══════════════════════════════════════════════════════════════
// EVALUATION DECISION
// ═══════════════════════════════════════════════════════════════

export function shouldEvaluatePosition(
  pos: PositionControllerState,
  eventPriority: EventPriorityLevel,
  now: number,
): { shouldEvaluate: boolean; reason: string } {
  // Never evaluate stopped or paused positions
  if (pos.lifecycle === "STOPPED") {
    return { shouldEvaluate: false, reason: "Position is stopped." };
  }
  if (pos.lifecycle === "PAUSED") {
    if (eventPriority === "CRITICAL") {
      return { shouldEvaluate: true, reason: "Critical event bypasses pause." };
    }
    return { shouldEvaluate: false, reason: "Position is paused." };
  }

  // Critical events always trigger evaluation
  if (eventPriority === "CRITICAL") {
    return { shouldEvaluate: true, reason: "Critical event triggers immediate evaluation." };
  }

  // High priority events trigger evaluation
  if (eventPriority === "HIGH") {
    return { shouldEvaluate: true, reason: "High-priority event triggers evaluation." };
  }

  // Check cadence
  const cadence = getCadenceForHorizon(pos.horizon);
  return shouldEvaluateNow(pos.lastEvaluationAt, now, cadence, eventPriority);
}

// ═══════════════════════════════════════════════════════════════
// POSITION EVALUATION
// ═══════════════════════════════════════════════════════════════

export interface EvaluationResult {
  alert: ProtectionAlert;
  earlyProtectionLevel: string;
  fusedSignals: FusedSignal[];
  positionPriority: PositionPriorityRank;
}

export function evaluatePosition(
  pos: PositionControllerState,
  evidence: MarketEvidence,
  now: number,
): EvaluationResult {
  // Build position context
  const positionCtx: PositionContext = {
    instrument: pos.instrument,
    assetClass: pos.assetClass,
    side: pos.side,
    entryPrice: pos.entryPrice,
    currentPrice: pos.currentPrice,
    stopLoss: pos.stopLoss,
    takeProfit: pos.takeProfit,
    leverage: pos.leverage,
    openedAt: pos.openedAt,
    horizon: pos.horizon,
    peakPrice: pos.peakPrice,
  };

  // Run protection engine
  const protectionResult = evaluateProtection({
    position: positionCtx,
    evidence,
    monitoringState: pos.monitoringState,
    now,
  });

  // Signal fusion
  const fused = fuseSignals(protectionResult.alert);

  // Early protection classification
  const givebackState = calculateGiveback({
    positionId: pos.positionId,
    instrument: pos.instrument,
    side: pos.side,
    entryPrice: pos.entryPrice,
    currentPrice: pos.currentPrice,
    stopLoss: pos.stopLoss,
    horizon: pos.horizon,
    openedAt: pos.openedAt,
    lastUpdateAt: now,
    monitoringStatus: "LIVE",
  });

  const isProfitable = protectionResult.alert.profit.profitState === "PROFITABLE" ||
    protectionResult.alert.profit.profitState === "STRONGLY_PROFITABLE";

  const shock = detectShock(evidence);
  const mtResult = aggregateTimeframeEvidence([]);

  const earlyInput: EarlyProtectionInput = {
    side: pos.side,
    profitState: protectionResult.alert.profit.profitState,
    isProfitable,
    giveback: givebackState,
    multiTimeframe: mtResult,
    deteriorationCount: protectionResult.alert.deteriorationSignals.length,
    thesisHealthScore: protectionResult.alert.thesisHealthScore,
    shockState: shock.state,
    priceRoc: 0,
    givebackRoc: givebackState.givebackRate ?? 0,
    eventApproaching: evidence.eventApproaching ?? false,
    crossAssetDivergence: evidence.correlatedDivergence ?? false,
  };

  const earlyResult = classifyEarlyProtection(earlyInput);

  // Position priority
  const priority = computePositionPriority({
    severity: protectionResult.alert.severity,
    urgency: protectionResult.alert.urgency,
    givebackPct: givebackState.givebackPct,
    accelerationLevel: "NORMAL",
    profitState: protectionResult.alert.profit.profitState,
  });

  return {
    alert: protectionResult.alert,
    earlyProtectionLevel: earlyResult.level,
    fusedSignals: fused,
    positionPriority: priority,
  };
}

// ═══════════════════════════════════════════════════════════════
// EVENT PROCESSING
// ═══════════════════════════════════════════════════════════════

export interface ProcessEventResult {
  state: ContinuousControllerState;
  alerts: Array<{
    positionId: string;
    instrument: string;
    severity: AlertSeverity;
    urgency: ProfitProtectionUrgency;
    earlyProtectionLevel: string;
  }>;
}

export function processEventForController(
  state: ContinuousControllerState,
  event: RealTimeEvent,
  now: number,
): ProcessEventResult {
  const eventPriority = computeEventPriority(event);
  const alerts: ProcessEventResult["alerts"] = [];
  let updatedState = { ...state };

  let hasProcessedPosition = false;

  for (const [posId, pos] of updatedState.positions) {
    // Only process events for matching instruments
    if (pos.instrument !== event.instrument) continue;

    const evalDecision = shouldEvaluatePosition(pos, eventPriority, now);
    if (!evalDecision.shouldEvaluate) continue;

    // Build evidence from event
    const evidence = buildEvidenceFromEvent(event, pos);

    // Evaluate
    const result = evaluatePosition(pos, evidence, now);

    // Update position state
    const updatedPositions = new Map(updatedState.positions);
    updatedPositions.set(posId, {
      ...pos,
      currentPrice: typeof event.payload.price === "number" ? event.payload.price : pos.currentPrice,
      lastEvaluationAt: now,
      lastAlertSeverity: result.alert.severity,
      alertCount: result.alert.severity !== "NONE" ? pos.alertCount + 1 : pos.alertCount,
      fusedSignals: result.fusedSignals,
      earlyProtectionResult: result.earlyProtectionLevel,
      monitoringState: result.alert.severity !== pos.lastAlertSeverity
        ? result.alert.stateTransition
          ? pos.monitoringState // Already updated by evaluateProtection
          : pos.monitoringState
        : pos.monitoringState,
    });

    hasProcessedPosition = true;
    updatedState = {
      ...updatedState,
      positions: updatedPositions,
      evaluationsPerformed: updatedState.evaluationsPerformed + 1,
    };

    // Only emit alert if severity changed
    if (result.alert.severity !== pos.lastAlertSeverity || eventPriority === "CRITICAL") {
      alerts.push({
        positionId: posId,
        instrument: pos.instrument,
        severity: result.alert.severity,
        urgency: result.alert.urgency,
        earlyProtectionLevel: result.earlyProtectionLevel,
      });
      updatedState = { ...updatedState, alertsGenerated: updatedState.alertsGenerated + 1 };
    }
  }

  if (eventPriority === "CRITICAL" && hasProcessedPosition) {
    updatedState = { ...updatedState, criticalEventsProcessed: updatedState.criticalEventsProcessed + 1 };
  }

  return { state: updatedState, alerts };
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE BUILDER
// ═══════════════════════════════════════════════════════════════

function buildEvidenceFromEvent(event: RealTimeEvent, pos: PositionControllerState): MarketEvidence {
  const ev: MarketEvidence = {
    price: typeof event.payload.price === "number" ? event.payload.price : pos.currentPrice,
  };

  switch (event.eventType) {
    case "MARKET_STRUCTURE_CHANGE":
      ev.structureBroken = event.payload.broken === true;
      break;
    case "MOMENTUM_CHANGE":
      if (typeof event.payload.change === "number") ev.momentumChange = event.payload.change;
      break;
    case "VOLATILITY_CHANGE":
      if (typeof event.payload.volatility === "number") ev.volatility = event.payload.volatility;
      if (typeof event.payload.avgVolatility === "number") ev.avgVolatility = event.payload.avgVolatility;
      break;
    case "FUNDING_CHANGE":
      if (typeof event.payload.fundingRate === "number") ev.fundingRate = event.payload.fundingRate;
      break;
    case "OPEN_INTEREST_CHANGE":
      if (typeof event.payload.oiChange === "number") ev.oiChange = event.payload.oiChange;
      break;
    case "LIQUIDATION_CHANGE":
      ev.liquidationSpike = event.payload.spike === true;
      break;
    case "MACRO_CHANGE":
      ev.riskRegimeChanged = true;
      {
        // Phase 227 — an unrecognised regime string is dropped, not cast.
        const regime = asRiskRegime(event.payload.regime);
        if (regime) ev.riskRegime = regime;
      }
      break;
    case "CROSS_ASSET_CHANGE":
      ev.correlatedDivergence = event.payload.divergence === true;
      break;
    case "NEWS_EVENT":
      ev.eventApproaching = true;
      break;
    case "PROVIDER_DEGRADED":
      // Provider failure = missing data, never directional
      break;
    case "PROVIDER_RECOVERED":
      // Recovery — data is fresh again
      break;
    case "DATA_STALE":
      // Stale data — no directional claims
      break;
  }

  return ev;
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATED DASHBOARD
// ═══════════════════════════════════════════════════════════════

export interface ControllerDashboard {
  totalPositions: number;
  activePositions: number;
  pausedPositions: number;
  criticalCount: number;
  highRiskCount: number;
  cautionCount: number;
  watchCount: number;
  healthyCount: number;
  positionsAtRisk: number;
  highestPriority: PositionPriorityRank | null;
  evaluationsPerformed: number;
  alertsGenerated: number;
  criticalEventsProcessed: number;
}

export function getDashboard(state: ContinuousControllerState): ControllerDashboard {
  let active = 0;
  let paused = 0;
  let critical = 0;
  let highRisk = 0;
  let caution = 0;
  let watch = 0;
  let healthy = 0;
  let highestPriority: PositionPriorityRank | null = null;

  for (const pos of state.positions.values()) {
    if (pos.lifecycle === "RUNNING") active++;
    if (pos.lifecycle === "PAUSED") paused++;

    switch (pos.lastAlertSeverity) {
      case "INVALIDATED": critical++; break;
      case "HIGH_RISK": highRisk++; break;
      case "CAUTION": caution++; break;
      case "WATCH": watch++; break;
      case "NONE": healthy++; break;
    }

    const priority = computePositionPriority({
      severity: pos.lastAlertSeverity,
      urgency: "NONE",
      givebackPct: 0,
      accelerationLevel: "NORMAL",
      profitState: "BREAK_EVEN_ZONE",
    });

    if (!highestPriority || priority.rank > highestPriority.rank) {
      highestPriority = priority;
    }
  }

  return {
    totalPositions: state.positions.size,
    activePositions: active,
    pausedPositions: paused,
    criticalCount: critical,
    highRiskCount: highRisk,
    cautionCount: caution,
    watchCount: watch,
    healthyCount: healthy,
    positionsAtRisk: critical + highRisk + caution,
    highestPriority,
    evaluationsPerformed: state.evaluationsPerformed,
    alertsGenerated: state.alertsGenerated,
    criticalEventsProcessed: state.criticalEventsProcessed,
  };
}
