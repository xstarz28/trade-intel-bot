#!/usr/bin/env bash
# Phase 191 — mutation suite for authenticated-copy integrity.
#
# Each mutation reintroduces a specific way the authenticated UI could mislead
# a user who is about to risk capital. All must be reported CAUGHT.
#
# Files are restored from byte-exact `.bak` copies and verified with `cmp`;
# `git diff` on an already-dirty tree yields phantom results. A mutation that
# changes no bytes is reported INVALID rather than silently "passing".
#
#   usage: bash scripts/mutation-suite-phase191.sh
set -uo pipefail
cd "$(dirname "$0")/.."

EN="src/lib/i18n/en.ts"
DE="src/lib/i18n/de.ts"
PROV="src/lib/i18n/provenance-copy.ts"
HIST="src/components/AnalysisHistory.tsx"
PPD="src/components/PositionProtectionDashboard.tsx"
DASH="src/pages/Dashboard.tsx"
REG="src/lib/market-radar/provider-registry.ts"
TYPES="src/lib/market-radar/types.ts"

TRUTH="src/lib/i18n/authenticated-copy-truthfulness.phase191.test.ts"
GUARD="src/lib/i18n/page-localization-guard.phase189.test.ts"
PARITY="src/lib/i18n/phase145-localization.test.ts"

TARGETS=("$EN" "$DE" "$PROV" "$HIST" "$PPD" "$DASH" "$REG" "$TYPES" "$TRUTH" "$GUARD" "$PARITY")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p191bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p191bak" "$f"
    cmp -s "$f" "$f.p191bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}

PASSED=0; FAILED=0

mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  eval "$cmd"
  if [ $? -ne 0 ]; then echo "SKIP     $label (could not apply)"; restore; return; fi
  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p191bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed)"
    FAILED=$((FAILED+1)); restore; return
  fi
  if npx vitest run "$@" >/tmp/p191_mut.log 2>&1; then
    echo "SURVIVED $label   <-- GUARD GAP"
    FAILED=$((FAILED+1))
  else
    echo "CAUGHT   $label"
    PASSED=$((PASSED+1))
  fi
  restore
}

echo "=== Phase 191 mutation suite ==="

# M1 — confidence reframed as a probability.
mutate "M1 confidence -> probability" \
  "perl -0pi -e 's|confidenceNotProbability: \"[^\"]*\"|confidenceNotProbability: \"Confidence is the probability of success.\"|' '$EN'" \
  "$TRUTH"

# M2 — conviction reframed as a win rate.
mutate "M2 conviction -> win rate" \
  "perl -0pi -e 's|convictionPrefix: \"[^\"]*\"|convictionPrefix: \"Historical win rate\"|' '$EN'" \
  "$TRUTH"

# M3 — history reverts to a bare percentage.
mutate "M3 history shows raw confidence %" \
  "perl -0pi -e 's|\{mapConfidence\(a\.conviction \?\? deriveConvictionBand\(a\.confidence\), t\)\}|{a.confidence}%|' '$HIST'" \
  "$TRUTH"

# M4 — LOCKED presented as WAIT.
mutate "M4 LOCKED -> WAIT" \
  "perl -0pi -e 's|lockedNotWait: \"[^\"]*\"|lockedNotWait: \"This is a Wait verdict; no action needed.\"|' '$EN'" \
  "$TRUTH"

# M5 — LOCKED leaks the withheld direction.
mutate "M5 LOCKED leaks direction" \
  "perl -0pi -e 's|lockedBody: \"|lockedBody: \"The withheld direction is LONG. |' '$EN'" \
  "$TRUTH"

# M6 — cached data described as a new observation.
mutate "M6 cache-reused -> observed now" \
  "perl -0pi -e 's|cacheReused: \"[^\"]*\"|cacheReused: \"Observed now\"|' '$EN'" \
  "$TRUTH"

# M7 — cache mode allowed to present as current.
mutate "M7 cache may present as current" \
  "perl -0pi -e 's|return isNewObservation\(\{|return true \|\| isNewObservation({|' '$PROV'" \
  "$TRUTH"

# M8 — unavailable described as complete/healthy.
mutate "M8 unavailable -> complete" \
  "perl -0pi -e 's|unavailable: \"Unavailable\"|unavailable: \"Complete and verified by the provider\"|' '$EN'" \
  "$TRUTH"

# M9 — degraded described as a market verdict.
mutate "M9 degraded -> no trade verdict" \
  "perl -0pi -e 's|degraded: \"[^\"]*\"|degraded: \"No opportunity — wait\"|' '$EN'" \
  "$TRUTH"

# M10 — historical described as current.
mutate "M10 historical -> live" \
  "perl -0pi -e 's|historical: \"[^\"]*\"|historical: \"Live real-time evidence\"|' '$EN'" \
  "$TRUTH"

# M11 — monitoring described as execution.
mutate "M11 monitoring -> execution" \
  "perl -0pi -e 's|noAutoExecute: \"[^\"]*\"|noAutoExecute: \"Your order was submitted and the trade executed.\"|' '$EN'" \
  "$TRUTH"

# M12 — the execution boundary stops being rendered.
mutate "M12 stop rendering the no-exec boundary" \
  "perl -0pi -e 's|\{tx\(\"protection.noAutoExecute\"\)\}||' '$PPD'" \
  "$TRUTH"

# M13 — suggested stop becomes a guaranteed stop.
# NOTE: this value wraps onto a continuation line, so the opening quote is not
# on the key's line. Match across the newline (Phase 189 lesson).
mutate "M13 suggested stop -> guaranteed stop" \
  "perl -0pi -e 's|riskNoteDisclaimer:\s*\n?\s*\"|riskNoteDisclaimer: \"Your stop-loss is guaranteed and caps your losses at this level. |s' '$EN'" \
  "$TRUTH"

# M14 — fetch time laundered into observation time.
mutate "M14 observedAt <- fetchTimestamp" \
  "perl -0pi -e 's|observedAt: ls\.marketData\.price\.timestamp \|\| undefined|observedAt: ls.marketData.price.timestamp \|\| ls.marketData.fetchTimestamp|' '$DASH'" \
  "$TRUTH"

# M15 — missing observation time still graded realtime.
mutate "M15 no observation -> realtime" \
  "perl -0pi -e 's|result\.snapshot\.observedAt === undefined\n      \? \"unavailable\"\n      :|false ? \"unavailable\" :|s' '$REG'" \
  "$TRUTH"

# M16 — a locale key is removed.
mutate "M16 remove provenance key from de" \
  "perl -0pi -e 's|^\s*cacheReused: \"[^\"]*\",\n||m' '$DE'" \
  "$PARITY" "$TRUTH"

# M17 — a locale falls back to English.
mutate "M17 de falls back to English provenance" \
  "perl -0pi -e 's|cacheReused: \"[^\"]*\"|cacheReused: \"Reused earlier observation — provider not contacted\"|' '$DE'" \
  "$TRUTH"

# M18 — the {age} placeholder is renamed.
mutate "M18 rename {age} placeholder" \
  "perl -0pi -e 's|evidenceAge: \"Evidence age \{age\}\"|evidenceAge: \"Evidence age {ageMs}\"|' '$EN'" \
  "$PARITY" "$TRUTH"

# M19 — hardcoded English reappears in a clean component.
mutate "M19 plant hardcoded copy in a clean component" \
  "perl -0pi -e 's|<div className=\"space-y-4\">|<div className=\"space-y-4\"><p>Your position was closed automatically</p>|' '$PPD'" \
  "$GUARD" "$TRUTH"

for f in "${TARGETS[@]}"; do rm -f "$f.p191bak"; done
echo "=== CAUGHT $PASSED / $((PASSED+FAILED)) ==="
[ "$FAILED" -eq 0 ] || exit 1
