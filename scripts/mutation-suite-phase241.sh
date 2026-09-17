#!/usr/bin/env bash
#
# Phase 241 — mutation suite: can the release gate be made to say READY wrongly?
#
# WHAT IT ANSWERS
# A green suite proves the gate's rules hold for the inputs the tests use. This
# suite proves something stronger and more useful: that each individual rule is
# LOAD-BEARING. Every mutant below removes or inverts exactly one rule — the
# invert VERIFIED check, delete a blocker from the aggregate, accept a fixture as
# production evidence, swallow the evaluation error, bypass the real path — and
# the focused suites must reject it. A mutant that survives is a rule nothing
# actually enforces.
#
# METHOD
# Mutations are python3 heredocs (quoted, so nothing is expanded by the shell);
# each asserts the exact anchor it replaces occurs exactly once, so a mutation
# that matches nothing is reported INVALID rather than silently counted.
#
# SAFETY
# Baseline first: with a failing suite every mutant would read as CAUGHT, which
# is the false confidence this suite exists to remove. Restore is byte-exact via
# `cmp` against a `.p241bak` snapshot, under `trap`.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGETS=(
  "src/lib/deployment/release-gate.ts"
  "src/lib/deployment/release-current-state.ts"
  "src/lib/deployment/release-gate-failclosed.phase241.test.ts"
  "src/lib/deployment/release-current-state.phase241.test.ts"
)

for f in "${TARGETS[@]}"; do cp "$f" "$f.p241bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p241bak" "$f"
    cmp -s "$f" "$f.p241bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p241bak"; done' EXIT

FOCUS=(
  "src/lib/deployment/release-gate-failclosed.phase241.test.ts"
  "src/lib/deployment/release-current-state.phase241.test.ts"
)

PASSED=0; EQUIV=0; GAPS=0; N=0

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)

  N=$((N+1))
  printf '%s' "$program" > "/tmp/p241_${N}.py"

  if ! python3 "/tmp/p241_${N}.py"; then
    echo "INVALID  $label (mutation failed to apply — proves nothing)"
    GAPS=$((GAPS+1)); restore; return
  fi

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p241bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    GAPS=$((GAPS+1)); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p241_${N}.log" 2>&1; then
    if [ "$expect" = "survive" ]; then
      echo "EQUIVALENT  $label (documented as inert)"
      EQUIV=$((EQUIV+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP"
      GAPS=$((GAPS+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- guard now flags a behaviourally inert change"
      GAPS=$((GAPS+1))
    else
      echo "CAUGHT   $label"
      PASSED=$((PASSED+1))
    fi
  fi
  restore
}

echo "=== Phase 241 mutation suite ==="

echo "--- baseline: the release-gate suites must pass first ---"
if ! npx vitest run "${FOCUS[@]}" >/tmp/p241_baseline.log 2>&1; then
  echo "FATAL: the release-gate suites fail at baseline."
  echo "       Every CAUGHT verdict below would be a false positive. Not running mutants."
  exit 2
fi
echo "--- baseline green; mutation verdicts are meaningful ---"

GATE="src/lib/deployment/release-gate.ts"
READER="src/lib/deployment/release-current-state.ts"

# ── the aggregate ─────────────────────────────────────────────────────────
mutate "M1 one blocker is deleted from the aggregate (A1 ignored)" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "  const ready = allBlockers.length === 0;"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  const ready = allBlockers.filter((b) => !b.startsWith("A1_")).length === 0;'))
PY

mutate "M2 one blocker is deleted from the aggregate (A2 ignored)" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "  const ready = allBlockers.length === 0;"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  const ready = allBlockers.filter((b) => !b.startsWith("A2_")).length === 0;'))
PY

mutate "M3 the aggregate becomes ANY-pass instead of ALL-mandatory" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "  const ready = allBlockers.length === 0;"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  const ready = outcomes.some((o) => o.state === "VERIFIED");'))
PY

mutate "M4 the VERIFIED check is inverted (non-verified becomes the requirement)" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = '.filter((o) => o.mandatory && o.state !== "VERIFIED")'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '.filter((o) => o.mandatory && o.state === "VERIFIED")'))
PY

mutate "M5 one mandatory prerequisite stops being mandatory (A2)" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "mandatory: true,"
if s.count(old) != 5:
    sys.exit(f"expected 5 mandatory prerequisites, found {s.count(old)}")
# The second entry in the manifest is A2: a blocker removed from the set the
# verdict is computed over.
at = s.index(old)
second = s.index(old, at + 1)
open(P, "w").write(s[:second] + "mandatory: false," + s[second + len(old):])
PY

mutate "M6 the deployment gate is unbound (any deployment satisfies it)" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = 'binding: "deployment",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'binding: "none",'))
PY

mutate "M7 the Evidence-D provider set is unbound (one provider would do)" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = 'binding: "provider-set",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'binding: "none",'))
PY

mutate "M8 the email gate stops being mandatory" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "mandatory: true,"
if s.count(old) != 5:
    sys.exit(f"expected 5 mandatory prerequisites, found {s.count(old)}")
at = s.index(old)
third = s.index(old, s.index(old, at + 1) + 1)   # 3rd: CONVEX
fourth = s.index(old, third + 1)                 # 4th: EMAIL
open(P, "w").write(s[:fourth] + "mandatory: false," + s[fourth + len(old):])
PY

# ── the states ────────────────────────────────────────────────────────────
mutate "M9 BLOCKED is mapped to VERIFIED" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = '      state: "BLOCKED",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '      state: "VERIFIED",'))
PY

mutate "M10 UNKNOWN is mapped to VERIFIED" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = '    state: "UNVERIFIED",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    state: "VERIFIED",'))
PY

mutate "M11 STALE is mapped to VERIFIED" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = '    return { ...base, state: "STALE", reasons };'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    return { ...base, state: "VERIFIED", reasons };'))
PY

mutate "M12 missing evidence defaults to VERIFIED" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = '    return { ...base, state: "UNVERIFIED", reasons: ["no evidence was supplied"] };'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    return { ...base, state: "VERIFIED", reasons: ["assumed"] };'))
PY

mutate "M13 CONTRADICTORY is mapped to VERIFIED (the pass is preferred)" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "  if (verified.length > 0 && blocked.length > 0) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  if (false) {"))
PY

# ── the evidence classes ──────────────────────────────────────────────────
mutate "M14 a fixture is accepted as production evidence" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification"];'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification", "fixture"];'))
PY

mutate "M15 documentation is accepted as proof" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification"];'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification", "documentation"];'))
PY

mutate "M16 the verdict depends only on CI" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification"];'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["ci-run"];'))
PY

mutate "M17 evidence for the WRONG commit is accepted" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "  const claimedCommit = record.subject?.commit;"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  const claimedCommit: string | undefined = undefined;"))
PY

mutate "M18 the freshness window is disabled" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "  if (prerequisite.maxAgeMs !== null && now - observedAt > prerequisite.maxAgeMs) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M19 future-dated proof is accepted" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "  if (observedAt > now) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M20 an unknown affected-ref set is treated as an empty set" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "      if (input.affectedRefs.length === 0) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      if (false) {"))
PY

mutate "M21 an unknown provider set is treated as an empty set" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "      if (input.requiredProviders.length === 0) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      if (false) {"))
PY

mutate "M22 unrecognised VERIFIED evidence no longer blocks" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "    ...unrecognisedVerified.map((id) => `${id} (unrecognised evidence claiming VERIFIED)`),"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, ""))
PY

mutate "M23 an exemption may waive a mandatory prerequisite" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "    if (prerequisite.mandatory || !prerequisite.exemptible) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "    if (false) {"))
PY

# ── the failure modes of evaluation itself ────────────────────────────────
mutate "M24 an evaluation exception returns READY" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = '      ready: false,\n      verdict: "NOT READY",\n      blockers: ["<evaluation-error>"],'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '      ready: true,\n      verdict: "READY",\n      blockers: [],'))
PY

mutate "M25 an empty manifest is accepted instead of refusing" catch <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = "  if (!Array.isArray(prerequisites) || prerequisites.length === 0) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  if (false) {"))
PY

# ── the reader must not promote a claim, and must not bypass the gate ──────
mutate "M26 the reader accepts ANY declared source" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = '    source: (declared.source as EvidenceRecord["source"]) ?? "documentation",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    source: "external-verification",'))
PY

mutate "M27 the reader accepts ANY declared environment" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = '    environment: (declared.environment as EvidenceRecord["environment"]) ?? "local",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    environment: "production",'))
PY

mutate "M28 the reader treats a filed claim as verified" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = '    status: verified ? "VERIFIED" : "UNVERIFIED",'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    status: "VERIFIED",'))
PY

mutate "M29 the current verdict bypasses the real evaluation" catch <<'PY'
import sys
P = "src/lib/deployment/release-current-state.ts"
s = open(P).read()
old = "  return deriveCurrentReleaseState(source).verdict;"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  return { ready: false, verdict: "NOT READY", blockers: [], prerequisites: [], unrecognised: [] };'))
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
[ "$GAPS" -eq 0 ]
