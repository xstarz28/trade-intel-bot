import { describe, expect, it } from "vitest";
import { isAllowedConvexCloudUrl } from "./convex-url";

describe("isAllowedConvexCloudUrl", () => {
  it("accepts the active HTTPS Convex cloud deployment", () => {
    expect(isAllowedConvexCloudUrl("https://hushed-seal-237.convex.cloud")).toBe(true);
  });

  it.each([
    "http://hushed-seal-237.convex.cloud",
    "https://calculating-eagle-241.convex.cloud",
    "https://tough-goose-455.convex.cloud",
    "https://pleasant-curlew-264.convex.cloud",
    "https://hushed-seal-237.convex.cloud/extra",
    "https://user:pass@hushed-seal-237.convex.cloud",
    "https://hushed-seal-237.convex.cloud?override=1",
    "not a URL",
    "",
    undefined,
  ])("rejects invalid or retired Convex origins: %s", (value) => {
    expect(isAllowedConvexCloudUrl(value)).toBe(false);
  });
});
