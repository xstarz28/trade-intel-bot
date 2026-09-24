/**
 * Phase 237 — global setup for the live provider suite.
 *
 * Refuses to start unless the caller passed the explicit opt-in. This is the
 * second of three independent layers that keep live verification out of the
 * default path:
 *
 *   1. the default config does not collect `*.live.test.ts` files at all;
 *   2. this file refuses to run the live config without the opt-in env var, so
 *      even `vitest run --config vitest.live.config.ts` cannot be triggered by
 *      accident;
 *   3. the runtime network guard (src/test-network-guard.ts) stays installed in
 *      every other run, so a live test that somehow got collected would fail
 *      loudly instead of quietly making real requests.
 */
import { LIVE_OPT_IN_ENV, LIVE_OPT_IN_VALUE, isLiveOptIn } from "./test-network-guard";

export default function assertLiveOptIn(): void {
  if (isLiveOptIn()) return;

  throw new Error(
    `Refusing to run the live provider suite without an explicit opt-in.\n` +
      `\n` +
      `These tests make real outbound requests to third-party providers, so they\n` +
      `depend on that provider's uptime and rate limits — never on this repo's\n` +
      `correctness. They must not run as part of the default regression suite.\n` +
      `\n` +
      `Run them deliberately with:\n` +
      `  ${LIVE_OPT_IN_ENV}=${LIVE_OPT_IN_VALUE} npm run test:live\n`,
  );
}
