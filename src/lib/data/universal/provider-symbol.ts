import { getProviderSymbol } from "./instruments";

/**
 * Resolve the symbol sent to a specific data provider while keeping the
 * user's selected/canonical instrument identity separate.
 *
 * Provider-native identities (for example OKX contracts) must bypass the
 * canonical registry so they are never rewritten to a different market.
 */
export function resolveProviderRequestSymbol(
  instrument: string,
  provider: string,
  preserveNativeIdentity = false,
): string {
  const normalized = instrument.trim().toUpperCase();
  if (!normalized || preserveNativeIdentity) return normalized;
  return getProviderSymbol(normalized, provider) ?? normalized;
}
