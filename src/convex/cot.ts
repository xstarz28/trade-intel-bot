/**
 * Phase 7B-2 — CFTC COT positioning fetch action.
 *
 * Queries the public Socrata dataset (verified live, no API key):
 *   https://publicreporting.cftc.gov/resource/6dca-aqww.json
 * (Legacy Futures-Only report) with an EXACT market-name filter from the
 * verified mapping table in the shared pure module — never guessed names.
 *
 * Failure of any kind surfaces as an explicit unavailable state; the primary
 * analysis is never blocked and no positioning data is ever fabricated.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { buildCotContext, mapInstrumentToCot } from "../lib/data/cot";
import { getProviderCache } from "../lib/data/provider-cache-registry";

const DATASET = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

export const fetchCotPositioning = action({
  args: { instrument: v.string() },
  handler: async (_ctx, args) => {
    const mapping = mapInstrumentToCot(args.instrument);
    if (!mapping) {
      return {
        success: false as const,
        error: `No verified CFTC futures contract mapping for ${args.instrument}.`,
      };
    }
    try {
      // Phase 178c — CFTC publishes ONE report per week (Friday, covering the
      // prior Tuesday). Re-fetching it per analysis cannot produce new
      // information, so the raw rows are cached for 12h.
      //
      // The cache stores the RAW ROWS, not the built context: `buildCotContext`
      // recomputes `freshness` from the report date against the CURRENT clock
      // on every read. A cached report therefore ages honestly
      // (FRESH -> DELAYED -> STALE) with no refetch, and a hit can never make
      // an old report look newly published.
      //
      // Keyed on the CFTC contract, not the caller's symbol: several aliases
      // map to one contract and must share a single entry.
      const evidence = await getProviderCache().fetch<unknown[]>(
        {
          provider: "cftc",
          dataset: "cot",
          instrument: mapping.sourceInstrument,
        },
        async () => {
          const url =
            `${DATASET}?market_and_exchange_names=${encodeURIComponent(mapping.sourceInstrument)}` +
            `&%24order=report_date_as_yyyy_mm_dd%20DESC&%24limit=2`;
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
            // Phase 177 — HTTP deadline below the 8s cftc leg budget.
            signal: AbortSignal.timeout(7_000),
          });
          if (!res.ok) {
            throw new Error(`CFTC endpoint returned HTTP ${res.status}.`);
          }
          const rows: unknown = await res.json();
          if (!Array.isArray(rows)) {
            throw new Error("CFTC endpoint returned a non-array response.");
          }
          return { data: rows as unknown[], observedAt: Date.now() };
        },
      );
      if (!evidence) {
        return { success: false as const, error: "CFTC returned no rows." };
      }
      // Freshness is derived HERE, from the report date and the current time.
      const ctx = buildCotContext(evidence.data, args.instrument, Date.now());
      if (!ctx.available) {
        return { success: false as const, error: ctx.reason };
      }
      return {
        success: true as const,
        data: ctx,
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
      };
    } catch (err) {
      return {
        success: false as const,
        error: `CFTC fetch failed: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },
});
