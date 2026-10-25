import { useState, useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

/**
 * Three-phase auth state machine. There are exactly three stable states,
 * and the phase follows Convex's auth state after initial resolution:
 *
 *   "initializing" → "authenticated"   (session found)
 *   "initializing" → "unauthenticated" (no session)
 *
 * The phase never returns to "initializing" after the initial session check.
 * Interactive sign-in and sign-out are allowed to update the settled phase.
 *
 * Phase resolution is based solely on Convex's auth token state
 * (useConvexAuth). The user query is fetched separately and does
 * NOT gate phase transitions — waiting for it caused the double-login
 * loop because the query arrives after the token is already valid.
 */
export type AuthPhase = "initializing" | "authenticated" | "unauthenticated";

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();

  const [phase, setPhase] = useState<AuthPhase>("initializing");
  const phaseRef = useRef<AuthPhase>("initializing");

  useEffect(() => {
    // Wait until Convex has completed the current token/session check.
    if (isAuthLoading) return;

    if (isAuthenticated) {
      if (phaseRef.current !== "authenticated") {
        phaseRef.current = "authenticated";
        setPhase("authenticated");
      }
      return;
    }

    // OAuth callback/session restoration can briefly report unauthenticated
    // before the new token is visible. Delay ALL signed-out transitions,
    // including initial resolution, so RequireAuth cannot redirect away from
    // a callback in flight. A valid token cancels this timeout immediately.
    if (phaseRef.current === "unauthenticated") return;

    const timeout = setTimeout(() => {
      phaseRef.current = "unauthenticated";
      setPhase("unauthenticated");
    }, 5000);

    return () => clearTimeout(timeout);
  }, [isAuthLoading, isAuthenticated]);

  const isLoading = phase === "initializing";

  return {
    /** The strict three-phase state. */
    phase,
    /** True only while phase is "initializing". */
    isLoading,
    /** Derived from phase — true in "authenticated" state. */
    isAuthenticated: phase === "authenticated",
    /** The current user document (or null). */
    user: phase === "initializing" ? undefined : user ?? null,
    signIn,
    signOut,
  };
}
