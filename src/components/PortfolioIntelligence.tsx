/**
 * Phase 92 — Portfolio Intelligence Dashboard Component
 *
 * Displays portfolio-level intelligence aggregating all registered positions.
 */

import React, { useMemo } from "react";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  Link,
  Unlink,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { generatePortfolioIntelligence, type PortfolioIntelligence } from "@/lib/position-protection/portfolio-intelligence";
import type { PositionIntelligence } from "@/lib/position-protection/market-intelligence-analyzer";

// ═══════════════════════════════════════════════════════════════
// STATE COLOR MAPPING
// ═══════════════════════════════════════════════════════════════

const STATE_COLORS: Record<string, string> = {
  HEALTHY: "text-emerald-400 bg-emerald-500/10",
  STABLE: "text-emerald-400 bg-emerald-500/10",
  CAUTION: "text-amber-400 bg-amber-500/10",
  DETERIORATING: "text-orange-400 bg-orange-500/10",
  SEVERELY_DETERIORATING: "text-red-400 bg-red-500/10",
  INVALIDATED: "text-red-400 bg-red-500/10",
  INSUFFICIENT_DATA: "text-muted-foreground bg-muted/30",
  UNKNOWN: "text-muted-foreground bg-muted/30",
};

const RISK_COLORS: Record<string, string> = {
  LOW_CONCERN: "text-emerald-400",
  MIXED: "text-amber-400",
  ELEVATED_CONCERN: "text-red-400",
  INSUFFICIENT_DATA: "text-muted-foreground",
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-400 bg-red-500/10",
  HIGH: "text-orange-400 bg-orange-500/10",
  MEDIUM: "text-amber-400 bg-amber-500/10",
  LOW: "text-muted-foreground bg-muted/30",
};

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════

interface PortfolioIntelligenceProps {
  positions: PositionIntelligence[];
}

export function PortfolioIntelligenceView({ positions }: PortfolioIntelligenceProps) {
  const intel: PortfolioIntelligence | null = useMemo(
    () => positions.length > 0 ? generatePortfolioIntelligence(positions) : null,
    [positions],
  );

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50 mb-3">
          <Shield className="size-5 text-muted-foreground/40" />
        </div>
        <p className="text-xs font-mono text-muted-foreground max-w-xs">
          Register positions to see portfolio-level intelligence.
        </p>
      </div>
    );
  }

  if (!intel) return null;

  return (
    <div className="space-y-3">
      {/* ─── PORTFOLIO SUMMARY ─── */}
      <div className="border border-border/30 rounded-lg p-3">
        <h4 className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
          PORTFOLIO SUMMARY
        </h4>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[10px] font-mono">
          <div className="text-center">
            <div className="text-lg font-bold text-foreground">{intel.summary.totalPositions}</div>
            <div className="text-muted-foreground">positions</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-400">{intel.summary.healthyPositions}</div>
            <div className="text-muted-foreground">healthy</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-amber-400">{intel.summary.cautionPositions}</div>
            <div className="text-muted-foreground">caution</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-orange-400">{intel.summary.deterioratingPositions}</div>
            <div className="text-muted-foreground">deteriorating</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-red-400">{intel.summary.invalidatedPositions}</div>
            <div className="text-muted-foreground">invalidated</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-muted-foreground">{intel.summary.unavailablePositions}</div>
            <div className="text-muted-foreground">no data</div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[9px] font-mono text-muted-foreground">DOMINANT:</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${STATE_COLORS[intel.summary.dominantPortfolioState] ?? ""}`}>
            {intel.summary.dominantPortfolioState.replace(/_/g, " ")}
          </span>
          <span className="text-[9px] font-mono text-muted-foreground">
            Evidence: {intel.summary.portfolioEvidenceQuality.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* ─── MARKET CONTEXT ─── */}
      <div className="border border-border/30 rounded-lg p-3">
        <h4 className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
          MARKET CONTEXT
        </h4>
        <p className="text-[10px] font-mono text-foreground/80 leading-relaxed">
          {intel.marketContext}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[9px] font-mono text-muted-foreground">RISK:</span>
          <span className={`text-[9px] font-mono font-semibold ${RISK_COLORS[intel.riskContext] ?? ""}`}>
            {intel.riskContext.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* ─── ALIGNMENTS ─── */}
      {intel.alignments.length > 0 && (
        <div className="border border-border/30 rounded-lg p-3">
          <h4 className="text-[10px] font-mono font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <Link className="size-3" />
            ALIGNMENTS ({intel.alignments.length})
          </h4>
          <div className="space-y-1.5">
            {intel.alignments.map((a, i) => (
              <div key={i} className="text-[10px] font-mono flex items-start gap-2">
                <span className={`shrink-0 px-1 py-0.5 rounded ${
                  a.strength === "STRONG" ? "text-emerald-400 bg-emerald-500/10" :
                  a.strength === "MODERATE" ? "text-blue-400 bg-blue-500/10" :
                  "text-muted-foreground bg-muted/30"
                }`}>
                  {a.alignmentType.replace(/_/g, " ")}
                </span>
                <span className="text-foreground/80">{a.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── CONFLICTS ─── */}
      {intel.conflicts.length > 0 && (
        <div className="border border-border/30 rounded-lg p-3">
          <h4 className="text-[10px] font-mono font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <Unlink className="size-3" />
            CONFLICTS ({intel.conflicts.length})
          </h4>
          <div className="space-y-1.5">
            {intel.conflicts.map((c, i) => (
              <div key={i} className="text-[10px] font-mono flex items-start gap-2">
                <span className={`shrink-0 px-1 py-0.5 rounded ${
                  c.strength === "STRONG" ? "text-red-400 bg-red-500/10" :
                  c.strength === "MODERATE" ? "text-amber-400 bg-amber-500/10" :
                  "text-muted-foreground bg-muted/30"
                }`}>
                  {c.conflictType.replace(/_/g, " ")}
                </span>
                <span className="text-foreground/80">{c.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── EXPOSURE ─── */}
      <div className="border border-border/30 rounded-lg p-3">
        <h4 className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
          EXPOSURE
        </h4>
        <div className="space-y-1">
          {intel.exposure.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
              <span className="w-20 shrink-0 font-semibold">{e.instrument}</span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded ${
                e.side === "LONG" ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"
              }`}>
                {e.side}
              </span>
              <span className={`px-1.5 py-0.5 rounded ${STATE_COLORS[e.thesisState] ?? ""}`}>
                {e.thesisState.replace(/_/g, " ")}
              </span>
              <span className="text-muted-foreground truncate flex-1">{e.portfolioImpact}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── WATCH NEXT ─── */}
      {intel.watchItems.length > 0 && (
        <div className="border border-border/30 rounded-lg p-3">
          <h4 className="text-[10px] font-mono font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <Eye className="size-3" />
            WATCH NEXT ({intel.watchItems.length})
          </h4>
          <div className="space-y-1.5">
            {intel.watchItems.map((w, i) => (
              <div key={i} className="text-[10px] font-mono flex items-start gap-2">
                <span className={`shrink-0 w-5 text-center font-bold ${
                  PRIORITY_COLORS[w.priority]?.split(" ")[0] ?? ""
                }`}>
                  {i + 1}.
                </span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded ${PRIORITY_COLORS[w.priority] ?? ""}`}>
                  {w.priority}
                </span>
                <span className="text-foreground/80">
                  <span className="font-semibold">{w.instrument}</span> — {w.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── DATA STATUS ─── */}
      <div className="border border-border/30 rounded-lg p-3">
        <h4 className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
          DATA STATUS
        </h4>
        <div className="flex flex-wrap gap-2 text-[9px] font-mono">
          {Object.entries(intel.dataAvailability).map(([key, value]) => (
            <span key={key} className={`px-1.5 py-0.5 rounded ${
              value === "AVAILABLE" ? "text-emerald-400 bg-emerald-500/10" :
              value === "LIMITED" ? "text-amber-400 bg-amber-500/10" :
              "text-muted-foreground bg-muted/30"
            }`}>
              {key}: {value}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
