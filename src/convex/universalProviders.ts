"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "./lib/requireIdentity";
import type { ProviderDiscoveryResult } from "../lib/discovery/types";

// ────────────────────────────────────────────────────────────────
// CCXT
// ────────────────────────────────────────────────────────────────

export const discoverCcxtMarkets = action({
  args: {
    maxExchanges: v.optional(v.number()),
    exchangeId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ProviderDiscoveryResult> => {
    await requireIdentity(ctx);
    const { discoverCcxtMarkets, discoverSingleCcxtExchange } = await import(
      "../lib/discovery/ccxt-discovery"
    );
    const now = Date.now();
    if (args.exchangeId) {
      return discoverSingleCcxtExchange(args.exchangeId, now, {
        maxExchanges: args.maxExchanges ?? 5,
      });
    }
    return discoverCcxtMarkets(now, { maxExchanges: args.maxExchanges ?? 3 });
  },
});

// ────────────────────────────────────────────────────────────────
// DEXSCREENER
// ────────────────────────────────────────────────────────────────

export const discoverDexScreener = action({
  args: {},
  handler: async (ctx): Promise<ProviderDiscoveryResult> => {
    await requireIdentity(ctx);
    const { discoverDexScreener } = await import("../lib/discovery/dexscreener-adapter");
    const transport = async (url: string): Promise<{ ok: boolean; status: number; json: unknown }> => {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { ok: res.ok, status: res.status, json };
    };
    return discoverDexScreener(transport, Date.now());
  },
});

// ────────────────────────────────────────────────────────────────
// GECKOTERMINAL
// ────────────────────────────────────────────────────────────────

export const discoverGeckoTerminal = action({
  args: {},
  handler: async (ctx): Promise<ProviderDiscoveryResult> => {
    await requireIdentity(ctx);
    const { discoverGeckoTerminal } = await import("../lib/discovery/geckoterminal-adapter");
    const transport = async (url: string): Promise<{ ok: boolean; status: number; json: unknown }> => {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { ok: res.ok, status: res.status, json };
    };
    return discoverGeckoTerminal(transport, Date.now(), { maxNetworks: 2, maxPagesPerNetwork: 1 });
  },
});

// ────────────────────────────────────────────────────────────────
// IDX
// ────────────────────────────────────────────────────────────────

export const discoverIdx = action({
  args: {},
  handler: async (ctx): Promise<ProviderDiscoveryResult> => {
    await requireIdentity(ctx);
    const { discoverIdx } = await import("../lib/discovery/idx-adapter");
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    const transport = async (url: string): Promise<{ ok: boolean; status: number; json: unknown }> => {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { ok: res.ok, status: res.status, json };
    };
    return discoverIdx(transport, Date.now(), { apiKey });
  },
});

// ────────────────────────────────────────────────────────────────
// STOCKBIT / AJAIB (UNAVAILABLE)
// ────────────────────────────────────────────────────────────────

export const discoverStockbit = action({
  args: {},
  handler: async (ctx): Promise<ProviderDiscoveryResult> => {
    await requireIdentity(ctx);
    const { createStockbitDiscoveryAdapter } = await import("../lib/discovery/stockbit-adapter");
    const adapter = createStockbitDiscoveryAdapter();
    return adapter.discover(Date.now());
  },
});

export const discoverAjaib = action({
  args: {},
  handler: async (ctx): Promise<ProviderDiscoveryResult> => {
    await requireIdentity(ctx);
    const { createAjaibDiscoveryAdapter } = await import("../lib/discovery/stockbit-adapter");
    const adapter = createAjaibDiscoveryAdapter();
    return adapter.discover(Date.now());
  },
});

// ────────────────────────────────────────────────────────────────
// UNIVERSAL DISCOVERY — all providers
// ────────────────────────────────────────────────────────────────

export const discoverAllProviders = action({
  args: {
    includeCcxt: v.optional(v.boolean()),
    includeDex: v.optional(v.boolean()),
    includeIdx: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const { discoverOkxInstruments: discoverOkxPure } = await import(
      "../lib/data/universal/okx-discovery"
    );
    const { createTwelveDataDiscoveryAdapter } = await import(
      "../lib/discovery/twelve-data-adapter"
    );
    const { discoverCcxtMarkets } = await import("../lib/discovery/ccxt-discovery");
    const { discoverDexScreener } = await import("../lib/discovery/dexscreener-adapter");
    const { discoverGeckoTerminal } = await import("../lib/discovery/geckoterminal-adapter");
    const { discoverIdx } = await import("../lib/discovery/idx-adapter");

    const now = Date.now();
    const apiKey = process.env.TWELVE_DATA_API_KEY ?? "";

    const readEnv = (name: string) => process.env[name];

    const transport = async (url: string): Promise<{ ok: boolean; status: number; json: unknown }> => {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { ok: res.ok, status: res.status, json };
    };

    const okxPromise = discoverOkxPure((url) => fetch(url, { headers: { Accept: "application/json" } }));

    const twelveDataAdapter = createTwelveDataDiscoveryAdapter(
      async (url: string) => {
        let finalUrl = url;
        if (apiKey && url.includes("twelvedata.com") && !/[?&]apikey=/.test(url)) {
          finalUrl = `${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(apiKey)}`;
        }
        const res = await fetch(finalUrl, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          json = undefined;
        }
        return { ok: res.ok, status: res.status, json };
      },
      readEnv,
    );
    const twelveDataPromise = twelveDataAdapter.discover(now);

    const ccxtPromise = args.includeCcxt === false
      ? Promise.resolve(null)
      : discoverCcxtMarkets(now, { maxExchanges: 3 }).catch((err) => ({
          provider: "ccxt",
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          completeness: "FAILED" as const,
          pagesFetched: 0,
          totalDiscovered: 0,
          error: err instanceof Error ? err.message : "ccxt failed",
        }));

    const dexPromise = args.includeDex === false
      ? Promise.resolve(null)
      : discoverDexScreener(transport, now).catch((err) => ({
          provider: "dexscreener",
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          completeness: "FAILED" as const,
          pagesFetched: 0,
          totalDiscovered: 0,
          error: err instanceof Error ? err.message : "dexscreener failed",
        }));

    const geckoPromise = args.includeDex === false
      ? Promise.resolve(null)
      : discoverGeckoTerminal(transport, now, { maxNetworks: 2, maxPagesPerNetwork: 1 }).catch((err) => ({
          provider: "geckoterminal",
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          completeness: "FAILED" as const,
          pagesFetched: 0,
          totalDiscovered: 0,
          error: err instanceof Error ? err.message : "geckoterminal failed",
        }));

    const idxPromise = args.includeIdx === false
      ? Promise.resolve(null)
      : discoverIdx(transport, now, { apiKey }).catch((err) => ({
          provider: "idx",
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          completeness: "FAILED" as const,
          pagesFetched: 0,
          totalDiscovered: 0,
          error: err instanceof Error ? err.message : "idx failed",
        }));

    const [okxRaw, twelveRaw, ccxtRaw, dexRaw, geckoRaw, idxRaw] = await Promise.all([
      okxPromise,
      twelveDataPromise,
      ccxtPromise,
      dexPromise,
      geckoPromise,
      idxPromise,
    ]);

    const results: ProviderDiscoveryResult[] = [];

    // OKX
    if (okxRaw) {
      const { normalizeOkxInstrument } = await import("../lib/discovery/okx-adapter");
      results.push({
        provider: "okx",
        success: okxRaw.success,
        discoveredAt: okxRaw.discoveredAt,
        instruments: okxRaw.instruments.map((row) => normalizeOkxInstrument(row, okxRaw.discoveredAt)),
        warnings: okxRaw.warnings,
        completeness: okxRaw.completeness ?? (okxRaw.success ? "COMPLETE" : "FAILED"),
        pagesFetched: okxRaw.pagesFetched ?? 0,
        totalDiscovered: okxRaw.totalDiscovered ?? okxRaw.instruments.length,
        catalogs: [
          {
            path: "/api/v5/public/instruments",
            assetClass: "crypto",
            completeness: okxRaw.completeness ?? (okxRaw.success ? "COMPLETE" : "FAILED"),
            pagesFetched: okxRaw.pagesFetched ?? 0,
            totalDiscovered: okxRaw.totalDiscovered ?? okxRaw.instruments.length,
          },
        ],
        ...(okxRaw.error ? { error: okxRaw.error } : {}),
      });
    }

    // Twelve Data
    if (twelveRaw) results.push(twelveRaw as ProviderDiscoveryResult);
    if (ccxtRaw) results.push(ccxtRaw as ProviderDiscoveryResult);
    if (dexRaw) results.push(dexRaw as ProviderDiscoveryResult);
    if (geckoRaw) results.push(geckoRaw as ProviderDiscoveryResult);
    if (idxRaw) results.push(idxRaw as ProviderDiscoveryResult);

    // Stockbit / Ajaib as unavailable
    results.push({
      provider: "stockbit",
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: "Stockbit requires authorized Live Datafeed license (REQUIRES_LICENSE). No scraping.",
    });
    results.push({
      provider: "ajaib",
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: "Ajaib requires authorized access (REQUIRES_LICENSE). No scraping.",
    });

    return { results, discoveredAt: now };
  },
});

// ────────────────────────────────────────────────────────────────
// LIVE ACQUISITION — generic for any provider
// ────────────────────────────────────────────────────────────────

export const acquireNativeLiveBatch = action({
  args: {
    instruments: v.array(
      v.object({
        instrument: v.string(),
        provider: v.string(),
        providerInstrumentId: v.string(),
        assetClass: v.union(
          v.literal("crypto"),
          v.literal("forex"),
          v.literal("equity"),
          v.literal("commodity"),
          v.literal("indices"),
          v.literal("macro"),
        ),
      }),
    ),
    concurrency: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const { acquireBatchProviderNativeLiveData } = await import(
      "../lib/market-radar/provider-registry"
    );
    const { acquireCcxtLive } = await import("../lib/discovery/ccxt-live");
    const { acquireIdxLive } = await import("../lib/discovery/idx-adapter");
    const { acquireStockbitLive, acquireAjaibLive } = await import(
      "../lib/discovery/stockbit-adapter"
    );

    // Group by provider
    const groups = new Map<string, typeof args.instruments>();
    for (const inst of args.instruments) {
      const list = groups.get(inst.provider) ?? [];
      list.push(inst);
      groups.set(inst.provider, list);
    }

    const allResults: unknown[] = [];

    for (const [provider, items] of groups) {
      if (provider.startsWith("ccxt:")) {
        for (const item of items) {
          const res = await acquireCcxtLive(
            {
              instrument: item.instrument,
              provider: item.provider,
              providerInstrumentId: item.providerInstrumentId,
              assetClass: item.assetClass as never,
            },
            (name) => process.env[name],
          );
          allResults.push(res);
        }
        continue;
      }
      if (provider === "idx") {
        for (const item of items) {
          const res = await acquireIdxLive(
            { providerInstrumentId: item.providerInstrumentId, assetClass: item.assetClass as never },
            (name) => process.env[name],
          );
          allResults.push({
            instrument: item.instrument,
            assetClass: item.assetClass,
            providerInstrumentId: item.providerInstrumentId,
            provider,
            success: false,
            snapshot: null,
            error: res.error,
          });
        }
        continue;
      }
      if (provider === "stockbit") {
        for (const item of items) {
          const res = await acquireStockbitLive();
          allResults.push({
            instrument: item.instrument,
            assetClass: item.assetClass,
            providerInstrumentId: item.providerInstrumentId,
            provider,
            success: false,
            snapshot: null,
            error: res.error,
          });
        }
        continue;
      }
      if (provider === "ajaib") {
        for (const item of items) {
          const res = await acquireAjaibLive();
          allResults.push({
            instrument: item.instrument,
            assetClass: item.assetClass,
            providerInstrumentId: item.providerInstrumentId,
            provider,
            success: false,
            snapshot: null,
            error: res.error,
          });
        }
        continue;
      }
      if (provider === "dexscreener" || provider === "geckoterminal") {
        // DEX live not yet implemented via generic registry, return UNAVAILABLE for now
        for (const item of items) {
          allResults.push({
            instrument: item.instrument,
            assetClass: item.assetClass,
            providerInstrumentId: item.providerInstrumentId,
            provider,
            success: false,
            snapshot: null,
            error: `${provider} live acquisition requires on-chain provider (UNAVAILABLE for OHLCV)`,
          });
        }
        continue;
      }

      // Fallback to existing generic registry (okx, twelve-data)
      const batch = await acquireBatchProviderNativeLiveData(
        items.map((i) => ({
          instrument: i.instrument,
          provider: i.provider,
          providerInstrumentId: i.providerInstrumentId,
          assetClass: i.assetClass as never,
        })),
        (name) => process.env[name],
        Math.max(1, Math.min(Math.floor(args.concurrency ?? 5), 10)),
        async (url: string) => {
          const apiKey = process.env.TWELVE_DATA_API_KEY ?? "";
          let finalUrl = url;
          if (apiKey && url.includes("twelvedata.com") && !/[?&]apikey=/.test(url)) {
            finalUrl = `${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(apiKey)}`;
          }
          const res = await fetch(finalUrl, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          });
          let json: unknown;
          try {
            json = await res.json();
          } catch {
            json = undefined;
          }
          return { ok: res.ok, status: res.status, json };
        },
      );
      allResults.push(...batch);
    }

    return allResults;
  },
});
