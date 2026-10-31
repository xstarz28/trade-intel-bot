import { describe, expect, it } from "vitest";
import { resolveAuthRedirect } from "./auth-redirect";

describe("resolveAuthRedirect", () => {
  it("preserves a safe internal path, query, and fragment", () => {
    expect(resolveAuthRedirect("/journal?tab=closed#latest")).toBe("/journal?tab=closed#latest");
  });

  it("uses the fallback when returnTo is absent", () => {
    expect(resolveAuthRedirect(null)).toBe("/dashboard");
  });

  it.each([
    "//attacker.example/path",
    "/\\\\attacker.example/path",
    "https://attacker.example/path",
    "javascript:alert(1)",
    "/dashboard\\\\@attacker.example",
    "/dashboard\\u0000",
  ])("rejects unsafe redirect target %s", (candidate) => {
    expect(resolveAuthRedirect(candidate)).toBe("/dashboard");
  });

  it("supports a safe caller-provided fallback", () => {
    expect(resolveAuthRedirect("https://attacker.example", "/journal")).toBe("/journal");
  });

  it("rejects an unsafe caller-provided fallback", () => {
    expect(resolveAuthRedirect(null, "//attacker.example")).toBe("/dashboard");
    expect(resolveAuthRedirect(null, "/\\\\attacker.example")).toBe("/dashboard");
  });
});
