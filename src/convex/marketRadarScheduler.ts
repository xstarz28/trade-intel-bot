/**
 * Durable background market scanner.
 *
 * The cron owns discovery cadence and checkpoints; provider actions remain
 * bounded by the existing provider request budgets. The foreground dashboard
 * scanner remains available for immediate refresh and low-latency views.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { anyApi } from "convex/server";
import { internalAction, query } from "./_generated/server";
import { DEFAULT_UNIVERSE } from "../lib/market-radar/universe";
import { ALL_SCAN_HORIZONS } from "../lib/liveScanner";
import { selectBackgroundScanBatch } from "../lib/market-radar/background-schedule";
import {
  scanRadar,
  type RadarState,
} from "../lib/market-radar/radar";
import {
  toRadarCandidateSource,
  type RadarCandidateSource,
} from "../lib/market-radar/candidate-builder";
import type { RadarOpportunity } from "../lib/market-radar/types";
import type { LiveCandidateSource } from "../lib/liveCandidateBuilder";
import type { MarketData, TechnicalData } from "../lib/data/market-types";
import { runAnalysis, type AnalysisInput, type AnalysisResult } from "../lib/analysis-engine";
import { buildCryptoIntelligenceContext } from "../lib/data/crypto/intelligence";
import { parseCoinGlassResult } from "../lib/data/crypto/coinglass-adapter";
import { parseDeFiLlamaResult } from "../lib/data/crypto/defillama-adapter";

const GLOBAL_SCOPE = "global";
const SOURCE_LIMIT = 300;
const CANDLES_TO_PERSIST = 40;

function sourceKey(source: LiveCandidateSource): string {
  const timeframe = source.marketData?.timeframe?.trim().toUpperCase() ?? "UNKNOWN";
  return `${source.instrument.trim().toUpperCase()}|${timeframe}`;
}

function compactSource(source: LiveCandidateSource): LiveCandidateSource {
  const marketData = source.marketData;
  if (!marketData) return source;
  const analysis = source.analysisResult;
  const compactAnalysis = analysis ? {
    id: analysis.id,
    instrument: analysis.instrument,
    instrumentType: analysis.instrumentType,
    timeframe: analysis.timeframe,
    bias: analysis.bias,
    confidence: analysis.confidence,
    recommendation: analysis.recommendation,
    conviction: analysis.conviction,
    noTradeReasons: analysis.noTradeReasons,
    tradingStyle: analysis.tradingStyle,
    tradePlan: analysis.tradePlan,
    projectedTradePlan: analysis.projectedTradePlan,
    mtfSummary: analysis.mtfSummary,
    longHorizonThesis: analysis.longHorizonThesis,
    breakdown: analysis.breakdown,
    dataCompleteness: analysis.dataCompleteness,
    dataFlags: analysis.dataFlags,
    priceSnapshot: analysis.priceSnapshot,
    fundamentalData: analysis.fundamentalData,
    sentimentData: analysis.sentimentData,
    macroData: analysis.macroData,
    derivativesData: analysis.derivativesData,
    calendarData: analysis.calendarData,
    treasuryContext: analysis.treasuryContext,
    cotContext: analysis.cotContext,
    eiaContext: analysis.eiaContext,
    cryptoIntelligenceContext: analysis.cryptoIntelligenceContext,
    universalIntelligenceContext: analysis.universalIntelligenceContext,
    timestamp: analysis.timestamp,
  } as AnalysisResult : undefined;
  const compact = {
    instrument: source.instrument,
    assetClass: source.assetClass,
    ...(source.providerNative ? { providerNative: source.providerNative } : {}),
    marketData: {
      ...marketData,
      candles: marketData.candles.slice(-CANDLES_TO_PERSIST),
      ...(marketData.higherTimeframeCandles
        ? { higherTimeframeCandles: marketData.higherTimeframeCandles.slice(-CANDLES_TO_PERSIST) }
        : {}),
    },
    ...(source.technicalData ? { technicalData: source.technicalData } : {}),
    ...(compactAnalysis ? { analysisResult: compactAnalysis } : {}),
    ...(source.universalIntelligence ? { universalIntelligence: source.universalIntelligence } : {}),
    ...(source.derivativesData ? { derivativesData: source.derivativesData } : {}),
    ...(source.calendarData ? { calendarData: source.calendarData } : {}),
    ...(source.treasuryData ? { treasuryData: source.treasuryData } : {}),
    ...(source.cotData ? { cotData: source.cotData } : {}),
    ...(source.eiaData ? { eiaData: source.eiaData } : {}),
  };
  // Convex values cannot contain undefined; JSON round-tripping strips absent
  // optional fields before persistence while retaining provider timestamps.
  return JSON.parse(JSON.stringify(compact)) as LiveCandidateSource;
}

async function callOptionalProvider<T>(
  run: () => Promise<T>,
  label: string,
  errors: string[],
): Promise<T | undefined> {
  try {
    const result = await run();
    const envelope = result as { success?: boolean; error?: string; errorCode?: string; status?: string };
    if (envelope?.success === false) {
      const reason = [envelope.errorCode, envelope.status, envelope.error].filter(Boolean).join(": ");
      if (!(label === "DeFiLlama" && /UNSUPPORTED|NOT_SUPPORTED|NO_MAPPING/i.test(reason))) {
        errors.push(`${label}: ${reason || "provider unavailable"}`);
      }
      return undefined;
    }
    return result;
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function toInstrumentType(assetClass: string): "forex" | "crypto" | "stock" | "commodity" | "indices" | undefined {
  if (assetClass === "equity") return "stock";
  if (assetClass === "forex" || assetClass === "crypto" || assetClass === "commodity" || assetClass === "indices") {
    return assetClass;
  }
  return undefined;
}

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const state = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();
    if (!state) return null;

    const rows = await ctx.db
      .query("marketRadarSources")
      .withIndex("by_updated_at")
      .order("desc")
      .take(SOURCE_LIMIT);

    return {
      lastScanAt: state.lastScanAt,
      metrics: state.metrics,
      errors: state.errors,
      sources: rows.map((row) => row.payload as LiveCandidateSource),
    };
  },
});

export const runScheduledScan = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const claim = await ctx.runMutation(anyApi.marketRadarInternal.claimScan, { now }) as
      | { claimed: false }
      | { claimed: true; cursor: number; previousResults: Array<[string, RadarOpportunity[]]>; lastScanAt: number };
    if (!claim.claimed) return { skipped: true as const, reason: "previous scan still holds the lease" };

    try {
      const universe = DEFAULT_UNIVERSE.filter((entry) => entry.assetClass !== "macro");
      if (universe.length === 0) throw new Error("market radar universe is empty");

      // Three rotating passes cover H1/D1, H4/W1, and M5/H1. Two acquisitions
      // per minute preserve the shared provider request budget.
      const batch = selectBackgroundScanBatch(claim.cursor, universe.length);
      const entry = universe[batch.instrumentIndex]!;
      const instrumentType = toInstrumentType(entry.assetClass);
      const timeframes = batch.timeframes;

      const existingSources = (await ctx.runQuery(anyApi.marketRadarInternal.listSources, {}) as LiveCandidateSource[])
        .filter((source) => !!source && typeof source.instrument === "string" &&
          !!source.marketData && Array.isArray(source.marketData.candles));
      const sourceMap = new Map<string, LiveCandidateSource>(
        existingSources.map((source) => [sourceKey(source), source] as const),
      );
      const updates: Array<{
        key: string;
        instrument: string;
        timeframe: string;
        assetClass: string;
        payload: LiveCandidateSource;
        updatedAt: number;
      }> = [];
      const errors: string[] = [];

      if (!instrumentType) {
        errors.push(`Unsupported asset class for ${entry.instrument}: ${entry.assetClass}`);
      } else {
        // Asset-specific enrichment runs once per instrument visit and is
        // reused across both timeframe analyses. Each provider is isolated:
        // one outage never suppresses independent evidence from other sources.
        const intelligencePromise = callOptionalProvider(
          () => ctx.runAction(anyApi.alphaVantage.fetchIntelligence, {
            instrument: entry.instrument, instrumentType,
          }),
          "Alpha Vantage intelligence",
          errors,
        );
        const calendarPromise = callOptionalProvider(
          () => ctx.runAction(anyApi.tradingEconomics.fetchCalendar, {
            instrument: entry.instrument, instrumentType,
          }),
          "Economic calendar",
          errors,
        );
        const treasuryPromise = entry.assetClass === "forex" || entry.assetClass === "commodity"
          ? callOptionalProvider(
              () => ctx.runAction(anyApi.treasury.fetchTreasuryYields, {}),
              "Treasury yields",
              errors,
            )
          : Promise.resolve(undefined);
        const cotPromise = entry.requiredCapabilities.includes("cot")
          ? callOptionalProvider(
              () => ctx.runAction(anyApi.cot.fetchCotPositioning, { instrument: entry.instrument }),
              "CFTC COT positioning",
              errors,
            )
          : Promise.resolve(undefined);
        const eiaPromise = entry.requiredCapabilities.includes("eia")
          ? callOptionalProvider(
              () => ctx.runAction(anyApi.eia.fetchEiaInventory, {}),
              "EIA inventory",
              errors,
            )
          : Promise.resolve(undefined);
        const derivativesPromise = entry.assetClass === "crypto" && entry.requiredCapabilities.includes("derivatives")
          ? callOptionalProvider(
              () => ctx.runAction(anyApi.coinglass.fetchDerivatives, { instrument: entry.instrument }),
              "CoinGlass derivatives",
              errors,
            )
          : Promise.resolve(undefined);
        const defiPromise = entry.assetClass === "crypto"
          ? callOptionalProvider(
              () => ctx.runAction(anyApi.coinglass.fetchDeFiLlamaFundamentals, { instrument: entry.instrument }),
              "DeFiLlama",
              errors,
            )
          : Promise.resolve(undefined);

        const [intelligenceResult, calendarResult, treasuryResult, cotResult, eiaResult, derivativesResult, defiResult] =
          await Promise.all([
            intelligencePromise,
            calendarPromise,
            treasuryPromise,
            cotPromise,
            eiaPromise,
            derivativesPromise,
            defiPromise,
          ]);

        const intelligence = intelligenceResult as {
          sentiment?: AnalysisInput["sentimentData"];
          fundamentals?: AnalysisInput["fundamentalData"];
          macro?: AnalysisInput["macroData"];
        } | undefined;
        const calendarData = (calendarResult as { data?: AnalysisInput["calendarData"] } | undefined)?.data;
        const treasuryData = (treasuryResult as { data?: AnalysisInput["treasuryData"] } | undefined)?.data;
        const cotData = (cotResult as { data?: AnalysisInput["cotData"] } | undefined)?.data;
        const eiaData = (eiaResult as { data?: AnalysisInput["eiaData"] } | undefined)?.data;
        const derivativesData = (derivativesResult as { data?: AnalysisInput["derivativesData"] } | undefined)?.data;

        let cryptoIntelligenceContext: AnalysisInput["cryptoIntelligenceContext"];
        if (entry.assetClass === "crypto") {
          const derivativesEnvelope = derivativesResult as {
            data?: Record<string, unknown> & { timestamp?: number };
            tokenomics?: NonNullable<AnalysisInput["cryptoIntelligenceContext"]>["tokenomics"];
          } | undefined;
          const defiEnvelope = defiResult as { data?: Record<string, unknown>; observedAt?: number } | undefined;
          const derivativesContext = derivativesEnvelope?.data
            ? parseCoinGlassResult(derivativesEnvelope.data, entry.instrument, derivativesEnvelope.data.timestamp ?? now)
            : undefined;
          const defiContext = defiEnvelope?.data
            ? parseDeFiLlamaResult(defiEnvelope.data, entry.instrument, defiEnvelope.observedAt ?? now)
            : undefined;
          cryptoIntelligenceContext = buildCryptoIntelligenceContext(
            entry.instrument,
            derivativesContext,
            defiContext,
            derivativesEnvelope?.tokenomics,
          ) ?? undefined;
        }

        for (const timeframe of timeframes) {
          const response = await ctx.runAction(anyApi.marketData.fetchMarketData, {
            instrument: entry.instrument,
            instrumentType,
            timeframe,
          }) as
            | { success: true; data: MarketData; technical?: TechnicalData }
            | { success: false; error?: string; errorCode?: string };
          if (!response.success || !response.data) {
            const failure = response as { error?: string; errorCode?: string };
            errors.push(`${entry.instrument} ${timeframe}: ${failure.error ?? "provider returned no market data"}`);
            if (failure.errorCode === "RATE_LIMIT") break;
            continue;
          }

          let analysisResult: AnalysisResult | undefined;
          try {
            const tradingStyle: NonNullable<AnalysisInput["tradingStyle"]> =
              timeframe === "M5" ? "scalping" : timeframe === "H1" ? "intraday" : "swing";
            const analysisInput: AnalysisInput = {
              instrument: entry.instrument,
              instrumentType,
              timeframe: timeframe as AnalysisInput["timeframe"],
              tradingStyle,
              marketData: response.data,
              technicalData: response.technical,
              sentimentData: intelligence?.sentiment,
              fundamentalData: intelligence?.fundamentals,
              macroData: intelligence?.macro,
              derivativesData,
              calendarData,
              treasuryData,
              cotData,
              eiaData,
              cryptoIntelligenceContext,
            };
            analysisResult = runAnalysis(analysisInput);
          } catch (error) {
            errors.push(`${entry.instrument} ${timeframe} analysis: ${error instanceof Error ? error.message : String(error)}`);
          }

          const liveSource: LiveCandidateSource = compactSource({
            instrument: entry.instrument,
            assetClass: entry.assetClass,
            marketData: response.data as MarketData,
            ...(response.technical ? { technicalData: response.technical as TechnicalData } : {}),
            ...(analysisResult ? { analysisResult } : {}),
            ...(derivativesData ? { derivativesData } : {}),
            ...(calendarData ? { calendarData } : {}),
            ...(treasuryData ? { treasuryData } : {}),
            ...(cotData ? { cotData } : {}),
            ...(eiaData ? { eiaData } : {}),
          });
          const key = sourceKey(liveSource);
          sourceMap.set(key, liveSource);
          updates.push({
            key,
            instrument: entry.instrument,
            timeframe,
            assetClass: entry.assetClass,
            payload: liveSource,
            updatedAt: now,
          });
        }
      }

      const allLiveSources = Array.from(sourceMap.values());
      const universeByInstrument = new Map(universe.map((item) => [item.instrument, item]));
      const radarSources: RadarCandidateSource[] = allLiveSources.flatMap((source) => {
        if (!universeByInstrument.has(source.instrument)) return [];
        return [toRadarCandidateSource(source, allLiveSources)];
      });

      const previousEntries = Array.isArray(claim.previousResults)
        ? claim.previousResults as Array<[string, RadarOpportunity[]]>
        : [];
      const previous = new Map<string, RadarOpportunity>();
      for (const [, opportunities] of previousEntries) {
        for (const opportunity of opportunities) {
          if (!previous.has(opportunity.instrument)) previous.set(opportunity.instrument, opportunity);
        }
      }
      const previousState: RadarState = { previous, lastScanAt: claim.lastScanAt };
      const scan = scanRadar(
        radarSources,
        { horizons: ALL_SCAN_HORIZONS, maxResults: 10 },
        previousState,
        now,
      );

      const metrics = {
        totalScanned: scan.totalScanned,
        totalWithLiveData: scan.totalWithLiveData,
        totalInsufficient: scan.totalInsufficient,
        freshCount: scan.freshCount,
        delayedCount: scan.delayedCount,
        staleCount: scan.staleCount,
        unavailableCount: scan.unavailableCount,
        durationMs: scan.durationMs,
      };

      const saved = await ctx.runMutation(anyApi.marketRadarInternal.persistScan, {
        updates,
        cursor: batch.nextCursor,
        results: JSON.parse(JSON.stringify(Array.from(scan.results.entries()))),
        diffs: JSON.parse(JSON.stringify(scan.diffs)),
        metrics,
        errors,
        lastScanAt: now,
      }) as { savedSources: number; lastScanAt: number };

      return {
        skipped: false as const,
        instrument: entry.instrument,
        timeframes,
        acquired: updates.length,
        savedSources: saved.savedSources,
        scanned: scan.totalScanned,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(anyApi.marketRadarInternal.releaseScan, {
        now: Date.now(),
        error: message,
      });
      return { skipped: false as const, error: message.slice(0, 500) };
    }
  },
});
