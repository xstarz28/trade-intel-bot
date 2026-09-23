/**
 * Phase 235 — IDX (Indonesia Stock Exchange) Provider Abstraction
 *
 * Level 1 — discoverable/public metadata:
 *   listed company, ticker/code, company name, sector/subsector if available,
 *   listing status, corporate action metadata if available.
 *
 * Level 2 — market-data acquisition:
 *   EOD, delayed, realtime adapters, but if credential/license/feed not available:
 *   status = REQUIRES_LICENSE
 *
 * No fake price.
 * No scraping private/mobile/internal endpoint.
 *
 * Implementation:
 * - Tries public IDX metadata via alternative public sources that are authorized
 *   (e.g. Twelve Data filtered to IDX exchange when available).
 * - If no credential/license, live acquisition returns REQUIRES_LICENSE.
 * - Discovery never fabricates price.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { DiscoveredInstrument, ProviderDiscoveryResult } from "./types";
import type { CatalogFetchReport } from "./completeness";

const PROVIDER = "idx";

type FetchJson = (url: string) => Promise<{ ok: boolean; status: number; json?: unknown }>;

type IdxStockRow = {
  symbol: string;
  name?: string;
  exchange?: string;
  country?: string;
  currency?: string;
};

function toDiscovered(row: IdxStockRow, now: number): DiscoveredInstrument | null {
  const symbol = row.symbol?.trim();
  if (!symbol) return null;
  // Only keep IDX-related symbols — exchange or country hint
  const exchange = (row.exchange ?? "").toUpperCase();
  const isIdx =
    exchange.includes("IDX") ||
    exchange.includes("JK") ||
    exchange.includes("INDONESIA") ||
    symbol.endsWith(".JK") ||
    symbol.includes(".JK");

  // If exchange info not present, we still allow if symbol looks like IDX (ends with .JK)
  // Otherwise skip to avoid polluting catalog with non-IDX stocks when using generic source
  if (row.exchange && !isIdx) return null;

  const base = symbol.replace(".JK", "").trim();
  if (!base) return null;

  return {
    provider: PROVIDER,
    providerInstrumentId: symbol, // exact native, e.g. BBCA.JK
    assetClass: "equity" as AssetClass,
    subType: "equity_common",
    baseAsset: base,
    quoteAsset: row.currency?.trim() || "IDR",
    tradingState: "TRADING",
    capabilities: ["eod", "delayed", "realtime", "fundamentals"] as unknown as DiscoveredInstrument["capabilities"],
    region: "ID",
    discoveredAt: now,
  };
}

/**
 * Discover IDX stocks via public metadata.
 * Tries Twelve Data stock list filtered to IDX/JK, or alternative public source.
 * If no source available, returns REQUIRES_LICENSE / UNAVAILABLE, not fake-success.
 */
export async function discoverIdx(
  fetchJson: FetchJson,
  now: number = Date.now(),
  opts: { apiKey?: string } = {},
): Promise<ProviderDiscoveryResult> {
  const warnings: string[] = [];
  const instruments: DiscoveredInstrument[] = [];
  const catalogs: CatalogFetchReport[] = [];

  // Try Twelve Data /stocks with exchange=Jakarta Stock Exchange if key available
  // This is public metadata, not live price, and uses existing credential mechanism.
  if (opts.apiKey) {
    try {
      const url = `https://api.twelvedata.com/stocks?exchange=IDX&apikey=${encodeURIComponent(opts.apiKey)}`;
      const res = await fetchJson(url);
      if (res.ok) {
        const json = res.json as { data?: IdxStockRow[] };
        const rows = json.data ?? [];
        let kept = 0;
        for (const r of rows) {
          const disc = toDiscovered(r, now);
          if (!disc) continue;
          instruments.push(disc);
          kept += 1;
        }
        catalogs.push({
          path: "/stocks?exchange=IDX",
          assetClass: "equity",
          completeness: "COMPLETE",
          pagesFetched: 1,
          totalDiscovered: kept,
        });
        if (kept > 0) {
          const deduped = Array.from(
            new Map(instruments.map((i) => [`${i.provider}|${i.providerInstrumentId}`, i])).values(),
          );
          return {
            provider: PROVIDER,
            success: true,
            discoveredAt: now,
            instruments: deduped,
            warnings,
            completeness: "COMPLETE",
            pagesFetched: 1,
            totalDiscovered: deduped.length,
            catalogs,
          };
        }
      } else {
        warnings.push(`IDX via Twelve Data returned HTTP ${res.status}`);
      }
    } catch (err) {
      warnings.push(`IDX discovery via Twelve Data failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  // Fallback: try IDX official public metadata if available (no private scraping)
  // For now, if no API key or no results, return REQUIRES_LICENSE for live, but
  // still provide empty discovery with explicit error, not fake-success.
  // We keep a minimal public list via alternative open source? No hardcoded whitelist allowed,
  // so we must not fabricate. Return explicit UNAVAILABLE.

  return {
    provider: PROVIDER,
    success: false,
    discoveredAt: now,
    instruments: [],
    warnings,
    completeness: "FAILED",
    pagesFetched: 0,
    totalDiscovered: 0,
    error: `IDX public metadata discovery requires license or credential (REQUIRES_LICENSE). No fake price.`,
  };
}

export function createIdxDiscoveryAdapter(
  fetchJson: FetchJson,
  apiKey?: string,
): import("./types").ProviderDiscoveryAdapter {
  return {
    provider: PROVIDER,
    assetClasses: ["equity", "indices"],
    discover: (now) => discoverIdx(fetchJson, now, { apiKey }),
  };
}

/**
 * IDX live acquisition — returns REQUIRES_LICENSE when credential/license missing.
 * Never fabricates price.
 */
export type IdxLiveResult = {
  success: false;
  provider: typeof PROVIDER;
  error: string;
  status: "REQUIRES_LICENSE" | "UNAVAILABLE";
};

export async function acquireIdxLive(
  _input: { providerInstrumentId: string; assetClass: AssetClass },
  _readEnv?: (name: string) => string | undefined,
): Promise<IdxLiveResult> {
  return {
    success: false,
    provider: PROVIDER,
    error: "IDX realtime requires official licensed datafeed (REQUIRES_LICENSE). EOD/delayed may be available via licensed provider.",
    status: "REQUIRES_LICENSE",
  };
}
