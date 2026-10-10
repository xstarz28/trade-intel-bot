/**
 * Normalize provider candle timestamps without relying on the server's local
 * timezone. Twelve Data may return naive local-market datetimes by default;
 * the caller requests timezone=UTC and this parser treats any still-naive
 * timestamp as UTC rather than interpreting it in the worker's local zone.
 */
export function parseMarketDataTimestamp(value: string): number {
  const input = value.trim();
  if (!input) return Number.NaN;

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return Date.parse(input + "T00:00:00Z");
  }

  const iso = input.includes("T") ? input : input.replace(/\s+/, "T");
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  return Date.parse(hasExplicitTimezone ? iso : iso + "Z");
}
