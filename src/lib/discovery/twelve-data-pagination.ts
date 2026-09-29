/**
 * Twelve Data reference-catalog pagination.
 *
 * Documented continuation (twelvedata.com/docs asset catalogs):
 *   query  `page` (integer, default 1)
 *   body   `count` (total matching rows) + `data` (page rows)
 *
 * Page 1 is requested WITHOUT `page` so a provider that still returns the
 * full dump in one response keeps doing so. Further pages are requested
 * only when `count` is a finite number greater than rows already collected.
 * Missing `count` is the historical complete-dump contract — COMPLETE,
 * never guessed-as-truncated.
 *
 * Offsets are never invented. `page` is the documented cursor.
 *
 * Phase 289C — MEMORY. The deployed discovery action runs under Convex's 512 MB
 * Node.js action limit and was killed by it: every catalog's raw rows were
 * retained until the whole discovery finished. Callers may now pass `onRows`,
 * which delivers each page's rows as they arrive and keeps only a `Set` of the
 * seen symbols here. The raw provider pages are then released page-by-page
 * instead of accumulating, and `rows` comes back empty because the caller
 * already consumed them. Every other contract — completeness, `pagesFetched`,
 * `failedPage`, warnings, provider order, the first-occurrence dedupe rule — is
 * identical with and without the sink.
 *
 * Phase 289E — THE PROVIDER DOES NOT PAGINATE THESE CATALOGS.
 *
 * Probed against the live endpoint: `?page=2` returns the SAME complete catalog
 * as page 1 for `/stocks`, `/forex_pairs` and `/commodities`, and `count` always
 * equals the rows in that one response. So page 1 IS the whole catalog — for
 * `/stocks` about 124k rows / 30 MB — and no cursor value can shrink it. The
 * remaining lever is not how many pages are requested but how a single response
 * is READ: when the transport exposes the raw body (`body`), the page is scanned
 * row-by-row and each row is handed to the sink as it completes, so the body text
 * and the full parsed array are never resident at the same time. Without a body
 * stream the buffered `json` path is used unchanged (tests, other callers), and
 * every semantic above is identical on both paths.
 */

import type { DiscoveryCompleteness } from "./completeness";
import { redactDiagnosticText } from "../data/provenance-diagnostics";
import { scanTwelveDataCatalogRows } from "./twelve-data-stream";

export type FetchJson = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json?: unknown;
  /**
   * Phase 289E — the raw response body, when the transport can expose it.
   * Preferred over `json`: it lets a catalog be consumed row-by-row instead of
   * materializing the whole payload. Optional — the buffered `json` path stays
   * the contract for every caller that cannot stream.
   */
  body?: AsyncIterable<Uint8Array | string>;
}>;

const BASE_URL = "https://api.twelvedata.com";

/** Longest provider message kept in a catalog warning. */
const CATALOG_DETAIL_MAX_CHARS = 240;

/**
 * Phase 288 — the provider's own explanation of a rejected catalog page.
 *
 * Twelve Data answers a plan/credit/quota rejection with an HTTP status AND an
 * error body (`{status:"error", code:…, message:…}`). Reporting only the status
 * made a `429`/`403` indistinguishable from a truncated dump, so the caller
 * (and the runtime smoke) could not say why an asset class discovered nothing.
 * The message is credential-redacted and bounded here; nothing is invented when
 * the body is absent or unreadable, and the status code is always kept too.
 */
export function catalogFailureDetail(status: number, json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const record = json as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (message === "") return undefined;
  const credSafe = redactDiagnosticText(message).replace(/\s+/g, " ");
  const bounded =
    credSafe.length > CATALOG_DETAIL_MAX_CHARS
      ? `${credSafe.slice(0, CATALOG_DETAIL_MAX_CHARS - 1)}\u2026`
      : credSafe;
  const code =
    typeof record.code === "number" || (typeof record.code === "string" && record.code.trim() !== "")
      ? `code ${String(record.code)}`
      : `HTTP ${status}`;
  return `${code} — ${bounded}`;
}

export type CatalogPageParse =
  | { ok: true; rows: unknown[]; totalCount?: number }
  | { ok: false; error: string };

export type CatalogPagesResult = {
  /**
   * The catalog's rows. Empty when a row sink was supplied: the rows were
   * delivered as they arrived and are deliberately NOT retained.
   */
  rows: unknown[];
  pagesFetched: number;
  completeness: DiscoveryCompleteness;
  totalCount?: number;
  warnings: string[];
  failedPage?: number;
};

export function twelveDataCatalogUrl(
  path: string,
  apiKey: string,
  page: number,
): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (apiKey) url.searchParams.set("apikey", apiKey);
  // Page 1 omits the param so an unpaginated dump stays unpaginated.
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function readCount(json: Record<string, unknown>): number | undefined {
  const raw = json.count;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function rowSymbol(row: unknown): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const symbol = (row as { symbol?: unknown }).symbol;
  return typeof symbol === "string" && symbol.trim() ? symbol.trim() : undefined;
}

export function parseTwelveDataCatalogPage(json: unknown): CatalogPageParse {
  if (!json || typeof json !== "object") {
    return { ok: false, error: "catalog payload is not an object" };
  }
  const record = json as Record<string, unknown>;
  if (record.status === "error") {
    const message =
      typeof record.message === "string" && record.message.trim()
        ? record.message
        : "provider returned a catalog error";
    return { ok: false, error: message };
  }
  if (!Array.isArray(record.data)) {
    return { ok: false, error: "catalog returned no instrument array" };
  }
  const totalCount = readCount(record);
  return {
    ok: true,
    rows: record.data,
    ...(totalCount !== undefined ? { totalCount } : {}),
  };
}

/**
 * Continue only when the provider itself reported a total larger than
 * what we have collected. A missing count is a complete dump.
 */
export function catalogHasMorePages(args: {
  rowsThisPage: number;
  uniqueAccumulated: number;
  totalCount?: number;
  newUniqueThisPage: number;
}): boolean {
  if (args.rowsThisPage === 0) return false;
  if (args.newUniqueThisPage === 0) return false;
  if (args.totalCount === undefined) return false;
  return args.uniqueAccumulated < args.totalCount;
}

/**
 * Phase 289E — ONE row consumer for both sources.
 *
 * Dedupe, provider order, skipped-identity counting and the "first occurrence
 * wins" rule live here so the streamed and buffered paths cannot drift apart.
 * In streaming mode an identity that survives is emitted immediately instead of
 * being collected into a page-sized array.
 */
function rowConsumer(args: {
  streaming: boolean;
  bySymbol: Map<string, unknown> | null;
  seenSymbols: Set<string> | null;
  unidentified: unknown[];
  emit: (row: unknown) => void;
}) {
  const counts = { rowsSeen: 0, newUnique: 0 };
  const consume = (row: unknown) => {
    counts.rowsSeen += 1;
    const symbol = rowSymbol(row);
    if (!symbol) {
      // A row with no symbol is not deduplicated — it is delivered and the
      // caller counts it as a skipped identity, exactly as before.
      if (args.streaming) args.emit(row);
      else args.unidentified.push(row);
      return;
    }
    if (args.streaming) {
      if (args.seenSymbols!.has(symbol)) return;
      args.seenSymbols!.add(symbol);
      counts.newUnique += 1;
      args.emit(row);
      return;
    }
    if (!args.bySymbol!.has(symbol)) {
      args.bySymbol!.set(symbol, row);
      counts.newUnique += 1;
    }
  };
  return { consume, counts };
}

/**
 * Phase 289E — how many rows are handed to the sink at a time on the streaming
 * path. Small enough that a single response (the provider ignores `page`, so the
 * whole catalog arrives at once) never becomes a retained array, large enough
 * that the sink is not called once per row.
 */
export const STREAM_BATCH_ROWS = 512;

export async function fetchTwelveDataCatalogPages(
  fetchJson: FetchJson,
  args: {
    path: string;
    apiKey: string;
    onRows?: (rows: unknown[]) => void;
    /**
     * Phase 289F — backpressure for a sink that PERSISTS rows.
     *
     * `onRows` is synchronous because it is called from inside the row scanner,
     * so a sink that must await (a database write, say) queues bounded batches
     * there and hands this hook the drain. It is awaited between transport
     * chunks and after a buffered page, so the queue never grows past one
     * transport chunk while the scanner's row-by-row contract stays intact.
     *
     * Phase 289G — `rowsPerDrain` bounds the queue INDEPENDENTLY of the
     * transport: the scanner pauses itself after that many rows and awaits the
     * same drain, so a single oversized chunk can no longer accumulate the whole
     * catalog. The bound belongs to the caller that owns the queue.
     */
    drain?: () => Promise<void>;
    /** Rows the scanner may deliver before pausing for `drain`. */
    rowsPerDrain?: number;
  },
): Promise<CatalogPagesResult> {
  const warnings: string[] = [];
  const streaming = typeof args.onRows === "function";
  // Streaming mode keeps ONLY identities (short strings) resident; buffered mode
  // keeps the raw rows, which is what callers that inspect them expect.
  const bySymbol = streaming ? null : new Map<string, unknown>();
  const seenSymbols = streaming ? new Set<string>() : null;
  const unidentified: unknown[] = [];
  let pagesFetched = 0;
  let totalCount: number | undefined;
  let page = 1;

  const uniqueIdentities = (): number => (streaming ? seenSymbols!.size : bySymbol!.size);
  const collected = (): unknown[] =>
    streaming ? [] : [...bySymbol!.values(), ...unidentified];

  while (true) {
    const url = twelveDataCatalogUrl(args.path, args.apiKey, page);
    let res: Awaited<ReturnType<FetchJson>>;
    try {
      res = await fetchJson(url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "network failure";
      if (pagesFetched === 0) {
        return {
          rows: [],
          pagesFetched: 0,
          completeness: "FAILED",
          warnings: [`${args.path} discovery failed: ${reason}.`],
        };
      }
      warnings.push(`${args.path} page ${page} failed: ${reason}.`);
      return {
        rows: collected(),
        pagesFetched,
        completeness: "PARTIAL",
        ...(totalCount !== undefined ? { totalCount } : {}),
        warnings,
        failedPage: page,
      };
    }

    if (!res.ok) {
      // Phase 288 — a bare status code cannot distinguish a plan/credit
      // rejection from a transport failure, and this warning is the ONLY
      // surviving record of a failed catalog (the smoke reads it to explain
      // why an asset class discovered nothing). Twelve Data answers a
      // rejection with an error body; its own message is kept, credential-
      // redacted and bounded, and the status code stays verbatim.
      const providerDetail = catalogFailureDetail(res.status, res.json);
      if (pagesFetched === 0) {
        return {
          rows: [],
          pagesFetched: 0,
          completeness: "FAILED",
          warnings: [`${args.path} returned HTTP ${res.status}${providerDetail ? `: ${providerDetail}` : ""}.`],
        };
      }
      warnings.push(
        `${args.path} page ${page} returned HTTP ${res.status}${providerDetail ? `: ${providerDetail}` : ""}.`,
      );
      return {
        rows: collected(),
        pagesFetched,
        completeness: "PARTIAL",
        ...(totalCount !== undefined ? { totalCount } : {}),
        warnings,
        failedPage: page,
      };
    }

    // Phase 289E — batching. On the streaming path rows are handed to the sink
    // as they arrive, in bounded batches, so neither the body text NOR a
    // page-sized array of raw rows is ever resident. On the buffered path the
    // sink does not exist and rows are collected exactly as before.
    const batch: unknown[] = [];
    let deliveredRows = 0;
    const flush = () => {
      if (batch.length === 0) return;
      const rows = batch.splice(0, batch.length);
      deliveredRows += rows.length;
      if (streaming) args.onRows!(rows);
    };

    const consumer = rowConsumer({
      streaming,
      bySymbol,
      seenSymbols,
      unidentified,
      emit: (row) => {
        if (!streaming) return;
        batch.push(row);
        if (batch.length >= STREAM_BATCH_ROWS) flush();
      },
    });

    let rowsThisPage: number;
    let pageTotalCount: number | undefined;

    if (res.body) {
      const scan = await scanTwelveDataCatalogRows(
        res.body,
        consumer.consume,
        args.drain
          ? {
              onChunk: args.drain,
              onPause: args.drain,
              ...(args.rowsPerDrain !== undefined ? { rowsPerPause: args.rowsPerDrain } : {}),
            }
          : {},
      );
      flush();
      if (args.drain) await args.drain();
      if (!scan.ok) {
        if (pagesFetched === 0 && deliveredRows === 0) {
          return {
            rows: [],
            pagesFetched: 0,
            completeness: "FAILED",
            warnings: [`${args.path} ${scan.error}.`],
          };
        }
        // Rows genuinely arrived before the failure: they are kept and the
        // catalog is PARTIAL. A short read is never reported as COMPLETE.
        warnings.push(`${args.path} page ${page} ${scan.error}.`);
        return {
          rows: collected(),
          pagesFetched,
          completeness: "PARTIAL",
          ...(totalCount !== undefined ? { totalCount } : {}),
          warnings,
          failedPage: page,
        };
      }
      rowsThisPage = scan.rowsSeen;
      pageTotalCount = scan.totalCount;
    } else {
      const parsed = parseTwelveDataCatalogPage(res.json);
      if (!parsed.ok) {
        if (pagesFetched === 0) {
          return {
            rows: [],
            pagesFetched: 0,
            completeness: "FAILED",
            warnings: [`${args.path} ${parsed.error}.`],
          };
        }
        warnings.push(`${args.path} page ${page} ${parsed.error}.`);
        return {
          rows: collected(),
          pagesFetched,
          completeness: "PARTIAL",
          ...(totalCount !== undefined ? { totalCount } : {}),
          warnings,
          failedPage: page,
        };
      }
      for (const row of parsed.rows) consumer.consume(row);
      // A sink may be attached even when this page came from `json` (a caller
      // that could not stream): hand it over in batches too, exactly once.
      flush();
      if (args.drain) await args.drain();
      rowsThisPage = parsed.rows.length;
      pageTotalCount = parsed.totalCount;
    }

    pagesFetched += 1;
    if (pageTotalCount !== undefined) totalCount = pageTotalCount;

    if (
      !catalogHasMorePages({
        rowsThisPage,
        uniqueAccumulated: uniqueIdentities(),
        totalCount,
        newUniqueThisPage: consumer.counts.newUnique,
      })
    ) {
      if (
        totalCount !== undefined &&
        uniqueIdentities() < totalCount &&
        (rowsThisPage === 0 || consumer.counts.newUnique === 0)
      ) {
        warnings.push(
          `${args.path} stopped at page ${page} with ${uniqueIdentities()} identities before provider count ${totalCount}.`,
        );
        return {
          rows: collected(),
          pagesFetched,
          completeness: "PARTIAL",
          totalCount,
          warnings,
          failedPage: page,
        };
      }
      return {
        rows: collected(),
        pagesFetched,
        completeness: "COMPLETE",
        ...(totalCount !== undefined ? { totalCount } : {}),
        warnings,
      };
    }

    page += 1;
  }
}
