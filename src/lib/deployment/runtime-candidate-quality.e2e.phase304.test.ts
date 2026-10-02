/**
 * Phase 304 — the candidate-quality seams, executed end to end against a STUBBED
 * deployment (the same discipline as the phase-289B CLI e2e: the stub is a test
 * double, never evidence).
 *
 * Each domain fixture reproduces ONE live shape from run 36957205385 and pins
 * the fix the phase shipped:
 *
 *   CRYPTO    — USDC-PLN first with real market bytes and no usable technical
 *               series; the run must TRY THE NEXT candidate (USDC-EUR is the
 *               same learned family and must sink; ETH-USD must be attempted).
 *   FOREX     — EUR/USD with a present-but-`available:false` fundamental and
 *               the verbatim released-measurement sentence: the phase-303 bug
 *               ended the loop after ONE attempt; the run must attempt the next
 *               discovery-ranked pair and the verdict must read
 *               block=EXTERNAL_DATA_GAP.
 *   STOCK     — /stocks staged (COMPLETE, 3 kept, zero inline rows): the
 *               equity candidate must come FROM THE STAGE (bounded window,
 *               provenance recorded), never from thin air.
 *   COMMODITY — XAU/CHF present but the proven route WTI/USD also discovered:
 *               the capability routing must put WTI/USD first and the domain
 *               must close on it (route preference, no whitelist — XAU/CHF
 *               stays in the pool and is attempted by nothing but the probe).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOST = "stub-dev-304.convex.cloud";

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

const respond = (path, args) => {
  if (path === "auth:signIn") return { tokens: { token: "anon" } };
  if (path === "entitlements:getMyEntitlement") return { plan: "guest", remaining: 9 };
  if (path === "okx:discoverOkxInstruments")
    return {
      success: true,
      provider: "okx",
      completeness: "COMPLETE",
      instruments: [
        { instId: "USDC-PLN", state: "live", subType: "spot", assetClass: "crypto" },
        { instId: "USDC-EUR", state: "live", subType: "spot", assetClass: "crypto" },
        { instId: "ETH-USD", state: "live", subType: "spot", assetClass: "crypto" },
      ],
    };
  if (path === "marketData:discoverTwelveDataInstruments")
    return {
      success: true,
      provider: "twelve-data",
      completeness: "PARTIAL",
      pagesFetched: 3,
      totalDiscovered: 6,
      instruments: [
        { providerInstrumentId: "XAU/CHF", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
        { providerInstrumentId: "WTI/USD", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
        { providerInstrumentId: "EUR/USD", assetClass: "forex", subType: "forex_spot", tradingState: "TRADING" },
        { providerInstrumentId: "GBP/USD", assetClass: "forex", subType: "forex_spot", tradingState: "TRADING" },
      ],
      catalogs: [
        { path: "/forex_pairs", assetClass: "forex", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 2, failedPage: null },
        {
          path: "/stocks",
          assetClass: "equity",
          completeness: "COMPLETE",
          pagesFetched: 1,
          totalDiscovered: 2,
          failedPage: null,
          transport: { mode: "staged", state: "complete", stageId: "/stocks|phase304|stub", stagedRows: 2, inlineRows: 0 },
        },
        { path: "/commodities", assetClass: "commodity", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 2, failedPage: null },
      ],
      warnings: [],
    };
  if (path === "marketData:readTwelveDataCatalogStage") {
    if (args.stageId === "/stocks|phase304|stub") {
      const rows = [
        { seq: 0, provider: "twelve-data", providerInstrumentId: "AAPL", assetClass: "equity", subType: "equity_common", baseAsset: "AAPL", quoteAsset: "USD", tradingState: "live" },
        { seq: 1, provider: "twelve-data", providerInstrumentId: "MSFT", assetClass: "equity", subType: "equity_common", baseAsset: "MSFT", quoteAsset: "USD", tradingState: "live" },
      ];
      return { rows, hasMore: false, nextAfterSeq: rows.length - 1, stagedRows: 2, completeness: "COMPLETE", totalDiscovered: 2, transportState: "complete" };
    }
    return { rows: [], hasMore: false, nextAfterSeq: -1, stagedRows: 0 };
  }
  if (path === "protectedAnalysis:runProtectedAnalysis") {
    const native = args?.input?.providerInstrumentId ?? "UNKNOWN";
    const okxSet = native === "USDC-PLN" || native === "USDC-EUR" || native === "ETH-USD";
    const provider = okxSet ? "okx" : "twelve-data";
    if (native === "XAU/CHF") {
      // Live shape, run 36957205385: the plan-restricted OHLCV leg produced
      // nothing — no price snapshot at all, and the leg's own 404 sentence.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        provider,
        providerInstrumentId: native,
        technicalData: null,
        fundamentalAssessment: { available: true, domain: "commodity", provider: "CFTC + US Treasury", state: "weakening" },
        fundamentalSummary: "fundamental-only read",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [
          { provider: "twelve-data", dataset: "ohlcv", mode: "unavailable", acquired: false, attached: false, usedByEngine: false,
            reason: "No live data: [404] [404] This symbol is available starting with the Grow or Venture plan. Consider upgrading now at https://twelvedata.com/pricing" },
        ],
      } };
    }
    if (native === "USDC-PLN" || native === "USDC-EUR") {
      // Live shape: real market bytes, no usable technical series.
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalSummary: "No crypto-native fundamental evidence was supplied for this instrument.",
        unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false, bias: null, confidence: null }, limitations: ["Technical evidence unavailable"] },
        technicalSummary: "Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.",
        providerDiagnostics: [],
      } };
    }
    if (native === "EUR/USD" || native === "GBP/USD") {
      // Live shape: the fundamental assessment is PRESENT but available:false —
      // the exact duality that broke the phase-303 forex gate.
      const sides = native.split("/");
      return { status: "DELIVERED", entitlement: { charged: false }, result: {
        ...base(native, provider),
        fundamentalAssessment: { available: false, domain: "forex", provider: "tickatlas", state: "unavailable" },
        fundamentalSummary: "No released macroeconomic measurement was supplied for " + sides[0] + " or " + sides[1] + " — no two-sided fundamental assessment is produced, and none is invented.",
        unifiedIntelligence: fullUI(),
        providerDiagnostics: [],
      } };
    }
    // WTI/USD, ETH-USD, AAPL, MSFT: the full evidence shape.
    const fa =
      native === "WTI/USD"
        ? { available: true, domain: "commodity", provider: "twelve-data", state: "improving" }
        : native === "ETH-USD"
          ? { available: true, domain: "crypto", provider: "okx", state: "stable" }
          : native === "AAPL" || native === "MSFT"
            ? { available: true, domain: "stock", provider: "filings", state: "stable" }
            : null;
    return { status: "DELIVERED", entitlement: { charged: false }, result: {
      ...base(native, provider),
      fundamentalAssessment: fa,
      fundamentalSummary: fa ? "domain fundamental read." : "no fundamental",
      unifiedIntelligence: fullUI(),
      providerDiagnostics: [],
    } };
  }
  return {};
};

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.pathname === "/version") return new Response("stub-version-304", { status: 200 });
  if (u.pathname === "/api/query" || u.pathname === "/api/action") {
    const body = JSON.parse(String(init.body ?? "{}"));
    return json({ status: "success", value: respond(body.path, body.args) });
  }
  return new Response("not found", { status: 404 });
};
`;

let dir: string;
let outPath: string;
let stdout = "";
let status = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "smoke-cli-304-"));
  outPath = join(dir, "smoke-304.json");
  const stubPath = join(dir, "stub-fetch-304.mjs");
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
          XSTARZ_SMOKE_SOURCE_COMMIT: "c".repeat(40),
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
const domainOf = (label: string) =>
  reportOf().domains.find((d: { label: string }) => d.label === label);

describe("phase 304 e2e — crypto: the next candidate is really tried", () => {
  it("runs USDC-PLN, learns its family, then attempts ETH-USD (not USDC-EUR)", () => {
    expect(status).toBe(0);
    const crypto = domainOf("CRYPTO");
    const analysis = crypto.attempts.filter((a: { step: string }) => a.step === "analysis");
    expect(analysis.map((a: { instrument: string }) => a.instrument)).toEqual(["USDC-PLN", "ETH-USD"]);
    expect(reportOf().learnedObservations.technicallyInsufficientFamilies).toContain("USDC");
    // the switch reason travels with the verdicts
    expect(analysis[0].reason).toContain("technical/unified evidence is not available");
    expect(analysis[1].verdict).toBe("PASS");
  });

  it("shows the attempt trail and the OKX pool in the annotations", () => {
    expect(stdout).toContain("attempts=[USDC-PLN=UNAVAILABLE>ETH-USD=PASS]");
    expect(stdout).toContain("OKX discovery OK");
    expect(stdout).toContain("total=3 · identities=USDC-PLN,USDC-EUR,ETH-USD");
  });
});

describe("phase 304 e2e — forex: no early stop on a present-but-unavailable fundamental", () => {
  it("attempts BOTH discovered pairs and classifies the gap EXTERNAL_DATA_GAP", () => {
    const forex = domainOf("FOREX");
    const analysis = forex.attempts.filter((a: { step: string }) => a.step === "analysis");
    expect(analysis.map((a: { instrument: string }) => a.instrument)).toEqual(["EUR/USD", "GBP/USD"]);
    expect(forex.block).toBe("EXTERNAL_DATA_GAP");
    expect(reportOf().learnedObservations.macroGapCurrencies).toEqual(expect.arrayContaining(["EUR", "USD"]));
    expect(analysis[0].reason).toContain("No released macroeconomic measurement was supplied for EUR or USD");
  });
});

describe("phase 304 e2e — stock: the candidate is read from the staged catalog", () => {
  it("selects AAPL from the stage window with full provenance and analyses it", () => {
    const stock = domainOf("STOCK");
    expect(stock.candidateSource).toBe("staged-catalog");
    const analysis = stock.attempts.filter((a: { step: string }) => a.step === "analysis");
    expect(analysis[0].instrument).toBe("AAPL");
    expect(stock.discovery.stagedSelection.stageId).toBe("/stocks|phase304|stub");
    expect(stock.discovery.stagedSelection.rowsRead).toBe(2);
    expect(stock.discovery.stagedSelection.usableRows).toBe(2);
    expect(stock.discovery.stagedSelection.selected).toEqual(["AAPL", "MSFT"]);
    // the staged pick reached the runtime: the analysis was really attempted
    expect(analysis[0].verdict).toBe("PASS");
    expect(stdout).toContain("staged-catalog selection");
    expect(stdout).toContain("stageId=/stocks|phase304|stub");
  });
});

describe("phase 304 e2e — commodity: the proven route outranks the restricted family", () => {
  it("closes on WTI/USD first — no XAU attempt needed, nothing whitelisted", () => {
    const commodity = domainOf("COMMODITY");
    const analysis = commodity.attempts.filter((a: { step: string }) => a.step === "analysis");
    expect(analysis.map((a: { instrument: string }) => a.instrument)).toEqual(["WTI/USD"]);
    expect(commodity.headline).toBe("PASS");
    expect(commodity.providerInstrumentId).toBe("WTI/USD");
    // XAU/CHF was never injected nor dropped — the probe still sees it
    expect(reportOf().energyGateProbe.samples.map((s: { instrument: string }) => s.instrument)).toContain("XAU/CHF");
  });
});
