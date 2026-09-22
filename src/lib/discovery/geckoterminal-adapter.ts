/**
 * Phase 235 — GeckoTerminal / CoinGecko On-Chain Adapter
 *
 * GeckoTerminal provides on-chain pool/token data on many networks.
 * Some large-scale discovery capabilities have plan limitations, so
 * capability/limit must be noted and not assumed complete automatically.
 *
 * Identity:
 *   chain/network
 *   dex
 *   poolAddress/pairAddress
 *   baseTokenAddress
 *   quoteTokenAddress
 *   providerNativeId
 *
 * Uses completeness semantics Phase 234.
 * Networks discovered dynamically via /api/v2/networks.
 * Pools paginated via page param.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { DiscoveredInstrument, ProviderDiscoveryResult } from "./types";
import type { CatalogFetchReport, DiscoveryCompleteness } from "./completeness";
import { rollupCompleteness } from "./completeness";

const PROVIDER = "geckoterminal";
const BASE = "https://api.geckoterminal.com/api/v2";

type FetchJson = (url: string) => Promise<{ ok: boolean; status: number; json?: unknown }>;

type Network = { id: string; type: string; attributes?: { name?: string } };
type Pool = {
  id: string;
  type: string;
  attributes: {
    address: string;
    name: string;
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
  };
  relationships?: {
    base_token?: { data: { id: string } };
    quote_token?: { data: { id: string } };
    dex?: { data: { id: string } };
  };
};

function parsePool(pool: Pool, networkId: string, now: number): DiscoveredInstrument | null {
  const poolAddr = pool.attributes?.address?.trim();
  const name = pool.attributes?.name?.trim() ?? "";
  if (!poolAddr) return null;

  // Try to extract base/quote from name like "ETH / USDC" or from relationships
  let baseSym = "UNKNOWN";
  let quoteSym = "UNKNOWN";
  if (name.includes("/")) {
    const parts = name.split("/").map((s) => s.trim());
    if (parts[0]) baseSym = parts[0];
    if (parts[1]) quoteSym = parts[1].split(" ")[0] ?? parts[1];
  }

  const baseTokenId = pool.relationships?.base_token?.data?.id ?? "";
  const quoteTokenId = pool.relationships?.quote_token?.data?.id ?? "";
  const dexId = pool.relationships?.dex?.data?.id ?? "unknown-dex";

  // Provider-native id is network:dex:poolAddress — unique per pool
  const providerNativeId = `${networkId}:${dexId}:${poolAddr}`;

  return {
    provider: PROVIDER,
    providerInstrumentId: providerNativeId,
    assetClass: "crypto" as AssetClass,
    subType: "crypto_spot",
    baseAsset: baseSym,
    quoteAsset: quoteSym,
    tradingState: "TRADING",
    capabilities: ["on_chain", "quote", "ohlcv"] as DiscoveredInstrument["capabilities"],
    region: networkId,
    discoveredAt: now,
  };
}

async function fetchNetworks(fetchJson: FetchJson): Promise<string[]> {
  const url = `${BASE}/networks`;
  const res = await fetchJson(url);
  if (!res.ok) throw new Error(`networks returned HTTP ${res.status}`);
  const json = res.json as { data?: Network[] };
  const networks = json.data ?? [];
  return networks.map((n) => n.id).filter(Boolean);
}

async function fetchPoolsPage(
  fetchJson: FetchJson,
  networkId: string,
  page: number,
): Promise<{ pools: Pool[]; hasMore: boolean }> {
  const url = `${BASE}/networks/${encodeURIComponent(networkId)}/pools?page=${page}`;
  const res = await fetchJson(url);
  if (!res.ok) {
    throw new Error(`pools ${networkId} page ${page} HTTP ${res.status}`);
  }
  const json = res.json as { data?: Pool[]; links?: { next?: string } };
  const pools = json.data ?? [];
  const hasMore = !!json.links?.next;
  return { pools, hasMore };
}

export async function discoverGeckoTerminal(
  fetchJson: FetchJson,
  now: number = Date.now(),
  opts: { maxNetworks?: number; maxPagesPerNetwork?: number } = {},
): Promise<ProviderDiscoveryResult> {
  const maxNetworks = opts.maxNetworks ?? 3;
  const maxPages = opts.maxPagesPerNetwork ?? 2;

  const warnings: string[] = [];
  const instruments: DiscoveredInstrument[] = [];
  const catalogs: CatalogFetchReport[] = [];
  let pagesFetched = 0;

  try {
    const networks = await fetchNetworks(fetchJson);
    const selected = networks.slice(0, maxNetworks);

    for (const netId of selected) {
      let page = 1;
      let netKept = 0;
      let netPages = 0;
      let netCompleteness: DiscoveryCompleteness = "COMPLETE";
      let failedPage: number | undefined;

      while (page <= maxPages) {
        try {
          const { pools, hasMore } = await fetchPoolsPage(fetchJson, netId, page);
          netPages += 1;
          pagesFetched += 1;
          for (const pool of pools) {
            const disc = parsePool(pool, netId, now);
            if (!disc) continue;
            instruments.push(disc);
            netKept += 1;
          }
          if (!hasMore) break;
          page += 1;
        } catch (err) {
          const reason = err instanceof Error ? err.message : "unknown";
          warnings.push(`${PROVIDER} ${netId} page ${page} failed: ${reason}`);
          netCompleteness = "PARTIAL";
          failedPage = page;
          break;
        }
      }

      catalogs.push({
        path: `/networks/${netId}/pools`,
        assetClass: "crypto",
        completeness: netCompleteness,
        pagesFetched: netPages,
        totalDiscovered: netKept,
        ...(failedPage !== undefined ? { failedPage } : {}),
      });
    }

    const deduped = Array.from(
      new Map(instruments.map((i) => [`${i.provider}|${i.providerInstrumentId}`, i])).values(),
    );

    const completeness = rollupCompleteness(catalogs.map((c) => c.completeness));

    return {
      provider: PROVIDER,
      success: deduped.length > 0,
      discoveredAt: now,
      instruments: deduped,
      warnings,
      completeness,
      pagesFetched,
      totalDiscovered: deduped.length,
      catalogs,
      ...(deduped.length === 0 ? { error: "GeckoTerminal discovery returned no pools" } : {}),
    };
  } catch (err) {
    return {
      provider: PROVIDER,
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings,
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: `GeckoTerminal failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

export function createGeckoTerminalDiscoveryAdapter(
  fetchJson: FetchJson,
): import("./types").ProviderDiscoveryAdapter {
  return {
    provider: PROVIDER,
    assetClasses: ["crypto"],
    discover: (now) => discoverGeckoTerminal(fetchJson, now),
  };
}
