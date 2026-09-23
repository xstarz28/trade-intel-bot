#!/usr/bin/env bash
# Phase 238 — mutation suite for the one-event-one-instant clock discipline.
#
# The premise: the fix is a SINGLE clock read where there used to be two. Every
# mutant below puts a second read back (or moves a recorded instant onto a
# read-time clock), in a way that still looks reasonable — a default that
# becomes "now", a derived block dated at derivation time, a field rebuilt on a
# cache hit, a fallback that reads the clock instead of reusing the instant it
# already has.
#
#   M1  Alpha Vantage: the fundamentals producer reads the clock twice again
#   M2  Alpha Vantage: `normalizeFundamentalsFromAV` stamps its own "now"
#   M3  Alpha Vantage: an EMPTY sentiment block is dated at derivation time
#   M4  Alpha Vantage: a populated sentiment block is dated at derivation time
#   M5  Alpha Vantage: the macro block is dated at derivation time
#   M6  Alpha Vantage: an unavailable fundamentals block claims "now"
#   M7  EIA: `fetchedAt` is rebuilt from the read clock
#   M8  EIA: the exact pre-Phase-238 double read returns
#   M9  COT: `fetchedAt` is rebuilt from the read clock
#   M10 Treasury: `fetchedAt` is rebuilt from the read clock
#   M11 OKX order book: the freshness verdict gets its own read
#   M12 market-radar OKX candles: the record grades itself at a second read
#   M13 market-radar OKX candles: the `observedAt` fallback reads the clock again
#   M12b provider-native acquisition: the snapshot is graded at a second read
#        (the same class as M12, on the path that builds a MarketData feed)
#   M19 the six adapters with no provider observation time re-read the clock
#       for `observedAt` instead of carrying the read they were acquired at
#   M20 twelve-data grades its freshness at a SECOND read
#   M21 acquireLiveData dates its result with its own read instead of the
#       snapshot's (the coupling Phase 238 added)
#   M22 the no-provider result dates itself and measures latency at two reads
#   M23 the health wrapper re-reads for `lastSuccessAt`
#   M24 the provider-native FAILURE-path latency re-reads (no transport report)
#   M24b the success-path twin of M24, which is UNOBSERVABLE because every
#        LIVE_* record the transport returns already carries a latency
#   M25 the provider-native path reads the clock after the transport returned
#   M17 two clock reads on ONE line (the structural complement's teeth)
#   M18 an application module imports the test-only counting clock
#   M14 the counting clock is neutered (all reads return the same value)
#   M15 the legacy Phase 229 assertion is DELETED and the defect reintroduced —
#       the Phase 238 suite must still catch it (defence in depth)
#   M16 the Phase 178c `fetchedAt`-across-hits assertion is WEAKENED and the EIA
#       defect reintroduced — the Phase 238 suite must still catch it
#
# METHOD
# Mutations are python3 heredocs; each asserts the exact anchor it replaces
# occurs exactly once, so a mutant that matches nothing is reported INVALID
# rather than counted as caught. Two mutants (M15, M16) deliberately weaken a
# guard AND reintroduce the defect: they exist to prove the new suite carries
# the property on its own, not merely alongside the older assertions.
#
# SAFETY
# Restore is byte-exact via `cmp` against a `.p238bak` snapshot, under `trap`.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGETS=(
  "src/convex/alphaVantage.ts"
  "src/convex/eia.ts"
  "src/convex/cot.ts"
  "src/convex/treasury.ts"
  "src/convex/okx.ts"
  "src/lib/market-radar/provider-registry.ts"
  "src/test-counting-clock.ts"
  "src/convex/one-instant.phase238.test.ts"
  "src/convex/alphavantage-legs.phase229.test.ts"
  "src/convex/remaining-providers.phase178c.test.ts"
)
for f in "${TARGETS[@]}"; do cp "$f" "$f.p238bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p238bak" "$f"
    cmp -s "$f" "$f.p238bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p238bak"; done' EXIT

# The clock discipline's own tests, plus the two suites that assert the same
# properties from the providers' side.
FOCUS=(
  "src/convex/one-instant.phase238.test.ts"
  "src/lib/market-radar/one-instant.phase238.test.ts"
  "src/convex/alphavantage-legs.phase229.test.ts"
  "src/convex/remaining-providers.phase178c.test.ts"
)

PASSED=0; FAILED=0; N=0

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)

  N=$((N+1))
  printf '%s' "$program" > "/tmp/p238_${N}.py"

  if ! python3 "/tmp/p238_${N}.py"; then
    echo "INVALID  $label (mutation failed to apply — proves nothing)"
    FAILED=$((FAILED+1)); restore; return
  fi

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p238bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p238_${N}.log" 2>&1; then
    if [ "$expect" = "survive" ]; then
      echo "CORRECT  $label (equivalent mutant — correctly not flagged)"
      PASSED=$((PASSED+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP"
      FAILED=$((FAILED+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- guard now flags a behaviourally inert change"
      FAILED=$((FAILED+1))
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

def cut(path, old, count=1):
    swap(path, old, "", count)
PY

echo "=== Phase 238 mutation suite ==="

# A verdict only means something against a GREEN baseline: with a failing guard
# test every mutant would read as "caught", which is the false confidence this
# phase exists to remove.
echo "--- baseline: the clock-discipline tests must pass first ---"
if ! npx vitest run "${FOCUS[@]}" >/tmp/p238_baseline.log 2>&1; then
  echo "FATAL: the clock-discipline tests fail at baseline."
  echo "       Every CAUGHT verdict below would be a false positive. Not running mutants."
  grep -E 'FAIL|AssertionError|Tests ' /tmp/p238_baseline.log | head -20
  exit 2
fi
grep -E '^ (Test Files|Tests )' /tmp/p238_baseline.log | sed 's/^/    /'
echo "--- baseline green; mutation verdicts are meaningful ---"

# ── Alpha Vantage: one acquisition, one instant ────────────────────────────
mutate "M1 AV fundamentals producer reads twice" catch <<PY
$PROLOGUE
swap("src/convex/alphaVantage.ts",
     "                  observedAt,\n                };",
     "                  observedAt: Date.now(),\n                };")
PY

mutate "M2 AV fundamentals block stamped with its own now" catch <<PY
$PROLOGUE
swap("src/convex/alphaVantage.ts",
     '    provider: "alpha-vantage",\n    timestamp: observedAt,\n    instrumentType: instrumentType as FundamentalData["instrumentType"],',
     '    provider: "alpha-vantage",\n    timestamp: Date.now(),\n    instrumentType: instrumentType as FundamentalData["instrumentType"],')
PY

mutate "M3 AV empty sentiment block dated at derivation time" catch <<PY
$PROLOGUE
swap("src/convex/alphaVantage.ts",
     "      provider,\n      timestamp: observedAt,\n      averageScore: 0,",
     "      provider,\n      timestamp: Date.now(),\n      averageScore: 0,")
PY

mutate "M4 AV populated sentiment block dated at derivation time" catch <<PY
$PROLOGUE
swap("src/convex/alphaVantage.ts",
     "    provider,\n    timestamp: observedAt,\n    averageScore: Math.round(avgScore * 1000) / 1000,",
     "    provider,\n    timestamp: Date.now(),\n    averageScore: Math.round(avgScore * 1000) / 1000,")
PY

mutate "M5 AV macro block dated at derivation time" catch <<PY
$PROLOGUE
swap("src/convex/alphaVantage.ts",
     '    provider: "alpha-vantage",\n    timestamp: observedAt,\n    dxyTrend,',
     '    provider: "alpha-vantage",\n    timestamp: Date.now(),\n    dxyTrend,')
PY

mutate "M6 AV unavailable block claims now" catch <<PY
$PROLOGUE
swap("src/convex/alphaVantage.ts",
     "          timestamp: 0,",
     "          timestamp: Date.now(),")
PY

# ── the cached context providers ──────────────────────────────────────────
mutate "M7 EIA fetchedAt rebuilt from the read clock" catch <<PY
$PROLOGUE
swap("src/convex/eia.ts",
     "      const ctx = buildEiaContext(evidence.data, evidence.observedAt, nowMs);",
     "      const ctx = buildEiaContext(evidence.data, nowMs, nowMs);")
PY

mutate "M8 EIA double read returns" catch <<PY
$PROLOGUE
swap("src/convex/eia.ts",
     "      const nowMs = Date.now();\n      const ctx = buildEiaContext(evidence.data, evidence.observedAt, nowMs);",
     "      const ctx = buildEiaContext(evidence.data, Date.now(), Date.now());")
PY

mutate "M9 COT fetchedAt rebuilt from the read clock" catch <<PY
$PROLOGUE
swap("src/convex/cot.ts",
     "      const ctx = buildCotContext(evidence.data, args.instrument, evidence.observedAt, Date.now());",
     "      const ctx = buildCotContext(evidence.data, args.instrument, Date.now(), Date.now());")
PY

mutate "M10 Treasury fetchedAt rebuilt from the read clock" catch <<PY
$PROLOGUE
swap("src/convex/treasury.ts",
     "      const ctx = buildTreasuryContext(\n        [nomThis, nomPrev],\n        [realThis, realPrev],\n        evidence.observedAt,\n        Date.now(),\n      );",
     "      const ctx = buildTreasuryContext(\n        [nomThis, nomPrev],\n        [realThis, realPrev],\n        Date.now(),\n        Date.now(),\n      );")
PY

mutate "M11 OKX order book grades at a second read" catch <<PY
$PROLOGUE
swap("src/convex/okx.ts",
     "      const fetchedAt = Date.now();\n      const data = buildExecutionData(parsed, fetchedAt, fetchedAt);",
     "      const fetchedAt = Date.now();\n      const data = buildExecutionData(parsed, fetchedAt, Date.now());")
PY

# ── market-radar adapters ─────────────────────────────────────────────────
mutate "M12 OKX candles grade at a second read" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "          freshness: assessFreshness(observedAt, acquiredAt),",
     "          freshness: assessFreshness(observedAt, Date.now()),")
PY

mutate "M13 OKX candles observedAt fallback reads again" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "        const observedAt = Number.isFinite(ts) ? ts : acquiredAt;",
     "        const observedAt = Number.isFinite(ts) ? ts : Date.now();")
PY

# ── the guard's own teeth ─────────────────────────────────────────────────
mutate "M12b provider-native snapshot graded at a second read" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "  const fetchedAt = result.receivedAt ?? Date.now();\n  const freshness = assessFreshness(observedAt, fetchedAt);",
     "  const fetchedAt = result.receivedAt ?? Date.now();\n  const freshness = assessFreshness(observedAt, Date.now());")
PY

mutate "M17 a single statement reads the clock twice" catch <<PY
$PROLOGUE
swap("src/convex/eia.ts",
     "      const nowMs = Date.now();\n      const ctx = buildEiaContext(evidence.data, evidence.observedAt, nowMs);",
     "      const nowMs = Date.now(), _dup = Date.now();\n      const ctx = buildEiaContext(evidence.data, evidence.observedAt, nowMs);")
PY

mutate "M18 an application module imports the test-only counting clock" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     'import type { AssetClass } from "@/lib/data/universal/types";',
     'import type { AssetClass } from "@/lib/data/universal/types";\nimport "../../test-counting-clock";')
PY

mutate "M14 counting clock neutered (every read identical)" catch <<PY
$PROLOGUE
swap("src/test-counting-clock.ts",
     "      const value = base + reads.length + 1;",
     "      const value = base;")
PY

# ── the sweep: every adapter, one instant per record ──────────────────────
mutate "M19 adapters with no provider time re-read for observedAt" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "observedAt: acquiredAt,",
     "observedAt: Date.now(),",
     6)
PY

mutate "M20 twelve-data grades freshness at a second read" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "freshness: assessFreshness(new Date(latest.datetime).getTime(), acquiredAt),",
     "freshness: assessFreshness(new Date(latest.datetime).getTime(), Date.now()),")
PY

mutate "M21 acquireLiveData dates its result with its own read" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "        fetchedAt: snapshot.acquiredAt ?? completedAt,",
     "        fetchedAt: completedAt,")
PY

mutate "M22 the no-provider result re-reads for its latency" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "      provider: \"none\",\n      success: false,\n      error: \"no available provider for this instrument\",\n      latencyMs: completedAt - startTime,",
     "      provider: \"none\",\n      success: false,\n      error: \"no available provider for this instrument\",\n      latencyMs: Date.now() - startTime,")
PY

mutate "M23 the health wrapper re-reads for lastSuccessAt" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "health.lastSuccessAt = completedAt;",
     "health.lastSuccessAt = Date.now();")
PY

mutate "M24 the native FAILURE-path latency re-reads" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "      latencyMs: result.latencyMs ?? completedAt - startTime,",
     "      latencyMs: result.latencyMs ?? Date.now() - startTime,")
PY

# M24b is deliberately left UNOBSERVABLE rather than unguarded: every LIVE_*
# record `executeLiveRequest` returns carries a latency, so the success-path
# fallback cannot be reached from the public API. Declaring it lets the suite
# state that fact instead of implying coverage it does not have.
mutate "M24b the native success-path latency fallback re-reads (unobservable)" survive <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "    latencyMs: result.latencyMs ?? fetchedAt - startTime,",
     "    latencyMs: result.latencyMs ?? Date.now() - startTime,")
PY

mutate "M25 the native path reads the clock after the transport returned" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/provider-registry.ts",
     "  const candles = result.candles ?? [];\n  const latest = candles[candles.length - 1];",
     "  const completedAt = Date.now();\n  const candles = result.candles ?? [];\n  const latest = candles[candles.length - 1];")
PY

# ── defence in depth: the new suite alone must carry the property ──────────
mutate "M15 legacy phase-229 assertion deleted AND the defect reintroduced" catch <<PY
$PROLOGUE
swap("src/convex/alphaVantage.ts",
     "                  observedAt,\n                };",
     "                  observedAt: Date.now(),\n                };")
cut("src/convex/alphavantage-legs.phase229.test.ts",
    "    expect(r.observedAt).toBe(r.fundamentals!.timestamp);\n")
PY

mutate "M16 phase-178c fetchedAt assertion weakened AND the EIA defect reintroduced" catch <<PY
$PROLOGUE
swap("src/convex/eia.ts",
     "      const nowMs = Date.now();\n      const ctx = buildEiaContext(evidence.data, evidence.observedAt, nowMs);",
     "      const nowMs = Date.now();\n      const ctx = buildEiaContext(evidence.data, nowMs, nowMs);")
swap("src/convex/remaining-providers.phase178c.test.ts",
     "    // rather than the property, and it broke the moment the defect was fixed.\n    expect(second.data?.fetchedAt).toBe(first.data?.fetchedAt);\n    expect(second.acquisition).toBe(\"cache-reused\");",
     "    // rather than the property, and it broke the moment the defect was fixed.\n    expect(second.data?.fetchedAt).toBeGreaterThan(0);\n    expect(second.acquisition).toBe(\"cache-reused\");")
PY

echo
echo "mutants CAUGHT: $PASSED; gaps: $FAILED"
[ "$FAILED" -eq 0 ]
