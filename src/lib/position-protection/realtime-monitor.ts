/**
 * Phase 58 — Real-Time Monitor
 *
 * Orchestrates event ingestion, dedup, coalescing, and protection evaluation.
 * Only meaningful events trigger reevaluation.
 * Pure-function state transitions — no side effects in evaluation logic.
 */

import type {
  RealTimeEvent,
  PositionSnapshot,
  InstrumentState,
  ProtectionEvent,
  MonitoringStatus,
  Timeframe,
  EventType,
} from "./realtime-types";
import type { PositionContext, AlertSeverity } from "./types";
import type { MarketEvidence } from "./thesis-health";
import { evaluateProtection, type ProtectionEngineInput } from "./protection-engine";
import { calculateGiveback, classifyGivebackSeverity, type GivebackState } from "./giveback-monitor";
import {
  createDispatcherState,
  shouldDispatch,
  dispatch,
  severityToNotificationPriority,
  type DispatcherState,
} from "./alert-dispatcher";

// ═══════════════════════════════════════════════════════════════
// MONITOR STATE
// ═══════════════════════════════════════════════════════════════

export interface MonitorState {
  /** Per-instrument state. */
  instruments: Map<string, InstrumentState>;
  /** Per-position snapshots. */
  positions: Map<string, PositionSnapshot>;
  /** Per-position giveback state. */
  giveback: Map<string, GivebackState>;
  /** Per-position last alert severity. */
  lastSeverity: Map<string, AlertSeverity>;
  /** Event buffer for coalescing. */
  eventBuffer: RealTimeEvent[];
  /** Dispatcher state. */
  dispatcher: DispatcherState;
  /** Last reevaluation timestamp per position. */
  lastReevalAt: Map<string, number>;
}

export function createMonitorState(): MonitorState {
  return {
    instruments: new Map(),
    positions: new Map(),
    giveback: new Map(),
    lastSeverity: new Map(),
    eventBuffer: [],
    dispatcher: createDispatcherState(),
    lastReevalAt: new Map(),
  };
}

// ═══════════════════════════════════════════════════════════════
// EVENT SIGNIFICANCE
// ═══════════════════════════════════════════════════════════════

const SIGNIFICANT_EVENT_TYPES: Set<EventType> = new Set([
  "MARKET_STRUCTURE_CHANGE",
  "MOMENTUM_CHANGE",
  "VOLATILITY_CHANGE",
  "DERIVATIVES_CHANGE",
  "FUNDING_CHANGE",
  "OPEN_INTEREST_CHANGE",
  "LIQUIDATION_CHANGE",
  "MACRO_CHANGE",
  "NEWS_EVENT",
  "FUNDAMENTAL_CHANGE",
  "REGIME_CHANGE",
  "POSITION_UPDATE",
]);

function isSignificant(event: RealTimeEvent): boolean {
  if (event.priority === "CRITICAL" || event.priority === "HIGH") return true;
  if (SIGNIFICANT_EVENT_TYPES.has(event.eventType)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// EVENT COALESCING
// ═══════════════════════════════════════════════════════════════

export function coalesceEvents(events: RealTimeEvent[]): RealTimeEvent[] {
  if (events.length === 0) return [];

  // Group by instrument + positionId
  const groups = new Map<string, RealTimeEvent[]>();
  for (const e of events) {
    const key = `${e.instrument}:${e.positionId ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(e);
    groups.set(key, group);
  }

  const coalesced: RealTimeEvent[] = [];
  for (const group of groups.values()) {
    // Check if any critical events — they bypass coalescing
    const critical = group.filter(e => e.priority === "CRITICAL");
    if (critical.length > 0) {
      coalesced.push(...critical);
      continue;
    }

    // Keep the highest-priority non-critical event
    const sorted = group.sort((a, b) => {
      const pa = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(a.priority);
      const pb = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(b.priority);
      return pb - pa;
    });
    coalesced.push(sorted[0]);
  }

  return coalesced;
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE BUILDER (from instrument state + events)
// ═══════════════════════════════════════════════════════════════

function buildEvidenceFromState(
  instrumentState: InstrumentState | undefined,
  position: PositionSnapshot,
  relevantEvents: RealTimeEvent[],
): MarketEvidence {
  const state = instrumentState;
  const ev: MarketEvidence = { price: position.currentPrice };

  if (state) {
    ev.volatility = state.volatility;
    ev.avgVolatility = state.avgVolatility;
    ev.fundingRate = state.fundingRate;
    ev.oiChange = state.oiChange;
    ev.vix = state.vix;
    if (state.riskRegime) ev.riskRegime = state.riskRegime;

    // Simple trend from recent changes
    if (state.recentChanges.length >= 3) {
      const recent = state.recentChanges.slice(-3);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      if (avg > 0.5) ev.shortTermTrend = "bullish";
      else if (avg < -0.5) ev.shortTermTrend = "bearish";
      else ev.shortTermTrend = "neutral";
    }
  }

  // Extract event-specific evidence
  for (const evt of relevantEvents) {
    switch (evt.eventType) {
      case "MARKET_STRUCTURE_CHANGE":
        ev.structureBroken = evt.payload.broken === true;
        break;
      case "MOMENTUM_CHANGE":
        if (typeof evt.payload.change === "number") ev.momentumChange = evt.payload.change as number;
        break;
      case "VOLATILITY_CHANGE":
        if (typeof evt.payload.volatility === "number") ev.volatility = evt.payload.volatility as number;
        if (typeof evt.payload.avgVolatility === "number") ev.avgVolatility = evt.payload.avgVolatility as number;
        break;
      case "LIQUIDATION_CHANGE":
        ev.liquidationSpike = evt.payload.spike === true;
        break;
      case "REGIME_CHANGE":
        ev.riskRegimeChanged = true;
        if (typeof evt.payload.regime === "string") ev.riskRegime = evt.payload.regime as any;
        break;
      case "CROSS_ASSET_CHANGE":
        ev.correlatedDivergence = evt.payload.divergence === true;
        if (typeof evt.payload.asset === "string") ev.correlatedAsset = evt.payload.asset as string;
        break;
      case "NEWS_EVENT":
        ev.eventApproaching = true;
        if (typeof evt.payload.name === "string") ev.eventName = evt.payload.name as string;
        break;
    }
  }

  return ev;
}

// ═══════════════════════════════════════════════════════════════
// POSITION CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════

function snapshotToContext(snapshot: PositionSnapshot): PositionContext {
  return {
    instrument: snapshot.instrument,
    assetClass: "crypto", // derived from instrument
    side: snapshot.side,
    entryPrice: snapshot.entryPrice,
    currentPrice: snapshot.currentPrice,
    stopLoss: snapshot.stopLoss,
    takeProfit: snapshot.takeProfit,
    leverage: snapshot.leverage,
    openedAt: snapshot.openedAt,
    horizon: snapshot.horizon,
    peakPrice: snapshot.peakPrice,
  };
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS CHECK
// ═══════════════════════════════════════════════════════════════

function checkFreshness(state: InstrumentState | undefined, now: number): MonitoringStatus {
  if (!state) return "DATA_STALE";
  const age = now - state.lastUpdateAt;
  if (age > 300_000) return "DATA_STALE"; // 5 min
  if (age > 60_000) return "RECONNECTING"; // 1 min
  return "LIVE";
}

// ═══════════════════════════════════════════════════════════════
// EVENT PROCESSING
// ═══════════════════════════════════════════════════════════════

export interface ProcessResult {
  state: MonitorState;
  alerts: ProtectionEvent[];
}

export function processEvent(
  state: MonitorState,
  event: RealTimeEvent,
  now: number,
): ProcessResult {
  const updatedState = { ...state };
  const alerts: ProtectionEvent[] = [];

  // 1. Update instrument state
  const instKey = event.instrument;
  let inst = updatedState.instruments.get(instKey) ?? {
    instrument: instKey,
    lastPrice: 0,
    lastUpdateAt: 0,
    recentChanges: [],
    providerStatus: "HEALTHY" as const,
    eventsProcessed: 0,
  };

  // Update price if available
  if (typeof event.payload.price === "number") {
    if (inst.lastPrice > 0) {
      const change = ((event.payload.price as number) - inst.lastPrice) / inst.lastPrice * 100;
      inst.recentChanges = [...inst.recentChanges.slice(-19), change];
    }
    inst.lastPrice = event.payload.price as number;
  }
  if (typeof event.payload.volatility === "number") inst.volatility = event.payload.volatility as number;
  if (typeof event.payload.avgVolatility === "number") inst.avgVolatility = event.payload.avgVolatility as number;
  if (typeof event.payload.fundingRate === "number") inst.fundingRate = event.payload.fundingRate as number;
  if (typeof event.payload.oiChange === "number") inst.oiChange = event.payload.oiChange as number;
  if (typeof event.payload.vix === "number") inst.vix = event.payload.vix as number;
  if (typeof event.payload.riskRegime === "string") inst.riskRegime = event.payload.riskRegime as any;

  if (event.eventType === "PROVIDER_DEGRADED") inst.providerStatus = "DEGRADED";
  if (event.eventType === "PROVIDER_RECOVERED") inst.providerStatus = "HEALTHY";
  if (event.eventType === "DATA_STALE") inst.providerStatus = "UNAVAILABLE";

  inst.lastUpdateAt = event.timestamp;
  inst.eventsProcessed++;
  updatedState.instruments.set(instKey, inst);

  // 2. Update position snapshots affected by this instrument
  for (const [posId, snap] of updatedState.positions) {
    if (snap.instrument !== event.instrument) continue;

    let snapshot = snap;

    // Update current price
    if (typeof event.payload.price === "number") {
      snapshot = { ...snapshot, currentPrice: event.payload.price as number, lastUpdateAt: event.timestamp };
      updatedState.positions.set(posId, snapshot);
    }

    // 3. Check giveback
    const prevGiveback = updatedState.giveback.get(posId);
    const giveback = calculateGiveback(snapshot, prevGiveback?.peakPrice);
    updatedState.giveback.set(posId, giveback);

    // 4. Only reevaluate if significant or enough time has passed
    const lastReeval = updatedState.lastReevalAt.get(posId) ?? 0;
    const timeSinceReeval = now - lastReeval;
    const minInterval = snapshot.horizon === "SCALPING" ? 5_000
      : snapshot.horizon === "INTRADAY" ? 15_000
      : snapshot.horizon === "SWING" ? 30_000
      : 60_000;

    const significant = isSignificant(event);
    if (!significant && timeSinceReeval < minInterval) continue;

    // 5. Build evidence and evaluate
    const evidence = buildEvidenceFromState(inst, snapshot, [event]);
    const positionCtx = snapshotToContext(snapshot);

    const freshness = checkFreshness(inst, now);
    snapshot.monitoringStatus = freshness;

    if (freshness === "DATA_STALE" && event.priority !== "CRITICAL") {
      // Don't evaluate with stale data for non-critical events
      continue;
    }

    const engineInput: ProtectionEngineInput = {
      position: positionCtx,
      evidence,
      monitoringState: updatedState.lastSeverity.has(posId) ? undefined : undefined,
      now,
    };

    const result = evaluateProtection(engineInput);
    updatedState.lastReevalAt.set(posId, now);

    // 6. Combine severity with giveback intelligence
    let finalSeverity = result.alert.severity;
    const givebackSeverity = classifyGivebackSeverity(giveback, snapshot.horizon);

    // Escalate if giveback is severe
    if (givebackSeverity === "PROTECT_NOW" && finalSeverity !== "INVALIDATED") {
      finalSeverity = "HIGH_RISK";
    } else if (givebackSeverity === "MANUAL_TP" && finalSeverity === "NONE") {
      finalSeverity = "CAUTION";
    } else if (givebackSeverity === "PARTIAL_TP" && finalSeverity === "NONE") {
      finalSeverity = "WATCH";
    }

    // 7. Check if should dispatch
    const prevSeverity = updatedState.lastSeverity.get(posId);
    updatedState.lastSeverity.set(posId, finalSeverity);

    const dispatchDecision = shouldDispatch(updatedState.dispatcher, posId, finalSeverity, now);

    if (dispatchDecision.shouldDispatch) {
      const notifPriority = severityToNotificationPriority(finalSeverity);
      const protectionEvent: ProtectionEvent = {
        eventId: `${posId}:${finalSeverity}:${now}`,
        positionId: posId,
        instrument: snapshot.instrument,
        notificationPriority: notifPriority,
        severity: finalSeverity,
        action: result.alert.actionRecommendation,
        reason: result.alert.alertMessage,
        currentProfit: {
          rMultiple: result.alert.profit.rMultiple,
          givebackPct: giveback.givebackPct,
          distanceFromEntryPct: result.alert.profit.distanceFromEntryPct,
        },
        timestamp: now,
        stateTransition: finalSeverity !== prevSeverity,
        previousSeverity: prevSeverity,
        acknowledged: false,
      };

      updatedState.dispatcher = dispatch(updatedState.dispatcher, protectionEvent);
      alerts.push(protectionEvent);
    }
  }

  return { state: updatedState, alerts };
}

// ═══════════════════════════════════════════════════════════════
// BATCH PROCESSING (for coalesced events)
// ═══════════════════════════════════════════════════════════════

export function processEvents(
  state: MonitorState,
  events: RealTimeEvent[],
  now: number,
): ProcessResult {
  const coalesced = coalesceEvents(events);
  let currentState = state;
  const allAlerts: ProtectionEvent[] = [];

  for (const event of coalesced) {
    const result = processEvent(currentState, event, now);
    currentState = result.state;
    allAlerts.push(...result.alerts);
  }

  return { state: currentState, alerts: allAlerts };
}

// ═══════════════════════════════════════════════════════════════
// POSITION MANAGEMENT
// ═══════════════════════════════════════════════════════════════

export function addPosition(state: MonitorState, snapshot: PositionSnapshot): MonitorState {
  const positions = new Map(state.positions);
  positions.set(snapshot.positionId, snapshot);
  return { ...state, positions };
}

export function removePosition(state: MonitorState, positionId: string): MonitorState {
  const positions = new Map(state.positions);
  positions.delete(positionId);
  const giveback = new Map(state.giveback);
  giveback.delete(positionId);
  const lastSeverity = new Map(state.lastSeverity);
  lastSeverity.delete(positionId);
  const lastReevalAt = new Map(state.lastReevalAt);
  lastReevalAt.delete(positionId);
  return { ...state, positions, giveback, lastSeverity, lastReevalAt };
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP (prevent unbounded growth)
// ═══════════════════════════════════════════════════════════════

export function cleanup(state: MonitorState, maxHistory: number = 500): MonitorState {
  const newHistory = state.dispatcher.history.slice(-maxHistory);
  const newSeen = new Set<string>();
  // Keep only recent fingerprints (last 1000)
  const seenArr = Array.from(state.dispatcher.seenFingerprints);
  for (const fp of seenArr.slice(-1000)) {
    newSeen.add(fp);
  }
  return {
    ...state,
    dispatcher: {
      ...state.dispatcher,
      history: newHistory,
      seenFingerprints: newSeen,
    },
  };
}
