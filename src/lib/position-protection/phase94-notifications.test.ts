/**
 * Phase 94 — Notifications Test Suite
 *
 * Comprehensive tests for the notification engine:
 * - Notification model
 * - buildNotification() determinism
 * - Alert → notification mapping
 * - Severity & category mapping
 * - LONG/SHORT symmetry
 * - Deduplication
 * - Read/unread lifecycle
 * - Filtering
 * - Retention
 * - User isolation
 * - No fabricated data
 * - No probability language
 * - No execution language
 * - Bounded output
 * - Empty state
 */

import { describe, it, expect } from "vitest";
import type { RuleAlert, RuleCondition, RuleSeverity } from "./alert-rule-engine";
import {
  buildNotification,
  notificationIdentity,
  filterNotifications,
  applyRetention,
  SEVERITY_ORDER,
  MAX_NOTIFICATIONS_PER_USER,
  type Notification,
  type NotificationFilter,
  type NotificationCategory,
} from "./notification-engine";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeAlert(overrides: Partial<RuleAlert> = {}): RuleAlert {
  return {
    alertId: "alert-1",
    ruleId: "rule-1",
    ruleName: "Test Rule",
    userId: "user-1",
    instrument: "BTC/USDT",
    positionId: "pos-1",
    condition: "THESIS_STATE_CHANGED",
    severity: "HIGH",
    description: "Thesis state changed from HEALTHY to DETERIORATING",
    previousState: "HEALTHY",
    currentState: "DETERIORATING",
    timestamp: 1000,
    source: "CUSTOM_RULE",
    ...overrides,
  };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return buildNotification(makeAlert(), "LONG", 2000);
}

// ═══════════════════════════════════════════════════════════════
// A. NOTIFICATION MODEL
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Notification Model", () => {
  it("notification has all required fields", () => {
    const notif = makeNotification();
    expect(notif.notificationId).toBeTruthy();
    expect(notif.userId).toBe("user-1");
    expect(notif.alertIdentity).toBeTruthy();
    expect(notif.ruleId).toBe("rule-1");
    expect(notif.ruleName).toBe("Test Rule");
    expect(notif.timestamp).toBe(1000);
    expect(notif.createdAt).toBe(2000);
    expect(notif.severity).toBe("HIGH");
    expect(notif.title).toBeTruthy();
    expect(notif.message).toBeTruthy();
    expect(notif.category).toBeTruthy();
    expect(notif.impact).toBeTruthy();
    expect(notif.read).toBe(false);
    expect(notif.dismissed).toBe(false);
    expect(notif.source).toBe("CUSTOM_RULE");
  });

  it("new notifications are unread by default", () => {
    const notif = makeNotification();
    expect(notif.read).toBe(false);
  });

  it("new notifications are not dismissed by default", () => {
    const notif = makeNotification();
    expect(notif.dismissed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. buildNotification() DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — buildNotification() Determinism", () => {
  it("same input produces identical output", () => {
    const alert = makeAlert();
    const n1 = buildNotification(alert, "LONG", 5000);
    const n2 = buildNotification(alert, "LONG", 5000);
    expect(n1.notificationId).toBe(n2.notificationId);
    expect(n1.title).toBe(n2.title);
    expect(n1.message).toBe(n2.message);
    expect(n1.category).toBe(n2.category);
    expect(n1.impact).toBe(n2.impact);
    expect(n1.severity).toBe(n2.severity);
  });

  it("different timestamp produces same notificationId", () => {
    const alert = makeAlert();
    const n1 = buildNotification(alert, "LONG", 5000);
    const n2 = buildNotification(alert, "LONG", 6000);
    // notificationId is based on alert identity, not 'now'
    expect(n1.notificationId).toBe(n2.notificationId);
    expect(n1.createdAt).toBe(5000);
    expect(n2.createdAt).toBe(6000);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. ALERT → NOTIFICATION MAPPING
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Alert → Notification Mapping", () => {
  it("maps ruleId and ruleName from alert", () => {
    const alert = makeAlert({ ruleId: "r-42", ruleName: "My Rule" });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.ruleId).toBe("r-42");
    expect(notif.ruleName).toBe("My Rule");
  });

  it("maps instrument and positionId from alert", () => {
    const alert = makeAlert({ instrument: "ETH/USDT", positionId: "p-7" });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.instrument).toBe("ETH/USDT");
    expect(notif.positionId).toBe("p-7");
  });

  it("maps timestamp from alert", () => {
    const alert = makeAlert({ timestamp: 9999 });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.timestamp).toBe(9999);
  });

  it("maps description to message", () => {
    const alert = makeAlert({ description: "Custom description" });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.message).toBe("Custom description");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. SEVERITY MAPPING
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Severity Mapping", () => {
  const severities: RuleSeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

  severities.forEach((sev) => {
    it(`maps severity ${sev} correctly`, () => {
      const alert = makeAlert({ severity: sev });
      const notif = buildNotification(alert, "LONG", 1000);
      expect(notif.severity).toBe(sev);
    });
  });

  it("severity ordering is correct", () => {
    expect(SEVERITY_ORDER.INFO).toBeLessThan(SEVERITY_ORDER.LOW);
    expect(SEVERITY_ORDER.LOW).toBeLessThan(SEVERITY_ORDER.MEDIUM);
    expect(SEVERITY_ORDER.MEDIUM).toBeLessThan(SEVERITY_ORDER.HIGH);
    expect(SEVERITY_ORDER.HIGH).toBeLessThan(SEVERITY_ORDER.CRITICAL);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. CATEGORY MAPPING
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Category Mapping", () => {
  const conditionCategoryMap: [RuleCondition, NotificationCategory][] = [
    ["THESIS_STATE_CHANGED", "THESIS"],
    ["THESIS_BECAME_DETERIORATING", "THESIS"],
    ["THESIS_BECAME_INVALIDATED", "THESIS"],
    ["REGIME_CHANGED", "REGIME"],
    ["H1_TREND_CHANGED", "TREND"],
    ["M15_TREND_CHANGED", "TREND"],
    ["M5_TREND_CHANGED", "TREND"],
    ["STRUCTURE_CHANGED", "STRUCTURE"],
    ["MOMENTUM_CHANGED", "MOMENTUM"],
    ["VOLATILITY_CHANGED", "VOLATILITY"],
    ["EVIDENCE_QUALITY_CHANGED", "EVIDENCE"],
    ["SUPPORTING_EVIDENCE_CHANGED", "EVIDENCE"],
    ["CONFLICTING_EVIDENCE_CHANGED", "EVIDENCE"],
    ["NEWS_BECAME_CONFLICTING", "NEWS"],
    ["NEWS_BECAME_SUPPORTING", "NEWS"],
    ["MACRO_REGIME_CHANGED", "MACRO"],
    ["CROSS_ASSET_CONFLICT", "CROSS_ASSET"],
    ["PORTFOLIO_CONCENTRATION_DETECTED", "PORTFOLIO"],
    ["PORTFOLIO_CONFLICT_DETECTED", "PORTFOLIO"],
    ["DATA_BECAME_UNAVAILABLE", "DATA_QUALITY"],
    ["DATA_RECOVERED", "DATA_QUALITY"],
  ];

  conditionCategoryMap.forEach(([condition, category]) => {
    it(`maps ${condition} → ${category}`, () => {
      const alert = makeAlert({ condition });
      const notif = buildNotification(alert, "LONG", 1000);
      expect(notif.category).toBe(category);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// F. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — LONG/SHORT Symmetry", () => {
  it("NEWS_BECAME_SUPPORTING is SUPPORTING for LONG, CONFLICTING for SHORT", () => {
    const alert = makeAlert({ condition: "NEWS_BECAME_SUPPORTING" });
    const longNotif = buildNotification(alert, "LONG", 1000);
    const shortNotif = buildNotification(alert, "SHORT", 1000);
    expect(longNotif.impact).toBe("SUPPORTING");
    expect(shortNotif.impact).toBe("CONFLICTING");
  });

  it("THESIS_BECAME_DETERIORATING is CONFLICTING for LONG, SUPPORTING for SHORT", () => {
    const alert = makeAlert({ condition: "THESIS_BECAME_DETERIORATING" });
    const longNotif = buildNotification(alert, "LONG", 1000);
    const shortNotif = buildNotification(alert, "SHORT", 1000);
    expect(longNotif.impact).toBe("CONFLICTING");
    expect(shortNotif.impact).toBe("SUPPORTING");
  });

  it("THESIS_BECAME_INVALIDATED is CONFLICTING for LONG, SUPPORTING for SHORT", () => {
    const alert = makeAlert({ condition: "THESIS_BECAME_INVALIDATED" });
    const longNotif = buildNotification(alert, "LONG", 1000);
    const shortNotif = buildNotification(alert, "SHORT", 1000);
    expect(longNotif.impact).toBe("CONFLICTING");
    expect(shortNotif.impact).toBe("SUPPORTING");
  });

  it("NEWS_BECAME_CONFLICTING is CONFLICTING for LONG, SUPPORTING for SHORT", () => {
    const alert = makeAlert({ condition: "NEWS_BECAME_CONFLICTING" });
    const longNotif = buildNotification(alert, "LONG", 1000);
    const shortNotif = buildNotification(alert, "SHORT", 1000);
    expect(longNotif.impact).toBe("CONFLICTING");
    expect(shortNotif.impact).toBe("SUPPORTING");
  });

  it("DATA_RECOVERED is SUPPORTING for LONG, CONFLICTING for SHORT", () => {
    const alert = makeAlert({ condition: "DATA_RECOVERED" });
    const longNotif = buildNotification(alert, "LONG", 1000);
    const shortNotif = buildNotification(alert, "SHORT", 1000);
    expect(longNotif.impact).toBe("SUPPORTING");
    expect(shortNotif.impact).toBe("CONFLICTING");
  });

  it("DATA_BECAME_UNAVAILABLE is CONFLICTING for LONG, SUPPORTING for SHORT", () => {
    const alert = makeAlert({ condition: "DATA_BECAME_UNAVAILABLE" });
    const longNotif = buildNotification(alert, "LONG", 1000);
    const shortNotif = buildNotification(alert, "SHORT", 1000);
    expect(longNotif.impact).toBe("CONFLICTING");
    expect(shortNotif.impact).toBe("SUPPORTING");
  });

  it("REGIME_CHANGED is NEUTRAL for both LONG and SHORT", () => {
    const alert = makeAlert({ condition: "REGIME_CHANGED" });
    const longNotif = buildNotification(alert, "LONG", 1000);
    const shortNotif = buildNotification(alert, "SHORT", 1000);
    expect(longNotif.impact).toBe("NEUTRAL");
    expect(shortNotif.impact).toBe("NEUTRAL");
  });

  it("side NONE produces NEUTRAL impact", () => {
    const alert = makeAlert({ condition: "NEWS_BECAME_SUPPORTING" });
    const notif = buildNotification(alert, "NONE", 1000);
    expect(notif.impact).toBe("NEUTRAL");
  });

  it("side preserved in notification", () => {
    const alert = makeAlert();
    const longNotif = buildNotification(alert, "LONG", 1000);
    const shortNotif = buildNotification(alert, "SHORT", 1000);
    expect(longNotif.side).toBe("LONG");
    expect(shortNotif.side).toBe("SHORT");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Deduplication", () => {
  it("notificationIdentity is deterministic", () => {
    const id1 = notificationIdentity("user-1", "alert-abc");
    const id2 = notificationIdentity("user-1", "alert-abc");
    expect(id1).toBe(id2);
  });

  it("different users produce different identities", () => {
    const id1 = notificationIdentity("user-1", "alert-abc");
    const id2 = notificationIdentity("user-2", "alert-abc");
    expect(id1).not.toBe(id2);
  });

  it("different alerts produce different identities", () => {
    const id1 = notificationIdentity("user-1", "alert-abc");
    const id2 = notificationIdentity("user-1", "alert-xyz");
    expect(id1).not.toBe(id2);
  });

  it("same RuleAlert always produces same notificationId", () => {
    const alert = makeAlert({ alertId: "stable-id-123" });
    const n1 = buildNotification(alert, "LONG", 1000);
    const n2 = buildNotification(alert, "LONG", 2000);
    expect(n1.notificationId).toBe(n2.notificationId);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. READ/UNREAD
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Read/Unread", () => {
  it("new notification is unread", () => {
    const notif = makeNotification();
    expect(notif.read).toBe(false);
  });

  it("read state can be toggled (simulated)", () => {
    const notif = makeNotification();
    expect(notif.read).toBe(false);
    const readNotif = { ...notif, read: true };
    expect(readNotif.read).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. FILTERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Filtering", () => {
  const notifications: Notification[] = [
    { ...makeNotification(), read: false, severity: "CRITICAL" },
    { ...makeNotification(), read: true, severity: "HIGH" },
    { ...makeNotification(), read: false, severity: "MEDIUM" },
    { ...makeNotification(), read: true, severity: "LOW" },
    { ...makeNotification(), read: false, severity: "INFO" },
  ];

  it("ALL filter returns all", () => {
    const result = filterNotifications(notifications, "ALL");
    expect(result.length).toBe(5);
  });

  it("UNREAD filter returns only unread", () => {
    const result = filterNotifications(notifications, "UNREAD");
    expect(result.length).toBe(3);
    expect(result.every((n) => !n.read)).toBe(true);
  });

  it("CRITICAL filter returns only critical", () => {
    const result = filterNotifications(notifications, "CRITICAL");
    expect(result.length).toBe(1);
    expect(result[0].severity).toBe("CRITICAL");
  });

  it("HIGH filter returns only high", () => {
    const result = filterNotifications(notifications, "HIGH");
    expect(result.length).toBe(1);
    expect(result[0].severity).toBe("HIGH");
  });

  it("MEDIUM filter returns only medium", () => {
    const result = filterNotifications(notifications, "MEDIUM");
    expect(result.length).toBe(1);
  });

  it("LOW filter returns only low", () => {
    const result = filterNotifications(notifications, "LOW");
    expect(result.length).toBe(1);
  });

  it("filter on empty array returns empty", () => {
    const result = filterNotifications([], "UNREAD");
    expect(result.length).toBe(0);
  });

  it("filter does not mutate input", () => {
    const input = [...notifications];
    filterNotifications(input, "UNREAD");
    expect(input.length).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. RETENTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Retention", () => {
  it("returns all notifications if under limit", () => {
    const notifs = [makeNotification(), makeNotification()];
    const result = applyRetention(notifs, 200);
    expect(result.length).toBe(2);
  });

  it("returns all notifications if at limit", () => {
    const notifs = Array.from({ length: 5 }, () => makeNotification());
    const result = applyRetention(notifs, 5);
    expect(result.length).toBe(5);
  });

  it("truncates to max when over limit", () => {
    const notifs = Array.from({ length: 10 }, () => makeNotification());
    const result = applyRetention(notifs, 5);
    expect(result.length).toBe(5);
  });

  it("preserves higher severity notifications", () => {
    const critical: Notification = {
      ...makeNotification(),
      severity: "CRITICAL",
      createdAt: 100,
    };
    const low: Notification = {
      ...makeNotification(),
      severity: "LOW",
      createdAt: 200,
    };
    const result = applyRetention([low, critical], 1);
    expect(result.length).toBe(1);
    expect(result[0].severity).toBe("CRITICAL");
  });

  it("preserves newer when severity is equal", () => {
    const older: Notification = {
      ...makeNotification(),
      severity: "HIGH",
      createdAt: 100,
    };
    const newer: Notification = {
      ...makeNotification(),
      severity: "HIGH",
      createdAt: 200,
    };
    const result = applyRetention([older, newer], 1);
    expect(result.length).toBe(1);
    expect(result[0].createdAt).toBe(200);
  });

  it("MAX_NOTIFICATIONS_PER_USER is 200", () => {
    expect(MAX_NOTIFICATIONS_PER_USER).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. MISSING OPTIONAL FIELDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Missing Optional Fields", () => {
  it("handles alert without instrument", () => {
    const alert = makeAlert({ instrument: undefined });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.instrument).toBeUndefined();
    expect(notif.title).toBeTruthy();
  });

  it("handles alert without positionId", () => {
    const alert = makeAlert({ positionId: undefined });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.positionId).toBeUndefined();
  });

  it("handles alert without side", () => {
    const alert = makeAlert();
    const notif = buildNotification(alert, undefined, 1000);
    expect(notif.side).toBe("NONE");
    expect(notif.impact).toBe("NEUTRAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. NO FABRICATED DATA
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — No Fabricated Data", () => {
  it("notification message is derived from alert description, not fabricated", () => {
    const alert = makeAlert({ description: "Real alert description" });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.message).toBe("Real alert description");
  });

  it("notification does not contain price data", () => {
    const notif = makeNotification();
    const serialized = JSON.stringify(notif);
    expect(serialized).not.toMatch(/\$[\d,.]+/);
    expect(serialized).not.toMatch(/price.*\d+\.\d+/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. NO PROBABILITY LANGUAGE
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — No Probability Language", () => {
  const prohibitedTerms = [
    "guaranteed",
    "likely",
    "will happen",
    "probability",
    "percent",
    "chance",
    "expected to",
    "predicted",
  ];

  const conditions: RuleCondition[] = [
    "THESIS_STATE_CHANGED",
    "THESIS_BECAME_DETERIORATING",
    "THESIS_BECAME_INVALIDATED",
    "REGIME_CHANGED",
    "NEWS_BECAME_CONFLICTING",
    "NEWS_BECAME_SUPPORTING",
    "MACRO_REGIME_CHANGED",
    "CROSS_ASSET_CONFLICT",
    "DATA_BECAME_UNAVAILABLE",
    "DATA_RECOVERED",
  ];

  conditions.forEach((condition) => {
    it(`notification for ${condition} contains no probability language`, () => {
      const alert = makeAlert({ condition });
      const notif = buildNotification(alert, "LONG", 1000);
      const text = `${notif.title} ${notif.message}`.toLowerCase();
      for (const term of prohibitedTerms) {
        expect(text).not.toContain(term);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// N. NO EXECUTION LANGUAGE
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — No Execution Language", () => {
  const execTerms = [
    "buy",
    "sell",
    "close position",
    "execute",
    "place order",
    "open trade",
    "auto-buy",
    "auto-sell",
    "auto-close",
  ];

  const conditions: RuleCondition[] = [
    "THESIS_STATE_CHANGED",
    "THESIS_BECAME_DETERIORATING",
    "NEWS_BECAME_SUPPORTING",
    "PORTFOLIO_CONFLICT_DETECTED",
  ];

  conditions.forEach((condition) => {
    it(`notification for ${condition} contains no execution language`, () => {
      const alert = makeAlert({ condition });
      const notif = buildNotification(alert, "LONG", 1000);
      const text = `${notif.title} ${notif.message}`.toLowerCase();
      for (const term of execTerms) {
        expect(text).not.toContain(term);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// O. BOUNDED OUTPUT
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Bounded Output", () => {
  it("retention produces bounded output", () => {
    const notifs = Array.from({ length: 500 }, (_, i) => ({
      ...makeNotification(),
      createdAt: i,
    }));
    const result = applyRetention(notifs, 200);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("filter produces bounded output", () => {
    const notifs = Array.from({ length: 100 }, () => ({
      ...makeNotification(),
      read: false,
    }));
    const result = filterNotifications(notifs, "UNREAD");
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. EMPTY STATE
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Empty State", () => {
  it("filter on empty array returns empty", () => {
    expect(filterNotifications([], "ALL").length).toBe(0);
    expect(filterNotifications([], "UNREAD").length).toBe(0);
    expect(filterNotifications([], "CRITICAL").length).toBe(0);
  });

  it("retention on empty array returns empty", () => {
    expect(applyRetention([], 200).length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. MULTIPLE NOTIFICATIONS ORDERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Multiple Notifications Ordering", () => {
  it("retention sorts by severity desc then createdAt desc", () => {
    const notifs: Notification[] = [
      { ...makeNotification(), severity: "LOW", createdAt: 300 },
      { ...makeNotification(), severity: "CRITICAL", createdAt: 100 },
      { ...makeNotification(), severity: "HIGH", createdAt: 200 },
      { ...makeNotification(), severity: "MEDIUM", createdAt: 400 },
    ];
    const result = applyRetention(notifs, 3);
    expect(result[0].severity).toBe("CRITICAL");
    expect(result[1].severity).toBe("HIGH");
    expect(result[2].severity).toBe("MEDIUM");
  });
});

// ═══════════════════════════════════════════════════════════════
// R. USER ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — User Isolation", () => {
  it("notificationIdentity includes userId for isolation", () => {
    const id1 = notificationIdentity("user-A", "alert-1");
    const id2 = notificationIdentity("user-B", "alert-1");
    expect(id1).not.toBe(id2);
  });

  it("different users cannot share notification identity", () => {
    const notif1 = buildNotification(
      makeAlert({ userId: "user-A" }),
      "LONG",
      1000,
    );
    const notif2 = buildNotification(
      makeAlert({ userId: "user-B" }),
      "LONG",
      1000,
    );
    expect(notif1.notificationId).not.toBe(notif2.notificationId);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. IMPACT NEUTRAL FOR NON-DIRECTIONAL CONDITIONS
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Impact Neutral for Non-Directional", () => {
  const neutralConditions: RuleCondition[] = [
    "THESIS_STATE_CHANGED",
    "REGIME_CHANGED",
    "H1_TREND_CHANGED",
    "M15_TREND_CHANGED",
    "M5_TREND_CHANGED",
    "STRUCTURE_CHANGED",
    "MOMENTUM_CHANGED",
    "VOLATILITY_CHANGED",
    "EVIDENCE_QUALITY_CHANGED",
    "SUPPORTING_EVIDENCE_CHANGED",
    "CONFLICTING_EVIDENCE_CHANGED",
    "MACRO_REGIME_CHANGED",
    "CROSS_ASSET_CONFLICT",
    "PORTFOLIO_CONCENTRATION_DETECTED",
    "PORTFOLIO_CONFLICT_DETECTED",
  ];

  neutralConditions.forEach((condition) => {
    it(`${condition} is NEUTRAL impact`, () => {
      const alert = makeAlert({ condition });
      const notif = buildNotification(alert, "LONG", 1000);
      expect(notif.impact).toBe("NEUTRAL");
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// T. NOTIFICATION TITLE CONTAINS INSTRUMENT
// ═══════════════════════════════════════════════════════════════

describe("Phase 94 — Notification Titles", () => {
  it("thesis title contains instrument", () => {
    const alert = makeAlert({ condition: "THESIS_STATE_CHANGED", instrument: "ETH/USDT" });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.title).toContain("ETH/USDT");
  });

  it("portfolio title does not require instrument", () => {
    const alert = makeAlert({ condition: "PORTFOLIO_CONFLICT_DETECTED", instrument: undefined });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.title).toBeTruthy();
  });

  it("macro title does not require instrument", () => {
    const alert = makeAlert({ condition: "MACRO_REGIME_CHANGED", instrument: undefined });
    const notif = buildNotification(alert, "LONG", 1000);
    expect(notif.title).toBeTruthy();
  });
});
