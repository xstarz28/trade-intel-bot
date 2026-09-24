/**
 * Phase 235 — Stockbit / Ajaib / Broker-Local Adapters
 *
 * No unauthorized data retrieval.
 * No synthetic adapter.
 * Authentication bypass is prohibited.
 * Reverse engineering is prohibited.
 * Register provider capability as unavailable/unsupported-without-authorization.
 *
 * Stockbit currently has real-time Live Datafeed with paid access.
 * Ajaib also has access/use terms.
 * Architecture must allow future official/authorized adapter when user has official access.
 */

import type { ProviderDiscoveryResult } from "./types";

export const STOCKBIT_PROVIDER_ID = "stockbit";
export const AJAIB_PROVIDER_ID = "ajaib";

export function createStockbitDiscoveryAdapter(): import("./types").ProviderDiscoveryAdapter {
  return {
    provider: STOCKBIT_PROVIDER_ID,
    assetClasses: ["equity"],
    discover: async (now) => {
      return {
        provider: STOCKBIT_PROVIDER_ID,
        success: false,
        discoveredAt: now,
        instruments: [],
        warnings: [],
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
        error:
          "Stockbit real-time Live Datafeed requires paid access and authorized API. Requires authorized datafeed license. Status: REQUIRES_LICENSE.",
      } as ProviderDiscoveryResult;
    },
  };
}

export function createAjaibDiscoveryAdapter(): import("./types").ProviderDiscoveryAdapter {
  return {
    provider: AJAIB_PROVIDER_ID,
    assetClasses: ["equity"],
    discover: async (now) => {
      return {
        provider: AJAIB_PROVIDER_ID,
        success: false,
        discoveredAt: now,
        instruments: [],
        warnings: [],
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
        error:
          "Ajaib market data requires authorized access. Requires authorized datafeed license. Status: REQUIRES_LICENSE.",
      } as ProviderDiscoveryResult;
    },
  };
}

export type BrokerLiveResult = {
  success: false;
  provider: string;
  error: string;
  status: "REQUIRES_LICENSE" | "UNAVAILABLE";
};

export async function acquireStockbitLive(): Promise<BrokerLiveResult> {
  return {
    success: false,
    provider: STOCKBIT_PROVIDER_ID,
    error: "Stockbit requires authorized Live Datafeed license (REQUIRES_LICENSE). Requires authorized license.",
    status: "REQUIRES_LICENSE",
  };
}

export async function acquireAjaibLive(): Promise<BrokerLiveResult> {
  return {
    success: false,
    provider: AJAIB_PROVIDER_ID,
    error: "Ajaib requires authorized access (REQUIRES_LICENSE). Requires authorized license.",
    status: "REQUIRES_LICENSE",
  };
}
