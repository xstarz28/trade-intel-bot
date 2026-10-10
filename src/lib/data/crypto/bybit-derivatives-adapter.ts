/**
 * Public Bybit linear-perpetual derivatives fallback.
 * Uses only documented public market-data endpoints; no API key is required.
 * Does not synthesize liquidation figures, OI changes, or annualized funding.
 */
import type { CryptoDerivativesData } from "../derivatives-types";
import { isCryptoInstrument, toCoinGlassSymbol } from "./symbols";

const BASE_URL = "https://api.bybit.com";
const REQUEST_TIMEOUT_MS = 4_000;

function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function positive(value: unknown): number | undefined {
  const n = finite(value);
  return n !== undefined && n > 0 ? n : undefined;
}

export function toBybitLinearSymbol(instrument: string): string | null {
  const cleaned = instrument.trim().toUpperCase();
  if (!isCryptoInstrument(cleaned)) return null;
  const mapped = toCoinGlassSymbol(cleaned);
  const base = mapped ?? cleaned.split(/[\/-]/)[0];
  return base && /^[A-Z0-9]{2,20}$/.test(base) ? base + "USDT" : null;
}

export class BybitPublicDerivativesAdapter {
  private fetchFn: typeof fetch;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? fetch;
  }

  private async getJson(path: string): Promise<any> {
    const response = await this.fetchFn(BASE_URL + path, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error("Bybit HTTP " + response.status + ": " + String(json?.retMsg ?? response.statusText ?? "request failed"));
    }
    if (!json || (json.retCode !== undefined && Number(json.retCode) !== 0)) {
      throw new Error("Bybit API " + String(json?.retCode ?? "NO_RESPONSE") + ": " + String(json?.retMsg ?? "invalid response"));
    }
    return json;
  }

  async fetch(instrument: string): Promise<CryptoDerivativesData | null> {
    const symbol = toBybitLinearSymbol(instrument);
    if (!symbol) return null;

    const encoded = encodeURIComponent(symbol);
    const [oiResult, tickerResult, ratioResult] = await Promise.allSettled([
      this.getJson("/v5/market/open-interest?category=linear&symbol=" + encoded + "&intervalTime=5min&limit=1"),
      this.getJson("/v5/market/tickers?category=linear&symbol=" + encoded),
      this.getJson("/v5/market/account-ratio?category=linear&symbol=" + encoded + "&period=4h&limit=1"),
    ]);

    const tickerRows = tickerResult.status === "fulfilled" && Array.isArray(tickerResult.value?.result?.list)
      ? tickerResult.value.result.list
      : [];
    const ticker = tickerRows.find((row: any) => String(row.symbol || "").toUpperCase() === symbol) ?? tickerRows[0];
    const tickerOiUsd = positive(ticker?.openInterestValue);
    const lastPrice = positive(ticker?.lastPrice);

    const oiPayload = oiResult.status === "fulfilled" ? oiResult.value?.result?.list : undefined;
    const oiRows = Array.isArray(oiPayload) ? oiPayload : [];
    const oiRow = oiRows[0];
    const oiBase = positive(oiRow?.openInterest);
    const openInterestUsd = tickerOiUsd ?? (oiBase !== undefined && lastPrice !== undefined ? oiBase * lastPrice : undefined);
    const openInterest = openInterestUsd !== undefined ? { current: openInterestUsd } : undefined;

    const rawFunding = finite(ticker?.fundingRate);
    const fundingRate = rawFunding !== undefined ? { currentRate: rawFunding } : undefined;

    const ratioPayload = ratioResult.status === "fulfilled" ? ratioResult.value?.result?.list : undefined;
    const ratioRows = Array.isArray(ratioPayload) ? ratioPayload : [];
    const ratioRow = ratioRows[0];
    const buyRatio = positive(ratioRow?.buyRatio);
    const sellRatio = positive(ratioRow?.sellRatio);
    const accountRatio = buyRatio !== undefined && sellRatio !== undefined ? Number((buyRatio / sellRatio).toFixed(6)) : undefined;
    const longShort = accountRatio !== undefined && Number.isFinite(accountRatio) ? { accountRatio } : undefined;

    const availability = {
      openInterest: !!openInterest,
      fundingRate: !!fundingRate,
      longShort: !!longShort,
      liquidations: false,
    };
    const count = Object.values(availability).filter(Boolean).length;
    if (count === 0) {
      const reason = (label: string, result: PromiseSettledResult<any>) =>
        result.status === "rejected"
          ? label + ": " + (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : label + ": no usable fields";
      throw new Error([
        reason("open interest", oiResult),
        reason("ticker", tickerResult),
        reason("account ratio", ratioResult),
      ].join("; "));
    }

    const confidence: CryptoDerivativesData["confidence"] =
      count >= 3 ? "high" : count >= 2 ? "medium" : "low";
    return {
      provider: "bybit-public-derivatives",
      symbol,
      timestamp: Date.now(),
      freshness: "realtime",
      openInterest,
      fundingRate,
      longShort,
      liquidations: undefined,
      availability,
      confidence,
      interpretation: [
        openInterest ? "Bybit public open-interest value available" : undefined,
        fundingRate ? "Bybit perpetual funding rate available" : undefined,
        longShort ? "Bybit long/short account ratio available" : undefined,
        "Liquidation context unavailable from this public fallback",
      ].filter(Boolean).join("; "),
    };
  }
}