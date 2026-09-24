#!/usr/bin/env node
/**
 * Phase 193 — i18n leaf-key usage report.
 *
 * Produces the evidence behind every key classification. The point is NOT to
 * minimise the key count: it is to decide, per key, whether a missing consumer
 * is dead weight or a DROPPED UI SURFACE (a product defect).
 *
 * WHY THIS IS NOT `grep`:
 *   A raw grep for "protection.title" finds nothing, because real consumers
 *   look like `t.protection.title`, `const { protection } = t`, `tx(key)` with
 *   a computed key, or a map of config → label. Treating "grep found nothing"
 *   as "dead" is exactly the false confidence this phase forbids.
 *
 * Evidence collected per leaf key:
 *   direct        `t.a.b.c` / `translations.a.b.c` member access
 *   destructured  `const { a } = t` … then `a.b.c`
 *   literal       the dot-path appears as a string literal (tx/txi/config)
 *   dynamic       a prefix of the key is reachable via computed access
 *   test          referenced only from *.test.* files
 *
 * Keys are read by EXECUTING en.ts (via esbuild), never by parsing it, so the
 * inventory reflects the real runtime object.
 *
 *   usage: node scripts/i18n-key-usage-report.mjs [--json]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const I18N = join(SRC, "lib", "i18n");

/** Locale value files + the type/definition files are DEFINITIONS, not consumers. */
const LOCALE_FILES = new Set(
  ["en", "id", "es", "fr", "pt", "de", "ja", "ko", "zh"].map((l) => join(I18N, `${l}.ts`)),
);
const DEFINITION_FILES = new Set([join(I18N, "types.ts")]);

// ── 1. Load the real translation object ────────────────────────

function loadEnglishLeaves() {
  const dir = mkdtempSync(join(tmpdir(), "i18n-report-"));
  const out = join(dir, "en.mjs");
  execFileSync(
    join(ROOT, "node_modules", ".bin", "esbuild"),
    [join(I18N, "en.ts"), "--bundle", "--format=esm", "--platform=neutral", `--outfile=${out}`],
    { stdio: "pipe" },
  );
  return { out, dir };
}

function walkLeaves(obj, prefix, acc) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) walkLeaves(v, path, acc);
    else if (typeof v === "string") acc.push(path);
  }
  return acc;
}

// ── 2. Collect production + test sources ───────────────────────

function collectSources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "_generated" || entry === "__generated__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, acc);
    else if (/\.(ts|tsx)$/.test(full)) acc.push(full);
  }
  return acc;
}

/** Strip comments so a commented-out consumer never counts as evidence. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

// ── 2b. Module reachability from the real entry point ──────────
//
// A key consumed ONLY by a component that nothing mounts is not actually
// rendered to any user. Import-graph reachability from `src/main.tsx` is what
// separates "live consumer" from "orphaned consumer" — a distinction a text
// search cannot make, and the reason three Phase 67 components were found
// holding translations hostage.

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(join(fromFile, ".."), spec);
  else return null; // bare package
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      /* not this candidate */
    }
  }
  return null;
}

function reachableModules(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let src;
    try {
      src = stripComments(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const specs = [
      ...src.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      const target = resolveImport(spec, file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

// ── 3. Evidence extraction ─────────────────────────────────────

function analyse() {
  const { out, dir } = loadEnglishLeaves();
  return import(pathToFileURL(out).href).then((mod) => {
    const en = mod.default ?? mod.en;
    const leaves = walkLeaves(en, "", []);
    const topLevel = new Set(Object.keys(en));

    const files = collectSources(SRC);
    const reachable = reachableModules(join(SRC, "main.tsx"));
    const evidence = new Map(leaves.map((k) => [k, new Set()]));
    const dynamicPrefixes = new Set();
    const dynamicSites = [];

    for (const file of files) {
      if (LOCALE_FILES.has(file) || DEFINITION_FILES.has(file)) continue;
      const isTest = /\.test\.|\.spec\./.test(file);
      // Consumed only by a module nothing mounts => not rendered to any user.
      const orphaned = !isTest && !reachable.has(file);
      const rel = relative(ROOT, file);
      const raw = readFileSync(file, "utf8");
      const src = stripComments(raw);

      // (a) direct member access: t.a.b.c / translations.a.b.c / tr.a.b.c
      for (const m of src.matchAll(
        /\b(?:t|tr|translations|resource|en|copy)\s*((?:\.\s*[A-Za-z_$][\w$]*)+)/g,
      )) {
        const path = m[1].replace(/[\s.]+/g, ".").replace(/^\./, "");
        markPrefixPaths(path, rel, isTest ? "test" : orphaned ? "orphan" : "direct");
      }

      // (b) destructured section: const { protection, intelligence } = t
      const destructured = new Set();
      for (const m of src.matchAll(/(?:const|let)\s*\{([^}]+)\}\s*=\s*(?:t|translations)\b/g)) {
        for (const part of m[1].split(",")) {
          const name = part.split(":").pop().trim().replace(/\s.*$/, "");
          if (topLevel.has(name)) destructured.add(name);
        }
      }
      for (const section of destructured) {
        for (const m of src.matchAll(
          new RegExp(`\\b${section}\\s*((?:\\.\\s*[A-Za-z_$][\\w$]*)+)`, "g"),
        )) {
          const path = `${section}${m[1].replace(/[\s.]+/g, ".")}`;
          markPrefixPaths(path, rel, isTest ? "test" : orphaned ? "orphan" : "destructured");
        }
      }

      // (c) dot-path string literals: tx("a.b.c"), txi("a.b.c", …), config maps
      for (const m of src.matchAll(/["'`]([a-z][\w$]*(?:\.[\w$]+)+)["'`]/gi)) {
        const path = m[1];
        if (evidence.has(path))
          evidence.get(path).add(`${isTest ? "test" : orphaned ? "orphan" : "literal"}:${rel}`);
      }

      // (d) DYNAMIC access — the critical audit. A computed lookup means the
      //     whole subtree may be reachable without any literal match.
      const dynPatterns = [
        // tx(`a.b.${x}`) / txi(`a.${x}.c`)
        /\b(?:tx|txi)\s*\(\s*`([^`]*?)\$\{/g,
        // tx(variable) / txi(variable, …) — key not statically known
        /\b(?:tx|txi)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g,
        // t.section[expr] / t[expr]
        /\bt\s*\.\s*([A-Za-z_$][\w$]*)\s*\[/g,
        /\bt\s*\[\s*([A-Za-z_$][\w$]*)/g,
      ];
      for (const re of dynPatterns) {
        for (const m of src.matchAll(re)) {
          const hint = (m[1] || "").replace(/\.$/, "");
          dynamicSites.push({ file: rel, hint, snippet: m[0].trim().slice(0, 70), isTest });
          if (hint && topLevel.has(hint.split(".")[0])) dynamicPrefixes.add(hint.split(".")[0]);
        }
      }
    }

    function markPrefixPaths(path, rel, kind) {
      // `t.protection.title` marks exactly protection.title; a partial path
      // like `t.protection` marks nothing on its own (it is a section handle).
      if (evidence.has(path)) {
        evidence.get(path).add(`${kind}:${rel}`);
        return;
      }
      // A member access can continue past the leaf into a STRING METHOD:
      //   t.system.historyCount.replace("{count}", n)
      // The raw match is then `system.historyCount.replace`, which is not a
      // key. Walk back up the path until a real leaf is found, otherwise the
      // most common interpolation idiom in this codebase reads as "unused".
      const parts = path.split(".");
      for (let i = parts.length - 1; i >= 2; i--) {
        const candidate = parts.slice(0, i).join(".");
        if (evidence.has(candidate)) {
          evidence.get(candidate).add(`${kind}:${rel}`);
          return;
        }
      }
    }

    rmSync(dir, { recursive: true, force: true });
    const orphanModules = files
      .filter((f) => !/\.test\.|\.spec\./.test(f) && !reachable.has(f))
      .map((f) => relative(ROOT, f));
    return { leaves, evidence, dynamicPrefixes, dynamicSites, topLevel, orphanModules };
  });
}

// ── 4. Report ──────────────────────────────────────────────────

const { leaves, evidence, dynamicPrefixes, dynamicSites, orphanModules } = await analyse();

const rows = leaves.map((key) => {
  const ev = [...evidence.get(key)];
  const live = ev.filter((e) => !e.startsWith("test:") && !e.startsWith("orphan:"));
  const orphanOnly = live.length === 0 && ev.some((e) => e.startsWith("orphan:"));
  return {
    key,
    referenced: live.length > 0,
    orphanOnly,
    testOnly: live.length === 0 && !orphanOnly && ev.length > 0,
    evidence: ev,
    dynamicCandidate: dynamicPrefixes.has(key.split(".")[0]),
  };
});

const unref = rows.filter((r) => !r.referenced);
const json = {
  totalLeaves: leaves.length,
  referenced: rows.length - unref.length,
  unreferenced: unref.length,
  testOnly: unref.filter((r) => r.testOnly).length,
  orphanConsumerOnly: unref.filter((r) => r.orphanOnly).length,
  orphanModules,
  dynamicCandidates: unref.filter((r) => r.dynamicCandidate).length,
  dynamicPrefixes: [...dynamicPrefixes].sort(),
  dynamicSites,
  unreferencedKeys: unref.map((r) => r.key),
  keyEvidence: Object.fromEntries(unref.map((r) => [r.key, r.evidence])),
  byPrefix: {},
};
for (const r of unref) {
  const p = r.key.split(".")[0];
  json.byPrefix[p] = (json.byPrefix[p] ?? 0) + 1;
}

if (process.argv.includes("--json")) {
  const dest = join(ROOT, "docs", "i18n-key-usage.json");
  writeFileSync(dest, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote ${relative(ROOT, dest)}`);
}

console.log(`total leaf keys      ${json.totalLeaves}`);
console.log(`referenced (prod)    ${json.referenced}`);
console.log(`UNREFERENCED         ${json.unreferenced}`);
console.log(`  of which test-only ${json.testOnly}`);
console.log(`  orphan-consumer    ${json.orphanConsumerOnly}`);
console.log(`  dynamic candidates ${json.dynamicCandidates}`);
console.log(`dynamic access sites ${dynamicSites.length}`);
console.log(`unmounted modules    ${orphanModules.length}`);
console.log("\nunreferenced by section:");
for (const [p, n] of Object.entries(json.byPrefix).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${p.padEnd(18)} ${n}`);
}
