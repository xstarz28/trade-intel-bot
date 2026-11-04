import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { Button } from "@/components/ui/button";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { phase, refresh, error } = useAuth();
  const location = useLocation();

  if (phase === "initializing") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground font-mono">restoring backend session...</p>
        </div>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <p className="text-sm font-semibold">Authentication service is temporarily unavailable.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account has not been signed out. The self-hosted session could not be checked.
          </p>
          {error && <p className="mt-2 text-xs text-muted-foreground">{error.message}</p>}
          <Button className="mt-4" onClick={() => void refresh()}>Retry session check</Button>
        </div>
      </main>
    );
  }

  if (phase === "unauthenticated") {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return children;
}
