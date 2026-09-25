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
 *
 * Phase 280 — the query asks for COT_HISTORY_ROWS weekly reports instead of
 * the latest two. The latest two still drive the report-to-report change read
 * (unchanged); the older reports let the fundamental layer place the current
 * net position in the provider's own one-year distribution (percentile /
 * extreme-positioning context) instead of guessing from a single change.
 *
 * Phase 230 — single-leg failure semantics via the shared leg taxonomy
 * (lib/legOutcome.ts): HTTP 429 -> RATE_LIMIT, 401/403 -> AUTH_ERROR,
 * other non-2xx -> provider_error, non-JSON / non-array body -> malformed,
 * timeout/server-unreachable -> timeout / network. Every failure class
 * throws out of the cache fetcher (nothing cached, Phase 178b); the
 * action-level catch returns an explicitly classified envelope. An
 * answered-but-empty row set keeps the existing "no usable reports"
 * contract (§227: a valid answer is not an outage).
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { buildCotContext, mapInstrumentToCot } from "../lib/data/cot";
import { getProviderCache } from "../lib/data/provider-cache-registry";
import { errorMessage } from "./lib/json";
import { ProviderHttpError, ProviderMalformedError, classifyLegError } from "./lib/legOutcome";

const DATASET = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

/**
 * Weekly reports requested: one year plus the two release rows. The pure
 * module caps what it keeps (`COT_MAX_HISTORY`) and degrades honestly when the
 * provider returns fewer rows than a percentile needs.
 */
const COT_HISTORY_ROWS = 54;

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
            `&%24order=report_date_as_yyyy_mm_dd%20DESC&%24limit=${COT_HISTORY_ROWS}`;
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
            // Phase 177 — HTTP deadline below the 8s cftc leg budget.
            signal: AbortSignal.timeout(7_000),
          });
          // Phase 230 — shared leg taxonomy. 429/401/403 are FATAL classes:
          // they must reach the action-level catch as an explicit envelope,
          // not be flattened into a generic HTTP error. Every class here
          // throws, so nothing is ever cached for a failed acquisition.
          if (res.status === 429) throw new Error(`RATE_LIMIT: HTTP 429 ${res.statusText}`);
          if (res.status === 401 || res.status === 403) {
            throw new Error(`AUTH_ERROR: HTTP ${res.status} ${res.statusText}`);
          }
          if (!res.ok) throw new ProviderHttpError("CFTC", res.status, res.statusText);
          let rows: unknown;
          try {
            rows = await res.json();
          } catch {
            throw new ProviderMalformedError("CFTC endpoint returned a non-JSON body.");
          }
          if (!Array.isArray(rows)) {
            throw new ProviderMalformedError("CFTC endpoint returned a non-array response.");
          }
          return { data: rows as unknown[], observedAt: Date.now() };
        },
      );
      if (!evidence) {
        return { success: false as const, error: "CFTC returned no rows." };
      }
      // Phase 238 — acquisition instant for `fetchedAt`, read-time instant for
      // the freshness evaluation. Two events, one clock read each.
      const ctx = buildCotContext(evidence.data, args.instrument, evidence.observedAt, Date.now());
      if (!ctx.available) {
        return { success: false as const, error: ctx.reason };
      }
      return {
        success: true as const,
        data: ctx,
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
      };
    } catch (err: unknown) {
      // Phase 230 — preserve the fetcher's classification: a 429 read as a
      // generic outage would hide the rate-limit signal Phase 177's budget
      // needs, and Convex only surfaces explicitly returned envelopes.
      const msg = errorMessage(err) || "unknown error";
      if (msg.startsWith("RATE_LIMIT")) {
        return {
          success: false as const,
          error: "CFTC rate limit exceeded (HTTP 429).",
          errorCode: "RATE_LIMIT" as const,
        };
      }
      if (msg.startsWith("AUTH_ERROR")) {
        return {
          success: false as const,
          error: `CFTC access rejected (${msg}).`,
          errorCode: "AUTH_ERROR" as const,
        };
      }
      const cls = classifyLegError(err);
      return {
        success: false as const,
        error: `CFTC request failed: ${cls.status} (${msg})`,
        errorCode: "API_UNAVAILABLE" as const,
      };
    }
  },
});
