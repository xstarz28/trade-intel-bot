import { describe, expect, it } from "vitest";
import { isActiveConvexUrl, resolveAuthProviderMode } from "./auth-provider-mode";

describe("resolveAuthProviderMode", () => {
  it("uses Convex whenever the configured client is available", () => {
    expect(resolveAuthProviderMode({ isDevelopment: true, hasConvexClient: true })).toBe("convex");
    expect(resolveAuthProviderMode({ isDevelopment: false, hasConvexClient: true })).toBe("convex");
  });

  it("allows mock auth only in development when Convex is unavailable", () => {
    expect(resolveAuthProviderMode({ isDevelopment: true, hasConvexClient: false })).toBe("mock");
  });

  it("fails closed in production when Convex is unavailable", () => {
    expect(resolveAuthProviderMode({ isDevelopment: false, hasConvexClient: false })).toBe("misconfigured");
  });
});

describe("isActiveConvexUrl", () => {
  it.each([
    "https://hushed-seal-237.convex.cloud",
    "https://hushed-seal-237.convex.cloud/",
  ])("accepts the active deployment URL %s", (value) => {
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
