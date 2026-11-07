import {
  fetchAlphaVantageIntelligence,
  fetchCotPositioning,
  fetchCryptoDerivatives,
  fetchCryptoFundamentals,
  fetchEconomicCalendar,
  fetchEiaInventory,
  fetchMarketCandlesBatch,
  fetchSecFundamentalObservations,
  fetchYahooIdxFundamentals,
  fetchTreasuryYields,
} from "./market-data-engine";
import { DEFAULT_UNIVERSE } from "../../src/lib/market-radar/universe";
import { classifyMarketDataFreshness } from "../../src/lib/data/market-freshness";
import { selectPriorityScanBatch } from "../../src/lib/market-radar/background-schedule";
import { scanRadar, type RadarState } from "../../src/lib/market-radar/radar";
import { toRadarCandidateSource } from "../../src/lib/market-radar/candidate-builder";
import { calculateTechnical } from "../../src/lib/data/technical";
import { runAnalysis, type AnalysisInput } from "../../src/lib/analysis-engine";
import { buildCryptoIntelligenceContext } from "../../src/lib/data/crypto/intelligence";
import { parseCoinGlassResult } from "../../src/lib/data/crypto/coinglass-adapter";
import { parseDeFiLlamaResult } from "../../src/lib/data/crypto/defillama-adapter";
import type { LiveCandidateSource } from "../../src/lib/liveCandidateBuilder";
import type { MarketData } from "../../src/lib/data/market-types";
import type { AnalysisResult } from "../../src/types/analysis";
import type { RadarOpportunity, RadarScanConfig } from "../../src/lib/market-radar/types";
import type { TradingMode, InvestorHorizon } from "../../src/lib/recommendation-engine";

const SCAN_UNIVERSE = DEFAULT_UNIVERSE.filter(entry => entry.assetClass !== "macro");
const HORIZONS: RadarScanConfig["horizons"] = [
  "SCALPING", "INTRADAY", "SWING",
  "1-4_WEEKS", "1-3_MONTHS", "3-6_MONTHS",
  "6-12_MONTHS", "1-3_YEARS", "3+_YEARS",
];
const TF_MS: Record<string, number> = {
  M5: 300_000, H1: 3_600_000, H4: 14_400_000,
  D1: 86_400_000, W1: 604_800_000,
};
const enrichmentCache = new Map<string, { value: unknown; expiresAt: number }>();

function instrumentType(assetClass: string): MarketData["instrumentType"] {
  if (assetClass === "equity") return "stock";
  if (assetClass === "forex" || assetClass === "crypto" || assetClass === "commodity" || assetClass === "indices") return assetClass;
  return "indices";
}
function freshness(timestamp: number, now: number, timeframe: string): MarketData["dataFreshness"] {
  return classifyMarketDataFreshness(timestamp, now, timeframe);
}
function key(source: LiveCandidateSource): string {
  return source.instrument.toUpperCase() + "|" + (source.marketData?.timeframe ?? "UNKNOWN").toUpperCase();
}
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const existing = enrichmentCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value as T;
  const value = await load();
  if ((value as { success?: boolean } | null)?.success !== false) {
    enrichmentCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
  if (enrichmentCache.size > 2_000) {
    const now = Date.now();
    for (const [cacheKey, item] of enrichmentCache) if (item.expiresAt <= now) enrichmentCache.delete(cacheKey);
  }
  return value;
}
async function optional<T>(name: string, task: Promise<T>, errors: string[]): Promise<T | undefined> {
  try {
    const value = await task;
    const result = value as { success?: boolean; error?: string; errorCode?: string; status?: string };
    if (result?.success === false) {
      errors.push(`${name}: ${result.errorCode ?? result.status ?? result.error ?? "provider unavailable"}`);
      return undefined;
    }
    return value;
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function acquireEnrichment(
  entry: (typeof SCAN_UNIVERSE)[number],
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  errors: string[],
  now: number,
) {
  const type = instrumentType(entry.assetClass);
  const alphaType: "stock" | "crypto" | "forex" | "commodity" | "macro" =
    entry.assetClass === "equity" ? "stock" :
    entry.assetClass === "crypto" || entry.assetClass === "forex" || entry.assetClass === "commodity"
      ? entry.assetClass : "macro";
  // Respect provider quotas: news/fundamental enrichment is slower-moving
  // than candles and must not be requested on every radar acquisition visit.
  const isIdxEquity = entry.assetClass === "equity" && entry.region === "idx";
  // IDX tickers must never be sent to Alpha Vantage's US-oriented stock
  // overview path. Enrich them from the free, exact-symbol Yahoo .JK feed.
  const alphaPromise = env.ALPHA_VANTAGE_API_KEY?.trim() && !isIdxEquity
    ? optional("Alpha Vantage", cached(`alpha:${entry.instrument}`, 15 * 60_000,
        () => fetchAlphaVantageIntelligence(entry.instrument, env.ALPHA_VANTAGE_API_KEY!, fetchImpl, alphaType)), errors)
    : Promise.resolve(undefined);
  const idxFundamentalsPromise = isIdxEquity
    ? optional("Yahoo Finance IDX fundamentals", cached(`idx-fundamentals:${entry.instrument}`, 6 * 60 * 60_000,
        () => fetchYahooIdxFundamentals(entry.instrument, fetchImpl)), errors)
    : Promise.resolve(undefined);
  const calendarPromise = env.TICKATLAS_API_KEY?.trim()
    ? optional("Economic calendar", cached(`calendar:${entry.instrument}`, 5 * 60_000,
        () => fetchEconomicCalendar(entry.instrument, type, env.TICKATLAS_API_KEY!, fetchImpl)), errors)
    : Promise.resolve(undefined);
  const treasuryPromise = entry.assetClass === "forex" || entry.assetClass === "commodity"
    ? optional("Treasury/FRED yields", cached("treasury", 30 * 60_000, () => fetchTreasuryYields(fetchImpl)), errors)
    : Promise.resolve(undefined);
  const cotPromise = entry.requiredCapabilities.includes("cot")
    ? optional("CFTC COT", cached(`cot:${entry.instrument}`, 6 * 60 * 60_000, () => fetchCotPositioning(entry.instrument, fetchImpl)), errors)
    : Promise.resolve(undefined);
  const eiaPromise = entry.requiredCapabilities.includes("eia")
    ? optional("EIA/FRED inventory", cached("eia:petroleum", 6 * 60 * 60_000, () => fetchEiaInventory(env.EIA_API_KEY, fetchImpl)), errors)
    : Promise.resolve(undefined);
  const derivativesPromise = entry.assetClass === "crypto"
    ? optional("Public/paid crypto derivatives", cached(`derivatives:${entry.instrument}`, 5 * 60_000,
        () => fetchCryptoDerivatives(entry.instrument, env.COINGLASS_API_KEY, fetchImpl, env.TOKENOMIST_API_KEY)), errors)
    : Promise.resolve(undefined);
  const defiPromise = entry.assetClass === "crypto"
    ? optional("DeFiLlama fundamentals", cached(`defi-fundamentals:${entry.instrument}`, 6 * 60 * 60_000,
        () => fetchCryptoFundamentals(entry.instrument, fetchImpl)), errors)
    : Promise.resolve(undefined);
  const secPromise = entry.assetClass === "equity" && entry.region === "us" &&
      entry.requiredCapabilities.includes("fundamentals") && env.SEC_USER_AGENT?.trim()
    ? optional("SEC EDGAR filings", cached(`sec:${entry.instrument}`, 6 * 60 * 60_000,
        () => fetchSecFundamentalObservations(entry.instrument, env.SEC_USER_AGENT, fetchImpl)), errors)
    : Promise.resolve(undefined);

  const [alpha, idxFundamentals, calendar, treasury, cot, eia, derivatives, defi, sec] = await Promise.all([
    alphaPromise, idxFundamentalsPromise, calendarPromise, treasuryPromise, cotPromise,
    eiaPromise, derivativesPromise, defiPromise, secPromise,
  ]);
  let cryptoIntelligenceContext: AnalysisInput["cryptoIntelligenceContext"];
  if (entry.assetClass === "crypto") {
    const derivativeEnvelope = derivatives as { data?: Record<string, unknown> & { timestamp?: number }; tokenomics?: NonNullable<AnalysisInput["cryptoIntelligenceContext"]>["tokenomics"] } | undefined;
    const defiEnvelope = defi as { data?: Record<string, unknown>; observedAt?: number } | undefined;
    const derivativesContext = derivativeEnvelope?.data
      ? parseCoinGlassResult(derivativeEnvelope.data, entry.instrument, derivativeEnvelope.data.timestamp ?? now)
      : undefined;
    const defiContext = defiEnvelope?.data
      ? parseDeFiLlamaResult(defiEnvelope.data, entry.instrument, defiEnvelope.observedAt ?? now)
      : undefined;
    cryptoIntelligenceContext = buildCryptoIntelligenceContext(
      entry.instrument, derivativesContext, defiContext, derivativeEnvelope?.tokenomics,
    ) ?? undefined;
  }
  const alphaResult = alpha as {
    sentiment?: AnalysisInput["sentimentData"];
    fundamentals?: AnalysisInput["fundamentalData"];
    macro?: AnalysisInput["macroData"];
  } | undefined;
  const combinedAlpha = alphaResult || idxFundamentals
    ? { ...(alphaResult ?? {}), ...(idxFundamentals ? { fundamentals: idxFundamentals } : {}) }
    : undefined;
  return {
    alpha: combinedAlpha,
    calendar: (calendar as { data?: AnalysisInput["calendarData"] } | undefined)?.data,
    treasury: (treasury as { data?: AnalysisInput["treasuryData"] } | undefined)?.data,
    cot: (cot as { data?: AnalysisInput["cotData"] } | undefined)?.data,
    eia: (eia as { data?: AnalysisInput["eiaData"] } | undefined)?.data,
    derivatives: (derivatives as { data?: AnalysisInput["derivativesData"] } | undefined)?.data,
    cryptoIntelligenceContext,
    secObservations: (sec as { observations?: AnalysisResult["secEdgarObservations"] } | undefined)?.observations,
  };
}

export async function runOpportunityBatch(input: {
  cursor: number;
  sources: LiveCandidateSource[];
  previousResults: RadarOpportunity[];
  scanAttempts?: Record<string, number>;
  now?: number;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}) {
  const now = input.now ?? Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const env = input.env ?? {};
  const batch = selectPriorityScanBatch(input.cursor, SCAN_UNIVERSE, input.sources, now, input.scanAttempts);
  const entry = SCAN_UNIVERSE[batch.instrumentIndex]!;
  const errors: string[] = [];
  const [fetched, enrichment] = await Promise.all([
    fetchMarketCandlesBatch([entry.instrument], [...batch.timeframes], 210, fetchImpl),
    acquireEnrichment(entry, env, fetchImpl, errors, now),
  ]);
  const valid = fetched.filter(item => item.success && item.candles.length >= 20);
  const byTimeframe = new Map(valid.map(item => [item.timeframe, item]));
  const updates: LiveCandidateSource[] = valid.map(item => {
    const last = item.candles[item.candles.length - 1]!;
    const higherIndex = batch.timeframes.findIndex((tf, i) =>
      i !== batch.timeframes.indexOf(item.timeframe) && (TF_MS[tf] ?? 0) > (TF_MS[item.timeframe] ?? 0),
    );
    const higher = higherIndex >= 0 ? byTimeframe.get(batch.timeframes[higherIndex]!) : undefined;
    const marketData: MarketData = {
      instrument: entry.instrument,
      instrumentType: instrumentType(entry.assetClass),
      provider: item.provider ?? "unknown",
      fetchTimestamp: now,
      price: { price: last.close, timestamp: last.timestamp, source: item.provider ?? "unknown" },
      candles: item.candles,
      timeframe: item.timeframe,
      ...(higher && higher.candles.length >= 30 ? {
        higherTimeframe: higher.timeframe,
        higherTimeframeCandles: higher.candles,
      } : {}),
      dataFreshness: freshness(last.timestamp, now, item.timeframe),
    };
    const technical = calculateTechnical(
      item.candles,
      higher?.candles,
      higher?.timeframe ?? "HTF",
    );
    const alpha = enrichment.alpha as {
      sentiment?: AnalysisInput["sentimentData"];
      fundamentals?: AnalysisInput["fundamentalData"];
      macro?: AnalysisInput["macroData"];
    } | undefined;
    const analysisInput: AnalysisInput = {
      instrument: entry.instrument,
      instrumentType: instrumentType(entry.assetClass),
      timeframe: item.timeframe as AnalysisInput["timeframe"],
      tradingStyle: item.timeframe === "M5" ? "scalping" : item.timeframe === "H1" ? "intraday" : "swing",
      marketData,
      technicalData: technical,
      ...(alpha?.sentiment && alpha.sentiment.confidence !== "unavailable" ? { sentimentData: alpha.sentiment } : {}),
      ...(alpha?.fundamentals?.available ? { fundamentalData: alpha.fundamentals } : {}),
      ...(alpha?.macro && alpha.macro.confidence !== "unavailable" ? { macroData: alpha.macro } : {}),
      ...(enrichment.derivatives ? { derivativesData: enrichment.derivatives } : {}),
      ...(enrichment.calendar ? { calendarData: enrichment.calendar } : {}),
      ...(enrichment.treasury?.available ? { treasuryData: enrichment.treasury } : {}),
      ...(enrichment.cot?.available ? { cotData: enrichment.cot } : {}),
      ...(enrichment.eia?.available ? { eiaData: enrichment.eia } : {}),
      ...(enrichment.cryptoIntelligenceContext ? { cryptoIntelligenceContext: enrichment.cryptoIntelligenceContext } : {}),
    };
    let analysisResult: AnalysisResult | undefined;
    try {
      analysisResult = runAnalysis(analysisInput);
      if (enrichment.secObservations?.length) {
        analysisResult = { ...analysisResult, secEdgarObservations: enrichment.secObservations };
      }
    } catch (error) {
      errors.push(`${entry.instrument} ${item.timeframe} analysis: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      instrument: entry.instrument,
      assetClass: entry.assetClass,
      marketData,
      technicalData: technical,
      ...(analysisResult ? { analysisResult } : {}),
      ...(enrichment.derivatives ? { derivativesData: enrichment.derivatives } : {}),
      ...(enrichment.calendar ? { calendarData: enrichment.calendar } : {}),
      ...(enrichment.treasury?.available ? { treasuryData: enrichment.treasury } : {}),
      ...(enrichment.cot?.available ? { cotData: enrichment.cot } : {}),
      ...(enrichment.eia?.available ? { eiaData: enrichment.eia } : {}),
      ...(enrichment.cryptoIntelligenceContext ? { cryptoIntelligenceContext: enrichment.cryptoIntelligenceContext } : {}),
    };
  });
  const merged = new Map(input.sources.map(source => [key(source), source]));
  for (const source of updates) merged.set(key(source), source);
  const allSources = [...merged.values()];
  const radarSources = allSources.map(source => toRadarCandidateSource(source, allSources));
  const previous = new Map<string, RadarOpportunity>();
  for (const item of input.previousResults) if (!previous.has(item.instrument)) previous.set(item.instrument, item);
  const result = scanRadar(radarSources, { horizons: HORIZONS, maxResults: 20 }, {
    previous,
    lastScanAt: now,
  } satisfies RadarState, now);
  return {
    cursor: batch.nextCursor,
    scanAttempts: { ...input.scanAttempts, [entry.instrument.toUpperCase()]: now },
    instrument: entry.instrument,
    timeframes: [...batch.timeframes],
    updates,
    results: [...result.results.entries()] as Array<[TradingMode | InvestorHorizon, RadarOpportunity[]]>,
    diffs: result.diffs,
    metrics: {
      totalScanned: result.totalScanned,
      totalWithLiveData: result.totalWithLiveData,
      totalInsufficient: result.totalInsufficient,
      freshCount: result.freshCount,
      delayedCount: result.delayedCount,
      staleCount: result.staleCount,
      unavailableCount: result.unavailableCount,
      durationMs: result.durationMs,
    },
    errors: [
      ...fetched.filter(item => !item.success).map(item => `${item.instrument} ${item.timeframe}: ${item.error ?? "provider unavailable"}`),
      ...errors,
    ].slice(0, 30),
    scannedAt: now,
  };
}
