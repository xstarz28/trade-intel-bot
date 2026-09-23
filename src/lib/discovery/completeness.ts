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

export type CatalogFetchReport = {
  path: string;
  assetClass: string;
  completeness: DiscoveryCompleteness;
  pagesFetched: number;
  totalDiscovered: number;
  failedPage?: number;
};

export function rollupCompleteness(
  parts: readonly DiscoveryCompleteness[],
): DiscoveryCompleteness {
  if (parts.length === 0) return "FAILED";
  if (parts.every((part) => part === "FAILED")) return "FAILED";
  if (parts.every((part) => part === "COMPLETE")) return "COMPLETE";
  return "PARTIAL";
}
