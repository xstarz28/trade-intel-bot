import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";
import logo from "@/assets/logo.svg";
import { ArrowRight, Loader2, Mail, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { resolveSafeRedirect } from "@/lib/routing/safe-redirect";
import { reportAuthDiagnostic } from "@/lib/auth/safe-diagnostics";

/**
 * Phase 189 — kept in sync with `OTP_EXPIRY_MINUTES` in
 * `src/convex/auth/emailOtp.ts`. Stating a lifetime the backend does not
 * honour would be worse than stating none, so a test asserts these agree.
 */
const OTP_VALIDITY_MINUTES = 10;

interface AuthProps {
  redirectAfterAuth?: string;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const { t, txi } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // `returnTo` is attacker-controllable; resolveSafeRedirect refuses anything
  // that could leave this origin. See src/lib/routing/safe-redirect.ts.
  const redirect = resolveSafeRedirect(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);
  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch {
      // The error VALUE is deliberately not captured or logged: a provider
      // rejection can embed request details, vendor identity or credentials.
      reportAuthDiagnostic("email-code-send-failed");
      setError(t.auth.sendFailed);
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      // Do NOT navigate here — the useEffect above handles redirect
      // once isAuthenticated is true. Navigating before Convex auth
      // fully resolves causes the double-login loop.
    } catch {
      // Never log the rejection: it can echo back the submitted code.
      reportAuthDiagnostic("otp-verification-failed");
      setError(t.auth.codeIncorrect);
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
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
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">

      
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">
        <Card className="min-w-[350px] pb-0 border shadow-md">
          {step === "signIn" ? (
            <>
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
              <form onSubmit={handleEmailSubmit}>
                <CardContent>
                  
                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="auth-email"
                        name="email"
                        aria-label={t.auth.emailLabel}
                        aria-describedby="auth-email-help"
                        placeholder={t.auth.emailPlaceholder}
                        type="email"
                        className="pl-9"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      size="icon"
                      aria-label={t.auth.continueWithEmail}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p
                    id="auth-email-help"
                    className="mt-2 text-[11px] text-muted-foreground"
                  >
                    {t.auth.emailHelp}
                  </p>
                  {error && (
                    <p role="alert" className="mt-2 text-sm text-red-500">
                      {error}
                    </p>
                  )}
                  
                  <div className="mt-4">
                    <div className="relative">
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
                      disabled={isLoading}
                    >
                      <UserX className="mr-2 h-4 w-4" />
                      {t.auth.continueAsGuest}
                    </Button>
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">
                      {t.auth.guestHelp}
                    </p>
                  </div>
                </CardContent>
              </form>
            </>
          ) : (
            <>
              <CardHeader className="text-center mt-4">
                <CardTitle>{t.auth.checkEmailTitle}</CardTitle>
                <CardDescription>
                  {txi("auth.checkEmailBody", { email: step.email })}
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleOtpSubmit}>
                <CardContent className="pb-4">
                  <input type="hidden" name="email" value={step.email} />
                  <input type="hidden" name="code" value={otp} />

                  <div className="flex justify-center">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      aria-label={t.auth.otpLabel}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                          // Find the closest form and submit it
                          const form = (e.target as HTMLElement).closest("form");
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {error && (
                    <p
                      role="alert"
                      className="mt-2 text-sm text-red-500 text-center"
                    >
                      {error}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground text-center mt-3">
                    {txi("auth.codeValidity", { minutes: OTP_VALIDITY_MINUTES })}
                  </p>
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    {t.auth.noCodeQuestion}{" "}
                    <Button
                      type="button"
                      variant="link"
                      className="p-0 h-auto"
                      onClick={() => setStep("signIn")}
                    >
                      {t.auth.tryAgain}
                    </Button>
                  </p>
                  {/* Phase 189 — sets the expectation created by the Phase 187
                      resend cooldown, so the wait does not read as a failure. */}
                  <p className="text-[11px] text-muted-foreground/80 text-center mt-1">
                    {t.auth.resendHint}
                  </p>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || otp.length !== 6}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t.auth.verifying}
                      </>
                    ) : (
                      <>
                        {t.auth.verifyCode}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep("signIn")}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {t.auth.useDifferentEmail}
                  </Button>
                  <p className="text-[11px] text-muted-foreground/80 text-center">
                    {t.auth.sessionNote}
                  </p>
                </CardFooter>
              </form>
            </>
          )}

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
