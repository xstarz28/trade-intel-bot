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
import { applyFredYieldFallback, buildTreasuryContext } from "../lib/data/treasury";

const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function fetchFeed(data: string, yyyymm: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${BASE}?data=${data}&field_tdr_date_value_month=${yyyymm}`, {
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

    // Four independent legs — allSettled semantics via per-leg try/catch.
    const [nomThis, nomPrev, realThis, realPrev] = await Promise.all([
      fetchFeed("daily_treasury_yield_curve", thisMonth),
      fetchFeed("daily_treasury_yield_curve", prevMonth),
      fetchFeed("daily_treasury_real_yield_curve", thisMonth),
      fetchFeed("daily_treasury_real_yield_curve", prevMonth),
    ]);

    let ctx = buildTreasuryContext([nomThis, nomPrev], [realThis, realPrev], Date.now());
    // Treasury XML is primary. If its nominal leg fails or its real-yield leg
    // is missing, use official FRED public CSV mirrors (no API key) for DGS2,
    // DGS10 and DFII10. DFII10 is an observed real-yield series, never a
    // nominal-yield estimate or an inflation-derived proxy.
    if (!ctx.available || !ctx.latest.real || !ctx.previous?.real) {
      const start = new Date(Date.now() - 45 * 24 * 60 * 60_000).toISOString().slice(0, 10);
      const end = new Date().toISOString().slice(0, 10);
      const fetchFred = async (series: string): Promise<string | undefined> => {
        try {
          const response = await fetch(
            "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + encodeURIComponent(series) +
              "&cosd=" + start + "&coed=" + end,
            { headers: { accept: "text/csv" }, signal: AbortSignal.timeout(4_000) },
          );
          return response.ok ? await response.text() : undefined;
        } catch {
          return undefined;
        }
      };
      const [dgs2, dgs10, dfii10] = await Promise.all([
        fetchFred("DGS2"),
        fetchFred("DGS10"),
        fetchFred("DFII10"),
      ]);
      ctx = applyFredYieldFallback(ctx, dgs2, dgs10, dfii10, Date.now());
    }
    if (!ctx.available) {
      return { success: false as const, error: ctx.reason + " FRED public-series fallback also returned no usable nominal observations." };
    }
    return { success: true as const, data: ctx };
  },
});
