/**
 * Phase 166 — Enum mappers must degrade, not crash, on missing data.
 *
 * The module docstring promises "Unknown/future enum values always produce a
 * safe fallback, never undefined, blank, or crash." That contract was not
 * actually met: every mapper ended in `default: return value.replace(...)`,
 * and five also called `value.toUpperCase()` on the switch subject. Any
 * absent field — a provider omission, a partially-hydrated persisted record,
 * a legacy row — threw a TypeError that took down the whole surface.
 *
 * This was found by enabling the dormant `.test.tsx` component suites, which
 * had never been collected by any vitest run.
 */

import { describe, expect, it } from "vitest";
import en from "./en";
import * as mappers from "./enum-mapping";
import { humanize } from "./enum-mapping";

const MAPPERS = Object.entries(mappers).filter(
  ([name, fn]) => name.startsWith("map") && typeof fn === "function",
) as [string, (v: unknown, t: typeof en) => string][];

describe("enum mapper missing-data contract", () => {
  it("exposes a non-trivial number of mappers", () => {
    // Guard against the reflection silently matching nothing.
    expect(MAPPERS.length).toBeGreaterThan(20);
  });

  for (const absent of [undefined, null, ""]) {
    it(`every mapper returns a safe string for ${JSON.stringify(absent)}`, () => {
      for (const [name, fn] of MAPPERS) {
        let out: string;
        expect(() => {
          out = fn(absent, en);
        }, `${name} threw on ${JSON.stringify(absent)}`).not.toThrow();

        out = fn(absent, en);
        expect(typeof out, `${name} returned a non-string`).toBe("string");
        expect(out.length, `${name} returned a blank label`).toBeGreaterThan(0);
      }
    });
  }

  it("never returns the literal string 'undefined' or 'null'", () => {
    for (const [name, fn] of MAPPERS) {
      for (const absent of [undefined, null]) {
        const out = fn(absent, en);
        expect(out.toLowerCase(), `${name} leaked a stringified nullish`).not.toBe(
          String(absent),
        );
      }
    }
  });

  it("still maps known values to their translated labels", () => {
    // Regression guard: the missing-data fix must not change real mappings.
    expect(mappers.mapSeverity("INVALIDATED", en)).toBe(en.status.invalidated);
    expect(mappers.mapSide("LONG", en)).toBe(en.analysis.long);
    expect(mappers.mapSide("SHORT", en)).toBe(en.analysis.short);
    expect(mappers.mapThesisHealth("HEALTHY", en)).toBe(en.status.healthy);
  });

  it("humanizes genuinely unknown values instead of blanking them", () => {
    // A future enum value the UI does not know yet must still be readable.
    expect(mappers.mapSeverity("SOME_FUTURE_STATE", en)).toBe("SOME FUTURE STATE");
  });

  it("case-insensitive mappers still normalize real values", () => {
    expect(mappers.mapSide("long", en)).toBe(en.analysis.long);
    expect(mappers.mapTrendLabel("Bullish", en)).toBe(en.analysis.bullish);
  });
});

describe("humanize", () => {
  it("marks absent values as UNKNOWN rather than guessing", () => {
    expect(humanize(undefined)).toBe("UNKNOWN");
    expect(humanize(null)).toBe("UNKNOWN");
    expect(humanize("")).toBe("UNKNOWN");
  });

  it("replaces underscores in real values", () => {
    expect(humanize("HIGH_RISK")).toBe("HIGH RISK");
  });
});
