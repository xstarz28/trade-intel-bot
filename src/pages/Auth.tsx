import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";
import logo from "@/assets/logo.svg";
import { Loader2, UserX } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { resolveSafeRedirect } from "@/lib/routing/safe-redirect";
import { reportAuthDiagnostic } from "@/lib/auth/safe-diagnostics";

/**
 * Phase 269 — Google Sign-In is the only normal login path.
 *
 * The email-entry + OTP step was removed from the visible authentication
 * flow. The normal way in is “Continue with Google” (OIDC with PKCE + state,
 * provider configured in `src/convex/auth.ts`); a successful Google
 * authentication lands directly in the authenticated app with no
 * verification-code step in between, and a failure never opens a fallback
 * credential form.
 *
 * Deliberately NOT changed here:
 * - the backend provider list and OIDC hardening (`src/convex/auth.ts`)
 * - the anonymous guest session path, which is not a credential login.
 *
 * Phase 270 — the OTP email provider and its delivery infrastructure
 * (`src/convex/auth/emailOtp.ts`, `src/convex/lib/emailDelivery.ts`,
 * `src/convex/lib/emailTemplates.ts`) were RETIRED and removed backend-side.
 * OTP email is no longer an available sign-in method anywhere in the stack;
 * there is no email-entry surface to reintroduce here, and none may return.
 * The durable OTP anti-abuse tables/limiter stay in place and frozen for
 * data safety; a NEW signIn call naming that retired provider has no
 * registered provider and fails closed. A former OTP email account's identity
 * record persists and a real human returning with the same Google email links
 * to the SAME userId (Phase 246 account linking).
 */

interface AuthProps {
  redirectAfterAuth?: string;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // `returnTo` is attacker-controllable; resolveSafeRedirect refuses anything
  // that could leave this origin. See src/lib/routing/safe-redirect.ts.
  const redirect = resolveSafeRedirect(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hard in-flight latches. React state does not apply until the next render,
  // so two activations within one frame could otherwise launch the OAuth
  // redirect (or the guest sign-in) twice. The ref blocks re-entry
  // synchronously, which keeps exactly one authentication attempt alive.
  const googleInFlight = useRef(false);
  const guestInFlight = useRef(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleGoogleLogin = async () => {
    // One surface, one attempt: re-entry is ignored while an OAuth launch is
    // in progress. The latch is released only on failure — on success the
    // browser navigates away through the OIDC flow, so re-enabling the button
    // would just invite a second redirect while the first is being committed.
    if (googleInFlight.current || authLoading) return;
    googleInFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      // Convex Auth OAuth: signIn("google") returns {redirect} and triggers
      // window.location.href via the AuthProvider. No OTP step after this —
      // on return, the effect above routes the authenticated session
      // straight to its destination.
      await signIn("google", { redirectTo: redirect });
    } catch {
      // The error VALUE is deliberately not captured or logged: a provider
      // rejection can embed request details, vendor identity or credentials.
      // A failed Google attempt must NOT open any fallback credential form —
      // the user retries Google or leaves.
      reportAuthDiagnostic("google-signin-failed");
      googleInFlight.current = false;
      setError(t.auth.googleFailed);
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    if (guestInFlight.current) return;
    guestInFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      // Do NOT navigate here — the useEffect above handles redirect
      // once isAuthenticated is true.
    } catch {
      // Fixed category only — see src/lib/auth/safe-diagnostics.ts.
      reportAuthDiagnostic("guest-session-failed");
      setError(t.auth.guestFailed);
    } finally {
      guestInFlight.current = false;
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">
        <Card className="min-w-[350px] pb-0 border shadow-md">
          <CardHeader className="text-center">
            <div className="flex justify-center">
              <button
                type="button"
                aria-label={t.auth.title}
                className="flex size-12 items-center justify-center overflow-hidden rounded-xl bg-primary/15"
                onClick={() => navigate("/")}
              >
                <img
                  src={logo}
                  alt=""
                  className="size-12 rounded-xl object-cover"
                />
              </button>
            </div>
            <CardTitle className="text-lg font-mono">{t.auth.title}</CardTitle>
            <CardDescription className="font-mono text-xs">
              {t.auth.subtitle}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* The single normal login action. Google OIDC/PKCE per
                Phase 246; Phase 269 made it the only visible credential
                path, so there is no step state to branch on and no way to
                surface a one-time-code form. */}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleLogin}
              disabled={isLoading || authLoading}
              aria-label={t.auth.continueWithGoogle}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              <span className="ml-2">{t.auth.continueWithGoogle}</span>
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {t.auth.googleHelp}
            </p>

            {error && (
              <p role="alert" className="mt-3 text-sm text-red-500 text-center">
                {error}
              </p>
            )}

            <div className="relative mt-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  {t.auth.orDivider}
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full mt-4"
              onClick={handleGuestLogin}
              disabled={isLoading || authLoading}
            >
              <UserX className="mr-2 h-4 w-4" />
              {t.auth.continueAsGuest}
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {t.auth.guestHelp}
            </p>
          </CardContent>

          <div className="py-4 px-6 text-[11px] font-mono text-center text-muted-foreground bg-muted border-t rounded-b-lg">
            {t.auth.disclaimer}
          </div>
        </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
