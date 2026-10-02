/**
 * Phase 306 — the readiness fixes, executed end to end against a STUBBED
 * deployment (test double, never evidence). One full CLI run pins:
 *
 *  B. STOCK  — the provider-order HEAD of the staged equity catalog is a
 *              contiguous plan-restricted block (run 36962601231: `selected=
 *              000,0000,000001`, all `[404] ... Grow or Venture plan`). The
 *              bounded selector must ADVANCE its scan window on that provider
 *              evidence (window0 → window1 → window2) and reach the analysable
 *              candidates further down the SAME provider order — provenance
 *              complete at every window.
 *  C. CRYPTO — the thin-quote head block (PLN/SGD) cannot absorb the budget:
 *              strike learning must steer picks to the zero-strike deep-quote
 *              row BEYOND the old 12-candidate pool window, and every attempt
 *              must carry the candle depth the engine consumed.
 *  D. VERDICT/PROSE — the reported verdict's OWN evidence is what the record
 *              prints, in both directions: a FAIL-first domain must not dress
 *              itself in a later attempt's evidence (FOREX), and a later PASS
 *              must not overwrite an earlier UNAVAILABLE's record (COMMODITY —
 *              the run-36960231581 GBP/JPY contradiction class).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOST = "stub-dev-306.convex.cloud";

const STUB = `
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const base = (native, provider) => ({
  priceSnapshot: { price: 100, timestamp: 1790000000000, source: provider },
  provider,
  providerInstrumentId: native,
  dataCompleteness: "full",
  technicalData: { dataPoints: 210 },
  advancedTechnicalEvidence: { evidenceClasses: ["trend"], confluence: [], conflicts: [], unavailableMetrics: [] },
});

const fullUI = () => ({
  available: true,
  state: "aligned_bullish",
  confluence: { agreement: "aligned", reason: "trend and momentum agree" },
  technical: { available: true, bias: "bullish", confidence: "medium" },
  limitations: [],
});

const PLAN_404 = "No live data: [404] [404] This symbol is available starting with the Grow or Venture plan. Consider upgrading now at https://twelvedata.com/pricing";

// The OKX catalog's live-shaped head: a contiguous thin-quote block, with the
// deep-quote instruments sitting BEYOND the old 12-candidate learning window.
const OKX_POOL = [
  "BTC-PLN", "ETH-PLN", "USDC-PLN", "USDT-SGD", "USDC-SGD", "USDG-SGD",
  "XRP-PLN", "ADA-PLN", "DOGE-PLN", "SOL-SGD", "AVAX-SGD", "LINK-SGD",
  "DOT-PLN", "LTC-PLN", "BCH-SGD",
  "ETH-USD", "SOL-USDT", "XRP-USDT",
];

// The staged equity catalog: 1920 plan-restricted numeric rows (the provider
// order's head block), then analysable alpha rows.
const STAGE_ROWS = [];
for (let i = 0; i < 1920; i++) {
  const sym = "0" + String(i).padStart(4, "0");
  STAGE_ROWS.push({ seq: i, provider: "twelve-data", providerInstrumentId: sym, assetClass: "equity", subType: "equity_common", baseAsset: sym, quoteAsset: "USD", tradingState: "live" });
}
["AAC", "ABC", "ACN", "ADBE", "AEM"].forEach((sym, k) => {
  STAGE_ROWS.push({ seq: 1920 + k, provider: "twelve-data", providerInstrumentId: sym, assetClass: "equity", subType: "equity_common", baseAsset: sym, quoteAsset: "USD", tradingState: "live" });
});

const respond = (path, args) => {
  if (path === "auth:signIn") return { tokens: { token: "anon" } };
  if (path === "entitlements:getMyEntitlement") return { plan: "guest", remaining: 9 };
  if (path === "okx:discoverOkxInstruments")
    return {
      success: true,
      provider: "okx",
      completeness: "COMPLETE",
      instruments: OKX_POOL.map((instId) => ({ instId, state: "live", subType: "spot", assetClass: "crypto" })),
    };
  if (path === "marketData:discoverTwelveDataInstruments")
    return {
      success: true,
      provider: "twelve-data",
      completeness: "PARTIAL",
      pagesFetched: 3,
      totalDiscovered: 5,
      instruments: [
        { providerInstrumentId: "XAU/USD", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
        { providerInstrumentId: "WTI/USD", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
        { providerInstrumentId: "EUR/USD", assetClass: "forex", subType: "forex_spot", tradingState: "TRADING" },
        { providerInstrumentId: "GBP/JPY", assetClass: "forex", subType: "forex_spot", tradingState: "TRADING" },
        { providerInstrumentId: "AUD/CAD", assetClass: "forex", subType: "forex_spot", tradingState: "TRADING" },
      ],
      catalogs: [
        { path: "/forex_pairs", assetClass: "forex", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 3, failedPage: null },
        {
          path: "/stocks",
          assetClass: "equity",
          completeness: "COMPLETE",
          pagesFetched: 1,
          totalDiscovered: 1925,
          failedPage: null,
          transport: { mode: "staged", state: "complete", stageId: "/stocks|306|e2e", stagedRows: 1925, inlineRows: 0 },
        },
        { path: "/commodities", assetClass: "commodity", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 2, failedPage: null },
      ],
      warnings: [],
    };
  if (path === "marketData:readTwelveDataCatalogStage") {
    if (args.stageId === "/stocks|306|e2e") {
      const start = (args.afterSeq ?? -1) + 1;
      const batch = STAGE_ROWS.slice(start, start + (args.limit ?? 480));
      return { rows: batch, hasMore: start + batch.length < STAGE_ROWS.length, nextAfterSeq: start + batch.length - 1, stagedRows: STAGE_ROWS.length, completeness: "COMPLETE", totalDiscovered: STAGE_ROWS.length, transportState: "complete" };
    }
    return { rows: [], hasMore: false, nextAfterSeq: -1, stagedRows: 0, transportState: "complete" };
  }
  if (path === "protectedAnalysis:runProtectedAnalysis") {
    const native = args?.input?.providerInstrumentId ?? "UNKNOWN";
    const okxSet = OKX_POOL.includes(native);
    const provider = okxSet ? "okx" : "twelve-data";
    if (okxSet && native !== "ETH-USD" && native !== "SOL-USDT" && native !== "XRP-USDT") {
      // Live shape: real market bytes, no usable technical series.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalSummary: "No crypto-native fundamental evidence was supplied for this instrument.",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false, bias: null, confidence: null }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [],
      } };
    }
    if (native === "EUR/USD" && !globalThis.__eurFailed) {
      // Workstream D — the forex domain's FIRST attempt fails at the transport
      // level: a FAIL verdict with NO evidence structure at all.
      globalThis.__eurFailed = true;
      return { __httpStatus: 500 };
    }
    if (native === "EUR/USD" || native === "GBP/JPY" || native === "AUD/CAD") {
      // Live shape: real market+technical+unified; the fundamental assessment
      // is PRESENT but available:false, naming ITS OWN pair's sides.
      const sides = native.split("/");
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalAssessment: { available: false, domain: "forex", provider: "tickatlas", state: "unavailable", measurementPipeline: { eventsReceived: 5, releasedWithActual: 0, baseReleasedMatched: 0, quoteReleasedMatched: 0, policyRatesBase: false, policyRatesQuote: false, inflationBase: false, inflationQuote: false, acquisition: { lookbackDays: 40, pastLeg: "ok", pastFetched: 64, pastWithActual: 0, merged: 0, upcomingFetched: 5 }, availability: false } },
        fundamentalSummary: "No released macroeconomic measurement was supplied for " + sides[0] + " or " + sides[1] + " — no two-sided fundamental assessment is produced, and none is invented.",
        unifiedIntelligence: fullUI(),
        providerDiagnostics: [],
      } };
    }
    if (native.startsWith("0") && Number.isFinite(Number(native))) {
      // The staged equity catalog's live head (zero-padded numeric tickers):
      // the plan-restricted OHLCV leg produced nothing — no price snapshot,
      // and the leg's own 404 sentence.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        provider,
        providerInstrumentId: native,
        technicalData: null,
        fundamentalAssessment: { available: true, domain: "stock", provider: "filings", state: "stable" },
        fundamentalSummary: "fundamental-only read",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [
          { provider: "twelve-data", dataset: "ohlcv", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, reason: PLAN_404 },
        ],
      } };
    }
    if (native === "XAU/USD") {
      // Live shape, run 36957205385: the plan-restricted OHLCV leg produced
      // nothing — no price snapshot, and the leg's own 404 sentence. The
      // domain's later WTI/USD PASS must NOT bleed into this record.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        provider,
        providerInstrumentId: native,
        technicalData: null,
        fundamentalAssessment: { available: true, domain: "commodity", provider: "CFTC + US Treasury", state: "weakening" },
        fundamentalSummary: "fundamental-only read",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [
          { provider: "twelve-data", dataset: "ohlcv", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, reason: PLAN_404 },
        ],
      } };
    }
    if (native === "WTI/USD") {
      // The domain's SECOND attempt also lands UNAVAILABLE (market bytes but
      // no usable technical series) — so the REPORTED verdict is the FIRST
      // attempt's (XAU/USD) under most-severe ranking, and the record must
      // describe XAU/USD, not this attempt.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalAssessment: { available: true, domain: "commodity", provider: "twelve-data", state: "improving" },
        fundamentalSummary: "domain fundamental read.",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false, bias: null, confidence: null }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [],
      } };
    }
    // The analysable equities beyond the advanced windows deliver full shape.
    return { status: "DELIVERED", entitlement: { charged: false }, result: {
      ...base(native, provider),
      fundamentalAssessment: { available: true, domain: "stock", provider: "filings", state: "stable" },
      fundamentalSummary: "domain fundamental read.",
      unifiedIntelligence: fullUI(),
      providerDiagnostics: [],
    } };
  }
  return {};
};

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.pathname === "/version") return new Response("stub-version-306", { status: 200 });
  if (u.pathname === "/api/query" || u.pathname === "/api/action") {
    const body = JSON.parse(String(init.body ?? "{}"));
    const value = respond(body.path, body.args);
    if (value && value.__httpStatus) return new Response("server error", { status: value.__httpStatus });
    return json({ status: "success", value });
  }
  return new Response("not found", { status: 404 });
};
`;

let dir: string;
let outPath: string;
let stdout = "";
let status = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "smoke-cli-306-"));
  outPath = join(dir, "smoke-306.json");
  const stubPath = join(dir, "stub-fetch-306.mjs");
  writeFileSync(stubPath, STUB);
  const root = resolve(__dirname, "../../..");
  try {
    stdout = execFileSync(
      process.execPath,
      [
        "--import",
        stubPath,
        join(root, "scripts/development-runtime-smoke.mjs"),
        "--url",
        `https://${HOST}`,
        "--allow-host",
        HOST,
        "--out",
        outPath,
        "--domains",
        "crypto,forex,stock,commodity",
        "--max-attempts",
        "3",
        "--quiet",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "true",
          XSTARZ_SMOKE_SOURCE_COMMIT: "d".repeat(40),
          XSTARZ_SMOKE_PACING_WINDOW_MS: "0",
        },
        timeout: 120_000,
      },
    );
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    stdout = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const reportOf = () => JSON.parse(readFileSync(outPath, "utf8"));
type AttemptRecord = { step: string; [key: string]: unknown };
const domainOf = (label: string) => reportOf().domains.find((d: { label: string }) => d.label === label);
const analysisOf = (d: { attempts: AttemptRecord[] }) => d.attempts.filter((a: AttemptRecord) => a.step === "analysis");

describe("phase 306 e2e — B: the staged selector advances past a plan-restricted head block", () => {
  it("walks window0 → window1 → window2 on provider plan evidence and analyses the reachable candidate", () => {
    const stock = domainOf("STOCK");
    const steps = (stock.attempts as AttemptRecord[]).map((a) => `${a.step}:${a.outcome ?? a.verdict ?? ""}`);
    expect(steps).toContain("selection:window-advanced");
    expect(steps.filter((s: string) => s === "selection:window-advanced")).toHaveLength(2);
    const analysis = analysisOf(stock);
    expect(analysis[0].instrument).toBe("00000"); // the head block's first row
    expect(analysis[0].reason).toContain("Grow or Venture plan");
    // the LAST attempt is a genuinely analysable candidate from the advanced window
    expect(analysis[analysis.length - 1].instrument).toBe("AAC");
    expect(analysis[analysis.length - 1].verdict).toBe("PASS");
    expect(stock.headline).toBe("PASS");
    // provenance survives every advance
    expect(stock.discovery.stagedSelection.windowIndex).toBe(2);
    expect(stock.discovery.stagedSelection.stageId).toBe("/stocks|306|e2e");
    expect(stock.discovery.stagedSelection.selected).toContain("AAC");
  });
});

describe("phase 306 e2e — C: strike steering reaches past the old pool window, with depth", () => {
  it("burns the thin-quote head, then lands on the deep-quote row at pool position 15", () => {
    const crypto = domainOf("CRYPTO");
    const instruments = analysisOf(crypto).map((a) => String(a.instrument));
    expect(instruments[0]).toBe("BTC-PLN");
    // after the PLN strike, the zero-strike SGD rows outrank the struck PLN family;
    // after the SGD strike, the pick reaches ETH-USD — pool position 15 (>12)
    expect(instruments).toEqual(["BTC-PLN", "USDT-SGD", "ETH-USD"]);
    expect(crypto.headline).toBe("PASS");
    expect(reportOf().learnedObservations.technicalStrikes["quote:PLN"]).toBeGreaterThanOrEqual(1);
    expect(reportOf().learnedObservations.technicalStrikes["quote:SGD"]).toBeGreaterThanOrEqual(1);
    // technical depth is first-class on every attempt that delivered market bytes
    for (const a of analysisOf(crypto)) expect(a.technicalDepth).toBe(210);
  });
});

describe("phase 306 e2e — D: the record prints the REPORTED verdict's own evidence", () => {
  it("forex FAIL-first: a later attempt's evidence cannot dress a FAIL verdict", () => {
    const forex = domainOf("FOREX");
    // attempt 1 was a transport-level FAIL with no evidence structure; FAIL is
    // the most severe verdict, so the record must describe THAT attempt.
    expect(forex.headline).toBe("FAIL");
    expect(forex.providerInstrumentId).toBe("EUR/USD");
    expect(forex.legs.market).toBe("not delivered");
    expect(forex.legs.technical).toBe("not delivered");
    expect(forex.evidence).toBeUndefined();
    // no borrowed detail from the later gap attempts
    expect(forex.reason).not.toContain("macroeconomic measurement");
  });

  it("commodity: the reported UNAVAILABLE's record is its OWN, not another attempt's", () => {
    const commodity = domainOf("COMMODITY");
    const analysis = analysisOf(commodity);
    expect(analysis[0].instrument).toBe("XAU/USD");
    expect(analysis[0].verdict).toBe("UNAVAILABLE");
    // the reported verdict is the FIRST (most severe) UNAVAILABLE — XAU/USD —
    // and the record's identity, reason and legs are XAU/USD's OWN (the exact
    // class of the run-36960231581 GBP/JPY contradiction: the reason quoted
    // AUD/CAD while the printed legs belonged to GBP/JPY).
    expect(commodity.headline).toBe("UNAVAILABLE");
    expect(commodity.providerInstrumentId).toBe("XAU/USD");
    expect(commodity.reason).toContain("Grow or Venture plan");
    expect(commodity.legs.market).toBe("none returned");
    expect(commodity.evidence.market.providerInstrumentId).toBe("XAU/USD");
    expect(commodity.failingLegs.join(" ")).toContain("Grow or Venture plan");
    expect(commodity.failingLegs.join(" ")).not.toContain("WTI");
  });
});
