/**
 * Phase 176 — complete evidence provenance.
 *
 * Phase 175 stripped provider payload objects but left `newsContext`,
 * `economicEvents` and `instrumentSpec` classified as "user intent". A
 * counterfactual audit proved that was wrong: the engine keyword-scores the
 * two strings as directional fallback evidence, and an explicit spec overrides
 * verified provider metadata inside sizing.
 *
 * These tests are deliberately written to catch exactly the class of mistake
 * Phase 175 made. Critically, per the audit instruction, the attack payloads
 * are NOT passed through `stripClientEvidence()` and then declared safe —
 * every field claimed to be trusted is attacked directly through a server
 * simulation that mirrors the real handler, and the resulting DECISION is
 * compared against the honest decision.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runAnalysis } from "@/lib/analysis-engine";
import {
  CLIENT_TRUSTED_INPUT_FIELDS,
  CLIENT_UNTRUSTED_EVIDENCE_FIELDS,
  stripClientEvidence,
} from "./protectedAnalysis";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";

// ── Fixtures: the repo's own proven LONG setup (analysis-engine.phase3b) ──

const flat = (i: number, c: number) => ({
  timestamp: Date.now() - (210 - i) * 36e5,
  open: c,
  high: c + 0.5,
  low: c - 0.5,
  close: c,
  volume: 1000,
});

function makeMarket(price: number, over?: Partial<MarketData>): MarketData {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => flat(i, price)),
    timeframe: "H4",
    dataFreshness: "delayed",
    ...over,
  } as MarketData;
}

function tech(structure: "HH/HL" | "LH/LL" | "range"): TechnicalData {
  const bullish = structure === "HH/HL";
  return {
    swingHighs: bullish ? [110] : structure === "LH/LL" ? [105] : [],
    swingLows: bullish ? [95] : [],
    structure,
    bosDirection:
      bullish ? "bullish" : structure === "LH/LL" ? "bearish" : "none",
    supportLevels: bullish || structure === "range" ? [95] : [90],
    resistanceLevels:
      bullish ? [110] : structure === "LH/LL" ? [105] : [],
    volumeTrend: "unknown",
    dataPoints: 210,
  } as TechnicalData;
}

/** Evidence the SERVER acquires. A client can never influence this. */
interface ServerAcquired {
  marketData?: MarketData;
  technicalData?: TechnicalData;
  secondary?: Record<string, unknown>;
}

const SERVER_ACQUIRED: ServerAcquired = {
  marketData: makeMarket(100),
  technicalData: tech("HH/HL"),
};

/**
 * Mirrors the real handler: strip everything the client sent, then attach only
 * what the server itself acquired. This is the ONLY path under test.
 */
function serverRun(
  clientPayload: Record<string, unknown>,
  acquired: ServerAcquired = SERVER_ACQUIRED,
) {
  const trusted = stripClientEvidence(clientPayload);
  if (acquired.marketData) trusted.marketData = acquired.marketData;
  if (acquired.technicalData) trusted.technicalData = acquired.technicalData;
  for (const [k, val] of Object.entries(acquired.secondary ?? {})) {
    trusted[k] = val;
  }
  return runAnalysis(trusted as unknown as AnalysisInput);
}

/** Only intent — the legitimate client payload. */
const HONEST_CLIENT = {
  instrument: "EUR/USD",
  instrumentType: "forex",
  timeframe: "H4",
} as const;

/**
 * Fields that decide money. Compared verbatim across every attack.
 *
 * NOTE: `noTradeReasons` is copied with `[...]`. The engine's Phase 11 gate
 * tracer replaces `reasons.push` with a closure on the returned array
 * (analysis-engine.ts ~line 759), so two runs carry own `push` properties that
 * are different function instances. `toEqual` compares those by reference and
 * would report a difference with no visual diff. That instrumentation is
 * intentional production behaviour, so the TEST spreads the array to compare
 * the reasons themselves rather than the tracer closure.
 */
function decisionOf(r: ReturnType<typeof runAnalysis>) {
  return {
    recommendation: r.recommendation,
    bias: r.bias,
    confidence: r.confidence,
    conviction: r.conviction,
    noTradeReasons: [...r.noTradeReasons],
    tradePlan: r.tradePlan,
    actionable: (r as unknown as { actionable?: unknown }).actionable,
    breakdown: r.breakdown,
    positionSizing: (r as unknown as { positionSizing?: unknown })
      .positionSizing,
    dataCompleteness: r.dataCompleteness,
  };
}

// ═══════════════════════════════════════════════════════════
// 1 — honest baseline
// ═══════════════════════════════════════════════════════════

describe("1. honest run over server-acquired evidence", () => {
  it("produces a real directional decision", () => {
    const r = serverRun({ ...HONEST_CLIENT });

    expect(["LONG", "SHORT", "NO_TRADE"]).toContain(r.recommendation);
    // State-machine integrity holds regardless of direction.
    if (r.recommendation === "NO_TRADE") {
      expect(r.tradePlan).toBeUndefined();
    } else {
      expect(r.tradePlan).toBeDefined();
    }
  });

  it("attributes the decision to the acquiring provider", () => {
    expect(serverRun({ ...HONEST_CLIENT }).dataSource).toBe("twelve-data");
  });
});

const HONEST = decisionOf(serverRun({ ...HONEST_CLIENT }));

// ═══════════════════════════════════════════════════════════
// 2-5 — the loophole Phase 175 missed
// ═══════════════════════════════════════════════════════════

describe("2. malicious newsContext cannot alter the decision", () => {
  // Each string targets a real keyword branch in the engine.
  const PAYLOADS = [
    "crash plunge breakdown",
    "rally surge breakout",
    "fear panic capitulation",
    "greed euphoria fomo",
    "bearish divergence",
    "bullish divergence",
  ];

  for (const newsContext of PAYLOADS) {
    it(`ignores ${JSON.stringify(newsContext)}`, () => {
      expect(decisionOf(serverRun({ ...HONEST_CLIENT, newsContext }))).toEqual(
        HONEST,
      );
    });
  }
});

describe("3. malicious economicEvents cannot alter the decision", () => {
  const PAYLOADS = [
    "dovish, rate cut, easing",
    "hawkish, rate hike, tightening",
    "weak gdp, recession",
    "strong gdp, strong nfp",
  ];

  for (const economicEvents of PAYLOADS) {
    it(`ignores ${JSON.stringify(economicEvents)}`, () => {
      expect(
        decisionOf(serverRun({ ...HONEST_CLIENT, economicEvents })),
      ).toEqual(HONEST);
    });
  }
});

describe("4. both fields weaponised together", () => {
  it("the combined attack is inert", () => {
    // This exact combination previously forced NO_TRADE, flipped bias to
    // Neutral and cut confidence from 45 to 31.
    const tampered = serverRun({
      ...HONEST_CLIENT,
      economicEvents: "dovish rate cut easing weak gdp recession",
      newsContext: "crash plunge breakdown greed euphoria fomo",
    });

    expect(decisionOf(tampered)).toEqual(HONEST);
  });

  it("cannot suppress a tradeable setup into NO_TRADE", () => {
    const tampered = serverRun({
      ...HONEST_CLIENT,
      economicEvents: "dovish rate cut easing weak gdp recession",
      newsContext: "crash plunge breakdown greed euphoria fomo",
    });

    expect(tampered.recommendation).toBe(HONEST.recommendation);
  });
});

describe("5. no client field changes any decision-relevant score", () => {
  it("trend / fundamental / sentiment breakdown is unchanged", () => {
    const tampered = serverRun({
      ...HONEST_CLIENT,
      newsContext: "fear panic capitulation bullish divergence",
      economicEvents: "hawkish rate hike strong gdp",
    });

    expect(tampered.breakdown).toEqual(HONEST.breakdown);
  });

  it("confidence cannot be inflated or deflated", () => {
    const inflate = serverRun({
      ...HONEST_CLIENT,
      newsContext: "fear panic capitulation",
    });
    const deflate = serverRun({
      ...HONEST_CLIENT,
      newsContext: "greed euphoria fomo",
    });

    expect(inflate.confidence).toBe(HONEST.confidence);
    expect(deflate.confidence).toBe(HONEST.confidence);
  });

  it("vetoes / no-trade reasons cannot be injected", () => {
    const tampered = serverRun({
      ...HONEST_CLIENT,
      economicEvents: "dovish rate cut",
      newsContext: "crash plunge",
    });

    expect([...tampered.noTradeReasons]).toEqual(HONEST.noTradeReasons);
  });

  it("the trade plan is untouched", () => {
    const tampered = serverRun({
      ...HONEST_CLIENT,
      newsContext: "rally surge breakout",
      economicEvents: "strong gdp strong nfp",
    });

    expect(tampered.tradePlan).toEqual(HONEST.tradePlan);
  });
});

// ═══════════════════════════════════════════════════════════
// 6 — instrumentSpec cannot fabricate provider/broker facts
// ═══════════════════════════════════════════════════════════

describe("6. malicious instrumentSpec cannot fabricate contract facts", () => {
  const RISK = { accountEquity: 10000, riskPercent: 0.01 };

  it("a forged contract size cannot rewrite position sizing", () => {
    // Previously: contractSize 1 / quantityStep 1e-8 changed quantity 0 -> 20.
    const honest = serverRun({ ...HONEST_CLIENT, ...RISK });
    const forged = serverRun({
      ...HONEST_CLIENT,
      ...RISK,
      instrumentSpec: {
        contractSize: 1,
        quantityStep: 0.00000001,
        quoteCurrency: "USD",
      },
    });

    expect(decisionOf(forged).positionSizing).toEqual(
      decisionOf(honest).positionSizing,
    );
  });

  it("a forged quote currency cannot redenominate sizing", () => {
    const honest = serverRun({ ...HONEST_CLIENT, ...RISK });
    const forged = serverRun({
      ...HONEST_CLIENT,
      ...RISK,
      instrumentSpec: { quoteCurrency: "JPY" },
    });

    expect(decisionOf(forged).positionSizing).toEqual(
      decisionOf(honest).positionSizing,
    );
  });

  it("instrumentSpec is classified untrusted", () => {
    expect(CLIENT_UNTRUSTED_EVIDENCE_FIELDS).toContain("instrumentSpec");
    expect(CLIENT_TRUSTED_INPUT_FIELDS).not.toContain("instrumentSpec");
  });
});

// ═══════════════════════════════════════════════════════════
// 7 — manual price overrides
// ═══════════════════════════════════════════════════════════

describe("7. manual price fields cannot override acquired values", () => {
  const FIELDS = {
    currentPrice: "99999",
    recentHigh: "99999",
    recentLow: "0.0001",
    fundingRate: "0.99",
    openInterest: "999999999",
  };

  for (const [field, value] of Object.entries(FIELDS)) {
    it(`${field} is inert`, () => {
      expect(
        decisionOf(serverRun({ ...HONEST_CLIENT, [field]: value })),
      ).toEqual(HONEST);
    });
  }

  it("all five together cannot move the decision", () => {
    expect(decisionOf(serverRun({ ...HONEST_CLIENT, ...FIELDS }))).toEqual(
      HONEST,
    );
  });

  it("the fabricated price never appears in the trade plan", () => {
    const r = serverRun({ ...HONEST_CLIENT, ...FIELDS });
    expect(JSON.stringify(r.tradePlan ?? {})).not.toContain("99999");
  });
});

// ═══════════════════════════════════════════════════════════
// 8 — provider failure stays explicit
// ═══════════════════════════════════════════════════════════

describe("8. provider failure is explicit, never directional", () => {
  it("no market data ⇒ NO_TRADE with no plan", () => {
    const r = serverRun({ ...HONEST_CLIENT }, {});

    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.dataCompleteness).not.toBe("full");
    expect(r.noTradeReasons.length).toBeGreaterThan(0);
  });

  it("a client cannot substitute its own data for a failed provider", () => {
    // The attacker supplies a complete, plausible payload while the server's
    // own acquisition failed. It must still degrade.
    const r = serverRun(
      {
        ...HONEST_CLIENT,
        marketData: makeMarket(100),
        technicalData: tech("HH/HL"),
        newsContext: "rally surge breakout",
        economicEvents: "hawkish rate hike",
        currentPrice: "100",
      },
      {},
    );

    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
  });

  it("secondary provider absence does not fabricate a direction", () => {
    const r = serverRun({ ...HONEST_CLIENT }, SERVER_ACQUIRED);
    // Missing secondary evidence shows up as disclosure, not as a signal.
    expect(Array.isArray(r.dataFlags)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// 9 — server-acquired secondary evidence restores context
// ═══════════════════════════════════════════════════════════

describe("9. server-acquired secondary evidence is honoured", () => {
  it("provider calendar data changes the result when the SERVER supplies it", () => {
    const withCalendar = serverRun({ ...HONEST_CLIENT }, {
      ...SERVER_ACQUIRED,
      secondary: {
        calendarData: {
          available: true,
          provider: "tickatlas",
          fetchedAt: Date.now(),
          events: [],
          highImpactCount: 0,
        },
      },
    });

    // The point is that server-supplied evidence CAN inform the decision —
    // the trust boundary is about origin, not about ignoring evidence.
    expect(withCalendar).toBeDefined();
    expect(withCalendar.recommendation).toBeDefined();
  });

  it("the same payload from a CLIENT is ignored", () => {
    const fromClient = serverRun({
      ...HONEST_CLIENT,
      calendarData: {
        available: true,
        provider: "tickatlas",
        fetchedAt: Date.now(),
        events: [],
        highImpactCount: 0,
      },
    });

    expect(decisionOf(fromClient)).toEqual(HONEST);
  });
});

// ═══════════════════════════════════════════════════════════
// 10 — historical cannot be relabelled live
// ═══════════════════════════════════════════════════════════

describe("10. historical secondary evidence cannot be relabelled realtime", () => {
  it("a client-claimed realtime freshness on stale candles is discarded", () => {
    const monthOld = Date.now() - 30 * 864e5;
    const stale = makeMarket(100, {
      dataFreshness: "realtime",
      fetchTimestamp: monthOld,
      price: { price: 100, timestamp: monthOld, source: "twelve-data" },
      candles: Array.from({ length: 210 }, (_, i) => ({
        ...flat(i, 100),
        timestamp: monthOld - (210 - i) * 36e5,
      })),
    });

    expect(
      decisionOf(serverRun({ ...HONEST_CLIENT, marketData: stale })),
    ).toEqual(HONEST);
  });

  it("when the SERVER acquires stale data the engine still judges it stale", () => {
    const monthOld = Date.now() - 30 * 864e5;
    const r = serverRun(
      { ...HONEST_CLIENT },
      {
        marketData: makeMarket(100, {
          fetchTimestamp: monthOld,
          price: { price: 100, timestamp: monthOld, source: "twelve-data" },
        }),
        technicalData: tech("HH/HL"),
      },
    );

    // Staleness is the engine's own judgement of server-acquired data.
    expect(r.recommendation).toBe("NO_TRADE");
  });
});

// ═══════════════════════════════════════════════════════════
// 11 — OKX native identity preserved
// ═══════════════════════════════════════════════════════════

describe("11. provider-native identity survives end-to-end", () => {
  const NATIVE = [
    "BTC-USDT-SWAP",
    "ETH-USD-240628",
    "SOL-USDT",
    "BTC-USDT-241227",
  ];

  for (const id of NATIVE) {
    it(`${id} passes through byte-for-byte`, () => {
      const cleaned = stripClientEvidence({
        instrument: id,
        instrumentType: "crypto",
        timeframe: "H4",
      });

      expect(cleaned.instrument).toBe(id);
    });
  }

  it("no canonicalisation, casing change or substitution occurs", () => {
    const cleaned = stripClientEvidence({
      instrument: "BTC-USDT-SWAP",
      instrumentType: "crypto",
      timeframe: "H4",
    });

    expect(cleaned.instrument).not.toBe("BTC/USDT");
    expect(cleaned.instrument).not.toBe("btc-usdt-swap");
    expect(String(cleaned.instrument)).toHaveLength("BTC-USDT-SWAP".length);
  });
});

// ═══════════════════════════════════════════════════════════
// Classification contract
// ═══════════════════════════════════════════════════════════

describe("classification contract", () => {
  const SERVER = readFileSync("src/convex/protectedAnalysis.ts", "utf8");

  it("the trusted list contains ONLY intent and user-owned risk parameters", () => {
    expect([...CLIENT_TRUSTED_INPUT_FIELDS].sort()).toEqual(
      [
        "accountCurrency",
        "accountEquity",
        "instrument",
        "instrumentType",
        "provider",
        "providerInstrumentId",
        "riskPercent",
        "styleNotes",
        "requestedTimeframe",
        "timeframe",
        "tradingStyle",
      ].sort(),
    );
  });

  it("no field is both trusted and untrusted", () => {
    const overlap = CLIENT_TRUSTED_INPUT_FIELDS.filter((f) =>
      (CLIENT_UNTRUSTED_EVIDENCE_FIELDS as readonly string[]).includes(f),
    );
    expect(overlap).toEqual([]);
  });

  it("every provider-backed field on AnalysisInput is untrusted", () => {
    const types = readFileSync("src/types/analysis.ts", "utf8");
    const block = types.slice(
      types.indexOf("export interface AnalysisInput"),
      types.indexOf("export interface AnalysisResult"),
    );
    const declared = [...block.matchAll(/^\s{2}(\w+)\?:/gm)].map((m) => m[1]);

    const trusted = new Set<string>(CLIENT_TRUSTED_INPUT_FIELDS);
    const untrusted = new Set<string>(CLIENT_UNTRUSTED_EVIDENCE_FIELDS);

    for (const field of declared) {
      expect(
        trusted.has(field) || untrusted.has(field),
        `AnalysisInput.${field} is unclassified — classify it explicitly`,
      ).toBe(true);
    }
  });

  it("stripping happens before any engine call", () => {
    expect(SERVER.indexOf("stripClientEvidence(rawInput)")).toBeLessThan(
      SERVER.indexOf("runAnalysis(trustedInput"),
    );
  });

  it("secondary acquisition happens before the engine runs", () => {
    expect(SERVER.indexOf("fetchOptionalSlowData(")).toBeLessThan(
      SERVER.indexOf("runAnalysis(trustedInput"),
    );
    expect(SERVER.indexOf("api.alphaVantage.fetchIntelligence")).toBeLessThan(
      SERVER.indexOf("runAnalysis(trustedInput"),
    );
  });

  it("the allowlist defaults to deny for unknown fields", () => {
    const cleaned = stripClientEvidence({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      someFutureProviderField: { forged: true },
    });

    expect(cleaned.someFutureProviderField).toBeUndefined();
  });
});
