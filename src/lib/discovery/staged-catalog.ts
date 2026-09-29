/**
 * Phase 289F — reading a persisted catalog across the function boundary.
 *
 * A catalog larger than `DISCOVERY_INLINE_LIMIT` is written to the server-side
 * stage in provider order and read back one bounded chunk at a time. This module
 * owns the two halves of that contract:
 *
 *   - the exact row mapping (an instrument in, the same instrument out — every
 *     provider-native field preserved verbatim, `seq` is the provider order),
 *   - the deterministic walk that reassembles the FULL catalog for a consumer
 *     that genuinely needs it, with transport completeness reported honestly.
 *
 * IT NEVER THROWS AWAY ROWS AND NEVER INVENTS THEM. A walk that cannot read
 * every staged row comes back `partial`/`failed` with the exact reason — it is
 * never returned as a complete universe, and a short read is never padded.
 */

import type {
  CatalogFetchReport,
  DiscoveryTransportState,
} from "./completeness";
import type { ProviderDiscoveryResult } from "./types";
import type { DiscoveredInstrument } from "./types";
import { STAGE_READ_ROWS } from "./return-boundary";

/**
 * One persisted instrument row.
 *
 * Field-for-field the `DiscoveredInstrument` contract plus the stage
 * coordinates. Optional fields stay absent when the provider did not report
 * them — a missing region is never written as an empty string.
 */
export interface DiscoveryStageRow {
  /** Provider order inside this catalog: 0-based, dense, monotonic. */
  seq: number;
  provider: string;
  providerInstrumentId: string;
  assetClass: string;
  subType: string;
  baseAsset: string;
  quoteAsset: string;
  settleAsset?: string;
  tradingState: string;
  providerState?: string;
  capabilities: string[];
  region?: string;
  discoveredAt: number;
  /** Provider precision/sizing, carried as JSON text so nothing is reshaped. */
  precisionJson?: string;
}

/** Convert a discovered instrument into its persisted row. */
export function toDiscoveryStageRow(
  instrument: DiscoveredInstrument,
  seq: number,
): DiscoveryStageRow {
  return {
    seq,
    provider: instrument.provider,
    providerInstrumentId: instrument.providerInstrumentId,
    assetClass: instrument.assetClass,
    subType: instrument.subType,
    baseAsset: instrument.baseAsset,
    quoteAsset: instrument.quoteAsset,
    ...(instrument.settleAsset !== undefined ? { settleAsset: instrument.settleAsset } : {}),
    tradingState: instrument.tradingState,
    ...(instrument.providerState !== undefined ? { providerState: instrument.providerState } : {}),
    capabilities: [...instrument.capabilities],
    ...(instrument.region !== undefined ? { region: instrument.region } : {}),
    discoveredAt: instrument.discoveredAt,
    ...(instrument.precision !== undefined
      ? { precisionJson: JSON.stringify(instrument.precision) }
      : {}),
  };
}

/**
 * Rebuild the discovered instrument from its row.
 *
 * The provider-native identity is copied verbatim; `precision` is parsed back
 * only when it was written, and a payload that cannot be parsed is DROPPED with
 * the rest of the row intact rather than replaced by a guess.
 */
export function fromDiscoveryStageRow(row: DiscoveryStageRow): DiscoveredInstrument {
  let precision: DiscoveredInstrument["precision"];
  if (typeof row.precisionJson === "string" && row.precisionJson.length > 0) {
    try {
      const parsed = JSON.parse(row.precisionJson) as unknown;
      if (parsed && typeof parsed === "object") {
        precision = parsed as DiscoveredInstrument["precision"];
      }
    } catch {
      precision = undefined;
    }
  }

  return {
    provider: row.provider,
    providerInstrumentId: row.providerInstrumentId,
    assetClass: row.assetClass as DiscoveredInstrument["assetClass"],
    subType: row.subType as DiscoveredInstrument["subType"],
    baseAsset: row.baseAsset,
    quoteAsset: row.quoteAsset,
    ...(row.settleAsset !== undefined ? { settleAsset: row.settleAsset } : {}),
    tradingState: row.tradingState as DiscoveredInstrument["tradingState"],
    ...(row.providerState !== undefined ? { providerState: row.providerState } : {}),
    capabilities: [...row.capabilities] as DiscoveredInstrument["capabilities"],
    ...(precision !== undefined ? { precision } : {}),
    ...(row.region !== undefined ? { region: row.region } : {}),
    discoveredAt: row.discoveredAt,
  };
}

/** A catalog whose rows live server-side under `stageId`. */
export interface StagedCatalogRef {
  stageId: string;
  catalogPath: string;
  /** Rows persisted — the number a complete walk must return. */
  stagedRows: number;
  /** Provider-order chunk size advertised by the run that staged the catalog. */
  chunkRows?: number;
}

/** One bounded page of a staged catalog. */
export interface StagedCatalogPage {
  rows: DiscoveredInstrument[];
  hasMore: boolean;
  nextAfterSeq: number | null;
  stagedRows: number;
  catalogPath?: string | null;
  completeness?: string | null;
  transportState?: DiscoveryTransportState | null;
}

export type ReadStagedCatalogPage = (args: {
  stageId: string;
  afterSeq: number;
  limit: number;
}) => Promise<StagedCatalogPage>;

export interface StagedCatalogWalk {
  rows: DiscoveredInstrument[];
  state: DiscoveryTransportState;
  pagesRead: number;
  detail?: string;
}

/**
 * Walk a staged catalog to its END, in provider order, in bounded chunks.
 *
 * The walk stops for exactly three reasons and never silently:
 *   - it reached every staged row (`complete`),
 *   - a read failed after some rows (`partial`, with the reason), or
 *   - nothing could be read (`failed`, with the reason).
 *
 * A read whose cursor does not advance is a defect in the reader, so it stops as
 * `partial` instead of looping forever. The final row count is compared against
 * the count the staging run recorded: a mismatch is a `partial` transport, never
 * a complete universe.
 */
export async function readFullStagedCatalog(
  ref: StagedCatalogRef,
  readPage: ReadStagedCatalogPage,
  options: { limit?: number; maxPages?: number } = {},
): Promise<StagedCatalogWalk> {
  const limit = Math.max(1, Math.min(options.limit ?? ref.chunkRows ?? STAGE_READ_ROWS, STAGE_READ_ROWS));
  const maxPages = Math.max(1, options.maxPages ?? Math.ceil(ref.stagedRows / limit) + 2);
  const rows: DiscoveredInstrument[] = [];
  let cursor = -1;
  let pagesRead = 0;

  while (pagesRead < maxPages) {
    let page: StagedCatalogPage;
    try {
      page = await readPage({ stageId: ref.stageId, afterSeq: cursor, limit });
    } catch (error) {
      const detail = `stage ${ref.stageId} read failed after ${rows.length}/${ref.stagedRows} row(s): ${
        error instanceof Error ? error.message : "unknown error"
      }`;
      return { rows, state: rows.length > 0 ? "partial" : "failed", pagesRead, detail };
    }

    pagesRead += 1;
    rows.push(...page.rows);

    if (!page.hasMore) break;

    const next = page.nextAfterSeq;
    if (next === null || next <= cursor) {
      return {
        rows,
        state: "partial",
        pagesRead,
        detail: `stage ${ref.stageId} cursor did not advance at ${cursor} (reader defect); stopped at ${rows.length}/${ref.stagedRows} row(s)`,
      };
    }
    cursor = next;
  }

  if (pagesRead >= maxPages) {
    return {
      rows,
      state: "partial",
      pagesRead,
      detail: `stage ${ref.stageId} exceeded ${maxPages} page(s); stopped at ${rows.length}/${ref.stagedRows} row(s)`,
    };
  }

  if (rows.length !== ref.stagedRows) {
    return {
      rows,
      state: rows.length > 0 ? "partial" : "failed",
      pagesRead,
      detail: `stage ${ref.stageId} returned ${rows.length} of ${ref.stagedRows} row(s)`,
    };
  }

  return { rows, state: "complete", pagesRead };
}

/** The catalogs of a discovery result that must be read through their stage. */
export function stagedCatalogRefs(
  result: Pick<ProviderDiscoveryResult, "catalogs"> | null | undefined,
): StagedCatalogRef[] {
  const catalogs: CatalogFetchReport[] = result?.catalogs ?? [];
  const refs: StagedCatalogRef[] = [];
  for (const catalog of catalogs) {
    const transport = catalog.transport;
    if (!transport || transport.mode !== "staged" || !transport.stageId) continue;
    refs.push({
      stageId: transport.stageId,
      catalogPath: catalog.path,
      stagedRows: transport.stagedRows,
      ...(transport.chunkRows !== undefined ? { chunkRows: transport.chunkRows } : {}),
    });
  }
  return refs;
}

/** How many rows are appended to the target array per push (stack-safe). */
const HYDRATE_PUSH_BATCH = 4096;

export interface StagedHydration {
  /** Rows appended to the result from stages, in catalog order. */
  hydratedRows: number;
  /** `complete` only when every staged catalog was walked to its end. */
  state: DiscoveryTransportState;
  /** One honest sentence per staged catalog that could not be fully walked. */
  errors: string[];
}

/**
 * Rebuild a provider result's staged catalogs onto `result.instruments`.
 *
 * This is how a consumer that genuinely needs the whole universe keeps it
 * without a function ever carrying an array past the boundary. The inline rows
 * are already in place; each staged catalog is walked to its end and appended in
 * catalog order (within every catalog provider order is exact). A walk that
 * cannot complete returns an ERROR instead of a shorter universe, so a degraded
 * cycle is visibly degraded rather than silently smaller.
 */
export async function hydrateStagedCatalogs(
  result: ProviderDiscoveryResult,
  readPage: ReadStagedCatalogPage,
  options: { limit?: number; maxPages?: number } = {},
): Promise<StagedHydration> {
  const refs = stagedCatalogRefs(result);
  if (refs.length === 0) return { hydratedRows: 0, state: "complete", errors: [] };

  const errors: string[] = [];
  let hydratedRows = 0;
  for (const ref of refs) {
    const walk = await readFullStagedCatalog(ref, readPage, options);
    // Pushed in bounded batches: spreading a six-figure array into a call is a
    // stack overflow, and the batch keeps the append itself bounded too.
    for (let i = 0; i < walk.rows.length; i += HYDRATE_PUSH_BATCH) {
      result.instruments.push(...walk.rows.slice(i, i + HYDRATE_PUSH_BATCH));
    }
    hydratedRows += walk.rows.length;
    if (walk.state !== "complete") {
      errors.push(
        `${ref.catalogPath} stage read ${walk.state} at ${walk.rows.length}/${ref.stagedRows} row(s): ${
          walk.detail ?? "no detail"
        }`,
      );
    }
  }
  return {
    hydratedRows,
    state: errors.length > 0 ? "partial" : "complete",
    errors,
  };
}

export interface DiscoveryTransportSummary {
  inlineRows: number;
  stagedRows: number;
  stagedCatalogs: number;
  state: DiscoveryTransportState;
  detail?: string;
}

/**
 * Transport totals for a composed discovery result, derived ONLY from the
 * per-catalog reports the run produced.
 */
export function discoveryTransportSummary(
  result: Pick<ProviderDiscoveryResult, "catalogs"> | null | undefined,
): DiscoveryTransportSummary {
  const catalogs: CatalogFetchReport[] = result?.catalogs ?? [];
  let inlineRows = 0;
  let stagedRows = 0;
  let stagedCatalogs = 0;
  const details: string[] = [];
  let anyFailed = false;
  let anyPartial = false;

  for (const catalog of catalogs) {
    const transport = catalog.transport;
    if (!transport) continue;
    inlineRows += transport.inlineRows;
    stagedRows += transport.stagedRows;
    if (transport.mode === "staged") stagedCatalogs += 1;
    if (transport.state === "failed") anyFailed = true;
    if (transport.state === "partial") anyPartial = true;
    if (transport.state !== "complete") {
      details.push(`${catalog.path} transport ${transport.state}: ${transport.detail ?? "no detail"}`);
    }
  }

  const state: DiscoveryTransportState =
    catalogs.length === 0
      ? "failed"
      : anyFailed && inlineRows + stagedRows === 0
        ? "failed"
        : anyFailed || anyPartial
          ? "partial"
          : "complete";

  return {
    inlineRows,
    stagedRows,
    stagedCatalogs,
    state,
    ...(details.length > 0 ? { detail: details.join("; ") } : {}),
  };
}
