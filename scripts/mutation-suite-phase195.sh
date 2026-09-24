#!/usr/bin/env bash
# Phase 195 — mutation suite for AnalysisResult localization and the
# decision-semantics safety net.
#
# The premise being tested: localizing a trading surface must never change
# WHAT THE ENGINE DECIDED or WHAT THE USER IS CHARGED FOR. Each mutation
# plants a defect a careless translation pass could realistically introduce.
#
#   M1  couple a decision to the active locale     -> snapshot test must fail
#   M2  make chargeability locale-dependent        -> billing test must fail
#   M3  put a directional verb in the WAIT copy    -> §13 test must fail
#   M4  collapse two distinct risk dimensions      -> §8 test must fail
#   M5  equate confirmation with invalidation      -> §13 test must fail
#   M6  drop the negation from the TVL disclaimer  -> truthfulness must fail
#   M7  shorten a CJK disclaimer to hide overflow  -> length floor must fail
#   M8  translate the CFTC acronym                 -> §4 notation must fail
#   M9  revert a section heading to English        -> parity must fail
#   M10 empty one locale's field label             -> completeness must fail
#   M11 legitimate rewording of a heading          -> must NOT be flagged
#
# Restore is byte-exact via `cmp` against a `.bak` snapshot. A mutation that
# changes zero bytes is reported INVALID, never "passed".
set -uo pipefail
cd "$(dirname "$0")/.."

COMP="src/components/AnalysisResult.tsx"
SEM="src/components/analysis-result-semantics.phase195.test.tsx"
EN="src/lib/i18n/en.ts"
JA="src/lib/i18n/ja.ts"
ZH="src/lib/i18n/zh.ts"
DE="src/lib/i18n/de.ts"
ENT="src/lib/entitlement/entitlement.ts"

TARGETS=("$COMP" "$SEM" "$EN" "$JA" "$ZH" "$DE" "$ENT")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p195bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p195bak" "$f"
    cmp -s "$f" "$f.p195bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p195bak"; done' EXIT

PASSED=0; FAILED=0

# $1 label, $2 mutation, $3 expectation (catch|survive), rest: test paths
mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  local expect="$1"; shift

  eval "$cmd" || { echo "SKIP     $label (could not apply)"; restore; return; }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p195bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p195_${label%% *}.log" 2>&1; then
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

echo "=== Phase 195 mutation suite ==="

# M1 — couple the decision itself to the active locale. This is THE failure
#      the phase exists to prevent: a Japanese user seeing a different call.
#      Mutates the snapshot helper so a WAIT becomes NO_TRADE for one locale.
mutate "M1 decision coupled to locale" \
  "perl -0pi -e 's|    recommendation: result.recommendation,|    recommendation: locale === \"ja\" \&\& result.recommendation === \"WAIT\" ? \"NO_TRADE\" : result.recommendation,|' '$SEM'; \
   perl -0pi -e 's|  void locale;||' '$SEM'" \
  catch "$SEM"

# M2 — make chargeability depend on language. A trader must never be charged
#      because of the language they read the app in.
mutate "M2 chargeability depends on locale" \
  "perl -0pi -e 's|chargeable: isProfitSignal\(result.recommendation\)|chargeable: isProfitSignal(result.recommendation) \&\& locale !== \"ja\"|' '$SEM'" \
  catch "$SEM"

# M3 — plant a directional verb in the WAIT copy. WAIT must never read as a
#      recommendation to act.
mutate "M3 directional verb in WAIT copy" \
  "perl -0pi -e 's|whyWait: \"warum warten\?\"|whyWait: \"kaufen oder warten?\"|' '$DE'" \
  catch "$SEM"

# M4 — collapse structural and extension risk into one label, destroying the
#      distinction the trader uses to know WHICH risk they hold.
mutate "M4 two risk dimensions collapsed" \
  "perl -0pi -e 's|extensionRisk: \"伸長リスク:\"|extensionRisk: \"構造リスク:\"|' '$JA'" \
  catch "$SEM"

# M5 — equate confirmation with invalidation: the two opposite outcomes of a
#      thesis would render identically.
mutate "M5 confirmation == invalidation" \
  "perl -0pi -e 's|invalidationLabel: \"失效\"|invalidationLabel: \"确认\"|' '$ZH'" \
  catch "$SEM"

# M6 — drop the negation from the TVL disclaimer, turning "not guaranteed
#      bullish" into a bullish promise.
mutate "M6 TVL disclaimer loses its negation" \
  "perl -0pi -e 's|TVL expansion is supportive context, not guaranteed bullish.|TVL expansion is a bullish confirmation.|' '$EN'" \
  catch "$SEM"

# M7 — shorten a CJK disclaimer to make it fit, the exact shortcut the
#      standing rule forbids ("fix the layout, not the translation").
mutate "M7 CJK disclaimer shortened to fit" \
  "perl -0pi -e 's|unlocksDisclaimer: \"[^\"]*\"|unlocksDisclaimer: \"解锁不是信号\"|' '$ZH'" \
  catch "$SEM"

# M8 — translate an institution acronym. CFTC names a specific US agency;
#      translating it makes the data provenance unverifiable.
mutate "M8 CFTC acronym translated away" \
  "perl -0pi -e 's|cftcFuturesPositioning: \"CFTC先物ポジション\"|cftcFuturesPositioning: \"先物ポジション\"|' '$JA'" \
  catch "$SEM"

# M9 — revert a section heading to English in ONE locale. Key-count parity
#      cannot see this (the key still exists and is non-empty), so it is the
#      script-awareness guard that has to catch it.
mutate "M9 section heading reverted to English" \
  "perl -0pi -e 's|decisionSnapshot: \"判断スナップショット\"|decisionSnapshot: \"decision-snapshot\"|' '$JA'" \
  catch "$SEM"

# M10 — blank one locale's field label. A trader would see an empty caption
#       next to a real number.
mutate "M10 field label emptied in one locale" \
  "perl -0pi -e 's|strongestSupport: \"最强支持：\"|strongestSupport: \"\"|' '$ZH'" \
  catch "$SEM"

# M11 — a LEGITIMATE rewording. The guards must not fire on honest edits,
#       otherwise translators are trained to ignore them.
mutate "M11 legitimate heading rewording" \
  "perl -0pi -e 's|scoreBreakdown: \"score-aufschlüsselung\"|scoreBreakdown: \"punkte-aufschlüsselung\"|' '$DE'" \
  survive "$SEM" src/lib/i18n/phase145-localization.test.ts

echo "=== CAUGHT/CORRECT $PASSED / $((PASSED+FAILED)) ==="
[ "$FAILED" -eq 0 ]
