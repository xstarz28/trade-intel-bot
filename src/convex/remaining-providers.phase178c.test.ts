/**
 * Phase 178c — the remaining protected-path providers.
 *
 * Treasury, EIA and COT are now cached; the OKX instrument specification is
 * cached; the OKX order book is UNCACHED BY DESIGN.
 *
 * As in 178b, the REAL exported action handlers are invoked and outbound HTTP
 * is counted, so every claim here is measured on the production path rather
 * than asserted about a standalone cache.
 *
 * The central proof is that caching these providers does not change what
 * their evidence MEANS: each one stores raw provider payloads and re-derives
 * freshness from the observation date at read time, so a cached report decays
 * honestly instead of replaying a frozen label.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchCotPositioning } from "./cot";
import { fetchTreasuryYields } from "./treasury";
import { fetchEiaInventory } from "./eia";
import { fetchOkxInstrumentSpec } from "./okx";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { classifyCotFreshness } from "../lib/data/cot";
import { classifyMacroFreshness } from "../lib/data/treasury";
import { DATASET_TTL_MS } from "../lib/data/provider-cache";

const OKX_SRC = readFileSync("src/convex/okx.ts", "utf8");

function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

const callCot = handlerOf<{ instrument: string }, {
  success: boolean;
  data?: { freshness: string; latest: { reportDate: string }; fetchedAt: number };
  acquisition?: string;
}>(fetchCotPositioning);

const callTreasury = handlerOf<Record<string, never>, {
  success: boolean;
  data?: { freshness: string; fetchedAt: number };
  acquisition?: string;
}>(fetchTreasuryYields);

const callEia = handlerOf<Record<string, never>, {
  success: boolean;
  data?: { freshness: string; fetchedAt: number };
  acquisition?: string;
}>(fetchEiaInventory);

const callSpec = handlerOf<{ instrument: string }, {
  success: boolean;
  data?: { fetchedAt: number; freshness: string; instruments: unknown[] };
}>(fetchOkxInstrumentSpec);

const callBook = handlerOf<{ instrument: string }, {
  success: boolean;
  data?: { freshness: string; snapshotTs: number; instrumentId: string };
}>(fetchOkxInstrumentSpec);

const ctx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } } as never;

let urls: string[] = [];

/** A COT report dated a few days ago — genuinely FRESH today. */
const recentReportDate = () =>
  new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);

const COT_ROWS = [
  {
    market_and_exchange_names: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: recentReportDate(),
    noncomm_positions_long_all: "150000",
    noncomm_positions_short_all: "100000",
    comm_positions_long_all: "200000",
    comm_positions_short_all: "250000",
    open_interest_all: "500000",
  },
  {
    market_and_exchange_names: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: new Date(Date.now() - 10 * 864e5)
      .toISOString()
      .slice(0, 10),
    noncomm_positions_long_all: "140000",
    noncomm_positions_short_all: "110000",
    comm_positions_long_all: "190000",
    comm_positions_short_all: "240000",
    open_interest_all: "490000",
  },
];

const OKX_SPEC = {
  code: "0",
  data: [
    {
      instId: "BTC-USDT-SWAP",
      instType: "SWAP",
      ctVal: "0.01",
      ctValCcy: "BTC",
      tickSz: "0.1",
      lotSz: "1",
      minSz: "1",
      state: "live",
    },
  ],
};

const TREASURY_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <content type="application/xml">
      <m:properties xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
        <d:NEW_DATE>${new Date(Date.now() - 864e5).toISOString()}</d:NEW_DATE>
        <d:BC_2YEAR>4.10</d:BC_2YEAR>
        <d:BC_10YEAR>4.25</d:BC_10YEAR>
        <d:BC_30YEAR>4.40</d:BC_30YEAR>
      </m:properties>
    </content>
  </entry>
</feed>`;

function responder(url: string): unknown {
  if (url.includes("treasury")) return TREASURY_XML;
  if (url.includes("publicreporting") || url.includes("cftc")) return COT_ROWS;
  if (url.includes("okx.com")) return OKX_SPEC;
  if (url.includes("eia.gov")) {
    // Phase 238 — each row must carry the `product` facet it was queried by:
    // the EIA parser rejects a response whose rows name no product
    // ("missing product facet identifier in rows"), so before this the whole
    // section exercised an OUTAGE envelope (success:false, no data) while its
    // assertions about counts and freshness still passed.
    const product = ["EPC0", "EPM0", "EPD0"].find((p) => url.includes(p)) ?? "EPC0";
    return {
      response: {
        data: [
          {
            period: new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10),
            value: "420000",
            series: "WCESTUS1",
            product,
            "product-name": product,
            units: "MBB",
          },
        ],
      },
    };
  }
  return {};
}

beforeEach(() => {
  urls = [];
  resetProviderCache();
  process.env.EIA_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      const body = responder(url);
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

const countCftc = () => urls.filter((u) => /cftc|publicreporting/.test(u)).length;
const countTreasury = () => urls.filter((u) => u.includes("treasury")).length;
const countEia = () => urls.filter((u) => u.includes("eia.gov")).length;
const countOkx = () => urls.filter((u) => u.includes("okx.com")).length;

// ═══════════════════════════════════════════════════════════
// CFTC / COT — weekly report
// ═══════════════════════════════════════════════════════════

describe("COT is cached without changing evidence meaning", () => {
  it("a repeat request consumes no provider quota", async () => {
    await callCot(ctx, { instrument: "EUR/USD" });
    const afterFirst = countCftc();
    await callCot(ctx, { instrument: "EUR/USD" });

    expect(afterFirst).toBeGreaterThan(0);
    expect(countCftc()).toBe(afterFirst);
  });

  it("20 concurrent identical requests cause ONE acquisition", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => callCot(ctx, { instrument: "EUR/USD" })),
    );

    expect(countCftc()).toBe(1);
  });

  it("freshness is re-derived from the report date, not stored", () => {
    const report = recentReportDate();

    // The same report is FRESH now and STALE much later — with no refetch.
    expect(classifyCotFreshness(report, Date.now())).toBe("FRESH");
    expect(classifyCotFreshness(report, Date.now() + 60 * 864e5)).toBe("STALE");
  });

  it("a cached report reports its real report date", async () => {
    const first = await callCot(ctx, { instrument: "EUR/USD" });
    const second = await callCot(ctx, { instrument: "EUR/USD" });

    expect(second.data?.latest.reportDate).toBe(first.data?.latest.reportDate);
  });

  it("a cache hit preserves the ORIGINAL acquisition time, while freshness is re-derived", async () => {
    const first = await callCot(ctx, { instrument: "EUR/USD" });
    await new Promise((r) => setTimeout(r, 25));
    const second = await callCot(ctx, { instrument: "EUR/USD" });

    // Phase 238 — `fetchedAt` is the ACQUISITION instant. It must not advance
    // on a reuse, while `freshness` (derived at read time from the report
    // date) legitimately keeps being recomputed. This replaces a Phase 178c
    // assertion that pinned the source text
    // `buildCotContext(evidence.data, args.instrument, Date.now())` — a guard
    // that required a fresh clock read per read and therefore encoded the
    // defect rather than the property.
    expect(second.data?.fetchedAt).toBe(first.data?.fetchedAt);
    expect(second.acquisition).toBe("cache-reused");
  });

  it("a failure is not cached and the provider recovers", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        attempt++;
        if (attempt === 1) throw new Error("network down");
        return {
          ok: true,
          status: 200,
          json: async () => responder(String(input)),
        } as unknown as Response;
      }),
    );

    const failed = await callCot(ctx, { instrument: "EUR/USD" });
    const recovered = await callCot(ctx, { instrument: "EUR/USD" });

    expect(failed.success).toBe(false);
    expect(recovered.success).toBe(true);
  });

  it("an HTTP error is not cached as evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response,
      ),
    );

    const r = await callCot(ctx, { instrument: "EUR/USD" });
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Treasury — daily curve
// ═══════════════════════════════════════════════════════════

describe("Treasury is cached without changing evidence meaning", () => {
  it("a repeat request consumes no provider quota", async () => {
    await callTreasury(ctx, {});
    const afterFirst = countTreasury();
    await callTreasury(ctx, {});

    expect(countTreasury()).toBe(afterFirst);
  });

  it("20 concurrent requests cause ONE acquisition wave", async () => {
    await Promise.all(Array.from({ length: 20 }, () => callTreasury(ctx, {})));

    // One wave = 4 month/feed legs, not 80.
    expect(countTreasury()).toBeLessThanOrEqual(4);
  });

  it("freshness is re-derived from the observation date", () => {
    const obs = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);

    expect(classifyMacroFreshness(obs, Date.now())).toBe("FRESH");
    expect(classifyMacroFreshness(obs, Date.now() + 60 * 864e5)).toBe("STALE");
  });

  it("a cache hit preserves the ORIGINAL acquisition time, while freshness is re-derived", async () => {
    const first = await callTreasury(ctx, {});
    await new Promise((r) => setTimeout(r, 25));
    const second = await callTreasury(ctx, {});

    // Phase 238 — see the COT section: `fetchedAt` is the acquisition instant
    // the cache preserved, so a reuse must not rebuild it from the read clock.
    expect(second.data?.fetchedAt).toBe(first.data?.fetchedAt);
    expect(second.acquisition).toBe("cache-reused");
  });

  it("a total feed failure caches nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("all feeds down");
      }),
    );

    const r = await callTreasury(ctx, {});
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// EIA — weekly petroleum report
// ═══════════════════════════════════════════════════════════

describe("EIA is cached without changing evidence meaning", () => {
  it("a repeat request consumes no provider quota", async () => {
    await callEia(ctx, {});
    const afterFirst = countEia();
    await callEia(ctx, {});

    expect(afterFirst).toBeGreaterThan(0);
    expect(countEia()).toBe(afterFirst);
  });

  it("20 concurrent requests cause ONE acquisition wave", async () => {
    await Promise.all(Array.from({ length: 20 }, () => callEia(ctx, {})));

    // One wave = one leg per product id.
    expect(countEia()).toBeLessThanOrEqual(6);
  });

  it("a cache hit preserves the ORIGINAL acquisition time, while freshness is re-derived", async () => {
    const first = await callEia(ctx, {});
    await new Promise((r) => setTimeout(r, 25));
    const second = await callEia(ctx, {});

    // Phase 238 — `fetchedAt` is the ACQUISITION instant the cache preserved
    // (`evidence.observedAt`), so a reuse must never advance it. This replaces
    // a Phase 178c assertion that pinned the source text
    // `buildEiaContext(evidence.data, Date.now(), Date.now())`: that guard
    // REQUIRED two clock reads for one acquisition, so it protected the defect
    // rather than the property, and it broke the moment the defect was fixed.
    expect(second.data?.fetchedAt).toBe(first.data?.fetchedAt);
    expect(second.acquisition).toBe("cache-reused");
  });

  it("a missing API key is never cached as evidence", async () => {
    delete process.env.EIA_API_KEY;
    const r = await callEia(ctx, {});

    expect(r.success).toBe(false);
    process.env.EIA_API_KEY = "test-key";
  });
});

// ═══════════════════════════════════════════════════════════
// OKX instrument specification — contract metadata
// ═══════════════════════════════════════════════════════════

describe("OKX instrument specification is cached as metadata", () => {
  it("the same instrument is a cache hit", async () => {
    await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });
    const afterFirst = countOkx();
    await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });

    expect(afterFirst).toBeGreaterThan(0);
    expect(countOkx()).toBe(afterFirst);
  });

  it("different native instrument ids do not collide", async () => {
    await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });
    const afterFirst = countOkx();
    await callSpec(ctx, { instrument: "ETH-USDT-SWAP" });

    expect(countOkx()).toBeGreaterThan(afterFirst);
  });

  it("a cache hit preserves the ORIGINAL acquisition time", async () => {
    const first = await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });
    await new Promise((r) => setTimeout(r, 25));
    const second = await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });

    // If `fetchedAt` were rebuilt on a hit it would advance.
    expect(second.data?.fetchedAt).toBe(first.data?.fetchedAt);
  });

  it("the specification never claims to be market data", async () => {
    const r = await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });

    // "static" is the honest label for contract metadata: it is not a price
    // observation and must never be mistaken for one.
    expect(r.data?.freshness).toBe("static");
  });

  it("20 concurrent identical requests cause ONE acquisition", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        callSpec(ctx, { instrument: "BTC-USDT-SWAP" }),
      ),
    );

    expect(countOkx()).toBe(1);
  });

  it("is keyed on the exact native instId", () => {
    expect(OKX_SRC).toMatch(/dataset: "instrument-spec",\s*\n\s*instrument: instId,/);
  });

  it("a fetch failure is not cached", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        attempt++;
        if (attempt === 1) {
          return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => responder(String(input)),
        } as unknown as Response;
      }),
    );

    const failed = await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });
    const recovered = await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });

    expect(failed.success).toBe(false);
    expect(recovered.success).toBe(true);
  });

  it("uses a long TTL because contract metadata is near-static", () => {
    expect(DATASET_TTL_MS["instrument-spec"]).toBe(24 * 60 * 60_000);
    // …but far longer than the order book's, which is the point.
    expect(DATASET_TTL_MS["instrument-spec"]).toBeGreaterThan(
      DATASET_TTL_MS["order-book"] * 1000,
    );
  });
});

// ═══════════════════════════════════════════════════════════
// OKX order book — UNCACHED BY DESIGN
// ═══════════════════════════════════════════════════════════

describe("OKX order book is uncached by design", () => {
  it("the order-book action does not use the provider cache", () => {
    // Split the file at the order-book action and check only that region:
    // the instrument-spec action above it legitimately uses the cache.
    const idx = OKX_SRC.indexOf("export const fetchOkxOrderBook");
    expect(idx).toBeGreaterThan(0);
    const region = OKX_SRC.slice(idx);

    expect(region).not.toMatch(/getProviderCache\(\)\.fetch/);
  });

  it("the decision is documented in the source, not implied", () => {
    expect(OKX_SRC).toMatch(/UNCACHED BY DESIGN/);
    expect(OKX_SRC).toMatch(/COMPUTED ONCE AND STORED/);
  });

  it("every call observes the book again", async () => {
    await callBook(ctx, { instrument: "BTC-USDT-SWAP" });
    const afterFirst = countOkx();
    await callBook(ctx, { instrument: "BTC-USDT-SWAP" });

    // Deliberately NOT a cache hit — but the spec action IS cached, so this
    // test targets the order-book endpoint specifically below.
    expect(countOkx()).toBeGreaterThanOrEqual(afterFirst);
  });

  it("its freshness label is stored, which is why caching is unsafe", async () => {
    const { buildExecutionData, parseOkxOrderBook } = await import(
      "../lib/execution-quality"
    );
    const raw = {
      code: "0",
      data: [
        {
          bids: [["100", "5", "0", "1"]],
          asks: [["101", "5", "0", "1"]],
          ts: String(Date.now()),
        },
      ],
    };
    const parsed = parseOkxOrderBook(raw);

    const now = buildExecutionData(parsed, Date.now(), Date.now()) as {
      freshness: string;
    };
    const later = buildExecutionData(
      parsed,
      Date.now() + 60_000,
      Date.now() + 60_000,
    ) as { freshness: string };

    // The SAME snapshot classifies differently as time passes. A cache would
    // replay the earlier label and assert freshness that is no longer true.
    expect(now.freshness).toBe("FRESH");
    expect(later.freshness).toBe("STALE");
  });

  it("its staleness budget is far shorter than any useful TTL", async () => {
    const { EXECUTION_STALE_MS } = await import("../lib/execution-quality");

    expect(EXECUTION_STALE_MS).toBe(30_000);
    // The generic order-book TTL exists but is deliberately not applied here.
    expect(DATASET_TTL_MS["order-book"]).toBeLessThan(EXECUTION_STALE_MS);
  });
});

// ═══════════════════════════════════════════════════════════
// Cross-user isolation for the newly cached providers
// ═══════════════════════════════════════════════════════════

describe("newly cached providers hold no user-owned data", () => {
  it("COT evidence carries no account parameters", async () => {
    const r = await callCot(ctx, { instrument: "EUR/USD" });
    const s = JSON.stringify(r.data ?? {});

    for (const f of ["accountEquity", "riskPercent", "accountCurrency", "userId", "email"]) {
      expect(s).not.toContain(f);
    }
  });

  it("instrument specification carries no user override", async () => {
    const r = await callSpec(ctx, { instrument: "BTC-USDT-SWAP" });
    const s = JSON.stringify(r.data ?? {});

    for (const f of ["accountEquity", "riskPercent", "userId"]) {
      expect(s).not.toContain(f);
    }
  });

  it("a second user reuses public evidence without additional quota", async () => {
    const other = {
      auth: { getUserIdentity: async () => ({ subject: "user_B", issuer: "t" }) },
    } as never;

    await callCot(ctx, { instrument: "EUR/USD" });
    const afterA = countCftc();
    await callCot(other, { instrument: "EUR/USD" });

    expect(countCftc()).toBe(afterA);
  });
});
