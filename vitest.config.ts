import { defineConfig } from "vitest/config";
import path from "path";

// Live integration tests — require real API access, rate-limited.
// Run separately: vitest run --config vitest.live.config.ts
//
// Phase 181: phase75 was missing from this list, which made `npm test`
// non-hermetic. It could not be noticed locally, because the sandbox has no
// outbound provider access, so the live fetch always failed and the test took
// its graceful-skip path. On a GitHub runner the network IS available, the
// fetch succeeds or gets rate-limited, and the suite fails — CI went red while
// the identical command passed locally.
//
// The rule this encodes: a test that performs real outbound I/O does not
// belong in the default regression suite. Its result depends on a third
// party's uptime and rate limits, not on this repository's correctness.
const LIVE_ONLY = [
  "src/**/phase72-*",
  "src/**/phase73-*",
  "src/**/phase74-*",
  "src/**/phase75-*",
];

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
          setupFiles: ["src/test-setup.ts"],
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
