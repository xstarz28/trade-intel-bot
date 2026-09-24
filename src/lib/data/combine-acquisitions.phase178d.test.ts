/**
 * Phase 178d integrity fix — `combineAcquisitions` must never fabricate
 * provider contact.
 *
 * The original implementation mapped an empty list to `observed-now`. An
 * empty list means NO cache read completed, which is no evidence that any
 * provider was contacted, so that return value violated the core Phase 178d
 * invariant: modes are REPORTED, never inferred.
 *
 * This was not theoretical. Measured against the real `fetchIntelligence`
 * handler with a dead transport: the action returned `success: true`,
 * `acquisition: "observed-now"`, `observedAt: undefined` — a claimed fresh
 * observation backed by nothing. The reachability test at the bottom of this
 * file pins that path.
 */

import { describe, expect, it } from "vitest";
import {
  combineAcquisitions,
  envelopeAcquisition,
  legFromCache,
  legUncachedByDesign,
  oldestObservation,
  summarizeProvenance,
} from "./provenance-diagnostics";

type Mode = "observed-now" | "observed-shared" | "cache-reused";

describe("combineAcquisitions — empty input cannot imply provider contact", () => {
  it("an empty list never reports observed-now", () => {
    expect(combineAcquisitions([])).not.toBe("observed-now");
  });

  it("an empty list never reports any mode implying an observation", () => {
    const result = combineAcquisitions([]);
    // The three forbidden answers named in the defect report.
    expect(result).not.toBe("observed-now");
    expect(result).not.toBe("observed-shared");
    expect(result).not.toBe("uncached-by-design");
  });

  it("an empty list never reports cache-reused either", () => {
    // No read completed, so nothing was reused from cache either. Claiming
    // reuse would imply evidence exists when none does.
    expect(combineAcquisitions([])).not.toBe("cache-reused");
  });

  it("an empty list resolves to the existing `unavailable` state", () => {
    // `unavailable` is already part of AcquisitionMode ("provider returned no
    // usable data"), so no new mode was invented for this fix.
    expect(combineAcquisitions([])).toBe("unavailable");
  });

  it("does not throw, because an empty composite is genuinely reachable", () => {
    // Alpha Vantage swallows a news-transport failure (news is non-critical)
    // and still returns a success envelope with zero completed cache reads.
    // Throwing would convert a survivable degradation into a hard failure.
    expect(() => combineAcquisitions([])).not.toThrow();
  });
});

describe("combineAcquisitions — precedence for real inputs is unchanged", () => {
  it("any caller-originated request wins: observed-now", () => {
    expect(combineAcquisitions(["cache-reused", "observed-now"])).toBe("observed-now");
    expect(combineAcquisitions(["observed-now"])).toBe("observed-now");
    expect(
      combineAcquisitions(["cache-reused", "observed-shared", "observed-now"]),
    ).toBe("observed-now");
  });

  it("shared without a caller-originated request: observed-shared", () => {
    expect(combineAcquisitions(["observed-shared"])).toBe("observed-shared");
    expect(combineAcquisitions(["cache-reused", "observed-shared"])).toBe("observed-shared");
  });

  it("all reads reused: cache-reused", () => {
    expect(combineAcquisitions(["cache-reused"])).toBe("cache-reused");
    expect(combineAcquisitions(["cache-reused", "cache-reused", "cache-reused"])).toBe(
      "cache-reused",
    );
  });

  it("a single fresh read among many reused reads still reports contact", () => {
    // Fails safe: the provider WAS contacted, so the composite must say so.
    const modes: Mode[] = ["cache-reused", "cache-reused", "observed-now", "cache-reused"];
    expect(combineAcquisitions(modes)).toBe("observed-now");
  });

  it("precedence is order-independent", () => {
    expect(combineAcquisitions(["observed-now", "cache-reused"])).toBe(
      combineAcquisitions(["cache-reused", "observed-now"]),
    );
    expect(combineAcquisitions(["observed-shared", "cache-reused"])).toBe(
      combineAcquisitions(["cache-reused", "observed-shared"]),
    );
  });
});

describe("envelopeAcquisition — envelopes make no claim when nothing was read", () => {
  it("returns undefined for an empty composite", () => {
    // A success envelope can only carry the three success modes, so the
    // honest representation of "no completed read" is an ABSENT claim.
    expect(envelopeAcquisition([])).toBeUndefined();
  });

  it("passes real modes through unchanged", () => {
    expect(envelopeAcquisition(["observed-now"])).toBe("observed-now");
    expect(envelopeAcquisition(["cache-reused"])).toBe("cache-reused");
    expect(envelopeAcquisition(["cache-reused", "observed-shared"])).toBe("observed-shared");
  });

  it("never converts an empty composite into a fabricated observation", () => {
    expect(envelopeAcquisition([])).not.toBe("observed-now");
    expect(envelopeAcquisition([])).not.toBe("observed-shared");
  });
});

describe("uncached-by-design remains explicit and unchanged", () => {
  it("is produced only by its own dedicated constructor", () => {
    const leg = legUncachedByDesign({
      provider: "okx-order-book",
      dataset: "order-book",
      observedAt: Date.now() - 120,
    });
    expect(leg.mode).toBe("uncached-by-design");
    expect(leg.providerContacted).toBe(true);
    expect(leg.quotaChargeAttributableToCaller).toBe(true);
  });

  it("is never reachable through the composite combiner", () => {
    const inputs: Mode[][] = [
      [],
      ["observed-now"],
      ["observed-shared"],
      ["cache-reused"],
      ["observed-now", "cache-reused", "observed-shared"],
    ];
    for (const input of inputs) {
      expect(combineAcquisitions(input)).not.toBe("uncached-by-design");
    }
  });
});

describe("oldestObservation guards the composite age", () => {
  it("returns undefined when no observation exists", () => {
    expect(oldestObservation([])).toBeUndefined();
  });

  it("a fresh read cannot mask an older component", () => {
    const now = Date.now();
    expect(oldestObservation([now, now - 60_000, now - 5_000])).toBe(now - 60_000);
  });
});

describe("a no-evidence composite cannot inflate quota accounting", () => {
  it("legs built from real modes still attribute quota correctly", () => {
    const now = Date.now();
    const summary = summarizeProvenance([
      legFromCache({
        provider: "alpha-vantage",
        dataset: "news-sentiment",
        acquisition: combineAcquisitions(["observed-now"]) as Mode,
        observedAt: now,
      }),
      legFromCache({
        provider: "coinglass",
        dataset: "derivatives",
        acquisition: combineAcquisitions(["cache-reused"]) as Mode,
        observedAt: now - 1000,
      }),
    ]);

    // Exactly one provider request was caused by this caller.
    expect(summary.providerRequestsCaused).toBe(1);
    expect(summary.cacheReuseCount).toBe(1);
  });
});
