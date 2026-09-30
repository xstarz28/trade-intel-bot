/**
 * Types for `verify-published-frontend.mjs`.
 *
 * The checker must run under plain `node` (CI, and anyone with a URL and no
 * build) — it is JavaScript for that reason. This declaration is what keeps the
 * test suite honest about what it consumes: the same evaluation function the
 * workflow runs against the live URL is the one these tests exercise.
 */

/** Bounds: a published page is fetched, never crawled. */
export const MAX_ASSETS: number;
export const MAX_ASSET_BYTES: number;
export const DEFAULT_TIMEOUT_MS: number;

export type PublishedAsset = {
  /** Same-origin path the served HTML references (also used as `name`). */
  path: string;
  name?: string;
  /** HTTP status, or null when the fetch itself failed. */
  status: number | null;
  text: string;
};

export type PublishedCheck = { name: string; ok: boolean; detail: string };

export type PublishedFrontendInput = {
  url: string;
  buildInfoText: string | null;
  buildInfoStatus: number | null;
  indexHtml: string | null;
  indexPath?: string | null;
  buildRouteHtml: string | null;
  buildRouteStatus: number | null;
  assets: PublishedAsset[];
  expected?: {
    commit?: string | null;
    branch?: string | null;
    /** sha256 of the provenance file that passed `verify:frontend`. */
    buildInfoSha256?: string | null;
    /** Content-hashed entry bundle names the verified `dist/index.html` references. */
    assetNames?: string[] | null;
  };
};

export type PublishedFrontendResult = {
  url: string;
  ok: boolean;
  checks: PublishedCheck[];
  /** The provenance the URL actually served, when it could be parsed. */
  observed: Record<string, unknown> | null;
};

/**
 * The artifact contract applied to what the network returned, plus the checks
 * that only exist for a live URL (the `/build` route, the asset files the page
 * actually loads, byte-identity with the verified artifact).
 */
export function evaluatePublishedFrontend(input: PublishedFrontendInput): PublishedFrontendResult;

/** Same-origin `.js`/`.css` paths the served HTML references, bounded. */
export function advertisedAssets(html: string, origin: string): string[];

export function formatPublishedReport(result: PublishedFrontendResult): string;
