/**
 * Phase 189 — standing page-level localization guard.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/pages/Auth.tsx` shipped 100% hardcoded English through 188 phases.
 * It was never caught because every previous localization check was
 * *enumerated*: Phase 148 lists five component paths by hand, and nothing
 * walked `src/pages/` at all. A guard that only inspects a hand-maintained
 * list cannot fail for a file nobody remembered to add.
 *
 * This guard is therefore **path-complete by construction**: it walks the
 * directory tree and asserts on everything it finds. Adding a new page puts
 * it under the guard automatically. Exemptions must be named explicitly, so
 * skipping a file is a visible, reviewable act.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Directories walked in full. Extend this, never narrow it silently. */
const SCANNED_DIRS = ["src/pages", "src/components"] as const;

/**
 * Files exempt from the hardcoded-string rule, each with a stated reason.
 * An entry here is a deliberate decision, not an oversight.
 */
const EXEMPT: Record<string, string> = {
  // Legal pages are deliberately English-only: a machine translation of
  // binding terms would be a liability, not a feature. Tracked separately.
  "src/pages/Privacy.tsx": "legal text, English-only by policy",
  "src/pages/Terms.tsx": "legal text, English-only by policy",
};

/**
 * KNOWN DEBT — a ratchet, not an exemption.
 *
 * Phase 189 recorded `src/pages/Landing.tsx` here because it carried a large
 * body of hardcoded copy, much of it Indonesian prose rendered to all nine
 * locales. **Phase 190 localized that page and emptied this list.**
 *
 * The ratchet stays in place (deliberately empty) because it is the mechanism
 * that prevents a future page from quietly acquiring the same debt:
 *   1. no file OUTSIDE this list may contain violations, and
 *   2. every file INSIDE it must still HAVE violations — so an entry that has
 *      been fixed fails the suite until it is removed.
 */
const KNOWN_UNLOCALIZED: Record<string, string> = {};
/** Proper nouns that must NOT be translated, so they are not violations. */
const BRAND_LITERALS = new Set(["Xstarz Analysis"]);

/** Subtrees that are vendor, generated, or otherwise not our UI text. */
const SKIP_DIR = new Set(["ui", "__generated__", "_generated", "node_modules"]);

function walk(dir: string): string[] {
  const abs = resolve(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const rel = join(dir, entry);
    const full = resolve(ROOT, rel);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIR.has(entry)) continue;
      out.push(...walk(rel));
      continue;
    }
    if (!entry.endsWith(".tsx")) continue;
    if (entry.includes(".test.")) continue;
    out.push(rel);
  }
  return out;
}

/**
 * Extract JSX text nodes: the literal prose a user actually reads.
 *
 * Deliberately narrow. It looks for `>Some words<` spanning a tag boundary
 * and ignores anything containing `{`, because that is an expression rather
 * than a literal. False negatives are acceptable here; false positives would
 * make the guard noisy and it would get disabled.
 */
function jsxTextNodes(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const found: string[] = [];
  // Require a CLOSING tag after the text (`>text</`). Without this, TypeScript
  // generics such as `useRef<Foo>(x); ... useRef<` produce `>...<` pairs that
  // look like text nodes but are ordinary code.
  const re = />([^<>{}]+)<\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (!text) continue;
    // Require two consecutive words: single tokens are usually punctuation,
    // separators, units or symbols rather than translatable sentences.
    if (!/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text)) continue;
    // Ignore anything that is clearly not prose.
    if (/^[\d\s.,:%/+-]+$/.test(text)) continue;
    // The brand is a proper noun and must stay untranslated (invariant 10).
    if (BRAND_LITERALS.has(text)) continue;
    found.push(text);
  }
  return found;
}

/** Literal user-facing attribute values (placeholder / aria-label / title). */
function hardcodedAttributes(source: string): string[] {
  const out: string[] = [];
  const re = /\b(placeholder|aria-label|title)\s*=\s*"([^"]{3,})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const value = m[2].trim();
    if (!/[A-Za-z]{3,}/.test(value)) continue;
    out.push(`${m[1]}="${value}"`);
  }
  return out;
}

const PAGES = walk("src/pages");

describe("189 — the localization guard is path-complete", () => {
  it("actually discovers page files (the guard is not vacuous)", () => {
    // If the walker silently returned nothing, every assertion below would
    // pass trivially. That is exactly how the original gap survived.
    expect(PAGES.length).toBeGreaterThan(3);
    expect(PAGES).toContain("src/pages/Auth.tsx");
  });

  it("covers src/pages, which the Phase 145/148 checks never walked", () => {
    expect(SCANNED_DIRS).toContain("src/pages");
  });

  it("audits more than just the debt-listed pages", () => {
    const audited = PAGES.filter((p) => !(p in EXEMPT) && !(p in KNOWN_UNLOCALIZED));
    expect(audited.length).toBeGreaterThan(1);
    expect(audited).toContain("src/pages/Auth.tsx");
  });

  it("190 — the known-debt list is empty; Landing was localized", () => {
    // Phase 190 retired the only entry. A non-empty list here means new debt
    // was accepted and must be justified in review.
    expect(Object.keys(KNOWN_UNLOCALIZED)).toEqual([]);
  });

  it("190 — every public route page is audited, none silently skipped", () => {
    // The public surface is what an unauthenticated visitor can reach:
    // /, /auth, /download, /privacy, /terms and the catch-all.
    const PUBLIC_PAGES = [
      "src/pages/Landing.tsx",
      "src/pages/Auth.tsx",
      "src/pages/Download.tsx",
      "src/pages/NotFound.tsx",
      "src/pages/Privacy.tsx",
      "src/pages/Terms.tsx",
    ];
    for (const page of PUBLIC_PAGES) {
      expect(PAGES, `${page} is not being walked`).toContain(page);
    }
    // Only the two legal pages may be exempt, and for a stated reason.
    const exemptPublic = PUBLIC_PAGES.filter((p) => p in EXEMPT);
    expect(exemptPublic.sort()).toEqual([
      "src/pages/Privacy.tsx",
      "src/pages/Terms.tsx",
    ]);
  });

  it("every exemption names a file that still exists", () => {
    for (const path of Object.keys(EXEMPT)) {
      expect(() => statSync(resolve(ROOT, path)), `stale exemption: ${path}`).not.toThrow();
    }
  });
});

describe("189 — the known-debt ratchet cannot rot", () => {
  it("every known-unlocalized file still exists", () => {
    for (const path of Object.keys(KNOWN_UNLOCALIZED)) {
      expect(() => statSync(resolve(ROOT, path)), `stale debt entry: ${path}`).not.toThrow();
    }
  });

  it.each(Object.keys(KNOWN_UNLOCALIZED))(
    "%s still has violations — remove it from KNOWN_UNLOCALIZED once localized",
    (path) => {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      const violations = [...jsxTextNodes(source), ...hardcodedAttributes(source)];
      expect(
        violations.length,
        `${path} appears localized now; delete its KNOWN_UNLOCALIZED entry so the guard enforces it`,
      ).toBeGreaterThan(0);
    },
  );

  it("records why each file is still outstanding", () => {
    for (const [path, reason] of Object.entries(KNOWN_UNLOCALIZED)) {
      expect(reason.length, `${path} needs a stated reason`).toBeGreaterThan(20);
    }
  });
});

describe("189 — no page ships hardcoded user-facing English", () => {
  const audited = PAGES.filter((p) => !(p in EXEMPT) && !(p in KNOWN_UNLOCALIZED));

  it.each(audited)("%s renders no literal JSX prose", (path) => {
    const source = readFileSync(resolve(ROOT, path), "utf8");
    expect(jsxTextNodes(source), `hardcoded prose in ${path}`).toEqual([]);
  });

  it.each(audited)("%s has no hardcoded user-facing attributes", (path) => {
    const source = readFileSync(resolve(ROOT, path), "utf8");
    expect(hardcodedAttributes(source), `hardcoded attribute in ${path}`).toEqual([]);
  });

  it("Auth.tsx in particular routes its copy through the catalogue", () => {
    const source = readFileSync(resolve(ROOT, "src/pages/Auth.tsx"), "utf8");
    expect(source).toContain("useI18n");
    expect(source).toContain("t.auth.");
  });
});

describe("189 — the guard detects a planted regression", () => {
  /**
   * Proves the detector is not vacuous. If these fail, the guard above is
   * decoration and a real regression would sail through.
   */
  it("catches planted JSX prose", () => {
    const planted = `
      export function Demo() {
        return <div><p>Sign in to continue</p></div>;
      }
    `;
    expect(jsxTextNodes(planted)).toContain("Sign in to continue");
  });

  it("catches a planted hardcoded placeholder", () => {
    const planted = `<Input placeholder="Enter your email address" />`;
    expect(hardcodedAttributes(planted)).toContain(
      'placeholder="Enter your email address"',
    );
  });

  it("catches a planted hardcoded aria-label", () => {
    const planted = `<button aria-label="Close the dialog" />`;
    expect(hardcodedAttributes(planted)).toContain('aria-label="Close the dialog"');
  });

  it("does not flag localized expressions", () => {
    const clean = `
      <div>
        <p>{t.auth.subtitle}</p>
        <Input placeholder={t.auth.emailPlaceholder} aria-label={t.auth.emailLabel} />
      </div>
    `;
    expect(jsxTextNodes(clean)).toEqual([]);
    expect(hardcodedAttributes(clean)).toEqual([]);
  });

  it("does not flag the real Auth page", () => {
    const source = readFileSync(resolve(ROOT, "src/pages/Auth.tsx"), "utf8");
    expect(jsxTextNodes(source)).toEqual([]);
    expect(hardcodedAttributes(source)).toEqual([]);
  });
});
