#!/usr/bin/env node
/**
 * Phase 233 — per-ref exposure inventory for the Phase 184 credential.
 *
 * WHAT THIS ANSWERS
 * `verify-history-clean.mjs` answers "is the credential reachable AT ALL".
 * It cannot answer "from WHICH refs", and that is the question the rewrite
 * procedure actually needs: a ref that is not in the rewrite map keeps the
 * blob reachable and undoes the whole exercise.
 *
 * METHOD — fingerprint reachability, not ancestry
 * Exposure is decided by asking whether the fingerprinted blob is reachable
 * from a ref's tip, which is the same definition `verify-history-clean.mjs`
 * uses. No claim is derived from "this ref is probably on the same lineage as
 * an affected ref": a ref is affected only when a commit in its own history
 * holds that exact blob at that exact path. The credential VALUE is never
 * stored, printed, or hashed into the output — only its SHA-256 fingerprint
 * prefix, which is already public in this repository.
 *
 * TWO DISTINCT FACTS PER REF (they are not interchangeable)
 *   affected      — the blob is reachable somewhere in this ref's history
 *   exposedAtTip  — the ref's tip itself serves the blob in its working tree
 * `clean` at the tip does NOT mean remediated: the blob is still reachable in
 * history, so the ref still needs rewriting. Conflating these two is what made
 * the previous per-ref table misleading.
 *
 *   node scripts/secret-ref-inventory.mjs            # print the table
 *   node scripts/secret-ref-inventory.mjs --write    # update the artifact
 *
 * Exit codes match the sibling scanner's philosophy:
 *   0 - scanned, inventory produced
 *   2 - refused (shallow/grafted clone, or the remote could not be read)
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const OUT = "docs/secret-remediation-refs.json";
const FINGERPRINTS = new Map([["b1ce18a1e85ba121", "OTP email delivery API key"]]);
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|env|txt|md|html|yml|yaml|sh|toml)$/i;

const fingerprint = (value) =>
  createHash("sha256").update(value + "\n").digest("hex").slice(0, 16);

const git = (args, max = 1 << 30) => {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: max });
  return r.status === 0 ? r.stdout : "";
};

function assertUsable() {
  const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf8" }).trim();
  if (existsSync(`${gitDir}/shallow`)) {
    console.error("REFUSING — shallow clone. A per-ref scan needs real history.");
    process.exit(2);
  }
  if (git(["rev-list", "--all"]).split("\n").filter(Boolean).length <= 1) {
    console.error("REFUSING — history is not present.");
    process.exit(2);
  }
}

/**
 * Live refs AND their remote SHAs (the source of truth), or refuse.
 *
 * The SHA comes from the remote, never from a local tracking ref: resolving
 * tips locally would reintroduce exactly the fetch-state dependency Phase 233
 * exists to remove. Each tip is then required to be present locally — a stale
 * clone would otherwise be analysed against an old tip and reported as current.
 */
function liveRefs() {
  const out = git(["ls-remote", "--heads", "--tags", "origin"]);
  const byRef = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const sha = line.slice(0, tab).trim();
    const ref = line.slice(tab + 1).trim();
    if (ref.endsWith("^{}") || ref === "refs/heads/HEAD" || ref === "HEAD") continue;
    if (ref.startsWith("refs/heads/")) byRef.set(`heads/${ref.slice("refs/heads/".length)}`, sha);
    else if (ref.startsWith("refs/tags/")) byRef.set(`tags/${ref.slice("refs/tags/".length)}`, sha);
  }
  if (byRef.size === 0) {
    console.error("REFUSING — remote reported no refs; refusing to imply a clean result.");
    process.exit(2);
  }

  const knownLocal = (sha) => spawnSync("git", ["cat-file", "-e", sha]).status === 0;
  const stale = [...byRef.entries()].filter(([, sha]) => !knownLocal(sha));
  if (stale.length > 0) {
    console.error("REFUSING — the local clone does not contain these remote tips:");
    for (const [ref, sha] of stale) console.error(`  ${ref} -> ${sha.slice(0, 8)}`);
    console.error("Run `git fetch --unshallow origin` (or fetch that ref) and retry.");
    process.exit(2);
  }

  return [...byRef.entries()].map(([ref, sha]) => ({ ref, sha })).sort((a, b) => (a.ref < b.ref ? -1 : 1));
}

/** Every distinct blob reachable in history that matches a known fingerprint. */
function leakedBlobs() {
  const listing = git(["rev-list", "--objects", "--all"]).split("\n").filter(Boolean);
  const found = new Map(); // path -> Set(oid)
  const seen = new Set();

  for (const line of listing) {
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const oid = line.slice(0, sp);
    const path = line.slice(sp + 1);
    if (!path || !TEXT_FILE.test(path) || seen.has(oid)) continue;
    seen.add(oid);
    const body = git(["cat-file", "-p", oid]);
    if (!body) continue;
    for (const m of body.matchAll(/["'`]([^"'`\n]{8,})["'`]/g)) {
      if (FINGERPRINTS.has(fingerprint(m[1]))) {
        if (!found.has(path)) found.set(path, new Set());
        found.get(path).add(oid);
        break;
      }
    }
  }
  return found;
}

assertUsable();
const refs = liveRefs();
const blobs = leakedBlobs();
const historyCommits = git(["rev-list", "--all"]).split("\n").filter(Boolean).length;

if (blobs.size === 0) {
  console.error("REFUSING — no fingerprinted blob found, yet the leak is documented.");
  console.error("A clean result here would contradict the recorded exposure. Investigate.");
  process.exit(2);
}

// Commits whose tree holds a leaked blob at its recorded path.
const carriers = new Set();
const allCommits = git(["rev-list", "--all"]).split("\n").filter(Boolean);
for (const c of allCommits) {
  for (const [path, oids] of blobs) {
    const at = git(["rev-parse", `${c}:${path}`]).trim();
    if (at && oids.has(at)) {
      carriers.add(c);
      break;
    }
  }
}

const rows = refs.map(({ ref, sha: tip }) => {
  const reachable = git(["rev-list", tip]).split("\n").filter(Boolean);
  const carrierCommits = reachable.filter((c) => carriers.has(c)).length;

  let exposedAtTip = false;
  for (const [path, oids] of blobs) {
    const at = git(["rev-parse", `${tip}:${path}`]).trim();
    if (at && oids.has(at)) exposedAtTip = true;
  }
  return { ref, affected: carrierCommits > 0, carrierCommits, exposedAtTip };
});

const widest = Math.max(...rows.map((r) => r.ref.length));
console.log(`history commits: ${historyCommits}`);
console.log(`leaked blob paths: ${[...blobs.keys()].join(", ")}`);
console.log(`carrier commits: ${carriers.size}`);
console.log("");
console.log("REF".padEnd(widest), " AFFECTED  CARRIERS  EXPOSED-AT-TIP");
for (const r of rows) {
  console.log(
    r.ref.padEnd(widest),
    String(r.affected).padEnd(9),
    String(r.carrierCommits).padEnd(9),
    r.exposedAtTip ? "*** YES ***" : "no",
  );
}

const payload = {
  generatedBy: "scripts/secret-ref-inventory.mjs",
  verifiedAt: new Date().toISOString(),
  method:
    "SHA-256 fingerprint reachability of the leaked blob from each live ref tip " +
    "(blob identity, not lineage inference)",
  fingerprint: [...FINGERPRINTS.keys()][0],
  blobPaths: [...blobs.keys()],
  historyCommits,
  carrierCommits: carriers.size,
  refs: rows,
};

if (process.argv.includes("--write")) {
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nwrote ${OUT}`);
} else {
  console.log("\n(dry run — pass --write to update the artifact)");
}
