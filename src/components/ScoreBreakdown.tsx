import type { BiasBreakdown, FactorScore } from "@/types/analysis";
import { cn } from "@/lib/utils";

const FACTORS = [
  { key: "trend" as const, label: "Structure & Trend", weight: "30%", icon: "📈" },
  { key: "indicator" as const, label: "Indicator Confirmation", weight: "25%", icon: "📊" },
  { key: "fundamental" as const, label: "Fundamentals", weight: "25%", icon: "📰" },
  { key: "sentiment" as const, label: "Sentiment & Positioning", weight: "20%", icon: "⚖️" },
] as const;

const SCORE_LABELS: Record<FactorScore, string> = {
  "-2": "Very Bearish",
  "-1": "Bearish",
  "0": "Neutral",
  "1": "Bullish",
  "2": "Very Bullish",
};

const SCORE_COLORS: Record<FactorScore, string> = {
  "-2": "text-red-500 bg-red-500/10",
  "-1": "text-red-400 bg-red-400/10",
  "0": "text-muted-foreground bg-muted",
  "1": "text-emerald-400 bg-emerald-400/10",
  "2": "text-emerald-500 bg-emerald-500/10",
};

function ScoreBar({ score }: { score: FactorScore }) {
  // Map -2..+2 to 0..100 for the bar fill
  const pct = ((score + 2) / 4) * 100;
  const barColor =
    score > 0
      ? "bg-emerald-500"
      : score < 0
        ? "bg-red-500"
        : "bg-muted-foreground/40";

  return (
    <div className="relative h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
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
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {FACTORS.map(({ key, label, weight, icon }) => {
        const score = breakdown[key] as FactorScore;
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">{icon}</span>
                <span className={cn("font-medium", compact ? "text-xs" : "text-sm")}>{label}</span>
                <span className="text-[10px] text-muted-foreground font-medium">({weight})</span>
              </div>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
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
