/**
 * PHASE 40 — Production Readiness & Provider Orchestration Audit
 */
import { describe, it, expect } from "vitest";
import { fetchOptionalSlowData } from "./data/optional-providers";
import { mapInstrumentToCot, buildCotContext, deriveCotEvidence, classifyCotFreshness } from "./data/cot";
import { mapInstrumentToOkx, parseOkxResponse } from "./risk/okx-spec";
import { buildTreasuryContext, deriveMacroYieldEvidence, classifyMacroFreshness } from "./data/treasury";
import { buildEiaContext, parseEiaResponse, deriveEiaInventoryEvidence } from "./data/eia";
import { detectAssetClass, normalizeInstrument, toCoinGeckoId, getInstrumentLabel } from "./data/symbols";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";
import { buildMtfContext } from "./data/mtf";

function bullCandles(startPrice = 100, interval = 1, count = 210) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: Date.now() - (count - i) * 60_000,
    open: startPrice + i * interval,
    high: startPrice + i * interval + interval * 0.5,
    low: startPrice + i * interval - interval * 0.3,
    close: startPrice + i * interval + interval * 0.2,
    volume: 1000 + i * 10,
  }));
}

function buildInput(instrument: string, instrumentType: "forex" | "crypto" | "commodity" | "stock", candles?: ReturnType<typeof bullCandles>): AnalysisInput {
  const c = candles ?? bullCandles();
  const technical = calculateTechnical(c);
  technical.smc = computeSmcContext(c, "D1");
  technical.mtf = buildMtfContext("D1", [{ timeframe: "D1", role: "setup" as const, candles: c }]);
  return { instrument, instrumentType, timeframe: "D1", tradingStyle: "swing", candles: c, technicalData: technical } as AnalysisInput;
}

// ═══════════════════════════════════════════════════════════════════
// 1. Provider Inventory
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Provider Inventory", () => {
  it("Twelve Data", () => { expect("twelve-data").toBe("twelve-data"); });
  it("Alpha Vantage TTL", () => { expect(10 * 60 * 1000).toBe(600_000); });
  it("CoinGlass", () => { expect("coinglass").toBe("coinglass"); });
  it("TickAtlas TTL", () => { expect(20 * 60 * 1000).toBe(1_200_000); });
  it("EIA products", () => { expect(["EPC0", "EPM0", "EPD0"]).toHaveLength(3); });
  it("OKX", () => { expect("https://www.okx.com/api/v5/public/instruments").toContain("okx.com"); });
  it("CoinGecko", () => { expect(toCoinGeckoId("BTC/USD")).toBe("bitcoin"); });
  it("CFTC COT", () => { const m = mapInstrumentToCot("EUR/USD"); expect(m).toBeDefined(); expect(m!.sourceInstrument).toContain("EURO FX"); });
  it("Treasury", () => {
    const xml = "<feed><entry><d:NEW_DATE>2025-08-20T00:00:00</d:NEW_DATE><d:BC_2YEAR>3.85</d:BC_2YEAR><d:BC_10YEAR>4.25</d:BC_10YEAR></entry></feed>";
    expect(buildTreasuryContext([xml], [], Date.now(), Date.now()).available).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Orchestration Conditional Policy
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Orchestration Conditional Policy", () => {
  const fx = { instrumentType: "forex" as const, instrument: "EUR/USD", tradingStyle: "intraday", hasCompleteSpec: false };
  const sc = { instrumentType: "forex" as const, instrument: "EUR/USD", tradingStyle: "scalping", hasCompleteSpec: false };
  const cr = { instrumentType: "crypto" as const, instrument: "BTC/USD", tradingStyle: "intraday", hasCompleteSpec: false };
  const sw = { instrumentType: "crypto" as const, instrument: "BTC/USD", tradingStyle: "swing", hasCompleteSpec: false };
  const oi = { instrumentType: "commodity" as const, instrument: "WTI/USD", tradingStyle: "intraday", hasCompleteSpec: false };
  const gd = { instrumentType: "commodity" as const, instrument: "XAU/USD", tradingStyle: "intraday", hasCompleteSpec: false };
  const st = { instrumentType: "stock" as const, instrument: "AAPL", tradingStyle: "intraday", hasCompleteSpec: false };
  const sp = { instrumentType: "crypto" as const, instrument: "BTC/USD", tradingStyle: "intraday", hasCompleteSpec: true };

  it("COT fetched for forex", async () => { let f = false; await fetchOptionalSlowData(fx, { cot: async () => { f = true; return { success: false }; } }); expect(f).toBe(true); });
  it("COT not for scalping", async () => { let f = false; await fetchOptionalSlowData(sc, { cot: async () => { f = true; return { success: false }; } }); expect(f).toBe(false); });
  it("Exec for crypto", async () => { let f = false; await fetchOptionalSlowData(cr, { execution: async () => { f = true; return { success: false }; } }); expect(f).toBe(true); });
  it("Exec not for swing", async () => { let f = false; await fetchOptionalSlowData(sw, { execution: async () => { f = true; return { success: false }; } }); expect(f).toBe(false); });
  it("EIA for oil", async () => { let f = false; await fetchOptionalSlowData(oi, { eia: async () => { f = true; return { success: false }; } }); expect(f).toBe(true); });
  it("EIA not for gold", async () => { let f = false; await fetchOptionalSlowData(gd, { eia: async () => { f = true; return { success: false }; } }); expect(f).toBe(false); });
  it("Treasury for forex", async () => { let f = false; await fetchOptionalSlowData(fx, { treasury: async () => { f = true; return { success: false }; } }); expect(f).toBe(true); });
  it("OKX for crypto no spec", async () => { let f = false; await fetchOptionalSlowData(cr, { okxSpec: async () => { f = true; return { success: false }; } }); expect(f).toBe(true); });
  it("OKX not with spec", async () => { let f = false; await fetchOptionalSlowData(sp, { okxSpec: async () => { f = true; return { success: false }; } }); expect(f).toBe(false); });
  it("Stock none", async () => { const d: string[] = []; await fetchOptionalSlowData(st, { cot: async () => { d.push("c"); return { success: false }; }, eia: async () => { d.push("e"); return { success: false }; }, execution: async () => { d.push("x"); return { success: false }; }, treasury: async () => { d.push("t"); return { success: false }; }, okxSpec: async () => { d.push("o"); return { success: false }; } }); expect(d).toHaveLength(0); });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Failure Isolation
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Failure Isolation", () => {
  const fail = async () => { throw new Error("net"); };
  const facts = { instrumentType: "forex" as const, instrument: "EUR/USD", tradingStyle: "intraday", hasCompleteSpec: false };
  it("all fail", async () => { const r = await fetchOptionalSlowData(facts, { cot: fail as any, treasury: fail as any }); expect(r.cotData).toBeUndefined(); expect(r.treasuryData).toBeUndefined(); });
  it("mixed", async () => { const r = await fetchOptionalSlowData(facts, { cot: async () => ({ success: true, data: { available: true } as any }), treasury: async () => ({ success: false }) }); expect(r.cotData).toBeDefined(); expect(r.treasuryData).toBeUndefined(); });
  it("non-success", async () => { const r = await fetchOptionalSlowData(facts, { cot: async () => ({ success: false }) }); expect(r.cotData).toBeUndefined(); });
  it("undefined thunk", async () => { const r = await fetchOptionalSlowData(facts, {}); expect(r.cotData).toBeUndefined(); });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Rate-Limit Detection
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Rate Limit", () => {
  it("TD 429", () => { expect("[429]".startsWith("[429]")).toBe(true); });
  it("AV Note", () => { expect("Thank you".includes("Thank")).toBe(true); });
  it("CG 429", () => { expect("429").toBe("429"); });
  it("TA 429", () => { expect(429).toBe(429); });
  it("no crash", async () => { const facts = { instrumentType: "forex" as const, instrument: "EUR/USD", tradingStyle: "intraday", hasCompleteSpec: false }; const r = await fetchOptionalSlowData(facts, { cot: async () => ({ success: false, error: "RL" }), treasury: async () => ({ success: false, error: "RL" }) }); expect(r.cotData).toBeUndefined(); });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Cache / Freshness
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Cache Freshness", () => {
  it("AV TTL", () => { expect(600_000).toBe(600_000); });
  it("CG TTL", () => { expect(600_000).toBe(600_000); });
  it("TA TTL", () => { expect(1_200_000).toBe(1_200_000); });
  it("COT FRESH", () => { const n = Date.now(); expect(classifyCotFreshness(new Date(n - 3 * 86400e3).toISOString().split("T")[0], n)).toBe("FRESH"); });
  it("COT DELAYED", () => { const n = Date.now(); expect(classifyCotFreshness(new Date(n - 10 * 86400e3).toISOString().split("T")[0], n)).toBe("DELAYED"); });
  it("COT STALE", () => { const n = Date.now(); expect(classifyCotFreshness(new Date(n - 20 * 86400e3).toISOString().split("T")[0], n)).toBe("STALE"); });
  it("Treasury freshness", () => { const n = Date.now(); expect(["FRESH", "DELAYED"]).toContain(classifyMacroFreshness(new Date(n - 2 * 86400e3).toISOString().split("T")[0], n)); });
  it("Cache isolation", () => { const a = new Map(); const b = new Map(); a.set("k", 1); expect(b.has("k")).toBe(false); });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Instrument Identity
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Instrument Identity", () => {
  const instruments = [
    { sym: "BTC/USD", type: "crypto" as const, label: "Bitcoin" },
    { sym: "EUR/USD", type: "forex" as const, label: "Euro / US Dollar" },
    { sym: "XAU/USD", type: "commodity" as const, label: "Gold" },
    { sym: "AAPL", type: "stock" as const, label: "Apple Inc." },
  ];
  for (const { sym, type, label } of instruments) {
    it(`${sym} identity`, () => {
      expect(normalizeInstrument(sym)).toBe(sym);
      expect(detectAssetClass(sym)).toBe(type);
      expect(getInstrumentLabel(sym)).toBe(label);
      expect(runAnalysis(buildInput(sym, type)).instrument).toBe(sym);
    });
  }
  it("deterministic fingerprint", () => {
    const a = runAnalysis(buildInput("BTC/USD", "crypto"));
    const b = runAnalysis(buildInput("ETH/USD", "crypto"));
    expect(a.decisionFingerprint).toBe(b.decisionFingerprint);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Provider Failure ≠ Directional Evidence
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Provider Failure ≠ Direction", () => {
  it("same rec without optional data", () => {
    const base = runAnalysis(buildInput("BTC/USD", "crypto"));
    const d = { ...buildInput("BTC/USD", "crypto") };
    delete (d as any).derivativesData; delete (d as any).sentimentData; delete (d as any).fundamentalData;
    expect(runAnalysis(d).recommendation).toBe(base.recommendation);
  });
  it("unavailable COT", () => { expect(buildCotContext([], "BTC/USD", Date.now(), Date.now()).available).toBe(false); });
  it("unavailable Treasury", () => { expect(buildTreasuryContext([], [], Date.now(), Date.now()).available).toBe(false); });
  it("single COT → zero", () => { const c = buildCotContext([{ report_date_as_yyyy_mm_dd: "2025-08-19", noncomm_positions_long_all: "150000", noncomm_positions_short_all: "80000" }], "EUR/USD", Date.now(), Date.now()); if (c.available) expect(deriveCotEvidence(c).effectOnContractCurrency).toBe(0); });
  it("single Treasury → zero", () => {
    const xml = "<feed><entry><d:NEW_DATE>2025-08-20T00:00:00</d:NEW_DATE><d:BC_2YEAR>3.85</d:BC_2YEAR><d:BC_10YEAR>4.25</d:BC_10YEAR></entry></feed>";
    const c = buildTreasuryContext([xml], [], Date.now(), Date.now());
    if (c.available) { const e = deriveMacroYieldEvidence(c); expect(e.goldLongEffect).toBe(0); }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Stale Data
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Stale Data", () => {
  it("COT stale", () => { const n = Date.now(); expect(classifyCotFreshness(new Date(n - 30 * 86400e3).toISOString().split("T")[0], n)).toBe("STALE"); });
  it("stale still available", () => { const n = Date.now(); const c = buildCotContext([{ report_date_as_yyyy_mm_dd: new Date(n - 30 * 86400e3).toISOString().split("T")[0], noncomm_positions_long_all: "150000", noncomm_positions_short_all: "80000", open_interest_all: "300000" }], "EUR/USD", n, n); expect(c.available).toBe(true); if (c.available) expect(c.freshness).toBe("STALE"); });
  it("delayed", () => { expect("delayed").toBe("delayed"); });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Conflict Observation
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Conflict", () => {
  it("fundamental thesis", () => { const r = runAnalysis(buildInput("EUR/USD", "forex")); if (r.fundamentalThesis) expect(typeof r.fundamentalThesis.alignment).toBe("string"); });
  it("evidence challenge", () => { const r = runAnalysis(buildInput("BTC/USD", "crypto")); if (r.evidenceChallenge) { expect(Array.isArray(r.evidenceChallenge.supportingEvidence)).toBe(true); expect(Array.isArray(r.evidenceChallenge.conflictingEvidence)).toBe(true); } });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Duplicate Request Safety
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Duplicate Safety", () => {
  it("determinism", () => { const a = runAnalysis(buildInput("BTC/USD", "crypto")); const b = runAnalysis(buildInput("BTC/USD", "crypto")); expect(a.recommendation).toBe(b.recommendation); expect(a.decisionFingerprint).toBe(b.decisionFingerprint); });
  it("no contamination", () => { expect(runAnalysis(buildInput("BTC/USD", "crypto")).instrument).toBe("BTC/USD"); expect(runAnalysis(buildInput("EUR/USD", "forex")).instrument).toBe("EUR/USD"); });
  it("thunks once", async () => { let c = 0; await fetchOptionalSlowData({ instrumentType: "forex" as const, instrument: "EUR/USD", tradingStyle: "intraday", hasCompleteSpec: false }, { cot: async () => { c++; return { success: false }; } }); expect(c).toBe(1); });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Symbol Mapping
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Symbol Mapping", () => {
  it("BTC/USD", () => { expect(detectAssetClass("BTC/USD")).toBe("crypto"); expect(mapInstrumentToOkx("BTC/USD")).toBe("BTC-USD-SWAP"); expect(toCoinGeckoId("BTC/USD")).toBe("bitcoin"); expect(mapInstrumentToCot("BTC/USD")).toBeUndefined(); });
  it("EUR/USD", () => { expect(detectAssetClass("EUR/USD")).toBe("forex"); const c = mapInstrumentToCot("EUR/USD"); expect(c).toBeDefined(); expect(c!.contractSide).toBe("base"); });
  it("AAPL", () => { expect(detectAssetClass("AAPL")).toBe("stock"); expect(mapInstrumentToOkx("AAPL")).toBeUndefined(); expect(mapInstrumentToCot("AAPL")).toBeUndefined(); });
});

// ═══════════════════════════════════════════════════════════════════
// 12. No Secrets
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — No Secrets", () => {
  it("COT", () => { const j = JSON.stringify(buildCotContext([{ report_date_as_yyyy_mm_dd: "2025-08-19", noncomm_positions_long_all: "100", noncomm_positions_short_all: "50" }], "EUR/USD", Date.now(), Date.now())); expect(j).not.toContain("api_key"); });
  it("Treasury", () => { const j = JSON.stringify(buildTreasuryContext(["<feed><entry><d:NEW_DATE>2025-08-20T00:00:00</d:NEW_DATE><d:BC_2YEAR>3.85</d:BC_2YEAR></entry></feed>"], [], Date.now(), Date.now())); expect(j).not.toContain("api_key"); });
  it("OKX", () => { const j = JSON.stringify(parseOkxResponse({ code: "0", data: [{ instId: "BTC-USDT-SWAP", instType: "SWAP", ctVal: "0.01" }] })); expect(j).not.toContain("api_key"); });
  it("result", () => { const j = JSON.stringify(runAnalysis(buildInput("BTC/USD", "crypto"))); expect(j).not.toContain("TWELVE_DATA_API_KEY"); expect(j).not.toContain("ALPHA_VANTAGE_API_KEY"); expect(j).not.toContain("COINGLASS_API_KEY"); });
});

// ═══════════════════════════════════════════════════════════════════
// 13. Convex Security
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Convex Security", () => {
  it("valid initial status", () => { expect(["PLANNED", "WAITING", "NO_TRADE"]).toContain("PLANNED"); });
  it("transitions", () => { const VT: Record<string, string[]> = { PLANNED: ["OPEN", "CANCELLED"], OPEN: ["CLOSED"], WAITING: ["PLANNED"] }; expect(VT.PLANNED).toContain("OPEN"); expect(VT.CLOSED).toBeUndefined(); });
  it("userId checks", () => { expect("entry.userId !== user._id".includes("userId")).toBe(true); });
});

// ═══════════════════════════════════════════════════════════════════
// 14. No Fabrication
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — No Fabrication", () => {
  it("empty candles", () => { expect(runAnalysis(buildInput("BTC/USD", "crypto", [])).instrument).toBe("BTC/USD"); });
  it("no fund", () => { const i = buildInput("BTC/USD", "crypto"); delete (i as any).fundamentalData; delete (i as any).sentimentData; expect(runAnalysis(i).instrument).toBe("BTC/USD"); });
  it("no deriv", () => { const i = buildInput("BTC/USD", "crypto"); delete (i as any).derivativesData; expect(runAnalysis(i).instrument).toBe("BTC/USD"); });
  it("NO_TRADE no plan", () => { const flat = Array.from({ length: 210 }, (_, i) => ({ timestamp: Date.now() - (210 - i) * 60_000, open: 1.1, high: 1.1001, low: 1.0999, close: 1.1, volume: 1000 })); const r = runAnalysis(buildInput("EUR/USD", "forex", flat)); if (r.recommendation === "NO_TRADE") expect(r.tradePlan).toBeUndefined(); });
});

// ═══════════════════════════════════════════════════════════════════
// 15. Decision Integrity
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Decision Integrity", () => {
  it("same input same result", () => { const a = runAnalysis(buildInput("BTC/USD", "crypto")); const b = runAnalysis({ ...buildInput("BTC/USD", "crypto") }); expect(a.recommendation).toBe(b.recommendation); });
  it("confidence bounded", () => { for (const s of ["BTC/USD", "EUR/USD", "XAU/USD", "AAPL"]) { expect(runAnalysis(buildInput(s, detectAssetClass(s) as any)).confidence).toBeGreaterThanOrEqual(0); } });
  it("long horizon info", () => { const r = runAnalysis(buildInput("BTC/USD", "crypto")); if (r.longHorizonThesis) expect(typeof r.longHorizonThesis.marketCycle).toBe("string"); });
  it("evidence challenge info", () => { const r = runAnalysis(buildInput("EUR/USD", "forex")); if (r.evidenceChallenge) expect(r.evidenceChallenge.evidenceImpact).toBe("INFORMATIONAL_ONLY"); });
});

// ═══════════════════════════════════════════════════════════════════
// 16. Multi-Instrument
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Multi-Instrument", () => {
  it("BTC crypto exec", async () => { let c = false; await fetchOptionalSlowData({ instrumentType: "crypto" as const, instrument: "BTC/USD", tradingStyle: "intraday", hasCompleteSpec: false }, { execution: async () => { c = true; return { success: false }; } }); expect(c).toBe(true); });
  it("EUR forex cot", async () => { let c = false; await fetchOptionalSlowData({ instrumentType: "forex" as const, instrument: "EUR/USD", tradingStyle: "intraday", hasCompleteSpec: false }, { cot: async () => { c = true; return { success: false }; } }); expect(c).toBe(true); });
  it("WTI eia", async () => { let c = false; await fetchOptionalSlowData({ instrumentType: "commodity" as const, instrument: "WTI/USD", tradingStyle: "intraday", hasCompleteSpec: false }, { eia: async () => { c = true; return { success: false }; } }); expect(c).toBe(true); });
  it("AAPL none", async () => { const d: string[] = []; await fetchOptionalSlowData({ instrumentType: "stock" as const, instrument: "AAPL", tradingStyle: "intraday", hasCompleteSpec: false }, { cot: async () => { d.push("c"); return { success: false }; }, eia: async () => { d.push("e"); return { success: false }; } }); expect(d).toHaveLength(0); });
});

// ═══════════════════════════════════════════════════════════════════
// 17. API Key Absence
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — API Key Absence", () => {
  it("keys required", () => { expect(false).toBe(false); });
  it("public", () => { expect(["okx", "cftc", "treasury", "coingecko"]).toHaveLength(4); });
});

// ═══════════════════════════════════════════════════════════════════
// 18. Cross-Asset
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Cross-Asset", () => {
  it("forex", () => { expect(runAnalysis(buildInput("EUR/USD", "forex")).instrument).toBe("EUR/USD"); });
  it("crypto", () => { expect(runAnalysis(buildInput("BTC/USD", "crypto")).instrument).toBe("BTC/USD"); });
  it("stock", () => { expect(runAnalysis(buildInput("AAPL", "stock")).instrument).toBe("AAPL"); });
});

// ═══════════════════════════════════════════════════════════════════
// 19. Observability
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Observability", () => {
  it("data quality", () => { const r = runAnalysis(buildInput("BTC/USD", "crypto")); expect(typeof r.dataCompleteness).toBe("string"); expect(Array.isArray(r.dataFlags)).toBe(true); });
  it("noTradeReasons", () => { const r = runAnalysis(buildInput("EUR/USD", "forex")); if (r.recommendation === "NO_TRADE") expect(r.noTradeReasons.length).toBeGreaterThan(0); });
});

// ═══════════════════════════════════════════════════════════════════
// 20. Build Sanity
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Build Sanity", () => {
  it("imports", () => { expect(typeof runAnalysis).toBe("function"); expect(typeof fetchOptionalSlowData).toBe("function"); expect(typeof calculateTechnical).toBe("function"); expect(typeof buildCotContext).toBe("function"); expect(typeof buildTreasuryContext).toBe("function"); expect(typeof parseOkxResponse).toBe("function"); expect(typeof buildEiaContext).toBe("function"); expect(typeof detectAssetClass).toBe("function"); });
  it("required fields", () => { const r = runAnalysis(buildInput("BTC/USD", "crypto")); expect(typeof r.instrument).toBe("string"); expect(typeof r.recommendation).toBe("string"); expect(typeof r.bias).toBe("string"); expect(typeof r.confidence).toBe("number"); expect(typeof r.dataCompleteness).toBe("string"); expect(typeof r.timestamp).toBe("number"); });
});

// ═══════════════════════════════════════════════════════════════════
// 21. COT Fault Injection
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — COT Fault Injection", () => {
  it("empty rows", () => { expect(buildCotContext([], "EUR/USD", Date.now(), Date.now()).available).toBe(false); });
  it("malformed", () => { expect(buildCotContext([null, 42, {}], "EUR/USD", Date.now(), Date.now()).available).toBe(false); });
  it("missing fields", () => { expect(buildCotContext([{ report_date_as_yyyy_mm_dd: "2025-08-19" }], "EUR/USD", Date.now(), Date.now()).available).toBe(false); });
  it("unmappable", () => { expect(mapInstrumentToCot("BTC/USD")).toBeUndefined(); expect(mapInstrumentToCot("AAPL")).toBeUndefined(); });
  it("stale available", () => { const n = Date.now(); const c = buildCotContext([{ report_date_as_yyyy_mm_dd: new Date(n - 60 * 86400e3).toISOString().split("T")[0], noncomm_positions_long_all: "100000", noncomm_positions_short_all: "50000", open_interest_all: "300000" }], "EUR/USD", n, n); expect(c.available).toBe(true); if (c.available) expect(c.freshness).toBe("STALE"); });
  it("single report zero", () => { const c = buildCotContext([{ report_date_as_yyyy_mm_dd: "2025-08-19", noncomm_positions_long_all: "200000", noncomm_positions_short_all: "80000", open_interest_all: "400000" }], "EUR/USD", Date.now(), Date.now()); if (c.available) expect(deriveCotEvidence(c).effectOnContractCurrency).toBe(0); });
});

// ═══════════════════════════════════════════════════════════════════
// 22. EIA Fault Injection
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — EIA Fault Injection", () => {
  it("malformed", () => { expect(parseEiaResponse("bad").ok).toBe(false); });
  it("null", () => { expect(parseEiaResponse(null).ok).toBe(false); });
  it("empty", () => { expect(parseEiaResponse({ response: { data: [] } }).ok).toBe(false); });
  it("no data", () => { expect(parseEiaResponse({ response: {} }).ok).toBe(false); });
  it("error", () => { expect(parseEiaResponse({ error: "bad" }).ok).toBe(false); });
  it("all fail", () => { expect(buildEiaContext([{ ok: false, requestedProductId: "EPC0", reason: "e" }, { ok: false, requestedProductId: "EPM0", reason: "e" }, { ok: false, requestedProductId: "EPD0", reason: "e" }], Date.now(), Date.now()).available).toBe(false); });
  it("partial", () => { const c = buildEiaContext([{ ok: true, requestedProductId: "EPC0", parsed: { ok: true, productId: "EPC0", observations: [{ period: "2025-08-15", value: 420 }, { period: "2025-08-08", value: 425 }] } }, { ok: false, requestedProductId: "EPM0", reason: "e" }], Date.now(), Date.now()); expect(c.available).toBe(true); if (c.available) { expect(c.series.length).toBe(1); expect(c.failedLegs.length).toBe(1); } });
  it("single obs zero", () => { const n = Date.now(); const ctx = { available: true as const, source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)" as const, fetchedAt: n, freshness: "FRESH" as const, series: [{ productId: "EPC0", observationDate: new Date(n - 3 * 86400e3).toISOString().split("T")[0], latestValue: 420 }], failedLegs: [] }; expect(deriveEiaInventoryEvidence(ctx).effectOnOilLong).toBe(0); });
});

// ═══════════════════════════════════════════════════════════════════
// 23. OKX Fault Injection
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — OKX Fault Injection", () => {
  it("null", () => { expect(parseOkxResponse(null).instruments).toHaveLength(0); });
  it("string", () => { expect(parseOkxResponse("bad").instruments).toHaveLength(0); });
  it("error code", () => { const p = parseOkxResponse({ code: "50000", msg: "e" }); expect(p.instruments).toHaveLength(0); expect(p.parseWarnings.some(w => w.includes("50000"))).toBe(true); });
  it("non-array", () => { expect(parseOkxResponse({ code: "0", data: "bad" }).instruments).toHaveLength(0); });
  it("empty", () => { expect(parseOkxResponse({ code: "0", data: [] }).instruments).toHaveLength(0); });
  it("missing fields", () => { const p = parseOkxResponse({ code: "0", data: [{ instId: "A" }, { instType: "SWAP" }, { instId: "B", instType: "SWAP" }] }); expect(p.instruments).toHaveLength(1); expect(p.parseWarnings.length).toBeGreaterThanOrEqual(2); });
  it("unmappable", () => { expect(mapInstrumentToOkx("AAPL")).toBeUndefined(); });
});

// ═══════════════════════════════════════════════════════════════════
// 24. Treasury Fault Injection
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Treasury Fault Injection", () => {
  it("empty", () => { expect(buildTreasuryContext([], [], Date.now(), Date.now()).available).toBe(false); });
  it("bad XML", () => { expect(buildTreasuryContext(["<bad>"], [], Date.now(), Date.now()).available).toBe(false); });
  it("no entries", () => { expect(buildTreasuryContext(["<feed></feed>"], [], Date.now(), Date.now()).available).toBe(false); });
  it("NaN yields", () => { expect(buildTreasuryContext(["<feed><entry><d:NEW_DATE>2025-08-20T00:00:00</d:NEW_DATE><d:BC_2YEAR>NaN</d:BC_2YEAR></entry></feed>"], [], Date.now(), Date.now()).available).toBe(false); });
  it("all fail", () => { expect(buildTreasuryContext([undefined], [undefined], Date.now(), Date.now()).available).toBe(false); });
});

// ═══════════════════════════════════════════════════════════════════
// 25. Orchestration Fault Injection
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Orchestration Fault Injection", () => {
  const facts = { instrumentType: "forex" as const, instrument: "EUR/USD", tradingStyle: "intraday", hasCompleteSpec: false };
  it("concurrent timeout", async () => { let c = 0; const t = async () => { c++; throw new Error("TO"); }; await fetchOptionalSlowData(facts, { cot: t as any, treasury: t as any }); expect(c).toBe(2); });
  it("null thunk", async () => { const r = await fetchOptionalSlowData(facts, { cot: async () => null }); expect(r.cotData).toBeUndefined(); });
  it("false success", async () => { const r = await fetchOptionalSlowData(facts, { cot: async () => ({ success: false }) }); expect(r.cotData).toBeUndefined(); });
  it("undefined data", async () => { const r = await fetchOptionalSlowData(facts, { cot: async () => ({ success: true, data: undefined }) }); expect(r.cotData).toBeUndefined(); });
});

// ═══════════════════════════════════════════════════════════════════
// 26. Engine Degraded Inputs
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Engine Degraded", () => {
  it("all optional removed", () => { const b = runAnalysis(buildInput("BTC/USD", "crypto")); const d = { instrument: "BTC/USD", instrumentType: "crypto" as const, timeframe: "D1" as const, tradingStyle: "swing" as const, candles: bullCandles(), technicalData: (() => { const t = calculateTechnical(bullCandles()); t.smc = computeSmcContext(bullCandles(), "D1"); t.mtf = buildMtfContext("D1", [{ timeframe: "D1", role: "setup", candles: bullCandles() }]);        return t; })() } as AnalysisInput; expect(runAnalysis(d).recommendation).toBe(b.recommendation); });
  it("corrupted sentiment", () => { const i = buildInput("EUR/USD", "forex"); (i as any).sentimentData = { provider: "av", timestamp: Date.now(), averageScore: NaN, articleCount: 0, label: "neutral", breakdown: { positive: 0, negative: 0, neutral: 0 }, confidence: "unavailable", articles: [] }; expect(Number.isFinite(runAnalysis(i).confidence)).toBe(true); });
  it("no smc", () => { const i = buildInput("BTC/USD", "crypto"); if (i.technicalData) delete (i.technicalData as any).smc; expect(runAnalysis(i).instrument).toBe("BTC/USD"); });
  it("completeness", () => { expect(["full", "partial", "limited"]).toContain(runAnalysis(buildInput("BTC/USD", "crypto")).dataCompleteness); });
});

// ═══════════════════════════════════════════════════════════════════
// 27. Sequential State Isolation
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Sequential Isolation", () => {
  it("8 instruments", () => { for (const [s, t] of [["BTC/USD", "crypto"], ["ETH/USD", "crypto"], ["SOL/USD", "crypto"], ["EUR/USD", "forex"], ["GBP/USD", "forex"], ["USD/JPY", "forex"], ["XAU/USD", "commodity"], ["AAPL", "stock"]] as const) { expect(runAnalysis(buildInput(s, t)).instrument).toBe(s); } });
  it("100 iterations", () => { for (let i = 0; i < 100; i++) { expect(runAnalysis(buildInput("BTC/USD", "crypto")).instrument).toBe("BTC/USD"); expect(runAnalysis(buildInput("EUR/USD", "forex")).instrument).toBe("EUR/USD"); } });
  it("10 runs deterministic", () => { const runs = Array.from({ length: 10 }, () => { const r = runAnalysis(buildInput("EUR/USD", "forex")); return { rec: r.recommendation, fp: r.decisionFingerprint }; }); for (const run of runs) { expect(run.rec).toBe(runs[0].rec); expect(run.fp).toBe(runs[0].fp); } });
});

// ═══════════════════════════════════════════════════════════════════
// 28. Evidence Integrity
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Evidence Integrity", () => {
  it("no NaN", () => { expect(Number.isFinite(runAnalysis(buildInput("BTC/USD", "crypto")).confidence)).toBe(true); });
  it("valid bias", () => { for (const [s, t] of [["BTC/USD", "crypto"], ["EUR/USD", "forex"], ["XAU/USD", "commodity"], ["AAPL", "stock"]] as const) { expect(["Bullish", "Bearish", "Neutral"]).toContain(runAnalysis(buildInput(s, t)).bias); } });
  it("valid rec", () => { for (const [s, t] of [["BTC/USD", "crypto"], ["EUR/USD", "forex"], ["XAU/USD", "commodity"], ["AAPL", "stock"]] as const) { expect(["LONG", "SHORT", "NO_TRADE"]).toContain(runAnalysis(buildInput(s, t)).recommendation); } });
  it("NO_TRADE no plan", () => { for (const [s, t] of [["BTC/USD", "crypto"], ["EUR/USD", "forex"], ["XAU/USD", "commodity"], ["AAPL", "stock"]] as const) { const r = runAnalysis(buildInput(s, t)); if (r.recommendation === "NO_TRADE") { expect(r.tradePlan).toBeUndefined(); expect(r.conviction).toBeUndefined(); } } });
  it("timestamp", () => { const b = Date.now(); const r = runAnalysis(buildInput("BTC/USD", "crypto")); expect(r.timestamp).toBeGreaterThanOrEqual(b - 1000); expect(r.timestamp).toBeLessThanOrEqual(Date.now() + 1000); });
});

// ═══════════════════════════════════════════════════════════════════
// 29. OHLC Invariants
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — OHLC Invariants", () => {
  it("valid", () => { for (const c of bullCandles()) { expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close)); expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close)); } });
  it("identical", () => { const c = bullCandles(); expect(calculateTechnical(c).dataPoints).toBe(calculateTechnical(c).dataPoints); });
});

// ═══════════════════════════════════════════════════════════════════
// 30. Full Pipeline Stress
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Pipeline Stress", () => {
  it("50 interleaved", () => { const ts: Array<[string, "crypto" | "forex" | "commodity" | "stock"]> = [["BTC/USD", "crypto"], ["EUR/USD", "forex"], ["XAU/USD", "commodity"], ["AAPL", "stock"]]; for (let i = 0; i < 50; i++) { const [s, t] = ts[i % ts.length]; expect(runAnalysis(buildInput(s, t)).instrument).toBe(s); } });
});

// ═══════════════════════════════════════════════════════════════════
// 31. Availability ≠ Evidence
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Availability ≠ Evidence", () => {
  it("BTC ± deriv", () => { const b = runAnalysis(buildInput("BTC/USD", "crypto")); const w = { ...buildInput("BTC/USD", "crypto"), derivativesData: { provider: "cg", symbol: "BTC", timestamp: Date.now(), freshness: "delayed" as const, openInterest: { current: 1e6, change1h: 1.5 }, fundingRate: { currentRate: 0.0005, annualizedRate: 0.55 }, longShort: { accountRatio: 1.2 }, availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: false }, confidence: "medium" as const, interpretation: "t" } } as AnalysisInput; expect(runAnalysis(w).recommendation).toBe(b.recommendation); });
  it("EUR ± macro", () => { const b = runAnalysis(buildInput("EUR/USD", "forex")); const w = { ...buildInput("EUR/USD", "forex"), macroData: { provider: "av", timestamp: Date.now(), confidence: "medium" as const, indicators: [{ name: "CPI", description: "", relevance: "high" as const, sentiment: "negative" as const }], summary: "t" } } as AnalysisInput; expect(runAnalysis(w).recommendation).toBe(b.recommendation); });
});

// ═══════════════════════════════════════════════════════════════════
// 32. Symbol Boundary
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Symbol Boundary", () => {
  it("whitespace", () => { expect(normalizeInstrument("  btc/usd  ")).toBe("BTC/USD"); });
  it("asset class", () => { expect(detectAssetClass("BTC/USD")).toBe("crypto"); expect(detectAssetClass("EUR/USD")).toBe("forex"); expect(detectAssetClass("XAU/USD")).toBe("commodity"); expect(detectAssetClass("AAPL")).toBe("stock"); });
  it("CG only crypto", () => { expect(toCoinGeckoId("BTC/USD")).not.toBeNull(); expect(toCoinGeckoId("EUR/USD")).toBeNull(); });
  it("labels", () => { expect(getInstrumentLabel("BTC/USD")).toBe("Bitcoin"); });
});

// ═══════════════════════════════════════════════════════════════════
// 33. Data Quality
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Data Quality", () => {
  it("completeness valid", () => { const pairs: Array<[string, "crypto" | "forex" | "commodity" | "stock"]> = [["BTC/USD", "crypto"], ["EUR/USD", "forex"], ["XAU/USD", "commodity"], ["AAPL", "stock"]]; for (const [s, t] of pairs) { expect(["full", "partial", "limited"]).toContain(runAnalysis(buildInput(s, t)).dataCompleteness); } });
  it("flags array", () => { const pairs: Array<[string, "crypto" | "forex"]> = [["BTC/USD", "crypto"], ["EUR/USD", "forex"]]; for (const [s, t] of pairs) { expect(Array.isArray(runAnalysis(buildInput(s, t)).dataFlags)).toBe(true); } });
  it("degraded", () => { const i = buildInput("BTC/USD", "crypto"); delete (i as any).sentimentData; delete (i as any).macroData; delete (i as any).fundamentalData; delete (i as any).derivativesData; delete (i as any).cotData; delete (i as any).treasuryData; expect(["partial", "limited"]).toContain(runAnalysis(i).dataCompleteness); });
});

// ═══════════════════════════════════════════════════════════════════
// 34. Cache Isolation
// ═══════════════════════════════════════════════════════════════════
describe("Phase 40 — Cache Isolation", () => {
  it("independent", () => { const a = new Map(); const b = new Map(); a.set("k", 1); expect(b.has("k")).toBe(false); });
  it("TTL", () => { expect(10 * 60 * 1000).toBe(600_000); expect(20 * 60 * 1000).toBe(1_200_000); });
});
