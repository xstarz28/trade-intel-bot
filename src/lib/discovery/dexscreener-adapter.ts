/**
 * Phase 235 — DexScreener Public API Adapter
 *
 * Prioritas: DexScreener public capability for DEX/on-chain discovery.
 * Provides pair search and token-pairs with chain/pair/token-address identity.
 *
 * Identity model:
 *   chain/network
 *   dex
 *   poolAddress/pairAddress
 *   baseTokenAddress
 *   quoteTokenAddress
 *   providerNativeId
 *
 * Distinct:
 * - token identity
 * - pool identity
 * - CEX market identity
 * Pool A/B and Pool C/D are NOT one instrument even if token pair same.
 *
 * Uses completeness semantics Phase 234.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { DiscoveredInstrument, ProviderDiscoveryResult } from "./types";
import type { CatalogFetchReport } from "./completeness";
import { rollupCompleteness } from "./completeness";

const PROVIDER = "dexscreener";

type DexScreenerPair = {
  chainId: string;
  dexId: string;
  url?: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
};

type DexScreenerSearchResponse = {
  pairs?: DexScreenerPair[];
};

export type DexScreenerFetch = (url: string) => Promise<{ ok: boolean; status: number; json?: unknown }>;

function toDiscovered(pair: DexScreenerPair, now: number): DiscoveredInstrument | null {
  const chain = pair.chainId?.trim();
  const dex = pair.dexId?.trim();
  const poolAddr = pair.pairAddress?.trim();
  const baseAddr = pair.baseToken?.address?.trim();
  const quoteAddr = pair.quoteToken?.address?.trim();
  const baseSym = pair.baseToken?.symbol?.trim();
  const quoteSym = pair.quoteToken?.symbol?.trim();
  if (!chain || !dex || !poolAddr || !baseAddr || !quoteAddr || !baseSym || !quoteSym) return null;

  // Provider-native id is chain:dex:poolAddress — unique per pool, not per token pair
  const providerNativeId = `${chain}:${dex}:${poolAddr}`;

  return {
    provider: PROVIDER,
    providerInstrumentId: providerNativeId,
    assetClass: "crypto" as AssetClass,
    subType: "crypto_spot",
    baseAsset: baseSym,
    quoteAsset: quoteSym,
    tradingState: "TRADING",
    capabilities: ["on_chain", "quote"] as DiscoveredInstrument["capabilities"],
    region: chain,
    discoveredAt: now,
  };
}

export async function discoverDexScreener(
  fetchJson: DexScreenerFetch,
  now: number = Date.now(),
  opts: { queries?: string[] } = {},
): Promise<ProviderDiscoveryResult> {
  // For scalability, bounded queries. Not a hardcoded ticker whitelist as source of truth,
  // but seed queries to bootstrap discovery. Source of truth is DexScreener API response.
  const queries = opts.queries ?? ["ETH", "USDC", "WETH", "SOL"];
  const warnings: string[] = [];
  const instruments: DiscoveredInstrument[] = [];
  const catalogs: CatalogFetchReport[] = [];
  let pagesFetched = 0;
  let successful = 0;

  for (const q of queries) {
    const url = `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(q)}`;
    try {
      const res = await fetchJson(url);
      pagesFetched += 1;
      if (!res.ok) {
        warnings.push(`${PROVIDER} search q=${q} returned HTTP ${res.status}`);
        catalogs.push({
          path: `/latest/dex/search/?q=${q}`,
          assetClass: "crypto",
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
        });
        continue;
      }
      const json = res.json as DexScreenerSearchResponse;
      const pairs = json.pairs ?? [];
      let kept = 0;
      for (const p of pairs) {
        const disc = toDiscovered(p, now);
        if (!disc) continue;
        instruments.push(disc);
        kept += 1;
      }
      catalogs.push({
        path: `/latest/dex/search/?q=${q}`,
        assetClass: "crypto",
        completeness: "COMPLETE",
        pagesFetched: 1,
        totalDiscovered: kept,
      });
      successful += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      warnings.push(`${PROVIDER} q=${q} failed: ${reason}`);
      catalogs.push({
        path: `/latest/dex/search/?q=${q}`,
        assetClass: "crypto",
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
      });
    }
  }

  const deduped = Array.from(
    new Map(instruments.map((i) => [`${i.provider}|${i.providerInstrumentId}`, i])).values(),
  );

  const completeness = rollupCompleteness(catalogs.map((c) => c.completeness));

  return {
    provider: PROVIDER,
    success: successful > 0,
    discoveredAt: now,
    instruments: deduped,
    warnings,
    completeness,
    pagesFetched,
    totalDiscovered: deduped.length,
    catalogs,
    ...(successful === 0 ? { error: "DexScreener discovery failed for all queries" } : {}),
  };
}

export function createDexScreenerDiscoveryAdapter(
  fetchJson: DexScreenerFetch,
): import("./types").ProviderDiscoveryAdapter {
  return {
    provider: PROVIDER,
    assetClasses: ["crypto"],
    discover: (now) => discoverDexScreener(fetchJson, now),
  };
}
