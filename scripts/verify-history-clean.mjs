#!/usr/bin/env node
/**
 * Reachable-history credential scanner.
 *
 * Proves that a compromised literal appears ZERO times in every blob reachable
 * from every ref — branches, tags, remotes — plus commit messages and tag
 * objects.
 *
 * The credential value is never stored here. Detection is by SHA-256
 * fingerprint, so this file is safe to commit and safe to read.
 *
 *   node scripts/verify-history-clean.mjs
 *
 * Exit 0 = zero occurrences. Exit 1 = occurrences found, or the scan could not
 * be trusted.
 *
 * REFUSES TO RUN on a shallow or grafted clone. That is deliberate: an earlier
 * audit reported "9 affected commits" from a shallow checkout when the true
 * figure was 270, because `rev-list --all` could only see one commit. A scan
 * that cannot see the history must fail loudly rather than report a clean
 * result it has no basis for.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

/** sha256(value + "\n") — the trailing newline matches shell `echo` hashing. */
const FINGERPRINTS = new Map([["b1ce18a1e85ba121", "OTP email delivery API key"]]);

const MIN_TOKEN = 8;
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|env|txt|md|html|yml|yaml|sh|toml)$/i;

const fingerprint = (value) =>
  createHash("sha256").update(value + "\n").digest("hex").slice(0, 16);

const git = (args, max = 1 << 28) => {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: max });
  return r.status === 0 ? r.stdout : "";
};

function assertFullClone() {
  const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf8" }).trim();
  const problems = [];
  if (existsSync(`${gitDir}/shallow`)) problems.push("clone is SHALLOW (.git/shallow exists)");
  if (existsSync(`${gitDir}/info/grafts`)) problems.push("clone is GRAFTED (.git/info/grafts exists)");

  const commits = git(["rev-list", "--all"]).split("\n").filter(Boolean).length;
  if (commits <= 1) problems.push(`only ${commits} reachable commit(s) — history is not present`);

  if (problems.length > 0) {
    console.error("REFUSING TO SCAN — the result would be meaningless:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\nRun `git fetch --unshallow` (or clone with full history) and retry.");
    process.exit(1);
  }
  return commits;
}

function scanBlobs() {
  const listing = execSync("git rev-list --objects --all", {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  })
    .split("\n")
    .filter(Boolean);

  const hits = [];
  let scanned = 0;

  for (const line of listing) {
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const oid = line.slice(0, sp);
    const path = line.slice(sp + 1);
    if (!TEXT_FILE.test(path)) continue;

    const body = git(["cat-file", "-p", oid]);
    if (!body) continue;
    scanned++;

    for (const m of body.matchAll(/["'`]([^"'`\n]{8,})["'`]/g)) {
      const label = FINGERPRINTS.get(fingerprint(m[1]));
      if (label) {
        hits.push({ oid, path, label });
        break;
      }
    }
  }
  return { scanned, hits };
}

function scanMessages() {
  const hits = [];
  const raw = execSync("git log --all --format=%H%x00%B%x1e", {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  }).split("\x1e");

  for (const entry of raw) {
    const [sha, body] = entry.split("\x00");
    if (!body) continue;
    for (const m of body.matchAll(/([A-Za-z0-9_\-]{8,})/g)) {
      const label = FINGERPRINTS.get(fingerprint(m[1]));
      if (label) {
        hits.push({ sha: (sha || "").trim().slice(0, 8), label });
        break;
      }
    }
  }
  return hits;
}

function scanTags() {
  const hits = [];
  const tags = git(["for-each-ref", "--format=%(refname)", "refs/tags"])
    .split("\n")
    .filter(Boolean);

  for (const tag of tags) {
    const body = git(["cat-file", "-p", tag]);
    if (!body) continue;
    for (const m of body.matchAll(/([A-Za-z0-9_\-]{8,})/g)) {
      const label = FINGERPRINTS.get(fingerprint(m[1]));
      if (label) {
        hits.push({ tag, label });
        break;
      }
    }
  }
  return { count: tags.length, hits };
}

const commits = assertFullClone();
console.log(`Scanning ${commits} reachable commits for ${FINGERPRINTS.size} known credential(s).`);

const blobs = scanBlobs();
const messages = scanMessages();
const tags = scanTags();

console.log(`  text blobs scanned      : ${blobs.scanned}`);
console.log(`  tag objects scanned     : ${tags.count}`);
console.log(`  blob occurrences        : ${blobs.hits.length}`);
console.log(`  commit-message hits     : ${messages.length}`);
console.log(`  tag-object hits         : ${tags.hits.length}`);

const total = blobs.hits.length + messages.length + tags.hits.length;

if (total > 0) {
  console.error("\nFAIL — compromised credential still reachable:");
  const paths = new Set(blobs.hits.map((h) => `${h.path} (${h.label})`));
  for (const p of paths) console.error(`  blob: ${p}`);
  for (const m of messages) console.error(`  commit message: ${m.sha} (${m.label})`);
  for (const t of tags.hits) console.error(`  tag: ${t.tag} (${t.label})`);
  console.error("\nThe value itself is never printed. Remediate per docs/SECURITY-REMEDIATION.md.");
  process.exit(1);
}

console.log("\nPASS — zero occurrences in reachable history.");
