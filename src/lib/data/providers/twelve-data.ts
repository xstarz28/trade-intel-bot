/**
 * Twelve Data provider implementation.
 *
 * Free tier: 800 requests/day, 8/min, up to 8000 candles/request.
 * Supports: forex, crypto, stocks, commodities, indices.
 * Docs: https://twelvedata.com/docs
 *
 * This file is intended to be run server-side (Convex action with "use node").
 * API keys are read from environment variables, never exposed to the client.
 */

import type { MarketData, OhlcvCandle, PriceSnapshot } from "../market-types";
import type { MarketDataProvider, ProviderCapabilities, ProviderConfig } from "./types";
import { TIMEFRAME_MAP } from "./types";

interface TwelveDataCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export class TwelveDataProvider implements MarketDataProvider {
  readonly name = "twelve-data";
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = {
      baseUrl: "https://api.twelvedata.com",
      maxCandles: 5000,
      ...config,
    };
  }

  capabilities(): ProviderCapabilities {
    return {
      name: this.name,
      supportedTypes: ["forex", "crypto", "stock", "commodity", "indices"],
      realtime: false,
      maxCandlesPerRequest: 8000,
      timeframes: Object.keys(TIMEFRAME_MAP),
    };
  }

  private timeToApi(timeframe: string): string {
    return TIMEFRAME_MAP[timeframe] ?? timeframe.toLowerCase();
  }

  async fetchCandles(symbol: string, timeframe: string, count: number): Promise<OhlcvCandle[]> {
    const tf = this.timeToApi(timeframe);
    const url = `${this.config.baseUrl}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${tf}&outputsize=${count}&apikey=${this.config.apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Twelve Data API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    if (json.code) {
      throw new Error(`Twelve Data error ${json.code}: ${json.message}`);
    }

    const values: TwelveDataCandle[] = json.values ?? [];
    if (values.length === 0) {
      throw new Error(`No candle data returned for ${symbol}`);
    }

    return values.reverse().map((c) => ({
      timestamp: new Date(c.datetime).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume) || 0,
    }));
  }

  async fetchPrice(symbol: string): Promise<PriceSnapshot> {
    const url = `${this.config.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${this.config.apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Twelve Data API error ${res.status}: ${body}`);
    }

    const json: any = await res.json();
    if (json.code) {
      throw new Error(`Twelve Data error ${json.code}: ${json.message}`);
    }

    return {
      price: parseFloat(json.close),
      timestamp: Date.now(),
      source: this.name,
      bid: json.bid ? parseFloat(json.bid) : undefined,
      ask: json.ask ? parseFloat(json.ask) : undefined,
    };
  }

  async fetchAll(symbol: string, timeframe: string, count: number): Promise<MarketData | null> {
    try {
      const [candles, price] = await Promise.all([
        this.fetchCandles(symbol, timeframe, count),
        this.fetchPrice(symbol),
      ]);

      return {
        instrument: symbol,
        instrumentType: "forex",
        provider: this.name,
        fetchTimestamp: Date.now(),
        price,
        candles,
        timeframe,
        dataFreshness: "delayed",
      };
    } catch {
      return null;
    }
  }
}

export function createTwelveDataProvider(apiKey: string): TwelveDataProvider {
  if (!apiKey) {
    throw new Error("TWELVE_DATA_API_KEY environment variable is required");
  }
  return new TwelveDataProvider({ apiKey });
}
