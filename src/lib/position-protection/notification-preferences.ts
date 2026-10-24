/**
 * Phase 98 — Notification Preferences & Alert Delivery Controls
 *
 * User-scoped preference layer controlling notification visibility.
 * Pure functions — no side effects, no network calls.
 * No fabrication, no probability, no auto-execution.
 */

import type { Notification, NotificationCategory, NotificationSeverity } from "./notification-engine";
import { SEVERITY_ORDER } from "./notification-engine";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PreferenceScope = "POSITION" | "INSTRUMENT" | "PORTFOLIO" | "GLOBAL";

/**
 * User notification preferences.
 * Controls which notifications are surfaced in the NotificationCenter.
 */
export interface NotificationPreferences {
  /** Minimum severity to display */
  minimumSeverity: NotificationSeverity;
  /** Enabled notification categories — empty means ALL enabled */
  enabledCategories: NotificationCategory[];
  /** Enabled scopes — empty means ALL enabled */
  enabledScopes: PreferenceScope[];
  /** Rule IDs whose notifications are muted (still persisted, just hidden) */
  mutedRuleIds: string[];
  /** Allow-list of instruments — empty means all instruments */
  enabledInstruments: string[];
  /** Deny-list of instruments */
  mutedInstruments: string[];
  /** Whether to show read notifications */
  showReadNotifications: boolean;
  /** Whether to show dismissed notifications */
  showDismissedNotifications: boolean;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const MAX_MUTED_RULES = 100;
export const MAX_MUTED_INSTRUMENTS = 100;
export const MAX_ENABLED_INSTRUMENTS = 100;

export const ALL_CATEGORIES: NotificationCategory[] = [
  "THESIS", "REGIME", "TREND", "STRUCTURE", "MOMENTUM", "VOLATILITY",
  "EVIDENCE", "NEWS", "MACRO", "CROSS_ASSET", "PORTFOLIO", "DATA_QUALITY", "SYSTEM",
];

export const ALL_SCOPES: PreferenceScope[] = ["POSITION", "INSTRUMENT", "PORTFOLIO", "GLOBAL"];

// ═══════════════════════════════════════════════════════════════
// DEFAULT PREFERENCES
// ═══════════════════════════════════════════════════════════════

/**
 * Default preferences — all notifications visible, no restrictions.
 * Existing users with no preferences record behave exactly like today.
 */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  minimumSeverity: "INFO",
  enabledCategories: [],
  enabledScopes: [],
  mutedRuleIds: [],
  enabledInstruments: [],
  mutedInstruments: [],
  showReadNotifications: true,
  showDismissedNotifications: false,
};

// ═══════════════════════════════════════════════════════════════
// PURE FILTER ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic filter: notifications + preferences → visible notifications.
 * Same inputs always produce identical output.
 * Does NOT mutate the input array.
 */
export function filterNotificationsByPreferences(
  notifications: Notification[],
  preferences: NotificationPreferences,
): Notification[] {
  return notifications.filter((n) => isNotificationVisible(n, preferences));
}

/**
 * Deterministic check: is a single notification visible given preferences?
 */
export function isNotificationVisible(
  notification: Notification,
  preferences: NotificationPreferences,
): boolean {
  // 1. Minimum severity check
  if (!meetsMinimumSeverity(notification.severity, preferences.minimumSeverity)) {
    return false;
  }

  // 2. Category check
  if (!isCategoryEnabled(notification.category, preferences.enabledCategories)) {
    return false;
  }

  // 3. Scope check (derive scope from notification context)
  const notifScope = deriveScope(notification);
  if (!isScopeEnabled(notifScope, preferences.enabledScopes)) {
    return false;
  }

  // 4. Muted rule check
  if (preferences.mutedRuleIds.includes(notification.ruleId)) {
    return false;
  }

  // 5. Muted instrument check
  if (notification.instrument && preferences.mutedInstruments.includes(notification.instrument)) {
    return false;
  }

  // 6. Enabled instruments check (allow-list)
  if (preferences.enabledInstruments.length > 0 && notification.instrument) {
    if (!preferences.enabledInstruments.includes(notification.instrument)) {
      return false;
    }
  }

  // 7. Read notification check
  if (notification.read && !preferences.showReadNotifications) {
    return false;
  }

  // 8. Dismissed notification check
  if (notification.dismissed && !preferences.showDismissedNotifications) {
    return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

function meetsMinimumSeverity(
  notificationSeverity: NotificationSeverity,
  minimumSeverity: NotificationSeverity,
): boolean {
  return (SEVERITY_ORDER[notificationSeverity] ?? 0) >= (SEVERITY_ORDER[minimumSeverity] ?? 0);
}

function isCategoryEnabled(
  category: NotificationCategory,
  enabledCategories: NotificationCategory[],
): boolean {
  // Empty = all enabled
  if (enabledCategories.length === 0) return true;
  return enabledCategories.includes(category);
}

function deriveScope(notification: Notification): PreferenceScope {
  if (notification.category === "PORTFOLIO" || notification.category === "CROSS_ASSET") {
    return "PORTFOLIO";
  }
  if (notification.positionId) return "POSITION";
  if (notification.instrument) return "INSTRUMENT";
  return "GLOBAL";
}

function isScopeEnabled(
  scope: PreferenceScope,
  enabledScopes: PreferenceScope[],
): boolean {
  // Empty = all enabled
  if (enabledScopes.length === 0) return true;
  return enabledScopes.includes(scope);
}

// ═══════════════════════════════════════════════════════════════
// PREFERENCE VALIDATION
// ═══════════════════════════════════════════════════════════════

const VALID_SEVERITIES: NotificationSeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const VALID_CATEGORIES: NotificationCategory[] = ALL_CATEGORIES;
const VALID_SCOPES: PreferenceScope[] = ALL_SCOPES;

/**
 * Validate preferences object. Returns true if valid, throws if invalid.
 */
export function validatePreferences(prefs: unknown): prefs is NotificationPreferences {
  if (typeof prefs !== "object" || prefs === null) return false;
  const p = prefs as Record<string, unknown>;

  if (typeof p.minimumSeverity !== "string" || !VALID_SEVERITIES.includes(p.minimumSeverity as NotificationSeverity)) return false;
  if (!Array.isArray(p.enabledCategories)) return false;
  if (!Array.isArray(p.enabledScopes)) return false;
  if (!Array.isArray(p.mutedRuleIds)) return false;
  if (!Array.isArray(p.enabledInstruments)) return false;
  if (!Array.isArray(p.mutedInstruments)) return false;
  if (typeof p.showReadNotifications !== "boolean") return false;
  if (typeof p.showDismissedNotifications !== "boolean") return false;

  // Bounded arrays
  if (p.mutedRuleIds.length > MAX_MUTED_RULES) return false;
  if (p.mutedInstruments.length > MAX_MUTED_INSTRUMENTS) return false;
  if (p.enabledInstruments.length > MAX_ENABLED_INSTRUMENTS) return false;

  // Validate category values
  for (const cat of p.enabledCategories) {
    if (!VALID_CATEGORIES.includes(cat as NotificationCategory)) return false;
  }
  // Validate scope values
  for (const scope of p.enabledScopes) {
    if (!VALID_SCOPES.includes(scope as PreferenceScope)) return false;
  }

  return true;
}

/**
 * Sanitize preferences: clamp arrays, deduplicate, normalize.
 * Returns a clean copy or default preferences if invalid.
 */
export function sanitizePreferences(prefs: unknown): NotificationPreferences {
  if (!validatePreferences(prefs)) {
    return { ...DEFAULT_PREFERENCES };
  }

  const p = prefs as NotificationPreferences;
  return {
    minimumSeverity: p.minimumSeverity,
    enabledCategories: dedup(p.enabledCategories).slice(0, ALL_CATEGORIES.length),
    enabledScopes: dedup(p.enabledScopes).slice(0, ALL_SCOPES.length),
    mutedRuleIds: dedup(p.mutedRuleIds).slice(0, MAX_MUTED_RULES),
    enabledInstruments: dedup(p.enabledInstruments).slice(0, MAX_ENABLED_INSTRUMENTS),
    mutedInstruments: dedup(p.mutedInstruments).slice(0, MAX_MUTED_INSTRUMENTS),
    showReadNotifications: p.showReadNotifications,
    showDismissedNotifications: p.showDismissedNotifications,
  };
}

function dedup<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
