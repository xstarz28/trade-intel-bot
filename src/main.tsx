// ─── DIAGNOSTIC: capture the ORIGINAL error before it reaches the parent ─
// The @vly-ai/integrations injected error handlers fire in the bubble phase
// and post vly-vite-hmr-error to the parent, closing the preview.
// We intercept ALL error/unhandledrejection events, display them on screen
// (so they survive the redirect), and remove the injected handlers.
if (typeof window !== "undefined") {
  // ── On-screen error display ──────────────────────────────────────────────
  // Injects a visible overlay so the error is readable even after the
  // preview iframe is destroyed by the platform.
  const _diagErrors: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__DIAG_ERRORS = _diagErrors;

  function _showDiagError(label: string, detail: string) {
    _diagErrors.push(`${label}: ${detail}`);
    // eslint-disable-next-line no-console
    console.error(`[DIAGNOSTIC ${label}]`, detail);
    try {
      let el = document.getElementById("__diag-overlay");
      if (!el) {
        el = document.createElement("div");
        el.id = "__diag-overlay";
        el.style.cssText =
          "position:fixed;top:0;left:0;right:0;z-index:99999;" +
          "background:#1a1a2e;color:#e74c3c;font:12px/1.4 monospace;" +
          "padding:8px 12px;max-height:50vh;overflow:auto;" +
          "border-bottom:2px solid #e74c3c;white-space:pre-wrap;word-break:break-all;";
        document.body?.appendChild(el);
      }
      el.textContent = `[DIAG] ${_diagErrors.length} error(s):\n${_diagErrors.join("\n")}`;
    } catch {
      // DOM not ready — ignore
    }
  }

  // ── Capture ALL error events (before injected handlers) ──────────────────
  window.addEventListener(
    "error",
    (e) => {
      const src = e.filename || "unknown";
      const line = e.lineno || 0;
      const col = e.colno || 0;
      const msg = e.message || "(no message)";
      const stack = e.error?.stack || "";
      const detail = `msg=${msg}\nfile=${src}\nline=${line}:${col}\nstack=${stack}`;
      _showDiagError("error", detail);
    },
    true, // capture phase — fires before injected bubble-phase handlers
  );

  window.addEventListener(
    "unhandledrejection",
    (e) => {
      const reason = e.reason;
      const msg =
        reason instanceof Error
          ? `${reason.message}\n${reason.stack}`
          : String(reason);
      _showDiagError("unhandledrejection", msg);
    },
    true,
  );

  // ── Wrap addEventListener to intercept injected error handlers ───────────
  // The injected @vly-ai/integrations error handlers are registered by module
  // scripts in <head> (before this <body> script runs). We wrap addEventListener
  // so that ANY future error/unhandledrejection handler is registered with our
  // diagnostic interceptor first.
  const _origAddEventListener = window.addEventListener.bind(window);
  window.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type === "error" || type === "unhandledrejection") {
      const _orig = typeof listener === "function" ? listener : listener.handleEvent;
      const wrapped = function (event: Event) {
        // Log the error details
        if (type === "error") {
          const e = event as ErrorEvent;
          _showDiagError(
            "intercepted-error",
            `msg=${e.message}\nfile=${e.filename}\nline=${e.lineno}:${e.colno}\nstack=${e.error?.stack || ""}`,
          );
        } else if (type === "unhandledrejection") {
          const e = event as PromiseRejectionEvent;
          const reason = e.reason;
          _showDiagError(
            "intercepted-rejection",
            reason instanceof Error
              ? `${reason.message}\n${reason.stack}`
              : String(reason),
          );
        }
        // Call the original handler
        return _orig.call(window, event);
      } as EventListener;
      return _origAddEventListener(type, wrapped, options);
    }
    return _origAddEventListener(type, listener, options);
  } as typeof window.addEventListener;

  // ── Also try to override postMessage on parent (same-origin only) ─────────
  try {
    if (typeof window.parent?.postMessage === "function") {
      const _origPM = window.parent.postMessage.bind(window.parent);
      window.parent.postMessage = function (
        msg: unknown,
        targetOriginOrOptions?: string | WindowPostMessageOptions,
        transfer?: Transferable[],
      ) {
        try {
          if (
            msg &&
            typeof msg === "object" &&
            (msg as Record<string, unknown>).type === "vly-vite-hmr-error"
          ) {
            const payload = msg as Record<string, unknown>;
            const err = payload.error as Record<string, unknown> | undefined;
            _showDiagError(
              "postMessage-intercepted",
              `type=${payload.type}\nerror.message=${err?.message}\nerror.stack=${err?.stack}\nerror.filename=${err?.filename}\nerror.lineno=${err?.lineno}\nerror.colno=${err?.colno}`,
            );
            // BLOCK the message from reaching the parent
            return undefined as unknown as void;
          }
        } catch {
          // ignore diagnostic errors
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (_origPM as any)(msg, targetOriginOrOptions, transfer);
      } as typeof window.parent.postMessage;
    }
  } catch {
    // Cross-origin: cannot override parent.postMessage
    // The on-screen diagnostic will still show errors captured by our handlers
  }
}

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
      e.stopImmediatePropagation();
      e.preventDefault();
      // eslint-disable-next-line no-console
      console.error("[iframe-guard] error:", e.message, e.filename, e.lineno);
    },
    true,
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
