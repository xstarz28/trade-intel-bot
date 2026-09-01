/**
 * Phase 121 — Investor Workspace
 *
 * Dedicated long-horizon portfolio intelligence view.
 * Complementary to TraderWorkspace (active trading, position-level).
 *
 * Focuses on:
 * - Portfolio-level thesis health across all positions
 * - Macro/inflation context from fundamental data
 * - Investment-grade opportunities (1–3 year emphasis)
 * - Risk attribution and data quality
 *
 * INFORMATIONAL_ONLY — never executes trades.
 */
import React, { useMemo } from "react";
import {
  Briefcase,
  Shield,
  AlertTriangle,
  CheckCircle,
  Eye,
  BarChart3,
  Activity,
  Layers,
} from "lucide-react";
import {
  usePositionProtection,
} from "@/lib/position-protection/use-position-protection";

// ═══════════════════════════════════════════════════════════════
// SECTION COMPONENT
// ═══════════════════════════════════════════════════════════════

function Section({
  title,
  icon,
  children,
  className = "",
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border/50 bg-card/50 p-3 ${className}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <h4 className="text-[10px] font-mono font-semibold text-foreground tracking-wide">
          {title}
        </h4>
      </div>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATE COLORS
// ═══════════════════════════════════════════════════════════════

const HEALTH_COLORS: Record<string, string> = {
  HEALTHY: "text-emerald-400",
  STABLE: "text-emerald-400",
  CAUTION: "text-amber-400",
  DETERIORATING: "text-orange-400",
  SEVERELY_DETERIORATING: "text-red-400",
  INVALIDATED: "text-red-400",
  INSUFFICIENT_DATA: "text-muted-foreground",
  UNKNOWN: "text-muted-foreground",
};

// ═══════════════════════════════════════════════════════════════
// MAIN INVESTOR WORKSPACE
// ═══════════════════════════════════════════════════════════════

export function InvestorWorkspace() {
  // Fetch positions from Convex
  const { positions: registeredPositions } = usePositionProtection();

  // Build portfolio summary from raw registered positions
  const portfolio = useMemo(() => {
    if (registeredPositions.length === 0) return null;

    const total = registeredPositions.length;
    const healthy = registeredPositions.filter(
      (p) => p.alert === null || p.alert?.severity === "NONE" || p.alert?.severity === "WATCH",
    ).length;
    const caution = registeredPositions.filter(
      (p) => p.alert?.severity === "CAUTION",
    ).length;
    const highRisk = registeredPositions.filter(
      (p) => p.alert?.severity === "HIGH_RISK",
    ).length;
    const invalidated = registeredPositions.filter(
      (p) => p.alert?.severity === "INVALIDATED",
    ).length;

    return {
      total,
      healthy,
      caution,
      highRisk,
      invalidated,
      positions: registeredPositions.map((p) => ({
        instrument: p.position.instrument,
        side: p.position.side,
        severity: p.alert?.severity ?? "NONE",
        lifecycle: p.position.lifecycle,
        entryPrice: p.position.entryPrice,
        stopLoss: p.position.stopLoss,
        takeProfit: p.position.takeProfit,
        horizon: p.position.horizon,
        openedAt: p.position.openedAt,
      })),
    };
  }, [registeredPositions]);

  return (
    <div className="space-y-4">
      {/* Investor Header */}
      <div className="flex items-center gap-2 text-[11px] font-mono font-semibold text-foreground">
        <Briefcase className="size-4 text-primary" />
        Investor Workspace
        <span className="text-[8px] text-muted-foreground font-normal ml-2">
          Long-horizon portfolio intelligence · 1–3 year emphasis
        </span>
      </div>

      {portfolio === null ? (
        <Section title="PORTFOLIO" icon={<Briefcase className="size-3" />}>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted/50 mb-3">
              <Briefcase className="size-5 text-muted-foreground/40" />
            </div>
            <h3 className="text-sm font-semibold text-foreground font-mono">
              No Positions Registered
            </h3>
            <p className="mt-1.5 text-[10px] text-muted-foreground max-w-xs font-mono">
              Register positions in the Intelligence tab to populate your portfolio view.
            </p>
          </div>
        </Section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Portfolio Overview */}
          <div className="lg:col-span-5 space-y-3">
            {/* Portfolio Health */}
            <Section title="PORTFOLIO HEALTH" icon={<Briefcase className="size-3" />}>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-foreground">
                    {portfolio.total}
                  </div>
                  <div className="text-[8px] text-muted-foreground font-mono">Positions</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-emerald-400">
                    {portfolio.healthy}
                  </div>
                  <div className="text-[8px] text-muted-foreground font-mono">Healthy</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-amber-400">
                    {portfolio.caution + portfolio.highRisk}
                  </div>
                  <div className="text-[8px] text-muted-foreground font-mono">At Risk</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-red-400">
                    {portfolio.invalidated}
                  </div>
                  <div className="text-[8px] text-muted-foreground font-mono">Invalidated</div>
                </div>
              </div>
            </Section>

            {/* Position List */}
            <Section title="POSITIONS" icon={<Layers className="size-3" />}>
              <div className="space-y-1.5">
                {portfolio.positions.map((pos) => (
                  <div
                    key={pos.instrument}
                    className="flex items-center gap-2 p-2 rounded border border-border/30 hover:bg-muted/50 text-[9px] font-mono transition-colors"
                  >
                    <span className="w-16 shrink-0 font-semibold text-foreground">{pos.instrument}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] ${pos.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                      {pos.side}
                    </span>
                    <span className={`text-[8px] ${HEALTH_COLORS[pos.severity] ?? "text-muted-foreground"}`}>
                      {pos.severity.replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto text-muted-foreground text-[8px]">{pos.horizon}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* Right: Risk + Context */}
          <div className="lg:col-span-7 space-y-3">
            {/* Risk Summary */}
            <Section title="RISK SUMMARY" icon={<Shield className="size-3" />}>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded bg-muted/30">
                  <div className={`text-sm font-bold font-mono ${
                    portfolio.caution + portfolio.highRisk > 0 ? "text-amber-400" : "text-emerald-400"
                  }`}>
                    {portfolio.caution + portfolio.highRisk === 0 ? "LOW" : portfolio.highRisk > 0 ? "ELEVATED" : "MODERATE"}
                  </div>
                  <div className="text-[7px] text-muted-foreground font-mono mt-0.5">Risk Level</div>
                </div>
                <div className="text-center p-2 rounded bg-muted/30">
                  <div className="text-sm font-bold font-mono text-foreground">
                    {portfolio.positions.filter((p) => p.stopLoss).length}/{portfolio.total}
                  </div>
                  <div className="text-[7px] text-muted-foreground font-mono mt-0.5">With SL</div>
                </div>
                <div className="text-center p-2 rounded bg-muted/30">
                  <div className="text-sm font-bold font-mono text-foreground">
                    {portfolio.positions.filter((p) => p.takeProfit).length}/{portfolio.total}
                  </div>
                  <div className="text-[7px] text-muted-foreground font-mono mt-0.5">With TP</div>
                </div>
              </div>
            </Section>

            {/* Horizon Distribution */}
            <Section title="HORIZON DISTRIBUTION" icon={<BarChart3 className="size-3" />}>
              <div className="space-y-1">
                {(["SCALPING", "INTRADAY", "SWING", "INVESTING"] as const).map((h) => {
                  const count = portfolio.positions.filter((p) => p.horizon === h).length;
                  if (count === 0) return null;
                  return (
                    <div key={h} className="flex items-center gap-2 text-[8px] font-mono">
                      <span className="w-16 text-muted-foreground">{h}</span>
                      <div className="flex-1 h-1.5 bg-muted/30 rounded overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded"
                          style={{ width: `${(count / portfolio.total) * 100}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground w-6 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Section>

            {/* Data Quality */}
            <Section title="DATA QUALITY" icon={<Activity className="size-3" />}>
              <div className="flex items-center gap-1.5 text-[8px] font-mono text-muted-foreground">
                <span>Positions registered: {portfolio.total}</span>
                <span>·</span>
                <span>With stop-loss: {portfolio.positions.filter((p) => p.stopLoss).length}</span>
                <span>·</span>
                <span>With take-profit: {portfolio.positions.filter((p) => p.takeProfit).length}</span>
              </div>
            </Section>
          </div>
        </div>
      )}

      {/* Footer disclaimer */}
      <div className="text-[8px] font-mono text-muted-foreground/40 pt-1 border-t border-border/20">
        Investment intelligence · Evidence-based analysis · No execution commands · Manual action required for any trade
      </div>
    </div>
  );
}
