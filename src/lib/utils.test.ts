import { describe, it, expect } from "vitest";
import { getTimeAgo } from "./utils";

describe("getTimeAgo", () => {
  it("returns 'now' for timestamps less than 60s ago", () => {
    const now = Date.now();
    expect(getTimeAgo(now - 30_000)).toBe("now");
    expect(getTimeAgo(now)).toBe("now");
  });

  it("returns minutes for timestamps within the hour", () => {
    const now = Date.now();
    expect(getTimeAgo(now - 5 * 60_000)).toBe("5m");
    expect(getTimeAgo(now - 59 * 60_000)).toBe("59m");
  });

  it("returns hours for timestamps within the day", () => {
    const now = Date.now();
    expect(getTimeAgo(now - 2 * 3600_000)).toBe("2h");
    expect(getTimeAgo(now - 23 * 3600_000)).toBe("23h");
  });

  it("returns days for older timestamps", () => {
    const now = Date.now();
    expect(getTimeAgo(now - 2 * 86400_000)).toBe("2d");
    expect(getTimeAgo(now - 30 * 86400_000)).toBe("30d");
  });

  it("handles future timestamps gracefully", () => {
    const now = Date.now();
    // Future timestamp: diff is negative, seconds will be negative, < 60 → "now"
    expect(getTimeAgo(now + 60_000)).toBe("now");
  });
});
