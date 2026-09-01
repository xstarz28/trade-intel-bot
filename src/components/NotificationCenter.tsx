/**
 * Phase 94 — NotificationCenter
 *
 * Trader-facing notification center with read/unread lifecycle,
 * filtering, and severity display. Informational only — no execution buttons.
 */

import React, { useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { NotificationFilter } from "../lib/position-protection/notification-engine";
import {
  filterNotifications,
  SEVERITY_COLOR,
  SEVERITY_BG,
  CATEGORY_LABELS,
  type Notification,
  type NotificationCategory,
  type NotificationSeverity,
} from "../lib/position-protection/notification-engine";
import {
  filterNotificationsByPreferences,
  DEFAULT_PREFERENCES,
  ALL_CATEGORIES,
  type NotificationPreferences,
  type PreferenceScope,
} from "../lib/position-protection/notification-preferences";

const SEVERITY_ORDER: Record<string, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const FILTER_OPTIONS: { label: string; value: NotificationFilter }[] = [
  { label: "ALL", value: "ALL" },
  { label: "UNREAD", value: "UNREAD" },
  { label: "CRITICAL", value: "CRITICAL" },
  { label: "HIGH", value: "HIGH" },
  { label: "MEDIUM", value: "MEDIUM" },
  { label: "LOW", value: "LOW" },
];

function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function NotificationCenter() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<NotificationFilter>("ALL");
  const [showPrefs, setShowPrefs] = useState(false);
  const notifications = useQuery(api.notifications.getNotifications, { limit: 100 });
  const unreadCount = useQuery(api.notifications.getUnreadCount);
  const markRead = useMutation(api.notifications.markNotificationRead);
  const markAllRead = useMutation(api.notifications.markAllNotificationsRead);

  // Phase 98: Notification preferences
  const rawPrefs = useQuery(api.notificationPreferences.getPreferences);
  const savePrefsMut = useMutation(api.notificationPreferences.savePreferences);
  const resetPrefsMut = useMutation(api.notificationPreferences.resetPreferences);

  const prefs: NotificationPreferences = useMemo(() => {
    if (!rawPrefs) return DEFAULT_PREFERENCES;
    return {
      minimumSeverity: (rawPrefs as any).minimumSeverity ?? DEFAULT_PREFERENCES.minimumSeverity,
      enabledCategories: (rawPrefs as any).enabledCategories ?? DEFAULT_PREFERENCES.enabledCategories,
      enabledScopes: (rawPrefs as any).enabledScopes ?? DEFAULT_PREFERENCES.enabledScopes,
      mutedRuleIds: (rawPrefs as any).mutedRuleIds ?? DEFAULT_PREFERENCES.mutedRuleIds,
      enabledInstruments: (rawPrefs as any).enabledInstruments ?? DEFAULT_PREFERENCES.enabledInstruments,
      mutedInstruments: (rawPrefs as any).mutedInstruments ?? DEFAULT_PREFERENCES.mutedInstruments,
      showReadNotifications: (rawPrefs as any).showReadNotifications ?? DEFAULT_PREFERENCES.showReadNotifications,
      showDismissedNotifications: (rawPrefs as any).showDismissedNotifications ?? DEFAULT_PREFERENCES.showDismissedNotifications,
    };
  }, [rawPrefs]);

  const filtered = useMemo(() => {
    if (!notifications) return [];
    const all = notifications as unknown as Notification[];
    // Apply preference-based filtering first, then UI filter
    const byPrefs = filterNotificationsByPreferences(all, prefs);
    return filterNotifications(byPrefs, filter);
  }, [notifications, filter, prefs]);

  // Phase 98: Visible unread count (preference-filtered)
  const visibleUnreadCount = useMemo(() => {
    if (!notifications) return 0;
    const all = notifications as unknown as Notification[];
    return filterNotificationsByPreferences(
      all.filter((n) => !n.read),
      prefs,
    ).length;
  }, [notifications, prefs]);

  const isLoading = notifications === undefined;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-mono font-semibold">{t.notifications.title}</h3>
          {visibleUnreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500/20 text-red-400 text-[10px] font-mono font-bold">
              {visibleUnreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPrefs(!showPrefs)}
            className={`text-[10px] font-mono py-1 px-2 rounded-md transition-colors ${
              showPrefs ? "bg-background text-foreground font-semibold border border-border/50" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {showPrefs ? "Hide Prefs" : "Preferences"}
          </button>
          {unreadCount !== undefined && unreadCount > 0 && (
            <button
              onClick={() => markAllRead()}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.notifications.markAllRead}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`text-[10px] font-mono py-1 px-2 rounded-md transition-colors ${
              filter === opt.value
                ? "bg-background text-foreground font-semibold border border-border/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
            {opt.value === "UNREAD" &&
              unreadCount !== undefined &&
              unreadCount > 0 &&
              ` (${unreadCount})`}
          </button>
        ))}
      </div>

      {/* Phase 98: Preferences Panel */}
      {showPrefs && (
        <div className="space-y-3 p-3 rounded-lg border border-border/40 bg-muted/20">
          <div className="text-[10px] font-mono font-semibold text-muted-foreground">PREFERENCES</div>

          {/* Minimum Severity */}
          <div className="space-y-1">
            <div className="text-[9px] font-mono text-muted-foreground/70">Minimum Severity</div>
            <div className="flex gap-1">
              {["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((sev) => (
                <button
                  key={sev}
                  onClick={() => {
                    const updated = { ...prefs, minimumSeverity: sev as NotificationSeverity };
                    savePrefsMut({
                      minimumSeverity: updated.minimumSeverity,
                      enabledCategories: updated.enabledCategories,
                      enabledScopes: updated.enabledScopes,
                      mutedRuleIds: updated.mutedRuleIds,
                      enabledInstruments: updated.enabledInstruments,
                      mutedInstruments: updated.mutedInstruments,
                      showReadNotifications: updated.showReadNotifications,
                      showDismissedNotifications: updated.showDismissedNotifications,
                    });
                  }}
                  className={`text-[9px] font-mono py-0.5 px-1.5 rounded transition-colors ${
                    prefs.minimumSeverity === sev
                      ? "bg-background text-foreground font-semibold border border-border/50"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-mono text-muted-foreground/70">Categories</div>
              <button
                onClick={() => {
                  const updated = {
                    ...prefs,
                    enabledCategories: prefs.enabledCategories.length === ALL_CATEGORIES.length ? [] : [...ALL_CATEGORIES],
                  };
                  savePrefsMut({
                    minimumSeverity: updated.minimumSeverity,
                    enabledCategories: updated.enabledCategories,
                    enabledScopes: updated.enabledScopes,
                    mutedRuleIds: updated.mutedRuleIds,
                    enabledInstruments: updated.enabledInstruments,
                    mutedInstruments: updated.mutedInstruments,
                    showReadNotifications: updated.showReadNotifications,
                    showDismissedNotifications: updated.showDismissedNotifications,
                  });
                }}
                className="text-[9px] font-mono text-muted-foreground hover:text-foreground"
              >
                {prefs.enabledCategories.length === ALL_CATEGORIES.length ? "Disable All" : "Enable All"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_CATEGORIES.map((cat) => {
                const isEnabled = prefs.enabledCategories.length === 0 || prefs.enabledCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      let newCats: NotificationCategory[];
                      if (prefs.enabledCategories.length === 0) {
                        // All enabled → disable this one
                        newCats = ALL_CATEGORIES.filter((c) => c !== cat);
                      } else if (prefs.enabledCategories.includes(cat)) {
                        newCats = prefs.enabledCategories.filter((c) => c !== cat);
                      } else {
                        newCats = [...prefs.enabledCategories, cat];
                      }
                      const updated = { ...prefs, enabledCategories: newCats };
                      savePrefsMut({
                        minimumSeverity: updated.minimumSeverity,
                        enabledCategories: updated.enabledCategories,
                        enabledScopes: updated.enabledScopes,
                        mutedRuleIds: updated.mutedRuleIds,
                        enabledInstruments: updated.enabledInstruments,
                        mutedInstruments: updated.mutedInstruments,
                        showReadNotifications: updated.showReadNotifications,
                        showDismissedNotifications: updated.showDismissedNotifications,
                      });
                    }}
                    className={`text-[9px] font-mono py-0.5 px-1.5 rounded transition-colors ${
                      isEnabled
                        ? "bg-background text-foreground border border-border/50"
                        : "text-muted-foreground/40"
                    }`}
                  >
                    {CATEGORY_LABELS[cat] ?? cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Display */}
          <div className="space-y-1">
            <div className="text-[9px] font-mono text-muted-foreground/70">Display</div>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.showReadNotifications}
                  onChange={(e) => {
                    const updated = { ...prefs, showReadNotifications: e.target.checked };
                    savePrefsMut({
                      minimumSeverity: updated.minimumSeverity,
                      enabledCategories: updated.enabledCategories,
                      enabledScopes: updated.enabledScopes,
                      mutedRuleIds: updated.mutedRuleIds,
                      enabledInstruments: updated.enabledInstruments,
                      mutedInstruments: updated.mutedInstruments,
                      showReadNotifications: updated.showReadNotifications,
                      showDismissedNotifications: updated.showDismissedNotifications,
                    });
                  }}
                  className="size-3 accent-primary"
                />
                <span className="text-[9px] font-mono text-muted-foreground">Show read</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.showDismissedNotifications}
                  onChange={(e) => {
                    const updated = { ...prefs, showDismissedNotifications: e.target.checked };
                    savePrefsMut({
                      minimumSeverity: updated.minimumSeverity,
                      enabledCategories: updated.enabledCategories,
                      enabledScopes: updated.enabledScopes,
                      mutedRuleIds: updated.mutedRuleIds,
                      enabledInstruments: updated.enabledInstruments,
                      mutedInstruments: updated.mutedInstruments,
                      showReadNotifications: updated.showReadNotifications,
                      showDismissedNotifications: updated.showDismissedNotifications,
                    });
                  }}
                  className="size-3 accent-primary"
                />
                <span className="text-[9px] font-mono text-muted-foreground">Show dismissed</span>
              </label>
            </div>
          </div>

          {/* Reset */}
          <button
            onClick={() => resetPrefsMut()}
            className="text-[9px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            Reset to defaults
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="size-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-xs font-mono text-muted-foreground">
            {filter === "UNREAD"
              ? t.notifications.noUnread
              : t.notifications.noNotifications}
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
            Intelligence alerts will appear here
          </p>
        </div>
      )}

      {/* Notification List */}
      <div className="space-y-1">
        {filtered.map((notif) => (
          <div
            key={notif.notificationId}
            onClick={() => {
              if (!notif.read) {
                markRead({ notificationId: notif.notificationId });
              }
            }}
            className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
              notif.read
                ? "border-border/20 bg-transparent hover:bg-muted/30"
                : "border-border/40 bg-muted/20 hover:bg-muted/40"
            }`}
          >
            {/* Unread dot */}
            <div className="mt-1.5 shrink-0">
              {!notif.read && (
                <div className="size-1.5 rounded-full bg-primary" />
              )}
              {notif.read && <div className="size-1.5" />}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-mono font-semibold ${
                    SEVERITY_COLOR[notif.severity as keyof typeof SEVERITY_COLOR] ?? "text-muted-foreground"
                  }`}
                >
                  {notif.severity}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {notif.title}
                </span>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5 truncate">
                {notif.message}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                    SEVERITY_BG[notif.severity as keyof typeof SEVERITY_BG] ?? "bg-muted"
                  }`}
                >
                  {CATEGORY_LABELS[notif.category as keyof typeof CATEGORY_LABELS] ?? notif.category}
                </span>
                {notif.instrument && (
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {notif.instrument}
                  </span>
                )}
                {notif.side && notif.side !== "NONE" && (
                  <span
                    className={`text-[9px] font-mono ${
                      notif.side === "LONG" ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {notif.side}
                  </span>
                )}
                <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">
                  {formatTimestamp(notif.timestamp)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
