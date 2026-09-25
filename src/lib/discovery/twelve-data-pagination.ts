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
 */

import type { DiscoveryCompleteness } from "./completeness";
import { redactDiagnosticText } from "../data/provenance-diagnostics";

export type FetchJson = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json?: unknown;
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

export async function fetchTwelveDataCatalogPages(
  fetchJson: FetchJson,
  args: { path: string; apiKey: string; onRows?: (rows: unknown[]) => void },
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

    pagesFetched += 1;
    if (parsed.totalCount !== undefined) totalCount = parsed.totalCount;

    let newUnique = 0;
    const deliverable: unknown[] = [];
    for (const row of parsed.rows) {
      const symbol = rowSymbol(row);
      if (!symbol) {
        // A row with no symbol is not deduplicated — it is delivered and the
        // caller counts it as a skipped identity, exactly as before.
        if (streaming) deliverable.push(row);
        else unidentified.push(row);
        continue;
      }
      if (streaming) {
        if (seenSymbols!.has(symbol)) continue;
        seenSymbols!.add(symbol);
        newUnique += 1;
        deliverable.push(row);
        continue;
      }
      if (!bySymbol!.has(symbol)) {
        bySymbol!.set(symbol, row);
        newUnique += 1;
      }
    }
    if (streaming && deliverable.length > 0) {
      // Hand the page over. The array (and the rows in it) is a per-iteration
      // local: once the next page is requested, nothing from this page is
      // reachable from here. It is deliberately NOT cleared afterwards — the
      // sink owns what it was given.
      args.onRows!(deliverable);
    }

    if (
      !catalogHasMorePages({
        rowsThisPage: parsed.rows.length,
        uniqueAccumulated: uniqueIdentities(),
        totalCount,
        newUniqueThisPage: newUnique,
      })
    ) {
      if (
        totalCount !== undefined &&
        uniqueIdentities() < totalCount &&
        (parsed.rows.length === 0 || newUnique === 0)
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
