import { describe, expect, it } from "vitest";
import { resolveLegacyMigrationRedirect } from "./legacy-redirect";

describe("legacy Convex migration redirect allowlist", () => {
  it("allows the exact self-hosted production origin", () => {
    expect(resolveLegacyMigrationRedirect("https://xstarzganaliys.com/dashboard"))
      .toBe("https://xstarzganaliys.com/dashboard");
  });

  it("allows relative paths on the configured legacy site origin", () => {
    expect(resolveLegacyMigrationRedirect("/dashboard", "https://old.example.com"))
      .toBe("https://old.example.com/dashboard");
  });

  it("allows an explicit redirect to the new domain while retaining the configured old origin", () => {
    expect(resolveLegacyMigrationRedirect("https://xstarzganaliys.com/dashboard", "https://old.example.com"))
      .toBe("https://xstarzganaliys.com/dashboard");
  });

  it.each([
    "https://evil.example/dashboard",
    "https://xstarzganaliys.com.evil.example/dashboard",
    "javascript:alert(1)",
    "//evil.example/dashboard",
  ])("rejects an unapproved redirect target: %s", (target) => {
    expect(() => resolveLegacyMigrationRedirect(target, "https://old.example.com"))
      .toThrow("Legacy account migration redirect origin is not allowed.");
  });

  it("does not let an invalid SITE_URL widen the allowlist", () => {
    expect(() => resolveLegacyMigrationRedirect("https://evil.example/dashboard", "not-a-url"))
      .toThrow("Legacy account migration redirect origin is not allowed.");
  });
});
