#!/usr/bin/env bash
# Phase 190 — mutation suite for public-copy integrity.
#
# A guard that has never failed is not evidence. Each mutation reintroduces a
# specific defect this phase fixed; the suite must report CAUGHT for all of
# them. Files are restored from byte-exact `.bak` copies and verified with
# `cmp`, because `git diff` on an already-dirty tree yields phantom results.
#
#   usage: bash scripts/mutation-suite-phase190.sh
set -uo pipefail
cd "$(dirname "$0")/.."

LANDING="src/pages/Landing.tsx"
EN="src/lib/i18n/en.ts"
DE="src/lib/i18n/de.ts"
TYPES="src/lib/i18n/types.ts"
TRUTH="src/lib/i18n/public-copy-truthfulness.phase190.test.ts"
GUARD="src/lib/i18n/page-localization-guard.phase189.test.ts"
PARITY="src/lib/i18n/phase145-localization.test.ts"
HTML="index.html"

TARGETS=("$LANDING" "$EN" "$DE" "$TYPES" "$TRUTH" "$GUARD" "$PARITY" "$HTML")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p190bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p190bak" "$f"
    cmp -s "$f" "$f.p190bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}

PASSED=0; FAILED=0

# $1 = label, $2 = mutation command, $3... = test files to run
mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  eval "$cmd"
  if [ $? -ne 0 ]; then echo "SKIP   $label (mutation could not be applied)"; restore; return; fi
  # Mutation must actually change something, else the result is meaningless.
  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p190bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi
  if npx vitest run "$@" >/tmp/p190_mut.log 2>&1; then
    echo "SURVIVED  $label   <-- GUARD GAP"
    FAILED=$((FAILED+1))
  else
    echo "CAUGHT    $label"
    PASSED=$((PASSED+1))
  fi
  restore
}

echo "=== Phase 190 mutation suite ==="

# M1 — reinsert a hardcoded English string into the landing page.
mutate "M1 reinsert hardcoded Landing string" \
  "perl -0pi -e 's|\{t\.landing\.frameworkTitle\}|Analytical Framework|' '$LANDING'" \
  "$GUARD" "$TRUTH"

# M2 — delete a locale key (parity break).
mutate "M2 remove landing key from de" \
  "perl -0pi -e 's|^\s*coverageNote: \"[^\"]*\",\n||m' '$DE'" \
  "$PARITY" "$TRUTH"

# M3 — revert a translated value back to the English sentence.
mutate "M3 revert de translation to English" \
  "node -e '
   const fs=require(\"fs\");
   const en=fs.readFileSync(\"$EN\",\"utf8\").match(/heroBody: \"((?:[^\"\\\\\\\\]|\\\\\\\\.)*)\"/)[1];
   let de=fs.readFileSync(\"$DE\",\"utf8\");
   de=de.replace(/heroBody: \"(?:[^\"\\\\\\\\]|\\\\\\\\.)*\"/, \"heroBody: \\\"\"+en+\"\\\"\");
   fs.writeFileSync(\"$DE\",de);'" \
  "$TRUTH"

# M4 — rename a key in one locale only (contract drift).
mutate "M4 rename landing key in en" \
  "perl -0pi -e 's|coverageNote:|coverageNotes:|' '$EN'" \
  "$PARITY" "$TRUTH"

# M5 — reinsert retired Freebuff branding into public copy.
mutate "M5 reinsert Freebuff branding" \
  "perl -0pi -e 's|footerTagline: \"|footerTagline: \"Freebuff · |' '$EN'" \
  "$TRUTH"

# M6 — weaken the no-guaranteed-accuracy guarantee (overclaim).
mutate "M6 add a guaranteed-accuracy claim" \
  "perl -0pi -e 's|heroBody: \"|heroBody: \"This engine guarantees accuracy on every setup. |' '$EN'" \
  "$TRUTH"

# M7 — turn conditional live-data wording into an absolute claim.
mutate "M7 absolutise live-data wording" \
  "perl -0pi -e 's|featureFlowBody: \"|featureFlowBody: \"Always real-time data for all instruments. |' '$EN'" \
  "$TRUTH"

# M8 — restore the unsupported "any symbol" promise.
mutate "M8 reinstate the any-symbol claim" \
  "perl -0pi -e 's|coverageNote: \"|coverageNote: \"Analyse any symbol you want. |' '$EN'" \
  "$TRUTH"

# M9 — advertise indices while the UI selector cannot choose them.
mutate "M9 advertise index futures" \
  "perl -0pi -e 's|assetCommodity: \"|assetCommodity: \"index futures\", assetCommodityX: \"|' '$EN'" \
  "$PARITY" "$TRUTH"

# M10 — invent a regulatory / security certification claim.
mutate "M10 invent a compliance claim" \
  "perl -0pi -e 's|disclaimerBody: \"|disclaimerBody: \"Bank-grade and SOC 2 certified. |' '$EN'" \
  "$TRUTH"

for f in "${TARGETS[@]}"; do rm -f "$f.p190bak"; done
echo "=== CAUGHT $PASSED / $((PASSED+FAILED)) ==="
[ "$FAILED" -eq 0 ] || exit 1
