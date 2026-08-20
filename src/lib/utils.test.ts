import { describe, it, expect } from "vitest";
import { getTimeAgo } from "./utils";

describe("getTimeAgo", () => {
  it("returns 'now' for timestamps less than 60s ago", () => {
    expect(getTimeAgo(Date.now() - 30_000)).toBe("now");
    expect(getTimeAgo(Date.now() - 1_000)).toBe("now");
  });

  it("returns minutes for < 1 hour", () => {
    expect(getTimeAgo(Date.now() - 120_000)).toBe("2m");
    expect(getTimeAgo(Date.now() - 3_600_000 + 1)).toBe("59m");
  });

  it("returns hours for < 24 hours", () => {
    expect(getTimeAgo(Date.now() - 3_600_000)).toBe("1h");
    expect(getTimeAgo(Date.now() - 86_400_000 + 1)).toBe("23h");
  });

  it("returns days for >= 24 hours", () => {
    expect(getTimeAgo(Date.now() - 86_400_000)).toBe("1d");
    expect(getTimeAgo(Date.now() - 172_800_000)).toBe("2d");
  });

  it("returns 'now' for future timestamps (edge case)", () => {
    expect(getTimeAgo(Date.now() + 60_000)).toBe("now");
  });
});
