import { describe, expect, it } from "vitest";
import { resolveAuthProviderMode } from "./auth-provider-mode";

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
