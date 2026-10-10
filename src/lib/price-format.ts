/**
 * Shared instrument-aware price precision for analysis output and trade plans.
 * Keep this in one place so Entry/SL/TP precision matches displayed market prices.
 */
export function getInstrumentPricePrecision(
  price: number,
  instrumentType: string,
  instrument: string,
): number {
  if (instrumentType === "forex") return /JPY/i.test(instrument) ? 3 : 5;

  const magnitude = Math.abs(price);
  if (instrumentType === "crypto") {
    if (magnitude >= 1000) return 2;
    if (magnitude >= 1) return 4;
    if (magnitude >= 0.01) return 6;
    if (magnitude >= 0.0001) return 8;
    return 10;
  }

  if (magnitude >= 1000) return 2;
  if (magnitude >= 1) return 2;
  if (magnitude >= 0.01) return 4;
  if (magnitude >= 0.0001) return 6;
  return 8;
}

/** Human-facing formatter; large prices use grouping without forced trailing zeros. */
export function formatInstrumentPrice(
  price: number,
  instrumentType: string,
  instrument: string,
): string {
  if (!Number.isFinite(price)) return "—";
  const precision = getInstrumentPricePrecision(price, instrumentType, instrument);
  if (Math.abs(price) >= 1000) {
    return price.toLocaleString("en-US", { maximumFractionDigits: precision });
  }
  return price.toFixed(precision);
}

/** Un-grouped, fixed-precision numeric string for trade-plan values and calculations. */
export function formatInstrumentPriceValue(
  price: number,
  instrumentType: string,
  instrument: string,
): string {
  if (!Number.isFinite(price)) return "—";
  return price.toFixed(getInstrumentPricePrecision(price, instrumentType, instrument));
}
