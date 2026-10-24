/**
 * Phase 56 — Analytical Context Panel
 *
 * Displays the analytical context from Phase 55-56 intelligence engines.
 * INFORMATIONAL_ONLY — never modifies decision logic.
 */
import React, { useState } from "react";
import {
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Shield,
  BarChart3,
  Activity,
  Globe,
  Calendar,
  Landmark,
  Droplets,
} from "lucide-react";
import type {
  UniversalAnalyticalContext,
  AnalyticalDimension,
  IndexAnalyticalDepth,
  MacroAnalyticalDepth,
} from "@/lib/data/universal/analytical-context";

// ═══════════════════════════════════════════════════════════════
// SECTIONS
// ═══════════════════════════════════════════════════════════════

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, icon, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-mono font-semibold text-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {icon}
        <span>{title}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs font-mono text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DIMENSION ROW
// ═══════════════════════════════════════════════════════════════

function DimensionRow({ dim }: { dim: AnalyticalDimension }) {
  const qualityColor =
    dim.quality === "VERIFIED"
      ? "text-emerald-400"
      : dim.quality === "DEGRADED"
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="flex items-start gap-2 py-1 border-b border-border/20 last:border-0">
      <span className="text-muted-foreground shrink-0 w-24">{dim.name}</span>
      <span className="text-foreground flex-1">{dim.explanation}</span>
      <span className={`shrink-0 text-[10px] ${qualityColor}`}>{dim.quality}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REGIME DISPLAY
// ═══════════════════════════════════════════════════════════════

function RegimeDisplay({ regime }: { regime?: string }) {
  if (!regime) return <span className="text-muted-foreground">Unknown</span>;
  const color =
    regime === "RISK_ON"
      ? "text-emerald-400"
      : regime === "RISK_OFF"
        ? "text-red-400"
        : regime === "TRENDING"
          ? "text-blue-400"
          : regime === "RANGING"
            ? "text-amber-400"
            : "text-muted-foreground";
  return <span className={`font-semibold ${color}`}>{regime.replace(/_/g, " ")}</span>;
}

// ═══════════════════════════════════════════════════════════════
// INDEX PANEL
// ═══════════════════════════════════════════════════════════════

function IndexPanel({ index }: { index: IndexAnalyticalDepth }) {
  return (
    <>
      {index.marketStructure && (
        <Section title="Market Structure" icon={<BarChart3 className="size-3" />} defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Trend: </span><RegimeDisplay regime={index.marketStructure.trend} /></div>
            <div><span className="text-muted-foreground">Momentum: </span>{index.marketStructure.momentum}</div>
            <div><span className="text-muted-foreground">Volatility: </span>{index.marketStructure.volatilityRegime}</div>
            <div><span className="text-muted-foreground">Mode: </span>{index.marketStructure.rangeExpansion}</div>
          </div>
          <p className="text-foreground">{index.marketStructure.description}</p>
        </Section>
      )}

      {index.volatility && (
        <Section title="Volatility" icon={<Activity className="size-3" />}>
          <p className="text-foreground">{index.volatility.description}</p>
          {index.volatility.vixRelationship && <p className="text-muted-foreground">{index.volatility.vixRelationship}</p>}
        </Section>
      )}

      {index.breadth?.available && (
        <Section title="Breadth" icon={<TrendingUp className="size-3" />}>
          <p className="text-foreground">{index.breadth.description}</p>
          {index.breadth.breadthStrength && <p className="text-muted-foreground">Strength: {index.breadth.breadthStrength}</p>}
        </Section>
      )}

      {index.valuation?.available && (
        <Section title="Valuation" icon={<Shield className="size-3" />}>
          <p className="text-foreground">{index.valuation.description}</p>
          {index.valuation.earningsYield !== undefined && (
            <p className="text-muted-foreground">Earnings yield: {index.valuation.earningsYield.toFixed(2)}%</p>
          )}
        </Section>
      )}

      {index.riskRegime && (
        <Section title="Risk Regime" icon={<Globe className="size-3" />}>
          <RegimeDisplay regime={index.riskRegime} />
        </Section>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// MACRO PANEL
// ═══════════════════════════════════════════════════════════════

function MacroPanel({ macro }: { macro: MacroAnalyticalDepth }) {
  return (
    <>
      {macro.dxyContext && (
        <Section title="DXY" icon={<Droplets className="size-3" />} defaultOpen>
          <p className="text-foreground">{macro.dxyContext.description}</p>
          <div><span className="text-muted-foreground">Trend: </span><RegimeDisplay regime={macro.dxyContext.trend} /></div>
        </Section>
      )}

      {macro.yieldCurve?.available && (
        <Section title="Yield Curve" icon={<TrendingUp className="size-3" />}>
          <p className="text-foreground">{macro.yieldCurve.description}</p>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Shape: </span>{macro.yieldCurve.shape}</div>
            {macro.yieldCurve.spread !== undefined && (
              <div><span className="text-muted-foreground">Spread: </span>{macro.yieldCurve.spread.toFixed(2)}%</div>
            )}
          </div>
        </Section>
      )}

      {macro.realYield?.available && (
        <Section title="Real Yields" icon={<Landmark className="size-3" />}>
          <p className="text-foreground">{macro.realYield.description}</p>
        </Section>
      )}

      {macro.centralBank?.available && (
        <Section title="Central Banks" icon={<Landmark className="size-3" />}>
          <p className="text-foreground">{macro.centralBank.description}</p>
        </Section>
      )}

      {macro.globalLiquidity?.available && (
        <Section title="Global Liquidity" icon={<Droplets className="size-3" />}>
          <p className="text-foreground">{macro.globalLiquidity.description}</p>
        </Section>
      )}

      {macro.macroEvents?.available && (
        <Section title="Upcoming Events" icon={<Calendar className="size-3" />}>
          <p className="text-foreground">{macro.macroEvents.description}</p>
        </Section>
      )}

      {macro.macroRegime && (
        <Section title="Macro Regime" icon={<Globe className="size-3" />}>
          <RegimeDisplay regime={macro.macroRegime.regime} />
          <p className="text-foreground">{macro.macroRegime.description}</p>
        </Section>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════

export function AnalyticalContextPanel({ context }: { context: UniversalAnalyticalContext }) {
  const [showDimensions, setShowDimensions] = useState(false);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <h3 className="text-sm font-mono font-semibold">Analytical Context</h3>
        <span className="text-[10px] font-mono text-muted-foreground">{context.instrument}</span>
      </div>

      {/* Summary */}
      <p className="text-xs font-mono text-muted-foreground">{context.analystSummary}</p>

      {/* Supporting / Conflicting evidence */}
      {context.supportingEvidence.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-mono font-semibold text-emerald-400">SUPPORTING</span>
          {context.supportingEvidence.slice(0, 5).map((e, i) => (
            <p key={i} className="text-xs font-mono text-foreground pl-2 border-l border-emerald-400/30">
              {e}
            </p>
          ))}
        </div>
      )}

      {context.conflictingEvidence.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-mono font-semibold text-amber-400">CONFLICTING</span>
          {context.conflictingEvidence.slice(0, 3).map((e, i) => (
            <p key={i} className="text-xs font-mono text-foreground pl-2 border-l border-amber-400/30">
              {e}
            </p>
          ))}
        </div>
      )}

      {context.missingInformation.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-mono font-semibold text-red-400">MISSING</span>
          {context.missingInformation.slice(0, 3).map((e, i) => (
            <p key={i} className="text-xs font-mono text-muted-foreground pl-2 border-l border-red-400/30">
              {e}
            </p>
          ))}
        </div>
      )}

      {/* Asset-class specific panels */}
      {context.index && <IndexPanel index={context.index} />}
      {context.macro && <MacroPanel macro={context.macro} />}

      {/* Expandable dimensions */}
      {context.overallDimensions.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            onClick={() => setShowDimensions(!showDimensions)}
          >
            {showDimensions ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {context.overallDimensions.length} analytical dimensions
          </button>
          {showDimensions && (
            <div className="mt-2 space-y-0">
              {context.overallDimensions.map((dim, i) => (
                <DimensionRow key={i} dim={dim} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Data flags */}
      {context.dataFlags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {context.dataFlags.map((flag, i) => (
            <span key={i} className="text-[9px] font-mono bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">
              {flag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
