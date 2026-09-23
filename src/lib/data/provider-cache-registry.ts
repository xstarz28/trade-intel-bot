/**
 * Phase 178b — the single authoritative provider cache for the protected
 * analysis path.
 *
 * Phase 178 built `ProviderCache` but left it beside the runtime: the Convex
 * provider actions kept their own `Map`/`getCached`/`setCache` caches, so the
 * provenance guarantees were never actually on the path that
 * `runProtectedAnalysis` executes. That was split cache authority, and it
 * meant the Phase 178 claim ("repeated analyses reduce provider load while
 * preserving freshness") was unproven in production.
 *
 * This module removes the split. Every provider module that previously kept a
 * private cache now goes through ONE shared `ProviderCache` instance obtained
 * here, so identity, TTL, freshness, single-flight and negative-cache
 * semantics cannot disagree between providers.
 *
 * SCOPE — stated honestly:
 *
 *   This registry is a module-level singleton. In Convex that means it is
 *   scoped to a single action instance (one V8 isolate). It deduplicates work
 *   WITHIN that instance, including across concurrent callers on it. It is
 *   NOT distributed: a cold instance re-acquires, and two instances do not
 *   share entries. No global/cross-instance quota reduction is claimed. A
 *   distributed cache would require external coordination (a Convex table or
 *   an external store), which is deliberately out of scope here.
 */

import { ProviderCache } from "./provider-cache";

let registry: ProviderCache | null = null;

/**
 * The authoritative provider cache. All provider evidence on the protected
 * path must flow through this instance.
 */
export function getProviderCache(): ProviderCache {
  if (!registry) registry = new ProviderCache();
  return registry;
}

/** Test seam: reset cache state between cases. */
export function resetProviderCache(): void {
  registry?.clear();
  registry = null;
}
