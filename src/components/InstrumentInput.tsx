import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  POPULAR_INSTRUMENTS,
  TIMEFRAMES,
  type AnalysisInput,
  type InstrumentType,
  type Timeframe,
} from "@/lib/analysis-engine";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  BarChart3,
  Search,
  ChevronDown,
  ChevronUp,
  Zap,
  AlertCircle,
} from "lucide-react";

interface InstrumentInputProps {
  onAnalyze: (input: AnalysisInput) => void;
  isAnalyzing: boolean;
}

export function InstrumentInput({ onAnalyze, isAnalyzing }: InstrumentInputProps) {
  const [instrument, setInstrument] = useState("");
  const [instrumentType, setInstrumentType] = useState<InstrumentType>("forex");
  const [timeframe, setTimeframe] = useState<Timeframe>("D1");
  const [currentPrice, setCurrentPrice] = useState("");
  const [recentHigh, setRecentHigh] = useState("");
  const [recentLow, setRecentLow] = useState("");
  const [newsContext, setNewsContext] = useState("");
  const [economicEvents, setEconomicEvents] = useState("");
  const [fundingRate, setFundingRate] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleQuickSelect = (symbol: string, type: InstrumentType) => {
    setInstrument(symbol);
    setInstrumentType(type);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instrument.trim()) return;

    onAnalyze({
      instrument: instrument.trim(),
      instrumentType,
      timeframe,
      currentPrice: currentPrice || undefined,
      recentHigh: recentHigh || undefined,
      recentLow: recentLow || undefined,
      newsContext: newsContext || undefined,
      economicEvents: economicEvents || undefined,
      fundingRate: fundingRate || undefined,
    });
  };

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
            <TrendingUp className="size-4.5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">New Analysis</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter an instrument and optional market data
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Quick Picks */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">
              Quick Picks
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR_INSTRUMENTS.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() => handleQuickSelect(item.symbol, item.type)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                    instrument === item.symbol
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  <span>{item.symbol}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Instrument + Type + Timeframe */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Instrument
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="e.g. EUR/USD"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className="pl-8 h-9 text-sm"
                  required
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Type
              </Label>
              <Select
                value={instrumentType}
                onValueChange={(v) => setInstrumentType(v as InstrumentType)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="forex">Forex</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="commodity">Commodity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Timeframe
              </Label>
              <Select
                value={timeframe}
                onValueChange={(v) => setTimeframe(v as Timeframe)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((tf) => (
                    <SelectItem key={tf.value} value={tf.value}>
                      {tf.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Price Data */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Price Data{" "}
              <span className="text-muted-foreground/60">(optional — improves accuracy)</span>
            </Label>
            <div className="grid grid-cols-3 gap-3">
              <Input
                placeholder="Current price"
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
                className="h-9 text-sm"
                type="number"
                step="any"
              />
              <Input
                placeholder="Recent high"
                value={recentHigh}
                onChange={(e) => setRecentHigh(e.target.value)}
                className="h-9 text-sm"
                type="number"
                step="any"
              />
              <Input
                placeholder="Recent low"
                value={recentLow}
                onChange={(e) => setRecentLow(e.target.value)}
                className="h-9 text-sm"
                type="number"
                step="any"
              />
            </div>
          </div>

          {/* Advanced Options Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <BarChart3 className="size-3.5" />
            Advanced Market Data
            {showAdvanced ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>

          {showAdvanced && (
            <div className="space-y-3 pl-1 border-l-2 border-border/50 ml-1">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  News / Market Context
                </Label>
                <Textarea
                  placeholder={
                    instrumentType === "crypto"
                      ? "e.g. Bitcoin ETF inflows hit $1B this week, regulatory clarity in EU..."
                      : "e.g. Fed signals pause, NFP beat expectations, geopolitical tensions in..."
                  }
                  value={newsContext}
                  onChange={(e) => setNewsContext(e.target.value)}
                  className="text-sm min-h-[60px] resize-none"
                  rows={2}
                />
              </div>
              {instrumentType === "forex" && (
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Economic Events
                  </Label>
                  <Textarea
                    placeholder="e.g. CPI 3.2% vs 3.0% expected, ECB rate decision Thursday, Jobless Claims Friday..."
                    value={economicEvents}
                    onChange={(e) => setEconomicEvents(e.target.value)}
                    className="text-sm min-h-[60px] resize-none"
                    rows={2}
                  />
                </div>
              )}
              {instrumentType === "crypto" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Funding Rate (%)
                    </Label>
                    <Input
                      placeholder="e.g. 0.01"
                      value={fundingRate}
                      onChange={(e) => setFundingRate(e.target.value)}
                      className="h-9 text-sm"
                      type="number"
                      step="any"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              disabled={!instrument.trim() || isAnalyzing}
              className="gap-2 px-5"
            >
              {isAnalyzing ? (
                <>
                  <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  Generate Bias
                </>
              )}
            </Button>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <AlertCircle className="size-3" />
              <span>More data = higher confidence</span>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
