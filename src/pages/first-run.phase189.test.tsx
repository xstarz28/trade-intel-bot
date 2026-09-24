/**
 * Phase 189 — onboarding and first-run experience.
 *
 * Critical property: **a brand-new user must complete the first-run journey
 * without the UI inventing authentication, entitlement, market-data or
 * analysis state.**
 *
 * These tests render the real Auth page and the real first-run components
 * with mocked Convex boundaries, so they exercise the actual shipped
 * components rather than helper functions.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n";
import { resolveSafeRedirect } from "@/lib/routing/safe-redirect";

/**
 * jsdom does not implement ResizeObserver, which `input-otp` instantiates on
 * mount. Environment gap, not a product defect — scoped to this file so the
 * shared setup stays untouched.
 */
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const AUTH_SRC = read("src/pages/Auth.tsx");
const DASHBOARD_SRC = read("src/pages/Dashboard.tsx");
const HISTORY_SRC = read("src/components/AnalysisHistory.tsx");
const PROTECTED_SRC = read("src/convex/protectedAnalysis.ts");

/* ------------------------------------------------------------------ *
 * Auth page harness
 * ------------------------------------------------------------------ */

const authState = {
  isLoading: false,
  isAuthenticated: false,
  signIn: vi.fn(),
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authState,
}));

const navigateSpy = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigateSpy };
});

import AuthPage from "./Auth";
import { AnalysisHistory } from "@/components/AnalysisHistory";
import { FirstRunGuide } from "@/components/FirstRunGuide";

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
  authState.isLoading = false;
  authState.isAuthenticated = false;
  authState.signIn = vi.fn().mockResolvedValue(undefined);
  navigateSpy.mockClear();
});

// ════════════ 1. UNAUTHENTICATED LANDING ════════════

describe("189.1 — unauthenticated first contact", () => {
  it("1. presents Google Sign-In as the normal entry, not a dashboard", () => {
    // Phase 269 — Google is the normal authentication entry point; the
    // email-entry step no longer exists in the visible flow.
    renderAuth();
    expect(screen.getByLabelText(/continue with google/i)).toBeTruthy();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("1. has no email-entry or OTP step in the normal flow", () => {
    const { container } = renderAuth();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.queryByLabelText(/verification code/i)).toBeNull();
    expect(container.querySelectorAll('input[type="email"]').length).toBe(0);
  });

  it("2. explains that Google sign-in needs no verification code", () => {
    const { container } = renderAuth();
    const text = container.textContent ?? "";
    expect(text).toMatch(/no verification code needed/i);
    expect(text).not.toMatch(/check your email/i);
  });

  it("names the product, never an email vendor or internal provider", () => {
    const { container } = renderAuth();
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).toContain("xstarz analysis");
    for (const forbidden of ["resend", "smtp2go", "freebuff", "convex", "vly", "postmark", "sendgrid"]) {
      expect(text, `${forbidden} must not be user-visible`).not.toContain(forbidden);
    }
  });

  it("states the decision-support boundary on the first screen", () => {
    const { container } = renderAuth();
    expect(container.textContent).toMatch(/never places trades/i);
  });

  it("does not promise permanent login", () => {
    const { container } = renderAuth();
    expect(container.textContent ?? "").not.toMatch(
      /stay signed in forever|always signed in|never sign in again/i,
    );
  });

  it("offers the guest path with an honest limit description", () => {
    const { container } = renderAuth();
    expect(screen.getByText(/continue as guest/i)).toBeTruthy();
    expect(container.textContent).toMatch(/limited number of analyses/i);
  });
});

// ════════════ 2. AUTH LOADING ════════════

describe("189.2 — authentication loading state", () => {
  it("2. loading does not redirect as though authenticated", () => {
    authState.isLoading = true;
    authState.isAuthenticated = false;
    renderAuth();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("2. a loading-but-authenticated state still waits for resolution", () => {
    authState.isLoading = true;
    authState.isAuthenticated = true;
    renderAuth();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(AUTH_SRC).toContain("!authLoading && isAuthenticated");
  });

  it("4. a resolved session redirects without asking for a new code", () => {
    authState.isLoading = false;
    authState.isAuthenticated = true;
    renderAuth();
    expect(navigateSpy).toHaveBeenCalledWith("/dashboard");
  });

  it("4. session restoration never re-prompts for OTP", () => {
    // Restoration is the same code path as a fresh resolved session: the
    // effect redirects and the OTP step is never constructed.
    authState.isAuthenticated = true;
    const { container } = renderAuth();
    expect(container.textContent).not.toMatch(/check your email/i);
  });
});

// ════════════ 3. NO OTP STEP (PHASE 269) ════════════
//
// Phase 269 removed the email-entry + verification-code step from the
// visible authentication flow: Google Sign-In is the normal path and leads
// straight into the app. The assertions that used to exercise the OTP step
// now pin the inverse property — no user action can make a credential code
// surface appear.

describe("189.3 — the OTP step is gone from the normal flow (Phase 269)", () => {
  it("no user action can reach an email or code-entry surface", async () => {
    renderAuth();
    // Drive the only credential action that exists and let it complete.
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    await waitFor(() => expect(authState.signIn).toHaveBeenCalled());
    expect(screen.queryByText(/check your email/i)).toBeNull();
    expect(screen.queryByLabelText(/verification code/i)).toBeNull();
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });

  it("the UI states no code lifetime, and the backend lifetime survives", () => {
    // Phase 189 required the stated validity to MATCH the backend. The OTP
    // step that carried the statement is gone, so the guarantee holds
    // vacuously — no UI copy can drift. Phase 270 removed the backend half of
    // the drift as well: the module that owned OTP_EXPIRY_MINUTES no longer
    // exists, and no signIn("email-otp") call can reach a provider.
    expect(existsSync("src/convex/auth/emailOtp.ts")).toBe(false);
    expect(AUTH_SRC).not.toContain("OTP_VALIDITY_MINUTES");
    expect(AUTH_SRC).not.toContain("handleOtpSubmit");
    expect(AUTH_SRC).not.toContain("handleEmailSubmit");
    expect(AUTH_SRC).not.toContain("InputOTP");
    // (scoped to code: the header comment legitimately names the retired
    // provider to document the fails-closed boundary.)
    const code = AUTH_SRC.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/signIn\(\s*["'`]email/);
  });

  it("OTP copy stays out of the rendered page entirely", () => {
    const { container } = renderAuth();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/check your email/i);
    expect(text).not.toMatch(/6-digit/i);
    expect(text).not.toMatch(/verify code/i);
    expect(text).not.toMatch(/different email/i);
    expect(text).not.toMatch(/valid for \d+ minutes/i);
  });
});

// ════════════ 4. AUTH FAILURE + RAW ERROR CONTAINMENT ════════════

describe("189.4 — authentication failures are safe and recoverable", () => {
  const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];
  let logged: string[] = [];

  beforeEach(() => {
    logged = [];
    for (const level of ["error", "warn", "log", "info", "debug"] as const) {
      consoleSpies.push(
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map((a) => String(a)).join(" "));
        }),
      );
    }
  });

  afterEach(() => {
    consoleSpies.splice(0).forEach((s) => s.mockRestore());
  });

  /** A rejection shaped like a real provider failure. */
  const hostileError = Object.assign(
    new Error("Resend API 401: invalid api key re_live_SECRETVALUE123456"),
    {
      response: { body: { message: "unauthorized", account: "acct_9921" } },
      request: { url: "https://api.resend.com/emails", token: "tok_abc123" },
      config: { endpoint: "https://internal.convex.site/otp" },
    },
  );

  it("14. a Google sign-in failure shows a retryable message, never a raw error", async () => {
    authState.signIn = vi.fn().mockRejectedValue(hostileError);
    renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not sign in with google/i);
    expect(alert.textContent).not.toMatch(/resend|401|api key|re_live|acct_|tok_/i);
  });

  it("3. no provider payload reaches ANY console channel", async () => {
    authState.signIn = vi.fn().mockRejectedValue(hostileError);
    renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    await screen.findByRole("alert");

    const joined = logged.join("\n");
    for (const secret of [
      "re_live_SECRETVALUE123456",
      "tok_abc123",
      "acct_9921",
      "api.resend.com",
      "internal.convex.site",
      "401",
      "unauthorized",
    ]) {
      expect(joined, `leaked ${secret} to console`).not.toContain(secret);
    }
  });

  it("3. the diagnostic that IS emitted is a fixed safe category", async () => {
    authState.signIn = vi.fn().mockRejectedValue(hostileError);
    renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    await screen.findByRole("alert");

    expect(logged.join("\n")).toContain("[auth] step failed: google-signin-failed");
  });

  it("3. no catch block binds the error value on the auth path", () => {
    // `catch {` (no binding) makes leakage structurally impossible: there is
    // no variable in scope to log. Guards against a future refactor.
    expect(AUTH_SRC).not.toMatch(/catch\s*\(\s*[A-Za-z_$][\w$]*\s*\)/);
    expect(AUTH_SRC).not.toContain("console.error");
  });

  it("3. the diagnostic helper accepts no error argument at all", () => {
    const helper = read("src/lib/auth/safe-diagnostics.ts");
    expect(helper).toMatch(/reportAuthDiagnostic\(\s*category: AuthDiagnosticCategory\s*\)/);
    // One parameter only — nothing through which a payload could arrive.
    const sig = helper.match(/export function reportAuthDiagnostic\(([^)]*)\)/)?.[1] ?? "";
    expect(sig.split(",").length).toBe(1);
  });

  it("failure messages are announced to assistive technology", async () => {
    authState.signIn = vi.fn().mockRejectedValue(new Error("boom"));
    renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    expect((await screen.findByRole("alert")).textContent).toBeTruthy();
  });

  it("9. a failed Google sign-in opens no OTP fallback and never implies success", async () => {
    authState.signIn = vi.fn().mockRejectedValue(new Error("boom"));
    const { container } = renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    await screen.findByRole("alert");
    expect(container.textContent).not.toMatch(/check your email/i);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.queryByLabelText(/verification code/i)).toBeNull();
  });

  it("9. a failed guest sign-in does not fabricate a session", async () => {
    authState.signIn = vi.fn().mockRejectedValue(new Error("boom"));
    renderAuth();
    fireEvent.click(screen.getByText(/continue as guest/i));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not start a guest session/i);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// ════════════ 5. DEEP LINKS ════════════

describe("189.5 — deep-link return after authentication", () => {
  it("16. returns to the requested internal route", () => {
    authState.isAuthenticated = true;
    renderAuth("?returnTo=%2Fjournal");
    expect(navigateSpy).toHaveBeenCalledWith("/journal");
  });

  it("16. refuses an attacker-controlled external destination", () => {
    authState.isAuthenticated = true;
    renderAuth("?returnTo=https%3A%2F%2Fevil.example.com");
    expect(navigateSpy).toHaveBeenCalledWith("/dashboard");
  });

  it("16. refuses protocol-relative and scheme tricks", () => {
    for (const hostile of ["//evil.example.com", "/\\evil.example.com", "javascript:alert(1)"]) {
      expect(resolveSafeRedirect(hostile)).toBe("/dashboard");
    }
  });

  it("the page uses the hardened resolver rather than raw params", () => {
    expect(AUTH_SRC).toContain("resolveSafeRedirect");
    expect(AUTH_SRC).not.toMatch(/navigate\(\s*searchParams\.get/);
  });
});

// ════════════ 6. EMPTY VS LOADING ════════════

describe("189.6 — empty states distinguish loading from genuinely empty", () => {
  const renderHistory = (props: Partial<{ analyses: never[]; isLoading: boolean }>) =>
    render(
      <I18nProvider>
        <AnalysisHistory
          analyses={props.analyses ?? []}
          onSelect={() => {}}
          isLoading={props.isLoading}
        />
      </I18nProvider>,
    );

  it("8. a loading history does NOT claim the account is empty", () => {
    // REGRESSION (Phase 189 defect 2). Convex useQuery returns undefined
    // until it resolves; the Dashboard collapsed that to [], so a first-run
    // user saw "No history yet" before anything had loaded.
    const { container } = renderHistory({ isLoading: true });
    expect(container.textContent).not.toMatch(/no history/i);
    expect(container.textContent).toMatch(/loading/i);
  });

  it("8. the loading state is announced politely", () => {
    renderHistory({ isLoading: true });
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("8. a genuinely empty account still says so", () => {
    const { container } = renderHistory({ isLoading: false });
    expect(container.textContent).toMatch(/no history/i);
  });

  it("8. the Dashboard derives the loading flag from the unresolved query", () => {
    expect(DASHBOARD_SRC).toContain("const historyLoading = dbHistory === undefined");
    expect(DASHBOARD_SRC).toContain("isLoading={historyLoading}");
  });

  it("8. every history call site forwards the loading flag", () => {
    const callSites = DASHBOARD_SRC.match(/<AnalysisHistory[\s\S]*?\/>/g) ?? [];
    expect(callSites.length).toBeGreaterThan(0);
    for (const site of callSites) {
      expect(site, "a call site omits isLoading").toContain("isLoading={historyLoading}");
    }
  });

  it("8. loading is a distinct branch, not a variant of empty", () => {
    const loadingIdx = HISTORY_SRC.indexOf("if (isLoading)");
    const emptyIdx = HISTORY_SRC.indexOf("if (analyses.length === 0)");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(loadingIdx).toBeLessThan(emptyIdx);
  });
});

// ════════════ 7. INVALID FIRST INPUT ════════════

describe("189.7 — invalid first-run input fails explicitly", () => {
  it("5. no mistypeable credential field exists on the auth surface", () => {
    // Phase 269 — with the email/OTP step removed there is no free-text
    // credential input left on which invalid input could even be entered.
    const { container } = renderAuth();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(container.querySelectorAll('input[type="email"]').length).toBe(0);
    expect(AUTH_SRC).not.toContain('type="email"');
  });

  it("5. the Google button disables while a sign-in attempt is in flight", async () => {
    authState.signIn = vi.fn(() => new Promise(() => {}));
    renderAuth();
    const google = screen.getByLabelText(/continue with google/i) as HTMLButtonElement;
    fireEvent.click(google);
    await waitFor(() => expect(google.disabled).toBe(true));
  });

  it("5. invalid input is rejected before any provider fan-out", () => {
    const handler = PROTECTED_SRC.slice(PROTECTED_SRC.indexOf("export const runProtectedAnalysis"));
    const invalid = handler.indexOf("INVALID_INPUT");
    const fanout = handler.indexOf("runFanOut");
    expect(invalid).toBeGreaterThan(-1);
    expect(fanout).toBeGreaterThan(-1);
    expect(invalid).toBeLessThan(fanout);
  });

  it("5. invalid input consumes no entitlement", () => {
    const handler = PROTECTED_SRC.slice(PROTECTED_SRC.indexOf("export const runProtectedAnalysis"));
    const invalid = handler.indexOf("INVALID_INPUT");
    const consume = handler.indexOf("resolveAndConsume");
    expect(consume).toBeGreaterThan(-1);
    expect(invalid).toBeLessThan(consume);
  });

  it("5. the validation guard is reachable, not disabled", () => {
    // M2 lesson: an ordering assertion over source TEXT still passes when the
    // branch is neutered (`if (false && ...)`). Execute the real predicate
    // extracted from production instead of trusting that the text exists.
    const handler = PROTECTED_SRC.slice(PROTECTED_SRC.indexOf("export const runProtectedAnalysis"));
    const guard = handler.match(/if \(([^)]*!instrument[^)]*)\) \{/)?.[1];
    expect(guard, "the instrument validation guard vanished").toBeTruthy();

    // A short-circuited guard (`false &&`, `0 &&`) can never reject anything.
    expect(guard, "validation guard is disabled").not.toMatch(/\bfalse\b|\b0\s*&&/);

    // Evaluate it for real: empty inputs MUST satisfy the reject condition,
    // complete inputs must not.
    const evaluate = (instrument: string, instrumentType: string, timeframe: string) =>
      new Function(
        "instrument",
        "instrumentType",
        "timeframe",
        `return Boolean(${guard});`,
      )(instrument, instrumentType, timeframe) as boolean;

    expect(evaluate("", "CRYPTO", "H1"), "empty instrument must be rejected").toBe(true);
    expect(evaluate("BTC-USDT", "", "H1"), "empty type must be rejected").toBe(true);
    expect(evaluate("BTC-USDT", "CRYPTO", ""), "empty timeframe must be rejected").toBe(true);
    expect(evaluate("BTC-USDT", "CRYPTO", "H1"), "valid input must pass").toBe(false);
  });
});

// ════════════ 7b. PROVIDER DEGRADATION ════════════

describe("189.7b — provider failure never becomes a result", () => {
  /**
   * M6 lesson: nothing asserted that a non-success leg yields no data, so
   * deleting the status check in `successfulData` went unnoticed. A failed
   * acquisition must stay failed — it is NOT a NO_TRADE and NOT empty data.
   */
  it("13. a failed leg surrenders no data even if one is attached", async () => {
    const { successfulData } = await import("@/lib/data/provider-resilience");
    const failed = {
      provider: "okx",
      status: "failed" as const,
      // A stale/partial payload clinging to a failed leg must be ignored.
      data: { price: 12345 },
      startedAt: 0,
      durationMs: 5,
      timedOut: false,
      rateLimited: false,
      attempts: 1,
    };
    expect(successfulData(failed)).toBeUndefined();
  });

  it("13. a skipped leg surrenders no data", async () => {
    const { successfulData, skippedLeg } = await import("@/lib/data/provider-resilience");
    const skipped = { ...skippedLeg("okx", "no credentials"), data: { price: 1 } };
    expect(successfulData(skipped as never)).toBeUndefined();
  });

  it("13. a timed-out leg surrenders no data", async () => {
    const { successfulData } = await import("@/lib/data/provider-resilience");
    expect(
      successfulData({
        provider: "twelvedata",
        status: "failed",
        data: { close: 99 },
        category: "timeout",
        startedAt: 0,
        durationMs: 8000,
        timedOut: true,
        rateLimited: false,
        attempts: 1,
      }),
    ).toBeUndefined();
  });

  it("13. a genuine success still returns its data", async () => {
    const { successfulData } = await import("@/lib/data/provider-resilience");
    expect(
      successfulData({
        provider: "okx",
        status: "success",
        data: { price: 42 },
        startedAt: 0,
        durationMs: 5,
        timedOut: false,
        rateLimited: false,
        attempts: 1,
      }),
    ).toEqual({ price: 42 });
  });

  it("13. degradation is distinct from an empty result", async () => {
    const { successfulData } = await import("@/lib/data/provider-resilience");
    // undefined = "we did not get data"; it must never be coerced to a
    // neutral/empty object that reads as a valid observation.
    const out = successfulData({
      provider: "okx",
      status: "failed",
      startedAt: 0,
      durationMs: 1,
      timedOut: false,
      rateLimited: false,
      attempts: 1,
    });
    expect(out).toBeUndefined();
    expect(out).not.toEqual({});
    expect(out).not.toBeNull();
  });
});

// ════════════ 8. SINGLE ANALYSIS PATH ════════════

describe("189.8 — first analysis uses the single protected path", () => {
  it("4. the dashboard calls only the protected action", () => {
    expect(DASHBOARD_SRC).toContain("api.protectedAnalysis.runProtectedAnalysis");
    expect(DASHBOARD_SRC).not.toContain("api.entitlements.consumeProfitSignal");
  });

  it("4. no second analysis entry point was introduced", () => {
    expect(DASHBOARD_SRC).not.toMatch(/\brunAnalysis\s*\(/);
  });
});

// ════════════ 9. FIRST-RUN GUIDE ════════════

describe("189.9 — the first-run guide renders real guidance", () => {
  const GUIDE_SRC = read("src/components/FirstRunGuide.tsx");

  beforeEach(() => localStorage.clear());

  const renderGuide = (show: boolean) =>
    render(
      <I18nProvider>
        <FirstRunGuide show={show} />
      </I18nProvider>,
    );

  it("3. a first-run user sees the three required steps", () => {
    const { container } = renderGuide(true);
    expect(container.textContent).toMatch(/choose an instrument/i);
    expect(container.textContent).toMatch(/timeframe/i);
    expect(container.textContent).toMatch(/run the analysis/i);
  });

  it("6. states that Wait and No-Trade are free", () => {
    const { container } = renderGuide(true);
    expect(container.textContent).toMatch(/always free/i);
  });

  it("7. describes LOCKED as withheld, never as converted to WAIT", () => {
    const { container } = renderGuide(true);
    const text = container.textContent ?? "";
    expect(text).toMatch(/locked rather than changed/i);
    expect(text).not.toMatch(/becomes? (a )?wait|shown as wait/i);
  });

  it("7. invents no commercial terms", () => {
    const { container } = renderGuide(true);
    expect(container.textContent ?? "").not.toMatch(
      /[$€£]\s?\d|\bper month\b|\bsubscri(be|ption)\b|\bprice\b|\bcost\b|\bbilling\b/i,
    );
  });

  it("is hidden when there is history to show", () => {
    const { container } = renderGuide(false);
    expect(container.textContent).toBe("");
  });

  it("can be dismissed and stays dismissed", () => {
    renderGuide(true);
    fireEvent.click(screen.getAllByRole("button", { name: /got it/i })[0]);
    expect(screen.queryByTestId("first-run-guide")).toBeNull();
    expect(localStorage.getItem("xstarz:first-run-guide-dismissed")).toBe("1");
  });

  it("the dashboard gates it on RESOLVED-empty, never on loading", () => {
    expect(DASHBOARD_SRC).toContain("!historyLoading && history.length === 0");
  });

  it("renders no market or entitlement data of its own", () => {
    expect(GUIDE_SRC).not.toMatch(/useQuery|useAction|useMutation/);
  });

  it("creates no second analysis path", () => {
    // Strip comments: the docstring legitimately *describes* the protected
    // action while explaining that it does not call it.
    const code = GUIDE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/runProtectedAnalysis|runAnalysis|\bapi\./);
  });

  it("survives blocked localStorage instead of crashing", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => renderGuide(true)).not.toThrow();
    spy.mockRestore();
  });
});

// ════════════ 10. LOCALIZATION ════════════

describe("189.10 — first-run strings exist in all nine locales", () => {
  const LOCALES = ["en", "id", "es", "fr", "pt", "de", "ja", "ko", "zh"];
  /* Phase 270: the 24-key email/OTP block retired out of `auth` entirely —
     11 keys remain, and this list is the parity contract across locales. */
  const AUTH_KEYS = [
    "title", "subtitle", "continueWithGoogle", "googleHelp", "googleFailed",
    "orDivider", "continueAsGuest", "guestHelp", "guestFailed",
    "disclaimer", "restoringSession",
  ];
  const ONBOARDING_KEYS = [
    "welcomeTitle", "welcomeBody", "step1", "step2", "step3",
    "freeOutcomeNote", "chargeableNote", "lockedNote", "dismiss",
  ];

  const blockOf = (src: string, name: string) => {
    const start = src.indexOf(`\n  ${name}: {`);
    return start === -1 ? "" : src.slice(start, src.indexOf("\n  },", start));
  };

  it("17. every locale defines every auth key", () => {
    for (const locale of LOCALES) {
      const block = blockOf(read(`src/lib/i18n/${locale}.ts`), "auth");
      expect(block, `${locale} has no auth block`).not.toBe("");
      for (const key of AUTH_KEYS) {
        expect(block, `${locale} missing auth.${key}`).toContain(`${key}:`);
      }
    }
  });

  it("17. every locale defines every onboarding key", () => {
    for (const locale of LOCALES) {
      const block = blockOf(read(`src/lib/i18n/${locale}.ts`), "onboarding");
      expect(block, `${locale} has no onboarding block`).not.toBe("");
      for (const key of ONBOARDING_KEYS) {
        expect(block, `${locale} missing onboarding.${key}`).toContain(`${key}:`);
      }
    }
  });

  it("17. no locale silently falls back to the English sentence", () => {
    const enBlock = blockOf(read("src/lib/i18n/en.ts"), "auth");
    const enSubtitle = enBlock.match(/subtitle:\s*"([^"]+)"/)?.[1];
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const block = blockOf(read(`src/lib/i18n/${locale}.ts`), "auth");
      const subtitle = block.match(/subtitle:\s*"([^"]+)"/)?.[1];
      expect(subtitle, `${locale} subtitle missing`).toBeTruthy();
      expect(subtitle, `${locale} still English`).not.toBe(enSubtitle);
    }
  });

  it("17. (retired, Phase 270) interpolation keys are gone together, in every locale", () => {
    // The keyed interpolation surfaces ({email}, {minutes}) retired with the
    // OTP step they described. The parity invariant survives as its inverse:
    // every locale drops them identically — no locale may keep a dangling
    // placeholder for a flow that no longer exists.
    for (const locale of LOCALES) {
      const block = blockOf(read(`src/lib/i18n/${locale}.ts`), "auth");
      expect(block, `${locale} still carries checkEmailBody`).not.toContain("checkEmailBody");
      expect(block, `${locale} still carries codeValidity`).not.toContain("codeValidity");
    }
  });

  it("17. no locale carries an OTP lifetime key at all (Phase 270)", () => {
    for (const locale of LOCALES) {
      const block = blockOf(read(`src/lib/i18n/${locale}.ts`), "auth");
      expect(block.match(/codeValidity:/, ) === null, `${locale} still carries an OTP lifetime key`).toBe(true);
    }
  });

  it("17. the product name is preserved untranslated in every locale", () => {
    for (const locale of LOCALES) {
      const block = blockOf(read(`src/lib/i18n/${locale}.ts`), "auth");
      expect(block, `${locale} lost the brand`).toContain("Xstarz Analysis");
    }
  });

  it("17. no locale leaks a provider name into user-facing auth copy", () => {
    // Inspect the string VALUES only: the key `resendHint` legitimately
    // contains the English verb "resend", which is not the vendor Resend.
    for (const locale of LOCALES) {
      const block = blockOf(read(`src/lib/i18n/${locale}.ts`), "auth");
      const values = [...block.matchAll(/:\s*"((?:[^"\\]|\\.)*)"/g)]
        .map((m) => m[1].toLowerCase())
        .join("\n");
      for (const vendor of ["smtp2go", "postmark", "sendgrid", "freebuff", "convex", "resend.com", "resend api"]) {
        expect(values, `${locale} leaks ${vendor}`).not.toContain(vendor);
      }
    }
  });

  it("no hardcoded English remains in the Auth page", () => {
    expect(AUTH_SRC).not.toMatch(
      />\s*(Check your email|Verify code|Continue as Guest|Try again|Use different email)\s*</,
    );
    expect(AUTH_SRC).not.toMatch(/placeholder="name@example\.com"/);
    expect(AUTH_SRC).toContain("t.auth.");
  });
});

// ════════════ 11. ACCESSIBILITY ════════════

describe("189.11 — first-run accessibility", () => {
  it("18. the Google action has an accessible name and visible help text", () => {
    renderAuth();
    const google = screen.getByLabelText(/continue with google/i);
    expect(google.getAttribute("aria-label")).toBeTruthy();
    // The help text sits directly under the control, so the no-OTP flow is
    // unambiguous even without visual context.
    expect(screen.getByText(/no verification code needed/i)).toBeTruthy();
  });

  it("18. the normal entry point is a single control, not a duplicated surface", () => {
    renderAuth();
    expect(screen.getAllByLabelText(/continue with google/i).length).toBe(1);
  });

  it("18. errors use role=alert so they are announced", () => {
    expect(AUTH_SRC).toContain('role="alert"');
  });

  it("18. disabled states are real attributes, not styling", async () => {
    authState.signIn = vi.fn(() => new Promise(() => {}));
    renderAuth();
    const google = screen.getByLabelText(/continue with google/i) as HTMLButtonElement;
    fireEvent.click(google);
    await waitFor(() => expect(google.disabled).toBe(true));
    // The pending Google attempt blocks the guest path too — one in-flight
    // authentication at a time, enforced by attributes not just styling.
    const guest = screen.getByText(/continue as guest/i).closest("button") as HTMLButtonElement;
    expect(guest.disabled).toBe(true);
  });

  it("18. every button declares an explicit type", () => {
    // The OTP form (where a missing type used to risk an accidental submit)
    // is gone, but the rule stays: no button on this page may rely on the
    // HTML default type.
    const buttons = AUTH_SRC.match(/<Button\b[\s\S]{0,250}?>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn).toContain('type="button"');
    }
  });
});

// ════════════ 12. SECURITY / PRIVACY ════════════

describe("189.12 — first-run leaks nothing sensitive", () => {
  it("14. no OTP value, key or token is logged", () => {
    const withoutLiterals = AUTH_SRC.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const consoleCalls = withoutLiterals.match(/console\.[a-z]+\([^;]*\)/gi) ?? [];
    for (const call of consoleCalls) {
      expect(call, `logs a sensitive value: ${call}`).not.toMatch(
        /\botp\b|\bcode\b|\btoken\b|\bemail\b/i,
      );
    }
  });

  it("14. no Convex internal function name is user-visible", () => {
    const en = read("src/lib/i18n/en.ts");
    const start = en.indexOf("\n  auth: {");
    const block = en.slice(start, en.indexOf("\n  },", start));
    expect(block).not.toMatch(/internal\.|api\.|mutation|query/i);
  });

  it("15. no analytics SDK was added for onboarding", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const sdk of ["mixpanel", "amplitude", "segment", "posthog", "@sentry/react"]) {
      expect(deps, `${sdk} must not be added`).not.toContain(sdk);
    }
  });
});
