// ─── Iframe error interception ─────────────────────────────────────────────
// The @vly-ai/integrations Vite plugin injects window-level `error` and
// `unhandledrejection` handlers (bubble phase) that post vly-vite-hmr-error
// to the parent, which Freebuff interprets as a fatal crash and closes the
// preview iframe.  Our capture-phase handlers run BEFORE the injected ones
// and call stopImmediatePropagation() + preventDefault() to swallow the
// event, preventing it from reaching the injected handlers.
if (typeof window !== "undefined") {
  window.addEventListener(
    "error",
    (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      // eslint-disable-next-line no-console
      console.error("[iframe-guard] error:", e.message, e.filename, e.lineno);
    },
    true, // capture phase — fires before injected bubble-phase handlers
  );
  window.addEventListener(
    "unhandledrejection",
    (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      // eslint-disable-next-line no-console
      console.error("[iframe-guard] unhandledrejection:", e.reason);
    },
    true,
  );

  // @convex-dev/auth does `window.location.href = url` when the backend
  // returns a redirect. Inside the Freebuff preview iframe, any hard
  // navigation escapes the iframe and dumps the user back in the editor.
  // We intercept the Location.prototype.href setter so attempted navigations
  // are silently swallowed — the React tree handles routing instead.
  if (window.self !== window.top) {
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
        },
      });
    }
  }
}

import "@vly-ai/integrations";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { describeBuild, isUnsafeDeploymentSource } from "@/lib/build-info";
import {
  initNativeShell,
  isNativeShell,
  nativePlatform,
} from "@/lib/mobile/native-shell";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { I18nProvider } from "@/lib/i18n";
import "./index.css";

// Static imports — React.lazy chunks fail to load in the Freebuff
// preview iframe, causing a blank-screen crash.
import Landing from "./pages/Landing.tsx";
import AuthPage from "./pages/Auth.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import { Journal } from "@/components/Journal";
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

/*
  Phase 180 — build provenance, emitted once at startup.

  Production deploys from the hardened agent branch, NOT from `main` (whose
  history still contains the leaked OTP credential). Logging the exact commit
  makes "which revision is live?" answerable from a user's console alone.
  Carries only commit/branch/timestamp — no author, remote, or env value.
*/
console.info(`[Xstarz Analysis] build ${describeBuild()}`);
if (isUnsafeDeploymentSource()) {
  console.warn(
    "[Xstarz Analysis] This artifact was built from `main`, which is NOT a " +
      "valid production source while the leaked credential remains in its history.",
  );
}

/*
  Phase 180 — fail loudly on a misconfigured deployment.

  VITE_CONVEX_URL is inlined at BUILD time, so an artifact built without it is
  permanently broken no matter how the server is configured afterwards. In
  that state ConvexReactClient throws "No address provided" while this module
  is still evaluating, which means React never mounts and the user sees a
  blank page with the real cause buried in the console.

  That is the same silent-blank-page failure mode as the asset-path defect
  this phase fixed, so it gets the same treatment: render an explicit
  operator-facing message instead of nothing at all. This is a deployment
  misconfiguration, not a user-facing error, so it is intentionally in
  English and not routed through i18n — the translation layer itself lives
  inside the app that has failed to start.
*/
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!convexUrl) {
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#0b0f19;color:#e5e7eb">
        <div style="max-width:32rem">
          <h1 style="font-size:1.125rem;font-weight:600;margin:0 0 8px">Xstarz Analysis is not configured</h1>
          <p style="margin:0 0 8px;color:#9ca3af;line-height:1.5">
            This build was produced without a backend URL, so it cannot reach the
            analysis service. No market data can be shown.
          </p>
          <p style="margin:0;color:#9ca3af;line-height:1.5">
            Set <code style="color:#93c5fd">VITE_CONVEX_URL</code> in the hosting
            environment and rebuild. It is read at build time, not at run time.
          </p>
        </div>
      </div>`;
  }
  throw new Error(
    "VITE_CONVEX_URL is not set. It is inlined at build time, so this artifact must be rebuilt with the variable present.",
  );
}

const convex = new ConvexReactClient(convexUrl);

/*
  Phase 179 — native shell bootstrap (Android + iOS).

  Marks <html> so the safe-area CSS applies, then initialises status bar,
  splash dismissal, the Android hardware back button and deep-link handling.
  In a browser `initNativeShell()` returns immediately and adds no class, so
  the web build is byte-for-byte unaffected in behaviour.

  Intentionally fire-and-forget: native chrome must never delay first paint,
  and a plugin failure must never prevent the app from starting.
*/
if (isNativeShell()) {
  document.documentElement.classList.add("native-shell", `platform-${nativePlatform()}`);
}
void initNativeShell();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      {/*
        Development-only. The toolbar is an editor affordance: it injects a
        floating overlay and links out to the build platform, neither of which
        belongs in a shipped product. Gating on import.meta.env.DEV also lets
        the bundler tree-shake it out of the production build.
      */}
      {import.meta.env.DEV && (
        <ToolbarErrorBoundary>
          <VlyToolbar />
        </ToolbarErrorBoundary>
      )}
      <I18nProvider>
      <ConvexAuthProvider client={convex}>
        {/*
          BrowserRouter, not MemoryRouter: MemoryRouter keeps routing state in
          memory only, so the address bar never updates, deep links such as
          /dashboard 404 on load, and reload plus browser back/forward all drop
          the user back to the landing page. Real URLs are also required for
          the post-auth ?returnTo flow to mean anything.
        */}
        <BrowserRouter>
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
            <Route
              path="/journal"
              element={
                <RequireAuth>
                  <Journal />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
      </I18nProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
