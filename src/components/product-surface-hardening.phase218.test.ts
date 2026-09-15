/**
 * Phase 218 — product-surface hardening regressions.
 *
 * Two concrete defects were found in the user-visible surface and fixed. These
 * tests pin both, and pin the surrounding invariants that made them defects.
 *
 * 1. FABRICATED FRESHNESS. PositionProtectionDashboard mapped provider news
 *    into the feed with `timestamp: art.publishedAt ? ... : Date.now()`, then
 *    passed that same value to `classifyNewsFreshness(..., Date.now())`. For an
 *    article with no provider timestamp the computed age was 0 ms, so it was
 *    always labelled FRESH and shown as LIVE. Local receipt time is not a
 *    publication time, and "we do not know when this was published" must not
 *    render as "published just now".
 *
 * 2. RAW AUTH ERROR ON THE CONSOLE. LogoDropdown logged the sign-out rejection
 *    with `console.error("Sign out error:", error)`. A rejected auth call can
 *    carry provider bodies, endpoint paths and token or session fragments, and
 *    the browser console is user-visible and captured by extensions. A failed
 *    sign-out also left the user in the authenticated area, presenting them as
 *    still signed in on a session they asked to end.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { classifyNewsFreshness } from "@/lib/position-protection/news-intelligence";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const dashboard = read("src/components/PositionProtectionDashboard.tsx");
const logoDropdown = read("src/components/LogoDropdown.tsx");
const diagnostics = read("src/lib/auth/safe-diagnostics.ts");

/** Strip comments: the invariants are also described in prose. */
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

describe("Phase 218 — a missing provider timestamp is never rendered as FRESH", () => {
  it("demonstrates why substituting the local clock was wrong", () => {
    // The old expression: timestamp = Date.now(), now = Date.now().
    const now = Date.now();
    expect(classifyNewsFreshness(now, now)).toBe("FRESH");
    // An undated article was therefore indistinguishable from one published
    // seconds ago, which is the defect this phase removes at the call site.
  });

  it("still classifies genuine provider timestamps by real age", () => {
    const now = Date.now();
    expect(classifyNewsFreshness(now - 30 * 60_000, now)).toBe("FRESH");
    expect(classifyNewsFreshness(now - 3 * 3_600_000, now)).toBe("RECENT");
    expect(classifyNewsFreshness(now - 48 * 3_600_000, now)).toBe("STALE");
  });

  it("no longer substitutes Date.now() for a missing publishedAt", () => {
    const code = codeOnly(dashboard);
    expect(code).not.toContain("new Date(art.publishedAt).getTime() : Date.now()");
    expect(code).toContain("hasProviderTimestamp");
  });

  it("labels an article without a provider timestamp UNAVAILABLE", () => {
    const code = codeOnly(dashboard);
    // The honest state already exists in the NewsItem union and is localized.
    expect(code).toMatch(/hasProviderTimestamp[\s\S]{0,140}UNAVAILABLE/);
  });

  it("only classifies freshness when a provider timestamp exists", () => {
    const code = codeOnly(dashboard);
    const call = code.slice(code.indexOf("freshness:"), code.indexOf("sourceMode:"));
    expect(call).toContain("hasProviderTimestamp");
    expect(call).toContain("classifyNewsFreshness");
  });

  it("keeps UNAVAILABLE a real member of the freshness union", () => {
    const news = read("src/lib/position-protection/news-intelligence.ts");
    expect(news).toMatch(/freshness:\s*"FRESH"\s*\|\s*"RECENT"\s*\|\s*"STALE"\s*\|\s*"UNAVAILABLE"/);
  });

  it("renders UNAVAILABLE through the localized mapper, not raw text", () => {
    const mapping = read("src/lib/i18n/enum-mapping.ts");
    expect(mapping).toMatch(/case "UNAVAILABLE": return t\.marketPanel\.freshness\.unavailable/);
  });
});

describe("Phase 218 — sign-out failures disclose nothing", () => {
  it("never passes the rejection to the console", () => {
    const code = codeOnly(logoDropdown);
    expect(code).not.toContain("console.error");
    expect(code).not.toMatch(/catch\s*\(\s*error\s*\)/);
  });

  it("reports a fixed category instead", () => {
    expect(codeOnly(logoDropdown)).toContain('reportAuthDiagnostic("sign-out-failed")');
  });

  it("registers the category in the diagnostics union", () => {
    expect(diagnostics).toContain('"sign-out-failed"');
  });

  it("keeps the diagnostic helper incapable of accepting an error", () => {
    // The helper takes no error parameter by design, so there is no channel
    // through which a payload could reach the console even by accident.
    expect(diagnostics).toMatch(
      /export function reportAuthDiagnostic\(category: AuthDiagnosticCategory\): void/,
    );
  });

  it("leaves the authenticated area even when sign-out fails", () => {
    const handler = logoDropdown.slice(
      logoDropdown.indexOf("const handleSignOut"),
      logoDropdown.indexOf("const handleGoHome"),
    );
    // Two navigations: the success path and the failure path.
    expect(handler.match(/navigate\("\/"\)/g)?.length).toBe(2);
  });
});

describe("Phase 218 — audited surfaces that were already correct stay correct", () => {
  it("the dashboard does not invent an entitlement count", () => {
    const badge = read("src/components/EntitlementBadge.tsx");
    // Remaining is read from the server response, never derived locally.
    expect(badge).toContain("entitlement.remaining");
    expect(codeOnly(badge)).not.toMatch(/remaining\s*[-+]{2}|remaining\s*=\s*remaining\s*[-+]/);
  });

  it("a superseded analysis run cannot overwrite a newer result", () => {
    const dash = read("src/pages/Dashboard.tsx");
    expect(dash).toContain("isStaleRun");
    const success = dash.slice(dash.indexOf("if (isStaleRun()) return;"));
    expect(success.slice(0, 200)).toContain("setCurrentResult(result)");
  });

  it("the auth page does not navigate before the server confirms the session", () => {
    const auth = read("src/pages/Auth.tsx");
    const otpHandler = auth.slice(
      auth.indexOf("const handleOtpSubmit"),
      auth.indexOf("const handleGuestLogin"),
    );
    // The redirect is driven by isAuthenticated in an effect, not inline.
    expect(otpHandler).not.toMatch(/navigate\(/);
  });
});
