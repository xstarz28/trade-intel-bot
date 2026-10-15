import type { OhlcvCandle } from "../market-types";
import { getProviderSymbol, resolveInstrument } from "../universal/instruments";

const INTERVALS: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  H1: "60m",
  H4: "60m",
  D1: "1d",
  W1: "1wk",
};

const RANGES: Record<string, string> = {
  M1: "7d",
  M5: "60d",
  M15: "60d",
  H1: "730d",
  H4: "730d",
  D1: "2y",
  W1: "10y",
};

type YahooChartTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Resolve an equivalent Yahoo Finance equity ticker, never an asset-class
 * proxy. Indonesian equities use their exact IDX-listed .JK ticker.
 */
export function resolveYahooFinanceStockSymbol(instrument: string): string | null {
  const normalized = instrument.trim().toUpperCase();
  if (!normalized) return null;

  const withoutIdxSuffix = normalized.endsWith(".JK") ? normalized.slice(0, -3) : normalized;
  const canonical = resolveInstrument(normalized) ?? resolveInstrument(withoutIdxSuffix);
  if (canonical?.assetClass === "equity" && canonical.primaryExchange === "IDX") {
    const mapped = getProviderSymbol(canonical.canonical, "twelve-data");
    if (mapped?.toUpperCase().endsWith(".JK")) return mapped;
    if (normalized.endsWith(".JK")) return normalized;
    return null;
  }

  if (normalized.endsWith(".JK")) return normalized;
  // Yahoo uses the exchange ticker directly for ordinary listed equities
  // (AAPL, MSFT, BBCA.JK etc.); do not pass currency pairs/derivatives here.
  if (/^[A-Z][A-Z0-9.]{0,14}$/.test(normalized)) return normalized;
  return null;
}

/** Parse only complete, finite OHLC candles from Yahoo's chart response. */
export function parseYahooFinanceCandles(payload: unknown, outputsize: number): OhlcvCandle[] {
  const root = payload as {
    chart?: {
      error?: { description?: string; code?: string } | null;
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }> };
      }> | null;
    };
  } | null;

  const chart = root?.chart;
  const result = chart?.result?.[0];
  if (!result) {
    throw new Error(chart?.error?.description || chart?.error?.code || "Yahoo Finance returned no chart data");
  }
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) throw new Error("Yahoo Finance chart response has no OHLC quote arrays");

  const candles: OhlcvCandle[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const time = timestamps[index];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (
      !Number.isFinite(time) || time <= 0 ||
      !Number.isFinite(open) || !Number.isFinite(high) ||
      !Number.isFinite(low) || !Number.isFinite(close) ||
      Number(open) <= 0 || Number(high) <= 0 ||
      Number(low) <= 0 || Number(close) <= 0 ||
      Number(high) < Math.max(Number(open), Number(close), Number(low)) ||
      Number(low) > Math.min(Number(open), Number(close), Number(high))
    ) continue;

    const volume = quote.volume?.[index];
    candles.push({
      timestamp: Number(time) * 1000,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number.isFinite(volume) && Number(volume) >= 0 ? Number(volume) : 0,
    });
  }

  const deduplicated = [...new Map(candles.map((candle) => [candle.timestamp, candle])).values()]
    .sort((a, b) => a.timestamp - b.timestamp);
  const resultCandles = deduplicated.slice(-Math.max(1, Math.floor(outputsize)));
  if (resultCandles.length === 0) throw new Error("Yahoo Finance returned no valid OHLCV candles");
  return resultCandles;
}

/**
 * Build true four-hour candles from four consecutive one-hour candles in the
 * same local exchange session. Incomplete session fragments are discarded
 * instead of being mislabeled as H4 bars.
 */
function aggregateFourHourCandles(
  hourly: OhlcvCandle[],
  outputsize: number,
  timeZone: string,
): OhlcvCandle[] {
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const output: OhlcvCandle[] = [];
  let group: OhlcvCandle[] = [];
  let previous: OhlcvCandle | undefined;

  const flushCompleteGroup = () => {
    if (group.length === 4) {
      output.push({
        timestamp: group[0].timestamp,
        open: group[0].open,
        high: Math.max(...group.map((bar) => bar.high)),
        low: Math.min(...group.map((bar) => bar.low)),
        close: group[3].close,
        volume: group.reduce((total, bar) => total + bar.volume, 0),
      });
    }
    group = [];
  };

  for (const candle of hourly) {
    const newSession = previous !== undefined && (
      dayFormatter.format(new Date(candle.timestamp)) !== dayFormatter.format(new Date(previous.timestamp)) ||
      candle.timestamp - previous.timestamp > 90 * 60 * 1000
    );
    if (newSession) flushCompleteGroup();

    group.push(candle);
    previous = candle;
    if (group.length === 4) {
      flushCompleteGroup();
      previous = undefined;
    }
  }

  // Deliberately discard an incomplete final group: it is not a four-hour bar.
  flushCompleteGroup();
  const result = output.slice(-Math.max(1, Math.floor(outputsize)));
  if (result.length === 0) {
    throw new Error("Yahoo Finance did not return four consecutive hourly candles for an H4 bar");
  }
  return result;
}


/**
 * Resolve Yahoo tickers only where the symbol represents the same market
 * instrument. Never use a related future/index as a substitute for spot.
 */
export function resolveYahooFinanceMarketSymbol(instrumentType: string, instrument: string): string | null {
  const normalized = instrument.trim().toUpperCase();
  if (!normalized) return null;
  if (instrumentType === "stock") return resolveYahooFinanceStockSymbol(normalized);

  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  if (instrumentType === "forex") {
    const exactPairs: Record<string, string> = {
      EURUSD: "EURUSD=X", GBPUSD: "GBPUSD=X", AUDUSD: "AUDUSD=X", NZDUSD: "NZDUSD=X",
      USDJPY: "JPY=X", USDCHF: "CHF=X", USDCAD: "CAD=X",
      EURJPY: "EURJPY=X", GBPJPY: "GBPJPY=X", AUDJPY: "AUDJPY=X", NZDJPY: "NZDJPY=X",
      EURGBP: "EURGBP=X", EURCHF: "EURCHF=X", EURAUD: "EURAUD=X", EURCAD: "EURCAD=X",
      EURNZD: "EURNZD=X", GBPAUD: "GBPAUD=X", GBPCAD: "GBPCAD=X", GBPNZD: "GBPNZD=X",
      AUDCAD: "AUDCAD=X", AUDNZD: "AUDNZD=X", CADJPY: "CADJPY=X", CHFJPY: "CHFJPY=X",
    };
    return exactPairs[compact] ?? null;
  }
  if (instrumentType === "commodity") {
    if (["XAUUSD", "GOLD", "XAU"].includes(compact)) return "XAUUSD=X";
    if (["XAGUSD", "SILVER", "XAG"].includes(compact)) return "XAGUSD=X";
  }
  return null;
}

/** Exact market-index tickers used for cross-asset evidence. */
export function resolveYahooFinanceComparatorSymbol(comparator: string): string | null {
  switch (comparator.trim().toUpperCase()) {
    case "DXY": return "DX-Y.NYB";
    case "NDX": return "^NDX";
    default: return null;
  }
}

export async function fetchYahooFinanceCandles(
  symbol: string,
  timeframe: string,
  outputsize: number,
  transport: YahooChartTransport = fetch,
): Promise<OhlcvCandle[]> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedTimeframe = timeframe.trim().toUpperCase();
  const interval = INTERVALS[normalizedTimeframe];
  const range = RANGES[normalizedTimeframe];
  if (!normalizedSymbol || !interval || !range) {
    throw new Error("Yahoo Finance fallback does not support this symbol/timeframe");
  }

  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(normalizedSymbol) +
    "?interval=" + encodeURIComponent(interval) +
    "&range=" + encodeURIComponent(range) +
    "&events=div%2Csplits";
  const response = await transport(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; XstarzGAnalysis/1.0)",
    },
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error("Yahoo Finance chart HTTP " + response.status);
  }
  const parseSize = normalizedTimeframe === "H4" ? outputsize * 5 : outputsize;
  const parsed = parseYahooFinanceCandles(payload, parseSize);
  if (normalizedTimeframe !== "H4") return parsed;
  const timezone = normalizedSymbol.endsWith(".JK") ? "Asia/Jakarta" : "America/New_York";
  return aggregateFourHourCandles(parsed, outputsize, timezone);
}
