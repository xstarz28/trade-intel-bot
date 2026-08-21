// ─── Iframe hard-navigation lock ───────────────────────────────────────────
// @convex-dev/auth does `window.location.href = url` when the backend returns
// a redirect.  Inside the Freebuff preview iframe, any hard navigation escapes
// the iframe and dumps the user back in the editor.  We intercept the
// Location.prototype.href setter so that all attempted navigations are
// silently swallowed — the Convex Auth flow completes via tokens in memory,
// and the React tree handles routing via MemoryRouter.
if (typeof window !== "undefined" && window.self !== window.top) {
  const origHrefDesc = Object.getOwnPropertyDescriptor(
    Location.prototype,
    "href",
  );
  if (origHrefDesc?.set) {
    Object.defineProperty(Location.prototype, "href", {
      configurable: true,
      enumerable: true,
      get: origHrefDesc.get,
      set(_value: string) {
        // Silently swallow — do not navigate.
        // Tokens are already set in memory by the Convex auth client.
      },
    });
  }
}

// ─── Global error handlers ──────────────────────────────────────────────────
// The @vly-ai/integrations Vite plugin injects its own window-level `error` and
// `unhandledrejection` handlers (capture phase) that post vly-vite-hmr-error
// to the parent, which the platform may interpret as a fatal redirect signal.
// Our capture-phase handlers run first and prevent those injected handlers from
// seeing the event, keeping all errors in the console only.
if (typeof window !== "undefined") {
  window.addEventListener(
    "error",
    (e) => {
      e.preventDefault();
      // eslint-disable-next-line no-console
      console.error("[iframe-guard] error:", e.message, e.filename, e.lineno);
    },
    true,
  );
  window.addEventListener(
    "unhandledrejection",
    (e) => {
      e.preventDefault();
      // eslint-disable-next-line no-console
      console.error("[iframe-guard] unhandledrejection:", e.reason);
    },
    true,
  );
}

import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import "./index.css";

// Static imports — React.lazy chunks fail to load in the Freebuff
// preview iframe, causing a blank-screen crash.
import Landing from "./pages/Landing.tsx";
import AuthPage from "./pages/Auth.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import NotFound from "./pages/NotFound.tsx";

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
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
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
          </Routes>
        </MemoryRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
