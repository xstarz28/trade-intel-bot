/**
 * Phase 94 — NotificationCenter
 *
 * Trader-facing notification center with read/unread lifecycle,
 * filtering, and severity display. Informational only — no execution buttons.
 */

import React, { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { NotificationFilter } from "../lib/position-protection/notification-engine";
import {
  filterNotifications,
  SEVERITY_COLOR,
  SEVERITY_BG,
  CATEGORY_LABELS,
  type Notification,
} from "../lib/position-protection/notification-engine";

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
  const [filter, setFilter] = useState<NotificationFilter>("ALL");
  const notifications = useQuery(api.notifications.getNotifications, { limit: 100 });
  const unreadCount = useQuery(api.notifications.getUnreadCount);
  const markRead = useMutation(api.notifications.markNotificationRead);
  const markAllRead = useMutation(api.notifications.markAllNotificationsRead);

  const filtered = useMemo(() => {
    if (!notifications) return [];
    // Convex records match Notification shape with _id/_creationTime extras
    return filterNotifications(notifications as unknown as Notification[], filter);
  }, [notifications, filter]);

  const isLoading = notifications === undefined;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-mono font-semibold">Notifications</h3>
          {unreadCount !== undefined && unreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500/20 text-red-400 text-[10px] font-mono font-bold">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount !== undefined && unreadCount > 0 && (
          <button
            onClick={() => markAllRead()}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            Mark all read
          </button>
        )}
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
              ? "No unread notifications"
              : "No notifications yet"}
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
