/**
 * Phase 239 — route-scoped error boundary.
 *
 * ── The defect this fixes ────────────────────────────────────────────────
 *
 * `main.tsx` had ONE boundary, and it sat ABOVE `BrowserRouter`. Measured on
 * the real tree (Phase 239 probe): when a route's render threw, the fallback
 * replaced everything — the router included — leaving the page with
 * `interactiveNodes=0`. No header, no link, no button: the only way out was a
 * browser reload, and a subsequent route change did nothing because the
 * component that reads the URL no longer existed. One malformed record
 * therefore blanked the whole application.
 *
 * ── The fix ──────────────────────────────────────────────────────────────
 *
 * A second boundary INSIDE the router, wrapping the route table. A screen that
 * fails renders a scoped fallback; the router keeps running, so the URL bar,
 * browser back/forward and every other route still work, and navigating away
 * recovers without a reload.
 *
 * Two boundaries, two scopes — this is not duplication:
 *   · `RootErrorBoundary` (outside the router) — the application cannot
 *     continue: a failure in a provider or in the shell itself.
 *   · `RouteErrorBoundaryScope` (inside the router) — one screen failed and
 *     the application can continue.
 * The root boundary stays the last resort, so a failure thrown above the
 * router is still caught rather than unmounting React to a blank document.
 *
 * ── Why the reset key is the pathname ────────────────────────────────────
 *
 * React boundaries latch: they stay in the failed state until something clears
 * it. Keying on the pathname means navigation clears it, which is the
 * behaviour a user expects from "go somewhere else and come back". Re-rendering
 * the SAME route after a transient failure is the explicit "Try again" button,
 * which remounts the subtree via the reset token.
 */
import React from "react";
import { useLocation } from "react-router";
import { diagnosticsEnabledByDefault, recordRenderFailure } from "@/lib/runtime/diagnostics";
import { RouteFailureFallback } from "./error-fallbacks";

interface Props {
  children: React.ReactNode;
  /** Changing this value clears the failure state. */
  resetKeys: readonly unknown[];
  route: string;
}

interface State {
  error: unknown;
}

export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    recordRenderFailure(error, this.props.route);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error === null) return;
    if (prev.resetKeys.some((key, i) => !Object.is(key, this.props.resetKeys[i]))) {
      this.setState({ error: null });
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error !== null) {
      return (
        <RouteFailureFallback
          error={this.state.error}
          onRetry={this.retry}
          diagnosticsEnabled={diagnosticsEnabledByDefault()}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Router-aware wrapper: supplies the location the boundary resets on.
 *
 * A class component cannot call `useLocation`, and putting the hook in
 * `RouteErrorBoundary` itself would make the boundary unusable outside a
 * router (tests, and the root scope).
 */
export function RouteErrorBoundaryScope({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <RouteErrorBoundary resetKeys={[location.pathname]} route={location.pathname}>
      {children}
    </RouteErrorBoundary>
  );
}
