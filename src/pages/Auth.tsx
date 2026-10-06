import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/hooks/use-auth";

function resolveRedirect(returnTo: string | null, fallback="/dashboard") {
  return returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : fallback;
}

export default function AuthPage({ redirectAfterAuth="/dashboard" }: { redirectAfterAuth?: string }) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = resolveRedirect(params.get("returnTo"), redirectAfterAuth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate(redirect);
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const run = async (provider: string) => {
    setLoading(true); setError(null);
    try { await signIn(provider); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign in failed"); setLoading(false); }
  };

  return <div className="min-h-screen bg-background panel-grid flex items-center justify-center px-5">
    <Card className="metal-panel w-full max-w-md">
      <CardHeader className="text-center">
        <button onClick={() => navigate("/")} className="mx-auto mb-3 rounded-lg p-1 ring-1 ring-border/60" aria-label="XSTARZG home">
          <img src="/logo.svg" alt="XSTARZG" className="h-14 w-14" />
        </button>
        <CardTitle>XSTARZG Access</CardTitle>
        <CardDescription>Sign in with Google or continue without an account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" disabled={loading} onClick={() => run("google")}>
          {loading ? <Loader2 className="mr-2 size-4 animate-spin"/> : null} Continue with Google
        </Button>
        <Button variant="outline" className="w-full" disabled={loading} onClick={() => run("anonymous")}>
          <UserRound className="mr-2 size-4"/> Continue without an account
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  </div>;
}