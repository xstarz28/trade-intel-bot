/**
 * Phase 57 — Position Protection Panel
 *
 * Displays profit protection alerts and thesis health monitoring.
 * INFORMATIONAL_ONLY — never modifies trades.
 */
import React, { useState } from "react";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Activity,
  XCircle,
} from "lucide-react";
import type { ProtectionAlert } from "@/lib/position-protection/types";

// ═══════════════════════════════════════════════════════════════
// SEVERITY STYLES
// ═══════════════════════════════════════════════════════════════

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
  NONE: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: <CheckCircle className="size-4" />, label: "HEALTHY" },
  WATCH: { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", icon: <Activity className="size-4" />, label: "WATCH" },
  CAUTION: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: <AlertTriangle className="size-4" />, label: "CAUTION" },
  HIGH_RISK: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", icon: <TrendingDown className="size-4" />, label: "HIGH RISK" },
  INVALIDATED: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", icon: <XCircle className="size-4" />, label: "INVALIDATED" },
};

// ═══════════════════════════════════════════════════════════════
// HEALTH STATE STYLES
// ═══════════════════════════════════════════════════════════════

const HEALTH_COLORS: Record<string, string> = {
  HEALTHY: "text-emerald-400",
  STABLE: "text-blue-400",
  DETERIORATING: "text-amber-400",
  SEVERELY_DETERIORATING: "text-orange-400",
  INVALIDATED: "text-red-400",
  UNKNOWN: "text-muted-foreground",
};

// ═══════════════════════════════════════════════════════════════
// SECTION
// ═══════════════════════════════════════════════════════════════

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button className="flex items-center gap-2 w-full px-3 py-2 text-xs font-mono font-semibold text-foreground hover:bg-muted/50" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span>{title}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2 text-xs font-mono text-muted-foreground">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════

export function PositionProtectionPanel({ alert }: { alert: ProtectionAlert }) {
  const [expanded, setExpanded] = useState(true);
  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.NONE;

  return (
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden`}>
      {/* Header */}
      <button
        className="flex items-center justify-between w-full px-4 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Shield className="size-5 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold">{alert.instrument}</span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {alert.profit.unrealizedPnL >= 0 ? "+" : ""}{alert.profit.rMultiple !== undefined ? `${alert.profit.rMultiple.toFixed(2)}R` : `${alert.profit.distanceFromEntryPct.toFixed(2)}%`}
              </span>
            </div>
            <div className={`flex items-center gap-1.5 text-xs font-mono font-semibold ${cfg.color}`}>
              {cfg.icon}
              {cfg.label}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-muted-foreground">Thesis</div>
          <div className={`text-xs font-mono font-semibold ${HEALTH_COLORS[alert.thesisHealth]}`}>
            {alert.thesisHealth.replace(/_/g, " ")}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Alert message */}
          <div className="text-xs font-mono text-foreground bg-background/50 rounded-lg p-3 border border-border/30">
            {alert.alertMessage}
          </div>

          {/* Action */}
          {alert.severity !== "NONE" && (
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-mono font-semibold text-primary shrink-0">ACTION:</span>
              <span className="text-xs font-mono text-foreground">{alert.actionRecommendation}</span>
            </div>
          )}

          {/* Supporting evidence */}
          {alert.supportingEvidence.length > 0 && (
            <Section title="Supporting Evidence" defaultOpen={alert.severity === "NONE"}>
              {alert.supportingEvidence.map((e, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <CheckCircle className="size-3 text-emerald-400 mt-0.5 shrink-0" />
                  <span className="text-foreground">{e}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Conflicting evidence */}
          {alert.conflictingEvidence.length > 0 && (
            <Section title="Conflicting Evidence" defaultOpen>
              {alert.conflictingEvidence.map((e, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <AlertTriangle className="size-3 text-amber-400 mt-0.5 shrink-0" />
                  <span className="text-foreground">{e}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Missing data */}
          {alert.missingData.length > 0 && (
            <Section title="Missing Critical Data">
              {alert.missingData.map((e, i) => (
                <div key={i} className="text-amber-400/80">• {e}</div>
              ))}
            </Section>
          )}

          {/* Protection reference */}
          {alert.protectionReference !== undefined && (
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-muted-foreground">Protection reference:</span>
              <span className="text-foreground font-semibold">{alert.protectionReference.toFixed(2)}</span>
            </div>
          )}

          {/* Shock state */}
          {alert.shock.state !== "NORMAL" && (
            <div className={`text-xs font-mono px-2 py-1 rounded ${alert.shock.state === "SHOCK" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>
              ⚡ Shock: {alert.shock.description}
            </div>
          )}

          {/* Disclaimer */}
          <div className="text-[9px] font-mono text-muted-foreground/50 pt-2 border-t border-border/20">
            Informational only. This is not financial advice. Does not auto-execute trades. Classification confidence ≠ profit probability.
          </div>
        </div>
      )}
    </div>
  );
}
