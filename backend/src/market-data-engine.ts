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
import type { FxRateSnapshot } from "../../src/lib/risk";
import { parseDailyFxReferenceSnapshot } from "../../src/lib/risk/fx";
import { mapInstrumentToOkx, parseOkxResponse, type OkxSpecData } from "../../src/lib/risk/okx-spec";
import { parseOkxFuturesOpenInterest } from "../../src/lib/data/crypto/okx-futures-open-interest";
import {
  buildExecutionData,
  parseOkxOrderBook,
  requireExactOrderBookInstrument,
  type ExecutionData,
} from "../../src/lib/execution-quality";
import type { CryptoDerivativesData } from "../../src/lib/data/derivatives-types";
import {
  calculateMacroRisk,
  getRelevantCurrencies,
  type EconomicCalendarData,
  type EconomicEvent,
  type EventImportance,
  type CalendarResult,
} from "../../src/lib/data/calendar-types";
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
  fetchYahooFinanceQuote,
  resolveYahooFinanceComparatorSymbols,
  resolveYahooFinanceMarketSymbol,
} from "../../src/lib/data/providers/yahoo-finance";
import { DeFiLlamaAdapter } from "../../src/lib/data/crypto/defillama-adapter";
import { BinancePublicDerivativesAdapter } from "../../src/lib/data/crypto/binance-derivatives-adapter";
import { BybitPublicDerivativesAdapter } from "../../src/lib/data/crypto/bybit-derivatives-adapter";
import { OkxPublicDerivativesAdapter } from "../../src/lib/data/crypto/okx-derivatives-adapter";
import { TokenomistAdapter, parseTokenomistResult } from "../../src/lib/data/crypto/tokenomist-adapter";
import { PatternPlusUnlockAdapter } from "../../src/lib/data/crypto/patternplus-unlocks-adapter";
import { parseCoinGeckoSupplyFallback } from "../../src/lib/data/crypto/coingecko-supply";
import { getProviderSymbol, resolveInstrument } from "../../src/lib/data/universal/instruments";
import type { TokenomicsIntelligence } from "../../src/lib/data/crypto/types";

import type { DerivativesResult, OpenInterestData, FundingRateData, LongShortData, LiquidationData } from "../../src/lib/data/derivatives-types";
import {
  OKX_SPOT_MARKET_PROVIDER,
  OkxSpotMarketAdapter,
  toOkxSpotInstrument,
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

const MACRO_INDEX_SYMBOLS = new Set(["DXY", "VIX", "US10Y", "US2Y", "US500", "US30", "US100"]);
const INDEX_SYMBOLS: Record<string, string> = {
  SPX: "^GSPC", "S&P500": "^GSPC", GSPC: "^GSPC", US500: "^GSPC",
  NDX: "^NDX", NASDAQ100: "^NDX", "NASDAQ-100": "^NDX", US100: "^NDX",
  IXIC: "^IXIC", NASDAQ: "^IXIC",
  DJI: "^DJI", DOWJONES: "^DJI", US30: "^DJI",
  RUT: "^RUT", VIX: "^VIX", DXY: "DX-Y.NYB", US10Y: "^TNX",
  FTSE: "^FTSE", DAX: "^GDAXI", N225: "^N225", NIKKEI: "^N225",
  HSI: "^HSI", JKSE: "^JKSE", IHSG: "^JKSE",
};
const TIMEFRAMES = new Set(["M1","M5","M15","H1","H4","D1","W1"]);
const cache = new Map<string,{value:MarketAnalysisResult;expiresAt:number}>();
const inflight = new Map<string,Promise<MarketAnalysisResult>>();

const alphaVantageCache = new Map<string,{value:AlphaVantageIntelligenceResult;expiresAt:number}>();
const alphaVantageInflight = new Map<string,Promise<AlphaVantageIntelligenceResult>>();
const fxReferenceCache = new Map<string, { direct: FxRateSnapshot; expiresAt: number }>();

export interface AlphaVantageIntelligenceResult {
  success:boolean;
  sentiment?:SentimentData;
  fundamentals?:FundamentalData;
  macro?:MacroData;
  dataAvailable:{news:boolean;fundamentals:boolean;macro:boolean};
  error?:string;
  errorCode?:"API_UNAVAILABLE"|"RATE_LIMIT"|"AUTH_ERROR"|"NO_DATA";
}

type AlphaVantageInstrumentType = "stock" | "crypto" | "forex" | "commodity" | "macro";

function resolveAlphaVantageNewsQuery(
  symbol: string,
  instrumentType: AlphaVantageInstrumentType,
): { params: Record<string,string>; relatedSymbol: string } | null {
  if (instrumentType === "stock") {
    if (!/^[A-Z0-9.-]{1,15}$/.test(symbol)) return null;
    return { params: { tickers: symbol }, relatedSymbol: symbol };
  }
  if (instrumentType === "crypto") {
    let base = symbol.split(/[/-]/)[0] ?? "";
    base = base.replace(/(?:USDT|USDC|BUSD|USD)$/,"");
    if (!/^[A-Z0-9]{2,20}$/.test(base)) return null;
    return { params: { tickers: `CRYPTO:${base}` }, relatedSymbol: `CRYPTO:${base}` };
  }
  if (instrumentType === "forex") {
    const pair = symbol.match(/^([A-Z]{3})[/-]?([A-Z]{3})$/);
    if (!pair) return null;
    const base = `FOREX:${pair[1]}`;
    const quote = `FOREX:${pair[2]}`;
    return { params: { tickers: `${base},${quote}` }, relatedSymbol: base };
  }
  if (instrumentType === "commodity") {
    const topic = /WTI|BRENT|OIL|NATGAS|NATURAL.?GAS|NGAS/.test(symbol)
      ? "energy_transportation"
      : "financial_markets";
    return { params: { topics: topic }, relatedSymbol: "" };
  }
  const topic = /DXY|USD|US\d+Y|FED|RATE|YIELD/.test(symbol)
    ? "economy_monetary"
    : /DEFICIT|BUDGET|TAX/.test(symbol)
      ? "economy_fiscal"
      : "economy_macro";
  return { params: { topics: topic }, relatedSymbol: "" };
}


const twelveDataIdxFundamentalsCache = new Map<string, { value: FundamentalData; expiresAt: number }>();

function readProviderNumber(source: unknown, aliases: string[]): number | undefined {
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const object = source as Record<string, unknown>;
  for (const alias of aliases) {
    const raw = object[alias];
    if (raw === null || raw === undefined || raw === "") continue;
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  for (const value of Object.values(object)) {
    const nested = readProviderNumber(value, aliases);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function normalizeProviderPercent(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Math.abs(value) > 1 ? value / 100 : value;
}

/** True only for instruments explicitly registered on the Indonesian exchange. */
export function isIdxListedEquity(tickerInput: string): boolean {
  const ticker = tickerInput.trim().toUpperCase().replace(/\.JK$/, "");
  const canonical = resolveInstrument(ticker);
  return Boolean(canonical && canonical.assetClass === "equity" && canonical.primaryExchange === "IDX");
}

/** IDX statistics are separate from SEC EDGAR, which covers US registrants. */
export async function fetchTwelveDataIdxFundamentals(
  tickerInput: string,
  apiKeyInput: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<FundamentalData | null> {
  const ticker = tickerInput.trim().toUpperCase().replace(/\.JK$/, "");
  const canonical = resolveInstrument(ticker);
  if (!canonical || !isIdxListedEquity(ticker)) return null;
  if (!apiKeyInput?.trim()) return null;
  const providerSymbol = getProviderSymbol(canonical.canonical, "twelve-data");
  if (!providerSymbol?.toUpperCase().endsWith(".JK")) return null;
  const cached = twelveDataIdxFundamentalsCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL("https://api.twelvedata.com/statistics");
  url.search = new URLSearchParams({ symbol: providerSymbol, mic_code: "XIDX", apikey: apiKeyInput.trim() }).toString();
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Twelve Data IDX statistics HTTP " + response.status);
  const payload = await response.json() as Record<string, unknown>;
  if (typeof payload.code === "number" || (typeof payload.status === "string" && payload.status.toLowerCase() === "error")) {
    throw new Error("Twelve Data IDX statistics provider rejected the request");
  }
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta as Record<string, unknown> : {};
  const returnedSymbol = typeof meta.symbol === "string" ? meta.symbol.toUpperCase() : "";
  const returnedMic = typeof meta.mic_code === "string" ? meta.mic_code.toUpperCase() : "";
  const returnedExchange = typeof meta.exchange === "string" ? meta.exchange.toUpperCase() : "";
  if (returnedSymbol !== providerSymbol.toUpperCase()) throw new Error("Twelve Data did not verify the requested equity symbol");
  if (returnedMic !== "XIDX") throw new Error("Twelve Data did not verify the IDX exchange MIC");
  if (returnedExchange && returnedExchange !== "IDX") throw new Error("Twelve Data returned a different exchange");

  const market = payload.statistics && typeof payload.statistics === "object" ? payload.statistics : payload;
  const fields: Record<string, number | undefined> = {
    marketCap: readProviderNumber(market, ["market_capitalization", "market_cap", "marketCapitalization"]),
    peRatio: readProviderNumber(market, ["pe_ratio", "trailing_pe", "trailingPE"]),
    forwardPeRatio: readProviderNumber(market, ["forward_pe", "forwardPE"]),
    pegRatio: readProviderNumber(market, ["peg_ratio", "pegRatio"]),
    priceToSalesRatio: readProviderNumber(market, ["price_to_sales_ttm", "price_to_sales_ratio"]),
    evToRevenue: readProviderNumber(market, ["enterprise_to_revenue", "ev_to_revenue"]),
    evToEbitda: readProviderNumber(market, ["enterprise_to_ebitda", "ev_to_ebitda"]),
    revenueTTM: readProviderNumber(market, ["revenue_ttm", "revenueTTM"]),
    revenuePerShare: readProviderNumber(market, ["revenue_per_share_ttm", "revenue_per_share"]),
    revenueGrowth: normalizeProviderPercent(readProviderNumber(market, ["quarterly_revenue_growth", "revenue_growth_yoy"])),
    earningsGrowth: normalizeProviderPercent(readProviderNumber(market, ["quarterly_earnings_growth_yoy", "earnings_growth_yoy"])),
    grossProfitTTM: readProviderNumber(market, ["gross_profit_ttm", "grossProfitTTM"]),
    dilutedEPS: readProviderNumber(market, ["diluted_eps_ttm", "dilutedEPS"]),
    earningsPerShare: readProviderNumber(market, ["diluted_eps_ttm", "earnings_per_share", "eps"]),
    beta: readProviderNumber(market, ["beta"]),
    sharesOutstanding: readProviderNumber(market, ["shares_outstanding", "sharesOutstanding"]),
    bookValue: readProviderNumber(market, ["book_value_per_share", "book_value"]),
    dividendPerShare: readProviderNumber(market, ["trailing_annual_dividend_rate", "forward_annual_dividend_rate", "dividend_per_share", "dividendPerShare"]),
    dividendYield: normalizeProviderPercent(readProviderNumber(market, ["trailing_annual_dividend_yield", "forward_annual_dividend_yield", "dividend_yield", "dividendYield"])),
    profitMargin: normalizeProviderPercent(readProviderNumber(market, ["profit_margin", "profitMargin"])),
    operatingMargin: normalizeProviderPercent(readProviderNumber(market, ["operating_margin", "operatingMargin"])),
    returnOnAssets: normalizeProviderPercent(readProviderNumber(market, ["return_on_assets", "return_on_assets_ttm", "returnOnAssets"])),
    returnOnEquity: normalizeProviderPercent(readProviderNumber(market, ["return_on_equity_ttm", "return_on_equity", "returnOnEquity"])),
    priceToBook: readProviderNumber(market, ["price_to_book_mrq", "price_to_book", "priceToBook"]),
    fiftyDayMovingAverage: readProviderNumber(market, ["day_50_ma", "fifty_day_moving_average"]),
    twoHundredDayMovingAverage: readProviderNumber(market, ["day_200_ma", "two_hundred_day_moving_average"]),
    fiftyTwoWeekHigh: readProviderNumber(market, ["fifty_two_week_high", "52_week_high"]),
    fiftyTwoWeekLow: readProviderNumber(market, ["52_week_low", "fifty_two_week_low"]),
  };
  const availableFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  if (Object.keys(availableFields).length === 0) return null;
  const result: FundamentalData = {
    provider: "twelve-data-statistics",
    timestamp: Date.now(),
    instrumentType: "stock",
    symbol: ticker,
    ...(typeof meta.name === "string" ? { name: meta.name } : {}),
    ...availableFields,
    available: true,
  };
  twelveDataIdxFundamentalsCache.set(ticker, { value: result, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  if (twelveDataIdxFundamentalsCache.size > 500) {
    for (const [key, value] of twelveDataIdxFundamentalsCache) {
      if (value.expiresAt <= Date.now()) twelveDataIdxFundamentalsCache.delete(key);
    }
    while (twelveDataIdxFundamentalsCache.size > 500) {
      const oldest = twelveDataIdxFundamentalsCache.keys().next().value;
      if (oldest === undefined) break;
      twelveDataIdxFundamentalsCache.delete(oldest);
    }
  }
  return result;
}

/** Fetch news/sentiment for every supported asset class; stock fundamentals remain equity-only. */
export async function fetchAlphaVantageIntelligence(
  symbolInput:string,
  apiKey:string|undefined,
  fetchImpl:typeof fetch=fetch,
  instrumentTypeInput:AlphaVantageInstrumentType="stock",
):Promise<AlphaVantageIntelligenceResult> {
  const symbol=symbolInput.trim().toUpperCase();
  const instrumentType=instrumentTypeInput;
  const validSymbol=instrumentType==="stock"
    ? /^[A-Z0-9.-]{1,15}$/.test(symbol)
    : /^[A-Z0-9./-]{1,40}$/.test(symbol);
  const newsQuery=validSymbol?resolveAlphaVantageNewsQuery(symbol,instrumentType):null;
  if(!newsQuery) return {success:false,dataAvailable:{news:false,fundamentals:false,macro:false},error:"A supported instrument symbol is required.",errorCode:"NO_DATA"};
  if(!apiKey?.trim()) return {success:false,dataAvailable:{news:false,fundamentals:false,macro:false},error:"Alpha Vantage API key is not configured.",errorCode:"AUTH_ERROR"};
  const cacheKey=`${instrumentType}:${symbol}`;
  const cached=alphaVantageCache.get(cacheKey);
  if(cached&&cached.expiresAt>Date.now()) return cached.value;
  const pending=alphaVantageInflight.get(cacheKey);
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
    const requests=[request({function:"NEWS_SENTIMENT",...newsQuery.params,sort:"LATEST",limit:"50"})];
    if(instrumentType==="stock") {
      requests.push(request({function:"OVERVIEW",symbol}));
      requests.push(request({function:"EARNINGS",symbol}));
    }
    const outcomes=await Promise.allSettled(requests);
    const errors=outcomes
      .filter((x):x is PromiseRejectedResult=>x.status==="rejected")
      .map(x=>x.reason instanceof Error?x.reason.message:String(x.reason));
    const newsOutcome=outcomes[0];
    const newsPayload=newsOutcome?.status==="fulfilled"?newsOutcome.value:undefined;
    const overviewOutcome=instrumentType==="stock"?outcomes[1]:undefined;
    const earningsOutcome=instrumentType==="stock"?outcomes[2]:undefined;
    const overview=overviewOutcome?.status==="fulfilled"?overviewOutcome.value as RawOverview:undefined;
    const earnings=earningsOutcome?.status==="fulfilled"?earningsOutcome.value as RawEarnings:undefined;
    const feed=Array.isArray(newsPayload?.feed)?newsPayload.feed as RawNewsFeed["feed"]:undefined;
    const articles=normalizeNewsArticles(feed,newsQuery.relatedSymbol);
    const sentiment=aggregateSentiment(articles,"alpha-vantage");
    const macro=buildMacroContext(articles,instrumentType);
    const fundamentals=instrumentType==="stock"
      ? normalizeFundamentals(overview??null,earnings??null,"stock",symbol)
      : undefined;
    const dataAvailable={
      news:articles.length>0,
      fundamentals:fundamentals?.available??false,
      macro:macro.confidence!=="unavailable",
    };
    const hasData=Object.values(dataAvailable).some(Boolean);
    const result:AlphaVantageIntelligenceResult={
      success:hasData,
      sentiment,
      ...(fundamentals?{fundamentals}:{}),
      macro,
      dataAvailable,
      ...(errors.length?{
        error:errors.join("; "),
        errorCode:errors.some(x=>/rate limit|call frequency/i.test(x))?"RATE_LIMIT":"API_UNAVAILABLE",
      }:!hasData?{
        error:"Alpha Vantage returned no matching news or intelligence data.",
        errorCode:"NO_DATA",
      }:{}),
    };
    alphaVantageCache.set(cacheKey,{value:result,expiresAt:Date.now()+(result.success?5*60_000:30_000)});
    return result;
  })().finally(()=>alphaVantageInflight.delete(cacheKey));
  alphaVantageInflight.set(cacheKey,task);
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

interface CandleFetchResult {
  candles: OhlcvCandle[];
  provider: string;
}

async function fetchBinanceSpotCandles(
  instrumentInput: string,
  timeframe: string,
  count: number,
  fetchImpl: typeof fetch,
): Promise<OhlcvCandle[]> {
  const symbol = instrumentInput.trim().toUpperCase().replace(/[/-]/g, "");
  // Only use Binance when the requested quote currency is identical. Never
  // silently replace USD, BTC, ETH, or a derivative contract with a proxy.
  if (!/^[A-Z0-9]{2,30}(USDT|USDC)$/.test(symbol)) {
    throw new Error("No exact Binance spot symbol is available for this quote currency.");
  }
  const interval = ({ M1: "1m", M5: "5m", M15: "15m", H1: "1h", H4: "4h", D1: "1d", W1: "1w" } as Record<string,string>)[timeframe];
  if (!interval) throw new Error("Unsupported Binance spot timeframe: " + timeframe);
  const query = new URLSearchParams({ symbol, interval, limit: String(Math.min(1000, Math.max(20, Math.floor(count)))) });
  const failures: string[] = [];
  for (const host of ["https://api.binance.com", "https://data-api.binance.vision"]) {
    try {
      const response = await fetchImpl(host + "/api/v3/klines?" + query, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload)) {
        failures.push(host + " HTTP " + response.status);
        continue;
      }
      const candles = payload
        .filter((row: unknown) => Array.isArray(row) && row.length >= 6)
        .map((row: unknown[]) => ({
          timestamp: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        }))
        .filter((row: OhlcvCandle) => [row.timestamp,row.open,row.high,row.low,row.close,row.volume].every(Number.isFinite) &&
          Number.isSafeInteger(row.timestamp) && row.timestamp > 0 && row.open > 0 &&
          row.high >= Math.max(row.open,row.close,row.low) &&
          row.low <= Math.min(row.open,row.close,row.high) && row.volume >= 0)
        .sort((a: OhlcvCandle,b: OhlcvCandle) => a.timestamp-b.timestamp)
        .slice(-count);
      if (candles.length < 20) {
        failures.push(host + " returned fewer than 20 valid candles");
        continue;
      }
      return candles;
    } catch (error) {
      failures.push(host + ": " + (error instanceof Error ? error.message : "request failed"));
    }
  }
  throw new Error("Binance exact-symbol fallback unavailable: " + failures.join("; "));
}

async function fetchCandles(
  request:MarketAnalysisRequest,
  timeframe:string,
  count:number,
  okx:OkxSpotMarketAdapter,
  fetchImpl:typeof fetch,
):Promise<CandleFetchResult> {
  if(request.instrumentType==="crypto") {
    const instrument = request.instrument.toUpperCase();
    if (instrument.endsWith("-SWAP") || /-[0-9]{6}$/.test(instrument)) {
      const bar = ({ M1: "1m", M5: "5m", M15: "15m", H1: "1H", H4: "4H", D1: "1D", W1: "1W" } as Record<string,string>)[timeframe];
      if (!bar) throw Object.assign(new Error("Unsupported OKX derivative candle timeframe: " + timeframe), { code: "UNSUPPORTED" });
      const url = "https://www.okx.com/api/v5/market/candles?instId=" + encodeURIComponent(instrument) +
        "&bar=" + encodeURIComponent(bar) + "&limit=" + Math.min(300, Math.max(1, Math.floor(count)));
      const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || String(payload.code) !== "0" || !Array.isArray(payload.data)) {
        throw Object.assign(new Error("OKX derivative candles unavailable for exact contract " + instrument + ": " + String(payload?.msg ?? response.statusText)), { code: "API_UNAVAILABLE" });
      }
      const candles = payload.data
        .filter((row: unknown) => Array.isArray(row) && row.length >= 6)
        .map((row: unknown[]) => ({
          timestamp: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5] ?? 0),
        }))
        .filter((row: OhlcvCandle) => [row.timestamp,row.open,row.high,row.low,row.close,row.volume].every(Number.isFinite) &&
          row.timestamp > 0 && row.open > 0 && row.high >= Math.max(row.open,row.close,row.low) &&
          row.low <= Math.min(row.open,row.close,row.high))
        .sort((a: OhlcvCandle,b: OhlcvCandle) => a.timestamp-b.timestamp)
        .slice(-count);
      if (candles.length < 20) throw Object.assign(new Error("OKX returned fewer than 20 valid candles for exact contract " + instrument), { code: "API_UNAVAILABLE" });
      return { candles, provider: instrument.endsWith("-SWAP") ? "okx-perpetual-public" : "okx-dated-futures-public" };
    }
    try {
      const candles = await okx.fetchCandles(request.instrument,timeframe,count);
      return { candles, provider: OKX_SPOT_MARKET_PROVIDER };
    } catch (primaryError) {
      try {
        const candles = await fetchBinanceSpotCandles(instrument,timeframe,count,fetchImpl);
        return { candles, provider: "binance-spot-public-fallback" };
      } catch (fallbackError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : "OKX spot request failed";
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Binance fallback failed";
        throw Object.assign(new Error("Primary OKX spot feed failed (" + primaryMessage + "). Exact-quote Binance fallback also failed (" + fallbackMessage + ")."), {
          code: (primaryError as { code?: string })?.code ?? "API_UNAVAILABLE",
        });
      }
    }
  }
  const symbol=resolveYahooSymbol(request.instrumentType,request.instrument);
  if(!symbol) {
    throw Object.assign(new Error("No exact Yahoo Finance ticker mapping exists for this instrument. No correlated proxy or substitute instrument was used."),{code:"UNSUPPORTED"});
  }
  const candles = await fetchYahooFinanceCandles(symbol,timeframe,count,fetchImpl);
  return { candles, provider: "yahoo-finance-public" };
}


function inferInstrumentType(instrumentInput: string): MarketAnalysisRequest["instrumentType"] {
  const instrument = instrumentInput.trim().toUpperCase();
  if (instrument.endsWith("-SWAP") || /-[0-9]{6}$/.test(instrument)) return "crypto";

  // Explicit metal/energy aliases take precedence over generic six-letter
  // currency-pair heuristics (XAUUSD is a commodity, not forex).
  if (/^(XAU|XAG|WTI|BRENT|GOLD|SILVER|COPPER|CL|NG)/.test(instrument)) return "commodity";
  if (INDEX_SYMBOLS[instrument] || MACRO_INDEX_SYMBOLS.has(instrument)) return "indices";

  const registered = resolveInstrument(instrument);
  if (registered?.assetClass === "crypto") return "crypto";
  if (registered?.assetClass === "forex") return "forex";
  if (registered?.assetClass === "commodity") return "commodity";
  if (registered?.assetClass === "equity") return "stock";
  if (registered?.assetClass === "indices") return "indices";

  // USD-quoted FX pairs are not crypto. Crypto USD aliases are limited to
  // recognized base assets; USDT/USDC pairs may use any canonical ticker.
  if (/^(BTC|ETH|SOL|XRP|BNB|ADA|DOGE|AVAX|DOT|LINK|LTC|BCH|TRX|TON)[/-](USD|USDT|USDC|BTC|ETH)$/.test(instrument) ||
      /^[A-Z0-9]{2,20}[/-](USDT|USDC|BTC|ETH)$/.test(instrument) ||
      /^[A-Z0-9]{2,20}(USDT|USDC)$/.test(instrument)) return "crypto";
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(instrument) || /^[A-Z]{6}$/.test(instrument)) return "forex";
  return "stock";
}

/** Fetches a bounded batch of real OHLCV candles through the backend provider fabric. */
export async function fetchMarketCandlesBatch(
  instruments: string[],
  timeframes: string[],
  outputsize: number,
  fetchImpl: typeof fetch = fetch,
) {
  const okx = new OkxSpotMarketAdapter(fetchImpl);
  const requests = instruments.flatMap((instrument) => timeframes.map((timeframe) => ({ instrument, timeframe })));
  return Promise.all(requests.map(async ({ instrument, timeframe }) => {
    try {
      const instrumentType = inferInstrumentType(instrument);
      const result = await fetchCandles({
        instrument: instrument.trim().toUpperCase(),
        instrumentType,
        timeframe: timeframe.trim().toUpperCase(),
      }, timeframe.trim().toUpperCase(), Math.min(300, Math.max(20, Math.floor(outputsize))), okx, fetchImpl);
      return {
        instrument: instrument.trim().toUpperCase(),
        timeframe: timeframe.trim().toUpperCase(),
        success: true,
        candles: result.candles,
        provider: result.provider,
      };
    } catch (error) {
      return {
        instrument: instrument.trim().toUpperCase(),
        timeframe: timeframe.trim().toUpperCase(),
        success: false,
        candles: [],
        error: error instanceof Error ? error.message : "OHLCV provider request failed",
      };
    }
  }));
}

async function calculate(request:MarketAnalysisRequest,fetchImpl:typeof fetch):Promise<MarketAnalysisResult> {
  const symbol=request.instrument.trim().toUpperCase();
  const now=Date.now();
  const okx=new OkxSpotMarketAdapter(fetchImpl);
  let provider=request.instrumentType==="crypto"
    ? (/-SWAP$/.test(symbol) ? "okx-perpetual-public" : /-[0-9]{6}$/.test(symbol) ? "okx-dated-futures-public" : OKX_SPOT_MARKET_PROVIDER)
    : "yahoo-finance-public";

  try {
    const candleResult=await fetchCandles(request,request.timeframe,210,okx,fetchImpl);
    const candles=candleResult.candles;
    provider=candleResult.provider;
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
      return (await fetchCandles(request,slot.timeframe,slot.role==="trigger"?100:120,okx,fetchImpl)).candles;
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


import { buildCotContext, mapInstrumentToCot } from "../../src/lib/data/cot";
import { buildEiaContext, parseEiaResponse, parseFredInventoryCsv } from "../../src/lib/data/eia";
import { applyFredYieldFallback, buildTreasuryContext } from "../../src/lib/data/treasury";

async function fetchText(url: string, accept: string, fetchImpl: typeof fetch, timeoutMs = 7000): Promise<string | undefined> {
  try {
    const response = await fetchImpl(url, { headers: { accept }, signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchCotPositioning(instrumentInput: string, fetchImpl: typeof fetch = fetch) {
  const instrument = instrumentInput.trim().toUpperCase();
  const mapping = mapInstrumentToCot(instrument);
  if (!mapping) return { success: false as const, error: `No verified CFTC futures contract mapping for ${instrument}.` };
  try {
    const url = "https://publicreporting.cftc.gov/resource/6dca-aqww.json?market_and_exchange_names=" +
      encodeURIComponent(mapping.sourceInstrument) + "&%24order=report_date_as_yyyy_mm_dd%20DESC&%24limit=2";
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7000) });
    if (!response.ok) return { success: false as const, error: `CFTC endpoint returned HTTP ${response.status}.` };
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) return { success: false as const, error: "CFTC endpoint returned a non-array response." };
    const context = buildCotContext(rows, instrument, Date.now());
    return context.available ? { success: true as const, data: context } : { success: false as const, error: context.reason };
  } catch (error) {
    return { success: false as const, error: `CFTC fetch failed: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

const EIA_FRED_SERIES = [
  { productId: "EPC0", seriesId: "WCESTUS1", productName: "Commercial crude oil stocks excluding SPR" },
  { productId: "EPM0", seriesId: "WGTSTUS1", productName: "Total motor gasoline stocks" },
  { productId: "EPD0", seriesId: "WDISTUS1", productName: "Distillate fuel oil stocks" },
] as const;

export async function fetchEiaInventory(apiKey: string | undefined, fetchImpl: typeof fetch = fetch) {
  const now = Date.now();
  const base = "https://api.eia.gov/v2/petroleum/sto/data/";
  const products = ["EPC0", "EPM0", "EPD0"] as const;
  const eiaLegs = apiKey?.trim() ? await Promise.all(products.map(async productId => {
    const url = base + "?api_key=" + encodeURIComponent(apiKey) +
      "&frequency=weekly&data%5B0%5D=value&facets%5Bproduct%5D%5B%5D=" + productId +
      "&facets%5Bprocess%5D%5B%5D=STA&facets%5Barea%5D%5B%5D=NUS-Z00" +
      "&sort%5B0%5D%5Bcolumn%5D=period&sort%5B0%5D%5Bdirection%5D=desc&length=2";
    try {
      const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7000) });
      if (!response.ok) return { ok: false, requestedProductId: productId, reason: `EIA HTTP ${response.status}` };
      return { ok: true, requestedProductId: productId, parsed: parseEiaResponse(await response.json()) };
    } catch (error) {
      return { ok: false, requestedProductId: productId, reason: error instanceof Error ? error.message : "EIA network failure" };
    }
  })) : [];
  let context = buildEiaContext(eiaLegs, now, now);
  if (!context.available) {
    const start = new Date(now - 35 * 86400000).toISOString().slice(0, 10);
    const end = new Date(now).toISOString().slice(0, 10);
    const fredLegs = await Promise.all(EIA_FRED_SERIES.map(async item => {
      const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + item.seriesId + "&cosd=" + start + "&coed=" + end;
      const csv = await fetchText(url, "text/csv", fetchImpl);
      return csv ? { ok: true, requestedProductId: item.productId, parsed: parseFredInventoryCsv(csv, item.productId, item.seriesId, item.productName) } :
        { ok: false, requestedProductId: item.productId, reason: "FRED mirror unavailable" };
    }));
    context = buildEiaContext(fredLegs, now, now, "EIA Weekly Petroleum Status Report (public FRED series mirror)");
  }
  return context.available ? { success: true as const, data: context } : { success: false as const, error: context.reason };
}

function utcMonth(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}



/** Fetches exact OKX contract metadata using the shared fail-closed parser. */
export async function fetchOkxInstrumentSpec(
  instrument: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; data?: OkxSpecData; error?: string }> {
  const instId = mapInstrumentToOkx(instrument);
  if (!instId) return { success: false, error: "instrument is not shaped like a verified OKX contract id or BASE/QUOTE pair" };
  const instType = /-[0-9]{6}$/.test(instId) ? "FUTURES" : "SWAP";
  try {
    const response = await fetchImpl(
      `https://www.okx.com/api/v5/public/instruments?instType=${instType}&instId=${encodeURIComponent(instId)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { success: false, error: `OKX instruments returned HTTP ${response.status}` };
    const parsed = parseOkxResponse(payload);
    const exact = parsed.instruments.filter((item) => item.instId === instId);
    if (exact.length !== 1) {
      return {
        success: false,
        error: exact.length === 0
          ? `OKX did not return the exact requested instrument ${instId}`
          : `OKX returned ambiguous metadata for ${instId}`,
      };
    }
    return {
      success: true,
      data: {
        fetchedAt: Date.now(),
        source: "OKX public instruments",
        freshness: "static",
        instruments: exact,
        parseWarnings: parsed.parseWarnings,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown provider error";
    return { success: false, error: `OKX instruments request failed: ${reason}` };
  }
}

/** Fetches a real OKX order-book snapshot and fails closed on instrument mismatch. */
export async function fetchOkxOrderBook(
  instrument: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; data?: ExecutionData; error?: string }> {
  const instId = mapInstrumentToOkx(instrument);
  if (!instId) return { success: false, error: "instrument is not shaped like a verified OKX contract id or BASE/QUOTE pair" };
  try {
    const response = await fetchImpl(
      `https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=50`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { success: false, error: `OKX order book returned HTTP ${response.status}` };
    const parsed = requireExactOrderBookInstrument(parseOkxOrderBook(payload), instId);
    const now = Date.now();
    const data = buildExecutionData(parsed, now, now);
    return data.available
      ? { success: true, data }
      : { success: false, data, error: data.reason };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown provider error";
    return { success: false, error: `OKX order-book request failed: ${reason}` };
  }
}

/** Exact dated-futures OI in USD; never substitutes the perpetual contract. */
export async function fetchOkxFuturesOpenInterest(
  instrument: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; data?: CryptoDerivativesData; error?: string }> {
  const instId = mapInstrumentToOkx(instrument);
  if (!instId || !/-[0-9]{6}$/.test(instId)) {
    return { success: false, error: "a literal dated OKX futures instrument ID is required" };
  }
  try {
    const response = await fetchImpl(
      `https://www.okx.com/api/v5/public/open-interest?instType=FUTURES&instId=${encodeURIComponent(instId)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { success: false, error: `OKX open-interest endpoint returned HTTP ${response.status}` };
    const data = parseOkxFuturesOpenInterest(payload, instId);
    if (!data) return { success: false, error: "OKX returned no fresh, exact-contract USD open-interest value" };
    return { success: true, data };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown provider error";
    return { success: false, error: `OKX open-interest request failed: ${reason}` };
  }
}


const TICKATLAS_CALENDAR_CACHE_TTL_MS = 20 * 60 * 1000;
const tickAtlasCalendarCache = new Map<string, { data: EconomicCalendarData; expiresAt: number }>();

function parseCalendarValue(value: unknown): number | string | undefined {
  if (value === null || value === undefined || value === "" || value === "‑" || value === "—" || value === "-") {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value);
}

function normalizeTickAtlasEvent(
  raw: unknown,
  relevantCountries: Map<string, string>,
  now: number,
): EconomicEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const eventName = typeof row.event === "string" ? row.event :
    typeof row.Event === "string" ? row.Event : "";
  const currency = typeof row.currency === "string" ? row.currency.toUpperCase() :
    typeof row.Currency === "string" ? row.Currency.toUpperCase() : "";
  if (!eventName || !currency || !relevantCountries.has(currency)) return null;

  const rawDate = row.datetime ?? row.Date ?? row.date;
  const datetime = typeof rawDate === "number" ? rawDate :
    typeof rawDate === "string" ? Date.parse(rawDate) : NaN;
  if (!Number.isFinite(datetime) || datetime <= 0) return null;

  const importanceRaw = typeof row.impact === "string" ? row.impact.toLowerCase() :
    typeof row.Importance === "string" ? row.Importance.toLowerCase() : "";
  const importance: EventImportance = importanceRaw === "high" ? 3 :
    importanceRaw === "medium" ? 2 : 1;
  const actual = parseCalendarValue(row.actual ?? row.Actual);
  const forecast = parseCalendarValue(row.forecast ?? row.Forecast);
  const previous = parseCalendarValue(row.previous ?? row.Previous);
  const revised = parseCalendarValue(row.revised ?? row.Revised);
  const status: EconomicEvent["status"] = actual !== undefined
    ? revised !== undefined ? "revised" : "released"
    : datetime < now ? "released" : "upcoming";
  const suppliedId = row.id ?? row.Id;
  const id = suppliedId === undefined || suppliedId === null || suppliedId === ""
    ? `${currency}-${datetime}-${eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    : String(suppliedId);

  return {
    id,
    event: eventName,
    category: typeof row.category === "string" ? row.category :
      typeof row.Category === "string" ? row.Category : "",
    country: relevantCountries.get(currency) ?? "",
    currency,
    datetime,
    ...(actual !== undefined ? { actual } : {}),
    ...(forecast !== undefined ? { forecast } : {}),
    ...(previous !== undefined ? { previous } : {}),
    ...(revised !== undefined ? { revised } : {}),
    importance,
    source: "tickatlas",
    ...(typeof row.url === "string" ? { sourceUrl: row.url } :
      typeof row.Source_url === "string" ? { sourceUrl: row.Source_url } : {}),
    ...(typeof row.period === "string" ? { referencePeriod: row.period } :
      typeof row.Period === "string" ? { referencePeriod: row.Period } : {}),
    status,
  };
}

function tickAtlasEvents(payload: unknown): unknown[] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const row = payload as Record<string, unknown>;
  if (row.success === true && row.data && typeof row.data === "object") {
    const data = row.data as Record<string, unknown>;
    if (Array.isArray(data.events)) return data.events;
  }
  if (Array.isArray(row.data)) return row.data;
  return undefined;
}

/** Fetches normalized TickAtlas economic events through the self-hosted backend. */
export async function fetchEconomicCalendar(
  instrument: string,
  instrumentType: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarResult> {
  if (!apiKey?.trim()) {
    return { success: false, error: "TickAtlas calendar is not configured: TICKATLAS_API_KEY is missing.", errorCode: "AUTH_ERROR" };
  }
  const relevantCurrencies = getRelevantCurrencies(instrument, instrumentType);
  if (relevantCurrencies.length === 0) {
    return { success: false, error: "No relevant currencies determined for this instrument.", errorCode: "NO_DATA" };
  }
  const cacheKey = `${instrument.toUpperCase()}:${instrumentType}`;
  const now = Date.now();
  const cached = tickAtlasCalendarCache.get(cacheKey);
  if (cached && now < cached.expiresAt) return { success: true, data: cached.data };
  if (cached) tickAtlasCalendarCache.delete(cacheKey);

  const countryParam = relevantCurrencies.map((item) => encodeURIComponent(item.country)).join(",");
  const relevantCountries = new Map(relevantCurrencies.map((item) => [item.currency, item.country]));
  const dateFrom = new Date(now).toISOString().slice(0, 10);
  const dateTo = new Date(now + 7 * 86400000).toISOString().slice(0, 10);
  const datePast = new Date(now - 7 * 86400000).toISOString().slice(0, 10);

  const requestCalendar = async (from: string, to: string) => {
    const url = `https://tickatlas.com/v1/calendar?countries=${countryParam}&from=${from}&to=${to}`;
    const response = await fetchImpl(url, {
      headers: { "X-API-Key": apiKey.trim(), accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "AUTH_ERROR" :
        response.status === 429 ? "RATE_LIMIT" : "API_UNAVAILABLE";
      const error = new Error(`TickAtlas calendar HTTP ${response.status}`);
      Object.assign(error, { code });
      throw error;
    }
    const events = tickAtlasEvents(await response.json().catch(() => null));
    if (!events) throw new Error("TickAtlas calendar returned an invalid event payload");
    return events;
  };

  let rawEvents: unknown[];
  try {
    rawEvents = await requestCalendar(dateFrom, dateTo);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code) : "API_UNAVAILABLE";
    const message = error instanceof Error ? error.message : "TickAtlas calendar request failed";
    return {
      success: false,
      error: message,
      errorCode: code === "AUTH_ERROR" || code === "RATE_LIMIT" || code === "NO_DATA" ? code : "API_UNAVAILABLE",
    };
  }

  try {
    const pastEvents = await requestCalendar(datePast, dateFrom);
    const existing = new Set(rawEvents.map((event) => {
      if (!event || typeof event !== "object") return "";
      const row = event as Record<string, unknown>;
      return String(row.id ?? row.Id ?? "");
    }));
    for (const event of pastEvents) {
      if (!event || typeof event !== "object") continue;
      const row = event as Record<string, unknown>;
      const id = String(row.id ?? row.Id ?? "");
      const normalized = normalizeTickAtlasEvent(event, relevantCountries, now);
      if (normalized && normalized.importance === 3 && normalized.actual !== undefined && (!id || !existing.has(id))) {
        rawEvents.push(event);
        if (id) existing.add(id);
      }
    }
  } catch {
    // Recent released-event enrichment is non-critical; the upcoming window remains authoritative.
  }

  const events = rawEvents
    .map((event) => normalizeTickAtlasEvent(event, relevantCountries, now))
    .filter((event): event is EconomicEvent => event !== null)
    .sort((a, b) => a.datetime - b.datetime);
  const nowMs = Date.now();
  const in24h = nowMs + 86400000;
  const in72h = nowMs + 3 * 86400000;
  const upcoming = events.filter((event) => event.status === "upcoming" && event.datetime > nowMs);
  const recentlyReleased = events.filter((event) =>
    (event.status === "released" || event.status === "revised") &&
    event.datetime > nowMs - 7 * 86400000,
  );
  const hasHighImpact = events.some((event) => event.importance === 3);
  const confidence: EconomicCalendarData["confidence"] = events.length === 0 ? "unavailable" :
    hasHighImpact && events.length >= 5 ? "high" : events.length >= 3 ? "medium" : "low";
  const data: EconomicCalendarData = {
    provider: "tickatlas",
    events,
    macroRisk: calculateMacroRisk(events),
    timestamp: Date.now(),
    freshness: events.length > 0 ? "recent" : "unavailable",
    confidence,
    availability: {
      upcoming24h: upcoming.some((event) => event.datetime <= in24h),
      upcoming72h: upcoming.some((event) => event.datetime <= in72h),
      recentReleased: recentlyReleased.length > 0,
    },
  };
  tickAtlasCalendarCache.set(cacheKey, { data, expiresAt: Date.now() + TICKATLAS_CALENDAR_CACHE_TTL_MS });
  if (tickAtlasCalendarCache.size > 5000) {
    for (const [key, value] of tickAtlasCalendarCache) {
      if (Date.now() >= value.expiresAt) tickAtlasCalendarCache.delete(key);
    }
    while (tickAtlasCalendarCache.size > 5000) {
      const oldestKey = tickAtlasCalendarCache.keys().next().value;
      if (oldestKey === undefined) break;
      tickAtlasCalendarCache.delete(oldestKey);
    }
  }
  return { success: true, data };
}


const cryptoDerivativesCache = new Map<string, { value: DerivativesResult; expiresAt: number }>();
const cryptoFundamentalsCache = new Map<string, { value: { success: boolean; data?: Record<string, unknown>; provider?: string; observedAt?: number; error?: string }; expiresAt: number }>();

const tokenomicsCache = new Map<string, { value: TokenomicsIntelligence; expiresAt: number }>();

async function fetchCryptoTokenomics(
  instrument: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<TokenomicsIntelligence> {
  const key = instrument.trim().toUpperCase();
  const cached = tokenomicsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let tokenomistFailure: string | undefined;
  if (apiKey?.trim()) {
    try {
      const result = await new TokenomistAdapter(fetchImpl, apiKey.trim()).fetch(key);
      if (result?.success && result.data && typeof result.data === "object") {
        const normalized = parseTokenomistResult(result.data as Parameters<typeof parseTokenomistResult>[0], key, result.observedAt ?? Date.now());
        if (normalized.available) {
          tokenomicsCache.set(key, { value: normalized, expiresAt: Date.now() + 30 * 60_000 });
          return normalized;
        }
      }
      tokenomistFailure = result?.error ?? "Tokenomist returned no verified tokenomics.";
    } catch (error) {
      tokenomistFailure = error instanceof Error ? error.message : "Tokenomist request failed.";
    }
  }
  try {
    const fallback = await new PatternPlusUnlockAdapter(fetchImpl).fetch(key);
    if (fallback.available) {
      tokenomicsCache.set(key, { value: fallback, expiresAt: Date.now() + 30 * 60_000 });
      return fallback;
    }
    const coinGeckoId = getProviderSymbol(key, "coingecko");
    if (coinGeckoId) {
      try {
        const response = await fetchImpl(
          "https://api.coingecko.com/api/v3/coins/" + encodeURIComponent(coinGeckoId) +
            "?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false",
          { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) },
        );
        if (response.ok) {
          const supply = parseCoinGeckoSupplyFallback(await response.json());
          if (supply) {
            const value = {
              ...supply,
              failureReason: "Supply fallback active. Verified unlock calendar unavailable: " +
                (fallback.failureReason ?? tokenomistFailure ?? "no dated unlock records returned"),
            };
            tokenomicsCache.set(key, { value, expiresAt: Date.now() + 30 * 60_000 });
            return value;
          }
        }
      } catch {
        // Preserve the explicit unavailable result below.
      }
    }
    const value = tokenomistFailure
      ? { ...fallback, failureReason: "Tokenomist unavailable (" + tokenomistFailure + "); " + (fallback.failureReason ?? "PatternPlus has no usable record.") }
      : fallback;
    tokenomicsCache.set(key, { value, expiresAt: Date.now() + 30 * 60_000 });
    return value;
  } catch (error) {
    const value: TokenomicsIntelligence = {
      provider: "PatternPlus",
      observedAt: Date.now(),
      freshness: "UNAVAILABLE",
      quality: "UNAVAILABLE",
      available: false,
      failureReason: error instanceof Error ? error.message : "Tokenomics provider unavailable.",
      availableDatasets: 0,
      totalDatasets: 2,
    };
    tokenomicsCache.set(key, { value, expiresAt: Date.now() + 30 * 60_000 });
    return value;
  }
}

function finiteProviderNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

type ProviderRow = Record<string, unknown>;

function providerRows(value: unknown): ProviderRow[] {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  return candidates.filter((item): item is ProviderRow => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

async function fetchCoinGlassJson(path: string, apiKey: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl("https://open-api-v4.coinglass.com/api" + path, {
    headers: { accept: "application/json", "CG-API-KEY": apiKey },
    signal: AbortSignal.timeout(6500),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`CoinGlass HTTP ${response.status}`);
  if (!payload || (payload.code !== undefined && String(payload.code) !== "0")) {
    throw new Error("CoinGlass returned an invalid or unsuccessful response");
  }
  return payload.data ?? payload;
}

export async function fetchCryptoDerivatives(
  instrument: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  tokenomistApiKey?: string,
): Promise<DerivativesResult> {
  const normalized = instrument.trim().toUpperCase();
  if (!normalized || normalized.length > 80) return { success: false, error: "A valid crypto instrument is required.", errorCode: "UNSUPPORTED_ASSET" };
  const cached = cryptoDerivativesCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) cryptoDerivativesCache.delete(normalized);
  const tokenomicsPromise = fetchCryptoTokenomics(normalized, tokenomistApiKey, fetchImpl);

  if (apiKey?.trim()) {
    const symbol = normalized.split("/")[0].replace(/-SWAP$/, "").replace(/-[0-9]{6}$/, "").replace(/-(USDT|USDC|USD|BTC|ETH)$/, "");
    try {
      const [oiRaw, fundingRaw, longShortRaw, liquidationRaw] = await Promise.allSettled([
        fetchCoinGlassJson("/futures/open-interest/exchange-list?symbol=" + encodeURIComponent(symbol), apiKey.trim(), fetchImpl),
        fetchCoinGlassJson("/futures/funding-rate/exchange-list?symbol=" + encodeURIComponent(symbol), apiKey.trim(), fetchImpl),
        fetchCoinGlassJson("/futures/global-long-short-account-ratio/history?exchange=Binance&symbol=" + encodeURIComponent(symbol + "USDT") + "&interval=4h&limit=1", apiKey.trim(), fetchImpl),
        fetchCoinGlassJson("/futures/liquidation/aggregated-history?exchange_list=Binance%2COKX%2CBybit&symbol=" + encodeURIComponent(symbol) + "&interval=4h&limit=1", apiKey.trim(), fetchImpl),
      ]);
      const oiRows = oiRaw.status === "fulfilled" ? providerRows(oiRaw.value) : [];
      const oiItem = oiRows.find((item) => String(item.exchange ?? "").toLowerCase() === "all") ?? oiRows[0];
      const oiValue = finiteProviderNumber(oiItem?.open_interest_usd);
      const openInterest: OpenInterestData | undefined = oiValue !== undefined && oiValue > 0 ? {
        current: oiValue,
        ...(finiteProviderNumber(oiItem?.open_interest_change_percent_1h) !== undefined ? { change1h: finiteProviderNumber(oiItem.open_interest_change_percent_1h) } : {}),
        ...(finiteProviderNumber(oiItem?.open_interest_change_percent_24h) !== undefined ? { change24h: finiteProviderNumber(oiItem.open_interest_change_percent_24h) } : {}),
      } : undefined;
      const fundingRows = fundingRaw.status === "fulfilled" ? providerRows(fundingRaw.value) : [];
      const fundingItem = fundingRows.find((item) => String(item.symbol ?? "").toUpperCase() === symbol) ?? fundingRows[0];
      const fundingEntries = providerRows(fundingItem?.stablecoin_margin_list);
      const fundingValues = fundingEntries.map((entry) => ({
        name: String(entry.exchange ?? "unknown"),
        raw: finiteProviderNumber(entry.funding_rate),
        interval: finiteProviderNumber(entry.funding_rate_interval) ?? 8,
      })).filter((entry): entry is { name: string; raw: number; interval: number } => entry.raw !== undefined);
      const selectedFunding = fundingValues.find((entry) => entry.name.toLowerCase() === "binance") ?? fundingValues[0];
      const fundingRate: FundingRateData | undefined = selectedFunding ? {
        currentRate: selectedFunding.raw / 100,
        annualizedRate: selectedFunding.raw / 100 * (24 / Math.max(1, selectedFunding.interval)) * 365,
        exchanges: fundingValues.map((entry) => ({ name: entry.name, rate: entry.raw / 100 })),
      } : undefined;
      const lsRows = longShortRaw.status === "fulfilled" ? providerRows(longShortRaw.value) : [];
      const lsValue = finiteProviderNumber(lsRows.at(-1)?.global_account_long_short_ratio);
      const longShort: LongShortData | undefined = lsValue !== undefined && lsValue > 0 ? { accountRatio: lsValue } : undefined;
      const liquidationRows = liquidationRaw.status === "fulfilled" ? providerRows(liquidationRaw.value) : [];
      const liqItem = liquidationRows.at(-1);
      const longVolume = finiteProviderNumber(liqItem?.aggregated_long_liquidation_usd);
      const shortVolume = finiteProviderNumber(liqItem?.aggregated_short_liquidation_usd);
      const liquidations: LiquidationData | undefined = longVolume !== undefined || shortVolume !== undefined ? {
        longVolume: longVolume ?? 0, shortVolume: shortVolume ?? 0,
        totalVolume: (longVolume ?? 0) + (shortVolume ?? 0),
        dominantSide: (longVolume ?? 0) > (shortVolume ?? 0) * 1.5 ? "longs" :
          (shortVolume ?? 0) > (longVolume ?? 0) * 1.5 ? "shorts" : "balanced",
        window: "4h",
      } : undefined;
      const availability = { openInterest: Boolean(openInterest), fundingRate: Boolean(fundingRate), longShort: Boolean(longShort), liquidations: Boolean(liquidations) };
      const available = Object.values(availability).filter(Boolean).length;
      if (available > 0) {
        const tokenomics = await tokenomicsPromise;
        const value: DerivativesResult = {
          success: true,
          tokenomics,
          data: {
            provider: "coinglass", symbol, timestamp: Date.now(), freshness: "realtime",
            ...(openInterest ? { openInterest } : {}), ...(fundingRate ? { fundingRate } : {}),
            ...(longShort ? { longShort } : {}), ...(liquidations ? { liquidations } : {}),
            availability, confidence: available >= 3 ? "high" : available >= 2 ? "medium" : "low",
          },
        };
        cryptoDerivativesCache.set(normalized, { value, expiresAt: Date.now() + 60_000 });
        return value;
      }
    } catch {
      // A failed paid provider is never promoted; try explicitly labelled public adapters.
    }
  }

  const adapters = [
    new BinancePublicDerivativesAdapter(fetchImpl),
    new BybitPublicDerivativesAdapter(fetchImpl),
    new OkxPublicDerivativesAdapter(fetchImpl),
  ];
  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.fetch(normalized)));
  const match = settled.find((item) => item.status === "fulfilled" && item.value);
  const data = match?.status === "fulfilled" ? match.value : null;
  const tokenomics = await tokenomicsPromise;
  if (!data) return { success: tokenomics.available, tokenomics, error: "CoinGlass and public derivatives providers returned no usable data for the exact instrument.", errorCode: "NO_DATA" };
  const value: DerivativesResult = { success: true, data, tokenomics };
  cryptoDerivativesCache.set(normalized, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

export async function fetchCryptoFundamentals(instrument: string, fetchImpl: typeof fetch = fetch) {
  const key = instrument.trim().toUpperCase();
  const cached = cryptoFundamentalsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const result = await new DeFiLlamaAdapter(fetchImpl).fetch(key);
  if (!result || !result.success || !result.data) {
    return { success: false, error: result?.error ?? "DeFiLlama does not support this instrument.", provider: result?.provider ?? "DeFiLlama", observedAt: result?.observedAt ?? Date.now() };
  }
  const value = { success: true, data: result.data as Record<string, unknown>, provider: result.provider, observedAt: result.observedAt };
  cryptoFundamentalsCache.set(key, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
  return value;
}

const FX_REFERENCE_CACHE_TTL_MS = 60 * 60 * 1000;

/** Fetches a dated Frankfurter reference rate; never labels it as a live quote. */
export async function fetchFxReference(
  fromInput: string,
  toInput: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  success: boolean;
  direct?: FxRateSnapshot | null;
  inverse?: FxRateSnapshot | null;
  error?: string;
}> {
  const from = fromInput.trim().toUpperCase();
  const to = toInput.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return { success: false, error: "invalid ISO currency code for FX reference" };
  }
  if (from === to) return { success: false, error: "same currency — no conversion needed" };

  const pair = `${from}/${to}`;
  const now = Date.now();
  const cached = fxReferenceCache.get(pair);
  if (
    cached &&
    now < cached.expiresAt &&
    now >= cached.direct.timestamp &&
    now - cached.direct.timestamp <= (cached.direct.maxAgeMs ?? 0)
  ) {
    return { success: true, direct: { ...cached.direct }, inverse: null };
  }
  if (cached) fxReferenceCache.delete(pair);

  try {
    const response = await fetchImpl(
      `https://api.frankfurter.dev/v2/rate/${from.toLowerCase()}/${to.toLowerCase()}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        success: false,
        error: `Frankfurter daily FX reference unavailable for ${pair} (HTTP ${response.status})`,
      };
    }
    const parsed = parseDailyFxReferenceSnapshot(payload, from, to, now);
    if ("error" in parsed) return { success: false, error: parsed.error };

    fxReferenceCache.set(pair, {
      direct: parsed.snapshot,
      expiresAt: now + FX_REFERENCE_CACHE_TTL_MS,
    });
    if (fxReferenceCache.size > 5000) {
      for (const [key, value] of fxReferenceCache) {
        if (now >= value.expiresAt || now - value.direct.timestamp > (value.direct.maxAgeMs ?? 0)) {
          fxReferenceCache.delete(key);
        }
      }
      while (fxReferenceCache.size > 5000) {
        const oldestKey = fxReferenceCache.keys().next().value;
        if (oldestKey === undefined) break;
        fxReferenceCache.delete(oldestKey);
      }
    }
    return { success: true, direct: parsed.snapshot, inverse: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown provider error";
    return { success: false, error: `Frankfurter daily FX reference failed for ${pair}: ${reason}` };
  }
}

export async function fetchTreasuryYields(fetchImpl: typeof fetch = fetch) {
  const now = new Date();
  const thisMonth = utcMonth(now);
  const previousMonth = utcMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const base = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=";
  const [nominalCurrent, nominalPrevious, realCurrent, realPrevious] = await Promise.all([
    fetchText(base + "daily_treasury_yield_curve&field_tdr_date_value_month=" + thisMonth, "text/xml", fetchImpl),
    fetchText(base + "daily_treasury_yield_curve&field_tdr_date_value_month=" + previousMonth, "text/xml", fetchImpl),
    fetchText(base + "daily_treasury_real_yield_curve&field_tdr_date_value_month=" + thisMonth, "text/xml", fetchImpl),
    fetchText(base + "daily_treasury_real_yield_curve&field_tdr_date_value_month=" + previousMonth, "text/xml", fetchImpl),
  ]);
  let context = buildTreasuryContext(
    [nominalCurrent?.includes("<entry>") ? nominalCurrent : undefined, nominalPrevious?.includes("<entry>") ? nominalPrevious : undefined],
    [realCurrent?.includes("<entry>") ? realCurrent : undefined, realPrevious?.includes("<entry>") ? realPrevious : undefined],
    Date.now(),
  );
  if (!context.available || !context.latest.real || !context.previous?.real) {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const fred = async (series: string) => fetchText("https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + series + "&cosd=" + start + "&coed=" + end, "text/csv", fetchImpl, 5000);
    const [dgs2, dgs10, dfii10] = await Promise.all([fred("DGS2"), fred("DGS10"), fred("DFII10")]);
    context = applyFredYieldFallback(context, dgs2, dgs10, dfii10, Date.now());
  }
  return context.available ? { success: true as const, data: context } : { success: false as const, error: context.reason };
}


export interface LiveMarketQuoteResult {
  instrument: string;
  assetClass: string;
  price: number;
  bid?: number;
  ask?: number;
  change24h?: number;
  volume24h?: number;
  timestamp: number;
  provider: string;
  primaryProvider: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  sourceMode: "LIVE" | "SIMULATED" | "STALE" | "UNAVAILABLE";
  success: boolean;
  error?: string;
}

const LIVE_QUOTE_CACHE_TTL_MS = 10_000;
const liveQuoteCache = new Map<string, { value: LiveMarketQuoteResult; expiresAt: number }>();
const liveQuoteInflight = new Map<string, Promise<LiveMarketQuoteResult>>();

function liveQuoteFresh(timestamp: number, now = Date.now()): boolean {
  const age = now - timestamp;
  return Number.isFinite(timestamp) && timestamp > 0 && age >= -30_000 && age <= 60_000;
}

function normalizeLiveOkxInstrument(instrument: string): string | null {
  const value = instrument.trim().toUpperCase().replace(/\s/g, "");
  if (value.endsWith("-SWAP") || /-[0-9]{6}$/.test(value)) return value;
  if (/^[A-Z0-9]{2,20}-[A-Z0-9]{2,20}$/.test(value)) return value;
  if (/^[A-Z0-9]{2,20}(USDT|USDC|USD)$/.test(value)) {
    const quote = value.endsWith("USDT") ? "USDT" : value.endsWith("USDC") ? "USDC" : "USD";
    return value.slice(0, -quote.length) + "-" + quote;
  }
  const exactSlashPair = value.match(/^([A-Z0-9]{2,20})\/([A-Z0-9]{2,20})$/);
  if (exactSlashPair) return exactSlashPair[1] + "-" + exactSlashPair[2];
  return toOkxSpotInstrument(value);
}

async function fetchExactOkxLiveQuote(
  instId: string,
  fetchImpl: typeof fetch,
): Promise<{ price: number; timestamp: number; bid?: number; ask?: number; change24h?: number; volume24h?: number }> {
  const response = await fetchImpl(
    "https://www.okx.com/api/v5/market/ticker?instId=" + encodeURIComponent(instId),
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || String(payload.code) !== "0" || !Array.isArray(payload.data)) {
    throw new Error("OKX exact-instrument ticker unavailable for " + instId + ": " + String(payload?.msg ?? response.statusText));
  }
  const row = payload.data.find((item: unknown) =>
    Boolean(item) && typeof item === "object" && String((item as Record<string, unknown>).instId ?? "") === instId
  ) as Record<string, unknown> | undefined;
  if (!row) throw new Error("OKX did not return the exact requested instrument " + instId);
  const price = finiteProviderNumber(row.last);
  const timestamp = finiteProviderNumber(row.ts);
  if (price === undefined || price <= 0 || timestamp === undefined || timestamp <= 0) {
    throw new Error("OKX returned an invalid or un-timestamped quote for " + instId);
  }
  const rawBid = finiteProviderNumber(row.bidPx);
  const rawAsk = finiteProviderNumber(row.askPx);
  const bid = rawBid !== undefined && rawBid > 0 ? rawBid : undefined;
  const ask = rawAsk !== undefined && rawAsk > 0 ? rawAsk : undefined;
  const crossedSpread = bid !== undefined && ask !== undefined && bid > ask;
  const open24h = finiteProviderNumber(row.open24h);
  const volume24h = finiteProviderNumber(row.vol24h);
  return {
    price,
    timestamp,
    ...(!crossedSpread && bid !== undefined ? { bid } : {}),
    ...(!crossedSpread && ask !== undefined ? { ask } : {}),
    ...(open24h !== undefined && open24h > 0 ? { change24h: ((price - open24h) / open24h) * 100 } : {}),
    ...(volume24h !== undefined && volume24h >= 0 ? { volume24h } : {}),
  };
}

async function fetchExactBinanceSpotFallback(
  instrument: string,
  fetchImpl: typeof fetch,
): Promise<{ price: number; timestamp: number; bid?: number; ask?: number; change24h?: number; volume24h?: number }> {
  const normalized = instrument.trim().toUpperCase().replace("/", "-");
  const match = normalized.match(/^([A-Z0-9]{2,20})-USDT$/);
  if (!match) throw new Error("Binance fallback is restricted to the exact USDT spot pair");
  const symbol = match[1] + "USDT";
  const response = await fetchImpl(
    "https://api.binance.com/api/v3/ticker/24hr?symbol=" + encodeURIComponent(symbol),
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || String(payload.symbol ?? "") !== symbol) {
    throw new Error("Binance exact spot fallback unavailable for " + symbol);
  }
  const price = finiteProviderNumber(payload.lastPrice);
  const timestamp = finiteProviderNumber(payload.closeTime);
  if (price === undefined || price <= 0 || timestamp === undefined || timestamp <= 0) {
    throw new Error("Binance returned an invalid or un-timestamped exact spot quote for " + symbol);
  }
  const rawBid = finiteProviderNumber(payload.bidPrice);
  const rawAsk = finiteProviderNumber(payload.askPrice);
  const bid = rawBid !== undefined && rawBid > 0 ? rawBid : undefined;
  const ask = rawAsk !== undefined && rawAsk > 0 ? rawAsk : undefined;
  const crossedSpread = bid !== undefined && ask !== undefined && bid > ask;
  const change24h = finiteProviderNumber(payload.priceChangePercent);
  const volume24h = finiteProviderNumber(payload.volume);
  return {
    price,
    timestamp,
    ...(!crossedSpread && bid !== undefined ? { bid } : {}),
    ...(!crossedSpread && ask !== undefined ? { ask } : {}),
    ...(change24h !== undefined ? { change24h } : {}),
    ...(volume24h !== undefined && volume24h >= 0 ? { volume24h } : {}),
  };
}

const twelveDataQuoteBudget = { windowStartedAt: 0, requests: 0 };
const TWELVE_DATA_QUOTE_WINDOW_MS = 60_000;
const TWELVE_DATA_QUOTE_MAX_REQUESTS = 8;

function reserveTwelveDataQuoteRequest(now = Date.now()): boolean {
  if (now - twelveDataQuoteBudget.windowStartedAt >= TWELVE_DATA_QUOTE_WINDOW_MS) {
    twelveDataQuoteBudget.windowStartedAt = now;
    twelveDataQuoteBudget.requests = 0;
  }
  if (twelveDataQuoteBudget.requests >= TWELVE_DATA_QUOTE_MAX_REQUESTS) return false;
  twelveDataQuoteBudget.requests += 1;
  return true;
}

function normalizeTwelveDataQuoteSymbol(instrument: string): string {
  const normalized = instrument.trim().toUpperCase().replace(/-/g, "/");
  if (/^[A-Z]{6}$/.test(normalized)) return normalized.slice(0, 3) + "/" + normalized.slice(3);
  if (normalized === "XAUUSD" || normalized === "GOLD") return "XAU/USD";
  if (normalized === "XAGUSD" || normalized === "SILVER") return "XAG/USD";
  return normalized;
}

async function fetchTwelveDataLiveQuote(
  instrument: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ price: number; timestamp: number; bid?: number; ask?: number; change24h?: number; volume24h?: number }> {
  const symbol = normalizeTwelveDataQuoteSymbol(instrument);
  const url = "https://api.twelvedata.com/quote?symbol=" + encodeURIComponent(symbol) +
    "&apikey=" + encodeURIComponent(apiKey);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(6_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("TwelveData quote request failed with HTTP " + response.status);
  }
  const row = payload as Record<string, unknown>;
  if (row.code || row.status === "error") throw new Error("TwelveData returned an unsuccessful quote response");
  const price = finiteProviderNumber(row.close);
  const rawTimestamp = finiteProviderNumber(row.timestamp);
  if (price === undefined || price <= 0 || rawTimestamp === undefined || rawTimestamp <= 0) {
    throw new Error("TwelveData returned no valid provider-timestamped quote");
  }
  const timestamp = rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
  const rawBid = finiteProviderNumber(row.bid);
  const rawAsk = finiteProviderNumber(row.ask);
  const bid = rawBid !== undefined && rawBid > 0 ? rawBid : undefined;
  const ask = rawAsk !== undefined && rawAsk > 0 ? rawAsk : undefined;
  const crossedSpread = bid !== undefined && ask !== undefined && bid > ask;
  const change24h = finiteProviderNumber(row.percent_change ?? row.change_percent);
  const volume24h = finiteProviderNumber(row.volume);
  return {
    price,
    timestamp,
    ...(!crossedSpread && bid !== undefined ? { bid } : {}),
    ...(!crossedSpread && ask !== undefined ? { ask } : {}),
    ...(change24h !== undefined ? { change24h } : {}),
    ...(volume24h !== undefined && volume24h >= 0 ? { volume24h } : {}),
  };
}

async function fetchLiveQuoteUncached(
  instrumentInput: string,
  fetchImpl: typeof fetch,
  twelveDataApiKey?: string,
): Promise<LiveMarketQuoteResult> {
  const instrument = instrumentInput.trim().toUpperCase();
  const instrumentType = inferInstrumentType(instrument);
  const assetClass = ["DXY", "VIX", "US10Y", "US2Y"].includes(instrument) ? "macro" : instrumentType;
  const now = Date.now();

  if (instrument === "US2Y") {
    return {
      instrument, assetClass, price: 0, timestamp: now, provider: "Yahoo Finance",
      primaryProvider: "Yahoo Finance", fallbackUsed: false, sourceMode: "UNAVAILABLE",
      success: false,
      error: "No verified exact US 2-year Treasury yield symbol is configured; the ^IRX 13-week T-bill series is not a valid substitute.",
    };
  }

  if (instrumentType === "crypto") {
    const instId = normalizeLiveOkxInstrument(instrument);
    if (!instId) {
      return {
        instrument, assetClass, price: 0, timestamp: now, provider: "OKX",
        primaryProvider: "OKX", fallbackUsed: false, sourceMode: "UNAVAILABLE",
        success: false, error: "No exact OKX instrument mapping exists; no spot or correlated substitute was used.",
      };
    }
    try {
      const quote = await fetchExactOkxLiveQuote(instId, fetchImpl);
      return {
        instrument, assetClass, ...quote, provider: "OKX", primaryProvider: "OKX",
        fallbackUsed: false, sourceMode: liveQuoteFresh(quote.timestamp, now) ? "LIVE" : "STALE",
        success: true,
      };
    } catch (primaryError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : "OKX quote unavailable";
      // Binance fallback is allowed only for the exact USDT spot pair. Never
      // route a perpetual or dated futures contract through a spot ticker.
      if (!instrument.endsWith("-SWAP") && !/-[0-9]{6}$/.test(instrument) &&
          /(?:\/|-)USDT$/.test(instrument)) {
        try {
          const quote = await fetchExactBinanceSpotFallback(instrument, fetchImpl);
          return {
            instrument, assetClass, ...quote, provider: "Binance Spot", primaryProvider: "OKX",
            fallbackUsed: true, fallbackReason: primaryMessage,
            sourceMode: liveQuoteFresh(quote.timestamp, now) ? "LIVE" : "STALE",
            success: true,
          };
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Binance fallback unavailable";
          return {
            instrument, assetClass, price: 0, timestamp: now, provider: "OKX/Binance",
            primaryProvider: "OKX", fallbackUsed: true, fallbackReason: primaryMessage,
            sourceMode: "UNAVAILABLE", success: false,
            error: primaryMessage + "; exact Binance fallback: " + fallbackMessage,
          };
        }
      }
      return {
        instrument, assetClass, price: 0, timestamp: now, provider: "OKX",
        primaryProvider: "OKX", fallbackUsed: false, sourceMode: "UNAVAILABLE",
        success: false, error: primaryMessage,
      };
    }
  }

  let twelveDataObservation: Awaited<ReturnType<typeof fetchTwelveDataLiveQuote>> | undefined;
  let twelveDataFailure: string | undefined;
  const useTwelveData = (instrumentType === "forex" || instrumentType === "commodity") &&
    Boolean(twelveDataApiKey?.trim());
  if (useTwelveData) {
    if (reserveTwelveDataQuoteRequest()) {
      try {
        twelveDataObservation = await fetchTwelveDataLiveQuote(instrument, twelveDataApiKey!.trim(), fetchImpl);
        if (liveQuoteFresh(twelveDataObservation.timestamp, now)) {
          return {
            instrument, assetClass, ...twelveDataObservation, provider: "TwelveData",
            primaryProvider: "TwelveData", fallbackUsed: false, sourceMode: "LIVE", success: true,
          };
        }
        twelveDataFailure = "TwelveData returned a stale provider timestamp";
      } catch (error) {
        twelveDataFailure = error instanceof Error ? error.message : "TwelveData quote unavailable";
      }
    } else {
      twelveDataFailure = "TwelveData per-minute quote budget exhausted";
    }
  }

  const yahooSymbol = resolveYahooSymbol(instrumentType, instrument);
  if (!yahooSymbol) {
    if (twelveDataObservation) {
      return {
        instrument, assetClass, ...twelveDataObservation, provider: "TwelveData",
        primaryProvider: "TwelveData", fallbackUsed: false, sourceMode: "STALE", success: true,
      };
    }
    return {
      instrument, assetClass, price: 0, timestamp: now, provider: useTwelveData ? "TwelveData" : "Yahoo Finance",
      primaryProvider: useTwelveData ? "TwelveData" : "Yahoo Finance", fallbackUsed: false, sourceMode: "UNAVAILABLE",
      success: false, error: "No exact provider quote mapping exists for this instrument.",
    };
  }
  try {
    const quote = await fetchYahooFinanceQuote(yahooSymbol, fetchImpl);
    if (twelveDataObservation && twelveDataObservation.timestamp > quote.timestamp) {
      return {
        instrument, assetClass, ...twelveDataObservation, provider: "TwelveData",
        primaryProvider: "TwelveData", fallbackUsed: false, sourceMode: "STALE", success: true,
      };
    }
    return {
      instrument, assetClass, ...quote, provider: "Yahoo Finance",
      primaryProvider: useTwelveData ? "TwelveData" : "Yahoo Finance",
      fallbackUsed: Boolean(useTwelveData),
      ...(twelveDataFailure ? { fallbackReason: twelveDataFailure } : {}),
      sourceMode: liveQuoteFresh(quote.timestamp, now) ? "LIVE" : "STALE",
      success: true,
    };
  } catch (error) {
    if (twelveDataObservation) {
      return {
        instrument, assetClass, ...twelveDataObservation, provider: "TwelveData",
        primaryProvider: "TwelveData", fallbackUsed: false, sourceMode: "STALE", success: true,
      };
    }
    const yahooFailure = error instanceof Error ? error.message : "Yahoo Finance quote unavailable";
    return {
      instrument, assetClass, price: 0, timestamp: now, provider: useTwelveData ? "TwelveData/Yahoo Finance" : "Yahoo Finance",
      primaryProvider: useTwelveData ? "TwelveData" : "Yahoo Finance",
      fallbackUsed: Boolean(useTwelveData),
      ...(twelveDataFailure ? { fallbackReason: twelveDataFailure } : {}),
      sourceMode: "UNAVAILABLE", success: false,
      error: twelveDataFailure ? twelveDataFailure + "; Yahoo Finance: " + yahooFailure : yahooFailure,
    };
  }
}

async function fetchLiveQuoteCached(
  instrument: string,
  fetchImpl: typeof fetch,
  twelveDataApiKey?: string,
): Promise<LiveMarketQuoteResult> {
  const key = instrument.trim().toUpperCase();
  // Cache entries must respect provider configuration. Otherwise a public
  // quote fetched before credentials are configured can mask the preferred
  // TwelveData source for the same instrument.
  const cacheKey = `${key}::${twelveDataApiKey?.trim() ? "twelvedata" : "public"}`;
  const now = Date.now();
  const cached = liveQuoteCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return { ...cached.value };
  const pending = liveQuoteInflight.get(cacheKey);
  if (pending) return { ...(await pending) };
  const request = fetchLiveQuoteUncached(key, fetchImpl, twelveDataApiKey);
  liveQuoteInflight.set(cacheKey, request);
  try {
    const value = await request;
    liveQuoteCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + (value.success ? LIVE_QUOTE_CACHE_TTL_MS : 5_000),
    });
    if (liveQuoteCache.size > 5000) {
      for (const [cacheKey, entry] of liveQuoteCache) {
        if (Date.now() >= entry.expiresAt) liveQuoteCache.delete(cacheKey);
      }
      while (liveQuoteCache.size > 5000) {
        const oldestKey = liveQuoteCache.keys().next().value;
        if (oldestKey === undefined) break;
        liveQuoteCache.delete(oldestKey);
      }
    }
    return { ...value };
  } finally {
    if (liveQuoteInflight.get(cacheKey) === request) liveQuoteInflight.delete(cacheKey);
  }
}

/** Fetches exact, provider-timestamped live quotes through the backend provider fabric. */
export async function fetchMarketQuotesBatch(
  instruments: string[],
  fetchImpl: typeof fetch = fetch,
  twelveDataApiKey?: string,
): Promise<LiveMarketQuoteResult[]> {
  const normalized = instruments.map((instrument) => instrument.trim().toUpperCase());
  if (normalized.some((instrument) => !instrument || instrument.length > 80)) {
    throw new Error("A live quote batch contains an invalid instrument");
  }
  const results: LiveMarketQuoteResult[] = [];
  for (let offset = 0; offset < normalized.length; offset += 8) {
    const batch = normalized.slice(offset, offset + 8);
    results.push(...await Promise.all(batch.map((instrument) =>
      fetchLiveQuoteCached(instrument, fetchImpl, twelveDataApiKey)
    )));
  }
  return results;
}
