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
import { getProviderCache } from "../lib/data/provider-cache-registry";
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
      // Phase 178c — CONTRACT METADATA, not a market observation. ctVal,
      // tickSz and lotSz change only when the exchange relists a contract, so
      // a 24h TTL is safe: unlike the order book, this data has no
      // microsecond-scale truth. It is used for position sizing arithmetic,
      // never as directional evidence or as a price.
      //
      // Keyed on the EXACT provider-native instId — never a generic symbol —
      // so BTC-USDT-SWAP and BTC-USD-SWAP can never share a specification.
      const evidence = await getProviderCache().fetch<{
        instruments: ReturnType<typeof parseOkxResponse>["instruments"];
        parseWarnings: ReturnType<typeof parseOkxResponse>["parseWarnings"];
        acquiredAt: number;
      }>(
        {
          provider: "okx",
          dataset: "instrument-spec",
          instrument: instId,
        },
        async () => {
          const res = await fetch(`${ENDPOINT}?instType=SWAP&instId=${encodeURIComponent(instId)}`, {
            headers: { Accept: "application/json" },
            // Phase 177 — HTTP deadline below the 6s okx-instrument-spec budget.
            signal: AbortSignal.timeout(5_000),
          });
          if (!res.ok) {
            throw new Error(`OKX endpoint returned HTTP ${res.status}.`);
          }
          const json: unknown = await res.json().catch(() => undefined);
          if (json === undefined) {
            throw new Error("OKX returned malformed JSON.");
          }
          const parsed = parseOkxResponse(json);
          const acquiredAt = Date.now();
          return {
            data: {
              instruments: parsed.instruments,
              parseWarnings: parsed.parseWarnings,
              acquiredAt,
            },
            observedAt: acquiredAt,
          };
        },
      );
      if (!evidence) {
        return { success: false as const, error: "OKX returned no instrument specification." };
      }
      return {
        success: true as const,
        data: {
          // The ORIGINAL acquisition time survives a cache hit — it is not
          // rewritten to the moment of reuse.
          fetchedAt: evidence.data.acquiredAt,
          source: "OKX public instruments" as const,
          freshness: "static" as const,
          instruments: evidence.data.instruments,
          parseWarnings: evidence.data.parseWarnings,
        },
        // Phase 178d — reported by the cache, not inferred.
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
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
 *
 * ─────────────────────────────────────────────────────────────────
 * Phase 178c — UNCACHED BY DESIGN. This is a deliberate architecture
 * decision, not an omission. Do not "optimise" it by adding a cache.
 *
 * WHY. The order book is the only protected-path provider whose freshness
 * label is COMPUTED ONCE AND STORED. `buildExecutionData` classifies the
 * snapshot FRESH or STALE against EXECUTION_STALE_MS (30s) at build time and
 * writes that string into the payload. Every other cached provider
 * (Treasury, EIA, COT) stores raw data and RE-DERIVES freshness from the
 * observation date on each read, so a cached entry decays honestly. A cached
 * order book would instead REPLAY a frozen "FRESH" label — proven by
 * measurement: the same snapshot built 60s later classifies STALE, so a hit
 * serving the earlier payload would assert freshness that is no longer true.
 *
 * WHAT THAT WOULD BREAK. This label is not cosmetic. It gates:
 *   - the SCALPING hard veto on extreme spread / THIN depth
 *     (analysis-engine.ts ~1037, `ed.freshness === "FRESH"`)
 *   - the crypto execution confidence layer
 *     (analysis-engine.ts ~1527, same gate)
 *   - slippage estimation, which walks the real book levels
 *   - the "Execution snapshot is stale" user-facing warning
 * A replayed FRESH label could therefore veto a valid setup, or let a stale
 * book contribute confidence, on microstructure that no longer exists.
 *
 * THE BUDGET. Top-of-book depth changes continuously; the engine's own
 * tolerance is 30s from the EXCHANGE timestamp. A cache TTL long enough to
 * cut meaningful quota would exceed the window in which the data is true.
 *
 * THE COST. One request per crypto analysis, on an endpoint that needs no
 * API key and has no per-user quota. There is nothing material to save.
 *
 * Single-flight is also intentionally NOT applied: two concurrent analyses
 * of the same instrument must each observe the book at their own instant.
 * Sharing one snapshot would make the second analysis silently act on the
 * first one's microstructure.
 * ─────────────────────────────────────────────────────────────────
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
        {
          headers: { Accept: "application/json" },
          // Phase 177 — HTTP deadline below the 6s okx-order-book budget.
          signal: AbortSignal.timeout(5_000),
        },
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
