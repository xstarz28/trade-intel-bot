import type { AssetClass, InstrumentSubType } from "./types";

export interface ProviderNativeInstrument {
  provider: string;
  providerInstrumentId: string;
  assetClass: AssetClass;
  subType: InstrumentSubType;
}

/**
 * Validated provider-native identity.
 *
 * This does NOT create a canonical registry entry and does NOT imply
 * market-data availability.
 */
export function createProviderNativeInstrument(
  input: ProviderNativeInstrument,
): ProviderNativeInstrument | null {
  if (!input.provider.trim()) return null;
  if (!input.providerInstrumentId.trim()) return null;
  if (!input.assetClass) return null;
  if (!input.subType) return null;

  return {
    provider: input.provider,
    providerInstrumentId: input.providerInstrumentId,
    assetClass: input.assetClass,
    subType: input.subType,
  };
}
