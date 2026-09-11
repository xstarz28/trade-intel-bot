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
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { buildTreasuryContext } from "../lib/data/treasury";
import { getProviderCache } from "../lib/data/provider-cache-registry";

const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function fetchFeed(data: string, yyyymm: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${BASE}?data=${data}&field_tdr_date_value_month=${yyyymm}`, {
      // Phase 177 — HTTP deadline; four legs share the 10s treasury budget.
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "text/xml" },
    });
    if (!res.ok) return undefined;
    const text = await res.text();
    return text.includes("<entry>") ? text : undefined;
  } catch {
    return undefined; // network failure → leg absent, context degrades
  }
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
    const evidence = await getProviderCache().fetch<(string | undefined)[]>(
      {
        provider: "us-treasury",
        dataset: "treasury",
        qualifier: `${thisMonth},${prevMonth}`,
      },
      async () => {
        // Four independent legs — allSettled semantics via per-leg try/catch.
        const legs = await Promise.all([
          fetchFeed("daily_treasury_yield_curve", thisMonth),
          fetchFeed("daily_treasury_yield_curve", prevMonth),
          fetchFeed("daily_treasury_real_yield_curve", thisMonth),
          fetchFeed("daily_treasury_real_yield_curve", prevMonth),
        ]);
        // Every leg failed: acquire nothing rather than cache an empty curve.
        if (legs.every((l) => l === undefined)) return null;
        return { data: legs, observedAt: Date.now() };
      },
    );
    if (!evidence) {
      return {
        success: false as const,
        error: "Treasury feeds unavailable — no yield curve could be acquired.",
      };
    }
    const [nomThis, nomPrev, realThis, realPrev] = evidence.data;

    const ctx = buildTreasuryContext([nomThis, nomPrev], [realThis, realPrev], Date.now());
    if (!ctx.available) {
      return { success: false as const, error: ctx.reason };
    }
    return {
      success: true as const,
      data: ctx,
      acquisition: evidence.acquisition,
      observedAt: evidence.observedAt,
    };
  },
});
