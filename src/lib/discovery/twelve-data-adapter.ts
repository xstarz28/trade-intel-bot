/**
 * Phase 160 — Twelve Data Discovery Adapter (multi-asset-class coverage)
 *
 * Twelve Data publishes reference catalogs per asset class:
 *   /forex_pairs      forex
 *   /stocks           equity
 *   /commodities      commodity
 *   /indices          indices
 *   /cryptocurrencies crypto
 *
 * This adapter turns those catalogs into the universal DiscoveredInstrument
 * contract. It exists so forex/equity/commodity/indices coverage comes from a
 * provider that genuinely lists those instruments — NOT from a hardcoded list.
 *
 * HONESTY RULES ENFORCED HERE:
 *   - Requires real credentials. Without them the result is an explicit
 *     failure, never an empty success and never placeholder instruments.
 *   - A row missing the identity fields we need is SKIPPED with a warning.
 *     We never invent a base/quote asset to make a row usable.
 *   - Provider symbols are preserved exactly as `providerInstrumentId`.
 *   - One asset-class endpoint failing never discards the others.
 *
 * TRADING STATE: Twelve Data's catalogs exclude delisted identifiers by
 * default (`include_delisted=false`), so presence in the default catalog is
 * the provider's positive assertion that the instrument is currently listed.
 * We do not request delisted rows, so we never have to guess.
 */

import type {
  AssetClass,
  DataCapability,
  InstrumentSubType,
} from "@/lib/data/universal/types";
import type { EnvReader } from "@/lib/data/universal/live/credentials";
import { checkCredentials } from "@/lib/data/universal/live/credentials";
import type {
  DiscoveredInstrument,
  ProviderDiscoveryAdapter,
  ProviderDiscoveryResult,
} from "./types";

const BASE_URL = "https://api.twelvedata.com";
const PROVIDER = "twelve-data";

/** Twelve Data serves OHLCV + quote for every catalog below. */
const CAPABILITIES: DataCapability[] = ["ohlcv", "quote"];

interface CatalogRow {
  symbol?: string;
  name?: string;
  currency?: string;
  currency_base?: string;
  currency_quote?: string;
  exchange?: string;
  country?: string;
  mic_code?: string;
  category?: string;
  type?: string;
}

interface CatalogSpec {
  path: string;
  assetClass: AssetClass;
  subType: InstrumentSubType;
  /** Extract (base, quote) or null when the row cannot be identified. */
  identity: (row: CatalogRow) => { base: string; quote: string } | null;
}

/**
 * Pair-style catalogs report base/quote explicitly.
 * If either leg is missing we cannot identify the instrument — skip it.
 */
function pairIdentity(row: CatalogRow) {
  const base = row.currency_base?.trim();
  const quote = row.currency_quote?.trim();
  if (!base || !quote) return null;
  return { base, quote };
}

/**
 * Single-symbol catalogs (equity/indices) price one asset in one currency.
 * The symbol is the base; the reported currency is the quote.
 */
function symbolIdentity(row: CatalogRow) {
  const base = row.symbol?.trim();
  const quote = row.currency?.trim();
  if (!base || !quote) return null;
  return { base, quote };
}

/**
 * Commodities are published as pairs (e.g. "XAU/USD"). Prefer explicit
 * base/quote; otherwise split the symbol only when it is genuinely a pair.
 */
function commodityIdentity(row: CatalogRow) {
  const explicit = pairIdentity(row);
  if (explicit) return explicit;

  const symbol = row.symbol?.trim();
  if (!symbol?.includes("/")) return null;

  const [base, quote] = symbol.split("/");
  if (!base?.trim() || !quote?.trim()) return null;
  return { base: base.trim(), quote: quote.trim() };
}

const CATALOGS: CatalogSpec[] = [
  { path: "/forex_pairs", assetClass: "forex", subType: "forex_spot", identity: pairIdentity },
  { path: "/stocks", assetClass: "equity", subType: "equity_common", identity: symbolIdentity },
  { path: "/commodities", assetClass: "commodity", subType: "commodity_spot", identity: commodityIdentity },
  { path: "/indices", assetClass: "indices", subType: "index_cash", identity: symbolIdentity },
  { path: "/cryptocurrencies", assetClass: "crypto", subType: "crypto_spot", identity: pairIdentity },
];

export type FetchJson = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json?: unknown;
}>;

function extractRows(json: unknown): CatalogRow[] | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  return data as CatalogRow[];
}

export function normalizeCatalogRow(
  row: CatalogRow,
  spec: CatalogSpec,
  discoveredAt: number,
): DiscoveredInstrument | null {
  const symbol = row.symbol?.trim();
  if (!symbol) return null;

  const identity = spec.identity(row);
  if (!identity) return null;

  return {
    provider: PROVIDER,
    // Exact provider symbol — never rewritten.
    providerInstrumentId: symbol,
    assetClass: spec.assetClass,
    subType: spec.subType,
    baseAsset: identity.base,
    quoteAsset: identity.quote,
    // Catalog excludes delisted rows by default, so listing is a positive
    // assertion of an active listing rather than an assumption.
    tradingState: "TRADING",
    capabilities: [...CAPABILITIES],
    ...(row.country || row.exchange
      ? { region: (row.country || row.exchange)!.trim() }
      : {}),
    discoveredAt,
  };
}

/**
 * Build the Twelve Data discovery adapter.
 *
 * `readEnv` is injectable so tests never touch real secrets, matching the
 * existing credential-awareness design.
 */
export function createTwelveDataDiscoveryAdapter(
  fetchJson: FetchJson,
  readEnv?: EnvReader,
  options: { assetClasses?: readonly AssetClass[] } = {},
): ProviderDiscoveryAdapter {
  const enabled = CATALOGS.filter(
    (c) =>
      !options.assetClasses ||
      options.assetClasses.length === 0 ||
      options.assetClasses.includes(c.assetClass),
  );

  return {
    provider: PROVIDER,
    assetClasses: Array.from(new Set(enabled.map((c) => c.assetClass))),

    async discover(now: number): Promise<ProviderDiscoveryResult> {
      // Credentials are required. Missing credentials is an explicit failure,
      // never a silent empty catalog.
      const cred = checkCredentials(PROVIDER, readEnv);
      if (cred && cred.authRequired && !cred.available) {
        return {
          provider: PROVIDER,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          error: `Required credentials not configured: ${cred.missingEnvVarNames.join(", ")}.`,
        };
      }

      const apiKey = readEnv?.("TWELVE_DATA_API_KEY") ?? "";
      const warnings: string[] = [];
      const instruments: DiscoveredInstrument[] = [];
      let succeeded = 0;

      const responses = await Promise.all(
        enabled.map(async (spec) => {
          try {
            const res = await fetchJson(
              `${BASE_URL}${spec.path}?apikey=${encodeURIComponent(apiKey)}`,
            );
            return { spec, res, error: undefined as string | undefined };
          } catch (err) {
            return {
              spec,
              res: undefined,
              error: err instanceof Error ? err.message : "network failure",
            };
          }
        }),
      );

      for (const { spec, res, error } of responses) {
        if (error || !res) {
          warnings.push(`${spec.path} discovery failed: ${error ?? "no response"}.`);
          continue;
        }
        if (!res.ok) {
          warnings.push(`${spec.path} returned HTTP ${res.status}.`);
          continue;
        }

        const rows = extractRows(res.json);
        if (!rows) {
          warnings.push(`${spec.path} returned an unexpected payload shape.`);
          continue;
        }

        // One endpoint succeeding is real coverage even if others failed.
        succeeded += 1;

        let skipped = 0;
        for (const row of rows) {
          const normalized = normalizeCatalogRow(row, spec, now);
          if (!normalized) {
            skipped += 1;
            continue;
          }
          instruments.push(normalized);
        }

        if (skipped > 0) {
          warnings.push(
            `${spec.path}: skipped ${skipped} row(s) missing identity fields.`,
          );
        }
      }

      // Provider-scoped dedup: the same symbol may appear in two catalogs.
      const deduplicated = Array.from(
        new Map(
          instruments.map((i) => [`${i.assetClass}|${i.providerInstrumentId}`, i]),
        ).values(),
      );

      return {
        provider: PROVIDER,
        success: succeeded > 0,
        discoveredAt: now,
        instruments: deduplicated,
        warnings,
        ...(succeeded === 0
          ? { error: "Twelve Data discovery failed for all catalogs." }
          : {}),
      };
    },
  };
}
