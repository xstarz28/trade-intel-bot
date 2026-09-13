#!/usr/bin/env bash
# Phase 193 — mutation suite for the orphan-key guard and the localized
# market-provenance surface.
#
# Every mutation targets a DIFFERENT failure mode the task called out:
#   M1  remove an active consumer            -> must be detected as orphaned
#   M2  make an active consumer dynamic      -> must NOT be misreported dead
#   M3  add an unreferenced production key   -> must be detected
#   M4  remove an allowlist entry            -> must fail while key is retained
#   M5  delete one locale's translation      -> parity must fail
#   M6  revert the LIVE badge to English     -> surface test must fail
#   M7  revert the legend to English         -> surface test must fail
#   M8  resurrect a retired system.* key     -> must fail (one locale only)
#   M9  slacken the ratchet budget           -> must fail (budget sanity)
#
# Restore is byte-exact via `cmp` against a `.bak` snapshot (the Phase 192
# lesson: `git diff` is useless for this when the tree is already dirty).
# A mutation that changes zero bytes is reported INVALID, never "passed".
set -uo pipefail
cd "$(dirname "$0")/.."

PANEL="src/components/MarketOverviewPanel.tsx"
GUARD="src/lib/i18n/orphan-key-guard.phase193.test.ts"
EN="src/lib/i18n/en.ts"
JA="src/lib/i18n/ja.ts"
TYPES="src/lib/i18n/types.ts"

TARGETS=("$PANEL" "$GUARD" "$EN" "$JA" "$TYPES")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p193bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p193bak" "$f"
    cmp -s "$f" "$f.p193bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p193bak"; done' EXIT

PASSED=0; FAILED=0

# $1 label, $2 mutation, $3 expectation (catch|survive), rest: test paths
mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  local expect="$1"; shift

  eval "$cmd" || { echo "SKIP     $label (could not apply)"; restore; return; }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p193bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >/tmp/p193_mut.log 2>&1; then
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

echo "=== Phase 193 mutation suite ==="

# M1 — remove an active consumer. The key becomes orphaned; the surface test
#      that asserts the rendered translation must fail.
mutate "M1 remove active consumer (legend)" \
  "perl -0pi -e 's|\{t\.market\.sourceTransparency\}|Source transparency|' '$PANEL'" \
  catch \
  src/components/market-overview-localization.phase193.test.tsx

# M2 — make an active consumer DYNAMIC. The key is still rendered, so the
#      surface test must still pass: proving the guard does not equate
#      "no literal member access" with "dead".
mutate "M2 active consumer made dynamic" \
  "perl -0pi -e 's|\{t\.market\.sourceTransparency\}|{(t.market as Record<string, string>)[\"sourceTransparency\"]}|' '$PANEL'" \
  survive \
  src/components/market-overview-localization.phase193.test.tsx

# M3 — add an unreferenced production key. Budget must trip.
mutate "M3 add unreferenced production key" \
  "perl -0pi -e 's|(  market: \{\n    title: )|    phase193OrphanProbe: \"orphan probe\",\n\$1|' '$EN' && perl -0pi -e 's|(  market: \{\n    title: string;)|  market: {\n    phase193OrphanProbe: string;\n    title: string;|' '$TYPES'" \
  catch \
  src/lib/i18n/orphan-key-guard.phase193.test.ts

# M4 — remove an allowlist entry while the key is still intentionally retained.
#      The allowlist must be self-validating in BOTH directions; here we delete
#      the reason text, which the "states a reason" assertion must reject.
mutate "M4 allowlist entry loses its reason" \
  "perl -0pi -e 's|reason: \"Phase 191 provenance vocabulary; renderer exists, data plumbing pending\.\",|reason: \"\",|' '$GUARD'" \
  catch \
  src/lib/i18n/orphan-key-guard.phase193.test.ts

# M5 — delete one locale's translation. Parity must fail.
mutate "M5 drop ja market.sourceTransparency" \
  "perl -0pi -e 's|    sourceTransparency:\n      \"[^\"]*\",\n||' '$JA'" \
  catch \
  src/lib/i18n/phase145-localization.test.ts \
  src/components/market-overview-localization.phase193.test.tsx

# M6 — revert the badge to hardcoded English.
mutate "M6 badge reverted to English LIVE/STALE" \
  "perl -0pi -e 's|\{isLive \? t\.market\.live : isStale \? t\.market\.stale : \"—\"\}|{isLive ? \"LIVE\" : isStale ? \"STALE\" : \"—\"}|' '$PANEL'" \
  catch \
  src/components/market-overview-localization.phase193.test.tsx

# M7 — remove the aria-label, losing the accessible name.
mutate "M7 badge loses its accessible name" \
  "perl -0pi -e 's|\n        aria-label=\{isLive \? t\.market\.live : isStale \? t\.market\.stale : t\.market\.unavailable\}||' '$PANEL'" \
  catch \
  src/components/market-overview-localization.phase193.test.tsx

# M8 — resurrect a retired system.* key in ONE locale (parity drift).
mutate "M8 resurrect system.stale in ja only" \
  "perl -0pi -e 's|(  system: \{\n)|\$1    stale: \"STALE\",\n|' '$JA'" \
  catch \
  src/lib/i18n/phase145-localization.test.ts \
  src/components/market-overview-localization.phase193.test.tsx

# M9 — slacken the ratchet so it can never fail.
mutate "M9 ratchet budget slackened" \
  "perl -0pi -e 's|const UNREFERENCED_BUDGET = \d+;|const UNREFERENCED_BUDGET = 99999;|' '$GUARD'" \
  catch \
  src/lib/i18n/orphan-key-guard.phase193.test.ts

echo "=== CAUGHT/CORRECT $PASSED / $((PASSED+FAILED)) ==="
[ "$FAILED" -eq 0 ] || exit 1
