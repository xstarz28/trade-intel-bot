import { defineConfig } from "vitest/config";
import path from "path";

// ── The default suite is hermetic. Two independent mechanisms enforce it. ──
//
// 1. FILES: suites that make real provider requests are not collected here.
//    They live in `*.live.test.ts` files and are run by vitest.live.config.ts.
//
//    Phase 181: phase75 was missing from this list, which made `npm test`
//    non-hermetic. It could not be noticed locally, because the sandbox has no
//    outbound provider access, so the live fetch always failed and the test took
//    its graceful-skip path. On a GitHub runner the network IS available, the
//    fetch succeeds or gets rate-limited, and the suite fails — CI went red
//    while the identical command passed locally.
//
// 2. RUNTIME: `src/test-network-guard.ts` (installed below) makes any outbound
//    connection that is not loopback FAIL, whatever API it is attempted
//    through. Phase 237 added this because a filename list can only exclude the
//    leaks somebody already thought of: phase54 called `verifyProvider()`, which
//    reaches `fetch()` inside production code, so no hostname literal existed in
//    the test for the old source scan to find and it ran 29 real requests as
//    part of `npm test`.
//
// The rule this encodes: a test whose result depends on a third party's uptime
// and rate limits does not belong in the default regression suite.
const LIVE_ONLY = [
  "src/**/phase72-*",
  "src/**/phase73-*",
  "src/**/phase74-*",
  "src/**/phase75-*",
  "src/**/*.live",
];

const NETWORK_GUARD_SETUP = "src/test-setup-network-guard.ts";

export default defineConfig({
  test: {
    // Two projects so component tests get a DOM while the pure-logic suites
    // (the overwhelming majority) keep the fast node environment.
    //
    // Previously `include` was `src/**/*.test.ts` only, which silently
    // excluded every `.test.tsx` file — the component render suites were
    // never collected by any run, so UI regressions could not be caught.
    projects: [
      {
        resolve: {
          alias: { "@": path.resolve(__dirname, "src") },
        },
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          setupFiles: [NETWORK_GUARD_SETUP],
          include: ["src/**/*.test.ts"],
          exclude: LIVE_ONLY.map((p) => `${p}.test.ts`),
          testTimeout: 10_000,
        },
      },
      {
        resolve: {
          alias: { "@": path.resolve(__dirname, "src") },
        },
        test: {
          name: "ui",
          globals: true,
          environment: "jsdom",
          setupFiles: ["src/test-setup.ts", NETWORK_GUARD_SETUP],
          include: ["src/**/*.test.tsx"],
          exclude: LIVE_ONLY.map((p) => `${p}.test.tsx`),
          testTimeout: 10_000,
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
