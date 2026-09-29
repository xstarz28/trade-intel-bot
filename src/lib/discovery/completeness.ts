/**
 * Discovery completeness is METADATA about the catalog fetch.
 *
 * COMPLETE — every requested catalog/page finished; the provider indicated
 *            it had nothing more to send.
 * PARTIAL  — at least one catalog or later page failed after some rows
 *            arrived. The catalog may be shown, never as exhaustive.
 * FAILED   — nothing usable was discovered.
 *
 * HTTP 200 is not completeness. Discovery rows are never live evidence.
 */

export type DiscoveryCompleteness = "COMPLETE" | "PARTIAL" | "FAILED";

/**
 * Phase 289F — TRANSPORT completeness, a DIFFERENT question from catalog
 * completeness.
 *
 *   COMPLETE — every kept row of this catalog is available to a consumer
 *              (inline in the response, or fully persisted under a stage).
 *   PARTIAL  — the transport stopped after some rows: a consumer that walks the
 *              catalog sees fewer rows than the walk kept.
 *   FAILED   — no row is available through the transport.
 *
 * A single bounded page/chunk is NOT PARTIAL. A COMPLETE catalog read one chunk
 * at a time is COMPLETE at the catalog level and COMPLETE at the transport
 * level; only the CURRENT RESPONSE is one chunk of it. The two states are
 * reported separately so a bounded read can never masquerade as a short
 * catalog, and a short catalog can never hide behind a bounded read.
 */
export type DiscoveryTransportState = "complete" | "partial" | "failed";

/** How a catalog's rows reach the caller across the function boundary. */
export type CatalogTransportMode = "inline" | "staged";

export interface CatalogTransportReport {
  mode: CatalogTransportMode;
  state: DiscoveryTransportState;
  /** Rows carried inline in THIS response (0 for a fully staged catalog). */
  inlineRows: number;
  /** Rows persisted server-side under `stageId` and readable in chunks. */
  stagedRows: number;
  /** Rows the provider walk kept — inline + staged. Never a capped subset. */
  totalKept: number;
  /** Provider-order chunk size a consumer should page with. */
  chunkRows?: number;
  /** Phase 289G — rows stored per stage document (the write-side chunk). */
  writeChunkRows?: number;
  /** Server-side stage identifier; present only for the staged mode. */
  stageId?: string;
  /** Why the transport state is not `complete`. */
  detail?: string;
}

export type CatalogFetchReport = {
  path: string;
  assetClass: string;
  completeness: DiscoveryCompleteness;
  pagesFetched: number;
  totalDiscovered: number;
  /**
   * Phase 289G — the provider's own row count for this catalog, verbatim.
   * Reported beside `totalDiscovered` so a reader can see both the number the
   * provider published and the number this walk kept (identity dedupe inside a
   * catalog legitimately makes them differ; neither is invented).
   */
  providerCount?: number;
  /**
   * Phase 289J — THE RAW SIDE OF THE SAME QUESTION.
   *
   *   `rawRowsSeen` — provider `data` elements actually parsed, before identity
   *                   dedupe and before normalization. This is the number that
   *                   reconciles with `providerCount`: a COMPLETE catalog has
   *                   consumed a body that handed over at least as many raw rows
   *                   as the provider said it was sending.
   *   `skippedIdentityRows` — raw rows discarded because they carry none of the
   *                   identity fields this catalog requires. Counted, never
   *                   hidden and never turned into a fabricated identity.
   *   `duplicateRows` — raw rows discarded because their identity had already
   *                   been taken (first occurrence wins, provider order kept).
   *
   * Accounting, for every catalog a walk completed:
   *   `rawRowsSeen == totalDiscovered + skippedIdentityRows + duplicateRows`.
   *
   * `totalDiscovered` (unique usable instruments) is deliberately NOT required to
   * equal `providerCount`: normalization may legitimately keep fewer rows than
   * the provider sent, and the deployed run states exactly that for
   * `/commodities` (31 kept of 32). Completeness is decided on the RAW
   * reconciliation above, never on unique-instrument equality.
   */
  rawRowsSeen?: number;
  skippedIdentityRows?: number;
  duplicateRows?: number;
  failedPage?: number;
  /** Phase 289F — how (and how completely) the rows crossed the boundary. */
  transport?: CatalogTransportReport;
};

/** Roll up per-catalog transport states the same way completeness rolls up. */
export function rollupTransportState(
  parts: readonly DiscoveryTransportState[],
): DiscoveryTransportState {
  if (parts.length === 0) return "failed";
  if (parts.every((part) => part === "failed")) return "failed";
  if (parts.every((part) => part === "complete")) return "complete";
  return "partial";
}

export function rollupCompleteness(
  parts: readonly DiscoveryCompleteness[],
): DiscoveryCompleteness {
  if (parts.length === 0) return "FAILED";
  if (parts.every((part) => part === "FAILED")) return "FAILED";
  if (parts.every((part) => part === "COMPLETE")) return "COMPLETE";
  return "PARTIAL";
}
