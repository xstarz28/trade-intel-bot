/**
 * Phase 237 — the guard must cover the UI project too.
 *
 * `vitest.config.ts` defines two projects: `unit` (node) and `ui` (jsdom).
 * Excluding a live suite from one of them while the other still reaches the
 * network would leave `npm test` non-hermetic, and a fix applied to only the
 * node project is exactly the kind of half-measure the Phase 181 comment warns
 * about. This file runs in the jsdom project and makes the same two
 * behavioural demands: the guard is installed, and an external fetch is refused
 * with the guard's named error.
 *
 * It is a .test.tsx file so that it is collected by the `ui` project — the
 * suffix is the mechanism, not an accident.
 */
import { describe, expect, it } from "vitest";

import {
  ExternalNetworkBlockedError,
  isLiveOptIn,
  isNetworkGuardInstalled,
} from "../../test-network-guard";

describe("Phase 237 — jsdom project is guarded as well", () => {
  it("has the guard installed", () => {
    expect(isNetworkGuardInstalled()).toBe(true);
    expect(isLiveOptIn()).toBe(false);
  });

  it("refuses an external fetch from the jsdom project", async () => {
    await expect(
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"),
    ).rejects.toBeInstanceOf(ExternalNetworkBlockedError);
  });

  it("still reaches a local origin, so component tests with local servers work", async () => {
    // jsdom provides its own origin; the point is that the guard did not turn
    // into a blanket ban on HTTP in this project.
    const res = await fetch("http://127.0.0.1:1/__guard_probe__").then(
      () => "connected",
      (e: Error) => e.name,
    );
    expect(res).not.toBe("ExternalNetworkBlockedError");
  });
});
