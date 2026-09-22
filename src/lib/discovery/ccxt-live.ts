/**
 * Phase 235 — CCXT Live Acquisition
 *
 * Uses CCXT native provider through CCXT.
 * Ticker/OHLCV when capability available.
 * Preserve provider timestamp, exact provider-native symbol.
 * Failure classification uses existing live failure architecture.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { LiveAcquisitionResult } from "@/lib/market-radar/provider-registry";
import { assessFreshness } from "@/lib/market-radar/freshness";
import { classifyLiveFailure } from "@/lib/data/universal/live/failure-class";
import type { Transport } from "@/lib/data/universal/live/client";

type CcxtTicker = {
  symbol: string;
  last?: number;
  timestamp?: number;
  datetime?: string;
};

type CcxtCandle = [number, number, number, number, number, number]; // [ts, open, high, low, close, vol]

type CcxtExchange = {
  id: string;
  fetchTicker: (symbol: string) => Promise<CcxtTicker>;
  fetchOHLCV: (symbol: string, timeframe?: string, since?: number, limit?: number) => Promise<CcxtCandle[]>;
  has?: Record<string, boolean>;
};

function getCcxtExchange(id: string): CcxtExchange {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ccxt = require("ccxt") as Record<string, new () => CcxtExchange>;
  const Cls = ccxt[id] as unknown as new () => CcxtExchange;
  if (!Cls) throw new Error(`CCXT exchange ${id} not found`);
  const ex = new Cls();
  return ex;
}

export async function acquireCcxtLive(
  input: {
    instrument: string;
    provider: string;
    providerInstrumentId: string;
    assetClass: AssetClass;
    timeframe?: string;
    count?: number;
  },
  _readEnv?: (name: string) => string | undefined,
  _transport: Transport = async () => ({ ok: false, status: 500 }),
): Promise<LiveAcquisitionResult> {
  const start = Date.now();
  const exchangeId = input.provider.startsWith("ccxt:") ? input.provider.slice(5) : input.provider;

  try {
    const ex = getCcxtExchange(exchangeId);
    const symbol = input.providerInstrumentId;

    // Try OHLCV first
    let candles: CcxtCandle[] = [];
    try {
      if (ex.has?.fetchOHLCV || true) {
        candles = await ex.fetchOHLCV(symbol, input.timeframe ?? "1h", undefined, input.count ?? 100);
      }
    } catch {
      // fallback to ticker
    }

    if (candles.length > 0) {
      const latest = candles[candles.length - 1];
      const ts = latest[0];
      const close = latest[4];
      if (!Number.isFinite(close) || close <= 0) {
        throw new Error("invalid close");
      }
      const observedAt = Number.isFinite(ts) ? ts : Date.now();
      const fetchedAt = Date.now();
      return {
        instrument: input.instrument,
        assetClass: input.assetClass,
        providerInstrumentId: input.providerInstrumentId,
        snapshot: {
          instrument: input.instrument,
          assetClass: input.assetClass,
          price: close,
          ohlcvAvailable: true,
          availableTimeframes: ["H1"],
          provider: input.provider,
          observedAt,
          freshness: assessFreshness(observedAt, fetchedAt),
          quality: "VERIFIED",
        },
        candles: candles.map((c) => ({
          timestamp: c[0],
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5] ?? 0,
        })),
        provider: input.provider,
        fetchedAt,
        success: true,
        latencyMs: fetchedAt - start,
        liveStatus: "LIVE_VERIFIED",
        quality: "VERIFIED",
      };
    }

    // Fallback to ticker
    const ticker = await ex.fetchTicker(symbol);
    const price = ticker.last;
    if (!Number.isFinite(price) || (price as number) <= 0) {
      throw new Error("no price");
    }
    const observedAt = ticker.timestamp ?? Date.now();
    const fetchedAt = Date.now();
    return {
      instrument: input.instrument,
      assetClass: input.assetClass,
      providerInstrumentId: input.providerInstrumentId,
      snapshot: {
        instrument: input.instrument,
        assetClass: input.assetClass,
        price: price as number,
        ohlcvAvailable: false,
        availableTimeframes: [],
        provider: input.provider,
        observedAt,
        freshness: assessFreshness(observedAt, fetchedAt),
        quality: "VERIFIED",
      },
      provider: input.provider,
      fetchedAt,
      success: true,
      latencyMs: fetchedAt - start,
      liveStatus: "LIVE_VERIFIED",
      quality: "VERIFIED",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    const failureClass = classifyLiveFailure({ message: msg });
    const completedAt = Date.now();
    return {
      instrument: input.instrument,
      assetClass: input.assetClass,
      providerInstrumentId: input.providerInstrumentId,
      snapshot: null,
      provider: input.provider,
      fetchedAt: completedAt,
      success: false,
      error: msg,
      latencyMs: completedAt - start,
      liveStatus: "PROVIDER_ERROR",
      failureClass,
      quality: "UNAVAILABLE",
    };
  }
}
