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
import {
  POPULAR_INSTRUMENTS,
  TIMEFRAMES,
  type AnalysisInput,
  type InstrumentType,
  type Timeframe,
} from "@/lib/analysis-engine";
import { cn } from "@/lib/utils";
import {
  Terminal,
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
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
            <Terminal className="size-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold font-mono">
              $ new-analysis
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
              submit an instrument to generate a directional bias
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quick Picks */}
          <div>
            <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-2 block">
              $ instruments
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR_INSTRUMENTS.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() => handleQuickSelect(item.symbol, item.type)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-mono font-medium transition-all",
                    instrument === item.symbol
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/50 bg-muted/20 text-muted-foreground hover:border-border hover:text-foreground"
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
              <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                instrument
              </Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-primary/60 font-mono">$</span>
                <Input
                  placeholder="EUR/USD"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className="pl-7 h-9 text-sm font-mono"
                  required
                />
              </div>
            </div>
            <div>
              <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                type
              </Label>
              <Select
                value={instrumentType}
                onValueChange={(v) => setInstrumentType(v as InstrumentType)}
              >
                <SelectTrigger className="h-9 text-sm font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="forex">forex</SelectItem>
                  <SelectItem value="crypto">crypto</SelectItem>
                  <SelectItem value="stock">stock</SelectItem>
                  <SelectItem value="commodity">commodity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                timeframe
              </Label>
              <Select
                value={timeframe}
                onValueChange={(v) => setTimeframe(v as Timeframe)}
              >
                <SelectTrigger className="h-9 text-sm font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((tf) => (
                    <SelectItem key={tf.value} value={tf.value} className="font-mono">
                      {tf.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Price Data */}
          <div>
            <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
              price data{" "}
              <span className="text-muted-foreground/50">(optional)</span>
            </Label>
            <div className="grid grid-cols-3 gap-3">
              <Input
                placeholder="current"
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
                className="h-9 text-sm font-mono"
                type="number"
                step="any"
              />
              <Input
                placeholder="high"
                value={recentHigh}
                onChange={(e) => setRecentHigh(e.target.value)}
                className="h-9 text-sm font-mono"
                type="number"
                step="any"
              />
              <Input
                placeholder="low"
                value={recentLow}
                onChange={(e) => setRecentLow(e.target.value)}
                className="h-9 text-sm font-mono"
                type="number"
                step="any"
              />
            </div>
          </div>

          {/* Advanced Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-[11px] font-mono font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-primary/60">$</span>
            advanced data
            {showAdvanced ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>

          {showAdvanced && (
            <div className="space-y-3 pl-3 border-l border-border/50">
              <div>
                <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                  news / context
                </Label>
                <Textarea
                  placeholder={
                    instrumentType === "crypto"
                      ? "ETF inflows, regulatory news, on-chain catalysts..."
                      : "Fed signals, NFP data, geopolitical events..."
                  }
                  value={newsContext}
                  onChange={(e) => setNewsContext(e.target.value)}
                  className="text-sm font-mono min-h-[60px] resize-none"
                  rows={2}
                />
              </div>
              {instrumentType === "forex" && (
                <div>
                  <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                    economic events
                  </Label>
                  <Textarea
                    placeholder="CPI 3.2% vs 3.0% exp, ECB decision Thursday..."
                    value={economicEvents}
                    onChange={(e) => setEconomicEvents(e.target.value)}
                    className="text-sm font-mono min-h-[60px] resize-none"
                    rows={2}
                  />
                </div>
              )}
              {instrumentType === "crypto" && (
                <div>
                  <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                    funding rate (%)
                  </Label>
                  <Input
                    placeholder="0.01"
                    value={fundingRate}
                    onChange={(e) => setFundingRate(e.target.value)}
                    className="h-9 text-sm font-mono"
                    type="number"
                    step="any"
                  />
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              disabled={!instrument.trim() || isAnalyzing}
              className="gap-2 px-5 font-mono text-sm"
            >
              {isAnalyzing ? (
                <>
                  <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  analyzing...
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  run bias
                </>
              )}
            </Button>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
              <AlertCircle className="size-3" />
              <span>more data → higher confidence</span>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
