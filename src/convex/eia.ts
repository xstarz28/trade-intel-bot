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
 * Without a key this returns an explicit unavailable state — no placeholder,
 * no fabricated data.
 */
"use node";

import { action } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";
import { v } from "convex/values";
import { buildEiaContext, parseEiaResponse } from "../lib/data/eia";

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
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Phase 177 — HTTP deadline; three legs share the 10s eia budget.
      signal: AbortSignal.timeout(8_000),
    });
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

export const fetchEiaInventory = action({
  args: {},
  handler: async (actionCtx) => {
    // Requires a signed-in identity: this action spends a server-side API key.
    await requireIdentity(actionCtx);

    const now = Date.now();
    const apiKey = process.env.EIA_API_KEY;
    if (!apiKey) {
      return {
        success: false as const,
        error:
          "EIA_API_KEY is missing. Add it in the Keys/API keys tab to enable actual WPSR inventory data.",
      };
    }

    const legs = await Promise.all(PRODUCT_IDS.map((p) => fetchProductLeg(p, apiKey)));
    const ctx = buildEiaContext(legs, now, now);
    if (!ctx.available) {
      return { success: false as const, error: ctx.reason };
    }
    return { success: true as const, data: ctx };
  },
});
