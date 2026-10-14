import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { TRADING_STYLES, resolveStyle, type TradingStyle } from "@/lib/trading-style";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { buildManualInstrumentSpec, type ManualInstrumentSpecFields } from "@/lib/risk/manual-spec";
import { dedupeInstrumentCatalog } from "@/lib/data/instrument-catalog";
import {
  Zap,
  AlertCircle,
} from "lucide-react";

interface AvailableInstrument {
  symbol: string;
  type: InstrumentType;
  label: string;
  marketType?: "spot" | "perpetual" | "futures";
}

type CryptoMarketType = "spot" | "perpetual" | "futures";
function inferCryptoMarketType(item: Pick<AvailableInstrument, "symbol" | "marketType">): CryptoMarketType {
  if (item.marketType) return item.marketType;
  const symbol = item.symbol.toUpperCase();
  if (symbol.endsWith("-SWAP") || symbol.endsWith("-FUTURES")) return "perpetual";
  if (/-[0-9]{6}$/.test(symbol)) return "futures";
  return "spot";
}
const CRYPTO_MARKET_OPTIONS: Array<{ value: CryptoMarketType; label: string }> = [
  { value: "spot", label: "SPOT" },
  { value: "perpetual", label: "PERPETUAL / SWAP" },
  { value: "futures", label: "DATED FUTURES" },
];

interface InstrumentInputProps {
  onAnalyze: (input: AnalysisInput) => void;
  isAnalyzing: boolean;
  availableInstruments?: AvailableInstrument[];
  marketDiscoveryMessage?: string | null;
}

const STORAGE_KEY = "xstarzg-analysis-form";

interface PersistedForm {
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  tradingStyle: TradingStyle;
}

const DEFAULT_FORM: PersistedForm = {
  // Start with a valid instrument so the primary action is usable on a fresh session.
  instrument: "EUR/USD",
  instrumentType: "forex",
  timeframe: "D1",
  tradingStyle: "intraday",
};

function loadPersistedForm(): PersistedForm {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORM;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_FORM,
      ...parsed,
      // Older sessions may have persisted an empty instrument, which disabled
      // the primary submit button even though the form was otherwise ready.
      instrument: typeof parsed.instrument === "string" && parsed.instrument.trim()
        ? parsed.instrument
        : DEFAULT_FORM.instrument,
    };
  } catch {
    return DEFAULT_FORM;
  }
}

export function InstrumentInput({
  onAnalyze,
  isAnalyzing,
  availableInstruments = [],
  marketDiscoveryMessage,
}: InstrumentInputProps) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<PersistedForm>(loadPersistedForm);
  const [manualSpecOpen, setManualSpecOpen] = useState(false);
  const [manualSpecFields, setManualSpecFields] = useState<ManualInstrumentSpecFields>({
    quoteCurrency: "",
    contractSize: "",
    quantityStep: "",
    minQuantity: "",
  });
  const [manualSearch, setManualSearch] = useState(false);
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [manualSearchError, setManualSearchError] = useState<string | null>(null);
  const [cryptoMarketType, setCryptoMarketType] = useState<CryptoMarketType>("spot");
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  // Keep every field synchronous with user input so an immediate submit cannot
  // combine a new instrument with the previous category/timeframe/style render.
  const formRef = useRef(form);
  const commitForm = useCallback((updateForm: (current: PersistedForm) => PersistedForm) => {
    const current = formRef.current;
    const next = updateForm(current);
    // Contract metadata belongs only to the exact selected instrument.
    // Clear it synchronously when that selection changes to prevent reuse
    // of a gold/forex contract specification on a different market symbol.
    if (next.instrument !== current.instrument) {
      setManualSpecFields({
        quoteCurrency: "",
        contractSize: "",
        quantityStep: "",
        minQuantity: "",
      });
    }
    formRef.current = next;
    setForm(next);
  }, []);
  useEffect(() => {
    if (manualSearch) manualInputRef.current?.focus();
  }, [manualSearch]);

  const universeOptions = dedupeInstrumentCatalog(
    availableInstruments.length > 0 ? availableInstruments : POPULAR_INSTRUMENTS,
  );

  useEffect(() => {
    if (form.instrumentType !== "crypto") return;
    const selected = universeOptions.find((item) => item.symbol === form.instrument);
    if (selected) setCryptoMarketType(inferCryptoMarketType(selected));
  }, [form.instrument, form.instrumentType, universeOptions]);

  // Keep the selected horizon and setup timeframe coherent, including when
  // restoring an older saved form that used an incompatible timeframe.
  useEffect(() => {
    const profile = resolveStyle(form.tradingStyle);
    if (!profile.allowedSetupTfs.includes(form.timeframe)) {
      commitForm((prev) => ({
        ...prev,
        timeframe: resolveStyle(prev.tradingStyle).fallbackTf as Timeframe,
      }));
    }
  }, [form.tradingStyle, form.timeframe, commitForm]);

  const categoryOptions: { value: InstrumentType; label: string }[] = [
    { value: "forex", label: t.entryForm.forex },
    { value: "crypto", label: t.entryForm.crypto },
    { value: "stock", label: t.entryForm.stocks },
    { value: "commodity", label: t.entryForm.commodities },
  ];

  const categoryInstruments = universeOptions
    .filter((item) => item.type === form.instrumentType)
    .filter((item) => form.instrumentType !== "crypto" || inferCryptoMarketType(item) === cryptoMarketType);
  const filteredInstruments = categoryInstruments;
  const manualQuery = manualSearchQuery.trim().toUpperCase();
  const manualSearchMatches = manualQuery
    ? universeOptions
        .filter((item) =>
          item.symbol.toUpperCase().includes(manualQuery) ||
          item.label.toUpperCase().includes(manualQuery)
        )
        .sort((a, b) => {
          const rank = (item: AvailableInstrument) => {
            const symbol = item.symbol.toUpperCase();
            const label = item.label.toUpperCase();
            if (symbol === manualQuery) return 0;
            if (symbol.startsWith(manualQuery)) return 1;
            if (label.startsWith(manualQuery)) return 2;
            if (symbol.includes(manualQuery)) return 3;
            return 4;
          };
          return rank(a) - rank(b) || a.symbol.localeCompare(b.symbol);
        })
        .slice(0, 8)
    : [];
  const exactManualMatch = manualQuery
    ? universeOptions.find((item) => item.symbol.toUpperCase() === manualQuery)
    : undefined;

  const selectCategory = useCallback((type: InstrumentType) => {
    commitForm((prev) => {
      const nextOptions = universeOptions
        .filter((item) => item.type === type)
        .filter((item) => type !== "crypto" || inferCryptoMarketType(item) === cryptoMarketType);
      const currentStillValid = nextOptions.some((item) => item.symbol === prev.instrument);
      const preferred = type === "crypto"
        ? (cryptoMarketType === "perpetual" ? ["BTC-USDT-SWAP"] : cryptoMarketType === "futures" ? [] : ["BTC/USD", "BTC-USDT"])
        : type === "forex" ? ["EUR/USD"]
          : type === "stock" ? ["AAPL"]
            : type === "commodity" ? ["XAU/USD"] : [];
      const firstPreferred = preferred.find((symbol) => nextOptions.some((item) => item.symbol === symbol));
      const nextInstrument = currentStillValid ? prev.instrument : (firstPreferred ?? nextOptions[0]?.symbol ?? "");
      return { ...prev, instrumentType: type, instrument: nextInstrument };
    });
  }, [commitForm, universeOptions, cryptoMarketType]);

  const selectInstrument = useCallback((symbol: string) => {
    const match = universeOptions.find((item) => item.symbol === symbol);
    if (match?.type === "crypto") setCryptoMarketType(inferCryptoMarketType(match));
    commitForm((prev) => ({
      ...prev,
      instrument: symbol,
      instrumentType: match?.type ?? prev.instrumentType,
    }));
  }, [commitForm, universeOptions]);

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
    commitForm((prev) => ({ ...prev, [key]: value }));
  }, [commitForm]);

  const handleQuickSelect = useCallback((symbol: string, type: InstrumentType) => {
    commitForm((prev) => ({ ...prev, instrument: symbol, instrumentType: type }));
  }, [commitForm]);

  const submitAnalysis = useCallback(() => {
    const currentForm = formRef.current;
    const typedInstrument = manualSearchQuery.trim();
    const instrument = (manualSearch && typedInstrument
      ? typedInstrument
      : currentForm.instrument).trim();
    if (!instrument || isAnalyzing) return;

    const knownInstrument = universeOptions.find(
      (item) => item.symbol.toUpperCase() === instrument.toUpperCase(),
    );

    // Manual search must resolve to a canonical catalog item. Otherwise a
    // ticker could be sent to the provider under the previously selected class.
    if (manualSearch && !knownInstrument) {
      setManualSearchError("Choose a matching instrument from the search results before running analysis.");
      return;
    }
    setManualSearchError(null);

    const resolvedInstrument = knownInstrument?.symbol ?? instrument;
    // The custom specification is sent only with the exact instrument it was
    // entered for. A typed manual-search symbol that was not selected via the
    // form never inherits another instrument's contract metadata.
    const manualSpec = currentForm.instrument.toUpperCase() === resolvedInstrument.toUpperCase()
      ? buildManualInstrumentSpec({
          instrument: resolvedInstrument,
          assetClass: knownInstrument?.type ?? currentForm.instrumentType,
          fields: manualSpecFields,
        })
      : undefined;

    onAnalyze({
      instrument: resolvedInstrument,
      instrumentType: knownInstrument?.type ?? currentForm.instrumentType,
      timeframe: currentForm.timeframe,
      tradingStyle: currentForm.tradingStyle,
      requestedTimeframe: currentForm.timeframe,
      ...(manualSpec ? { instrumentSpec: manualSpec } : {}),
    });
  }, [isAnalyzing, manualSearch, manualSearchQuery, manualSpecFields, onAnalyze, universeOptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitAnalysis();
  };

  const submitInstrument = manualSearch
    ? (exactManualMatch?.symbol ?? "")
    : form.instrument.trim();

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center">
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

          {form.instrumentType === "crypto" && !manualSearch && (
            <div data-testid="crypto-market-type" className="flex flex-wrap gap-1 mb-2">
              {CRYPTO_MARKET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-1 text-[9px] font-mono transition-colors",
                    cryptoMarketType === option.value
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border/50 text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => {
                    setCryptoMarketType(option.value);
                    const choices = universeOptions.filter((item) => item.type === "crypto" && inferCryptoMarketType(item) === option.value);
                    const preferred = option.value === "spot" ? ["BTC/USD", "BTC-USDT"]
                      : option.value === "perpetual" ? ["BTC-USDT-SWAP"] : [];
                    const next = preferred.find((symbol) => choices.some((item) => item.symbol === symbol)) ?? choices[0]?.symbol;
                    commitForm((prev) => ({ ...prev, instrumentType: "crypto", instrument: next ?? "" }));
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

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
            {!manualSearch && (
              <Select value={form.instrument} onValueChange={selectInstrument}>
              <SelectTrigger className="h-11 text-sm font-mono">
                <SelectValue placeholder={filteredInstruments.length ? t.dashboard.selectInstrument : t.market.noData} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {filteredInstruments.map((item) => (
                  <SelectItem key={item.symbol} value={item.symbol} className="font-mono">
                    {item.symbol}
                    {item.type === "crypto" ? " [" + inferCryptoMarketType(item).toUpperCase() + "]" : ""}
                    {item.label && item.label !== item.symbol ? ` — ${item.label}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
              </Select>
            )}
            {form.instrumentType === "crypto" &&
              !manualSearch &&
              filteredInstruments.length === 0 &&
              marketDiscoveryMessage && (
                <p role="status" className="mt-2 text-[10px] font-mono text-amber-400/90">
                  {marketDiscoveryMessage}
                </p>
              )}

            <button
              type="button"
              data-testid="manual-search-toggle"
              onClick={() => {
                setManualSearch((value) => !value);
                setManualSearchQuery("");
                setManualSearchError(null);
              }}
              className="mt-2 text-[11px] font-mono text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              {manualSearch ? t.entryForm.hideManualSearch : t.entryForm.searchSpecificInstrument}
            </button>

            {manualSearch && (
              <div className="relative z-20 mt-2 pointer-events-auto">
                <input
                  ref={manualInputRef}
                  data-testid="manual-instrument-search"
                  aria-label={t.entryForm.manualSearchPlaceholder}
                  name="manualInstrumentSearch"
                  type="text"
                  placeholder={t.entryForm.manualSearchPlaceholder}
                  value={manualSearchQuery}
                  onChange={(event) => {
                    setManualSearchQuery(event.currentTarget.value);
                    setManualSearchError(null);
                  }}
                  className="relative z-20 h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-foreground shadow-sm outline-none pointer-events-auto focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                />
                {manualQuery && (
                  <div role="listbox" aria-label="Instrument search results" className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border/60 bg-background">
                    {manualSearchMatches.length > 0 ? manualSearchMatches.map((item) => (
                      <button
                        key={item.symbol}
                        type="button"
                        role="option"
                        aria-selected={exactManualMatch?.symbol === item.symbol}
                        className="flex w-full items-start justify-between gap-3 border-b border-border/30 px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                        onClick={() => {
                          setManualSearchQuery(item.symbol);
                          setManualSearchError(null);
                          if (item.type === "crypto") setCryptoMarketType(inferCryptoMarketType(item));
                          commitForm((prev) => ({ ...prev, instrument: item.symbol, instrumentType: item.type }));
                        }}
                      >
                        <span className="font-mono text-xs font-semibold">{item.symbol}</span>
                        <span className="text-right text-[10px] text-muted-foreground">{item.label}{("marketType" in item && item.marketType) ? ` · ${item.marketType.toUpperCase()}` : ` · ${item.type.toUpperCase()}`}</span>
                      </button>
                    )) : (
                      <p role="status" className="px-3 py-2 text-[10px] font-mono text-amber-400">
                        No catalog match. Try a ticker, pair, or instrument name.
                      </p>
                    )}
                  </div>
                )}
                {manualSearchError && (
                  <p role="alert" className="mt-1.5 text-[10px] font-mono text-red-400">{manualSearchError}</p>
                )}
                <p className="mt-1.5 text-[10px] font-mono text-muted-foreground">
                  {t.entryForm.manualSearchNote}
                </p>
              </div>
            )}
          </div>

          {/* Optional broker metadata for transparent, user-controlled position sizing. */}
          <section className="rounded-md border border-border/50 p-3 space-y-2" data-testid="broker-specification-panel">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-[11px] font-mono font-semibold"
              aria-expanded={manualSpecOpen}
              data-testid="broker-specification-toggle"
              onClick={() => setManualSpecOpen((value) => !value)}
            >
              <span>{locale === "id" ? "Spesifikasi kontrak broker (opsional)" : "Broker contract specification (optional)"}</span>
              <span className="text-muted-foreground">{manualSpecOpen ? "−" : "+"}</span>
            </button>
            {manualSpecOpen && (
              <div className="space-y-2">
                <p className="text-[10px] font-mono text-muted-foreground">
                  {locale === "id"
                    ? "Masukkan spesifikasi broker untuk instrumen yang sedang dipilih. Tidak ada ukuran lot atau kontrak standar yang diasumsikan; kolom dibersihkan saat instrumen diganti."
                    : "Enter broker-confirmed details for the selected instrument. No standard lot or contract size is assumed; these fields reset when the instrument changes."}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[10px] font-mono text-muted-foreground">
                    {locale === "id" ? "Ukuran kontrak" : "Contract size"}
                    <input
                      aria-label={locale === "id" ? "Ukuran kontrak" : "Contract size"}
                      type="number"
                      min="0"
                      step="any"
                      value={manualSpecFields.contractSize}
                      onChange={(event) => setManualSpecFields((prev) => ({ ...prev, contractSize: event.currentTarget.value }))}
                      placeholder={locale === "id" ? "Dari broker" : "From broker"}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground"
                    />
                  </label>
                  <label className="block text-[10px] font-mono text-muted-foreground">
                    {locale === "id" ? "Langkah kuantitas" : "Quantity step"}
                    <input
                      aria-label={locale === "id" ? "Langkah kuantitas" : "Quantity step"}
                      type="number"
                      min="0"
                      step="any"
                      value={manualSpecFields.quantityStep}
                      onChange={(event) => setManualSpecFields((prev) => ({ ...prev, quantityStep: event.currentTarget.value }))}
                      placeholder={locale === "id" ? "Dari broker" : "From broker"}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground"
                    />
                  </label>
                  <label className="block text-[10px] font-mono text-muted-foreground">
                    {locale === "id" ? "Kuantitas minimum" : "Minimum quantity"}
                    <input
                      aria-label={locale === "id" ? "Kuantitas minimum" : "Minimum quantity"}
                      type="number"
                      min="0"
                      step="any"
                      value={manualSpecFields.minQuantity}
                      onChange={(event) => setManualSpecFields((prev) => ({ ...prev, minQuantity: event.currentTarget.value }))}
                      placeholder={locale === "id" ? "Opsional" : "Optional"}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground"
                    />
                  </label>
                  <label className="block text-[10px] font-mono text-muted-foreground">
                    {locale === "id" ? "Mata uang kuotasi" : "Quote currency"}
                    <input
                      aria-label={locale === "id" ? "Mata uang kuotasi" : "Quote currency"}
                      type="text"
                      maxLength={6}
                      pattern="[A-Za-z0-9]{3,6}"
                      value={manualSpecFields.quoteCurrency}
                      onChange={(event) => setManualSpecFields((prev) => ({ ...prev, quoteCurrency: event.currentTarget.value.toUpperCase() }))}
                      placeholder={locale === "id" ? "Kode mata uang/aset" : "Currency/asset code"}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-mono uppercase text-foreground"
                    />
                  </label>
                </div>
                <p className="text-[9px] font-mono text-muted-foreground">
                  {locale === "id"
                    ? "Sizing hanya aktif dengan spesifikasi lengkap. Jika detail broker belum diketahui, biarkan kosong; hasil ukuran posisi akan tetap tidak tersedia daripada memakai asumsi."
                    : "Sizing activates only with complete specifications. Leave unknown broker details blank; position size remains unavailable rather than relying on assumptions."}
                </p>
              </div>
            )}
          </section>

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
                  onClick={() => commitForm((prev) => {
                    const profile = resolveStyle(st);
                    return {
                      ...prev,
                      tradingStyle: st,
                      timeframe: profile.fallbackTf as Timeframe,
                    };
                  })}
                  className={`h-9 rounded-md border text-[11px] font-mono uppercase transition-colors ${
                    form.tradingStyle === st
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {t.investor[st === "scalping" ? "horizonScalping" : st === "swing" ? "horizonSwing" : "horizonIntraday"]}
                </button>
              ))}
            </div>
          </div>


          {/* Timeframes are scoped to the chosen trading horizon. */}
          <div>
            <Label className="text-xs font-mono font-semibold text-foreground mb-2 block">
              {t.entryForm.timeframeLabel} · {t.investor[form.tradingStyle === "scalping" ? "horizonScalping" : form.tradingStyle === "swing" ? "horizonSwing" : "horizonIntraday"]}
            </Label>
            <div className="grid grid-cols-3 sm:grid-cols-3 gap-1.5">
              {TIMEFRAMES.filter((tf) => resolveStyle(form.tradingStyle).allowedSetupTfs.includes(tf.value)).map((tf) => (
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

          {/* Submit */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              disabled={!submitInstrument || isAnalyzing}
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
