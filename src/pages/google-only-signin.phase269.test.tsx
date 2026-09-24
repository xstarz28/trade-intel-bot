/**
 * Phase 269 — Google Sign-In as the only normal login path.
 *
 * Pins the Phase 269 contract end to end:
 *
 *   1. Google is the single normal visible login action.
 *   2. Google login never opens an OTP step.
 *   3. A successful Google authentication reaches the authenticated app
 *      directly (redirect only after the session resolves, no intermediate
 *      credential surface).
 *   4. A failed Google authentication never falls back to email OTP.
 *   5. Exactly one authentication surface exists (one /auth route, one
 *      mount, no modal/overlay twin).
 *   6. Duplicate activation cannot launch duplicate auth attempts.
 *   7. Logout leaves the single Google entry point as the only way back in.
 *
 * These tests render the real Auth page with the Convex boundary mocked —
 * the same harness pattern as `first-run.phase189.test.tsx`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const AUTH_SRC = read("src/pages/Auth.tsx");

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

function authTree(search = "") {
  return (
    <MemoryRouter initialEntries={[`/auth${search}`]}>
      <I18nProvider>
        <AuthPage />
      </I18nProvider>
    </MemoryRouter>
  );
}

function renderAuth(search = "") {
  return render(authTree(search));
}

/** Project sources, excluding generated code and test files. */
function walkSources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith("_") || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSources(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !name.includes(".test.")) acc.push(p);
  }
  return acc;
}

beforeEach(() => {
  authState.isLoading = false;
  authState.isAuthenticated = false;
  authState.signIn = vi.fn().mockResolvedValue(undefined);
  navigateSpy.mockClear();
});

/* ------------------------------------------------------------------ */

describe("269.1 — Google is the single normal login entry", () => {
  it("renders exactly one Google action and zero credential inputs", () => {
    const { container } = renderAuth();
    expect(screen.getAllByLabelText(/continue with google/i).length).toBe(1);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.queryByLabelText(/verification code/i)).toBeNull();
    expect(
      container.querySelectorAll(
        'input[type="email"], input[name="email"], input[name="code"]',
      ).length,
    ).toBe(0);
  });

  it("the Auth page source carries no email-OTP wiring at all", () => {
    expect(AUTH_SRC).not.toContain("email-otp");
    expect(AUTH_SRC).not.toContain("InputOTP");
    expect(AUTH_SRC).not.toContain("handleEmailSubmit");
    expect(AUTH_SRC).not.toContain("handleOtpSubmit");
    expect(AUTH_SRC).not.toContain("setStep");
    expect(AUTH_SRC).not.toContain("OTP_VALIDITY_MINUTES");
  });

  it("the only providers the UI can invoke are google and anonymous", () => {
    // No order/repetition assumptions — just that email-otp can never be
    // requested from this surface, and the preserved guest path stays
    // available.
    const providers = [
      ...new Set([...AUTH_SRC.matchAll(/signIn\("([\w-]+)"/g)].map((m) => m[1])),
    ].sort();
    expect(providers).toEqual(["anonymous", "google"]);
  });
});

describe("269.2 — Google login does not open OTP", () => {
  it("clicking Google invokes the google provider, never email-otp", async () => {
    renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    await waitFor(() => expect(authState.signIn).toHaveBeenCalledTimes(1));
    expect(authState.signIn).toHaveBeenCalledWith("google", expect.anything());
    for (const call of authState.signIn.mock.calls) {
      expect(call[0]).not.toBe("email-otp");
    }
  });

  it("a complete Google attempt never renders a code prompt", async () => {
    renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    await waitFor(() => expect(authState.signIn).toHaveBeenCalled());
    expect(screen.queryByText(/check your email/i)).toBeNull();
    expect(screen.queryByLabelText(/verification code/i)).toBeNull();
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });
});

describe("269.3 — successful Google auth reaches the app directly", () => {
  it("routes straight to the destination when the session resolves — no intermediate step", async () => {
    const utils = renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    await waitFor(() => expect(authState.signIn).toHaveBeenCalled());
    // No redirect before the server confirms the session.
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/check your email/i)).toBeNull();

    // The session has now resolved as authenticated: the effect routes
    // directly to the post-auth destination, never to a code step.
    authState.isAuthenticated = true;
    utils.rerender(authTree());
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/dashboard"));
  });

  it("the Google handler itself never navigates inline", () => {
    const handler = AUTH_SRC.slice(
      AUTH_SRC.indexOf("const handleGoogleLogin"),
      AUTH_SRC.indexOf("return ("),
    );
    expect(handler).not.toMatch(/navigate\(/);
    expect(handler).not.toContain("setStep");
  });

  it("the post-auth redirect target is passed into the OAuth launch", () => {
    expect(AUTH_SRC).toContain('signIn("google", { redirectTo: redirect })');
    expect(AUTH_SRC).toContain("resolveSafeRedirect");
  });
});

describe("269.4 — Google failure does not fall back to OTP", () => {
  it("a rejected Google sign-in shows a fixed error and no fallback credential UI", async () => {
    authState.signIn = vi.fn().mockRejectedValue(new Error("provider exploded"));
    const { container } = renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not sign in with google/i);
    expect(container.textContent).not.toMatch(/check your email/i);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.queryByLabelText(/verification code/i)).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("the failure path resets so Google can simply be retried", async () => {
    authState.signIn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    renderAuth();
    const google = screen.getByLabelText(/continue with google/i);
    fireEvent.click(google);
    await screen.findByRole("alert");
    fireEvent.click(google);
    await waitFor(() => expect(authState.signIn).toHaveBeenCalledTimes(2));
    for (const call of authState.signIn.mock.calls) {
      expect(call[0]).toBe("google");
    }
  });
});

describe("269.5 — only one authentication surface is mounted", () => {
  it("AuthPage is mounted at exactly one route and nowhere else", () => {
    const main = read("src/main.tsx");
    expect(main.match(/<AuthPage[\s/>]/g)?.length).toBe(1);
    expect(main.match(/path="\/auth"/g)?.length).toBe(1);
    for (const file of walkSources("src")) {
      if (file.endsWith(join("main.tsx")) || file.endsWith(join("pages", "Auth.tsx"))) {
        continue;
      }
      expect(read(file), `${file} must not mount the auth page`).not.toContain("AuthPage");
    }
  });

  it("the only destination for an unauthenticated user is the /auth page — no modal", () => {
    const requireAuth = read("src/components/RequireAuth.tsx");
    expect(requireAuth).toContain("/auth?returnTo=");
    expect(requireAuth).not.toMatch(/Modal|Dialog/);
  });

  it("no auth modal, overlay or second sign-in surface exists anywhere", () => {
    for (const file of walkSources("src")) {
      const src = read(file);
      expect(src, `${file} opens an auth modal`).not.toMatch(
        /AuthModal|SignInModal|AuthDialog|AuthOverlay|LoginModal/,
      );
    }
  });

  it("no page or component still mounts the OTP input", () => {
    for (const file of walkSources("src")) {
      // The OTP input component stays in the ui kit; nothing mounts it.
      if (file.includes(join("components", "ui"))) continue;
      expect(read(file), `${file} still mounts InputOTP`).not.toContain("InputOTP");
    }
  });
});

describe("269.6 — duplicate activation cannot launch duplicate auth attempts", () => {
  it("double activation launches exactly one OAuth attempt", () => {
    authState.signIn = vi.fn(() => new Promise(() => {}));
    renderAuth();
    const google = screen.getByLabelText(/continue with google/i);
    fireEvent.click(google);
    fireEvent.click(google);
    expect(authState.signIn).toHaveBeenCalledTimes(1);
    // The re-entry latch is a synchronous ref, not React state, so it holds
    // even within a single frame before the disabled attribute applies.
    expect(AUTH_SRC).toContain("googleInFlight");
  });

  it("guest activation cannot double-fire anonymous sign-in", () => {
    authState.signIn = vi.fn(() => new Promise(() => {}));
    renderAuth();
    const guest = screen.getByText(/continue as guest/i).closest("button")!;
    fireEvent.click(guest);
    fireEvent.click(guest);
    expect(authState.signIn).toHaveBeenCalledTimes(1);
    expect(AUTH_SRC).toContain("guestInFlight");
  });

  it("a second authentication surface cannot mount while one is in flight", () => {
    authState.signIn = vi.fn(() => new Promise(() => {}));
    renderAuth();
    fireEvent.click(screen.getByLabelText(/continue with google/i));
    expect(screen.getAllByLabelText(/continue with google/i).length).toBe(1);
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });
});

describe("269.7 — logout returns to the single Google login entry point", () => {
  it("the signed-out surface is exactly the Google entry — and nothing else", () => {
    // Signed-out is the state the user is in after signOut resolves.
    authState.isAuthenticated = false;
    const { container } = renderAuth();
    expect(screen.getAllByLabelText(/continue with google/i).length).toBe(1);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(container.textContent).not.toMatch(/check your email/i);
  });

  it("sign-out clears the session and /auth is the only way back in", () => {
    const dropdown = read("src/components/LogoDropdown.tsx");
    expect(dropdown).toContain("signOut");
    const requireAuth = read("src/components/RequireAuth.tsx");
    expect(requireAuth).toContain("unauthenticated");
    expect(requireAuth).toContain("/auth");
  });

  it("an expired session hits RequireAuth, which lands on the same single surface", () => {
    // RequireAuth's only unauthenticated destination is /auth (asserted
    // above); rendering /auth signed-out shows the Google entry (asserted
    // above). This test pins the chain in one place: the deep-link returnTo
    // still resolves after a Google sign-in, with no code step on the way.
    authState.isAuthenticated = true;
    renderAuth("?returnTo=%2Fjournal");
    expect(navigateSpy).toHaveBeenCalledWith("/journal");
  });
});
