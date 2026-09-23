/**
 * Phase 158 — OKX Discovery Adapter
 *
 * Normalizes OKX's provider-native discovery output into the universal
 * `DiscoveredInstrument` contract WITHOUT altering OKX's native identity.
 *
 * The OKX instId is carried through byte-for-byte as `providerInstrumentId`.
 */

import type { DataCapability } from "@/lib/data/universal/types";
import {
  discoverOkxInstruments,
  type OkxDiscoveredInstrument,
} from "@/lib/data/universal/okx-discovery";
import type {
  DiscoveredInstrument,
  ProviderDiscoveryAdapter,
  ProviderDiscoveryResult,
  TradingState,
} from "./types";

/**
 * Map OKX's `state` field to a normalized trading state.
 *
 * Unrecognized states become UNKNOWN (never TRADING) so an unfamiliar state
 * can never be mistaken for a tradable one.
 */
export function mapOkxTradingState(state: string | undefined): TradingState {
  switch (state?.toLowerCase()) {
    case "live":
      return "TRADING";
    case "suspend":
      return "SUSPENDED";
    case "preopen":
      return "PRE_LAUNCH";
    case "expired":
      return "EXPIRED";
    case undefined:
    case "":
      return "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}

/** Capabilities OKX genuinely serves for crypto instruments. */
const OKX_CAPABILITIES: DataCapability[] = ["ohlcv", "quote", "order_book"];

export function normalizeOkxInstrument(
  row: OkxDiscoveredInstrument,
  discoveredAt: number,
): DiscoveredInstrument {
  return {
    provider: "okx",
    // Exact native id — never rewritten.
    providerInstrumentId: row.instId,
    assetClass: "crypto",
    subType: row.subType,
    baseAsset: row.baseAsset,
    quoteAsset: row.quoteAsset,
    ...(row.settleAsset ? { settleAsset: row.settleAsset } : {}),
    tradingState: mapOkxTradingState(row.state),
    ...(row.state ? { providerState: row.state } : {}),
    capabilities: [...OKX_CAPABILITIES],
    precision: {
      ...(row.tickSize !== undefined ? { tickSize: row.tickSize } : {}),
      ...(row.lotSize !== undefined ? { lotSize: row.lotSize } : {}),
      ...(row.minSize !== undefined ? { minSize: row.minSize } : {}),
    },
    region: "global",
    discoveredAt,
  };
}

export function createOkxDiscoveryAdapter(
  transport: (url: string) => Promise<Response>,
): ProviderDiscoveryAdapter {
  return {
    provider: "okx",
    assetClasses: ["crypto"],
    async discover(now: number): Promise<ProviderDiscoveryResult> {
      const raw = await discoverOkxInstruments(transport, now);

      const completeness = raw.completeness ?? (raw.success ? "COMPLETE" : "FAILED");
      const pagesFetched = raw.pagesFetched ?? 0;
      const totalDiscovered = raw.totalDiscovered ?? raw.instruments.length;
      return {
        provider: "okx",
        success: raw.success,
        discoveredAt: raw.discoveredAt,
        instruments: raw.instruments.map((row) =>
          normalizeOkxInstrument(row, raw.discoveredAt),
        ),
        warnings: raw.warnings,
        completeness,
        pagesFetched,
        totalDiscovered,
        catalogs: [
          {
            path: "/api/v5/public/instruments",
            assetClass: "crypto",
            completeness,
            pagesFetched,
            totalDiscovered,
          },
        ],
        ...(raw.error ? { error: raw.error } : {}),
      };
    },
  };
}
