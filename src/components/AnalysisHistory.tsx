import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AnalysisResult } from "@/types/analysis";
import { cn } from "@/lib/utils";
import { History, TrendingUp, TrendingDown, Minus, Clock } from "lucide-react";

interface AnalysisHistoryProps {
  analyses: AnalysisResult[];
  onSelect: (analysis: AnalysisResult) => void;
  selectedId?: string;
}

const BIAS_ICONS = {
  Bullish: TrendingUp,
  Bearish: TrendingDown,
  Neutral: Minus,
} as const;

const BIAS_COLORS = {
  Bullish: "text-emerald-500",
  Bearish: "text-red-500",
  Neutral: "text-muted-foreground",
} as const;

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

export function AnalysisHistory({ analyses, onSelect, selectedId }: AnalysisHistoryProps) {
  if (analyses.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted mb-3">
            <History className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No analyses yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Your analysis history will appear here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">History</CardTitle>
          <Badge variant="outline" className="text-[10px] ml-auto">
            {analyses.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-1.5">
            {analyses.map((a) => {
              const BiasIcon = BIAS_ICONS[a.bias];
              const isSelected = a.id === selectedId;
              return (
                <button
                  key={a.id}
                  onClick={() => onSelect(a)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                    isSelected
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted/50 border border-transparent"
                  )}
                >
                  <BiasIcon className={cn("size-4 shrink-0", BIAS_COLORS[a.bias])} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold">{a.instrument}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{a.timeframe}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn("text-[11px] font-medium", BIAS_COLORS[a.bias])}>
                        {a.bias}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {a.confidence}%
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                    <Clock className="size-3" />
                    {getTimeAgo(a.timestamp)}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
