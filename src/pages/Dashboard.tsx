import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { InstrumentInput } from "@/components/InstrumentInput";
import { AnalysisResultDisplay } from "@/components/AnalysisResult";
import { AnalysisHistory } from "@/components/AnalysisHistory";
import { useAuth } from "@/hooks/use-auth";
import { runAnalysis, type AnalysisInput } from "@/lib/analysis-engine";
import type { AnalysisResult } from "@/types/analysis";
import type { MarketDataResult } from "@/lib/data/market-types";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery, useAction } from "convex/react";
import { fetchOptionalSlowData } from "@/lib/data/optional-providers";
import { parseSymbolCurrencies } from "@/lib/risk/spec-resolver";
import { resolveStyle, adaptSetupTimeframe } from "@/lib/trading-style";
import { discoverCandidates, type CandidateInput } from "@/lib/recommendation-engine";
import { MarketOpportunities } from "@/components/MarketOpportunities";
import type { UniversalIntelligenceContext, ForexIntelligenceContext, EquityIntelligenceContext, CommodityIntelligenceContext, CrossAssetIntelligenceContext } from "@/lib/data/universal/types";
import { LogOut, Terminal, Zap, Loader2, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";

/** Convert a Convex DB record to the AnalysisResult shape used by the UI. */
function fromDbRecord(record: any): AnalysisResult {
  return {
    id: record._id,
    instrument: record.instrument,
    instrumentType: record.instrumentType,
    timeframe: record.timeframe,
    bias: record.bias,
    confidence: record.confidence,
    recommendation: record.recommendation ?? (record.bias === "Bullish" ? "LONG" : record.bias === "Bearish" ? "SHORT" : "NO_TRADE"),
    tradingStyle: record.tradingStyle ?? "intraday",
    conviction: record.conviction ?? undefined,
    noTradeReasons: record.noTradeReasons ?? [],
    technicalSummary: record.technicalSummary,
    fundamentalSummary: record.fundamentalSummary,
    breakdown: record.breakdown,
    keyLevels: record.keyLevels,
    riskNote: record.riskNote,
    dataCompleteness: record.dataCompleteness,
    dataFlags: record.dataFlags,
    timestamp: record.timestamp,
    ...(record.price != null ? { priceSnapshot: { price: record.price, timestamp: record.timestamp, source: record.dataSource || "unknown" } } : {}),
    ...(record.dataSource ? { dataSource: record.dataSource } : {}),
    ...(record.sentimentSummary ? { sentimentData: { provider: "alpha-vantage", timestamp: record.timestamp, averageScore: record.sentimentScore ?? 0, articleCount: 0, label: (record.sentimentScore ?? 0) > 0.15 ? "bullish" : (record.sentimentScore ?? 0) < -0.15 ? "bearish" : "neutral", breakdown: { positive: 0, negative: 0, neutral: 0 }, confidence: "medium" as const, articles: [] } } : {}),
    ...(record.macroSummary ? { macroData: { provider: "alpha-vantage", timestamp: record.timestamp, indicators: [], summary: record.macroSummary, confidence: "medium" as const } } : {}),
    ...(record.derivativesSummary ? { derivativesData: { provider: "coinglass", symbol: record.instrument, timestamp: record.timestamp, freshness: "delayed" as const, availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true }, confidence: "medium" as const, interpretation: record.derivativesSummary } } : {}),
    ...(record.calendarSummary ? { calendarData: { provider: "tickatlas" as const, events: [], macroRisk: { level: "medium" as const, explanation: record.calendarSummary, highImpact24h: 0, highImpact72h: 0 }, timestamp: record.timestamp, freshness: "recent" as const, confidence: "medium" as const, availability: { upcoming24h: false, upcoming72h: false, recentReleased: false } } } : {}),
  };
}

/** Loading step for the multi-step sequence. */
interface LoadingStep {
  label: string;
  status: "pending" | "active" | "done" | "error";
}

const INITIAL_STEPS: LoadingStep[] = [
  { label: "Detecting instrument", status: "pending" },
  { label: "Fetching market data", status: "pending" },
  { label: "Fetching intelligence data", status: "pending" },
  { label: "Calculating indicators", status: "pending" },
  { label: "Generating bias", status: "pending" },
];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null);
  const [loadingSteps, setLoadingSteps] = useState<LoadingStep[]>(INITIAL_STEPS);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Phase 14 P3 — run identity: a slow/abandoned analysis run must NEVER
  // overwrite the result of a newer run (stale-result mixing guard).
  const runTokenRef = useRef(0);

  // Convex persistence
  const saveAnalysis = useMutation(api.analyses.save);
  const dbHistory = useQuery(api.analyses.list);

  // Convex actions for server-side data fetching
  const fetchMarketData = useAction(api.marketData.fetchMarketData);
  const fetchFxRate = useAction(api.marketData.fetchFxRate);
  const fetchIntelligence = useAction(api.alphaVantage.fetchIntelligence);
  const fetchDerivatives = useAction(api.coinglass.fetchDerivatives);
  const fetchCalendar = useAction(api.tradingEconomics.fetchCalendar);
  const fetchTreasuryYields = useAction(api.treasury.fetchTreasuryYields);
  const fetchCotPositioning = useAction(api.cot.fetchCotPositioning);
  const fetchEiaInventory = useAction(api.eia.fetchEiaInventory);
  const fetchOkxOrderBook = useAction(api.okx.fetchOkxOrderBook);
  const fetchOkxInstrumentSpec = useAction(api.okx.fetchOkxInstrumentSpec);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const updateStep = useCallback((index: number, status: LoadingStep["status"]) => {
    setLoadingSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, status } : step)),
    );
  }, []);

  const handleAnalyze = useCallback(
    async (input: AnalysisInput) => {
      const myRun = ++runTokenRef.current;
      const isStaleRun = () => runTokenRef.current !== myRun;
      setIsAnalyzing(true);
      setCurrentResult(null);
      setFetchError(null);

      // Reset loading steps
      setLoadingSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" as const })));

      try {
        // Step 1: Detecting instrument
        updateStep(0, "active");
        await new Promise((r) => setTimeout(r, 300));
        updateStep(0, "done");

        // Phase 6 — style-adaptive setup timeframe selection over the EXISTING
        // ladder, applied BEFORE fetching. Fallback uses REAL provider data
        // for a supported timeframe and is disclosed in the result.
        const styleProfile = resolveStyle(input.tradingStyle);
        const adapted = adaptSetupTimeframe(
          styleProfile.style,
          input.requestedTimeframe ?? input.timeframe,
        );
        input.timeframe = adapted.timeframe as AnalysisInput["timeframe"];
        if (adapted.fallbackApplied) {
          input.styleNotes = [adapted.reason!];
        }
        input.requestedTimeframe = undefined;

        // Step 2: Fetching market data + intelligence + derivatives in parallel
        updateStep(1, "active");
        let marketDataResult: MarketDataResult;
        let intelligenceResult: any = null;
        let derivativesResult: any = null;
        let calendarResult: any = null;
        try {
          // Build fetch promises
          const fetchPromises: Promise<any>[] = [
            fetchMarketData({
              instrument: input.instrument,
              instrumentType: input.instrumentType,
              timeframe: input.timeframe,
            }),
            fetchIntelligence({
              instrument: input.instrument,
              instrumentType: input.instrumentType,
            }),
            fetchCalendar({
              instrument: input.instrument,
              instrumentType: input.instrumentType,
            }),
          ];
          if (input.instrumentType === "crypto") {
            fetchPromises.push(
              fetchDerivatives({ instrument: input.instrument }),
            );
          }

          const results = await Promise.allSettled(fetchPromises);
          const marketResult = results[0];
          const intelResult = results[1];
          calendarResult = results[2];
          const derivResult = input.instrumentType === "crypto" ? results[3] : undefined;

          // Market data is critical
          if (marketResult.status === "fulfilled") {
            marketDataResult = marketResult.value as MarketDataResult;
          } else {
            throw new Error(marketResult.reason?.message || "Market data fetch failed");
          }

          if (!marketDataResult.success || !marketDataResult.data) {
            throw new Error(marketDataResult.error || "Market data unavailable");
          }
          updateStep(1, "done");

          // Intelligence is non-critical
          if (intelResult.status === "fulfilled") {
            intelligenceResult = intelResult.value;
          }
          // Calendar is non-critical
          if (calendarResult && calendarResult.status === "fulfilled") {
            calendarResult = calendarResult.value;
          }
          // Derivatives is non-critical
          if (derivResult && derivResult.status === "fulfilled") {
            derivativesResult = derivResult.value;
          }
        } catch (err: any) {
          updateStep(1, "error");
          setFetchError(`Data fetch failed: ${err?.message || "provider not configured"}`);
          setIsAnalyzing(false);
          return;
        }

        // Step 3: Fetching intelligence data
        updateStep(2, "active");
        if (intelligenceResult?.success) {
          updateStep(2, "done");
        } else {
          // Intelligence unavailable — continue without it
          updateStep(2, "done");
        }

        // Step 4: Calculating indicators (already done in Convex action)
        updateStep(3, "active");
        await new Promise((r) => setTimeout(r, 150));
        updateStep(3, "done");

        // Step 5: Generate bias
        updateStep(4, "active");

        // Phase 4 — live FX snapshots for account-currency-aware sizing.
        // Phase 15 — OPTIONAL slow-data providers now run CONCURRENTLY.
        // These legs are provably independent of each other (no data
        // dependencies), each keeps its EXACT conditional policy and non-fatal
        // failure semantics (see lib/data/optional-providers.ts), each provider
        // is still invoked at most once per analysis, and the Phase-14 race
        // guard remains the sole authority for state updates. Parallelism
        // changes WHEN data is fetched — never WHAT the data means.

        // FX pair resolution stays synchronous (depends only on user input).
        let fxPair: { from: string; to: string } | undefined;
        if (input.accountCurrency) {
          const quoteCcy =
            input.instrumentSpec?.quoteCurrency ??
            parseSymbolCurrencies(input.instrument).quote;
          const acct = input.accountCurrency.toUpperCase();
          if (quoteCcy && quoteCcy.toUpperCase() !== acct) {
            // Fetched ONLY when an explicit account currency differs from the
            // instrument's quote currency. Failure is non-fatal: the engine
            // reports sizing as unavailable instead of inventing a rate.
            fxPair = { from: quoteCcy, to: acct };
          }
        }

        const {
          fxRates,
          treasuryData,
          cotData,
          eiaData,
          executionData,
          okxSpecData,
        } = await fetchOptionalSlowData(
          {
            instrumentType: input.instrumentType,
            instrument: input.instrument,
            tradingStyle: input.tradingStyle,
            hasCompleteSpec: !!(
              input.instrumentSpec?.contractSize &&
              input.instrumentSpec?.quantityStep
            ),
          },
          {
            fx: fxPair
              ? () => fetchFxRate({ from: fxPair!.from, to: fxPair!.to })
              : undefined,
            cot: () => fetchCotPositioning({ instrument: input.instrument }),
            execution: () => fetchOkxOrderBook({ instrument: input.instrument }),
            eia: () => fetchEiaInventory({}),
            treasury: () => fetchTreasuryYields({}),
            okxSpec: () =>
              fetchOkxInstrumentSpec({ instrument: input.instrument }),
          },
        );

        const enrichedInput: AnalysisInput = {
          ...input,
          marketData: marketDataResult.data,
          technicalData: marketDataResult.technical,
          sentimentData: intelligenceResult?.sentiment,
          fundamentalData: intelligenceResult?.fundamentals,
          macroData: intelligenceResult?.macro,
          derivativesData: derivativesResult?.data,
          calendarData: calendarResult?.data,
          fxRates,
          treasuryData,
          cotData,
          eiaData,
          executionData,
          okxSpecData,
        };

        // Phase 44-45 — Build universal intelligence context for non-crypto instruments.
        // Crypto uses its own CryptoIntelligenceContext (Phase 41-43).
        if (input.instrumentType !== "crypto") {
          try {
            const now = Date.now();
            const meta = (provider: string) => ({
              provider,
              observedAt: now,
              freshness: "FRESH" as const,
              quality: "DEGRADED" as const,
              available: false,
              availableDatasets: 0,
              totalDatasets: 0,
            });

            // Build forex intelligence context
            let forexCtx: ForexIntelligenceContext | undefined;
            if (input.instrumentType === "forex") {
              forexCtx = {
                instrument: input.instrument,
                instrumentType: "forex",
                assembledAt: now,
                rates: treasuryData?.available ? {
                  ...meta("treasury"),
                  available: true,
                  quality: "VERIFIED",
                  availableDatasets: 1,
                  totalDatasets: 1,
                  rateDifferential: undefined,
                } : undefined,
                positioning: cotData?.available ? {
                  ...meta("cftc"),
                  available: true,
                  quality: "DEGRADED",
                  availableDatasets: 1,
                  totalDatasets: 1,
                  nonCommercialNet: cotData.mappedAsset ? undefined : undefined,
                  commercialNet: undefined,
                } : undefined,
                macro: calendarResult?.data ? {
                  ...meta("trading-economics"),
                  available: true,
                  quality: "VERIFIED",
                  availableDatasets: 1,
                  totalDatasets: 1,
                  upcomingEvents: calendarResult.data.events?.filter((e: any) => e.status === "upcoming").slice(0, 5).map((e: any) => ({
                    name: e.event,
                    date: new Date(e.datetime).toISOString().slice(0, 10),
                    impact: e.importance === 3 ? "high" : e.importance === 2 ? "medium" : "low",
                  })) ?? [],
                } : undefined,
                crossAsset: {
                  ...meta("cross-asset"),
                  available: true,
                  quality: "DEGRADED",
                  availableDatasets: 1,
                  totalDatasets: 1,
                  riskRegime: "unknown",
                },
                evidence: [],
                overallAvailability: "PARTIAL",
                overallQuality: "DEGRADED",
                missingInformation: [],
                analystSummary: `Forex intelligence assembled for ${input.instrument}.`,
              };
            }

            // Build equity intelligence context
            let equityCtx: EquityIntelligenceContext | undefined;
            if (input.instrumentType === "stock") {
              const fundamentals = intelligenceResult?.fundamentals;
              equityCtx = {
                instrument: input.instrument,
                instrumentType: "equity",
                assembledAt: now,
                fundamentals: fundamentals?.available ? {
                  ...meta("alpha-vantage"),
                  available: true,
                  quality: "VERIFIED",
                  availableDatasets: 5,
                  totalDatasets: 5,
                  peRatio: fundamentals.peRatio,
                  marketCap: fundamentals.marketCap,
                  profitMargin: fundamentals.profitMargin,
                  revenueGrowth: fundamentals.revenueGrowth,
                } : undefined,
                sector: fundamentals?.sector ? {
                  sector: fundamentals.sector,
                  industry: fundamentals.industry,
                } : undefined,
                evidence: [],
                overallAvailability: fundamentals?.available ? "PARTIAL" : "MINIMAL",
                overallQuality: fundamentals?.available ? "VERIFIED" : "UNAVAILABLE",
                missingInformation: fundamentals?.available ? [] : ["Fundamental data unavailable"],
                analystSummary: `Equity intelligence assembled for ${input.instrument}.`,
              };
            }

            // Build commodity intelligence context
            let commodityCtx: CommodityIntelligenceContext | undefined;
            if (input.instrumentType === "commodity") {
              commodityCtx = {
                instrument: input.instrument,
                instrumentType: "commodity",
                assembledAt: now,
                inventory: eiaData?.available ? {
                  ...meta("eia"),
                  available: true,
                  quality: "DEGRADED",
                  availableDatasets: 1,
                  totalDatasets: 1,
                  currentInventory: eiaData.series?.[0]?.latestValue,
                  changeWeekly: eiaData.series?.[0]?.change,
                } : undefined,
                positioning: cotData?.available ? {
                  ...meta("cftc"),
                  available: true,
                  quality: "DEGRADED",
                  availableDatasets: 1,
                  totalDatasets: 1,
                } : undefined,
                evidence: [],
                overallAvailability: (eiaData?.available || cotData?.available) ? "PARTIAL" : "MINIMAL",
                overallQuality: "DEGRADED",
                missingInformation: [
                  ...(!eiaData?.available ? ["EIA inventory data"] : []),
                  ...(!cotData?.available ? ["CFTC COT positioning"] : []),
                ],
                analystSummary: `Commodity intelligence assembled for ${input.instrument}.`,
              };
            }

            // Build cross-asset context (always available for non-crypto)
            const crossAssetCtx: CrossAssetIntelligenceContext = {
              assembledAt: now,
              treasury: treasuryData?.available ? {
                ...meta("treasury"),
                available: true,
                quality: "VERIFIED",
                availableDatasets: 2,
                totalDatasets: 2,
                tenYear: treasuryData.latest?.nominal?.nominal?.["10Y"],
                yieldCurve: undefined,
              } : undefined,
              evidence: [],
              overallAvailability: treasuryData?.available ? "PARTIAL" : "MINIMAL",
              overallQuality: "DEGRADED",
              missingInformation: [
                ...(!treasuryData?.available ? ["Treasury yield data"] : []),
                "DXY data (live)",
                "Risk regime data",
              ],
              analystSummary: `Cross-asset context assembled for ${input.instrument}.`,
            };

            // Construct universal intelligence context
            const universalCtx: UniversalIntelligenceContext = {
              instrument: input.instrument,
              assetClass: input.instrumentType === "forex" ? "forex" : input.instrumentType === "stock" ? "equity" : input.instrumentType === "commodity" ? "commodity" : "macro",
              assembledAt: now,
              forex: forexCtx,
              equity: equityCtx,
              commodity: commodityCtx,
              crossAsset: crossAssetCtx,
              evidence: [],
              overallAvailability: "PARTIAL",
              overallQuality: "DEGRADED",
              missingInformation: [
                ...(!treasuryData?.available ? ["Treasury yield data"] : []),
                ...(!cotData?.available ? ["CFTC COT positioning"] : []),
                ...(!eiaData?.available ? ["EIA inventory data"] : []),
                ...(!intelligenceResult?.fundamentals?.available ? ["Fundamental data"] : []),
              ],
              dataFlags: [],
              analystSummary: `Universal intelligence assembled for ${input.instrument}.`,
            };

            enrichedInput.universalIntelligenceContext = universalCtx;
          } catch {
            // Universal intelligence is informational — failure is non-fatal
          }
        }

        const result = runAnalysis(enrichedInput);

        await new Promise((r) => setTimeout(r, 150));
        updateStep(4, "done");

        // A newer analysis superseded this run — drop the stale result.
        if (isStaleRun()) return;

        setCurrentResult(result);

        // Persist to Convex (fire-and-forget)
        try {
          await saveAnalysis({
            instrument: result.instrument,
            instrumentType: result.instrumentType,
            timeframe: result.timeframe,
            bias: result.bias,
            confidence: result.confidence,
            recommendation: result.recommendation,
            conviction: result.conviction,
            noTradeReasons: result.noTradeReasons.length > 0 ? result.noTradeReasons : undefined,
            riskReward: result.tradePlan?.riskReward,
            tradingStyle: result.tradingStyle,
            technicalSummary: result.technicalSummary,
            fundamentalSummary: result.fundamentalSummary,
            breakdown: result.breakdown,
            keyLevels: result.keyLevels,
            riskNote: result.riskNote,
            dataCompleteness: result.dataCompleteness,
            dataFlags: result.dataFlags,
            price: result.priceSnapshot?.price,
            dataSource: result.dataSource,
            sentimentSummary: result.sentimentData?.confidence !== "unavailable" ? `${result.sentimentData?.label} (${result.sentimentData?.articleCount ?? 0} articles)` : undefined,
            sentimentScore: result.sentimentData?.confidence !== "unavailable" ? result.sentimentData?.averageScore : undefined,
            macroSummary: result.macroData?.confidence !== "unavailable" ? result.macroData?.summary : undefined,
            derivativesSummary: result.derivativesData?.confidence !== "unavailable" ? result.derivativesData?.interpretation : undefined,
            calendarSummary: result.calendarData?.confidence !== "unavailable" ? `Macro risk: ${result.calendarData?.macroRisk.level} — ${result.calendarData?.macroRisk.explanation}` : undefined,
          });
        } catch {
          // Save failed (guest user) — analysis still shows in session
        }
      } catch (err: any) {
        if (!isStaleRun()) {
          setFetchError(`Analysis failed: ${err?.message || "unknown error"}`);
        }
      } finally {
        // Only the newest run owns the loading UI; stale runs exit silently.
        if (!isStaleRun()) {
          setIsAnalyzing(false);
        }
      }
    },
    [fetchMarketData, fetchIntelligence, fetchCalendar, fetchDerivatives, fetchTreasuryYields, fetchCotPositioning, fetchEiaInventory, fetchOkxOrderBook, fetchOkxInstrumentSpec, saveAnalysis, updateStep],
  );

  const handleSelectHistory = useCallback((analysis: AnalysisResult) => {
    setCurrentResult(analysis);
  }, []);

  const history: AnalysisResult[] = dbHistory
    ? dbHistory.map(fromDbRecord)
    : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
              <Terminal className="size-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight font-mono">
                XstarzG<span className="text-muted-foreground"> · </span>
                <span className="text-primary">Trader</span>
              </h1>
              <p className="text-[10px] text-muted-foreground -mt-0.5 font-mono">chief market strategist</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground font-mono hidden sm:block">
              {user?.name || user?.email || "guest"}
            </span>
            <Separator orientation="vertical" className="h-5 hidden sm:block" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline text-xs font-mono">exit</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left — Input + History */}
          <div className="lg:col-span-4 space-y-4">
            <InstrumentInput onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} />

            <div className="hidden lg:block">
              <AnalysisHistory
                analyses={history}
                onSelect={handleSelectHistory}
                selectedId={currentResult?.id}
              />
            </div>

            {/* Phase 49 — Market Opportunities: ranked candidates from instrument registry discovery */}
            <div className="hidden lg:block">
              <MarketOpportunities
                candidates={discoverCandidates().map((d) => ({
                  instrument: d.instrument,
                  assetClass: d.assetClass,
                  currentPrice: 0,
                  dataCompleteness: "MINIMAL",
                  dataPoints: 0,
                  hasLiveData: false,
                  freshness: "UNAVAILABLE",
                  providerCoverage: "PARTIAL",
                } as CandidateInput))}
              />
            </div>
          </div>

          {/* Right — Results */}
          <div className="lg:col-span-8">
            <AnimatePresence mode="wait">
              {isAnalyzing ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col items-center justify-center py-16 text-center"
                >
                  <div className="relative mb-6">
                    <div className="size-16 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Zap className="size-6 text-primary" />
                    </div>
                  </div>

                  {/* Multi-step loading sequence */}
                  <div className="w-full max-w-xs space-y-2.5">
                    {loadingSteps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        {step.status === "done" ? (
                          <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                        ) : step.status === "error" ? (
                          <span className="size-4 flex items-center justify-center text-red-400 shrink-0">✗</span>
                        ) : step.status === "active" ? (
                          <Loader2 className="size-4 animate-spin text-primary shrink-0" />
                        ) : (
                          <div className="size-4 rounded-full border border-border/50 shrink-0" />
                        )}
                        <span
                          className={`text-xs font-mono ${
                            step.status === "active"
                              ? "text-foreground"
                              : step.status === "done"
                                ? "text-emerald-400"
                                : step.status === "error"
                                  ? "text-red-400"
                                  : "text-muted-foreground/50"
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>

                  {fetchError && (
                    <div className="mt-4 max-w-sm rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
                      <p className="text-xs font-mono text-red-400">{fetchError}</p>
                      <p className="text-[10px] font-mono text-red-400/60 mt-1">
                        Check that TWELVE_DATA_API_KEY is configured in the Keys tab.
                      </p>
                    </div>
                  )}
                </motion.div>
              ) : currentResult ? (
                <motion.div
                  key={currentResult.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                >
                  <AnalysisResultDisplay result={currentResult} />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-24 text-center"
                >
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/50 mb-4">
                    <Terminal className="size-7 text-muted-foreground/40" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground font-mono">
                    Terminal Ready
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground max-w-sm font-mono">
                    Pilih instrumen dan run analysis — struktur, liquidity, positioning
                    dan fundamental diambil otomatis dari backend.
                  </p>
                  <div className="mt-6 grid grid-cols-3 gap-3 max-w-sm">
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary font-mono">4</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">faktor</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary font-mono">5</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">timeframes</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary font-mono">∞</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">instrumen</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* History — Mobile */}
            <div className="lg:hidden mt-6">
              <AnalysisHistory
                analyses={history}
                onSelect={handleSelectHistory}
                selectedId={currentResult?.id}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
