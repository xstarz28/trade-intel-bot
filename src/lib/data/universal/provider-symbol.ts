import { getProviderSymbol, resolveInstrument } from "./instruments";

export interface ProviderRequestIdentity {
  /** Exact symbol field sent to the provider. */
  symbol: string;
  /** Exchange MIC is supplied separately when the provider requires it. */
  micCode?: string;
}

/**
 * Resolve provider parameters while keeping the user's canonical identity
 * separate from provider syntax. Provider-native contracts bypass mapping.
 */
export function resolveProviderRequest(
  instrument: string,
  provider: string,
  preserveNativeIdentity = false,
): ProviderRequestIdentity {
  const normalized = instrument.trim().toUpperCase();
  if (!normalized || preserveNativeIdentity) return { symbol: normalized };

  const mapping = getProviderSymbol(normalized, provider);
  const indexedTicker = normalized.endsWith(".JK")
    ? normalized.slice(0, -3)
    : normalized;
  const canonical = resolveInstrument(normalized) ?? resolveInstrument(indexedTicker);

  // Twelve Data identifies Indonesian listings by their bare exchange ticker
  // plus MIC XIDX, rather than the .JK suffix used by other catalog sources.
  // Cover both canonical registry symbols (BBCA -> BBCA.JK mapping) and
  // provider-discovered catalog symbols already suffixed with .JK.
  if (provider === "twelve-data") {
    if (canonical?.primaryExchange === "IDX" && mapping?.toUpperCase().endsWith(".JK")) {
      return { symbol: mapping.slice(0, -3), micCode: "XIDX" };
    }
    if (normalized.endsWith(".JK")) {
      return { symbol: indexedTicker, micCode: "XIDX" };
    }
  }

  return { symbol: mapping ?? normalized };
}

export function resolveProviderRequestSymbol(
  instrument: string,
  provider: string,
  preserveNativeIdentity = false,
): string {
  return resolveProviderRequest(instrument, provider, preserveNativeIdentity).symbol;
}
