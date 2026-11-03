import { calculateTechnical } from "../../src/lib/data/technical";
import {
  findSecTickerRecord,
  mapSecQuarterlyFundamentals,
  type SecTickerRecord,
  type SecSubmissions,
} from "../../src/lib/data/sec-edgar";
import { runAnalysis, type AnalysisInput } from "../../src/lib/analysis-engine";
import type { MarketData } from "../../src/lib/data/market-types";
import type { FundamentalData, SentimentData, MacroData } from "../../src/lib/data/intelligence-types";
import {
  normalizeNewsArticles,
  aggregateSentiment,
  normalizeFundamentals,
  buildMacroContext,
  type RawOverview,
  type RawEarnings,
  type RawNewsFeed,
} from "../../src/lib/data/alpha-vantage/normalize";
import { computeSmcContext } from "../../src/lib/data/smc";
import { buildChain, buildMtfContext, selectBudgetedMtfSlots } from "../../src/lib/data/mtf";
import { resolveQuoteObservation } from "../../src/lib/data/quote-freshness";
import { detectIctUnicorn, type ClassicPriceActionContext } from "../../src/lib/data/classic-price-action";
import {
  alignCrossAssetCloses,
  crossAssetComparator,
  pearsonCorrelation,
} from "../../src/lib/market-context";
import type {
  OhlcvCandle,
  TechnicalData,
  TimeframeStructureContext,
} from "../../src/lib/data/market-types";
import {
  fetchYahooFinanceCandles,
  resolveYahooFinanceComparatorSymbols,
  resolveYahooFinanceMarketSymbol,
} from "../../src/lib/data/providers/yahoo-finance";
import {
  OKX_SPOT_MARKET_PROVIDER,
  OkxSpotMarketAdapter,
} from "../../src/lib/data/crypto/okx-spot-market-adapter";

export interface MarketAnalysisRequest {
  instrument: string;
  instrumentType: "forex" | "crypto" | "stock" | "commodity" | "indices";
  timeframe: string;
  tradingStyle?: string;
  /** Point-in-time provider observations loaded by the authenticated API layer. */
  fundamentalData?: FundamentalData;
  sentimentData?: SentimentData;
  macroData?: MacroData;
}

export interface MarketAnalysisResult {
  success: boolean;
  error?: string;
  errorCode?: "INVALID_INPUT" | "UNSUPPORTED" | "RATE_LIMIT" | "API_UNAVAILABLE";
  data?: {
    instrument: string;
    instrumentType: MarketAnalysisRequest["instrumentType"];
    provider: string;
    fetchTimestamp: number;
    price: {
      price: number;
      timestamp: number;
      source: string;
      bid?: number;
      ask?: number;
    };
    candles: OhlcvCandle[];
    timeframe: string;
    higherTimeframe?: string;
    dataFreshness: "realtime" | "delayed" | "stale" | "unavailable";
  };
  technical?: TechnicalData;
  /** Authoritative future-facing decision, trade plan, risk gates and forecast. */
  analysis?: ReturnType<typeof runAnalysis>;
}

const INDEX_SYMBOLS: Record<string, string> = {
  SPX: "^GSPC", "S&P500": "^GSPC", GSPC: "^GSPC",
  NDX: "^NDX", NASDAQ100: "^NDX", "NASDAQ-100": "^NDX",
  IXIC: "^IXIC", NASDAQ: "^IXIC",
  DJI: "^DJI", DOWJONES: "^DJI",
  RUT: "^RUT", VIX: "^VIX",
  FTSE: "^FTSE", DAX: "^GDAXI", N225: "^N225", NIKKEI: "^N225",
  HSI: "^HSI", JKSE: "^JKSE", IHSG: "^JKSE",
};
const TIMEFRAMES = new Set(["M1","M5","M15","H1","H4","D1","W1"]);
const cache = new Map<string,{value:MarketAnalysisResult;expiresAt:number}>();
const inflight = new Map<string,Promise<MarketAnalysisResult>>();

const alphaVantageCache = new Map<string,{value:AlphaVantageIntelligenceResult;expiresAt:number}>();
const alphaVantageInflight = new Map<string,Promise<AlphaVantageIntelligenceResult>>();

export interface AlphaVantageIntelligenceResult {
  success:boolean;
  sentiment?:SentimentData;
  fundamentals?:FundamentalData;
  macro?:MacroData;
  dataAvailable:{news:boolean;fundamentals:boolean;macro:boolean};
  error?:string;
  errorCode?:"API_UNAVAILABLE"|"RATE_LIMIT"|"AUTH_ERROR"|"NO_DATA";
}

/** Fetch stock news/sentiment and company fundamentals using the existing shared normalizers. */
export async function fetchAlphaVantageIntelligence(
  symbolInput:string,
  apiKey:string|undefined,
  fetchImpl:typeof fetch=fetch,
):Promise<AlphaVantageIntelligenceResult> {
  const symbol=symbolInput.trim().toUpperCase();
  if(!/^[A-Z0-9.-]{1,15}$/.test(symbol)) return {success:false,dataAvailable:{news:false,fundamentals:false,macro:false},error:"A valid stock ticker is required.",errorCode:"NO_DATA"};
  if(!apiKey?.trim()) return {success:false,dataAvailable:{news:false,fundamentals:false,macro:false},error:"Alpha Vantage API key is not configured.",errorCode:"AUTH_ERROR"};
  const cached=alphaVantageCache.get(symbol);
  if(cached&&cached.expiresAt>Date.now()) return cached.value;
  const pending=alphaVantageInflight.get(symbol);
  if(pending) return pending;
  const task=(async()=>{
    const request=async(params:Record<string,string>)=>{
      const url=new URL("https://www.alphavantage.co/query");
      url.search=new URLSearchParams({...params,apikey:apiKey}).toString();
      const response=await fetchImpl(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(10_000)});
      if(!response.ok) throw new Error("Alpha Vantage HTTP "+response.status);
      const payload=await response.json() as Record<string,unknown>;
      const providerMessage=[payload.Note,payload.Information,payload["Error Message"]].find(x=>typeof x==="string");
      if(providerMessage) throw new Error(String(providerMessage));
      return payload;
    };
    const [newsResult,overviewResult,earningsResult]=await Promise.allSettled([
      request({function:"NEWS_SENTIMENT",tickers:symbol,sort:"LATEST",limit:"50"}),
      request({function:"OVERVIEW",symbol}),
      request({function:"EARNINGS",symbol}),
    ]);
    const errors=[newsResult,overviewResult,earningsResult]
      .filter((x):x is PromiseRejectedResult=>x.status==="rejected")
      .map(x=>x.reason instanceof Error?x.reason.message:String(x.reason));
    const newsPayload=newsResult.status==="fulfilled"?newsResult.value:undefined;
    const overview=overviewResult.status==="fulfilled"?overviewResult.value as RawOverview:undefined;
    const earnings=earningsResult.status==="fulfilled"?earningsResult.value as RawEarnings:undefined;
    const feed=Array.isArray(newsPayload?.feed)?newsPayload.feed as RawNewsFeed["feed"]:undefined;
    const articles=normalizeNewsArticles(feed,symbol);
    const sentiment=aggregateSentiment(articles,"alpha-vantage");
    const macro=buildMacroContext(articles,"stock");
    const fundamentals=normalizeFundamentals(overview??null,earnings??null,"stock",symbol);
    const dataAvailable={news:articles.length>0,fundamentals:fundamentals.available,macro:macro.confidence!=="unavailable"};
    const result:AlphaVantageIntelligenceResult={
      success:Object.values(dataAvailable).some(Boolean),sentiment,fundamentals,macro,dataAvailable,
      ...(errors.length?{
        error:errors.join("; "),
        errorCode:errors.some(x=>/rate limit|call frequency/i.test(x))?"RATE_LIMIT":"API_UNAVAILABLE",
      }:{}),
    };
    alphaVantageCache.set(symbol,{value:result,expiresAt:Date.now()+(result.success?5*60_000:30_000)});
    return result;
  })().finally(()=>alphaVantageInflight.delete(symbol));
  alphaVantageInflight.set(symbol,task);
  return task;
}


function ttl(timeframe:string):number {
  switch(timeframe) {
    case "M1": return 10_000;
    case "M5": return 20_000;
    case "M15": return 45_000;
    case "H1": return 120_000;
    case "H4": return 300_000;
    case "D1": return 900_000;
    case "W1": return 3_600_000;
    default: return 15_000;
  }
}

function resolveYahooSymbol(type:string,instrument:string):string|null {
  if(type==="indices") return INDEX_SYMBOLS[instrument.trim().toUpperCase()] ?? null;
  return resolveYahooFinanceMarketSymbol(type,instrument);
}

function legacyContext(entry: NonNullable<ReturnType<typeof buildMtfContext>["timeframes"][number]>): TimeframeStructureContext {
  const external=entry.smc!.internalExternal.external;
  return {
    timeframe:entry.timeframe,
    structure:external.structure,
    bosDirection:external.bosDirection,
    chochDirection:external.chochDirection,
    lastSwingHigh:external.lastSwingHigh,
    lastSwingLow:external.lastSwingLow,
    dataPoints:external.dataPoints,
  };
}

async function fetchCandles(
  request:MarketAnalysisRequest,
  timeframe:string,
  count:number,
  okx:OkxSpotMarketAdapter,
  fetchImpl:typeof fetch,
):Promise<OhlcvCandle[]> {
  if(request.instrumentType==="crypto") {
    if(/-SWAP$|-[0-9]{6}$/.test(request.instrument.toUpperCase())) {
      throw Object.assign(new Error("This self-hosted market-data lane currently supports verified OKX spot instruments only; no spot substitution was made for a derivative contract."),{code:"UNSUPPORTED"});
    }
    return okx.fetchCandles(request.instrument,timeframe,count);
  }
  const symbol=resolveYahooSymbol(request.instrumentType,request.instrument);
  if(!symbol) {
    throw Object.assign(new Error("No exact Yahoo Finance ticker mapping exists for this instrument. No correlated proxy or substitute instrument was used."),{code:"UNSUPPORTED"});
  }
  return fetchYahooFinanceCandles(symbol,timeframe,count,fetchImpl);
}

async function calculate(request:MarketAnalysisRequest,fetchImpl:typeof fetch):Promise<MarketAnalysisResult> {
  const symbol=request.instrument.trim().toUpperCase();
  const now=Date.now();
  const okx=new OkxSpotMarketAdapter(fetchImpl);
  const provider=request.instrumentType==="crypto"?OKX_SPOT_MARKET_PROVIDER:"yahoo-finance-public";

  try {
    const candles=await fetchCandles(request,request.timeframe,210,okx,fetchImpl);
    if(candles.length<20) {
      return {success:false,error:`Only ${candles.length} verified candles returned; at least 20 are required for independent structure analysis.`,errorCode:"API_UNAVAILABLE"};
    }
    const latest=candles[candles.length-1];
    let quote:{price:number;bid?:number;ask?:number;timestamp?:number}|undefined;
    if(request.instrumentType==="crypto") {
      quote=await okx.fetchTicker(request.instrument).catch(()=>undefined);
    }
    const observation=resolveQuoteObservation({
      quotePrice:quote?.price??Number.NaN,
      quoteTimestamp:quote?.timestamp,
      candleTimestamp:latest.timestamp,
      now,
    });
    const price=observation.hasLiveQuote&&quote?quote.price:latest.close;
    const technical=calculateTechnical(candles);
    technical.smc=computeSmcContext(candles,request.timeframe);
    const classic=technical as TechnicalData & {classicContext?:ClassicPriceActionContext};
    if(classic.classicContext) {
      classic.classicContext.ictUnicorn=detectIctUnicorn(
        technical.smc.orderBlocks,technical.smc.fvgs,request.timeframe,
      );
    }

    const slots=buildChain(request.timeframe);
    const preferred=selectBudgetedMtfSlots(slots,request.timeframe,request.tradingStyle);
    const mtfResults=await Promise.allSettled(slots.map(async slot=>{
      if(!preferred.some(p=>p.timeframe===slot.timeframe)) {
        throw new Error("Timeframe not fetched under the bounded on-demand data budget.");
      }
      return fetchCandles(request,slot.timeframe,slot.role==="trigger"?100:120,okx,fetchImpl);
    }));
    const mtfInputs=slots.map((slot,index)=>{
      const result=mtfResults[index];
      return result.status==="fulfilled"
        ? {timeframe:slot.timeframe,role:slot.role,candles:result.value}
        : {timeframe:slot.timeframe,role:slot.role,candles:null,error:result.reason instanceof Error?result.reason.message:"timeframe unavailable"};
    });
    mtfInputs.unshift({timeframe:request.timeframe,role:"setup" as const,candles});
    const mtf=buildMtfContext(request.timeframe,mtfInputs);
    technical.mtf=mtf;
    const structure=mtf.timeframes.find(t=>t.role==="structure");
    const trigger=mtf.timeframes.find(t=>t.role==="trigger");
    if(structure) technical.htfContext=legacyContext(structure);
    else delete technical.htfContext;
    if(trigger) technical.ltfTrigger=legacyContext(trigger);
    else delete technical.ltfTrigger;
    if(mtf.unavailable.length) technical.chainUnavailable=mtf.unavailable.map(x=>x.timeframe);
    else delete technical.chainUnavailable;

    const comparator=crossAssetComparator(request.instrumentType,symbol);
    if(comparator) {
      const candidates=resolveYahooFinanceComparatorSymbols(comparator);
      const failures:string[]=[];
      let crossAsset:TechnicalData["crossAsset"]={
        comparatorSymbol:comparator,timeframe:request.timeframe,available:false,
        unavailableReason:candidates.length?"No comparator candidate has yet produced enough aligned observations.":"No exact comparator ticker mapping exists.",
      };
      for(const candidate of candidates) {
        try {
          const comparatorCandles=await fetchYahooFinanceCandles(candidate.symbol,request.timeframe,120,fetchImpl);
          const aligned=alignCrossAssetCloses(candles,comparatorCandles,request.timeframe);
          const stats=pearsonCorrelation(aligned.primary,aligned.comparator);
          if(!stats) { failures.push(candidate.label+": insufficient timestamp-aligned observations or zero variance");continue; }
          const base=aligned.comparator[Math.max(0,aligned.comparator.length-21)];
          const last=aligned.comparator[aligned.comparator.length-1];
          crossAsset={
            comparatorSymbol:candidate.label,providerSymbol:candidate.symbol,timeframe:request.timeframe,
            available:true,correlation:stats.correlation,sampleSize:stats.n,
            directionalContext:stats.correlation>=0.6?"direct":stats.correlation<=-0.6?"inverse":"weak",
            comparatorMomentum:last>base?"up":last<base?"down":"flat",
            dataKind:"actual_price",provider:"yahoo-finance-public",
          };
          break;
        } catch(error) {
          failures.push(candidate.label+": "+(error instanceof Error?error.message:String(error)));
        }
      }
      if(!crossAsset.available&&failures.length) crossAsset.unavailableReason=failures.join("; ");
      technical.crossAsset=crossAsset;
    }

    const priceSnapshot = {
      price,
      timestamp:observation.priceTimestamp,
      source:provider,
      ...(observation.hasLiveQuote&&quote?.bid!==undefined?{bid:quote.bid}:{}),
      ...(observation.hasLiveQuote&&quote?.ask!==undefined?{ask:quote.ask}:{}),
    };
    const marketData:MarketData = {
      instrument:symbol,
      instrumentType:request.instrumentType,
      provider,
      fetchTimestamp:now,
      price:priceSnapshot,
      candles,
      timeframe:request.timeframe,
      higherTimeframe:mtf.htfTimeframe,
      dataFreshness:observation.dataFreshness,
    };
    // Reuse the existing decision engine verbatim. Do not invent fundamental
    // observations here: absent provider evidence remains unavailable/partial.
    const analysis = runAnalysis({
      instrument:symbol,
      instrumentType:request.instrumentType,
      timeframe:request.timeframe as AnalysisInput["timeframe"],
      tradingStyle:request.tradingStyle as AnalysisInput["tradingStyle"],
      marketData,
      technicalData:technical,
      ...(request.fundamentalData?{fundamentalData:request.fundamentalData}:{}),
      ...(request.sentimentData?{sentimentData:request.sentimentData}:{}),
      ...(request.macroData?{macroData:request.macroData}:{}),
    });

    return {
      success:true,
      data:marketData,
      technical,
      analysis,
    };
  } catch(error) {
    const code=(error as {code?:string})?.code;
    const message=error instanceof Error?error.message:"Unknown market-data failure";
    return {
      success:false,error:message,
      errorCode:code==="UNSUPPORTED"?"UNSUPPORTED":/429|rate limit/i.test(message)?"RATE_LIMIT":"API_UNAVAILABLE",
    };
  }
}

export async function analyzeMarket(request:MarketAnalysisRequest,fetchImpl:typeof fetch=fetch):Promise<MarketAnalysisResult> {
  const normalized:MarketAnalysisRequest={
    ...request,
    instrument:request.instrument.trim().toUpperCase(),
    timeframe:request.timeframe.trim().toUpperCase(),
  };
  if(!normalized.instrument||!TIMEFRAMES.has(normalized.timeframe)||
    !["forex","crypto","stock","commodity","indices"].includes(normalized.instrumentType)) {
    return {success:false,error:"Instrument, asset class, or timeframe is invalid.",errorCode:"INVALID_INPUT"};
  }
  const key=[normalized.instrumentType,normalized.instrument,normalized.timeframe,normalized.tradingStyle??"",normalized.fundamentalData?.provider??"",normalized.fundamentalData?.timestamp??"",normalized.sentimentData?.timestamp??"",normalized.macroData?.timestamp??""].join("|");
  const cached=cache.get(key);
  if(cached&&cached.expiresAt>Date.now()) return cached.value;
  const pending=inflight.get(key);
  if(pending) return pending;
  const task=calculate(normalized,fetchImpl).then(result=>{
    if(result.success) cache.set(key,{value:result,expiresAt:Date.now()+ttl(normalized.timeframe)});
    return result;
  }).finally(()=>inflight.delete(key));
  inflight.set(key,task);
  return task;
}


const SEC_TICKER_DIRECTORY = "https://www.sec.gov/files/company_tickers.json";
const SEC_DATA_BASE = "https://data.sec.gov";
const SEC_TICKER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let secTickerDirectoryCache: { value: Record<string, SecTickerRecord>; expiresAt: number } | undefined;

/**
 * Retrieve filing-matched, discrete quarterly/yearly fundamentals from SEC.
 * SEC filingDate and acceptanceDateTime are kept distinct; neither is
 * represented as an exact market-publication timestamp.
 */
export async function fetchSecFundamentalObservations(
  tickerInput: string,
  userAgentInput: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; status: string; ticker: string; cik?: string; observations: ReturnType<typeof mapSecQuarterlyFundamentals>; error?: string }> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,15}$/.test(ticker)) {
    return { success: false, status: "INVALID_TICKER", ticker, observations: [] };
  }
  const userAgent = userAgentInput?.trim();
  if (!userAgent || userAgent.length > 250 || /[\r\n]/.test(userAgent) || !/\([^)]*@[^)]+\)/.test(userAgent)) {
    return { success: false, status: "USER_AGENT_NOT_CONFIGURED", ticker, observations: [] };
  }
  const fetchJson = async <T>(url: string): Promise<T> => {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`SEC EDGAR HTTP ${response.status} for ${new URL(url).pathname}`);
    return await response.json() as T;
  };
  try {
    let directory = secTickerDirectoryCache?.expiresAt && secTickerDirectoryCache.expiresAt > Date.now()
      ? secTickerDirectoryCache.value
      : undefined;
    if (!directory) {
      directory = await fetchJson<Record<string, SecTickerRecord>>(SEC_TICKER_DIRECTORY);
      secTickerDirectoryCache = { value: directory, expiresAt: Date.now() + SEC_TICKER_CACHE_TTL_MS };
    }
    const company = findSecTickerRecord(ticker, directory);
    if (!company) return { success: false, status: "TICKER_NOT_FOUND", ticker, observations: [] };
    const cik = String(company.cik_str).padStart(10, "0");
    const submissions = await fetchJson<SecSubmissions>(`${SEC_DATA_BASE}/submissions/CIK${cik}.json`);
    const facts = await fetchJson<{
      cik?: number;
      entityName?: string;
      facts?: { "us-gaap"?: Record<string, { units?: Record<string, Array<{
        accn?: string; filed?: string; start?: string; end?: string; val?: number;
        fy?: number; fp?: string; form?: string; frame?: string;
      }>> }> };
    }>(`${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`);
    const observations = mapSecQuarterlyFundamentals(ticker, cik, facts, submissions);
    return {
      success: true,
      status: observations.length ? "OBSERVATIONS_READY" : "NO_USABLE_FILING_FACTS",
      ticker, cik, observations,
    };
  } catch (error) {
    return {
      success: false, status: "PROVIDER_ERROR", ticker, observations: [],
      error: error instanceof Error ? error.message : "SEC EDGAR request failed",
    };
  }
}
