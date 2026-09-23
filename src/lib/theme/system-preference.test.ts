/**
 * System-preference theme: Xstarz blue, real light + dark palettes,
 * no forced html.dark, no localStorage theme toggle.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("src/index.css", "utf8");
const main = readFileSync("src/main.tsx", "utf8");

function oklchChannels(block: string, property: string): {
  l: number;
  c: number;
  h: number;
} | null {
  const re = new RegExp(
    `${property}:\\s*oklch\\((\\d*\\.?\\d+)\\s+(\\d*\\.?\\d+)\\s+(\\d*\\.?\\d+)\\)`,
  );
  const m = block.match(re);
  if (!m) return null;
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

function rootBlock(source: string): string {
  const start = source.search(/:root\s*\{/);
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return "";
}

function darkMediaBlock(source: string): string {
  // Require the opening brace so we do not match
  // `@custom-variant dark (@media (prefers-color-scheme: dark));`
  const start = source.search(
    /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{/,
  );
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

describe("theme: no forced dark class", () => {
  it("index.html does not force class=\"dark\" on <html>", () => {
    expect(html).not.toMatch(/<html[^>]*class=["'][^"']*\bdark\b/);
  });
});

describe("theme: system preference", () => {
  it("dark palette is gated on prefers-color-scheme", () => {
    expect(css).toMatch(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);
  });

  it("tailwind dark variant follows the system preference, not a class", () => {
    expect(css).toMatch(
      /@custom-variant\s+dark\s*\(\s*@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\)/,
    );
  });

  it("does not install a localStorage / user-toggle theme system", () => {
    expect(main).not.toMatch(/localStorage\.(get|set)Item\(\s*["']theme["']/);
    expect(css).not.toMatch(/data-theme/);
  });
});

describe("theme: light and dark palettes are real and distinct", () => {
  it("light :root is actually light", () => {
    const light = oklchChannels(rootBlock(css), "--background");
    expect(light).not.toBeNull();
    expect(light!.l).toBeGreaterThan(0.85);
  });

  it("system-dark background is actually dark", () => {
    const dark = oklchChannels(darkMediaBlock(css), "--background");
    expect(dark).not.toBeNull();
    expect(dark!.l).toBeLessThan(0.3);
  });

  it("light and dark backgrounds differ materially", () => {
    const light = oklchChannels(rootBlock(css), "--background")!;
    const dark = oklchChannels(darkMediaBlock(css), "--background")!;
    expect(Math.abs(light.l - dark.l)).toBeGreaterThan(0.5);
  });

  it("light foreground is dark text, dark foreground is light text", () => {
    const lightFg = oklchChannels(rootBlock(css), "--foreground")!;
    const darkFg = oklchChannels(darkMediaBlock(css), "--foreground")!;
    expect(lightFg.l).toBeLessThan(0.4);
    expect(darkFg.l).toBeGreaterThan(0.7);
  });
});

describe("theme: primary/accent is Xstarz blue, not the old green", () => {
  it("light primary hue is blue (not teal/green ~170)", () => {
    const primary = oklchChannels(rootBlock(css), "--primary")!;
    expect(primary.h).toBeGreaterThan(230);
    expect(primary.h).toBeLessThan(280);
    expect(primary.h).not.toBe(170);
  });

  it("dark primary hue is blue (not teal/green ~170)", () => {
    const primary = oklchChannels(darkMediaBlock(css), "--primary")!;
    expect(primary.h).toBeGreaterThan(230);
    expect(primary.h).toBeLessThan(280);
  });

  it("accent follows the blue brand, not the old green", () => {
    const light = oklchChannels(rootBlock(css), "--accent")!;
    const dark = oklchChannels(darkMediaBlock(css), "--accent")!;
    expect(light.h).toBeGreaterThan(230);
    expect(dark.h).toBeGreaterThan(230);
  });

  it("semantic bullish/bearish remain green/red", () => {
    expect(css).toMatch(/--color-bullish:\s*#10b981/);
    expect(css).toMatch(/--color-bearish:\s*#ef4444/);
  });
});

describe("theme: chrome uses semantic tokens, not dark-only hex", () => {
  it("Dashboard / Landing / Auth / EntitlementBadge use bg-background, not a hardcoded dark hex", () => {
    const files = [
      "src/pages/Dashboard.tsx",
      "src/pages/Landing.tsx",
      "src/pages/Auth.tsx",
      "src/components/EntitlementBadge.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/bg-\[#(0b1220|0a0a0a|111827)\]/);
      expect(src, file).not.toMatch(/backgroundColor:\s*["']#(0b1220|0a0a0a)/);
    }
    expect(readFileSync("src/pages/Dashboard.tsx", "utf8")).toContain(
      "bg-background",
    );
  });

  it("no page chrome walks src/pages looking for a forced dark class", () => {
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, acc);
        else if (/\.(tsx|ts)$/.test(name) && !name.includes(".test.")) acc.push(path);
      }
      return acc;
    };
    for (const file of walk("src/pages")) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/document\.documentElement\.classList\.(add|toggle)\(\s*["']dark["']/);
    }
  });
});
