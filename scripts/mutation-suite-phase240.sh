#!/usr/bin/env bash
#
# Phase 240 — mutation suite: does the timestamp-pair guard actually hold?
#
# WHAT IT ANSWERS
# A green suite proves the tests pass, not that they would FAIL if the pair
# regressed. Each mutant below reintroduces one specific defect — most of them
# shapes that existed in this file before Phase 240 — and the focused suites must
# reject it. A mutant that survives is reported as a guard gap.
#
# MUTANTS
#   M1  a second clock read for `receivedAt` inside the envelope builder
#   M2  `latencyMs` measured from a LATER read than the receipt
#   M3  `receivedAt` taken from an EARLIER read (the request start)
#   M4  one success branch stops reusing the captured completion (native candles)
#   M5  the duration is computed backwards (start - completion)
#   M6  one success branch (quote) stops reusing the captured completion
#   M7  one ERROR branch (native network failure) loses the measured completion
#   M8  a different clock source for the paired field (`Number(new Date())`)
#   M9  the duration arithmetic is off by one
#   M10 defence in depth: the pair assertions are neutered AND the second read is
#       reintroduced — the sweep and semantics suites must still catch it
#   M11 an extra clock consultation that does NOT change the recorded pair
#       (the Phase 238 lesson: the read count is itself the observable)
#   M12 the diagnostic reports a different duration from the envelope
#   M13 provider health re-measures the duration instead of reusing it
#   M14 a pre-flight branch borrows the caller's `now` as its receipt
#   M15 defence in depth: the sweep's sanctioned-read check is neutered AND the
#       second read is reintroduced
#
# METHOD
# Mutations are python3 heredocs; each asserts the exact anchor it replaces
# occurs exactly once, so a mutant that matches nothing is reported INVALID
# rather than counted as caught.
#
# SAFETY
# Restore is byte-exact via `cmp` against a `.p240bak` snapshot, under `trap`.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGETS=(
  "src/lib/data/universal/live/client.ts"
  "src/lib/data/universal/live/client-timestamp-pair.phase240.test.ts"
  "src/lib/data/universal/live/client-timestamp-sweep.phase240.test.ts"
  "src/lib/data/universal/live/client-timestamp-semantics.phase240.test.ts"
)

for f in "${TARGETS[@]}"; do cp "$f" "$f.p240bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p240bak" "$f"
    cmp -s "$f" "$f.p240bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p240bak"; done' EXIT

FOCUS=(
  "src/lib/data/universal/live/client-timestamp-pair.phase240.test.ts"
  "src/lib/data/universal/live/client-timestamp-sweep.phase240.test.ts"
  "src/lib/data/universal/live/client-timestamp-semantics.phase240.test.ts"
)

PASSED=0; EQUIV=0; GAPS=0; N=0

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)

  N=$((N+1))
  printf '%s' "$program" > "/tmp/p240_${N}.py"

  if ! python3 "/tmp/p240_${N}.py"; then
    echo "INVALID  $label (mutation failed to apply — proves nothing)"
    GAPS=$((GAPS+1)); restore; return
  fi

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p240bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    GAPS=$((GAPS+1)); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p240_${N}.log" 2>&1; then
    if [ "$expect" = "survive" ]; then
      echo "EQUIVALENT  $label (documented as inert)"
      EQUIV=$((EQUIV+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP"
      GAPS=$((GAPS+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- guard now flags a behaviourally inert change"
      GAPS=$((GAPS+1))
    else
      echo "CAUGHT   $label"
      PASSED=$((PASSED+1))
    fi
  fi
  restore
}

read -r -d '' PROLOGUE <<'PY'
import sys

def swap(path, old, new, count=1):
    s = open(path).read()
    if s.count(old) != count:
        sys.exit(f"anchor not found exactly {count}x in {path} (found {s.count(old)})")
    open(path, "w").write(s.replace(old, new))
PY

CLIENT="src/lib/data/universal/live/client.ts"
PAIR="src/lib/data/universal/live/client-timestamp-pair.phase240.test.ts"
SWEEP="src/lib/data/universal/live/client-timestamp-sweep.phase240.test.ts"

# The single-reading constructor, quoted once because four mutants rewrite it.
CONSTRUCTOR_OLD='  const receivedAt = Date.now();\n  return { receivedAt, latencyMs: receivedAt - startedAt };'
RECEIPT_FROM_COMPLETION='    const { receivedAt, latencyMs } = completion;'

echo "=== Phase 240 mutation suite ==="

# A verdict only means something against a GREEN baseline: with a failing guard
# test every mutant would read as "caught", which is the false confidence this
# phase exists to remove.
echo "--- baseline: the timestamp-pair suites must pass first ---"
if ! npx vitest run "${FOCUS[@]}" >/tmp/p240_baseline.log 2>&1; then
  echo "FATAL: the pair suites fail at baseline."
  echo "       Every CAUGHT verdict below would be a false positive. Not running mutants."
  exit 2
fi
echo "--- baseline green; mutation verdicts are meaningful ---"

# ── the pair itself ───────────────────────────────────────────────────────
mutate "M1 a second read supplies receivedAt in the builder" catch <<PY
$PROLOGUE
swap("$CLIENT", "$RECEIPT_FROM_COMPLETION",
     "    const receivedAt = Date.now();\n    const latencyMs = completion.latencyMs;")
PY

mutate "M2 latencyMs measured from a later read" catch <<PY
$PROLOGUE
swap("$CLIENT", "$CONSTRUCTOR_OLD",
     "  const receivedAt = Date.now();\n  return { receivedAt, latencyMs: Date.now() - startedAt };")
PY

mutate "M3 receivedAt taken from the EARLIER start read" catch <<PY
$PROLOGUE
swap("$CLIENT", "$CONSTRUCTOR_OLD",
     "  const receivedAt = Date.now();\n  return { receivedAt: startedAt, latencyMs: 0 };")
PY

mutate "M5 the duration is computed backwards" catch <<PY
$PROLOGUE
swap("$CLIENT", "$CONSTRUCTOR_OLD",
     "  const receivedAt = Date.now();\n  return { receivedAt, latencyMs: startedAt - receivedAt };")
PY

mutate "M8 a different clock source for the paired field" catch <<PY
$PROLOGUE
swap("$CLIENT", "$CONSTRUCTOR_OLD",
     "  const receivedAt = Number(new Date());\n  return { receivedAt, latencyMs: receivedAt - startedAt };")
PY

mutate "M9 the duration arithmetic is off by one" catch <<PY
$PROLOGUE
swap("$CLIENT", "  return { receivedAt, latencyMs: receivedAt - startedAt };",
     "  return { receivedAt, latencyMs: receivedAt - startedAt + 1 };")
PY

# ── branches must reuse the captured completion ───────────────────────────
mutate "M4 a SUCCESS branch stops reusing the completion (native candles)" catch <<PY
$PROLOGUE
swap("$CLIENT",
     '        return finish("LIVE_VERIFIED", completion, {\n          provider: providerId,\n          symbolUsed: providerSymbol,\n          candles: accepted,',
     '        return finish("LIVE_VERIFIED", completionWithoutRequest(), {\n          provider: providerId,\n          symbolUsed: providerSymbol,\n          candles: accepted,')
PY

mutate "M6 a SUCCESS branch stops reusing the completion (quote)" catch <<PY
$PROLOGUE
swap("$CLIENT",
     '    return finish("LIVE_VERIFIED", completion, {\n      provider: providerId,\n      symbolUsed: providerSymbol,\n      quote: extracted.quote,',
     '    return finish("LIVE_VERIFIED", completionWithoutRequest(), {\n      provider: providerId,\n      symbolUsed: providerSymbol,\n      quote: extracted.quote,')
PY

mutate "M7 an ERROR branch loses the measured completion (network failure)" catch <<PY
$PROLOGUE
swap("$CLIENT",
     '      const completion = completionAt(t0);\n      return finish("NETWORK_UNAVAILABLE", completion, {',
     '      const completion = completionWithoutRequest();\n      return finish("NETWORK_UNAVAILABLE", completion, {')
PY

# ── no second measurement beside the pair ─────────────────────────────────
mutate "M11 an extra clock consultation that changes no value" catch <<PY
$PROLOGUE
swap("$CLIENT", "$CONSTRUCTOR_OLD",
     "  void Date.now();\n  const receivedAt = Date.now();\n  return { receivedAt, latencyMs: receivedAt - startedAt };")
PY

mutate "M12 the diagnostic reports a different duration" catch <<PY
$PROLOGUE
swap("$CLIENT", "        latencyMs,\n        cacheHit: false,",
     "        latencyMs: latencyMs === null ? null : latencyMs + 1,\n        cacheHit: false,")
PY

mutate "M13 provider health re-measures instead of reusing" catch <<PY
$PROLOGUE
swap("$CLIENT",
     '      recordProviderHealth({ providerId, status: "AVAILABLE", responseTimeMs: completion.latencyMs });',
     '      recordProviderHealth({ providerId, status: "AVAILABLE", responseTimeMs: Date.now() - t0 });')
PY

mutate "M14 a pre-flight branch borrows the caller's now" catch <<PY
$PROLOGUE
swap("$CLIENT",
     '      return finish("UNSUPPORTED", completionWithoutRequest(), {\n        failureReason:\n          route.unavailableReason ??',
     '      return finish("UNSUPPORTED", { receivedAt: requestedAt, latencyMs: null }, {\n        failureReason:\n          route.unavailableReason ??')
PY

# ── defence in depth: neuter one guard, reintroduce one defect ────────────
mutate "M10 pair assertions neutered AND the second read reintroduced" catch <<PY
$PROLOGUE
swap("$PAIR",
     "  if (result.latencyMs === null) return;\n  expect(result.latencyMs).toBe(receivedAt - start);",
     "  if (result.latencyMs === null) return;\n  void start;\n  return;")
swap("$CLIENT", "$RECEIPT_FROM_COMPLETION",
     "    const receivedAt = Date.now();\n    const latencyMs = completion.latencyMs;")
PY

mutate "M15 sweep check neutered AND the second read reintroduced" catch <<PY
$PROLOGUE
swap("$SWEEP", "for (const reading of readings) {", "for (const reading of [] as const) {")
swap("$CLIENT", "$RECEIPT_FROM_COMPLETION",
     "    const receivedAt = Date.now();\n    const latencyMs = completion.latencyMs;")
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
[ "$GAPS" -eq 0 ]
