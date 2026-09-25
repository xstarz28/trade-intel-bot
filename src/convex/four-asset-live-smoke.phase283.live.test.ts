/**
 * Phase 283 — REAL provider live smoke for all four asset classes.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Phase 282 proved the complete production path — domain selection → exact
 * provider-native identity → protected analysis → live technical evidence →
 * domain-native fundamentals → unified intelligence → opportunity radar — with
 * the network boundary stubbed. This suite is the other half of that evidence:
 * the SAME shipped path, with NO stub of any kind. No `vi.stubGlobal("fetch")`,
 * no fixture transport, no intercepted response, no injected timestamp. The
 * requests that leave this process are the ones production makes, over real
 * DNS and real TLS, and the values that come back are the providers' own.
 *
 * HOW TO RUN IT
 * -------------
 *   LIVE_PROVIDER_VERIFICATION=1 npm run test:live \
 *     -- src/convex/four-asset-live-smoke.phase283.live.test.ts
 *
 * It is never collected by `npm test` (see `vitest.config.ts` LIVE_ONLY) and the
 * live config refuses to start without the explicit opt-in.
 *
 * CREDENTIALS AND EGRESS
 * ----------------------
 * The suite reads NOTHING from the environment except the presence of the
 * documented credential names. No key value is ever read into the evidence
 * record, logged, or written to disk.
 *
 *   TWELVE_DATA_API_KEY    forex / equity / commodity market data + quote
 *   ALPHA_VANTAGE_API_KEY  equity fundamentals (OVERVIEW + EARNINGS)
 *   COINGLASS_API_KEY      crypto derivatives (open interest, funding, L/S)
 *   TICKATLAS_API_KEY      macro calendar (released + upcoming)
 *   EIA_API_KEY            U.S. petroleum inventory releases
 *
 * Providers that require no credential: OKX (crypto OHLCV), Tokenomist and
 * DeFiLlama (crypto-native fundamentals), CFTC (positioning reports), U.S.
 * Treasury (yield curve XML).
 *
 * WHAT IT ASSERTS IN ANY ENVIRONMENT
 * ----------------------------------
 * Honesty, not success. A blocked socket, a missing credential, a rate limit or
 * a stale payload is a VALID result and must be classified as one
 * (SUCCESS / PROVIDER_UNAVAILABLE / CREDENTIAL_REQUIRED / RATE_LIMITED /
 * UNSUPPORTED / STALE / DATA_QUALITY_FAILURE), must leave the affected evidence
 * genuinely absent — never zero-filled, never re-dated, never substituted — and
 * must never be converted into a directional claim. Where live data IS obtained,
 * the same assertions require the full chain to be produced FROM that data.
 *
 * THE ONE NON-PRODUCTION BOUNDARY
 * -------------------------------
 * Two Convex collaborators cannot exist in a local process: the database
 * mutation that consumes an entitlement and the caller-identity query. They are
 * stubbed here exactly as the Phase 282 suite stubs them (the entitlement
 * decision is not provider evidence). Every provider-facing collaborator is the
 * real action handler, reached over the real network.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
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
import { acquireCryptoFundamentals } from "../lib/data/crypto/fundamentals-acquisition";
import type { UnifiedIntelligence } from "../lib/unified-intelligence";
import type { FundamentalAssessment } from "../lib/fundamental-engine";

// ─────────────────────────────────────────────────────────────────
// Result classification (Phase 283 taxonomy)
// ─────────────────────────────────────────────────────────────────

type Classification =
  | "SUCCESS"
  | "PROVIDER_UNAVAILABLE"
  | "CREDENTIAL_REQUIRED"
  | "RATE_LIMITED"
  | "UNSUPPORTED"
  | "STALE"
  | "DATA_QUALITY_FAILURE";

const CLASSIFICATIONS: readonly Classification[] = [
  "SUCCESS",
  "PROVIDER_UNAVAILABLE",
  "CREDENTIAL_REQUIRED",
  "RATE_LIMITED",
  "UNSUPPORTED",
  "STALE",
  "DATA_QUALITY_FAILURE",
];

/** Presence only — a credential VALUE is never read, logged or stored here. */
function credentialPresent(envName: string | null): boolean {
  if (!envName) return true; // provider needs no credential
  const value = process.env[envName];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Classify a provider outcome from the production code's own wording.
 * Transport-level evidence (socket/TLS/timeout) is classified first, then the
 * provider's own error codes, then freshness.
 */
function classifyOutcome(reason: string | undefined, envName: string | null): Classification {
  const text = (reason ?? "").toLowerCase();
  if (text.length === 0) return "SUCCESS";
  if (/rate limit|too many requests|\b429\b/.test(text)) return "RATE_LIMITED";
  if (/not configured|is missing|missing api key|invalid api key|unauthorised|unauthorized|\b401\b|\b403\b/.test(text)) {
    return credentialPresent(envName) ? "DATA_QUALITY_FAILURE" : "CREDENTIAL_REQUIRED";
  }
  if (/does not expose|not supported|unsupported|not applicable|no .* mapping/.test(text)) return "UNSUPPORTED";
  if (/stale|older than|outside freshness/.test(text)) return "STALE";
  if (
    /fetch failed|network|unreachable|timeout|timed out|abort|socket|econn|enotfound|etimedout|eai_again|tls|ssl|connection|terminated|other side closed/.test(
      text,
    )
  ) {
    return "PROVIDER_UNAVAILABLE";
  }
  return "DATA_QUALITY_FAILURE";
}

// ─────────────────────────────────────────────────────────────────
// Evidence record (safe metadata only)
// ─────────────────────────────────────────────────────────────────

interface DomainRecord {
  assetClass: "crypto" | "forex" | "stock" | "commodity";
  instrument: string;
  provider: string | null;
  providerInstrumentId: string | null;
  request: { success: boolean; error?: string; errorCode?: string };
  classification: Classification;
  providerObservationTimestamp: number | null;
  marketDataFreshness: string | null;
  fundamentalSources: string[];
  reportingPeriod: string | null;
  technicalState: string | null;
  fundamentalState: string | null;
  unifiedState: string | null;
  actionability: string | null;
  radarState: string | null;
  failureReason: string | null;
}

interface ReachabilityRecord {
  provider: string;
  host: string;
  credentialEnv: string | null;
  credentialPresent: boolean;
  reachable: boolean;
  httpStatus: number | null;
  classification: Classification;
  error: string | null;
}

interface LegRecord {
  provider: string;
  domain: string;
  credentialEnv: string | null;
  credentialPresent: boolean;
  success: boolean;
  classification: Classification;
  reason: string | null;
}

const DOMAIN_RECORDS: DomainRecord[] = [];
const REACHABILITY: ReachabilityRecord[] = [];
const LEG_RECORDS: LegRecord[] = [];

afterAll(() => {
  const record = {
    phase: 283,
    kind: "real-provider-live-smoke",
    ranAtUtc: new Date().toISOString(),
    stubsUsed: "none (production handlers over the real network)",
    reachability: REACHABILITY,
    legs: LEG_RECORDS,
    domains: DOMAIN_RECORDS,
  };
  writeFileSync("phase283-live-evidence.json", `${JSON.stringify(record, null, 2)}\n`, "utf8");
  // The table the phase report quotes, printed from the recorded metadata.
  const rows = DOMAIN_RECORDS.map((r) =>
    [
      r.assetClass,
      r.instrument,
      r.provider ?? "-",
      r.request.success ? "ok" : "fail",
      r.providerObservationTimestamp ? "yes" : "no",
      r.fundamentalSources.length > 0 ? r.fundamentalSources.join("+") : "-",
      r.unifiedState ?? "-",
      r.radarState ?? "-",
      r.classification,
    ].join(" | "),
  );
  console.log(
    `\n[Phase 283] asset | instrument | provider | request | obs-time | fundamental | unified | radar | classification\n` +
      rows.map((r) => `[Phase 283] ${r}`).join("\n"),
  );
});

// ─────────────────────────────────────────────────────────────────
// Production collaborators (real handlers, stubbed DB boundary only)
// ─────────────────────────────────────────────────────────────────

function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

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

let marketEnvelope: {
  success?: boolean;
  error?: string;
  data?: {
    provider?: string;
    providerInstrumentId?: string;
    dataFreshness?: string;
    candles?: unknown[];
    price?: { price?: number; timestamp?: number };
  };
} | null = null;

function liveCtx(subject = "phase283_smoke") {
  return {
    auth: { getUserIdentity: async () => ({ subject, issuer: "phase283" }) },
    // ── DB boundary only (no database in a local process) ──
    runMutation: async () => ({
      allowed: true,
      plan: "pro",
      remaining: 1,
      charged: true,
      upgradeRequired: false,
      reason: "live smoke",
    }),
    runQuery: async () => null,
    // ── everything provider-facing is the REAL action ──
    runAction: async (ref: unknown, args: unknown) => {
      let name = "";
      try {
        name = getFunctionName(ref as never);
      } catch {
        return { success: false, error: "unknown collaborator in this process" };
      }
      const handler = REAL_HANDLERS[name];
      if (!handler) return { success: false, error: `collaborator ${name} is not provider-facing` };
      const out = await handler(liveCtx(subject) as never, args as never);
      if (name === "marketData:fetchMarketData") marketEnvelope = out as typeof marketEnvelope;
      return out;
    },
  } as never;
}

type ProtectedResponse = {
  status: string;
  result?: {
    instrument?: string;
    provider?: string;
    providerInstrumentId?: string;
    dataCompleteness?: string;
    recommendation?: string;
    noTradeReasons?: string[];
    fundamentalAssessment?: FundamentalAssessment;
    unifiedIntelligence?: UnifiedIntelligence;
  };
};

async function runLiveAnalysis(input: Record<string, unknown>): Promise<ProtectedResponse> {
  const handler = handlerOf<{ input: Record<string, unknown> }, ProtectedResponse>(runProtectedAnalysis);
  return handler(liveCtx() as never, { input });
}

// ═════════════════════════════════════════════════════════════════
// 1. REAL network reachability of every provider the flow depends on
// ═════════════════════════════════════════════════════════════════

const PROVIDER_ENDPOINTS: Array<{
  provider: string;
  host: string;
  url: string;
  credentialEnv: string | null;
}> = [
  { provider: "okx", host: "www.okx.com", credentialEnv: null, url: "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=15m&limit=2" },
  { provider: "twelve-data", host: "api.twelvedata.com", credentialEnv: "TWELVE_DATA_API_KEY", url: "https://api.twelvedata.com/time_series?symbol=EUR%2FUSD&interval=1h&outputsize=2" },
  { provider: "alpha-vantage", host: "www.alphavantage.co", credentialEnv: "ALPHA_VANTAGE_API_KEY", url: "https://www.alphavantage.co/query?function=OVERVIEW&symbol=IBM&apikey=demo" },
  { provider: "coinglass", host: "open-api-v3.coinglass.com", credentialEnv: "COINGLASS_API_KEY", url: "https://open-api-v3.coinglass.com/api/futures/openInterest/ohlc-history?symbol=BTC&interval=1h" },
  { provider: "tickatlas", host: "tickatlas.com", credentialEnv: "TICKATLAS_API_KEY", url: "https://tickatlas.com/v1/calendar" },
  { provider: "cftc", host: "publicreporting.cftc.gov", credentialEnv: null, url: "https://publicreporting.cftc.gov/resource/6dca-aqww.json?$limit=1" },
  { provider: "us-treasury", host: "home.treasury.gov", credentialEnv: null, url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve" },
  { provider: "eia", host: "api.eia.gov", credentialEnv: "EIA_API_KEY", url: "https://api.eia.gov/v2/petroleum/sto/data/?api_key=DEMO_KEY&length=1" },
  { provider: "tokenomist", host: "api.tokenomist.xyz", credentialEnv: null, url: "https://api.tokenomist.xyz/token/BTC/supply" },
  { provider: "defillama", host: "api.llama.fi", credentialEnv: null, url: "https://api.llama.fi/v2/historicalChainTvl/ethereum" },
];

/** Error text from a real fetch failure, including the undici cause code. */
function fetchErrorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText =
      cause instanceof Error ? `${cause.name}: ${cause.message}` : cause ? String(cause) : "";
    return `${err.name}: ${err.message}${causeText ? ` (${causeText})` : ""}`;
  }
  return String(err);
}

describe("283 — real provider reachability (no stubs)", () => {
  it("probes every provider the four-asset flow depends on with a REAL request", async () => {
    // Probed in parallel: a blocked socket must not consume the budget of a
    // reachable one, and the whole matrix is one environment fact.
    const probes = await Promise.all(
      PROVIDER_ENDPOINTS.map(async (endpoint): Promise<ReachabilityRecord> => {
        const base: ReachabilityRecord = {
          provider: endpoint.provider,
          host: endpoint.host,
          credentialEnv: endpoint.credentialEnv,
          credentialPresent: credentialPresent(endpoint.credentialEnv),
          reachable: false,
          httpStatus: null,
          classification: "PROVIDER_UNAVAILABLE",
          error: null,
        };
        try {
          const res = await fetch(endpoint.url, {
            method: "GET",
            signal: AbortSignal.timeout(6_000),
            headers: { Accept: "application/json" },
          });
          return {
            ...base,
            reachable: true,
            httpStatus: res.status,
            classification: res.status === 429 ? "RATE_LIMITED" : "SUCCESS",
          };
        } catch (err) {
          const text = fetchErrorText(err);
          return { ...base, error: text, classification: classifyOutcome(text, endpoint.credentialEnv) };
        }
      }),
    );
    for (const record of probes) {
      REACHABILITY.push(record);
      console.log(
        `[Phase 283] reachability ${record.provider.padEnd(14)} ${record.host.padEnd(28)} ` +
          `${record.reachable ? `http=${record.httpStatus}` : `blocked (${record.classification})`}`,
      );
    }

    // The probe itself must have produced a classified verdict for every
    // provider — no silent, unclassified outcome is allowed to stand in for one.
    expect(REACHABILITY.length).toBe(PROVIDER_ENDPOINTS.length);
    for (const record of REACHABILITY) {
      expect(CLASSIFICATIONS).toContain(record.classification);
      if (!record.reachable) expect(record.error).toBeTruthy();
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// 2-5. The four domains through the REAL protected path
// ═════════════════════════════════════════════════════════════════

/** The env var the MARKET-DATA leg requires for each domain. */
function marketKeyFor(assetClass: DomainRecord["assetClass"]): string | null {
  return assetClass === "crypto" ? null : "TWELVE_DATA_API_KEY";
}

function recordDomain(
  assetClass: DomainRecord["assetClass"],
  instrument: string,
  res: ProtectedResponse,
  extras: {
    fundamentalKeyByProvider?: Record<string, string | null>;
    failureReason?: string | null;
  } = {},
): DomainRecord {
  const r = res.result ?? {};
  const env = marketEnvelope;
  const requestOk = env?.success === true;
  const fundamentalSources = uniqueSources(r.fundamentalAssessment);

  const record: DomainRecord = {
    assetClass,
    instrument,
    provider: env?.data?.provider ?? r.provider ?? null,
    providerInstrumentId: env?.data?.providerInstrumentId ?? r.providerInstrumentId ?? null,
    request: { success: requestOk, ...(env?.error ? { error: env.error } : {}) },
    classification: requestOk ? "SUCCESS" : classifyOutcome(env?.error, marketKeyFor(assetClass)),
    providerObservationTimestamp: env?.data?.price?.timestamp ?? null,
    marketDataFreshness: env?.data?.dataFreshness ?? null,
    fundamentalSources,
    reportingPeriod: r.fundamentalAssessment?.reportingPeriod ?? null,
    technicalState: r.unifiedIntelligence?.technical.available
      ? `${r.unifiedIntelligence.technical.bias} (${r.unifiedIntelligence.technical.confidence})`
      : null,
    fundamentalState: r.fundamentalAssessment
      ? `${r.fundamentalAssessment.state} (${r.fundamentalAssessment.confidence})`
      : null,
    unifiedState: r.unifiedIntelligence?.state ?? null,
    actionability: r.unifiedIntelligence
      ? `${r.unifiedIntelligence.actionable ? "actionable" : "not-actionable"}: ${r.unifiedIntelligence.actionabilityReason}`
      : null,
    radarState: r.unifiedIntelligence ? sweepRadar(assetClass, instrument, r) : null,
    failureReason:
      extras.failureReason ??
      (requestOk ? null : (env?.error ?? "market data leg did not return a live envelope")),
  };
  DOMAIN_RECORDS.push(record);
  console.log(
    `[Phase 283] domain ${assetClass.padEnd(9)} ${instrument.padEnd(10)} -> ${record.classification}` +
      (record.failureReason ? ` :: ${record.failureReason.slice(0, 160)}` : ""),
  );
  return record;
}

function uniqueSources(fa: FundamentalAssessment | undefined): string[] {
  // An unavailable assessment obtained no fundamental evidence, so it names no
  // fundamental source — the provider that supplied the MARKET leg is not one.
  if (!fa || !fa.available) return [];
  const sources = (fa.summary ?? "")
    .split("\n")
    .filter((line) => line.startsWith("Sources:"))
    .join(" ")
    .replace("Sources:", "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // The provider string is the framework's own attribution of the bags used.
  return Array.from(new Set([...sources.map((s) => s.split(" (")[0]), ...(fa.provider ? [fa.provider] : [])])).slice(0, 6);
}

/**
 * The scanner is the radar half of the flow. It is given the delivered unified
 * object exactly as the Dashboard gives it to `scanRadar` — no value is
 * recomputed here, and with no live market data there is nothing for it to
 * rank, which the record states rather than inventing a candidate.
 */
function sweepRadar(
  assetClass: DomainRecord["assetClass"],
  instrument: string,
  r: NonNullable<ProtectedResponse["result"]>,
): string {
  const unified = r.unifiedIntelligence;
  if (!unified) return "no-unified-object";
  if (!unified.technical.available) return `no-candidate (technical unavailable; unified ${unified.state})`;
  return `candidate (unified ${unified.state}; agreement ${unified.confluence.agreement}) for ${assetClass}:${instrument}`;
}

/**
 * A run that did not obtain live market data is a VALID result — but it must be
 * a classified, disclosed one, with no live evidence fabricated anywhere.
 *
 * The expected class depends on the environment, not on a wish: with the market
 * credential absent the production code refuses BEFORE dialling and says so;
 * with it present, a failure is a network/provider fact.
 */
function assertHonestFailure(
  record: DomainRecord,
  res: ProtectedResponse,
  marketKey: string | null,
): void {
  expect(CLASSIFICATIONS).toContain(record.classification);
  expect(record.classification).not.toBe("SUCCESS");
  expect(record.failureReason).toBeTruthy();
  expect(record.providerObservationTimestamp).toBeNull();
  if (marketKey && !credentialPresent(marketKey)) {
    expect(record.classification).toBe("CREDENTIAL_REQUIRED");
    expect(record.failureReason ?? "").toMatch(new RegExp(marketKey));
  } else {
    expect([
      "PROVIDER_UNAVAILABLE",
      "RATE_LIMITED",
      "DATA_QUALITY_FAILURE",
      "UNSUPPORTED",
      "STALE",
    ]).toContain(record.classification);
  }
  // Nothing was invented to fill the gap: no technical read, and the delivered
  // completeness is the engine's own "limited" verdict.
  expect(res.result?.unifiedIntelligence?.technical.available ?? false).toBe(false);
  expect(res.result?.dataCompleteness).toBe("limited");
}

beforeEach(() => {
  resetProviderCache();
  marketEnvelope = null;
});

afterEach(() => {
  resetProviderCache();
});

// ─────────────────────────────────────────────────────────────────
// 2. Provider-leg ledger — every leg the four domains consume, dialled for real
// ─────────────────────────────────────────────────────────────────

type LegEnvelope = { success?: boolean; error?: string; errorCode?: string };

/** The real action handler of a provider leg, carrying its real transport. */
function legHandler(action: unknown): (c: never, a: never) => Promise<LegEnvelope> {
  return (action as { _handler: (c: never, a: never) => Promise<LegEnvelope> })._handler;
}

/** One provider leg, invoked exactly as the protected action invokes it. */
async function probeLeg(
  provider: string,
  domain: string,
  credentialEnv: string | null,
  call: () => Promise<{ success?: boolean; error?: string; errorCode?: string }>,
): Promise<LegRecord> {
  let record: LegRecord = {
    provider,
    domain,
    credentialEnv,
    credentialPresent: credentialPresent(credentialEnv),
    success: false,
    classification: "PROVIDER_UNAVAILABLE",
    reason: null,
  };
  try {
    const envelope = await call();
    const success = envelope?.success === true;
    record = {
      ...record,
      success,
      classification: success ? "SUCCESS" : classifyOutcome(envelope?.error ?? envelope?.errorCode, credentialEnv),
      reason: success ? null : (envelope?.error ?? envelope?.errorCode ?? "leg reported no success and no reason"),
    };
  } catch (err) {
    const text = fetchErrorText(err);
    record = { ...record, classification: classifyOutcome(text, credentialEnv), reason: text };
  }
  LEG_RECORDS.push(record);
  console.log(
    `[Phase 283] leg ${provider.padEnd(20)} ${domain.padEnd(9)} ${record.success ? "ok" : record.classification}` +
      (record.reason ? ` :: ${record.reason.slice(0, 120)}` : ""),
  );
  return record;
}

describe("283 — provider legs (real requests, per provider)", () => {
  it("dials every provider the four domains depend on through its production handler", async () => {
    const market = legHandler(fetchMarketData);
    const av = legHandler(fetchIntelligence);
    const calendar = legHandler(fetchCalendar);
    const derivatives = legHandler(fetchDerivatives);
    const cot = legHandler(fetchCotPositioning);
    const eia = legHandler(fetchEiaInventory);
    const treasury = legHandler(fetchTreasuryYields);
    const orderBook = legHandler(fetchOkxOrderBook);
    const instrumentSpec = legHandler(fetchOkxInstrumentSpec);

    const ctx = liveCtx();

    // CRYPTO
    await probeLeg("okx (OHLCV)", "crypto", null, () =>
      market(ctx as never, {
        instrument: "BTC-USDT",
        instrumentType: "crypto",
        timeframe: "M15",
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
      } as never),
    );
    await probeLeg("okx (order book)", "crypto", null, () => orderBook(ctx as never, { instrument: "BTC-USDT" } as never));
    await probeLeg("okx (instrument spec)", "crypto", null, () =>
      instrumentSpec(ctx as never, { instrument: "BTC-USDT" } as never),
    );
    await probeLeg("coinglass", "crypto", "COINGLASS_API_KEY", () =>
      derivatives(ctx as never, { instrument: "BTC-USDT" } as never),
    );
    {
      // Tokenomist + DeFiLlama are the crypto-NATIVE fundamental legs. They are
      // acquired by the production module the protected action calls, and each
      // sub-leg reports its own outcome.
      const acquired = await acquireCryptoFundamentals({
        instrument: "BTC-USDT",
        instrumentType: "crypto",
        providerInstrumentId: "BTC-USDT",
      });
      for (const leg of acquired.legs) {
        const record: LegRecord = {
          provider: leg.provider,
          domain: "crypto",
          credentialEnv: null,
          credentialPresent: true,
          success: leg.status === "ok",
          classification: leg.status === "ok" ? "SUCCESS" : classifyOutcome(leg.reason, null),
          reason: leg.status === "ok" ? null : (leg.reason ?? "leg reported no reason"),
        };
        LEG_RECORDS.push(record);
        console.log(
          `[Phase 283] leg ${record.provider.padEnd(20)} crypto    ` +
            `${record.success ? "ok" : record.classification}${record.reason ? ` :: ${record.reason.slice(0, 120)}` : ""}`,
        );
      }
    }

    // FOREX / STOCK / COMMODITY market data
    await probeLeg("twelve-data (FX)", "forex", "TWELVE_DATA_API_KEY", () =>
      market(ctx as never, {
        instrument: "EUR/USD",
        instrumentType: "forex",
        timeframe: "H4",
        provider: "twelve-data",
        providerInstrumentId: "EUR/USD",
      } as never),
    );
    await probeLeg("twelve-data (equity)", "stock", "TWELVE_DATA_API_KEY", () =>
      market(ctx as never, {
        instrument: "AAPL",
        instrumentType: "stock",
        timeframe: "H4",
        provider: "twelve-data",
        providerInstrumentId: "AAPL",
      } as never),
    );
    await probeLeg("twelve-data (commodity)", "commodity", "TWELVE_DATA_API_KEY", () =>
      market(ctx as never, {
        instrument: "WTI/USD",
        instrumentType: "commodity",
        timeframe: "H4",
        provider: "twelve-data",
        providerInstrumentId: "WTI/USD",
      } as never),
    );
    // Fundamental legs
    await probeLeg("alpha-vantage", "stock", "ALPHA_VANTAGE_API_KEY", () =>
      av(ctx as never, { instrument: "AAPL", instrumentType: "stock", provider: "twelve-data", providerInstrumentId: "AAPL" } as never),
    );
    await probeLeg("tickatlas", "forex", "TICKATLAS_API_KEY", () =>
      calendar(ctx as never, { instrument: "EUR/USD", instrumentType: "forex" } as never),
    );
    await probeLeg("cftc (EUR)", "forex", null, () => cot(ctx as never, { instrument: "EUR/USD" } as never));
    await probeLeg("cftc (WTI)", "commodity", null, () => cot(ctx as never, { instrument: "WTI/USD" } as never));
    await probeLeg("us-treasury", "forex+commodity", null, () => treasury(ctx as never, {} as never));
    await probeLeg("eia", "commodity", "EIA_API_KEY", () => eia(ctx as never, {} as never));

    // Every leg produced a classified verdict — no unclassified silence.
    expect(LEG_RECORDS.length).toBeGreaterThanOrEqual(12);
    for (const record of LEG_RECORDS) {
      expect(CLASSIFICATIONS).toContain(record.classification);
      if (!record.success) expect(record.reason ?? record.classification).toBeTruthy();
      // A credential-gated provider may only be reported as CREDENTIAL_REQUIRED
      // when the credential really is absent.
      if (record.classification === "CREDENTIAL_REQUIRED") expect(record.credentialPresent).toBe(false);
    }
  });
});

describe("283 — crypto (OKX native path)", () => {
  it("BTC-USDT through the real protected action", async () => {
    const res = await runLiveAnalysis({
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      tradingStyle: "swing",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });
    const record = recordDomain("crypto", "BTC-USDT", res);

    if (record.classification === "SUCCESS") {
      // Live path: the whole chain must exist, with the PROVIDER's timestamps.
      expect(res.status).toBe("DELIVERED");
      expect(record.provider).toBe("okx");
      expect(record.providerInstrumentId).toBe("BTC-USDT");
      expect(record.providerObservationTimestamp).toBeGreaterThan(0);
      expect(record.technicalState).toBeTruthy();
      expect(record.fundamentalState).toBeTruthy();
      expect(record.unifiedState).toBeTruthy();
      // Delivered market evidence is the provider's own: no fabricated instant.
      expect(record.marketDataFreshness).not.toBe("unavailable");
    } else {
      assertHonestFailure(record, res, null);
      // OKX needs no credential, so a failure here is a transport fact.
      expect(["PROVIDER_UNAVAILABLE", "RATE_LIMITED", "DATA_QUALITY_FAILURE", "STALE"]).toContain(
        record.classification,
      );
    }
  });
});

describe("283 — forex (Twelve Data + macro providers)", () => {
  it("EUR/USD through the real protected action", async () => {
    const res = await runLiveAnalysis({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
    });
    const record = recordDomain("forex", "EUR/USD", res, {
      fundamentalKeyByProvider: { tickatlas: "TICKATLAS_API_KEY" },
    });

    if (record.classification === "SUCCESS") {
      expect(res.status).toBe("DELIVERED");
      expect(record.providerInstrumentId).toBe("EUR/USD");
      expect(record.providerObservationTimestamp).toBeGreaterThan(0);
      expect(record.technicalState).toBeTruthy();
      // Two-sided macro evidence is reported per side by the assessment; a live
      // pair without a calendar leg reports that dimension as unavailable
      // rather than as neutral.
      expect(record.fundamentalState).toBeTruthy();
      expect(record.unifiedState).toBeTruthy();
    } else {
      assertHonestFailure(record, res, "TWELVE_DATA_API_KEY");
    }
  });
});

describe("283 — stock (Twelve Data market data + Alpha Vantage fundamentals)", () => {
  it("AAPL through the real protected action", async () => {
    const res = await runLiveAnalysis({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "AAPL",
    });
    const record = recordDomain("stock", "AAPL", res, {
      fundamentalKeyByProvider: { "alpha-vantage": "ALPHA_VANTAGE_API_KEY" },
    });

    if (record.classification === "SUCCESS") {
      expect(res.status).toBe("DELIVERED");
      expect(record.providerInstrumentId).toBe("AAPL");
      expect(record.providerObservationTimestamp).toBeGreaterThan(0);
      expect(record.technicalState).toBeTruthy();
      // Reported fiscal periods travel with the assessment and are never the
      // market-data instant.
      if (record.fundamentalState && !record.fundamentalState.startsWith("unavailable")) {
        expect(record.reportingPeriod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(record.reportingPeriod).not.toBe(
          new Date(record.providerObservationTimestamp!).toISOString().slice(0, 10),
        );
      }
    } else {
      assertHonestFailure(record, res, "TWELVE_DATA_API_KEY");
    }
  });
});

describe("283 — commodity (Twelve Data + EIA/CFTC/Treasury)", () => {
  it("WTI/USD through the real protected action", async () => {
    const res = await runLiveAnalysis({
      instrument: "WTI/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      tradingStyle: "swing",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
    });
    const record = recordDomain("commodity", "WTI/USD", res, {
      fundamentalKeyByProvider: {
        eia: "EIA_API_KEY",
        cftc: null,
        "us-treasury": null,
      },
    });

    if (record.classification === "SUCCESS") {
      expect(res.status).toBe("DELIVERED");
      expect(record.providerInstrumentId).toBe("WTI/USD");
      expect(record.providerObservationTimestamp).toBeGreaterThan(0);
      const fa = res.result?.fundamentalAssessment;
      expect(fa?.domain).toBe("commodity");
      // Commodity-native: no company-style metric may appear anywhere.
      const text = [
        ...(fa?.dimensions ?? []).map((d) => d.evidence ?? ""),
        fa?.summary ?? "",
        fa?.confidenceEvidence ?? "",
      ].join(" ");
      expect(text).not.toMatch(/\bEPS\b|P\/E|net margin|book value|\bROE\b/i);
      expect(record.unifiedState).toBeTruthy();
    } else {
      assertHonestFailure(record, res, "TWELVE_DATA_API_KEY");
    }
  });
});

describe("283 — the record itself", () => {
  it("covers all four asset classes and never fabricates a success", () => {
    expect(DOMAIN_RECORDS.length).toBe(4);
    expect(new Set(DOMAIN_RECORDS.map((r) => r.assetClass)).size).toBe(4);
    for (const record of DOMAIN_RECORDS) {
      expect(CLASSIFICATIONS).toContain(record.classification);
      // A run that did not obtain live market data must say so explicitly...
      if (record.classification !== "SUCCESS") {
        expect(record.failureReason).toBeTruthy();
        expect(record.providerObservationTimestamp).toBeNull();
      }
      // ...and an observation instant can only ever come from the provider.
      if (record.providerObservationTimestamp !== null) {
        expect(record.request.success).toBe(true);
        expect(record.providerObservationTimestamp).toBeGreaterThan(0);
      }
    }
  });
});
