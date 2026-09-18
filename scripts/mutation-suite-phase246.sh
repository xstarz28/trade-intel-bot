#!/usr/bin/env bash
#
# Phase 246 mutation suite — "A1 issuer evidence and operator handoff".
#
#   bash scripts/mutation-suite-phase246.sh
#
# Method
#   1. confirm the baseline: the focused suites pass, and the real report command
#      behaves (exit code, blocker, guarantees, and no change to the tree)
#   2. for each mutant: apply it, re-run the focused suites; if they still pass,
#      run the report command again and compare its observable behaviour with the
#      baseline
#   3. restore every mutated file byte-exact (verified with `cmp`) via `trap`
#
# The focused suites are two: the Phase 246 suite (this phase's decisions and the
# reporting command) and the Phase 244 safety suite (the canonical post-check that
# Phase 246 layers on top of). A mutant that neither suite nor the probe notices is
# a gap; the one mutant declared equivalent is reworded section ORDER in the
# human-readable report, which changes no decision and is re-verified by the probe.
#
# SAFETY: no network module is reachable from the reporting path, no credential is
# read, no git command outside a read-only allowlist is executed, and the probe
# asserts that the command leaves the worktree and `docs/remediation/` untouched.
set -uo pipefail
cd "$(dirname "$0")/.."

LIB="src/lib/deployment/a1-issuer-evidence.ts"
SCRIPT="scripts/a1-issuer-report.mjs"
POSTCHECK="src/lib/deployment/remediation-postcheck.ts"
GATE="src/lib/deployment/release-gate.ts"

TARGETS=("$LIB" "$SCRIPT" "$POSTCHECK" "$GATE")
FOCUS=(
  "src/lib/deployment/a1-issuer-evidence.phase246.test.ts"
  "src/lib/deployment/remediation-safety.phase244.test.ts"
)

BASELINE_PROBE=""
PASSED=0; EQUIV=0; GAPS=0; N=0
FAILED_LABELS=()

for f in "${TARGETS[@]}"; do cp "$f" "$f.p246bak"; done
restore() { for f in "${TARGETS[@]}"; do cp "$f.p246bak" "$f"; done; }
cleanup() { restore; for f in "${TARGETS[@]}"; do rm -f "$f.p246bak"; done; }
trap cleanup EXIT

# ── the probe: what the reporting command observably does ────────────────────

tree_state() {
  local files porcelain
  files=$(find docs/remediation -type f 2>/dev/null | wc -l | tr -d ' ')
  porcelain=$(git status --porcelain | sha256sum | cut -c1-12)
  echo "${files}:${porcelain}"
}

probe() {
  local before after rc out summary
  before=$(tree_state)
  out=$(node --experimental-strip-types --no-warnings scripts/a1-issuer-report.mjs --json --now 1770000000000 2>/dev/null)
  rc=$?
  after=$(tree_state)
  summary=$(printf '%s' "$out" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print("unparseable")
    sys.exit(0)
g = d.get("guarantees", {})
flags = "".join("f" if g.get(k) is False else ("t" if g.get(k) is True else "?") for k in sorted(g))
blocker = str(d.get("blocker", "")).split(":")[0]
attestation = "none" if d.get("attestation") is None else "filed"
verdict_flag = "no" if d.get("verdictIssuedHere") is False else "yes"
remediation = "no" if d.get("remediationPerformed") is False else "yes"
print(f"{blocker}|{flags}|{attestation}|{verdict_flag}|{remediation}")
')
  local tree="same"
  [ "$before" = "$after" ] || tree="changed"
  echo "${rc}|${summary}|${tree}"
}

echo "baseline: focused suites + the reporting command must behave first"
if ! npx vitest run "${FOCUS[@]}" >/dev/null 2>&1; then echo "FATAL: baseline suites are red"; exit 2; fi
BASELINE_PROBE=$(probe)
echo "baseline probe: $BASELINE_PROBE"
if [ "$BASELINE_PROBE" != "1|MISSING_EXTERNAL_ACCESS|ffffffff|none|no|no|same" ]; then
  echo "FATAL: the baseline probe is not the expected one; the harness would measure nothing"
  exit 2
fi
echo
echo "── mutants ──────────────────────────────────────────────────────────────"

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)
  case "$program" in
    "import sys"*) ;;
    *)
      echo "INVALID   $label (no mutation program on stdin: a heredoc delimiter is missing)"
      GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
      ;;
  esac

  N=$((N + 1))
  printf '%s' "$program" >"/tmp/p246_${N}.py"
  if ! python3 "/tmp/p246_${N}.py" >/dev/null; then
    echo "INVALID   $label (the mutation did not apply: the anchor is stale, so it proves nothing)"
    GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
  fi
  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p246bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID   $label (no byte changed: the mutation is inert by construction)"
    GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p246_${N}.log" 2>&1; then
    local observed; observed=$(probe)
    if [ "$observed" != "$BASELINE_PROBE" ]; then
      echo "CAUGHT    $label (probe: expected $BASELINE_PROBE, observed $observed)"
      PASSED=$((PASSED + 1))
    elif [ "$expect" = "survive" ]; then
      echo "EQUIVALENT $label (documented: no decision changed, and the probe is unmoved)"
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

# ── the bindings ─────────────────────────────────────────────────────────────
mutate "M1 accept a revocation recorded at another issuer" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  if (hostOf(declaredIssuer) !== hostOf(manifest.issuer.identity)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M2 accept evidence about a different credential" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  if (declaredFingerprint !== manifest.credential.fingerprint) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M3 stop checking how old the evidence is" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  if (options.now - observedAt > maxAgeMs) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M4 accept an observation made before the revocation" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """    if (observedAt <= remediationAt) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) {"""))
PY

mutate "M5 accept a timeout as proof of revocation" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  const statusOk = status !== null && contract.admissible[1].rejectionStatuses.includes(status);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  const statusOk = true;"""))
PY

mutate "M6 accept a 000 (no response) as proof of revocation" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-postcheck.ts"
s = open(p).read()
old = """    (rejectionStatus === 401 || rejectionStatus === 403) &&"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    (rejectionStatus === 401 || rejectionStatus === 403 || rejectionStatus === 0) &&"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M7 accept a document as issuer evidence" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  const wrongSource = post.filter((record) => record.source !== "external-issuer");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const wrongSource: RemediationEvidenceRecord[] = [];"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M8 accept a synthetic fixture as production evidence" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  const fixtures = evidence.filter(isFixtureRecord);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const fixtures: RemediationEvidenceRecord[] = [];"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M9 accept a different credential's rejection (canonical layer)" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-postcheck.ts"
s = open(p).read()
old = """        record.subject?.fingerprint === undefined ||
        record.subject.fingerprint === manifest.credential.fingerprint,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """        record.subject?.fingerprint === undefined ||
        record.subject.fingerprint !== undefined,"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M10 ignore the production environment binding" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-postcheck.ts"
s = open(p).read()
old = """      return environment === "production" && fresh;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      return environment !== "unset" && fresh;"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M11 ignore the issuer binding (canonical layer)" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-postcheck.ts"
s = open(p).read()
old = """    hostOf(confirmation.record.subject?.issuer ?? "") === hostOf(manifest.issuer.identity);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    true;"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M12 ignore the ordering between the revocation and the observation" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-postcheck.ts"
s = open(p).read()
old = """  remediationAt !== null && record.observedAt > remediationAt;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  remediationAt !== null;"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M13 swallow malformed evidence instead of refusing it" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """    passed: malformed.length === 0,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    passed: true,"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M14 report the current A1 state as complete" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  const unavailable: string[] = [];
  if (request.externalIssuerAccess !== "available") {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const unavailable: string[] = [];
  if (false) {"""
open(p, "w").write(s.replace(old, new))
PY

# ── the reporting command ────────────────────────────────────────────────────
mutate "M15 make the reporting command open the network" catch <<'PY'
import sys
p = "scripts/a1-issuer-report.mjs"
s = open(p).read()
old = """import { spawnSync } from "node:child_process";"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """import { spawnSync } from "node:child_process";
import https from "node:https";"""
s = s.replace(old, new)
old2 = """  const now = Number(flag("--now") ?? Date.now());"""
if s.count(old2) != 1:
    sys.exit("anchor 2 not found exactly once")
new2 = """  https.get("https://auth.freebuff.app/", () => {});
  const now = Number(flag("--now") ?? Date.now());"""
open(p, "w").write(s.replace(old2, new2))
PY

mutate "M16 make the reporting command print a credential from the environment" catch <<'PY'
import sys
p = "scripts/a1-issuer-report.mjs"
s = open(p).read()
old = """  console.log(formatA1OperatorHandoff(report));"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  console.log(process.env.OTP_EMAIL_API_KEY ?? "");
  console.log(formatA1OperatorHandoff(report));"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M17 make the reporting command mutate a provider credential" catch <<'PY'
import sys
p = "scripts/a1-issuer-report.mjs"
s = open(p).read()
old = """  console.log(formatA1OperatorHandoff(report));"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  spawnSync("npx", ["convex", "env", "set", "OTP_EMAIL_API_KEY"], { encoding: "utf8" });
  console.log(formatA1OperatorHandoff(report));"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M18 make the reporting command write a ref" catch <<'PY'
import sys
p = "scripts/a1-issuer-report.mjs"
s = open(p).read()
old = """  "for-each-ref","""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  "for-each-ref",
  "update-ref","""
s = s.replace(old, new)
old2 = """  const releaseVerdict = currentReleaseVerdict(undefined, { now });"""
if s.count(old2) != 1:
    sys.exit("anchor 2 not found exactly once")
new2 = """  git(["update-ref", "refs/heads/phase246-mutant", repository.head]);
  const releaseVerdict = currentReleaseVerdict(undefined, { now });"""
open(p, "w").write(s.replace(old2, new2))
PY

mutate "M19 make the command persist a synthetic attestation as real evidence" catch <<'PY'
import sys
p = "scripts/a1-issuer-report.mjs"
s = open(p).read()
old = """import { existsSync, readFileSync } from "node:fs";"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """import { existsSync, readFileSync, writeFileSync } from "node:fs";"""
s = s.replace(old, new)
old2 = """  console.log(formatA1OperatorHandoff(report));"""
if s.count(old2) != 1:
    sys.exit("anchor 2 not found exactly once")
new2 = """  writeFileSync(report.contract.attestation.path, JSON.stringify({ schema: "phase246.a1-evidence/v1", verified: true }));
  console.log(formatA1OperatorHandoff(report));"""
open(p, "w").write(s.replace(old2, new2))
PY

mutate "M20 let a fixture satisfy the canonical release gate" catch <<'PY'
import sys
p = "src/lib/deployment/release-gate.ts"
s = open(p).read()
old = """const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification"];"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification", "fixture"];"""
open(p, "w").write(s.replace(old, new))
PY

# ── implementation-specific ──────────────────────────────────────────────────
mutate "M21 let the discovery invent a revocation endpoint" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  documentedEndpoints: [],
  selfServiceSurfaces: [],"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  documentedEndpoints: ["https://auth.freebuff.app/revoke"],
  selfServiceSurfaces: [],"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M22 drop the unavailable external prerequisite from the handoff" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  const pendingEvidence = readiness.evidence.unsatisfied.map("""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  unavailable.length = 0;
  const pendingEvidence = readiness.evidence.unsatisfied.map("""
open(p, "w").write(s.replace(old, new))
PY

mutate "M23 let an attestation carry the credential value" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  for (const key of FORBIDDEN_ATTESTATION_KEYS) {
    if (key in payload) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  for (const key of [] as string[]) {
    if (key in payload) {"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M24 stop naming the observations that are not proof" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """export const A1_REJECTED_OBSERVATIONS: readonly A1RejectedObservation[] = ["""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """export const A1_REJECTED_OBSERVATIONS: readonly A1RejectedObservation[] = [];
export const A1_REJECTED_OBSERVATIONS_UNUSED: readonly A1RejectedObservation[] = ["""
open(p, "w").write(s.replace(old, new))
PY

mutate "M25 let the report command tell the shell everything is fine" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  return report.current.actionPending && report.unavailable.length === 0 ? 0 : 1;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  return 0;"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M26 shrink the complete-set requirement to one half" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """      requires: ["a1-post-issuer-confirmation", "a1-post-credential-rejected"],"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      requires: ["a1-post-issuer-confirmation"],"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M27 widen the accepted rejection statuses beyond 401/403" catch <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """        rejectionStatuses: [401, 403],"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """        rejectionStatuses: [200, 401, 403],"""
open(p, "w").write(s.replace(old, new))
PY

# ── documented equivalent ────────────────────────────────────────────────────
mutate "M28 reorder the human-readable sections of the report" survive <<'PY'
import sys
p = "src/lib/deployment/a1-issuer-evidence.ts"
s = open(p).read()
old = """  lines.push("── not evidence ─────────────────────────────────────────────────────────");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  lines.push("── not evidence (moved to the end for layout) ──────────────────────────");"""
open(p, "w").write(s.replace(old, new))
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
echo
echo "── tree ─────────────────────────────────────────────────────────────────"
restore
for f in "${TARGETS[@]}"; do
  if cmp -s "$f" "$f.p246bak"; then echo "byte-exact: $f"; else echo "FATAL: $f is NOT restored"; exit 3; fi
done

if [ "$GAPS" -ne 0 ]; then
  printf 'FAILED: %s\n' "${FAILED_LABELS[@]}"
  exit 1
fi
exit 0
