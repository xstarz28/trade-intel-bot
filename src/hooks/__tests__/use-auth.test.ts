import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────

let mockIsAuthLoading = true;
let mockIsAuthenticated = false;
let mockUser: any = undefined;

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isLoading: mockIsAuthLoading,
    isAuthenticated: mockIsAuthenticated,
  }),
  useQuery: () => mockUser,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { users: { currentUser: {} } },
}));

// ── Tests ────────────────────────────────────────────────────────────

describe("useAuth — loading state during session restore", () => {
  beforeEach(() => {
    mockIsAuthLoading = true;
    mockIsAuthenticated = false;
    mockUser = undefined;
  });

  it("isLoading is true while useConvexAuth is loading", async () => {
    const { useAuth } = await import("@/hooks/use-auth");
    const { result, rerender } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    rerender();
  });

  it("isLoading stays true until authInitialized flag fires", async () => {
    const { useAuth } = await import("@/hooks/use-auth");
    const { result, rerender } = renderHook(() => useAuth());

    // Simulate useConvexAuth finishing its check
    act(() => {
      mockIsAuthLoading = false;
      mockIsAuthenticated = true;
    });
    rerender();

    // The useEffect to set authInitialized hasn't committed yet
    // isLoading should still be true
    expect(result.current.isLoading).toBe(true);

    // After useEffect commits (next render cycle)
    act(() => {});
    rerender();

    // Now authInitialized should be true, user is still undefined though
    // isLoading = false || true || false = true (user undefined keeps it true)
    expect(result.current.isLoading).toBe(true);

    // Now provide the user
    act(() => {
      mockUser = { _id: "user1", name: "Test" };
    });
    rerender();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("isLoading stays true while user query is still undefined", async () => {
    const { useAuth } = await import("@/hooks/use-auth");
    const { result, rerender } = renderHook(() => useAuth());

    act(() => {
      mockIsAuthLoading = false;
      mockIsAuthenticated = true;
      // user is still undefined
    });
    rerender();
    act(() => {}); // flush useEffect
    rerender();

    // user===undefined keeps isLoading true
    expect(result.current.isLoading).toBe(true);
  });

  it("isLoading becomes false when all three conditions are met", async () => {
    const { useAuth } = await import("@/hooks/use-auth");
    const { result, rerender } = renderHook(() => useAuth());

    act(() => {
      mockIsAuthLoading = false;
      mockIsAuthenticated = true;
      mockUser = { _id: "user1", name: "Test" };
    });
    rerender();
    act(() => {}); // flush useEffect
    rerender();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ _id: "user1", name: "Test" });
  });

  it("isLoading becomes false for unauthenticated users after init", async () => {
    const { useAuth } = await import("@/hooks/use-auth");
    const { result, rerender } = renderHook(() => useAuth());

    act(() => {
      mockIsAuthLoading = false;
      mockIsAuthenticated = false;
      mockUser = null; // query resolved, no user
    });
    rerender();
    act(() => {}); // flush useEffect
    rerender();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("isLoading stays true during the full reload → restore cycle", async () => {
    const { useAuth } = await import("@/hooks/use-auth");
    const { result, rerender } = renderHook(() => useAuth());

    // Phase 1: initial load (auth loading, no user)
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);

    // Phase 2: auth finishes, user query still loading
    act(() => {
      mockIsAuthLoading = false;
      mockIsAuthenticated = true;
      mockUser = undefined;
    });
    rerender();
    expect(result.current.isLoading).toBe(true);

    // Phase 3: useEffect fires, authInitialized = true
    act(() => {});
    rerender();
    // user===undefined still keeps isLoading true
    expect(result.current.isLoading).toBe(true);

    // Phase 4: user query resolves
    act(() => {
      mockUser = { _id: "u1", name: "Gilfan" };
    });
    rerender();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isAuthenticated).toBe(true);
  });
});
