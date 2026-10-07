import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { I18nProvider } from "@/lib/i18n";
import "./index.css";

import Landing from "./pages/Landing.tsx";
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Journal = lazy(() => import("@/components/Journal").then((m) => ({ default: m.Journal })));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Pricing = lazy(() => import("./pages/Pricing.tsx"));

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[XSTARZG] Root crash:", err);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-lg text-center">
          <p className="text-sm font-semibold">XSTARZG could not load this view.</p>
          <p className="mt-2 text-xs text-muted-foreground break-words">{this.state.message}</p>
          {this.state.stack && (
            <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
              {this.state.stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <I18nProvider>
        <ConvexAuthProvider client={convex}>
          <MemoryRouter initialEntries={["/"]}>
            <Suspense fallback={
              <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
                <div className="text-center">
                  <p className="text-sm font-semibold">XSTARZG</p>
                  <p className="mt-2 text-xs text-muted-foreground">Loading analysis surface…</p>
                </div>
              </div>
            }>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<AuthPage redirectAfterAuth="/dashboard" />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
                <Route path="/journal" element={<RequireAuth><Journal /></RequireAuth>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </MemoryRouter>
          <Toaster />
        </ConvexAuthProvider>
      </I18nProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
