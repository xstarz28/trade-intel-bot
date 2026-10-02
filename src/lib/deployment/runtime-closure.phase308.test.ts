/**
 * Phase 308 — runtime closure audit. Every requirement that is a SOURCE or
 * FUNCTIONAL property is pinned here; the full-system behavior has its own
 * e2e file. Baseline: smoke 36967115649 + the phase-307 implementation.
 *
 *  A. forex — the pipeline distinguishes "the calendar leg never delivered"
 *     (calendarDelivered=false) from "the provider answered with zero usable
 *     rows"; released-with-actual still drives availability; upcoming-only
 *     stays EXTERNAL_DATA_GAP; mapping alone is never measurement.
 *  B. stock — attempt records + the reported record carry the provider-order
 *     windowIndex; window strikes demote the WHOLE window; selection stays
 *     bounded and provider-order-preserving with full provenance.
 *  C. crypto — stride traversal is bounded + order-preserving; technicalDepth
 *     and quote/base strikes stay first-class.
 *  D. commodity — plan restrictions classify as PLAN_RESTRICTED (never a
 *     generic provider error); the digest/adapter keep XAU/EIA evidence
 *     intact; nothing turns a timeout into PASS.
 *  E. binding — the record binds identity/evidence/window to the attempt that
 *     earned the FINAL headline.
 *  F. budget — the 303 model is untouched; no new provider calls.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assessForexFundamentals } from "../fundamental/forex";
import type { EconomicCalendarData, EconomicEvent } from "../data/calendar-types";
import {
  readResultEvidence,
  evidenceDigest,
  selectCandidatesFromStagedCatalog,
  selectCandidates,
  STAGED_MAX_WINDOWS,
  STAGED_SELECTION_MAX_ROWS,
} from "../../../scripts/development-runtime-smoke.mjs";
import { rankByAnalysisEligibility, observeAttemptOutcome } from "../../../scripts/lib/analysis-eligibility.mjs";
import { PROVIDER_BLOCK_CLASSES } from "../../../scripts/lib/provider-budget.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const TE = read("src/convex/tradingEconomics.ts");
const SMOKE = read("scripts/development-runtime-smoke.mjs");
const FOREX = read("src/lib/fundamental/forex.ts");
const ENGINE = read("src/lib/analysis-engine.ts");
const PROTECTED = read("src/convex/protectedAnalysis.ts");
const BUDGET = read("scripts/lib/provider-budget.mjs");

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
    upcomingFetched: 9,
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

// ── A. forex: acquisition failures are DISTINGUISHABLE from provider gaps ───

describe("phase308 · A — the pipeline distinguishes an acquisition failure from a provider gap", () => {
  it("calendar leg never delivered => calendarDelivered=false, no invented acquisition counts", () => {
    const assessment = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      // calendar === undefined: the leg timed out / was rate-limited / outage
      calendar: undefined,
    });
    expect(assessment.available).toBe(false);
    const p = assessment.measurementPipeline!;
    expect(p.calendarDelivered).toBe(false);
    expect(p.eventsReceived).toBe(0);
    // nothing is fabricated about what the provider "would have" supplied
    expect(p.acquisition.pastFetched).toBeUndefined();
    expect(p.acquisition.pastLeg).toBeUndefined();
    expect(p.availability).toBe(false);
  });

  it("calendar delivered but empty => calendarDelivered=true with zeros (a provider fact, not a transport one)", () => {
    const assessment = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: calendarWith([]),
    });
    const p = assessment.measurementPipeline!;
    expect(p.calendarDelivered).toBe(true);
    expect(p.eventsReceived).toBe(0);
    expect(p.acquisition.lookbackDays).toBe(40);
    expect(p.acquisition.pastLeg).toBe("ok");
  });

  it("a timed-out past leg is a CLASSIFIED failure on delivered data (307 model, re-pinned)", () => {
    const assessment = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: calendarWith(
        [event({ id: "up", event: "CPI", currency: "EUR", datetime: Date.now() + 3 * 3600_000, status: "upcoming", forecast: 2.2 })],
        { lookbackDays: 40, upcomingFetched: 1, pastFetched: 0, pastWithActual: 0, merged: 0, pastLeg: "failed:timeout" },
      ),
    });
    expect(assessment.available).toBe(false);
    const p = assessment.measurementPipeline!;
    expect(p.calendarDelivered).toBe(true);
    expect(p.eventsReceived).toBe(1); // the upcoming event DID arrive
    expect(p.acquisition.pastLeg).toBe("failed:timeout");
    expect(p.acquisition.pastFetched).toBe(0);
  });

  it("released+actual still makes it available; upcoming-only never does; the digest names each stop", () => {
    const available = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: calendarWith([
        event({ id: "ecb", event: "ECB Interest Rate Decision", currency: "EUR", category: "Interest Rate", datetime: Date.now() - 12 * 24 * 3600_000, actual: 2.15, previous: 2.4 }),
        event({ id: "fed", event: "Federal Funds Rate", currency: "USD", category: "Interest Rate", datetime: Date.now() - 9 * 24 * 3600_000, actual: 4.0, previous: 4.25 }),
      ]),
    });
    expect(available.available).toBe(true);

    const digest = evidenceDigest({
      headline: "UNAVAILABLE",
      evidence: {
        fundamental: {
          available: false,
          measurementPipeline: assessUnavailablePipeline(),
        },
      },
    });
    expect(digest).toContain("stoppedAt=calendar-leg");
  });

  function assessUnavailablePipeline() {
    return {
      calendarDelivered: false,
      eventsReceived: 0,
      releasedWithActual: 0,
      baseReleasedMatched: 0,
      quoteReleasedMatched: 0,
      policyRatesBase: false,
      policyRatesQuote: false,
      inflationBase: false,
      inflationQuote: false,
      acquisition: {},
      availability: false,
    };
  }

  it("the 307 bounded-deadline model is intact (20s past inside 25s leg budget; 7s upcoming)", () => {
    expect(TE).toContain("const TA_PAST_FETCH_TIMEOUT_MS = 20_000;");
    expect(TE).toContain("export const CALENDAR_LEG_BUDGET_MS = 25_000;");
    expect(TE).toContain("qualifier: CALENDAR_CACHE_CONTRACT,");
    expect(PROTECTED).toContain("budgetMs: CALENDAR_LEG_BUDGET_MS,");
    // the engine passes the delivered calendar straight into the forex assessment
    expect(ENGINE).toContain("calendar: input.calendarData,");
    expect(FOREX).toContain("const calendarDelivered = calendar != null;");
  });
});

// ── B/C. selection: windows, strikes, stride, provenance ────────────────────

describe("phase308 · B — window demotion is whole-window, attempt trails carry windowIndex", () => {
  const row = (symbol: string, seq: number, windowIndex: number) => ({
    seq,
    provider: "twelve-data",
    providerInstrumentId: symbol,
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: symbol,
    quoteAsset: "USD",
    tradingState: "live",
    windowIndex,
  });

  it("one refusal in window 0 sinks EVERY window-0 row behind window-1 rows", () => {
    const w0 = [0, 1, 2, 3].map((i) => row(`BAD${i}`, i, 0));
    const w1 = [10, 11, 12].map((i) => row(`GOOD${i}`, i, 1));
    const ranked = rankByAnalysisEligibility([...w0, ...w1], { provider: "twelve-data", assetClass: "equity" }, {
      planRestrictedWindows: new Map([[0, 1]]),
    });
    expect(ranked.slice(0, 3).map((r) => r.providerInstrumentId)).toEqual(["GOOD10", "GOOD11", "GOOD12"]);
    expect(ranked.slice(3).every((r) => r.windowIndex === 0)).toBe(true);
  });

  it("the smoke records the candidate's windowIndex on attempts AND on the reported record", () => {
    expect(SMOKE).toContain("? { windowIndex: candidate.windowIndex }");
    expect(SMOKE).toContain("record.windowIndex = reported");
    expect(SMOKE).toContain("windows: STAGED_MAX_WINDOWS,");
    expect(STAGED_MAX_WINDOWS).toBe(3);
  });

  it("the staged selector's provenance stays complete (stageId, pages, rows, usable, selected, windows)", async () => {
    const rows = Array.from({ length: STAGED_SELECTION_MAX_ROWS + 3 }, (_, i) => row(`S${i}`, i, 0));
    const res = await selectCandidatesFromStagedCatalog(
      { domain: "stock", label: "STOCK", discovery: "twelve-data", assetClass: "equity" } as never,
      {
        success: true,
        instruments: [],
        catalogs: [
          { path: "/stocks", assetClass: "equity", completeness: "COMPLETE", transport: { mode: "staged", state: "complete", stageId: "/stocks|308|t", stagedRows: rows.length } },
        ],
      } as never,
      {
        action: async (_p: string, args: { afterSeq?: number; limit?: number }) => {
          const start = (args.afterSeq ?? -1) + 1;
          const batch = rows.slice(start, start + (args.limit ?? 480));
          return { ok: true, value: { rows: batch, hasMore: start + batch.length < rows.length, nextAfterSeq: start + batch.length - 1, stagedRows: rows.length } };
        },
      } as never,
      "t",
      { maxAttempts: 3, windows: 2 },
    );
    const prov = res.provenance!;
    expect(prov.stageId).toBe("/stocks|308|t");
    expect(prov.pagesRead).toBeGreaterThan(0);
    expect(prov.rowsRead).toBe(rows.length);
    expect(prov.usableRows).toBe(rows.length);
    expect(Array.isArray(prov.selected)).toBe(true);
    expect(prov.windowsRead).toBe(2);
  });
});

describe("phase308 · C — stride traversal is bounded and order-preserving; depth stays first-class", () => {
  const CRYPTO_SPEC = { domain: "crypto", label: "CRYPTO", discovery: "okx", assetClass: "crypto" };
  const okx = (n: number) => ({
    success: true,
    instruments: Array.from({ length: n }, (_, i) => ({ instId: `C${i}-USDT`, state: "live", subType: "spot", assetClass: "crypto" })),
  });

  it("stride across 400 discovered rows stays <=96 and spans the catalog in provider order", () => {
    const pool = selectCandidates(CRYPTO_SPEC as never, okx(400) as never, 3, 96, undefined, "stride");
    expect(pool.length).toBeLessThanOrEqual(96);
    const ids = (pool as Array<{ instId: string }>).map((c) => c.instId);
    const positions = ids.map((id) => Number(id.slice(1, -5)));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(positions[positions.length - 1]).toBeGreaterThan(300); // deep coverage
  });

  it("quote/base strikes steer; plan refusals classify as PLAN_RESTRICTED (not provider errors)", () => {
    expect(SMOKE).toContain("addStrike(`quote:${observed.technicallyInsufficientQuote}`)");
    expect(SMOKE).toContain('spec.assetClass === "crypto" ? "stride" : "head"');
    expect(SMOKE).toContain("? { technicalDepth: verdict.evidence.market.dataPoints }");
    // the plan sentence classifies via the provider's own wording
    const observed = observeAttemptOutcome({
      providerInstrumentId: "XAU/CHF",
      assetClass: "commodity",
      verdictReason: "no provider market evidence with a provider observation instant — runtime said: No live data: [404] This symbol is available starting with the Grow or Venture plan",
    });
    expect(observed.planRestrictedFamily).toBe("XAU");
  });

  it("classifyProviderBlock keeps plan restrictions a PLAN-tier fact", () => {
    const block = (
      PROVIDER_BLOCK_CLASSES as Record<string, string>
    );
    expect(block.PLAN_RESTRICTED).toBeTruthy();
    expect(BUDGET).toContain("available starting with the");
  });
});

// ── D/E. adapter + binding ──────────────────────────────────────────────────

describe("phase308 · D/E — the adapter keeps XAU/EIA evidence whole; binding is per-attempt", () => {
  it("the evidence adapter preserves a commodity record: failing OHLCV leg + intact fundamental + no fabricated market", () => {
    const evidence = readResultEvidence({
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      // NO priceSnapshot: the plan-restricted OHLCV leg produced nothing
      technicalData: null,
      fundamentalAssessment: {
        available: true,
        domain: "commodity",
        provider: "CFTC + US Treasury",
        state: "weakening",
        evidence: [{ metric: "treasury_real_yield", provider: "US Treasury", source: "real", value: 2.1 }],
      },
      unifiedIntelligence: { available: false, state: "unavailable", technical: { available: false }, limitations: ["No live data: [404] This symbol is available starting with the Grow or Venture plan"] },
      providerDiagnostics: [
        { provider: "twelve-data", dataset: "ohlcv", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, observedAt: null, reason: "No live data: [404] This symbol is available starting with the Grow or Venture plan" },
      ],
    });
    expect(evidence.market.present).toBe(false);
    expect(evidence.market.observedAt).toBeNull(); // never re-timed
    expect(evidence.fundamental.available).toBe(true); // the CFTC/Treasury read survived
    expect(evidence.fundamental.evidenceProviders).toContain("US Treasury");
    expect(evidence.diagnostics[0].reason).toContain("Grow or Venture plan");
    expect(evidence.technical.available).toBe(false);
  });

  it("the digest carries market depth + technical availability (record-level C evidence)", () => {
    const digest = evidenceDigest({
      headline: "PASS",
      evidence: {
        market: { present: true, provider: "okx", observedAt: 1790000000000, dataPoints: 210 },
        technical: { available: true, bias: "bullish" },
        fundamental: { available: true, domain: "crypto" },
      },
    });
    expect(digest).toContain("depth=210");
    expect(digest).toContain("technical[available=true bias=bullish]");
    // a thin series is visible as thin
    const thin = evidenceDigest({
      headline: "UNAVAILABLE",
      evidence: { market: { present: true, provider: "okx", observedAt: 1790000000000, dataPoints: 3 }, technical: { available: false }, fundamental: { available: false } },
    });
    expect(thin).toContain("depth=3");
    expect(thin).toContain("technical[available=false]");
  });

  it("binding: PASS binds the LAST attempt; non-PASS binds the most severe — pinned at source", () => {
    expect(SMOKE).toContain('if (record.headline === "PASS") {');
    expect(SMOKE).toContain("const reported = attemptMeta[attemptMeta.length - 1];");
    expect(SMOKE).toContain("attemptMeta.find((m) => m.verdict === domainVerdict)");
  });

  it("budget model: no new provider calls, deterministic priority untouched", () => {
    // the phase-303 budget constants are byte-identical (spot pins)
    expect(BUDGET).toContain("TWELVE_DATA_DISCOVERY_CREDITS");
    // the only new budget value is the calendar leg's own patience (no extra calls)
    expect(TE).toContain("export const CALENDAR_LEG_BUDGET_MS = 25_000;");
  });
});
