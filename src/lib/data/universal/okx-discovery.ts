/**
 * Phase 150 — OKX Universal Instrument Discovery
 *
 * Discovers currently listed OKX crypto instruments from the public
 * instruments endpoint. Discovery is metadata only; it does not produce
 * market direction, prices, or recommendations.
 *
 * CRITICAL:
 * - Never silently substitute one instrument for another.
 * - Only return instruments actually returned by OKX.
 * - Only ACTIVE/LIVE contracts are eligible.
 * - SPOT / SWAP / FUTURES retain their native instrument subtype.
 */

import type { InstrumentSubType } from "./types";
import {
  parseOkxResponse,
  type OkxInstrumentMetadata,
} from "../../risk/okx-spec";

const ENDPOINT = "https://www.okx.com/api/v5/public/instruments";

export interface OkxDiscoveredInstrument {
  instId: string;
  instType: string;
  baseAsset: string;
  quoteAsset: string;
  settleAsset?: string;
  subType: InstrumentSubType;
  state?: string;
  tickSize?: number;
  lotSize?: number;
  minSize?: number;
}

export interface OkxDiscoveryResult {
  success: boolean;
  provider: "okx";
  discoveredAt: number;
  instruments: OkxDiscoveredInstrument[];
  warnings: string[];
  error?: string;
  completeness?: "COMPLETE" | "PARTIAL" | "FAILED";
  pagesFetched?: number;
  totalDiscovered?: number;
}

function mapSubtype(instType: string): InstrumentSubType | undefined {
  switch (instType.toUpperCase()) {
    case "SPOT":
      return "crypto_spot";
    case "SWAP":
      return "crypto_perpetual";
    case "FUTURES":
      return "crypto_futures";
    default:
      return undefined;
  }
}

/**
 * Resolve base/quote for an OKX row.
 *
 * OKX only populates `baseCcy`/`quoteCcy` for SPOT. For SWAP and FUTURES those
 * fields are empty and the pair is expressed by `uly` (the underlying index,
 * e.g. "BTC-USDT" for "BTC-USDT-SWAP"). Requiring baseCcy/quoteCcy therefore
 * silently discarded every derivative OKX returned.
 *
 * Everything here comes from fields OKX itself reported — the underlying index
 * or the native instId — so the instrument's identity is never invented. If no
 * provider field yields a pair, the row is rejected rather than guessed.
 */
function resolvePair(
  row: OkxInstrumentMetadata,
): { baseAsset: string; quoteAsset: string } | undefined {
  // 1. Spot: the provider states the pair outright.
  if (row.baseCcy && row.quoteCcy) {
    return { baseAsset: row.baseCcy, quoteAsset: row.quoteCcy };
  }

  // 2. Derivatives: the underlying index carries the pair.
  if (row.uly) {
    const [base, quote] = row.uly.split("-");
    if (base && quote) return { baseAsset: base, quoteAsset: quote };
  }

  // 3. Fall back to the native instId, which OKX composes as
  //    BASE-QUOTE-SWAP or BASE-QUOTE-<expiry> for derivatives.
  const parts = row.instId.split("-");
  if (parts.length >= 3 && parts[0] && parts[1]) {
    return { baseAsset: parts[0], quoteAsset: parts[1] };
  }

  return undefined;
}

function toDiscoveredInstrument(
  row: OkxInstrumentMetadata,
): OkxDiscoveredInstrument | undefined {
  const subType = mapSubtype(row.instType);
  if (!subType) return undefined;

  const pair = resolvePair(row);
  if (!pair) return undefined;

  return {
    instId: row.instId,
    instType: row.instType,
    baseAsset: pair.baseAsset,
    quoteAsset: pair.quoteAsset,
    ...(row.settleCcy ? { settleAsset: row.settleCcy } : {}),
    subType,
    ...(row.state ? { state: row.state } : {}),
    ...(row.tickSz !== undefined ? { tickSize: row.tickSz } : {}),
    ...(row.lotSz !== undefined ? { lotSize: row.lotSz } : {}),
    ...(row.minSz !== undefined ? { minSize: row.minSz } : {}),
  };
}

export async function discoverOkxInstruments(
  transport: (url: string) => Promise<Response>,
  now = Date.now(),
): Promise<OkxDiscoveryResult> {
  try {
    const instTypes = ["SPOT", "SWAP", "FUTURES"] as const;
    const responses = await Promise.all(
      instTypes.map(async (instType) => {
        const res = await transport(
          `${ENDPOINT}?instType=${instType}`,
        );

        if (!res.ok) {
          return {
            instType,
            json: undefined,
            error: `OKX ${instType} discovery returned HTTP ${res.status}.`,
          };
        }

        return {
          instType,
          json: await res.json().catch(() => undefined),
          error: undefined,
        };
      }),
    );

    const warnings: string[] = [];
    const instruments: OkxDiscoveredInstrument[] = [];
    let successfulTypes = 0;
    let failedTypes = 0;

    for (const response of responses) {
      if (response.error) {
        warnings.push(response.error);
        failedTypes += 1;
        continue;
      }

      if (response.json === undefined) {
        warnings.push(`OKX ${response.instType} discovery returned malformed JSON.`);
        failedTypes += 1;
        continue;
      }

      const parsed = parseOkxResponse(response.json);
      warnings.push(...parsed.parseWarnings.map(
        (warning) => `${response.instType}: ${warning}`,
      ));

      const discovered = parsed.instruments
        .filter((row) => row.state === undefined || row.state === "live")
        .map(toDiscoveredInstrument)
        .filter((row): row is OkxDiscoveredInstrument => row !== undefined);

      instruments.push(...discovered);
      successfulTypes += 1;
    }

    const deduplicated = Array.from(
      new Map(instruments.map((instrument) => [instrument.instId, instrument])).values(),
    );

    const completeness =
      successfulTypes === 0
        ? "FAILED"
        : failedTypes > 0
          ? "PARTIAL"
          : "COMPLETE";

    return {
      success: successfulTypes > 0,
      provider: "okx",
      discoveredAt: now,
      instruments: deduplicated,
      warnings,
      completeness,
      pagesFetched: instTypes.length,
      totalDiscovered: deduplicated.length,
      ...(successfulTypes === 0
        ? { error: "OKX discovery failed for all instrument types." }
        : {}),
    };
  } catch (err) {
    return {
      success: false,
      provider: "okx",
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: `OKX discovery failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
