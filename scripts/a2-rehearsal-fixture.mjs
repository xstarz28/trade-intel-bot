#!/usr/bin/env node
/**
 * Phase 245 — disposable rehearsal fixtures.
 *
 *   node scripts/a2-rehearsal-fixture.mjs --out <dir> [--variant full|shallow|grafted|missing-ref|extra-ref]
 *
 * The `full` variant is a bare repository the driver clones with `--source`; the
 * `shallow` variant is a shallow *working* clone the driver is handed with `--repo`.
 *
 * Builds a tiny repository that has the *shape* of the real exposure — several
 * commits that carry a synthetic credential at a recorded path, later commits that
 * do not, a couple of branches, a tag, and one ref nobody scoped — plus the fixture
 * manifest the rehearsal driver compares against.
 *
 * The credential is synthetic and obviously so (`SYNTHETIC-…`). It exists to be
 * detected, replaced and verified; it is never a real credential, and the fixture
 * never leaves the directory it is written to.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const out = resolve(flag("out", "/tmp/p245-fixture"));
const variant = flag("variant", "full");

const VALUE = "SYNTHETIC-P245-KEY-01234567890123"; // 33 characters, deliberately not a credential
const PATH_IN_REPO = "src/convex/auth/emailOtp.ts";
const fingerprint = createHash("sha256").update(`${VALUE}\n`).digest("hex").slice(0, 16);

const FIXTURE_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};
const gitTry = (args, cwd) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: FIXTURE_ENV });
  return result.status === 0 ? result.stdout.trim() : "";
};
const git = (args, cwd) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: FIXTURE_ENV });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr).trim()}`);
  return result.stdout.trim();
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/* a scratch working repository, pushed into a bare "origin" fixture */
const work = resolve(out, "work");
git(["init", "--quiet", "--initial-branch=main", work]);
writeFileSync(resolve(work, "README.md"), "# fixture\n");
const exposed = (key) => `export const otpKey = "${key}";\nexport const otpEndpoint = "https://auth.example.invalid/send_otp";\n`;
const clean = () => `export const otpKey = process.env.OTP_EMAIL_API_KEY;\nexport const otpEndpoint = "https://auth.example.invalid/send_otp";\n`;
git(["add", "-A"], work);
git(["commit", "--quiet", "-m", "fixture: unrelated root"], work);

/* three commits that carry the synthetic credential */
for (let index = 0; index < 3; index += 1) {
  mkdirSync(resolve(work, "src/convex/auth"), { recursive: true });
  writeFileSync(resolve(work, PATH_IN_REPO), exposed(VALUE));
  writeFileSync(resolve(work, `note-${index}.md`), `carrier ${index}\n`);
  git(["add", "-A"], work);
  git(["commit", "--quiet", "-m", `fixture: carrier ${index}`], work);
}

/* history that no longer carries it at the tip */
writeFileSync(resolve(work, PATH_IN_REPO), clean());
writeFileSync(resolve(work, "src/app.ts"), "export const app = 1;\n");
git(["add", "-A"], work);
git(["commit", "--quiet", "-m", "fixture: rotate the key out of source"], work);
const tipAuthor = "fixture: add an unrelated file";
writeFileSync(resolve(work, "src/other.ts"), "export const other = 2;\n");
git(["add", "-A"], work);
git(["commit", "--quiet", "-m", tipAuthor], work);

const carrierTip = git(["rev-parse", "HEAD~1"], work);
git(["branch", "phase-157-live-discovery-lifecycle", carrierTip], work);
git(["branch", "arena/01a0adfb-trade-intel-bot"], work);
git(["tag", "rc-181", carrierTip], work);
/* one ref nobody scoped: it still points into the exposed history, like a PR ref */
git(["update-ref", "refs/pull/1/head", carrierTip], work);

const origin = resolve(out, "origin.git");
git(["init", "--quiet", "--bare", origin]);
/* the fixture's default branch is main, like the repository this rehearses */
git(["-C", origin, "symbolic-ref", "HEAD", "refs/heads/main"]);
git(["push", "--quiet", origin, "refs/heads/main:refs/heads/main"], work);
git(["push", "--quiet", origin, `refs/heads/phase-157-live-discovery-lifecycle:refs/heads/phase-157-live-discovery-lifecycle`], work);
git(["push", "--quiet", origin, "refs/heads/arena/01a0adfb-trade-intel-bot:refs/heads/arena/01a0adfb-trade-intel-bot"], work);
git(["push", "--quiet", origin, "refs/tags/rc-181:refs/tags/rc-181"], work);
git(["push", "--quiet", origin, "refs/heads/main:refs/pull/1/head"], work);
rmSync(work, { recursive: true, force: true });

const scoped = ["refs/heads/main", "refs/heads/phase-157-live-discovery-lifecycle", "refs/heads/arena/01a0adfb-trade-intel-bot", "refs/tags/rc-181"];

/* the leaked blobs: the recorded path, whose content carries the synthetic value */
const leaky = new Set();
for (const line of git(["-C", origin, "rev-list", "--objects", "--all"]).split("\n")) {
  const space = line.indexOf(" ");
  if (space < 0) continue;
  const oid = line.slice(0, space);
  const objectPath = line.slice(space + 1);
  if (objectPath !== PATH_IN_REPO) continue;
  if (gitTry(["-C", origin, "cat-file", "-p", oid]).includes(VALUE)) leaky.add(oid);
}
const carries = (commit) => leaky.has(gitTry(["-C", origin, "rev-parse", `${commit}:${PATH_IN_REPO}`]));
const carrierCommits = git(["-C", origin, "rev-list", "--all"]).split("\n").filter(Boolean).filter(carries).length;
const affectedRefs = scoped.map((ref) => {
  const tip = git(["-C", origin, "rev-parse", ref]);
  return {
    ref,
    tip,
    carrierCommits: git(["-C", origin, "rev-list", tip]).split("\n").filter(Boolean).filter(carries).length,
    exposedAtTip: carries(tip),
  };
});

const variants = {
  full: origin,
  shallow: resolve(out, "shallow"),
  grafted: resolve(out, "grafted.git"),
};
if (variant === "shallow" || variant === "grafted") {
  const clone = variants[variant];
  if (variant === "shallow") {
    /* a genuinely shallow clone, made by git: the driver is handed this repository
       with `--repo` and must refuse it (a truncated history cannot be measured) */
    const shallow = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--no-single-branch", `file://${origin}`, clone], { encoding: "utf8" });
    if (shallow.status !== 0) throw new Error(`could not build the shallow fixture: ${String(shallow.stderr).trim()}`);
  } else {
    /* a graft makes the local history differ from the real one: refused for the same
       reason a shallow clone is — what it measures is not the repository */
    spawnSync("cp", ["-a", origin, clone]);
    git(["-C", clone, "remote", "add", "origin", origin]);
    mkdirSync(resolve(clone, "info"), { recursive: true });
    writeFileSync(resolve(clone, "info/grafts"), `${git(["-C", origin, "rev-parse", "refs/heads/main"])} ${git(["-C", origin, "rev-parse", "refs/heads/main~1"])}\n`);
  }
}

const manifest = {
  source: variants[variant] ?? origin,
  repository: {
    canonical: "example/fixture",
    remoteName: "origin",
    remoteUrl: "https://github.com/example/fixture.git",
    expectedBranch: "main",
    forbiddenBranches: ["main"],
  },
  credential: {
    name: "synthetic fixture credential",
    kind: "quoted literal in a source file",
    fingerprint,
    fingerprintRule: 'sha256(value + "\\n")[0:16]',
    secretLength: VALUE.length,
    path: PATH_IN_REPO,
    blob: [...leaky][0] ?? null,
    carrierCommits,
    retiredEnvNames: ["OTP_EMAIL_API_KEY"],
    thirdPartyEnvNames: [],
  },
  issuer: { identity: "auth.example.invalid", operator: "nobody", selfServiceRevocation: "absent", retiredHosts: [], procedure: [] },
  affectedRefs:
    variant === "extra-ref" ? affectedRefs.slice(0, 3) : affectedRefs.map(({ ref, carrierCommits: count, exposedAtTip }) => ({ ref, carrierCommits: count, exposedAtTip })),
  inventory: { path: "docs/secret-remediation-refs.json", generator: "scripts/secret-ref-inventory.mjs", maxAgeMs: 86400000, requiredBlobPaths: [PATH_IN_REPO] },
  a1Requirements: [],
  a2Requirements: [],
  reconciliation: [],
};
if (variant === "missing-ref") manifest.affectedRefs.push({ ref: "refs/heads/does-not-exist", carrierCommits: 3, exposedAtTip: false });
writeFileSync(resolve(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({ variant, out, source: manifest.source, fingerprint, carrierCommits, blob: manifest.credential.blob?.slice(0, 8) ?? null, scopedRefs: manifest.affectedRefs.length }, null, 2));
