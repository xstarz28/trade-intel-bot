import {
  discoverOkxInstruments,
  type OkxDiscoveryResult,
} from "./okx-discovery";
import {
  type ProviderDiscoveryAdapter,
  type ProviderDiscoveryResult,
} from "./provider-discovery";

export function adaptOkxDiscoveryResult(
  result: OkxDiscoveryResult,
): ProviderDiscoveryResult {
  return {
    success: result.success,
    provider: result.provider,
    discoveredAt: result.discoveredAt,
    instruments: result.instruments
      .filter((instrument) => instrument.instId.length > 0)
      .map((instrument) => ({
        provider: result.provider,
        providerInstrumentId: instrument.instId,
        assetClass: "crypto" as const,
        providerInstrumentType: instrument.instType,
        baseAsset: instrument.baseAsset,
        quoteAsset: instrument.quoteAsset,
        ...(instrument.settleAsset
          ? { settleAsset: instrument.settleAsset }
          : {}),
        metadata: {
          subType: instrument.subType,
          ...(instrument.state ? { state: instrument.state } : {}),
        },
      })),
    warnings: [...result.warnings],
    ...(result.error ? { error: result.error } : {}),
  };
}

export const okxProviderDiscoveryAdapter: ProviderDiscoveryAdapter = {
  provider: "okx",
  supportedAssetClasses: ["crypto"],

  async discover(transport, now) {
    return adaptOkxDiscoveryResult(
      await discoverOkxInstruments(transport, now),
    );
  },
};
