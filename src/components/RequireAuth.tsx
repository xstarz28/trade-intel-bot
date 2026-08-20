import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

/**
 * Blocks the children until the auth phase is definitively resolved.
 *
 * While phase === "initializing" → renders a stable loading screen
 * (no white flash, no intermediate redirect).
 * Once phase is "authenticated"   → renders children.
 * Once phase is "unauthenticated" → redirects to /auth.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { phase } = useAuth();
  const location = useLocation();

  if (phase === "initializing") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground font-mono">
            restoring session...
          </p>
        </div>
      </main>
    );
  }

  if (phase === "unauthenticated") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return children;
}
