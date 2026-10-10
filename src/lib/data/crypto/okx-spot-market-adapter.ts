import type { OhlcvCandle } from "../market-types";

export const OKX_SPOT_MARKET_PROVIDER = "okx-spot-public";
const BASE_URL = "https://www.okx.com";

export function toOkxSpotInstrument(symbol: string): string | null {
  const parts = symbol.trim().toUpperCase().replace(/\s/g, "").split(/[\/-]/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const base = parts[0];
  const quote = parts[1] === "USD" ? "USDT" : parts[1];
  if (base === quote || !/^[A-Z0-9]{2,20}$/.test(base) || !/^[A-Z0-9]{2,20}$/.test(quote)) return null;
  return base + "-" + quote;
}

export function toOkxSpotBar(timeframe: string): string {
  const bars: Record<string, string> = { M1: "1m", M5: "5m", M15: "15m", H1: "1H", H4: "4H", D1: "1D", W1: "1W" };
  return bars[timeframe.trim().toUpperCase()] ?? timeframe.trim();
}

export function normalizeOkxSpotCandles(payload: unknown, outputsize: number): OhlcvCandle[] {
  const rows = (payload as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const candles = rows.map((row): OhlcvCandle | null => {
    if (!Array.isArray(row) || row.length < 6) return null;
    const [rawTimestamp, rawOpen, rawHigh, rawLow, rawClose, rawVolume] = row;
    const timestamp = Number(rawTimestamp);
    const open = Number(rawOpen), high = Number(rawHigh), low = Number(rawLow), close = Number(rawClose);
    const volume = rawVolume == null || rawVolume === "" ? 0 : Number(rawVolume);
    if (![timestamp, open, high, low, close, volume].every(Number.isFinite)) return null;
    if (timestamp <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || high < low || volume < 0) return null;
    return { timestamp, open, high, low, close, volume };
  }).filter((candle): candle is OhlcvCandle => candle !== null);
  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles.slice(-Math.max(1, Math.floor(outputsize)));
}

export class OkxSpotMarketAdapter {
  private fetchFn: typeof fetch;
  constructor(fetchFn?: typeof fetch) { this.fetchFn = fetchFn ?? fetch; }

  private async getJson(path: string): Promise<any> {
    const response = await this.fetchFn(BASE_URL + path, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error("OKX Spot HTTP " + response.status + ": " + String(json?.msg ?? response.statusText));
    if (!json || (json.code !== undefined && String(json.code) !== "0")) {
      throw new Error("OKX Spot API " + String(json?.code ?? "NO_RESPONSE") + ": " + String(json?.msg ?? "invalid response"));
    }
    return json;
  }

  async fetchCandles(symbol: string, timeframe: string, outputsize: number): Promise<OhlcvCandle[]> {
    const instId = toOkxSpotInstrument(symbol);
    if (!instId) throw new Error("Unsupported OKX Spot symbol: " + symbol);
    const limit = Math.min(300, Math.max(1, Math.floor(outputsize)));
    const json = await this.getJson("/api/v5/market/candles?instId=" + encodeURIComponent(instId) +
      "&bar=" + encodeURIComponent(toOkxSpotBar(timeframe)) + "&limit=" + limit);
    const candles = normalizeOkxSpotCandles(json, outputsize);
    if (!candles.length) throw new Error("OKX Spot returned no valid candles for " + instId + " " + timeframe);
    return candles;
  }

  async fetchTicker(symbol: string): Promise<{ price: number; bid?: number; ask?: number }> {
    const instId = toOkxSpotInstrument(symbol);
    if (!instId) throw new Error("Unsupported OKX Spot symbol: " + symbol);
    const json = await this.getJson("/api/v5/market/ticker?instId=" + encodeURIComponent(instId));
    const row = Array.isArray(json?.data) ? json.data[0] : undefined;
    const price = Number(row?.last);
    const bid = Number(row?.bidPx), ask = Number(row?.askPx);
    if (!Number.isFinite(price) || price <= 0) throw new Error("OKX Spot ticker has no valid price for " + instId);
    return { price, ...(Number.isFinite(bid) && bid > 0 ? { bid } : {}), ...(Number.isFinite(ask) && ask > 0 ? { ask } : {}) };
  }
}
