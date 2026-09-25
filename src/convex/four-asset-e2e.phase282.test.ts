/**
 * Phase 282 — four-asset end-to-end market intelligence through the SHIPPED flow.
 *
 * WHAT THIS PROVES
 * ----------------
 * The product flow the mission names is
 *
 *   asset domain → discovered exact instrument → Analyze → live/verified market
 *   evidence → modern technical analysis → domain-native fundamental analysis →
 *   unified intelligence → opportunity/radar eligibility → existing UI
 *
 * and these tests drive it through the REAL server action, not a simulation of
 * it. `runProtectedAnalysis` is invoked as the client invokes it (`{ input }`),
 * and its provider legs are dispatched to the REAL action handlers
 * (`marketData.fetchMarketData`, `alphaVantage.fetchIntelligence`,
 * `tradingEconomics.fetchCalendar`, `coinglass.fetchDerivatives`,
 * `cot.fetchCotPositioning`, `eia.fetchEiaInventory`, `treasury.fetchTreasuryYields`,
 * `okx.*`) over a stubbed `fetch`. The ONLY thing that is not production code is
 * the provider's HTTP response body, which is a fixture. Nothing is faked at a
 * layer above the network boundary: the envelope, validation, technical engine,
 * fundamental adapters, unified layer and radar are all the shipped ones.
 *
 * Per domain (crypto / forex / stock / commodity) the suite asserts:
 *   · the EXACT provider-native identity survives the whole path — including
 *     into the provider request URL and out through the radar opportunity;
 *   · live technical evidence is acquired and timestamped by the provider;
 *   · the fundamental assessment belongs to the DOMAIN's own dimension space,
 *     with no metric leakage from another domain;
 *   · the unified layer echoes that assessment (state, confidence, provenance)
 *     and the radar receives it without recalculating anything;
 *   · reporting periods (fiscal/macro/weekly) stay distinct from live market
 *     timestamps and are never presented as live observations;
 *   · missing evidence is explicitly unavailable/informational, and conflicting
 *     evidence blocks unjustified actionability;
 *   · materially changed evidence changes the final intelligence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import { runProtectedAnalysis } from "./protectedAnalysis";
import { fetchMarketData, fetchFxRate } from "./marketData";
import { fetchIntelligence } from "./alphaVantage";
import { fetchDerivatives } from "./coinglass";
import { fetchCalendar } from "./tradingEconomics";
import { fetchCotPositioning } from "./cot";
import { fetchEiaInventory } from "./eia";
import { fetchTreasuryYields } from "./treasury";
import { fetchOkxOrderBook, fetchOkxInstrumentSpec } from "./okx";
import { resetProviderCache } from "../lib/data/provider-cache-registry";

import type { UnifiedIntelligence } from "../lib/unified-intelligence";
import { scanRadar } from "../lib/market-radar/radar";
import type { RadarCandidateSource } from "../lib/market-radar/candidate-builder";
import type { FundamentalAssessment } from "../lib/fundamental-engine";
import type { AssetClass } from "../lib/data/universal/types";

// ─────────────────────────────────────────────────────────────────
// Harness — real handlers, one stubbed network boundary
// ─────────────────────────────────────────────────────────────────

type Envelope = {
  success?: boolean;
  error?: string;
  data?: {
    provider?: string;
    providerInstrumentId?: string;
    dataFreshness?: string;
    candles?: Array<{ timestamp: number; close: number }>;
    price?: { price: number; timestamp: number; source?: string };
  };
  technical?: unknown;
  observedAt?: number;
  acquisition?: string;
};

function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

const runProtected = handlerOf<{ input: Record<string, unknown> }, ProtectedResponse>(
  runProtectedAnalysis,
);

type ProtectedResponse = {
  status: string;
  entitlement?: { allowed?: boolean };
  result?: {
    instrument: string;
    instrumentType?: string;
    provider?: string;
    providerInstrumentId?: string;
    recommendation?: string;
    bias?: string;
    confidence?: number;
    noTradeReasons?: string[];
    fundamentalAssessment?: FundamentalAssessment;
    unifiedIntelligence?: UnifiedIntelligence;
    technicalSummary?: string;
  };
};

const REAL_HANDLERS: Record<string, (c: never, a: never) => Promise<unknown>> = {
  "marketData:fetchMarketData": handlerOf(fetchMarketData) as never,
  "marketData:fetchFxRate": handlerOf(fetchFxRate) as never,
  "alphaVantage:fetchIntelligence": handlerOf(fetchIntelligence) as never,
  "coinglass:fetchDerivatives": handlerOf(fetchDerivatives) as never,
  "tradingEconomics:fetchCalendar": handlerOf(fetchCalendar) as never,
  "cot:fetchCotPositioning": handlerOf(fetchCotPositioning) as never,
  "eia:fetchEiaInventory": handlerOf(fetchEiaInventory) as never,
  "treasury:fetchTreasuryYields": handlerOf(fetchTreasuryYields) as never,
  "okx:fetchOkxOrderBook": handlerOf(fetchOkxOrderBook) as never,
  "okx:fetchOkxInstrumentSpec": handlerOf(fetchOkxInstrumentSpec) as never,
};

/** Provider requests actually issued during one flow (the identity evidence). */
let requestedUrls: string[] = [];
/** The market-data envelope the run acquired (what the Dashboard retains). */
let marketEnvelope: Envelope | null = null;
/** Provider legs the protected action dispatched. */
let dispatchedLegs: string[] = [];

function testCtx(subject = "user_phase282") {
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject, issuer: "test" }) },
    // The DB-backed steps (entitlement consumption, caller resolution) are
    // stubbed — they need a database. Everything provider-facing is real.
    runMutation: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === "protectedAnalysis:resolveAndConsume") {
        return {
          allowed: true,
          plan: "pro",
          remaining: 5,
          charged: true,
          upgradeRequired: false,
          reason: "test entitlement",
        };
      }
      return "user_stub";
    },
    runQuery: async () => null,
    runAction: async (ref: unknown, args: unknown) => {
      let name = "";
      try {
        name = getFunctionName(ref as never);
      } catch {
        return { success: false, error: "unknown leg in this test" };
      }
      dispatchedLegs.push(name);
      const handler = REAL_HANDLERS[name];
      if (!handler) return { success: false, error: `leg ${name} not wired in this test` };
      const out = await handler(testCtx(subject) as never, args as never);
      if (name === "marketData:fetchMarketData") marketEnvelope = out as Envelope;
      return out;
    },
  };
  return ctx as never;
}

// ─────────────────────────────────────────────────────────────────
// Provider payload fixtures (the only non-production layer)
// ─────────────────────────────────────────────────────────────────

const BAR_MS = 900_000;
/** Bar anchor: one minute ago, floored to a 15-minute open. */
const ANCHOR = Math.floor((Date.now() - 60_000) / BAR_MS) * BAR_MS;

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const isoIso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString();

/**
 * A provider-shaped candle series with a real swing structure (higher highs and
 * higher lows when `slope` is positive) — never a straight line, so the
 * technical engine's structure detection has something real to read.
 */
function candleSeries(opts: {
  count: number;
  base: number;
  slope: number;
  amplitude: number;
  ageDays?: number;
  precision?: number;
}): Array<{ j: number; ts: number; close: number; open: number; high: number; low: number }> {
  const { count, base, slope, amplitude } = opts;
  const precision = opts.precision ?? 2;
  const anchor = ANCHOR - (opts.ageDays ?? 0) * 86_400_000;
  const rows: Array<{ j: number; ts: number; close: number; open: number; high: number; low: number }> = [];
  for (let i = 0; i < count; i++) {
    const j = count - 1 - i; // 0 = oldest bar
    const close = base + slope * j + amplitude * Math.sin(j * 0.55);
    const open = base + slope * j + amplitude * Math.sin((j - 1) * 0.55);
    rows.push({
      j,
      ts: anchor - i * BAR_MS,
      open: Number(open.toFixed(precision)),
      high: Number((Math.max(open, close) + amplitude * 0.2).toFixed(precision)),
      low: Number((Math.min(open, close) - amplitude * 0.2).toFixed(precision)),
      close: Number(close.toFixed(precision)),
    });
  }
  return rows; // newest first, exactly as the providers return them
}

function twelveDataValues(rows: ReturnType<typeof candleSeries>): Array<Record<string, string>> {
  return rows.map((r) => ({
    datetime: new Date(r.ts).toISOString().slice(0, 19).replace("T", " "),
    open: String(r.open),
    high: String(r.high),
    low: String(r.low),
    close: String(r.close),
    volume: "1000",
  }));
}

function okxRows(rows: ReturnType<typeof candleSeries>): string[][] {
  return rows.map((r) => [
    String(r.ts),
    String(r.open),
    String(r.high),
    String(r.low),
    String(r.close),
    "10",
    "0",
    "0",
  ]);
}

interface Scenario {
  okxInstId?: string;
  twelveSymbol: string;
  candles: ReturnType<typeof candleSeries>;
  /** CoinGlass payloads carry a provider `time` unless this is false. */
  coinglassTime?: boolean;
  coinglass?: "live" | "absent-time" | "unavailable";
  tokenomics?: { circulating: number; total: number };
  equity?: { quarters: number; epsBase: number; epsStep: number; revenueGrowth: string };
  calendar?: "two-sided" | "conflicting" | "none";
  eia?: "draw" | "build" | "unavailable";
  cot?: "supportive" | "unavailable";
}

const CD = (over: Partial<Scenario> = {}): Scenario => ({
  twelveSymbol: "EUR/USD",
  candles: candleSeries({ count: 210, base: 1.085, slope: 0.00002, amplitude: 0.0006, precision: 5 }),
  coinglassTime: true,
  coinglass: "live",
  cot: "unavailable",
  ...over,
});

function avOverview(symbol: string, revenueGrowth: string) {
  return {
    Symbol: symbol,
    Name: symbol,
    MarketCapitalization: "3200000000000",
    PERatio: "31.4",
    PEGRatio: "1.82",
    ReturnOnEquityTTM: "1.45",
    ProfitMargin: "0.24",
    OperatingMarginTTM: "0.31",
    QuarterlyEarningsGrowthYOY: "0.11",
    QuarterlyRevenueGrowthYOY: revenueGrowth,
    BookValue: "4.20",
    DividendPerShare: "0.98",
    DividendYield: "0.005",
  };
}

function avEarnings(quarters: number, epsBase: number, epsStep: number) {
  const ends = [
    "2026-06-30",
    "2026-03-31",
    "2025-12-31",
    "2025-09-30",
    "2025-06-30",
    "2025-03-31",
    "2024-12-31",
    "2024-09-30",
  ].slice(0, quarters);
  return {
    quarterlyEarnings: ends.map((fiscalDateEnding, i) => ({
      fiscalDateEnding,
      reportedEPS: String(Number((epsBase - i * epsStep).toFixed(2))),
      estimatedEPS: String(Number((epsBase - i * epsStep - 0.1).toFixed(2))),
      reportedDate: fiscalDateEnding,
    })),
  };
}

/** TickAtlas calendar: released high-impact releases plus one upcoming event. */
function calendarPayload(scenario: Scenario): unknown {
  if (scenario.calendar === "none") return { data: [] };
  const strong = scenario.calendar === "conflicting";
  const releases = [
    {
      id: "ecb",
      event: "ECB Interest Rate Decision",
      currency: "EUR",
      datetime: isoIso(-3),
      impact: "High",
      // A hike vs the previous release is a policy-positive read; the default
      // scenario cuts, which is negative for the base currency.
      actual: strong ? "4.25" : "4.0",
      forecast: "4.0",
      previous: strong ? "4.0" : "4.25",
    },
    {
      id: "fed",
      event: "Fed Interest Rate Decision",
      currency: "USD",
      datetime: isoIso(-3),
      impact: "High",
      actual: "5.5",
      forecast: "5.5",
      previous: "5.5",
    },
    {
      id: "eur-cpi",
      event: "Euro Area Inflation Rate YoY",
      currency: "EUR",
      datetime: isoIso(-3),
      impact: "High",
      // Below consensus is a currency-negative surprise for the base side, so
      // this opposes the policy hike above — two primary dimensions disagreeing.
      actual: strong ? "2.0" : "2.1",
      forecast: "2.3",
      previous: "2.4",
    },
    {
      id: "usd-cpi",
      event: "United States Inflation Rate YoY",
      currency: "USD",
      datetime: isoIso(-3),
      impact: "High",
      actual: "3.4",
      forecast: "3.2",
      previous: "3.3",
    },
  ];
  const upcoming = [
    {
      id: "up-1",
      event: "ECB Interest Rate Decision",
      currency: "EUR",
      datetime: isoIso(+5),
      impact: "High",
    },
  ];
  // The past-events leg is requested with `to=<today>`; the upcoming leg with
  // `from=`. Returning both under either shape would be a lie about the request,
  // so the responder decides by URL (see `scenarioResponder`).
  return { releases, upcoming };
}

function cotRows(net: number) {
  const long = 150_000 + net / 2;
  const short = 150_000 - net / 2;
  return [
    {
      report_date_as_yyyy_mm_dd: isoDay(-5),
      noncomm_positions_long_all: String(long),
      noncomm_positions_short_all: String(short),
      open_interest_all: "500000",
    },
    {
      report_date_as_yyyy_mm_dd: isoDay(-12),
      noncomm_positions_long_all: String(long - 15_000),
      noncomm_positions_short_all: String(short + 5_000),
      open_interest_all: "480000",
    },
  ];
}

function eiaLeg(product: string, direction: "draw" | "build", name: string) {
  const sign = direction === "draw" ? -1 : 1;
  return {
    response: {
      data: [
        { product, "product-name": name, units: "thousand barrels", period: isoDay(-4), value: "412000" },
        { product, "product-name": name, units: "thousand barrels", period: isoDay(-11), value: String(412000 - sign * 3400) },
        { product, "product-name": name, units: "thousand barrels", period: isoDay(-18), value: String(412000 - sign * 6800) },
        { product, "product-name": name, units: "thousand barrels", period: isoDay(-25), value: String(412000 - sign * 9000) },
      ],
    },
  };
}

function scenarioResponder(scenario: Scenario) {
  const cgTime = Math.floor((Date.now() - 120_000) / 1000) * 1000;
  return (url: string): unknown => {
    // ── crypto: OKX provider-native candles ──
    if (url.includes("okx.com/api/v5/market/candles")) {
      const u = new URL(url);
      if (scenario.okxInstId && u.searchParams.get("instId") !== scenario.okxInstId) {
        return { code: "51001", msg: "Instrument ID does not exist" };
      }
      return { code: "0", msg: "", data: okxRows(scenario.candles) };
    }
    if (url.includes("okx.com/api/v5/public/instruments")) {
      return { code: "0", msg: "", data: [] };
    }
    if (url.includes("okx.com/api/v5/market/books")) {
      return { code: "0", msg: "", data: [] };
    }
    // ── forex / stock / commodity: Twelve Data ──
    if (url.includes("twelvedata.com/time_series")) {
      return { status: "ok", values: twelveDataValues(scenario.candles) };
    }
    if (url.includes("twelvedata.com/quote")) {
      const newest = scenario.candles[0];
      return {
        symbol: scenario.twelveSymbol,
        close: String(newest.close),
        timestamp: Math.floor(newest.ts / 1000),
      };
    }
    // ── stock: Alpha Vantage ──
    if (url.includes("alphavantage.co")) {
      const symbol = new URL(url).searchParams.get("symbol") ?? "";
      if (url.includes("NEWS_SENTIMENT")) return { feed: [] };
      if (url.includes("OVERVIEW")) {
        return avOverview(symbol, scenario.equity?.revenueGrowth ?? "0.08");
      }
      if (url.includes("EARNINGS")) {
        const eq = scenario.equity ?? { quarters: 8, epsBase: 2.4, epsStep: 0.1, revenueGrowth: "0.08" };
        return avEarnings(eq.quarters, eq.epsBase, eq.epsStep);
      }
      return {};
    }
    // ── crypto: CoinGlass + tokenomics ──
    if (url.includes("coinglass")) {
      if (scenario.coinglass === "unavailable") {
        return { code: "500", msg: "provider outage" };
      }
      const time = scenario.coinglassTime === false ? undefined : cgTime;
      if (url.includes("openInterest")) {
        return { code: "0", data: [{ openInterest: "1000000000", ...(time ? { time } : {}) }] };
      }
      if (url.includes("fundingRate")) {
        return { code: "0", data: [{ symbol: "BTC", ...(time ? { time } : {}), data: { currentRate: "0.0001", exchangeList: [] } }] };
      }
      if (url.includes("longShort")) {
        return { code: "0", data: [{ longShortRatio: 1.1, ...(time ? { time } : {}), data: { takerBuySellRatio: "0.95" } }] };
      }
      if (url.includes("liquidation")) {
        return { code: "0", data: [{ longLiquidation: 10, shortLiquidation: 12, ...(time ? { time } : {}) }] };
      }
      return { code: "0", data: [] };
    }
    if (url.includes("tokenomist.xyz")) {
      const supply = scenario.tokenomics ?? { circulating: 19_850_000, total: 21_000_000 };
      if (url.includes("/unlocks")) return { data: [] };
      if (url.includes("/supply")) {
        return { circulating_supply: supply.circulating, total_supply: supply.total };
      }
      return {};
    }
    // ── forex: macro calendar (two legs: released + upcoming) ──
    if (url.includes("tickatlas")) {
      const payload = calendarPayload(scenario) as { releases?: unknown[]; upcoming?: unknown[] };
      if (url.includes("to=")) return { success: true, data: { events: payload.releases ?? [] } };
      return { success: true, data: { events: payload.upcoming ?? [] } };
    }
    // ── forex / commodity: CFTC positioning ──
    if (url.includes("publicreporting.cftc.gov")) {
      if (scenario.cot === "unavailable") return [];
      const net = url.includes("WTI") ? 130_000 : 130_000;
      return cotRows(net);
    }
    // ── commodity: EIA weekly petroleum stocks ──
    if (url.includes("api.eia.gov")) {
      if (scenario.eia === "unavailable") return { error: "no data for this series", code: 404 };
      const product = new URL(url).searchParams.get("facets[product][]") ?? "EPC0";
      const direction = scenario.eia === "build" ? "build" : "draw";
      const name = product === "EPC0" ? "Crude Oil" : product === "EPM0" ? "Motor Gasoline" : "Distillate Fuel Oil";
      return eiaLeg(product, direction, name);
    }
    // ── treasury: deliberately unanswered here (no fixture) ──
    return {};
  };
}

beforeEach(() => {
  resetProviderCache();
  requestedUrls = [];
  marketEnvelope = null;
  dispatchedLegs = [];
  process.env.TWELVE_DATA_API_KEY = "test-key";
  process.env.ALPHA_VANTAGE_API_KEY = "test-key";
  process.env.COINGLASS_API_KEY = "test-key";
  process.env.TICKATLAS_API_KEY = "test-key";
  process.env.EIA_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

function installNetwork(scenario: Scenario): void {
  const responder = scenarioResponder(scenario);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String((input as Request)?.url ?? input);
      requestedUrls.push(url);
      const body = responder(url);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

async function analyze(input: Record<string, unknown>): Promise<ProtectedResponse> {
  return runProtected(testCtx(), { input });
}

function fundamentalOf(res: ProtectedResponse): FundamentalAssessment {
  const fa = res.result?.fundamentalAssessment;
  expect(fa, "the flow must deliver a fundamental assessment").toBeTruthy();
  return fa as FundamentalAssessment;
}

function unifiedOf(res: ProtectedResponse): UnifiedIntelligence {
  const u = res.result?.unifiedIntelligence;
  expect(u, "the flow must deliver unified intelligence").toBeTruthy();
  return u as UnifiedIntelligence;
}

/**
 * Turn one delivered analysis into a radar candidate EXACTLY as the Dashboard
 * does: the market snapshot the pipeline acquired, the engine's verdict, and the
 * unified object rebuilt from that same result. No value is recomputed here.
 */
function radarSource(
  res: ProtectedResponse,
  assetClass: AssetClass,
  extra?: Partial<RadarCandidateSource>,
): RadarCandidateSource {
  const r = res.result!;
  const env = marketEnvelope;
  const source: RadarCandidateSource = {
    universe: {
      instrument: r.instrument,
      assetClass,
      ...(r.provider && r.providerInstrumentId
        ? { providerNative: { provider: r.provider, providerInstrumentId: r.providerInstrumentId } }
        : {}),
      requiredCapabilities: ["ohlcv", "quote"],
      priority: 1,
      refreshIntervalMs: 300_000,
    },
    snapshot: env?.data
      ? {
          instrument: env.data.providerInstrumentId ?? r.instrument,
          assetClass,
          price: env.data.price?.price ?? 0,
          ohlcvAvailable: (env.data.candles?.length ?? 0) > 0,
          availableTimeframes: ["H4"],
          htfBias: r.bias === "Bullish" ? "long" : r.bias === "Bearish" ? "short" : "neutral",
          marketRegime: "UNKNOWN",
          provider: env.data.provider,
          observedAt: env.data.price?.timestamp || undefined,
          freshness: env.data.dataFreshness === "realtime" ? "FRESH" : "DELAYED",
          quality: "VERIFIED",
        }
      : null,
    ...(r.recommendation ? { analysisResult: { confidence: r.confidence, bias: r.bias, recommendation: r.recommendation } } : {}),
    unified: unifiedOf(res),
    ...extra,
  } as RadarCandidateSource;
  return source;
}

function scanOne(source: RadarCandidateSource) {
  const scan = scanRadar([source], { horizons: ["SWING"], maxResults: 10 }, undefined, Date.now());
  const opportunities = scan.results.get("SWING") ?? [];
  expect(opportunities.length, "the radar must emit an opportunity for the analysed instrument").toBe(1);
  return opportunities[0];
}

/** Domain isolation: the text of a domain's own assessment must not contain another domain's metrics. */
function assessmentText(fa: FundamentalAssessment): string {
  return [
    ...fa.dimensions.map((d) => d.evidence),
    fa.summary ?? "",
    fa.confidenceEvidence,
    ...(fa.comparisons ?? []),
  ].join(" \n ");
}

// ═════════════════════════════════════════════════════════════════
// A. CRYPTO
// ═════════════════════════════════════════════════════════════════

describe("282 (A) crypto — OKX native identity through the whole path", () => {
  const cryptoScenario = () =>
    CD({
      twelveSymbol: "BTC-USDT",
      okxInstId: "BTC-USDT",
      candles: candleSeries({ count: 210, base: 40_000, slope: 40, amplitude: 200, precision: 2 }),
      coinglass: "live",
      tokenomics: { circulating: 19_850_000, total: 21_000_000 },
    });

  it("(1) delivers live technical + crypto-native fundamental evidence under the exact provider id", async () => {
    installNetwork(cryptoScenario());
    const res = await analyze({
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      tradingStyle: "swing",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });

    expect(res.status).toBe("DELIVERED");
    const r = res.result!;
    // Identity: the selection's exact provider + native id is what the provider
    // was asked for and what the delivered result reports.
    expect(r.instrument).toBe("BTC-USDT");
    expect(r.provider).toBe("okx");
    expect(r.providerInstrumentId).toBe("BTC-USDT");
    const okxCalls = requestedUrls.filter((u) => u.includes("okx.com/api/v5/market/candles"));
    expect(okxCalls.length).toBe(3); // setup + structure + macro timeframes
    for (const u of okxCalls) {
      expect(new URL(u).searchParams.get("instId")).toBe("BTC-USDT");
    }
    // The instrument itself was never re-fetched from another provider. (A
    // twelve-data request may still appear for the documented DXY breadth
    // comparator — that is a different instrument explicitly labelled DXY, not
    // a substitution for BTC-USDT.)
    const reFetchedElsewhere = requestedUrls.filter(
      (u) => u.includes("twelvedata") && u.toUpperCase().includes("BTC"),
    );
    expect(reFetchedElsewhere).toEqual([]);

    // Live technical evidence — provider-observed bar time, not our clock.
    const u = unifiedOf(res);
    expect(u.technical.available).toBe(true);
    expect(u.technical.provider).toBe("okx");
    expect(u.technical.instrumentId).toBe("BTC-USDT");
    expect(u.technical.observedAt).toBe(marketEnvelope!.data!.price!.timestamp);
    expect(u.technical.dataPoints).toBe(210);
    expect(r.technicalSummary ?? "").toMatch(/RSI|EMA|structure/i);

    // Crypto-native fundamentals: the crypto dimension space, from crypto evidence.
    const fa = fundamentalOf(res);
    expect(fa.domain).toBe("crypto");
    expect(fa.instrumentId).toBe("BTC-USDT");
    const names = fa.dimensions.map((d) => d.name);
    expect(names).toContain("supply-structure");
    expect(names).toContain("unlock-dilution");
    expect(names).toContain("market-positioning");
    const supply = fa.dimensions.find((d) => d.name === "supply-structure")!;
    expect(supply.status).toBe("positive");
    expect(supply.evidence).toContain("19,850,000");
    expect(supply.evidence).toContain("21,000,000");
    // Unavailable dimensions are disclosed, never zero-filled.
    const protocol = fa.dimensions.find((d) => d.name === "protocol-economics")!;
    expect(protocol.status).toBe("unavailable");

    // Unified intelligence: echoes the assessment, one combined conclusion.
    expect(u.fundamental.present).toBe(true);
    expect(u.fundamental.state).toBe(fa.state);
    expect(u.fundamental.provider).toContain("Tokenomist");
    expect(u.explanation.length).toBeGreaterThan(0);
    expect(u.confluence.agreement).toBeTruthy();
  });

  it("(2) the radar consumes the delivered unified assessment without recalculating it", async () => {
    installNetwork(cryptoScenario());
    const res = await analyze({
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      tradingStyle: "swing",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });
    const opp = scanOne(radarSource(res, "crypto"));
    const unified = unifiedOf(res);
    expect(opp.instrument).toBe("BTC-USDT");
    expect(opp.providerNative).toEqual({ provider: "okx", providerInstrumentId: "BTC-USDT" });
    expect(opp.unified!.state).toBe(unified.state);
    expect(opp.unified!.fundamentalState).toBe(unified.fundamental.state);
    expect(opp.unified!.technicalBias).toBe(unified.technical.bias);
    expect(opp.unified!.provenance.technicalInstrumentId).toBe("BTC-USDT");
    expect(opp.confidence).toBeLessThanOrEqual(100);
  });

  it("(3) a derivatives payload with no provider instant is disclosed as such — never as 1970", async () => {
    installNetwork({ ...cryptoScenario(), coinglassTime: false });
    const res = await analyze({
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      tradingStyle: "swing",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });
    const fa = fundamentalOf(res);
    const positioning = fa.dimensions.find((d) => d.name === "market-positioning")!;
    expect(positioning.evidence).not.toContain("1970");
    expect(positioning.evidence).toContain("provider stamped no observation instant");
  });

  it("(4) materially heavier dilution changes the delivered fundamental state and the unified conclusion", async () => {
    installNetwork(cryptoScenario());
    const baseline = await analyze({
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      tradingStyle: "swing",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });
    vi.unstubAllGlobals();
    resetProviderCache();
    installNetwork({ ...cryptoScenario(), tokenomics: { circulating: 12_000_000, total: 21_000_000 } });
    const changed = await analyze({
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      tradingStyle: "swing",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });

    const before = fundamentalOf(baseline);
    const after = fundamentalOf(changed);
    expect(before.state).not.toBe(after.state);
    // The delivered intelligence follows the evidence, not a fixed template.
    expect(unifiedOf(changed).fundamental.state).toBe(after.state);
    expect(unifiedOf(changed).fundamental.state).not.toBe(unifiedOf(baseline).fundamental.state);
    expect(unifiedOf(changed).explanation).not.toBe(unifiedOf(baseline).explanation);
  });
});

// ═════════════════════════════════════════════════════════════════
// B. FOREX
// ═════════════════════════════════════════════════════════════════

describe("282 (B) forex — two-sided macro evidence on the exact pair", () => {
  const fxScenario = () => CD({ calendar: "two-sided", cot: "supportive" });

  it("(5) delivers live technical + two-sided macro fundamentals and keeps release times distinct", async () => {
    installNetwork(fxScenario());
    const res = await analyze({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
    });

    expect(res.status).toBe("DELIVERED");
    const r = res.result!;
    expect(r.instrument).toBe("EUR/USD");
    expect(r.provider).toBe("twelve-data");
    expect(r.providerInstrumentId).toBe("EUR/USD");
    // Every candle request names the exact symbol — no substitution.
    const seriesUrls = requestedUrls.filter((u) => u.includes("time_series"));
    expect(seriesUrls.length).toBeGreaterThan(0);
    const symbols = seriesUrls.map((u) => new URL(u).searchParams.get("symbol"));
    expect(symbols).toContain("EUR/USD");
    // Every series is either the analysed pair or the explicitly labelled
    // DXY index comparator — never a look-alike symbol standing in for it.
    for (const symbol of symbols) {
      expect(["EUR/USD", "DXY"]).toContain(symbol);
    }
    // The CFTC leg was asked for the mapped Euro contract by its exact name.
    const cotUrls = requestedUrls.filter((u) => u.includes("publicreporting.cftc.gov"));
    expect(cotUrls.length).toBeGreaterThan(0);
    expect(cotUrls.some((u) => /euro fx/i.test(decodeURIComponent(u)))).toBe(true);

    const fa = fundamentalOf(res);
    expect(fa.domain).toBe("forex");
    expect(fa.instrumentId).toBe("EUR/USD");
    const byName = new Map(fa.dimensions.map((d) => [d.name, d]));
    expect(byName.get("policy-rates")).toBeTruthy();
    expect(byName.get("inflation")).toBeTruthy();
    // Two-sided: both currencies' releases are compared, and the comparison
    // records which side of the pair each reading belongs to.
    const policyEvidence = byName.get("policy-rates")!.evidence;
    expect(policyEvidence).toMatch(/EUR/);
    expect(policyEvidence).toMatch(/USD/);
    expect((fa.comparisons ?? []).length).toBeGreaterThan(0);

    // Macro releases are dated by their RELEASE time; the live technical read is
    // dated by the provider's bar time. They stay distinct facts.
    const releaseInstant = Date.parse(isoIso(-3));
    const techObserved = unifiedOf(res).technical.observedAt!;
    expect(techObserved).not.toBe(releaseInstant);
    expect(Math.abs(techObserved - ANCHOR)).toBeLessThan(2 * BAR_MS);
    expect(policyEvidence).toContain("tickatlas");
  });

  it("(6) conflicting top-tier evidence yields a mixed state and never a forced direction", async () => {
    installNetwork(CD({ calendar: "conflicting", cot: "supportive" }));
    const res = await analyze({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
    });
    const fa = fundamentalOf(res);
    expect(fa.state).toBe("mixed");
    expect(fa.directionalBias).toBe("none");
    expect(fa.confidenceEvidence).toMatch(/conflict|mixed/i);
  });

  it("(7) without a calendar the macro dimensions are explicitly unavailable, and the radar says so", async () => {
    installNetwork(CD({ calendar: "none", cot: "unavailable" }));
    const res = await analyze({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
    });
    const fa = fundamentalOf(res);
    const unavailable = fa.dimensions.filter((d) => d.status === "unavailable").map((d) => d.name);
    expect(unavailable).toContain("policy-rates");
    expect(unavailable).toContain("inflation");
    expect(fa.available).toBe(false);
    expect(fa.state).toBe("insufficient");
    expect(fa.limitations.join(" ")).toMatch(/UNAVAILABLE/);

    // The delivered analysis is still honest: no macro direction is claimed.
    const opp = scanOne(radarSource(res, "forex"));
    // The unified layer refuses a direction when the class produced nothing:
    // the absence is stated and the combined state is technical-only.
    expect(opp.unified!.fundamentalState).toBe("unavailable");
    expect(opp.unified!.state).toBe("technical_only");
    expect(opp.unified!.combinedDirectional).toBe(false);
    expect(opp.unified!.actionable).toBe(false);
    expect(opp.conflictingEvidence.join(" ")).not.toMatch(/bullish|bearish/i);
  });
});

// ═════════════════════════════════════════════════════════════════
// C. STOCK
// ═════════════════════════════════════════════════════════════════

describe("282 (C) stock — reported financials under the exact ticker", () => {
  const stockScenario = () =>
    CD({
      twelveSymbol: "AAPL",
      candles: candleSeries({ count: 210, base: 180, slope: 0.2, amplitude: 1.2, precision: 2 }),
      equity: { quarters: 8, epsBase: 2.4, epsStep: 0.1, revenueGrowth: "0.08" },
      cot: "unavailable",
    });

  it("(8) delivers reported fundamentals with their fiscal periods preserved", async () => {
    installNetwork(stockScenario());
    const res = await analyze({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "AAPL",
    });

    expect(res.status).toBe("DELIVERED");
    const r = res.result!;
    expect(r.instrument).toBe("AAPL");
    expect(r.providerInstrumentId).toBe("AAPL");
    // The fundamental leg asked for the same ticker on its own provider.
    const avUrls = requestedUrls.filter((u) => u.includes("alphavantage.co"));
    expect(avUrls.length).toBeGreaterThan(0);
    const fundamentalUrls = avUrls.filter((u) => /function=(OVERVIEW|EARNINGS)/.test(u));
    expect(fundamentalUrls.length).toBeGreaterThan(0);
    for (const u of fundamentalUrls) {
      expect(new URL(u).searchParams.get("symbol")).toBe("AAPL");
    }

    const fa = fundamentalOf(res);
    expect(fa.domain).toBe("equity");
    expect(fa.instrumentId).toBe("AAPL");
    const byName = new Map(fa.dimensions.map((d) => [d.name, d]));
    expect(byName.get("revenue-growth")!.status).toBe("positive");
    expect(byName.get("eps-trend")).toBeTruthy();
    expect(byName.get("profitability")).toBeTruthy();

    // Fiscal periods are the provider's reported quarter ends, and the
    // assessment states them as reporting periods — never as market instants.
    expect(fa.reportingPeriod).toBe("2026-06-30");
    expect(assessmentText(fa)).toContain("2026-06-30");
    expect(assessmentText(fa)).toMatch(/period|quarter|q\/q/i);
    // The acquisition receipt is a different fact from the fiscal period.
    expect(fa.observedAt).not.toBe(Date.parse(`${fa.reportingPeriod}T00:00:00Z`));
    expect(unifiedOf(res).fundamental.reportingPeriod).toBe("2026-06-30");
  });

  it("(9) a materially different earnings trajectory changes the delivered intelligence", async () => {
    installNetwork(stockScenario());
    const growing = await analyze({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "AAPL",
    });
    vi.unstubAllGlobals();
    resetProviderCache();
    // Same ticker, same providers — the reported EPS trajectory is now falling.
    installNetwork({ ...stockScenario(), equity: { quarters: 8, epsBase: 1.0, epsStep: -0.1, revenueGrowth: "-0.04" } });
    const shrinking = await analyze({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "AAPL",
    });

    const before = fundamentalOf(growing);
    const after = fundamentalOf(shrinking);
    expect(before.state).not.toBe(after.state);
    expect(unifiedOf(shrinking).fundamental.state).toBe(after.state);
    expect(scanOne(radarSource(shrinking, "equity")).unified!.fundamentalState).toBe(after.state);
  });

  it("(10) stale live market data is rejected instead of presented as current", async () => {
    installNetwork(
      CD({
        twelveSymbol: "AAPL",
        candles: candleSeries({ count: 210, base: 180, slope: 0.2, amplitude: 1.2, precision: 2, ageDays: 10 }),
        equity: { quarters: 8, epsBase: 2.4, epsStep: 0.1, revenueGrowth: "0.08" },
      }),
    );
    const res = await analyze({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "AAPL",
    });

    const r = res.result!;
    // Whatever the gate decides, the delivered verdict must not read as a live
    // setup: either the acquisition refused the payload, or the engine refused
    // to trade on it — and the staleness is disclosed either way.
    const refusedByAcquisition = marketEnvelope?.success === false;
    const noTrade = r.recommendation === "NO_TRADE";
    expect(refusedByAcquisition || noTrade).toBe(true);
    if (!refusedByAcquisition) {
      expect((r.noTradeReasons ?? []).join(" ")).toMatch(/stale|age|freshness|old/i);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// D. COMMODITY
// ═════════════════════════════════════════════════════════════════

describe("282 (D) commodity — physical evidence, never a company model", () => {
  const commodityScenario = (over: Partial<Scenario> = {}) =>
    CD({
      twelveSymbol: "WTI/USD",
      candles: candleSeries({ count: 210, base: 70, slope: 0.02, amplitude: 0.4, precision: 2 }),
      eia: "draw",
      cot: "supportive",
      ...over,
    });

  it("(11) delivers inventory and positioning evidence with the release periods preserved", async () => {
    installNetwork(commodityScenario());
    const res = await analyze({
      instrument: "WTI/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
    });

    expect(res.status).toBe("DELIVERED");
    const r = res.result!;
    expect(r.instrument).toBe("WTI/USD");
    expect(r.providerInstrumentId).toBe("WTI/USD");
    // Each EIA product leg is requested once, and the CFTC leg names the exact
    // WTI contract — no commodity is ever matched by a look-alike symbol.
    const eiaUrls = requestedUrls.filter((u) => u.includes("api.eia.gov"));
    const products = eiaUrls.map((u) => new URL(u).searchParams.get("facets[product][]"));
    expect(products.sort()).toEqual(["EPC0", "EPD0", "EPM0"]);
    const cotUrls = requestedUrls.filter((u) => u.includes("publicreporting.cftc.gov"));
    expect(cotUrls.some((u) => decodeURIComponent(u).includes("WTI FINANCIAL CRUDE OIL"))).toBe(true);

    const fa = fundamentalOf(res);
    expect(fa.domain).toBe("commodity");
    const byName = new Map(fa.dimensions.map((d) => [d.name, d]));
    expect(byName.get("inventories")!.status).toBe("positive");
    expect(byName.get("futures-positioning")).toBeTruthy();
    // Term structure requires a real multi-expiry curve; absent one it is
    // UNAVAILABLE with a reason rather than inferred from spot candles.
    expect(byName.get("term-structure")!.status).toBe("unavailable");
    expect(
      `${byName.get("term-structure")!.evidence ?? ""} ${fa.limitations.join(" ")}`,
    ).toMatch(/multi-expiry/i);
    // Commodity-native: no company-style metric anywhere in the assessment.
    const text = assessmentText(fa);
    expect(text).not.toMatch(/\bEPS\b|P\/E|net margin|book value|return on equity|\bROE\b/i);
    // Weekly release periods are stated as observation periods, not live prices.
    expect(fa.reportingPeriod).toBe(isoDay(-4));
    expect(text).toContain(isoDay(-4));
    expect(text).toMatch(/observation|report/i);
    expect(unifiedOf(res).fundamental.state).toBe(fa.state);
    expect(unifiedOf(res).fundamental.reportingPeriod).toBe(isoDay(-4));
  });

  it("(12) a physical build instead of a draw moves the delivered state — the intelligence follows the evidence", async () => {
    installNetwork(commodityScenario());
    const drawing = await analyze({
      instrument: "WTI/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
    });
    vi.unstubAllGlobals();
    resetProviderCache();
    installNetwork(commodityScenario({ eia: "build" }));
    const building = await analyze({
      instrument: "WTI/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
    });

    const before = fundamentalOf(drawing);
    const after = fundamentalOf(building);
    const beforeInv = before.dimensions.find((d) => d.name === "inventories")!;
    const afterInv = after.dimensions.find((d) => d.name === "inventories")!;
    expect(beforeInv.status).not.toBe(afterInv.status);
    expect(after.state).not.toBe(before.state);
    expect(unifiedOf(building).fundamental.state).toBe(after.state);
  });

  it("(13) a failed inventory feed is reported unavailable, not neutral, and the radar carries the gap", async () => {
    installNetwork(commodityScenario({ eia: "unavailable", cot: "unavailable" }));
    const res = await analyze({
      instrument: "WTI/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
    });
    const fa = fundamentalOf(res);
    expect(fa.dimensions.find((d) => d.name === "inventories")!.status).toBe("unavailable");
    expect(fa.state).toBe("insufficient");
    const opp = scanOne(radarSource(res, "commodity"));
    expect(opp.unified!.fundamentalState).toBe("unavailable");
    expect(opp.unified!.state).toBe("technical_only");
    expect(opp.unified!.actionable).toBe(false);
    // A missing class is visible in the opportunity's information gaps and
    // never upgraded into a directional claim.
    expect([...opp.missingInformation, ...opp.conflictingEvidence].join(" ")).toMatch(/fundamental/i);
  });
});

// ═════════════════════════════════════════════════════════════════
// E. Cross-domain truthfulness (same flow, four domains)
// ═════════════════════════════════════════════════════════════════

describe("282 (E) — one flow, four domains, no fabricated evidence", () => {
  it("(14) each domain keeps its own dimension space and identity; no metric crosses over", async () => {
    const crypto = await (async () => {
      installNetwork(CD({
        twelveSymbol: "BTC-USDT",
        okxInstId: "BTC-USDT",
        candles: candleSeries({ count: 210, base: 40_000, slope: 40, amplitude: 200, precision: 2 }),
      }));
      return analyze({
        instrument: "BTC-USDT",
        instrumentType: "crypto",
        timeframe: "M15",
        tradingStyle: "swing",
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
      });
    })();
    vi.unstubAllGlobals();
    resetProviderCache();

    const stock = await (async () => {
      installNetwork(CD({
        twelveSymbol: "AAPL",
        candles: candleSeries({ count: 210, base: 180, slope: 0.2, amplitude: 1.2, precision: 2 }),
        equity: { quarters: 8, epsBase: 2.4, epsStep: 0.1, revenueGrowth: "0.08" },
      }));
      return analyze({
        instrument: "AAPL",
        instrumentType: "stock",
        timeframe: "H4",
        tradingStyle: "swing",
        provider: "twelve-data",
        providerInstrumentId: "AAPL",
      });
    })();
    vi.unstubAllGlobals();
    resetProviderCache();

    const commodity = await (async () => {
      installNetwork(CD({
        twelveSymbol: "WTI/USD",
        candles: candleSeries({ count: 210, base: 70, slope: 0.02, amplitude: 0.4, precision: 2 }),
        eia: "draw",
        cot: "supportive",
      }));
      return analyze({
        instrument: "WTI/USD",
        instrumentType: "commodity",
        timeframe: "H4",
        tradingStyle: "swing",
        provider: "twelve-data",
        providerInstrumentId: "WTI/USD",
      });
    })();

    const cryptoFa = fundamentalOf(crypto);
    const stockFa = fundamentalOf(stock);
    const commodityFa = fundamentalOf(commodity);

    expect(new Set([cryptoFa.domain, stockFa.domain, commodityFa.domain]).size).toBe(3);
    // Pairwise disjoint dimension names: one shared framework, four domains.
    const names = (fa: FundamentalAssessment) => new Set(fa.dimensions.map((d) => d.name));
    const [c, s, m] = [names(cryptoFa), names(stockFa), names(commodityFa)];
    for (const n of c) {
      expect(s.has(n)).toBe(false);
      expect(m.has(n)).toBe(false);
    }
    for (const n of s) expect(m.has(n)).toBe(false);

    // Identity never crosses domains either.
    expect(crypto.result!.providerInstrumentId).toBe("BTC-USDT");
    expect(stock.result!.providerInstrumentId).toBe("AAPL");
    expect(commodity.result!.providerInstrumentId).toBe("WTI/USD");

    // No technical/fundamental cross-domain leakage in the evidence text.
    expect(assessmentText(cryptoFa)).not.toMatch(/inventory|contango|backwardation/i);
    expect(assessmentText(stockFa)).not.toMatch(/inventory|contango|non-commercial|circulating supply/i);
    expect(assessmentText(commodityFa)).not.toMatch(/EPS|P\/E|circulating supply|tokenomics/i);

    // Every delivered evidence item names a provider and stays inside its
    // domain's own bags — no item can be attributed to two domains at once.
    for (const fa of [cryptoFa, stockFa, commodityFa]) {
      expect(fa.provider.length).toBeGreaterThan(0);
      for (const d of fa.dimensions) {
        if (d.status !== "unavailable") expect((d.evidence ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("(15) identical evidence is deterministic: the same payloads produce the same intelligence", async () => {
    const scenario = CD({ calendar: "two-sided", cot: "supportive" });
    const structural = (fa: FundamentalAssessment) => ({
      domain: fa.domain,
      available: fa.available,
      state: fa.state,
      confidence: fa.confidence,
      directionalBias: fa.directionalBias,
      dims: fa.dimensions.map((d) => `${d.name}:${d.status}`),
      comparisons: fa.comparisons ?? [],
      periodsCount: fa.periodsCount,
      values: fa.evidence.map((e) => `${e.metric}=${String(e.value)}`),
    });
    const unifiedShape = (u: UnifiedIntelligence) => ({
      state: u.state,
      agreement: u.confluence.agreement,
      technicalBias: u.technical.bias,
      fundamentalState: u.fundamental.state,
      actionable: u.actionable,
    });

    installNetwork(scenario);
    const first = await analyze({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
    });
    vi.unstubAllGlobals();
    resetProviderCache();
    installNetwork(scenario);
    const second = await analyze({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
    });

    // Acquisition instants legitimately differ between runs (they are real
    // receipts); everything the evidence DECIDES must be identical.
    expect(structural(fundamentalOf(second))).toEqual(structural(fundamentalOf(first)));
    expect(unifiedShape(unifiedOf(second))).toEqual(unifiedShape(unifiedOf(first)));
    expect(unifiedOf(second).fundamental.state).toBe(unifiedOf(first).fundamental.state);
  });

  it("(16) a technical read that contradicts the fundamentals is delivered as conflicting and blocks clean actionability", async () => {
    // Directional technical evidence (a real uptrend) against macro evidence that
    // favours the quote side of the pair: the two classes contradict each other.
    installNetwork(CD({ calendar: "two-sided", cot: "supportive" }));
    const res = await analyze({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
    });
    const fa = fundamentalOf(res);
    const unified = unifiedOf(res);
    expect(fa.state).toBe("weakening");
    expect(unified.technical.bias).toBe("bullish");
    expect(unified.state).toBe("conflicting");
    expect(unified.confluence.agreement).toBe("conflicting");
    expect(unified.actionable).toBe(false);

    const opp = scanOne(radarSource(res, "forex"));
    expect(opp.unified!.state).toBe("conflicting");
    expect(opp.unified!.blocksCleanActionability).toBe(true);
    expect(opp.unified!.actionable).toBe(false);
    // Confidence is capped by the documented confluence policy for a conflict,
    // and the A/B quality tiers are reserved for supported conclusions.
    expect(opp.confidence).toBeLessThanOrEqual(35);
    expect(["A", "B"]).not.toContain(opp.qualityTier);
    expect(opp.invalidationConditions.length).toBeGreaterThan(0);
  });

  it("(17) a present-but-mixed fundamental class is disclosed as non-directional, never as absent", async () => {
    installNetwork(CD({ calendar: "conflicting", cot: "supportive" }));
    const res = await analyze({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
    });
    const unified = unifiedOf(res);
    expect(fundamentalOf(res).state).toBe("mixed");
    expect(unified.fundamental.present).toBe(true);
    // No combined direction is claimed, and the absence is attributed to the
    // read being non-directional rather than to evidence that was never there.
    expect(unified.state).toBe("technical_only");
    expect(unified.confluence.reason).toMatch(/did not reach a directional state \(mixed\)/);

    const opp = scanOne(radarSource(res, "forex"));
    expect(opp.unified!.explanation).toMatch(/supplied but is non-directional \(mixed\)/);
    expect(opp.unified!.explanation).not.toMatch(/fundamental evidence unavailable/);
    // Nothing in the delivered opportunity claims a fundamental direction.
    expect(opp.unified!.combinedDirectional).toBe(false);
    expect(opp.unified!.fundamentalState).toBe("mixed");
  });
});
