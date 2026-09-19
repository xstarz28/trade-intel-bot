/**
 * Phase 173 — recovery after a provider outage must be reachable.
 *
 * Found while writing the UAT step "provider connectivity returns → user
 * recovers". The Dashboard gated the refresh control on having live sources:
 *
 *     onRefresh={liveSources.length > 0 ? handleScanRefresh : undefined}
 *
 * and MarketOpportunities renders the refresh button only `{onRefresh && ...}`.
 *
 * So the one state where a retry actually matters — a first discovery cycle
 * that returned nothing because the provider was unreachable — was the exact
 * state with no retry control. There is no polling interval and no other
 * caller of runDiscoveryCycle, so the only escape was a full page reload.
 * That is a dead end, and it reads to the user as "no opportunities exist"
 * rather than "retry available".
 *
 * Fix: always pass the handler; recovery is reachable from the empty state.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const DASHBOARD = readFileSync("src/pages/Dashboard.tsx", "utf8");
const PANEL = readFileSync("src/components/MarketOpportunities.tsx", "utf8");

describe("refresh affordance survives an empty/degraded scan", () => {
  it("does not gate onRefresh on having live sources", () => {
    expect(DASHBOARD).not.toMatch(
      /onRefresh=\{\s*liveSources\.length\s*>\s*0\s*\?/,
    );
  });

  it("always hands the panel a refresh handler", () => {
    expect(DASHBOARD).toMatch(/onRefresh=\{handleScanRefresh\}/);
  });

  it("the handler re-runs the discovery cycle", () => {
    const idx = DASHBOARD.indexOf("const handleScanRefresh");
    expect(idx).toBeGreaterThan(-1);
    expect(DASHBOARD.slice(idx, idx + 400)).toContain("runDiscoveryCycle");
  });

  it("a failed refresh keeps previously retained sources", () => {
    const idx = DASHBOARD.indexOf("const handleScanRefresh");
    const block = DASHBOARD.slice(idx, idx + 400);
    // The catch must not clear liveSourceRef — a failed acquisition never
    // deletes the previously good source.
    expect(block).not.toMatch(/liveSourceRef\.current\s*=\s*new Map/);
  });

  it("the panel still only renders the button when a handler exists", () => {
    // Unchanged contract — the fix is at the call site, not here.
    expect(PANEL).toContain("{onRefresh && (");
  });

  it("there is no polling interval that would mask the dead end", () => {
    // If this ever gains an interval, the reasoning above must be revisited.
    expect(DASHBOARD).not.toContain("setInterval");
  });
});
