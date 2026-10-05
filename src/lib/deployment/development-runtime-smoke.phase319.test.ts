/**
 * Phase 319 — the smoke's RESOURCE MODE (`--domains none|exact`).
 *
 * Monthly Convex free-plan resource limits made every wasted catalog walk a
 * real cost. Acceptance runs only ever needed the EXACT identities, but the
 * harness unconditionally walked every generic domain's catalog (Twelve Data
 * credits + action compute + staging writes + discovery-ranked analyses that
 * produced zero annotations). This suite pins the resource-mode semantics by
 * reading the REAL script artifact (same pattern as the phase-287 suite), so
 * the mode cannot silently regress:
 *
 *   - `--domains none` / `--domains exact` selects NO generic domains;
 *   - an exact-only run refuses to start without exact instruments;
 *   - a generic empty/unknown domains list still refuses (no silent full walk);
 *   - the run announces the skipped work on the run's annotations.
 *
 * Nothing here contacts a network.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const script = readFileSync(
  resolve(process.cwd(), "scripts/development-runtime-smoke.mjs"),
  "utf8",
);

describe("319 — smoke resource mode (exact-only runs)", () => {
  it("parses `none` and `exact` as the exact-only domain selectors", () => {
    expect(script).toMatch(/const EXACT_ONLY = domainsArg === "none" \|\| domainsArg === "exact";/);
  });

  it("exact-only selection yields an EMPTY generic domain list", () => {
    expect(script).toMatch(
      /: EXACT_ONLY\n\s+\? \[\]\n\s+: DOMAIN_SPECS;/,
    );
  });

  it("refuses an exact-only run that carries no exact instruments", () => {
    expect(script).toMatch(
      /REFUSED: --domains none\/exact is exact-only and no exact instruments were given/,
    );
    // The refusal must consider the exact specs — not fire unconditionally.
    expect(script).toMatch(/specs\.length === 0 && !exactParsed\.ok/);
  });

  it("still refuses an empty or unknown generic domains list without exact specs", () => {
    expect(script).toMatch(/REFUSED: no known domain selected \(crypto\|forex\|stock\|commodity\|none\)/);
  });

  it("announces the skipped work on the run's annotations", () => {
    expect(script).toMatch(/EXACT-ONLY RUN \(Phase 319 resource mode\)/);
    expect(script).toMatch(/the Twelve Data catalog walk, OKX discovery and domain analyses are skipped/);
  });

  it("the discovery walk stays lazy — no catalog walk without a generic domain", () => {
    // The OKX discovery only runs when a spec needs it...
    expect(script).toMatch(/specs\.some\(\(s\) => s\.discovery === "okx"\)/);
    // ...and the Twelve Data walk lives inside the per-domain loop guard.
    expect(script).toMatch(/twelveDiscovery === null && twelveDiscoveryError === null/);
  });
});
