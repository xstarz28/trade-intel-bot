import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { type ReactNode, useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  // Block any redirect until after the first mount + effect cycle.
  // This prevents the component from rendering a Navigate before
  // Convex's auth token has had a chance to restore from storage.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground font-mono">
            {!mounted ? "initializing..." : "restoring session..."}
          </p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
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
