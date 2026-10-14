export interface CatalogInstrument {
  symbol: string;
  type: string;
  label: string;
  marketType?: string;
}

function marketTypeOf(item: CatalogInstrument): string {
  if (item.marketType) return item.marketType.toLowerCase();
  if (item.type !== "crypto") return "";
  const symbol = item.symbol.trim().toUpperCase();
  if (symbol.endsWith("-SWAP") || symbol.endsWith("-FUTURES")) return "perpetual";
  if (/-[0-9]{6}$/.test(symbol)) return "futures";
  return "spot";
}

/**
 * Removes repeated provider/catalog rows without collapsing distinct markets.
 * Identity deliberately includes asset class and crypto contract kind.
 */
export function dedupeInstrumentCatalog<T extends CatalogInstrument>(
  items: readonly T[],
): T[] {
  const unique = new Map<string, T>();

  for (const item of items) {
    const symbol = item.symbol.trim();
    if (!symbol) continue;
    const identity = [
      item.type.trim().toLowerCase(),
      symbol.toUpperCase(),
      marketTypeOf(item),
    ].join("\u0000");
    const previous = unique.get(identity);
    if (!previous || (!previous.label.trim() && item.label.trim())) {
      unique.set(identity, item);
    }
  }

  return [...unique.values()];
}
