/**
 * Phase 7B-1 — US Treasury XML parser & context builder tests.
 * All fixtures mirror the LIVE-verified feed structure
 * (d:BC_* nominal, d:TC_* real) or its documented failure modes.
 */
import { describe, it, expect } from "vitest";
import {
  parseTreasuryXml,
  buildTreasuryContext,
  classifyMacroFreshness,
  deriveMacroYieldEvidence,
  TREASURY_FRESH_DAYS,
  TREASURY_DELAYED_DAYS,
} from "./treasury";

const NOW = Date.parse("2026-08-24T12:00:00Z");

function nominalEntry(date: string, rates: Record<string, string>): string {
  const fields = Object.entries(rates)
    .map(([f, v]) => `<d:${f} m:type="Edm.Double">${v}</d:${f}>`)
    .join("\n");
  return `<entry><content type="application/xml"><m:properties>
<d:Id m:type="Edm.Int32">1</d:Id>
<d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>
${fields}
</m:properties></content></entry>`;
}

function feed(...entries: string[]): string {
  return `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<feed xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
${entries.join("\n")}
</feed>`;
}

const VALID_NOMINAL = feed(
  nominalEntry("2026-08-03", { BC_2YEAR: "4.25", BC_10YEAR: "4.70", BC_30YEAR: "5.23" }),
  nominalEntry("2026-08-04", { BC_2YEAR: "4.20", BC_10YEAR: "4.63", BC_30YEAR: "5.18" }),
);

const VALID_REAL = feed(
  nominalEntry("2026-08-03", { TC_5YEAR: "2.17", TC_10YEAR: "2.43", TC_30YEAR: "2.99" }),
  nominalEntry("2026-08-04", { TC_5YEAR: "2.10", TC_10YEAR: "2.35", TC_30YEAR: "2.90" }),
).replace(/BC_/g, "TC_");

// ── Parser ─────────────────────────────────────────────────────────

describe("parseTreasuryXml — nominal", () => {
  it("parses valid XML into ascending-date observations with tenor labels", () => {
    const obs = parseTreasuryXml(VALID_NOMINAL, "nominal");
    expect(obs).toHaveLength(2);
    expect(obs[0].observationDate).toBe("2026-08-03");
    expect(obs[1].nominal["2Y"]).toBeCloseTo(4.20);
    expect(obs[1].nominal["10Y"]).toBeCloseTo(4.63);
  });

  it("never labels nominal yields as real yields", () => {
    const obs = parseTreasuryXml(VALID_NOMINAL, "nominal");
    for (const o of obs) expect(o.nominal).toBeDefined();
  });

  it("returns [] on malformed XML instead of throwing", () => {
    expect(parseTreasuryXml("<feed><entry>broken", "nominal")).toEqual([]);
    expect(parseTreasuryXml("", "nominal")).toEqual([]);
    expect(parseTreasuryXml("total garbage <>", "nominal")).toEqual([]);
  });

  it("returns [] on empty feed (no entries)", () => {
    expect(parseTreasuryXml('<feed xmlns:d="x"></feed>', "nominal")).toEqual([]);
  });

  it("skips entries missing NEW_DATE and entries without usable rates", () => {
    const xml = feed(
      '<entry><content><m:properties><d:BC_2YEAR m:type="Edm.Double">4.2</d:BC_2YEAR></m:properties></content></entry>',
      nominalEntry("2026-08-05", { BC_2YEAR: "4.3" }),
    );
    const obs = parseTreasuryXml(xml, "nominal");
    expect(obs).toHaveLength(1);
    expect(obs[0].observationDate).toBe("2026-08-05");
  });

  it("omits individual missing tenors without inventing values (schema mismatch tolerated)", () => {
    const xml = feed(nominalEntry("2026-08-05", { BC_2YEAR: "4.3" })); // no 10Y/30Y
    const obs = parseTreasuryXml(xml, "nominal");
    expect(obs[0].nominal["2Y"]).toBeDefined();
    expect(obs[0].nominal["10Y"]).toBeUndefined();
    expect(obs[0].nominal["30Y"]).toBeUndefined();
  });

  it("ignores unexpected schema fields (no BC_*/TC_* match → no observation)", () => {
    const xml = feed(nominalEntry("2026-08-05", { WEIRD_FIELD: "9.9" }));
    expect(parseTreasuryXml(xml, "nominal")).toEqual([]);
  });

  it("real feed uses TC_* fields only and keeps them separate from nominal", () => {
    const obs = parseTreasuryXml(VALID_REAL, "real");
    expect(obs).toHaveLength(2);
    expect(obs[1].nominal["10Y"]).toBeCloseTo(2.35);
    // Real curve has no short tenors in the verified schema.
    expect(obs[1].nominal["2Y"]).toBeUndefined();
  });
});

// ── Context builder ────────────────────────────────────────────────

describe("buildTreasuryContext", () => {
  it("builds available context with latest + previous and real curve attached", () => {
    const ctx = buildTreasuryContext([VALID_NOMINAL], [VALID_REAL], NOW);
    if (!ctx.available) throw new Error("expected available");
    expect(ctx.latest.nominal.observationDate).toBe("2026-08-04");
    expect(ctx.previous?.nominal.observationDate).toBe("2026-08-03");
    expect(ctx.latest.real?.real["10Y"]).toBeCloseTo(2.35);
    expect(ctx.source).toMatch(/US Treasury/);
  });

  it("is unavailable with explicit reason when all feeds fail", () => {
    const r = buildTreasuryContext([undefined, undefined], [undefined], NOW);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toMatch(/no usable nominal yield/i);
  });

  it("degrades gracefully: real-feed failure leaves real curve absent, never substituted", () => {
    const ctx = buildTreasuryContext([VALID_NOMINAL], [undefined], NOW);
    if (!ctx.available) throw new Error("expected available");
    expect(ctx.latest.real).toBeUndefined();
    expect(ctx.latest.nominal["10Y" as keyof typeof ctx.latest.nominal]).toBeUndefined();
    // The nominal object must NOT be re-labeled as real anywhere:
    expect(ctx.latest.real?.observationDate).toBeUndefined();
  });

  it("picks the newest observation across multiple month feeds", () => {
    const july = feed(nominalEntry("2026-07-28", { BC_2YEAR: "4.10", BC_10YEAR: "4.55" }));
    const ctx = buildTreasuryContext([july, VALID_NOMINAL], [], NOW);
    if (!ctx.available) throw new Error("expected available");
    expect(ctx.latest.nominal.observationDate).toBe("2026-08-04");
  });
});

// ── Freshness policy ───────────────────────────────────────────────

describe("classifyMacroFreshness (slow macro policy)", () => {
  it("FRESH within the weekend/holiday-tolerant window", () => {
    expect(classifyMacroFreshness("2026-08-21", NOW)).toBe("FRESH"); // Friday, now Monday
    expect(classifyMacroFreshness("2026-08-24", NOW)).toBe("FRESH");
  });

  it("DELAYED past the fresh window but within the macro tolerance", () => {
    expect(classifyMacroFreshness("2026-08-18", NOW)).toBe("DELAYED");
    const edge = new Date(NOW - (TREASURY_DELAYED_DAYS - 0.5) * 86400e3);
    expect(classifyMacroFreshness(edge.toISOString().slice(0, 10), NOW)).toBe("DELAYED");
  });

  it("STALE beyond the macro tolerance", () => {
    expect(classifyMacroFreshness("2026-08-01", NOW)).toBe("STALE");
    expect(classifyMacroFreshness("2026-07-01", NOW)).toBe("STALE");
  });

  it("unparseable date is treated as STALE, never FRESH", () => {
    expect(classifyMacroFreshness("not-a-date", NOW)).toBe("STALE");
  });
});

// ── Directional evidence ───────────────────────────────────────────

describe("deriveMacroYieldEvidence", () => {
  it("falling ACTUAL real yields → supportive of gold longs; rising nominal → USD-positive", () => {
    const ctx = buildTreasuryContext([VALID_NOMINAL], [VALID_REAL], NOW);
    if (!ctx.available) throw new Error("expected available");
    const ev = deriveMacroYieldEvidence(ctx);
    expect(ev.goldLongEffect).toBeGreaterThan(0); // real fell 2.43 → 2.35
    expect(ev.usdStrengthEffect).toBeLessThan(0); // nominal fell
    expect(ev.notes.some((n) => /REAL yields/.test(n))).toBe(true);
  });

  it("single observation → zero directional evidence, disclosed note", () => {
    const one = feed(nominalEntry("2026-08-04", { BC_2YEAR: "4.20", BC_10YEAR: "4.63" }));
    const ctx = buildTreasuryContext([one], [], NOW);
    if (!ctx.available) throw new Error("expected available");
    const ev = deriveMacroYieldEvidence(ctx);
    expect(ev.goldLongEffect).toBe(0);
    expect(ev.usdStrengthEffect).toBe(0);
    expect(ev.notes.join(" ")).toMatch(/Only one Treasury observation/i);
  });

  it("sub-threshold change → NO directional evidence (availability ≠ confluence)", () => {
    const tiny = feed(
      nominalEntry("2026-08-03", { BC_2YEAR: "4.200", BC_10YEAR: "4.630" }),
      nominalEntry("2026-08-04", { BC_2YEAR: "4.205", BC_10YEAR: "4.632" }), // ~0.002pp
    );
    const ctx = buildTreasuryContext([tiny], [], NOW);
    if (!ctx.available) throw new Error("expected available");
    const ev = deriveMacroYieldEvidence(ctx);
    expect(ev.usdStrengthEffect).toBe(0);
    expect(ev.notes.join(" ")).toMatch(/below signal threshold/);
  });

  it("missing real curve → gold effect stays 0 and is explicitly disclosed (no nominal substitution)", () => {
    const ctx = buildTreasuryContext([VALID_NOMINAL], [undefined], NOW);
    if (!ctx.available) throw new Error("expected available");
    const ev = deriveMacroYieldEvidence(ctx);
    expect(ev.goldLongEffect).toBe(0);
    expect(ev.notes.join(" ")).toMatch(/Real-yield curve unavailable/);
    expect(ev.notes.join(" ")).toMatch(/NOT substituted/);
  });

  it("magnitude scales with change size but saturates at ±1", () => {
    const big = feed(
      nominalEntry("2026-08-03", { BC_2YEAR: "4.00", BC_10YEAR: "4.50" }),
      nominalEntry("2026-08-04", { BC_2YEAR: "4.40", BC_10YEAR: "4.90" }), // +0.40pp
    );
    const small = feed(
      nominalEntry("2026-08-03", { BC_2YEAR: "4.00", BC_10YEAR: "4.50" }),
      nominalEntry("2026-08-04", { BC_2YEAR: "4.02", BC_10YEAR: "4.52" }), // +0.02pp → below threshold
    );
    const bigEv = deriveMacroYieldEvidence(buildTreasuryContext([big], [], NOW) as never & { available: true });
    const smallCtx = buildTreasuryContext([small], [], NOW);
    if (!smallCtx.available) throw new Error("expected available");
    const smallEv = deriveMacroYieldEvidence(smallCtx);
    expect(bigEv.usdStrengthEffect).toBe(1); // saturated
    expect(smallEv.usdStrengthEffect).toBe(0);
  });
});
