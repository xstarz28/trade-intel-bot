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

/**
 * Phase 193 — hardcoded STATUS TOKENS inside JSX expressions.
 *
 * `jsxTextNodes` deliberately requires two consecutive words, because single
 * tokens are usually punctuation, units or symbols. That rule has a blind
 * spot: a one-word *claim* rendered from an expression, e.g.
 *
 *   {isLive ? "LIVE" : isStale ? "STALE" : "—"}
 *
 * MarketOverviewPanel shipped exactly that while `market.live` / `market.stale`
 * sat translated in all nine locales. The words are short, so the prose rule
 * skipped them — yet LIVE/STALE is a data-provenance claim, the single most
 * important thing a non-English user needs to read correctly.
 *
 * This detector is deliberately NARROW: only ALL-CAPS alphabetic tokens of
 * 3-12 characters appearing as string literals inside a JSX expression
 * container. It does not fire on imports, enum comparisons, object keys or
 * `case "LIVE":` — only on values being rendered.
 */
const STATUS_TOKEN_ALLOWED = new Set([
  // Untranslated-by-design vocabulary (see the i18n contract). These are
  // instrument/timeframe/analysis notation, identical in every locale.
  "BOS", "CHOCH", "FVG", "HTF", "LTF", "DXY", "WTI", "VIX", "SL", "TP", "RR",
  "W1", "D1", "H4", "H1", "M15", "M5", "USD", "EUR", "JPY", "GBP", "OTP",
  "API", "URL", "CSV", "JSON", "UTC", "ID",
]);

function hardcodedStatusTokens(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  // Scan only JSX expression containers: `{ ... }` that contain a quoted
  // ALL-CAPS token and sit immediately after `>` or whitespace in markup.
  // A type annotation like `plan: "GUEST" | "PREMIUM";` also lives inside
  // braces (the props object), so require the brace content to look like a
  // RENDER expression: it must contain a ternary/`&&` or be a bare literal
  // immediately following markup, and must not contain a type separator.
  const re = /\{([^{}]*?"[A-Z][A-Z_]{2,11}"[^{}]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    const body = m[1];
    const tokenMatch = /"([A-Z][A-Z_]{2,11})"/.exec(body);
    if (!tokenMatch) continue;
    const token = tokenMatch[1];
    if (STATUS_TOKEN_ALLOWED.has(token)) continue;
    // Type unions / declarations, not rendered values.
    if (/^[\s\w]*:\s*"/.test(body) || body.includes("|")) continue;
    // Only flag values produced by a render expression.
    if (!/\?|&&/.test(body)) continue;
    // A COMPARISON against the token selects behaviour (a CSS class, a
    // colour); it does not render the word. `x === "SUPPORTING" ? cls : cls`
    // is correct code. Only flag a token that appears as a RESULT — i.e. on
    // the right-hand side of `?` or `:` without being compared first.
    if (new RegExp(`[=!]==?\\s*"${token}"`).test(body)) continue;
    // Class-name payloads are styling, not copy.
    if (/\b(?:text|bg|border|fill|stroke)-/.test(body)) continue;
    // The token is an ENUM ARGUMENT handed to a mapper that returns
    // translated copy — `mapSeverity("CAUTION", t)`, possibly spread over
    // several lines with a ternary inside. That is the CORRECT localization
    // path, so flagging it would punish good code.
    if (/\bmap[A-Za-z]*\s*\(/.test(body)) continue;
    // `?? "NONE"` supplies a DATA default that is then mapped downstream.
    if (new RegExp(`\\?\\?\\s*"${token}"`).test(body)) continue;
    // Same for a constant lookup keyed by the token: `COLORS.CAUTION`.
    if (new RegExp(`[A-Z_]+\\.${token}\\b`).test(body)) continue;
    // Ignore non-render contexts that legitimately use caps string literals.
    const context = withoutComments.slice(Math.max(0, m.index - 60), m.index);
    if (/(case|===|!==|includes|Set\(|\bkey=|import|from|type |enum )\s*$/.test(context)) continue;
    if (/[.:]\s*$/.test(context)) continue;
    out.push(`{…"${token}"…}`);
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
  "src/components/AnalysisResult.tsx":
    "36 literal strings; the largest authenticated surface — needs a dedicated localization phase",
  "src/components/analytical-context-panel.tsx":
    "12 hardcoded title attributes plus a panel heading",
  "src/components/PositionRegistrationPanel.tsx":
    "form labels and placeholders for position registration",
  "src/components/Journal.tsx":
    "journal entry form labels; journal.* keys exist but are unwired",
  "src/components/CustomAlertRulesPanel.tsx":
    "alert rule builder labels and placeholders",
  "src/components/NotificationCenter.tsx":
    "notification filter labels",
  "src/components/ProtectionAlertCenter.tsx":
    "alert centre headings and severity filters",
  "src/components/PositionProtectionControlCenter.tsx":
    "control centre headings and status text",
  "src/components/PositionProtectionDetail.tsx":
    "protection reference headings",
  "src/components/HistoricalTimeline.tsx":
    "timeline section headings",
  "src/components/LogoDropdown.tsx":
    "navigation menu item labels",
  "src/components/InstrumentInput.tsx":
    "one placeholder attribute on the symbol field",
  "src/components/PositionRegistrationForm.tsx":
    "one placeholder attribute on the entry form",
  "src/components/TraderWorkspace.tsx":
    "one hardcoded section heading (Thesis Distribution)",
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
      const violations = [...jsxTextNodes(source), ...hardcodedAttributes(source)];
      // A cleaned-up file must be removed from the list, not left behind.
      expect(
        violations.length,
        `${path} is clean — remove it from COMPONENT_DEBT`,
      ).toBeGreaterThan(0);
    }
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
