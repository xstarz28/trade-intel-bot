#!/usr/bin/env bash
# Phase 234 — mutation suite for the Convex access verdict contract.
#
# The premise: the probe's classification is a security gate. It decides when a
# credential conclusion may be drawn from what the network showed. A gate is
# worth only as much as its failures, so every mutation below is a way that gate
# can lie — most of them in the direction the Phase 200 test was originally
# written to catch, and one in the opposite direction.
#
#   M1  NOT_REACHABLE reported as CREDENTIALS_REJECTED   (blocked net -> "bad key")
#   M2  CREDENTIALS_REJECTED reported as NOT_REACHABLE   (bad key -> "firewall")
#   M3  the auth stage is not recorded                   (a skipped check, invisible)
#   M4  the network stage is not recorded                (failures become unattributable)
#   M5  a transport failure on the auth request is swallowed into "authenticated"
#   M6  the auth response classifier hardcodes success
#   M7  the auth response classifier hardcodes failure
#   M8  an unknown/empty auth result falls through to success
#   M9  isAuthEvidence hardcoded true
#   M10 isRevocationEvidence hardcoded true              (claims evidence it cannot have)
#   M11 reachability is not checked before the credential verdict
#   M12 AUTH_INDETERMINATE folded back into UNAUTHENTICATED
#   M13 the validator is neutered (always returns no problems)
#   M14 the probe re-inlines a verdict literal           (the contract is forked)
#   M15 an unreachable verdict stops at the auth step
#
# ESCAPING
# The perl programs live in QUOTED heredocs (`<<'PERL'`) which expand nothing,
# and are handed to perl via `-e "$(cat …)"`. That is the lesson from Phase 233,
# where `$ENV{...}` inside a double-quoted replacement was parsed by bash as
# `${ENV}` and three mutants silently no-opped.
#
# SAFETY
# Restore is byte-exact via `cmp` against a `.p234bak` snapshot, under a `trap`.
# A mutation that changes zero bytes is reported INVALID, never "passed".
set -uo pipefail
cd "$(dirname "$0")/.."

LIB="scripts/lib/convex-access-verdict.mjs"
PROBE="scripts/verify-convex-access.mjs"

TARGETS=("$LIB" "$PROBE")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p234bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p234bak" "$f"
    cmp -s "$f" "$f.p234bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p234bak"; done' EXIT

export PA234="src/lib/deployment/convex-access-verdict.phase234.test.ts"
export P200="src/lib/deployment/handoff-readiness.phase200.test.ts"

PASSED=0; FAILED=0; N=0

# $1 label, $2 target file, $3 expectation (catch|survive), $4 perl program, rest: test paths
mutate() {
  local label="$1"; shift
  local target="$1"; shift
  local expect="$1"; shift
  local program="$1"; shift

  N=$((N+1))
  printf '%s' "$program" >"/tmp/p234_${N}.pl"
  perl -0pi -e "$(cat "/tmp/p234_${N}.pl")" "$target" \
    || {
      echo "SKIP     $label (perl failed — a mutant that never applied proves nothing)"
      FAILED=$((FAILED+1)); restore; return
    }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p234bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p234_${N}.log" 2>&1; then
    if [ "$expect" = "survive" ]; then
      echo "CORRECT  $label (correctly NOT flagged)"
      PASSED=$((PASSED+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP"
      FAILED=$((FAILED+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- guard misfires on a legitimate pattern"
      FAILED=$((FAILED+1))
    else
      echo "CAUGHT   $label"
      PASSED=$((PASSED+1))
    fi
  fi
  restore
}

echo "=== Phase 234 mutation suite ==="

# ── the two directions of the central mistake ──────────────────────────
# A blocked network must never look like a refused credential.
mutate "M1 NOT_REACHABLE reported as CREDENTIALS_REJECTED" "$LIB" catch '
s|\Q        state: "NOT_REACHABLE",\E|        state: "CREDENTIALS_REJECTED",|' "$PA234"

# ...and a refused credential must never look like a blocked network.
mutate "M2 CREDENTIALS_REJECTED reported as NOT_REACHABLE" "$LIB" catch '
s|\Q        state: "CREDENTIALS_REJECTED",\E|        state: "NOT_REACHABLE",|' "$PA234"

# ── omitted stages ─────────────────────────────────────────────────────
mutate "M3 auth stage not recorded" "$PROBE" catch '
s|\Qrecord("auth", primary, auth.state === "authenticated" ? "PASS" : "BLOCKED", auth.detail);\E||' "$P200"

mutate "M4 network (DNS) stage not recorded" "$PROBE" catch '
s|\Q  record("dns", host, dns.ok ? "PASS" : "FAIL", dns.detail);\E|  void dns;|' "$P200"

# ── swallowed probe exception ──────────────────────────────────────────
mutate "M5 transport failure on the auth request swallowed as authenticated" "$LIB" catch '
s|\Q    state: "unreachable",\E|    state: "authenticated",|' "$PA234"

# ── hardcoded success / failure in the response classifier ─────────────
# NOTE: the delimiter is `#`, not `|` — this pattern contains a literal `||`,
# and `\Q…\E` does NOT protect the delimiter (perl tokenises it first).
mutate "M6 auth response classifier hardcodes success" "$LIB" catch '
s#\Q  if (status === 401 || status === 403) {\E#  if (false) {#' "$PA234"

mutate "M7 auth response classifier hardcodes failure" "$LIB" catch '
s|\Q  if (status >= 200 && status < 500) {\E|  if (false) {|' "$PA234"

# ── unknown/empty result treated as safe ───────────────────────────────
mutate "M8 unknown auth result falls through to authenticated" "$LIB" catch '
s|\Q      state: "AUTH_INDETERMINATE",\E|      state: "AUTHENTICATED",|' "$PA234"

# ── evidence flags ─────────────────────────────────────────────────────
mutate "M9 isAuthEvidence hardcoded true" "$LIB" catch '
s|\Q        isAuthEvidence: false,\E|        isAuthEvidence: true,|' "$PA234"

mutate "M10 isRevocationEvidence hardcoded true" "$LIB" catch '
s|\Q        isRevocationEvidence: false,\E|        isRevocationEvidence: true,|' "$PA234"

# ── ordering: reachability is a precondition ───────────────────────────
mutate "M11 reachability not checked before the credential verdict" "$LIB" catch '
s|\Q  if (!reachable) {\E|  if (false) {|' "$PA234"

mutate "M12 AUTH_INDETERMINATE folded into UNAUTHENTICATED" "$LIB" catch '
s|\Q        state: "UNAUTHENTICATED",\E|        state: "AUTH_INDETERMINATE",|' "$PA234"

# ── the validator itself ───────────────────────────────────────────────
mutate "M13 validator neutered (always reports no problems)" "$LIB" catch '
s|\Q  const problems = [];\E|  return [];\n  const problems = [];|' "$PA234"

# ── the contract is forked back into the probe ─────────────────────────
mutate "M14 probe re-inlines a verdict literal" "$PROBE" catch '
s|\Qconst { verdict, exitCode } = computeVerdict({\E|const verdict = { state: "AUTHENTICATED" };\nconst exitCode = computeVerdict({|' "$PA234"

# ── an unreachable verdict that claims an auth stop ────────────────────
mutate "M15 unreachable verdict stops at the auth step" "$LIB" catch '
s|\Q        blockedAt: blockedTransport ?? "unknown",\E|        blockedAt: "auth",|' "$PA234"

echo
echo "mutants CAUGHT or correct: $PASSED; gaps: $FAILED"
[ "$FAILED" -eq 0 ]
