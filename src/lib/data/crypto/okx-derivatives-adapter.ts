/**
 * OKX public perpetual-swap derivatives fallback.
 * Uses public V5 endpoints only; no API key is required.
 * Unavailable liquidation/positioning metrics remain unavailable, never fabricated.
 */
import type { CryptoDerivativesData } from "../derivatives-types";
import { isCryptoInstrument, toCoinGlassSymbol } from "./symbols";

const BASE_URL = "https://www.okx.com";
const REQUEST_TIMEOUT_MS = 4_000;

function positive(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function toOkxSwapInstrument(instrument: string): string | null {
  const cleaned = instrument.trim().toUpperCase();
  if (!isCryptoInstrument(cleaned)) return null;
  const base = toCoinGlassSymbol(cleaned) ?? cleaned.split(/[\/-]/)[0];
  return base && /^[A-Z0-9]{2,20}$/.test(base) ? base + "-USDT-SWAP" : null;
}

export class OkxPublicDerivativesAdapter {
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
      throw new Error("OKX HTTP " + response.status + ": " + String(json?.msg ?? response.statusText ?? "request failed"));
    }
    if (!json || (json.code !== undefined && String(json.code) !== "0")) {
      throw new Error("OKX API " + String(json?.code ?? "NO_RESPONSE") + ": " + String(json?.msg ?? "invalid response"));
    }
    return json;
  }

  async fetch(instrument: string): Promise<CryptoDerivativesData | null> {
    const instId = toOkxSwapInstrument(instrument);
    if (!instId) return null;
    const encoded = encodeURIComponent(instId);
    const [oiResult, fundingResult] = await Promise.allSettled([
      this.getJson("/api/v5/public/open-interest?instType=SWAP&instId=" + encoded),
      this.getJson("/api/v5/public/funding-rate?instId=" + encoded),
    ]);

    const oiRow = oiResult.status === "fulfilled" && Array.isArray(oiResult.value?.data)
      ? oiResult.value.data[0]
      : undefined;
    const fundingRow = fundingResult.status === "fulfilled" && Array.isArray(fundingResult.value?.data)
      ? fundingResult.value.data[0]
      : undefined;
    const oiUsd = positive(oiRow?.oiUsd);
    const openInterest = oiUsd !== undefined ? { current: oiUsd } : undefined;
    const rawFunding = finite(fundingRow?.fundingRate);
    const fundingRate = rawFunding !== undefined ? { currentRate: rawFunding } : undefined;
    const availability = {
      openInterest: !!openInterest,
      fundingRate: !!fundingRate,
      longShort: false,
      liquidations: false,
    };
    const count = Object.values(availability).filter(Boolean).length;
    if (count === 0) {
      const describe = (label: string, result: PromiseSettledResult<any>) =>
        result.status === "rejected"
          ? label + ": " + (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : label + ": response contained no usable fields";
      throw new Error([describe("open interest", oiResult), describe("funding rate", fundingResult)].join("; "));
    }

    return {
      provider: "okx-public-derivatives",
      symbol: instId,
      timestamp: Date.now(),
      freshness: "realtime",
      openInterest,
      fundingRate,
      longShort: undefined,
      liquidations: undefined,
      availability,
      confidence: count === 2 ? "medium" : "low",
      interpretation: [
        openInterest ? "OKX public swap open interest in USD available" : undefined,
        fundingRate ? "OKX public perpetual funding rate available" : undefined,
        "Long/short positioning and liquidation data unavailable from this public fallback",
      ].filter(Boolean).join("; "),
    };
  }
}