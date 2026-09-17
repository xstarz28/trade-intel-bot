#!/usr/bin/env bash
# Phase 237 — mutation suite for the hermetic-test boundary.
#
# The premise: the value of this phase is entirely in what it REFUSES. Every
# mutant below is a way that refusal can be deleted by an edit that still looks
# reasonable — a guard that no longer guards, a default that quietly becomes
# opt-in, a live suite that switches itself on, or an assertion weakened into
# something that can no longer fail.
#
#   M1  guard removed from the unit project's setupFiles
#   M2  guard removed from the ui project's setupFiles
#   M3  loopback predicate says everything is loopback (nothing is blocked)
#   M4  external hosts allowed through a hardcoded allowlist
#   M5  hermetic mode becomes opt-in instead of the default
#   M6  fetch is no longer intercepted
#   M7  raw sockets (net/tls) are no longer intercepted
#   M8  dns.lookup is no longer intercepted
#   M9  dns.promises.lookup is no longer intercepted
#   M10 a refused call returns a fake 200 instead of failing (silent PASS)
#   M11 loopback boundary weakened to a substring match
#   M12 the `.live` exclusion disappears from the default config
#   M13 the phase75 exclusion disappears (the original CI failure)
#   M14 the live config stops including the live files
#   M15 the live config stops requiring the opt-in global setup
#   M16 the live global setup stops refusing without an opt-in
#   M17 the opt-in accepts any non-empty value
#   M18 `npm test` is pointed at the live config
#   M19 a CI workflow enables live verification
#   M20 the external-call scanner is neutered (returns no offenders)
#   M21 application code imports the guard (enforcement leaks into runtime)
#   M22 the setup file stops installing the guard
#
# METHOD
# Mutations are python3 heredocs, not perl: each one asserts the exact anchor it
# replaces occurs exactly once, so a mutant that silently matches nothing is
# reported INVALID rather than counted as caught. (Phase 236's escaping notes
# still apply to perl mutants if any are ever added here: `\Q…\E` protects
# neither the delimiter nor `$`/`@` interpolation.)
#
# SAFETY
# Restore is byte-exact via `cmp` against a `.p237bak` snapshot, under `trap`.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGETS=(
  "vitest.config.ts"
  "vitest.live.config.ts"
  "src/test-network-guard.ts"
  "src/test-setup-network-guard.ts"
  "src/vitest-live-global-setup.ts"
  "src/lib/hosting/suite-hermeticity.phase181.test.ts"
  "src/lib/market-radar/verification.ts"
  "package.json"
  ".github/workflows/ci.yml"
)
for f in "${TARGETS[@]}"; do cp "$f" "$f.p237bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p237bak" "$f"
    cmp -s "$f" "$f.p237bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p237bak"; done' EXIT

# The boundary's own tests: the structural detector and both runtime probes.
FOCUS=(
  "src/lib/hosting/suite-hermeticity.phase181.test.ts"
  "src/lib/hosting/hermetic-network-guard.phase237.test.ts"
  "src/lib/hosting/hermetic-guard-jsdom.phase237.test.tsx"
)

PASSED=0; FAILED=0; N=0

edit() { python3 - "$@" ; }

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)

  N=$((N+1))
  printf '%s' "$program" > "/tmp/p237_${N}.py"

  if ! python3 "/tmp/p237_${N}.py"; then
    echo "INVALID  $label (mutation failed to apply — proves nothing)"
    FAILED=$((FAILED+1)); restore; return
  fi

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p237bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p237_${N}.log" 2>&1; then
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

# Helper prologue reused by every mutation: byte-exact single-occurrence replace.
read -r -d '' PROLOGUE <<'PY'
import sys

def swap(path, old, new, count=1):
    s = open(path).read()
    if s.count(old) != count:
        sys.exit(f"anchor not found exactly {count}x in {path} (found {s.count(old)})")
    open(path, "w").write(s.replace(old, new))
PY

echo "=== Phase 237 mutation suite ==="

# A mutation verdict only means something against a GREEN baseline. Without
# this check, a guard test that was already failing would make every mutant look
# "caught" — the exact false confidence this phase exists to remove.
echo "--- baseline: the boundary's own tests must pass first ---"
if ! npx vitest run "${FOCUS[@]}" >/tmp/p237_baseline.log 2>&1; then
  echo "FATAL: the boundary's own tests fail at baseline."
  echo "       Every CAUGHT verdict below would be a false positive. Not running mutants."
  grep -E 'FAIL|AssertionError|Tests ' /tmp/p237_baseline.log | head -20
  exit 2
fi
grep -E '^ (Test Files|Tests )' /tmp/p237_baseline.log | sed 's/^/    /'
echo "--- baseline green; mutation verdicts are meaningful ---"

# ── the guard must be installed in BOTH projects ───────────────────────────
mutate "M1 guard removed from the unit project" catch <<PY
$PROLOGUE
swap("vitest.config.ts",
     '          setupFiles: [NETWORK_GUARD_SETUP],\n',
     '')
PY

mutate "M2 guard removed from the ui project" catch <<PY
$PROLOGUE
swap("vitest.config.ts",
     '          setupFiles: ["src/test-setup.ts", NETWORK_GUARD_SETUP],\n',
     '          setupFiles: ["src/test-setup.ts"],\n')
PY

# ── the boundary itself must stay a boundary ───────────────────────────────
mutate "M3 everything is treated as loopback" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '  const host = (rawHost ?? "").trim().toLowerCase().replace(/^\\[|\\]\$/g, "");',
     '  const host = (rawHost ?? "").trim().toLowerCase().replace(/^\\[|\\]\$/g, "");\n  return true;\n  // eslint-disable-next-line no-unreachable\n  const _unused = host;')
PY

mutate "M4 external hosts allowed by a hardcoded allowlist" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return true;',
     '  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return true;\n  if (host === "api.coingecko.com" || host === "www.okx.com") return true;')
PY

mutate "M5 hermetic mode becomes opt-in" catch <<PY
$PROLOGUE
swap("src/test-setup-network-guard.ts",
     'if (!isLiveOptIn()) {\n  installNetworkGuard();\n}',
     'if (process.env.HERMETIC_NETWORK_GUARD === "1") {\n  installNetworkGuard();\n}')
PY

mutate "M6 fetch is no longer intercepted" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '  const originalFetch = globalThis.fetch;\n  if (typeof originalFetch === "function") {',
     '  const originalFetch = globalThis.fetch;\n  if (false && typeof originalFetch === "function") {')
PY

mutate "M7 raw sockets are no longer intercepted" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '  const socketTargets: Array<[string, Record<string, unknown>, string]> = [\n    ["net", net as unknown as Record<string, unknown>, "connect"],\n    ["net", net as unknown as Record<string, unknown>, "createConnection"],\n    ["tls", tls as unknown as Record<string, unknown>, "connect"],\n  ];',
     '  const socketTargets: Array<[string, Record<string, unknown>, string]> = [];')
PY

mutate "M8 dns.lookup is no longer intercepted" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '  (dns as unknown as Record<string, unknown>).lookup = function guarded(',
     '  (dns as unknown as Record<string, unknown>).__lookup_disabled = function guarded(')
PY

mutate "M9 dns.promises.lookup is no longer intercepted" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '  promises.lookup = function guarded(hostname: unknown, ...rest: unknown[]): unknown {',
     '  promises.__lookup_disabled = function guarded(hostname: unknown, ...rest: unknown[]): unknown {')
PY

mutate "M10 a refused call returns a fake 200 instead of failing" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '      if (host === null || !isLoopbackHost(host)) {\n        return Promise.reject(blockedError("fetch", describeTarget(input, host)));\n      }',
     '      if (host === null || !isLoopbackHost(host)) {\n        return Promise.resolve(new Response("{}", { status: 200 }));\n      }')
PY

mutate "M11 loopback boundary weakened to a substring match" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return true;',
     '  if (host === "" || host.includes("localhost") || host.includes("127")) return true;')
PY

mutate "M22 the setup file stops installing the guard" catch <<PY
$PROLOGUE
swap("src/test-setup-network-guard.ts",
     'if (!isLiveOptIn()) {\n  installNetworkGuard();\n}',
     'if (false && !isLiveOptIn()) {\n  installNetworkGuard();\n}')
PY

# ── the default config must keep the live suites out ───────────────────────
mutate "M12 the .live exclusion disappears from the default config" catch <<PY
$PROLOGUE
swap("vitest.config.ts",
     '  "src/**/*.live",\n',
     '')
PY

mutate "M13 the phase75 exclusion disappears" catch <<PY
$PROLOGUE
swap("vitest.config.ts",
     '  "src/**/phase75-*",\n',
     '')
PY

# ── the live path must stay separate AND stay opt-in ───────────────────────
mutate "M14 the live config stops including the live files" catch <<PY
$PROLOGUE
swap("vitest.live.config.ts",
     '      "src/**/*.live.test.ts",\n',
     '')
PY

mutate "M15 the live config stops requiring the opt-in" catch <<PY
$PROLOGUE
swap("vitest.live.config.ts",
     '    globalSetup: ["src/vitest-live-global-setup.ts"],\n',
     '')
PY

mutate "M16 the live global setup stops refusing" catch <<PY
$PROLOGUE
swap("src/vitest-live-global-setup.ts",
     '  if (isLiveOptIn()) return;\n',
     '  return;\n')
PY

mutate "M17 the opt-in accepts any non-empty value" catch <<PY
$PROLOGUE
swap("src/test-network-guard.ts",
     '  return env[LIVE_OPT_IN_ENV] === LIVE_OPT_IN_VALUE;',
     '  return Boolean(env[LIVE_OPT_IN_ENV]);')
PY

mutate "M18 npm test is pointed at the live config" catch <<PY
$PROLOGUE
swap("package.json",
     '"test": "vitest run",',
     '"test": "vitest run --config vitest.live.config.ts",')
PY

mutate "M19 a CI workflow enables live verification" catch <<PY
$PROLOGUE
swap(".github/workflows/ci.yml",
     '        run: npm test',
     '        run: npm test\n        env:\n          LIVE_PROVIDER_VERIFICATION: "1"')
PY

# ── the structural detector must keep its teeth ────────────────────────────
mutate "M20 the external-call scanner is neutered" catch <<PY
$PROLOGUE
swap("src/lib/hosting/suite-hermeticity.phase181.test.ts",
     '  const found: string[] = [];',
     '  const found: string[] = [];\n  return found;')
PY

# ── enforcement stays in the test layer ────────────────────────────────────
mutate "M21 application code imports the guard" catch <<PY
$PROLOGUE
swap("src/lib/market-radar/verification.ts",
     'const DEFAULT_TIMEOUT_MS = 10_000;',
     'import { installNetworkGuard } from "../test-network-guard";\nvoid installNetworkGuard;\n\nconst DEFAULT_TIMEOUT_MS = 10_000;')
PY

echo
echo "mutants CAUGHT: $PASSED; gaps: $FAILED"
[ "$FAILED" -eq 0 ]
