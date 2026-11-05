import { describe, expect, it } from "vitest";
import { isActiveConvexUrl } from "./auth-provider-mode";

describe("isActiveConvexUrl", () => {
  it.each([
    "https://legacy-test.convex.cloud",
    "https://legacy-test.convex.cloud/",
  ])("accepts the legacy deployment URL only for account export: %s", (value) => {
    expect(isActiveConvexUrl(value)).toBe(true);
  });

  it.each([
    "https://calculating-eagle-241.convex.cloud",
    "https://tough-goose-455.convex.cloud",
    "https://other-deployment.convex.cloud",
    "http://legacy-test.convex.cloud",
    "https://legacy-test.convex.cloud?override=1",
    "https://legacy-test.convex.cloud/path",
    "https://user:pass@legacy-test.convex.cloud",
    undefined,
    null,
  ])("rejects non-active or malformed deployment URLs: %s", (value) => {
    expect(isActiveConvexUrl(value)).toBe(false);
  });
});
