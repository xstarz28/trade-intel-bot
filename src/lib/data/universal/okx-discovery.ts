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

function toDiscoveredInstrument(
  row: OkxInstrumentMetadata,
): OkxDiscoveredInstrument | undefined {
  const subType = mapSubtype(row.instType);

  if (!subType || !row.baseCcy || !row.quoteCcy) {
    return undefined;
  }

  return {
    instId: row.instId,
    instType: row.instType,
    baseAsset: row.baseCcy,
    quoteAsset: row.quoteCcy,
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

    for (const response of responses) {
      if (response.error) {
        warnings.push(response.error);
        continue;
      }

      if (response.json === undefined) {
        warnings.push(`OKX ${response.instType} discovery returned malformed JSON.`);
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

    return {
      success: successfulTypes > 0,
      provider: "okx",
      discoveredAt: now,
      instruments: deduplicated,
      warnings,
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
      error: `OKX discovery failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
