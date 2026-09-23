/**
 * Vitest config for the live provider suite — the ONLY place these tests run.
 *
 * These tests make real HTTP requests to third-party providers
 * (CoinGecko/OKX/Treasury/CFTC/DeFiLlama/Twelve Data) and are subject to those
 * providers' uptime and rate limits. They must never run as part of the default
 * regression suite: a red live run is evidence about a third party, not about
 * this repository.
 *
 * HOW TO RUN IT (explicit opt-in is required — see the global setup below):
 *
 *   LIVE_PROVIDER_VERIFICATION=1 npm run test:live
 *
 * Running `vitest run --config vitest.live.config.ts` without that env var
 * fails immediately with instructions instead of making live requests. Nothing
 * in CI sets it, and the default `npm test` neither sets it nor collects these
 * files.
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Refuses to start without LIVE_PROVIDER_VERIFICATION=1.
    globalSetup: ["src/vitest-live-global-setup.ts"],
    // Phase 237: the network guard is deliberately NOT installed here — this is
    // the one path allowed to reach the real network.
    include: [
      "src/**/phase72-*.test.ts",
      "src/**/phase73-*.test.ts",
      "src/**/phase74-*.test.ts",
      "src/**/phase75-*.test.ts",
      "src/**/*.live.test.ts",
    ],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
