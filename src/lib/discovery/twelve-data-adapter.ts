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
import type { CatalogTransportReport, DiscoveryTransportState } from "./completeness";
import { rollupCompleteness } from "./completeness";
import {
  boundedInlineLimit,
  DISCOVERY_INLINE_LIMIT,
  STAGE_READ_ROWS,
  STAGE_WRITE_BATCH_ROWS,
} from "./return-boundary";
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
  /** Kept rows per catalog, including the ones that live in a stage. */
  let totalDiscovered = 0;

  for (const part of parts) {
    for (const instrument of part.instruments) {
      const identity = `${instrument.assetClass}|${instrument.providerInstrumentId}`;
      if (byIdentity.has(identity)) continue;
      byIdentity.set(identity, instrument);
      instruments.push(instrument);
    }
    warnings.push(...part.warnings);
    pagesFetched += part.pagesFetched ?? 0;
    for (const catalog of part.catalogs ?? []) {
      totalDiscovered += catalog.totalDiscovered;
      catalogs.push(catalog);
    }
    // A part that reports no per-catalog rows (a credential failure) still
    // contributes its own total, which is zero by construction.
    if ((part.catalogs ?? []).length === 0) {
      totalDiscovered += part.totalDiscovered ?? 0;
    }
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
    totalDiscovered,
    catalogs,
    ...(succeeded ? {} : { error: "Twelve Data discovery failed for all catalogs." }),
  };
}

/**
 * Phase 289F — where a catalog that CANNOT cross the function boundary goes.
 *
 * Convex rejects any function return (or argument) carrying an array longer than
 * 8192 elements, and the provider returns the whole `/stocks` catalog — 143300
 * rows — in one response. The adapter therefore stages such a catalog
 * server-side: the rows are written in provider order, the response carries a
 * bounded descriptor instead of the array, and consumers read the universe back
 * in chunks. Nothing is dropped, nothing is capped, and the catalog's
 * completeness stays the provider walk's own truth.
 *
 * `begin` → `append` (once per bounded batch, in order) → `finish`. A sink that
 * throws makes the catalog's TRANSPORT state partial/failed; the catalog's own
 * COMPLETE/PARTIAL/FAILED is untouched, because the two answer different
 * questions.
 */
export interface CatalogStagingSink {
  begin(args: {
    catalogPath: string;
    assetClass: string;
    discoveredAt: number;
  }): Promise<{ stageId: string }>;
  append(args: {
    stageId: string;
    rows: readonly DiscoveredInstrument[];
  }): Promise<void>;
  finish(args: {
    stageId: string;
    catalogPath: string;
    stagedRows: number;
    totalDiscovered: number;
    completeness: ProviderDiscoveryResult["completeness"];
    state: DiscoveryTransportState;
    detail?: string;
  }): Promise<void>;
}

/**
 * Phase 289F — settle a catalog's transport state after its walk finished.
 *
 * `observed` is what the sink reported while rows were being written; the final
 * state can only be worse, never better: a catalog that staged fewer rows than
 * it kept is `partial` (some rows available) or `failed` (none), and a catalog
 * that staged everything is `complete`. Kept as a standalone function so the
 * state is settled in ONE place — the same rule for every catalog.
 */
export function settleCatalogTransport(
  observed: DiscoveryTransportState,
  stagedRows: number,
  kept: number,
): { state: DiscoveryTransportState; detail?: string } {
  if (observed === "failed") return { state: "failed" };
  if (stagedRows < kept) {
    return {
      state: stagedRows > 0 ? "partial" : "failed",
      detail: `${stagedRows} of ${kept} row(s) staged`,
    };
  }
  // The sink already reported a partial write: it can never be upgraded to
  // complete just because the counts happen to line up.
  if (observed === "partial") {
    return { state: "partial", detail: "the staging sink reported a partial write" };
  }
  return { state: "complete" };
}

export interface TwelveDataDiscoveryOptions {
  assetClasses?: readonly AssetClass[];
  catalogPaths?: readonly string[];
  /** Rows ONE response may carry inline. Defaults to the boundary constant. */
  inlineLimit?: number;
  /** Persists catalogs that exceed `inlineLimit`. */
  staging?: CatalogStagingSink;
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
  options: TwelveDataDiscoveryOptions = {},
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
       *
       * Phase 289F — THE RETURN BOUNDARY. Memory was not the last limit: Convex
       * also rejects any return value carrying an array longer than 8192
       * elements, and `/stocks` is 143300 instruments — the deployed runtime
       * answered
       *
       *   `return value invalid: Array length is too long (143300 > maximum length 8192)`
       *
       * Slicing to 8192 would present a truncated catalog as the universe, so a
       * catalog that does not fit `inlineLimit` moves AS A WHOLE onto the staged
       * transport: every row is persisted in provider order and the response
       * carries only a bounded descriptor. `totalDiscovered` stays the real
       * count, the catalog's own completeness is untouched, and the transport
       * state says whether every row really is available.
       */
      const inlineLimit = boundedInlineLimit(options.inlineLimit);
      const staging = options.staging;
      const byIdentity = new Map<string, DiscoveredInstrument>();

      for (const spec of enabled) {
        let skipped = 0;
        let kept = 0;
        /** Identity dedupe INSIDE this catalog (provider order preserved). */
        const seen = new Set<string>();
        /** Rows of this catalog that are still small enough to travel inline. */
        const inlineInCatalog: DiscoveredInstrument[] = [];

        // ── this catalog's transport state ────────────────────────────
        let stagedMode = false;
        let stageId: string | null = null;
        let stagedRows = 0;
        let stagingState: DiscoveryTransportState = "complete";
        let stagingDetail: string | undefined;

        // Bounded write queue. `onRows` is synchronous (the row scanner calls
        // it), so full batches queue here and `drain` persists them as soon as
        // the pagination yields — the queue never exceeds one transport chunk.
        let pending: DiscoveredInstrument[] = [];
        const pendingBatches: DiscoveredInstrument[][] = [];
        const queueRows = (rows: readonly DiscoveredInstrument[]) => {
          for (const row of rows) pending.push(row);
          while (pending.length >= STAGE_WRITE_BATCH_ROWS) {
            pendingBatches.push(pending.splice(0, STAGE_WRITE_BATCH_ROWS));
          }
        };
        const flushPending = () => {
          if (pending.length > 0) pendingBatches.push(pending.splice(0, pending.length));
        };

        const drain = async (): Promise<void> => {
          if (!stagedMode) return;
          flushPending();
          if (staging === undefined) {
            // No sink: rows past the boundary have nowhere to go. They are NOT
            // silently inlined (that would be a truncated catalog) — the
            // transport says exactly what happened instead.
            pendingBatches.length = 0;
            stagedRows = 0;
            stagingState = "failed";
            stagingDetail ??=
              `catalog holds ${kept} row(s), above the ${inlineLimit}-row inline boundary, and no staging sink is configured`;
            return;
          }
          while (pendingBatches.length > 0) {
            const batch = pendingBatches.shift()!;
            if (stagingState === "failed") break;
            if (stageId === null) {
              try {
                const started = await staging.begin({
                  catalogPath: spec.path,
                  assetClass: spec.assetClass,
                  discoveredAt: now,
                });
                stageId = started.stageId;
              } catch (error) {
                stagingState = "failed";
                stagingDetail = `staging could not be opened: ${
                  error instanceof Error ? error.message : "unknown error"
                }`;
                break;
              }
            }
            try {
              await staging.append({ stageId, rows: batch });
              stagedRows += batch.length;
            } catch (error) {
              stagingState = stagedRows > 0 ? "partial" : "failed";
              stagingDetail = `staging write failed after ${stagedRows} row(s): ${
                error instanceof Error ? error.message : "unknown error"
              }`;
              break;
            }
          }
          pendingBatches.length = 0;
        };

        const result = await fetchTwelveDataCatalogPages(fetchJson, {
          path: spec.path,
          apiKey,
          drain,
          onRows: (rows) => {
            for (const raw of rows) {
              const normalized = normalizeCatalogRow(raw as CatalogRow, spec, now);
              if (!normalized) {
                skipped += 1;
                continue;
              }
              const identity = `${normalized.assetClass}|${normalized.providerInstrumentId}`;
              if (seen.has(identity)) continue;
              seen.add(identity);
              kept += 1;

              if (!stagedMode) {
                if (kept <= inlineLimit) {
                  inlineInCatalog.push(normalized);
                  continue;
                }
                // Crossing the boundary. The catalog moves to the staged
                // transport AS A WHOLE: the rows already collected are persisted
                // too, so the stage holds the entire catalog in provider order
                // and the response carries none of it (no first-N prefix).
                stagedMode = true;
                for (const row of inlineInCatalog) {
                  const key = `${row.assetClass}|${row.providerInstrumentId}`;
                  if (byIdentity.get(key) === row) byIdentity.delete(key);
                }
                queueRows(inlineInCatalog.splice(0, inlineInCatalog.length));
                queueRows([normalized]);
                continue;
              }

              queueRows([normalized]);
            }
          },
        });

        if (stagedMode) await drain();

        warnings.push(...result.warnings);
        pagesFetched += result.pagesFetched;

        if (result.completeness === "FAILED") {
          catalogs.push({
            path: spec.path,
            assetClass: spec.assetClass,
            completeness: "FAILED",
            pagesFetched: result.pagesFetched,
            totalDiscovered: 0,
            transport: {
              mode: "inline",
              state: "failed",
              inlineRows: 0,
              stagedRows: 0,
              totalKept: 0,
              detail: "the catalog was not read, so there is nothing to transport",
            },
            ...(result.failedPage !== undefined
              ? { failedPage: result.failedPage }
              : {}),
          });
          continue;
        }

        // The walk is done: settle the staged transport and record its real
        // numbers before the catalog is reported.
        let transport: CatalogTransportReport;
        if (stagedMode) {
          const settled = settleCatalogTransport(stagingState, stagedRows, kept);
          stagingState = settled.state;
          if (settled.detail !== undefined) stagingDetail ??= settled.detail;
          if (stageId === null) {
            stagingState = stagedRows > 0 ? "partial" : "failed";
            stagingDetail ??=
              `catalog holds ${kept} row(s) and no stage was opened; nothing is readable through the boundary`;
          }
          if (staging !== undefined && stageId !== null) {
            try {
              await staging.finish({
                stageId,
                catalogPath: spec.path,
                stagedRows,
                totalDiscovered: kept,
                completeness: result.completeness,
                state: stagingState,
                ...(stagingDetail !== undefined ? { detail: stagingDetail } : {}),
              });
            } catch (error) {
              stagingState = stagedRows > 0 ? "partial" : "failed";
              stagingDetail = `stage metadata write failed: ${
                error instanceof Error ? error.message : "unknown error"
              }`;
            }
          }
          transport = {
            mode: "staged",
            state: stagingState,
            inlineRows: 0,
            stagedRows,
            totalKept: kept,
            chunkRows: STAGE_READ_ROWS,
            ...(stageId !== null ? { stageId } : {}),
            ...(stagingDetail !== undefined ? { detail: stagingDetail } : {}),
          };
          if (stagingState !== "complete") {
            warnings.push(
              `${spec.path}: staged transport ${stagingState} — ${stagingDetail ?? "no detail"}. The provider walk reported ${result.completeness}; this catalog's rows are not fully available.`,
            );
          }
        } else {
          for (const row of inlineInCatalog) {
            const identity = `${row.assetClass}|${row.providerInstrumentId}`;
            if (!byIdentity.has(identity)) byIdentity.set(identity, row);
          }
          transport = {
            mode: "inline",
            state: "complete",
            inlineRows: inlineInCatalog.length,
            stagedRows: 0,
            totalKept: kept,
          };
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
          transport,
          ...(result.failedPage !== undefined
            ? { failedPage: result.failedPage }
            : {}),
        });
      }

      const instruments = Array.from(byIdentity.values());
      const completeness = rollupCompleteness(catalogs.map((c) => c.completeness));
      const succeeded = catalogs.some((c) => c.completeness !== "FAILED");
      // Phase 289F — `totalDiscovered` is the sum of what the walks actually
      // kept, NOT the length of the inline array. With a staged catalog the two
      // differ, and reporting the inline length would understate the universe.
      const totalDiscovered = catalogs.reduce((n, c) => n + c.totalDiscovered, 0);

      return {
        provider: PROVIDER,
        success: succeeded,
        discoveredAt: now,
        instruments,
        warnings,
        completeness,
        pagesFetched,
        totalDiscovered,
        catalogs,
        ...(succeeded
          ? {}
          : { error: "Twelve Data discovery failed for all catalogs." }),
      };
    },
  };
}
