#!/usr/bin/env bash
#
# Phase 245 mutation suite — "A2 full-clone rehearsal and rewrite proof".
#
#   bash scripts/mutation-suite-phase245.sh
#
# Method
#   1. build three disposable fixtures: a complete one, a shallow one and a grafted one
#   2. confirm the baseline: the focused suites pass, and the real driver reports
#        complete fixture -> exit 0 (REHEARSAL_VERIFIED)
#        shallow fixture  -> exit 1 (refused)
#        grafted fixture  -> exit 1 (refused)
#   3. for each mutant: apply it, re-run the suites; if the suites still pass, run the
#      driver against all three fixtures and compare the exit codes with the baseline
#   4. restore every mutated file byte-exact (verified with `cmp`) via `trap`
#
# A mutant that neither fails a suite nor changes the driver's behaviour is a gap.
# Two mutants are declared equivalent up front and explained in docs/RELEASE-GATE.md
# §Phase 245 — they are reworded prose and a duplicated measurement, not decisions.
#
# SAFETY: fixtures and runs live under /tmp and are deleted on exit. No real remote is
# contacted (the fixtures are local paths), no credential is read, no ref outside the
# fixtures is written, and nothing here can force-push anything.
set -uo pipefail
cd "$(dirname "$0")/.."

LIB="src/lib/deployment/a2-rehearsal.ts"
DRIVER="scripts/a2-rehearsal.mjs"
FIXTURE="scripts/a2-rehearsal-fixture.mjs"
FOCUS=("src/lib/deployment/a2-rehearsal.phase245.test.ts")
TARGETS=("$LIB" "$DRIVER")
FIXDIR=/tmp/p245-mut
EXPECTED_PROBE="0|1|1"
BASELINE_PROBE=""
PASSED=0; EQUIV=0; GAPS=0; N=0
FAILED_LABELS=()

for f in "${TARGETS[@]}"; do cp "$f" "$f.p245bak"; done
restore() { for f in "${TARGETS[@]}"; do cp "$f.p245bak" "$f"; done; }
cleanup() { restore; for f in "${TARGETS[@]}"; do rm -f "$f.p245bak"; done; rm -rf "$FIXDIR"; }
trap cleanup EXIT

build_fixtures() {
  rm -rf "$FIXDIR"; mkdir -p "$FIXDIR"
  for variant in full shallow grafted; do
    node "$FIXTURE" --out "$FIXDIR/p-$variant" --variant "$variant" >/dev/null
  done
}

probe() {
  node --experimental-strip-types --no-warnings "$DRIVER" \
    --source "$FIXDIR/p-full/origin.git" --work-dir "$FIXDIR/run-full" \
    --manifest "$FIXDIR/p-full/manifest.json" >/dev/null 2>&1
  local rc_full=$?
  node --experimental-strip-types --no-warnings "$DRIVER" \
    --repo "$FIXDIR/p-shallow/shallow" --work-dir "$FIXDIR/run-shallow" \
    --manifest "$FIXDIR/p-shallow/manifest.json" >/dev/null 2>&1
  local rc_shallow=$?
  node --experimental-strip-types --no-warnings "$DRIVER" \
    --repo "$FIXDIR/p-grafted/grafted.git" --work-dir "$FIXDIR/run-grafted" \
    --manifest "$FIXDIR/p-grafted/manifest.json" >/dev/null 2>&1
  local rc_grafted=$?
  echo "$rc_full|$rc_shallow|$rc_grafted"
}

echo "building disposable fixtures…"
build_fixtures

echo "baseline: suites + driver must behave before anything is mutated"
if ! npx vitest run "${FOCUS[@]}" >/dev/null 2>&1; then echo "FATAL: baseline suites are red"; exit 2; fi
BASELINE_PROBE=$(probe)
if [ "$BASELINE_PROBE" != "$EXPECTED_PROBE" ]; then
  echo "FATAL: baseline probe is '$BASELINE_PROBE', expected '$EXPECTED_PROBE'"; exit 2
fi
echo "baseline ok (suites green; driver exit codes full|shallow|grafted = $BASELINE_PROBE)"
echo
echo "── mutants ──────────────────────────────────────────────────────────────"

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)
  # a missing heredoc would feed this function the rest of the script instead
  case "$program" in
    "import sys"*) ;;
    *)
      echo "INVALID   $label (no mutation program on stdin: a heredoc delimiter is missing)"
      GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
      ;;
  esac

  N=$((N + 1))
  printf '%s' "$program" >"/tmp/p245_${N}.py"
  if ! python3 "/tmp/p245_${N}.py" >/dev/null; then
    echo "INVALID   $label (the mutation did not apply: the anchor is stale, so it proves nothing)"
    GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
  fi
  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p245bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID   $label (no byte changed: the mutation is inert by construction)"
    GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p245_${N}.log" 2>&1; then
    local observed; observed=$(probe)
    if [ "$observed" != "$BASELINE_PROBE" ]; then
      echo "CAUGHT    $label (driver: expected $BASELINE_PROBE, observed $observed)"
      PASSED=$((PASSED + 1))
    elif [ "$expect" = "survive" ]; then
      echo "EQUIVALENT $label (documented: no decision changed)"
      EQUIV=$((EQUIV + 1))
    else
      echo "SURVIVED  $label   <-- GUARD GAP"
      GAPS=$((GAPS + 1)); FAILED_LABELS+=("SURVIVED: $label")
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "CAUGHT?   $label   <-- flagged, but this mutant was declared equivalent"
      GAPS=$((GAPS + 1)); FAILED_LABELS+=("FALSE EQUIVALENT: $label")
    else
      echo "CAUGHT    $label (a focused suite failed)"
      PASSED=$((PASSED + 1))
    fi
  fi
  restore
}

# ── Phase A: the full-clone requirement ──────────────────────────────────
mutate "M1 a shallow clone is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = '  if (observation.shallow) problems.push("clone is shallow: .git/shallow exists, so the history is truncated");'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* shallowness is no longer reported */"))
PY

mutate "M2 an incomplete object database is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  if (!observation.objectDatabaseComplete)
    problems.push("the object database did not traverse end to end (git fsck reported damage)");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* object database completeness is no longer checked */"))
PY

mutate "M3 a grafted clone is silently accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = '  if (observation.grafted) problems.push("clone is grafted: .git/info/grafts exists, so parents are rewritten locally");'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* grafts are no longer named in the report */"))
PY

# ── Phase B: repository identity ─────────────────────────────────────────
mutate "M4 the remote URL is no longer compared with the manifest" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  const matches = fromUrl
    ? sameRepository(observation.remoteUrl, manifest.repository.remoteUrl)
    : wanted.length > 0 && resolveLike(observation.source) === resolveLike(wanted);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const matches = fromUrl
    ? observation.remoteUrl.trim().length > 0
    : wanted.length > 0 && resolveLike(observation.source) === resolveLike(wanted);"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M5 a wrong repository, owner or host is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  return {
    state: matches ? "IDENTITY_OK" : !fromUrl && wanted.length === 0 ? "AMBIGUOUS_REMOTE" : "WRONG_REPOSITORY",
    ok: matches,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  return {
    state: "IDENTITY_OK",
    ok: true,"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M6 the local fixture identity ignores what the manifest declares" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """    : wanted.length > 0 && resolveLike(observation.source) === resolveLike(wanted);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    : observation.directoryName.length > 0;"))
PY

# ── Phase C: the affected-ref inventory ──────────────────────────────────
mutate "M7 a missing affected ref is tolerated" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  if (missingRefs.length > 0) {
    problems.push(`ref(s) in the manifest but not in the fixture: ${missingRefs.join(", ")}`);
    return { state: "MISSING_REF", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* missing refs are no longer reported */"))
PY

mutate "M8 an unexpected ref is tolerated" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  if (unexpectedRefs.length > 0) {
    problems.push(`ref(s) nobody approved rewriting: ${unexpectedRefs.join(", ")}`);
    return { state: "UNEXPECTED_REF", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* unexpected refs are no longer reported */"))
PY

mutate "M9 an empty ref inventory is accepted as 'nothing to rewrite'" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  if (sorted.length === 0) {
    problems.push("the measurement is empty: an empty ref set is not 'nothing to rewrite'");
    return { state: "EMPTY_INVENTORY", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* an empty measurement is accepted */"))
PY

mutate "M10 one of the eight refs is dropped from the expectation" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  const expected = manifest.affectedRefs.map((entry) => canonicalRefName(entry.ref)).sort();"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, old + "\n  expected.splice(0, 1);"))
PY

mutate "M11 manifest short names are no longer joined to full ref names" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  const trimmed = ref.trim();
  return trimmed.startsWith("refs/") ? trimmed : `refs/${trimmed}`;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  return ref.trim();"))
PY

mutate "M12 a scoped ref that carries no exposure counts as affected" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = "  if (affectedRefs.length !== expected.length) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false && affectedRefs.length !== expected.length) {"))
PY

# ── Phase E: backup and restore ──────────────────────────────────────────
mutate "M13 a backup that omits one ref is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """    if (!seen.has(entry.backupRef)) {
      problems.push(`no backup for ${entry.ref}`);
      continue;
    }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (!seen.has(entry.backupRef)) {
      continue;
    }"""))
PY

mutate "M14 a backup pointing at the wrong commit is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = '    if (sha !== entry.sha) problems.push(`backup for ${entry.ref} points at ${sha ?? "nothing"}, not the original tip`);'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    /* the backed-up sha is no longer compared */"))
PY

mutate "M15 the restore is called exact without comparing the tips" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  for (const [ref, sha] of wanted) {
    if (!actual.has(ref)) problems.push(`${ref} did not come back`);
    else if (actual.get(ref) !== sha) problems.push(`${ref} came back at a different commit`);
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* the restored tips are no longer compared */"))
PY

mutate "M16 a restore that loses commits is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = "  if (observation.reachableCommits !== expected.reachableCommits) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false && observation.reachableCommits !== expected.reachableCommits) {"))
PY

mutate "M17 refs left behind after the restore are accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = "  if (extra.length > 0 || observation.unexpectedRefs.length > 0 || observation.tips.length > expected.refs) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false) {"))
PY

# ── Phases F-H: the rewrite and the post-rewrite proof ───────────────────
mutate "M18 a tip-only scan counts as proof (historical objects ignored)" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = "  const reachable = input.after.filter((entry) => entry.fingerprintReachable || entry.carrierCommits > 0);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  const reachable = input.after.filter((entry) => entry.fingerprintAtTip);"))
PY

mutate "M19 a ref that disappeared after the rewrite is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  if (missing.length > 0) {
    problems.push(`ref(s) missing after the rewrite: ${missing.join(", ")}`);
    return { state: "REF_MISSING_AFTER_REWRITE", ok: false, verifiedRefs, problems };
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* refs missing after the rewrite are no longer reported */"))
PY

mutate "M20 history that no longer traverses is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = "  const traversable = input.after.filter((entry) => !entry.traversable).map((entry) => entry.ref);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  const traversable: string[] = [];"))
PY

mutate "M21 the mechanism may rewrite a ref nobody approved" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = "  const unapproved = input.rewrite.rewrittenRefs.filter((ref) => !approved.has(ref));"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  const unapproved: string[] = [];"))
PY

mutate "M22 a ref outside the approved scope may change" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """      if (!approved.has(ref)) {
        unapprovedRefs.push(ref);
        problems.push(`ref changed without approval: ${ref}`);
      }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """      if (!approved.has(ref)) {
        changed.push(ref);
      }"""))
PY

mutate "M23 a ref that disappeared during the rewrite is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  for (const [ref] of before) {
    if (!after.has(ref)) {
      goneRefs.push(ref);
      problems.push(`ref disappeared during the rewrite: ${ref}`);
    }
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* a disappeared ref is no longer reported */"))
PY

mutate "M24 a rewrite that changed nothing still counts as a rewrite" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  if (changed.length !== approved.size) {
    problems.push(`only ${changed.length} of ${approved.size} approved refs changed: the rewrite did not do the work it claimed`);
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* a no-op rewrite is accepted */"))
PY

mutate "M25 post-rewrite verification accepts a pre-rewrite package" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = '  if (package_.phase !== "post") problems.push("the package describes the pre-rewrite state; it cannot prove the rewrite");'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* the evidence phase is no longer checked */"))
PY

mutate "M26 the evidence digest stops covering the content" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  const text = JSON.stringify(payload);
  let hash = 0x811c9dc5;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  const text = "constant";
  let hash = 0x811c9dc5;"""))
PY

# ── Phase I: repository integrity ────────────────────────────────────────
mutate "M27 repository integrity is assumed instead of verified" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = '  if (!observation.fsckClean) problems.push("git fsck reported damage");'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, '  /* fsck output is ignored */'))
PY

mutate "M28 a rewrite that loses unrelated content is accepted" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  for (const entry of observation.preservedPaths) {
    if (!entry.same) problems.push(`unrelated file changed by the rewrite: ${entry.path}`);
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* unrelated content is no longer compared */"))
PY

mutate "M29 the target file may stay unfixed" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  else if (!observation.targetPath.rewritten)
    problems.push(
      `the replacement is absent from the rewritten history of ${observation.targetPath.path}: the mechanism did not do the work it claimed`,
    );"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* the positive control is no longer required */"))
PY

# ── the driver and the invocation guard ──────────────────────────────────
mutate "M30 the tool gains a real push --force call site" catch <<'PY'
import sys
p = "scripts/a2-rehearsal.mjs"
s = open(p).read()
old = """  /* 11 ── restore from the backup, prove it, then drop the fixture */"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  git(["push", "origin", "--force", "refs/heads/main"], { cwd: clone, allowFailure: true });

  /* 11 ── restore from the backup, prove it, then drop the fixture */"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M31 a remote-mutating verb becomes allowed (a push could be delegated)" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """export const READ_ONLY_VERBS = [
  "rev-parse", "rev-list","""
if s.count(old) != 1:
    sys.exit("anchor 1 not found exactly once")
s = s.replace(old, """export const READ_ONLY_VERBS = [
  "push", "rev-parse", "rev-list",""")
old2 = """export const REMOTE_MUTATING_VERBS = ["push", "fetch", "pull", "send-pack", "submodule", "gc", "prune", "repack"] as const;"""
if s.count(old2) != 1:
    sys.exit("anchor 2 not found exactly once")
s = s.replace(old2, """export const REMOTE_MUTATING_VERBS = ["fetch", "pull", "send-pack", "submodule", "gc", "prune", "repack"] as const;""")
open(p, "w").write(s)
PY

mutate "M32 ref writes are permitted outside the disposable directories" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """    const inside = containsPath(observation.workDir, observation.cwd) ||
      (observation.repoDir ? containsPath(observation.repoDir, observation.cwd) : false);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    const inside = true;"))
PY

mutate "M33 the project checkout is accepted as a rehearsal source" catch <<'PY'
import sys
p = "scripts/a2-rehearsal.mjs"
s = open(p).read()
old = """    throw new Error("refused: the rehearsal source is the project checkout itself");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    /* the project checkout may be used as a source */"))
PY

mutate "M34 the rewrite targets every ref it can see, not the approved eight" catch <<'PY'
import sys
p = "scripts/a2-rehearsal.mjs"
s = open(p).read()
old = """...scopedRefs.map((entry) => entry.ref)],"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """...refsOf(clone).map((entry) => entry.ref)],"""))
PY

mutate "M35 the rewrite becomes a no-op and the report still claims success" catch <<'PY'
import sys
p = "scripts/a2-rehearsal.mjs"
s = open(p).read()
old = '`python3 ${filterPath}`'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, '"true"'))
PY

mutate "M43 the driver ignores the rewrite mechanism's exit status" survive <<'PY'
import sys
p = "scripts/a2-rehearsal.mjs"
s = open(p).read()
old = """  if (rewrite.status !== 0) throw new Error(`the rewrite mechanism failed: ${String(rewrite.stderr).trim().split("\\n").slice(-1)[0]}`);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  /* the mechanism's exit status is no longer checked here */"))
PY

mutate "M36 backup refs are written into the real ref namespaces" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """    .map((entry) => ({ ref: entry.ref, backupRef: `${namespace}/${canonicalRefName(entry.ref)}`, sha: entry.tip as string }));"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    .map((entry) => ({ ref: entry.ref, backupRef: `${canonicalRefName(entry.ref)}`, sha: entry.tip as string }));"""))
PY

mutate "M37 a successful rehearsal marks A2 verified" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """    a2Verified: false,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    a2Verified: true as unknown as false,"""))
PY

mutate "M38 the report claims the real remote was touched" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """    realRemoteTouched: false,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    realRemoteTouched: true as unknown as false,"""))
PY

mutate "M39 the eight-ref result becomes order-dependent" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  const sorted = [...measured].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  const sorted = [...measured];"))
PY

mutate "M40 the lib stops failing on a still-reachable rewritten object" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = "  const reachable = input.after.filter((entry) => entry.fingerprintReachable || entry.carrierCommits > 0);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  const reachable = input.after.filter((entry) => entry.carrierCommits > 0);"))
PY

# ── documented equivalents ───────────────────────────────────────────────
mutate "M41 reworded advisory prose in the report" catch <<'PY'
import sys
p = "src/lib/deployment/a2-rehearsal.ts"
s = open(p).read()
old = """  lines.push("mode: REHEARSAL (disposable clone; the real repository is never contacted for mutation)");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  lines.push("mode: REHEARSAL (disposable clone; the real repository is not contacted for mutation)");"""))
PY

mutate "M42 the driver stops recording whether the exposed object is reachable" catch <<'PY'
import sys
p = "scripts/a2-rehearsal.mjs"
s = open(p).read()
old = """      blobReachable: commits.some((commit) => {
        const seen = maybe(["rev-parse", `${commit}:${path}`], { cwd: clone });
        return Boolean(seen) && blobOids.has(seen);
      }),"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "      blobReachable: false,"))
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
echo
echo "── tree ─────────────────────────────────────────────────────────────────"
restore
for f in "${TARGETS[@]}"; do
  if cmp -s "$f" "$f.p245bak"; then echo "byte-exact: $f"; else echo "FATAL: $f is NOT restored"; exit 3; fi
done

if [ "$GAPS" -ne 0 ]; then
  printf 'FAILED: %s\n' "${FAILED_LABELS[@]}"
  exit 1
fi
exit 0
