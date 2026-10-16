import type { OhlcvCandle } from "../market-types";

export const BINANCE_SPOT_MARKET_PROVIDER = "binance-spot-public";
const BASE_URL = "https://api.binance.com";

const INTERVALS: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
  W1: "1w",
};

type BinanceTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Convert only a two-leg spot pair; USD is represented by the liquid USDT pair. */
export function toBinanceSpotSymbol(symbol: string): string | null {
  const parts = symbol.trim().toUpperCase().replace(/\s/g, "").split(/[\/-]/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const base = parts[0];
  const quote = parts[1] === "USD" ? "USDT" : parts[1];
  if (base === quote || !/^[A-Z0-9]{2,20}$/.test(base) || !/^[A-Z0-9]{2,20}$/.test(quote)) return null;
  return base + quote;
}

/** Parse Binance public spot klines into validated Unix-ms OHLCV candles. */
export function normalizeBinanceSpotCandles(payload: unknown, outputsize: number): OhlcvCandle[] {
  if (!Array.isArray(payload)) return [];
  const candles = payload.map((row): OhlcvCandle | null => {
    if (!Array.isArray(row) || row.length < 6) return null;
    const timestamp = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (![timestamp, open, high, low, close, volume].every(Number.isFinite)) return null;
    if (timestamp <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return null;
    if (high < Math.max(open, low, close) || low > Math.min(open, high, close)) return null;
    return { timestamp, open, high, low, close, volume };
  }).filter((candle): candle is OhlcvCandle => candle !== null);

  return [...new Map(candles.map((candle) => [candle.timestamp, candle])).values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-Math.min(1000, Math.max(1, Math.floor(outputsize))));
}

export class BinanceSpotMarketAdapter {
  private fetchFn: BinanceTransport;

  constructor(fetchFn?: BinanceTransport) {
    this.fetchFn = fetchFn ?? fetch;
  }

  async fetchCandles(symbol: string, timeframe: string, outputsize: number): Promise<OhlcvCandle[]> {
    const normalizedSymbol = toBinanceSpotSymbol(symbol);
    const interval = INTERVALS[timeframe.trim().toUpperCase()];
    if (!normalizedSymbol || !interval) {
      throw new Error("Binance Spot fallback does not support this symbol/timeframe");
    }
    const limit = Math.min(1000, Math.max(1, Math.floor(outputsize)));
    const url = BASE_URL + "/api/v3/klines?symbol=" + encodeURIComponent(normalizedSymbol) +
      "&interval=" + encodeURIComponent(interval) + "&limit=" + limit;
    const response = await this.fetchFn(url, {
      headers: { accept: "application/json", "user-agent": "XstarzGAnalysis/1.0" },
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "msg" in payload
        ? String((payload as { msg?: unknown }).msg ?? response.statusText)
        : response.statusText;
      throw new Error("Binance Spot HTTP " + response.status + ": " + message);
    }
    const candles = normalizeBinanceSpotCandles(payload, outputsize);
    if (candles.length === 0) throw new Error("Binance Spot returned no valid candles for " + normalizedSymbol);
    return candles;
  }
}
