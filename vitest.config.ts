import { defineConfig } from "vitest/config";
import path from "path";

// Live integration tests — require real API access, rate-limited.
// Run separately: vitest run --config vitest.live.config.ts
const LIVE_ONLY = [
  "src/**/phase72-*",
  "src/**/phase73-*",
  "src/**/phase74-*",
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
