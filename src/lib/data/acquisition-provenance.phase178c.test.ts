/**
 * Phase 178c — acquisition provenance.
 *
 * Keeps "the provider returned data" from collapsing two different facts:
 * a new observation and a reuse of an older one.
 */

import { describe, expect, it } from "vitest";
import {
  type AcquisitionMode,
  consumedQuota,
  describeProvenance,
  isCacheReuse,
  isNewObservation,
  recordProvenance,
} from "./acquisition-provenance";

const T0 = 1_700_000_000_000;

describe("acquisition provenance distinguishes observation from reuse", () => {
  it("a fresh observation is a new observation and consumes quota", () => {
    const p = recordProvenance({
      provider: "cftc", dataset: "cot", mode: "observed-now",
      observedAt: T0, usedAt: T0,
    });
    expect(isNewObservation(p)).toBe(true);
    expect(isCacheReuse(p)).toBe(false);
    expect(consumedQuota(p)).toBe(true);
  });

  it("a cache reuse is NOT a new observation and consumes no quota", () => {
    const p = recordProvenance({
      provider: "cftc", dataset: "cot", mode: "cache-reused",
      observedAt: T0, usedAt: T0 + 60_000,
    });
    expect(isNewObservation(p)).toBe(false);
    expect(isCacheReuse(p)).toBe(true);
    expect(consumedQuota(p)).toBe(false);
  });

  it("evidence age is usedAt - observedAt", () => {
    const p = recordProvenance({
      provider: "eia", dataset: "eia", mode: "cache-reused",
      observedAt: T0, usedAt: T0 + 90_000,
    });
    expect(p.evidenceAgeMs).toBe(90_000);
  });

  it("usedAt is never substituted for a missing observedAt", () => {
    const p = recordProvenance({
      provider: "okx", dataset: "order-book", mode: "timed-out", usedAt: T0,
    });
    // Back-filling would fabricate an observation that never happened.
    expect(p.observedAt).toBeUndefined();
    expect(p.evidenceAgeMs).toBeUndefined();
    expect(p.usedAt).toBe(T0);
  });

  it("failure modes never carry an observation timestamp", () => {
    for (const mode of ["unavailable", "timed-out", "rate-limited", "skipped"] as AcquisitionMode[]) {
      const p = recordProvenance({
        provider: "p", dataset: "d", mode, observedAt: T0, usedAt: T0,
      });
      expect(p.observedAt).toBeUndefined();
    }
  });

  it("uncached-by-design is a new observation every time", () => {
    const p = recordProvenance({
      provider: "okx", dataset: "order-book", mode: "uncached-by-design",
      observedAt: T0, usedAt: T0,
    });
    expect(isNewObservation(p)).toBe(true);
    expect(consumedQuota(p)).toBe(true);
  });

  it("a single-flight join is an observation, not a cache hit", () => {
    const p = recordProvenance({
      provider: "cftc", dataset: "cot", mode: "observed-shared",
      observedAt: T0, usedAt: T0,
    });
    expect(isNewObservation(p)).toBe(true);
    expect(isCacheReuse(p)).toBe(false);
    // The provider WAS called; this caller merely shared the result.
    expect(consumedQuota(p)).toBe(false);
  });

  it("a reuse is described as a reuse, never as fresh", () => {
    const text = describeProvenance(recordProvenance({
      provider: "cftc", dataset: "cot", mode: "cache-reused",
      observedAt: T0, usedAt: T0 + 120_000,
    }));
    expect(text).toContain("reused earlier observation");
    expect(text).toContain("provider NOT contacted");
    expect(text).not.toContain("observed now");
  });

  it("descriptions never leak credentials", () => {
    for (const mode of ["observed-now","cache-reused","rate-limited","uncached-by-design"] as AcquisitionMode[]) {
      const text = describeProvenance(recordProvenance({
        provider: "alpha-vantage", dataset: "news-sentiment", mode,
        observedAt: T0, usedAt: T0,
      }));
      expect(text).not.toMatch(/apikey|api_key|Bearer/i);
    }
  });

  it("a negative age is clamped rather than reported as future evidence", () => {
    const p = recordProvenance({
      provider: "p", dataset: "d", mode: "cache-reused",
      observedAt: T0 + 5_000, usedAt: T0,
    });
    expect(p.evidenceAgeMs).toBe(0);
  });
});
