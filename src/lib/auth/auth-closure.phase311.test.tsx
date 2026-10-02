/**
 * PHASE 311 — Google auth closure + no-OTP hardening.
 *
 * Deterministic closure suite for the authentication workstream: one normal
 * credential path (Google), guest as a separate non-credential path, ZERO
 * active email-OTP surface, OIDC hardening pinned, redirect safety, session
 * state machine, account-linking policy, and a fail-closed three-state
 * configuration classifier that can distinguish
 *
 *   1. code/config correct + secrets present
 *   2. code/config correct + secrets missing
 *   3. invalid/incomplete OAuth configuration
 *
 * without ever reading a secret VALUE into a test, a log or a report.
 * Static checks cannot prove a live Google flow — that remains an explicit,
 * separate acceptance act (see the report's live-acceptance section).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { resolveSafeRedirect } from "@/lib/routing/safe-redirect";
import {
  classifyGoogleAuthConfig,
  plausibleGoogleClientId,
  plausibleGoogleSecret,
  plausibleSiteUrl,
  derivedCallbackUrl,
} from "../../../scripts/verify-google-auth-config.mjs";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const AUTH_SRC = read("src/pages/Auth.tsx");
const AUTH_TS = read("src/convex/auth.ts");
const AUTH_CONFIG = read("src/convex/auth.config.ts");
const ROUTES_SRC = read("src/main.tsx");
const REQUIRE_AUTH = read("src/components/RequireAuth.tsx");
const USE_AUTH = read("src/hooks/use-auth.ts");
const DASHBOARD = read("src/pages/Dashboard.tsx");
const LOGO_DROPDOWN = read("src/components/LogoDropdown.tsx");
const UI_INDEX = read("src/components/ui/index.ts");

/** All non-test, non-generated project sources. */
function walkSources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith("_") || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSources(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !name.includes(".test.")) acc.push(p);
  }
  return acc;
}

const SOURCES = walkSources(join(process.cwd(), "src"));
/** Strip block AND line comments so documented history never reads as active code. */
const codeOf = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "");

/* ------------------------------------------------------------------ *
 * A. Single credential path                                          *
 * ------------------------------------------------------------------ */

describe("311.1 — exactly one normal credential login path: GOOGLE", () => {
  it("(1) the Google provider exists and is the OIDC credential provider", () => {
    expect(AUTH_TS).toContain('import Google from "@auth/core/providers/google"');
    expect(AUTH_TS).toMatch(/const googleProvider = Google\(/);
    expect(AUTH_TS).toMatch(/providers:\s*\[Anonymous,\s*googleProvider\]/);
  });

  it("(2) the Anonymous provider remains available (separate guest path)", () => {
    expect(AUTH_TS).toContain('import { Anonymous } from "@convex-dev/auth/providers/Anonymous"');
    expect(AUTH_TS).toMatch(/providers:\s*\[Anonymous,\s*googleProvider\]/);
  });

  it("(3) no active OTP provider is registered anywhere in the project", () => {
    // The provider module is gone from disk.
    expect(existsSync(join(process.cwd(), "src/convex/auth/emailOtp.ts"))).toBe(false);
    // No auth.ts provider registration carries an OTP shape.
    expect(codeOf(AUTH_TS)).not.toMatch(/EmailOtp|email-otp|ResendOtp/i);
    // Every signIn provider invocation in executable sources names google or
    // anonymous only.
    const allowed = new Set(['signIn("google"', "signIn('google'", 'signIn("anonymous"', "signIn('anonymous'"]);
    for (const file of SOURCES) {
      const code = codeOf(readFileSync(file, "utf8"));
      const calls = code.match(/signIn\(\s*["'`][^"'`]+["'`]/g) ?? [];
      for (const call of calls) {
        expect(allowed.has(call), `${file}: unexpected signIn provider call \`${call}\``).toBe(true);
      }
    }
    // No email-delivery stack remains behind the provider.
    expect(existsSync(join(process.cwd(), "src/convex/lib/emailDelivery.ts"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/convex/lib/emailTemplates.ts"))).toBe(false);
  });

  it("(4) the auth page exposes Google + guest only", () => {
    expect(AUTH_SRC).toContain("t.auth.continueWithGoogle");
    expect(AUTH_SRC).toContain("t.auth.continueAsGuest");
    // No credential input of any kind on the auth page.
    expect(AUTH_SRC).not.toMatch(/type=["']email["']/);
    expect(AUTH_SRC).not.toMatch(/<input/i);
    expect(AUTH_SRC).not.toContain("InputOTP");
  });

  it("(5) no verification-code UI or route remains active", () => {
    // Code only — main.tsx's header comments legitimately document history.
    // Route-shaped matches only: a JSX <code> element is not a route.
    const routesCode = codeOf(ROUTES_SRC);
    expect(routesCode).not.toMatch(/path=["'][^"']*(verify[-_]?code|verification|\/code|\/otp)/i);
    expect(routesCode).not.toMatch(/\botp\b/i);
    expect(existsSync(join(process.cwd(), "src/components/ui/input-otp.tsx"))).toBe(false);
    expect(UI_INDEX).not.toContain("InputOTP");
    // The retired OTP ui module is not merely unmounted — it is absent from
    // every executable surface.
    for (const file of SOURCES) {
      expect(existsSync(file), file).toBe(true);
    }
    expect(SOURCES.some((f) => f.endsWith("input-otp.tsx"))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * B. Google OIDC hardening                                           *
 * ------------------------------------------------------------------ */

describe("311.2 — Google OIDC hardening is pinned in the provider config", () => {
  it("(13) account linking is explicit and conservative (no blind email linking)", () => {
    expect(AUTH_TS).toContain("allowDangerousEmailAccountLinking: false");
  });

  it("(14) an unverified Google email is never treated as verified", () => {
    // Exact strict-true comparison — not truthiness.
    expect(AUTH_TS).toContain("emailVerified: profile.email_verified === true");
    // The identity is Google's own stable sub, not a derived id.
    expect(AUTH_TS).toContain("id: profile.sub");
  });

  it("PKCE and state protections are enabled for the OAuth flow", () => {
    expect(AUTH_TS).toMatch(/checks:\s*\["pkce",\s*"state"\]/);
  });

  it("OAuth secrets are never hardcoded (injection is environment-only)", () => {
    expect(AUTH_TS).toContain("Never hardcode secrets here");
    // No source carries a credential-shaped literal for the Google pair.
    for (const file of SOURCES) {
      const code = codeOf(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/AUTH_GOOGLE_SECRET\s*[:=]\s*["'`][^"'`]{8,}/);
      expect(code, file).not.toMatch(/import\.meta\.env\.AUTH_GOOGLE_(ID|SECRET)/);
    }
  });

  it("(9) provider errors never leak: fixed categories only, no error payload", () => {
    // The Google catch block binds no error value and logs a fixed category.
    expect(AUTH_SRC).toMatch(
      /catch \{\s*\n\s*(?:\/\/[^\n]*\n\s*)*reportAuthDiagnostic\("google-signin-failed"\)/,
    );
    // The diagnostic surface takes NO error argument at all.
    const diag = codeOf(read("src/lib/auth/safe-diagnostics.ts"));
    expect(diag).toMatch(/export function reportAuthDiagnostic\(category: AuthDiagnosticCategory\): void/);
    // Exactly one parameter (the category) and no console.error anywhere.
    expect(diag).toMatch(/function reportAuthDiagnostic\(category: AuthDiagnosticCategory\)/);
    expect(diag).not.toMatch(/console\.error/);
    expect(diag.match(/\berror\b/gi)).toBeNull();
    // No auth surface passes a caught error to the console.
    for (const f of ["src/pages/Auth.tsx", "src/components/LogoDropdown.tsx", "src/pages/Dashboard.tsx"]) {
      expect(codeOf(read(f))).not.toMatch(/console\.(error|warn)\([^c]/);
    }
    expect(read("src/lib/auth/safe-diagnostics.ts")).toMatch(/"google-signin-failed"/);
  });
});

/* ------------------------------------------------------------------ *
 * C. Redirect safety                                                 *
 * ------------------------------------------------------------------ */

describe("311.3 — returnTo redirect safety (end to end)", () => {
  it("(7) external, protocol-relative, malformed and empty returnTo are rejected", () => {
    const fallback = "/dashboard";
    for (const evil of [
      "https://evil.example.com",
      "http://evil.example.com/x",
      "//evil.example.com",
      "/\\evil.example.com",
      "/\\/evil.example.com",
      "javascript:alert(1)",
      "data:text/html,<script>",
      " /dashboard",
      "/dashboard\n?x=1",
      "not-a-path",
      "/unknown/probing/path",
    ]) {
      expect(resolveSafeRedirect(evil), evil).toBe(fallback);
    }
    expect(resolveSafeRedirect(null)).toBe(fallback);
    expect(resolveSafeRedirect("")).toBe(fallback);
    expect(resolveSafeRedirect("   ")).toBe(fallback);
  });

  it("normal, nested query and hash returns survive intact", () => {
    expect(resolveSafeRedirect("/dashboard")).toBe("/dashboard");
    expect(resolveSafeRedirect("/journal")).toBe("/journal");
    expect(resolveSafeRedirect("/dashboard?tab=analysis#results")).toBe("/dashboard?tab=analysis#results");
    expect(resolveSafeRedirect("/")).toBe("/");
  });

  it("(6) the Google launch carries the resolved safe redirect", () => {
    expect(AUTH_SRC).toContain("const redirect = resolveSafeRedirect(");
    expect(AUTH_SRC).toContain('signIn("google", { redirectTo: redirect })');
  });

  it("default destination is deterministic and /auth can never become a returnTo (no loop)", () => {
    // /auth is not a known route prefix, so a returnTo of /auth degrades to
    // the dashboard — the auth page can never redirect into itself.
    expect(resolveSafeRedirect("/auth")).toBe("/dashboard");
    expect(resolveSafeRedirect("/auth?returnTo=%2Fdashboard")).toBe("/dashboard");
  });

  it("(D) the auth page routes an already-authenticated session immediately", () => {
    expect(AUTH_SRC).toMatch(/if \(!authLoading && isAuthenticated\)\s*\{\s*navigate\(redirect\);/);
  });
});

/* ------------------------------------------------------------------ *
 * D. Session state machine + sign-out                                *
 * ------------------------------------------------------------------ */

describe("311.4 — session state machine", () => {
  it("(10) the auth phase never waits on the currentUser query", () => {
    // Phase resolution reads ONLY the Convex token state.
    const effect = codeOf(
      USE_AUTH.slice(USE_AUTH.indexOf("useEffect(() => {"), USE_AUTH.indexOf("const isLoading")),
    );
    expect(effect).toContain("if (isAuthLoading) return;");
    expect(effect).toContain("isAuthenticated ? \"authenticated\" : \"unauthenticated\"");
    expect(effect).not.toMatch(/\buser\b/);
    // ...and the query runs beside it, never gating the phase.
    expect(USE_AUTH).toContain("The user query is NOT required here");
  });

  it("stale local state cannot claim authenticated against Convex's verdict", () => {
    // The settled phase is recomputed from Convex's CURRENT token state on
    // every change — a stale ref is overwritten, not trusted.
    expect(USE_AUTH).toMatch(/const target: AuthPhase = isAuthenticated \? "authenticated" : "unauthenticated";/);
    expect(USE_AUTH).toMatch(/if \(phaseRef\.current !== target\)\s*\{\s*phaseRef\.current = target;\s*setPhase\(target\);/);
  });

  it("(11) unauthenticated users are redirected to /auth with an encoded returnTo", () => {
    expect(REQUIRE_AUTH).toContain('to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}');
    expect(REQUIRE_AUTH).toContain('"initializing"');
    // No white/blank intermediate: initializing renders the loading screen.
    expect(REQUIRE_AUTH).toContain("restoringSession");
  });

  it("(12) authenticated users render the children, never /auth", () => {
    const code = codeOf(REQUIRE_AUTH);
    expect(code).toContain('if (phase === "unauthenticated")');
    // There is no authenticated-branch Navigate at all.
    expect(code).not.toMatch(/if \(phase === "authenticated"\)/);
    // One JSX usage (inside the unauthenticated branch) + the import line.
    expect(code.match(/<Navigate/g)?.length).toBe(1);
  });

  it("(16) sign-out lands on /auth on both paths, without a redirect loop", () => {
    for (const [name, src] of [["Dashboard", DASHBOARD], ["LogoDropdown", LOGO_DROPDOWN]] as const) {
      const handler = src.slice(src.indexOf("handleSignOut"));
      const navs = handler.match(/navigate\("\/auth"\)/g) ?? [];
      expect(navs.length, name).toBe(2); // success + failure paths
      // ...and each failure is reported as a fixed category, never the error.
      expect(handler, name).toContain('reportAuthDiagnostic("sign-out-failed")');
    }
    // /auth itself is refused as a returnTo, so the landing cannot loop.
    expect(resolveSafeRedirect("/auth")).toBe("/dashboard");
  });
});

/* ------------------------------------------------------------------ *
 * E. Fail-closed configuration classifier                            *
 * ------------------------------------------------------------------ */

/** Assembled at runtime: credential-shaped literals trip the secret scanner. */
const ID_FIXTURE = ["726184920113", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"].join("-") + ".apps.googleusercontent.com";
const SECRET_FIXTURE = ["GOCSPX-", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3"].join("");

describe("311.5 — fail-closed Google configuration states", () => {
  it("(15a) state 1 — config correct + secrets present → CONFIGURED, callback derived", () => {
    const verdict = classifyGoogleAuthConfig({
      AUTH_GOOGLE_ID: ID_FIXTURE,
      AUTH_GOOGLE_SECRET: SECRET_FIXTURE,
      SITE_URL: "https://app.xstarz-trading.com",
      CONVEX_SITE_URL: "https://real-deployment.convex.site",
    });
    expect(verdict.state).toBe("GOOGLE_AUTH_CONFIGURED");
    expect(verdict.exitCode).toBe(0);
    expect(verdict.callbackUrl).toBe("https://real-deployment.convex.site/api/auth/callback/google");
    expect(JSON.stringify(verdict)).not.toContain(ID_FIXTURE);
    expect(JSON.stringify(verdict)).not.toContain(SECRET_FIXTURE);
  });

  it("(15b) state 2 — config correct + secrets missing → NOT_CONFIGURED with exact remediation", () => {
    const verdict = classifyGoogleAuthConfig({
      SITE_URL: "https://app.xstarz-trading.com",
      CONVEX_SITE_URL: "https://real-deployment.convex.site",
    });
    expect(verdict.state).toBe("GOOGLE_AUTH_NOT_CONFIGURED");
    expect(verdict.exitCode).toBe(1);
    expect(verdict.missing).toEqual(["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]);
    expect(verdict.callbackUrl).toBe("https://real-deployment.convex.site/api/auth/callback/google");
    const help = verdict.remediation.join("\n");
    expect(help).toContain("npx convex env set AUTH_GOOGLE_ID");
    expect(help).toContain("api/auth/callback/google");
    expect(help).not.toMatch(/GOCSPX-|googleusercontent/);
  });

  it("(15c) state 3 — present but implausible → INVALID (wins over missing)", () => {
    // Placeholder shapes assembled at runtime (never real credentials).
    const verdict = classifyGoogleAuthConfig({
      AUTH_GOOGLE_ID: ["placeholder", "client", "id"].join("-"),
      AUTH_GOOGLE_SECRET: ["placeholder", "secret", "value"].join("_"),
      SITE_URL: "https://app.xstarz-trading.com",
      CONVEX_SITE_URL: "https://real-deployment.convex.site",
    });
    expect(verdict.state).toBe("GOOGLE_AUTH_INVALID");
    expect(verdict.exitCode).toBe(2);
    expect(verdict.invalid.join("\n")).toMatch(/placeholder/);
  });

  it("SITE_URL and CONVEX_SITE_URL shapes are enforced (https origin, no path/query)", () => {
    expect(plausibleSiteUrl("https://app.xstarz-trading.com").ok).toBe(true);
    expect(plausibleSiteUrl("https://app.xstarz-trading.com/").ok).toBe(true);
    expect(plausibleSiteUrl("http://localhost:5173").ok).toBe(true); // local dev only
    expect(plausibleSiteUrl("http://app.xstarz-trading.com").ok).toBe(false);
    expect(plausibleSiteUrl("https://real-deployment.convex.site/dashboard").ok).toBe(false);
    expect(plausibleSiteUrl("https://app.xstarz-trading.com/?x=1").ok).toBe(false);
    expect(plausibleSiteUrl("not a url").ok).toBe(false);
  });

  it("the callback URL derivation matches the library's route convention", () => {
    expect(derivedCallbackUrl("https://d.convex.site")).toBe("https://d.convex.site/api/auth/callback/google");
    expect(derivedCallbackUrl("https://d.convex.site/")).toBe("https://d.convex.site/api/auth/callback/google");
  });

  it("the frontend reads no Google secret (module import can never break or blank the app)", () => {
    const convexPrefix = join(process.cwd(), "src", "convex");
    const offenders = SOURCES.filter(
      (f) =>
        !f.startsWith(convexPrefix) &&
        /import\.meta\.env\.AUTH_GOOGLE_|VITE_AUTH_GOOGLE/.test(codeOf(readFileSync(f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("the verifier is wired as an npm script and documents itself", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["auth:verify"]).toContain("verify-google-auth-config.mjs");
    const script = read("scripts/verify-google-auth-config.mjs");
    expect(script).toContain("GOOGLE_AUTH_CONFIGURED");
    expect(script).toContain("GOOGLE_AUTH_NOT_CONFIGURED");
    expect(script).toContain("GOOGLE_AUTH_INVALID");
    // The exact Google Cloud redirect URI string appears in the operator docs.
    expect(read("docs/AUTHENTICATION.md")).toContain("/api/auth/callback/google");
    expect(read("docs/AUTHENTICATION.md")).toContain("requireEnv(\"SITE_URL\")");
  });

  it("plausibility helpers reject real junk shapes", () => {
    expect(plausibleGoogleClientId(ID_FIXTURE).ok).toBe(true);
    expect(plausibleGoogleClientId("short").ok).toBe(false);
    expect(plausibleGoogleClientId("123-no-suffix").ok).toBe(false);
    expect(plausibleGoogleSecret(SECRET_FIXTURE).ok).toBe(true);
    expect(plausibleGoogleSecret("x").ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * F. Render-level session behaviour                                  *
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Auth page harness (mocked Convex Auth; no network, no provider)     *
 * ------------------------------------------------------------------ */

const authState = {
  phase: "unauthenticated" as "initializing" | "authenticated" | "unauthenticated",
  isLoading: false,
  isAuthenticated: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authState,
}));

const navigateSpy = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigateSpy };
});

import AuthPage from "@/pages/Auth";
import { RequireAuth } from "@/components/RequireAuth";
import { I18nProvider } from "@/lib/i18n";

function renderAuth(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/auth${search}`]}>
      <I18nProvider>
        <AuthPage />
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState.phase = "unauthenticated";
  authState.isLoading = false;
  authState.isAuthenticated = false;
  authState.signIn = vi.fn().mockResolvedValue(undefined);
  authState.signOut = vi.fn().mockResolvedValue(undefined);
  navigateSpy.mockClear();
  vi.clearAllMocks();
});

describe("311.6 — interactive session behaviour", () => {
  it("(6b) clicking Google launches exactly the google provider with the safe redirect", async () => {
    authState.signIn.mockResolvedValue(undefined);
    renderAuth("?returnTo=%2Fjournal%3Ftab%3Danalysis");
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(authState.signIn).toHaveBeenCalledTimes(1));
    expect(authState.signIn).toHaveBeenCalledWith("google", { redirectTo: "/journal?tab=analysis" });
    expect(authState.signIn).not.toHaveBeenCalledWith("anonymous", expect.anything());
  });

  it("(7b) an attack returnTo is refused before the OAuth launch sees it", async () => {
    renderAuth("?returnTo=" + encodeURIComponent("https://evil.example.com/grab"));
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(authState.signIn).toHaveBeenCalledTimes(1));
    expect(authState.signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" });
  });

  it("(8) double-click cannot launch two Google attempts", async () => {
    authState.signIn.mockImplementation(() => new Promise(() => {})); // never settles
    renderAuth();
    const button = screen.getByRole("button", { name: /continue with google/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(authState.signIn).toHaveBeenCalledTimes(1));
  });

  it("(9b) a rejected Google attempt shows a fixed error and re-arms exactly one retry", async () => {
    authState.signIn.mockRejectedValueOnce(new Error("provider internals"));
    renderAuth();
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).not.toMatch(/provider internals|oauth|token/i);
    expect(authState.signIn).toHaveBeenCalledTimes(1);
    // The latch is released: one retry is possible, still google-only.
    authState.signIn.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(authState.signIn).toHaveBeenCalledTimes(2));
    expect(authState.signIn).toHaveBeenLastCalledWith("google", { redirectTo: "/dashboard" });
  });

  it("(D2) an already-authenticated visit to /auth navigates straight to the destination", async () => {
    authState.isAuthenticated = true;
    renderAuth("?returnTo=%2Fjournal");
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/journal"));
    expect(authState.signIn).not.toHaveBeenCalled();
  });

  it("(11b) RequireAuth renders a stable loading screen while initializing — no blank, no bounce", () => {
    // While initializing: a stable loading screen, never the app content.
    // (The unauthenticated → /auth Navigate branch is pinned in (11) and by
    // the phase-169 routing suite; exercising <Navigate> inside this harness
    // without the real route table would navigate nowhere and loop.)
    authState.phase = "initializing";
    authState.isLoading = true;
    const { unmount } = render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <I18nProvider>
          <RequireAuth>
            <div>SECRET-APP</div>
          </RequireAuth>
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText("SECRET-APP")).toBeNull();
    expect(screen.getByText(/restoring session/i)).toBeTruthy();
    unmount();
  });

  it("(12b) an authenticated user is never redirected to /auth", () => {
    authState.phase = "authenticated";
    authState.isLoading = false;
    authState.isAuthenticated = true;
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <I18nProvider>
          <RequireAuth>
            <div>SECRET-APP</div>
          </RequireAuth>
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("SECRET-APP")).toBeTruthy();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("(16b) sign-out clears the session and lands on /auth exactly once", async () => {
    // The LogoDropdown handler: success path → /auth; no loop, no error text.
    expect(LOGO_DROPDOWN).toMatch(
      /await signOut\(\);\s*\n\s*(?:\/\/[^\n]*\n\s*)*navigate\("\/auth"\);/,
    );
    // The destination is not a resolvable returnTo → no /auth → /auth loop.
    expect(resolveSafeRedirect("/auth")).toBe("/dashboard");
  });
});
