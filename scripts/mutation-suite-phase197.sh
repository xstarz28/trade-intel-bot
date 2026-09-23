#!/usr/bin/env bash
# Phase 197 — mutation suite for historical-timeline localization.
#
# The premise: the timeline is an EVIDENCE surface. Localizing it must change
# the language a trader reads and nothing else — not which fields are marked as
# changed, not the direction of a transition, not the instrument identity, and
# not the persisted record the engine wrote.
#
# Phase 197 carries one risk the earlier phases did not: three of the defects
# fixed here were INVISIBLE to the shared hardcoded-copy detector (array
# literals, raw enum values, lib-side template prose). So these mutations
# deliberately target the detector's blind spots — a guard that only re-runs
# the detector would score 0/N on this list.
#
#   M1  a localized caption reverted to hardcoded English        -> CAUGHT
#   M2  raw enum rendered instead of the mapper (detector-blind) -> CAUGHT
#   M3  structure mapper returns the canonical enum              -> CAUGHT
#   M4  change detection driven by TRANSLATED text, not enums    -> CAUGHT
#       (structurally; see the note on the mutation itself)
#   M5  instrument symbol translated                             -> CAUGHT
#   M6  event clock reverted to the host locale                  -> CAUGHT
#   M7  stored English description rendered verbatim             -> CAUGHT
#   M8  interpretation falls back to the English sentence        -> CAUGHT
#   M9  engine's persisted description rewritten at the source   -> CAUGHT
#   M10 one locale key emptied                                   -> CAUGHT
#   M11 side dropped from the initial-analysis sentence          -> CAUGHT
#   M12 a legitimate rewording of a translated label             -> must NOT flag
#
# Restore is byte-exact via `cmp` against a `.bak` snapshot. A mutation that
# changes zero bytes is reported INVALID, never "passed".
set -uo pipefail
cd "$(dirname "$0")/.."

COMP="src/components/HistoricalTimeline.tsx"
INPUT="src/components/InstrumentInput.tsx"
INPUT_SEM="src/components/instrument-input-localization.phase197.test.tsx"
ALERTS="src/components/CustomAlertRulesPanel.tsx"
NOTIFS="src/components/NotificationCenter.tsx"
ALERTS_SEM="src/components/alerts-notifications-localization.phase197.test.tsx"
GUARD="src/lib/i18n/page-localization-guard.phase189.test.ts"
SEM="src/components/historical-timeline-localization.phase197.test.tsx"
MAP="src/lib/i18n/enum-mapping.ts"
LIB="src/lib/position-protection/historical-intelligence.ts"
EN="src/lib/i18n/en.ts"
JA="src/lib/i18n/ja.ts"
DE="src/lib/i18n/de.ts"

# Phase 90/91 assert the persisted description byte-for-byte; M9 must be caught
# by them, so they are part of the verification set.
PERSIST="src/lib/position-protection/phase90-persistent-history.test.ts"

TARGETS=("$COMP" "$SEM" "$MAP" "$LIB" "$EN" "$JA" "$DE" "$INPUT" "$ALERTS" "$NOTIFS" "$GUARD")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p197bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p197bak" "$f"
    cmp -s "$f" "$f.p197bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p197bak"; done' EXIT

PASSED=0; FAILED=0

# $1 label, $2 mutation, $3 expectation (catch|survive), rest: test paths
mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  local expect="$1"; shift

  eval "$cmd" || { echo "SKIP     $label (could not apply)"; restore; return; }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p197bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p197_${label%% *}.log" 2>&1; then
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

echo "=== Phase 197 mutation suite ==="

# M1 — revert a localized caption to hardcoded English.
mutate "M1 caption reverted to English" \
  "perl -0pi -e 's|\{t\.timeline\.currentLabel\}:|Current:|' '$COMP'" \
  catch "$SEM"

# M2 — render the raw enum instead of routing through the mapper. This is the
#      defect the detector CANNOT see, because the value is a variable.
mutate "M2 raw enum rendered (detector-blind)" \
  "perl -0pi -e 's|previous: mapStructureValue\(previous\.structure, t\)|previous: previous.structure|' '$COMP'" \
  catch "$SEM"

# M3 — mapper stops translating and echoes the canonical enum. Asserting the
#      mapper is *called* would miss this; the test must compare output values.
mutate "M3 structure mapper returns canonical enum" \
  "perl -0pi -e 's|    case \"LOWER_HIGHS_LOWER_LOWS\": return t\.intelligence\.structureLhLl;|    case \"LOWER_HIGHS_LOWER_LOWS\": return \"LOWER_HIGHS_LOWER_LOWS\";|' '$MAP'" \
  catch "$SEM"

# M4 — compute `changed` from the TRANSLATED strings. In locales where two
#      states share a translation this silently loses a real change.
#
#      NOTE: this is behaviourally an EQUIVALENT MUTANT today — no two values in
#      any enum domain currently share a translation in any of the nine locales,
#      so the rewritten predicate returns the same booleans. It is nonetheless a
#      latent defect (the first colliding translation would suppress a real
#      change), so it is caught STRUCTURALLY by asserting that no `changed:`
#      expression calls a mapper, and the no-collision invariant that makes the
#      mutant equivalent is itself asserted as a test. Both live in $SEM.
mutate "M4 change detection uses translated text" \
  "perl -0pi -e 's|changed: previous\.structure !== current\.structure|changed: mapStructureValue(previous.structure, t) !== mapStructureValue(current.structure, t)|' '$COMP'" \
  catch "$SEM"

# M5 — translate the instrument symbol. Provider-native identity must survive.
mutate "M5 instrument symbol translated" \
  "perl -0pi -e 's|\\\$\{snapshot\.instrument\}|INSTRUMENT|' '$COMP'" \
  catch "$SEM"

# M6 — revert the clock to the host locale (the Phase 196 defect class).
mutate "M6 clock reverted to host locale" \
  "perl -0pi -e 's|toLocaleTimeString\(locale,|toLocaleTimeString([],|' '$COMP'" \
  catch "$SEM"

# M7 — render the stored English description verbatim in every locale.
mutate "M7 stored English description rendered" \
  "perl -0pi -e 's|\{localizeEventDescription\(event, t, snapshot\) \?\? event\.description\}|{event.description}|' '$COMP'" \
  catch "$SEM"

# M8 — drop the structured interpretation and fall back to English prose.
mutate "M8 interpretation falls back to English" \
  "perl -0pi -e 's|\{localizeInterpretation\(summary, t, txi\)\}|{summary.interpretation}|' '$COMP'" \
  catch "$SEM"

# M9 — rewrite the PERSISTED description at the source. This is the change the
#      phase deliberately refused to make.
#
#      This mutation originally SURVIVED: Phase 90/91 only use descriptions as
#      round-trip fixtures, so nothing pinned the string the engine actually
#      emits — the template could have been rewritten, invalidating every
#      already-persisted row, with the whole suite still green. The gap is now
#      closed by an explicit regression in $SEM.
mutate "M9 persisted description rewritten at source" \
  "perl -0pi -e 's|description: \`Thesis: \\\$\{previous\.thesisState\} → \\\$\{current\.thesisState\}\`|description: \`THESIS \\\$\{previous.thesisState} to \\\$\{current.thesisState}\`|' '$LIB'" \
  catch "$PERSIST" "$SEM"

# M10 — empty one locale value. Parity must fail loudly, not render blank.
mutate "M10 locale key emptied" \
  "perl -0pi -e 's|    structureLhLl: \"高値切り下げ／安値切り下げ\",|    structureLhLl: \"\",|' '$JA'" \
  catch "src/lib/i18n/phase145-localization.test.ts"

# M11 — drop the side from the initial-analysis sentence. LONG vs SHORT is the
#       single most consequential fact on the surface.
mutate "M11 side dropped from initial analysis" \
  "perl -0pi -e 's|\\\$\{snapshot\.instrument\} \\\$\{mapSide\(snapshot\.side, t\)\} — |\\\$\{snapshot.instrument} — |' '$COMP'" \
  catch "$SEM"

# M12 — CONTROL: a legitimate rewording of a German label. Translations must be
#       free to improve without the guard objecting.
mutate "M12 legitimate rewording (control)" \
  "perl -0pi -e 's|    momentumOverbought: \"Überkauft\",|    momentumOverbought: \"Überkauft-Zone\",|' '$DE'" \
  survive "$SEM"

# ─── InstrumentInput ────────────────────────────────────────────────────────

# M13 — translate the VALUE instead of the label. The backend would receive an
#       asset class no provider adapter recognises.
mutate "M13 SelectItem value translated" \
  "perl -0pi -e 's|<SelectItem value=\"crypto\">|<SelectItem value={t.entryForm.typeCrypto}>|' '$INPUT'" \
  catch "$INPUT_SEM"

# M14 — revert a terminal heading to hardcoded English.
mutate "M14 terminal heading hardcoded" \
  "perl -0pi -e 's|\\\$ \{t\.entryForm\.newAnalysisHeading\}|\\\$ new-analysis|' '$INPUT'" \
  catch "$INPUT_SEM"

# M15 — render the raw lowercase enum on the trading-style buttons.
mutate "M15 trading style renders raw enum" \
  "perl -0pi -e 's|\{mapHorizon\(st\.toUpperCase\(\), t\)\}|{st}|' '$INPUT'" \
  catch "$INPUT_SEM"

# M16 — submit the TRANSLATION rather than the canonical style value.
mutate "M16 handler submits translation" \
  "perl -0pi -e 's|update\(\"tradingStyle\", st\)|update(\"tradingStyle\", mapHorizon(st.toUpperCase(), t) as TradingStyle)|' '$INPUT'" \
  catch "$INPUT_SEM"

# M17 — give two asset classes the same translation, making them
#       indistinguishable in the dropdown.
mutate "M17 duplicate asset-type labels" \
  "perl -0pi -e 's|    typeStock: \"株式\",|    typeStock: \"商品\",|' '$JA'" \
  catch "$INPUT_SEM"

# ─── Alerts / Notifications / Protection panel ──────────────────────────────

# M18 — localize a toast but drop the translator from the dependency array.
#       The callback keeps the language captured at mount: switch to Japanese,
#       delete a rule, and the confirmation is still in English.
mutate "M18 stale closure on locale switch" \
  "perl -0pi -e 's|    \[deleteRule, t\],|    [deleteRule],|' '$ALERTS'" \
  catch "$ALERTS_SEM"

# M19 — translate the filter VALUE rather than its label.
mutate "M19 filter value translated" \
  "perl -0pi -e 's|\{ label: \"UNREAD\", value: \"UNREAD\" \}|{ label: \"UNREAD\", value: \"Ungelesen\" }|' '$NOTIFS'" \
  catch "$ALERTS_SEM"

# M20 — replace the provider's real failure reason with generic localized copy.
#       The user would lose the actual reason the backend rejected the rule.
mutate "M20 backend error reason discarded" \
  "perl -0pi -e 's|toast\\.error\\(errorMessage\\(err\\) \\|\\| t\\.alerts\\.ruleDeleteFailed\\);|toast.error(t.alerts.ruleDeleteFailed);|' '$ALERTS'" \
  catch "$ALERTS_SEM"

# M21 — drop the interpolation, making the confirmation ambiguous.
mutate "M21 {name} dropped from toast" \
  "perl -0pi -e 's|    ruleCreated: \"ルール「\{name\}」を作成しました\",|    ruleCreated: \"ルールを作成しました\",|' '$JA'" \
  catch "$ALERTS_SEM"

# M22 — give the two toggle states identical wording.
mutate "M22 show/hide indistinguishable" \
  "perl -0pi -e 's|    preferencesHide: \"Ausblenden\",|    preferencesHide: \"Einstellungen\",|' '$DE'" \
  catch "$ALERTS_SEM"

# M23 — the Phase 197 invariant itself: re-adding a MOUNTED component to the
#       debt list must fail, so the zero-debt state cannot be quietly undone.
mutate "M23 mounted component re-added to debt" \
  "perl -0pi -e 's|const COMPONENT_DEBT: Record<string, string> = \{|const COMPONENT_DEBT: Record<string, string> = {\n  \"src/components/Journal.tsx\": \"planted mounted entry for mutation M23\",|' '$GUARD'" \
  catch "$GUARD"

echo ""
echo "=== Phase 197 mutation results: $PASSED passed / $((PASSED+FAILED)) total ==="
[ "$FAILED" -eq 0 ] || exit 1
