/**
 * Phase 7D — EIA Weekly Petroleum Status Report inventory fetch action.
 *
 * Route (documented + auth behavior verified live — 403 without key):
 *   GET https://api.eia.gov/v2/petroleum/sto/data/
 *     ?api_key=…&frequency=weekly&data[]=value
 *     &facets[product][]=<PRODUCT>&facets[process][]=STA
 *     &facets[area][]=NUS-Z00&sort[0][column]=period&sort[0][direction]=desc&length=2
 *
 * Three independent product legs (crude EPC0 / gasoline EPM0 / distillate
 * EPD0). A failing leg never corrupts the others; a wrong facet code simply
 * fails its leg with an explicit reason. Parsing/derivation uses the SHARED
 * pure module (src/lib/data/eia.ts) — no duplicate logic.
 *
 * The API key is read from process.env.EIA_API_KEY and NEVER hardcoded.
 * If the key is absent or the EIA API fails completely, use the public FRED
 * mirror of the same EIA-sourced weekly inventory series. No placeholder,
 * interpolation, or fabricated data is allowed.
 */
"use node";

import { action } from "./_generated/server";
import { buildEiaContext, parseEiaResponse, parseFredInventoryCsv } from "../lib/data/eia";

const BASE = "https://api.eia.gov/v2/petroleum/sto/data/";
const PRODUCT_IDS = ["EPC0", "EPM0", "EPD0"] as const;

async function fetchProductLeg(
  productId: string,
  apiKey: string,
): Promise<{ ok: boolean; requestedProductId: string; parsed?: ReturnType<typeof parseEiaResponse>; reason?: string }> {
  try {
    const url =
      `${BASE}?api_key=${encodeURIComponent(apiKey)}` +
      `&frequency=weekly&data%5B0%5D=value` +
      `&facets%5Bproduct%5D%5B%5D=${encodeURIComponent(productId)}` +
      `&facets%5Bprocess%5D%5B%5D=STA&facets%5Barea%5D%5B%5D=NUS-Z00` +
      `&sort%5B0%5D%5Bcolumn%5D=period&sort%5B0%5D%5Bdirection%5D=desc&length=2`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      // Try to surface the provider's own error message when present.
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as Record<string, unknown>;
        if (typeof body.error === "string") detail += `: ${body.error}`;
      } catch {
        /* body not JSON — keep HTTP status only */
      }
      return { ok: false, requestedProductId: productId, reason: detail };
    }
    const json = await res.json();
    return { ok: true, requestedProductId: productId, parsed: parseEiaResponse(json) };
  } catch (e) {
    return { ok: false, requestedProductId: productId, reason: `network failure: ${String(e).slice(0, 120)}` };
  }
}


const FRED_SERIES = [
  { productId: "EPC0", seriesId: "WCESTUS1", productName: "Commercial crude oil stocks excluding SPR" },
  { productId: "EPM0", seriesId: "WGTSTUS1", productName: "Total motor gasoline stocks" },
  { productId: "EPD0", seriesId: "WDISTUS1", productName: "Distillate fuel oil stocks" },
] as const;

async function fetchFredProductLeg(
  item: (typeof FRED_SERIES)[number],
  now: number,
): Promise<{ ok: boolean; requestedProductId: string; parsed?: ReturnType<typeof parseFredInventoryCsv>; reason?: string }> {
  try {
    // Four to five weekly observations are sufficient for a week-over-week
    // change and freshness classification; avoid downloading decades per analysis.
    const endDate = new Date(now).toISOString().slice(0, 10);
    const startDate = new Date(now - 35 * 86_400_000).toISOString().slice(0, 10);
    const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" +
      encodeURIComponent(item.seriesId) + "&cosd=" + startDate + "&coed=" + endDate;
    const res = await fetch(url, {
      headers: { Accept: "text/csv" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!res.ok) return { ok: false, requestedProductId: item.productId, reason: "FRED mirror HTTP " + res.status };
    const csv = await res.text();
    return {
      ok: true,
      requestedProductId: item.productId,
      parsed: parseFredInventoryCsv(csv, item.productId, item.seriesId, item.productName),
    };
  } catch (error) {
    return {
      ok: false,
      requestedProductId: item.productId,
      reason: "FRED mirror network failure: " + (error instanceof Error ? error.message : String(error)).slice(0, 120),
    };
  }
}

async function fetchPublicFredFallback(now: number, eiaFailure?: string) {
  const legs = await Promise.all(FRED_SERIES.map((item) => fetchFredProductLeg(item, now)));
  const ctx = buildEiaContext(
    legs,
    now,
    now,
    "EIA Weekly Petroleum Status Report (public FRED series mirror)",
  );
  if (!ctx.available) {
    return {
      success: false as const,
      error: [eiaFailure, ctx.reason].filter(Boolean).join("; "),
    };
  }
  return { success: true as const, data: ctx };
}

export const fetchEiaInventory = action({
  args: {},
  handler: async () => {
    const now = Date.now();
    const apiKey = process.env.EIA_API_KEY;
    if (!apiKey) {
      return await fetchPublicFredFallback(
        now,
        "EIA_API_KEY is missing; tried the public FRED mirror of EIA weekly inventory series",
      );
    }

    const legs = await Promise.all(PRODUCT_IDS.map((p) => fetchProductLeg(p, apiKey)));
    const ctx = buildEiaContext(legs, now, now);
    if (!ctx.available) {
      return await fetchPublicFredFallback(now, "EIA API unavailable: " + ctx.reason);
    }
    return { success: true as const, data: ctx };
  },
});
