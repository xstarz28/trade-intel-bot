/**
 * Phase 7D — EIA WPSR parser, freshness and evidence tests.
 * Fixtures mirror the DOCUMENTED EIA v2 response schema (values are strings,
 * error shape {error, code}) or its failure modes. Live data verification
 * requires an API key not yet present in this environment — the parser is
 * therefore validated against the documented schema and fails closed.
 */
import { describe, it, expect } from "vitest";
import {
  parseEiaResponse,
  buildEiaContext,
  classifyEiaFreshness,
  deriveEiaInventoryEvidence,
} from "./eia";

const NOW = Date.parse("2026-08-24T12:00:00Z"); // Monday after Fri 2026-08-21 release

/** Documented v2 row shape: values standardized as strings (v2.1.6). */
function legResponse(
  productId: string,
  rows: { period: string; value: string | number | null }[],
  productName = "Crude Oil excluding SPR",
) {
  return {
    response: {
      total: rows.length,
      data: rows.map((r) => ({
        period: r.period,
        value: r.value,
        product: productId,
        "product-name": productName,
        process: "STA",
        units: "million barrels",
      })),
    },
    request: { command: "/v2/petroleum/sto/data/" },
    apiVersion: "2.1.12",
  };
}

describe("parseEiaResponse", () => {
  it("parses a valid documented response with STRING values, sorted desc", () => {
    const p = parseEiaResponse(
      legResponse("EPC0", [
        { period: "2026-08-14", value: "418.2" },
        { period: "2026-08-21", value: "415.7" },
      ]),
    );
    if (!p.ok) throw new Error(`expected ok, got ${p.reason}`);
    expect(p.productId).toBe("EPC0");
    expect(p.unit).toBe("million barrels");
    expect(p.observations).toEqual([
      { period: "2026-08-21", value: 415.7 },
      { period: "2026-08-14", value: 418.2 },
    ]);
  });

  it("accepts numeric values too (defensive)", () => {
    const p = parseEiaResponse(legResponse("EPC0", [{ period: "2026-08-21", value: 415.7 }]));
    expect(p.ok).toBe(true);
  });

  it("rejects API error objects with an explicit reason", () => {
    const p = parseEiaResponse({ error: "Invalid api_key", code: 403 });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("Invalid api_key");
  });

  it("rejects malformed / non-object payloads", () => {
    for (const bad of [null, undefined, "oops", 42]) {
      const p = parseEiaResponse(bad);
      expect(p.ok).toBe(false);
    }
  });

  it("rejects unexpected schema without response.data", () => {
    const p = parseEiaResponse({ something: true });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("unexpected schema");
  });

  it("rejects empty datasets explicitly", () => {
    const p = parseEiaResponse(legResponse("EPC0", []));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("empty dataset");
  });

  it("skips invalid numeric values instead of coercing them", () => {
    const p = parseEiaResponse(
      legResponse("EPC0", [
        { period: "2026-08-21", value: "N/A" },
        { period: "2026-08-14", value: "418.2" },
        { period: "2026-08-07", value: null as unknown as string },
      ]),
    );
    if (!p.ok) throw new Error("expected ok");
    expect(p.observations).toHaveLength(1); // only the valid row survives
  });

  it("rejects rows without a real observation date", () => {
    const p = parseEiaResponse(legResponse("EPC0", [{ period: "", value: "100" }]));
    expect(p.ok).toBe(false);
  });

  it("reports a missing product identifier", () => {
    const res = legResponse("", [{ period: "2026-08-21", value: "400" }]);
    // strip product field to simulate unexpected schema drift
    (res.response.data[0] as Record<string, unknown>).product = undefined;
    const p = parseEiaResponse(res);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("missing product facet");
  });
});

describe("classifyEiaFreshness (weekly slow-data policy)", () => {
  it("FRESH within one full release cycle (≤10 days)", () => {
    // Friday release of Tue-dated data, checked the following Monday.
    expect(classifyEiaFreshness("2026-08-18", NOW)).toBe("FRESH");
    // Weekend check right before a new release is still FRESH.
    expect(classifyEiaFreshness("2026-08-11", Date.parse("2026-08-16T12:00:00Z"))).toBe("FRESH");
  });

  it("DELAYED up to one missed release (≤18 days)", () => {
    expect(classifyEiaFreshness("2026-08-08", NOW)).toBe("DELAYED");
  });

  it("STALE beyond that", () => {
    expect(classifyEiaFreshness("2026-07-28", NOW)).toBe("STALE");
  });

  it("unparseable observation dates can never look fresh", () => {
    expect(classifyEiaFreshness("not-a-date", NOW)).toBe("STALE");
  });
});

describe("buildEiaContext", () => {
  const crude = { ok: true as const, requestedProductId: "EPC0", parsed: parseEiaResponse(
    legResponse("EPC0", [
      { period: "2026-08-21", value: "415.7" },
      { period: "2026-08-14", value: "418.2" },
    ]),
  ) };

  it("builds change fields from two REAL observations only", () => {
    const ctx = buildEiaContext([crude], Date.now(), NOW);
    expect(ctx.available).toBe(true);
    if (!ctx.available) return;
    const s = ctx.series[0];
    expect(s.observationDate).toBe("2026-08-21"); // date preserved verbatim
    expect(s.previousValue).toBe(418.2);
    expect(s.change).toBeCloseTo(-2.5, 5);
    expect(s.changePercent).toBeCloseTo((-2.5 / 418.2) * 100, 5);
  });

  it("crude-only remains valid WITH disclosure of the failed legs", () => {
    const gasFail = { ok: false as const, requestedProductId: "EPM0", reason: "provider error: no data" };
    const ctx = buildEiaContext([crude, gasFail], Date.now(), NOW);
    expect(ctx.available).toBe(true);
    if (!ctx.available) return;
    expect(ctx.series).toHaveLength(1);
    expect(ctx.failedLegs).toEqual([{ productId: "EPM0", reason: "provider error: no data" }]);
  });

  it("all legs failing → explicit unavailable, never fabricated", () => {
    const fail = { ok: false as const, requestedProductId: "EPC0", reason: "HTTP 500" };
    const ctx = buildEiaContext([fail], Date.now(), NOW);
    expect(ctx.available).toBe(false);
    if (!ctx.available) expect(ctx.reason).toContain("HTTP 500");
  });

  it("single observation yields NO change fields (no synthetic previous)", () => {
    const single = { ok: true as const, requestedProductId: "EPC0", parsed: parseEiaResponse(
      legResponse("EPC0", [{ period: "2026-08-21", value: "415.7" }]),
    ) };
    const ctx = buildEiaContext([single], Date.now(), NOW);
    if (!ctx.available) throw new Error("expected available");
    expect(ctx.series[0].change).toBeUndefined();
    expect(ctx.series[0].previousValue).toBeUndefined();
  });
});

describe("deriveEiaInventoryEvidence", () => {
  function ctxWith(
    rows: { productId: string; latest: number; prev?: number; obsDate?: string }[],
    freshness: "FRESH" | "DELAYED" | "STALE" = "FRESH",
  ) {
    const series = rows.map((r) => ({
      productId: r.productId,
      observationDate: r.obsDate ?? "2026-08-18",
      latestValue: r.latest,
      ...(r.prev !== undefined
        ? {
            previousObservationDate: "2026-08-11",
            previousValue: r.prev,
            change: r.latest - r.prev,
            changePercent: ((r.latest - r.prev) / r.prev) * 100,
          }
        : {}),
      unit: "million barrels",
    }));
    return {
      available: true as const,
      source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)" as const,
      fetchedAt: Date.now(),
      freshness,
      series,
      failedLegs: [],
    };
  }

  it("significant DRAWDOWN → positive oil-long evidence (DRAW)", () => {
    const ev = deriveEiaInventoryEvidence(ctxWith([{ productId: "EPC0", latest: 410, prev: 420 }]));
    expect(ev.aggregate).toBe("DRAW");
    expect(ev.effectOnOilLong).toBeGreaterThan(0);
  });

  it("significant BUILD → negative oil-long evidence (BUILD)", () => {
    const ev = deriveEiaInventoryEvidence(ctxWith([{ productId: "EPC0", latest: 430, prev: 420 }]));
    expect(ev.aggregate).toBe("BUILD");
    expect(ev.effectOnOilLong).toBeLessThan(0);
  });

  it("insignificant change → ZERO contribution (availability ≠ confluence)", () => {
    const ev = deriveEiaInventoryEvidence(ctxWith([{ productId: "EPC0", latest: 420.3, prev: 420 }]));
    expect(ev.aggregate).toBe("INSUFFICIENT");
    expect(ev.effectOnOilLong).toBe(0);
  });

  it("MIXED draw/build nets honestly and never becomes one big vote", () => {
    // Crude draws hard (-0.6 weight direction +), products build (+0.2 each, −).
    const ev = deriveEiaInventoryEvidence(
      ctxWith([
        { productId: "EPC0", latest: 410, prev: 420 },
        { productId: "EPM0", latest: 230, prev: 225 },
        { productId: "EPD0", latest: 125, prev: 120 },
      ]),
    );
    expect(ev.aggregate).toBe("MIXED");
    expect(Math.abs(ev.effectOnOilLong)).toBeLessThan(1);
  });

  it("STALE observation → zero directional evidence with disclosure", () => {
    const ev = deriveEiaInventoryEvidence(ctxWith([{ productId: "EPC0", latest: 410, prev: 420 }], "STALE"));
    expect(ev.effectOnOilLong).toBe(0);
    expect(ev.notes.some((n) => n.includes("stale"))).toBe(true);
  });
});
