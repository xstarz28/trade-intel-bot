/**
 * Phase 98 — Notification Preferences & Alert Delivery Controls
 *
 * Comprehensive test suite for the notification preference model,
 * pure filter engine, validation, sanitization, and safety invariants.
 *
 * No fabricated data. No probability language. No execution language.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREFERENCES,
  filterNotificationsByPreferences,
  isNotificationVisible,
  validatePreferences,
  sanitizePreferences,
  ALL_CATEGORIES,
  ALL_SCOPES,
  MAX_MUTED_RULES,
  MAX_MUTED_INSTRUMENTS,
  MAX_ENABLED_INSTRUMENTS,
  type NotificationPreferences,
} from "./notification-preferences";
import type { Notification, NotificationCategory, NotificationSeverity } from "./notification-engine";

// ─── Test Helpers ────────────────────────────────────────────

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    notificationId: "notif-1",
    userId: "user-1",
    // alertId is not a field on Notification — alertIdentity is
    alertIdentity: "user-1:alert-1",
    ruleId: "rule-1",
    ruleName: "Thesis Changed",
    timestamp: Date.now(),
    createdAt: Date.now(),
    instrument: "BTC/USDT",
    positionId: "pos-1",
    side: "LONG",
    severity: "MEDIUM",
    title: "BTC/USDT LONG thesis changed",
    message: "Thesis shifted from HEALTHY to STABLE",
    category: "THESIS",
    impact: "SUPPORTING",
    read: false,
    dismissed: false,
    source: "CUSTOM_RULE",
    condition: "THESIS_STATE_CHANGED",
    ...overrides,
  };
}

function makePrefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

// ═══════════════════════════════════════════════════════════════
// A. DEFAULT PREFERENCES
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Default Preferences", () => {
  it("defaults to INFO minimum severity", () => {
    expect(DEFAULT_PREFERENCES.minimumSeverity).toBe("INFO");
  });

  it("defaults to all categories enabled (empty array)", () => {
    expect(DEFAULT_PREFERENCES.enabledCategories).toEqual([]);
  });

  it("defaults to all scopes enabled (empty array)", () => {
    expect(DEFAULT_PREFERENCES.enabledScopes).toEqual([]);
  });

  it("defaults to no muted rules", () => {
    expect(DEFAULT_PREFERENCES.mutedRuleIds).toEqual([]);
  });

  it("defaults to no instrument restrictions", () => {
    expect(DEFAULT_PREFERENCES.enabledInstruments).toEqual([]);
    expect(DEFAULT_PREFERENCES.mutedInstruments).toEqual([]);
  });

  it("defaults to showing read notifications", () => {
    expect(DEFAULT_PREFERENCES.showReadNotifications).toBe(true);
  });

  it("defaults to hiding dismissed notifications", () => {
    expect(DEFAULT_PREFERENCES.showDismissedNotifications).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. SEVERITY FILTERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Severity Filtering", () => {
  it("shows all notifications at INFO minimum", () => {
    const notifs = [
      makeNotification({ severity: "INFO" }),
      makeNotification({ severity: "LOW" }),
      makeNotification({ severity: "MEDIUM" }),
      makeNotification({ severity: "HIGH" }),
      makeNotification({ severity: "CRITICAL" }),
    ];
    const result = filterNotificationsByPreferences(notifs, makePrefs());
    expect(result).toHaveLength(5);
  });

  it("hides INFO and LOW when minimum is MEDIUM", () => {
    const notifs = [
      makeNotification({ severity: "INFO" }),
      makeNotification({ severity: "LOW" }),
      makeNotification({ severity: "MEDIUM" }),
      makeNotification({ severity: "HIGH" }),
      makeNotification({ severity: "CRITICAL" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ minimumSeverity: "MEDIUM" }),
    );
    expect(result).toHaveLength(3);
    expect(result.every((n) => ["MEDIUM", "HIGH", "CRITICAL"].includes(n.severity))).toBe(true);
  });

  it("shows only CRITICAL at CRITICAL minimum", () => {
    const notifs = [
      makeNotification({ severity: "INFO" }),
      makeNotification({ severity: "HIGH" }),
      makeNotification({ severity: "CRITICAL" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ minimumSeverity: "CRITICAL" }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("CRITICAL");
  });

  it("hides everything when severity is below minimum", () => {
    const notifs = [makeNotification({ severity: "INFO" })];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ minimumSeverity: "LOW" }),
    );
    expect(result).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. CATEGORY FILTERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Category Filtering", () => {
  it("shows all categories when enabledCategories is empty", () => {
    const notifs = [
      makeNotification({ category: "THESIS" }),
      makeNotification({ category: "REGIME" }),
      makeNotification({ category: "NEWS" }),
    ];
    const result = filterNotificationsByPreferences(notifs, makePrefs());
    expect(result).toHaveLength(3);
  });

  it("hides categories not in enabledCategories", () => {
    const notifs = [
      makeNotification({ category: "THESIS" }),
      makeNotification({ category: "REGIME" }),
      makeNotification({ category: "NEWS" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ enabledCategories: ["THESIS"] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("THESIS");
  });

  it("enables multiple specific categories", () => {
    const notifs = [
      makeNotification({ category: "THESIS" }),
      makeNotification({ category: "REGIME" }),
      makeNotification({ category: "NEWS" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ enabledCategories: ["THESIS", "NEWS"] }),
    );
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. SCOPE FILTERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Scope Filtering", () => {
  it("shows all scopes when enabledScopes is empty", () => {
    const notifs = [
      makeNotification({ positionId: "pos-1", instrument: "BTC/USDT" }),
      makeNotification({ positionId: undefined, instrument: "ETH/USDT" }),
      makeNotification({ category: "PORTFOLIO" }),
      makeNotification({ positionId: undefined, instrument: undefined }),
    ];
    const result = filterNotificationsByPreferences(notifs, makePrefs());
    expect(result).toHaveLength(4);
  });

  it("POSITION scope only shows notifications with positionId", () => {
    const notifs = [
      makeNotification({ positionId: "pos-1", instrument: "BTC/USDT" }),
      makeNotification({ positionId: undefined, instrument: "ETH/USDT" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ enabledScopes: ["POSITION"] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].positionId).toBe("pos-1");
  });

  it("PORTFOLIO scope shows portfolio-category notifications", () => {
    const notifs = [
      makeNotification({ category: "PORTFOLIO", positionId: undefined }),
      makeNotification({ positionId: "pos-1" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ enabledScopes: ["PORTFOLIO"] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("PORTFOLIO");
  });

  it("GLOBAL scope shows notifications without position or instrument", () => {
    const notifs = [
      makeNotification({ positionId: "pos-1", instrument: "BTC/USDT" }),
      makeNotification({ positionId: undefined, instrument: undefined }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ enabledScopes: ["GLOBAL"] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].positionId).toBeUndefined();
    expect(result[0].instrument).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// E. MUTED RULE FILTERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Muted Rule Filtering", () => {
  it("hides notifications from muted rules", () => {
    const notifs = [
      makeNotification({ ruleId: "rule-1" }),
      makeNotification({ ruleId: "rule-2" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ mutedRuleIds: ["rule-1"] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("rule-2");
  });

  it("shows all when no rules are muted", () => {
    const notifs = [
      makeNotification({ ruleId: "rule-1" }),
      makeNotification({ ruleId: "rule-2" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ mutedRuleIds: [] }),
    );
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. INSTRUMENT FILTERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Instrument Filtering", () => {
  it("muted instrument hides matching notifications", () => {
    const notifs = [
      makeNotification({ instrument: "BTC/USDT" }),
      makeNotification({ instrument: "ETH/USDT" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ mutedInstruments: ["BTC/USDT"] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].instrument).toBe("ETH/USDT");
  });

  it("enabledInstruments acts as allow-list", () => {
    const notifs = [
      makeNotification({ instrument: "BTC/USDT" }),
      makeNotification({ instrument: "ETH/USDT" }),
      makeNotification({ instrument: "SOL/USDT" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ enabledInstruments: ["BTC/USDT", "ETH/USDT"] }),
    );
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.instrument)).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("portfolio/global notifications without instrument are NOT hidden by enabledInstruments", () => {
    const notifs = [
      makeNotification({ instrument: "BTC/USDT" }),
      makeNotification({ instrument: undefined, category: "PORTFOLIO", positionId: undefined }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ enabledInstruments: ["BTC/USDT"] }),
    );
    // BTC/USDT is allowed, PORTFOLIO notification has no instrument so it passes the enabledInstruments check
    expect(result).toHaveLength(2);
  });

  it("empty enabledInstruments shows all", () => {
    const notifs = [
      makeNotification({ instrument: "BTC/USDT" }),
      makeNotification({ instrument: "ETH/USDT" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ enabledInstruments: [] }),
    );
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. READ / DISMISSED FILTERING
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Read/Dismissed Filtering", () => {
  it("read notifications hidden when showReadNotifications=false", () => {
    const notifs = [
      makeNotification({ read: true }),
      makeNotification({ read: false }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ showReadNotifications: false }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].read).toBe(false);
  });

  it("all notifications shown when showReadNotifications=true", () => {
    const notifs = [
      makeNotification({ read: true }),
      makeNotification({ read: false }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ showReadNotifications: true }),
    );
    expect(result).toHaveLength(2);
  });

  it("dismissed notifications hidden by default", () => {
    const notifs = [
      makeNotification({ dismissed: true }),
      makeNotification({ dismissed: false }),
    ];
    const result = filterNotificationsByPreferences(notifs, makePrefs());
    expect(result).toHaveLength(1);
    expect(result[0].dismissed).toBe(false);
  });

  it("dismissed notifications shown when showDismissedNotifications=true", () => {
    const notifs = [
      makeNotification({ dismissed: true }),
      makeNotification({ dismissed: false }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ showDismissedNotifications: true }),
    );
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. COMBINED FILTERS
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Combined Filters", () => {
  it("applies multiple filters simultaneously", () => {
    const notifs = [
      makeNotification({ severity: "INFO", category: "THESIS", read: true }),
      makeNotification({ severity: "HIGH", category: "THESIS", read: false }),
      makeNotification({ severity: "HIGH", category: "NEWS", read: false }),
      makeNotification({ severity: "CRITICAL", category: "THESIS", read: false, dismissed: true }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({
        minimumSeverity: "MEDIUM",
        enabledCategories: ["THESIS"],
        showReadNotifications: false,
        showDismissedNotifications: false,
      }),
    );
    // Only HIGH + THESIS + unread + not dismissed
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("HIGH");
    expect(result[0].category).toBe("THESIS");
    expect(result[0].read).toBe(false);
  });

  it("returns empty array when all notifications are filtered out", () => {
    const notifs = [
      makeNotification({ severity: "INFO" }),
      makeNotification({ severity: "LOW" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ minimumSeverity: "CRITICAL" }),
    );
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. NO MUTATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — No Mutation", () => {
  it("does not mutate the input array", () => {
    const notifs = [
      makeNotification({ severity: "INFO" }),
      makeNotification({ severity: "HIGH" }),
    ];
    const original = [...notifs];
    filterNotificationsByPreferences(
      notifs,
      makePrefs({ minimumSeverity: "HIGH" }),
    );
    expect(notifs).toEqual(original);
  });

  it("does not mutate notification objects", () => {
    const notif = makeNotification({ read: false });
    const original = { ...notif };
    filterNotificationsByPreferences(
      [notif],
      makePrefs({ showReadNotifications: false }),
    );
    expect(notif).toEqual(original);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. DETERMINISTIC OUTPUT
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Deterministic Output", () => {
  it("same inputs produce identical output", () => {
    const notifs = [
      makeNotification({ severity: "MEDIUM" }),
      makeNotification({ severity: "HIGH" }),
    ];
    const prefs = makePrefs({ minimumSeverity: "MEDIUM" });
    const result1 = filterNotificationsByPreferences(notifs, prefs);
    const result2 = filterNotificationsByPreferences(notifs, prefs);
    expect(result1).toEqual(result2);
  });

  it("isNotificationVisible is deterministic", () => {
    const notif = makeNotification();
    const prefs = makePrefs();
    expect(isNotificationVisible(notif, prefs)).toBe(
      isNotificationVisible(notif, prefs),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// K. EMPTY / MISSING FIELDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Empty/Missing Fields", () => {
  it("handles empty notification list", () => {
    const result = filterNotificationsByPreferences([], makePrefs());
    expect(result).toEqual([]);
  });

  it("handles notification with no instrument", () => {
    const notif = makeNotification({ instrument: undefined, positionId: undefined });
    const result = filterNotificationsByPreferences(
      [notif],
      makePrefs({ enabledInstruments: ["BTC/USDT"] }),
    );
    // No instrument → passes enabledInstruments check (no instrument to filter)
    expect(result).toHaveLength(1);
  });

  it("handles notification with no positionId", () => {
    const notif = makeNotification({ positionId: undefined });
    const result = filterNotificationsByPreferences(
      [notif],
      makePrefs({ enabledScopes: ["POSITION"] }),
    );
    // No positionId → derived scope is not POSITION → hidden
    expect(result).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — LONG/SHORT Symmetry", () => {
  it("preferences filter both LONG and SHORT equally", () => {
    const notifs = [
      makeNotification({ side: "LONG", instrument: "BTC/USDT" }),
      makeNotification({ side: "SHORT", instrument: "BTC/USDT" }),
      makeNotification({ side: "LONG", instrument: "ETH/USDT" }),
    ];
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ mutedInstruments: ["ETH/USDT"] }),
    );
    expect(result).toHaveLength(2);
    expect(result.every((n) => n.instrument === "BTC/USDT")).toBe(true);
  });

  it("preferences do not alter side field", () => {
    const notif = makeNotification({ side: "SHORT" });
    const result = filterNotificationsByPreferences([notif], makePrefs());
    expect(result[0].side).toBe("SHORT");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Validation", () => {
  it("valid default preferences", () => {
    expect(validatePreferences(DEFAULT_PREFERENCES)).toBe(true);
  });

  it("rejects null", () => {
    expect(validatePreferences(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validatePreferences(undefined)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(validatePreferences("string")).toBe(false);
  });

  it("rejects invalid severity", () => {
    expect(
      validatePreferences({ ...DEFAULT_PREFERENCES, minimumSeverity: "INVALID" }),
    ).toBe(false);
  });

  it("rejects non-array enabledCategories", () => {
    expect(
      validatePreferences({ ...DEFAULT_PREFERENCES, enabledCategories: "THESIS" }),
    ).toBe(false);
  });

  it("rejects non-boolean showReadNotifications", () => {
    expect(
      validatePreferences({ ...DEFAULT_PREFERENCES, showReadNotifications: "yes" }),
    ).toBe(false);
  });

  it("rejects exceeding mutedRuleIds limit", () => {
    expect(
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        mutedRuleIds: Array.from({ length: MAX_MUTED_RULES + 1 }, (_, i) => `rule-${i}`),
      }),
    ).toBe(false);
  });

  it("accepts at max mutedRuleIds limit", () => {
    expect(
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        mutedRuleIds: Array.from({ length: MAX_MUTED_RULES }, (_, i) => `rule-${i}`),
      }),
    ).toBe(true);
  });

  it("rejects invalid category value", () => {
    expect(
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        enabledCategories: ["INVALID_CAT"],
      }),
    ).toBe(false);
  });

  it("rejects invalid scope value", () => {
    expect(
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        enabledScopes: ["INVALID_SCOPE"],
      }),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. SANITIZATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Sanitization", () => {
  it("returns defaults for invalid input", () => {
    const result = sanitizePreferences(null);
    expect(result).toEqual(DEFAULT_PREFERENCES);
  });

  it("deduplicates enabledCategories", () => {
    const result = sanitizePreferences({
      ...DEFAULT_PREFERENCES,
      enabledCategories: ["THESIS", "THESIS", "REGIME"],
    });
    expect(result.enabledCategories).toEqual(["THESIS", "REGIME"]);
  });

  it("deduplicates mutedRuleIds", () => {
    const result = sanitizePreferences({
      ...DEFAULT_PREFERENCES,
      mutedRuleIds: ["r1", "r1", "r2"],
    });
    expect(result.mutedRuleIds).toEqual(["r1", "r2"]);
  });

  it("returns defaults when mutedRuleIds exceed max (validation rejects)", () => {
    const result = sanitizePreferences({
      ...DEFAULT_PREFERENCES,
      mutedRuleIds: Array.from({ length: MAX_MUTED_RULES + 5 }, (_, i) => `rule-${i}`),
    });
    // Invalid input → sanitizePreferences returns defaults
    expect(result.mutedRuleIds).toEqual([]);
  });

  it("keeps valid mutedRuleIds up to max", () => {
    const result = sanitizePreferences({
      ...DEFAULT_PREFERENCES,
      mutedRuleIds: Array.from({ length: MAX_MUTED_RULES }, (_, i) => `rule-${i}`),
    });
    expect(result.mutedRuleIds.length).toBe(MAX_MUTED_RULES);
  });

  it("returns defaults for completely invalid object", () => {
    const result = sanitizePreferences({ random: "data" });
    expect(result).toEqual(DEFAULT_PREFERENCES);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. PORTFOLIO/GLOBAL NOTIFICATIONS WITHOUT INSTRUMENTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Portfolio/Global Without Instruments", () => {
  it("PORTFOLIO notification with no instrument is not hidden by enabledInstruments", () => {
    const notif = makeNotification({
      instrument: undefined,
      positionId: undefined,
      category: "PORTFOLIO",
    });
    const result = filterNotificationsByPreferences(
      [notif],
      makePrefs({ enabledInstruments: ["BTC/USDT"] }),
    );
    expect(result).toHaveLength(1);
  });

  it("GLOBAL notification with no instrument is not hidden by enabledInstruments", () => {
    const notif = makeNotification({
      instrument: undefined,
      positionId: undefined,
      category: "SYSTEM",
    });
    const result = filterNotificationsByPreferences(
      [notif],
      makePrefs({ enabledInstruments: ["BTC/USDT"] }),
    );
    expect(result).toHaveLength(1);
  });

  it("CROSS_ASSET notification with no instrument maps to PORTFOLIO scope", () => {
    const notif = makeNotification({
      instrument: undefined,
      positionId: undefined,
      category: "CROSS_ASSET",
    });
    const result = filterNotificationsByPreferences(
      [notif],
      makePrefs({ enabledScopes: ["GLOBAL"] }),
    );
    // CROSS_ASSET derives to PORTFOLIO scope, GLOBAL scope does not match
    expect(result).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. SAFETY — NO PROBABILITY / EXECUTION LANGUAGE
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Safety Invariants", () => {
  it("preferences have no execution semantics", () => {
    const prefs = DEFAULT_PREFERENCES;
    const json = JSON.stringify(prefs).toLowerCase();
    expect(json).not.toContain("execute");
    expect(json).not.toContain("auto-buy");
    expect(json).not.toContain("auto-sell");
    expect(json).not.toContain("order");
  });

  it("notification filtering does not introduce probability language", () => {
    const notifs = [makeNotification()];
    const result = filterNotificationsByPreferences(notifs, makePrefs());
    const json = JSON.stringify(result).toLowerCase();
    expect(json).not.toContain("guaranteed");
    expect(json).not.toContain("likely");
    expect(json).not.toContain("probability");
    expect(json).not.toContain("percent chance");
  });

  it("constants have no fabrication", () => {
    const json = JSON.stringify(ALL_CATEGORIES).toLowerCase();
    expect(json).not.toContain("prediction");
    expect(json).not.toContain("guaranteed");
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. BOUNDED OUTPUT
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — Bounded Output", () => {
  it("filter result length <= input length", () => {
    const notifs = Array.from({ length: 50 }, (_, i) =>
      makeNotification({ notificationId: `notif-${i}` }),
    );
    const result = filterNotificationsByPreferences(
      notifs,
      makePrefs({ minimumSeverity: "CRITICAL" }),
    );
    expect(result.length).toBeLessThanOrEqual(notifs.length);
  });

  it("ALL_CATEGORIES contains expected categories", () => {
    expect(ALL_CATEGORIES.length).toBeGreaterThan(0);
    expect(ALL_CATEGORIES).toContain("THESIS");
    expect(ALL_CATEGORIES).toContain("PORTFOLIO");
  });

  it("ALL_SCOPES contains expected scopes", () => {
    expect(ALL_SCOPES).toEqual(["POSITION", "INSTRUMENT", "PORTFOLIO", "GLOBAL"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. isNotificationVisible EDGE CASES
// ═══════════════════════════════════════════════════════════════

describe("Phase 98 — isNotificationVisible Edge Cases", () => {
  it("CRITICAL notification passes INFO minimum", () => {
    const notif = makeNotification({ severity: "CRITICAL" });
    expect(isNotificationVisible(notif, makePrefs({ minimumSeverity: "INFO" }))).toBe(true);
  });

  it("INFO notification fails HIGH minimum", () => {
    const notif = makeNotification({ severity: "INFO" });
    expect(isNotificationVisible(notif, makePrefs({ minimumSeverity: "HIGH" }))).toBe(false);
  });

  it("muted rule notification is hidden", () => {
    const notif = makeNotification({ ruleId: "r-1" });
    expect(
      isNotificationVisible(notif, makePrefs({ mutedRuleIds: ["r-1"] })),
    ).toBe(false);
  });

  it("non-muted rule notification is shown", () => {
    const notif = makeNotification({ ruleId: "r-1" });
    expect(
      isNotificationVisible(notif, makePrefs({ mutedRuleIds: ["r-2"] })),
    ).toBe(true);
  });

  it("read notification with showRead=false is hidden", () => {
    const notif = makeNotification({ read: true });
    expect(
      isNotificationVisible(notif, makePrefs({ showReadNotifications: false })),
    ).toBe(false);
  });

  it("dismissed notification with showDismissed=false is hidden", () => {
    const notif = makeNotification({ dismissed: true });
    expect(
      isNotificationVisible(notif, makePrefs({ showDismissedNotifications: false })),
    ).toBe(false);
  });
});
