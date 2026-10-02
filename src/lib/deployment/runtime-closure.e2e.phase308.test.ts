/**
 * Phase 308 — closure e2e: ONE full CLI run (stubbed deployment; test double,
 * never evidence) proving the coupled runtime seams end to end:
 *
 *  B. STOCK  — attempts CROSS provider-order windows (windowIndex on the
 *              attempt trail AND on the record), inside maxAttempts.
 *  C. CRYPTO — stride traversal reaches the deep candidate; technicalDepth is
 *              3 (thin) vs 210 (real); the annotation digest carries depth=.
 *  A. FOREX  — when the calendar LEG never delivered, the assessment proves it:
 *              pipeline.calendarDelivered=false, stoppedAt=calendar-leg on the
 *              annotation (acquisition failure != provider gap).
 *  D. COMMODITY — the XAU/USD plan-restricted OHLCV leg is a PLAN_RESTRICTED
 *              block (never a generic provider error), the auxiliary Alpha
 *              Vantage slash-format news failure rides alongside WITHOUT
 *              corrupting the intact CFTC/Treasury fundamental, and the
 *              verdict stays UNAVAILABLE (never a timeout-dressed PASS).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOST = "stub-dev-308.convex.cloud";

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
const AV_NEWS_FAIL = "Alpha Vantage news fetch failed: invalid ticker XAU/USD (slash-format not accepted by the news endpoint)";

const OKX_POOL = ["BTC-PLN"];
for (let i = 1; i < 150; i++) OKX_POOL.push("T" + i + "-" + (i % 3 < 2 ? "PLN" : "SGD"));
OKX_POOL.push("ETH-USD", "SOL-USDT", "XRP-USDT");

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
          transport: { mode: "staged", state: "complete", stageId: "/stocks|308|e2e", stagedRows: 1925, inlineRows: 0 },
        },
        { path: "/commodities", assetClass: "commodity", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 2, failedPage: null },
      ],
      warnings: [],
    };
  if (path === "marketData:readTwelveDataCatalogStage") {
    if (args.stageId === "/stocks|308|e2e") {
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
      // Thin-quote head: real market bytes, a THIN series, no technical/unified.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        technicalData: { dataPoints: 3 },
        fundamentalSummary: "No crypto-native fundamental evidence was supplied for this instrument.",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false, bias: null, confidence: null }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [],
      } };
    }
    if (native === "EUR/USD") {
      // The 307/308 forex shape: market+technical+unified fine; the calendar
      // LEG never delivered (acquisition failure), so the assessment's own
      // pipeline proves the transport fact — calendarDelivered=false.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalAssessment: { available: false, domain: "forex", provider: "tickatlas", state: "unavailable", measurementPipeline: { calendarDelivered: false, eventsReceived: 0, releasedWithActual: 0, baseReleasedMatched: 0, quoteReleasedMatched: 0, policyRatesBase: false, policyRatesQuote: false, inflationBase: false, inflationQuote: false, acquisition: {}, availability: false } },
        fundamentalSummary: "No released macroeconomic measurement was supplied for EUR or USD — the economic-calendar provider leg delivered no evidence for this analysis (acquisition failed), which is a transport fact, not a measurement of the provider's catalog.",
        unifiedIntelligence: fullUI(),
        providerDiagnostics: [],
      } };
    }
    if (native === "GBP/JPY" || native === "AUD/CAD") {
      // A delivered calendar with a timed-out past leg: the 307 classified shape.
      const sides = native.split("/");
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalAssessment: { available: false, domain: "forex", provider: "tickatlas", state: "unavailable", measurementPipeline: { calendarDelivered: true, eventsReceived: 5, releasedWithActual: 0, baseReleasedMatched: 0, quoteReleasedMatched: 0, policyRatesBase: false, policyRatesQuote: false, inflationBase: false, inflationQuote: false, acquisition: { lookbackDays: 40, upcomingFetched: 5, pastFetched: 0, pastWithActual: 0, merged: 0, pastLeg: "failed:timeout" }, availability: false } },
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
          { provider: "twelve-data", dataset: "ohlcv", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, observedAt: null, reason: PLAN_404 },
        ],
      } };
    }
    if (native === "XAU/USD") {
      // The live XAU shape: plan-restricted OHLCV leg + auxiliary AV news
      // slash-format failure; the CFTC/Treasury fundamental stays intact.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        provider,
        providerInstrumentId: native,
        technicalData: null,
        fundamentalAssessment: { available: true, domain: "commodity", provider: "CFTC + US Treasury", state: "weakening", evidence: [{ metric: "treasury_real_yield", provider: "US Treasury", source: "daily par yields", value: 2.1 }] },
        fundamentalSummary: "fundamental-only read",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false }, limitations: [PLAN_404] },
        providerDiagnostics: [
          { provider: "twelve-data", dataset: "ohlcv", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, observedAt: null, reason: PLAN_404 },
          { provider: "alpha-vantage", dataset: "news", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, observedAt: null, reason: AV_NEWS_FAIL },
        ],
      } };
    }
    if (native === "WTI/USD") {
      // Second commodity attempt also UNAVAILABLE (thin technical), so the
      // REPORTED verdict is the FIRST attempt's (XAU/USD).
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalAssessment: { available: true, domain: "commodity", provider: "twelve-data", state: "improving" },
        fundamentalSummary: "domain fundamental read.",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false, bias: null, confidence: null }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [],
      } };
    }
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
  if (u.pathname === "/version") return new Response("stub-version-308", { status: 200 });
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
  dir = mkdtempSync(join(tmpdir(), "smoke-cli-308-"));
  outPath = join(dir, "smoke-308.json");
  const stubPath = join(dir, "stub-fetch-308.mjs");
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
          XSTARZ_SMOKE_SOURCE_COMMIT: "f".repeat(40),
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

describe("phase 308 e2e — B: the attempt trail crosses provider-order windows, with window provenance", () => {
  it("window 0 -> 1 -> 2 on the ATTEMPTS, windowIndex on attempts and record, <= maxAttempts", () => {
    const stock = domainOf("STOCK");
    const analysis = analysisOf(stock);
    expect(analysis.map((a) => String(a.instrument))).toEqual(["00000", "00960", "AAC"]);
    expect(analysis.length).toBe(3);
    expect(analysis[0].windowIndex).toBe(0);
    expect(analysis[1].windowIndex).toBe(1);
    expect(analysis[2].windowIndex).toBe(2);
    expect(analysis[0].reason).toContain("Grow or Venture plan");
    expect(analysis[2].verdict).toBe("PASS");
    expect(stock.headline).toBe("PASS");
    // the REPORTED record's window is the passing attempt's window
    expect(stock.windowIndex).toBe(2);
    expect(stock.discovery.stagedSelection.windowsRead).toBe(3);
    expect(stock.discovery.stagedSelection.stageId).toBe("/stocks|308|e2e");
  });
});

describe("phase 308 e2e — C: stride progression with discriminating technical depth", () => {
  it("thin head -> other thin quote -> deep candidate; depth 3/3/210; digest carries depth", () => {
    const crypto = domainOf("CRYPTO");
    const analysis = analysisOf(crypto);
    expect(analysis.map((a) => String(a.instrument))).toEqual(["BTC-PLN", "T2-SGD", "ETH-USD"]);
    expect(analysis.map((a) => (a as { technicalDepth?: number }).technicalDepth)).toEqual([3, 3, 210]);
    expect(crypto.headline).toBe("PASS");
    expect(crypto.windowIndex).toBeNull(); // okx rows carry no staged window
    expect(reportOf().learnedObservations.technicalStrikes["quote:PLN"]).toBeGreaterThanOrEqual(1);
    expect(reportOf().learnedObservations.technicalStrikes["quote:SGD"]).toBeGreaterThanOrEqual(1);
    // the record-level annotation digest exposes the depth
    expect(stdout).toMatch(/CRYPTO PASS[\s\S]*?depth=210/);
  });
});

describe("phase 308 e2e — A: acquisition failure is distinguishable from a provider gap", () => {
  it("calendar leg never delivered => stoppedAt=calendar-leg on the annotation, pipeline on the record", () => {
    const forex = domainOf("FOREX");
    const analysis = analysisOf(forex);
    expect(analysis[0].instrument).toBe("EUR/USD");
    const pipeline = forex.evidence.fundamental.measurementPipeline;
    expect(pipeline.calendarDelivered).toBe(false);
    expect(pipeline.acquisition).toEqual({}); // nothing invented
    expect(pipeline.availability).toBe(false);
    expect(forex.headline).toBe("UNAVAILABLE"); // never dressed up
    expect(stdout).toMatch(/FOREX UNAVAILABLE[\s\S]*?pipeline\[.*stoppedAt=calendar-leg/);
  });

  it("delivered calendar with a timed-out past leg => the ATTEMPT prose names its own sides (D binding)", () => {
    const forex = domainOf("FOREX");
    const gapAttempt = analysisOf(forex).find((a) => String(a.instrument) === "GBP/JPY");
    expect(gapAttempt).toBeTruthy();
    expect(gapAttempt!.verdict).toBe("UNAVAILABLE");
    // the attempt's reason names GBP/JPY's OWN sides — never another pair's
    expect(String(gapAttempt!.reason)).toContain("supplied for GBP or JPY");
    expect(String(gapAttempt!.reason)).not.toContain("EUR");
    // the REPORTED record (first/most-severe = EUR/USD) carries the
    // calendar-leg stop in its digest; both classes are visible in ONE run.
    expect(stdout).toMatch(/FOREX UNAVAILABLE[\s\S]*?stoppedAt=calendar-leg/);
    const trail = (forex.attempts as AttemptRecord[]).map((a) => `${a.instrument ?? a.step}=${a.outcome ?? a.verdict}`).join(">");
    expect(trail).toContain("GBP/JPY=UNAVAILABLE");
  });
});

describe("phase 308 e2e — D: XAU plan restriction + auxiliary AV failure, evidence intact, never PASS", () => {
  it("the reported commodity record is XAU/USD's OWN: PLAN_RESTRICTED block, fundamental intact", () => {
    const commodity = domainOf("COMMODITY");
    const analysis = analysisOf(commodity);
    expect(analysis[0].instrument).toBe("XAU/USD");
    expect(commodity.headline).toBe("UNAVAILABLE"); // timeout/404 never becomes PASS
    expect(commodity.providerInstrumentId).toBe("XAU/USD");
    expect(commodity.block).toBe("PLAN_RESTRICTED");
    const legs = commodity.failingLegs.join(" | ");
    expect(legs).toContain("Grow or Venture plan"); // the plan restriction
    expect(legs).toContain("alpha-vantage"); // the auxiliary news failure, visible
    // the CFTC/Treasury fundamental survived the auxiliary failure
    expect(commodity.evidence.fundamental.available).toBe(true);
    expect(commodity.evidence.fundamental.provider).toBe("CFTC + US Treasury");
    expect(commodity.evidence.market.present).toBe(false); // no fabricated market bytes
    expect(commodity.evidence.market.observedAt).toBeNull(); // and no fabricated instant
  });
});
