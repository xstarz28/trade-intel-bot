/**
 * Instrument universe for Analyze selection.
 *
 * Source of truth is actual provider discovery (tracked rows), never
 * POPULAR_INSTRUMENTS, instruments.ts, alias maps, or typed guesses.
 *
 * A catalog row is METADATA + lifecycle. Discovery is never live evidence.
 * Selecting a DISCOVERED (not yet acquired) row is allowed; Analyze then
 * performs provider-native acquisition.
 */

import type { AssetClass, DataCapability, InstrumentSubType } from "@/lib/data/universal/types";
import {
  discoveredInstrumentKey,
  isAcquirableState,
  type CatalogFetchReport,
  type DiscoveryCompleteness,
  type DiscoveredInstrument,
  type ProviderDiscoveryResult,
  type TradingState,
} from "./types";
import { rollupCompleteness } from "./completeness";
import type { DiscoveryLifecycleState, TrackedInstrument } from "./lifecycle";

/** Display window only — not a product ceiling and not a whitelist. */
export const CATALOG_RENDER_WINDOW = 80;

export type CatalogInstrument = {
  provider: string;
  providerInstrumentId: string;
  assetClass: AssetClass;
  subType: InstrumentSubType;
  baseAsset: string;
  quoteAsset: string;
  tradingState: TradingState;
  capabilities: DataCapability[];
  region?: string;
  discoveredAt: number;
  /** Lifecycle of live acquisition — not a tradability rewrite. */
  lifecycle: DiscoveryLifecycleState;
};

export type DiscoveryProviderStatus = {
  provider: string;
  ok: boolean;
  completeness?: DiscoveryCompleteness;
  pagesFetched?: number;
  totalDiscovered?: number;
  warnings?: string[];
  catalogs?: CatalogFetchReport[];
};

export type ClassDiscoverySummary = {
  assetClass: AssetClass;
  count: number;
  completeness: DiscoveryCompleteness;
  failedPage?: number;
};

export function providerStatusFromDiscovery(
  result: ProviderDiscoveryResult,
): DiscoveryProviderStatus {
  return {
    provider: result.provider,
    ok: result.success,
    completeness:
      result.completeness ?? (result.success ? "COMPLETE" : "FAILED"),
    pagesFetched: result.pagesFetched ?? 0,
    totalDiscovered: result.totalDiscovered ?? result.instruments.length,
    warnings: result.warnings,
    catalogs: result.catalogs,
  };
}

export function classDiscoverySummaries(
  catalog: readonly CatalogInstrument[],
  providers: readonly DiscoveryProviderStatus[],
): ClassDiscoverySummary[] {
  const counts = countByAssetClass(catalog);
  const classes: AssetClass[] = [
    "crypto",
    "forex",
    "equity",
    "commodity",
    "indices",
    "macro",
  ];
  const out: ClassDiscoverySummary[] = [];
  for (const assetClass of classes) {
    const reports = providers.flatMap((p) =>
      (p.catalogs ?? []).filter((c) => c.assetClass === assetClass),
    );
    if (reports.length === 0 && counts[assetClass] === 0) continue;
    const completeness =
      reports.length === 0
        ? counts[assetClass] > 0
          ? "COMPLETE"
          : "FAILED"
        : rollupCompleteness(reports.map((r) => r.completeness));
    const failedPage = reports.find((r) => r.failedPage !== undefined)?.failedPage;
    out.push({
      assetClass,
      count: counts[assetClass],
      completeness,
      ...(failedPage !== undefined ? { failedPage } : {}),
    });
  }
  return out;
}

/**
 * UI filter values. `stock` is the existing canonical InstrumentType token
 * (Phase 190/197); it maps onto discovery `equity`. It never rewrites a
 * native id and never invents an instrument.
 */
export type ClassFilter =
  | "all"
  | "forex"
  | "crypto"
  | "stock"
  | "commodity"
  | "indices"
  | "macro";

export type NativeSelection = {
  provider: string;
  providerInstrumentId: string;
  assetClass: AssetClass;
};

export function catalogIdentityKey(
  row: Pick<CatalogInstrument, "provider" | "providerInstrumentId">,
): string {
  return `${row.provider}::${row.providerInstrumentId}`;
}

export function assetClassForFilter(filter: ClassFilter): AssetClass | undefined {
  if (filter === "all") return undefined;
  if (filter === "stock") return "equity";
  return filter;
}

/** Always-visible class chips. Indices/macro appear only when catalog has them. */
export const PRIMARY_CLASS_FILTERS: ClassFilter[] = [
  "all",
  "crypto",
  "forex",
  "stock",
  "commodity",
];

export function visibleClassFilters(catalog: readonly CatalogInstrument[]): ClassFilter[] {
  const filters: ClassFilter[] = [...PRIMARY_CLASS_FILTERS];
  if (catalog.some((row) => row.assetClass === "indices")) filters.push("indices");
  if (catalog.some((row) => row.assetClass === "macro")) filters.push("macro");
  return filters;
}

/**
 * Catalog from tracked discovery. Excludes DELISTED and non-tradable
 * trading states. Does not require LIVE acquisition.
 */
export function buildInstrumentCatalog(
  tracked: ReadonlyMap<string, TrackedInstrument>,
): CatalogInstrument[] {
  const rows: CatalogInstrument[] = [];
  for (const entry of tracked.values()) {
    if (entry.state === "DELISTED") continue;
    const inst = entry.instrument;
    if (!isAcquirableState(inst.tradingState)) continue;
    if (!inst.provider || !inst.providerInstrumentId) continue;
    rows.push(toCatalogRow(inst, entry.state));
  }
  return rows.sort((a, b) => catalogIdentityKey(a).localeCompare(catalogIdentityKey(b)));
}

export function catalogFromDiscovered(
  discovered: readonly DiscoveredInstrument[],
  lifecycle: DiscoveryLifecycleState = "DISCOVERED",
): CatalogInstrument[] {
  const rows: CatalogInstrument[] = [];
  for (const inst of discovered) {
    if (!isAcquirableState(inst.tradingState)) continue;
    if (!inst.provider || !inst.providerInstrumentId) continue;
    rows.push(toCatalogRow(inst, lifecycle));
  }
  return rows.sort((a, b) => catalogIdentityKey(a).localeCompare(catalogIdentityKey(b)));
}

function toCatalogRow(
  inst: DiscoveredInstrument,
  lifecycle: DiscoveryLifecycleState,
): CatalogInstrument {
  return {
    provider: inst.provider,
    providerInstrumentId: inst.providerInstrumentId,
    assetClass: inst.assetClass,
    subType: inst.subType,
    baseAsset: inst.baseAsset,
    quoteAsset: inst.quoteAsset,
    tradingState: inst.tradingState,
    capabilities: [...inst.capabilities],
    ...(inst.region ? { region: inst.region } : {}),
    discoveredAt: inst.discoveredAt,
    lifecycle,
  };
}

export function countByAssetClass(
  catalog: readonly CatalogInstrument[],
): Record<AssetClass, number> {
  const counts: Record<AssetClass, number> = {
    crypto: 0,
    forex: 0,
    equity: 0,
    commodity: 0,
    indices: 0,
    macro: 0,
  };
  for (const row of catalog) {
    counts[row.assetClass] += 1;
  }
  return counts;
}

export function countForFilter(
  catalog: readonly CatalogInstrument[],
  filter: ClassFilter,
): number {
  if (filter === "all") return catalog.length;
  const assetClass = assetClassForFilter(filter);
  if (!assetClass) return 0;
  return catalog.reduce((n, row) => n + (row.assetClass === assetClass ? 1 : 0), 0);
}

/**
 * Search/filter only. A typed string that matches nothing does not create
 * a provider identity and is never uppercased/substituted into one.
 */
export function filterCatalog(
  catalog: readonly CatalogInstrument[],
  args: { classFilter: ClassFilter; query: string },
): CatalogInstrument[] {
  const assetClass = assetClassForFilter(args.classFilter);
  const q = args.query.trim();
  const out: CatalogInstrument[] = [];
  for (const row of catalog) {
    if (assetClass && row.assetClass !== assetClass) continue;
    if (q && !rowMatchesQuery(row, q)) continue;
    out.push(row);
  }
  return out;
}

function rowMatchesQuery(row: CatalogInstrument, query: string): boolean {
  const q = query.toUpperCase();
  return (
    row.providerInstrumentId.toUpperCase().includes(q) ||
    row.baseAsset.toUpperCase().includes(q) ||
    row.quoteAsset.toUpperCase().includes(q) ||
    row.provider.toUpperCase().includes(q) ||
    row.assetClass.toUpperCase().includes(q)
  );
}

export function windowCatalog(
  rows: readonly CatalogInstrument[],
  windowSize: number = CATALOG_RENDER_WINDOW,
): CatalogInstrument[] {
  if (windowSize < 0) return [];
  return rows.slice(0, windowSize);
}

/** Authoritative Analyze payload. Display string is never the identity. */
export function nativeSelectionOf(row: CatalogInstrument): NativeSelection {
  return {
    provider: row.provider,
    providerInstrumentId: row.providerInstrumentId,
    assetClass: row.assetClass,
  };
}

export function findCatalogRow(
  catalog: readonly CatalogInstrument[],
  selection: Pick<NativeSelection, "provider" | "providerInstrumentId">,
): CatalogInstrument | undefined {
  return catalog.find(
    (row) =>
      row.provider === selection.provider &&
      row.providerInstrumentId === selection.providerInstrumentId,
  );
}

export function findCatalogRowByKey(
  catalog: readonly CatalogInstrument[],
  key: string,
): CatalogInstrument | undefined {
  return catalog.find((row) => catalogIdentityKey(row) === key);
}

/**
 * Free-text cannot mint an identity. Returns the row only when the typed
 * string is exactly one catalog native id (and optionally one provider).
 * Multiple matches refuse rather than pick.
 */
export function identityFromTypedSearch(
  catalog: readonly CatalogInstrument[],
  typed: string,
): CatalogInstrument | undefined {
  const needle = typed.trim();
  if (!needle) return undefined;
  const exact = catalog.filter((row) => row.providerInstrumentId === needle);
  if (exact.length === 1) return exact[0];
  return undefined;
}

export { discoveredInstrumentKey };
