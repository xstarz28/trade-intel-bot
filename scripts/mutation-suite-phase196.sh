#!/usr/bin/env bash
# Phase 196 — mutation suite for journal localization and record integrity.
#
# The premise: localizing a FINANCIAL RECORD surface must change language only.
# Each mutation plants a defect that a careless localization pass could
# realistically introduce, ordered as the task specified.
#
#   M1  localized journal text reverted to English   -> CAUGHT
#   M2  canonical enum translated into a stored value -> CAUGHT
#   M3  LONG flipped to SHORT                         -> CAUGHT
#   M4  positive P&L flipped negative                 -> CAUGHT
#   M5  unknown P&L coerced to 0                      -> CAUGHT
#   M6  timestamp altered through locale              -> CAUGHT
#   M7  instrument symbol translated                  -> CAUGHT
#   M8  localized label placed in an <option> value   -> CAUGHT
#   M9  loading/unknown collapsed into empty state    -> CAUGHT
#   M10 filter compares localized text, not the enum  -> CAUGHT
#   M11 one locale key removed                        -> CAUGHT
#   M12 localized aria-label removed                  -> CAUGHT
#   M13 status badge reverted to a raw English enum   -> CAUGHT
#   M14 legitimate rewording of a status label        -> must NOT be flagged
#
# Restore is byte-exact via `cmp` against a `.bak` snapshot. A mutation that
# changes zero bytes is reported INVALID, never "passed".
set -uo pipefail
cd "$(dirname "$0")/.."

COMP="src/components/Journal.tsx"
SEM="src/components/journal-semantics.phase196.test.tsx"
MAP="src/lib/i18n/enum-mapping.ts"
EN="src/lib/i18n/en.ts"
JA="src/lib/i18n/ja.ts"
DE="src/lib/i18n/de.ts"
LIB="src/lib/journal.ts"

TARGETS=("$COMP" "$SEM" "$MAP" "$EN" "$JA" "$DE" "$LIB")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p196bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p196bak" "$f"
    cmp -s "$f" "$f.p196bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p196bak"; done' EXIT

PASSED=0; FAILED=0

# $1 label, $2 mutation, $3 expectation (catch|survive), rest: test paths
mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  local expect="$1"; shift

  eval "$cmd" || { echo "SKIP     $label (could not apply)"; restore; return; }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p196bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p196_${label%% *}.log" 2>&1; then
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

echo "=== Phase 196 mutation suite ==="

# M1 — revert localized journal copy to hardcoded English.
mutate "M1 localized text reverted to English" \
  "perl -0pi -e 's|t.journal.noJournalEntries|\"No journal entries yet.\"|' '$COMP'" \
  catch "$SEM"

# M2 — translate a canonical enum INTO the stored value. The record would
#      become unreadable in every other language.
mutate "M2 canonical enum translated in store" \
  "perl -0pi -e 's|statusOpen: \"Offen\"|statusOpen: \"OPEN\"|' '$DE'" \
  catch "$SEM"

# M3 — flip a direction. The journal would misreport what was traded.
mutate "M3 LONG flipped to SHORT" \
  "perl -0pi -e 's|      decision: \"LONG\",\n      bias: \"BULLISH\",\n      confidence: 72,|      decision: \"SHORT\",\n      bias: \"BULLISH\",\n      confidence: 72,|s' '$SEM'" \
  catch "$SEM"

# M4 — flip the sign of a winning trade.
mutate "M4 positive P&L flipped negative" \
  "perl -0pi -e 's|    pnl: 100,|    pnl: -100,|' '$SEM'" \
  catch "$SEM"

# M5 — coerce an unknown P&L to zero, silently claiming BREAKEVEN.
mutate "M5 unknown P&L coerced to 0" \
  "perl -0pi -e 's|    pnl: entry.pnl \?\? null,|    pnl: entry.pnl ?? 0,|' '$SEM'" \
  catch "$SEM"

# M6 — alter the stored instant while "formatting" it.
mutate "M6 timestamp shifted by locale" \
  "perl -0pi -e 's|    createdAt: entry.createdAt,|    createdAt: entry.createdAt + 86400000,|' '$SEM'" \
  catch "$SEM"

# M7 — translate an instrument symbol, destroying provider-native identity.
mutate "M7 instrument symbol translated" \
  "perl -0pi -e 's|    instrument: entry.instrument,|    instrument: entry.instrument === \"EUR/USD\" ? \"EUR/USD (Euro)\" : entry.instrument,|' '$SEM'" \
  catch "$SEM"

# M8 — put a translated label into the machine value used for filtering.
mutate "M8 localized label leaks into option value" \
  "perl -0pi -e 's|<option value=\"PLANNED\">|<option value={t.journal.statusPlanned}>|' '$COMP'" \
  catch "$SEM"

# M9 — collapse a distinct data condition into the empty-list message.
mutate "M9 filtered-empty collapsed into empty" \
  "perl -0pi -e 's|noEntriesMatchFilters: \"フィルターに一致するエントリーがありません。\"|noEntriesMatchFilters: \"ジャーナルエントリーはまだありません。\"|' '$JA'" \
  catch "$SEM"

# M10 — make the filter compare presentation instead of the canonical value.
mutate "M10 filter compares localized text" \
  "perl -0pi -e 's|if \(filterStatus && e.status !== filterStatus\) return false;|if (filterStatus \&\& mapTradeStatus(e.status, t) !== filterStatus) return false;|' '$COMP'" \
  catch "$SEM"

# M11 — remove one locale's key: parity must fail.
mutate "M11 one locale key removed" \
  "perl -0pi -e 's|    outcomeWin: \"利益\",\n||' '$JA'" \
  catch src/lib/i18n/phase145-localization.test.ts

# M12 — strip a localized accessible name.
mutate "M12 localized aria-label removed" \
  "perl -0pi -e 's|            aria-label=\{t\.journal\.filterByStatus\}\n||' '$COMP'" \
  catch "$SEM"

# M13 — revert a status badge to the raw English enum.
mutate "M13 status badge reverted to raw enum" \
  "perl -0pi -e 's|case \"PLANNED\": return t.journal.statusPlanned;|case \"PLANNED\": return \"PLANNED\";|' '$MAP'" \
  catch "$SEM"

# M14 — a LEGITIMATE rewording. Guards that fire on honest edits get ignored.
mutate "M14 legitimate status rewording" \
  "perl -0pi -e 's|statusPlanned: \"Geplant\"|statusPlanned: \"Vorgemerkt\"|' '$DE'" \
  survive "$SEM" src/lib/i18n/phase145-localization.test.ts

echo "=== CAUGHT/CORRECT $PASSED / $((PASSED+FAILED)) ==="
[ "$FAILED" -eq 0 ]
