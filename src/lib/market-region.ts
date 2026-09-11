/**
 * Phase 165 — Region classification from provider metadata.
 *
 * Replaces a hardcoded symbol whitelist in the opportunities UI, which read:
 *
 *   ["BBCA", "BBRI", "TLKM", "BMRI", "BBNI", "GOTO"].includes(instrument)
 *
 * That was a permanent ceiling in disguise. Any IDX equity outside those six
 * names was silently misfiled as "us", so newly discovered Indonesian
 * listings could never appear under the IDX filter no matter how correctly
 * discovery found them.
 *
 * Classification order:
 *   1. Region reported by the PROVIDER during discovery — authoritative.
 *   2. Exchange suffix carried in the instrument id (e.g. ".JK"), which is a
 *      structural convention, not a list of names.
 *   3. Otherwise UNKNOWN. We do NOT guess a default.
 *
 * UNKNOWN is a real answer. An instrument whose region we cannot establish is
 * excluded from a specific region filter rather than being assigned to one.
 */

import type { AssetClass } from "@/lib/data/universal/types";

/** Non-regional asset classes: traded globally rather than on one venue. */
const GLOBAL_ASSET_CLASSES: AssetClass[] = [
  "crypto",
  "forex",
  "commodity",
  "indices",
  "macro",
];

/**
 * Exchange suffix → region. These are venue conventions embedded in the
 * instrument identifier itself, not a curated list of instruments.
 */
const SUFFIX_REGIONS: { suffix: string; region: string }[] = [
  { suffix: ".JK", region: "idx" },
  { suffix: ".AX", region: "asx" },
  { suffix: ".L", region: "lse" },
  { suffix: ".T", region: "tse" },
  { suffix: ".HK", region: "hkex" },
  { suffix: ".SI", region: "sgx" },
  { suffix: ".KS", region: "krx" },
  { suffix: ".SS", region: "sse" },
  { suffix: ".SZ", region: "szse" },
  { suffix: ".NS", region: "nse" },
  { suffix: ".BO", region: "bse" },
  { suffix: ".TO", region: "tsx" },
  { suffix: ".DE", region: "xetra" },
  { suffix: ".PA", region: "euronext" },
  { suffix: ".AS", region: "euronext" },
  { suffix: ".MI", region: "borsa-italiana" },
  { suffix: ".SW", region: "six" },
  { suffix: ".BK", region: "set" },
];

/**
 * Free-text region/country strings that providers report, normalised to the
 * filter keys the UI uses. Matching is substring-based and case-insensitive
 * because providers are inconsistent ("IDX", "Indonesia", "Jakarta").
 */
const REGION_ALIASES: { match: string[]; region: string }[] = [
  { match: ["idx", "indonesia", "jakarta"], region: "idx" },
  {
    match: ["united states", "usa", "nasdaq", "nyse", "us", "amex", "bats"],
    region: "us",
  },
];

export interface RegionClassifiable {
  instrument: string;
  assetClass: AssetClass;
  /** Region reported by the provider, when it reported one. */
  region?: string;
}

/**
 * Determine an instrument's region.
 * Returns "global" for non-regional asset classes, or `undefined` when the
 * region genuinely cannot be established.
 */
export function classifyRegion(item: RegionClassifiable): string | undefined {
  if (GLOBAL_ASSET_CLASSES.includes(item.assetClass)) return "global";

  // 1. Provider-reported region wins.
  const reported = item.region?.trim();
  if (reported) {
    const lower = reported.toLowerCase();
    for (const alias of REGION_ALIASES) {
      if (alias.match.some((m) => lower === m || lower.includes(m))) {
        return alias.region;
      }
    }
    return lower;
  }

  // 2. Exchange suffix in the identifier.
  const upper = item.instrument.toUpperCase();
  for (const { suffix, region } of SUFFIX_REGIONS) {
    if (upper.endsWith(suffix)) return region;
  }

  // 3. Unknown — we do not guess.
  return undefined;
}

/**
 * Whether an instrument matches a UI region filter.
 *
 * `"all"` matches everything. An instrument with an indeterminate region does
 * NOT match a specific filter — it is better to omit it than to file it under
 * a venue it may not belong to.
 */
export function matchesRegionFilter(
  item: RegionClassifiable,
  regionFilter: string,
): boolean {
  if (regionFilter === "all") return true;
  const region = classifyRegion(item);
  if (region === undefined) return false;
  return region === regionFilter;
}
