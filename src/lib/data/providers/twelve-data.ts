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
import { asFiniteNumber, asRecordArray, asString, field } from "../json/narrow";

/** Twelve Data error envelope: `{ code, message, status: "error" }`. */
function throwIfError(json: unknown): void {
  const code = field(json, "code");
  if (code !== undefined && code !== null && code !== 0 && code !== "") {
    throw new Error(`Twelve Data error ${String(code)}: ${asString(field(json, "message")) ?? "unknown"}`);
  }
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

    const json: unknown = await res.json();
    throwIfError(json);

    // Phase 227 — rows enter as unknown. A row with a missing/non-finite
    // price or an unparseable datetime is dropped rather than emitted as a
    // NaN candle; if nothing survives the fetch fails like an empty payload.
    const candles: OhlcvCandle[] = [];
    for (const c of asRecordArray(field(json, "values"))) {
      const open = asFiniteNumber(c.open);
      const high = asFiniteNumber(c.high);
      const low = asFiniteNumber(c.low);
      const close = asFiniteNumber(c.close);
      const dt = c.datetime;
      if (open === undefined || high === undefined || low === undefined || close === undefined) continue;
      if (typeof dt !== "string" && typeof dt !== "number") continue;
      const timestamp = new Date(dt).getTime();
      if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
      candles.push({ timestamp, open, high, low, close, volume: asFiniteNumber(c.volume) ?? 0 });
    }
    if (candles.length === 0) {
      throw new Error(`No candle data returned for ${symbol}`);
    }

    return candles.reverse();
  }

  async fetchPrice(symbol: string): Promise<PriceSnapshot> {
    const url = `${this.config.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${this.config.apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Twelve Data API error ${res.status}: ${body}`);
    }

    const json: unknown = await res.json();
    throwIfError(json);

    const price = asFiniteNumber(field(json, "close"));
    if (price === undefined) {
      throw new Error(`Twelve Data quote for ${symbol} has no numeric close`);
    }
    // Phase 227 — the quote's own `timestamp` (unix seconds) is the
    // observation time. The previous `Date.now()` stamped a delayed quote as
    // current (the Phase 220 E2 defect class); a quote without a provider
    // time is rejected rather than re-dated.
    const providerTs = asFiniteNumber(field(json, "timestamp"));
    // Same plausibility window as convex/marketData.resolveProviderPriceTimestamp.
    if (providerTs === undefined || providerTs < 1e9 || providerTs >= 1e11) {
      throw new Error(`Twelve Data quote for ${symbol} has no provider timestamp`);
    }

    return {
      price,
      timestamp: providerTs * 1000,
      source: this.name,
      bid: asFiniteNumber(field(json, "bid")),
      ask: asFiniteNumber(field(json, "ask")),
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
