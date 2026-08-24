import type { BiasBreakdown, FactorScore } from "@/types/analysis";
import { cn } from "@/lib/utils";

/**
 * Phase 19 — labels match the CURRENT engine weights (Phase 8 P6):
 *   trend (structure): 45%  ·  fundamental: 30%  ·  sentiment: 25%
 * Indicators (RSI/MACD) are NOT part of the bias calculation — they only
 * contribute a ±3 conviction modifier. Displayed for context only.
 */
const FACTORS = [
  { key: "trend" as const, label: "structure", weight: "45%", core: true },
  { key: "indicator" as const, label: "indicators", weight: "display only", core: false },
  { key: "fundamental" as const, label: "fundamentals", weight: "30%", core: true },
  { key: "sentiment" as const, label: "sentiment", weight: "25%", core: true },
] as const;

const SCORE_LABELS: Record<FactorScore, string> = {
  "-2": "very bearish",
  "-1": "bearish",
  "0": "neutral",
  "1": "bullish",
  "2": "very bullish",
};

const SCORE_COLORS: Record<FactorScore, string> = {
  "-2": "text-red-400 bg-red-500/10",
  "-1": "text-red-400/70 bg-red-500/5",
  "0": "text-muted-foreground bg-muted/30",
  "1": "text-emerald-400/70 bg-emerald-500/5",
  "2": "text-emerald-400 bg-emerald-500/10",
};

function ScoreBar({ score }: { score: FactorScore }) {
  const pct = ((score + 2) / 4) * 100;
  const barColor =
    score > 0
      ? "bg-emerald-500"
      : score < 0
        ? "bg-red-500"
        : "bg-muted-foreground/30";

  return (
    <div className="relative h-1 w-full rounded-full bg-muted/30 overflow-hidden">
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500", barColor)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

interface ScoreBreakdownProps {
  breakdown: BiasBreakdown;
  compact?: boolean;
}

export function ScoreBreakdown({ breakdown, compact = false }: ScoreBreakdownProps) {
  return (
    <div className={cn("space-y-2.5", compact && "space-y-2")}>
      {FACTORS.map(({ key, label, weight }) => {
        const score = breakdown[key] as FactorScore;
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-mono font-medium", compact ? "text-[11px]" : "text-xs")}>
                  {label}
                </span>
                <span className={cn(
                  "text-[10px] font-mono",
                  (FACTORS.find(f => f.key === key) ?? { core: true }).core
                    ? "text-muted-foreground/50"
                    : "text-muted-foreground/30 italic"
                )}>({weight})</span>
              </div>
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-mono font-medium",
                  SCORE_COLORS[score]
                )}
              >
                {score > 0 ? "+" : ""}{score} · {SCORE_LABELS[score]}
              </span>
            </div>
            <ScoreBar score={score} />
          </div>
        );
      })}
    </div>
  );
}
