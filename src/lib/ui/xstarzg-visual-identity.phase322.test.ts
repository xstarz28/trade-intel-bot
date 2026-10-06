/**
 * Phase 322 — XSTARZG visual identity is pinned by artifact.
 *
 * The master visual direction (product owner reference): dark graphite /
 * charcoal metallic wall, geometric panel construction, silver/chrome
 * lettering, restrained cold-white / steel-blue illumination.
 *
 * This suite locks the TOKEN SYSTEM and its guardrails so the identity
 * cannot silently regress:
 *  - the reusable XSTARZG surface vocabulary exists (exactly once);
 *  - the palette is graphite/steel — no purple "AI SaaS" gradients return;
 *  - AI-associated icons (Sparkles/Brain/Robot/…) stay out of the UI;
 *  - the brand wordmark string is preserved;
 *  - the geometric radius token and both-scheme chrome treatment survive.
 *
 * Nothing here renders a browser; these are artifact guarantees.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const indexCss = read("src/index.css");
const indexHtml = read("index.html");

function walkTsxs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTsxs(full));
    else if ((entry.endsWith(".tsx") || entry.endsWith(".ts")) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

describe("322 — XSTARZG visual system tokens", () => {
  it("the surface vocabulary exists exactly once each", () => {
    for (const utility of [".metal-panel {", ".panel-grid {", ".chart-shell {"]) {
      expect(indexCss.split(utility).length - 1, utility).toBe(1);
    }
    // chrome-text: exactly one base definition + exactly one light override
    expect(indexCss.split(".chrome-text {").length - 1).toBe(2);
    expect(indexCss.split("@media (prefers-color-scheme: light) {\n  .chrome-text {").length - 1).toBe(1);
  });

  it("the palette is graphite/steel: dark background is near-neutral, not blue-purple", () => {
    const darkBlock = indexCss.slice(indexCss.indexOf("@media (prefers-color-scheme: dark)"));
    expect(darkBlock).toContain("--background: oklch(0.145");
    // chroma ≤ 0.01 on the dark background token (graphite, not saturated hue)
    expect(darkBlock).toMatch(/--background: oklch\(0\.145 0\.0\d+ 260\)/);
    // steel-blue illumination is the single primary in dark
    expect(darkBlock).toContain("--primary: oklch(0.78 0.065 235)");
  });

  it("surfaces are geometric: the shared radius token is crisp (0.375rem)", () => {
    expect(indexCss).toContain("--radius: 0.375rem;");
    expect(indexCss).not.toContain("--radius: 0.5rem;");
  });

  it("chrome lettering has BOTH a dark and a light (contrast-safe) treatment", () => {
    expect(indexCss).toMatch(/\.chrome-text \{[\s\S]*?oklch\(0\.95 0\.006 250\)/);
    expect(indexCss).toContain(".chrome-text {");
    expect(indexCss).toMatch(/@media \(prefers-color-scheme: light\) \{\s*\.chrome-text \{/);
  });

  it("no purple AI-SaaS gradient utilities anywhere in app source", () => {
    for (const file of walkTsxs("src")) {
      const content = read(file);
      expect(content, file).not.toMatch(/from-(purple|violet|indigo|fuchsia)-/);
      expect(content, file).not.toMatch(/via-(purple|violet|fuchsia)-/);
    }
  });

  it("AI-associated icons stay out of the UI vocabulary", () => {
    for (const file of walkTsxs("src")) {
      const content = read(file);
      expect(content, file).not.toMatch(/\bSparkles\b/);
      expect(content, file).not.toMatch(/\bBrain\b/);
      expect(content, file).not.toMatch(/\bRobot\b/);
      expect(content, file).not.toMatch(/\bWand2\b/);
    }
  });

  it("the honest brand wordmark is untouched (naming is a later phase's concern)", () => {
    expect(read("src/pages/Landing.tsx")).toContain("Xstarz Analysis");
    expect(indexHtml).toContain("Xstarz Analysis — decision-support market analysis");
  });

  it("device chrome follows the identity: graphite theme-color, old blue-black gone", () => {
    expect(indexHtml).toContain('content="#131519"');
    expect(indexHtml).toContain('content="#eef1f4"');
    expect(indexHtml).not.toContain("#0b1220");
    expect(read("src/main.tsx")).toContain("background:#131519");
  });

  it("the dist artifact guard is re-pinned to the SAME brand tokens as index.css (no drift)", () => {
    const guard = read("scripts/verify-frontend-artifact.mjs");
    expect(guard).toContain(
      "export const BRAND_PRIMARY_OKLCH = { l: 0.5, c: 0.095, h: 240 };",
    );
    expect(guard).toContain(
      "export const BRAND_PRIMARY_OKLCH_DARK = { l: 0.78, c: 0.065, h: 235 };",
    );
    // the tokens the guard pins must be the tokens the stylesheet ships
    expect(indexCss).toContain("--primary: oklch(0.5 0.095 240);");
    expect(indexCss).toContain("--primary: oklch(0.78 0.065 235);");
    // the guard must actively REFUSE both retired primaries
    expect(guard).toContain("RETIRED_XSTARZ_BLUE_PRIMARY_OKLCH = { l: 0.52, c: 0.18, h: 255 }");
    expect(guard).toContain("RETIRED_PRIMARY_OKLCH = { l: 0.6, c: 0.16, h: 170 }");
  });

  it("the application logo is chrome-on-graphite with the steel-blue illumination accent", () => {
    const logo = read("public/logo.svg");
    expect(logo).toContain('id="xstarzg-chrome"');
    expect(logo).toContain('id="xstarzg-graphite"');
    expect(logo).toContain("#9fc4e8");
    expect(logo).not.toContain("#000000");
  });
});
