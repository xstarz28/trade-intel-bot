/**
 * Phase 307 — the three concrete runtime bottlenecks, executed end to end
 * against a STUBBED deployment (test double, never evidence). One full CLI
 * run pins:
 *
 *  C. CRYPTO — the OKX catalog's thin-quote head is 150 rows long (run
 *             36967115649 live shape, longer): no head slice can escape it.
 *             The stride pool must reach the deep rows: BTC-PLN → another
 *             thin quote → the deep candidate, within maxAttempts=3, with
 *             technicalDepth distinguishing a thin series (3 candles) from a
 *             real one (210).
 *  B. STOCK  — window0 plan-restricted → next attempt from window1;
 *              window1 plan-restricted → next attempt from window2; total
 *              analysis attempts stay at maxAttempts.
 *  A. FOREX  — the projection delivers the measurement pipeline: the record's
 *              evidence.fundamental carries the pipeline (acquisition with the
 *              classified past-leg failure) and the ANNOTATION names the
 *              stopping point (stoppedAt=released+actual, leg=failed:timeout).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOST = "stub-dev-307.convex.cloud";

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

// The OKX catalog: a 150-row contiguous thin-quote head (quotes alternate
// PLN/SGD by i%3 so both thin quotes appear inside any stride), with deep
// instruments ONLY at positions 150+. No head slice of <=96 rows can reach
// them; a stride across the full 153-row order does.
const OKX_POOL = ["BTC-PLN"];
for (let i = 1; i < 150; i++) OKX_POOL.push("T" + i + "-" + (i % 3 < 2 ? "PLN" : "SGD"));
OKX_POOL.push("ETH-USD", "SOL-USDT", "XRP-USDT");

// The staged equity catalog: 1920 plan-restricted numeric rows (windows 0 and
// 1), analysable alpha rows at the start of window 2.
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
          transport: { mode: "staged", state: "complete", stageId: "/stocks|307|e2e", stagedRows: 1925, inlineRows: 0 },
        },
        { path: "/commodities", assetClass: "commodity", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 2, failedPage: null },
      ],
      warnings: [],
    };
  if (path === "marketData:readTwelveDataCatalogStage") {
    if (args.stageId === "/stocks|307|e2e") {
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
      // The thin-quote head: real market bytes, a THIN candle series (3
      // points), no usable technical/unified evidence.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        technicalData: { dataPoints: 3 },
        fundamentalSummary: "No crypto-native fundamental evidence was supplied for this instrument.",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false, bias: null, confidence: null }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [],
      } };
    }
    if (native === "EUR/USD" || native === "GBP/JPY" || native === "AUD/CAD") {
      // Live shape: real market+technical+unified; the fundamental assessment
      // is PRESENT but available:false, carrying the 307 pipeline — here the
      // past leg TIMED OUT (classified), so pastFetched=0.
      const sides = native.split("/");
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalAssessment: { available: false, domain: "forex", provider: "tickatlas", state: "unavailable", measurementPipeline: { eventsReceived: 5, releasedWithActual: 0, baseReleasedMatched: 0, quoteReleasedMatched: 0, policyRatesBase: false, policyRatesQuote: false, inflationBase: false, inflationQuote: false, acquisition: { lookbackDays: 40, upcomingFetched: 5, pastFetched: 0, pastWithActual: 0, merged: 0, pastLeg: "failed:timeout" }, availability: false } },
        fundamentalSummary: "No released macroeconomic measurement was supplied for " + sides[0] + " or " + sides[1] + " — no two-sided fundamental assessment is produced, and none is invented.",
        unifiedIntelligence: fullUI(),
        providerDiagnostics: [],
      } };
    }
    if (native.startsWith("0") && Number.isFinite(Number(native))) {
      // The staged equity catalog's head (zero-padded numeric tickers): the
      // plan-restricted OHLCV leg produced nothing — no price snapshot, and
      // the leg's own 404 sentence.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        provider,
        providerInstrumentId: native,
        technicalData: null,
        fundamentalAssessment: { available: true, domain: "stock", provider: "filings", state: "stable" },
        fundamentalSummary: "fundamental-only read",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false }, limitations: [PLAN_404] },
        providerDiagnostics: [
          { provider: "twelve-data", dataset: "ohlcv", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, reason: PLAN_404 },
        ],
      } };
    }
    if (native === "XAU/USD") {
      // The live 36957205385 shape: the plan-restricted OHLCV leg produced
      // nothing — the record keeps its OWN evidence (workstream D).
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        provider,
        providerInstrumentId: native,
        technicalData: null,
        fundamentalAssessment: { available: true, domain: "commodity", provider: "CFTC + US Treasury", state: "weakening" },
        fundamentalSummary: "fundamental-only read",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false }, limitations: [PLAN_404] },
        providerDiagnostics: [
          { provider: "twelve-data", dataset: "ohlcv", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, reason: PLAN_404 },
        ],
      } };
    }
    if (native === "WTI/USD") {
      // Second commodity attempt also UNAVAILABLE, so the reported verdict is
      // the FIRST attempt's (XAU/USD) and the record must describe XAU/USD.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalAssessment: { available: true, domain: "commodity", provider: "twelve-data", state: "improving" },
        fundamentalSummary: "domain fundamental read.",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false, bias: null, confidence: null }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [],
      } };
    }
    // The analysable equities and deep crypto rows deliver the full shape.
    const fa =
      okxSet
        ? { available: true, domain: "crypto", provider: "okx", state: "stable" }
        : { available: true, domain: "stock", provider: "filings", state: "stable" };
    return { status: "DELIVERED", entitlement: { charged: false }, result: {
      ...base(native, provider),
      fundamentalAssessment: fa,
      fundamentalSummary: "domain fundamental read.",
      unifiedIntelligence: fullUI(),
      providerDiagnostics: [],
    } };
  }
  return {};
};

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.pathname === "/version") return new Response("stub-version-307", { status: 200 });
  if (u.pathname === "/api/query" || u.pathname === "/api/action") {
    const body = JSON.parse(String(init.body ?? "{}"));
    const value = respond(body.path, body.args);
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
  dir = mkdtempSync(join(tmpdir(), "smoke-cli-307-"));
  outPath = join(dir, "smoke-307.json");
  const stubPath = join(dir, "stub-fetch-307.mjs");
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
          XSTARZ_SMOKE_SOURCE_COMMIT: "e".repeat(40),
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

describe("phase 307 e2e — C: the stride pool reaches the deep candidate inside the fixed budget", () => {
  it("BTC-PLN -> another thin quote -> the deep candidate, in exactly 3 attempts", () => {
    const crypto = domainOf("CRYPTO");
    const analysis = analysisOf(crypto);
    const instruments = analysis.map((a) => String(a.instrument));
    // attempt 1: the thin head's first row; attempt 2: ANOTHER thin quote
    // (the first zero-strike row inside the stride); attempt 3: the deep
    // candidate at provider position 150 — outside any head slice.
    expect(instruments).toEqual(["BTC-PLN", "T2-SGD", "ETH-USD"]);
    expect(analysis.length).toBe(3); // maxAttempts respected
    expect(crypto.headline).toBe("PASS");
    // both thin quotes were learned as strikes during the run
    expect(reportOf().learnedObservations.technicalStrikes["quote:PLN"]).toBeGreaterThanOrEqual(1);
    expect(reportOf().learnedObservations.technicalStrikes["quote:SGD"]).toBeGreaterThanOrEqual(1);
    // technicalDepth is first-class AND discriminating: thin series vs real
    expect(analysis[0].technicalDepth).toBe(3);
    expect(analysis[1].technicalDepth).toBe(3);
    expect(analysis[2].technicalDepth).toBe(210);
    // workstream D binding: the record describes its OWN (reporting) attempt
    expect(crypto.providerInstrumentId).toBe("ETH-USD");
    expect(crypto.evidence.technical.available).toBe(true);
  });
});

describe("phase 307 e2e — B: window strikes move the ACTUAL attempts across windows", () => {
  it("window0 plan-restricted -> window1 candidate -> window2 candidate, <= maxAttempts", () => {
    const stock = domainOf("STOCK");
    const analysis = analysisOf(stock);
    expect(analysis.map((a) => String(a.instrument))).toEqual(["00000", "00960", "AAC"]);
    expect(analysis.length).toBe(3);
    expect(analysis[0].reason).toContain("Grow or Venture plan");
    expect(analysis[1].reason).toContain("Grow or Venture plan");
    expect(analysis[2].verdict).toBe("PASS");
    expect(stock.headline).toBe("PASS");
    // provenance: the windows were pre-assembled before any attempt
    expect(stock.discovery.stagedSelection.windowsRead).toBe(3);
    expect(stock.discovery.stagedSelection.stageId).toBe("/stocks|307|e2e");
    expect(stock.discovery.stagedSelection.window).toContain("scan windows 1..3");
  });
});

describe("phase 307 e2e — A: the projection delivers the pipeline; the annotation names the stop", () => {
  it("the forex record carries the pipeline with the classified past-leg failure", () => {
    const forex = domainOf("FOREX");
    expect(forex.headline).toBe("UNAVAILABLE");
    // reported attempt = the first (equal-severity) — the record describes IT
    expect(forex.providerInstrumentId).toBe("EUR/USD");
    expect(forex.reason).toContain("EUR");
    expect(forex.reason).toContain("USD");
    // THE projection: the pipeline travels into the record's evidence
    const pipeline = forex.evidence.fundamental.measurementPipeline;
    expect(pipeline).not.toBeNull();
    expect(pipeline.eventsReceived).toBe(5);
    expect(pipeline.releasedWithActual).toBe(0);
    expect(pipeline.acquisition.lookbackDays).toBe(40);
    expect(pipeline.acquisition.pastFetched).toBe(0);
    expect(pipeline.acquisition.pastLeg).toBe("failed:timeout");
    expect(pipeline.availability).toBe(false);
  });

  it("the annotation names the stopping point (rows -> released+actual -> ...)", () => {
    // the FOREX annotation's informational digest shows the pipeline with the
    // classified past leg and the named stopping stage
    expect(stdout).toMatch(/FOREX UNAVAILABLE[\s\S]*?pipeline\[events=5 releasedWithActual=0[\s\S]*?leg=failed:timeout[\s\S]*?stoppedAt=released\+actual/);
  });
});

describe("phase 307 e2e — XAU/USD + EIA remain intact", () => {
  it("the commodity domain still runs the exact gold route and its own record", () => {
    const commodity = domainOf("COMMODITY");
    expect(analysisOf(commodity)[0].instrument).toBe("XAU/USD");
    expect(commodity.reason).toContain("Grow or Venture plan"); // its OWN failing leg
    expect(commodity.evidence.market.providerInstrumentId).toBe("XAU/USD");
  });
});
