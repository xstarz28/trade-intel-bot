import { useState, useEffect, useCallback } from "react";
import { TRADING_STYLES, type TradingStyle } from "@/lib/trading-style";
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
  Zap,
  AlertCircle,
} from "lucide-react";

interface InstrumentInputProps {
  onAnalyze: (input: AnalysisInput) => void;
  isAnalyzing: boolean;
}

const STORAGE_KEY = "xstarzg-analysis-form";

interface PersistedForm {
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  tradingStyle: TradingStyle;
}

const DEFAULT_FORM: PersistedForm = {
  instrument: "",
  instrumentType: "forex",
  timeframe: "D1",
  tradingStyle: "intraday",
};

function loadPersistedForm(): PersistedForm {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORM;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_FORM, ...parsed };
  } catch {
    return DEFAULT_FORM;
  }
}

export function InstrumentInput({ onAnalyze, isAnalyzing }: InstrumentInputProps) {
  const [form, setForm] = useState<PersistedForm>(loadPersistedForm);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // silent
    }
  }, [form]);

  const update = useCallback(<K extends keyof PersistedForm>(
    key: K,
    value: PersistedForm[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleQuickSelect = useCallback((symbol: string, type: InstrumentType) => {
    setForm((prev) => ({ ...prev, instrument: symbol, instrumentType: type }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.instrument.trim()) return;

    onAnalyze({
      instrument: form.instrument.trim(),
      instrumentType: form.instrumentType,
      timeframe: form.timeframe,
      tradingStyle: form.tradingStyle,
      requestedTimeframe: form.timeframe,
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
              pilih instrumen dan run analysis — data diambil otomatis
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
                    form.instrument === item.symbol
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
                  value={form.instrument}
                  onChange={(e) => update("instrument", e.target.value)}
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
                value={form.instrumentType}
                onValueChange={(v) => update("instrumentType", v as InstrumentType)}
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
                value={form.timeframe}
                onValueChange={(v) => update("timeframe", v as Timeframe)}
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

          {/* Phase 6 — Trading style: changes decision HORIZON and
              requirements only, never market facts. */}
          <div>
            <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
              trading style
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {TRADING_STYLES.map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => update("tradingStyle", st)}
                  className={`h-9 rounded-md border text-[11px] font-mono uppercase transition-colors ${
                    form.tradingStyle === st
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              disabled={!form.instrument.trim() || isAnalyzing}
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
                  run analysis
                </>
              )}
            </Button>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
              <AlertCircle className="size-3" />
              <span>data diambil otomatis via backend</span>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
