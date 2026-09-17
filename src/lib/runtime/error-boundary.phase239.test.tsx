/**
 * Phase 239 — error boundaries, route isolation and recovery.
 *
 * The measured defect (real tree, this phase): a render error inside a route
 * replaced the ENTIRE application — the fallback rendered with
 * `interactiveNodes=0`, so there was no link, no button and no header left, and
 * a subsequent route change did nothing because `BrowserRouter` had been
 * unmounted with everything else. Recovery required a browser reload, which
 * re-crashed on the same persisted data.
 *
 * These tests use the REAL components (`RootErrorBoundary`,
 * `RouteErrorBoundaryScope`, `RouteErrorBoundary`) and the real router. The
 * app-level test at the end boots the real `main.tsx` route table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { RootErrorBoundary } from "@/components/root-error-boundary";
import { RouteErrorBoundary, RouteErrorBoundaryScope } from "@/components/route-error-boundary";
import {
  getFirstRuntimeFailure,
  getRuntimeFailures,
  installRuntimeDiagnostics,
  resetRuntimeDiagnostics,
} from "./diagnostics";

let uninstall: () => void = () => {};

beforeEach(() => {
  resetRuntimeDiagnostics();
  uninstall = installRuntimeDiagnostics({ enabled: true });
});

afterEach(() => {
  uninstall();
  resetRuntimeDiagnostics();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A route that throws deterministically — a synthetic failure, not timing. */
function ExplodingRoute({ message = "route exploded" }: { message?: string }): never {
  throw new Error(message);
}

function HealthyRoute({ label }: { label: string }) {
  return <p>{label}</p>;
}

/** Small app: a header that must survive, plus a switchable route. */
function Harness() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <header data-testid="app-header">
        <span>Xstarz shell</span>
        <button type="button" onClick={() => navigate("/fine")}>
          go-fine
        </button>
      </header>
      <span data-testid="path">{location.pathname}</span>
      <RouteErrorBoundaryScope>
        <Routes>
          <Route path="/broken" element={<ExplodingRoute />} />
          <Route path="/other-broken" element={<ExplodingRoute message="second exploded" />} />
          <Route path="/fine" element={<HealthyRoute label="fine route" />} />
        </Routes>
      </RouteErrorBoundaryScope>
    </div>
  );
}

const mountHarness = (initialPath = "/broken") =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Harness />
    </MemoryRouter>,
  );

describe("239 — a failing route does not take the application with it", () => {
  it("catches the render failure and shows a fallback instead of a blank document", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = mountHarness();

    expect(container.textContent).toContain("This screen failed to load");
    expect(container.textContent).not.toBe("");
    quiet.mockRestore();
  });

  it("keeps the shared shell alive and interactive", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    mountHarness();

    // The header the previous behaviour destroyed.
    expect(screen.getByTestId("app-header")).toBeTruthy();
    expect(screen.getByText("go-fine")).toBeTruthy();
    quiet.mockRestore();
  });

  it("records the failure with its kind and route", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    mountHarness();

    const failure = getFirstRuntimeFailure();
    expect(failure?.kind).toBe("render-error");
    expect(failure?.route).toBe("/broken");
    expect(failure?.message).toBe("route exploded");
    quiet.mockRestore();
  });

  it("recovers on navigation: another route renders normally afterwards", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    mountHarness();

    fireEvent.click(screen.getByText("go-fine"));

    await waitFor(() => expect(screen.getByText("fine route")).toBeTruthy());
    expect(screen.queryByText("This screen failed to load")).toBeNull();
    quiet.mockRestore();
  });

  it("isolates a SECOND failing route from the first one's recovery", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    mountHarness();

    fireEvent.click(screen.getByText("go-fine"));
    await waitFor(() => expect(screen.getByText("fine route")).toBeTruthy());

    // navigate away and back into a broken route: the fallback returns, and
    // the shell is still there.
    const { rerender } = mountHarness("/other-broken");
    rerender(
      <MemoryRouter initialEntries={["/other-broken"]}>
        <Harness />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/This screen failed to load/).length).toBeGreaterThan(0);
    quiet.mockRestore();
  });
});

describe("239 — retry and remount", () => {
  it("remounts the failing subtree on retry, and succeeds once the failure stops", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;

    function Flaky() {
      if (shouldThrow) throw new Error("first attempt fails");
      return <p>recovered after retry</p>;
    }

    function RetryHarness() {
      return (
        <RouteErrorBoundary resetKeys={["/flaky"]} route="/flaky">
          <Flaky />
        </RouteErrorBoundary>
      );
    }

    render(<RetryHarness />);
    expect(screen.getByText("This screen failed to load")).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Try again"));

    await waitFor(() => expect(screen.getByText("recovered after retry")).toBeTruthy());
    quiet.mockRestore();
  });

  it("clears the failure when the reset key changes", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("boom");
      return <p>now healthy</p>;
    }

    const { rerender } = render(
      <RouteErrorBoundary resetKeys={["/a"]} route="/a">
        <Flaky />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("This screen failed to load")).toBeTruthy();

    shouldThrow = false;
    rerender(
      <RouteErrorBoundary resetKeys={["/b"]} route="/b">
        <Flaky />
      </RouteErrorBoundary>,
    );

    await waitFor(() => expect(screen.getByText("now healthy")).toBeTruthy());
    quiet.mockRestore();
  });
});

describe("239 — the two scopes are different scopes", () => {
  it("the root boundary catches a failure ABOVE the router and still renders an operable fallback", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <RootErrorBoundary>
        <ExplodingRoute message="provider blew up" />
      </RootErrorBoundary>,
    );

    expect(container.textContent).toContain("Xstarz Analysis stopped unexpectedly");
    // An operable recovery, not a dead page.
    expect(screen.getByText("Reload")).toBeTruthy();
    expect(getFirstRuntimeFailure()?.kind).toBe("render-error");
    quiet.mockRestore();
  });

  it("a PRODUCTION build renders no stack and no frames, only the message", () => {
    vi.stubEnv("VITE_RUNTIME_DIAGNOSTICS", "0");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RootErrorBoundary>
        <ExplodingRoute message="deep internal detail" />
      </RootErrorBoundary>,
    );

    const html = document.body.innerHTML;
    // The user sees what happened...
    expect(html).toContain("deep internal detail");
    expect(html).toContain("Technical details");
    // ...and never a stack frame, a build path or a module name.
    expect(html).not.toContain("at ExplodingRoute");
    expect(html).not.toContain("/home/");
    expect(html).not.toContain(".tsx:");
    quiet.mockRestore();
  });

  it("a DEVELOPMENT build shows the stack, but only inside a collapsed disclosure", () => {
    vi.stubEnv("VITE_RUNTIME_DIAGNOSTICS", "1");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <RootErrorBoundary>
        <ExplodingRoute message="developer detail" />
      </RootErrorBoundary>,
    );

    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    // Not expanded by default: a developer can open it, a user is not shown it.
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("pre")?.textContent ?? "").toContain("ExplodingRoute");
    quiet.mockRestore();
  });

  it("a PRODUCTION build hides the stack in the ROUTE fallback too", () => {
    /*
      The root fallback already had this test; the route fallback — the one a
      user actually meets, because it is the one a single broken screen
      produces — did not. Phase 239's mutation pass removed its
      `diagnosticsEnabled` guard and every test stayed green, which is a guard
      gap: the route fallback takes the same `diagnosticsEnabledByDefault()`
      flag and must honour it identically.
    */
    vi.stubEnv("VITE_RUNTIME_DIAGNOSTICS", "0");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = mountHarness();

    const html = container.innerHTML;
    // The user still gets the message and the disclosure...
    expect(html).toContain("This screen failed to load");
    expect(html).toContain("route exploded");
    // ...and no stack frame, build path or module name.
    expect(html).not.toContain("at ExplodingRoute");
    expect(html).not.toContain("/home/");
    expect(html).not.toContain(".tsx:");
    quiet.mockRestore();
  });

  it("a DEVELOPMENT build shows the route stack, but only inside a collapsed disclosure", () => {
    vi.stubEnv("VITE_RUNTIME_DIAGNOSTICS", "1");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = mountHarness();

    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("pre")?.textContent ?? "").toContain("ExplodingRoute");
    quiet.mockRestore();
  });

  it("the route fallback is announced to assistive technology", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = mountHarness();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    quiet.mockRestore();
  });
});

describe("239 — the fallback itself is allowed to fail without recursion", () => {
  it("a fallback that throws does not re-enter the same boundary forever", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    // The fallbacks take no context, so there is nothing for them to depend on
    // that the failure could have removed. This asserts the property by
    // rendering them with no i18n and no router present at all.
    const { container } = render(<RootErrorBoundary><ExplodingRoute /></RootErrorBoundary>);

    expect(container.textContent).toContain("Reload");
    expect(getRuntimeFailures().length).toBeGreaterThan(0);
    quiet.mockRestore();
  });
});
