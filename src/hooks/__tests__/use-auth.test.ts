/**
 * @vitest-environment jsdom
 *
 * Application auth is intentionally independent from Convex. These tests
 * exercise the adapter over the self-hosted backend session hook.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type BackendState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: { id: string; name: string; email: string | null; isAnonymous: boolean; role: string } }
  | { status: "error"; error: Error };

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  logout: vi.fn(),
  createAnonymous: vi.fn(),
  googleUrl: vi.fn(() => "https://api.example.test/api/v1/auth/google"),
  assign: vi.fn(),
  backendState: { current: { status: "loading" } as BackendState },
}));

vi.mock("@/hooks/use-backend-session", () => ({
  useBackendSession: () => ({
    state: mocks.backendState.current,
    refresh: mocks.refresh,
    logout: mocks.logout,
  }),
}));

vi.mock("@/lib/backend-api", () => ({
  createAnonymousBackendSession: mocks.createAnonymous,
  getBackendGoogleSignInUrl: mocks.googleUrl,
}));

import { useAuth } from "../use-auth";

describe("useAuth — self-hosted backend authority", () => {
  beforeEach(() => {
    mocks.backendState.current = { status: "loading" };
    vi.clearAllMocks();
  });

  it("remains initializing while the backend session is being restored", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe("initializing");
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("uses the backend session as the authenticated identity", () => {
    mocks.backendState.current = {
      status: "authenticated",
      user: { id: "account-1", name: "Trader", email: "trader@example.test", isAnonymous: false, role: "user" },
    };
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe("authenticated");
    expect(result.current.user?.id).toBe("account-1");
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("treats an absent backend session as signed out", () => {
    mocks.backendState.current = { status: "anonymous" };
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });

  it("does not silently convert a backend outage into a signed-out session", () => {
    mocks.backendState.current = { status: "error", error: new Error("backend unavailable") };
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe("error");
    expect(result.current.error?.message).toBe("backend unavailable");
  });

  it("starts Google OAuth through the self-hosted backend", async () => {
    const { result } = renderHook(() => useAuth());
    vi.stubGlobal("window", { location: { assign: mocks.assign } });
    try {
      await act(async () => result.current.signIn("google"));
      expect(mocks.googleUrl).toHaveBeenCalledOnce();
      expect(mocks.assign).toHaveBeenCalledWith("https://api.example.test/api/v1/auth/google");
      expect(mocks.createAnonymous).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates a real backend guest account and restores its session", async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => result.current.signIn("anonymous"));
    expect(mocks.createAnonymous).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("logs out through the self-hosted backend", async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => result.current.signOut());
    expect(mocks.logout).toHaveBeenCalledOnce();
  });
});
