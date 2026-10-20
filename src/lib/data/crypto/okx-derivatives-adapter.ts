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
  const base = toCoinGlassSymbol(cleaned) ?? cleaned.split(/[/-]/)[0];
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
    const base = instId.split("-")[0];
    const family = encodeURIComponent(base + "-USDT");
    const [oiResult, fundingResult, ratioResult, liquidationResult, instrumentResult] = await Promise.allSettled([
      this.getJson("/api/v5/public/open-interest?instType=SWAP&instId=" + encoded),
      this.getJson("/api/v5/public/funding-rate?instId=" + encoded),
      this.getJson("/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=" + encodeURIComponent(base) + "&period=5m"),
      this.getJson("/api/v5/public/liquidation-orders?instType=SWAP&uly=" + family + "&state=filled&limit=100"),
      this.getJson("/api/v5/public/instruments?instType=SWAP&instId=" + encoded),
    ]);

    const firstRow = (result: PromiseSettledResult<any>) =>
      result.status === "fulfilled" && Array.isArray(result.value?.data)
        ? result.value.data[0]
        : undefined;
    const oiRow = firstRow(oiResult);
    const fundingRow = firstRow(fundingResult);
    const instrumentRow = firstRow(instrumentResult);

    const oiUsd = positive(oiRow?.oiUsd);
    const openInterest = oiUsd !== undefined ? { current: oiUsd } : undefined;
    const rawFunding = finite(fundingRow?.fundingRate);
    const fundingRate = rawFunding !== undefined ? { currentRate: rawFunding } : undefined;

    const ratioRows = ratioResult.status === "fulfilled" && Array.isArray(ratioResult.value?.data)
      ? ratioResult.value.data
      : [];
    const latestRatioRow = ratioRows
      .filter((row: unknown) => Array.isArray(row) && row.length >= 2)
      .sort((left: unknown[], right: unknown[]) => Number(right[0]) - Number(left[0]))[0];
    const accountRatio = positive(latestRatioRow?.[1]);
    const longShort = accountRatio !== undefined ? { accountRatio } : undefined;

    // OKX returns grouped liquidation orders. Aggregate only observations from
    // the last hour, and convert contract size using the exact public contract
    // metadata. If size/contract value cannot be verified, leave this dataset
    // unavailable instead of inventing a USD notional.
    const liquidationGroups = liquidationResult.status === "fulfilled" && Array.isArray(liquidationResult.value?.data)
      ? liquidationResult.value.data
      : [];
    const details = liquidationGroups.flatMap((group: any) =>
      Array.isArray(group?.details) ? group.details : []
    );
    const now = Date.now();
    const recent = details.filter((row: any) => {
      const timestamp = finite(row?.ts ?? row?.time);
      return timestamp !== undefined && timestamp <= now && now - timestamp <= 60 * 60 * 1000;
    });
    const contractValue = positive(instrumentRow?.ctVal);
    const contractValueCurrency = String(instrumentRow?.ctValCcy ?? "").toUpperCase();
    const contractType = String(instrumentRow?.ctType ?? "").toLowerCase();
    const quoteCurrency = instId.split("-")[1]?.toUpperCase();
    const liquidationUsd = (row: any): number | undefined => {
      const size = positive(row?.sz);
      const bankruptcyPrice = positive(row?.bkPx);
      if (size === undefined || contractValue === undefined) return undefined;
      if (contractType === "inverse") return size * contractValue;
      if (contractType === "linear" && contractValueCurrency === base && bankruptcyPrice !== undefined) {
        return size * contractValue * bankruptcyPrice;
      }
      if (contractType === "linear" && contractValueCurrency === quoteCurrency) {
        return size * contractValue;
      }
      return undefined;
    };
    let longVolume = 0;
    let shortVolume = 0;
    let totalVolume = 0;
    let pricedLiquidationCount = 0;
    for (const row of recent) {
      const notional = liquidationUsd(row);
      if (notional === undefined || !Number.isFinite(notional) || notional <= 0) continue;
      totalVolume += notional;
      pricedLiquidationCount += 1;
      if (String(row?.posSide ?? "").toLowerCase() === "long") longVolume += notional;
      if (String(row?.posSide ?? "").toLowerCase() === "short") shortVolume += notional;
    }
    const liquidations = pricedLiquidationCount > 0 && totalVolume > 0
      ? {
          totalVolume,
          longVolume,
          shortVolume,
          dominantSide: longVolume > shortVolume ? "longs" as const :
            shortVolume > longVolume ? "shorts" as const : "balanced" as const,
          window: "last 1h · latest OKX public liquidation orders",
        }
      : undefined;

    const availability = {
      openInterest: !!openInterest,
      fundingRate: !!fundingRate,
      longShort: !!longShort,
      liquidations: !!liquidations,
    };
    const count = Object.values(availability).filter(Boolean).length;
    if (count === 0) {
      const describe = (label: string, result: PromiseSettledResult<any>) =>
        result.status === "rejected"
          ? label + ": " + (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : label + ": response contained no usable fields";
      throw new Error([
        describe("open interest", oiResult),
        describe("funding rate", fundingResult),
        describe("long/short ratio", ratioResult),
        describe("liquidation orders", liquidationResult),
      ].join("; "));
    }

    const missing = [
      !openInterest ? "open interest" : undefined,
      !fundingRate ? "funding rate" : undefined,
      !longShort ? "long/short account ratio" : undefined,
      !liquidations ? "verified recent liquidation notional" : undefined,
    ].filter(Boolean);
    return {
      provider: "okx-public-derivatives",
      symbol: instId,
      timestamp: Date.now(),
      freshness: "realtime",
      openInterest,
      fundingRate,
      longShort,
      liquidations,
      availability,
      confidence: count >= 3 ? "high" : count === 2 ? "medium" : "low",
      interpretation: [
        openInterest ? "OKX public swap open interest in USD available" : undefined,
        fundingRate ? "OKX public perpetual funding rate available" : undefined,
        longShort ? "OKX public contract long/short account ratio: " + accountRatio : undefined,
        liquidations ? "OKX public liquidations: $" + Math.round(totalVolume).toLocaleString("en-US") + " notional in the last hour; dominant side " + liquidations.dominantSide : undefined,
        missing.length ? "Unavailable datasets: " + missing.join(", ") : "All four public derivatives datasets are available",
      ].filter(Boolean).join("; "),
    };
  }
}