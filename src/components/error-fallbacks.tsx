/**
 * Phase 239 — fallback surfaces for the two error boundaries.
 *
 * WHY THESE DO NOT USE i18n OR THE ROUTER
 *
 * A fallback that depends on the layer that just failed can fail itself, and
 * then the user gets the blank screen this exists to prevent. `RootErrorBoundary`
 * sits ABOVE `I18nProvider` and `ConvexAuthProvider`, so a failure in either
 * leaves `useI18n()` throwing and any `<Link>`/`useNavigate()` without context.
 * Both fallbacks are therefore plain markup with no context dependency:
 * anchors and a reload, nothing else. The copy is intentionally operator-facing
 * English, matching the existing `VITE_CONVEX_URL` misconfiguration screen in
 * `main.tsx`, for the same reason.
 *
 * WHY THE STACK IS NOT ON SCREEN
 *
 * The previous root fallback printed the raw exception message AND its stack —
 * absolute build paths, module names and frame positions — to every user. The
 * details an operator needs are recorded in `lib/runtime/diagnostics` and are
 * shown only where diagnostics are enabled (development/test), collapsed behind
 * a disclosure. A production user sees what happened and what to do, not a
 * trace.
 */
import { redactDiagnosticText, type FailurePhase } from "@/lib/runtime/diagnostics";

const SHELL = "min-h-screen flex items-center justify-center bg-background text-foreground p-6";

function Actions({ onRetry, showHome }: { onRetry?: () => void; showHome: boolean }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      )}
      {showHome && (
        <a
          href="/"
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          Go to home
        </a>
      )}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
      >
        Reload
      </button>
    </div>
  );
}

/**
 * Route-scoped fallback: one screen failed, the application did not.
 *
 * Shown INSIDE the router, so the URL bar still works and navigating to another
 * route recovers without a reload.
 */
export function RouteFailureFallback({
  error,
  onRetry,
  diagnosticsEnabled,
}: {
  error: unknown;
  onRetry: () => void;
  diagnosticsEnabled: boolean;
}) {
  const name = error instanceof Error ? error.name : "Error";
  const message = redactDiagnosticText(error instanceof Error ? error.message : String(error));
  const stack =
    error instanceof Error && typeof error.stack === "string"
      ? redactDiagnosticText(error.stack)
      : "";

  return (
    <main className={SHELL} role="alert" aria-live="assertive">
      <div className="max-w-lg">
        <h1 className="text-sm font-semibold">This screen failed to load</h1>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          The rest of the application is still working. Your saved data was not
          modified. You can try this screen again, or continue somewhere else.
        </p>
        <Actions onRetry={onRetry} showHome />
        <details className="mt-4 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <p className="mt-2 break-words font-mono">
            {name}: {message}
          </p>
          {diagnosticsEnabled && stack && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 p-2 font-mono text-[10px] leading-4">
              {stack}
            </pre>
          )}
        </details>
      </div>
    </main>
  );
}

/**
 * Root fallback: the application itself could not continue.
 *
 * No retry-remount here on purpose — the failure is above the router and the
 * providers, so re-rendering the same tree would usually fail the same way.
 * A reload is the honest recovery, and it is the only one offered.
 */
export function RootFailureFallback({
  error,
  route,
  phase,
  diagnosticsEnabled,
}: {
  error: unknown;
  route: string;
  phase: FailurePhase;
  diagnosticsEnabled: boolean;
}) {
  const name = error instanceof Error ? error.name : "Error";
  const message = redactDiagnosticText(error instanceof Error ? error.message : String(error));
  const stack = error instanceof Error && typeof error.stack === "string"
    ? redactDiagnosticText(error.stack)
    : "";

  return (
    <main className={SHELL} role="alert" aria-live="assertive">
      <div className="max-w-lg">
        <h1 className="text-sm font-semibold">Xstarz Analysis stopped unexpectedly</h1>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          The application could not continue and has stopped. Reloading is the
          way back; if it keeps happening, the details below identify where it
          failed.
        </p>
        <Actions showHome={false} />
        <details className="mt-4 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <p className="mt-2 break-words font-mono">
            {name}: {message}
          </p>
          <p className="mt-1 break-words font-mono">
            route {route} · phase {phase} · render-error
          </p>
          {diagnosticsEnabled && stack && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 p-2 font-mono text-[10px] leading-4">
              {stack}
            </pre>
          )}
        </details>
      </div>
    </main>
  );
}
