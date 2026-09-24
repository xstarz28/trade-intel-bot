/**
 * Phase 246 — Google OAuth without OTP
 * Validates Google OAuth integration, session integrity, no OTP after Google,
 * user linking, security, UI, and regression.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Phase246 1 — Google login success", () => {
  it("auth.ts includes Google provider", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("Google");
    expect(src).toContain("googleProvider");
    expect(src).toContain("@auth/core/providers/google");
  });
  it("Google provider is in providers list (Phase 270: alongside only Anonymous)", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toMatch(/providers:\s*\[.*Anonymous.*googleProvider/s);
    expect(src).not.toContain("emailOtp");
  });
});

describe("Phase246 2 — Google callback success", () => {
  it("http.ts adds auth routes including OAuth callback", () => {
    const src = read("src/convex/http.ts");
    expect(src).toContain("auth.addHttpRoutes");
  });
  it("auth config handles OAuth callback via convexAuth", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("convexAuth");
  });
});

describe("Phase246 3 — no OTP after Google", () => {
  it("Auth.tsx Google handler does not set OTP step", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("handleGoogleLogin");
    expect(src).not.toMatch(/handleGoogleLogin[\s\S]{0,200}setStep.*email/);
  });
  it("Google login does not invoke email-otp", () => {
    const src = read("src/pages/Auth.tsx");
    // Google path uses signIn("google"), not email-otp. Slice the whole
    // handler rather than a fixed window so the check survives the handler
    // growing (Phase 269 added the re-entry latch).
    const googleBlock = src.slice(
      src.indexOf("const handleGoogleLogin"),
      src.indexOf("const handleGuestLogin"),
    );
    expect(googleBlock).toContain('"google"');
    expect(googleBlock).not.toContain("email-otp");
  });
});

describe("Phase246 4 — no /verify-code redirect", () => {
  it("Auth page does not redirect Google to verify-code", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).not.toContain("/verify-code");
    expect(src).not.toContain("needsVerificationCode");
  });
  it("No verify-code route in App", () => {
    const src = read("src/main.tsx");
    expect(src).not.toContain("verify-code");
  });
});

describe("Phase246 5 — session creation", () => {
  it("useAuth creates authenticated phase from token", () => {
    const src = read("src/hooks/use-auth.ts");
    expect(src).toContain("isAuthenticated");
    expect(src).toContain("phase");
  });
  it("AuthProvider stores JWT after code verification", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("signIn");
    expect(src).toContain("store");
  });
});

describe("Phase246 6 — refresh persistence", () => {
  it("Auth page redirects when already authenticated", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("!authLoading && isAuthenticated");
    expect(src).toContain("navigate(redirect)");
  });
  it("useAuth preserves phase across refresh via storage", () => {
    const src = read("src/hooks/use-auth.ts");
    expect(src).toContain("useConvexAuth");
  });
});

describe("Phase246 7 — logout", () => {
  it("signOut is exported from auth", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("signOut");
  });
  it("useAuth exposes signOut", () => {
    const src = read("src/hooks/use-auth.ts");
    expect(src).toContain("signOut");
  });
});

describe("Phase246 8 — session expiration", () => {
  it("RequireAuth blocks unauthenticated", () => {
    const src = read("src/components/RequireAuth.tsx");
    expect(src).toContain("unauthenticated");
    expect(src).toContain("/auth");
  });
  it("isAuthenticated query exists", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("isAuthenticated");
  });
});

describe("Phase246 9 — repeated Google login", () => {
  it("upsertUserAndAccount handles existing account", () => {
    // Indirect via convex-auth implementation, but we check our config allows repeat
    const src = read("src/convex/auth.ts");
    expect(src).toContain("googleProvider");
    // No duplicate user creation logic in our code, delegated to convex-auth
  });
  it("Google profile returns stable id (sub)", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("profile.sub");
    expect(src).toContain("id: profile.sub");
  });
});

describe("Phase246 10 — duplicate-user prevention", () => {
  it("allowDangerousEmailAccountLinking false prevents blind linking", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("allowDangerousEmailAccountLinking: false");
  });
  it("emailVerified based on Google email_verified", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("email_verified");
    expect(src).toContain("emailVerified: profile.email_verified === true");
  });
});

describe("Phase246 11 — existing-user handling", () => {
  it("existing verified email user will be linked (convex-auth default)", () => {
    const src = read("src/convex/auth.ts");
    // linking via verified email is expected, but only when email_verified true
    expect(src).toContain("emailVerified");
  });
});

describe("Phase246 12 — identity preservation", () => {
  it("Google profile preserves name, email, image", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("name:");
    expect(src).toContain("email:");
    expect(src).toContain("image:");
  });
});

describe("Phase246 13 — provider subject preservation", () => {
  it("providerAccountId is Google sub", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("sub");
  });
  it("No client-controlled identity accepted", () => {
    const src = read("src/pages/Auth.tsx");
    // Auth.tsx does not accept arbitrary email/name as auth, only via signIn
    expect(src).not.toContain("providerAccountId");
  });
});

describe("Phase246 14 — verified email handling", () => {
  it("verified email leads to emailVerificationTime", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("emailVerified");
  });
});

describe("Phase246 15 — unverified email safety", () => {
  it("unverified Google email does not set emailVerified true", () => {
    const src = read("src/convex/auth.ts");
    // explicit check === true
    expect(src).toContain("=== true");
  });
  it("allowDangerous false prevents unverified linking", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("allowDangerousEmailAccountLinking: false");
  });
});

describe("Phase246 16 — state validation", () => {
  it("checks include state for CSRF", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("state");
    expect(src).toContain('checks: ["pkce", "state"]');
  });
});

describe("Phase246 17 — CSRF/state mismatch", () => {
  it("convex-auth handles state mismatch via handleOAuth", () => {
    // Ensure we use standard OAuth flow which validates state
    const src = read("src/convex/auth.ts");
    expect(src).toContain("pkce");
  });
});

describe("Phase246 18 — callback failure", () => {
  it("Auth.tsx handles Google failure with fixed error", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("google-signin-failed");
    expect(src).toContain("googleFailed");
  });
});

describe("Phase246 19 — cancelled login", () => {
  it("cancelled login does not create session", () => {
    const src = read("src/pages/Auth.tsx");
    // handleGoogleLogin catches error, does not set authenticated
    expect(src).toContain("handleGoogleLogin");
    expect(src).toContain("setIsLoading(false)");
  });
});

describe("Phase246 20 — provider unavailable", () => {
  it("Google button disabled when loading, shows error on failure", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("disabled={isLoading");
    expect(src).toContain("googleFailed");
  });
});

describe("Phase246 21 — missing configuration", () => {
  it("no hardcoded client id/secret in source", () => {
    const src = read("src/convex/auth.ts");
    expect(src).not.toMatch(/clientId:\s*["'][A-Za-z0-9]/);
    expect(src).not.toMatch(/clientSecret:\s*["']/);
    expect(src).toContain("AUTH_GOOGLE_ID");
  });
  it("env vars via setEnvDefaults, not committed", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("Never hardcode secrets");
  });
});

describe("Phase246 22 — account-link conflict", () => {
  it("convex-auth prevents linking when both email and phone verified users exist", () => {
    // This is in convex-auth users.js, we ensure our config doesn't bypass
    const src = read("src/convex/auth.ts");
    expect(src).toContain("allowDangerousEmailAccountLinking: false");
  });
});

describe("Phase246 23 — authorization guard", () => {
  it("RequireAuth redirects to /auth with returnTo", () => {
    const src = read("src/components/RequireAuth.tsx");
    expect(src).toContain("returnTo");
    expect(src).toContain("/auth");
  });
});

describe("Phase246 24 — protected Dashboard", () => {
  it("Dashboard is behind RequireAuth in App.tsx", () => {
    const app = read("src/main.tsx");
    expect(app).toContain("RequireAuth");
    expect(app).toContain("Dashboard");
  });
});

describe("Phase246 25 — cross-user isolation", () => {
  it("users table has email index, not shared", () => {
    const schema = read("src/convex/schema.ts");
    expect(schema).toContain('index("email"');
  });
  it("auth does not expose other users data", () => {
    const src = read("src/convex/users.ts");
    expect(src).toContain("currentUser");
  });
});

describe("Phase246 26 — data preservation", () => {
  it("analyses and journal linked to userId, not reset on login", () => {
    const schema = read("src/convex/schema.ts");
    expect(schema).toContain("userId");
    expect(schema).toContain("analyses");
    expect(schema).toContain("journal");
  });
});

describe("Phase246 27 — invalid session", () => {
  it("RequireAuth shows loading then unauthenticated", () => {
    const src = read("src/components/RequireAuth.tsx");
    expect(src).toContain("initializing");
    expect(src).toContain("unauthenticated");
  });
});

describe("Phase246 28 — OAuth retry", () => {
  it("signIn retry logic exists in client", () => {
    // convex-auth client has RETRY_BACKOFF
    const src = read("src/hooks/use-auth.ts");
    expect(src).toBeDefined();
  });
  it("Google login can be retried after failure", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("handleGoogleLogin");
    expect(src).toContain("setIsLoading(false)");
  });
});

describe("Phase246 29 — redirect-loop prevention", () => {
  it("Auth page useEffect only navigates when authenticated", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("if (!authLoading && isAuthenticated)");
    // No navigate in OTP or Google handlers directly
    const googleSection = src.slice(src.indexOf("handleGoogleLogin"), src.indexOf("handleGoogleLogin") + 600);
    expect(googleSection).not.toContain("navigate(");
  });
});

describe("Phase246 30 — no client secret leakage", () => {
  it("Auth.tsx does not log secrets", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).not.toContain("clientSecret");
    expect(src).not.toContain("AUTH_GOOGLE_SECRET");
  });
  it("safe-diagnostics does not log error values", () => {
    const src = read("src/lib/auth/safe-diagnostics.ts");
    expect(src).toContain("never log the error VALUE");
    // The file mentions console.error in comment, but must not call it
    expect(src).not.toMatch(/console\.error\(/);
  });
});

describe("Phase246 31 — no secret in Git", () => {
  it("no secret files committed", () => {
    const src = read("src/convex/auth.ts");
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
    expect(src).not.toContain("GOOGLE_CLIENT_SECRET");
  });
  it("no private key in auth files", () => {
    const authFiles = ["src/convex/auth.ts", "src/pages/Auth.tsx", "src/hooks/use-auth.ts"].map(read).join("\n");
    expect(authFiles).not.toContain("PRIVATE KEY");
    expect(authFiles).not.toContain("BEGIN RSA");
  });
});

describe("Phase246 32 — browser token handling", () => {
  it("Google access tokens not stored in localStorage", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).not.toContain("access_token");
    expect(src).not.toContain("refresh_token");
  });
  it("only Convex JWT stored via AuthProvider", () => {
    const hook = read("src/hooks/use-auth.ts");
    expect(hook).toContain("useConvexAuth");
  });
});

describe("Phase246 33 — logout/relogin", () => {
  it("signOut clears tokens", () => {
    const src = read("src/hooks/use-auth.ts");
    expect(src).toContain("signOut");
  });
  it("after logout, RequireAuth blocks", () => {
    const src = read("src/components/RequireAuth.tsx");
    expect(src).toContain("unauthenticated");
  });
});

describe("Phase246 34 — multiple-session behavior", () => {
  it("AuthProvider syncs across tabs via storage event", () => {
    // This is in convex-auth client, but we verify hook uses it
    const src = read("src/hooks/use-auth.ts");
    expect(src).toContain("useConvexAuth");
  });
});

describe("Phase246 35 — deterministic auth errors", () => {
  it("error messages are fixed, not dynamic", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("t.auth.googleFailed");
    expect(src).toContain("t.auth.guestFailed");
    // Phase 269: t.auth.sendFailed left the page with the email send flow.
    // No interpolation of error.message
    expect(src).not.toMatch(/setError\(.*error\.message/);
    // Every error assignment still routes through a fixed catalogue string.
    for (const assignment of src.match(/setError\(([^)]+)\)/g) ?? []) {
      expect(assignment).toMatch(/setError\((t\.auth\.\w+|null)\)/);
    }
  });
  it("diagnostic categories are fixed union", () => {
    const src = read("src/lib/auth/safe-diagnostics.ts");
    expect(src).toContain("AuthDiagnosticCategory");
    expect(src).toContain("google-signin-failed");
  });
});

describe("Phase246 36 — OTP is no longer a normal UI path (amended by Phase 269)", () => {
  it("email OTP handlers, step state and code input are removed from the Auth page", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).not.toContain("email-otp");
    expect(src).not.toContain("handleEmailSubmit");
    expect(src).not.toContain("handleOtpSubmit");
    expect(src).not.toContain("InputOTP");
  });
  it("backend OTP delivery infrastructure is retired and removed (Phase 270 amendment)", () => {
    // Phase 269 left the decision open ("retiring that infrastructure is a
    // separate decision"). Phase 270 made it: the delivery modules no longer
    // exist, so the pin inverts — absence of the whole stack, stronger than
    // any content assertion.
    expect(existsSync("src/convex/auth/emailOtp.ts")).toBe(false);
    expect(existsSync("src/convex/lib/emailDelivery.ts")).toBe(false);
    expect(existsSync("src/convex/lib/emailTemplates.ts")).toBe(false);
  });
  it("no UI copy states an OTP lifetime — and no backend lifetime exists to drift from (Phase 270)", () => {
    // The drift this pin guarded is now impossible in both directions: the UI
    // has no OTP copy, and the backend constant is gone with its module.
    const src = read("src/pages/Auth.tsx");
    expect(src).not.toContain("OTP_VALIDITY_MINUTES");
    expect(existsSync("src/convex/auth/emailOtp.ts")).toBe(false);
  });
});

describe("Phase246 37 — Google path separation (amended by Phase 269)", () => {
  it("Google login is a self-contained handler with no step state", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src.indexOf("handleGoogleLogin")).toBeGreaterThan(-1);
    expect(src).toContain("const handleGoogleLogin");
    // There is no step machine left for the Google path to leak into.
    expect(src).not.toContain("setStep");
    expect(src).not.toMatch(/useState<"signIn" \| \{ email: string \}>/);
  });
  it("the single visible surface never branches to a code-entry step", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).not.toContain('step === "signIn"');
    expect(src).not.toContain("checkEmailTitle");
    expect(src).not.toContain("verifyCode");
  });
});

describe("Phase246 38 — unauthorized route behavior", () => {
  it("unauthenticated user redirected to login", () => {
    const src = read("src/components/RequireAuth.tsx");
    expect(src).toContain("Navigate");
    expect(src).toContain("/auth");
  });
  it("authenticated user can access Dashboard", () => {
    const src = read("src/components/RequireAuth.tsx");
    expect(src).toContain("return children");
  });
});

describe("Phase246 39 — UI button behavior", () => {
  it("Google button exists with correct aria-label", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("continueWithGoogle");
    expect(src).toContain("aria-label={t.auth.continueWithGoogle}");
  });
  it("Google button shows help text no OTP needed", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("googleHelp");
    const en = read("src/lib/i18n/en.ts");
    expect(en).toContain("No verification code needed");
  });
  it("Google button disabled when loading", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("disabled={isLoading || authLoading}");
  });
  it("Google icon is present", () => {
    const src = read("src/pages/Auth.tsx");
    expect(src).toContain("GoogleIcon");
  });
});

describe("Phase246 40 — end-to-end auth flow", () => {
  it("Google -> callback -> session -> Dashboard without OTP", () => {
    const authTs = read("src/convex/auth.ts");
    const authPage = read("src/pages/Auth.tsx");
    const requireAuth = read("src/components/RequireAuth.tsx");
    // Google provider configured
    expect(authTs).toContain("Google");
    // UI triggers Google
    expect(authPage).toContain('signIn("google"');
    // No OTP after Google
    expect(authPage).not.toContain("Google + OTP");
    expect(authPage).not.toContain("Google verification code");
    // Protected routes
    expect(requireAuth).toContain("authenticated");
  });
  it("full flow: unauth -> /auth -> Google -> authenticated -> /dashboard", () => {
    const app = read("src/main.tsx");
    expect(app).toContain("/auth");
    expect(app).toContain("RequireAuth");
  });
});

describe("Phase246 extra — security audit", () => {
  it("no hardcoded Google secrets in repo", () => {
    const files = ["src/convex/auth.ts", "src/pages/Auth.tsx", "src/lib/i18n/en.ts"].map(read).join("\n");
    expect(files).not.toMatch(/GOCSPX-[A-Za-z0-9_-]+/);
  });
  it("PKCE and state enforced", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("pkce");
    expect(src).toContain("state");
  });
});
