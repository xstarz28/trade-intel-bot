/**
 * Provider abstraction: a clean interface so the external data source
 * can be swapped without rewriting the analysis engine or frontend.
 */

import type { MarketData, OhlcvCandle, PriceSnapshot } from "../market-types";

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  maxCandles?: number;
}

export interface ProviderCapabilities {
  name: string;
  supportedTypes: string[];
  realtime: boolean;
  maxCandlesPerRequest: number;
  timeframes: string[];
}

export interface MarketDataProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  fetchCandles(symbol: string, timeframe: string, count: number): Promise<OhlcvCandle[]>;
  fetchPrice(symbol: string): Promise<PriceSnapshot>;
  fetchAll?(symbol: string, timeframe: string, count: number): Promise<MarketData | null>;
}

/** Common timeframe conversion map. */
export const TIMEFRAME_MAP: Record<string, string> = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  H1: "1h",
  H4: "4h",
  D1: "1day",
  W1: "1week",
};
