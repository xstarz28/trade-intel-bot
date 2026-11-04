import { useCallback } from "react";
import {
  createAnonymousBackendSession,
  getBackendGoogleSignInUrl,
} from "@/lib/backend-api";
import { useBackendSession } from "@/hooks/use-backend-session";

export type AuthPhase = "initializing" | "authenticated" | "unauthenticated" | "error";

/**
 * Application authentication is owned by the self-hosted backend.
 *
 * Convex may still be used by legacy data surfaces during the staged data
 * migration, but it is never consulted to determine whether a user is signed
 * in, restore a browser session, create an account, or sign out.
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

  const phase: AuthPhase =
    state.status === "loading" ? "initializing" :
    state.status === "authenticated" ? "authenticated" :
    state.status === "error" ? "error" :
    "unauthenticated";

  return {
    phase,
    isLoading: phase === "initializing",
    isAuthenticated: phase === "authenticated",
    user: state.status === "authenticated" ? state.user : state.status === "loading" ? undefined : null,
    error: state.status === "error" ? state.error : null,
    signIn,
    signOut,
    refresh,
  };
}
