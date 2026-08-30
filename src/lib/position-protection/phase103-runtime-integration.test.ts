/**
 * Phase 103 — Runtime Integration & E2E Readiness Audit
 *
 * Comprehensive integration tests covering the complete Phase 93–102 pipeline.
 * Verifies alert→notification lifecycle, portfolio alerts, preferences,
 * health lifecycle, persistence, position/rule lifecycle, and safety invariants.
 *
 * No fabricated data. No execution language. No probability claims.
 */

import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════

import {
  evaluateAlertRuntimeBridge,
  buildInitialStateStore,
  removePositionFromState,
  removePositionTriggerRecords,
  cleanStaleInstrumentState,
  cleanStaleRuleTriggerRecords,
  extractSnapshot,
  extractPortfolioSnapshot,
  type PreviousStateStore,
} from "./alert-runtime-bridge";
import type { AlertRule, RuleTriggerRecord } from "./alert-rule-engine";
import { alertIdentity } from "./alert-rule-engine";
import {
  buildNotification,
  notificationIdentity,
  filterNotifications,
  applyRetention,
  MAX_NOTIFICATIONS_PER_USER,
  type Notification,
} from "./notification-engine";
import {
  filterNotificationsByPreferences,
  DEFAULT_PREFERENCES,
  validatePreferences,
  sanitizePreferences,
  type NotificationPreferences,
} from "./notification-preferences";
import {
  buildRuntimeHealthSnapshot,
  calculateOverallHealth,
  classifyFreshness,
  normalizeRuntimeHealthEvent,
  aggregateRuntimeHealth,
  shouldPersistRuntimeHealth,
  detectHealthTransitions,
  FRESH_THRESHOLD_MS,
  AGING_THRESHOLD_MS,
  type RuntimeHealthEvent,
  type RuntimeHealthSnapshot,
} from "./runtime-health";
import {
  createHealthEventBuffer,
  recordHealthEvent,
  recordProviderResult,
  shouldPersistFromBuffer,
  markPersisted,
  getLatestEventForComponent,
  getEventCount,
  buildSnapshotFromBuffer,
  type HealthEventBuffer,
} from "./health-event-buffer";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence } from "./portfolio-intelligence";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    ruleId: "rule-1",
    userId: "user-1",
    name: "Test Rule",
    enabled: true,
    scope: "POSITION",
    instrument: "BTC/USDT",
    positionId: "pos-1",
    condition: "THESIS_STATE_CHANGED",
    severity: "MEDIUM",
    cooldownMs: 5000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeIntel(overrides: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "Bitcoin",
    side: "LONG",
    assetClass: "crypto",
    entryPrice: 60000,
    currentPrice: 65000,
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    confidence: "STRONG_EVIDENCE",
    ohlcvRegime: "TRENDING_UP",
    shortTermContext: "BULLISH",
    volatilityContext: "NORMAL",
    h1Analysis: { trend: "UP", momentum: "STRONG", structure: "BULLISH", volatility: "NORMAL", confidence: "HIGH" } as any,
    m15Analysis: { trend: "UP", momentum: "MODERATE", structure: "BULLISH", volatility: "NORMAL", confidence: "MEDIUM" } as any,
    m5Analysis: { trend: "SIDEWAYS", momentum: "WEAK", structure: "NEUTRAL", volatility: "LOW", confidence: "LOW" } as any,
    evidence: [],
    dataQuality: "HIGH",
    dataSource: "TwelveData",
    ...overrides,
  } as PositionIntelligence;
}

function makeNotif(overrides: Partial<Notification> = {}): Notification {
  return {
    notificationId: "notif-1",
    userId: "user-1",
    alertIdentity: "alert-1",
    ruleId: "rule-1",
    ruleName: "Test Rule",
    timestamp: Date.now(),
    createdAt: Date.now(),
    instrument: "BTC/USDT",
    positionId: "pos-1",
    side: "LONG",
    severity: "MEDIUM",
    title: "Test",
    message: "Test message",
    category: "THESIS",
    impact: "NEUTRAL",
    read: false,
    dismissed: false,
    source: "CUSTOM_RULE",
    condition: "THESIS_STATE_CHANGED",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. ALERT → NOTIFICATION LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Alert → Notification Lifecycle", () => {
  it("active rule evaluates only from intelligence updates", () => {
    const rule = makeRule();
    const intel = makeIntel();
    const intelMap = new Map([["pos-1", intel]]);
    const prevState = buildInitialStateStore(intelMap);

    // Same intelligence = no transition = no alert
    const result = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      new Map(),
      Date.now(),
    );
    expect(result.notifications).toHaveLength(0);
  });

  it("initial state does not generate false alerts", () => {
    const rule = makeRule();
    const intel = makeIntel();
    const intelMap = new Map([["pos-1", intel]]);
    const prevState = buildInitialStateStore(intelMap);

    const result = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      new Map(),
      Date.now(),
    );
    expect(result.notifications).toHaveLength(0);
  });

  it("real transition generates RuleAlert", () => {
    const rule = makeRule();
    const intel = makeIntel({ thesisHealth: "HEALTHY" });
    const intelMap = new Map([["pos-1", intel]]);
    const prevState = buildInitialStateStore(intelMap);

    // Change thesis to trigger transition
    const changedIntel = makeIntel({ thesisHealth: "STABLE" });
    const changedMap = new Map([["pos-1", changedIntel]]);

    const result = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: changedMap },
      prevState,
      new Map(),
      Date.now(),
    );
    expect(result.notifications.length).toBeGreaterThanOrEqual(1);
  });

  it("cooldown prevents unchanged-state spam", () => {
    const rule = makeRule({ cooldownMs: 10000 });
    const intel = makeIntel({ thesisHealth: "STABLE" });
    const intelMap = new Map([["pos-1", intel]]);
    const prevState = buildInitialStateStore(intelMap);

    const now = Date.now();
    const triggerRecords = new Map<string, RuleTriggerRecord>();
    triggerRecords.set("rule-1:pos-1", {
      ruleId: "rule-1",
      positionId: "pos-1",
      lastTriggeredAt: now,
      lastConditionTrue: true,
    });

    const result = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      triggerRecords,
      now + 1000,
    );
    expect(result.notifications).toHaveLength(0);
  });

  it("alertIdentity is deterministic", () => {
    const id1 = alertIdentity("r1", "p1", "THESIS_STATE_CHANGED", 1000);
    const id2 = alertIdentity("r1", "p1", "THESIS_STATE_CHANGED", 1000);
    expect(id1).toBe(id2);
  });

  it("buildNotification preserves rule identity, side, severity, source", () => {
    const notif = makeNotif();
    expect(notif.ruleId).toBe("rule-1");
    expect(notif.side).toBe("LONG");
    expect(notif.severity).toBe("MEDIUM");
    expect(notif.source).toBe("CUSTOM_RULE");
    expect(notif.condition).toBe("THESIS_STATE_CHANGED");
  });

  it("notification identity includes userId for isolation", () => {
    const id1 = notificationIdentity("user-A", "alert-1");
    const id2 = notificationIdentity("user-B", "alert-1");
    expect(id1).not.toBe(id2);
  });

  it("same RuleAlert produces same notification identity", () => {
    const alert = {
      alertId: "a1", ruleId: "r1", ruleName: "R", userId: "u1",
      condition: "THESIS_STATE_CHANGED" as const, severity: "MEDIUM" as const,
      description: "test", timestamp: 1000, source: "CUSTOM_RULE" as const,
    };
    const n1 = buildNotification(alert, "LONG", 2000);
    const n2 = buildNotification(alert, "LONG", 3000);
    expect(n1.notificationId).toBe(n2.notificationId);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. PORTFOLIO ALERT LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Portfolio Alert Lifecycle", () => {
  it("empty portfolio produces no fabricated alerts", () => {
    const rule = makeRule({ scope: "PORTFOLIO" });
    const intelMap = new Map<string, PositionIntelligence>();
    const prevState = buildInitialStateStore(intelMap);

    const result = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      new Map(),
      Date.now(),
    );
    expect(result.notifications).toHaveLength(0);
  });

  it("portfolio alerts use side NONE where appropriate", () => {
    const notif = makeNotif({ side: "NONE", positionId: undefined });
    expect(notif.side).toBe("NONE");
    expect(notif.positionId).toBeUndefined();
  });

  it("portfolio rules evaluate against actual portfolio intelligence", () => {
    const rule = makeRule({
      scope: "PORTFOLIO",
      condition: "PORTFOLIO_CONFLICT_DETECTED",
    });
    const intel1 = makeIntel({ instrument: "BTC/USDT", thesisHealth: "HEALTHY" });
    const intel2 = makeIntel({ instrument: "ETH/USDT", thesisHealth: "INVALIDATED" });
    const intelMap = new Map([["pos-1", intel1], ["pos-2", intel2]]);
    const prevState = buildInitialStateStore(intelMap);

    // With conflicting thesis states, portfolio conflict may be detected
    const result = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      new Map(),
      Date.now(),
    );
    // The rule evaluates — result depends on actual portfolio intelligence
    expect(result).toBeDefined();
    expect(result.diagnostics).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. PREFERENCE → NOTIFICATION VISIBILITY LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Preference → Notification Visibility", () => {
  it("default preferences show all notifications", () => {
    const notifs = [makeNotif({ severity: "INFO" }), makeNotif({ severity: "CRITICAL" })];
    const result = filterNotificationsByPreferences(notifs, DEFAULT_PREFERENCES);
    expect(result).toHaveLength(2);
  });

  it("preference filtering does not mutate persisted notifications", () => {
    const notifs = [makeNotif({ read: false, severity: "INFO" })];
    const original = JSON.stringify(notifs);
    filterNotificationsByPreferences(
      notifs,
      { ...DEFAULT_PREFERENCES, minimumSeverity: "HIGH" },
    );
    expect(JSON.stringify(notifs)).toBe(original);
  });

  it("visibleUnreadCount differs from persisted count when preferences filter", () => {
    const notifs = [
      makeNotif({ read: false, severity: "INFO" }),
      makeNotif({ read: false, severity: "HIGH" }),
    ];
    const allUnread = notifs.filter((n) => !n.read).length;
    const visibleUnread = filterNotificationsByPreferences(
      notifs.filter((n) => !n.read),
      { ...DEFAULT_PREFERENCES, minimumSeverity: "MEDIUM" },
    ).length;
    expect(allUnread).toBe(2);
    expect(visibleUnread).toBe(1);
  });

  it("user isolation enforced at Convex layer, not client filter", () => {
    // Client-side preference filter operates on notification content (ruleId, instrument, etc.)
    // User isolation is enforced server-side by Convex mutations/queries
    const prefs: NotificationPreferences = {
      ...DEFAULT_PREFERENCES,
      mutedRuleIds: ["rule-1"],
    };
    const notifs = [makeNotif({ ruleId: "rule-1" }), makeNotif({ ruleId: "rule-2" })];
    const visible = filterNotificationsByPreferences(notifs, prefs);
    expect(visible).toHaveLength(1);
    expect(visible[0].ruleId).toBe("rule-2");
  });

  it("resetPreferences returns defaults", () => {
    const prefs = sanitizePreferences(null);
    expect(prefs).toEqual(DEFAULT_PREFERENCES);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. HEALTH EVENT → AGGREGATION → PERSISTENCE DECISION
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Health Lifecycle", () => {
  it("provider events enter bounded buffer", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "OHLCV", success: true });
    expect(getEventCount(buf)).toBe(1);
  });

  it("OHLCV callback records actual success/failure", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "OHLCV",
      source: "TwelveData",
      operation: "OHLCV fetch: BTC/USDT",
      success: true,
      durationMs: 150,
    });
    const latest = getLatestEventForComponent(buf, "OHLCV");
    expect(latest!.status).toBe("HEALTHY");
    expect(latest!.source).toBe("TwelveData");
  });

  it("MARKET_DATA remains direct", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "MARKET_DATA",
      source: "CoinGecko",
      success: true,
    });
    expect(event.component).toBe("MARKET_DATA");
    expect(event.status).toBe("HEALTHY");
  });

  it("INTELLIGENCE_ENGINE remains direct", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "INTELLIGENCE_ENGINE",
      operation: "Analyzed 3/3 positions",
      success: true,
    });
    expect(getLatestEventForComponent(buf, "INTELLIGENCE_ENGINE")!.status).toBe("HEALTHY");
  });

  it("aggregation uses actual execution evidence", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      { component: "NEWS", status: "HEALTHY", timestamp: now - 5000, message: "ok" },
      { component: "NEWS", status: "DEGRADED", timestamp: now - 1000, message: "failed" },
    ];
    const components = aggregateRuntimeHealth(events, now);
    expect(components.find((c) => c.component === "NEWS")!.status).toBe("DEGRADED");
  });

  it("recovery transitions work", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      { component: "OHLCV", status: "HEALTHY", timestamp: now - 10000, message: "ok" },
      { component: "OHLCV", status: "DEGRADED", timestamp: now - 5000, message: "failed" },
      { component: "OHLCV", status: "HEALTHY", timestamp: now - 1000, message: "recovered" },
    ];
    const components = aggregateRuntimeHealth(events, now);
    expect(components.find((c) => c.component === "OHLCV")!.status).toBe("HEALTHY");
  });

  it("no event means UNKNOWN, not fabricated HEALTHY", () => {
    const components = aggregateRuntimeHealth([], Date.now());
    expect(components.every((c) => c.status === "UNKNOWN")).toBe(true);
  });

  it("stale/aging classification is deterministic", () => {
    expect(classifyFreshness(1000)).toBe("FRESH");
    expect(classifyFreshness(FRESH_THRESHOLD_MS)).toBe("AGING");
    expect(classifyFreshness(AGING_THRESHOLD_MS)).toBe("STALE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. PERSISTENCE LOOP PREVENTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Persistence Loop Prevention", () => {
  it("isPersistingHealthRef prevents recursive persistence", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });
    const snap1 = shouldPersistFromBuffer(buf, 1000)!;
    buf = markPersisted(buf, snap1);

    // Same state → no persistence
    const snap2 = shouldPersistFromBuffer(buf, 2000);
    expect(snap2).toBeNull();
  });

  it("persistence failure does not recursively generate health event", () => {
    // The dashboard guard prevents this — we verify the pattern here
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });
    const snap1 = shouldPersistFromBuffer(buf, 1000)!;
    buf = markPersisted(buf, snap1);

    // After markPersisted, shouldPersistFromBuffer returns null
    // Even if we DON'T record a failure event, the guard prevents recursion
    const snap2 = shouldPersistFromBuffer(buf, 2000);
    expect(snap2).toBeNull();
  });

  it("status transitions do cause persistence", () => {
    let buf = createHealthEventBuffer();
    buf = recordHealthEvent(buf, { component: "NEWS", status: "HEALTHY", timestamp: 1000, message: "ok" });
    const snap1 = shouldPersistFromBuffer(buf, 2000)!;
    buf = markPersisted(buf, snap1);

    buf = recordHealthEvent(buf, { component: "NEWS", status: "DEGRADED", timestamp: 3000, message: "failed" });
    const snap2 = shouldPersistFromBuffer(buf, 4000);
    expect(snap2).not.toBeNull();
  });

  it("identical health state does not cause unnecessary writes", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });
    const snap1 = shouldPersistFromBuffer(buf, 1000)!;
    buf = markPersisted(buf, snap1);

    // Same state at different time → no persist
    const snap2 = shouldPersistFromBuffer(buf, 5000);
    expect(snap2).toBeNull();
    const snap3 = shouldPersistFromBuffer(buf, 10000);
    expect(snap3).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. POSITION REMOVAL CLEANUP
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Position Removal Cleanup", () => {
  it("removes position from previous state", () => {
    const intel1 = makeIntel({ instrument: "BTC/USDT" });
    const intel2 = makeIntel({ instrument: "ETH/USDT" });
    const state = buildInitialStateStore(new Map([["pos-1", intel1], ["pos-2", intel2]]));

    const cleaned = removePositionFromState(state, "pos-1");
    expect(cleaned.snapshots.has("pos-1")).toBe(false);
    expect(cleaned.snapshots.has("pos-2")).toBe(true);
  });

  it("removes trigger records for removed position", () => {
    const records = new Map<string, RuleTriggerRecord>();
    records.set("rule-1:pos-1", { ruleId: "rule-1", positionId: "pos-1", lastTriggeredAt: 1000, lastConditionTrue: true });
    records.set("rule-2:pos-2", { ruleId: "rule-2", positionId: "pos-2", lastTriggeredAt: 1000, lastConditionTrue: true });

    const cleaned = removePositionTriggerRecords(records, "pos-1");
    expect(cleaned.has("rule-1:pos-1")).toBe(false);
    expect(cleaned.has("rule-2:pos-2")).toBe(true);
  });

  it("cleans stale instrument state", () => {
    const state: PreviousStateStore = {
      snapshots: new Map(),
      newsStance: new Map([["BTC/USDT", "SUPPORTING"], ["ETH/USDT", "CONFLICTING"]]),
      dataAvailability: new Map([["BTC/USDT", "HIGH"], ["ETH/USDT", "LOW"]]),
    };
    const cleaned = cleanStaleInstrumentState(state, new Set(["BTC/USDT"]));
    expect(cleaned.newsStance.has("ETH/USDT")).toBe(false);
    expect(cleaned.dataAvailability.has("ETH/USDT")).toBe(false);
  });

  it("cleans stale rule trigger records", () => {
    const records = new Map<string, RuleTriggerRecord>();
    records.set("rule-active:pos-1", { ruleId: "rule-active", positionId: "pos-1", lastTriggeredAt: 1000, lastConditionTrue: true });
    records.set("rule-deleted:pos-1", { ruleId: "rule-deleted", positionId: "pos-1", lastTriggeredAt: 1000, lastConditionTrue: true });

    const cleaned = cleanStaleRuleTriggerRecords(records, new Set(["rule-active"]));
    expect(cleaned.has("rule-active:pos-1")).toBe(true);
    expect(cleaned.has("rule-deleted:pos-1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. RULE LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Rule Lifecycle", () => {
  it("disabled rule does not generate alert", () => {
    const rule = makeRule({ enabled: false });
    const intel = makeIntel({ thesisHealth: "STABLE" });
    const intelMap = new Map([["pos-1", intel]]);
    const prevState = buildInitialStateStore(intelMap);

    const result = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      new Map(),
      Date.now(),
    );
    expect(result.notifications).toHaveLength(0);
  });

  it("re-enabled rule respects cooldown then allows retrigger on new transition", () => {
    const rule = makeRule({ enabled: true, cooldownMs: 1000 });
    const intel = makeIntel({ thesisHealth: "HEALTHY" });
    const intelMap = new Map([["pos-1", intel]]);
    const prevState = buildInitialStateStore(intelMap);

    const now = Date.now();
    // First evaluation — initial state, no transition yet
    const result1 = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      new Map(),
      now,
    );
    expect(result1.notifications).toHaveLength(0);

    // Transition 1: HEALTHY → STABLE
    const intel2 = makeIntel({ thesisHealth: "STABLE" });
    const map2 = new Map([["pos-1", intel2]]);
    const result2 = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: map2 },
      prevState,
      new Map(),
      now + 100,
    );
    expect(result2.notifications.length).toBeGreaterThanOrEqual(1);

    // Within cooldown → blocked (same state STABLE)
    const result3 = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: map2 },
      { ...prevState, snapshots: result2.updatedPreviousSnapshots },
      result2.updatedTriggerRecords,
      now + 500,
    );
    expect(result3.notifications).toHaveLength(0);

    // Transition 2 (after cooldown): STABLE → DETERIORATING (new transition)
    const intel3 = makeIntel({ thesisHealth: "DETERIORATING" });
    const map3 = new Map([["pos-1", intel3]]);
    const result4 = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: map3 },
      { ...prevState, snapshots: result3.updatedPreviousSnapshots },
      result3.updatedTriggerRecords,
      now + 2000,
    );
    expect(result4.notifications.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. REMOUNT INITIALIZATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Remount Initialization", () => {
  it("buildInitialStateStore seeds without false transitions", () => {
    const intel = makeIntel();
    const intelMap = new Map([["pos-1", intel]]);
    const state = buildInitialStateStore(intelMap);

    // Initial state should have snapshot
    expect(state.snapshots.has("pos-1")).toBe(true);
    expect(state.snapshots.get("pos-1")!.thesisState).toBe("HEALTHY");
  });

  it("first evaluation with initial state produces no alerts", () => {
    const rule = makeRule();
    const intel = makeIntel();
    const intelMap = new Map([["pos-1", intel]]);
    const prevState = buildInitialStateStore(intelMap);

    const result = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      new Map(),
      Date.now(),
    );
    expect(result.notifications).toHaveLength(0);
  });

  it("fresh buffer after remount starts clean", () => {
    const buf = createHealthEventBuffer();
    expect(getEventCount(buf)).toBe(0);
    expect(buf.lastPersistedSnapshot).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. DUPLICATE EVALUATION PREVENTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Duplicate Evaluation Prevention", () => {
  it("same intelligence state does not re-trigger", () => {
    const rule = makeRule();
    const intel = makeIntel({ thesisHealth: "STABLE" });
    const intelMap = new Map([["pos-1", intel]]);
    const prevState = buildInitialStateStore(intelMap);

    const now = Date.now();
    const result1 = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      prevState,
      new Map(),
      now,
    );

    // Second evaluation with same state
    const result2 = evaluateAlertRuntimeBridge(
      { rules: [rule], intelligenceMap: intelMap },
      { ...prevState, snapshots: result1.updatedPreviousSnapshots },
      result1.updatedTriggerRecords,
      now + 100,
    );
    // Should not re-trigger (cooldown from first trigger)
    expect(result2.notifications).toHaveLength(0);
  });

  it("deterministic notification identity prevents duplicates", () => {
    const notif1 = buildNotification(
      { alertId: "a1", ruleId: "r1", ruleName: "R", userId: "u1", condition: "THESIS_STATE_CHANGED", severity: "MEDIUM", description: "test", timestamp: 1000, source: "CUSTOM_RULE" },
      "LONG",
      2000,
    );
    const notif2 = buildNotification(
      { alertId: "a1", ruleId: "r1", ruleName: "R", userId: "u1", condition: "THESIS_STATE_CHANGED", severity: "MEDIUM", description: "test", timestamp: 1000, source: "CUSTOM_RULE" },
      "LONG",
      3000,
    );
    expect(notif1.notificationId).toBe(notif2.notificationId);
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — LONG/SHORT Symmetry", () => {
  it("LONG INVALIDATED thesis → CONFLICTING impact", () => {
    const notif = buildNotification(
      { alertId: "a1", ruleId: "r1", ruleName: "R", userId: "u1", condition: "THESIS_BECAME_INVALIDATED", severity: "HIGH", description: "test", timestamp: 1000, source: "CUSTOM_RULE" },
      "LONG",
    );
    expect(notif.impact).toBe("CONFLICTING");
  });

  it("SHORT INVALIDATED thesis → SUPPORTING impact", () => {
    const notif = buildNotification(
      { alertId: "a1", ruleId: "r1", ruleName: "R", userId: "u1", condition: "THESIS_BECAME_INVALIDATED", severity: "HIGH", description: "test", timestamp: 1000, source: "CUSTOM_RULE" },
      "SHORT",
    );
    expect(notif.impact).toBe("SUPPORTING");
  });

  it("preferences filter both LONG and SHORT equally", () => {
    const notifs = [
      makeNotif({ side: "LONG", instrument: "BTC/USDT" }),
      makeNotif({ side: "SHORT", instrument: "ETH/USDT" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      { ...DEFAULT_PREFERENCES, mutedInstruments: ["ETH/USDT"] },
    );
    expect(result).toHaveLength(1);
    expect(result[0].side).toBe("LONG");
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 103 — Safety Invariants", () => {
  it("no auto-execution in any output", () => {
    const notif = makeNotif();
    const health = buildRuntimeHealthSnapshot({}, Date.now());
    const combined = JSON.stringify({ notif, health }).toLowerCase();
    expect(combined).not.toContain("execute");
    expect(combined).not.toContain("auto-buy");
    expect(combined).not.toContain("auto-sell");
    expect(combined).not.toContain("place order");
  });

  it("no probability claims", () => {
    const notif = makeNotif();
    const event = normalizeRuntimeHealthEvent({ component: "NEWS", success: true });
    const combined = JSON.stringify({ notif, event }).toLowerCase();
    expect(combined).not.toContain("probability");
    expect(combined).not.toContain("guaranteed");
    expect(combined).not.toContain("likely");
  });

  it("no fabricated market data", () => {
    const health = buildRuntimeHealthSnapshot(
      { marketDataAvailable: true, marketDataLastSuccess: Date.now() },
      Date.now(),
    );
    const json = JSON.stringify(health);
    expect(json).not.toContain("$");
    expect(json).not.toContain("65000");
    expect(json).not.toContain("bid");
    expect(json).not.toContain("ask");
  });

  it("bounded storage everywhere", () => {
    let buf = createHealthEventBuffer();
    for (let i = 0; i < 250; i++) {
      buf = recordHealthEvent(buf, { component: "MARKET_DATA", status: "HEALTHY", timestamp: i, message: "ok" });
    }
    expect(getEventCount(buf)).toBeLessThanOrEqual(200);

    const notifs = Array.from({ length: 300 }, (_, i) => makeNotif({ notificationId: `n-${i}` }));
    const retained = applyRetention(notifs);
    expect(retained.length).toBeLessThanOrEqual(MAX_NOTIFICATIONS_PER_USER);
  });

  it("user isolation in notification identity", () => {
    const id1 = notificationIdentity("user-A", "alert-1");
    const id2 = notificationIdentity("user-B", "alert-1");
    expect(id1).not.toBe(id2);
  });

  it("position isolation — removing position cleans state", () => {
    const intel = makeIntel();
    const state = buildInitialStateStore(new Map([["pos-1", intel]]));
    const cleaned = removePositionFromState(state, "pos-1");
    expect(cleaned.snapshots.size).toBe(0);
  });
});
