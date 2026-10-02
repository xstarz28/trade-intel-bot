/**
 * Phase 306 — closing the run-36962601231 readiness gaps, with tests pinned to
 * that run's live evidence.
 *
 * LIVE FACTS UNDER TEST (run 36960231581 → 36962601231):
 *  - STOCK: the staged seam works (`stagedRows=143187 · rowsRead=960 · usable=960
 *    · selected=000,0000,000001`) but the equity catalog's provider-order HEAD is
 *    a contiguous block of plan-restricted symbols (`000001` → `[404] This
 *    symbol is available starting with the Grow or Venture plan`) — all three
 *    attempts burned inside it (workstream B);
 *  - FOREX: EUR/USD still EXTERNAL_DATA_GAP after the 40-day lookback, with no
 *    stage-level proof of WHERE the released-measurement chain stopped
 *    (workstream A);
 *  - CRYPTO: strike learning steered correctly (USDT-SGD, not USDC-PLN) but the
 *    ranked pool (12) never reached a deep-quote row, and the candle depth the
 *    engine consumed was invisible (workstream C);
 *  - the GBP/JPY record's reason quoted AUD/CAD's measurement gap — the worst
 *    verdict's reason met the LAST attempt's evidence (workstream D).
 *
 * Under test here: A — the released-measurement pipeline diagnostics + the
 * three fixtures the brief names; B — the bounded provider-order scan-window
 * advance on plan-restriction evidence; C — technical depth as a first-class
 * attempt field + the widened pool. D has its own e2e file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { assessForexFundamentals } from "../fundamental/forex";
import type { EconomicCalendarData, EconomicEvent } from "../data/calendar-types";
import {
  selectCandidatesFromStagedCatalog,
  STAGED_MAX_WINDOWS,
  STAGED_SELECTION_MAX_ROWS,
} from "../../../scripts/development-runtime-smoke.mjs";
import { rankByAnalysisEligibility } from "../../../scripts/lib/analysis-eligibility.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const event = (over: Partial<EconomicEvent>): EconomicEvent => ({
  id: over.id ?? "evt",
  event: over.event ?? "Interest Rate Decision",
  category: over.category ?? "Interest Rate",
  country: over.country ?? "Euro Area",
  currency: over.currency ?? "EUR",
  datetime: over.datetime ?? Date.now() - 5 * 24 * 60 * 60 * 1000,
  importance: over.importance ?? 3,
  source: over.source ?? "TickAtlas",
  status: over.status ?? "released",
  ...over,
});

const calendarWith = (
  events: EconomicEvent[],
  acquisition: EconomicCalendarData["releasedAcquisition"] = {
    lookbackDays: 40,
    upcomingFetched: 42,
    pastFetched: 130,
    pastWithActual: 9,
    merged: 9,
    pastLeg: "ok",
  },
): EconomicCalendarData =>
  ({
    provider: "tickatlas",
    events,
    macroRisk: { level: "low", explanation: "test", highImpact24h: 0, highImpact72h: 0 },
    confidence: "medium",
    availability: { upcoming24h: false, upcoming72h: false, recentReleased: events.some((e) => e.status === "released") },
    fetchedAt: Date.now(),
    freshness: "observed-now",
    releasedAcquisition: acquisition,
  }) as unknown as EconomicCalendarData;

describe("phase306 · A — the released-measurement pipeline is proven, stage by stage", () => {
  it("FIXTURE 1: a released print 35 days old (outside the old 7-day window, inside 40) makes the fundamental available — with the full pipeline", () => {
    const assessment = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: calendarWith([
        event({
          id: "ecb-old",
          event: "ECB Interest Rate Decision",
          currency: "EUR",
          category: "Interest Rate",
          datetime: Date.now() - 35 * 24 * 60 * 60 * 1000,
          actual: 2.15,
          previous: 2.4,
          referencePeriod: "Jul 2026",
          status: "released",
        }),
        event({
          id: "fed-old",
          event: "Federal Funds Rate",
          currency: "USD",
          category: "Interest Rate",
          datetime: Date.now() - 30 * 24 * 60 * 60 * 1000,
          actual: 4.0,
          previous: 4.25,
          status: "released",
        }),
        event({
          id: "cpi-eu",
          event: "CPI (YoY)",
          currency: "EUR",
          category: "Inflation",
          datetime: Date.now() - 33 * 24 * 60 * 60 * 1000,
          actual: 2.1,
          forecast: 2.2,
          previous: 2.0,
          status: "released",
          importance: 2,
        }),
      ]),
    });
    expect(assessment.available).toBe(true);
    const p = assessment.measurementPipeline!;
    expect(p.eventsReceived).toBe(3);
    expect(p.releasedWithActual).toBe(3);
    expect(p.baseReleasedMatched).toBe(2); // ECB + CPI (EUR)
    expect(p.quoteReleasedMatched).toBe(1); // Fed (USD)
    expect(p.policyRatesBase).toBe(true);
    expect(p.policyRatesQuote).toBe(true);
    expect(p.inflationBase).toBe(true);
    expect(p.availability).toBe(true);
    // acquisition provenance rides along verbatim
    expect(p.acquisition.lookbackDays).toBe(40);
    expect(p.acquisition.merged).toBe(9);
  });

  it("FIXTURE 2: upcoming-only events stay EXTERNAL_DATA_GAP — and the pipeline proves released=0", () => {
    const assessment = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: calendarWith([
        event({ id: "cpi-soon", event: "CPI (YoY)", currency: "EUR", datetime: Date.now() + 5 * 60 * 60 * 1000, forecast: 2.2, status: "upcoming", importance: 3 }),
        event({ id: "nfp-soon", event: "Nonfarm Payrolls", currency: "USD", datetime: Date.now() + 8 * 60 * 60 * 1000, forecast: 180, status: "upcoming", importance: 3 }),
      ]),
    });
    expect(assessment.available).toBe(false);
    expect(assessment.limitations[0]).toContain("No released macroeconomic measurement was supplied for EUR or USD");
    const p = assessment.measurementPipeline!;
    expect(p.eventsReceived).toBe(2);
    expect(p.releasedWithActual).toBe(0);
    expect(p.baseReleasedMatched).toBe(0);
    expect(p.quoteReleasedMatched).toBe(0);
    expect(p.policyRatesBase).toBe(false);
    expect(p.policyRatesQuote).toBe(false);
    expect(p.inflationBase).toBe(false);
    expect(p.availability).toBe(false);
  });

  it("FIXTURE 3: a released event inside the 40-day window but OUTSIDE the prior 7-day window is available (the exact 305→306 regression)", () => {
    const assessment = assessForexFundamentals({
      instrument: "GBP/JPY",
      provider: "twelve-data",
      providerInstrumentId: "GBP/JPY",
      calendar: calendarWith([
        event({
          id: "boj",
          event: "BoJ Policy Rate",
          currency: "JPY",
          category: "Interest Rate",
          datetime: Date.now() - 25 * 24 * 60 * 60 * 1000,
          actual: 0.5,
          previous: 0.25,
          status: "released",
        }),
        event({
          id: "boe",
          event: "Bank Rate",
          currency: "GBP",
          category: "Interest Rate",
          datetime: Date.now() - 20 * 24 * 60 * 60 * 1000,
          actual: 3.75,
          previous: 4.0,
          status: "released",
        }),
      ]),
    });
    expect(assessment.available).toBe(true);
    expect(assessment.measurementPipeline!.availability).toBe(true);
    // event risk stays separate: macro risk reads the FORWARD window only
    expect(assessment.limitations.join(" ")).not.toContain("invented");
  });

  it("an acquisition that fetched rows but delivered NO eligible actuals is proven at every stage", () => {
    const assessment = assessForexFundamentals({
      instrument: "AUD/CAD",
      provider: "twelve-data",
      providerInstrumentId: "AUD/CAD",
      calendar: calendarWith(
        [event({ id: "rba", event: "RBA Rate Decision", currency: "AUD", datetime: Date.now() - 10 * 24 * 60 * 60 * 1000, status: "released" })], // NO actual
        { lookbackDays: 40, upcomingFetched: 17, pastFetched: 64, pastWithActual: 0, merged: 0, pastLeg: "ok" },
      ),
    });
    expect(assessment.available).toBe(false);
    const p = assessment.measurementPipeline!;
    expect(p.releasedWithActual).toBe(0);
    expect(p.acquisition.pastFetched).toBe(64);
    expect(p.acquisition.pastWithActual).toBe(0);
    expect(p.acquisition.merged).toBe(0);
    // the chain's stopping point is visible: rows came back, none carried actuals
    expect(p.acquisition.pastLeg).toBe("ok");
  });

  it("the acquisition provenance is wired provider-side and digested by the harness", () => {
    const te = read("src/convex/tradingEconomics.ts");
    expect(te).toContain("releasedAcquisition: {");
    expect(te).toContain("lookbackDays: CALENDAR_RELEASED_LOOKBACK_DAYS");
    expect(te).toContain("pastWithActual += 1");
    const smoke = read("scripts/development-runtime-smoke.mjs");
    expect(smoke).toContain("pipeline[events=${pipeline.eventsReceived}");
  });
});

// ── B: the bounded provider-order scan-window advance ────────────────────────

const equityRow = (symbol: string, seq: number) => ({
  seq,
  provider: "twelve-data",
  providerInstrumentId: symbol,
  assetClass: "equity",
  subType: "equity_common",
  baseAsset: symbol,
  quoteAsset: "USD",
  tradingState: "live",
});

describe("phase306 · B — bounded provider-order scan windows on plan-restriction evidence", () => {
  const STOCK_SPEC = { domain: "stock", label: "STOCK", discovery: "twelve-data", assetClass: "equity" };

  const stagedDiscovery = (total: number) => ({
    success: true,
    instruments: [],
    catalogs: [
      { path: "/stocks", assetClass: "equity", completeness: "COMPLETE", transport: { mode: "staged", state: "complete", stageId: "/stocks|306|t", stagedRows: total } },
    ],
  });

  const stageTransport = (rows: unknown[]) => ({
    action: async (_p: string, args: { stageId: string; afterSeq?: number; limit?: number }) => {
      const start = (args.afterSeq ?? -1) + 1;
      const batch = rows.slice(start, start + (args.limit ?? 480));
      return {
        ok: true,
        value: {
          rows: batch,
          hasMore: start + batch.length < rows.length,
          nextAfterSeq: start + batch.length - 1,
          stagedRows: rows.length,
        },
      };
    },
  });

  it("STAGED_MAX_WINDOWS is the bounded window count (3)", () => {
    expect(STAGED_MAX_WINDOWS).toBe(3);
  });

  it("phase 307 design: windows are PRE-ASSEMBLED in provider order, rows tagged with their window", async () => {
    const rows = Array.from({ length: STAGED_SELECTION_MAX_ROWS + 5 }, (_, i) => equityRow(`S${i}`, i));
    const res = await selectCandidatesFromStagedCatalog(
      STOCK_SPEC as never,
      stagedDiscovery(rows.length) as never,
      stageTransport(rows) as never,
      "t",
      { maxAttempts: 3, windows: 2 },
    );
    expect(res.ok).toBe(true);
    expect(res.provenance!.windowsRead).toBe(2);
    expect(res.provenance!.rowsRead).toBe(rows.length); // 960 + 5, bounded
    expect(res.provenance!.window).toContain("scan windows 1..2");
    // every ranked row carries its provider-order window tag
    const firstWindowRow = res.ranked!.find((r) => r.providerInstrumentId === "S0") as unknown as { windowIndex: number };
    const secondWindowRow = res.ranked!.find((r) => r.providerInstrumentId === `S${STAGED_SELECTION_MAX_ROWS}`) as unknown as { windowIndex: number };
    expect(firstWindowRow.windowIndex).toBe(0);
    expect(secondWindowRow.windowIndex).toBe(1);
  });

  it("phase 307 design: a plan-refused window is demoted WHOLE — the next pick comes from the next window", () => {
    const w0 = Array.from({ length: 4 }, (_, i) => ({ ...equityRow(`BAD${i}`, i), windowIndex: 0 }));
    const w1 = Array.from({ length: 4 }, (_, i) => ({ ...equityRow(`GOOD${i}`, 10 + i), windowIndex: 1 }));
    const refusals = new Map([[0, 1]]);
    const ranked = rankByAnalysisEligibility(
      [...w0, ...w1],
      { provider: "twelve-data", assetClass: "equity" },
      { planRestrictedWindows: refusals },
    );
    expect(ranked[0].providerInstrumentId).toBe("GOOD0");
    expect(ranked.filter((r: { windowIndex: number }) => r.windowIndex === 0).length).toBe(4);
    // and with no refusals the provider order stands
    const neutral = rankByAnalysisEligibility([...w0, ...w1], { provider: "twelve-data", assetClass: "equity" }, {});
    expect(neutral[0].providerInstrumentId).toBe("BAD0");
  });

  it("the smoke loop steers via window strikes, not post-attempt telemetry", () => {
    const smoke = read("scripts/development-runtime-smoke.mjs");
    expect(smoke).toContain("windowPlanRefusals.set(w, (windowPlanRefusals.get(w) ?? 0) + 1);");
    expect(smoke).toContain("planRestrictedWindows: windowPlanRefusals,");
    expect(smoke).toContain("windows: STAGED_MAX_WINDOWS,");
    // the phase-306 post-attempt advance is GONE — it could not steer attempts
    expect(smoke).not.toContain('outcome: "window-advanced"');
  });
});

// ── C: technical depth as a first-class readiness field + the widened pool ──

describe("phase306 · C — technical readiness is first-class; the pool reaches past a struck head", () => {
  it("the pool window is 96 — deep enough to rank past the run-36960231581 thin-quote head block", () => {
    const smoke = read("scripts/development-runtime-smoke.mjs");
    expect(smoke).toContain("export const CANDIDATE_POOL_WINDOW = 96;");
    expect(smoke).toContain("const learningQueueCeiling = Math.max(maxAttempts, CANDIDATE_POOL_WINDOW);");
  });

  it("every attempt carries the candle depth the engine consumed", () => {
    const smoke = read("scripts/development-runtime-smoke.mjs");
    expect(smoke).toContain("? { technicalDepth: verdict.evidence.market.dataPoints }");
    // and the reported verdict's evidence is what the record prints
    expect(smoke).toContain("attemptMeta.find((m) => m.verdict === domainVerdict)");
  });
});
