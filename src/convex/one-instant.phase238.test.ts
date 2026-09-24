/**
 * Phase 238 — one event, one instant.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Several provider actions read `Date.now()` more than once for ONE
 * acquisition, and recorded the results in fields that are supposed to
 * describe the same observation:
 *
 *   · `alphaVantage.ts` — `normalizeFundamentalsFromAV` stamped its own
 *     `FundamentalData.timestamp`, and the cache fetcher stamped
 *     `observedAt: Date.now()` afterwards, so one acquisition carried two
 *     instants. Phase 229 asserted they are equal; on CI they were 1 ms apart.
 *     The sentiment and macro blocks were worse: they were stamped with a
 *     fresh clock read at DERIVATION time, so a block derived from the news
 *     articles claimed to have been observed later than the articles.
 *   · `eia.ts`, `cot.ts`, `treasury.ts` — `fetchedAt` was rebuilt from the
 *     read-time clock, so a cache hit reported a fetch that never happened
 *     while the envelope said `cache-reused`.
 *   · `okx.ts` — `buildExecutionData(parsed, Date.now(), Date.now())`.
 *   · `market-radar/provider-registry.ts` — the OKX candles adapter consulted
 *     the clock twice in one record (its `observedAt` fallback and the instant
 *     its own freshness was judged against).
 *
 * ── Why this file is deterministic ───────────────────────────────────────
 *
 * With a real clock these disagreements are a race: usually invisible, visible
 * only under load. Every test below installs `createCountingClock` — a clock
 * that advances 1 ms per READ — so a second read can never produce the same
 * value as the first. The assertions then hold because the code reads once,
 * never because the millisecond happened not to tick.
 *
 * ── What is NOT claimed here ─────────────────────────────────────────────
 *
 * Two legs of one action are two acquisitions: their instants are expected to
 * differ, and the tests assert the ordering rather than equality. Only
 * instants describing the SAME event must be the same value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCountingClock } from "../test-counting-clock";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { fetchIntelligence } from "./alphaVantage";
import { fetchCotPositioning } from "./cot";
import { fetchEiaInventory } from "./eia";
import { fetchTreasuryYields } from "./treasury";
import { fetchOkxOrderBook } from "./okx";
import { EXECUTION_STALE_MS } from "../lib/execution-quality";
import { readFileSync, readdirSync } from "node:fs";

type Envelope = {
  success: boolean;
  observedAt?: number;
  acquisition?: string;
  error?: string;
  sentiment?: { timestamp: number; articleCount: number };
  fundamentals?: { timestamp: number; available: boolean; unavailableReason?: string };
  macro?: { timestamp: number };
  data?: { fetchedAt?: number; freshness?: string; snapshotTs?: number };
};
type Handler = (ctx: unknown, args: Record<string, unknown>) => Promise<Envelope>;

const av = (fetchIntelligence as unknown as { _handler: Handler })._handler;
const eia = (fetchEiaInventory as unknown as { _handler: Handler })._handler;
const cot = (fetchCotPositioning as unknown as { _handler: Handler })._handler;
const treasury = (fetchTreasuryYields as unknown as { _handler: Handler })._handler;
const orderBook = (fetchOkxOrderBook as unknown as { _handler: Handler })._handler;

const ctx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } };
const AV_STOCK = { instrument: "AAPL", instrumentType: "stock" };

const BASE = 1_700_000_000_000;
const periodOf = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

const OK_NEWS = {
  feed: Array.from({ length: 6 }, (_, i) => ({
    title: `A${i}`,
    url: `https://x/${i}`,
    time_published: "20250101T120000",
    source: "W",
    overall_sentiment_score: "0.3",
    ticker_sentiment: [
      { ticker: "AAPL", ticker_sentiment_score: "0.4", relevance_score: "0.9", ticker_sentiment_label: "Bullish" },
    ],
  })),
};
const OK_OVERVIEW = { Symbol: "AAPL", Name: "Apple", Sector: "Tech", MarketCapitalization: "12", PERatio: "20" };
const OK_EARNINGS = { quarterlyEarnings: [{ fiscalDateEnding: "2025-03-31", reportedEPS: "1.5" }] };
const COT_ROWS = [
  {
    market_and_exchange_names: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: periodOf(3),
    noncomm_positions_long_all: "150000",
    noncomm_positions_short_all: "100000",
    comm_positions_long_all: "200000",
    comm_positions_short_all: "250000",
    open_interest_all: "500000",
  },
];
const TREASURY_XML = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><content type="application/xml"><m:properties xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"><d:NEW_DATE>${new Date(Date.now() - 864e5).toISOString()}</d:NEW_DATE><d:BC_2YEAR>4.10</d:BC_2YEAR><d:BC_10YEAR>4.25</d:BC_10YEAR><d:BC_30YEAR>4.40</d:BC_30YEAR></m:properties></content></entry></feed>`;

/** The book's exchange timestamp is placed exactly ON the staleness boundary. */
const boundaryBook = (snapshotTs: number) => ({
  code: "0",
  data: [
    {
      instId: "BTC-USDT-SWAP",
      ts: String(snapshotTs),
      asks: [["100.5", "10", "0", "2"], ["100.6", "12", "0", "2"]],
      bids: [["100.4", "9", "0", "2"], ["100.3", "8", "0", "2"]],
    },
  ],
});

let avRoutes: Record<string, unknown> = {};
let bookPayload: unknown = boundaryBook(BASE);
/** When true the NEWS_SENTIMENT leg fails at the transport, nothing else does. */
let newsFails = false;

beforeEach(() => {
  resetProviderCache();
  process.env.ALPHA_VANTAGE_API_KEY = "k";
  process.env.EIA_API_KEY = "k";
  avRoutes = { NEWS_SENTIMENT: OK_NEWS, OVERVIEW: OK_OVERVIEW, EARNINGS: OK_EARNINGS };
  newsFails = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      let body: unknown = {};
      if (url.includes("NEWS_SENTIMENT") && newsFails) {
        throw Object.assign(new Error("aborted due to timeout"), { name: "TimeoutError" });
      } else if (url.includes("alphavantage")) {
        for (const key of Object.keys(avRoutes)) if (url.includes(key)) body = avRoutes[key];
      } else if (url.includes("eia.gov")) {
        const product = ["EPC0", "EPM0", "EPD0"].find((p) => url.includes(p)) ?? "EPC0";
        body = {
          response: {
            data: [
              {
                period: periodOf(3),
                value: "420.5",
                product,
                "product-name": product,
                units: "MBB",
              },
            ],
          },
        };
      } else if (url.includes("cftc")) body = COT_ROWS;
      else if (url.includes("treasury")) body = TREASURY_XML;
      else if (url.includes("okx.com")) body = bookPayload;
      return {
        ok: true,
        status: 200,
        statusText: "x",
        json: async () => body,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetProviderCache();
});

function installClock(base = BASE) {
  const clock = createCountingClock(base);
  vi.spyOn(Date, "now").mockImplementation(clock.now);
  return clock;
}

// ═══════════════════════════════════════════════════════════════
// THE CLOCK ITSELF — the guard's guard
// ═══════════════════════════════════════════════════════════════

describe("238 — the counting clock", () => {
  it("returns a distinct, strictly increasing instant on EVERY read", () => {
    const clock = createCountingClock(BASE);
    const values = [clock.now(), clock.now(), clock.now()];

    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual([BASE + 1, BASE + 2, BASE + 3]);
    expect(clock.reads).toEqual(values);
  });

  it("would expose a second read for one acquisition (the property the suite relies on)", () => {
    const clock = createCountingClock(BASE);
    const firstRead = clock.now();
    const secondRead = clock.now();

    // This is why a double read can never pass unnoticed here, while with the
    // real clock the same defect is invisible on an idle machine.
    expect(secondRead).not.toBe(firstRead);
  });
});

// ═══════════════════════════════════════════════════════════════
// ALPHA VANTAGE — the CI-red site
// ═══════════════════════════════════════════════════════════════

describe("238 — Alpha Vantage: one acquisition, one instant", () => {
  it("partial: the envelope's observedAt IS the surviving leg's timestamp", async () => {
    newsFails = true;
    installClock();
    const r = await av(ctx, AV_STOCK);

    expect(r.success).toBe(true);
    expect(r.sentiment).toBeUndefined();
    expect(r.fundamentals?.available).toBe(true);
    expect(r.error).toMatch(/news: timeout/);
    // The exact assertion that failed on CI (run 35187915524) with a 1 ms
    // difference. It is now deterministic: one acquisition, one clock read.
    expect(r.observedAt).toBe(r.fundamentals?.timestamp);
  });

  it("full: the derived blocks carry the NEWS acquisition instant, not a derivation-time read", async () => {
    installClock();
    const r = await av(ctx, AV_STOCK);

    expect(r.sentiment?.articleCount).toBe(6);
    expect(r.observedAt).toBe(r.sentiment?.timestamp);
    expect(r.observedAt).toBe(r.macro?.timestamp);
  });

  it("full: the two legs are two acquisitions, so their instants are distinct and ordered", async () => {
    installClock();
    const r = await av(ctx, AV_STOCK);

    // News is fetched first. The fundamentals instant must be LATER, and both
    // must be real clock reads — equality here would mean one leg stole the
    // other's instant.
    expect(r.fundamentals?.timestamp).toBeGreaterThan(r.observedAt ?? 0);
  });

  it("every recorded instant is a real clock read (nothing back-filled from elsewhere)", async () => {
    const clock = installClock();
    const r = await av(ctx, AV_STOCK);

    for (const instant of [r.observedAt, r.sentiment?.timestamp, r.macro?.timestamp, r.fundamentals?.timestamp]) {
      expect(clock.reads).toContain(instant);
    }
  });

  it("answered-empty news: the zero-article block is still dated by its acquisition", async () => {
    avRoutes.NEWS_SENTIMENT = { feed: [] };
    installClock();
    const r = await av(ctx, AV_STOCK);

    // An empty answer is not an outage: the news leg succeeded and the
    // sentiment block carries its (zero-article) reading — dated by the SAME
    // acquisition instant, never by the moment the empty block was assembled.
    expect(r.success).toBe(true);
    expect(r.sentiment?.articleCount).toBe(0);
    expect(r.sentiment?.timestamp).toBe(r.observedAt);
  });

  it("cache hit: the derived blocks keep the ORIGINAL observation instant", async () => {
    const first = await av(ctx, AV_STOCK);
    const clock = installClock(); // a fresh clock: new reads must NOT move anything
    const second = await av(ctx, AV_STOCK);

    expect(second.acquisition).toBe("cache-reused");
    expect(second.observedAt).toBe(first.observedAt);
    expect(second.sentiment?.timestamp).toBe(second.observedAt);
    expect(second.macro?.timestamp).toBe(second.observedAt);
    expect(second.fundamentals?.timestamp).toBe(first.fundamentals?.timestamp);
    // Nothing recorded on the reuse came from this call's clock at all.
    for (const instant of [second.observedAt, second.sentiment?.timestamp, second.macro?.timestamp, second.fundamentals?.timestamp]) {
      expect(clock.reads).not.toContain(instant);
    }
  });

  it("non-stock: a block that was never acquired carries NO observation instant (0 sentinel)", async () => {
    installClock();
    const r = await av(ctx, { instrument: "EUR/USD", instrumentType: "forex" });

    expect(r.fundamentals?.available).toBe(false);
    // Not `Date.now()`: the request clock would assert an observation that
    // never happened. 0 is the documented "no provider timestamp" sentinel.
    expect(r.fundamentals?.timestamp).toBe(0);
    // The news leg DID answer, so the envelope still carries its instant.
    expect(r.observedAt).toBe(r.sentiment?.timestamp);
  });
});

// ═══════════════════════════════════════════════════════════════
// THE CACHED CONTEXT PROVIDERS — fetchedAt is the acquisition instant
// ═══════════════════════════════════════════════════════════════

describe("238 — EIA / COT / Treasury: fetchedAt is the acquisition instant", () => {
  it("EIA: the context's fetchedAt equals the envelope's observedAt", async () => {
    installClock();
    const r = await eia(ctx, {});
    expect(r.success).toBe(true);
    expect(r.data?.fetchedAt).toBe(r.observedAt);
  });

  it("COT: the context's fetchedAt equals the envelope's observedAt", async () => {
    installClock();
    const r = await cot(ctx, { instrument: "EUR/USD" });
    expect(r.success).toBe(true);
    expect(r.data?.fetchedAt).toBe(r.observedAt);
  });

  it("Treasury: the context's fetchedAt equals the envelope's observedAt", async () => {
    installClock();
    const r = await treasury(ctx, {});
    expect(r.success).toBe(true);
    expect(r.data?.fetchedAt).toBe(r.observedAt);
  });

  it("a cache hit does not rebuild fetchedAt from the read clock", async () => {
    const first = await eia(ctx, {});
    const clock = installClock();
    const second = await eia(ctx, {});

    expect(second.acquisition).toBe("cache-reused");
    expect(second.data?.fetchedAt).toBe(first.data?.fetchedAt);
    expect(clock.reads).not.toContain(second.data?.fetchedAt);
  });
});

// ═══════════════════════════════════════════════════════════════
// OKX ORDER BOOK — the verdict is computed at the recorded instant
// ═══════════════════════════════════════════════════════════════

describe("238 — OKX order book: freshness is judged at the instant the payload records", () => {
  it("on the staleness boundary: FRESH, because fetchedAt and the verdict share one read", async () => {
    // The exchange timestamp is placed so the age is EXACTLY the staleness
    // budget relative to the FIRST clock read of the call. One read → age ==
    // budget → FRESH. A second read one millisecond later → age == budget + 1
    // → STALE, which is what the pre-Phase-238 code produced on the same book.
    bookPayload = boundaryBook(BASE + 1 - EXECUTION_STALE_MS);
    installClock();

    const r = await orderBook(ctx, { instrument: "BTC/USDT" });

    expect(r.data?.fetchedAt).toBe(BASE + 1);
    expect(r.data?.freshness).toBe("FRESH");
  });

  it("a crossed book is refused rather than judged (control: the boundary above is reachable)", async () => {
    bookPayload = {
      code: "0",
      data: [
        {
          instId: "BTC-USDT-SWAP",
          ts: String(BASE),
          asks: [["100.0", "10", "0", "2"]],
          bids: [["100.5", "9", "0", "2"]],
        },
      ],
    };
    installClock();

    const r = await orderBook(ctx, { instrument: "BTC/USDT" });
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// STRUCTURAL COMPLEMENTS
//
// Runtime enforcement is authoritative (Phase 237's lesson about text
// scanners), but two shapes are cheap to refuse outright: a single call
// expression that reads the clock twice, and the test clock leaking into the
// shipped bundle.
// ═══════════════════════════════════════════════════════════════

describe("238 — structural complements", () => {
  const PRODUCTION_FILES = [
    "src/convex/alphaVantage.ts",
    "src/convex/eia.ts",
    "src/convex/cot.ts",
    "src/convex/treasury.ts",
    "src/convex/okx.ts",
    "src/lib/data/cot.ts",
    "src/lib/data/treasury.ts",
    "src/lib/market-radar/provider-registry.ts",
  ];

  it("no provider file reads the clock more than once on a single line", () => {
    // A single statement that calls `Date.now()` twice is a two-instant
    // expression by construction; no legitimate acquisition needs one. Reads
    // split across separate statements are the runtime tests' job.
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        const reads = line.match(/Date\.now\(\)/g) ?? [];
        if (reads.length > 1) offenders.push(`${file}:${i + 1} (${reads.length} reads)`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no application module imports the test-only counting clock", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
        if (path.endsWith("src/test-counting-clock.ts")) continue;
        if (/test-counting-clock/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });
});
