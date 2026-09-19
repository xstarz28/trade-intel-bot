#!/usr/bin/env bash
# Phase 233 — mutation suite for the deterministic ref source and the runbook
# reconciliation.
#
# The premise: Phase 233 replaced an oracle whose verdict depended on the
# environment with one that reads the remote, and reconciled a runbook whose
# ref tables had drifted from reality. Both halves are only worth anything if
# the new checks actually FAIL when the condition they describe returns.
#
# Every mutation below is a defect that has really occurred, or the exact
# regression the new code exists to prevent:
#
#   G1  a live ref vanishes from the rewrite map   (the 01a0a92b/01a0ad26 omission)
#   G2  a live ref vanishes from the exposure table (same omission, first table)
#   G3  a ref row is duplicated                    (the Phase 198 01a08e67 repeat)
#   G4  a ref tip is relabelled clean while still exposed
#   G5  a ref's occurrence count is zeroed         ("clean" claim vs 269 carriers)
#   G6  the summary reverts to a stale count       (the "All five" drift)
#   G7  the artifact misreports tip exposure       (snapshot going stale)
#   G8  the inventory omits a live ref             (scan never run for it)
#   G9  remote failure returns [] instead of failing closed  (the old `catch { return }`)
#   G10 an empty ref list is accepted as success   (vacuous pass, the original defect)
#   G11 the ref list is hardcoded                  (explicitly forbidden by the brief)
#   G12 peeled tag objects are counted as refs     (a phantom second row for one tag)
#   G13 the affected-to-coverage rule is deleted
#   G14 duplicate detection is deleted
#   G15 the unaffected-labelled-affected rule is deleted
#   G16 tip-status comparison is deleted
#   G17 the section parser swallows a sibling section (a bug found while writing this)
#   G18 the summary-count rule is deleted
#
# ESCAPING
# Phase 232's suite passed its patterns through the environment and matched them
# with perl's `\Q…\E`. That works, but every replacement still had to survive
# bash double-quote expansion, and `$ENV{...}` in a replacement is parsed by
# BASH as `$ENV` — an unbound variable — before perl ever sees it. Three
# mutations died that way while this suite was being written.
#
# So the perl programs here live in QUOTED heredocs (`<<'PERL'`), which expand
# nothing at all, and are handed to perl via `-e "$(cat …)"`. The `$ENV{...}`
# forms reach perl intact, and no pattern needs escaping for any shell.
#
# SAFETY
# Restore is byte-exact via `cmp` against a `.p233bak` snapshot, under a `trap`.
# A mutation that changes zero bytes is reported INVALID, never "passed" — a
# mutation that did not apply must not be scored as a caught one.
set -uo pipefail
cd "$(dirname "$0")/.."

LIVE_REFS="src/lib/deployment/live-refs.ts"
FACTS="src/lib/deployment/runbook-ref-facts.ts"
RUNBOOK="docs/SECRET-REMEDIATION-RUNBOOK.md"
ARTIFACT="docs/secret-remediation-refs.json"
TEST="src/lib/deployment/ref-inventory.phase233.test.ts"

TARGETS=("$LIVE_REFS" "$FACTS" "$RUNBOOK" "$ARTIFACT")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p233bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p233bak" "$f"
    cmp -s "$f" "$f.p233bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p233bak"; done' EXIT

# The environment the perl programs read. Exported once, so the heredocs stay
# free of shell quoting concerns entirely.
export RB_0867_ROW='| `refs/heads/arena/01a08e67-trade-intel-bot` | **clean** | 269 |'
export RB_MAIN_ROW='| `refs/heads/main` | **EXPOSED AT TIP** | 261 |'
export RB_MAIN_CLEAN='| `refs/heads/main` | **clean** | 261 |'
export RB_RC181_ROW='| `refs/tags/rc-181` | **clean** | 269 |'
export RB_RC181_ZERO='| `refs/tags/rc-181` | **clean** | 0 |'
export RB_AD26_ROW='| `heads/arena/01a0ad26-trade-intel-bot` | *added Phase 233* | *not rehearsed* |'
export RB_A92B_ROW='| `refs/heads/arena/01a0a92b-trade-intel-bot` | **clean** | 269 |'
export RB_ALL_SEVEN='**All seven**'
export RB_ALL_FIVE='**All five**'
export ART_MAIN_TRUE='"ref": "heads/main",
      "affected": true,
      "carrierCommits": 261,
      "exposedAtTip": true'
export ART_MAIN_FALSE='"ref": "heads/main",
      "affected": true,
      "carrierCommits": 261,
      "exposedAtTip": false'
export ART_DROP_REF='    {
      "ref": "heads/arena/01a0ad26-trade-intel-bot",
      "affected": true,
      "carrierCommits": 269,
      "exposedAtTip": false
    },
'

PASSED=0; FAILED=0; N=0

# $1 label, $2 target file, $3 expectation (catch|survive), $4 perl program, rest: test paths
mutate() {
  local label="$1"; shift
  local target="$1"; shift
  local expect="$1"; shift
  local program="$1"; shift

  N=$((N+1))
  printf '%s' "$program" >"/tmp/p233_${N}.pl"
  perl -0pi -e "$(cat "/tmp/p233_${N}.pl")" "$target" \
    || { echo "SKIP     $label (perl failed)"; restore; return; }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p233bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p233_${N}.log" 2>&1; then
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

echo "=== Phase 233 mutation suite ==="

# ── the runbook-drift defects (Part B) ─────────────────────────────────
mutate "G1 drop 01a0ad26 from rewrite map" "$RUNBOOK" catch '
s|\Q$ENV{RB_AD26_ROW}\E\n||' "$TEST"

mutate "G2 drop 01a0a92b from exposure table" "$RUNBOOK" catch '
s|\Q$ENV{RB_A92B_ROW}\E\n||' "$TEST"

mutate "G3 duplicate the 01a08e67 row (Phase 198 defect)" "$RUNBOOK" catch '
s|\Q$ENV{RB_0867_ROW}\E|$ENV{RB_0867_ROW}\n$ENV{RB_0867_ROW}|' "$TEST"

mutate "G4 relabel main tip as clean" "$RUNBOOK" catch '
s|\Q$ENV{RB_MAIN_ROW}\E|$ENV{RB_MAIN_CLEAN}|' "$TEST"

mutate "G5 zero rc-181 occurrence count" "$RUNBOOK" catch '
s|\Q$ENV{RB_RC181_ROW}\E|$ENV{RB_RC181_ZERO}|' "$TEST"

mutate "G6 revert summary to All five" "$RUNBOOK" catch '
s|\Q$ENV{RB_ALL_SEVEN}\E|$ENV{RB_ALL_FIVE}|' "$TEST"

# ── the artifact going stale ──────────────────────────────────────────
mutate "G7 artifact flips main exposedAtTip to false" "$ARTIFACT" catch '
s|\Q$ENV{ART_MAIN_TRUE}\E|$ENV{ART_MAIN_FALSE}|' "$TEST"

mutate "G8 artifact omits a live ref" "$ARTIFACT" catch '
s|\Q$ENV{ART_DROP_REF}\E||' "$TEST"

# ── the ref source (Part A) ───────────────────────────────────────────
# G9 reproduces the ORIGINAL defect's failure mode: a git error swallowed into
# an empty result, which reads downstream as "nothing to check". Both edits
# keep the file syntactically valid, so the mutant is caught by an ASSERTION
# rather than a compile error — a syntax-error "catch" would prove nothing.
mutate "G9 remote failure returns [] instead of failing closed" "$LIVE_REFS" catch '
s|\Q    throw new LiveRefSourceUnavailableError(\E|    return []; /*|;
s|\Q      { cause: err },\E|      { cause: err },\n    ); */|' "$TEST"

mutate "G10 empty ref list accepted as success" "$LIVE_REFS" catch '
s|\Q  if (refs.length === 0) {\E|  if (false) {|' "$TEST"

mutate "G11 ref list hardcoded instead of read from remote" "$LIVE_REFS" catch '
s|\Qrun(["ls-remote", "--heads", "--tags", remote])\E|"heads/main\nheads/arena/01a0a92b-trade-intel-bot"|' "$TEST"

mutate "G12 peeled tag objects counted as refs" "$LIVE_REFS" catch '
s|\Q    if (ref.endsWith("^{}")) continue;\E\n||' "$TEST"

# ── the rule set deleting itself ──────────────────────────────────────
mutate "G13 affected-ref-missing-from-coverage rule deleted" "$FACTS" catch '
s|\Q    if (entry.affected && !coveredRefs.includes(entry.ref)) {\E|    if (false) {|' "$TEST"

mutate "G14 duplicate-row rule deleted" "$FACTS" catch '
s|\Q  for (const ref of duplicateRefs(exposedRefs)) {\E|  for (const ref of []) {|' "$TEST"

mutate "G15 unaffected-labelled-affected rule deleted" "$FACTS" catch '
s|\Q    if (!entry.affected && coveredRefs.includes(entry.ref)) {\E|    if (false) {|' "$TEST"

mutate "G16 tip-status comparison deleted" "$FACTS" catch '
s|\Q    if (entry.exposedAtTip !== isMarkedExposedAtTip(row)) {\E|    if (false) {|' "$TEST"

mutate "G17 section parser swallows the next heading level" "$FACTS" catch '
s|\Q  const next = rest.search(/\n#{2,3} /);\E|  const next = rest.search(/\n## /);|' "$TEST"

mutate "G18 summary-count rule deleted" "$FACTS" catch '
s|\Q  if (declared !== liveRefs.length) {\E|  if (false) {|' "$TEST"

echo
echo "mutants CAUGHT or correct: $PASSED; gaps: $FAILED"
[ "$FAILED" -eq 0 ]
