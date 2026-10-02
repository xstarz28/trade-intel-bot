/**
 * Phase 307 — the concrete runtime bottlenecks left open by smoke 36967115649
 * (parent 3a6c205), each pinned at the layer that owns it.
 *
 *  A. FOREX — the past released-measurement leg: it now carries a PROPORTIONAL,
 *     bounded deadline (20s inside a 25s leg budget) instead of the 7-day
 *     window's 7s bound; its failure CLASS travels in the provenance
 *     (`failed:timeout`, never a bare "failed"); the cache identity carries
 *     the released-window CONTRACT so a stale pre-40-day cached 7-day result
 *     cannot masquerade as the 40-day acquisition; and the smoke projection
 *     (readResultEvidence) actually DELIVERS the measurement pipeline to the
 *     operator — the phase-306 wiring was invisible live because the
 *     projection dropped it.
 *  B. STOCK — windows are PRE-ASSEMBLED (server-side stage reads, no
 *     provider credits) and a provider-proven plan refusal strikes the
 *     candidate's whole window, so the NEXT attempt comes from the NEXT
 *     provider-order block inside the SAME attempt budget.
 *  C. CRYPTO — the learning pool is a bounded STRIDE across the WHOLE
 *     provider order, because the live thin-quote head is longer than any
 *     head slice (run 36967115649: BTC-PLN → USDT-SGD, both inside the head).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serializeKey } from "../data/provider-cache";
import { CALENDAR_CACHE_CONTRACT } from "../../convex/tradingEconomics";
import { runLeg, classifyLegError } from "../../convex/lib/legOutcome";
import { ProviderHttpError } from "../../convex/lib/legOutcome";
import {
  selectCandidatesFromStagedCatalog,
  selectCandidates,
  STAGED_MAX_WINDOWS,
  STAGED_SELECTION_MAX_ROWS,
  readResultEvidence,
  evidenceDigest,
} from "../../../scripts/development-runtime-smoke.mjs";
import { assessForexFundamentals } from "../fundamental/forex";
import type { EconomicCalendarData, EconomicEvent } from "../data/calendar-types";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const TE = read("src/convex/tradingEconomics.ts");
const PA = read("src/convex/protectedAnalysis.ts");
const SMOKE = read("scripts/development-runtime-smoke.mjs");

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

const calendarWith = (events: EconomicEvent[]): EconomicCalendarData =>
  ({
    provider: "tickatlas",
    events,
    macroRisk: { level: "low", explanation: "test", highImpact24h: 0, highImpact72h: 0 },
    confidence: "medium",
    availability: { upcoming24h: false, upcoming72h: false, recentReleased: events.some((e) => e.status === "released") },
    fetchedAt: Date.now(),
    freshness: "observed-now",
    releasedAcquisition: { lookbackDays: 40, upcomingFetched: 9, pastFetched: 130, pastWithActual: 9, merged: 9, pastLeg: "ok" },
  }) as unknown as EconomicCalendarData;

// ── A. the past released leg: bounded deadlines, classified failure ─────────

describe("phase307 · A1 — the past released leg gets a proportional, bounded transport budget", () => {
  it("the past call passes its OWN deadline; the upcoming call keeps the 7s bound; nothing is unbounded", () => {
    // the dedicated constants exist and are documented
    expect(TE).toContain("const TA_UPCOMING_FETCH_TIMEOUT_MS = 7_000;");
    expect(TE).toContain("const TA_PAST_FETCH_TIMEOUT_MS = 20_000;");
    // taFetch takes the budget as a parameter (never an unbounded fetch)
    expect(TE).toContain("timeoutMs: number = TA_UPCOMING_FETCH_TIMEOUT_MS");
    // the past leg's request uses the past deadline
    expect(TE).toContain("TA_PAST_FETCH_TIMEOUT_MS,");
    // the upcoming leg keeps the default (7s) — the call passes no override
    expect(TE).toContain("extractEvents(await taFetch(`/calendar?countries=${countryParam}&from=${dateFrom}&to=${dateTo}`, apiKey)),");
  });

  it("the calendar leg's OUTER budget contains the past deadline (25s, at the run site)", () => {
    expect(TE).toContain("export const CALENDAR_LEG_BUDGET_MS = 25_000;");
    expect(PA).toContain("budgetMs: CALENDAR_LEG_BUDGET_MS,");
    // and the transport deadline that consumes it stays far below the harness's 60s action timeout
    expect(SMOKE).toContain("const TIMEOUT_MS = 60_000;");
  });

  it("a past-leg timeout is a CLASSIFIED leg failure (never synthetic availability)", async () => {
    const outcome = await runLeg(async () => {
      const err = new Error("The operation was aborted due to timeout");
      (err as { name: string }).name = "TimeoutError";
      throw err;
    });
    expect(outcome.status).toBe("timeout");
    expect(classifyLegError(new ProviderHttpError("TickAtlas", 502, "bad gateway")).status).toBe("provider_error");
    // and the provenance carries the class
    expect(TE).toContain("pastLeg: pastLeg.status === \"ok\" ? \"ok\" : `failed:${pastLeg.status}`");
  });

  it("a timed-out past leg can never satisfy the released contract — the assessment stays EXTERNAL_DATA_GAP", () => {
    // simulated timed-out leg: pastFetched=0 with the classified failure
    const assessment = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: calendarWith([
        event({ id: "cpi-soon", event: "CPI (YoY)", currency: "EUR", datetime: Date.now() + 5 * 60 * 60 * 1000, status: "upcoming", forecast: 2.2 }),
      ]),
    });
    expect(assessment.available).toBe(false);
    expect(assessment.limitations[0]).toContain("No released macroeconomic measurement was supplied for EUR or USD");
  });
});

describe("phase307 · A2 — the released-window CONTRACT is part of the cache identity", () => {
  it("the calendar cache key carries the contract token; a stale pre-40-day entry cannot be served", () => {
    expect(TE).toContain('qualifier: CALENDAR_CACHE_CONTRACT,');
    // the token is a real, non-empty versioned contract
    expect(CALENDAR_CACHE_CONTRACT).toMatch(/released-lookback-40d-v\d+/);
    // identity differs from the qualifier-less pre-306 key AND from any other contract
    const base = { provider: "tickatlas", dataset: "calendar" as const, instrument: "EUR/USD", instrumentType: "forex" };
    expect(serializeKey({ ...base, qualifier: CALENDAR_CACHE_CONTRACT })).not.toBe(serializeKey(base));
    expect(serializeKey({ ...base, qualifier: CALENDAR_CACHE_CONTRACT })).not.toBe(
      serializeKey({ ...base, qualifier: "released-lookback-40d-v1" }),
    );
  });
});

describe("phase307 · A3 — the smoke projection DELIVERS the measurement pipeline (the 306 miss)", () => {
  const PIPELINE = {
    eventsReceived: 5,
    releasedWithActual: 0,
    baseReleasedMatched: 0,
    quoteReleasedMatched: 0,
    policyRatesBase: false,
    policyRatesQuote: false,
    inflationBase: false,
    inflationQuote: false,
    acquisition: { lookbackDays: 40, upcomingFetched: 5, pastFetched: 0, pastWithActual: 0, merged: 0, pastLeg: "failed:timeout" },
    availability: false,
  };

  it("readResultEvidence copies measurementPipeline from the assessment into evidence.fundamental", () => {
    const evidence = readResultEvidence({
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      priceSnapshot: { price: 1.17, timestamp: 1790000000000, source: "twelve-data" },
      fundamentalAssessment: { available: false, domain: "forex", provider: "tickatlas", state: "unavailable", measurementPipeline: PIPELINE },
      technicalData: { dataPoints: 210 },
    });
    expect(evidence.fundamental.available).toBe(false);
    const pipeline = evidence.fundamental.measurementPipeline as Record<string, any> | null;
    expect(pipeline).not.toBeNull();
    expect(pipeline!.acquisition.lookbackDays).toBe(40);
    expect(pipeline!.acquisition.pastLeg).toBe("failed:timeout");
    // available fundamentals keep the field null-able without breaking shape
    const ok = readResultEvidence({
      priceSnapshot: { price: 1, timestamp: 1, source: "x" },
      fundamentalAssessment: { available: true, domain: "stock" },
    });
    expect(ok.fundamental.measurementPipeline).toBeNull();
  });

  it("the digest names the chain's stopping point: rows -> released+actual -> currency match -> reads -> availability", () => {
    const record = {
      headline: "UNAVAILABLE",
      evidence: {
        fundamental: { available: false, measurementPipeline: PIPELINE },
      },
    };
    const digest = evidenceDigest(record);
    expect(digest).toContain("pipeline[events=5 releasedWithActual=0");
    expect(digest).toContain("acq=[lookback=40d upcoming=5 past=0 withActual=0 merged=0 leg=failed:timeout]");
    expect(digest).toContain("stoppedAt=released+actual");
    // a rows-delivered-but-no-side-match record stops at currency-match
    const digest2 = evidenceDigest({
      headline: "UNAVAILABLE",
      evidence: {
        fundamental: {
          available: false,
          measurementPipeline: { ...PIPELINE, releasedWithActual: 3 },
        },
      },
    });
    expect(digest2).toContain("stoppedAt=currency-match");
    // no pipeline -> no pipeline fragment at all
    expect(evidenceDigest({ headline: "PASS", evidence: { fundamental: { available: true } } })).not.toContain("pipeline[");
  });

  it("the projection pins live in the smoke source (not just this fixture)", () => {
    expect(SMOKE).toContain("measurementPipeline:");
    expect(SMOKE).toContain("stoppedAt=");
  });
});

// ── B. the staged windows: pre-assembled, struck per window ────────────────

describe("phase307 · B — pre-assembled windows steer the NEXT attempt inside the budget", () => {
  const STOCK_SPEC = { domain: "stock", label: "STOCK", discovery: "twelve-data", assetClass: "equity" };
  const row = (symbol: string, seq: number) => ({
    seq,
    provider: "twelve-data",
    providerInstrumentId: symbol,
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: symbol,
    quoteAsset: "USD",
    tradingState: "live",
  });
  const stageTransport = (rows: unknown[]) => ({
    pages: [] as number[],
    action: async (_p: string, args: { afterSeq?: number; limit?: number }) => {
      const start = (args.afterSeq ?? -1) + 1;
      const batch = rows.slice(start, start + (args.limit ?? 480));
      return {
        ok: true,
        value: { rows: batch, hasMore: start + batch.length < rows.length, nextAfterSeq: start + batch.length - 1, stagedRows: rows.length },
      };
    },
  });
  const stagedDiscovery = (total: number) => ({
    success: true,
    instruments: [],
    catalogs: [
      { path: "/stocks", assetClass: "equity", completeness: "COMPLETE", transport: { mode: "staged", state: "complete", stageId: "/stocks|307|t", stagedRows: total } },
    ],
  });

  it("all STAGED_MAX_WINDOWS windows are pre-assembled server-side, rows tagged in provider order", async () => {
    const rows = Array.from({ length: 2 * STAGED_SELECTION_MAX_ROWS + 7 }, (_, i) => row(`S${i}`, i));
    const res = await selectCandidatesFromStagedCatalog(
      STOCK_SPEC as never,
      stagedDiscovery(rows.length) as never,
      stageTransport(rows) as never,
      "t",
      { maxAttempts: 3, windows: STAGED_MAX_WINDOWS },
    );
    expect(res.ok).toBe(true);
    expect(res.provenance!.windowsRead).toBe(3);
    expect(res.provenance!.rowsRead).toBe(rows.length);
    const winOf = (id: string) =>
      (res.ranked!.find((r) => r.providerInstrumentId === id) as unknown as { windowIndex: number }).windowIndex;
    expect(winOf("S0")).toBe(0);
    expect(winOf(`S${STAGED_SELECTION_MAX_ROWS}`)).toBe(1);
    expect(winOf(`S${2 * STAGED_SELECTION_MAX_ROWS}`)).toBe(2);
  });

  it("the loop steers by WINDOW strikes — never by re-selecting a refused window; budget untouched", () => {
    // steering inputs come only from provider refusals, and the advance of 306
    // (post-attempt telemetry) is gone
    expect(SMOKE).toContain("windowPlanRefusals.set(w, (windowPlanRefusals.get(w) ?? 0) + 1);");
    expect(SMOKE).toContain("planRestrictedWindows: windowPlanRefusals,");
    expect(SMOKE).not.toContain('outcome: "window-advanced"');
    // the attempt budget is still the loop's own bound
    expect(SMOKE).toContain("for (let index = 0; triedInstruments.size < maxAttempts; index += 1) {");
    // windows are assembled BEFORE attempts, from server-side stage reads
    expect(SMOKE).toContain("windows: STAGED_MAX_WINDOWS,");
  });
});

// ── C. the crypto learning pool: bounded stride across the whole order ──────

describe("phase307 · C — the learning pool spans the provider order (stride), head callers unchanged", () => {
  const CRYPTO_SPEC = { domain: "crypto", label: "CRYPTO", discovery: "okx", assetClass: "crypto" };
  const okxDiscovery = (n: number) => ({
    success: true,
    instruments: Array.from({ length: n }, (_, i) => ({
      instId: `COIN${i}-USDT`,
      state: "live",
      subType: "spot",
      assetClass: "crypto",
    })),
  });

  it("a thin head longer than the pool cannot trap the stride: deep rows are IN the pool", () => {
    // 190 discovered rows; a head slice of ANY width <= 96 would sit inside
    // the first 96 (all thin). The stride reaches the full span.
    const pool = selectCandidates(CRYPTO_SPEC as never, okxDiscovery(190) as never, 3, 96, undefined, "stride");
    expect(pool.length).toBeLessThanOrEqual(96);
    expect(pool.length).toBeGreaterThan(48); // a real span, not a stub
    const ids = (pool as Array<{ instId: string }>).map((c) => c.instId);
    expect(ids[0]).toBe("COIN0-USDT"); // provider order preserved at the head
    expect(ids.some((id: string) => Number(id.slice(4, -5)) >= 150)).toBe(true); // deep rows present
    // strictly provider-order-preserving (relative order)
    const positions = ids.map((id: string) => Number(id.slice(4, -5)));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("head mode (every legacy caller) keeps the exact historical slice", () => {
    expect(selectCandidates(CRYPTO_SPEC as never, okxDiscovery(190) as never, 3, 96, undefined, "head").length).toBe(3);
    expect(selectCandidates(CRYPTO_SPEC as never, okxDiscovery(30) as never, 99).length).toBe(3);
    expect(selectCandidates(CRYPTO_SPEC as never, okxDiscovery(5) as never, 3, 96, undefined, "stride").length).toBe(5);
  });

  it("the domain loop asks for the stride ONLY on the crypto inline path", () => {
    expect(SMOKE).toContain('spec.assetClass === "crypto" ? "stride" : "head"');
    // technical depth stays first-class on every attempt record
    expect(SMOKE).toContain("? { technicalDepth: verdict.evidence.market.dataPoints }");
    // base/quote strike learning is intact
    expect(SMOKE).toContain("addStrike(`base:${observed.technicallyInsufficientFamily}`)");
    expect(SMOKE).toContain("addStrike(`quote:${observed.technicallyInsufficientQuote}`)");
  });
});
