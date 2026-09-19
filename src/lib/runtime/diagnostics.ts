/**
 * Phase 239 — runtime failure diagnostics.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The reported symptom was "the web app often crashes", sometimes as a blank
 * screen. There was nowhere to look: Phase 224 correctly DELETED the old
 * capture-phase `error`/`unhandledrejection` handler (it called
 * `preventDefault()` and `stopImmediatePropagation()` on every uncaught error,
 * so the app silently swallowed real failures), and nothing replaced it. A
 * React render error reached `RootErrorBoundary` and was logged with
 * `console.error`; an unhandled promise rejection, or a runtime error outside
 * React, reached nothing at all. Diagnosing the report would have meant asking
 * the user to open devtools.
 *
 * ── What it does, and what it deliberately does NOT do ───────────────────
 *
 * It OBSERVES. It never calls `preventDefault()` or `stopPropagation()`, so
 * the browser's own error handling, the console output and the default
 * rejection warning all still happen — this layer adds a record, it does not
 * intercept. A diagnostic that swallows the error it reports is how the
 * previous handler hid failures for many phases.
 *
 * It is LOCAL ONLY. Nothing is sent anywhere: no `fetch`, no `sendBeacon`, no
 * `navigator.sendBeacon`, no console spam. Instrumentation must not change
 * runtime, data or network behaviour, and a diagnostics buffer that phones
 * home would be a new privacy surface rather than a fix.
 *
 * It is DISABLEABLE. Enabled in development and test builds by default; in a
 * production build it is off unless `VITE_RUNTIME_DIAGNOSTICS` is exactly
 * `"1"`. `installRuntimeDiagnostics()` returns an uninstall function, so a
 * caller (or a test) can remove it completely.
 *
 * It REDACTES. Messages, stacks and routes pass through `redactDiagnosticText`
 * before storage, and the route is recorded as a pathname only — never the
 * query string, which is where a `?returnTo=` or a token would travel. Tokens,
 * `Authorization` values, API keys, JWTs and long credential-shaped blobs are
 * masked. Free-text payloads are never captured: no request bodies, no
 * provider envelopes, no auth objects.
 *
 * ── The shape of a record ────────────────────────────────────────────────
 *
 *   kind      — which failure surface produced it
 *   route     — pathname at the time (no query, no hash)
 *   message   — redacted, truncated
 *   name      — Error.name, or "UnhandledRejection" for a non-Error rejection
 *   stack     — redacted, truncated
 *   timestamp — Date.now() at capture
 *   phase     — "boot" until the app signals it painted, then "running"
 */

export type FailureKind =
  | "runtime-error"
  | "unhandled-rejection"
  | "render-error"
  /** A persisted record that could not be interpreted and was dropped. */
  | "data-integrity";

export type FailurePhase = "boot" | "running";

export interface RuntimeFailure {
  kind: FailureKind;
  route: string;
  message: string;
  name: string;
  stack: string;
  timestamp: number;
  phase: FailurePhase;
}

const MAX_MESSAGE = 400;
const MAX_STACK = 2_000;
const MAX_FAILURES = 20;

/**
 * Secrets that must never reach a diagnostic record.
 *
 * Each pattern is deliberately narrow: over-redacting a stack trace makes the
 * diagnostic useless, so only credential-shaped text is masked.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  // `Authorization: Bearer xxx`, `api_key=xxx`, `token: xxx`, …
  [/(authorization|bearer|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd)["'`]?\s*[:=]\s*["'`]?[^\s"'`,;&)\]}]+/gi, "$1=[redacted]"],
  // JWTs (header.payload.signature)
  [/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, "[redacted-jwt]"],
  // Provider key prefixes
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{4,}/g, "[redacted-key]"],
  // A query string anywhere in a message: the value is what leaks.
  [/\?[^\s"'`)\]}]*=[^\s"'`)\]}]*/g, "?[redacted]"],
  // Long provider-shaped blobs (base64/hex-ish runs). File names, bundle
  // hashes and frame numbers in a stack are far shorter than this.
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, "[redacted-blob]"],
];

/** Mask credential-shaped text. Exported so the redaction itself is testable. */
export function redactDiagnosticText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Pathname only. Never the query string or hash — those carry tokens. */
export function currentRoutePath(): string {
  return safeRoute();
}

/** "boot" until {@link markRuntimeBootComplete} — for render-time readers. */
export function currentFailurePhase(): FailurePhase {
  return state.ready ? "running" : "boot";
}

/**
 * Reduce anything route-shaped to a pathname.
 *
 * A caller may pass a full URL (`https://host/dashboard?token=…`) or just a
 * pathname; both are reduced to the path with the query and hash removed. The
 * explicit value wins over the ambient location, because a boundary knows
 * WHICH route failed while `window.location` may already have moved on.
 */
function safeRoute(explicit?: string): string {
  if (typeof explicit === "string" && explicit.length > 0) {
    const withoutQuery = explicit.split(/[?#]/)[0];
    if (withoutQuery.startsWith("/")) return withoutQuery;
  }
  if (typeof window === "undefined") return "";
  const loc = window.location;
  if (!loc || typeof loc.pathname !== "string") return "";
  return loc.pathname || "/";
}

interface DiagnosticsState {
  failures: RuntimeFailure[];
  installed: boolean;
  ready: boolean;
  uninstall: (() => void) | null;
}

const state: DiagnosticsState = {
  failures: [],
  installed: false,
  ready: false,
  uninstall: null,
};

/** True when this build records failures without being asked to. */
export function diagnosticsEnabledByDefault(): boolean {
  const flag = import.meta.env?.VITE_RUNTIME_DIAGNOSTICS;
  if (flag === "1") return true;
  if (flag === "0") return false;
  // Development and test builds only. A production bundle that has not opted
  // in records nothing, so shipping this file changes no production behaviour.
  return import.meta.env?.DEV === true;
}

function toFailure(
  kind: FailureKind,
  error: unknown,
  route?: string,
): RuntimeFailure {
  const name =
    error instanceof Error
      ? error.name || "Error"
      : kind === "unhandled-rejection"
        ? "UnhandledRejection"
        : "UnknownError";

  let message: string;
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  else if (error === null || error === undefined) message = "(no error value)";
  else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = "(unserializable error value)";
    }
  }

  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";

  return {
    kind,
    route: safeRoute(route),
    message: truncate(redactDiagnosticText(message), MAX_MESSAGE),
    name: truncate(redactDiagnosticText(name), MAX_MESSAGE),
    stack: truncate(redactDiagnosticText(stack), MAX_STACK),
    timestamp: Date.now(),
    phase: state.ready ? "running" : "boot",
  };
}

/**
 * Append a failure. The FIRST one is preserved: with a repeating error the
 * original cause is the one worth having, and a boundary that re-renders can
 * otherwise bury it under hundreds of copies of itself.
 */
function push(kind: FailureKind, error: unknown, route?: string): RuntimeFailure {
  const failure = toFailure(kind, error, route);

  /*
    Collapse an immediate duplicate.

    React StrictMode renders a component twice in development, so a failure
    raised during render (a render error, or a row dropped inside a `useMemo`)
    arrives twice for one event. Only the IMMEDIATELY preceding record is
    compared: two occurrences of the same error separated by anything else are
    two real events and both are kept.
  */
  const previous = state.failures[state.failures.length - 1];
  if (
    previous &&
    previous.kind === failure.kind &&
    previous.message === failure.message &&
    previous.route === failure.route
  ) {
    return previous;
  }

  state.failures.push(failure);
  /*
    The bound drops the SECOND-oldest entry, never the first: the original
    cause of a repeating failure is the one worth keeping, and a boundary that
    re-renders would otherwise evict it within milliseconds in favour of
    copies of itself.
  */
  if (state.failures.length > MAX_FAILURES) {
    state.failures.splice(1, state.failures.length - MAX_FAILURES);
  }
  return failure;
}

/** Called by an error boundary for a React render error. */
export function recordRenderFailure(error: unknown, route?: string): RuntimeFailure {
  return push("render-error", error, route);
}

/** Called when a persisted record was dropped because it could not be read. */
export function recordDataIntegrityIssue(reason: string, route?: string): RuntimeFailure {
  return push("data-integrity", new Error(reason), route);
}

export function getRuntimeFailures(): readonly RuntimeFailure[] {
  return state.failures;
}

/** The first failure recorded since the last reset — null when none. */
export function getFirstRuntimeFailure(): RuntimeFailure | null {
  return state.failures[0] ?? null;
}

export function resetRuntimeDiagnostics(): void {
  state.failures = [];
  state.ready = false;
}

/** Signal that the application painted; later failures are phase "running". */
export function markRuntimeBootComplete(): void {
  state.ready = true;
}

/**
 * Install the global observers. Returns an uninstall function.
 *
 * Safe to call once; a second call returns the existing uninstall function
 * instead of stacking duplicate listeners.
 */
export function installRuntimeDiagnostics(
  options: { enabled?: boolean; force?: boolean } = {},
): () => void {
  if (state.installed && state.uninstall) return state.uninstall;

  const enabled = options.enabled ?? diagnosticsEnabledByDefault();
  if (!enabled) return () => {};

  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {};
  }

  const onError = (event: ErrorEvent) => {
    // `event.error` is absent for resource load failures (a failing <img> or
    // <script>), which are not application exceptions.
    if (!event.error) return;
    push("runtime-error", event.error);
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    // No preventDefault: the browser's own reporting must still happen.
    push("unhandled-rejection", event.reason);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  state.installed = true;
  state.uninstall = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    state.installed = false;
    state.uninstall = null;
  };
  return state.uninstall;
}

/** True while the observers are attached. */
export function isRuntimeDiagnosticsInstalled(): boolean {
  return state.installed;
}
