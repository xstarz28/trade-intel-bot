#!/usr/bin/env bash
# Phase 235 — mutation suite for the Evidence D probe classification.
#
# The premise: the classification is the boundary between "the network did not
# answer" and "the deployment rejected us". Every mutant below is a way that
# boundary can be crossed — most of them in the direction the Phase 203 guard
# was originally written to catch (a blocked transport became an authentication
# or revocation conclusion), and several in the opposite direction (a real
# answer became a hardcoded PASS).
#
#   M1  a blocked transport is reported as AUTHENTICATED
#   M2  a blocked transport is reported as UNAUTHENTICATED
#   M3  the refusal blames a rejected credential
#   M4  a transport failure carries isAuthEvidence
#   M5  a network-only result is reported as revocation evidence
#   M6  a malformed (no application status) answer is read as AUTHENTICATED
#   M7  an unavailable service (5xx/4xx) is read as AUTHENTICATED
#   M8  the classification validator is neutered
#   M9  a blocked transport is no longer classified as blocked (ordering lost)
#   M10 the classifier consults the environment
#   M11 an unrecognised transport code is guessed into a specific layer
#   M12 a missing refusal reason is treated as safe (empty message)
#   M13 the exit state is hardcoded (FAILED runs exit as if unresolved)
#   M14 a swallowed transport exception is reshaped into an HTTP 401 answer
#   M14b ...and the transport error itself is dropped, so nothing records it
#   M15 a refusal reports its checks as PASS
#   M16 a malformed answer satisfies D3
#   M17 D3 is hardcoded to PASS
#   M18 --timeout is ignored (a hanging probe stalls for the 60s default)
#   M19 the harness re-inlines its own reachability rule (contract forked)
#   M20 the harness stops reporting the refusal at all (silent continuation)
#
# ESCAPING (lesson from Phase 233, kept from Phase 234)
# Every perl program is written to a file with `printf '%s'` from a SINGLE-quoted
# argument (nothing is expanded by bash) and handed to perl via `-e "$(cat …)"`.
# `\Q…\E` does NOT protect the s/// delimiter itself, so `#` is used for any
# pattern whose text contains a pipe.
#
# SAFETY
# Restore is byte-exact via `cmp` against a `.p235bak` snapshot, under a `trap`.
# A mutation that changes zero bytes is reported INVALID, never "passed", and a
# perl failure (SKIP) counts as a gap — a mutant that never applied proves
# nothing about the guard.
set -uo pipefail
cd "$(dirname "$0")/.."

PROBE="scripts/lib/evidence-d-probe.mjs"
HARNESS="scripts/evidence-d-harness.mjs"

TARGETS=("$PROBE" "$HARNESS")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p235bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p235bak" "$f"
    cmp -s "$f" "$f.p235bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p235bak"; done' EXIT

# The guard that must catch every mutant: the Phase 203 suite, now fixture-driven
# (section 5b/5c/5d of the file), plus the live smoke probe.
export P235="src/lib/deployment/evidence-d-execution.phase203.test.ts"

PASSED=0; FAILED=0; N=0

# $1 label, $2 target file, $3 expectation (catch|survive), $4 perl program,
# rest: test paths. `survive` is for a documented EQUIVALENT mutant: one whose
# change provably cannot alter an observable outcome, so "correctly not flagged"
# is the required result and a flag would itself be a defect.
mutate() {
  local label="$1"; shift
  local target="$1"; shift
  local expect="$1"; shift
  local program="$1"; shift

  N=$((N+1))
  printf '%s' "$program" >"/tmp/p235_${N}.pl"
  perl -0pi -e "$(cat "/tmp/p235_${N}.pl")" "$target" \
    || {
      echo "SKIP     $label (perl failed — a mutant that never applied proves nothing)"
      FAILED=$((FAILED+1)); restore; return
    }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p235bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p235_${N}.log" 2>&1; then
    if [ "$expect" = "survive" ]; then
      echo "CORRECT  $label (equivalent mutant — correctly not flagged)"
      PASSED=$((PASSED+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP"
      FAILED=$((FAILED+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- guard now flags a behaviourally inert change"
      FAILED=$((FAILED+1))
    else
      echo "CAUGHT   $label"
      PASSED=$((PASSED+1))
    fi
  fi
  restore
}

echo "=== Phase 235 mutation suite ==="

# ── the central mistake: a blocked transport becomes a credential verdict ──
mutate "M1 blocked transport reported as AUTHENTICATED" "$PROBE" catch '
s|\Q      state: "TRANSPORT_BLOCKED",\E|      state: "AUTHENTICATED",|' "$P235"

mutate "M2 blocked transport reported as UNAUTHENTICATED" "$PROBE" catch '
s|\Q      state: "TRANSPORT_BLOCKED",\E|      state: "UNAUTHENTICATED",|' "$P235"

# ── the refusal blames the credential instead of the network ───────────────
mutate "M3 refusal blames a rejected credential" "$PROBE" catch '
s|\Q"authentication or authorisation result. Check connectivity before " +\E|"a rejected credential. Check the key before blaming the network. " +|' "$P235"

# ── evidence flags on an unreached probe ───────────────────────────────────
mutate "M4 transport failure carries isAuthEvidence" "$PROBE" catch '
s|\Q      reached: false,\E\n\Q      isAuthEvidence: false,\E|      reached: false,\n      isAuthEvidence: true,|' "$P235"

mutate "M5 network-only result reported as revocation evidence" "$PROBE" catch '
s|\Q      isAuthEvidence: false,\E\n\Q      isRevocationEvidence: false,\E|      isAuthEvidence: false,\n      isRevocationEvidence: true,|' "$P235"

# ── answered, but not serving / not interpretable: read as success ─────────
mutate "M6 malformed answer read as AUTHENTICATED" "$PROBE" catch '
s|\Q    state: "MALFORMED",\E|    state: "AUTHENTICATED",|' "$P235"

mutate "M7 unavailable service read as AUTHENTICATED" "$PROBE" catch '
s|\Q      state: "SERVICE_UNAVAILABLE",\E|      state: "AUTHENTICATED",|' "$P235"

# ── the validator itself ───────────────────────────────────────────────────
mutate "M8 classification validator neutered (always reports no problems)" "$PROBE" catch '
s|\Q  const problems = [];\E|  return [];\n  const problems = [];|' "$P235"

# ── ordering: a transport failure is decided first, unconditionally ────────
mutate "M9 blocked transport no longer classified as blocked" "$PROBE" catch '
s#\Q  if (status === 0 || transportError) {\E#  if (false) {#' "$P235"

# ── the machine must not change the semantics ──────────────────────────────
mutate "M10 classifier consults the environment" "$PROBE" catch '
s|\Qexport function transportLayerOf(code) {\E|export function transportLayerOf(code) {\n  if (process.env.EVIDENCE_D_FORCE_LAYER) return process.env.EVIDENCE_D_FORCE_LAYER;|' "$P235"

mutate "M11 unrecognised transport code guessed into a specific layer" "$PROBE" catch '
s|\Q  return "unknown";\E|  return "tls";|' "$P235"

# ── a missing reason treated as safe ───────────────────────────────────────
mutate "M12 refusal reason silenced for an unattributable code" "$PROBE" catch '
s|\Q  const cause =\E|  if (classification.layer === "unknown") return "";\n  const cause =|' "$P235"

# ── hardcoded exit state ───────────────────────────────────────────────────
mutate "M13 exit state hardcoded (FAILED runs no longer exit 1)" "$HARNESS" catch '
s|\Qconst failed = report.summary.failed;\E|const failed = 0;|' "$P235"

# ── swallowed transport exception, reshaped into an authentication answer ──
# EQUIVALENT MUTANT, expected to survive. A thrown fetch reshaped into an HTTP
# 401 while KEEPING `transportError` cannot change any outcome: the classifier
# decides a recorded transport error first and unconditionally, so the forged
# status is dead data. The fixture test "lets a recorded transport error outrank
# any status, however it is shaped" asserts that inertness on the contract; M14
# asserts it stays inert end to end.
mutate "M14 transport error kept alongside a forged 401 (behaviourally inert)" "$HARNESS" survive '
s|\Q    return { ok: false, httpStatus: 0, transportError: code, value: undefined, body: null };\E|    return { ok: false, httpStatus: 401, transportError: code, value: { status: "UNAUTHENTICATED", result: null }, body: null };|' "$P235"

mutate "M14b swallowed transport exception with the transport error dropped" "$HARNESS" catch '
s|\Q    return { ok: false, httpStatus: 0, transportError: code, value: undefined, body: null };\E|    return { ok: false, httpStatus: 401, transportError: null, value: { status: "UNAUTHENTICATED", result: null }, body: null };|' "$P235"

# ── hardcoded PASS ─────────────────────────────────────────────────────────
mutate "M15 a refusal reports its checks as PASS" "$HARNESS" catch '
s|\Q      title: d.title,\E\n\Q      status: "BLOCKED",\E|      title: d.title,\n      status: "PASS",|' "$P235"

mutate "M16 a malformed answer satisfies D3" "$HARNESS" catch '
s#\Q    unauthClass.state === "UNAUTHENTICATED" ? "PASS" : "FAIL",\E#    unauthClass.state === "UNAUTHENTICATED" || unauthClass.state === "MALFORMED" ? "PASS" : "FAIL",#' "$P235"

mutate "M17 D3 hardcoded to PASS" "$HARNESS" catch '
s|\Q    unauthClass.state === "UNAUTHENTICATED" ? "PASS" : "FAIL",\E|    "PASS",|' "$P235"

# ── bounded probing ────────────────────────────────────────────────────────
mutate "M18 --timeout ignored (a hanging probe stalls for 60s)" "$HARNESS" catch '
s|\Qconst timeoutSeconds = Number(flag("--timeout") ?? 60);\E|const timeoutSeconds = 60;|' "$P235"

# ── the contract is forked back into the harness ───────────────────────────
mutate "M19 harness re-inlines its own reachability rule" "$HARNESS" catch '
s|\Qif (unauthClass.state === "TRANSPORT_BLOCKED") {\E|if (unauth.httpStatus === 0) {|' "$P235"

# ── the refusal never happens: the run continues on a dead transport ───────
mutate "M20 transport refusal removed (run continues silently)" "$HARNESS" catch '
s|\Q  if (unauthClass.state === "TRANSPORT_BLOCKED") {\E|  if (false) {|' "$P235"

echo
echo "mutants CAUGHT: $PASSED; gaps: $FAILED"
[ "$FAILED" -eq 0 ]
