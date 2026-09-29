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

/** Rows handed to one staging mutation. Bounded write, provider order kept. */
export const STAGE_WRITE_BATCH_ROWS = 256;

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
