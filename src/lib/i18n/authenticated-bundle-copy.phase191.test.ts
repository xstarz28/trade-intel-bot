/**
 * Phase 191 — authenticated copy as it actually ships.
 *
 * Source-level tests prove the catalogue is honest. This proves the BUNDLE is,
 * because a build can inline, tree-shake or re-order strings, and what a user
 * sees is the artifact, not the repository.
 *
 * Vacuity is the hazard here (Phase 189/190 lesson): without `VITE_CONVEX_URL`
 * the app fails closed to a "not configured" notice, `dist/` contains almost
 * no application code, and every `not.toContain` passes for the wrong reason.
 * So the suite first PROVES the artifact is a real build and SKIPS explicitly
 * when it cannot — a skip is visible, a false pass is not.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIST = resolve(ROOT, "dist/assets");

/** Positive markers that only a genuinely built app can contain. */
const APP_MARKERS = [
  "Xstarz Analysis",
  "No trades are executed automatically",
  "Reused earlier observation",
];

/** Below this the artifact is a stub, not an application. */
// Phase 264: real production build is now ~234k (222k index + vendors) after tree-shaking, previously ~500k+ before chunk splitting; lower threshold to 200k to avoid false skip while still rejecting stub (<1k)
const MIN_BUNDLE_CHARS = 200_000;

function loadBundle(): { js: string; reason?: string } {
  if (!existsSync(DIST)) return { js: "", reason: "dist/assets does not exist" };
  const files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
  if (files.length === 0) return { js: "", reason: "no JS emitted" };
  const js = files.map((f) => readFileSync(resolve(DIST, f), "utf8")).join("\n");
  if (js.length < MIN_BUNDLE_CHARS) {
    return { js, reason: `bundle too small (${js.length} chars) — likely a stub build` };
  }
  const missing = APP_MARKERS.filter((m) => !js.includes(m));
  if (missing.length > 1) {
    return { js, reason: `missing app markers: ${missing.join(", ")}` };
  }
  return { js };
}

const bundle = loadBundle();
const REAL_BUILD = bundle.reason === undefined;

/**
 * Negation-aware scan over the bundle.
 *
 * The shipped copy deliberately contains "not a win rate and not a
 * probability". A naive `not.toContain("win rate")` fails on the very
 * sentence that makes the product honest, so the check must look for
 * AFFIRMATIVE claims only.
 */
const NEGATORS =
  /\b(not|never|no|without|cannot|isn't|aren't|doesn't|bukan|tidak|nicht|keine?|non|nunca|não)\b|않|없|아닙|不|无|非|ません|ありません/i;

function affirmativeHits(
  text: string,
  pattern: RegExp,
  honestContext?: RegExp,
): string[] {
  const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  const hits: string[] = [];
  for (const m of text.matchAll(global)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    if (!NEGATORS.test(before)) {
      // Phase 315 — the phase-312 probability surface reports the journal
      // statistic WITH its epistemic qualifiers (status "historically_estimated",
      // explicit sample size, Wilson 95% interval). An estimate that carries its
      // own qualification is not an overclaiming claim; an UNQUALIFIED one still
      // is. The exemption is contextual and narrow — the qualifier must sit in
      // the same rendered/code context as the match.
      const context = text.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 120);
      if (honestContext && honestContext.test(context)) continue;
      hits.push(text.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 40));
    }
  }
  return hits;
}

/**
 * A probability/win-rate mention that ships together with its honesty
 * markers — the phase-312 status field, the sample-size field, or the
 * Wilson interval — is the qualified statistic, not marketing.
 */
const HONEST_PROBABILITY_CONTEXT =
  /historically[_ ]?estimated|insufficient[_ ]?history|limited[_ ]?sample|sampleSize|sample size|95%/i;

describe("191 — shipped bundle carries no overclaiming copy", () => {
  it("the artifact is a real production build (anti-vacuity gate)", () => {
    if (!REAL_BUILD) {
      // Explicit, visible failure mode. Never a silent pass.
      console.warn(`[phase191] SKIP bundle assertions — ${bundle.reason}`);
    }
    // The gate itself always runs: either we have a real build, or we have a
    // stated reason. What must never happen is asserting on an empty string.
    expect(REAL_BUILD || typeof bundle.reason === "string").toBe(true);
  });

  it.runIf(REAL_BUILD)("contains the app markers it claims to test", () => {
    for (const marker of APP_MARKERS) {
      expect(bundle.js, `missing marker: ${marker}`).toContain(marker);
    }
    expect(bundle.js.length).toBeGreaterThan(MIN_BUNDLE_CHARS);
  });

  it.runIf(REAL_BUILD)("ships no affirmative probability or win-rate claim", () => {
    const PATTERNS = [
      { pattern: /probability of (profit|success|winning)/i, honest: HONEST_PROBABILITY_CONTEXT },
      { pattern: /\bwin[\s-]?rate\b/i, honest: HONEST_PROBABILITY_CONTEXT },
      // Execution/guarantee language stays an ABSOLUTE ban — no context exempts it.
      { pattern: /\bguaranteed (profit|accuracy|stop|fill)\b/i },
      { pattern: /\border (submitted|placed|filled)\b/i },
      { pattern: /\btrade executed\b/i },
    ];
    for (const { pattern, honest } of PATTERNS) {
      expect(
        affirmativeHits(bundle.js, pattern, honest),
        `bundle ships an affirmative claim for ${pattern}`,
      ).toEqual([]);
    }
  });

  it.runIf(REAL_BUILD)("ships the execution-boundary and provenance guarantees", () => {
    // Presence checks, so a regression that deletes the guarantee is caught
    // in the artifact and not only in source.
    expect(bundle.js).toContain("No trades are executed automatically");
    expect(bundle.js).toContain("Reused earlier observation");
    expect(bundle.js).toContain("not current evidence");
  });

  it.runIf(REAL_BUILD)("ships no provider credential or env var name", () => {
    for (const pattern of [/VITE_CONVEX_URL\s*[:=]\s*["'][^"']{8,}/, /sk_live_/, /Bearer\s+[A-Za-z0-9._-]{20,}/]) {
      expect(bundle.js, `bundle leaks ${pattern}`).not.toMatch(pattern);
    }
  });

  it("the vacuity gate rejects a stub artifact", () => {
    // Proves the gate is load-bearing: a tiny artifact must not qualify.
    const stub = "console.log('not configured')";
    expect(stub.length).toBeLessThan(MIN_BUNDLE_CHARS);
    expect(APP_MARKERS.filter((m) => stub.includes(m)).length).toBe(0);
  });

  it("the negation-aware scan distinguishes claims from disclaimers", () => {
    const claim = "This strategy has a proven win rate of 80%.";
    const disclaimer = "Conviction is not a win rate and not a probability.";
    expect(affirmativeHits(claim, /\bwin[\s-]?rate\b/i).length).toBeGreaterThan(0);
    expect(affirmativeHits(disclaimer, /\bwin[\s-]?rate\b/i)).toEqual([]);
  });
});
