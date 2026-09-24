/**
 * Phase 239 — the last-resort error boundary.
 *
 * Extracted from `main.tsx` unchanged in behaviour, with three corrections
 * measured in this phase:
 *
 *   1. It no longer prints the raw exception message AND stack to every user.
 *      The probe showed the shipped fallback rendering
 *      `TypeError: Cannot read properties of undefined (reading 'trend') at
 *      fromDbRecord (/home/…` — absolute build paths on the screen. Details now
 *      live behind a disclosure, and the stack only where diagnostics are on.
 *   2. It no longer calls itself a "Preview runtime error" and no longer logs
 *      `[WebContainer preview] Root crash:` — leftovers from the retired
 *      build-platform preview container, shown to real users.
 *   3. It records the failure through `lib/runtime/diagnostics` (kind
 *      "render-error", route, phase) instead of a bare `console.error`, so the
 *      regression suite reads the same surface an operator would.
 *
 * It is deliberately kept PURE during render: `getDerivedStateFromError` only
 * forwards the error, and the side effect happens in `componentDidCatch`,
 * because React may invoke the former more than once for one failure.
 *
 * This boundary sits OUTSIDE the router: its subject is "the application
 * cannot continue". A route-scoped failure is caught closer to the failure by
 * `RouteErrorBoundaryScope`, which keeps the router — and therefore recovery —
 * alive. Both exist because they cover different scopes; see
 * `route-error-boundary.tsx` for the measured reasoning.
 */
import React from "react";
import {
  currentFailurePhase,
  currentRoutePath,
  diagnosticsEnabledByDefault,
  recordRenderFailure,
} from "@/lib/runtime/diagnostics";
import { RootFailureFallback } from "./error-fallbacks";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: unknown;
}

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    recordRenderFailure(error);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <RootFailureFallback
          error={this.state.error}
          route={currentRoutePath()}
          phase={currentFailurePhase()}
          diagnosticsEnabled={diagnosticsEnabledByDefault()}
        />
      );
    }
    return this.props.children;
  }
}
