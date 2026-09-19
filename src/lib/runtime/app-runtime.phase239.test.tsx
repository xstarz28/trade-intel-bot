/**
 * Phase 239 — the real application, booted, with the data that used to crash it.
 *
 * This is the regression for the REPORTED symptom ("the web app often crashes",
 * blank screen). It boots the REAL `main.tsx` — the real route table, the real
 * boundaries, the real pages — with Convex stubbed at the boundary, and drives
 * it with the exact input the Phase 239 probe proved fatal:
 *
 *   a persisted `analyses` row that the projection cannot interpret
 *   (`breakdown` absent — a row written before the field existed, which Convex
 *   returns because it validates on write, not on read).
 *
 * Measured before the fix, on this same harness: the fallback replaced the whole
 * tree, `interactiveNodes=0`, and changing the route did nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

// ─── environment gaps (jsdom), not product defects ────────────────────────
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}
if (!("IntersectionObserver" in globalThis)) {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}
if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
}

const state = {
  history: [] as unknown[],
  entitlement: undefined as unknown,
};

/**
 * Convex references are opaque proxies; replacing the generated module makes
 * them readable strings, so a test can say which query it is answering.
 */
vi.mock("@/convex/_generated/api", () => ({
  api: new Proxy({}, { get: (_t, mod) => new Proxy({}, { get: (_t2, fn) => `${String(mod)}.${String(fn)}` }) }),
}));

vi.mock("convex/react", async () => {
  const actual = await vi.importActual<typeof import("convex/react")>("convex/react");
  return {
    ...actual,
    ConvexReactClient: class { constructor(_url: string) {} },
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
    useQuery: (ref: unknown) => {
      const key = String(ref);
      if (key.includes("analyses.list")) return state.history;
      if (key.includes("getMyEntitlement")) return state.entitlement;
      return undefined;
    },
    useMutation: () => vi.fn(async () => "id"),
    useAction: () => vi.fn(async () => null),
  };
});
vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}));

const VALID_ROW = {
  _id: "a1", _creationTime: 1, userId: "u1",
  instrument: "BTC/USD", instrumentType: "crypto", timeframe: "H1",
  bias: "Bullish", confidence: 70, recommendation: "LONG", conviction: "Medium",
  noTradeReasons: [], tradingStyle: "intraday",
  technicalSummary: "t", fundamentalSummary: "f",
  breakdown: { trend: 1, indicator: 0, fundamental: 1, sentiment: 0 },
  keyLevels: { support: "1", resistance: "2", invalidation: "0" },
  riskNote: "r", dataCompleteness: "full", dataFlags: [], timestamp: 1_700_000_000_000,
};

const LEGACY_ROW = (() => {
  const row = { ...VALID_ROW, _id: "legacy-1" } as Record<string, unknown>;
  delete row.breakdown;
  return row;
})();

const NO_LEVELS_ROW = (() => {
  const row = { ...VALID_ROW, _id: "nolevels-1" } as Record<string, unknown>;
  delete row.keyLevels;
  return row;
})();

/** Boot the real application at `url` and let it settle. */
async function boot(url: string) {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", url);
  (import.meta.env as Record<string, string>).VITE_CONVEX_URL = "https://convex.example.invalid";

  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  const diagnostics = await import("./diagnostics");
  // The same module instance `main.tsx` will install.
  await import("../../main");
  await settle();
  consoleError.mockRestore();

  return diagnostics;
}

/**
 * Wait until the application has finished its first pass.
 *
 * Polling on an observable, not sleeping a fixed number of milliseconds: the
 * route table resolves auth in an effect, and a fixed delay is a timing bet
 * that passes on a fast machine and fails on a loaded one — the exact class of
 * flakiness Phase 238 removed from the clock.
 */
async function settle(timeoutMs: number | null = 5_000): Promise<void> {
  const budget = timeoutMs ?? 5_000;
  const deadline = Date.now() + budget;
  const authSettled = () => {
    const body = text();
    return body.length > 0 && !/Restoring session/.test(body);
  };
  while (Date.now() < deadline) {
    if (authSettled()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the application never settled; last render: ${text().slice(0, 120)}`);
}

/**
 * Wait for an observable expectation rather than for a duration.
 *
 * `settle()` only means "the app painted something", which is already true of
 * a fallback — so a navigation assertion must wait for the thing it is about
 * instead of assuming the router has processed the event.
 */
async function waitForText(needle: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (text().includes(needle)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`"${needle}" never rendered; last render: ${text().slice(0, 200)}`);
}

const text = () => (document.getElementById("root")?.textContent ?? "").replace(/\s+/g, " ");
const interactive = () => document.getElementById("root")?.querySelectorAll("a[href], button").length ?? 0;
const crashed = () => /stopped unexpectedly|failed to load/i.test(text());

beforeEach(() => {
  state.history = [];
  state.entitlement = undefined;
  delete (window as unknown as Record<string, unknown>).Capacitor;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("239 — the reported crash, on the real tree", () => {
  it("a legacy row WITHOUT breakdown no longer blanks the application", async () => {
    state.history = [LEGACY_ROW];
    const diagnostics = await boot("/dashboard");

    expect(crashed()).toBe(false);
    expect(text()).toContain("Xstarz Analysis");
    expect(interactive()).toBeGreaterThan(0);
    // ...and the drop is recorded rather than silent.
    const issue = diagnostics.getRuntimeFailures().find((f) => f.kind === "data-integrity");
    expect(issue?.message).toContain("breakdown");
    expect(issue?.message).toContain("legacy-1");
  });

  it("a row WITHOUT key levels is dropped instead of crashing a consumer later", async () => {
    state.history = [NO_LEVELS_ROW];
    const diagnostics = await boot("/dashboard");

    expect(crashed()).toBe(false);
    expect(interactive()).toBeGreaterThan(0);
    const issue = diagnostics.getRuntimeFailures().find((f) => f.kind === "data-integrity");
    expect(issue?.message).toContain("key levels");
  });

  it("a null entry in the history array is survivable", async () => {
    state.history = [null];
    await boot("/dashboard");

    expect(crashed()).toBe(false);
    expect(text()).toContain("Xstarz Analysis");
  });

  it("a hard refresh does not reproduce the crash", async () => {
    state.history = [LEGACY_ROW];

    const first = await boot("/dashboard");
    expect(crashed()).toBe(false);
    const second = await boot("/dashboard");
    expect(crashed()).toBe(false);

    // Deterministic in both directions: each boot records the same one issue.
    expect(first.getRuntimeFailures().filter((f) => f.kind === "data-integrity")).toHaveLength(1);
    expect(second.getRuntimeFailures().filter((f) => f.kind === "data-integrity")).toHaveLength(1);
  });

  it("a good record still reaches the UI (the fix drops nothing it should keep)", async () => {
    state.history = [VALID_ROW];
    const diagnostics = await boot("/dashboard");

    expect(crashed()).toBe(false);
    expect(diagnostics.getRuntimeFailures().filter((f) => f.kind === "data-integrity")).toHaveLength(0);
  });
});

describe("239 — the reported crash, on the real tree", () => {
  it("installs the window observers before mount and attributes later failures to running", async () => {
    /*
      The instrumentation is only useful if the REAL entry point turns it on
      before anything renders: a failure during the first mount is exactly the
      one that leaves a blank screen and nothing to read afterwards. Dispatching
      through the real window also proves the observer is not swallowing the
      event it reports.
    */
    const diagnostics = await boot("/privacy");

    const suppress = (event: Event) => event.preventDefault();
    window.addEventListener("error", suppress);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom after boot") }));
    window.removeEventListener("error", suppress);

    const failure = diagnostics.getFirstRuntimeFailure();
    expect(failure?.kind).toBe("runtime-error");
    expect(failure?.message).toContain("boom after boot");
    expect(failure?.route).toBe("/privacy");
    // Boot finished, so the failure is attributed to the running application.
    expect(failure?.phase).toBe("running");
  });
});

describe("239 — a screen failure stays inside the screen", () => {
  it("when a route does fail, the shell and navigation survive and another route works", async () => {
    // A history row that survives projection but explodes a consumer would be
    // caught by the route boundary; the observable that matters is that the
    // application is still there and can be navigated.
    state.history = [LEGACY_ROW];
    await boot("/dashboard");
    expect(interactive()).toBeGreaterThan(0);

    // navigate the way the browser does
    window.history.pushState({}, "", "/privacy");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(text()).toContain("Privacy");
    expect(crashed()).toBe(false);
    expect(interactive()).toBeGreaterThan(0);
  });
});

describe("239 — provider-unavailable and partial states", () => {
  it("boots to a healthy public route with no backend reachable", async () => {
    await boot("/privacy");

    expect(crashed()).toBe(false);
    expect(text()).toContain("Privacy");
    expect(interactive()).toBeGreaterThan(0);
  });

  it("keeps the app mounted when every provider leg is unavailable", async () => {
    // No credentials, no live data: the state a first-run user is actually in.
    state.history = [];
    state.entitlement = null;
    await boot("/dashboard");

    expect(crashed()).toBe(false);
    expect(text()).toContain("Xstarz Analysis");
    expect(interactive()).toBeGreaterThan(0);
    // The domain semantics are untouched: an absent entitlement is absent.
    expect(text()).not.toMatch(/premium unlocked/i);
  });

  it("keeps the marketing and legal routes unchanged", async () => {
    await boot("/terms");

    expect(text()).toContain("Terms");
    expect(crashed()).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("239 — the route boundary is WIRED INTO the real application", () => {
  it("a route that throws leaves the router alive: another route still renders", async () => {
    /*
      The wiring, not the component: `main.tsx` is booted with a page that
      throws on render. With the boundary inside the router (this phase) the
      failure is contained and `/terms` still renders. With only the root
      boundary (before this phase), the router is unmounted and every
      subsequent navigation renders the terminal fallback instead — which is
      exactly what the measured probe recorded.
    */
    vi.doMock("@/pages/Privacy", () => ({
      default: function ExplodingPrivacy(): React.ReactNode {
        throw new Error("privacy page exploded");
      },
    }));

    await boot("/privacy");
    vi.doUnmock("@/pages/Privacy");

    // The failure is contained, announced, and offers recovery.
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    expect(text()).toContain("This screen failed to load");

    // ...and the router survived, so another route renders normally.
    window.history.pushState({}, "", "/terms");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitForText("Terms");

    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("records that failure as a render error carrying its route", async () => {
    vi.doMock("@/pages/Terms", () => ({
      default: function ExplodingTerms(): React.ReactNode {
        throw new Error("terms page exploded");
      },
    }));

    const diagnostics = await boot("/terms");
    vi.doUnmock("@/pages/Terms");

    /*
      Found by kind rather than by position: React 19 also re-reports a
      boundary-caught error to the global handler, so the buffer legitimately
      holds BOTH a "render-error" (from the boundary, which knows the route it
      was rendering) and a "runtime-error" (from React's rethrow). Their order
      is not a property worth pinning — the kind and the route are.
    */
    const failure = diagnostics.getRuntimeFailures().find((f) => f.kind === "render-error");
    expect(failure).toBeDefined();
    expect(failure?.route).toBe("/terms");
    expect(failure?.phase).toBe("running");
  });
});

describe("239 — a partial result must not crash the panel", () => {
  it("renders an absent key level as a placeholder instead of throwing", async () => {
    const { render } = await import("@testing-library/react");
    const { I18nProvider } = await import("@/lib/i18n");
    const { AnalysisResultDisplay } = await import("@/components/AnalysisResult");
    const { fromDbRecord } = await import("@/lib/analysis/from-db-record");

    const result = fromDbRecord(VALID_ROW as never);
    expect(result).not.toBeNull();

    // A producer that hands over the same result minus its levels: the panel
    // must degrade to "—", never dereference the absent object.
    const partial = { ...result!, keyLevels: undefined } as unknown as NonNullable<typeof result>;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <I18nProvider>
        <AnalysisResultDisplay result={partial} />
      </I18nProvider>,
    );

    expect(container.textContent).toContain("—");
    quiet.mockRestore();
  });
});

describe("239 — the other distribution surfaces still boot", () => {
  it("boots under the Capacitor native shell", async () => {
    (window as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
    };
    await boot("/");

    expect(crashed()).toBe(false);
    expect(document.documentElement.classList.contains("native-shell")).toBe(true);
    expect(text().length).toBeGreaterThan(0);
  });

  it("boots under the Tauri desktop shell", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    await boot("/");

    expect(crashed()).toBe(false);
    expect(text().length).toBeGreaterThan(0);
  });
});
