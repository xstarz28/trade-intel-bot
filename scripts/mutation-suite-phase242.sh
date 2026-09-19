#!/usr/bin/env bash
#
# Phase 242 — mutation suite: can a release be ADMITTED without being verified?
#
# WHAT IT ANSWERS
# Phase 241's suite asked whether the evaluator can be made to say READY wrongly.
# This one asks the enforcement question: can the *admission* — the thing release
# paths call — be made to admit a release, be downgraded to a report, be decided
# by CI status or by a local build, or be replaced by a second, laxer check?
#
# Every mutant below removes exactly one enforcement rule. Two observables decide
# each verdict:
#   * the focused suites (`FOCUS`) — behaviour of the admission and its guards;
#   * the BOUNDARY PROBE — `RELEASE_ADMISSION=require` must keep REFUSING this
#     release while a mandatory prerequisite is unverified. A mutant that makes
#     the boundary exit 0 has admitted a release that nothing verified, and is
#     caught even if every assertion in every suite still passes.
#
# METHOD
# Mutations are python3 heredocs (quoted, so the shell expands nothing); each one
# asserts that its anchor occurs exactly once, so a mutation that matches nothing
# is reported INVALID rather than silently counted.
#
# SAFETY
# Baseline first, probe included: with a failing suite (or a boundary that already
# admits) every mutant would read as CAUGHT, which is the false confidence this
# suite exists to remove. Restore is byte-exact via `cmp` against a `.p242bak`
# snapshot, under `trap`.
set -uo pipefail
cd "$(dirname "$0")/.."

GATE="src/lib/deployment/release-gate.ts"
ADMISSION="src/lib/deployment/release-admission.ts"
READER="src/lib/deployment/release-current-state.ts"
BOUNDARY="src/lib/deployment/release-admission.boundary.phase242.test.ts"
MAIN="src/lib/deployment/release-admission.phase242.test.ts"
ENTRY="src/lib/deployment/release-entrypoints.phase242.test.ts"
WORKFLOW=".github/workflows/release-admission.yml"
CI=".github/workflows/ci.yml"
PKG="package.json"

TARGETS=(
  "$GATE"
  "$ADMISSION"
  "$READER"
  "$BOUNDARY"
  "$WORKFLOW"
  "$CI"
  "$PKG"
)

# Backups are taken by `arm_backups`, AFTER the baseline gate: a suite that fails
# before any mutation must not leave scratch copies of source files lying around
# for the guards to trip over.
arm_backups() {
  for f in "${TARGETS[@]}"; do cp "$f" "$f.p242bak"; done
}

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p242bak" "$f"
    cmp -s "$f" "$f.p242bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'for f in "${TARGETS[@]}"; do [ -f "$f.p242bak" ] && restore && break; done; for f in "${TARGETS[@]}"; do rm -f "$f.p242bak"; done' EXIT

FOCUS=(
  "$MAIN"
  "$ENTRY"
  "$BOUNDARY"
)

PASSED=0; EQUIV=0; GAPS=0; N=0

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)

  N=$((N+1))
  printf '%s' "$program" > "/tmp/p242_${N}.py"

  if ! python3 "/tmp/p242_${N}.py"; then
    echo "INVALID  $label (mutation failed to apply — proves nothing)"
    GAPS=$((GAPS+1)); restore; return
  fi

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p242bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    GAPS=$((GAPS+1)); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p242_${N}.log" 2>&1; then
    # The suites are happy. Ask the release boundary itself, which is the one
    # observable a suite cannot fake: does `require` mode still refuse?
    RELEASE_ADMISSION=require npx vitest run "$BOUNDARY" >"/tmp/p242_${N}.probe" 2>&1
    local probe=$?
    if [ "$probe" -eq 0 ]; then
      echo "CAUGHT   $label (boundary probe: the release was ADMITTED)"
      PASSED=$((PASSED+1))
    elif [ "$probe" -eq 1 ] && [ "$expect" = "survive" ]; then
      echo "EQUIVALENT  $label (documented as inert: refused both before and after)"
      EQUIV=$((EQUIV+1))
    elif [ "$probe" -eq 1 ]; then
      echo "SURVIVED $label   <-- GUARD GAP"
      GAPS=$((GAPS+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP (probe exited $probe: the gate broke, it did not enforce)"
      GAPS=$((GAPS+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- the guards flag a behaviourally inert change"
      GAPS=$((GAPS+1))
    else
      echo "CAUGHT   $label"
      PASSED=$((PASSED+1))
    fi
  fi
  restore
}

echo "=== Phase 242 mutation suite ==="

echo "--- baseline: the release suites must pass, and the boundary must still refuse ---"
if ! npx vitest run "${FOCUS[@]}" >/tmp/p242_baseline.log 2>&1; then
  echo "FATAL: the phase-242 suites fail at baseline."
  echo "       Every CAUGHT verdict below would be a false positive. Not running mutants."
  exit 2
fi
RELEASE_ADMISSION=require npx vitest run "$BOUNDARY" >/tmp/p242_baseline_probe.log 2>&1
BASELINE_PROBE=$?
if [ "$BASELINE_PROBE" -ne 1 ]; then
  echo "FATAL: baseline release admission probe exited $BASELINE_PROBE, expected 1 (refused)."
  exit 2
fi
echo "--- baseline green; the boundary refuses; mutation verdicts are meaningful ---"
arm_backups

# ── the admission decision ────────────────────────────────────────────────
mutate "M1 admission is forced true at the release entry" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "    return {\n      admitted,\n      verdict: state.verdict.verdict,"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "    return {\n      admitted: true,\n      verdict: state.verdict.verdict,"))
PY

mutate "M2 the admission result is inverted" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "      admitted,\n      verdict: state.verdict.verdict,"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      admitted: !admitted,\n      verdict: state.verdict.verdict,"))
PY

mutate "M3 the verdict is mapped to READY regardless of evidence" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "      verdict: state.verdict.verdict,\n      candidate,"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '      verdict: "READY",\n      candidate,'))
PY

mutate "M4 one blocker is dropped from the projection" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = '    .filter((outcome) => outcome.mandatory && outcome.state !== "VERIFIED")'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, old + '\n    .filter((outcome) => outcome.id !== "A1_OTP_ISSUER_REVOCATION")'))
PY

mutate "M5 admission is decided by CI status" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "      allMandatoryVerified;"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '      Boolean(process.env.CI || process.env.GITHUB_ACTIONS);'))
PY

mutate "M6 admission is decided by local success (the evidence was readable)" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
lines = s.split(chr(10))
start = lines.index("    const admitted =")
end = next(k for k in range(start, start + 10) if lines[k].rstrip().endswith(";"))
lines[start:end + 1] = ["    const admitted = state.facts !== null;"]
open(P, "w").write(chr(10).join(lines))
if "state.verdict.ready" in open(P).read():
    sys.exit("mutation did not remove the canonical conjunction")
PY

mutate "M7 stale evidence is refreshed into freshness by the reader" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = '    observedAt: typeof declared.observedAt === "number" ? declared.observedAt : Number.NaN,'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "    observedAt: Date.now(),"))
PY

mutate "M8 the candidate-commit binding is dropped (candidate pinned to the worktree)" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = "      commit: options.commit ?? CANDIDATE.commit,"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      commit: CANDIDATE.commit,"))
PY

mutate "M9 a proof that omits its environment inherits production" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = '    environment: (declared.environment as EvidenceRecord["environment"]) ?? "local",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    environment: (declared.environment as EvidenceRecord["environment"]) ?? "production",'))
PY

mutate "M25 the reader accepts ANY declared evidence source" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = '    source: (declared.source as EvidenceRecord["source"]) ?? "documentation",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    source: "external-verification",'))
PY

mutate "M26 the reader accepts ANY declared environment" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = '    environment: (declared.environment as EvidenceRecord["environment"]) ?? "local",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    environment: "production",'))
PY

mutate "M16 the reader accepts documentation as verification" survive <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = "  const verified = declared.verified === true;"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  const verified = declared.verified === true || declared.source === "documentation";'))
PY

# ── the report and the JSON ───────────────────────────────────────────────
mutate "M10 the display report hardcodes its own verdict" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "    `verdict: ${admission.verdict}`,"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "    `verdict: READY`,"))
PY

mutate "M20 the JSON report emits its own verdict" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "      verdict: admission.verdict,"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '      verdict: "READY",'))
PY

# ── fail-closed behaviour ─────────────────────────────────────────────────
mutate "M13 an evaluation error is swallowed into an admission" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = '      admitted: false,\n      verdict: "NOT READY",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '      admitted: true,\n      verdict: "READY",'))
PY

mutate "M21 a bypass helper is exported from the admission module" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "export function releaseAdmissionExitCode("
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
helper = "export function forceAdmission() {\n  return { admitted: true } as const;\n}\n\n"
open(P, "w").write(s.replace(old, helper + old))
PY

# ── duplicate aggregation and a skipped prerequisite ──────────────────────
mutate "M14 duplicate blocker aggregation replaces the canonical projection" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "  return outcomes\n    .filter((outcome) => outcome.mandatory && outcome.state !== \"VERIFIED\")"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
hardcoded = (
    '  return ["A1_OTP_ISSUER_REVOCATION", "A2_HISTORY_REWRITE"].map((id) => ({\n'
    "    id,\n    requirement: id,\n    state: \"UNVERIFIED\" as const,\n    reasons: [] as string[],\n"
    "  }));\n"
) + old
open(P, "w").write(s.replace(old, hardcoded))
PY

mutate "M15 one mandatory prerequisite is skipped by the decision" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
edits = [
    (
        "    const outcomes = state.verdict.prerequisites;",
        '    const outcomes = state.verdict.prerequisites.filter(\n      (outcome) => outcome.id !== "EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION",\n    );',
    ),
    ("      state.verdict.ready &&", "      true &&"),
    ("      blockers.length === 0 &&", "      true &&"),
]
for old, new in edits:
    if s.count(old) != 1:
        sys.exit("anchor not found exactly once: " + old)
    s = s.replace(old, new)
open(P, "w").write(s)
PY

# ── the enforcement surface: workflow, CI and package scripts ─────────────
mutate "M11 the admission job is made advisory (continue-on-error)" catch <<'PY'
import sys
P = ".github/workflows/release-admission.yml"
s = open(P).read()
old = "  release-admission:\n    name: Release admission — this candidate\n"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, old + "    continue-on-error: true\n"))
PY

mutate "M12 the boundary job is downgraded to a logic check" catch <<'PY'
import sys
P = ".github/workflows/release-admission.yml"
s = open(P).read()
old = "        run: npm run release:admission"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "        run: npm run release:gate-verify"))
PY

mutate "M19 the release workflow is widened to ordinary branch pushes" catch <<'PY'
import sys
P = ".github/workflows/release-admission.yml"
s = open(P).read()
old = "on:\n  workflow_dispatch:"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'on:\n  push:\n    branches: ["arena/**"]\n  workflow_dispatch:'))
PY

mutate "M23 ordinary development CI runs the release admission" catch <<'PY'
import sys
P = ".github/workflows/ci.yml"
s = open(P).read()
old = "      - name: Lint (advisory)"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
added = "      - name: Release admission\n        run: npm run release:admission\n\n" + old
open(P, "w").write(s.replace(old, added))
PY

mutate "M18 the admission command is downgraded to verify mode" catch <<'PY'
import sys
P = "package.json"
s = open(P).read()
old = '"release:admission": "RELEASE_ADMISSION=require vitest run'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '"release:admission": "vitest run'))
PY

mutate "M24 a proof path is changed to a document (docs-as-proof)" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = '  a1Revocation: "docs/remediation/a1-revocation-attestation.json",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  a1Revocation: "docs/remediation/a1-revocation-attestation.md",'))
PY

# ── the boundary probe: an advisory require mode ──────────────────────────
mutate "M27 require mode stops asserting admission (CI integration made advisory)" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.boundary.phase242.test.ts"
s = open(P).read()
old = "      ).toBe(true);\n      expect(releaseAdmissionExitCode(admission)).toBe(0);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      ).toBeDefined();\n      expect(releaseAdmissionExitCode(admission)).toBeDefined();"))
PY

mutate "M16b the evaluator counts documentation as a verifying source" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification"];'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, 'w').write(s.replace(old, 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification", "documentation"];'))
PY

mutate "M17 the verify-mode assertion is deleted AND admission is forced true" catch <<'PY'
import sys
P = "src/lib/deployment/release-admission.boundary.phase242.test.ts"
s = open(P).read()
old = "      expect(admission.admitted).toBe(false);\n      expect(admission.verdict).toBe(\"NOT READY\");"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, '      expect(typeof admission.admitted).toBe("boolean");\n      expect(admission.verdict).toBe("NOT READY");')
open(P, "w").write(s)

P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = "      admitted,\n      verdict: state.verdict.verdict,"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      admitted: true,\n      verdict: state.verdict.verdict,"))
PY

# ── documented equivalent: defence in depth, not a gap ────────────────────
mutate "M22 an unreadable inventory is reported as present-with-no-affected-refs" survive <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = (
    "    // An unreadable inventory is not an empty inventory. Reporting \"no refs\n"
    "    // affected\" from a parse failure would be the same defect the Phase 233\n"
    "    // guards exist to prevent, one layer up.\n"
    "    return { present: false, affectedRefs: [], stillServing: [] };"
)
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = (
    "    // An unreadable inventory is not an empty inventory. Reporting \"no refs\n"
    "    // affected\" from a parse failure would be the same defect the Phase 233\n"
    "    // guards exist to prevent, one layer up.\n"
    "    return { present: true, affectedRefs: [], stillServing: [] };"
)
open(P, "w").write(s.replace(old, new))
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
