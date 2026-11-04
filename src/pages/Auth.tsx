import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { resolveAuthRedirect } from "@/lib/auth-redirect";

export default function AuthPage({ redirectAfterAuth="/dashboard" }: { redirectAfterAuth?: string }) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = resolveAuthRedirect(params.get("returnTo"), redirectAfterAuth);
  const authError = params.get("error");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    switch (params.get("error")) {
      case "account_link_conflict":
        return "Google account ini sudah terhubung ke akun Trade Intel lain. Akun tamu dan datanya tetap aman; masuklah dengan akun Google yang sebelumnya digunakan.";
      case "google_state_invalid":
        return "Sesi keamanan Google sudah kedaluwarsa atau tidak valid. Silakan mulai login kembali.";
      case "google_auth_not_configured":
        return "Login Google belum dikonfigurasi pada server. Gunakan akses tamu sementara.";
      case "google_auth_failed":
        return "Login Google gagal diverifikasi. Silakan coba kembali.";
      default:
        return null;
    }
  });

  useEffect(() => {
    if (!authLoading && isAuthenticated && !authError) navigate(redirect, { replace: true });
  }, [authLoading, isAuthenticated, navigate, redirect, authError]);

  const run = async (provider: string) => {
    setLoading(true); setError(null);
    try {
      await signIn(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      // Some auth-action paths can resolve without a full-page navigation.
      // Always release the button lock so a transient callback failure is retryable.
      setLoading(false);
    }
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