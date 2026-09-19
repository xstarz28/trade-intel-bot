#!/usr/bin/env node
/**
 * Phase 194 — mounted-component hardcoded-copy inventory.
 *
 * Re-measures the debt using the SAME detector the guard uses
 * (`src/lib/i18n/hardcoded-copy-detector.ts`, loaded through esbuild) so the
 * report and the guard can never disagree. Per §12 there is no second scanner.
 *
 * It adds one thing the guard does not have: MOUNTEDNESS. Phase 193 proved
 * that a component nothing mounts renders to nobody, so localizing it would
 * reduce a number without helping a single user. Reachability is computed from
 * the real entry point `src/main.tsx`.
 *
 *   usage: node scripts/component-debt-inventory.mjs [--json] [--markdown]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const SKIP_DIR = new Set(["ui", "__generated__", "_generated", "node_modules"]);

/** Load the shared detector (TypeScript) by bundling it to ESM first. */
async function loadDetector() {
  const dir = mkdtempSync(join(tmpdir(), "debt-"));
  const out = join(dir, "detector.mjs");
  execFileSync(
    join(ROOT, "node_modules", ".bin", "esbuild"),
    [
      join(SRC, "lib", "i18n", "hardcoded-copy-detector.ts"),
      "--bundle",
      "--format=esm",
      "--platform=neutral",
      `--outfile=${out}`,
    ],
    { stdio: "pipe" },
  );
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIR.has(entry)) continue;
      walk(full, acc);
      continue;
    }
    if (!entry.endsWith(".tsx") || entry.includes(".test.")) continue;
    acc.push(full);
  }
  return acc;
}

// ── Mountedness, reused from the Phase 193 approach ────────────

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(join(fromFile, ".."), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* next candidate */
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
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of [
      ...src.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ]) {
      const target = resolveImport(m[1], file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

// ── Classification (§2) ────────────────────────────────────────

/**
 * Categorise a single finding. Every finding lands in exactly one bucket —
 * there is no "ignore" bucket, because that is where real defects hide.
 */
function classify(finding, TECHNICAL_TOKENS) {
  const tokenMatch = /^\{…"([A-Z_]+)"…\}$/.exec(finding);
  if (tokenMatch) {
    return TECHNICAL_TOKENS.has(tokenMatch[1])
      ? { category: "TECHNICAL_NOTATION", action: "retain untranslated" }
      : { category: "USER_FACING_COPY", action: "localize" };
  }
  if (finding.startsWith("placeholder=") || finding.startsWith("aria-label=") || finding.startsWith("title=")) {
    return { category: "USER_FACING_COPY", action: "localize (attribute)" };
  }
  // Pure notation strings such as "BOS / CHoCH" would not reach here because
  // jsxTextNodes needs two alphabetic words; anything that does is prose.
  return { category: "USER_FACING_COPY", action: "localize" };
}

// ── Main ───────────────────────────────────────────────────────

const { detectHardcodedCopy, TECHNICAL_TOKENS } = await loadDetector();
const reachable = reachableModules(join(SRC, "main.tsx"));

const files = [...walk(join(SRC, "components")), ...walk(join(SRC, "pages"))];
const rows = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, "utf8");
  const findings = detectHardcodedCopy(source);
  if (findings.length === 0) continue;
  const mounted = reachable.has(file);
  for (const finding of findings) {
    const { category, action } = classify(finding, TECHNICAL_TOKENS);
    rows.push({
      component: rel.split("/").pop().replace(/\.tsx$/, ""),
      file: rel,
      string: finding,
      mounted,
      userFacing: category === "USER_FACING_COPY",
      category,
      action: mounted ? action : `${action} — but component is UNMOUNTED`,
    });
  }
}

const byFile = new Map();
for (const r of rows) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}

const mountedFiles = [...byFile.keys()].filter((f) => byFile.get(f)[0].mounted);
const unmountedFiles = [...byFile.keys()].filter((f) => !byFile.get(f)[0].mounted);
const mountedStrings = rows.filter((r) => r.mounted).length;

const summary = {
  totalFilesWithDebt: byFile.size,
  mountedFilesWithDebt: mountedFiles.length,
  unmountedFilesWithDebt: unmountedFiles.length,
  totalStrings: rows.length,
  mountedStrings,
  unmountedStrings: rows.length - mountedStrings,
  mountedFiles: mountedFiles
    .map((f) => ({ file: f, count: byFile.get(f).length }))
    .sort((a, b) => b.count - a.count),
  unmountedFiles: unmountedFiles
    .map((f) => ({ file: f, count: byFile.get(f).length }))
    .sort((a, b) => b.count - a.count),
  rows,
};

if (process.argv.includes("--json")) {
  writeFileSync(join(ROOT, "docs", "component-debt.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log("wrote docs/component-debt.json");
}

if (process.argv.includes("--markdown")) {
  const lines = [
    "| Component | File | String | User-facing? | Category | Action |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of rows.filter((x) => x.mounted)) {
    const str = r.string.replace(/\|/g, "\\|").slice(0, 60);
    lines.push(
      `| ${r.component} | \`${r.file}\` | \`${str}\` | ${r.userFacing ? "YES" : "no"} | ${r.category} | ${r.action} |`,
    );
  }
  writeFileSync(join(ROOT, "docs", "component-debt-table.md"), `${lines.join("\n")}\n`);
  console.log("wrote docs/component-debt-table.md");
}

console.log(`files with debt        ${summary.totalFilesWithDebt}`);
console.log(`  MOUNTED              ${summary.mountedFilesWithDebt}`);
console.log(`  unmounted            ${summary.unmountedFilesWithDebt}`);
console.log(`strings                ${summary.totalStrings}`);
console.log(`  MOUNTED (real debt)  ${summary.mountedStrings}`);
console.log(`  unmounted            ${summary.unmountedStrings}`);
console.log("\nmounted components by debt:");
for (const f of summary.mountedFiles) console.log(`  ${String(f.count).padStart(3)}  ${f.file}`);
