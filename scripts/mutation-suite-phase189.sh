#!/usr/bin/env bash
# Phase 189 — mutation suite for first-run / entitlement / provider integrity.
#
# This harness was originally written under /tmp during Phase 189 and was lost
# when the sandbox was re-provisioned. It now lives in the repository so the
# evidence is reproducible rather than anecdotal.
#
# METHOD NOTE (the M7 lesson):
#   `git diff` is USELESS for deciding whether a mutation applied here, because
#   the working tree may itself be dirty — an unrelated modification makes a
#   failed mutation look applied ("phantom SURVIVED"). Every check below uses
#   byte-exact `cmp` against a `.bak` snapshot taken immediately before the
#   edit, and a mutation that changes zero bytes is reported INVALID rather
#   than being allowed to masquerade as a pass.
#
#   usage: bash scripts/mutation-suite-phase189.sh
set -uo pipefail
cd "$(dirname "$0")/.."

PROTECTED="src/convex/protectedAnalysis.ts"
ENTITLE="src/lib/entitlement/entitlement.ts"
GATE="src/lib/entitlement/decision-gate.ts"
RESILIENCE="src/lib/data/provider-resilience.ts"

TARGETS=("$PROTECTED" "$ENTITLE" "$GATE" "$RESILIENCE")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p189bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p189bak" "$f"
    cmp -s "$f" "$f.p189bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}

PASSED=0; FAILED=0

# $1 = label, $2 = mutation command, $3.. = test paths
mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  eval "$cmd"
  if [ $? -ne 0 ]; then echo "SKIP     $label (could not apply)"; restore; return; fi

  # Byte-exact applied-check — never `git diff`.
  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p189bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >/tmp/p189_mut.log 2>&1; then
    echo "SURVIVED $label   <-- GUARD GAP"
    FAILED=$((FAILED+1))
  else
    echo "CAUGHT   $label"
    PASSED=$((PASSED+1))
  fi
  restore
}

echo "=== Phase 189 mutation suite ==="

# ── M2 — invalid input reported as success ──────────────────────
# Missing instrument/timeframe must fail closed. Turning INVALID_INPUT into
# DELIVERED would hand the caller a "result" built from nothing.
mutate "M2 invalid-input -> success (DELIVERED)" \
  "perl -0pi -e 's|status: \"INVALID_INPUT\" as const|status: \"DELIVERED\" as const|' '$PROTECTED'" \
  src/convex/protected-analysis-wiring.phase174.test.ts \
  src/convex/protected-analysis-bypass.phase174.test.ts \
  src/pages/first-run.phase189.test.tsx

# ── M3 — WAIT becomes chargeable ────────────────────────────────
# WAIT/NO_TRADE must always be free. Making every recommendation chargeable
# would bill a user for being told not to trade.
mutate "M3 WAIT -> chargeable" \
  "perl -0pi -e 's|if \(NON_ACTIONABLE\.has\(normalized\)\) return false;||' '$ENTITLE'" \
  src/lib/entitlement/ \
  src/convex/entitlements.phase169.test.ts \
  src/pages/first-run.phase189.test.tsx

# ── M4 — LOCKED downgraded to WAIT ──────────────────────────────
# The single most dangerous entitlement mutation: it rewrites a withheld
# directional signal into "no trade", inverting the user's decision.
mutate "M4 LOCKED -> WAIT" \
  "perl -0pi -e 's|return \{ status: \"LOCKED\", chargeable: true, result: locked \};|return { status: \"WAIT\", chargeable: false, result: locked } as never;|' '$GATE'" \
  src/lib/entitlement/ \
  src/components/entitlement-surface.phase188.test.tsx \
  src/pages/first-run.phase189.test.tsx

# ── M6 — provider failure reported as success ───────────────────
# A failed leg must never surrender data. Relabelling failure as success is
# how fabricated evidence enters the engine.
mutate "M6 provider-failure -> success" \
  "perl -0pi -e 's|status: \"failed\" as const|status: \"success\" as const|' '$RESILIENCE'" \
  src/lib/data/provider-resilience.phase177.test.ts \
  src/convex/fanout-integration.phase177.test.ts \
  src/lib/entitlement/chargeability-invariants.phase189.test.ts \
  src/pages/first-run.phase189.test.tsx

for f in "${TARGETS[@]}"; do rm -f "$f.p189bak"; done
echo "=== CAUGHT $PASSED / $((PASSED+FAILED)) ==="
[ "$FAILED" -eq 0 ] || exit 1
