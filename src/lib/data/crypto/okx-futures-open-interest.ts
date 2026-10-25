import type { CryptoDerivativesData } from "../derivatives-types";

type OkxOpenInterestRow = {
  instId?: unknown;
  instType?: unknown;
  oiUsd?: unknown;
  ts?: unknown;
};

function positiveNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function observedAt(value: unknown, now: number): number | undefined {
  const timestamp = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) return undefined;
  return timestamp;
}

/**
 * Parse exact-contract OKX public open interest for dated futures/X-Perps.
 * Never substitute the base token's perpetual contract for a dated contract.
 * Only USD notional is accepted, so contract counts are never mislabeled as USD.
 */
export function parseOkxFuturesOpenInterest(
  payload: unknown,
  expectedInstrument: string,
  now = Date.now(),
): CryptoDerivativesData | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const body = payload as { code?: unknown; data?: unknown };
  if (String(body.code) !== "0" || !Array.isArray(body.data)) return undefined;

  const row = body.data.find((item): item is OkxOpenInterestRow => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as OkxOpenInterestRow;
    return typeof candidate.instId === "string" &&
      candidate.instId.toUpperCase() === expectedInstrument.trim().toUpperCase() &&
      String(candidate.instType).toUpperCase() === "FUTURES";
  });
  if (!row) return undefined;

  const current = positiveNumber(row.oiUsd);
  const timestamp = observedAt(row.ts, now);
  if (current === undefined || timestamp === undefined) return undefined;

  const ageMs = now - timestamp;
  if (ageMs >= 24 * 60 * 60 * 1000) return undefined;
  const freshness: CryptoDerivativesData["freshness"] =
    ageMs < 5 * 60 * 1000 ? "realtime" :
    ageMs < 60 * 60 * 1000 ? "delayed" : "stale";

  return {
    provider: "okx-public-futures-open-interest",
    symbol: expectedInstrument.trim().toUpperCase(),
    timestamp,
    freshness,
    openInterest: { current },
    availability: {
      openInterest: true,
      fundingRate: false,
      longShort: false,
      liquidations: false,
    },
    confidence: "low",
    interpretation: "Exact-contract open interest in USD from OKX public data. No funding rate or directional positioning is inferred.",
  };
}
