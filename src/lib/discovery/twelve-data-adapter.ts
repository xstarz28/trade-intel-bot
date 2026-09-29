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
 * Completeness: COMPLETE when all catalog pages fetched, PARTIAL when later page fails, FAILED when all fail.
 */

import type {
  AssetClass,
  DataCapability,
  InstrumentSubType,
} from "@/lib/data/universal/types";
import type { EnvReader } from "@/lib/data/universal/live/credentials";
import { checkCredentials } from "@/lib/data/universal/live/credentials";
import type {
  CatalogFetchReport,
  DiscoveredInstrument,
  ProviderDiscoveryAdapter,
  ProviderDiscoveryResult,
} from "./types";
import { rollupCompleteness } from "./completeness";
import {
  fetchTwelveDataCatalogPages,
  type FetchJson,
} from "./twelve-data-pagination";

export type { FetchJson };

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

/**
 * Phase 289E — the catalog paths this adapter owns, in provider order.
 * Callers that run ONE catalog per function execution (so a single oversized
 * catalog cannot take down the others, and so the failing catalog is named)
 * enumerate this list; it is the single source of truth for the path set.
 */
export const TWELVE_DATA_CATALOG_PATHS: readonly string[] = CATALOGS.map((c) => c.path);

function catalogSpecOf(path: string): CatalogSpec | undefined {
  return CATALOGS.find((c) => c.path === path);
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
 * Phase 289E — the credential gate, shared by every discovery entry point.
 *
 * Missing credentials are an explicit FAILURE, never a silent empty catalog.
 * Exported so the composing action can answer identically to a single-catalog
 * run instead of re-implementing (and drifting from) this rule.
 */
export function twelveDataCredentialGate(
  readEnv: EnvReader | undefined,
  now: number,
): ProviderDiscoveryResult | null {
  const cred = checkCredentials(PROVIDER, readEnv);
  if (cred && cred.authRequired && !cred.available) {
    return {
      provider: PROVIDER,
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      catalogs: [],
      error: `Required credentials not configured: ${cred.missingEnvVarNames.join(", ")}.`,
    };
  }
  return null;
}

/**
 * Phase 289E — a catalog that could not be run at all.
 *
 * Used when one catalog is executed in its own function execution and that
 * execution fails (transport timeout, runtime memory limit, provider outage).
 * The result names the catalog, keeps the runtime's own message, and reports
 * FAILED — a catalog that was never read is never presented as COMPLETE and its
 * absence never silently shrinks the universe.
 */
export function twelveDataCatalogFailure(
  path: string,
  now: number,
  reason: string,
): ProviderDiscoveryResult {
  const spec = catalogSpecOf(path);
  const warning = `${path} discovery failed: ${reason}.`;
  return {
    provider: PROVIDER,
    success: false,
    discoveredAt: now,
    instruments: [],
    warnings: [warning],
    completeness: "FAILED",
    pagesFetched: 0,
    totalDiscovered: 0,
    catalogs: [
      {
        path,
        assetClass: spec?.assetClass ?? "",
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
      },
    ],
    error: warning,
  };
}

/**
 * Phase 289E — compose per-catalog runs into the universal discovery result.
 *
 * The external contract is byte-for-byte the one a single-run discovery always
 * produced: provider order (catalog order, then the provider's own row order),
 * first-occurrence dedupe by `assetClass|providerInstrumentId`, the per-catalog
 * reports, the summed page count, the real total, and the COMPLETE/PARTIAL/FAILED
 * rollup. What changed is only WHO holds the memory: each catalog was fetched and
 * normalized in its own execution.
 */
export function mergeTwelveDataCatalogRuns(
  parts: readonly ProviderDiscoveryResult[],
  now: number,
): ProviderDiscoveryResult {
  const byIdentity = new Map<string, DiscoveredInstrument>();
  const instruments: DiscoveredInstrument[] = [];
  const warnings: string[] = [];
  const catalogs: CatalogFetchReport[] = [];
  let pagesFetched = 0;

  for (const part of parts) {
    for (const instrument of part.instruments) {
      const identity = `${instrument.assetClass}|${instrument.providerInstrumentId}`;
      if (byIdentity.has(identity)) continue;
      byIdentity.set(identity, instrument);
      instruments.push(instrument);
    }
    warnings.push(...part.warnings);
    pagesFetched += part.pagesFetched ?? 0;
    catalogs.push(...(part.catalogs ?? []));
  }

  const completeness = rollupCompleteness(catalogs.map((c) => c.completeness));
  const succeeded = catalogs.some((c) => c.completeness !== "FAILED");

  return {
    provider: PROVIDER,
    success: succeeded,
    discoveredAt: now,
    instruments,
    warnings,
    completeness,
    pagesFetched,
    totalDiscovered: instruments.length,
    catalogs,
    ...(succeeded ? {} : { error: "Twelve Data discovery failed for all catalogs." }),
  };
}

/**
 * Build the Twelve Data discovery adapter.
 *
 * `readEnv` is injectable so tests never touch real secrets, matching the
 * existing credential-awareness design. `catalogPaths` restricts the run to
 * specific catalogs (used by the per-catalog execution boundary); an unknown
 * path is an explicit failure, never an arbitrary fetch.
 */
export function createTwelveDataDiscoveryAdapter(
  fetchJson: FetchJson,
  readEnv?: EnvReader,
  options: { assetClasses?: readonly AssetClass[]; catalogPaths?: readonly string[] } = {},
): ProviderDiscoveryAdapter {
  const requestedPaths = options.catalogPaths;
  const enabled = CATALOGS.filter(
    (c) =>
      (!requestedPaths || requestedPaths.includes(c.path)) &&
      (!options.assetClasses ||
        options.assetClasses.length === 0 ||
        options.assetClasses.includes(c.assetClass)),
  );

  return {
    provider: PROVIDER,
    assetClasses: Array.from(new Set(enabled.map((c) => c.assetClass))),

    async discover(now: number): Promise<ProviderDiscoveryResult> {
      const unknownPaths = (requestedPaths ?? []).filter((p) => catalogSpecOf(p) === undefined);
      if (unknownPaths.length > 0) {
        return {
          provider: PROVIDER,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          catalogs: [],
          error: `Unknown Twelve Data catalog path(s): ${unknownPaths.join(", ")}.`,
        };
      }

      // Credentials are required. Missing credentials is an explicit failure,
      // never a silent empty catalog.
      const credentialFailure = twelveDataCredentialGate(readEnv, now);
      if (credentialFailure) return credentialFailure;

      const apiKey = readEnv?.("TWELVE_DATA_API_KEY") ?? "";
      const warnings: string[] = [];
      const catalogs: CatalogFetchReport[] = [];
      let pagesFetched = 0;

      /**
       * Phase 289C — MEMORY: catalogs are processed ONE AT A TIME, and each
       * catalog's rows are normalized as its pages arrive.
       *
       * What this replaced: `Promise.all(enabled.map(fetchTwelveDataCatalogPages))`
       * — every enabled catalog fetched concurrently, each one retaining ALL of
       * its raw provider rows, with the normalized instruments then built on top
       * of the still-live raw aggregate.
       *
       * Phase 289E — MEMORY: the accumulating index below IS the result. The
       * previous shape kept BOTH the growing `instruments` array and, at the end,
       * a second full array produced from a `Map` of the same instruments — so
       * the complete normalized set existed twice at the moment the action had
       * already parsed the largest catalog. One Map, first occurrence wins, no
       * second copy. (The same first-occurrence rule is applied again when
       * per-catalog runs are composed.)
       */
      const byIdentity = new Map<string, DiscoveredInstrument>();

      for (const spec of enabled) {
        let skipped = 0;
        let kept = 0;

        const result = await fetchTwelveDataCatalogPages(fetchJson, {
          path: spec.path,
          apiKey,
          onRows: (rows) => {
            for (const raw of rows) {
              const normalized = normalizeCatalogRow(raw as CatalogRow, spec, now);
              if (!normalized) {
                skipped += 1;
                continue;
              }
              const identity = `${normalized.assetClass}|${normalized.providerInstrumentId}`;
              if (byIdentity.has(identity)) continue;
              byIdentity.set(identity, normalized);
              kept += 1;
            }
          },
        });

        warnings.push(...result.warnings);
        pagesFetched += result.pagesFetched;

        if (result.completeness === "FAILED") {
          catalogs.push({
            path: spec.path,
            assetClass: spec.assetClass,
            completeness: "FAILED",
            pagesFetched: result.pagesFetched,
            totalDiscovered: 0,
            ...(result.failedPage !== undefined
              ? { failedPage: result.failedPage }
              : {}),
          });
          continue;
        }

        if (skipped > 0) {
          warnings.push(
            `${spec.path}: skipped ${skipped} row(s) missing identity fields.`,
          );
        }

        catalogs.push({
          path: spec.path,
          assetClass: spec.assetClass,
          completeness: result.completeness,
          pagesFetched: result.pagesFetched,
          totalDiscovered: kept,
          ...(result.failedPage !== undefined
            ? { failedPage: result.failedPage }
            : {}),
        });
      }

      const instruments = Array.from(byIdentity.values());
      const completeness = rollupCompleteness(catalogs.map((c) => c.completeness));
      const succeeded = catalogs.some((c) => c.completeness !== "FAILED");

      return {
        provider: PROVIDER,
        success: succeeded,
        discoveredAt: now,
        instruments,
        warnings,
        completeness,
        pagesFetched,
        totalDiscovered: instruments.length,
        catalogs,
        ...(succeeded
          ? {}
          : { error: "Twelve Data discovery failed for all catalogs." }),
      };
    },
  };
}
