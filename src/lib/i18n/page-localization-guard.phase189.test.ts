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

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// Phase 194 — the detector now lives in ONE place so the guard and the
// debt-inventory script cannot drift apart. Logic moved verbatim.
import {
  hardcodedAttributes,
  hardcodedStatusTokens,
  jsxTextNodes,
  singleWordJsxProse,
} from "@/lib/i18n/hardcoded-copy-detector";

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

const PAGES = walk("src/pages");

/**
 * Phase 191 — authenticated shared components.
 *
 * `src/pages` has been guarded since Phase 189, but most authenticated UI
 * lives in `src/components`, which was never walked. Measuring it found 15 of
 * 29 components still carrying hardcoded English.
 *
 * That is too large to localize safely inside a copy-truthfulness phase, and
 * rushing it would mean machine-translating trading terminology under time
 * pressure — the opposite of what Phase 190 established. So the debt is
 * RECORDED as a ratchet rather than hidden behind an exemption:
 *
 *   - components NOT on this list must stay clean (regression protection),
 *   - components ON this list must still have violations, so each one fails
 *     the moment it is fixed and is removed from the list.
 *
 * The list may only shrink. Growing it requires a deliberate edit here.
 */
const COMPONENTS = walk("src/components");

const COMPONENT_DEBT: Record<string, string> = {
  "src/components/analytical-context-panel.tsx":
    "12 hardcoded title attributes plus a panel heading",
  "src/components/PositionRegistrationPanel.tsx":
    "form labels and placeholders for position registration",
  "src/components/ProtectionAlertCenter.tsx":
    "alert centre headings and severity filters",
  "src/components/PositionProtectionControlCenter.tsx":
    "control centre headings and status text",
  "src/components/PositionProtectionDetail.tsx":
    "protection reference headings",
  "src/components/LogoDropdown.tsx":
    "navigation menu item labels",

  // ─── Phase 197: the Phase 195 detector-extension backlog is CLEARED ───
  // Every MOUNTED component now has zero localization debt. The six entries
  // above are unmounted components (no route or parent renders them); they are
  // deliberately not localized and are tracked, not fixed. If any of them is
  // ever mounted, it must be localized in the same change.
};

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

  it("191 — authenticated components are walked, not ignored", () => {
    // Most authenticated UI lives in src/components. If the walker returns
    // nothing the ratchet below is decoration.
    expect(COMPONENTS.length).toBeGreaterThan(20);
    expect(COMPONENTS).toContain("src/components/AnalysisResult.tsx");
    expect(COMPONENTS).toContain("src/components/PositionProtectionDashboard.tsx");
  });

  it("191 — every recorded component debt is real and justified", () => {
    for (const [path, reason] of Object.entries(COMPONENT_DEBT)) {
      expect(COMPONENTS, `${path} is listed but not walked`).toContain(path);
      expect(reason.length, `${path} needs a stated reason`).toBeGreaterThan(20);
      const source = readFileSync(resolve(ROOT, path), "utf8");
      const violations = [
        ...jsxTextNodes(source),
        ...hardcodedAttributes(source),
        ...singleWordJsxProse(source),
      ];
      // A cleaned-up file must be removed from the list, not left behind.
      expect(
        violations.length,
        `${path} is clean — remove it from COMPONENT_DEBT`,
      ).toBeGreaterThan(0);
    }
  });

  it("197 — no MOUNTED component carries localization debt", () => {
    // THE PHASE 197 INVARIANT, stated executably.
    //
    // COMPONENT_DEBT may only ever contain UNMOUNTED components. A mounted
    // component is one reachable by following imports from src/main.tsx — i.e.
    // one a real user can actually see. The moment such a component acquires
    // hardcoded copy, this fails; the moment one of the tracked unmounted
    // components is wired up, this fails too, forcing it to be localized in
    // the same change rather than shipping untranslated.
    //
    // Reachability is recomputed here rather than read from the inventory's
    // JSON output: a guard that trusts a generated artifact can be satisfied
    // by regenerating the artifact.
    const reachable = reachableFromEntry(resolve(ROOT, "src/main.tsx"));
    const mountedWithDebt = Object.keys(COMPONENT_DEBT).filter((path) =>
      reachable.has(resolve(ROOT, path)),
    );
    expect(
      mountedWithDebt,
      "a user-visible component is carrying untranslated copy",
    ).toEqual([]);
  });

  it("197 — the reachability walk is not vacuously empty", () => {
    // Without this, a broken resolver would make the invariant above pass by
    // finding nothing mounted at all.
    const reachable = reachableFromEntry(resolve(ROOT, "src/main.tsx"));
    expect(reachable.size).toBeGreaterThan(50);
    // Known-mounted anchors: if these are missing the walk is wrong.
    expect(reachable).toContain(resolve(ROOT, "src/components/Journal.tsx"));
    expect(reachable).toContain(
      resolve(ROOT, "src/components/HistoricalTimeline.tsx"),
    );
    // A known-unmounted component must NOT be reachable.
    expect(reachable).not.toContain(
      resolve(ROOT, "src/components/PositionProtectionDetail.tsx"),
    );
  });

  it("191 — components outside the debt list stay clean", () => {
    const clean = COMPONENTS.filter((c) => !(c in COMPONENT_DEBT));
    // Regression protection: this set must never acquire new violations.
    expect(clean.length).toBeGreaterThan(10);
    for (const path of clean) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      const violations = [
        ...jsxTextNodes(source),
        ...hardcodedAttributes(source),
        ...hardcodedStatusTokens(source),
        // Phase 195: single-word JSX prose ("entry", "support", "invalidation").
        // Omitting this rule hid 109 real labels in AnalysisResult alone.
        ...singleWordJsxProse(source),
      ];
      expect(violations, `new hardcoded copy in ${path}`).toEqual([]);
    }
  });

  it("191 — the protection dashboard is localized and stays that way", () => {
    // It renders the execution-boundary guarantee, so it must not regress.
    const path = "src/components/PositionProtectionDashboard.tsx";
    expect(path in COMPONENT_DEBT, "dashboard must remain clean").toBe(false);
    const source = readFileSync(resolve(ROOT, path), "utf8");
    expect(source).toContain("useI18n");
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
      const violations = [
        ...jsxTextNodes(source),
        ...hardcodedAttributes(source),
        ...singleWordJsxProse(source),
      ];
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


/**
 * Follow static and dynamic imports from an entry module.
 *
 * Deliberately duplicated from scripts/component-debt-inventory.mjs rather
 * than imported: the guard must not depend on a script that is itself part of
 * the thing being guarded, and a test that imports its subject's own helper
 * can be satisfied by breaking that helper.
 */
function reachableFromEntry(entry: string): Set<string> {
  const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];
  const seen = new Set<string>();
  const queue = [entry];

  const resolveImport = (spec: string, from: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = resolve(ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else return null;
    for (const ext of ["", ...EXTENSIONS]) {
      const candidate = base + ext;
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  };

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of [
      ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ]) {
      const target = resolveImport(match[1], file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}
