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
 */

import type { DiscoveryCompleteness } from "./completeness";

export type FetchJson = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json?: unknown;
}>;

const BASE_URL = "https://api.twelvedata.com";

export type CatalogPageParse =
  | { ok: true; rows: unknown[]; totalCount?: number }
  | { ok: false; error: string };

export type CatalogPagesResult = {
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
  args: { path: string; apiKey: string },
): Promise<CatalogPagesResult> {
  const warnings: string[] = [];
  const bySymbol = new Map<string, unknown>();
  const unidentified: unknown[] = [];
  let pagesFetched = 0;
  let totalCount: number | undefined;
  let page = 1;

  const collected = (): unknown[] => [...bySymbol.values(), ...unidentified];

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
      if (pagesFetched === 0) {
        return {
          rows: [],
          pagesFetched: 0,
          completeness: "FAILED",
          warnings: [`${args.path} returned HTTP ${res.status}.`],
        };
      }
      warnings.push(`${args.path} page ${page} returned HTTP ${res.status}.`);
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
    for (const row of parsed.rows) {
      const symbol = rowSymbol(row);
      if (!symbol) {
        unidentified.push(row);
        continue;
      }
      if (!bySymbol.has(symbol)) {
        bySymbol.set(symbol, row);
        newUnique += 1;
      }
    }

    if (
      !catalogHasMorePages({
        rowsThisPage: parsed.rows.length,
        uniqueAccumulated: bySymbol.size,
        totalCount,
        newUniqueThisPage: newUnique,
      })
    ) {
      if (
        totalCount !== undefined &&
        bySymbol.size < totalCount &&
        (parsed.rows.length === 0 || newUnique === 0)
      ) {
        warnings.push(
          `${args.path} stopped at page ${page} with ${bySymbol.size} identities before provider count ${totalCount}.`,
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
