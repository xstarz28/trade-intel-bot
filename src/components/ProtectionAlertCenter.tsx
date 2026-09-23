/**
 * Phase 67 — Protection Alert Center
 *
 * Alert management view with filtering, acknowledgement, and history.
 */

import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  BellOff,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
} from "lucide-react";

export interface ProtectionAlertEntry {
  eventId: string;
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  severity: string;
  urgency: string;
  reason: string;
  action: string;
  suggestedAction: string;
  timestamp: number;
  acknowledged: boolean;
  supportingEvidence: string[];
  conflictingEvidence: string[];
}

export interface AlertCenterProps {
  alerts: ProtectionAlertEntry[];
  onAcknowledge: (eventId: string) => void;
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case "INVALIDATED":
      return "border-red-500/30 bg-red-500/5";
    case "HIGH_RISK":
      return "border-orange-500/30 bg-orange-500/5";
    case "CAUTION":
      return "border-amber-500/30 bg-amber-500/5";
    case "WATCH":
      return "border-blue-500/30 bg-blue-500/5";
    default:
      return "border-border/50 bg-muted/30";
  }
}

function getSeverityText(severity: string): string {
  switch (severity) {
    case "INVALIDATED":
      return "text-red-400";
    case "HIGH_RISK":
      return "text-orange-400";
    case "CAUTION":
      return "text-amber-400";
    case "WATCH":
      return "text-blue-400";
    default:
      return "text-emerald-400";
  }
}

export function ProtectionAlertCenter({ alerts, onAcknowledge }: AlertCenterProps) {
  const [filterSeverity, setFilterSeverity] = useState<string>("ALL");
  const [filterAck, setFilterAck] = useState<"all" | "acknowledged" | "unacknowledged">("all");
  const [showHistory, setShowHistory] = useState(true);

  const filteredAlerts = useMemo(() => {
    let result = [...alerts];
    if (filterSeverity !== "ALL") {
      result = result.filter((a) => a.severity === filterSeverity);
    }
    if (filterAck === "acknowledged") {
      result = result.filter((a) => a.acknowledged);
    } else if (filterAck === "unacknowledged") {
      result = result.filter((a) => !a.acknowledged);
    }
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }, [alerts, filterSeverity, filterAck]);

  const activeAlerts = useMemo(
    () => alerts.filter((a) => !a.acknowledged && a.severity !== "NONE"),
    [alerts],
  );


  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="size-4 text-primary" />
          <h3 className="text-sm font-mono font-semibold">Alert Center</h3>
          {activeAlerts.length > 0 && (
            <span className="rounded-full bg-red-500/20 text-red-400 text-[9px] font-mono px-1.5 py-0.5">
              {activeAlerts.length} active
            </span>
          )}
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {showHistory ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          {showHistory ? "Hide" : "Show"} history
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="h-6 text-[9px] font-mono rounded border border-border/50 bg-transparent px-1.5"
        >
          <option value="ALL">All severity</option>
          <option value="INVALIDATED">INVALIDATED</option>
          <option value="HIGH_RISK">HIGH_RISK</option>
          <option value="CAUTION">CAUTION</option>
          <option value="WATCH">WATCH</option>
          <option value="NONE">NONE</option>
        </select>
        <select
          value={filterAck}
          onChange={(e) => setFilterAck(e.target.value as typeof filterAck)}
          className="h-6 text-[9px] font-mono rounded border border-border/50 bg-transparent px-1.5"
        >
          <option value="all">All</option>
          <option value="unacknowledged">Unacknowledged</option>
          <option value="acknowledged">Acknowledged</option>
        </select>
        <span className="text-[9px] font-mono text-muted-foreground self-center">
          {filteredAlerts.length} shown
        </span>
      </div>

      {/* Active Alerts */}
      {!showHistory && (
        <div className="space-y-1.5">
          {activeAlerts.length === 0 && (
            <div className="text-center py-4 text-[10px] text-muted-foreground font-mono flex items-center justify-center gap-1.5">
              <BellOff className="size-3" />
              No active alerts
            </div>
          )}
          <AnimatePresence>
            {activeAlerts.map((alert) => (
              <motion.div
                key={alert.eventId}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={`rounded-lg border px-2.5 py-2 ${getSeverityColor(alert.severity)}`}
              >
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <AlertTriangle className={`size-3 ${getSeverityText(alert.severity)}`} />
                  <span className="font-semibold">{alert.instrument}</span>
                  <span className="opacity-70">{alert.side}</span>
                  <span className={`font-bold ${getSeverityText(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <span className="flex-1 truncate opacity-70">{alert.suggestedAction}</span>
                  <button
                    onClick={() => onAcknowledge(alert.eventId)}
                    className="flex items-center gap-1 rounded border border-border/50 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  >
                    <CheckCircle2 className="size-2.5" />
                    Ack
                  </button>
                </div>
                {alert.supportingEvidence.length > 0 && (
                  <div className="mt-1 text-[9px] font-mono opacity-70">
                    Evidence: {alert.supportingEvidence.slice(0, 2).join("; ")}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* History */}
      {showHistory && (
        <div className="space-y-1">
          {filteredAlerts.length === 0 && (
            <div className="text-center py-4 text-[10px] text-muted-foreground font-mono">
              No alerts matching filters
            </div>
          )}
          {filteredAlerts.slice(0, 50).map((alert) => (
            <div
              key={alert.eventId}
              className={`flex items-center gap-2 rounded border border-border/30 px-2 py-1.5 text-[9px] font-mono ${
                alert.acknowledged ? "opacity-50" : ""
              }`}
            >
              <Clock className="size-2.5 text-muted-foreground" />
              <span className="text-muted-foreground w-14 shrink-0">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </span>
              <span className="font-semibold min-w-[50px]">{alert.instrument}</span>
              <span className={`${getSeverityText(alert.severity)} font-bold`}>{alert.severity}</span>
              <span className="flex-1 truncate opacity-70">{alert.suggestedAction || alert.action}</span>
              {!alert.acknowledged && (
                <button
                  onClick={() => onAcknowledge(alert.eventId)}
                  className="text-[8px] text-muted-foreground hover:text-foreground"
                >
                  ack
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
