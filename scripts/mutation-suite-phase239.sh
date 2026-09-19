#!/usr/bin/env bash
#
# Phase 239 — mutation suite: do the runtime-stability guards actually hold?
#
# WHAT IT ANSWERS
# A green test suite proves the tests pass, not that they would FAIL if the
# behaviour regressed. Each mutant below reintroduces one specific defect — the
# ones this phase measured on the real tree — and the FOCUS suites must reject
# it. A mutant that survives is a guard gap, reported as such.
#
# MUTANTS
#   M1  main.tsx: the route boundary is removed (the pre-239 wiring)
#   M2  the route boundary bypasses its fallback and renders children
#   M3  a render error is caught but never recorded
#   M4  the unhandledrejection observer is removed
#   M5  the window error observer is removed
#   M6  the buffer evicts the FIRST failure instead of the second-oldest
#   M7  the route is dropped from every diagnostic record
#   M8  retry no longer remounts the failed subtree
#   M9  the route boundary renders nothing (the blank screen, restored)
#   M10 redaction is disabled, so credentials reach a record
#   M11 the partial-result guard is removed (keyLevels dereferenced)
#   M12 the uninterpretable-row guard is removed from the projection
#   M13 a dropped row is dropped silently
#   M14 the boundary no longer resets when the route changes
#   M15 a production fallback prints the stack again
#   M16 the consecutive-duplicate collapse is removed (one event, two records)
#   M17 defence in depth: the Phase 228 helper tolerates `null` AND the
#       projection's guard is removed — the Phase 239 suites must still catch it
#   M18 defence in depth: the Phase 228 assertion is weakened AND the enums are
#       mapped without the conservative fallback — same requirement
#
# METHOD
# Mutations are python3 heredocs; each asserts the exact anchor it replaces
# occurs exactly once, so a mutant that matches nothing is reported INVALID
# rather than counted as caught.
#
# SAFETY
# Restore is byte-exact via `cmp` against a `.p239bak` snapshot, under `trap`.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGETS=(
  "src/main.tsx"
  "src/components/route-error-boundary.tsx"
  "src/components/root-error-boundary.tsx"
  "src/components/error-fallbacks.tsx"
  "src/lib/runtime/diagnostics.ts"
  "src/lib/analysis/from-db-record.ts"
  "src/lib/analysis/from-db-record.phase228.test.ts"
  "src/pages/Dashboard.tsx"
  "src/components/AnalysisResult.tsx"
  "src/lib/runtime/app-runtime.phase239.test.tsx"
)

for f in "${TARGETS[@]}"; do cp "$f" "$f.p239bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p239bak" "$f"
    cmp -s "$f" "$f.p239bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p239bak"; done' EXIT

# The runtime-stability suites, plus the pre-existing projection contract they
# extend.
FOCUS=(
  "src/lib/runtime/diagnostics.phase239.test.tsx"
  "src/lib/runtime/error-boundary.phase239.test.tsx"
  "src/lib/runtime/app-runtime.phase239.test.tsx"
  "src/lib/analysis/from-db-record.phase239.test.ts"
  "src/lib/analysis/from-db-record.phase228.test.ts"
)

PASSED=0; EQUIV=0; GAPS=0; N=0

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)

  N=$((N+1))
  printf '%s' "$program" > "/tmp/p239_${N}.py"

  if ! python3 "/tmp/p239_${N}.py"; then
    echo "INVALID  $label (mutation failed to apply — proves nothing)"
    GAPS=$((GAPS+1)); restore; return
  fi

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p239bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    GAPS=$((GAPS+1)); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p239_${N}.log" 2>&1; then
    if [ "$expect" = "survive" ]; then
      echo "EQUIVALENT  $label (documented: the other half of the drop makes it inert)"
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

def cut(path, old, count=1):
    swap(path, old, "", count)
PY

echo "=== Phase 239 mutation suite ==="

# A verdict only means something against a GREEN baseline: with a failing guard
# test every mutant would read as "caught", which is the false confidence this
# phase exists to remove.
echo "--- baseline: the runtime-stability tests must pass first ---"
if ! npx vitest run "${FOCUS[@]}" >/tmp/p239_baseline.log 2>&1; then
  echo "FATAL: the runtime-stability tests fail at baseline."
  echo "       Every CAUGHT verdict below would be a false positive. Not running mutants."
  exit 2
fi
echo "--- baseline green; mutation verdicts are meaningful ---"

# ── route isolation ───────────────────────────────────────────────────────
mutate "M1 the route boundary is removed from the application" catch <<PY
$PROLOGUE
cut("src/main.tsx", "          <RouteErrorBoundaryScope>\n")
cut("src/main.tsx", "          </RouteErrorBoundaryScope>\n")
PY

mutate "M2 the route boundary bypasses its fallback" catch <<PY
$PROLOGUE
swap("src/components/route-error-boundary.tsx",
     "    if (this.state.error !== null) {",
     "    if (false) {")
PY

mutate "M9 the route boundary renders NOTHING instead of a fallback" catch <<PY
$PROLOGUE
swap("src/components/route-error-boundary.tsx",
     "    if (this.state.error !== null) {\n      return (\n        <RouteFailureFallback\n          error={this.state.error}\n          onRetry={this.retry}\n          diagnosticsEnabled={diagnosticsEnabledByDefault()}\n        />\n      );\n    }",
     "    if (this.state.error !== null) {\n      return null as never;\n    }")
PY

mutate "M14 the boundary no longer resets when the route changes" catch <<PY
$PROLOGUE
swap("src/components/route-error-boundary.tsx",
     "    if (prev.resetKeys.some((key, i) => !Object.is(key, this.props.resetKeys[i]))) {",
     "    if (false) {")
PY

mutate "M8 retry no longer remounts the failed subtree" catch <<PY
$PROLOGUE
swap("src/components/route-error-boundary.tsx",
     "  private retry = () => {\n    this.setState({ error: null });\n  };",
     "  private retry = () => {\n    /* remount disabled */\n  };")
PY

# ── the failure is recorded ───────────────────────────────────────────────
mutate "M3 a render error is caught but never recorded" catch <<PY
$PROLOGUE
swap("src/components/route-error-boundary.tsx",
     "  componentDidCatch(error: unknown) {\n    recordRenderFailure(error, this.props.route);\n  }",
     "  componentDidCatch() {\n    /* recording disabled */\n  }")
PY

mutate "M4 the unhandledrejection observer is removed" catch <<PY
$PROLOGUE
cut("src/lib/runtime/diagnostics.ts", '  window.addEventListener("unhandledrejection", onRejection);\n')
PY

mutate "M5 the window error observer is removed" catch <<PY
$PROLOGUE
cut("src/lib/runtime/diagnostics.ts", '  window.addEventListener("error", onError);\n')
PY

mutate "M6 the buffer evicts the FIRST failure" catch <<PY
$PROLOGUE
swap("src/lib/runtime/diagnostics.ts",
     "    state.failures.splice(1, state.failures.length - MAX_FAILURES);",
     "    state.failures.shift();")
PY

mutate "M7 the route is dropped from every record" catch <<PY
$PROLOGUE
swap("src/lib/runtime/diagnostics.ts",
     '  return loc.pathname || "/";',
     '  return "";')
PY

mutate "M16 the duplicate collapse is removed (one event, two records)" catch <<PY
$PROLOGUE
swap("src/lib/runtime/diagnostics.ts",
     "    previous.route === failure.route\n  ) {\n    return previous;\n  }",
     "    previous.route === failure.route\n  ) {\n    /* collapse disabled */\n  }")
PY

# ── no secrets, and the details the developer needs ───────────────────────
mutate "M10 redaction is disabled" catch <<PY
$PROLOGUE
swap("src/lib/runtime/diagnostics.ts",
     "  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);",
     "  void REDACTIONS;")
PY

mutate "M15 the ROUTE fallback prints the stack in production" catch <<PY
$PROLOGUE
swap("src/components/error-fallbacks.tsx",
     "          {diagnosticsEnabled && stack && (\n            <pre className=\"mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 p-2 font-mono text-[10px] leading-4\">\n              {stack}\n            </pre>\n          )}\n        </details>\n      </div>\n    </main>\n  );\n}\n\n/**\n * Root fallback: the application itself could not continue.",
     "          <pre className=\"mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 p-2 font-mono text-[10px] leading-4\">\n            {stack}\n          </pre>\n        </details>\n      </div>\n    </main>\n  );\n}\n\n/**\n * Root fallback: the application itself could not continue.")
PY

# ── the data path that caused the report ──────────────────────────────────
mutate "M12 the uninterpretable-row guard is removed" catch <<PY
$PROLOGUE
cut("src/lib/analysis/from-db-record.ts",
    "  if (uninterpretableRowReason(record) !== null) return null;\n")
PY

mutate "M13 a dropped row is dropped silently" catch <<PY
$PROLOGUE
import re
s = open("src/pages/Dashboard.tsx").read()
# Matched by regex: the anchor itself contains a template literal, and the
# shell expands dollar signs inside this heredoc.
new, n = re.subn(r"[ \t]*recordDataIntegrityIssue\([^\n]*\n", "", s)
if n != 1:
    sys.exit(f"expected exactly 1 recordDataIntegrityIssue call, found {n}")
open("src/pages/Dashboard.tsx", "w").write(new)
PY

mutate "M11 the partial-result guard is removed" catch <<PY
$PROLOGUE
swap("src/components/AnalysisResult.tsx", "result.keyLevels?.support", "result.keyLevels.support")
swap("src/components/AnalysisResult.tsx", "result.keyLevels?.resistance", "result.keyLevels.resistance")
swap("src/components/AnalysisResult.tsx", "result.keyLevels?.invalidation", "result.keyLevels.invalidation")
PY

# ── defence in depth: the new suites alone must carry the property ─────────
mutate "M17 the projection forwards an uninterpretable row to the renderer" catch <<PY
$PROLOGUE
import re
s = open("src/pages/Dashboard.tsx").read()
# Both halves of the drop: the reason check that skips the row, and the filter
# that refuses a null. With only one of them removed nothing changes, which is
# why the equivalence below is documented rather than chased.
new, n = re.subn(
    r"[ \t]*const reason = uninterpretableRowReason\(row\);[\s\S]*?[ \t]*continue;\n[ \t]*\}\n",
    "",
    s,
)
if n != 1:
    sys.exit(f"drop guard block not found (found {n})")
open("src/pages/Dashboard.tsx", "w").write(new)
swap("src/pages/Dashboard.tsx",
     "      if (result) projected.push(result);",
     "      projected.push(result as AnalysisResult);")
PY

mutate "M18 Phase 228 weakened AND the conservative enum mapping removed" catch <<PY
$PROLOGUE
swap("src/lib/analysis/from-db-record.phase228.test.ts",
     "    expect(r.recommendation).toBe(\"LONG\");\n    expect(r.conviction).toBe(\"High\");",
     "    expect(r.recommendation).toBeTruthy();\n    expect(r.conviction).toBeTruthy();")
swap("src/lib/analysis/from-db-record.ts",
     "  const bias = oneOf(BIASES, record.bias) ?? \"Neutral\";",
     "  const bias = record.bias as DirectionalBias;")
PY

mutate "M19 the null filter alone is removed (documented equivalence)" survive <<PY
$PROLOGUE
swap("src/pages/Dashboard.tsx",
     "      if (result) projected.push(result);",
     "      projected.push(result as AnalysisResult);")
PY

mutate "M20 missing key levels are FABRICATED instead of refused" catch <<PY
$PROLOGUE
swap("src/lib/analysis/from-db-record.ts",
     "  if (!hasKeyLevels(r.keyLevels)) return \"row has no usable key levels\";",
     "  if (!hasKeyLevels(r.keyLevels)) r.keyLevels = { support: \"0\", resistance: \"0\", invalidation: \"0\" };")
PY

mutate "M21 the fallback stops announcing itself to assistive technology" catch <<PY
$PROLOGUE
swap("src/components/error-fallbacks.tsx",
     'role="alert" aria-live="assertive"',
     'role="none" aria-live="off"',
     2)
PY

mutate "M22 the entry point never installs the observers" catch <<PY
$PROLOGUE
swap("src/main.tsx",
     "const uninstallDiagnostics = installRuntimeDiagnostics();",
     "const uninstallDiagnostics = () => {};")
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
[ "$GAPS" -eq 0 ]
