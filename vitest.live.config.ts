/**
 * Vitest config for live integration tests.
 * These tests make real HTTP requests to CoinGecko/TwelveData APIs
 * and are subject to rate limits. Run separately from the main regression:
 *
 *   bun vitest run --config vitest.live.config.ts
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/phase72-*.test.ts",
      "src/**/phase73-*.test.ts",
      "src/**/phase74-*.test.ts",
      "src/**/phase75-*.test.ts",
    ],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
