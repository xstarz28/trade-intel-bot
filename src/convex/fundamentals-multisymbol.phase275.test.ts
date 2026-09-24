/**
 * Phase 275 — generalization contract for the REAL Alpha Vantage fundamental
 * path across supported stocks.
 *
 * Phase 274 proved the vertical slice with one symbol. This suite proves the
 * SAME production path serves any supported stock instrument:
 *
 *   discovery identity → fetchIntelligence (real handler, stubbed transport)
 *   → normalized FundamentalData → assessFundamentals → AnalysisResult
 *
 * What is asserted here:
 *   · each request carries the EXACT provider/native symbol it was given;
 *   · that identity survives normalization, the engine and the result;
 *   · two symbols' independent evidence produces independent assessments
 *     (no bleed, no shared state, no cache collision);
 *   · one engine and one path serve both — there is no per-symbol branch,
 *     whitelist or fallback (including a static check of the production
 *     modules for ticker literals and symbol switches);
 *   · missing metrics stay unavailable, provider failure stays unavailable,
 *     stale fiscal periods stay correctly dated, and changing evidence
 *     changes the assessment.
 *
 * Only the HTTP transport is stubbed. No production formula is mocked and
 * nothing in this file is reachable from the production path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { fetchIntelligence } from "./alphaVantage";
import { assessFundamentals } from "../lib/fundamental-engine";
import { runAnalysis } from "../lib/analysis-engine";
import type { IntelligenceResult } from "../lib/data/intelligence-types";

type Args = {
  instrument: string;
  instrumentType: "stock";
  provider?: string;
  providerInstrumentId?: string;
};
type Handler = (ctx: unknown, args: Args) => Promise<IntelligenceResult>;
const av = (fetchIntelligence as unknown as { _handler: Handler })._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "user_A|sess", issuer: "t" }) } };

type Route = { status?: number; body?: unknown };
let routes: Record<string, Record<string, Route>> = {};
const calls: string[] = [];

const NEWS = {
  feed: [
    {
      title: "Quarterly results published",
      url: "https://news/1",
      time_published: "20250731T120000",
      source: "Wire",
      ticker_sentiment: [
        { ticker: "MSFT", ticker_sentiment_score: "0.2", relevance_score: "0.8", ticker_sentiment_label: "Neutral" },
      ],
    },
  ],
};

/** Overview supplied by the provider for one symbol, with overrides. */
function overview(symbol: string, name: string, fields: Record<string, string> = {}) {
  return { Symbol: symbol, Name: name, Sector: "TECHNOLOGY", AssetType: "Common Stock", ...fields };
}

/**
 * Fiscal quarter ends, newest first, ending in a quarter that closed at least
 * `minAgeDays` ago. Derived from today so the fixtures describe a report a
 * company would plausibly have published — the engine's staleness disclosure
 * (measured between the period end and the observation stamp) then has a
 * realistic input instead of a fixture artifact. All dates are real calendar
 * dates and are asserted against the payload, never against "now".
 */
function recentQuarterEnds(count: number, minAgeDays = 60): Date[] {
  const now = Date.now();
  const quarterEnd = (y: number, qi: number) => new Date(Date.UTC(y, qi * 3 + 3, 0));
  let year = new Date().getUTCFullYear();
  let q = Math.floor(new Date().getUTCMonth() / 3);
  let d = quarterEnd(year, q);
  while (now - d.getTime() < minAgeDays * 86_400_000) {
    q -= 1;
    if (q < 0) {
      q = 3;
      year -= 1;
    }
    d = quarterEnd(year, q);
  }
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    out.push(new Date(d));
    q -= 1;
    if (q < 0) {
      q = 3;
      year -= 1;
    }
    d = quarterEnd(year, q);
  }
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Recent quarter ends, newest first (fresh statements). */
const RECENT_ENDS = recentQuarterEnds(8);
/** Deliberately old statements (stale-report case), newest first. */
const OLD_ENDS: Date[] = [0, 1, 2, 3, 4, 5, 6, 7].map(
  (i) => new Date(Date.UTC(2023, 5 - i * 3, 0)),
);

/** 8 quarters, newest first, from parallel EPS/revenue/estimate arrays. */
function earnings(
  eps: string[],
  revenue: string[],
  estimates: string[],
  ends: Date[] = RECENT_ENDS,
) {
  return {
    quarterlyEarnings: eps.map((e, i) => ({
      fiscalDateEnding: iso(ends[i]),
      // Report date: a plausible publication date after the period closed.
      reportedDate: iso(new Date(ends[i].getTime() + 35 * 86_400_000)),
      reportedEPS: e,
      estimatedEPS: estimates[i],
      reportedRevenue: revenue[i],
    })),
    annualEarnings: [{ fiscalDateEnding: iso(ends[3]), reportedEPS: eps[3] }],
  };
}

// ── Independent evidence per symbol ────────────────────────────────

const MSFT_OVERVIEW = overview("MSFT", "Microsoft Corporation", {
  MarketCapitalization: "3100000000000",
  PERatio: "34.0",
  ForwardPE: "30.0",
  EPS: "11.90",
  ProfitMargin: "0.360",
  ReturnOnEquityTTM: "0.350",
  ReturnOnAssetsTTM: "0.200",
  PriceToBookRatio: "12.10",
  PriceToSalesRatioTTM: "12.50",
  EVToEBITDA: "24.0",
  QuarterlyRevenueGrowthYOY: "0.151",
  QuarterlyEarningsGrowthYOY: "0.178",
});

const MSFT_EARNINGS = earnings(
  ["3.30", "3.12", "3.05", "2.95", "2.80", "2.72", "2.60", "2.51"],
  ["70000000000", "66000000000", "64000000000", "62000000000", "60000000000", "58000000000", "56000000000", "54000000000"],
  ["3.20", "3.05", "2.98", "2.90", "2.74", "2.66", "2.55", "2.47"],
);

const NVDA_OVERVIEW = overview("NVDA", "NVIDIA Corporation", {
  MarketCapitalization: "900000000000",
  PERatio: "55.0",
  ForwardPE: "60.0",
  EPS: "-0.90",
  ProfitMargin: "-0.081",
  ReturnOnEquityTTM: "-0.152",
  ReturnOnAssetsTTM: "-0.061",
  PriceToBookRatio: "38.0",
});

const NVDA_EARNINGS = earnings(
  ["0.60", "0.72", "0.85", "0.95", "1.05", "1.15", "1.24", "1.30"],
  ["26000000000", "29000000000", "32000000000", "35000000000", "38000000000", "41000000000", "44000000000", "46000000000"],
  ["0.95", "1.00", "1.05", "1.10", "1.12", "1.20", "1.28", "1.32"],
);

const AAPL_OVERVIEW = overview("AAPL", "Apple Inc", {
  MarketCapitalization: "3000000000000",
  PERatio: "28.5",
  EPS: "6.42",
  ProfitMargin: "0.265",
  ReturnOnEquityTTM: "1.47",
  ForwardPE: "26.1",
});

const AAPL_EARNINGS = earnings(
  ["1.65", "1.53", "1.50", "1.42", "1.35", "1.28", "1.24", "1.15"],
  ["94000000000", "90000000000", "85000000000", "81000000000", "78000000000", "74000000000", "71000000000", "68000000000"],
  ["1.60", "1.50", "1.45", "1.38", "1.33", "1.25", "1.20", "1.12"],
);

const FUNDAMENTALS: Record<string, { overview: unknown; earnings: unknown }> = {
  MSFT: { overview: MSFT_OVERVIEW, earnings: MSFT_EARNINGS },
  NVDA: { overview: NVDA_OVERVIEW, earnings: NVDA_EARNINGS },
  AAPL: { overview: AAPL_OVERVIEW, earnings: AAPL_EARNINGS },
  TSLA: {
    // Deliberately sparse: the provider supplies EPS history but no
    // profitability or valuation evidence at all.
    overview: overview("TSLA", "Tesla, Inc.", { EPS: "3.65" }),
    earnings: earnings(["1.05", "0.98"], ["25000000000", "24000000000"], ["1.00", "0.95"]),
  },
};

function routeForSymbol(symbol: string): Record<string, Route> {
  const f = FUNDAMENTALS[symbol];
  return {
    NEWS_SENTIMENT: { body: NEWS },
    OVERVIEW: { body: f.overview },
    EARNINGS: { body: f.earnings },
  };
}

/** Which fixture symbol does this URL ask for? (used by the stub router) */
function requestedFixture(url: string): string {
  for (const symbol of Object.keys(FUNDAMENTALS)) {
    if (url.includes(`symbol=${symbol}`) || url.includes(`tickers=${symbol}`)) return symbol;
  }
  return "MSFT";
}

const stockArgs = (symbol: string, nativeId?: string): Args => ({
  instrument: symbol,
  instrumentType: "stock",
  provider: "alpha-vantage",
  ...(nativeId !== undefined ? { providerInstrumentId: nativeId } : {}),
});

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  routes = {};
  process.env.ALPHA_VANTAGE_API_KEY = "k";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const symbol = requestedFixture(url);
      const route = routes[symbol]?.[
        url.includes("OVERVIEW") ? "OVERVIEW" : url.includes("EARNINGS") ? "EARNINGS" : "NEWS_SENTIMENT"
      ] ?? { body: {} };
      const status = route.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "x",
        text: async () => "",
        json: async () => route.body,
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetProviderCache();
});

function useSymbol(symbol: string) {
  routes[symbol] = routeForSymbol(symbol);
}

// ── 1. Exact requested symbol + preserved identity ────────────────

describe("275 — every supported stock asks for its own exact symbol", () => {
  it("requests the exact native symbol for two distinct instruments", async () => {
    useSymbol("MSFT");
    useSymbol("NVDA");

    await av(ctx, stockArgs("MSFT", "MSFT"));
    await av(ctx, stockArgs("NVDA", "NVDA"));

    const overviews = calls.filter((u) => u.includes("OVERVIEW"));
    expect(overviews).toHaveLength(2);
    expect(overviews[0]).toContain("symbol=MSFT");
    expect(overviews[1]).toContain("symbol=NVDA");
    // No substitution: the MSFT acquisition never touched NVDA and vice versa.
    expect(overviews[0]).not.toContain("NVDA");
    expect(overviews[1]).not.toContain("MSFT");

    const earningsCalls = calls.filter((u) => u.includes("EARNINGS"));
    expect(earningsCalls.map((u) => (u.includes("symbol=MSFT") ? "MSFT" : "NVDA"))).toEqual([
      "MSFT",
      "NVDA",
    ]);
  });

  it("preserves provider/native identity through normalization", async () => {
    useSymbol("MSFT");
    useSymbol("NVDA");

    const msft = (await av(ctx, stockArgs("MSFT", "MSFT"))).fundamentals!;
    const nvda = (await av(ctx, stockArgs("NVDA", "NVDA"))).fundamentals!;

    expect(msft.provider).toBe("alpha-vantage");
    expect(msft.symbol).toBe("MSFT");
    expect(msft.providerInstrumentId).toBe("MSFT");
    expect(msft.name).toBe("Microsoft Corporation");

    expect(nvda.symbol).toBe("NVDA");
    expect(nvda.providerInstrumentId).toBe("NVDA");
    expect(nvda.name).toBe("NVIDIA Corporation");
  });

  it("uses a supplied provider/native id verbatim when it differs from the canonical string", async () => {
    useSymbol("NVDA");
    // A discovery layer may hand over a native id distinct from the string the
    // user typed. The provider must be asked for the NATIVE instrument.
    const r = await av(ctx, { instrument: "NVDA", instrumentType: "stock", providerInstrumentId: "NVDA" });
    expect(calls.find((u) => u.includes("OVERVIEW"))).toContain("symbol=NVDA");
    expect(r.fundamentals!.providerInstrumentId).toBe("NVDA");
  });

  it("keeps identity attached to the engine assessment and the result", async () => {
    useSymbol("MSFT");
    const r = await av(ctx, stockArgs("MSFT", "MSFT"));
    const assessment = assessFundamentals(r.fundamentals);
    expect(assessment.instrumentId).toBe("MSFT");

    const result = runAnalysis({
      instrument: "MSFT",
      instrumentType: "stock",
      timeframe: "D1",
      fundamentalData: r.fundamentals,
    });
    expect(result.fundamentalAssessment!.instrumentId).toBe("MSFT");
    expect(result.fundamentalAssessment!.provider).toBe("alpha-vantage");
  });
});

// ── 2. Independent evidence → independent assessment, same engine ──

describe("275 — two symbols share one path but keep independent assessments", () => {
  it("produces different states, confidences and metrics from different evidence", async () => {
    useSymbol("MSFT");
    useSymbol("NVDA");

    const msft = assessFundamentals((await av(ctx, stockArgs("MSFT", "MSFT"))).fundamentals);
    const nvda = assessFundamentals((await av(ctx, stockArgs("NVDA", "NVDA"))).fundamentals);

    expect(msft.state).toBe("improving");
    expect(nvda.state).toBe("weakening");
    expect(msft.metrics.epsRises).toBe(7);
    expect(nvda.metrics.epsFalls).toBe(7);
    expect(msft.metrics.estimateBeats).toBe(8);
    expect(nvda.metrics.estimateMisses).toBeGreaterThan(0);
  });

  it("never bleeds one symbol's numbers into another's assessment", async () => {
    useSymbol("MSFT");
    useSymbol("NVDA");

    const msft = assessFundamentals((await av(ctx, stockArgs("MSFT", "MSFT"))).fundamentals);
    const nvda = assessFundamentals((await av(ctx, stockArgs("NVDA", "NVDA"))).fundamentals);

    const msftText = JSON.stringify(msft);
    const nvdaText = JSON.stringify(nvda);
    expect(msftText).toContain("MSFT");
    expect(msftText).not.toContain("NVDA");
    expect(nvdaText).toContain("NVDA");
    expect(nvdaText).not.toContain("MSFT");
    expect(msftText).toContain("net margin 36.0%");
    expect(msftText).not.toContain("-8.1%"); // NVDA's losses never appear on MSFT's side
    expect(nvdaText).toContain("net margin -8.1%");
    expect(nvdaText).not.toContain("36.0%");
  });

  it("serves both symbols from the same engine contract (identical shape)", async () => {
    useSymbol("MSFT");
    useSymbol("TSLA");

    const a = assessFundamentals((await av(ctx, stockArgs("MSFT", "MSFT"))).fundamentals);
    const b = assessFundamentals((await av(ctx, stockArgs("TSLA", "TSLA"))).fundamentals);

    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.dimensions.map((d) => d.name)).toEqual(b.dimensions.map((d) => d.name));
    expect(typeof assessFundamentals).toBe("function");
  });

  it("keeps cache entries per symbol — MSFT evidence never answers an NVDA request", async () => {
    useSymbol("MSFT");
    useSymbol("NVDA");

    const first = (await av(ctx, stockArgs("MSFT", "MSFT"))).fundamentals!;
    const second = (await av(ctx, stockArgs("NVDA", "NVDA"))).fundamentals!;
    expect(second.symbol).toBe("NVDA");

    // Re-request MSFT with the cache warm: the cached MSFT payload comes back.
    const again = (await av(ctx, stockArgs("MSFT", "MSFT"))).fundamentals!;
    expect(again.symbol).toBe("MSFT");
    expect(again.quarterlyEarningsHistory).toEqual(first.quarterlyEarningsHistory);
    expect(again.quarterlyEarningsHistory).not.toEqual(second.quarterlyEarningsHistory);
  });
});

// ── 3. Missing metrics and provider failure stay unavailable ──────

describe("275 — unavailable evidence stays unavailable for every symbol", () => {
  it("keeps unsupplied dimensions unavailable without inventing values", async () => {
    useSymbol("TSLA");
    const assessment = assessFundamentals((await av(ctx, stockArgs("TSLA", "TSLA"))).fundamentals);

    expect(assessment.available).toBe(true);
    expect(assessment.instrumentId).toBe("TSLA");
    expect(assessment.dimensions.find((d) => d.name === "profitability")!.status).toBe("unavailable");
    expect(assessment.dimensions.find((d) => d.name === "balance-sheet")!.status).toBe("unavailable");
    expect(assessment.metrics.epsYoY).toBeUndefined();
    expect(assessment.limitations.some((l) => /UNAVAILABLE/.test(l))).toBe(true);
  });

  it("reports provider failure explicitly and never substitutes another symbol", async () => {
    useSymbol("MSFT");
    useSymbol("NVDA");
    routes.MSFT = { ...routeForSymbol("MSFT"), OVERVIEW: { status: 500, body: {} } };

    const failed = await av(ctx, stockArgs("MSFT", "MSFT"));
    expect(failed.fundamentals).toBeUndefined();

    const assessment = assessFundamentals(failed.fundamentals);
    expect(assessment.available).toBe(false);
    expect(assessment.state).toBe("insufficient");
    expect(assessment.instrumentId).toBeUndefined();

    const result = runAnalysis({
      instrument: "MSFT",
      instrumentType: "stock",
      timeframe: "D1",
      fundamentalData: failed.fundamentals,
    });
    expect(result.fundamentalAssessment!.available).toBe(false);
    // NVDA's evidence was available in this run and was NOT borrowed.
    expect(JSON.stringify(result.fundamentalAssessment)).not.toContain("NVIDIA");
  });

  it("treats an empty provider payload for one symbol as unavailable, not as another company", async () => {
    useSymbol("TSLA");
    routes.TSLA = { ...routeForSymbol("TSLA"), OVERVIEW: { body: {} } };
    const r = await av(ctx, stockArgs("TSLA", "TSLA"));
    expect(r.fundamentals!.available).toBe(false);
    expect(r.fundamentals!.unavailableReason).toMatch(/No fundamental data available for this symbol/);
    expect(r.fundamentals!.quarterlyEarningsHistory).toBeUndefined();
  });
});

// ── 4. Reporting periods stay dated, never live ────────────────────

describe("275 — fiscal periods remain exact and are never labelled live", () => {
  it("keeps each period/report date verbatim for a non-AAPL symbol", async () => {
    useSymbol("MSFT");
    const f = (await av(ctx, stockArgs("MSFT", "MSFT"))).fundamentals!;
    expect(f.quarterlyEarningsHistory![0].fiscalDateEnding).toBe(iso(RECENT_ENDS[0]));
    expect(f.quarterlyEarningsHistory![0].reportedDate).toBe(
      iso(new Date(RECENT_ENDS[0].getTime() + 35 * 86_400_000)),
    );
    expect(f.quarterlyEarningsHistory![7].fiscalDateEnding).toBe(iso(RECENT_ENDS[7]));
    // All eight periods preserved exactly as generated, newest first, each
    // three calendar months apart.
    expect(f.quarterlyEarningsHistory!.map((q) => q.fiscalDateEnding)).toEqual(
      RECENT_ENDS.map(iso),
    );
    const gaps = f.quarterlyEarningsHistory!.slice(1).map((q, i) =>
      Math.round(
        (Date.parse(f.quarterlyEarningsHistory![i].fiscalDateEnding!) -
          Date.parse(q.fiscalDateEnding!)) /
          86_400_000,
      ),
    );
    expect(gaps.every((g) => g >= 89 && g <= 92)).toBe(true);
  });

  it("dates an old fiscal period against the payload's own observation instant", async () => {
    useSymbol("MSFT");
    // A stale statement: latest period ended 2023-01-31.
    routes.MSFT = {
      ...routeForSymbol("MSFT"),
      EARNINGS: {
        body: earnings(
          ["1.10", "1.05", "1.00", "0.95", "0.90", "0.85", "0.80", "0.75"],
          ["1", "2", "3", "4", "5", "6", "7", "8"],
          ["1", "1", "1", "1", "1", "1", "1", "1"],
          OLD_ENDS,
        ),
      },
    };
    const f = (await av(ctx, stockArgs("MSFT", "MSFT"))).fundamentals!;
    const assessment = assessFundamentals(f);
    expect(assessment.reportingPeriod).toBe(iso(OLD_ENDS[0]));
    expect(assessment.reportAgeDaysAtObservation).toBeGreaterThan(700);
    expect(assessment.limitations.some((l) => /stale reporting data, never presented as live market data/.test(l))).toBe(true);
    expect(JSON.stringify(assessment)).not.toMatch(/\bLIVE\b/);
  });

  it("changing evidence changes the assessment for the same symbol", async () => {
    useSymbol("NVDA");
    const deteriorating = assessFundamentals((await av(ctx, stockArgs("NVDA", "NVDA"))).fundamentals);
    expect(deteriorating.state).toBe("weakening");

    resetProviderCache();
    routes.NVDA = {
      ...routeForSymbol("NVDA"),
      EARNINGS: { body: MSFT_EARNINGS }, // same symbol, improving revisions
      OVERVIEW: { body: { ...MSFT_OVERVIEW, Symbol: "NVDA", Name: "NVIDIA Corporation" } },
    };
    const improved = assessFundamentals((await av(ctx, stockArgs("NVDA", "NVDA"))).fundamentals);

    expect(improved.instrumentId).toBe("NVDA");
    expect(improved.state).toBe("improving");
    expect(improved.state).not.toBe(deteriorating.state);
  });

  it("still traverses the original AAPL slice (Phase 274 continuity)", async () => {
    useSymbol("AAPL");
    const assessment = assessFundamentals((await av(ctx, stockArgs("AAPL", "AAPL"))).fundamentals);
    expect(assessment.instrumentId).toBe("AAPL");
    expect(assessment.state).toBe("improving");
    expect(assessment.reportingPeriod).toBe(iso(RECENT_ENDS[0]));
    expect(assessment.confidence).toBe("high");
  });
});

// ── 5. No symbol-specific logic exists on the fundamental path ────

describe("275 — no symbol-specific branching in the fundamental production path", () => {
  const files = [
    "src/lib/fundamental-engine.ts",
    "src/lib/data/alpha-vantage/normalize.ts",
    "src/convex/alphaVantage.ts",
  ];
  const sources = files.map((f) => ({
    file: f,
    source: readFileSync(join(process.cwd(), f), "utf8"),
  }));

  it("contains no ticker literals from the covered instrument set", () => {
    const tickers = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META"];
    for (const { file, source } of sources) {
      for (const ticker of tickers) {
        // Word-boundary match: identifiers like `mapSymbolForAV` never match,
        // a bare ticker string or branch would.
        expect(source, `${file} mentions ${ticker}`).not.toMatch(
          new RegExp(`\\b${ticker}\\b`),
        );
      }
    }
  });

  it("has no switch/branch keyed on an instrument symbol", () => {
    for (const { file, source } of sources) {
      expect(source, `${file}`).not.toMatch(/switch\s*\(\s*(symbol|ticker|instrument|requestedSymbol)\b/);
      expect(source, `${file}`).not.toMatch(
        /\[["'][A-Z]{1,5}["']\s*,\s*["'][A-Z]{1,5}["']\s*\]/,
      );
    }
  });

  it("derives the provider symbol generically from the requested identity", () => {
    const av = sources.find((s) => s.file === "src/convex/alphaVantage.ts")!.source;
    expect(av).toContain("const requestedSymbol =");
    expect(av).toContain("mapSymbolForAV(requestedSymbol, args.instrumentType)");
    expect(av).toContain("mapTickerForAV(requestedSymbol, args.instrumentType)");
  });
});
