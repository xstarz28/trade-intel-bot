function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type TwelveDataQuoteNormalization =
  | { success: true; price: number; timestamp: number; bid?: number; ask?: number }
  | { success: false; error: string };

/**
 * Validate a Twelve Data quote payload without inventing missing quote fields.
 * The caller separately verifies HTTP status and applies the freshness window.
 */
export function normalizeTwelveDataQuotePayload(payload: unknown): TwelveDataQuoteNormalization {
  if (!isRecord(payload)) {
    return { success: false, error: "TwelveData returned an invalid quote payload" };
  }

  if (payload.code) {
    return {
      success: false,
      error: `TwelveData [${String(payload.code)}]: ${String(payload.message ?? "provider error")}`,
    };
  }

  const price = finiteNumber(payload.close);
  if (price === undefined || price <= 0) {
    return { success: false, error: "TwelveData returned an invalid closing price" };
  }

  const rawTimestamp = finiteNumber(payload.timestamp);
  if (rawTimestamp === undefined || rawTimestamp <= 0) {
    return { success: false, error: "TwelveData returned an invalid quote timestamp" };
  }
  const timestamp = rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { success: false, error: "TwelveData returned an invalid quote timestamp" };
  }

  const parsedBid = finiteNumber(payload.bid);
  const parsedAsk = finiteNumber(payload.ask);
  const bid = parsedBid !== undefined && parsedBid > 0 ? parsedBid : undefined;
  const ask = parsedAsk !== undefined && parsedAsk > 0 ? parsedAsk : undefined;
  const crossedSpread = bid !== undefined && ask !== undefined && bid > ask;

  return {
    success: true,
    price,
    timestamp,
    ...(!crossedSpread && bid !== undefined ? { bid } : {}),
    ...(!crossedSpread && ask !== undefined ? { ask } : {}),
  };
}

/** Normalize Yahoo Finance chart payloads without inventing a local quote time. */
export function normalizeYahooFinanceQuotePayload(payload: unknown):
  | { success: true; price: number; timestamp: number }
  | { success: false; error: string } {
  if (!isRecord(payload) || !isRecord(payload.chart)) {
    return { success: false, error: "Yahoo Finance returned an invalid chart payload" };
  }

  const results = payload.chart.result;
  const firstResult = Array.isArray(results) ? results[0] : undefined;
  if (!isRecord(firstResult) || !isRecord(firstResult.meta)) {
    return { success: false, error: "Yahoo Finance returned no quote metadata" };
  }

  const price = finiteNumber(firstResult.meta.regularMarketPrice);
  if (price === undefined || price <= 0) {
    return { success: false, error: "Yahoo Finance returned an invalid market price" };
  }

  const rawTimestamp = finiteNumber(firstResult.meta.regularMarketTime);
  if (rawTimestamp === undefined || rawTimestamp <= 0) {
    return { success: false, error: "Yahoo Finance returned an invalid market timestamp" };
  }
  const timestamp = rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { success: false, error: "Yahoo Finance returned an invalid market timestamp" };
  }

  return { success: true, price, timestamp };
}

