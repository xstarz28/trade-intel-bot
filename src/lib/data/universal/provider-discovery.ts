import type { AssetClass } from "./types";

export interface ProviderDiscoveryInstrument {
  provider: string;
  providerInstrumentId: string;
  assetClass: AssetClass;
  providerInstrumentType?: string;
  baseAsset?: string;
  quoteAsset?: string;
  settleAsset?: string;
  region?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface ProviderDiscoveryResult {
  success: boolean;
  provider: string;
  discoveredAt: number;
  instruments: ProviderDiscoveryInstrument[];
  warnings: string[];
  error?: string;
}

export interface ProviderDiscoveryAdapter {
  provider: string;
  supportedAssetClasses: readonly AssetClass[];
  discover(
    transport: (url: string) => Promise<Response>,
    now?: number,
  ): Promise<ProviderDiscoveryResult>;
}

export interface ProviderDiscoveryRegistry {
  register(adapter: ProviderDiscoveryAdapter): void;
  list(): ProviderDiscoveryAdapter[];
  discoverAll(
    transport: (url: string) => Promise<Response>,
    now?: number,
  ): Promise<ProviderDiscoveryResult[]>;
}

export function createProviderDiscoveryRegistry(
  initialAdapters: readonly ProviderDiscoveryAdapter[] = [],
): ProviderDiscoveryRegistry {
  const adapters = new Map<string, ProviderDiscoveryAdapter>();

  for (const adapter of initialAdapters) {
    adapters.set(adapter.provider, adapter);
  }

  return {
    register(adapter) {
      adapters.set(adapter.provider, adapter);
    },

    list() {
      return Array.from(adapters.values());
    },

    async discoverAll(transport, now = Date.now()) {
      return Promise.all(
        Array.from(adapters.values()).map(async (adapter) => {
          try {
            return await adapter.discover(transport, now);
          } catch (error) {
            return {
              success: false,
              provider: adapter.provider,
              discoveredAt: now,
              instruments: [],
              warnings: [],
              error: error instanceof Error ? error.message : "unknown error",
            };
          }
        }),
      );
    },
  };
}

export function mergeProviderDiscoveryResults(
  results: readonly ProviderDiscoveryResult[],
): ProviderDiscoveryResult {
  const instruments = new Map<string, ProviderDiscoveryInstrument>();
  const warnings: string[] = [];

  let discoveredAt = 0;
  let success = false;

  for (const result of results) {
    discoveredAt = Math.max(discoveredAt, result.discoveredAt);
    success ||= result.success;
    warnings.push(...result.warnings);

    for (const instrument of result.instruments) {
      if (!instrument.provider || !instrument.providerInstrumentId) continue;

      const key = `${instrument.provider}\u0000${instrument.providerInstrumentId}`;
      if (!instruments.has(key)) {
        instruments.set(key, instrument);
      }
    }
  }

  return {
    success,
    provider: "multi",
    discoveredAt,
    instruments: Array.from(instruments.values()),
    warnings,
    ...(results.find((result) => result.error)?.error
      ? { error: results.find((result) => result.error)?.error }
      : {}),
  };
}
