/**
 * Phase 7B-1 — US Treasury yield & real-yield fetch action.
 *
 * Fetches the public home.treasury.gov XML feeds (no API key):
 *   nominal : data=daily_treasury_yield_curve       (d:BC_* fields)
 *   real    : data=daily_treasury_real_yield_curve  (d:TC_* fields)
 *
 * Current + previous month are fetched per feed so the latest observation
 * is correct even at the start of a month. Every leg is independent:
 * one failing leg never corrupts the others. Parsing/derivation uses the
 * SHARED pure module (src/lib/data/treasury.ts) — no duplicate logic.
 *
 * This action NEVER fabricates data: any failure surfaces as an explicit
 * unavailable state with a reason.
 *
 * Phase 230 — single-leg failure semantics via the shared leg taxonomy
 * (lib/legOutcome.ts). Before this phase `fetchFeed` ended in a bare
 * `catch { return undefined }` with NO 429/401/403 classification:
 *  - a 429/401/403 became a silent absent leg — and if all four legs were
 *    rejected the action reported an ordinary "no yield curve" miss instead
 *    of RATE_LIMIT / AUTH_ERROR;
 *  - a timeout/network/5xx leg failure was indistinguishable from "the
 *    Treasury has not published this month yet" (a legitimately empty feed).
 * Now: fatal classes propagate out of the cache fetcher (nothing cached,
 * Phase 178b) and reach the caller as an explicit envelope; non-fatal leg
 * failures are classified per leg onto the cached payload's `error` field
 * (survives a cache hit); an outage on ALL four legs is API_UNAVAILABLE,
 * never a "no data" miss.
 */
"use node";

import { action } from "./_generated/server";
import { buildTreasuryContext } from "../lib/data/treasury";
import { getProviderCache } from "../lib/data/provider-cache-registry";
import { errorMessage } from "./lib/json";
import {
  isFatalLegError,
  ProviderHttpError,
  runLeg,
  summarizeLegFailures,
  type LegOutcome,
} from "./lib/legOutcome";

const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * One XML feed leg. Throws on failure; returns undefined only when the
 * provider LEGITIMATELY answered with an empty feed (no <entry>), which is
 * the ordinary state for a month partition with no publications yet.
 */
async function fetchFeed(data: string, yyyymm: string): Promise<string | undefined> {
  const res = await fetch(`${BASE}?data=${data}&field_tdr_date_value_month=${yyyymm}`, {
    // Phase 177 — HTTP deadline; four legs share the 10s treasury budget.
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "text/xml" },
  });
  // Phase 230 — 429/401/403 are FATAL classes (shared taxonomy): they must
  // propagate, never collapse into an absent leg.
  if (res.status === 429) throw new Error(`RATE_LIMIT: HTTP 429 ${res.statusText}`);
  if (res.status === 401 || res.status === 403) throw new Error(`AUTH_ERROR: HTTP ${res.status} ${res.statusText}`);
  // Any other non-2xx is a provider fault on THIS leg — classified, not silent.
  if (!res.ok) throw new ProviderHttpError("US Treasury", res.status, res.statusText);
  const text = await res.text();
  return text.includes("<entry>") ? text : undefined;
}

/** Raw feeds plus any non-fatal per-leg failure metadata. */
interface TreasuryLegsPayload {
  legs: (string | undefined)[];
  /** "nominalCurrent: timeout (…); …" — absent when no leg failed. */
  error?: string;
}

export const fetchTreasuryYields = action({
  args: {},
  handler: async (_ctx) => {
    const now = new Date();
    const thisMonth = monthKey(now);
    const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevMonth = monthKey(lastMonthDate);

    // Phase 178c — the Treasury publishes the yield curve ONCE per business
    // day, so re-fetching four XML feeds on every analysis cannot yield new
    // information. Cached for 6h, keyed on the two month-partitions actually
    // requested (the URL dimensions), so a month rollover is a new key.
    //
    // The RAW FEED PAYLOADS are cached, not the built context:
    // `buildTreasuryContext` recomputes freshness from the observation date
    // against the current clock on every read, so a cached curve ages
    // honestly and a hit never makes an old observation look new.
    try {
      const evidence = await getProviderCache().fetch<TreasuryLegsPayload>(
        {
          provider: "us-treasury",
          dataset: "treasury",
          qualifier: `${thisMonth},${prevMonth}`,
        },
        async () => {
          // Phase 230 — four independent legs, each settled to a classified
          // LegOutcome; only the FATAL classes reject the promise.
          const settled = await Promise.allSettled([
            runLeg(() => fetchFeed("daily_treasury_yield_curve", thisMonth)),
            runLeg(() => fetchFeed("daily_treasury_yield_curve", prevMonth)),
            runLeg(() => fetchFeed("daily_treasury_real_yield_curve", thisMonth)),
            runLeg(() => fetchFeed("daily_treasury_real_yield_curve", prevMonth)),
          ]);

          // Phase 178b — a fatal failure must THROW out of the cache
          // fetcher. Returning an error envelope here would let
          // `ProviderCache` store a 429 as if it were evidence. Throwing
          // leaves the cache untouched; the action-level catch below turns
          // it back into the error envelope (Convex re-wraps thrown errors,
          // so the classification can only survive as envelope text).
          for (const result of settled) {
            if (result.status !== "rejected") continue;
            const msg = errorMessage(result.reason);
            if (isFatalLegError(result.reason)) {
              if (msg.startsWith("RATE_LIMIT")) {
                throw new Error("RATE_LIMIT: US Treasury rate limit exceeded.");
              }
              throw new Error("AUTH_ERROR: US Treasury access rejected (HTTP 401/403).");
            }
            // runLeg only rejects for fatal classes; anything else rejecting
            // here is unexpected — fail loudly rather than drop a leg.
            throw new Error(msg || "unknown error");
          }

          const legs = {
            nominalCurrent: (settled[0] as PromiseFulfilledResult<LegOutcome<string>>).value,
            nominalPrevious: (settled[1] as PromiseFulfilledResult<LegOutcome<string>>).value,
            realCurrent: (settled[2] as PromiseFulfilledResult<LegOutcome<string>>).value,
            realPrevious: (settled[3] as PromiseFulfilledResult<LegOutcome<string>>).value,
          };
          const legFailures = summarizeLegFailures(legs);

          // If EVERY leg failed for a transport/provider reason, that is a
          // provider outage, not "the Treasury has published nothing": throw
          // so the action reports API_UNAVAILABLE and nothing is cached.
          const answered = Object.values(legs).some(
            (l) => l.status === "ok" || l.status === "unavailable",
          );
          if (!answered) {
            throw new Error(`every leg failed (${legFailures})`);
          }

          const rawLegs = [
            legs.nominalCurrent,
            legs.nominalPrevious,
            legs.realCurrent,
            legs.realPrevious,
          ].map((l) => (l.status === "ok" ? l.value : undefined));

          // Every leg failed: acquire nothing rather than cache an empty
          // curve. An all-`unavailable` wave (provider answered every feed
          // with an empty body) is the legitimate "no publications yet".
          if (rawLegs.every((l) => l === undefined)) return null;

          // Phase 230 — non-fatal leg failures ride the cached payload on
          // `error` (a spare legs slot stays undefined), so a cache hit
          // replays the true acquisition record instead of laundering a
          // failed leg into "no observations that month".
          return {
            data: {
              legs: rawLegs,
              ...(legFailures ? { error: legFailures } : {}),
            },
            observedAt: Date.now(),
          };
        },
      );
      if (!evidence) {
        return {
          success: false as const,
          error: "Treasury feeds unavailable — no yield curve could be acquired.",
          errorCode: "NO_DATA" as const,
        };
      }
      const [nomThis, nomPrev, realThis, realPrev] = evidence.data.legs;

      // Phase 238 — the acquisition instant, not a fresh clock read: see the
      // builder's contract. Freshness is still judged at read time (one read).
      const ctx = buildTreasuryContext(
        [nomThis, nomPrev],
        [realThis, realPrev],
        evidence.observedAt,
        Date.now(),
      );
      if (!ctx.available) {
        return { success: false as const, error: ctx.reason };
      }
      return {
        success: true as const,
        data: ctx,
        // Phase 230 — per-leg failure metadata on the pre-existing contract:
        // `error` is additive on a success envelope and is consumed verbatim
        // by the protected fan-out (it never reclassifies a success).
        ...(evidence.data.error ? { error: evidence.data.error } : {}),
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
      };
    } catch (err: unknown) {
      // Preserve the fetcher's classification; Convex envelopes only carry
      // what is explicitly returned, so the fatal classes must land here.
      const msg = errorMessage(err) || "unknown error";
      if (msg.startsWith("RATE_LIMIT")) {
        return {
          success: false as const,
          error: "US Treasury rate limit exceeded (HTTP 429).",
          errorCode: "RATE_LIMIT" as const,
        };
      }
      if (msg.startsWith("AUTH_ERROR")) {
        return {
          success: false as const,
          error: "US Treasury access rejected (HTTP 401/403).",
          errorCode: "AUTH_ERROR" as const,
        };
      }
      return {
        success: false as const,
        error: `Treasury request failed: ${msg}`,
        errorCode: "API_UNAVAILABLE" as const,
      };
    }
  },
});
