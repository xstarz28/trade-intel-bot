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

const DATASET = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

export const fetchCotPositioning = action({
  args: { instrument: v.string() },
  handler: async (_ctx, args) => {
    const now = Date.now();
    const mapping = mapInstrumentToCot(args.instrument);
    if (!mapping) {
      return {
        success: false as const,
        error: `No verified CFTC futures contract mapping for ${args.instrument}.`,
      };
    }
    try {
      const url =
        `${DATASET}?market_and_exchange_names=${encodeURIComponent(mapping.sourceInstrument)}` +
        `&%24order=report_date_as_yyyy_mm_dd%20DESC&%24limit=2`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        // Phase 177 — HTTP deadline below the 8s cftc leg budget.
        signal: AbortSignal.timeout(7_000),
      });
      if (!res.ok) {
        return { success: false as const, error: `CFTC endpoint returned HTTP ${res.status}.` };
      }
      const rows: unknown = await res.json();
      if (!Array.isArray(rows)) {
        return { success: false as const, error: "CFTC endpoint returned a non-array response." };
      }
      const ctx = buildCotContext(rows, args.instrument, now);
      if (!ctx.available) {
        return { success: false as const, error: ctx.reason };
      }
      return { success: true as const, data: ctx };
    } catch (err) {
      return {
        success: false as const,
        error: `CFTC fetch failed: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },
});
