/**
 * Phase 235 — CCXT Backbone for Crypto CEX/DEX Universe
 *
 * Uses CCXT's dynamic exchange registry (ccxt.exchanges) as source of truth,
 * never a hardcoded exchange whitelist. fetchMarkets() is the native market
 * discovery.
 *
 * Preserves:
 * - exchange/provider id (ccxt:<exchangeId>)
 * - native symbol (exact)
 * - base, quote
 * - market type (spot/swap/future/option)
 * - active/status
 * - precision/limits when available
 *
 * Maps to DiscoveredInstrument, provider-native identity preserved.
 *
 * Provenance: provider = ccxt:<exchangeId>, providerInstrumentId = exact native market symbol/id
 * No synthetic symbol.
 *
 * Live acquisition uses CCXT native via provider-registry.
 *
 * No private credentials for public market discovery/live public data.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { DiscoveredInstrument, ProviderDiscoveryResult } from "./types";
import type { CatalogFetchReport } from "./completeness";
import { rollupCompleteness } from "./completeness";
import { ccxtProviderId, getAvailableCcxtExchangesDynamic } from "./universal-provider-registry";

type CcxtMarket = {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  settle?: string;
  type?: string;
  spot?: boolean;
  swap?: boolean;
  future?: boolean;
  option?: boolean;
  active?: boolean;
  precision?: { amount?: number; price?: number };
  limits?: { amount?: { min?: number }; price?: { min?: number } };
};

type CcxtExchange = {
  id: string;
  has?: Record<string, boolean>;
  markets?: Record<string, CcxtMarket>;
  fetchMarkets: () => Promise<CcxtMarket[]>;
};

function mapMarketType(market: CcxtMarket): DiscoveredInstrument["subType"] {
  if (market.option) return "crypto_futures";
  if (market.future) return "crypto_futures";
  if (market.swap) return "crypto_perpetual";
  if (market.spot) return "crypto_spot";
  // fallback based on type string
  const t = (market.type ?? "").toLowerCase();
  if (t.includes("swap") || t.includes("perpetual")) return "crypto_perpetual";
  if (t.includes("future")) return "crypto_futures";
  if (t.includes("option")) return "crypto_futures";
  return "crypto_spot";
}

function toDiscovered(
  market: CcxtMarket,
  exchangeId: string,
  now: number,
): DiscoveredInstrument | null {
  // Exclude inactive markets — provider's positive assertion of active listing
  if ((market.active as unknown) === false) {
    return null;
  }
  const symbol = market.symbol?.trim();
  const id = market.id?.trim() ?? symbol;
  if (!symbol || !id) return null;
  const base = market.base?.trim();
  const quote = market.quote?.trim();
  if (!base || !quote) return null;

  const provider = ccxtProviderId(exchangeId);
  return {
    provider,
    providerInstrumentId: symbol, // exact native symbol, never rewritten
    assetClass: "crypto" as AssetClass,
    subType: mapMarketType(market),
    baseAsset: base,
    quoteAsset: quote,
    ...(market.settle ? { settleAsset: market.settle } : {}),
    tradingState: "TRADING",
    ...((market.active as boolean | undefined) === false ? { providerState: "inactive" } : {}),
    capabilities: ["ohlcv", "quote", "order_book"] as DiscoveredInstrument["capabilities"],
    precision: {
      ...(market.precision?.price !== undefined ? { tickSize: market.precision.price } : {}),
      ...(market.precision?.amount !== undefined ? { lotSize: market.precision.amount } : {}),
      ...(market.limits?.amount?.min !== undefined ? { minSize: market.limits.amount.min } : {}),
    },
    region: "global",
    discoveredAt: now,
  };
}

export type CcxtDiscoveryDeps = {
  /** For tests: inject exchange list and fetchMarkets */
  getExchanges?: () => string[];
  createExchange?: (id: string) => CcxtExchange;
  /** Bounded concurrency for exchange discovery */
  maxExchanges?: number;
  /** For tests: inject cursor */
  cursor?: number;
  /** For tests: disable global cursor advancement */
  disableCursorAdvance?: boolean;
};

// ── Rotation cursor: bounded per-cycle batch, eventual full coverage ──
// maxExchanges=5 is maximum exchanges per discovery cycle, NOT permanent ceiling.
// Over repeated cycles, cursor rotates through entire ccxt.exchanges universe.
// No exchange permanently starved. Failure does not stall rotation.
let globalCcxtCursor = 0;

export function getCcxtDiscoveryCursor(): number {
  return globalCcxtCursor;
}
export function setCcxtDiscoveryCursor(n: number): void {
  globalCcxtCursor = Math.max(0, Math.floor(n));
}
export function resetCcxtDiscoveryCursor(): void {
  globalCcxtCursor = 0;
}

function getCcxtModule(): { exchanges: string[]; [key: string]: unknown } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ccxt = require("ccxt") as { exchanges: string[] };
    return ccxt as unknown as { exchanges: string[]; [key: string]: unknown };
  } catch {
    return null;
  }
}

export async function discoverCcxtMarkets(
  now: number = Date.now(),
  deps: CcxtDiscoveryDeps = {},
): Promise<ProviderDiscoveryResult> {
  const maxExchanges = deps.maxExchanges ?? 5; // bounded per cycle for scalability, NOT permanent ceiling — cursor rotates to cover eventual 105
  const getExchanges = deps.getExchanges ?? getAvailableCcxtExchangesDynamic;

  const ccxtMod = getCcxtModule();
  if (!ccxtMod) {
    return {
      provider: "ccxt",
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: "CCXT not available in this runtime (UNAVAILABLE)",
    };
  }

  const allExchanges = getExchanges();
  if (allExchanges.length === 0) {
    return {
      provider: "ccxt",
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: "No CCXT exchanges available",
    };
  }

  // ── Rotation logic ──
  // Deterministic sorted universe already from getAvailableCcxtExchangesDynamic.
  // Cursor advances each cycle, wraps to 0 after full coverage, no duplicates before full coverage.
  const total = allExchanges.length;
  const start = deps.cursor !== undefined ? deps.cursor % total : globalCcxtCursor % total;
  let selected: string[];
  let nextCursor: number;
  if (maxExchanges >= total) {
    selected = [...allExchanges];
    nextCursor = 0;
  } else if (start + maxExchanges <= total) {
    selected = allExchanges.slice(start, start + maxExchanges);
    nextCursor = (start + maxExchanges) % total;
  } else {
    // Remaining less than batch — take remaining only, no wrap in same batch to avoid duplicate before full coverage.
    // Next cycle starts at 0, beginning new rotation.
    selected = allExchanges.slice(start);
    nextCursor = 0;
  }

  const warnings: string[] = [];
  const instruments: DiscoveredInstrument[] = [];
  const catalogs: CatalogFetchReport[] = [];
  let pagesFetched = 0;
  let successful = 0;
  let failed = 0;

  const createExchange =
    deps.createExchange ??
    ((id: string): CcxtExchange => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ccxt = require("ccxt") as Record<string, new () => CcxtExchange>;
      const Cls = ccxt[id] as unknown as new () => CcxtExchange;
      if (!Cls) throw new Error(`Exchange ${id} not found in CCXT`);
      const ex = new Cls();
      ex.id = id;
      return ex;
    });

  for (const exId of selected) {
    try {
      const ex = createExchange(exId);
      const markets = await ex.fetchMarkets();
      pagesFetched += 1;
      let kept = 0;
      for (const m of markets) {
        const disc = toDiscovered(m, exId, now);
        if (!disc) continue;
        instruments.push(disc);
        kept += 1;
      }
      catalogs.push({
        path: `ccxt:${exId}/fetchMarkets`,
        assetClass: "crypto",
        completeness: "COMPLETE",
        pagesFetched: 1,
        totalDiscovered: kept,
      });
      successful += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      warnings.push(`ccxt:${exId} fetchMarkets failed: ${reason}`);
      catalogs.push({
        path: `ccxt:${exId}/fetchMarkets`,
        assetClass: "crypto",
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
      });
      failed += 1;
    }
  }

  const deduped = Array.from(
    new Map(instruments.map((i) => [`${i.provider}|${i.providerInstrumentId}`, i])).values(),
  );

  const completeness = rollupCompleteness(catalogs.map((c) => c.completeness));

  // Advance cursor for next cycle — failure does not stall rotation
  if (!deps.disableCursorAdvance && deps.cursor === undefined) {
    globalCcxtCursor = nextCursor;
  }

  return {
    provider: "ccxt",
    success: successful > 0,
    discoveredAt: now,
    instruments: deduped,
    warnings,
    completeness,
    pagesFetched,
    totalDiscovered: deduped.length,
    catalogs,
    ...(successful === 0 ? { error: `CCXT discovery failed for all ${selected.length} exchanges` } : {}),
  };
}

/**
 * Single-exchange discovery — used when providerId is ccxt:<exchangeId>
 */
export async function discoverSingleCcxtExchange(
  exchangeId: string,
  now: number = Date.now(),
  deps: CcxtDiscoveryDeps = {},
): Promise<ProviderDiscoveryResult> {
  const createExchange =
    deps.createExchange ??
    ((id: string): CcxtExchange => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ccxt = require("ccxt") as Record<string, new () => CcxtExchange>;
      const Cls = ccxt[id] as unknown as new () => CcxtExchange;
      if (!Cls) throw new Error(`Exchange ${id} not found`);
      const ex = new Cls();
      ex.id = id;
      return ex;
    });

  try {
    const ex = createExchange(exchangeId);
    const markets = await ex.fetchMarkets();
    const instruments: DiscoveredInstrument[] = [];
    for (const m of markets) {
      const disc = toDiscovered(m, exchangeId, now);
      if (!disc) continue;
      instruments.push(disc);
    }
    const deduped = Array.from(
      new Map(instruments.map((i) => [`${i.provider}|${i.providerInstrumentId}`, i])).values(),
    );
    return {
      provider: ccxtProviderId(exchangeId),
      success: true,
      discoveredAt: now,
      instruments: deduped,
      warnings: [],
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: deduped.length,
      catalogs: [
        {
          path: `ccxt:${exchangeId}/fetchMarkets`,
          assetClass: "crypto",
          completeness: "COMPLETE",
          pagesFetched: 1,
          totalDiscovered: deduped.length,
        },
      ],
    };
  } catch (err) {
    return {
      provider: ccxtProviderId(exchangeId),
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: `ccxt:${exchangeId} failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

export function createCcxtDiscoveryAdapter(
  deps: CcxtDiscoveryDeps = {},
): import("./types").ProviderDiscoveryAdapter {
  return {
    provider: "ccxt",
    assetClasses: ["crypto"],
    discover: (now) => discoverCcxtMarkets(now, deps),
  };
}

export function createSingleCcxtDiscoveryAdapter(
  exchangeId: string,
  deps: CcxtDiscoveryDeps = {},
): import("./types").ProviderDiscoveryAdapter {
  return {
    provider: ccxtProviderId(exchangeId),
    assetClasses: ["crypto"],
    discover: (now) => discoverSingleCcxtExchange(exchangeId, now, deps),
  };
}
