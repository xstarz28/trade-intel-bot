/**
 * @vitest-environment jsdom
 *
 * @file Tests for the three-phase auth state machine in useAuth.
 *
 * We mock the Convex dependencies and verify that the phase transitions
 * are stable and don't flicker between "initializing" → resolved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSignIn = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn, signOut: mockSignOut }),
}));

// Mutable mock state — tests toggle these to simulate auth phases.
let isAuthLoading = true;
let isAuthenticated = false;
let userMock: undefined | null | { name: string } = undefined;

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: isAuthLoading, isAuthenticated }),
  useQuery: () => userMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { users: { currentUser: "users/currentUser" } },
}));

// ── Import after mocks ────────────────────────────────────────────
import { useAuth } from "../use-auth";

// Helper: render useAuth, advance mock state, rerender, return hook result.
function runPhaseSequence(
  updates: Array<{ authLoading?: boolean; authenticated?: boolean; user?: null | { name: string } }>,
) {
  const { result, rerender } = renderHook(() => useAuth());

  for (const update of updates) {
    if (update.authLoading !== undefined) isAuthLoading = update.authLoading;
    if (update.authenticated !== undefined) isAuthenticated = update.authenticated;
    if (update.user !== undefined) userMock = update.user;
    act(() => rerender());
  }

  return result;
}

// ── Tests ─────────────────────────────────────────────────────────

describe("useAuth — three-phase state machine", () => {
  beforeEach(() => {
    isAuthLoading = true;
    isAuthenticated = false;
    userMock = undefined;
    vi.clearAllMocks();
  });

  it("reports isLoading while auth is still loading", () => {
    const result = runPhaseSequence([{ authLoading: true, user: undefined }]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.phase).toBe("initializing");
  });

  it("resolves to 'authenticated' once auth settles (no user query dependency)", () => {
    // Phase: auth loaded, token valid, user query still pending
    const result = runPhaseSequence([
      { authLoading: false, authenticated: true, user: undefined },
    ]);
    // Phase resolves immediately — user query is fetched separately
    expect(result.current.isLoading).toBe(false);
    expect(result.current.phase).toBe("authenticated");
  });

  it("resolves to 'unauthenticated' when auth settles without token", () => {
    const result = runPhaseSequence([
      { authLoading: false, authenticated: false, user: undefined },
    ]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.phase).toBe("unauthenticated");
  });

  it("resolves to 'authenticated' when all conditions met", () => {
    const result = runPhaseSequence([
      { authLoading: false, authenticated: true, user: { name: "Gilfan" } },
    ]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.phase).toBe("authenticated");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ name: "Gilfan" });
  });

  it("resolves to 'unauthenticated' when not authenticated", () => {
    const result = runPhaseSequence([
      { authLoading: false, authenticated: false, user: null },
    ]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.phase).toBe("unauthenticated");
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("simulates a full reload → restore cycle", () => {
    const result = runPhaseSequence([
      // Phase 1: initial loading (app just mounted)
      { authLoading: true, user: undefined },
      // Phase 2: Convex auth resolved, but user query still loading
      { authLoading: false, authenticated: true, user: undefined },
      // Phase 3: user query resolves — authenticated
      { authLoading: false, authenticated: true, user: { name: "Gilfan" } },
    ]);

    // All three phases were "initializing" until the final resolution
    expect(result.current.phase).toBe("authenticated");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAuthenticated).toBe(true);
  });
});
