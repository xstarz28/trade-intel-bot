import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { ProtectionAlert } from "../lib/position-protection/types";

/**
 * Phase 67 — Position Protection Detail
 *
 * Chronological protection timeline for a single position.
 *
 * Shows:
 * - POSITION REGISTERED
 * - MARKET UPDATE
 * - PROFIT INCREASE
 * - PEAK PROFIT
 * - GIVEBACK
 * - MOMENTUM CHANGE
 * - STRUCTURE CHANGE
 * - ALERT
 * - ESCALATION
 * - ACKNOWLEDGEMENT
 * - RECOVERY
 *
 * Each event contains:
 * - timestamp
 * - event type
 * - severity/priority if applicable
 * - concise factual explanation
 * - source
 * - freshness
 *
 * No fabricated timestamps or events.
 */

export interface TimelineEvent {
  timestamp: number;
  eventType: string;
  severity?: string;
  priority?: string;
  explanation: string;
  source?: string;
  freshness?: "FRESH" | "STALE" | "UNAVAILABLE";
}

export interface ProtectionReference {
  entryPrice: number;
  currentPrice: number;
  peakPrice: number;
  protectionRef: number;
  sl?: number;
  tp?: number;
  side: "LONG" | "SHORT";
}

interface PositionProtectionDetailProps {
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  timeline: TimelineEvent[];
  protectionRef: ProtectionReference | null;
  alerts: ProtectionAlert[];
  onAcknowledgeAlert?: (alertId: string) => void;
  onRemovePosition?: () => void;
  onPausePosition?: () => void;
  onResumePosition?: () => void;
  isPaused?: boolean;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function getEventIcon(eventType: string): string {
  if (eventType.includes("REGISTERED")) return "📋";
  if (eventType.includes("MARKET_UPDATE")) return "📊";
  if (eventType.includes("PROFIT_INCREASE")) return "📈";
  if (eventType.includes("PEAK")) return "🏔️";
  if (eventType.includes("GIVEBACK")) return "📉";
  if (eventType.includes("MOMENTUM")) return "⚡";
  if (eventType.includes("STRUCTURE")) return "🏗️";
  if (eventType.includes("ALERT") || eventType.includes("ESCALATION"))
    return "🚨";
  if (eventType.includes("ACKNOWLEDGE")) return "✅";
  if (eventType.includes("RECOVERY")) return "🔄";
  return "📌";
}

function getEventColor(eventType: string): string {
  if (eventType.includes("ALERT") || eventType.includes("ESCALATION"))
    return "border-red-500/50 bg-red-950/20";
  if (eventType.includes("RECOVERY"))
    return "border-emerald-500/50 bg-emerald-950/20";
  if (eventType.includes("GIVEBACK"))
    return "border-amber-500/50 bg-amber-950/20";
  if (eventType.includes("PROFIT_INCREASE") || eventType.includes("PEAK"))
    return "border-emerald-500/30 bg-emerald-950/10";
  return "border-zinc-700/50 bg-zinc-800/30";
}

function getSeverityColor(severity?: string): string {
  switch (severity) {
    case "INVALIDATED":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "HIGH_RISK":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "CAUTION":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "WATCH":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    default:
      return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  }
}

function calculateProfitDisplay(ref: ProtectionReference): {
  profit: number;
  profitPct: number;
  rMultiple: number | null;
  atPeak: boolean;
} {
  const isLong = ref.side === "LONG";
  const profit = isLong
    ? ref.currentPrice - ref.entryPrice
    : ref.entryPrice - ref.currentPrice;
  const profitPct =
    ref.entryPrice !== 0
      ? Math.abs(profit) / ref.entryPrice
      : 0;

  let rMultiple: number | null = null;
  if (ref.sl !== undefined) {
    const risk = Math.abs(ref.entryPrice - ref.sl);
    if (risk > 0) {
      rMultiple = profit / risk;
    }
  }

  const atPeak = ref.currentPrice === ref.peakPrice;

  return { profit, profitPct, rMultiple, atPeak };
}

export function PositionProtectionDetail({
  instrument,
  side,
  timeline,
  protectionRef,
  alerts,
  onAcknowledgeAlert,
  onRemovePosition,
  onPausePosition,
  onResumePosition,
  isPaused = false,
}: PositionProtectionDetailProps) {
  const sortedTimeline = useMemo(
    () => [...timeline].sort((a, b) => b.timestamp - a.timestamp),
    [timeline]
  );

  const latestAlert = useMemo(
    () =>
      alerts.length > 0
        ? alerts.reduce((latest, a) =>
            a.timestamp > latest.timestamp ? a : latest
          )
        : null,
    [alerts]
  );

  const profitDisplay = useMemo(
    () => (protectionRef ? calculateProfitDisplay(protectionRef) : null),
    [protectionRef]
  );

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-zinc-200">
            {instrument} — {side}
            {isPaused && (
              <Badge
                variant="outline"
                className="ml-2 text-xs bg-zinc-700/50 text-zinc-400"
              >
                PAUSED
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {onPausePosition && !isPaused && (
              <Button
                variant="outline"
                size="sm"
                onClick={onPausePosition}
                className="text-xs h-7"
              >
                ⏸ Pause
              </Button>
            )}
            {onResumePosition && isPaused && (
              <Button
                variant="outline"
                size="sm"
                onClick={onResumePosition}
                className="text-xs h-7"
              >
                ▶ Resume
              </Button>
            )}
            {onRemovePosition && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRemovePosition}
                className="text-xs h-7 text-red-400 border-red-800/50 hover:bg-red-950/30"
              >
                ✕ Remove
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Profit Protection Visualization */}
        {protectionRef && (
          <div className="p-3 rounded bg-zinc-800/50 border border-zinc-700/50 space-y-2">
            <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
              Protection Reference
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Entry:</span>
                <span className="text-zinc-300">
                  {protectionRef.entryPrice.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Current:</span>
                <span className="text-zinc-300">
                  {protectionRef.currentPrice.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Peak:</span>
                <span className="text-emerald-400">
                  {protectionRef.peakPrice.toLocaleString()}
                  {profitDisplay?.atPeak ? " (current)" : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Protection Ref:</span>
                <span className="text-amber-400">
                  {protectionRef.protectionRef.toLocaleString()}
                </span>
              </div>
              {protectionRef.sl !== undefined && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Stop Loss:</span>
                  <span className="text-red-400">
                    {protectionRef.sl.toLocaleString()}
                  </span>
                </div>
              )}
              {protectionRef.tp !== undefined && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Take Profit:</span>
                  <span className="text-emerald-400">
                    {protectionRef.tp.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
            {/* Visual Bar */}
            {protectionRef.sl !== undefined && protectionRef.tp !== undefined && (
              <div className="relative h-2 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-red-600/50"
                  style={{
                    width: `${
                      ((protectionRef.entryPrice - protectionRef.sl) /
                        (protectionRef.tp - protectionRef.sl)) *
                      100
                    }%`,
                  }}
                />
                <div
                  className="absolute inset-y-0 left-0 bg-emerald-500/70"
                  style={{
                    width: `${
                      ((protectionRef.currentPrice - protectionRef.sl) /
                        (protectionRef.tp - protectionRef.sl)) *
                      100
                    }%`,
                  }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-1 h-3 bg-amber-400 rounded"
                  style={{
                    left: `${
                      ((protectionRef.protectionRef - protectionRef.sl) /
                        (protectionRef.tp - protectionRef.sl)) *
                      100
                    }%`,
                  }}
                />
              </div>
            )}
            {profitDisplay && (
              <div className="flex gap-4 text-xs">
                <span
                  className={
                    profitDisplay.profit >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                >
                  {profitDisplay.profit >= 0 ? "+" : ""}
                  {profitDisplay.profit.toFixed(2)} ({(profitDisplay.profitPct * 100).toFixed(1)}%)
                </span>
                {profitDisplay.rMultiple !== null && (
                  <span className="text-zinc-400">
                    {profitDisplay.rMultiple >= 0 ? "+" : ""}
                    {profitDisplay.rMultiple.toFixed(2)}R
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Latest Alert "Why TP Now?" */}
        {latestAlert && latestAlert.whyTpNow && (
          <div className="p-3 rounded bg-red-950/20 border border-red-800/30 space-y-2">
            <div className="text-[10px] font-medium text-red-300 uppercase tracking-wider">
              ⚠ Why Protection Recommended
            </div>
            <div className="space-y-1 text-xs text-zinc-300">
              {latestAlert.whyTpNow.profitStatus && (
                <div>
                  <span className="text-zinc-500">Profit: </span>
                  {latestAlert.whyTpNow.profitStatus}
                </div>
              )}
              {latestAlert.whyTpNow.whatChanged &&
                latestAlert.whyTpNow.whatChanged.length > 0 && (
                  <div>
                    <span className="text-zinc-500">Changed: </span>
                    {latestAlert.whyTpNow.whatChanged.join("; ")}
                  </div>
                )}
              {latestAlert.whyTpNow.confirmations && latestAlert.whyTpNow.confirmations.length > 0 && (
                <div>
                  <span className="text-zinc-500">Confirmations: </span>
                  {latestAlert.whyTpNow.confirmations.length} independent signal{latestAlert.whyTpNow.confirmations.length !== 1 ? "s" : ""}
                </div>
              )}
              {latestAlert.whyTpNow.stillSupporting &&
                latestAlert.whyTpNow.stillSupporting.length > 0 && (
                  <div>
                    <span className="text-zinc-500">Still supporting: </span>
                    {latestAlert.whyTpNow.stillSupporting.join("; ")}
                  </div>
                )}
              {latestAlert.whyTpNow.missingEvidence &&
                latestAlert.whyTpNow.missingEvidence.length > 0 && (
                  <div>
                    <span className="text-zinc-500">Missing: </span>
                    {latestAlert.whyTpNow.missingEvidence.join("; ")}
                  </div>
                )}
              {latestAlert.whyTpNow.suggestedAction && (
                <div className="mt-1 p-2 rounded bg-amber-950/30 border border-amber-800/30 text-amber-300 font-medium">
                  {latestAlert.whyTpNow.suggestedAction}
                </div>
              )}
              {latestAlert.whyTpNow.disclaimer && (
                <div className="text-[10px] text-zinc-500 italic mt-1">
                  {latestAlert.whyTpNow.disclaimer}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
            Protection Timeline ({sortedTimeline.length} events)
          </div>
          {sortedTimeline.length === 0 && (
            <div className="text-xs text-zinc-500 text-center py-2">
              No events recorded yet
            </div>
          )}
          {sortedTimeline.map((event, idx) => (
            <div
              key={`${event.timestamp}-${idx}`}
              className={`p-2 rounded border ${getEventColor(
                event.eventType
              )} flex items-start gap-2`}
            >
              <span className="text-sm shrink-0">
                {getEventIcon(event.eventType)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-200">
                    {event.eventType}
                  </span>
                  {event.severity && (
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${getSeverityColor(
                        event.severity
                      )}`}
                    >
                      {event.severity}
                    </Badge>
                  )}
                  {event.freshness && event.freshness !== "FRESH" && (
                    <Badge
                      variant="outline"
                      className="text-[9px] bg-zinc-700/50 text-zinc-400"
                    >
                      {event.freshness}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {event.explanation}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-zinc-500">
                  <span>{formatTimestamp(event.timestamp)}</span>
                  {event.source && <span>• {event.source}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Alert History */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
              Alert History ({alerts.length})
            </div>
            {alerts.map((alert) => (
              <div
                key={`${alert.instrument}-${alert.timestamp}-${alert.severity}`}
                className="p-2 rounded bg-zinc-800/50 border border-zinc-700/50"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${getSeverityColor(
                        alert.severity
                      )}`}
                    >
                      {alert.severity}
                    </Badge>
                    {alert.urgency && alert.urgency !== "NONE" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-purple-900/30 text-purple-300"
                      >
                        {alert.urgency}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-zinc-500">
                      {formatTimestamp(alert.timestamp)}
                    </span>
                    {onAcknowledgeAlert && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onAcknowledgeAlert(`${alert.instrument}-${alert.timestamp}`)}
                        className="text-[9px] h-5 px-2"
                      >
                        Ack
                      </Button>
                    )}
                  </div>
                </div>
                {alert.actionRecommendation && (
                  <p className="text-[11px] text-zinc-400 mt-1">
                    {alert.actionRecommendation}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
