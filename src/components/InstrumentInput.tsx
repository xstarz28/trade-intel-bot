import { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { mapHorizon } from "@/lib/i18n/enum-mapping";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TIMEFRAMES,
  type AnalysisInput,
  type Timeframe,
} from "@/lib/analysis-engine";
import { cn } from "@/lib/utils";
import { Terminal, Zap, AlertCircle } from "lucide-react";
import type { AssetClass } from "@/lib/data/universal/types";
import { assetClassToInstrumentType } from "@/lib/discovery/live-identity";
import {
  CATALOG_RENDER_WINDOW,
  classDiscoverySummaries,
  countForFilter,
  filterCatalog,
  findCatalogRow,
  nativeSelectionOf,
  visibleClassFilters,
  windowCatalog,
  type CatalogInstrument,
  type ClassFilter,
  type DiscoveryProviderStatus,
  type NativeSelection,
} from "@/lib/discovery/instrument-universe";

interface InstrumentInputProps {
  onAnalyze: (input: AnalysisInput) => void;
  isAnalyzing: boolean;
  catalog?: CatalogInstrument[];
  discoveryProviders?: DiscoveryProviderStatus[];
}

const STORAGE_KEY = "xstarzg-analysis-form";

interface PersistedForm {
  selectedKey: string;
  timeframe: Timeframe;
  tradingStyle: TradingStyle;
  classFilter: ClassFilter;
}

const DEFAULT_FORM: PersistedForm = {
  selectedKey: "",
  timeframe: "D1",
  tradingStyle: "intraday",
  classFilter: "all",
};

function loadPersistedForm(): PersistedForm {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORM;
    const parsed = JSON.parse(raw) as Partial<PersistedForm>;
    return { ...DEFAULT_FORM, ...parsed };
  } catch {
    return DEFAULT_FORM;
  }
}

function classFilterLabel(
  filter: ClassFilter,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (filter === "all") return t.marketPanel.allOption;
  if (filter === "crypto") return t.entryForm.typeCrypto;
  if (filter === "forex") return t.entryForm.typeForex;
  if (filter === "stock") return t.entryForm.typeStock;
  if (filter === "commodity") return t.entryForm.typeCommodity;
  if (filter === "indices") return t.entryForm.typeIndices;
  return t.entryForm.typeMacro;
}

function assetClassLabel(
  assetClass: AssetClass,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (assetClass === "crypto") return t.entryForm.typeCrypto;
  if (assetClass === "forex") return t.entryForm.typeForex;
  if (assetClass === "equity") return t.entryForm.typeStock;
  if (assetClass === "commodity") return t.entryForm.typeCommodity;
  if (assetClass === "indices") return t.entryForm.typeIndices;
  return t.entryForm.typeMacro;
}

function completenessLabel(
  completeness: string | undefined,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (completeness === "COMPLETE") return t.entryForm.discoveryComplete;
  if (completeness === "PARTIAL") return t.entryForm.discoveryPartial;
  if (completeness === "FAILED") return t.entryForm.discoveryFailed;
  return t.global.loading;
}

function formatProviderDisplay(provider: string): string {
  if (provider.startsWith("ccxt:")) {
    const ex = provider.slice(5);
    return `${ex} via CCXT`;
  }
  if (provider === "twelve-data") return "Twelve Data";
  if (provider === "dexscreener") return "DexScreener";
  if (provider === "geckoterminal") return "GeckoTerminal";
  if (provider === "idx") return "IDX";
  if (provider === "stockbit") return "Stockbit";
  if (provider === "ajaib") return "Ajaib";
  return provider;
}

export function InstrumentInput({
  onAnalyze,
  isAnalyzing,
  catalog = [],
  discoveryProviders = [],
}: InstrumentInputProps) {
  const { t, txi } = useI18n();
  const [form, setForm] = useState<PersistedForm>(loadPersistedForm);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<NativeSelection | null>(null);
  const [renderWindow, setRenderWindow] = useState(CATALOG_RENDER_WINDOW);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // silent
    }
  }, [form]);

  useEffect(() => {
    if (form.selectedKey) {
      const restored = catalog.find(
        (row) => `${row.provider}::${row.providerInstrumentId}` === form.selectedKey,
      );
      if (restored) {
        setSelected(nativeSelectionOf(restored));
        return;
      }
    }
    setSelected((prev) => {
      if (!prev) return null;
      return findCatalogRow(catalog, prev) ? prev : null;
    });
  }, [catalog, form.selectedKey]);

  const update = useCallback(<K extends keyof PersistedForm>(
    key: K,
    value: PersistedForm[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const classFilters = useMemo(() => visibleClassFilters(catalog), [catalog]);
  const filtered = useMemo(
    () => filterCatalog(catalog, { classFilter: form.classFilter, query }),
    [catalog, form.classFilter, query],
  );
  // Reset render window when filter/query changes — ensures new filtered set starts at 80,
  // but previous window growth does not hide that filtering operates on complete catalog.
  useEffect(() => {
    setRenderWindow(CATALOG_RENDER_WINDOW);
  }, [form.classFilter, query]);
  const visibleRows = useMemo(
    () => windowCatalog(filtered, renderWindow),
    [filtered, renderWindow],
  );
  const summaries = useMemo(
    () => classDiscoverySummaries(catalog, discoveryProviders),
    [catalog, discoveryProviders],
  );
  const remaining = filtered.length - visibleRows.length;

  const handleSelectRow = useCallback((row: CatalogInstrument) => {
    const identity = nativeSelectionOf(row);
    setSelected(identity);
    setForm((prev) => ({
      ...prev,
      selectedKey: `${identity.provider}::${identity.providerInstrumentId}`,
    }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const row = findCatalogRow(catalog, selected);
    if (!row) return;
    const identity = nativeSelectionOf(row);
    onAnalyze({
      instrument: identity.providerInstrumentId,
      instrumentType: assetClassToInstrumentType(identity.assetClass),
      provider: identity.provider,
      providerInstrumentId: identity.providerInstrumentId,
      timeframe: form.timeframe,
      tradingStyle: form.tradingStyle,
      requestedTimeframe: form.timeframe,
    });
  };

  const selectValue: ClassFilter =
    form.classFilter === "indices" || form.classFilter === "macro"
      ? "all"
      : form.classFilter;

  const selectedRow = selected ? findCatalogRow(catalog, selected) : undefined;
  const waiting = catalog.length === 0;
  const notFound = !waiting && query.trim().length > 0 && filtered.length === 0;

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
            <Terminal className="size-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold font-mono">
              $ {t.entryForm.newAnalysisHeading}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
              {t.dashboard.terminalDescription}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div data-testid="discovery-status" className="text-[11px] font-mono text-muted-foreground space-y-1">
            <div>
              {t.entryForm.discoveryLabel}
              {": "}
              {discoveryProviders.length === 0
                ? t.global.loading
                : discoveryProviders.map((p, i) => {
                    const comp = completenessLabel(p.completeness, t);
                    const count = txi("entryForm.discoveredCount", { count: p.totalDiscovered ?? 0 });
                    const failed = p.catalogs?.find((c) => c.failedPage !== undefined)?.failedPage;
                    return (
                      <span key={p.provider}>
                        {i > 0 ? " · " : ""}
                        {formatProviderDisplay(p.provider)} {p.ok ? "✓" : t.status.unavailable} · {count} · {comp}
                        {failed !== undefined ? ` — ${txi("entryForm.partialPageFailed", { page: failed })}` : ""}
                      </span>
                    );
                  })}
            </div>
            {summaries.length > 0 && (
              <div data-testid="class-discovery-summary" className="flex flex-wrap gap-1.5">
                {summaries.map((s) => (
                  <span
                    key={s.assetClass}
                    className="inline-flex items-center rounded border border-border/50 bg-muted/20 px-1.5 py-0.5"
                  >
                    {assetClassLabel(s.assetClass, t)} · {txi("entryForm.discoveredCount", { count: s.count })} · {completenessLabel(s.completeness, t)}
                    {s.failedPage !== undefined ? ` — ${txi("entryForm.partialPageFailed", { page: s.failedPage })}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-2 block">
              $ {t.entryForm.instrumentsHeading}
            </Label>
            <div className="flex flex-wrap gap-1.5 items-center">
              <Select
                value={selectValue}
                onValueChange={(v) => update("classFilter", v as ClassFilter)}
              >
                <SelectTrigger className="h-8 w-auto min-w-[9rem] text-[11px] font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {classFilterLabel("all", t)} ({countForFilter(catalog, "all")})
                  </SelectItem>
                  <SelectItem value="crypto">
                    {t.entryForm.typeCrypto} ({countForFilter(catalog, "crypto")})
                  </SelectItem>
                  <SelectItem value="forex">
                    {t.entryForm.typeForex} ({countForFilter(catalog, "forex")})
                  </SelectItem>
                  <SelectItem value="stock">
                    {t.entryForm.typeStock} ({countForFilter(catalog, "stock")})
                  </SelectItem>
                  <SelectItem value="commodity">
                    {t.entryForm.typeCommodity} ({countForFilter(catalog, "commodity")})
                  </SelectItem>
                </SelectContent>
              </Select>
              {classFilters.includes("indices") && (
                <button
                  type="button"
                  onClick={() => update("classFilter", "indices")}
                  className={cn(
                    "inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-mono font-medium",
                    form.classFilter === "indices"
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.entryForm.typeIndices} ({countForFilter(catalog, "indices")})
                </button>
              )}
              {classFilters.includes("macro") && (
                <button
                  type="button"
                  onClick={() => update("classFilter", "macro")}
                  className={cn(
                    "inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-mono font-medium",
                    form.classFilter === "macro"
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.entryForm.typeMacro} ({countForFilter(catalog, "macro")})
                </button>
              )}
            </div>
          </div>

          <div>
            <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
              {t.entryForm.instrumentLabel}
            </Label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-primary/60 font-mono">$</span>
              <Input
                placeholder={t.entryForm.searchCatalog}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-7 h-9 text-sm font-mono"
                autoComplete="off"
              />
            </div>
          </div>

          {waiting ? (
            <p
              data-testid="catalog-empty"
              className="text-[11px] font-mono text-muted-foreground rounded-md border border-border/50 bg-muted/20 px-3 py-2"
            >
              {t.entryForm.discoveryWaiting}
            </p>
          ) : notFound ? (
            <p
              data-testid="catalog-not-found"
              className="text-[11px] font-mono text-muted-foreground rounded-md border border-border/50 bg-muted/20 px-3 py-2"
            >
              {t.entryForm.instrumentNotFound}
            </p>
          ) : (
            <>
              <ScrollArea className="h-48 rounded-md border border-border/50">
                <ul data-testid="instrument-catalog" className="divide-y divide-border/40">
                  {visibleRows.map((row) => {
                    const active =
                      selected?.provider === row.provider &&
                      selected?.providerInstrumentId === row.providerInstrumentId;
                    return (
                      <li key={`${row.provider}::${row.providerInstrumentId}`}>
                        <button
                          type="button"
                          data-testid="catalog-row"
                          onClick={() => handleSelectRow(row)}
                          className={cn(
                            "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] font-mono",
                            active
                              ? "bg-primary/15 text-primary"
                              : "text-foreground hover:bg-muted/40",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {row.providerInstrumentId}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {assetClassLabel(row.assetClass, t)}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatProviderDisplay(row.provider)}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {row.tradingState}
                          </span>
                          <span className="shrink-0">
                            {row.lifecycle === "LIVE" ? t.status.live : row.lifecycle}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
              {remaining > 0 && (
                <div className="flex items-center justify-between mt-2 text-[11px] font-mono text-muted-foreground">
                  <span data-testid="catalog-window-info">
                    {visibleRows.length} / {filtered.length} shown — {remaining} more via search or load more
                  </span>
                  <button
                    type="button"
                    data-testid="catalog-load-more"
                    onClick={() => setRenderWindow((w) => Math.min(w + CATALOG_RENDER_WINDOW, filtered.length))}
                    className="rounded border border-border/50 bg-muted/20 px-2 py-1 hover:bg-muted/40"
                  >
                    Load more +{Math.min(CATALOG_RENDER_WINDOW, remaining)}
                  </button>
                </div>
              )}
              {remaining === 0 && filtered.length > CATALOG_RENDER_WINDOW && (
                <div className="mt-2 text-[11px] font-mono text-muted-foreground" data-testid="catalog-complete-info">
                  All {filtered.length} filtered instruments accessible — window was rendering optimization, not ceiling. Search operates on complete catalog ({catalog.length} total).
                </div>
              )}
            </>
          )}

          {selectedRow && (
            <div
              data-testid="selected-identity"
              className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 font-mono"
            >
              <p className="text-sm text-foreground">{selectedRow.providerInstrumentId}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {assetClassLabel(selectedRow.assetClass, t)}
                {" · "}
                {formatProviderDisplay(selectedRow.provider)}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label className="text-[11px] font-mono font-medium text-muted-foreground mb-1.5 block">
                {t.entryForm.typeLabel}
              </Label>
              <div className="h-9 rounded-md border border-border/60 bg-muted/20 px-3 flex items-center text-[11px] font-mono text-muted-foreground">
                {selectedRow
                  ? assetClassLabel(selectedRow.assetClass, t)
                  : t.analysis.selectInstrument}
              </div>
            </div>
          </div>

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
                  {mapHorizon(st.toUpperCase(), t)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              disabled={!selectedRow || isAnalyzing}
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
