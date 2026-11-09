import { useCallback } from "react";
import {
  createAnonymousBackendSession,
  getBackendGoogleSignInUrl,
  type BackendUser,
} from "@/lib/backend-api";
import { useBackendSession } from "@/hooks/use-backend-session";

export type AuthPhase = "initializing" | "authenticated" | "unauthenticated" | "error";

/**
 * Application authentication is owned by the self-hosted backend.
 *
 * Convex is not consulted by application authentication. The optional legacy
 * account-export panel is isolated from this hook and can be unavailable
 * without affecting login, session restoration, or account creation.
 */
export function useAuth() {
  const { state, refresh, logout } = useBackendSession();

  const signIn = useCallback(async (provider: string) => {
    if (provider === "google") {
      window.location.assign(getBackendGoogleSignInUrl());
      return;
    }

    if (provider === "anonymous") {
      await createAnonymousBackendSession();
      await refresh();
      return;
    }

    throw new Error("Unsupported sign-in provider.");
  }, [refresh]);

  const signOut = useCallback(async () => {
    await logout();
  }, [logout]);

  let phase: AuthPhase;
  let user: BackendUser | null | undefined;
  if (state.status === "loading") {
    phase = "initializing";
    user = undefined;
  } else if (state.status === "authenticated") {
    phase = "authenticated";
    user = state.user;
  } else if (state.status === "error") {
    phase = "error";
    user = null;
  } else {
    phase = "unauthenticated";
    user = null;
  }

  return {
    phase,
    isLoading: phase === "initializing",
    isAuthenticated: phase === "authenticated",
    user,
    error: state.status === "error" ? state.error : null,
    signIn,
    signOut,
    refresh,
  };
}
