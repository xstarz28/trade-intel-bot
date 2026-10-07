import { useState, useEffect, useCallback, useRef } from "react";
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
import logo from "@/assets/logo.svg";
import {
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
  const [manualSearch, setManualSearch] = useState(false);
  const instrumentRef = useRef(form.instrument);
  const universeOptions = availableInstruments.length > 0 ? availableInstruments : POPULAR_INSTRUMENTS;

  const categoryOptions: { value: InstrumentType; label: string }[] = [
    { value: "forex", label: t.entryForm.forex },
    { value: "crypto", label: t.entryForm.crypto },
    { value: "stock", label: t.entryForm.stocks },
    { value: "commodity", label: t.entryForm.commodities },
  ];

  const categoryInstruments = universeOptions.filter((item) => item.type === form.instrumentType);
  const filteredInstruments = categoryInstruments.length > 0 ? categoryInstruments : universeOptions;

  const selectCategory = useCallback((type: InstrumentType) => {
    setForm((prev) => {
      const nextOptions = universeOptions.filter((item) => item.type === type);
      const currentStillValid = nextOptions.some((item) => item.symbol === prev.instrument);
      const nextInstrument = currentStillValid ? prev.instrument : (nextOptions[0]?.symbol ?? "");
      instrumentRef.current = nextInstrument;
      return {
        ...prev,
        instrumentType: type,
        instrument: nextInstrument,
      };
    });
  }, [universeOptions]);

  const selectInstrument = useCallback((symbol: string) => {
    instrumentRef.current = symbol;
    const match = universeOptions.find((item) => item.symbol === symbol);
    setForm((prev) => ({
      ...prev,
      instrument: symbol,
      instrumentType: match?.type ?? prev.instrumentType,
    }));
  }, [universeOptions]);

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
    if (key === "instrument") instrumentRef.current = String(value);
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleQuickSelect = useCallback((symbol: string, type: InstrumentType) => {
    instrumentRef.current = symbol;
    setForm((prev) => ({ ...prev, instrument: symbol, instrumentType: type }));
  }, []);

  const submitAnalysis = useCallback(() => {
    const instrument = instrumentRef.current.trim();
    if (!instrument || isAnalyzing) return;

    onAnalyze({
      instrument,
      instrumentType: form.instrumentType,
      timeframe: form.timeframe,
      tradingStyle: form.tradingStyle,
      requestedTimeframe: form.timeframe,
    });
  }, [form, isAnalyzing, onAnalyze]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitAnalysis();
  };

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <img src={logo} alt="XSTARZG" width={32} height={32} className="size-8 rounded-lg" />
          <div>
            <CardTitle className="text-sm font-semibold font-mono">
              {t.entryForm.newAnalysis}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
              {t.dashboard.terminalDescription}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Instrument category */}
          <div>
            <Label className="text-xs font-mono font-semibold text-foreground mb-2 block">
              {t.entryForm.marketLabel}
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {categoryOptions.map((category) => (
                <button
                  key={category.value}
                  type="button"
                  onClick={() => selectCategory(category.value)}
                  className={cn(
                    "h-10 rounded-md border text-xs font-mono font-semibold transition-all",
                    form.instrumentType === category.value
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>

          {/* Instrument browser — category drives this list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-mono font-semibold text-foreground">
                {t.entryForm.instrumentLabel}
              </Label>
              <span className="text-[10px] font-mono text-muted-foreground">
                {filteredInstruments.length.toLocaleString()} {t.entryForm.available}
              </span>
            </div>
            <Select value={form.instrument} onValueChange={selectInstrument}>
              <SelectTrigger className="h-11 text-sm font-mono">
                <SelectValue placeholder={filteredInstruments.length ? t.dashboard.selectInstrument : t.market.noData} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {filteredInstruments.map((item) => (
                  <SelectItem key={item.symbol} value={item.symbol} className="font-mono">
                    {item.symbol}{item.label && item.label !== item.symbol ? ` — ${item.label}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              type="button"
              onClick={() => setManualSearch((value) => !value)}
              className="mt-2 text-[11px] font-mono text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              {manualSearch ? t.entryForm.hideManualSearch : t.entryForm.searchSpecificInstrument}
            </button>

            {manualSearch && (
              <div className="mt-2">
                <Input
                  placeholder={t.entryForm.manualSearchPlaceholder}
                  value={form.instrument}
                  onChange={(e) => update("instrument", e.target.value)}
                  className="h-10 text-sm font-mono"
                  autoComplete="off"
                />
                <p className="mt-1.5 text-[10px] font-mono text-muted-foreground">
                  {t.entryForm.manualSearchNote}
                </p>
              </div>
            )}
          </div>

          {/* Timeframe — all supported choices visible */}
          <div>
            <Label className="text-xs font-mono font-semibold text-foreground mb-2 block">
              {t.entryForm.timeframeLabel}
            </Label>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  type="button"
                  onClick={() => update("timeframe", tf.value as Timeframe)}
                  className={cn(
                    "h-10 rounded-md border text-xs font-mono font-semibold transition-all",
                    form.timeframe === tf.value
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/60 bg-background/50 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                  title={tf.label}
                >
                  {tf.value}
                </button>
              ))}
            </div>
          </div>

          {/* Legacy type/timeframe selects removed: category and visible timeframe controls above are authoritative. */}

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
