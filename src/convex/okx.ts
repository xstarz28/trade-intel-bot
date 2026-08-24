/**
 * Phase 7B-3 — OKX public instrument metadata fetch action.
 *
 * Queries the verified live endpoint (no API key):
 *   https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=...
 * The instId is derived ONLY from the literal requested symbol via the
 * shared pure mapping; existence/ambiguity is validated in the pure layer.
 * All failures surface explicitly — no fallback values, no assumptions.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { mapInstrumentToOkx, parseOkxResponse } from "../lib/risk/okx-spec";

const ENDPOINT = "https://www.okx.com/api/v5/public/instruments";

export const fetchOkxInstrumentSpec = action({
  args: { instrument: v.string() },
  handler: async (_ctx, args) => {
    const instId = mapInstrumentToOkx(args.instrument);
    if (!instId) {
      return {
        success: false as const,
        error: `instrument "${args.instrument}" is not shaped like an OKX contract id or BASE/QUOTE pair`,
      };
    }
    try {
      const res = await fetch(`${ENDPOINT}?instType=SWAP&instId=${encodeURIComponent(instId)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        return { success: false as const, error: `OKX endpoint returned HTTP ${res.status}.` };
      }
      const json: unknown = await res.json().catch(() => undefined);
      if (json === undefined) {
        return { success: false as const, error: "OKX returned malformed JSON." };
      }
      const parsed = parseOkxResponse(json);
      return {
        success: true as const,
        data: {
          fetchedAt: Date.now(),
          source: "OKX public instruments" as const,
          freshness: "static" as const,
          instruments: parsed.instruments,
          parseWarnings: parsed.parseWarnings,
        },
      };
    } catch (err) {
      return {
        success: false as const,
        error: `OKX fetch failed: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },
});
