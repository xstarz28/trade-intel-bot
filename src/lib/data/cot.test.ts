/**
 * Phase 7B-2 — CFTC COT parser, mapping, freshness and evidence tests.
 * Fixtures mirror the LIVE-verified Socrata response schema or its
 * documented failure modes.
 */
import { describe, it, expect } from "vitest";
import {
  mapInstrumentToCot,
  buildCotContext,
  deriveCotEvidence,
  classifyCotFreshness,
} from "./cot";

const NOW = Date.parse("2026-08-24T12:00:00Z"); // Monday after Fri release of Tue 2026-08-18 data

function row(reportDate: string, over?: Record<string, unknown>): Record<string, unknown> {
  return {
    market_and_exchange_names: "GOLD - COMMODITY EXCHANGE INC.",
    report_date_as_yyyy_mm_dd: `${reportDate}T00:00:00.000`,
    noncomm_positions_long_all: "256902",
    noncomm_positions_short_all: "34713",
    comm_positions_long_all: "69050",
    comm_positions_short_all: "327468",
    open_interest_all: "406260",
    ...over,
  };
}

// ── Mapping ────────────────────────────────────────────────────────

describe("mapInstrumentToCot (explicit, verified)", () => {
  it("maps verified forex contracts with correct contract side", () => {
    expect(mapInstrumentToCot("EUR/USD")?.contractSide).toBe("base");
    expect(mapInstrumentToCot("GBP/USD")?.sourceInstrument).toMatch(/BRITISH POUND/);
    expect(mapInstrumentToCot("USD/JPY")?.contractSide).toBe("quote"); // contract is JPY
    expect(mapInstrumentToCot("USD/CAD")?.contractSide).toBe("quote");
  });

  it("maps commodity assets directly", () => {
    expect(mapInstrumentToCot("XAU/USD")?.mappedAsset).toMatch(/Gold/);
    expect(mapInstrumentToCot("XAG/USD")?.mappedAsset).toMatch(/Silver/);
    expect(mapInstrumentToCot("WTI")?.mappedAsset).toMatch(/Crude Oil/);
  });

  it("returns UNAVAILABLE mapping for crypto and anything unverified", () => {
    expect(mapInstrumentToCot("BTC/USD")).toBeUndefined();
    expect(mapInstrumentToCot("ETH/USD")).toBeUndefined();
    expect(mapInstrumentToCot("AAPL")).toBeUndefined();
    expect(mapInstrumentToCot("US500")).toBeUndefined();
  });
});

// ── Context building / parsing ─────────────────────────────────────

describe("buildCotContext", () => {
  it("builds context with net position, previous report and provenance", () => {
    const ctx = buildCotContext([row("2026-08-11"), row("2026-08-18")], "XAU/USD", NOW, NOW);
    if (!ctx.available) throw new Error("expected available");
    expect(ctx.netNonCommercial).toBe(256902 - 34713);
    expect(ctx.previous?.reportDate).toBe("2026-08-11");
    expect(ctx.changeFromPreviousReport).toBe(0); // unchanged fixture
    expect(ctx.sourceInstrument).toBe("GOLD - COMMODITY EXCHANGE INC.");
    expect(ctx.mappedAsset).toMatch(/Gold futures/);
  });

  it("changeFromPreviousReport computed only from an actual previous report", () => {
    const up = buildCotContext(
      [
        row("2026-08-11", { noncomm_positions_long_all: "240000" }),
        row("2026-08-18"),
      ],
      "XAU/USD",
      NOW,
      NOW,
    );
    if (!up.available) throw new Error("expected available");
    expect(up.changeFromPreviousReport).toBeGreaterThan(0);

    const single = buildCotContext([row("2026-08-18")], "XAU/USD", NOW, NOW);
    if (!single.available) throw new Error("expected available");
    expect(single.changeFromPreviousReport).toBeUndefined(); // never synthesized
    expect(single.previous).toBeUndefined();
  });

  it("unavailable with explicit reason for unmappable instrument (no fabricated COT for crypto)", () => {
    const r = buildCotContext([row("2026-08-18")], "BTC/USD", NOW, NOW);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toMatch(/No verified CFTC futures contract mapping/);
  });

  it("unavailable on empty response, malformed rows, or missing report date", () => {
    expect(buildCotContext([], "EUR/USD", NOW, NOW).available).toBe(false);
    const malformed = buildCotContext(["garbage", null, 42], "EUR/USD", NOW, NOW);
    expect(malformed.available).toBe(false);
    const noDate = buildCotContext(
      [{ report_date_as_yyyy_mm_dd: undefined, noncomm_positions_long_all: "1", noncomm_positions_short_all: "2" }],
      "EUR/USD",
      NOW,
      NOW,
    );
    expect(noDate.available).toBe(false);
  });

  it("partial positioning: missing commercial/OI fields tolerated; missing long/short rejects row", () => {
    const partial = buildCotContext(
      [
        row("2026-08-18", { comm_positions_long_all: undefined, open_interest_all: undefined }),
      ],
      "XAU/USD",
      NOW,
      NOW,
    );
    if (!partial.available) throw new Error("expected available");
    expect(partial.latest.commercialLong).toBeUndefined();
    expect(partial.latest.openInterest).toBeUndefined();

    const brokenRow = buildCotContext(
      [row("2026-08-18", { noncomm_positions_long_all: undefined })],
      "XAU/USD",
      NOW,
      NOW,
    );
    expect(brokenRow.available).toBe(false);
  });
});

// ── Weekly freshness policy ────────────────────────────────────────

describe("COT weekly freshness (report-date based)", () => {
  it("FRESH within a normal inter-release window — weekend is NOT staleness", () => {
    // Report Tue 2026-08-18; checked Monday 2026-08-24 (6 days) → FRESH.
    const ctx = buildCotContext([row("2026-08-18")], "XAU/USD", NOW, NOW);
    if (!ctx.available) throw new Error("expected available");
    expect(ctx.freshness).toBe("FRESH");
    expect(classifyCotFreshness("2026-08-15", NOW)).toBe("FRESH"); // Saturday date
  });

  it("DELAYED past one window, STALE after multiple missed releases", () => {
    expect(classifyCotFreshness("2026-08-10", NOW)).toBe("DELAYED");
    expect(classifyCotFreshness("2026-07-28", NOW)).toBe("STALE");
    const ctx = buildCotContext([row("2026-07-28")], "XAU/USD", NOW, NOW);
    if (!ctx.available) throw new Error("expected available");
    expect(ctx.freshness).toBe("STALE");
    expect(ctx.freshness).not.toBe("UNAVAILABLE"); // stale data stays dated & disclosed
  });
});

// ── Evidence derivation ────────────────────────────────────────────

describe("deriveCotEvidence", () => {
  function ctxWith(latestLong: number, prevLong: number, oi = "406260") {
    return buildCotContext(
      [
        row("2026-08-11", { noncomm_positions_long_all: String(prevLong), open_interest_all: oi }),
        row("2026-08-18", { noncomm_positions_long_all: String(latestLong), open_interest_all: oi }),
      ],
      "XAU/USD",
      NOW,
      NOW,
    ) as Extract<ReturnType<typeof buildCotContext>, { available: true }>;
  }

  it("increasing net-long positioning supports the contract currency", () => {
    const ev = deriveCotEvidence(ctxWith(280000, 256902));
    expect(ev.effectOnContractCurrency).toBeGreaterThan(0);
    expect(ev.notes.join(" ")).toMatch(/net length increasing/);
  });

  it("decreasing positioning opposes; unchanged adds nothing (availability ≠ confluence)", () => {
    expect(deriveCotEvidence(ctxWith(230000, 256902)).effectOnContractCurrency).toBeLessThan(0);
    expect(deriveCotEvidence(ctxWith(256902, 256902)).effectOnContractCurrency).toBe(0);
    expect(deriveCotEvidence(ctxWith(257100, 256902)).effectOnContractCurrency).toBe(0); // sub-threshold
  });

  it("crowding flag uses actual net/OI ratio as CONTEXT, not directional score", () => {
    // Net long ≈ 63% of OI → crowded.
    const ev = deriveCotEvidence(ctxWith(290000, 290000));
    expect(ev.crowded).toBe(true);
    expect((ev.crowdRatio ?? 0)).toBeGreaterThan(0.4);
    expect(ev.notes.join(" ")).toMatch(/Crowding context/);
    expect(ev.effectOnContractCurrency).toBe(0); // crowding alone scores nothing
  });

  it("single report → zero directional evidence, disclosed note", () => {
    const single = buildCotContext([row("2026-08-18")], "XAU/USD", NOW, NOW) as Extract<
      ReturnType<typeof buildCotContext>,
      { available: true }
    >;
    const ev = deriveCotEvidence(single);
    expect(ev.effectOnContractCurrency).toBe(0);
    expect(ev.notes.join(" ")).toMatch(/Only one report available/);
  });
});
