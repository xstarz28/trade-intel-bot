import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AnalysisResult } from "@/types/analysis";
import { cn, getTimeAgo } from "@/lib/utils";
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
  Bullish: "text-emerald-400",
  Bearish: "text-red-400",
  Neutral: "text-muted-foreground",
} as const;



export function AnalysisHistory({ analyses, onSelect, selectedId }: AnalysisHistoryProps) {
  if (analyses.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted/30 mb-3">
            <History className="size-5 text-muted-foreground/50" />
          </div>
          <p className="text-xs font-mono font-medium text-muted-foreground">no history yet</p>
          <p className="text-[11px] text-muted-foreground/50 mt-1 font-mono">
            run an analysis to see results here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <History className="size-3.5 text-muted-foreground" />
          <CardTitle className="text-[11px] font-mono font-semibold text-muted-foreground">$ history</CardTitle>
          <Badge variant="outline" className="text-[10px] font-mono ml-auto border-border/50">
            {analyses.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-1">
            {analyses.map((a) => {
              const BiasIcon = BIAS_ICONS[a.bias];
              const isSelected = a.id === selectedId;
              return (
                <button
                  key={a.id}
                  onClick={() => onSelect(a)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-all",
                    isSelected
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted/30 border border-transparent"
                  )}
                >
                  <BiasIcon className={cn("size-3.5 shrink-0", BIAS_COLORS[a.bias])} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-semibold">{a.instrument}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{a.timeframe}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn("text-[11px] font-mono font-medium", BIAS_COLORS[a.bias])}>
                        {a.bias.toLowerCase()}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {a.confidence}%
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
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
