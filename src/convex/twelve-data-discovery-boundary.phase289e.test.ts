/**
 * Phase 289E — the Twelve Data discovery EXECUTION BOUNDARY.
 *
 * THE DEPLOYED FAILURE
 * --------------------
 * `marketData:discoverTwelveDataInstruments` was killed by Convex's 512 MB
 * Node.js action limit, and because discovery ran every catalog inside that one
 * execution, the failure removed the WHOLE universe: the smoke found no
 * commodity candidate at all, so the EIA leg could not even be evaluated.
 *
 * These tests drive the shipped actions (real handlers, a stubbed network and a
 * stubbed `ctx.runAction`) and pin the properties that make that class of
 * failure survivable and diagnosable:
 *   · one catalog per function execution, in the adapter's declared order;
 *   · a catalog that fails (including an out-of-memory execution) is reported as
 *     THAT catalog's FAILED report, with the runtime's own message — and the
 *     other catalogs still deliver their instruments;
 *   · the composed result keeps the universal contract: exact provider-native
 *     identities, provider order, per-catalog reports, pagesFetched,
 *     totalDiscovered and the COMPLETE/PARTIAL/FAILED rollup;
 *   · missing credentials stay an explicit failure and never reach the network;
 *   · no credential is ever named in a diagnostic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";

import { discoverTwelveDataCatalog, discoverTwelveDataInstruments } from "./marketData";
import { TWELVE_DATA_CATALOG_PATHS } from "../lib/discovery/twelve-data-adapter";

type AnyHandler = (ctx: never, args: never) => Promise<unknown>;
const handlerOf = (fn: unknown) => (fn as { _handler: AnyHandler })._handler;

const catalogHandler = handlerOf(discoverTwelveDataCatalog);
const discoveryHandler = handlerOf(discoverTwelveDataInstruments);

/** The provider's own catalog rows, per path (real shapes). */
const CATALOGS: Record<string, unknown[]> = {
  "/forex_pairs": [
    { symbol: "EUR/USD", currency_group: "Major", currency_base: "Euro", currency_quote: "US Dollar" },
    { symbol: "USD/JPY", currency_group: "Major", currency_base: "US Dollar", currency_quote: "Japanese Yen" },
  ],
  "/stocks": [{ symbol: "AAPL", name: "Apple Inc.", currency: "USD", exchange: "NASDAQ", country: "United States" }],
  "/commodities": [
    { symbol: "GAU/EUR", name: "Gold Gram", category: "Precious Metal", description: "" },
    { symbol: "WTI/USD", name: "Crude Oil WTI Spot", category: "Energy Resource", description: "" },
    { symbol: "XAU/USD", name: "Gold Spot", category: "Precious Metal", description: "" },
  ],
  "/indices": [{ symbol: "SPX", name: "S&P 500", currency: "USD", exchange: "INDEX" }],
  "/cryptocurrencies": [{ symbol: "BTC/USD", currency_base: "Bitcoin", currency_quote: "US Dollar" }],
};

const bodyOf = (rows: unknown[]) =>
  JSON.stringify({ status: "ok", count: rows.length, data: rows });

interface FetchState {
  jsonCalls: number;
  paths: string[];
}

let fetchState: FetchState;

function installFetch(options: { fail?: string[]; throw?: string[] } = {}) {
  const state: FetchState = { jsonCalls: 0, paths: [] };
  const impl = (async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    const path = new URL(url).pathname;
    state.paths.push(path);
    if ((options.throw ?? []).includes(path)) throw new Error(`fetch refused for ${path}`);
    if ((options.fail ?? []).includes(path)) {
      return new Response(JSON.stringify({ status: "error", code: 403, message: "this endpoint requires a paid plan" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    const response = new Response(bodyOf(CATALOGS[path] ?? []), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    response.json = async () => {
      state.jsonCalls += 1;
      return JSON.parse(bodyOf(CATALOGS[path] ?? [])) as unknown;
    };
    return response;
  }) as unknown as typeof fetch;
  fetchState = state;
  globalThis.fetch = impl;
}

const identityCtx = () => ({
  auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) },
});

/** The parent's context: it can only reach other functions through runAction. */
function parentCtx(options: { throwFor?: string[] } = {}) {
  const calls: string[] = [];
  return {
    calls,
    ctx: {
      auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) },
      runAction: async (ref: unknown, args: unknown) => {
        const name = getFunctionName(ref as never);
        expect(name).toBe("marketData:discoverTwelveDataCatalog");
        const path = (args as { path: string }).path;
        calls.push(path);
        if ((options.throwFor ?? []).includes(path)) {
          throw new Error(
            "Node.js action execution ran out of memory (maximum memory usage: 512 MB)",
          );
        }
        return catalogHandler(identityCtx() as never, args as never);
      },
    },
  };
}

const OOM = "Node.js action execution ran out of memory (maximum memory usage: 512 MB)";

beforeEach(() => {
  process.env.TWELVE_DATA_API_KEY = "test-key";
  installFetch();
});
afterEach(() => {
  delete process.env.TWELVE_DATA_API_KEY;
});

describe("289E — one catalog per function execution", () => {
  it("fetches exactly one provider catalog per execution", async () => {
    const result = (await catalogHandler(identityCtx() as never, {
      path: "/commodities",
    } as never)) as {
      instruments: { providerInstrumentId: string; assetClass: string }[];
      catalogs: { path: string }[];
      pagesFetched: number;
      totalDiscovered: number;
      completeness: string;
    };

    expect(fetchState.paths).toEqual(["/commodities"]);
    expect(result.instruments.map((i) => i.providerInstrumentId)).toEqual([
      "GAU/EUR",
      "WTI/USD",
      "XAU/USD",
    ]);
    expect(result.instruments.every((i) => i.assetClass === "commodity")).toBe(true);
    expect(result.catalogs.map((c) => c.path)).toEqual(["/commodities"]);
    expect(result.pagesFetched).toBe(1);
    expect(result.totalDiscovered).toBe(3);
    expect(result.completeness).toBe("COMPLETE");
  });

  it("refuses an unknown catalog path without touching the network", async () => {
    const result = (await catalogHandler(identityCtx() as never, {
      path: "/../../secrets",
    } as never)) as { success: boolean; error?: string; completeness: string };

    expect(fetchState.paths).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.completeness).toBe("FAILED");
    expect(result.error).toContain("Unknown Twelve Data catalog path");
  });

  it("reads the catalog body as a stream: the buffered JSON path is never used", async () => {
    await catalogHandler(identityCtx() as never, { path: "/stocks" } as never);
    // If the transport had buffered `res.json()`, this would be > 0.
    expect(fetchState.jsonCalls).toBe(0);
  });
});

describe("289E — a failing catalog can no longer erase the universe", () => {
  it("an OOM in the stock catalog keeps commodity/forex discovery intact and names the culprit", async () => {
    const { ctx, calls } = parentCtx({ throwFor: ["/stocks"] });
    const result = (await discoveryHandler(ctx as never, {} as never)) as {
      success: boolean;
      completeness: string;
      instruments: { providerInstrumentId: string; assetClass: string }[];
      catalogs: { path: string; completeness: string; totalDiscovered: number }[];
      warnings: string[];
      pagesFetched: number;
      totalDiscovered: number;
    };

    // Every declared catalog was attempted, in the adapter's own order.
    expect(calls).toEqual([...TWELVE_DATA_CATALOG_PATHS]);
    // The runaway catalog is reported as ITS OWN failure, with the runtime's words.
    const stocks = result.catalogs.find((c) => c.path === "/stocks");
    expect(stocks).toMatchObject({ completeness: "FAILED", totalDiscovered: 0 });
    expect(result.warnings.join(" ")).toContain("out of memory");
    // And the discovery is still PARTIAL-success: the other catalogs delivered.
    expect(result.completeness).toBe("PARTIAL");
    expect(result.success).toBe(true);
    const ids = result.instruments.map((i) => i.providerInstrumentId);
    expect(ids).toContain("WTI/USD");
    expect(ids).toContain("EUR/USD");
    expect(ids).toContain("BTC/USD");
    expect(ids).not.toContain("AAPL");
    expect(result.totalDiscovered).toBe(result.instruments.length);
    expect(result.pagesFetched).toBe(4);
  });

  it("keeps a provider rejection inside its own catalog (the plan-gated one)", async () => {
    installFetch({ fail: ["/stocks"] });
    const { ctx } = parentCtx();
    const result = (await discoveryHandler(ctx as never, {} as never)) as {
      success: boolean;
      completeness: string;
      warnings: string[];
      catalogs: { path: string; completeness: string }[];
      instruments: { providerInstrumentId: string }[];
    };

    expect(result.completeness).toBe("PARTIAL");
    expect(result.success).toBe(true);
    expect(result.catalogs.find((c) => c.path === "/stocks")?.completeness).toBe("FAILED");
    // The provider's own message survives verbatim (Phase 288 behaviour).
    expect(result.warnings.join(" ")).toContain("this endpoint requires a paid plan");
    expect(result.instruments.map((i) => i.providerInstrumentId)).toContain("WTI/USD");
  });

  it("still reports FAILED when EVERY catalog fails, keeping the universal error text", async () => {
    installFetch({ throw: [...TWELVE_DATA_CATALOG_PATHS] });
    const { ctx } = parentCtx({ throwFor: [...TWELVE_DATA_CATALOG_PATHS] });
    const result = (await discoveryHandler(ctx as never, {} as never)) as {
      success: boolean;
      completeness: string;
      error?: string;
      instruments: unknown[];
      catalogs: { completeness: string }[];
    };

    expect(result.success).toBe(false);
    expect(result.completeness).toBe("FAILED");
    expect(result.instruments).toEqual([]);
    expect(result.catalogs).toHaveLength(TWELVE_DATA_CATALOG_PATHS.length);
    expect(result.catalogs.every((c) => c.completeness === "FAILED")).toBe(true);
    expect(result.error).toBe("Twelve Data discovery failed for all catalogs.");
  });
});

describe("289E — the universal discovery contract, unchanged", () => {
  it("preserves provider-native identities and provider order across catalogs", async () => {
    const { ctx } = parentCtx();
    const result = (await discoveryHandler(ctx as never, {} as never)) as {
      instruments: { providerInstrumentId: string; assetClass: string; provider: string }[];
      catalogs: { path: string; assetClass: string; totalDiscovered: number; pagesFetched: number }[];
      pagesFetched: number;
      totalDiscovered: number;
      success: boolean;
      provider: string;
    };

    expect(result.provider).toBe("twelve-data");
    expect(result.success).toBe(true);
    expect(result.instruments.map((i) => `${i.assetClass}:${i.providerInstrumentId}`)).toEqual([
      "forex:EUR/USD",
      "forex:USD/JPY",
      "equity:AAPL",
      "commodity:GAU/EUR",
      "commodity:WTI/USD",
      "commodity:XAU/USD",
      "indices:SPX",
      "crypto:BTC/USD",
    ]);
    // Per-catalog diagnostics are complete and honest.
    expect(result.catalogs.map((c) => `${c.path}(${c.assetClass})=${c.totalDiscovered}/${c.pagesFetched}`)).toEqual([
      "/forex_pairs(forex)=2/1",
      "/stocks(equity)=1/1",
      "/commodities(commodity)=3/1",
      "/indices(indices)=1/1",
      "/cryptocurrencies(crypto)=1/1",
    ]);
    expect(result.pagesFetched).toBe(5);
    expect(result.totalDiscovered).toBe(8);
  });

  it("keeps missing credentials an explicit failure that never reaches the network", async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const { ctx, calls } = parentCtx();
    const result = (await discoveryHandler(ctx as never, {} as never)) as {
      success: boolean;
      completeness: string;
      error?: string;
      instruments: unknown[];
      catalogs: unknown[];
    };

    expect(calls).toEqual([]);
    expect(fetchState.paths).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.completeness).toBe("FAILED");
    expect(result.instruments).toEqual([]);
    expect(result.catalogs).toEqual([]);
    expect(result.error).toContain("Required credentials not configured");
    expect(result.error).toContain("TWELVE_DATA_API_KEY");
  });

  it("never names a credential value in a diagnostic", async () => {
    installFetch({ fail: ["/stocks"] });
    process.env.TWELVE_DATA_API_KEY = "SECRETKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const { ctx } = parentCtx();
    const result = (await discoveryHandler(ctx as never, {} as never)) as { warnings: string[] };
    expect(JSON.stringify(result)).not.toContain("SECRETKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });
});

describe("289E — the EIA leg is untouched by the discovery boundary", () => {
  it("the corrected WPSR route and the per-leg facets are still what production calls", async () => {
    const { readFileSync } = await import("node:fs");
    const eia = readFileSync("src/convex/eia.ts", "utf8");
    expect(eia).toContain('const BASE = "https://api.eia.gov/v2/petroleum/stoc/wstk/data/"');
    expect(eia).toContain("facets[duoarea]");
    // The invalid route survives only as the comment that documents the fix —
    // it is never a request URL any more.
    expect(eia).not.toMatch(/"https:\/\/api\.eia\.gov\/v2\/petroleum\/sto\//);
    const protectedAnalysis = readFileSync("src/convex/protectedAnalysis.ts", "utf8");
    expect(protectedAnalysis).toContain("api.eia.fetchEiaInventory");
  });
});
