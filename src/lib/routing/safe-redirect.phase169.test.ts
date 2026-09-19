/**
 * Phase 169 — Open-redirect resistance.
 *
 * The previous inline guard (`startsWith("/") && !startsWith("//")`) allowed
 * `/\evil.com`, which browsers normalise into a protocol-relative URL. These
 * tests pin the attack set so that regression cannot return.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_REDIRECT, resolveSafeRedirect } from "./safe-redirect";

describe("legitimate destinations survive", () => {
  it("accepts the app's own routes", () => {
    expect(resolveSafeRedirect("/dashboard")).toBe("/dashboard");
    expect(resolveSafeRedirect("/journal")).toBe("/journal");
    expect(resolveSafeRedirect("/")).toBe("/");
  });

  it("preserves query strings and hashes on a deep link", () => {
    expect(resolveSafeRedirect("/dashboard?tab=investor")).toBe(
      "/dashboard?tab=investor",
    );
    expect(resolveSafeRedirect("/journal?id=abc#note")).toBe("/journal?id=abc#note");
  });

  it("accepts nested paths under a known route", () => {
    expect(resolveSafeRedirect("/dashboard/positions")).toBe("/dashboard/positions");
  });
});

describe("cross-origin escapes are refused", () => {
  const attacks = [
    "//evil.com",
    "///evil.com",
    "/\\evil.com", // backslash normalises to "/" -> protocol-relative
    "/\\/evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http://evil.com",
    "//evil.com/dashboard",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/\tevil.com", // control char stripped by the browser
    "/\nevil.com",
    "/ /evil.com",
    "%2F%2Fevil.com",
    "\u0000//evil.com",
  ];

  for (const attack of attacks) {
    it(`refuses ${JSON.stringify(attack)}`, () => {
      expect(resolveSafeRedirect(attack)).toBe(DEFAULT_REDIRECT);
    });
  }

  it("never returns a value that parses to a foreign origin", () => {
    for (const attack of attacks) {
      const out = resolveSafeRedirect(attack);
      const resolved = new URL(out, "https://xstarz.example");
      expect(resolved.origin, `${attack} -> ${out}`).toBe("https://xstarz.example");
    }
  });
});

describe("malformed input degrades safely", () => {
  it("falls back for null, undefined and empty values", () => {
    expect(resolveSafeRedirect(null)).toBe(DEFAULT_REDIRECT);
    expect(resolveSafeRedirect(undefined)).toBe(DEFAULT_REDIRECT);
    expect(resolveSafeRedirect("")).toBe(DEFAULT_REDIRECT);
    expect(resolveSafeRedirect("   ")).toBe(DEFAULT_REDIRECT);
  });

  it("falls back for non-string input", () => {
    expect(resolveSafeRedirect(42 as unknown as string)).toBe(DEFAULT_REDIRECT);
    expect(resolveSafeRedirect({} as unknown as string)).toBe(DEFAULT_REDIRECT);
  });

  it("falls back for a relative path", () => {
    expect(resolveSafeRedirect("dashboard")).toBe(DEFAULT_REDIRECT);
  });

  it("sends unknown routes to the fallback rather than a dead end", () => {
    expect(resolveSafeRedirect("/no-such-page")).toBe(DEFAULT_REDIRECT);
  });

  it("honours an explicit fallback", () => {
    expect(resolveSafeRedirect("//evil.com", "/")).toBe("/");
  });
});
