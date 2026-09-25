/**
 * Phase 282 — wiring guards for the four-asset flow.
 *
 * The behavioural suite (`four-asset-e2e.phase282.test.ts`) proves the four
 * domains work end-to-end through the SHIPPED code. These tests read that code
 * and pin the structural properties the flow depends on, so a later change
 * cannot quietly break the integration while the runtime path still looks
 * right:
 *
 *   · the exact provider/native identity a selection resolved is what every
 *     provider leg is asked for (market data, fundamentals, crypto datasets);
 *   · the domain is taken from the analysis ROUTING, never guessed from a
 *     ticker, and each domain adapter receives only its own evidence bag;
 *   · the product has ONE analysis surface: one protected analysis call site,
 *     one radar scan site, no per-domain analysis copies and no client-side
 *     recalculation of the delivered verdict;
 *   · the UI renders the delivered assessment verbatim;
 *   · client-supplied evidence can never reach the engine.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SERVER = readFileSync("src/convex/protectedAnalysis.ts", "utf8");
const MARKET_DATA = readFileSync("src/convex/marketData.ts", "utf8");
const ENGINE = readFileSync("src/lib/analysis-engine.ts", "utf8");
const FUNDAMENTAL_ENGINE = readFileSync("src/lib/fundamental-engine.ts", "utf8");
const DASHBOARD = readFileSync("src/pages/Dashboard.tsx", "utf8");
const RADAR = readFileSync("src/lib/market-radar/radar.ts", "utf8");
const ANALYSIS_RESULT = readFileSync("src/components/AnalysisResult.tsx", "utf8");

/** Comments stripped so prose can never satisfy a structural assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SERVER_CODE = stripComments(SERVER);
const DASHBOARD_CODE = stripComments(DASHBOARD);

/** The code block of one provider leg, from its provider name to the next. */
function legBlock(source: string, provider: string, length = 3000): string {
  const at = source.indexOf(`provider: "${provider}"`);
  expect(at, `leg ${provider} must exist`).toBeGreaterThan(-1);
  return source.slice(at, at + length);
}

describe("282 wiring — one identity, four domains, one path", () => {
  it("(1) the market-data and fundamental legs receive the EXACT resolved identity", () => {
    const marketLeg = legBlock(SERVER_CODE, "market-data", 2000);
    expect(marketLeg).toContain("provider: trustedInput.provider");
    expect(marketLeg).toContain("providerInstrumentId: trustedInput.providerInstrumentId");

    const intelLeg = legBlock(SERVER_CODE, "alpha-vantage", 4000);
    expect(intelLeg).toContain("provider: trustedInput.provider");
    expect(intelLeg).toContain("providerInstrumentId: trustedInput.providerInstrumentId");

    // Crypto-native fundamental datasets are acquired under the native id too.
    const cryptoLeg = legBlock(SERVER_CODE, "crypto-fundamentals", 2000);
    expect(cryptoLeg).toContain("providerInstrumentId: trustedInput.providerInstrumentId");
  });

  it("(2) a provider with no verified live-OHLCV leg is refused, never re-pointed at another provider", () => {
    expect(MARKET_DATA).toMatch(/isProviderNativeLiveOhlcvProvider/);
    expect(MARKET_DATA).toContain("does not expose a verified live OHLCV endpoint in this build");
    expect(MARKET_DATA).toContain("no fallback or symbol substitution was performed");
    // The native id travels as the request symbol — never a canonicalised alias.
    expect(MARKET_DATA).toContain("providerInstrumentId: v.optional(v.string())");
  });

  it("(3) the domain comes from the routing type and only that domain's evidence is passed", () => {
    const call = ENGINE.slice(ENGINE.indexOf("assessFundamentals(input.fundamentalData"), ENGINE.indexOf("assessFundamentals(input.fundamentalData") + 2000);
    expect(call).toContain("instrumentType: input.instrumentType");
    // Each domain's own bags — a domain receives nothing from another domain.
    expect(call).toContain("crypto: input.cryptoIntelligenceContext");
    expect(call).toContain("derivatives: input.derivativesData");
    expect(call).toContain("calendar: input.calendarData");
    expect(call).toContain("treasury: input.treasuryData");
    expect(call).toContain("cot: input.cotData");
    expect(call).toContain("eia: input.eiaData");
    // The market price reaches the equity context only as the pipeline's own
    // snapshot (for the derived market-cap context), never as a re-fetch.
    expect(call).toContain("price: input.marketData?.price?.price");
  });

  it("(4) the framework dispatches by domain and never falls back to another domain's metrics", () => {
    expect(FUNDAMENTAL_ENGINE).toContain("assessCryptoFundamentals");
    expect(FUNDAMENTAL_ENGINE).toContain("assessForexFundamentals");
    expect(FUNDAMENTAL_ENGINE).toContain("assessCommodityFundamentals");
    expect(FUNDAMENTAL_ENGINE).toMatch(/assessEquityFundamentals/);
    // A routing domain outside the four is explicitly unavailable.
    expect(FUNDAMENTAL_ENGINE).toContain("unassessedDomain(");
    expect(FUNDAMENTAL_ENGINE).toMatch(/never another domain's metrics/);
  });

  it("(5) there is exactly one analysis surface and one radar scan site", () => {
    const protectedCalls = DASHBOARD_CODE.match(/runProtectedAnalysis\(\{/g) ?? [];
    expect(protectedCalls.length).toBe(1);
    const scanCalls = DASHBOARD_CODE.match(/scanRadar\(/g) ?? [];
    expect(scanCalls.length).toBe(1);
    // One analysis surface for every asset class: the radar mapping is written
    // once, not duplicated per domain.
    expect(DASHBOARD_CODE).not.toMatch(/if \(ls\.assetClass === "forex"\)[\s\S]{0,400}scanRadar\(/);
    expect(DASHBOARD_CODE).not.toMatch(/if \(ls\.assetClass === "commodity"\)[\s\S]{0,400}scanRadar\(/);
  });

  it("(6) the client never recalculates the delivered verdict or the fundamentals", () => {
    // The UI may name the engine's INPUT type, but it never imports the engine
    // itself and never calls it: the verdict is always the server's.
    expect(DASHBOARD_CODE).not.toMatch(/import \{[^}]*\} from "@\/lib\/analysis-engine"/);
    expect(DASHBOARD_CODE).not.toMatch(/\brunAnalysis\b/);
    expect(DASHBOARD_CODE).not.toMatch(/from "@\/lib\/fundamental/);
    expect(DASHBOARD_CODE).not.toMatch(/assessFundamentals/);
    // The radar is handed the unified object rebuilt from the DELIVERED result,
    // so the opportunity can never disagree with the card the user sees.
    expect(DASHBOARD_CODE).toContain("unified: ar ? buildUnifiedIntelligence(ar) : undefined");
    // The radar itself computes no indicator, no ratio and no depth: it consumes
    // the unified assessment and applies the published policy table.
    expect(RADAR).toContain("evaluateUnifiedConfluence(source.unified)");
    expect(RADAR).not.toMatch(/calculateTechnical|assessFundamentals|runAnalysis/);
  });

  it("(7) the delivered assessment is rendered verbatim by the existing surface", () => {
    expect(ANALYSIS_RESULT).toContain("result.fundamentalAssessment");
    // The card is a renderer: it imports no engine and derives no metric.
    expect(stripComments(ANALYSIS_RESULT)).not.toMatch(/from "@\/lib\/fundamental/);
    expect(stripComments(ANALYSIS_RESULT)).not.toMatch(/assessFundamentals|calculateTechnical/);
    // Per-domain summaries come from the assessment's own `summary` field.
    expect(ANALYSIS_RESULT).toMatch(/fundamentalAssessment\.summary/);
  });

  it("(8) client-supplied evidence is stripped for every domain's evidence bag", () => {
    const listAt = SERVER_CODE.indexOf("CLIENT_UNTRUSTED_EVIDENCE_FIELDS");
    expect(listAt).toBeGreaterThan(-1);
    const list = SERVER_CODE.slice(listAt, listAt + 1500);
    for (const field of [
      "marketData",
      "technicalData",
      "fundamentalData",
      "derivativesData",
      "calendarData",
      "treasuryData",
      "cotData",
      "eiaData",
      "cryptoIntelligenceContext",
    ]) {
      expect(list).toContain(`"${field}"`);
    }
    // The action re-acquires each of them server-side before the engine runs.
    expect(SERVER_CODE).toContain("trustedInput.marketData = acquired.data");
    expect(SERVER_CODE).toContain("trustedInput.fundamentalData = intelligence.fundamentals");
    expect(SERVER_CODE).toContain("trustedInput.calendarData = calendar");
  });
});
