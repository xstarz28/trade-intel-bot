/**
 * Phase 237 — installs the fail-closed network guard for the default suite.
 *
 * Wired into both projects in vitest.config.ts. See src/test-network-guard.ts
 * for the rule and the reasoning.
 *
 * Under the live opt-in the guard is deliberately NOT installed: the live suite
 * exists precisely to make real provider requests. Nothing else turns it off —
 * not a filename, not a directory, not a test's own choice.
 */
import { installNetworkGuard, isLiveOptIn } from "./test-network-guard";

if (!isLiveOptIn()) {
  installNetworkGuard();
}
