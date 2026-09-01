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
  Globe,
  Shield,
  AlertTriangle,
  CheckCircle,
  Eye,
  BarChart3,
  Activity,
  Layers,
} from "lucide-react";
import {
  type PortfolioIntelligence,
  type PortfolioExposure,
  type PortfolioWatchItem,
} from "@/lib/position-protection/portfolio-intelligence";
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

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-400 bg-red-500/10",
  HIGH: "text-orange-400 bg-orange-500/10",
  MEDIUM: "text-amber-400 bg-amber-500/10",
  LOW: "text-muted-foreground bg-muted/30",
};

const EXPOSURE_COLORS: Record<string, string> = {
  LARGE: "text-red-400",
  MODERATE: "text-amber-400",
  SMALL: "text-emerald-400",
  MINIMAL: "text-muted-foreground",
};

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO HEALTH PANEL
// ═══════════════════════════════════════════════════════════════

function PortfolioHealthPanel({ portfolio }: { portfolio: PortfolioIntelligence }) {
  const { summary, exposure } = portfolio;

  return (
    <div className="space-y-3">
      <Section title="PORTFOLIO HEALTH" icon={<Briefcase className="size-3" />}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="text-center">
            <div className={`text-lg font-bold font-mono ${HEALTH_COLORS[summary.dominantPortfolioState] ?? "text-muted-foreground"}`}>
              {summary.totalPositions}
            </div>
            <div className="text-[8px] text-muted-foreground font-mono">Positions</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold font-mono text-emerald-400">
              {summary.healthyPositions}
            </div>
            <div className="text-[8px] text-muted-foreground font-mono">Healthy</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold font-mono text-amber-400">
              {summary.cautionPositions + summary.deterioratingPositions}
            </div>
            <div className="text-[8px] text-muted-foreground font-mono">At Risk</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold font-mono text-red-400">
              {summary.invalidatedPositions}
            </div>
            <div className="text-[8px] text-muted-foreground font-mono">Invalidated</div>
          </div>
        </div>
        <div className="mt-2 text-center">
          <span className={`text-[10px] font-mono font-semibold ${HEALTH_COLORS[summary.dominantPortfolioState] ?? "text-muted-foreground"}`}>
            {summary.dominantPortfolioState.replace(/_/g, " ")}
          </span>
          <span className="text-[8px] text-muted-foreground font-mono ml-2">
            · {summary.portfolioEvidenceQuality}
          </span>
        </div>
      </Section>

      {/* Position Exposure */}
      {exposure.length > 0 && (
        <Section title="POSITIONS" icon={<Layers className="size-3" />}>
          <div className="space-y-1.5">
            {exposure.map((pos: PortfolioExposure) => (
              <div
                key={pos.instrument}
                className="flex items-center gap-2 p-2 rounded border border-border/30 hover:bg-muted/50 text-[9px] font-mono transition-colors"
              >
                <span className="w-16 shrink-0 font-semibold text-foreground">{pos.instrument}</span>
                <span className={`px-1.5 py-0.5 rounded text-[8px] ${pos.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                  {pos.side}
                </span>
                <span className={HEALTH_COLORS[pos.thesisState] ?? "text-muted-foreground"}>
                  {pos.thesisState.replace(/_/g, " ")}
                </span>
                <span className={`ml-auto ${EXPOSURE_COLORS[pos.exposureCategory] ?? "text-muted-foreground"}`}>
                  {pos.exposureCategory}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ALIGNMENT & CONFLICTS PANEL
// ═══════════════════════════════════════════════════════════════

function AlignmentPanel({ portfolio }: { portfolio: PortfolioIntelligence }) {
  const { alignments, conflicts } = portfolio;

  if (alignments.length === 0 && conflicts.length === 0) return null;

  return (
    <div className="space-y-3">
      {alignments.length > 0 && (
        <Section title="THESIS ALIGNMENT" icon={<CheckCircle className="size-3" />}>
          <div className="space-y-1.5">
            {alignments.map((a, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[8px] font-mono">
                <CheckCircle className="size-3 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-emerald-400">{a.instruments.join(" ↔ ")}</span>
                  <span className="text-muted-foreground ml-1">— {a.description}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {conflicts.length > 0 && (
        <Section title="POSITION CONFLICTS" icon={<AlertTriangle className="size-3" />}>
          <div className="space-y-1.5">
            {conflicts.map((c, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[8px] font-mono">
                <AlertTriangle className="size-3 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-amber-400">{c.positionA} ↔ {c.positionB}</span>
                  <span className="text-muted-foreground ml-1">— {c.description}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MACRO CONTEXT PANEL
// ═══════════════════════════════════════════════════════════════

function MacroContextPanel({ portfolio }: { portfolio: PortfolioIntelligence }) {
  const { dataAvailability } = portfolio;

  const dims = [
    { label: "Technical", state: dataAvailability.technical },
    { label: "Macro", state: dataAvailability.macro },
    { label: "Fundamentals", state: dataAvailability.fundamentals },
    { label: "News", state: dataAvailability.news },
    { label: "Derivatives", state: dataAvailability.derivatives },
  ];

  return (
    <Section title="DATA COVERAGE" icon={<Globe className="size-3" />}>
      <div className="grid grid-cols-5 gap-1.5">
        {dims.map((d) => (
          <div key={d.label} className="text-center p-1.5 rounded bg-muted/30">
            <div className={`text-[8px] font-mono font-semibold ${
              d.state === "AVAILABLE" ? "text-emerald-400" :
              d.state === "LIMITED" ? "text-amber-400" :
              "text-muted-foreground"
            }`}>
              {d.state}
            </div>
            <div className="text-[7px] text-muted-foreground font-mono mt-0.5">{d.label}</div>
          </div>
        ))}
      </div>
      {portfolio.marketContext && (
        <p className="text-[8px] font-mono text-muted-foreground mt-2 leading-relaxed">
          {portfolio.marketContext}
        </p>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════
// WATCH ITEMS PANEL
// ═══════════════════════════════════════════════════════════════

function WatchItemsPanel({ portfolio }: { portfolio: PortfolioIntelligence }) {
  const { watchItems } = portfolio;

  if (watchItems.length === 0) return null;

  return (
    <Section title="WHAT TO MONITOR" icon={<Eye className="size-3" />}>
      <div className="space-y-1">
        {watchItems.map((w: PortfolioWatchItem, i: number) => (
          <div key={i} className="flex items-start gap-1.5 text-[8px] font-mono">
            <span className={`mt-0.5 ${
              w.priority === "CRITICAL" ? "text-red-400" :
              w.priority === "HIGH" ? "text-amber-400" : "text-blue-400"
            }`}>→</span>
            <span className="text-muted-foreground shrink-0 font-semibold w-12">{w.instrument}</span>
            <span className="text-muted-foreground">{w.reason}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════
// RISK CONTEXT PANEL
// ═══════════════════════════════════════════════════════════════

function RiskContextPanel({ portfolio }: { portfolio: PortfolioIntelligence }) {
  const { riskContext } = portfolio;

  const riskColor =
    riskContext === "LOW_CONCERN" ? "text-emerald-400" :
    riskContext === "MIXED" ? "text-amber-400" :
    riskContext === "ELEVATED_CONCERN" ? "text-red-400" :
    "text-muted-foreground";

  return (
    <Section title="RISK CONTEXT" icon={<Shield className="size-3" />}>
      <div className="flex items-center gap-1.5 text-[8px] font-mono">
        <span className="text-muted-foreground">Portfolio risk:</span>
        <span className={`font-semibold ${riskColor}`}>
          {riskContext.replace(/_/g, " ")}
        </span>
      </div>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN INVESTOR WORKSPACE
// ═══════════════════════════════════════════════════════════════

export function InvestorWorkspace() {
  // Fetch positions from Convex
  const { positions: registeredPositions } = usePositionProtection();

  // Build portfolio intelligence from raw registered positions
  const portfolio = useMemo(() => {
    // Convert registered positions to the minimal shape PortfolioIntelligence needs
    // by constructing lightweight PositionIntelligence-like objects
    if (registeredPositions.length === 0) return null;

    // We need PositionIntelligence[] for generatePortfolioIntelligence
    // But PositionIntelligence requires complex computation.
    // Instead, build a minimal portfolio summary directly.
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
                {portfolio.positions.map((pos) => {
                  const pnlPct = pos.entryPrice > 0
                    ? ((pos.entryPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === "LONG" ? 1 : -1)
                    : 0;

                  return (
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
                  );
                })}
              </div>
            </Section>
          </div>

          {/* Right: Risk + Context + Watch */}
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
                {["SCALPING", "INTRADAY", "SWING", "INVESTING"].map((h) => {
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
