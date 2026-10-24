/**
 * Safe identity matching for base-asset derivatives feeds.
 *
 * Derivatives providers often key aggregate metrics by base symbol (BTC),
 * while market sources use quote/contract-qualified IDs (BTC/USD,
 * BTC-USDT-SWAP, BTCUSDT). Match only normalized base symbols; never infer
 * equivalence across different base assets.
 */

export function normalizeDerivativeSymbol(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) return "";

  // Canonical pair IDs and exchange-native separated symbols.
  if (normalized.includes("/")) {
    return normalized.split("/")[0]?.replace(/[^A-Z0-9]/g, "") ?? "";
  }

  const withoutContractSuffix = normalized
    .replace(/-(?:SWAP|FUTURES|PERP)$/i, "")
    .replace(/-\d{6,8}$/i, "");
  if (/[-_:]/.test(withoutContractSuffix)) {
    return withoutContractSuffix.split(/[-_:]/)[0]?.replace(/[^A-Z0-9]/g, "") ?? "";
  }

  // Some exchanges return concatenated symbols such as BTCUSDT or ETHUSD.
  // Avoid stripping short standalone symbols such as BTC or BUSD.
  for (const quote of ["USDT", "USDC", "BUSD", "USD"]) {
    if (withoutContractSuffix.length > quote.length + 1 && withoutContractSuffix.endsWith(quote)) {
      return withoutContractSuffix.slice(0, -quote.length).replace(/[^A-Z0-9]/g, "");
    }
  }

  return withoutContractSuffix.replace(/[^A-Z0-9]/g, "");
}

export function matchesDerivativeSymbol(
  instrument: string,
  providerInstrumentId: string | undefined,
  dataSymbol: string | undefined,
): boolean {
  if (!dataSymbol?.trim()) return false;

  const exactDataSymbol = dataSymbol.trim().toUpperCase();
  const candidateIds = [instrument, providerInstrumentId].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  return candidateIds.some((candidate) =>
    candidate.trim().toUpperCase() === exactDataSymbol ||
    normalizeDerivativeSymbol(candidate) === normalizeDerivativeSymbol(exactDataSymbol),
  );
}
