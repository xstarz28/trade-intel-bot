/**
 * @vitest-environment jsdom
 *
 * Application auth is intentionally independent from Convex. These tests
 * exercise the adapter over the self-hosted backend session hook.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const mockRefresh = vi.fn();
const mockLogout = vi.fn();
const mockCreateAnonymous = vi.fn();
const mockGoogleUrl = vi.fn(() => "https://api.example.test/api/v1/auth/google");
const mockAssign = vi.fn();

let backendState:
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: { id: string; name: string; email: string | null; isAnonymous: boolean; role: string } }
  | { status: "error"; error: Error };

vi.mock("@/hooks/use-backend-session", () => ({
  useBackendSession: () => ({
    state: backendState,
    refresh: mockRefresh,
    logout: mockLogout,
  }),
}));

vi.mock("@/lib/backend-api", () => ({
  createAnonymousBackendSession: mockCreateAnonymous,
  getBackendGoogleSignInUrl: mockGoogleUrl,
}));

import { useAuth } from "../use-auth";

describe("useAuth — self-hosted backend authority", () => {
  beforeEach(() => {
    backendState = { status: "loading" };
    vi.clearAllMocks();
  });

  it("remains initializing while the backend session is being restored", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe("initializing");
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("uses the backend session as the authenticated identity", () => {
    backendState = {
      status: "authenticated",
      user: { id: "account-1", name: "Trader", email: "trader@example.test", isAnonymous: false, role: "user" },
    };
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe("authenticated");
    expect(result.current.user?.id).toBe("account-1");
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("treats an absent backend session as signed out", () => {
    backendState = { status: "anonymous" };
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });

  it("does not silently convert a backend outage into a signed-out session", () => {
    backendState = { status: "error", error: new Error("backend unavailable") };
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe("error");
    expect(result.current.error?.message).toBe("backend unavailable");
  });

  it("starts Google OAuth through the self-hosted backend", async () => {
    const { result } = renderHook(() => useAuth());
    vi.stubGlobal("window", { location: { assign: mockAssign } });
    try {
      await act(async () => result.current.signIn("google"));
      expect(mockGoogleUrl).toHaveBeenCalledOnce();
      expect(mockAssign).toHaveBeenCalledWith("https://api.example.test/api/v1/auth/google");
      expect(mockCreateAnonymous).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates a real backend guest account and restores its session", async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => result.current.signIn("anonymous"));
    expect(mockCreateAnonymous).toHaveBeenCalledOnce();
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("logs out through the self-hosted backend", async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => result.current.signOut());
    expect(mockLogout).toHaveBeenCalledOnce();
  });
});
