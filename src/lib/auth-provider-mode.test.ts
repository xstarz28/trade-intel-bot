import { describe, expect, it } from "vitest";
import { isActiveConvexUrl } from "./auth-provider-mode";

describe("isActiveConvexUrl", () => {
  it.each([
    "https://hushed-seal-237.convex.cloud",
    "https://hushed-seal-237.convex.cloud/",
  ])("accepts the legacy deployment URL only for account export: %s", (value) => {
    expect(isActiveConvexUrl(value)).toBe(true);
  });

  it.each([
    "https://calculating-eagle-241.convex.cloud",
    "https://other-deployment.convex.cloud",
    "http://hushed-seal-237.convex.cloud",
    "https://hushed-seal-237.convex.cloud?override=1",
    "https://hushed-seal-237.convex.cloud/path",
    "https://user:pass@hushed-seal-237.convex.cloud",
    undefined,
    null,
  ])("rejects non-active or malformed deployment URLs: %s", (value) => {
    expect(isActiveConvexUrl(value)).toBe(false);
  });
});
