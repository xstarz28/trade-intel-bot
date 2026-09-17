// Phase 224 — the former "iframe error interception" block is gone.
//
// It existed only for the retired build-platform preview iframe: a
// capture-phase `error`/`unhandledrejection` handler that swallowed EVERY
// uncaught error in production (stopImmediatePropagation + preventDefault),
// and — whenever the app was embedded in ANY iframe — a Location.prototype.href
// setter override that silently discarded all hard navigations, including the
// ones @convex-dev/auth performs on sign-in redirects. Neither behaviour is
// acceptable in a shipped product; RootErrorBoundary is the error surface.
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { describeBuild, isUnsafeDeploymentSource } from "@/lib/build-info";
import { initDesktopShell } from "@/lib/desktop/desktop-shell";
import {
  installRuntimeDiagnostics,
  markRuntimeBootComplete,
} from "@/lib/runtime/diagnostics";
import { RootErrorBoundary } from "@/components/root-error-boundary";
import { RouteErrorBoundaryScope } from "@/components/route-error-boundary";
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
// Phase 182 — public website pages. Part of the official-website surface,
// served by the same BrowserRouter and the same SPA rewrite as every other
// route, so a real custom domain can later serve them with no routing change.
import Download from "./pages/Download.tsx";
import Privacy from "./pages/Privacy.tsx";
import Terms from "./pages/Terms.tsx";

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
/*
  Phase 239 — runtime failure diagnostics.

  Installed BEFORE React mounts so a failure during boot is recorded too: with
  a boundary that only exists after mount, the blank page this phase is about
  had nothing to report it. The observers never call preventDefault, so the
  browser's own error reporting is unchanged; the buffer is local, redacted and
  bounded (see lib/runtime/diagnostics).

  Enabled in development/test by default and only on request in production
  (`VITE_RUNTIME_DIAGNOSTICS=1`), so a production build records nothing unless
  an operator asks for it.
*/
const uninstallDiagnostics = installRuntimeDiagnostics();

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

/*
  Phase 182 — desktop shell (Tauri, Windows first).

  The fourth distribution surface. Like the mobile shells this only marks the
  document for styling; it introduces no desktop-specific routing, no
  desktop-specific analysis engine, and no client-side provider access. In a
  browser this is a no-op.
*/
initDesktopShell();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
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
          {/*
            Phase 239 — route-scoped boundary INSIDE the router.

            Measured before this: a render error in one route replaced the
            entire tree, leaving zero interactive elements and no way back
            except a browser reload; changing the route did nothing because
            the router itself had been unmounted. The shell that must survive
            is the router, so the boundary that keeps a failure local lives
            inside it, and it resets when the pathname changes.
          */}
          <RouteErrorBoundaryScope>
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
              {/*
                Public website routes (Phase 182). Deliberately unauthenticated:
                a prospective user must be able to read the terms, the privacy
                statement and the download options before creating an account.
              */}
              <Route path="/download" element={<Download />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </RouteErrorBoundaryScope>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
      </I18nProvider>
    </RootErrorBoundary>
  </StrictMode>,
);

/*
  The application has painted: a failure from here on is a running failure, not
  a boot failure. This is what separates "the app is blank on load" from "the
  app broke while I was using it" in the recorded diagnostics — the two need
  different investigations and the report could not tell them apart.
*/
markRuntimeBootComplete();

/*
  The observers are deliberately NOT uninstalled: they live for the document.
  The returned function exists for tests and for a host that embeds this app,
  and is referenced here so the intent is explicit rather than implied.
*/
void uninstallDiagnostics;
