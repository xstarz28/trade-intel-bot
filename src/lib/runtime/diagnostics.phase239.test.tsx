/**
 * Phase 239 — the runtime diagnostics surface.
 *
 * The property under test is not "we have a logger". It is that the three
 * failure surfaces which were previously invisible or unreadable are now
 * OBSERVABLE, DETERMINISTICALLY, and that observing them changes nothing:
 *
 *   · a global runtime error   → previously reached nothing at all,
 *   · an unhandled rejection   → same,
 *   · a React render error     → reached only `console.error`.
 *
 * Determinism matters here for the same reason it did in Phase 238: a test
 * that depends on "the browser happened to report it" proves nothing. Each
 * test below dispatches a synthetic failure and then reads the record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentFailurePhase,
  currentRoutePath,
  diagnosticsEnabledByDefault,
  getFirstRuntimeFailure,
  getRuntimeFailures,
  installRuntimeDiagnostics,
  isRuntimeDiagnosticsInstalled,
  markRuntimeBootComplete,
  recordDataIntegrityIssue,
  recordRenderFailure,
  redactDiagnosticText,
  resetRuntimeDiagnostics,
} from "./diagnostics";

let uninstall: () => void = () => {};

/**
 * Dispatch a failure the way the browser does, WITHOUT jsdom reporting it as an
 * uncaught exception.
 *
 * jsdom's default action for an unhandled `error` event is to surface it as an
 * uncaught exception, which the test runner then counts as a suite-level error.
 * The diagnostics module deliberately does NOT call `preventDefault` (a
 * diagnostic that swallows the error it reports is the Phase 224 defect), so
 * the tests that assert "nothing was recorded" — where by definition no
 * listener remains — have to suppress that default themselves.
 */
function dispatchFailure(event: "error" | "unhandledrejection", error: Error) {
  const suppress = (e: Event) => e.preventDefault();
  window.addEventListener(event, suppress);
  window.dispatchEvent(
    event === "error"
      ? new ErrorEvent("error", { error, message: error.message })
      : new PromiseRejectionEvent("unhandledrejection", { promise: Promise.resolve(), reason: error }),
  );
  window.removeEventListener(event, suppress);
}

beforeEach(() => {
  resetRuntimeDiagnostics();
  uninstall = installRuntimeDiagnostics({ enabled: true });
});

afterEach(() => {
  uninstall();
  resetRuntimeDiagnostics();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("239 — global observation", () => {
  it("observes a global runtime error", () => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom"), message: "boom" }));

    const seen = getFirstRuntimeFailure();
    expect(seen).not.toBeNull();
    expect(seen?.kind).toBe("runtime-error");
    expect(seen?.name).toBe("Error");
    expect(seen?.message).toBe("boom");
  });

  it("observes an unhandled promise rejection, distinctly from a runtime error", () => {
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: new Error("rejected"),
      }),
    );

    const seen = getFirstRuntimeFailure();
    expect(seen?.kind).toBe("unhandled-rejection");
    expect(seen?.message).toBe("rejected");
  });

  it("names a rejection that is not an Error instead of losing it", () => {
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: { code: 42 },
      }),
    );

    const seen = getFirstRuntimeFailure();
    expect(seen?.name).toBe("UnhandledRejection");
    expect(seen?.message).toContain("42");
  });

  it("does not intercept the error: the browser's own handling still runs", () => {
    const seen = vi.fn();
    const observer = (event: ErrorEvent) => seen(event.error);
    window.addEventListener("error", observer);

    // The diagnostics listener is registered first. If it called
    // preventDefault or stopImmediatePropagation, this second listener would
    // never fire — which is exactly how the Phase 224 handler hid failures.
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("visible") }));

    window.removeEventListener("error", observer);
    expect(seen).toHaveBeenCalledTimes(1);
    expect((seen.mock.calls[0][0] as Error).message).toBe("visible");
  });

  it("records the FIRST failure and keeps it first as more arrive", () => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("first") }));
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("second") }));

    expect(getFirstRuntimeFailure()?.message).toBe("first");
    expect(getRuntimeFailures().map((f) => f.message)).toEqual(["first", "second"]);
  });

  it("ignores a resource load failure, which is not an application exception", () => {
    // An <img>/<script> error event carries no `error` property.
    window.dispatchEvent(new ErrorEvent("error", { message: "Failed to load resource" }));

    expect(getRuntimeFailures()).toHaveLength(0);
  });
});

describe("239 — the record's shape", () => {
  it("carries kind, route, message, name, stack, timestamp and phase", () => {
    window.history.replaceState({}, "", "/dashboard?token=should-not-be-recorded");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("shaped") }));

    const seen = getFirstRuntimeFailure();
    expect(Object.keys(seen ?? {}).sort()).toEqual(
      ["kind", "message", "name", "phase", "route", "stack", "timestamp"].sort(),
    );
    expect(seen?.timestamp).toBeGreaterThan(0);
    expect(typeof seen?.stack).toBe("string");
  });

  it("records the pathname and never the query string", () => {
    window.history.replaceState({}, "", "/auth?returnTo=%2Fdashboard&token=abc123");

    expect(currentRoutePath()).toBe("/auth");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("routed") }));
    expect(getFirstRuntimeFailure()?.route).toBe("/auth");
  });

  it("distinguishes a boot failure from a running failure", () => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("during boot") }));
    expect(currentFailurePhase()).toBe("boot");
    expect(getFirstRuntimeFailure()?.phase).toBe("boot");

    markRuntimeBootComplete();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("while running") }));

    expect(currentFailurePhase()).toBe("running");
    expect(getRuntimeFailures().map((f) => f.phase)).toEqual(["boot", "running"]);
  });

  it("records a React render error through the same surface", () => {
    const recorded = recordRenderFailure(new Error("render blew up"), "/dashboard");

    expect(recorded.kind).toBe("render-error");
    expect(recorded.route).toBe("/dashboard");
    expect(getFirstRuntimeFailure()).toBe(recorded);
  });

  it("records a dropped persisted row as a data-integrity issue, not a crash", () => {
    const recorded = recordDataIntegrityIssue("row has no usable breakdown");

    expect(recorded.kind).toBe("data-integrity");
    expect(recorded.message).toContain("breakdown");
  });

  it("bounds the buffer so a repeating failure cannot grow without limit", () => {
    for (let i = 0; i < 60; i++) {
      window.dispatchEvent(new ErrorEvent("error", { error: new Error(`e${i}`) }));
    }

    expect(getRuntimeFailures().length).toBeLessThanOrEqual(20);
    // ...and the first one is still the first, not the newest survivor.
    expect(getFirstRuntimeFailure()?.message).toBe("e0");
  });
});

describe("239 — no secrets in a diagnostic record", () => {
  it("masks credentials that appear in a message", () => {
    const text = redactDiagnosticText(
      "GET https://api.example.com/v1?api_key=SUPERSECRET123 failed; " +
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk " +
        "token=abc123def456",
    );

    expect(text).not.toContain("SUPERSECRET123");
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(text).not.toContain("abc123def456");
  });

  it("masks a provider key prefix and a long credential blob", () => {
    const text = redactDiagnosticText(
      "key sk_live_9f8e7d6c5b4a3f2e1d0c dXNlcl9pZDoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA",
    );

    expect(text).not.toContain("sk_live_9f8e7d6c5b4a3f2e1d0c");
    expect(text).not.toContain("dXNlcl9pZDoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA");
  });

  it("keeps a stack trace readable, so redaction has not destroyed the diagnostic", () => {
    const text = redactDiagnosticText(
      "Error: boom\n    at fromDbRecord (/app/src/lib/analysis/from-db-record.ts:58:11)",
    );

    expect(text).toContain("fromDbRecord");
    expect(text).toContain("from-db-record.ts:58");
  });

  it("never stores the raw secret that caused the failure", () => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("fetch failed for https://api.example.com/x?token=TOPSECRETVALUE"),
      }),
    );

    const stored = JSON.stringify(getRuntimeFailures());
    expect(stored).not.toContain("TOPSECRETVALUE");
  });
});

describe("239 — install/uninstall and production behaviour", () => {
  it("is off by default in a production build unless explicitly asked", () => {
    vi.stubEnv("VITE_RUNTIME_DIAGNOSTICS", "0");
    expect(diagnosticsEnabledByDefault()).toBe(false);
  });

  it("is on when the production build opts in", () => {
    vi.stubEnv("VITE_RUNTIME_DIAGNOSTICS", "1");
    expect(diagnosticsEnabledByDefault()).toBe(true);
  });

  it("records nothing at all when disabled", () => {
    uninstall();
    const noop = installRuntimeDiagnostics({ enabled: false });
    expect(isRuntimeDiagnosticsInstalled()).toBe(false);

    dispatchFailure("error", new Error("unobserved"));
    expect(getRuntimeFailures()).toHaveLength(0);

    noop();
  });

  it("uninstalls cleanly and is idempotent", () => {
    const first = installRuntimeDiagnostics({ enabled: true });
    const second = installRuntimeDiagnostics({ enabled: true });
    expect(second).toBe(first);

    uninstall();
    expect(isRuntimeDiagnosticsInstalled()).toBe(false);

    dispatchFailure("error", new Error("after uninstall"));
    expect(getRuntimeFailures()).toHaveLength(0);
    uninstall = () => {};
  });

  it("makes no network call of any kind", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("reported locally") }));
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: new Error("also local"),
      }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getRuntimeFailures()).toHaveLength(2);
  });
});
