/**
 * Public Binance USDⓈ-M futures fallback for crypto derivatives context.
 *
 * This adapter intentionally reports Binance as its source. It is used only
 * when CoinGlass is not configured or returns no usable derivatives datasets.
 * It does not synthesize liquidation data, funding intervals, or OI changes.
 */
import type { CryptoDerivativesData } from "../derivatives-types";
import { toCoinGlassSymbol } from "./symbols";

const BASE_URL = "https://fapi.binance.com";
const REQUEST_TIMEOUT_MS = 4_000;

type FetchFn = typeof fetch;

function finitePositive(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export function toBinanceUsdtFuturesSymbol(instrument: string): string | null {
  const cleaned = instrument.trim().toUpperCase();
  const knownBase = toCoinGlassSymbol(cleaned);
  const base = knownBase ?? cleaned.split(/[\/-]/)[0];
  if (!base || !/^[A-Z0-9]{2,20}$/.test(base)) return null;
  return base + "USDT";
}

export class BinancePublicDerivativesAdapter {
  private fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? fetch;
  }

  private async getJson(path: string): Promise<any> {
    const response = await this.fetchFn(BASE_URL + path, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = String(json?.msg ?? response.statusText ?? "provider request failed");
      throw new Error("Binance Futures HTTP " + response.status + ": " + detail);
    }
    if (json && !Array.isArray(json) && json.code !== undefined && Number(json.code) < 0) {
      throw new Error("Binance Futures " + json.code + ": " + String(json.msg ?? "provider error"));
    }
    return json;
  }

  async fetch(instrument: string): Promise<CryptoDerivativesData | null> {
    const symbol = toBinanceUsdtFuturesSymbol(instrument);
    if (!symbol) return null;

    const [oiResult, premiumResult, ratioResult] = await Promise.allSettled([
      this.getJson("/futures/data/openInterestHist?symbol=" + encodeURIComponent(symbol) + "&period=5m&limit=1"),
      this.getJson("/fapi/v1/premiumIndex?symbol=" + encodeURIComponent(symbol)),
      this.getJson("/futures/data/globalLongShortAccountRatio?symbol=" + encodeURIComponent(symbol) + "&period=4h&limit=1"),
    ]);

    const oiRows = oiResult.status === "fulfilled" && Array.isArray(oiResult.value) ? oiResult.value : [];
    const latestOi = oiRows[oiRows.length - 1];
    const oiValue = finitePositive(latestOi?.sumOpenInterestValue);
    const openInterest = oiValue !== undefined
      ? { current: oiValue }
      : undefined;

    const premium = premiumResult.status === "fulfilled" ? premiumResult.value : undefined;
    const rawFunding = finite(premium?.lastFundingRate);
    const fundingRate = rawFunding !== undefined
      ? { currentRate: rawFunding }
      : undefined;

    const ratioRows = ratioResult.status === "fulfilled" && Array.isArray(ratioResult.value) ? ratioResult.value : [];
    const latestRatio = ratioRows[ratioRows.length - 1];
    const accountRatio = finitePositive(latestRatio?.longShortRatio);
    const longShort = accountRatio !== undefined ? { accountRatio } : undefined;

    const availability = {
      openInterest: !!openInterest,
      fundingRate: !!fundingRate,
      longShort: !!longShort,
      liquidations: false,
    };
    const availableCount = Object.values(availability).filter(Boolean).length;
    if (availableCount === 0) return null;

    let confidence: CryptoDerivativesData["confidence"] = "low";
    if (availableCount >= 3) confidence = "high";
    else if (availableCount >= 2) confidence = "medium";

    return {
      provider: "binance-public-futures",
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
        openInterest ? "Binance USD-M open interest snapshot available" : undefined,
        fundingRate ? "Binance perpetual funding rate available" : undefined,
        longShort ? "Binance global long/short account ratio available" : undefined,
        "Liquidation context unavailable from this public fallback",
      ].filter(Boolean).join("; "),
    };
  }
}
