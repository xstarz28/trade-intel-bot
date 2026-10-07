import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
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

interface AvailableInstrument {
  symbol: string;
  type: InstrumentType;
  label: string;
}

interface InstrumentInputProps {
  onAnalyze: (input: AnalysisInput) => void;
  isAnalyzing: boolean;
  availableInstruments?: AvailableInstrument[];
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

export function InstrumentInput({ onAnalyze, isAnalyzing, availableInstruments = [] }: InstrumentInputProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<PersistedForm>(loadPersistedForm);
  const quickPicks = availableInstruments.length > 0
    ? availableInstruments.filter((item) => POPULAR_INSTRUMENTS.some((popular) => popular.symbol === item.symbol)).slice(0, 8)
    : POPULAR_INSTRUMENTS;
  const universeOptions = availableInstruments.length > 0 ? availableInstruments : POPULAR_INSTRUMENTS;

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
              {t.dashboard.terminalDescription}
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
              {quickPicks.map((item) => (
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
            <p className="mt-2 text-[10px] font-mono text-muted-foreground">
              {universeOptions.length.toLocaleString()} instruments available · search the full provider-backed universe below
            </p>
          </div>

          {/* Instrument + Type + Timeframe */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="col-span-1">
              <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                {t.entryForm.instrumentLabel}
              </Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-primary/60 font-mono">$</span>
                <Input
                  list="xstarzg-instrument-universe"
                  placeholder="Search symbol, e.g. BTC/USD or BTC-USDT-SWAP"
                  value={form.instrument}
                  onChange={(e) => {
                    const value = e.target.value;
                    const match = universeOptions.find((item) => item.symbol.toUpperCase() === value.toUpperCase());
                    update("instrument", value);
                    if (match) update("instrumentType", match.type);
                  }}
                  className="pl-7 h-9 text-sm font-mono"
                  required
                  autoComplete="off"
                />
                <datalist id="xstarzg-instrument-universe">
                  {universeOptions.map((item) => (
                    <option key={item.symbol} value={item.symbol}>{item.label}</option>
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                {t.entryForm.typeLabel}
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
                {t.entryForm.timeframeLabel}
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
              {t.entryForm.styleLabel}
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
                  {t.entryForm.analyzing}
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  {t.entryForm.runLabel}
                </>
              )}
            </Button>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
              <AlertCircle className="size-3" />
              <span>{t.entryForm.backendNote}</span>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
