#!/usr/bin/env bash
#
# Phase 248 mutation suite — "Convex production deployment verification harness".
#
#   bash scripts/mutation-suite-phase248.sh
#
# Method
#   1. confirm the baseline: the focused suites pass, and the operator command
#      behaves (exit codes, the CONVEX deployment state, the gate projection, the
#      simulated admission, the guarantees, and no change to the tree, with zero
#      outbound network attempts and zero git spawns)
#   2. for each mutant: apply it, re-run the focused suites; if they still pass,
#      run the command again and compare its observable behaviour with the
#      baseline
#   3. restore every mutated file byte-exact (verified with `cmp`) via `trap`
#
# The focused suites are two: the Phase 248 suite (this phase's decisions, the
# function-surface scanner, the operator command and the reader/gate integration)
# and the Phase 242 admission suite (the canonical layer the integration must not
# change). A mutant that neither suite nor the probe notices is a gap; the one
# mutant declared equivalent relabels a line of the human-readable handoff, which
# changes no decision, appears in no JSON the probe reads, and is re-verified by
# the probe staying unmoved.
#
# SAFETY: the decision module reaches no filesystem, no network module, no clock
# and no process spawn at all (only the surface scanner reads, and only the
# command reads one package); the probe runs the command under a network guard
# that REFUSES and records, behind a recording git shim, and compares the
# worktree fingerprint and `docs/remediation/` before and after every run.
set -uo pipefail
cd "$(dirname "$0")/.."

LIB="src/lib/deployment/convex-deployment-verification.ts"
SCANNER="src/lib/deployment/convex-function-surface.ts"
SCRIPT="scripts/convex-deployment-verify.mjs"
READER="src/lib/deployment/release-current-state.ts"
GATE="src/lib/deployment/release-gate.ts"

TARGETS=("$LIB" "$SCANNER" "$SCRIPT" "$READER" "$GATE")
FOCUS=(
  "src/lib/deployment/convex-deployment-verification.phase248.test.ts"
  "src/lib/deployment/release-admission.phase242.test.ts"
)

WORK=/tmp/p248-mutation
rm -rf "$WORK"; mkdir -p "$WORK"
FIXTURE="$WORK/complete.json"
NETLOG="$WORK/net.log"
GUARD="$WORK/netguard.mjs"
GITLOG="$WORK/git.log"

PASSED=0; EQUIV=0; GAPS=0; N=0
FAILED_LABELS=()
BASELINE_PROBE=""
# The log files exist from the start: a probe that measures "did this file grow"
# must not be confused by the file being created between its two readings.
: >"$NETLOG"; : >"$GITLOG"
# The PATH the harness itself uses, so the recording git shim can only be reached
# by the command under test.
PROBE_PATH="$PATH"

for f in "${TARGETS[@]}"; do cp "$f" "$f.p248bak"; done
restore() { for f in "${TARGETS[@]}"; do cp "$f.p248bak" "$f"; done; }
cleanup() { restore; for f in "${TARGETS[@]}"; do rm -f "$f.p248bak"; done; rm -rf "$WORK"; }
trap cleanup EXIT

# ── instruments ──────────────────────────────────────────────────────────────

# A guard that RECORDS and REFUSES every outbound network attempt. A command that
# only fails noisily would be indistinguishable from this sandbox's lack of
# Convex control-plane access, so the probe asserts the refusal identity, not
# merely failure.
cat >"$GUARD" <<'EOF'
import { appendFileSync } from "node:fs";
import net from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
const LOG = process.env.P248_NET_LOG;
const record = (what) => {
  appendFileSync(LOG, `${what}\n`);
  throw new Error(`phase248-net-guard: refused outbound network use (${what})`);
};
net.Socket.prototype.connect = function () { record("net.Socket.connect"); };
dns.lookup = function () { record("dns.lookup"); };
dns.promises.lookup = async function () { record("dns.promises.lookup"); };
http.request = function () { record("http.request"); };
http.get = function () { record("http.get"); };
https.request = function () { record("https.request"); };
https.get = function () { record("https.get"); };
globalThis.fetch = function () { record("fetch"); };
EOF

# A recording git shim, to prove the command spawns nothing.
REAL_GIT=$(command -v git)
mkdir -p "$WORK/shim"
cat >"$WORK/shim/git" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$GITLOG"
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$WORK/shim/git"

# The fixture the probe feeds the command: assembled ONCE, from the clean module,
# so a mutant is measured by how it validates a fixed package. It binds to the
# canonical candidate (WORKTREE / heads/arena/01a0adfb-trade-intel-bot) and to the
# declared deployment, and publishes the candidate's whole scanned surface.
cat >"$WORK/make-fixture.mjs" <<'EOF'
import { registerHooks } from "node:module";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
const root = process.cwd();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const aliased = resolvePath(root, "src", specifier.slice(2));
      for (const candidate of [aliased, `${aliased}.ts`, `${aliased}/index.ts`]) {
        try { readFileSync(candidate); return { url: pathToFileURL(candidate).href, shortCircuit: true }; } catch { /* next */ }
      }
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      try { return nextResolve(specifier, context); } catch { return nextResolve(`${specifier}.ts`, context); }
    }
    return nextResolve(specifier, context);
  },
});
const M = await import(pathToFileURL(resolvePath(root, "src/lib/deployment/convex-deployment-verification.ts")).href);
const S = await import(pathToFileURL(resolvePath(root, "src/lib/deployment/convex-function-surface.ts")).href);
const NOW = 1_800_000_000_000;
const pkg = M.buildConvexDeploymentPackage({
  candidate: { commit: "WORKTREE", ref: "heads/arena/01a0adfb-trade-intel-bot" },
  deployment: "prod:xstarz:trade-intel-bot",
  deploymentUrl: "https://trade-intel-bot.convex.cloud",
  siteUrl: "https://trade-intel-bot.convex.site",
  observedAt: NOW - 60_000,
  deploymentEnv: null,
  accessVerdict: M.AUTHENTICATED_ACCESS_STATES[0] ?? "AUTHENTICATED",
  publishedFunctions: S.requiredConvexFunctionReferences(),
});
writeFileSync(process.argv[2], JSON.stringify(pkg, null, 2));
EOF

tree_state() {
  local files porcelain gitcalls
  files=$(find docs/remediation -type f 2>/dev/null | wc -l | tr -d ' ')
  porcelain=$(env PATH="$PROBE_PATH" git status --porcelain | sha256sum | cut -c1-12)
  gitcalls=$(wc -l <"$GITLOG" 2>/dev/null | tr -d ' \n')
  echo "${files}:${porcelain}:${gitcalls:-0}"
}

summarise() {
  # $1 file with the JSON output, $2 mode (status|package)
  python3 - "$1" "$2" <<'PY'
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read()
mode = sys.argv[2]
try:
    d = json.loads(raw)
except Exception:
    print("unparseable")
    sys.exit(0)
g = d.get("guarantees", {})
flags = "".join("f" if g.get(k) is False else ("t" if g.get(k) is True else "?") for k in sorted(g))
if mode == "status":
    print(f"{d.get('deploymentState')}|{d.get('packageFiled')}|{len(d.get('blockers', []))}|{d.get('verdictEcho')}|{flags}")
else:
    rec = d.get("gateRecord")
    sim = d.get("simulated", {})
    print(f"{d.get('state')}|{'yes' if rec else 'no'}|{sim.get('deploymentState')}|{len(sim.get('blockers', []))}|{flags}")
PY
}

probe() {
  local before after rcA rcB summaryA summaryB net gitcalls tree
  before=$(tree_state)
  : >"$NETLOG"; : >"$GITLOG"

  PATH="$WORK/shim:$PATH" P248_NET_LOG="$NETLOG" \
    node --import "$GUARD" --experimental-strip-types --no-warnings \
    scripts/convex-deployment-verify.mjs --status --json --now 1800000000000 >"$WORK/status.json" 2>/dev/null
  rcA=$?
  summaryA=$(summarise "$WORK/status.json" status)

  PATH="$WORK/shim:$PATH" P248_NET_LOG="$NETLOG" \
    node --import "$GUARD" --experimental-strip-types --no-warnings \
    scripts/convex-deployment-verify.mjs --package "$FIXTURE" --deployment prod:xstarz:trade-intel-bot --json --now 1800000000000 >"$WORK/package.json" 2>/dev/null
  rcB=$?
  summaryB=$(summarise "$WORK/package.json" package)

  net=$(wc -l <"$NETLOG" 2>/dev/null | tr -d ' \n')
  after=$(tree_state)
  gitcalls=$(printf '%s' "$after" | cut -d: -f3)
  tree="same"
  [ "$before" = "$after" ] || tree="changed"
  echo "${rcA}|${summaryA}|${rcB}|${summaryB}|${net}|${gitcalls}|${tree}"
}

# ── baseline ─────────────────────────────────────────────────────────────────

echo "baseline: focused suites + the operator command must behave first"
if ! npx vitest run "${FOCUS[@]}" >/dev/null 2>&1; then echo "FATAL: baseline suites are red"; exit 2; fi
node --experimental-strip-types --no-warnings "$WORK/make-fixture.mjs" "$FIXTURE" || { echo "FATAL: could not build the fixture"; exit 2; }

# The guard must be able to see a leak, or its silence proves nothing.
: >"$NETLOG"
P248_NET_LOG="$NETLOG" node --import "$GUARD" -e "fetch('https://example.com').catch(() => {})" >/dev/null 2>&1
if [ "$(wc -l <"$NETLOG" 2>/dev/null | tr -d ' \n')" -eq 0 ]; then
  echo "FATAL: the network guard did not observe a deliberate fetch, so it cannot prove anything"
  exit 2
fi
: >"$NETLOG"

BASELINE_PROBE=$(probe)
echo "baseline probe: $BASELINE_PROBE"
if [ "$BASELINE_PROBE" != "1|UNVERIFIED|False|5|NOT READY|ffffffffff|0|CONVEX_DEPLOYMENT_VERIFIED|yes|VERIFIED|4|ffffffffff|0|0|same" ]; then
  echo "FATAL: the baseline probe is not the expected one; the harness would measure nothing"
  exit 2
fi
echo
echo "── mutants ──────────────────────────────────────────────────────────────"

# $1 label, $2 expectation (catch|survive); the python program arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local program
  program=$(cat)
  case "$program" in
    "import sys"*) ;;
    *)
      echo "INVALID   $label (no mutation program on stdin: a heredoc delimiter is missing)"
      GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
      ;;
  esac

  N=$((N + 1))
  printf '%s' "$program" >"$WORK/mut_${N}.py"
  if ! python3 "$WORK/mut_${N}.py" >/dev/null; then
    echo "INVALID   $label (the mutation did not apply: the anchor is stale, so it proves nothing)"
    GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
  fi
  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p248bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID   $label (no byte changed: the mutation is inert by construction)"
    GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"$WORK/mut_${N}.log" 2>&1; then
    local observed; observed=$(probe)
    if [ "$observed" != "$BASELINE_PROBE" ]; then
      echo "CAUGHT    $label (probe: expected $BASELINE_PROBE, observed $observed)"
      PASSED=$((PASSED + 1))
    elif [ "$expect" = "survive" ]; then
      echo "EQUIVALENT $label (documented: no decision changed, and the probe is unmoved)"
      EQUIV=$((EQUIV + 1))
    else
      echo "SURVIVED  $label   <-- GUARD GAP"
      GAPS=$((GAPS + 1)); FAILED_LABELS+=("SURVIVED: $label")
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "CAUGHT?   $label   <-- flagged, but this mutant was declared equivalent"
      GAPS=$((GAPS + 1)); FAILED_LABELS+=("FALSE EQUIVALENT: $label")
    else
      echo "CAUGHT    $label (a focused suite failed)"
      PASSED=$((PASSED + 1))
    fi
  fi
  restore
}

# ── the package-level contract ───────────────────────────────────────────────

mutate "M1 accept any schema id" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (pkg.schema !== CONVEX_DEPLOYMENT_SCHEMA) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M2 accept verified:false" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (pkg.verified !== true) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M3 accept any provenance source" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (pkg.source !== "external-verification") {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M4 accept any environment" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (pkg.environment !== CONVEX_DEPLOYMENT_ENVIRONMENT) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M5 ignore a credential-shaped field" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (credentialKeys.length > 0) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M6 stop pinning the content with the digest" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """    if (expected !== digest) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) {"""))
PY

mutate "M26 ignore the fixture/synthetic/*-only markers" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  const syntheticScoped =
    pkg.fixture === true ||
    pkg.synthetic === true ||
    pkg.configurationOnly === true ||
    pkg.buildOnly === true ||
    pkg.codegenOnly === true;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  const syntheticScoped = false;"""))
PY

# ── the deployment identity and binding ──────────────────────────────────────

mutate "M7 accept a package bound to another commit" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (claimed !== candidate.commit) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M8 accept a non-production deployment identity" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (problem) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M9 accept a missing deployment identity" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (deployment.length === 0) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M10 accept any observed deployment environment" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (!envCheck.ok) refuse(refusals, envCheck.code, envCheck.reason);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) refuse(refusals, envCheck.code, envCheck.reason);"""))
PY

mutate "M13 accept an undeclared deployment" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (declared.length === 0) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M14 accept a foreign (well-formed) deployment" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  } else if (deployment.length > 0 && deployment !== declared) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  } else if (false) {"""))
PY

# ── the recorded access verdict ──────────────────────────────────────────────

mutate "M11 accept an unauthenticated access verdict" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  } else if (!AUTHENTICATED_ACCESS_STATES.includes(accessVerdict)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  } else if (false) {"""))
PY

mutate "M12 accept a missing access verdict" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (accessVerdict.length === 0) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M31 treat every access state as authenticated" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  .filter(([, code]) => code === 0)"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  .filter(() => true)"""))
PY

# ── the deployment URLs ──────────────────────────────────────────────────────

mutate "M15 accept a non-https deployment URL" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (url.protocol !== "https:") {
    return { ok: false, code: "DEPLOYMENT_URL_NOT_HTTPS", reason: `the deployment URL must use https (got ${url.protocol})`, host };
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  if (false) {
    return { ok: false, code: "DEPLOYMENT_URL_NOT_HTTPS", reason: `the deployment URL must use https (got ${url.protocol})`, host };
  }"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M16 accept a loopback deployment URL" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "[::1]" || host === "::1") {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M17 accept a non-*.convex.cloud deployment host" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (!host.endsWith(CONVEX_CLOUD_SUFFIX) || host === CONVEX_CLOUD_SUFFIX.slice(1)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M18 accept a non-*.convex.site site host" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (!host.endsWith(CONVEX_SITE_SUFFIX) || host === CONVEX_SITE_SUFFIX.slice(1)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

# ── the required function surface and its coverage ───────────────────────────

mutate "M19 let an unknown required surface mean covered" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (requiredFunctions.length === 0) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M20 stop checking function coverage" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """    const missing = requiredFunctions.filter((reference) => !published.has(reference)).sort();"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    const missing: string[] = [];"""))
PY

mutate "M21 accept a publishedFunctions that is not an array" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (!Array.isArray(pkg.publishedFunctions)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M27 stop normalising module:function to module.function" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """        .map((entry) => entry.trim().replace(/:/g, ".")),"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """        .map((entry) => entry.trim()),"""))
PY

# ── the observation instant and freshness ────────────────────────────────────

mutate "M22 accept a future-dated observation" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  } else if (observedAt > now) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  } else if (false) {"""))
PY

mutate "M23 accept a stale observation" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  } else if (CONVEX_DEPLOYMENT_MAX_AGE_MS !== null && now - observedAt > CONVEX_DEPLOYMENT_MAX_AGE_MS) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  } else if (false) {"""))
PY

mutate "M24 accept a non-finite observation" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (!finite(observedAt)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M25 default a missing evaluation instant instead of refusing" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (!finite(now)) refuse(refusals, "NO_EVALUATION_INSTANT", "no evaluation instant was supplied");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) refuse(refusals, "NO_EVALUATION_INSTANT", "no evaluation instant was supplied");"""))
PY

# ── the state summary and the gate projection ────────────────────────────────

mutate "M30 summarise the first refusal instead of the worst" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """function worstState(codes: readonly string[]): ConvexDeploymentState {
  for (const state of CONVEX_DEPLOYMENT_STATE_PRECEDENCE) {
    if (codes.some((code) => stateOf(code) === state)) return state;
  }
  return "INVALID_EVIDENCE";
}"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """function worstState(codes: readonly string[]): ConvexDeploymentState {
  return codes.length > 0 ? stateOf(codes[0]) : "INVALID_EVIDENCE";
}"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M28 project a gate record even when the assessment is incomplete" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (!assessment.complete) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M29 project a gate record even when refusals remain" catch <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  if (refusals.length > 0) return { record: null, refusals };"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) return { record: null, refusals };"""))
PY

# ── the function-surface scanner ─────────────────────────────────────────────

mutate "M32 drop the internal* forms from the required surface" catch <<'PY'
import sys
p = "src/lib/deployment/convex-function-surface.ts"
s = open(p).read()
old = "(internalQuery|internalMutation|internalAction|query|mutation|action)"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "(query|mutation|action)"))
PY

mutate "M33 let test files contribute references" catch <<'PY'
import sys
p = "src/lib/deployment/convex-function-surface.ts"
s = open(p).read()
old = """    if (entry.name.includes(".test.")) continue;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) continue;"""))
PY

mutate "M34 stop marking internal functions" catch <<'PY'
import sys
p = "src/lib/deployment/convex-function-surface.ts"
s = open(p).read()
old = """        internal: kind.startsWith("internal"),"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """        internal: false,"""))
PY

# ── the operator command ─────────────────────────────────────────────────────

mutate "M35 make --status exit 0 even when CONVEX is unverified" catch <<'PY'
import sys
p = "scripts/convex-deployment-verify.mjs"
s = open(p).read()
old = """  process.exit(report.deploymentState === "VERIFIED" ? 0 : 1);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  process.exit(0);"""))
PY

mutate "M36 give the command a filesystem writer" catch <<'PY'
import sys
p = "scripts/convex-deployment-verify.mjs"
s = open(p).read()
old = """import { existsSync, readFileSync } from "node:fs";"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """import { existsSync, readFileSync, writeFileSync } from "node:fs";
writeFileSync("/tmp/p248-mutation-leak", "leak");"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M37 let the command read the environment" catch <<'PY'
import sys
p = "scripts/convex-deployment-verify.mjs"
s = open(p).read()
old = """const requiredFunctions = requiredConvexFunctionReferences();"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """const requiredFunctions = requiredConvexFunctionReferences();
const _envProbe = process.env.CONVEX_DEPLOYMENT_URL;"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M38 let the command import a network module" catch <<'PY'
import sys
p = "scripts/convex-deployment-verify.mjs"
s = open(p).read()
old = """import module from "node:module";"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """import module from "node:module";
import "node:https";"""
open(p, "w").write(s.replace(old, new))
PY

# ── the reader integration ───────────────────────────────────────────────────

mutate "M39 let the reader accept a package the validator refused" catch <<'PY'
import sys
p = "src/lib/deployment/release-current-state.ts"
s = open(p).read()
old = """  const projection = toGateConvexRecord(assessment, {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  if (!assessment.complete) {
    Object.assign(assessment, { complete: true, state: "CONVEX_DEPLOYMENT_VERIFIED", problems: [], syntheticScoped: false });
  }
  const projection = toGateConvexRecord(assessment, {"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M40 let the reader quote a bare claim instead of validating it" catch <<'PY'
import sys
p = "src/lib/deployment/release-current-state.ts"
s = open(p).read()
old = """  const assessment = evaluateConvexDeploymentPackage(parsed, {
    now,
    candidate,
    productionDeployment,
    requiredFunctions,
  });
  const projection = toGateConvexRecord(assessment, {
    candidateCommit: candidate.commit,
    deployment: productionDeployment ?? assessment.deployment ?? undefined,
  });
  return projection.record ?? blocked(assessment);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  return {
    prerequisite: CONVEX_DEPLOYMENT_PREREQUISITE,
    status: "VERIFIED",
    source: "external-verification",
    environment: "production",
    observedAt: now,
    subject: { commit: candidate.commit, ...(productionDeployment ? { deployment: productionDeployment } : {}) },
    detail: `${path}: quoted without validation`,
  };"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M41 let the reader evaluate against an empty required surface" catch <<'PY'
import sys
p = "src/lib/deployment/release-current-state.ts"
s = open(p).read()
old = """  const requiredFunctions = resolveRequiredFunctions(options.requiredConvexFunctions);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  const requiredFunctions: readonly string[] = [];"""))
PY

# ── the canonical gate, untouched by this phase ──────────────────────────────

mutate "M42 stop checking the deployment binding at the gate" catch <<'PY'
import sys
p = "src/lib/deployment/release-gate.ts"
s = open(p).read()
old = """    case "deployment":
      if (!input.candidate.productionDeployment) {
        return "no production deployment is declared for this candidate";
      }
      if (subject.deployment !== input.candidate.productionDeployment) {
        return `wrong deployment: evidence covers ${String(subject.deployment)}, candidate deploys to ${input.candidate.productionDeployment}`;
      }
      return null;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    case "deployment":
      return null;"""
open(p, "w").write(s.replace(old, new))
PY

# ── documented equivalent ───────────────────────────────────────────────────

mutate "M43 relabel a line of the human-readable handoff" survive <<'PY'
import sys
p = "src/lib/deployment/convex-deployment-verification.ts"
s = open(p).read()
old = """  lines.push(`statement: ${handoff.statement}`);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  lines.push(`statement (layout note): ${handoff.statement}`);"""
open(p, "w").write(s.replace(old, new))
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
echo
echo "── tree ─────────────────────────────────────────────────────────────────"
restore
for f in "${TARGETS[@]}"; do
  if cmp -s "$f" "$f.p248bak"; then echo "byte-exact: $f"; else echo "FATAL: $f is NOT restored"; exit 3; fi
done

if [ "$GAPS" -ne 0 ]; then
  printf 'FAILED: %s\n' "${FAILED_LABELS[@]}"
  exit 1
fi
exit 0
