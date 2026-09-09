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
import { discoverOkxInstruments as discoverOkxInstrumentsPure } from "../lib/data/universal/okx-discovery";
import { acquireProviderNativeLiveData, acquireBatchProviderNativeLiveData } from "../lib/market-radar/provider-registry";
import {
  buildExecutionData,
  parseOkxOrderBook,
  type ExecutionData,
} from "../lib/execution-quality";

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

/**
 * Phase 7E — OKX public order-book snapshot for crypto execution quality.
 * Endpoint verified live (no API key): /api/v5/market/books?instId=…&sz=50
 * Parsing/regime/freshness use the SHARED pure layer
 * (lib/execution-quality.ts) — identical to any client-side path.
 * Freshness is based on the EXCHANGE timestamp, never on fetch time.
 */
export const fetchOkxOrderBook = action({
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
      const res = await fetch(
        `https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=50`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        return { success: false as const, error: `OKX order book returned HTTP ${res.status}.` };
      }
      const json: unknown = await res.json().catch(() => undefined);
      if (json === undefined) {
        return { success: false as const, error: "OKX returned malformed JSON." };
      }
      const parsed = parseOkxOrderBook(json);
      const data = buildExecutionData(parsed, Date.now(), Date.now());
      return { success: data.available as boolean, data } as { success: boolean; data: ExecutionData };
    } catch (e) {
      return { success: false as const, error: `network failure: ${String(e).slice(0, 120)}` };
    }
  },
});


/**
 * Phase 150 — OKX public universal instrument discovery.
 * Metadata only; no API key, prices, direction, or recommendations.
 */
export const discoverOkxInstruments = action({
  args: {},
  handler: async (_ctx) => {
    return discoverOkxInstrumentsPure(
      (url) => fetch(url, { headers: { Accept: "application/json" } }),
    );
  },
});


/**
 * Phase 156 — Batch acquisition for discovered OKX instruments.
 *
 * The discovery list is provider-native metadata; only successful OHLCV
 * acquisition becomes live evidence.
 */
export const acquireOkxNativeLiveDataBatch = action({
  args: {
    instruments: v.array(
      v.object({
        instrument: v.string(),
        providerInstrumentId: v.string(),
        assetClass: v.literal("crypto"),
      }),
    ),
    concurrency: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    return acquireBatchProviderNativeLiveData(
      args.instruments.map((input) => ({
        ...input,
        provider: "okx",
        assetClass: input.assetClass,
      })),
      undefined,
      Math.max(1, Math.min(Math.floor(args.concurrency ?? 5), 10)),
    );
  },
});


/**
 * Phase 156 — OKX provider-native live OHLCV acquisition.
 * Uses the exact discovered OKX instrument ID.
 * Discovery metadata is never treated as price/live evidence.
 */
export const acquireOkxNativeLiveData = action({
  args: {
    instrument: v.string(),
    providerInstrumentId: v.string(),
    assetClass: v.literal("crypto"),
  },
  handler: async (_ctx, args) => {
    return acquireProviderNativeLiveData(
      {
        instrument: args.instrument,
        provider: "okx",
        providerInstrumentId: args.providerInstrumentId,
        assetClass: args.assetClass,
      },
      undefined,
    );
  },
});
