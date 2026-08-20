import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import type { AnalysisResult as AnalysisResultType } from "@/types/analysis";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Shield,
  AlertTriangle,
  Clock,
  FileText,
  CheckCircle2,
  Info,
} from "lucide-react";

const BIAS_CONFIG = {
  Bullish: {
    icon: TrendingUp,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  Bearish: {
    icon: TrendingDown,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    badge: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
  Neutral: {
    icon: Minus,
    color: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
    badge: "bg-muted text-muted-foreground",
  },
} as const;

const COMPLETENESS_CONFIG = {
  full: { label: "Full Data", color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  partial: { label: "Partial Data", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400", icon: Info },
  limited: { label: "Limited Data", color: "bg-red-500/15 text-red-600 dark:text-red-400", icon: AlertTriangle },
} as const;

interface AnalysisResultProps {
  result: AnalysisResultType;
}

export function AnalysisResultDisplay({ result }: AnalysisResultProps) {
  const biasConfig = BIAS_CONFIG[result.bias];
  const BiasIcon = biasConfig.icon;
  const completenessConfig = COMPLETENESS_CONFIG[result.dataCompleteness];
  const CompletenessIcon = completenessConfig.icon;

  const timeAgo = getTimeAgo(result.timestamp);

  return (
    <div className="space-y-4">
      {/* Header Card — Bias + Confidence */}
      <Card className={cn("border", biasConfig.border, "overflow-hidden")}>
        <div className={cn("px-5 py-4", biasConfig.bg)}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn("flex size-10 items-center justify-center rounded-xl", biasConfig.bg, "border", biasConfig.border)}>
                <BiasIcon className={cn("size-5", biasConfig.color)} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold tracking-tight">{result.instrument}</h3>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {result.timeframe}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn("text-sm font-semibold", biasConfig.color)}>
                    {result.bias}
                  </span>
                  <span className="text-xs text-muted-foreground">Bias</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tracking-tight tabular-nums">
                {result.confidence}
                <span className="text-sm font-medium text-muted-foreground">%</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Confidence</p>
            </div>
          </div>

          {/* Meta info row */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="size-3" />
              {timeAgo}
            </div>
            <Badge className={cn("text-[10px] font-medium", completenessConfig.color)}>
              <CompletenessIcon className="size-3 mr-1" />
              {completenessConfig.label}
            </Badge>
          </div>
        </div>
      </Card>

      {/* Data Flags — if any */}
      {result.dataFlags.length > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">
                  Data Gaps
                </p>
                <ul className="space-y-0.5">
                  {result.dataFlags.map((flag, i) => (
                    <li key={i} className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                      • {flag}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Technical Summary */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
              <FileText className="size-3.5 text-primary" />
            </div>
            <h4 className="text-sm font-semibold">📊 Technical Summary</h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm leading-relaxed text-muted-foreground">{result.technicalSummary}</p>
        </CardContent>
      </Card>

      {/* Fundamental Summary */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-blue-500/10">
              <FileText className="size-3.5 text-blue-500" />
            </div>
            <h4 className="text-sm font-semibold">📰 Fundamental Summary</h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm leading-relaxed text-muted-foreground">{result.fundamentalSummary}</p>
        </CardContent>
      </Card>

      {/* Score Breakdown */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-violet-500/10">
              <span className="text-sm">⚖️</span>
            </div>
            <h4 className="text-sm font-semibold">Score Breakdown</h4>
            <Badge variant="outline" className="text-[10px] font-mono ml-auto">
              {result.breakdown.trend > 0 ? "+" : ""}{result.breakdown.trend} |{" "}
              {result.breakdown.indicator > 0 ? "+" : ""}{result.breakdown.indicator} |{" "}
              {result.breakdown.fundamental > 0 ? "+" : ""}{result.breakdown.fundamental} |{" "}
              {result.breakdown.sentiment > 0 ? "+" : ""}{result.breakdown.sentiment}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <ScoreBreakdown breakdown={result.breakdown} />
        </CardContent>
      </Card>

      {/* Key Levels */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10">
              <Target className="size-3.5 text-emerald-500" />
            </div>
            <h4 className="text-sm font-semibold">🎯 Key Levels</h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
              <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                Support
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.support}</p>
            </div>
            <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2.5">
              <p className="text-[10px] font-medium text-red-600 dark:text-red-400 uppercase tracking-wider mb-1">
                Resistance
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.resistance}</p>
            </div>
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2.5">
              <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1">
                Invalidation
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.invalidation}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Note */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-amber-500/10">
              <Shield className="size-3.5 text-amber-500" />
            </div>
            <h4 className="text-sm font-semibold">⚠️ Risk Note</h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm leading-relaxed text-amber-800/80 dark:text-amber-200/80">
            {result.riskNote}
          </p>
          <Separator className="my-3 bg-amber-500/10" />
          <p className="text-[11px] text-amber-700/60 dark:text-amber-300/60 italic">
            This analysis is a decision-support tool only. It is NOT licensed financial advice.
            Always use proper risk management and verify independently before taking any action.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
