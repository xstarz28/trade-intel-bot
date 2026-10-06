/**
 * Phase 323 — product UX / productization guardrails.
 *
 * Phase 322 established the XSTARZG visual identity; Phase 323 turns the app
 * into a coherent product workspace. This suite pins the UX rules that make
 * the product feel human-built and professional:
 *
 *  - NO decorative violet/purple accents (steel-blue is THE accent);
 *  - NO emoji feature icons (lucide functional icons only);
 *  - NO AI-gimmick glyph in loading/run affordances (restrained ring, Play);
 *  - progress vocabulary is steel + destructive tokens, not raw palettes;
 *  - the empty state states the REAL discovered instrument count (no "∞");
 *  - blur restraint on sticky surfaces (backdrop-blur-md, not -xl);
 *  - the main workspace is reachable from the header brand;
 *  - the 322 identity utilities survive untouched;
 *  - entitlement honesty surfaces stay in place (Phase 324 pricing groundwork
 *    boundary — no invented tiers).
 *
 * Artifact-level: nothing here renders a browser.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function walkTsxs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTsxs(full));
    else if ((entry.endsWith(".tsx") || entry.endsWith(".ts")) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const dashboard = read("src/pages/Dashboard.tsx");
const instrumentInput = read("src/components/InstrumentInput.tsx");

describe("323 — decorative discipline (identity follow-ups)", () => {
  it("no violet/purple decorative classes remain in app source", () => {
    for (const file of walkTsxs("src")) {
      const content = read(file);
      expect(content, file).not.toMatch(/(text|bg|border)-(violet|purple|fuchsia)-/);
    }
  });

  it("no emoji feature icons: the ⛔ glyph is replaced by a functional icon", () => {
    for (const file of walkTsxs("src")) {
      expect(read(file), file).not.toContain("⛔");
    }
  });

  it("no Zap glyph in the run/loading affordances (Play + plain ring instead)", () => {
    expect(dashboard).not.toMatch(/\bZap\b/);
    expect(instrumentInput).not.toMatch(/\bZap\b/);
    expect(instrumentInput).toMatch(/<Play className="size-4" \/>/);
  });

  it("blur restraint: no backdrop-blur-xl on sticky surfaces", () => {
    for (const file of walkTsxs("src")) {
      expect(read(file), file).not.toMatch(/backdrop-blur-xl/);
    }
  });
});

describe("323 — workspace clarity", () => {
  it("the loading pipeline uses steel progress + destructive error tokens", () => {
    expect(dashboard).toMatch(/<X className="size-4 text-destructive shrink-0" \/>/);
    expect(dashboard).not.toMatch(/text-emerald-400/);
    expect(dashboard).not.toMatch(/border-red-500\/20/);
    expect(dashboard).toContain("border-destructive/25");
  });

  it("the empty state reports the REAL discovered instrument count — never ∞", () => {
    expect(dashboard).toContain("discoveredInstruments.length > 0 ? discoveredInstruments.length");
    expect(dashboard).not.toContain("∞");
  });

  it("the header brand returns to the main workspace", () => {
    expect(dashboard).toMatch(/<Link\s+to="\/dashboard"/);
  });
});

describe("323 — continuity and pricing groundwork boundaries", () => {
  it("the 322 identity utilities survive (chrome/metal/panel/chart vocabulary)", () => {
    const css = read("src/index.css");
    for (const utility of [".metal-panel {", ".panel-grid {", ".chrome-text {", ".chart-shell {"]) {
      expect(css.split(utility).length - 1).toBeGreaterThanOrEqual(1);
    }
    expect(read("src/pages/Landing.tsx")).toContain("chrome-text");
  });

  it("entitlement honesty stays server-authoritative and tier-free (324 boundary)", () => {
    const badge = read("src/components/EntitlementBadge.tsx");
    expect(badge).toContain("Renders ONLY what the server reported");
    expect(badge).toContain("upgradeComingSoon");
    // No invented pricing/tier marketing may appear during productization.
    expect(badge).not.toMatch(/unlimited analyses|pro tier|premium experience/i);
  });
});
