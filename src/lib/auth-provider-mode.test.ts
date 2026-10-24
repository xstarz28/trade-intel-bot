import { describe, expect, it } from "vitest";
import { isActiveConvexUrl, resolveAuthProviderMode } from "./auth-provider-mode";

describe("resolveAuthProviderMode", () => {
  it("uses real Convex whenever a client is available", () => {
    expect(resolveAuthProviderMode({ isDevelopment: true, hasConvexClient: true })).toBe("convex");
    expect(resolveAuthProviderMode({ isDevelopment: false, hasConvexClient: true })).toBe("convex");
  });

  it("allows mock auth only during development when Convex is absent", () => {
    expect(resolveAuthProviderMode({ isDevelopment: true, hasConvexClient: false })).toBe("mock");
  });

  it("fails closed in production when Convex is absent", () => {
    expect(resolveAuthProviderMode({ isDevelopment: false, hasConvexClient: false })).toBe("misconfigured");
  });
});

describe("isActiveConvexUrl", () => {
  it("accepts only the active Hushed Convex URL", () => {
    expect(isActiveConvexUrl("https://hushed-seal-237.convex.cloud")).toBe(true);
    expect(isActiveConvexUrl("https://hushed-seal-237.convex.cloud/")).toBe(true);
  });

  it.each([
    "https://calculating-eagle-241.convex.cloud",
    "https://other-deployment.convex.cloud",
    "http://hushed-seal-237.convex.cloud",
    "https://hushed-seal-237.convex.cloud?override=1",
    undefined,
  ])("rejects non-active Convex URLs: %s", (value) => {
    expect(isActiveConvexUrl(value)).toBe(false);
  });
});
