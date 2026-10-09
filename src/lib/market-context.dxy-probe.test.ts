import { describe, expect, it } from "vitest";
import { selectDxyProbeCandidate } from "./market-context";

describe("rate-safe DXY discovery", () => {
  const candidates = ["DXY", "DX.Y.NYB", "USD_INDEX", "I:DXY"];

  it("probes one candidate in order", () => {
    expect(selectDxyProbeCandidate(candidates, 0, null, 100_000)).toBe("DXY");
    expect(selectDxyProbeCandidate(candidates, 1, 100_000, 160_001)).toBe("DX.Y.NYB");
  });

  it("defers another probe inside the cooldown window", () => {
    expect(selectDxyProbeCandidate(candidates, 1, 100_000, 159_999)).toBeNull();
  });

  it("does not select a candidate beyond the list", () => {
    expect(selectDxyProbeCandidate(candidates, 4, null, 200_000)).toBeNull();
  });

  it("handles an empty candidate list", () => {
    expect(selectDxyProbeCandidate([], 0, null, 200_000)).toBeNull();
  });
});
