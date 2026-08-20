import { useState, useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

/**
 * Three-phase auth state machine. There are exactly three stable states,
 * and the phase transitions exactly once during the app lifecycle:
 *
 *   "initializing" → "authenticated"   (session found)
 *   "initializing" → "unauthenticated" (no session)
 *
 * Once the phase leaves "initializing" it never returns to it.
 * This eliminates flicker caused by independent boolean flags
 * resolving at different ticks.
 */
export type AuthPhase = "initializing" | "authenticated" | "unauthenticated";

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();

  const [phase, setPhase] = useState<AuthPhase>("initializing");
  const phaseRef = useRef<AuthPhase>("initializing");

  useEffect(() => {
    // Don't resolve until the Convex auth provider has finished its
    // initial session check AND the user query has loaded (null = no
    // user, object = user found).
    if (isAuthLoading || user === undefined) return;

    // Compute the target phase exactly once.
    const target: AuthPhase = isAuthenticated ? "authenticated" : "unauthenticated";

    // Only set if we haven't already settled — prevents StrictMode
    // double-fire from re-triggering a phase change.
    if (phaseRef.current === "initializing") {
      phaseRef.current = target;
      setPhase(target);
    }
  }, [isAuthLoading, isAuthenticated, user]);

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
