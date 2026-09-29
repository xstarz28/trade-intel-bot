/**
 * Phase 289F — the Convex function return/argument boundary.
 *
 * THE DEFECT THIS ENCODES
 * -----------------------
 * Phase 289E removed the 512 MB action OOM by reading each catalog as a stream
 * in its own execution. The deployed runtime then failed the NEXT boundary:
 *
 *   `Function marketData.js:discoverTwelveDataCatalog return value invalid:
 *    Array length is too long (143300 > maximum length 8192)`
 *
 * Convex validates every function's arguments AND return value, and no array in
 * that value may exceed 8192 elements. The provider returns the WHOLE `/stocks`
 * catalog in one response (it ignores `page`), so 143300 normalized instruments
 * can never be carried by one function call — and slicing them to 8192 would
 * present a truncated catalog as the universe, which is forbidden.
 *
 * THE RULE
 * --------
 *   - A response may carry at most `DISCOVERY_INLINE_LIMIT` instruments inline.
 *     That ceiling sits BELOW the runtime cap so the surrounding object graph
 *     (per-catalog reports, warnings, transport metadata) never pushes the
 *     return over the limit.
 *   - A catalog that does not fit is persisted in this sandbox-first, indexed
 *     stage (`STAGE_WRITE_BATCH_ROWS` per write, `STAGE_READ_ROWS` per read) and
 *     is read back in provider order, one bounded chunk at a time.
 *   - Nothing is dropped: `totalDiscovered` stays the real provider count.
 *
 * These are SERVER-SIDE boundary constants, not provider limits: they are never
 * sent to the provider and never presented as a provider restriction.
 */

/** Convex's own limit — no array in an argument or return may exceed this. */
export const CONVEX_MAX_ARRAY_LENGTH = 8192;

/**
 * How many instruments one discovery response may carry inline. Two thirds of
 * the runtime cap, leaving room for the reports/warnings around them.
 */
export const DISCOVERY_INLINE_LIMIT = 5461;

/**
 * Phase 289G — ROWS PER STAGING MUTATION. Bounded write, provider order kept.
 *
 * MEASURED, not chosen. The deployed 289F run staged 33,289 of ~124,000 rows
 * before the catalog transport budget expired, which is 130 mutations of the
 * old 256-row batch (256 x 130 = 33,280) — the write path, not the parser, was
 * the throttle. Benchmarked in this repository against the real staging
 * mutation (see `twelve-data-stage-throughput.phase289g.test.ts`):
 *
 *   payload  doc shape        rows/s    ms/mutation
 *   256      1 doc per row     52,719      4.86
 *   1024     1 doc per row     54,005     18.96
 *   1024     4 docs of 256     73,500     13.93
 *   2048     8 docs of 256     68,443     29.92
 *   4096    16 docs of 256     70,015     58.50
 *
 * Throughput plateaus at a 1024-row payload while the payload keeps growing, so
 * 1024 rows per mutation is the measured sweet spot: it cuts the mutation count
 * for the stock catalog from 485 to 122 without an oversized argument (a
 * 1024-row payload is ~0.25 MB, well inside Convex's 1 MiB value limit and its
 * 16 MiB argument limit).
 */
export const STAGE_WRITE_BATCH_ROWS = 1024;

/**
 * Phase 289G — ROWS PER STORED DOCUMENT.
 *
 * Convex charges per DOCUMENT write, and the measured cost of the old one-row-
 * per-document model is what throttled the provider read: 124,000 document
 * writes for `/stocks` versus ~485 chunk writes. A chunk holds an ordered run
 * of rows in the exact same shape, so identity and provider order are preserved
 * row-for-row while the write cost drops by the chunk size. 256 is the measured
 * best (73,500 rows/s vs 66,957 at 1024 rows/doc) and keeps each document around
 * 60 KB — far below the 1 MiB document limit, and small enough that reading one
 * page never loads a large document.
 */
export const STAGE_CHUNK_ROWS = 256;

/**
 * Phase 289G — ROWS RETAINED BETWEEN DRAINS (the real backpressure bound).
 *
 * The staging queue may hold at most this many rows before the row scanner
 * pauses and the queue is persisted, so memory stays bounded no matter how the
 * transport chunks the body: a 30 MB catalog delivered as ONE chunk cannot
 * accumulate the whole universe in the action. 4096 rows is ~1 MB of normalized
 * instruments — bounded, and large enough that the queue never becomes the
 * expensive part of the write path.
 */
export const STAGE_QUEUE_ROWS = 4096;

/**
 * Phase 289G — STAGING WRITES IN FLIGHT AT ONCE.
 *
 * The provider read used to STOP at every transport chunk while the mutation
 * for the previous rows committed (the 289F loop awaited each drain), so the
 * read rate was capped by the write latency. A bounded number of writes may now
 * overlap the read. The bound is what keeps memory finite: at most
 * `concurrency` full batches plus one partial batch are ever retained.
 */
export const STAGE_WRITE_IN_FLIGHT = 3;

/** Rows returned by one stage read. Bounded read, provider order kept. */
export const STAGE_READ_ROWS = 2048;

/** Widest row batch a staging mutation accepts (a defensive server-side cap). */
export const STAGE_WRITE_MAX_ROWS = 1024;

export interface BoundaryViolation {
  /** Dotted path to the offending array. */
  path: string;
  length: number;
}

/**
 * Every array in `value` that exceeds `limit`, in deterministic walk order.
 *
 * Used by tests to prove a synthetic 143300-instrument catalog never crosses the
 * boundary, and by the staging surface to reject an oversized write batch
 * before the runtime has to.
 */
export function arrayBoundViolations(
  value: unknown,
  limit: number = CONVEX_MAX_ARRAY_LENGTH,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      if (node.length > limit) violations.push({ path, length: node.length });
      for (let i = 0; i < node.length; i += 1) walk(node[i], `${path}[${i}]`);
      return;
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, path === "" ? key : `${path}.${key}`);
    }
  };

  walk(value, "");
  return violations;
}

/** TRUE when every array in `value` fits inside the Convex boundary. */
export function fitsConvexReturnBoundary(
  value: unknown,
  limit: number = CONVEX_MAX_ARRAY_LENGTH,
): boolean {
  return arrayBoundViolations(value, limit).length === 0;
}

/** Clamp a caller-supplied inline limit into the legal range. */
export function boundedInlineLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DISCOVERY_INLINE_LIMIT;
  return Math.max(0, Math.min(Math.floor(requested), DISCOVERY_INLINE_LIMIT));
}
