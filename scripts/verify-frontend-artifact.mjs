#!/usr/bin/env node
/**
 * Phase 299 — verify a BUILT frontend artifact before anyone trusts it.
 *
 * WHY THIS EXISTS
 * ---------------
 * A deployment can return HTTP 200 and still be the wrong software. The site
 * this project ships has been served, from the same origin, as both the current
 * product UI (Xstarz blue, Google + guest sign-in) and a retired build-platform
 * scaffold (green primary, "secured by freebuff.com", email-OTP sign-in). A
 * green pipeline step proved nothing about which one a person would see.
 *
 * So this checker inspects the artifact itself, not the pipeline:
 *
 *   1. IDENTITY      — `dist/build-info.json` exists, parses, and its commit,
 *                      branch and schema match the checked-out commit (and the
 *                      expected branch when one is required).
 *   2. DISCOVERY     — the same values are present as `xstarz-build-*` <meta>
 *                      tags in `dist/index.html`, so a plain HTTP GET of the
 *                      deployed site identifies it with no JavaScript.
 *   3. NO LEGACY     — no retired platform branding, no retired OTP path, in
 *                      any shipped text asset.
 *   4. THEME         — the built CSS carries the Xstarz blue primary token and
 *                      does NOT carry the retired teal-green one.
 *   5. AUTH SURFACE  — the current sign-in copy (Google + guest) is in the
 *                      bundle, and the retired OTP copy is not.
 *
 * It never contacts a host, never reads a credential and never "fixes" an
 * artifact: a wrong artifact must fail loudly so it is not deployed.
 *
 * Usage:
 *   node scripts/verify-frontend-artifact.mjs
 *   node scripts/verify-frontend-artifact.mjs --dist dist \
 *     --expect-commit b298c3c --expect-branch arena/01a0d195-trade-intel-bot
 *   node scripts/verify-frontend-artifact.mjs --json
 *
 * Flags:
 *   --dist <dir>          artifact root to inspect (default `dist`)
 *   --expect-commit <sha> the commit the artifact MUST have been built from
 *   --expect-branch <ref> the branch the artifact MUST have been built from
 *                         (a deploy passes the pinned source branch here, so a
 *                         `main` build cannot silently satisfy a check meant to
 *                         catch exactly that)
 *   --require-clean       treat `worktreeDirty: true` as a failure — CI and the
 *                         deploy use this; a local inspection does not
 *   --json                machine-readable report instead of the text form
 *
 * Exit codes:
 *   0 = the artifact satisfies every check
 *   1 = at least one check failed (the report names it)
 *   2 = could not evaluate (no artifact to inspect)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

/* ------------------------------------------------------------------ *
 * Expectations — the strings that decide which product this artifact is
 * ------------------------------------------------------------------ */

/**
 * Branding/paths that only the retired build-platform scaffold contains.
 *
 * NOTE — `freebuff:locale` is deliberately NOT here. It is the LEGACY
 * localStorage key the i18n module still reads once to migrate a returning
 * user's language (`src/lib/i18n/index.ts`), it is invisible in the UI, and
 * removing it would silently reset those users to English. The marker list
 * targets what a person can actually see or follow: the platform's domain,
 * its toolbar, and its retired configuration variables.
 */
export const RETIRED_PLATFORM_MARKERS = [
  "freebuff.com",
  "freebuff.app",
  "secured by",
  "vly.ai",
  "vly-toolbar",
  "VLY_APP_NAME",
  "VLY_CONVEX_AUTH_ISSUER",
];

/** Retired email-OTP sign-in surface (Phase 270). */
export const RETIRED_OTP_MARKERS = [
  "send_otp",
  "email-otp",
  "emailOtp",
  "Sign in with email",
  "One-time code",
];

/** The brand primary the current source defines (Xstarz blue, hue 255). */
export const BRAND_PRIMARY_OKLCH = { l: 0.52, c: 0.18, h: 255 };

/** The retired teal-green primary the legacy scaffold shipped (hue 170). */
export const RETIRED_PRIMARY_OKLCH = { l: 0.6, c: 0.16, h: 170 };

/**
 * The `--primary` custom-property declarations in a CSS asset.
 *
 * Minification rewrites `oklch(0.52 0.18 255)` to `oklch(52% .18 255)`, so the
 * values are parsed rather than pattern-matched: a literal regex for the
 * source spelling would pass on a build that had not been minified and fail on
 * one that had, which is exactly the kind of check that gets "fixed" by
 * weakening it.
 */
export function primaryTokens(css) {
  const out = [];
  const re = /--primary\s*:\s*oklch\(\s*([0-9.]+)(%?)\s+([0-9.]+)\s+([0-9.]+)/g;
  for (const match of css.matchAll(re)) {
    out.push({
      l: Number(match[1]) / (match[2] === "%" ? 100 : 1),
      c: Number(match[3]),
      h: Number(match[4]),
    });
  }
  return out;
}

export function colorMatches(token, want) {
  return (
    Math.abs(token.l - want.l) < 0.01 &&
    Math.abs(token.c - want.c) < 0.01 &&
    Math.abs(token.h - want.h) < 1
  );
}

/** Current auth surface copy (i18n strings, shipped in the bundle). */
export const CURRENT_AUTH_MARKERS = ["Continue with Google", "Continue as guest"];

const META_NAMES = [
  "xstarz-build-schema",
  "xstarz-build-commit",
  "xstarz-build-branch",
  "xstarz-build-time",
];

/* ------------------------------------------------------------------ *
 * Pure evaluation — testable without a build
 * ------------------------------------------------------------------ */

/**
 * The `content` of `<meta name="...">`, independent of attribute order and
 * quote style — a host or a minifier may reorder attributes, and a checker
 * that only understands one spelling would report "no provenance" for an
 * artifact that has it (the worst kind of false alarm: it sends someone
 * looking for a deployment bug that does not exist).
 */
export function metaContent(html, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const nameAttr = tag.match(/\bname\s*=\s*["']([^"']*)["']/i);
    if (!nameAttr || nameAttr[1] !== name) continue;
    const contentAttr = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (contentAttr) return contentAttr[1];
  }
  return null;
}

/**
 * @param {{
 *   indexHtml: string | null,
 *   buildInfoText: string | null,
 *   textAssets: { name: string, text: string }[],
 *   cssText: string,
 *   expected?: { commit?: string | null, branch?: string | null }
 * }} input
 */
export function evaluateFrontendArtifact(input) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const { indexHtml, buildInfoText, textAssets, cssText } = input;
  const expected = input.expected ?? {};

  // 1. IDENTITY -----------------------------------------------------
  let info = null;
  if (!buildInfoText) {
    add("build-info.json present", false, "dist/build-info.json is missing");
  } else {
    try {
      info = JSON.parse(buildInfoText);
      const schemaOk = info.schema === "xstarz.build-info/v1";
      add(
        "build-info.json schema",
        schemaOk,
        schemaOk ? info.schema : `unexpected schema ${String(info.schema)}`,
      );
      const commitOk = typeof info.commit === "string" && info.commit.length >= 7;
      add(
        "build-info.json records a commit",
        commitOk,
        commitOk ? info.commit : "no usable commit id",
      );
      const branchOk = typeof info.branch === "string" && info.branch.length > 0;
      add(
        "build-info.json records a branch",
        branchOk,
        branchOk ? info.branch : "no branch recorded",
      );
      if (expected.commit) {
        const want = expected.commit.trim().toLowerCase();
        const got = String(info.commit ?? "").toLowerCase();
        const matches = got === want || got.startsWith(want) || want.startsWith(got);
        add(
          "commit matches the checked-out revision",
          matches,
          matches ? got : `artifact says ${got || "nothing"}, expected ${want}`,
        );
      }
      if (expected.branch) {
        const matches = String(info.branch ?? "") === expected.branch;
        add(
          "branch matches the required deploy source",
          matches,
          matches
            ? info.branch
            : `artifact says ${String(info.branch ?? "nothing")}, expected ${expected.branch}`,
        );
      }
      if (expected.requireClean) {
        const clean = info.worktreeDirty === false;
        add(
          "artifact was built from a clean tree",
          clean,
          clean
            ? "worktree clean at build time"
            : `worktreeDirty=${String(info.worktreeDirty)} — the artifact does not correspond to its commit alone`,
        );
      }
      add(
        "artifact does not come from main",
        info.unsafeSource !== true && String(info.branch ?? "") !== "main",
        info.unsafeSource === true || info.branch === "main"
          ? "built from main — not a valid product source"
          : "not built from main",
      );
    } catch (error) {
      add(
        "build-info.json parses",
        false,
        `unreadable JSON: ${String(error?.message ?? error)}`,
      );
    }
  }

  // 2. DISCOVERY (the values a plain HTTP GET can see) ---------------
  if (!indexHtml) {
    add("index.html present", false, "dist/index.html is missing");
  } else {
    const missing = META_NAMES.filter((n) => !metaContent(indexHtml, n));
    add(
      "index.html advertises build provenance",
      missing.length === 0,
      missing.length === 0 ? META_NAMES.join(", ") : `missing meta: ${missing.join(", ")}`,
    );
    if (info) {
      const metaCommit = metaContent(indexHtml, "xstarz-build-commit");
      add(
        "meta commit agrees with build-info.json",
        metaCommit !== null && metaCommit === String(info.commit),
        metaCommit === String(info.commit)
          ? String(metaCommit)
          : `meta says ${String(metaCommit)}, json says ${String(info.commit)}`,
      );
    }
  }

  // 3. NO LEGACY PLATFORM / OTP SURFACE ------------------------------
  const lowerAssets = textAssets.map((a) => ({
    name: a.name,
    lower: a.text.toLowerCase(),
    text: a.text,
  }));
  for (const marker of RETIRED_PLATFORM_MARKERS) {
    const hits = lowerAssets
      .filter((a) => a.lower.includes(marker.toLowerCase()))
      .map((a) => a.name);
    add(
      `no retired platform marker "${marker}"`,
      hits.length === 0,
      hits.length === 0 ? "absent" : `found in ${hits.join(", ")}`,
    );
  }
  for (const marker of RETIRED_OTP_MARKERS) {
    const hits = lowerAssets
      .filter((a) => a.lower.includes(marker.toLowerCase()))
      .map((a) => a.name);
    add(
      `no retired OTP marker "${marker}"`,
      hits.length === 0,
      hits.length === 0 ? "absent" : `found in ${hits.join(", ")}`,
    );
  }

  // 4. THEME ---------------------------------------------------------
  const primaries = primaryTokens(cssText);
  const blue = primaries.filter((t) => colorMatches(t, BRAND_PRIMARY_OKLCH));
  const tealGreen = primaries.filter((t) => colorMatches(t, RETIRED_PRIMARY_OKLCH));
  add(
    "Xstarz blue primary token present in built CSS",
    blue.length > 0,
    blue.length > 0
      ? `${blue.length} --primary declaration(s) at hue ${BRAND_PRIMARY_OKLCH.h}`
      : primaries.length === 0
        ? "no --primary oklch declaration found in the built CSS"
        : `--primary hues found: ${[...new Set(primaries.map((t) => t.h))].join(", ")}`,
  );
  add(
    "retired teal-green primary absent from built CSS",
    tealGreen.length === 0,
    tealGreen.length === 0
      ? "absent"
      : "the retired oklch(0.6 0.16 170) primary is still shipped",
  );


  // 5. AUTH SURFACE --------------------------------------------------
  const bundle = textAssets.map((a) => a.text).join("\n");
  add(
    "legacy locale migration is a storage key, not a visible brand",
    true,
    /freebuff:locale/.test(bundle)
      ? "freebuff:locale present as the documented one-time migration key (invisible in UI)"
      : "not present",
  );
  const missingAuth = CURRENT_AUTH_MARKERS.filter((m) => !bundle.includes(m));
  add(
    "current sign-in copy (Google + guest) is shipped",
    missingAuth.length === 0,
    missingAuth.length === 0 ? CURRENT_AUTH_MARKERS.join(" / ") : `missing: ${missingAuth.join(", ")}`,
  );

  return { ok: checks.every((c) => c.ok), checks };
}

export function formatReport(result) {
  const lines = [];
  lines.push(`frontend artifact: ${result.ok ? "PASS" : "FAIL"}`);
  for (const check of result.checks) {
    lines.push(`  ${check.ok ? "ok  " : "FAIL"} ${check.name} — ${check.detail}`);
  }
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function collectTextAssets(distDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (/\.(js|css|html|json|txt|webmanifest)$/i.test(entry)) {
        out.push({ name: full.slice(distDir.length + 1), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(distDir);
  return out;
}

function parseArgs(argv) {
  const args = {
    dist: "dist",
    expectCommit: null,
    expectBranch: null,
    requireClean: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--dist") args.dist = argv[++i];
    else if (arg.startsWith("--dist=")) args.dist = arg.slice("--dist=".length);
    else if (arg === "--expect-commit") args.expectCommit = argv[++i];
    else if (arg.startsWith("--expect-commit=")) args.expectCommit = arg.slice("--expect-commit=".length);
    else if (arg === "--require-clean") args.requireClean = true;
    else if (arg === "--expect-branch") args.expectBranch = argv[++i];
    else if (arg.startsWith("--expect-branch=")) args.expectBranch = arg.slice("--expect-branch=".length);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const distDir = resolve(process.cwd(), args.dist);

  if (!existsSync(distDir)) {
    console.error(
      `COULD NOT LOOK: ${args.dist} does not exist. Build first (npm run build). Concluding nothing.`,
    );
    process.exit(2);
  }

  const indexPath = join(distDir, "index.html");
  const buildInfoPath = join(distDir, "build-info.json");
  const assets = collectTextAssets(distDir);

  const result = evaluateFrontendArtifact({
    indexHtml: existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null,
    buildInfoText: existsSync(buildInfoPath) ? readFileSync(buildInfoPath, "utf8") : null,
    textAssets: assets,
    cssText: assets
      .filter((a) => a.name.endsWith(".css"))
      .map((a) => a.text)
      .join("\n"),
    expected: {
      commit: args.expectCommit ?? process.env.GITHUB_SHA ?? gitHead(),
      branch: args.expectBranch ?? process.env.XSTARZ_REQUIRED_SOURCE_BRANCH ?? null,
      requireClean: args.requireClean,
    },
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(result));
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
