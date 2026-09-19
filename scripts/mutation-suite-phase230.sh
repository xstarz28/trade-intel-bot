#!/usr/bin/env bash
# Phase 230 — mutation suite for single-leg provider failure semantics.
#
# The premise: a 429/401/403 must read as RATE_LIMIT/AUTH_ERROR end-to-end, a
# non-fatal leg failure must carry its class on the payload, an outage must
# never be cached or masquerade as "no data", and the DXY negative cache may
# only be armed by a DEFINITIVE provider answer — never by a quota or
# transport failure during probing. Every mutation below re-introduces one of
# the pre-phase defects; each must be CAUGHT by the Phase 230 suites.
#
#   M1  treasury: HTTP 429 no longer classified          -> CAUGHT
#   M2  treasury: all-legs outage no longer throws       -> CAUGHT
#   M3  treasury: per-leg failure metadata dropped       -> CAUGHT
#   M4  treasury: outer catch maps RATE_LIMIT generically -> CAUGHT
#   M5  cot: HTTP 429 no longer classified               -> CAUGHT
#   M6  cot: API_UNAVAILABLE branch hardcodes a class    -> CAUGHT
#   M7  eia: all-legs outage cached again (the 6h poison) -> CAUGHT
#   M8  eia: 401/403 no longer AUTH_ERROR                -> CAUGHT
#   M9  eia: failed-leg class stripped from the payload  -> CAUGHT
#   M10 okx spec: HTTP 429 no longer classified          -> CAUGHT
#   M11 okx book: pinned literal rewritten (D10 contract) -> CAUGHT
#   M12 marketData: transport failures arm DXY poison    -> CAUGHT
#   M13 marketData: inconclusive wave overrides poison guard -> CAUGHT
#   M14 fx: HTTP 429 no longer classified                -> CAUGHT
#   M15 fx: JSON code 429 no longer classified           -> CAUGHT
#   M16 fx: both-legs outage reported as "no quote"      -> CAUGHT
#   M17 marketData: outer defensive fatal map removed    -> CAUGHT
#   M18 eia: outer catch maps AUTH_ERROR generically     -> CAUGHT
#
# Restore is byte-exact via `cmp` against a `.p230bak` snapshot. A mutation
# that changes zero bytes is reported INVALID, never "passed".
set -uo pipefail
cd "$(dirname "$0")/.."

TRE="src/convex/treasury.ts"
COT="src/convex/cot.ts"
EIA="src/convex/eia.ts"
OKX="src/convex/okx.ts"
MD="src/convex/marketData.ts"

TRE_T="src/convex/treasury-legs.phase230.test.ts"
COT_T="src/convex/cot-legs.phase230.test.ts"
EIA_T="src/convex/eia-legs.phase230.test.ts"
OKX_T="src/convex/okx-legs.phase230.test.ts"
FX_T="src/convex/fx-rate-legs.phase230.test.ts"
MD_T="src/convex/marketdata-secondary-legs.phase230.test.ts"
D10_T="src/lib/deployment/d10-failure-taxonomy.phase211.test.ts"

TARGETS=("$TRE" "$COT" "$EIA" "$OKX" "$MD")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p230bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p230bak" "$f"
    cmp -s "$f" "$f.p230bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p230bak"; done' EXIT

PASSED=0; FAILED=0

# $1 label, $2 mutation, $3 expectation (catch|survive), rest: test paths
mutate() {
  local label="$1"; shift
  local cmd="$1"; shift
  local expect="$1"; shift

  eval "$cmd" || { echo "SKIP     $label (could not apply)"; restore; return; }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p230bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p230_${label%% *}.log" 2>&1; then
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

echo "=== Phase 230 mutation suite ==="

# M1 — treasury: 429 falls through to the generic provider_error leg.
mutate "M1 treasury 429 not classified" \
  "perl -0pi -e 's|if \(res\.status === 429\) throw new Error|if (false \&\& res.status === 429) throw new Error|' '$TRE'" \
  catch "$TRE_T"

# M2 — treasury: an all-legs outage no longer throws (would cache/NO_DATA it).
mutate "M2 treasury outage throws not" \
  "perl -0pi -e 's|if \(!answered\)|if (false \&\& !answered)|' '$TRE'" \
  catch "$TRE_T"

# M3 — treasury: per-leg failure metadata never rides the cached payload.
mutate "M3 treasury metadata dropped" \
  "perl -0pi -e 's|\.\.\.\(legFailures \? \{ error: legFailures \} : \{\}\),|...(false ? { error: legFailures } : {}),|' '$TRE'" \
  catch "$TRE_T"

# M4 — treasury: the OUTER catch collapses RATE_LIMIT into API_UNAVAILABLE.
#      (occurrence 2 of the startsWith check; occurrence 1 is the fetcher map.)
mutate "M4 treasury outer maps RATE_LIMIT generically" \
  "perl -0pi -e '\$c=0; s|if \(msg\.startsWith\(\"RATE_LIMIT\"\)\) \{|\$c++ == 1 ? \"if (false) {\" : \$&|ge' '$TRE'" \
  catch "$TRE_T"

# M5 — cot: 429 no longer throws as a fatal class.
mutate "M5 cot 429 not classified" \
  "perl -0pi -e 's|if \(res\.status === 429\) throw new Error|if (false \&\& res.status === 429) throw new Error|' '$COT'" \
  catch "$COT_T"

# M6 — cot: the non-fatal envelope hardcodes one class instead of classifying.
mutate "M6 cot class hardcoded" \
  "perl -0pi -e 's|const cls = classifyLegError\(err\);|const cls = { status: \"network\", reason: msg };|' '$COT'" \
  catch "$COT_T"

# M7 — eia: the every-leg-failed throw is removed, so the outage payload is
#      cached again for 6h (the exact pre-phase defect).
mutate "M7 eia outage cached again" \
  "perl -0pi -e 's|if \(!anyAnswered\)|if (false \&\& !anyAnswered)|' '$EIA'" \
  catch "$EIA_T"

# M8 — eia: 401/403 no longer throw AUTH_ERROR (an invalid key caches again).
mutate "M8 eia auth not classified" \
  "perl -0pi -e 's|if \(res\.status === 401 \|\| res\.status === 403\) \{|if (false \&\& (res.status === 401 \|\| res.status === 403)) {|' '$EIA'" \
  catch "$EIA_T"

# M9 — eia: failed legs lose their class, keeping only the raw reason.
mutate "M9 eia failed-leg class stripped" \
  "perl -0pi -e 's|reason: \`\\\$\{outcome\.status\}: \\\$\{outcome\.reason\}\`|reason: \`\\\${outcome.reason}\`|' '$EIA'" \
  catch "$EIA_T"

# M10 — okx spec: 429 no longer throws as a fatal class.
mutate "M10 okx spec 429 not classified" \
  "perl -0pi -e 's|if \(res\.status === 429\) throw new Error|if (false \&\& res.status === 429) throw new Error|' '$OKX'" \
  catch "$OKX_T"

# M11 — okx book: the pinned D10 literal is rewritten (status lost).
mutate "M11 okx book literal rewritten" \
  "perl -0pi -e 's|OKX order book returned HTTP \\\$\{res\.status\}\.|OKX order book returned HTTP 200.|' '$OKX'" \
  catch "$OKX_T" "$D10_T"

# M12 — marketData: transport/fatal probe failures count as verified-invalid.
mutate "M12 dxy poison armed by transport" \
  "perl -0pi -e 's|return false; // timeout / network / 5xx / malformed|return true; // timeout / network / 5xx / malformed|' '$MD'" \
  catch "$MD_T"

# M13 — marketData: the inconclusive-wave guard is removed, so a quota wave
#       arms the 24h negative cache like a verified-invalid wave.
mutate "M13 dxy inconclusive guard removed" \
  "perl -0pi -e 's|if \(dxyProbeInconclusive !== undefined\) \{|if (false \&\& dxyProbeInconclusive !== undefined) {|' '$MD'" \
  catch "$MD_T"

# M14 — fx: an HTTP 429 status no longer throws as RATE_LIMIT.
mutate "M14 fx http 429 not classified" \
  "perl -0pi -e 's|if \(res\.status === 429\) throw new Error|if (false \&\& res.status === 429) throw new Error|' '$MD'" \
  catch "$FX_T"

# M15 — fx: a JSON `code: 429` body no longer throws as RATE_LIMIT.
mutate "M15 fx json 429 not classified" \
  "perl -0pi -e 's|if \(codeNum === 429\) throw new Error|if (false \&\& codeNum === 429) throw new Error|' '$MD'" \
  catch "$FX_T"

# M16 — fx: both legs failing is reported as "no quote available" again.
mutate "M16 fx outage reported as no-quote" \
  "perl -0pi -e 's|if \(direct\.kind === \"failed\" && inverse\.kind === \"failed\"\) \{|if (false \&\& direct.kind === \"failed\" \&\& inverse.kind === \"failed\") {|' '$MD'" \
  catch "$FX_T"

# M17 — marketData: the outer defensive fatal map is removed (source-pinned).
mutate "M17 outer defensive map removed" \
  "perl -0pi -e 's|msg\.startsWith\(\"RATE_LIMIT\"\) \|\| msg\.startsWith\(\"\[429\]\"\)|msg.startsWith(\"RATE_LIMIT\")|g' '$MD'" \
  catch "$MD_T"

# M18 — eia: the outer catch collapses AUTH_ERROR into API_UNAVAILABLE.
mutate "M18 eia outer maps AUTH_ERROR generically" \
  "perl -0pi -e 's|if \(msg\.startsWith\(\"AUTH_ERROR\"\)\) \{|if (false) {|' '$EIA'" \
  catch "$EIA_T"

echo
echo "mutants CAUGHT or correct: $PASSED; gaps: $FAILED"
[ "$FAILED" -eq 0 ]
