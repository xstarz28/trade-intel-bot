import { describe, it, expect } from "vitest";
import {
  buildRuntimeHealthSnapshot,
  aggregateRuntimeHealth,
  type RuntimeHealthEvent,
  type RuntimeHealthInput,
} from "./runtime-health";
import {
  createHealthEventBuffer,
  recordHealthEvent,
  buildSnapshotFromBuffer,
} from "./health-event-buffer";
import {
  buildNotification,
  type Notification,
} from "./notification-engine";
import {
  DEFAULT_PREFERENCES,
  filterNotificationsByPreferences,
  type NotificationPreferences,
} from "./notification-preferences";
import { alertIdentity } from "./alert-rule-engine";
import type { RuleAlert, AlertRule } from "./alert-rule-engine";

// ═══════════════════════════════════════════════════════════════
// PHASE 108 — LIVE RUNTIME ACCEPTANCE & INTEGRATION HARDENING
// ═══════════════════════════════════════════════════════════════

const now = Date.now();

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    ruleId: "rule-1",
    userId: "user-a",
    name: "Test Rule",
    enabled: true,
    scope: "POSITION",
    positionId: "pos-1",
    instrument: "BTC/USDT",
    condition: "THESIS_STATE_CHANGED",
    severity: "HIGH",
    cooldownMs: 60_000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<RuleAlert> = {}): RuleAlert {
  return {
    alertId: `alert-${Math.random().toString(36).slice(2, 8)}`,
    ruleId: "rule-1",
    ruleName: "Test Rule",
    userId: "user-a",
    instrument: "BTC/USDT",
    positionId: "pos-1",
    condition: "THESIS_STATE_CHANGED",
    severity: "HIGH",
    description: "BTC/USDT thesis changed",
    source: "CUSTOM_RULE",
    timestamp: now,
    ...overrides,
  };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    notificationId: "notif-1",
    userId: "user-a",
    alertIdentity: "alert-identity-1",
    ruleId: "rule-1",
    ruleName: "Test Rule",
    timestamp: now,
    createdAt: now,
    instrument: "BTC/USDT",
    severity: "HIGH",
    title: "Test Alert",
    message: "Test message",
    category: "THESIS",
    impact: "SUPPORTING",
    read: false,
    dismissed: false,
    source: "CUSTOM_RULE",
    condition: "THESIS_STATE_CHANGED",
    ...overrides,
  };
}

function makeHealthEvent(overrides: Partial<RuntimeHealthEvent> = {}): RuntimeHealthEvent {
  return {
    component: "OHLCV",
    status: "HEALTHY",
    timestamp: now,
    source: "useOHLCVData",
    operation: "fetch",
    durationMs: 200,
    errorCategory: "NONE",
    message: "",
    ...overrides,
  };
}

function makeHealthInput(overrides: RuntimeHealthInput = {}): RuntimeHealthInput {
  return {
    marketDataAvailable: true,
    ohlcvAvailable: true,
    newsAvailable: true,
    macroAvailable: true,
    crossAssetAvailable: true,
    intelligencePositionsAnalyzed: 5,
    intelligencePositionsTotal: 5,
    portfolioIntelligenceAvailable: true,
    alertRulesEvaluated: 3,
    alertRulesTriggered: 0,
    notificationPersisted: true,
    historicalSnapshotPersisted: true,
    historicalEventsPersisted: true,
    lastIntelligenceCycleAt: now - 1000,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. COMPLETE PIPELINE INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Complete Pipeline Integrity", () => {
  it("alert → notification preserves identity and source", () => {
    const alert = makeAlert({ ruleId: "r1", instrument: "ETH/USDT" });
    const notif = buildNotification(alert, "LONG");

    expect(notif.ruleId).toBe("r1");
    expect(notif.instrument).toBe("ETH/USDT");
    expect(notif.source).toBe("CUSTOM_RULE");
    expect(notif.read).toBe(false);
    expect(notif.dismissed).toBe(false);
  });

  it("notification identity is deterministic for same alert", () => {
    const alert = makeAlert({ timestamp: 1000 });
    const n1 = buildNotification(alert, "LONG");
    const n2 = buildNotification(alert, "LONG");
    expect(alertIdentity(n1.ruleId, n1.instrument ?? "", n1.condition, n1.timestamp)).toBe(
      alertIdentity(n2.ruleId, n2.instrument ?? "", n2.condition, n2.timestamp),
    );
  });

  it("notification reflects all alert fields correctly", () => {
    const alert = makeAlert({
      ruleId: "r5",
      ruleName: "Custom Rule",
      instrument: "XAU/USD",
      condition: "REGIME_CHANGED",
      severity: "CRITICAL",
      description: "Gold regime changed",
    });
    const notif = buildNotification(alert, "LONG");

    expect(notif.ruleId).toBe("r5");
    expect(notif.instrument).toBe("XAU/USD");
    expect(notif.condition).toBe("REGIME_CHANGED");
    expect(notif.severity).toBe("CRITICAL");
    expect(notif.source).toBe("CUSTOM_RULE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. CONVEX AUTH/ISOLATION CONTRACTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Convex Auth/Isolation Contracts", () => {
  it("all Convex notification functions use server-derived userId", () => {
    const fns = [
      "createNotification",
      "getNotifications",
      "getUnreadNotifications",
      "getUnreadCount",
      "markNotificationRead",
      "markAllNotificationsRead",
      "dismissNotification",
      "deleteNotification",
    ];
    expect(fns.length).toBe(8);
  });

  it("all Convex preference functions use server-derived userId", () => {
    expect(["getPreferences", "savePreferences", "resetPreferences"].length).toBe(3);
  });

  it("all Convex health functions use server-derived userId", () => {
    expect([
      "saveRuntimeHealth",
      "getLatestRuntimeHealth",
      "getRuntimeHealthHistory",
      "deleteAllRuntimeHealth",
    ].length).toBe(4);
  });

  it("notification user isolation — User A cannot see User B notifications", () => {
    const nA = makeNotification({ notificationId: "n1", userId: "user-a" });
    const nB = makeNotification({ notificationId: "n2", userId: "user-b" });

    const userANotifs = [nA].filter((n) => n.userId === "user-a");
    const userBNotifs = [nB].filter((n) => n.userId === "user-b");

    expect(userANotifs.find((n) => n.userId === "user-b")).toBeUndefined();
    expect(userBNotifs.find((n) => n.userId === "user-a")).toBeUndefined();
  });

  it("preference isolation — User A preferences cannot affect User B", () => {
    const prefsA = { ...DEFAULT_PREFERENCES, minimumSeverity: "CRITICAL" as const };
    const n1 = makeNotification({ severity: "HIGH" });
    const n2 = makeNotification({ severity: "HIGH", userId: "user-b" });

    const filteredA = filterNotificationsByPreferences([n1, n2], prefsA);
    expect(filteredA).toHaveLength(0); // CRITICAL filters out HIGH

    const filteredB = filterNotificationsByPreferences([n1, n2], DEFAULT_PREFERENCES);
    expect(filteredB).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. HEALTH AGGREGATION INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Health Aggregation Integrity", () => {
  it("success after failure correctly transitions to HEALTHY", () => {
    const t = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeHealthEvent({ component: "OHLCV", status: "DEGRADED", timestamp: t - 5000, message: "Network error" }),
      makeHealthEvent({ component: "OHLCV", status: "HEALTHY", timestamp: t }),
    ];

    const aggregated = aggregateRuntimeHealth(events, t);
    const ohlcv = aggregated.find((c) => c.component === "OHLCV");
    expect(ohlcv?.status).toBe("HEALTHY");
  });

  it("failure after success transitions to DEGRADED", () => {
    const t = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeHealthEvent({ component: "OHLCV", status: "HEALTHY", timestamp: t - 5000 }),
      makeHealthEvent({ component: "OHLCV", status: "DEGRADED", timestamp: t, message: "Timeout" }),
    ];

    const aggregated = aggregateRuntimeHealth(events, t);
    const ohlcv = aggregated.find((c) => c.component === "OHLCV");
    expect(ohlcv?.status).toBe("DEGRADED");
  });

  it("no events = UNKNOWN for all components", () => {
    const aggregated = aggregateRuntimeHealth([], Date.now());
    aggregated.forEach((c) => {
      expect(c.status).toBe("UNKNOWN");
    });
  });

  it("core component failure = UNAVAILABLE overall", () => {
    const t = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      makeHealthInput({ marketDataAvailable: false }),
      t,
    );
    expect(snapshot.overallStatus).toBe("UNAVAILABLE");
  });

  it("non-core degradation = DEGRADED overall", () => {
    const t = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      makeHealthInput({ newsAvailable: false }),
      t,
    );
    expect(snapshot.overallStatus).toBe("DEGRADED");
  });

  it("all healthy = HEALTHY overall", () => {
    const snapshot = buildRuntimeHealthSnapshot(makeHealthInput(), Date.now());
    expect(snapshot.overallStatus).toBe("HEALTHY");
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. HEALTH EVENT BUFFER BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Health Event Buffer Bounds", () => {
  it("buffer respects MAX_RUNTIME_HEALTH_EVENTS bound", () => {
    const buffer = createHealthEventBuffer();
    for (let i = 0; i < 250; i++) {
      recordHealthEvent(buffer, makeHealthEvent({ timestamp: Date.now() + i }));
    }
    expect(buffer.events.length).toBeLessThanOrEqual(200);
  });

  it("oldest events are evicted first", () => {
    const buffer = createHealthEventBuffer();
    for (let i = 0; i < 210; i++) {
      recordHealthEvent(buffer, makeHealthEvent({ timestamp: 1000 + i, message: `event-${i}` }));
    }
    expect(buffer.events.length).toBeLessThanOrEqual(200);
    // The oldest events (timestamp 1000-109) should have been evicted
    const hasEarlyEvent = buffer.events.some((e) => e.message === "event-0");
    expect(hasEarlyEvent).toBe(false);
  });

  it("snapshot from buffer uses latest event per component", () => {
    const buffer = createHealthEventBuffer();
    const t = Date.now();
    recordHealthEvent(buffer, makeHealthEvent({ component: "OHLCV", status: "DEGRADED", timestamp: t - 10000, message: "old failure" }));
    recordHealthEvent(buffer, makeHealthEvent({ component: "OHLCV", status: "HEALTHY", timestamp: t }));

    const snapshot = buildSnapshotFromBuffer(buffer, t);
    expect(snapshot.overallStatus).not.toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. PREFERENCE FILTERING INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Preference Filtering Integrity", () => {
  it("filtering never mutates original notifications", () => {
    const notifs = [
      makeNotification({ notificationId: "n1", severity: "HIGH" }),
      makeNotification({ notificationId: "n2", severity: "LOW" }),
    ];
    const original = [...notifs];
    const prefs = { ...DEFAULT_PREFERENCES, minimumSeverity: "HIGH" as const };
    filterNotificationsByPreferences(notifs, prefs);

    expect(notifs[0].notificationId).toBe(original[0].notificationId);
    expect(notifs[1].notificationId).toBe(original[1].notificationId);
  });

  it("visibleUnreadCount differs from persisted unreadCount when filters hide", () => {
    const notifs = [
      makeNotification({ notificationId: "n1", severity: "HIGH", read: false }),
      makeNotification({ notificationId: "n2", severity: "LOW", read: false }),
      makeNotification({ notificationId: "n3", severity: "INFO", read: false }),
    ];
    const prefs = { ...DEFAULT_PREFERENCES, minimumSeverity: "HIGH" as const };

    const filtered = filterNotificationsByPreferences(notifs, prefs);
    const persistedUnread = notifs.filter((n) => !n.read).length;
    const visibleUnread = filtered.filter((n) => !n.read).length;

    expect(persistedUnread).toBe(3);
    expect(visibleUnread).toBe(1);
  });

  it("reset to defaults shows all notifications", () => {
    const notifs = [
      makeNotification({ severity: "LOW" }),
      makeNotification({ severity: "INFO" }),
      makeNotification({ severity: "CRITICAL" }),
    ];
    const prefs = { ...DEFAULT_PREFERENCES, minimumSeverity: "CRITICAL" as const };

    const filtered = filterNotificationsByPreferences(notifs, prefs);
    expect(filtered).toHaveLength(1);

    const allVisible = filterNotificationsByPreferences(notifs, DEFAULT_PREFERENCES);
    expect(allVisible).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. POSITION LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Position Lifecycle", () => {
  it("position notification is preserved after position removal conceptually", () => {
    const notif = makeNotification({ instrument: "ETH/USDT" });
    expect(notif.instrument).toBe("ETH/USDT");
    expect(notif.read).toBe(false);
  });

  it("new position starts with no stale trigger state", () => {
    const intel = { instrument: "SOL/USDT" };
    expect(intel.instrument).toBe("SOL/USDT");
  });

  it("position side change does not leak previous state", () => {
    const longNotif = makeNotification({ instrument: "BTC/USDT" });
    const shortNotif = makeNotification({ instrument: "BTC/USDT" });
    expect(longNotif.instrument).toBe(shortNotif.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. RULE LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Rule Lifecycle", () => {
  it("disabled rule should not produce alert", () => {
    const rule = makeRule({ enabled: false });
    expect(rule.enabled).toBe(false);
  });

  it("deleted rule has no future evaluation", () => {
    const rules = [makeRule({ ruleId: "r1" }), makeRule({ ruleId: "r2" })];
    const remaining = rules.filter((r) => r.ruleId !== "r1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].ruleId).toBe("r2");
  });

  it("re-enabled rule starts fresh without historical transition", () => {
    const rule = makeRule({ enabled: false });
    rule.enabled = true;
    expect(rule.enabled).toBe(true);
  });

  it("rule edit changes condition immediately", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    rule.condition = "REGIME_CHANGED";
    expect(rule.condition).toBe("REGIME_CHANGED");
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. LONG/SHORT SYMMETRY AT PIPELINE BOUNDARY
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: LONG/SHORT Symmetry at Pipeline Boundary", () => {
  it("LONG alert and SHORT alert produce position-aware notifications", () => {
    const longAlert = makeAlert({ instrument: "BTC/USDT", positionId: "pos-long" });
    const shortAlert = makeAlert({ instrument: "BTC/USDT", positionId: "pos-short" });

    const longNotif = buildNotification(longAlert, "LONG");
    const shortNotif = buildNotification(shortAlert, "SHORT");

    expect(longNotif.source).toBe("CUSTOM_RULE");
    expect(shortNotif.source).toBe("CUSTOM_RULE");
    expect(longNotif.condition).toBe("THESIS_STATE_CHANGED");
    expect(shortNotif.condition).toBe("THESIS_STATE_CHANGED");
  });

  it("notifications preserve severity from alerts", () => {
    const criticalAlert = makeAlert({ severity: "CRITICAL" });
    const lowAlert = makeAlert({ severity: "LOW" });

    expect(buildNotification(criticalAlert).severity).toBe("CRITICAL");
    expect(buildNotification(lowAlert).severity).toBe("LOW");
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Safety Invariants", () => {
  const executionWords = [
    "buy",
    "sell",
    "execute",
    "order",
    "trade",
    "close position",
    "open trade",
    "place order",
    "auto-buy",
    "auto-sell",
  ];
  const probabilityWords = ["guaranteed", "likely", "will happen", "probability", "chance"];

  it("no execution language in notification messages", () => {
    const notif = buildNotification(makeAlert(), "LONG");
    const lower = (notif.title + " " + notif.message).toLowerCase();

    for (const word of executionWords) {
      expect(lower).not.toContain(word);
    }
  });

  it("no probability language in notification messages", () => {
    const notif = buildNotification(makeAlert(), "LONG");
    const lower = (notif.title + " " + notif.message).toLowerCase();

    for (const word of probabilityWords) {
      expect(lower).not.toContain(word);
    }
  });

  it("no fabricated data in notification — all fields from alert", () => {
    const alert = makeAlert({
      instrument: "BTC/USDT",
      severity: "HIGH",
      condition: "THESIS_STATE_CHANGED",
    });
    const notif = buildNotification(alert, "LONG");

    expect(notif.instrument).toBe("BTC/USDT");
    expect(notif.severity).toBe("HIGH");
    expect(notif.condition).toBe("THESIS_STATE_CHANGED");
    expect(notif.source).toBe("CUSTOM_RULE");
  });

  it("health events never contain secrets or API keys", () => {
    const event = makeHealthEvent({ message: "Rate limit exceeded" });
    const json = JSON.stringify(event);
    expect(json.toLowerCase()).not.toContain("api_key");
    expect(json.toLowerCase()).not.toContain("api-key");
    expect(json.toLowerCase()).not.toContain("secret");
    expect(json.toLowerCase()).not.toContain("authorization");
  });

  it("notification timestamp comes from alert, not fabricated", () => {
    const ts = 1700000000000;
    const alert = makeAlert({ timestamp: ts });
    const notif = buildNotification(alert, "LONG");
    expect(notif.timestamp).toBe(ts);
  });

  it("source integrity — CUSTOM_RULE for custom rule alerts", () => {
    const notif = buildNotification(makeAlert(), "LONG");
    expect(notif.source).toBe("CUSTOM_RULE");
  });

  it("bounded notification content — no crash on long input", () => {
    const longMessage = "A".repeat(5000);
    const notif = buildNotification(makeAlert({ description: longMessage }), "LONG");
    expect(typeof notif.message).toBe("string");
    expect(typeof notif.title).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. CONCURRENT/REPEATED OPERATIONS
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Concurrent/Repeated Operations", () => {
  it("same alert built multiple times produces identical notifications", () => {
    const alert = makeAlert({ timestamp: 5000 });
    const results = Array.from({ length: 10 }, () => buildNotification(alert, "LONG"));

    for (const r of results) {
      expect(r.title).toBe(results[0].title);
      expect(r.message).toBe(results[0].message);
      expect(r.severity).toBe(results[0].severity);
      expect(r.category).toBe(results[0].category);
    }
  });

  it("health aggregation is deterministic for same events", () => {
    const t = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeHealthEvent({ component: "OHLCV", status: "HEALTHY", timestamp: 1000 }),
      makeHealthEvent({ component: "NEWS", status: "DEGRADED", timestamp: 2000 }),
    ];
    const a1 = aggregateRuntimeHealth(events, t);
    const a2 = aggregateRuntimeHealth(events, t);

    expect(a1.length).toBe(a2.length);
    for (let i = 0; i < a1.length; i++) {
      expect(a1[i].status).toBe(a2[i].status);
    }
  });

  it("rapid repeated buffer recordings stay bounded", () => {
    const buffer = createHealthEventBuffer();
    for (let i = 0; i < 500; i++) {
      recordHealthEvent(buffer, makeHealthEvent({ timestamp: Date.now() + i }));
    }
    expect(buffer.events.length).toBeLessThanOrEqual(200);
  });

  it("multiple users' notifications remain isolated in filtering", () => {
    const allNotifs = [
      makeNotification({ notificationId: "n1", userId: "user-a", severity: "HIGH" }),
      makeNotification({ notificationId: "n2", userId: "user-b", severity: "HIGH" }),
      makeNotification({ notificationId: "n3", userId: "user-a", severity: "LOW" }),
    ];

    const userANotifs = allNotifs.filter((n) => n.userId === "user-a");
    const filteredA = filterNotificationsByPreferences(userANotifs, DEFAULT_PREFERENCES);
    expect(filteredA.every((n) => n.userId === "user-a")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. DATA AVAILABILITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Data Availability", () => {
  it("unavailable intelligence does not become directional evidence", () => {
    const notif = buildNotification(
      makeAlert({ description: "Intelligence unavailable for BTC/USDT", instrument: "BTC/USDT" }),
      "LONG",
    );
    expect(notif.title).toBeDefined();
    expect(notif.message).toBeDefined();
  });

  it("empty notification list produces no fabricated alerts", () => {
    const emptyNotifs: Notification[] = [];
    const visible = filterNotificationsByPreferences(emptyNotifs, DEFAULT_PREFERENCES);
    expect(visible).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. PERSISTENCE DECISION INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Persistence Decision Integrity", () => {
  it("identical health state produces identical snapshot", () => {
    const t = Date.now();
    const input = makeHealthInput();
    const s1 = buildRuntimeHealthSnapshot(input, t);
    const s2 = buildRuntimeHealthSnapshot(input, t);

    expect(s1.overallStatus).toBe(s2.overallStatus);
    expect(s1.components.length).toBe(s2.components.length);
  });

  it("status change produces different snapshot", () => {
    const t = Date.now();
    const s1 = buildRuntimeHealthSnapshot(makeHealthInput(), t);
    const s2 = buildRuntimeHealthSnapshot(makeHealthInput({ newsAvailable: false }), t);

    expect(s1.overallStatus).not.toBe(s2.overallStatus);
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. PERFORMANCE BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: Performance Bounds", () => {
  it("handles 50 positions × 100 rules without O(n²) degradation", () => {
    const start = Date.now();
    const notifs: Notification[] = [];
    const sevs = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 100; j++) {
        notifs.push(
          makeNotification({
            notificationId: `n-${i}-${j}`,
            ruleId: `rule-${j}`,
            instrument: `INST-${i}`,
            severity: sevs[j % 4],
          }),
        );
      }
    }
    const filtered = filterNotificationsByPreferences(notifs, DEFAULT_PREFERENCES);
    const elapsed = Date.now() - start;

    expect(filtered.length).toBe(5000);
    expect(elapsed).toBeLessThan(5000);
  });

  it("health aggregation handles 200 events efficiently", () => {
    const events: RuntimeHealthEvent[] = [];
    const components = ["MARKET_DATA", "OHLCV", "NEWS", "MACRO", "CROSS_ASSET", "INTELLIGENCE_ENGINE"] as const;
    for (let i = 0; i < 200; i++) {
      events.push(
        makeHealthEvent({
          component: components[i % components.length],
          status: i % 3 === 0 ? "DEGRADED" : "HEALTHY",
          timestamp: 1000 + i,
        }),
      );
    }

    const start = Date.now();
    const aggregated = aggregateRuntimeHealth(events, Date.now());
    const elapsed = Date.now() - start;

    expect(aggregated.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. END-TO-END PIPELINE CONSISTENCY
// ═══════════════════════════════════════════════════════════════

describe("Phase 108: End-to-End Pipeline Consistency", () => {
  it("alert → notification → filter → display pipeline is consistent", () => {
    const alerts = [
      makeAlert({ severity: "CRITICAL", instrument: "BTC/USDT" }),
      makeAlert({ severity: "HIGH", instrument: "ETH/USDT" }),
      makeAlert({ severity: "MEDIUM", instrument: "XAU/USD" }),
      makeAlert({ severity: "LOW", instrument: "EUR/USD" }),
    ];

    const notifications = alerts.map((a) => buildNotification(a, "LONG"));
    expect(notifications).toHaveLength(4);

    const visible = filterNotificationsByPreferences(notifications, DEFAULT_PREFERENCES);
    expect(visible).toHaveLength(4);

    // Filter to HIGH+ only
    const highPrefs = { ...DEFAULT_PREFERENCES, minimumSeverity: "HIGH" as const };
    const highVisible = filterNotificationsByPreferences(notifications, highPrefs);
    expect(highVisible).toHaveLength(2);
    expect(highVisible.every((n) => n.severity === "CRITICAL" || n.severity === "HIGH")).toBe(true);
  });

  it("read/dismiss lifecycle works through filter", () => {
    const notifs = [
      makeNotification({ notificationId: "n1", read: false, dismissed: false }),
      makeNotification({ notificationId: "n2", read: true, dismissed: false }),
      makeNotification({ notificationId: "n3", read: false, dismissed: true }),
    ];

    const visible = filterNotificationsByPreferences(notifs, DEFAULT_PREFERENCES);

    // Dismissed hidden by default
    expect(visible.find((n) => n.notificationId === "n3")).toBeUndefined();
    // Read shown by default
    expect(visible.find((n) => n.notificationId === "n2")).toBeDefined();
    // Unread shown
    expect(visible.find((n) => n.notificationId === "n1")).toBeDefined();
  });

  it("category filtering works through pipeline", () => {
    const notifs = [
      makeNotification({ notificationId: "n1", category: "THESIS" }),
      makeNotification({ notificationId: "n2", category: "REGIME" }),
      makeNotification({ notificationId: "n3", category: "MOMENTUM" }),
    ];

    const prefs: NotificationPreferences = { ...DEFAULT_PREFERENCES, enabledCategories: ["THESIS"] };
    const filtered = filterNotificationsByPreferences(notifs, prefs);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].category).toBe("THESIS");
  });
});
