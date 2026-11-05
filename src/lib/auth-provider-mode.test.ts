import { describe, expect, it } from "vitest";
import { isActiveConvexUrl } from "./auth-provider-mode";

describe("legacy Convex account-export URL", () => {
  it.each([
    "https://legacy-test.convex.cloud",
    "https://other-deployment.convex.cloud",
  ])("accepts a valid non-retired HTTPS Convex host: %s", (value) => {
    expect(isActiveConvexUrl(value)).toBe(true);
  });

  it.each([
    undefined,
    null,
    "",
    "http://legacy-test.convex.cloud",
    "https://example.com",
    "https://legacy-test.convex.cloud/path",
    "https://legacy-test.convex.cloud?query=1",
    "https://user:password@legacy-test.convex.cloud",
    "https://calculating-eagle-241.convex.cloud",
    "https://tough-goose-455.convex.cloud",
  ])("rejects invalid or retired legacy hosts: %s", (value) => {
    expect(isActiveConvexUrl(value)).toBe(false);
  });
});
