/**
 * Phase 158 — Twelve Data Provider-Native Instrument Discovery
 *
 * Reference discovery only. This module does not fetch prices, candles,
 * direction, recommendations, or other live market evidence.
 *
 * Invariants:
 * - Only instruments actually returned by Twelve Data are emitted.
 * - Provider-native symbols are preserved exactly.
 * - No canonical symbol substitution or whitelist is applied.
 * - Malformed rows are excluded and reported.
 * - Endpoint failures remain explicit and never become fake instruments.
 */

import type { AssetClass } from "./types";

const BASE_URL = "https://api.twelvedata.com";

export type TwelveDataDiscoveryKind =
  | "stocks"
  | "forex_pairs"
  | "cryptocurrencies"
  | "commodities";

export interface TwelveDataDiscoveredInstrument {
  provider: "twelve-data";
  providerInstrumentId: string;
  assetClass: AssetClass;
  displayName?: string;
  exchange?: string;
  region?: string;
  metadata: Record<string, string>;
}

export interface TwelveDataDiscoveryResult {
  provider: "twelve-data";
  discoveredAt: number;
  success: boolean;
  instruments: TwelveDataDiscoveredInstrument[];
  failedKinds: TwelveDataDiscoveryKind[];
  warnings: string[];
  error?: string;
}

interface DiscoveryOptions {
  apiKey: string;
  kinds?: TwelveDataDiscoveryKind[];
  now?: number;
  fetchImpl?: typeof fetch;
}

interface DiscoveryRow {
  symbol?: unknown;
  name?: unknown;
  exchange?: unknown;
  country?: unknown;
  currency?: unknown;
  type?: unknown;
  category?: unknown;
  description?: unknown;
  currency_group?: unknown;
  currency_base?: unknown;
  currency_quote?: unknown;
}

interface DiscoveryResponse {
  status?: unknown;
  data?: unknown;
  message?: unknown;
  code?: unknown;
}

const ENDPOINTS: Record<
  TwelveDataDiscoveryKind,
  { assetClass: AssetClass; path: string }
> = {
  stocks: { assetClass: "equity", path: "/stocks" },
  forex_pairs: { assetClass: "forex", path: "/forex_pairs" },
  cryptocurrencies: { assetClass: "crypto", path: "/cryptocurrencies" },
  commodities: { assetClass: "commodity", path: "/commodities" },
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function mapRow(
  kind: TwelveDataDiscoveryKind,
  row: DiscoveryRow,
): TwelveDataDiscoveredInstrument | undefined {
  const endpoint = ENDPOINTS[kind];
  const providerInstrumentId = asString(row.symbol);
  if (!providerInstrumentId) return undefined;

  const metadata = Object.entries(row).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      const text = asString(value);
      if (text) acc[key] = text;
      return acc;
    },
    {},
  );

  return {
    provider: "twelve-data",
    providerInstrumentId,
    assetClass: endpoint.assetClass,
    ...(asString(row.name) ? { displayName: asString(row.name) } : {}),
    ...(asString(row.exchange) ? { exchange: asString(row.exchange) } : {}),
    ...(asString(row.country) ? { region: asString(row.country) } : {}),
    metadata,
  };
}

async function discoverKind(
  kind: TwelveDataDiscoveryKind,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<
  | { ok: true; instruments: TwelveDataDiscoveredInstrument[] }
  | { ok: false; error: string }
> {
  const endpoint = ENDPOINTS[kind];
  const url = new URL(`${BASE_URL}${endpoint.path}`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("format", "JSON");

  try {
    const response = await fetchImpl(url.toString());

    if (!response.ok) {
      return {
        ok: false,
        error: `${kind} discovery returned HTTP ${response.status}.`,
      };
    }

    const body = (await response.json()) as DiscoveryResponse;

    if (body.status === "error") {
      return {
        ok: false,
        error:
          asString(body.message) ??
          `${kind} discovery returned a provider error.`,
      };
    }

    if (!Array.isArray(body.data)) {
      return {
        ok: false,
        error: `${kind} discovery returned no instrument array.`,
      };
    }

    const instruments = body.data
      .filter(
        (row): row is DiscoveryRow =>
          typeof row === "object" && row !== null,
      )
      .map((row) => mapRow(kind, row))
      .filter(
        (row): row is TwelveDataDiscoveredInstrument =>
          row !== undefined,
      );

    return { ok: true, instruments };
  } catch (error) {
    return {
      ok: false,
      error: `${kind} discovery failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

export async function discoverTwelveDataInstruments(
  options: DiscoveryOptions,
): Promise<TwelveDataDiscoveryResult> {
  const discoveredAt = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const kinds = options.kinds ?? (Object.keys(ENDPOINTS) as TwelveDataDiscoveryKind[]);

  const instruments: TwelveDataDiscoveredInstrument[] = [];
  const failedKinds: TwelveDataDiscoveryKind[] = [];
  const warnings: string[] = [];

  for (const kind of kinds) {
    const result = await discoverKind(kind, options.apiKey, fetchImpl);

    if (!result.ok) {
      failedKinds.push(kind);
      warnings.push(result.error);
      continue;
    }

    instruments.push(...result.instruments);
  }

  const deduplicated = Array.from(
    new Map(
      instruments.map((instrument) => [
        `${instrument.assetClass}|${instrument.providerInstrumentId}`,
        instrument,
      ]),
    ).values(),
  );

  return {
    provider: "twelve-data",
    discoveredAt,
    success: failedKinds.length < kinds.length,
    instruments: deduplicated,
    failedKinds,
    warnings,
    ...(failedKinds.length === kinds.length && kinds.length > 0
      ? { error: "Twelve Data discovery failed for all requested datasets." }
      : {}),
  };
}
