#!/usr/bin/env bash
# Phase 232 — mutation suite for market-data envelope acquisition passthrough.
#
# The premise: the market-data leg must forward `acquisition` and `observedAt`
# from `fetchMarketData`'s envelope VERBATIM. Both halves are load-bearing and
# they fail in OPPOSITE directions:
#
#   - Dropping a field is the original defect. A missing mode with a present
#     observation falls through to the `mode ?? "observed-now"` default and
#     re-labels a cache hit as a fresh read; a missing observation with a
#     present mode falls back to the REQUEST clock and renders `age 0ms` for
#     evidence the cache never re-stamped. Dropping both is the exact pre-phase
#     defect: a completed acquisition reported as `unavailable`, with its
#     `used` marker suppressed and `unavailableCount` inflated.
#
#   - Fabricating a field is the tempting "fix". A `?? Date.now()` fallback,
#     or defaulting the mode to `observed-now`, launder the Phase 178d degraded
#     case — an action that returned `success: true` without completing a
#     single cache read — into a claimed fresh provider contact.
#
#   M1  market-data leg drops the acquisition mode        -> CAUGHT
#   M2  market-data leg drops the observedAt              -> CAUGHT
#   M3  market-data leg drops BOTH (the pre-phase defect) -> CAUGHT
#   M4  observedAt fabricated via `?? Date.now()`         -> CAUGHT
#   M5  acquisition defaulted to "observed-now"           -> CAUGHT
#   M6  observedAt replaced with the request clock        -> CAUGHT
#   M7  acquisition hardcoded to "observed-now"           -> CAUGHT
#
# Every mutation targets the FIRST occurrence of its pattern, which is the
# market-data leg; the later occurrences belong to the other legs and must stay
# untouched. Patterns and replacements travel through the environment and are
# matched with perl's `\Q…\E`, so the literal text (quotes, pipes, `?:`) needs
# no escaping and cannot be mis-parsed as a delimiter. Restore is byte-exact via
# `cmp` against a `.p232bak` snapshot. A mutation that changes zero bytes is
# reported INVALID, never "passed".
set -uo pipefail
cd "$(dirname "$0")/.."

SERVER="src/convex/protectedAnalysis.ts"
SERVER_T="src/convex/marketdata-envelope.phase232.test.ts"
WIRING_T="src/convex/provenance-wiring.phase178d.test.ts"

TARGETS=("$SERVER")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p232bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p232bak" "$f"
    cmp -s "$f" "$f.p232bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p232bak"; done' EXIT

# The two forwarded fields, exactly as they appear in the market-data leg.
export ACQ='acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,'
export OBS='observedAt: (r as { observedAt?: number }).observedAt,'

# The fabricated forms each mutant substitutes in.
export OBS_CLOCK='observedAt: (r as { observedAt?: number }).observedAt ?? Date.now(),'
export OBS_RESTAMP='observedAt: Date.now(),'
export ACQ_DEFAULT='acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition ?? "observed-now",'
export ACQ_HARDCODED='acquisition: "observed-now",'

PASSED=0; FAILED=0

# $1 label, $2 mutation, $3 expectation (catch|survive), rest: test paths
mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  local expect="$1"; shift

  eval "$cmd" || { echo "SKIP     $label (could not apply)"; restore; return; }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p232bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p232_${label%% *}.log" 2>&1; then
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

echo "=== Phase 232 mutation suite ==="

# M1 — the acquisition mode is not forwarded; the mode-present default then
#      re-labels a cache hit as a fresh observation.
mutate "M1 drop acquisition mode" \
  "perl -0pi -e 's|\Q\$ENV{ACQ}\E||' '$SERVER'" \
  catch "$SERVER_T" "$WIRING_T"

# M2 — the observation time is not forwarded; the leg falls back to the
#      request clock and a reused read renders `age 0ms`.
mutate "M2 drop observedAt" \
  "perl -0pi -e 's|\Q\$ENV{OBS}\E||' '$SERVER'" \
  catch "$SERVER_T" "$WIRING_T"

# M3 — THE EXACT PRE-PHASE DEFECT: both fields dropped, so a completed
#      acquisition is reported `unavailable` with its `used` marker gone.
mutate "M3 drop both (pre-phase defect)" \
  "perl -0pi -e 's|\Q\$ENV{ACQ}\E||; s|\Q\$ENV{OBS}\E||' '$SERVER'" \
  catch "$SERVER_T" "$WIRING_T"

# M4 — fabrication: a missing observation is back-filled from the clock,
#      laundering the degraded envelope into a claimed fresh read.
mutate "M4 observedAt fabricated from clock" \
  "perl -0pi -e 's|\Q\$ENV{OBS}\E|\$ENV{OBS_CLOCK}|' '$SERVER'" \
  catch "$SERVER_T" "$WIRING_T"

# M5 — fabrication: a missing mode defaults to the strongest possible claim.
mutate "M5 acquisition defaulted observed-now" \
  "perl -0pi -e 's|\Q\$ENV{ACQ}\E|\$ENV{ACQ_DEFAULT}|' '$SERVER'" \
  catch "$SERVER_T" "$WIRING_T"

# M6 — fabrication: the observation time is discarded and re-stamped on read.
mutate "M6 observedAt restamped unconditionally" \
  "perl -0pi -e 's|\Q\$ENV{OBS}\E|\$ENV{OBS_RESTAMP}|' '$SERVER'" \
  catch "$SERVER_T" "$WIRING_T"

# M7 — fabrication: the mode is hardcoded, so every reuse claims contact.
mutate "M7 acquisition hardcoded observed-now" \
  "perl -0pi -e 's|\Q\$ENV{ACQ}\E|\$ENV{ACQ_HARDCODED}|' '$SERVER'" \
  catch "$SERVER_T" "$WIRING_T"

echo
echo "mutants CAUGHT or correct: $PASSED; gaps: $FAILED"
[ "$FAILED" -eq 0 ]
