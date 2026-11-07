// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBackendSession, logoutBackendSession } from "@/lib/backend-api";
import { useBackendSession } from "./use-backend-session";

vi.mock("@/lib/backend-api", () => ({
  getBackendSession: vi.fn(),
  logoutBackendSession: vi.fn(),
}));

const getSessionMock = vi.mocked(getBackendSession);
const logoutMock = vi.mocked(logoutBackendSession);

afterEach(() => vi.clearAllMocks());

const user = {
  id: "backend-user-1",
  name: "Trader",
  image: null,
  email: "trader@example.com",
  isAnonymous: false,
  role: "user",
};

describe("useBackendSession", () => {
  it("resolves an existing authenticated backend session", async () => {
    getSessionMock.mockResolvedValue({ user });
    const { result } = renderHook(() => useBackendSession());

    await waitFor(() => expect(result.current.state).toEqual({
      status: "authenticated",
      user,
    }));
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it("resolves a missing session as anonymous without creating an account", async () => {
    getSessionMock.mockResolvedValue({ user: null });
    const { result } = renderHook(() => useBackendSession());

    await waitFor(() => expect(result.current.state).toEqual({ status: "anonymous" }));
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it("surfaces session lookup failures without falling back to mock or Convex", async () => {
    getSessionMock.mockRejectedValue(new Error("backend unavailable"));
    const { result } = renderHook(() => useBackendSession());

    await waitFor(() => expect(result.current.state).toMatchObject({
      status: "error",
      error: new Error("backend unavailable"),
    }));
  });

  it("clears local backend auth state after a successful logout", async () => {
    getSessionMock.mockResolvedValue({ user });
    logoutMock.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useBackendSession());

    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    await act(async () => {
      await result.current.logout();
    });
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: "anonymous" });
  });

  it("allows an explicit session refresh", async () => {
    getSessionMock
      .mockResolvedValueOnce({ user: null })
      .mockResolvedValueOnce({ user });
    const { result } = renderHook(() => useBackendSession());

    await waitFor(() => expect(result.current.state.status).toBe("anonymous"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state).toEqual({ status: "authenticated", user });
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });
});
