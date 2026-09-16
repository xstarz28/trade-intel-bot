/**
 * Phase 170 — Numeric integrity on the position-entry path.
 *
 * Three defects, one chain. A user types something unparseable, the form
 * turns it into a real-looking number, the validator accepts it because
 * `NaN <= 0` is false, and the UI renders "NaN" or a fabricated "0.00000"
 * that reads like a genuine price level.
 *
 * Fabricating a price violates the live-data integrity rule, and a fabricated
 * stop or entry is a number a user could act on with real money.
 */

import { describe, expect, it } from "vitest";
import {
  PRICE_UNAVAILABLE,
  formatInstrumentPrice,
} from "./instrument-registry";
import { validateRegistration } from "./position-registration";
import type { PositionRegistrationInput } from "./position-registration";

const base: PositionRegistrationInput = {
  positionId: "pos-1",
  instrument: "BTC/USD",
  side: "LONG",
  entryPrice: 60_000,
  horizon: "SWING",
  openedAt: 1_700_000_000_000,
  assetClass: "crypto",
};

describe("formatInstrumentPrice never renders a non-price", () => {
  it("returns the unavailable marker for NaN", () => {
    // Previously rendered the literal string "NaN".
    expect(formatInstrumentPrice("BTC/USD", Number.NaN)).toBe(PRICE_UNAVAILABLE);
  });

  it("returns the unavailable marker for Infinity", () => {
    // Previously rendered "∞" via toLocaleString.
    expect(formatInstrumentPrice("BTC/USD", Number.POSITIVE_INFINITY)).toBe(
      PRICE_UNAVAILABLE,
    );
    expect(formatInstrumentPrice("BTC/USD", Number.NEGATIVE_INFINITY)).toBe(
      PRICE_UNAVAILABLE,
    );
  });

  it("does not render zero as a price", () => {
    // "0.00000" looks like a real quote. No instrument trades at zero.
    expect(formatInstrumentPrice("EUR/USD", 0)).toBe(PRICE_UNAVAILABLE);
  });

  it("does not render a negative price", () => {
    expect(formatInstrumentPrice("EUR/USD", -1)).toBe(PRICE_UNAVAILABLE);
  });

  it("handles null and undefined without throwing", () => {
    expect(formatInstrumentPrice("BTC/USD", null)).toBe(PRICE_UNAVAILABLE);
    expect(formatInstrumentPrice("BTC/USD", undefined)).toBe(PRICE_UNAVAILABLE);
  });

  it("still formats genuine prices correctly", () => {
    // The guard must not suppress real data.
    expect(formatInstrumentPrice("BTC/USD", 60_000)).not.toBe(PRICE_UNAVAILABLE);
    expect(formatInstrumentPrice("BTC/USD", 60_000)).toContain("60");
    expect(formatInstrumentPrice("EUR/USD", 1.0842)).toContain("1.08");
    // Sub-1 prices keep their precision.
    expect(formatInstrumentPrice("UNKNOWN/PAIR", 0.00012345)).toContain("0.0001");
  });

  it("formats an unknown symbol rather than failing", () => {
    expect(formatInstrumentPrice("NOT/LISTED", 250)).not.toBe(PRICE_UNAVAILABLE);
  });
});

describe("validateRegistration rejects non-finite numbers", () => {
  it("rejects a NaN entry price", () => {
    // `NaN <= 0` is false, so the old check accepted NaN as a valid price.
    const result = validateRegistration({ ...base, entryPrice: Number.NaN });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/entry price/i);
  });

  it("rejects an infinite entry price", () => {
    expect(
      validateRegistration({ ...base, entryPrice: Number.POSITIVE_INFINITY }).valid,
    ).toBe(false);
  });

  it("rejects NaN in every optional price field", () => {
    for (const field of ["currentPrice", "stopLoss", "takeProfit"] as const) {
      const result = validateRegistration({ ...base, [field]: Number.NaN });
      expect(result.valid, `${field} accepted NaN`).toBe(false);
    }
  });

  it("rejects a NaN leverage", () => {
    expect(validateRegistration({ ...base, leverage: Number.NaN }).valid).toBe(false);
  });

  it("still accepts a fully valid registration", () => {
    const result = validateRegistration({
      ...base,
      currentPrice: 61_000,
      stopLoss: 58_000,
      takeProfit: 65_000,
      leverage: 2,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("still accepts omitted optional fields", () => {
    expect(validateRegistration(base).valid).toBe(true);
  });
});

describe("validation messages are written for a user", () => {
  it("does not expose NaN as an internal token", () => {
    const errors = validateRegistration({ ...base, entryPrice: Number.NaN }).errors;
    expect(errors.join(" ")).not.toContain("NaN");
    expect(errors.join(" ")).toMatch(/not a valid number/i);
  });

  it("explains a zero price instead of restating it", () => {
    const errors = validateRegistration({ ...base, entryPrice: 0 }).errors;
    expect(errors.join(" ")).toMatch(/greater than zero/i);
  });

  it("explains an out-of-range leverage", () => {
    const errors = validateRegistration({ ...base, leverage: 0.5 }).errors;
    expect(errors.join(" ")).toMatch(/at least 1/i);
  });
});

describe("form parsing does not invent values", () => {
  // Mirrors parseNumericField in PositionRegistrationPanel.tsx.
  const parse = (raw: string): number | undefined => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return Number.NaN;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  it("distinguishes an empty field from an invalid one", () => {
    // Empty means "omitted"; invalid means "the user typed something wrong".
    expect(parse("")).toBeUndefined();
    expect(parse("   ")).toBeUndefined();
    expect(parse("abc")).toBeNaN();
  });

  it("never turns unparseable text into zero", () => {
    // The original `parseFloat(x) || 0` reported a price the user never typed.
    for (const raw of ["abc", "$60000", "60,000", "--5", "1.2.3"]) {
      expect(parse(raw), raw).toBeNaN();
      expect(parse(raw), raw).not.toBe(0);
    }
  });

  it("rejects a partial parse", () => {
    // parseFloat("12abc") is 12 — a typo silently becoming a real price.
    expect(parse("12abc")).toBeNaN();
    expect(parse("60000usd")).toBeNaN();
  });

  it("rejects overflow to Infinity", () => {
    expect(parse("1e999")).toBeNaN();
  });

  it("accepts the numeric formats a trader actually types", () => {
    expect(parse("60000")).toBe(60_000);
    expect(parse("1.0842")).toBe(1.0842);
    expect(parse(".5")).toBe(0.5);
    expect(parse("  61000  ")).toBe(61_000);
    expect(parse("1e3")).toBe(1000);
  });

  it("an invalid field reaches validation as invalid, not as zero", () => {
    const result = validateRegistration({
      ...base,
      entryPrice: parse("abc") ?? Number.NaN,
    });
    expect(result.valid).toBe(false);
    // Crucially the user is not told their price was 0.
    expect(result.errors.join(" ")).not.toMatch(/got 0\b/);
  });
});
