#!/usr/bin/env bash
#
# Phase 244 — mutation suite: can the readiness kit claim something it cannot?
#
# WHAT IT ANSWERS
# Phases 241/242 asked whether a release can be declared ready or admitted without
# evidence; Phase 243 asked whether production configuration can be accepted
# wrongly. This one asks the execution question: can the A1/A2 readiness checkers
# be made to say READY_TO_REVOKE / READY_TO_REWRITE for the wrong issuer, the
# wrong credential, the wrong repository, the wrong refs, an incomplete or empty
# inventory, a dirty worktree or missing rollback evidence — and can the
# destructive capability they claim not to have become reachable.
#
# TWO OBSERVABLES
#   * the focused suites (`FOCUS`) — the behaviour of the readiness, post-check and
#     safety contracts;
#   * the OPERATOR PROBE — the real checker, run twice against the real tree:
#       P1 must REFUSE A2 today (the workspace clone is shallow, so the ref scope
#          cannot be established: exit 1);
#       P2 must ACCEPT a complete synthetic A1 precheck (exit 0).
#     A mutant that flips either exit code has changed the one thing a suite could
#     have been written to expect.
#
# METHOD
# Mutations are python3 heredocs (quoted, so the shell expands nothing); each one
# asserts that its anchor occurs exactly once, so a mutation that matches nothing
# is reported INVALID rather than silently counted as caught.
#
# SAFETY
# Baseline first, probes included. Restore is byte-exact via `cmp`, under `trap`.
# No mutant performs a real operation: the two mutants that add a process call add
# a guarded `git` call the allowlist refuses, and the one that adds a network call
# points at a loopback discard port. No ref is written, no issuer is contacted, no
# credential is touched, and nothing is deployed or sent.
set -uo pipefail
cd "$(dirname "$0")/.."

MANIFEST="src/lib/deployment/remediation-manifest.ts"
READINESS="src/lib/deployment/remediation-readiness.ts"
POSTCHECK="src/lib/deployment/remediation-postcheck.ts"
CHECKER="scripts/verify-remediation-readiness.mjs"
SUITE_MANIFEST="src/lib/deployment/remediation-manifest.phase244.test.ts"
SUITE_A1="src/lib/deployment/a1-readiness.phase244.test.ts"
SUITE_A2="src/lib/deployment/a2-readiness.phase244.test.ts"
SUITE_SAFETY="src/lib/deployment/remediation-safety.phase244.test.ts"
ADMISSION="src/lib/deployment/release-admission.ts"
GATE="src/lib/deployment/release-gate.ts"

TARGETS=(
  "$MANIFEST"
  "$READINESS"
  "$POSTCHECK"
  "$CHECKER"
  "$ADMISSION"
  "$GATE"
)

arm_backups() {
  for f in "${TARGETS[@]}"; do cp "$f" "$f.p244bak"; done
}

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p244bak" "$f"
    cmp -s "$f" "$f.p244bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}

cleanup() {
  for f in "${TARGETS[@]}"; do
    if [ -f "$f.p244bak" ]; then cp "$f.p244bak" "$f"; rm -f "$f.p244bak"; fi
  done
}
trap cleanup EXIT

FOCUS=(
  "$SUITE_MANIFEST"
  "$SUITE_A1"
  "$SUITE_A2"
  "$SUITE_SAFETY"
  # The Phase 241 suite is the observable for "documentation is not verification":
  # it builds synthetic prerequisites, so widening what counts as a verifying
  # source is visible there even though no Phase 244 fixture is affected.
  "src/lib/deployment/release-gate-failclosed.phase241.test.ts"
)

FIXDIR=/tmp/p244-probe
NOW_MS=$(date +%s000)

# The probe fixtures are derived from the manifest itself, so the probe cannot
# drift from the values the checkers compare against.
build_fixtures() {
  rm -rf "$FIXDIR"; mkdir -p "$FIXDIR"
  python3 - "$NOW_MS" <<'PY'
import json, re, sys
now = int(sys.argv[1])
source = open("src/lib/deployment/remediation-manifest.ts").read()
issuer = re.search(r'identity: "([^"]+)"', source).group(1)
fingerprint = re.search(r'fingerprint: "([^"]+)"', source).group(1)
records = [
    {
        "requirementId": "a1-pre-credential-identity",
        "source": "local-tooling",
        "observedAt": now - 3000,
        "subject": {"fingerprint": fingerprint},
        "detail": "synthetic probe record",
    },
    {
        "requirementId": "a1-pre-live-status",
        "source": "external-issuer",
        "observedAt": now - 2000,
        "subject": {"issuer": issuer, "fingerprint": fingerprint, "environment": "production"},
        "observation": {"endpoint": f"https://{issuer}/send_otp"},
        "detail": "synthetic probe record",
    },
    {
        "requirementId": "a1-pre-replacement-provisioned",
        "source": "external-issuer",
        "observedAt": now - 1000,
        "subject": {"issuer": issuer, "environment": "production"},
        "detail": "synthetic probe record",
    },
]
open("/tmp/p244-probe/a1-precheck.json", "w").write(json.dumps(records, indent=2) + "\n")
PY
}

# The probe: two real invocations of the operator checker. It prints "<p1>|<p2>".
run_probe() {
  local head
  head=$(git rev-parse HEAD)
  node --experimental-strip-types --no-warnings "$CHECKER" \
    --a2 --expect-candidate "$head" >/dev/null 2>&1
  local p1=$?
  node --experimental-strip-types --no-warnings "$CHECKER" \
    --a1 --issuer "$(python3 -c "import re;print(re.search(r'identity: \"([^\"]+)\"', open('$MANIFEST').read()).group(1))")" \
    --fingerprint "$(python3 -c "import re;print(re.search(r'fingerprint: \"([^\"]+)\"', open('$MANIFEST').read()).group(1))")" \
    --issuer-access available --evidence "$FIXDIR/a1-precheck.json" >/dev/null 2>&1
  local p2=$?
  echo "$p1|$p2"
}

PASSED=0; EQUIV=0; GAPS=0; N=0
EXPECTED_PROBE="1|0"

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)

  N=$((N+1))
  printf '%s' "$program" > "/tmp/p244_${N}.py"

  if ! python3 "/tmp/p244_${N}.py"; then
    echo "INVALID  $label (mutation failed to apply — proves nothing)"
    GAPS=$((GAPS+1)); restore; return
  fi

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p244bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    GAPS=$((GAPS+1)); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p244_${N}.log" 2>&1; then
    local observed; observed=$(run_probe)
    if [ "$observed" != "$EXPECTED_PROBE" ]; then
      echo "CAUGHT   $label (probe: expected exit codes $EXPECTED_PROBE, observed $observed)"
      PASSED=$((PASSED+1))
    elif [ "$expect" = "survive" ]; then
      echo "EQUIVALENT  $label (documented as unobservable: no decision changed)"
      EQUIV=$((EQUIV+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP (probe still reports $observed)"
      GAPS=$((GAPS+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- the guards flag a change documented as unobservable"
      GAPS=$((GAPS+1))
    else
      echo "CAUGHT   $label"
      PASSED=$((PASSED+1))
    fi
  fi

  restore
}

echo "── baseline ─────────────────────────────────────────────────────────────"
build_fixtures
if ! npx vitest run "${FOCUS[@]}" >/tmp/p244_baseline.log 2>&1; then
  echo "BASELINE FAILED: a focused suite is red before any mutation — fix that first."
  tail -20 /tmp/p244_baseline.log
  exit 2
fi
echo "focused suites: green"
observed_baseline=$(run_probe)
if [ "$observed_baseline" != "$EXPECTED_PROBE" ]; then
  echo "BASELINE FAILED: the probe reports $observed_baseline, expected $EXPECTED_PROBE"
  exit 2
fi
echo "operator probe: A2 refuses the real tree (exit 1), A1 accepts a complete precheck (exit 0)"
echo
echo "── mutants ──────────────────────────────────────────────────────────────"

arm_backups

# ── A1 identity and access ─────────────────────────────────────────────────
mutate "M1 the issuer identity check is skipped" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """  const issuerMatches = operatorSuppliedIssuer
    ? sameHost(declaredIssuer as string, manifest.issuer.identity)
    : false;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const issuerMatches = operatorSuppliedIssuer;"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M2 any fingerprint is accepted as the exposed credential's" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """  const fingerprintMatches =
    operatorSuppliedFingerprint && declaredFingerprint === manifest.credential.fingerprint;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const fingerprintMatches = operatorSuppliedFingerprint;"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M3 missing external issuer access is treated as available" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = '  const externalAccessAvailable = request.externalIssuerAccess === "available";'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  const externalAccessAvailable = true;"))
PY

mutate "M4 local runs, fixtures and notes count as evidence" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """        (requirement.acceptableSources as readonly string[]).includes(record.source) &&
        !NEVER_EVIDENCE.has(record.source) &&
        record.fixture !== true,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """        true,"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M5 fixture records count as external evidence" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """        !NEVER_EVIDENCE.has(record.source) &&
        record.fixture !== true,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """        !NEVER_EVIDENCE.has(record.source),"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M6 documentation is accepted as proof of revocation, in both filters" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = 'const NEVER_EVIDENCE = new Set(["fixture", "local-run", "documentation"]);'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, 'const NEVER_EVIDENCE = new Set(["fixture", "local-run"]);')
open(P, "w").write(s)

P = "src/lib/deployment/remediation-manifest.ts"
s = open(P).read()
old = '''    description:
      "The credential's status at the issuer is observed externally before revocation, so the after-state can be compared with a before-state.",
    acceptableSources: ["external-issuer"],'''
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = '''    description:
      "The credential's status at the issuer is observed externally before revocation, so the after-state can be compared with a before-state.",
    acceptableSources: ["external-issuer", "documentation"],'''
open(P, "w").write(s.replace(old, new))
PY

mutate "M7 the readiness checker opens a network connection" catch <<'PY'
import sys
P = "scripts/verify-remediation-readiness.mjs"
s = open(P).read()
old = "const argv = process.argv.slice(2);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """try { await fetch("http://127.0.0.1:9/"); } catch { /* loopback discard port */ }
const argv = process.argv.slice(2);"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M8 the readiness checker gains a ref-mutating git call" catch <<'PY'
import sys
P = "scripts/verify-remediation-readiness.mjs"
s = open(P).read()
old = 'const repository = observeRepository();'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """git(["push", "--force", "origin", "main"]);
const repository = observeRepository();"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M9 the read-only git allowlist is widened to permit ref writes" catch <<'PY'
import sys
P = "scripts/verify-remediation-readiness.mjs"
s = open(P).read()
old = '  "config",\n]);'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = '  "config",\n  "push",\n  "update-ref",\n]);'
open(P, "w").write(s.replace(old, new))
PY

# ── A2 identity, scope and hygiene ─────────────────────────────────────────
mutate "M10 a manifest ref missing from the inventory is ignored" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = '  const missingRefs = expectedRefs.filter((ref) => !measuredRefs.includes(ref));'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  const missingRefs: string[] = [];"))
PY

mutate "M11 an incomplete or unmeasurable inventory is accepted as complete" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """  if (incomplete.length > 0) {
    problems.push(...incomplete);
    return report("INCOMPLETE_REF_INVENTORY");
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  if (false) {
    problems.push(...incomplete);
    return report("INCOMPLETE_REF_INVENTORY");
  }"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M12 an empty ref set is accepted as 'nothing to rewrite'" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """    if (inventory.refs.length === 0) {
      incomplete.push(
        "the inventory lists no refs: an empty ref set is not 'nothing to rewrite', it is an absent measurement",
      );
    }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "    if (false) {\n      incomplete.push(\"unreachable\");\n    }"))
PY

mutate "M13 an unexpected affected ref is rewritten along with the manifest's" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """  if (unexpectedRefs.length > 0) {
    problems.push(
      `the inventory reports ${unexpectedRefs.length} affected ref(s) the manifest does not account for`,
    );
    return report("UNEXPECTED_REF");
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  if (false) {
    return report("UNEXPECTED_REF");
  }"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M14 the wrong repository is accepted" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
P = "src/lib/deployment/remediation-manifest.ts"
s = open(P).read()
old = """  const one = repositoryIdentity(left);
  const other = repositoryIdentity(right);
  return one !== null && other !== null && one === other;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const one = repositoryIdentity(left);
  const other = repositoryIdentity(right);
  return one !== null && other !== null;"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M15 a moved or unpinned candidate is accepted" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """  if (request.expectedCandidate === null) return report("NOT_READY");
  if (!candidateMatches) return report("WRONG_CANDIDATE");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  /* the candidate pin is no longer checked */"))
PY

mutate "M16 rewriting from main is accepted as the working branch" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = '  if (branchProblem) return report("WRONG_BRANCH");'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  if (false) return report(\"WRONG_BRANCH\");"))
PY

mutate "M17 an unclean worktree is accepted" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = '  if (!repository.worktreeClean) return report("DIRTY_WORKTREE");'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  if (false) return report("DIRTY_WORKTREE");'))
PY

mutate "M18 missing rollback and rehearsal evidence is accepted" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = '  if (evidence.unsatisfied.length > 0) return report("MISSING_BACKUP_EVIDENCE");'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  if (false) return report("MISSING_BACKUP_EVIDENCE");'))
PY

mutate "M19 the scope is called authoritative even when it cannot be measured" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """          inventory.refs.length > 0 &&
          !repository.shallow &&
          inventoryAgeMs !== null &&"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """          inventory.refs.length > 0 &&
          inventoryAgeMs !== null &&"""
open(P, "w").write(s.replace(old, new))
PY

# ── post-check contract ────────────────────────────────────────────────────
mutate "M20 a post-check is satisfied by evidence captured before the operation" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """const POST_ONLY = (record: RemediationEvidenceRecord, remediationAt: number | null): boolean =>
  remediationAt !== null && record.observedAt > remediationAt;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """const POST_ONLY = (record: RemediationEvidenceRecord, remediationAt: number | null): boolean =>
  true;"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M21 the scanner's positive control is not required" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """    passed: scan !== null && scan.positiveControl === true,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """    passed: scan !== null,"""))
PY

mutate "M22 the scan does not have to cover every manifest ref" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """      unexpectedAfter.length === 0 &&
      refsCoveredByScan,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      unexpectedAfter.length === 0,"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M23 carriers that remain reachable are ignored" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """    passed: after !== null && after.carrierCommits === 0,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """    passed: after !== null,"""))
PY

mutate "M24 a non-rejection status counts as a successful revocation" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """    (rejectionStatus === 401 || rejectionStatus === 403) &&"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    rejectionStatus !== null &&"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M25 the freshness window is dropped from the post-check" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """      const fresh = request.now - record.observedAt <= maxAgeMs && record.observedAt <= request.now;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """      const fresh = true;"""))
PY

mutate "M26 a fixture post-check record counts as issuer evidence" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """  const localSubstitutes = request.evidence.filter(
    (record) =>
      record.requirementId.startsWith("a1-post-") &&
      (record.fixture === true || record.source === "local-run" || record.source === "documentation"),
  );"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, """  const localSubstitutes: RemediationEvidenceRecord[] = [];""")
open(P, "w").write(s)
PY

mutate "M26b a fixture confirmation record counts as issuer evidence" survive <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """    confirmation.record !== null &&
    confirmation.record.source === "external-issuer" &&
    confirmation.record.fixture !== true &&"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    confirmation.record !== null &&
    confirmation.record.source === "external-issuer" &&"""
open(P, "w").write(s.replace(old, new))
PY

# ── cross-cutting: verification, admission, manifests, safety model ────────
mutate "M27 an unpassed post-check produces a VERIFIED release-gate record" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """    status: verified ? "VERIFIED" : "UNVERIFIED","""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """    status: "VERIFIED","""))
PY

mutate "M28 an unverified record borrows the external source the gate trusts" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """    source: verified ? "external-verification" : "local-run","""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """    source: "external-verification","""))
PY

mutate "M29 a damaged manifest is evaluated instead of refused" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """  if (structureProblems.length > 0) return report("NOT_READY");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """  if (false) return report("NOT_READY");"""))
PY

mutate "M30 a missing fingerprint is reported as structurally valid" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-manifest.ts"
s = open(P).read()
old = """  if (!/^[0-9a-f]{16}$/.test(manifest.credential.fingerprint))
    problems.push("credential fingerprint is not a 16-character hex prefix");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """  /* the fingerprint shape is no longer checked */"""))
PY

mutate "M31 readiness is reported as verification" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """      operation: "A1",
      outcome,
      ready: outcome === "READY_TO_REVOKE",
      remediationPerformed: false,
      verified: false,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      operation: "A1",
      outcome,
      ready: outcome === "READY_TO_REVOKE",
      remediationPerformed: false,
      verified: true as unknown as false,"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M32 the manifest's affected-ref set is dropped from the ready path" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = """      scope: {
        expectedRefs,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      scope: {
        expectedRefs: [] as readonly string[],"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M33 release admission is forced to admit" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = """      admitted,
      verdict: state.verdict.verdict,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      admitted: true,
      verdict: state.verdict.verdict,"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M39 documentation counts as verification for the release gate" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification"];'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification", "documentation"];'))
PY

mutate "M35 the safety model allows skipping into the destructive stage" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-manifest.ts"
s = open(P).read()
old = """  if (target !== from + 1) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M36 the destructive stage no longer needs an explicit operator action" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-manifest.ts"
s = open(P).read()
old = """  if (external && options.operatorConfirmation !== true) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M37 the evidence package digest ignores its own content" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """  const canonical = JSON.stringify(packageWithoutDigest);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """  const canonical = "constant";"""))
PY

mutate "M38 the evidence package claims remediation was performed" catch <<'PY'
import sys
P = "src/lib/deployment/remediation-postcheck.ts"
s = open(P).read()
old = """    containsCredentialValue: false,
    remediationPerformed: false,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    containsCredentialValue: false,
    remediationPerformed: true as unknown as false,"""
open(P, "w").write(s.replace(old, new))
PY

# ── documented equivalents: changes with no decision to observe ────────────
mutate "E1 documentation leaves the never-evidence set (the allowlist still refuses it)" survive <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = 'const NEVER_EVIDENCE = new Set(["fixture", "local-run", "documentation"]);'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'const NEVER_EVIDENCE = new Set(["fixture", "local-run"]);'))
PY

mutate "E2 a shared-scaffold advisory is reworded (prose, no decision)" survive <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = '      "the exposed key is a shared scaffold default: revoking it at the issuer affects every project that still uses it, which is the point rather than a side effect",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = '      "the exposed key is a shared scaffold default, so revocation affects other projects too",'
open(P, "w").write(s.replace(old, new))
PY

mutate "E3 the wrong-branch message is reworded (prose, no decision)" survive <<'PY'
import sys
P = "src/lib/deployment/remediation-readiness.ts"
s = open(P).read()
old = '        ? `the working branch is ${repository.branch}: it is never a rewrite context, and a rewrite performed from it would rewrite the default branch in place`'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = '        ? `refusing to rewrite from ${repository.branch}: never a rewrite context`'
open(P, "w").write(s.replace(old, new))
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
echo
echo "── tree ─────────────────────────────────────────────────────────────────"
for f in "${TARGETS[@]}"; do
  cmp -s "$f" "$f.p244bak" || echo "DIRTY: $f differs from its snapshot"
done
echo "restored byte-exact: ${#TARGETS[@]} files"
