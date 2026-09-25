/**
 * Phase 288 — an unmapped currency is OUR coverage gap, not a provider outage.
 *
 * The live four-asset run selected the provider-native pair `AED/ARS`. Neither
 * side exists in `FOREX_COUNTRY_MAP` (the eight majors), so
 * `getRelevantCurrencies` returns an empty set, the cache producer returns
 * `null` and — correctly — no request is ever sent and nothing is cached. What
 * the caller then reported was "Calendar provider returned no data.": the
 * provider was blamed for a request this platform never made, and the wording
 * implied an assessment ("no data") where none was possible.
 *
 * These tests pin the precise reason, the fact that a formable request is left
 * completely unchanged, and that the calendar action actually uses the helper.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  calendarCoverageGapReason,
  getRelevantCurrencies,
} from "./calendar-types";

describe("phase 288 — the calendar coverage gap names itself", () => {
  it("names the unmapped sides of the pair and says no request was made", () => {
    const reason = calendarCoverageGapReason("AED/ARS", "forex");
    expect(reason).toBeDefined();
    expect(reason).toContain("No verified economic-calendar currency mapping");
    expect(reason).toContain("no calendar request was made");
    expect(reason).toContain("AED");
    expect(reason).toContain("ARS");
    // It must not read as a provider failure, and must not imply an assessment.
    expect(reason).not.toContain("provider returned no data");
  });

  it("does NOT fire when one side is mapped — that request is formable", () => {
    // Partially covered pairs stay on the ordinary path: the mapped side is
    // requested and the unmapped side is disclosed by the domain adapter
    // ("the calendar provider supplied no released … measurement for AED").
    // A request is only impossible when NO side is mapped.
    expect(getRelevantCurrencies("EUR/AED", "forex").length).toBeGreaterThan(0);
    expect(calendarCoverageGapReason("EUR/AED", "forex")).toBeUndefined();
  });

  it("stays silent when a request IS formable — every mapped pair", () => {
    for (const pair of ["EUR/USD", "GBP/JPY", "AUD/NZD", "USD/CHF", "EUR/CAD"]) {
      expect(getRelevantCurrencies(pair, "forex").length).toBeGreaterThan(0);
      expect(calendarCoverageGapReason(pair, "forex")).toBeUndefined();
    }
  });

  it("stays silent for the USD-anchored domains (crypto/commodity/stock)", () => {
    for (const type of ["crypto", "commodity", "stock"]) {
      expect(calendarCoverageGapReason("USDT-SGD", type)).toBeUndefined();
    }
  });

  it("names the routing domain when a non-forex domain has no mapping", () => {
    const reason = calendarCoverageGapReason("SOMETHING", "indices");
    expect(reason).toBeDefined();
    expect(reason).toContain("indices");
    expect(reason).toContain("not assessed");
  });

  it("the calendar action reports the gap instead of blaming the provider", () => {
    const source = readFileSync("src/convex/tradingEconomics.ts", "utf8");
    // The only `null` path of the cache producer is the empty-currency guard;
    // the caller must consult the helper there rather than assert "no data".
    expect(source).toContain("calendarCoverageGapReason(args.instrument, args.instrumentType)");
    expect(source).toContain('gap ?? "Calendar provider returned no data."');
    // …and the guard itself must keep refusing to send an unmapped request.
    expect(source).toContain("an absent currency mapping is not evidence");
  });
});
