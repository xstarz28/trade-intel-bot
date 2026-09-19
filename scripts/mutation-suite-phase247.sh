#!/usr/bin/env bash
#
# Phase 247 mutation suite — "Evidence D production verification harness".
#
#   bash scripts/mutation-suite-phase247.sh
#
# Method
#   1. confirm the baseline: the focused suites pass, and the operator command
#      behaves (exit codes, Evidence D state, gate projection, guarantees, and no
#      change to the tree, with zero outbound network attempts)
#   2. for each mutant: apply it, re-run the focused suites; if they still pass,
#      run the command again and compare its observable behaviour with the
#      baseline
#   3. restore every mutated file byte-exact (verified with `cmp`) via `trap`
#
# The focused suites are two: the Phase 247 suite (this phase's decisions, the
# operator command and the gate integration) and the Phase 242 admission suite
# (the canonical layer the gate integration must not change). A mutant that
# neither suite nor the probe notices is a gap; the one mutant declared
# equivalent is a reordering inside the human-readable report, which changes no
# decision and is re-verified by the probe.
#
# SAFETY: the decision module and the command reach no network module and no
# process spawn at all, the probe runs the command under a network guard that
# REFUSES and records, and the probe compares the worktree fingerprint and
# `docs/remediation/` before and after every run.
set -uo pipefail
cd "$(dirname "$0")/.."

LIB="src/lib/deployment/evidence-d-verification.ts"
SCRIPT="scripts/evidence-d-verify.mjs"
READER="src/lib/deployment/release-current-state.ts"
GATE="src/lib/deployment/release-gate.ts"

TARGETS=("$LIB" "$SCRIPT" "$READER" "$GATE")
FOCUS=(
  "src/lib/deployment/evidence-d-verification.phase247.test.ts"
  "src/lib/deployment/release-admission.phase242.test.ts"
)

WORK=/tmp/p247-mutation
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

for f in "${TARGETS[@]}"; do cp "$f" "$f.p247bak"; done
restore() { for f in "${TARGETS[@]}"; do cp "$f.p247bak" "$f"; done; }
cleanup() { restore; for f in "${TARGETS[@]}"; do rm -f "$f.p247bak"; done; rm -rf "$WORK"; }
trap cleanup EXIT

# ── instruments ──────────────────────────────────────────────────────────────

# A guard that RECORDS and REFUSES every outbound network attempt. A command that
# only fails noisily would be indistinguishable from this sandbox's lack of
# provider access, so the probe asserts the refusal identity, not merely failure.
cat >"$GUARD" <<'EOF'
import { appendFileSync } from "node:fs";
import net from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
const LOG = process.env.P247_NET_LOG;
const record = (what) => {
  appendFileSync(LOG, `${what}\n`);
  throw new Error(`phase247-net-guard: refused outbound network use (${what})`);
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
# so a mutant is measured by how it validates a fixed package.
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
const M = await import(pathToFileURL(resolvePath(root, "src/lib/deployment/evidence-d-verification.ts")).href);
const NOW = 1_800_000_000_000;
const DATASET = { "twelve-data": "ohlcv", "alpha-vantage": "ohlcv", coingecko: "quote", coinglass: "derivatives", defillama: "ohlcv", tokenomist: "fundamentals", tickatlas: "calendar", treasury: "treasury", cftc: "cot", eia: "eia", okx: "ohlcv" };
const INSTRUMENT = { "twelve-data": "BTC/USD", "alpha-vantage": "EUR/USD", coingecko: "BTC/USD", coinglass: "BTC/USD", defillama: "BTC/USD", tokenomist: "BTC/USD", eia: "WTI", tickatlas: null, treasury: null, cftc: null, okx: null };
const HOST = { ...M.DOCUMENTED_PROVIDER_HOSTS, coinglass: "live.coinglass.observed", defillama: "live.defillama.observed", tokenomist: "live.tokenomist.observed", tickatlas: "live.tickatlas.observed", treasury: "live.treasury.observed", cftc: "live.cftc.observed", eia: "live.eia.observed" };
const records = M.REQUIRED_PROVIDER_IDS.map((provider) =>
  M.evidenceDRecord({
    provider,
    dataset: DATASET[provider],
    instrument: INSTRUMENT[provider],
    observedAt: NOW - 60_000,
    receivedAt: NOW - 59_000,
    provenance: { transport: "https", host: HOST[provider], status: 200 },
  }),
);
const pkg = M.buildEvidenceDPackage({
  candidate: { commit: "WORKTREE", ref: "heads/arena/01a0adfb-trade-intel-bot" },
  verifiedAt: NOW - 30_000,
  records,
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
guarantees = d.get("guarantees", {})
flags = "".join(
    "f" if guarantees.get(key) is False else ("t" if guarantees.get(key) is True else "?")
    for key in sorted(guarantees)
)
if mode == "status":
    blockers = d.get("blockers", [])
    print(f"{d.get('evidenceDState')}|{d.get('packageFiled')}|{len(blockers)}|{d.get('verdictEcho')}|{flags}")
else:
    record = d.get("gateRecord")
    simulated = d.get("simulated", {})
    print(f"{d.get('state')}|{'yes' if record else 'no'}|{simulated.get('evidenceDState')}|{len(simulated.get('blockers', []))}|{flags}")
PY
}

probe() {
  local before after rcA rcB summaryA summaryB net gitcalls tree
  before=$(tree_state)
  : >"$NETLOG"; : >"$GITLOG"

  PATH="$WORK/shim:$PATH" P247_NET_LOG="$NETLOG" \
    node --import "$GUARD" --experimental-strip-types --no-warnings \
    scripts/evidence-d-verify.mjs --status --json --now 1800000000000 >"$WORK/status.json" 2>/dev/null
  rcA=$?
  summaryA=$(summarise "$WORK/status.json" status)

  PATH="$WORK/shim:$PATH" P247_NET_LOG="$NETLOG" \
    node --import "$GUARD" --experimental-strip-types --no-warnings \
    scripts/evidence-d-verify.mjs --package "$FIXTURE" --json --now 1800000000000 >"$WORK/package.json" 2>/dev/null
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
P247_NET_LOG="$NETLOG" node --import "$GUARD" -e "fetch('https://example.com').catch(() => {})" >/dev/null 2>&1
if [ "$(wc -l <"$NETLOG" 2>/dev/null | tr -d ' \n')" -eq 0 ]; then
  echo "FATAL: the network guard did not observe a deliberate fetch, so it cannot prove anything"
  exit 2
fi
: >"$NETLOG"

BASELINE_PROBE=$(probe)
echo "baseline probe: $BASELINE_PROBE"
if [ "$BASELINE_PROBE" != "1|UNVERIFIED|False|5|NOT READY|ffffffffff|0|EVIDENCE_D_COMPLETE|yes|VERIFIED|4|ffffffffff|0|0|same" ]; then
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
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p247bak" || changed=1; done
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

# ── the provider set ─────────────────────────────────────────────────────────

mutate "M1 drop one provider from the required set" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """export function canonicalProviderSet(): string[] {
  return [...new Set(registryProviderIds())].sort();
}"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """export function canonicalProviderSet(): string[] {
  return [...new Set(registryProviderIds())].sort().slice(0, -1);
}"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M2 accept an unknown provider id" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    } else if (!requiredProviders.includes(record.provider)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    } else if (false) {"""))
PY

mutate "M3 accept a duplicate provider record" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    } else if (seenProviders.includes(record.provider)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    } else if (false) {"""))
PY

mutate "M4 let an empty provider set mean success" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    ok:
      submitted.length > 0 &&"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    ok:
      true &&"""))
PY

mutate "M5 ignore the host this repository documents for the provider" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """        } else if (documented !== null && documented !== host) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """        } else if (false) {"""))
PY

mutate "M6 accept another provider's documented host (provider substitution)" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """        if (owners.length > 0) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """        if (false) {"""))
PY

mutate "M7 accept a returned symbol that is not the requested one" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """        if (requested !== null && record.returnedSymbol !== requested) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """        if (false) {"""))
PY

mutate "M8 accept a provider-native id this repository does not document" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """        if (requested !== documented) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """        if (false) {"""))
PY

mutate "M9 accept a dataset outside the canonical vocabulary" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (typeof record.dataset !== "string" || !EVIDENCE_D_DATASETS.includes(record.dataset)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) {"""))
PY

mutate "M10 accept an instrument-scoped provider without an instrument" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """      if (typeof record.provider === "string" && INSTRUMENT_SCOPED_PROVIDERS.includes(record.provider)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """      if (false) {"""))
PY

# ── live versus fixture, historical, cache and mock ──────────────────────────

mutate "M11 accept a record that declares itself a fixture" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (record.fixture === true) note("FIXTURE_MARKED", `${label} declares itself a fixture`);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    """))
PY

mutate "M12 accept a record that declares itself historical" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (record.historical === true) note("DECLARED_HISTORICAL", `${label} declares itself historical`);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    """))
PY

mutate "M13 accept cache-reused data as a live observation" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (mode === "cache-reused") {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) {"""))
PY

mutate "M14 accept a mock or loopback host" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """  return NON_PRODUCTION_HOSTS.some((pattern) => pattern.test(normalised));"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  return false && NON_PRODUCTION_HOSTS.some((pattern) => pattern.test(normalised));"""))
PY

mutate "M15 accept a test transport" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """        if (/mock|fixture|stub|fake|test|memory|in-process/.test(transport)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """        if (false) {"""))
PY

mutate "M16 accept provenance that is missing entirely" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (!provenance) {
      note("MISSING_PROVENANCE", `${label} carries no provenance, so nothing establishes how the value arrived`);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) {
      note("MISSING_PROVENANCE", `${label} carries no provenance, so nothing establishes how the value arrived`);"""))
PY

# ── timestamps and freshness ─────────────────────────────────────────────────

mutate "M17 ignore the freshness window" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    } else if (finite(now) && EVIDENCE_D_MAX_AGE_MS !== null && now - observedAt > EVIDENCE_D_MAX_AGE_MS) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    } else if (false) {"""))
PY

mutate "M18 accept a future observation" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    } else if (finite(now) && observedAt > now) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    } else if (false) {"""))
PY

mutate "M19 manufacture an observation instant from the receipt" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (observedAt === undefined || observedAt === null) {
      note(
        "MISSING_OBSERVATION",
        `${label} carries no observation time; a receipt time is not an observation and cannot stand in for one`,
      );"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    if (observedAt === undefined || observedAt === null) {
      declaredObservations.push(finite(record.receivedAt) ? record.receivedAt : now);"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M20 judge freshness by the client receipt time" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    } else if (finite(now) && EVIDENCE_D_MAX_AGE_MS !== null && now - observedAt > EVIDENCE_D_MAX_AGE_MS) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    } else if (finite(now) && EVIDENCE_D_MAX_AGE_MS !== null && now - (finite(receivedAt) ? receivedAt : observedAt) > EVIDENCE_D_MAX_AGE_MS) {"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M21 accept a receipt that predates the observation" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    } else if (finite(observedAt) && receivedAt < observedAt) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    } else if (false) {"""))
PY

mutate "M22 accept a wrong environment" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (record.environment !== EVIDENCE_D_ENVIRONMENT) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) {"""))
PY

# ── completeness, contradictions, digest and the gate projection ─────────────

mutate "M23 accept a record that disagrees about the dataset (contradiction)" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """      if (previous !== undefined && previous !== record.dataset) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """      if (false) {"""))
PY

mutate "M24 stop requiring every required provider (incomplete becomes complete)" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """  for (const id of missing) {
    if (seenProviders.includes(id)) continue; // already refused above, with its own reason"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  for (const id of []) {
    if (seenProviders.includes(id)) continue; // already refused above, with its own reason"""))
PY

mutate "M25 stop verifying the package digest" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (expected !== digest) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) {"""))
PY

mutate "M26 accept a package that carries a credential-shaped field" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """  if (credentialKeys.length > 0) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {"""))
PY

mutate "M27 stop binding the package to the candidate" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """    if (claimed !== candidate.commit) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """    if (false) {"""))
PY

mutate "M28 file a gate record for a refused package" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """  if (refusals.length > 0) return { record: null, refusals };"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) return { record: null, refusals };"""))
PY

mutate "M29 let a fixture-scoped package file a record" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """  if (assessment.syntheticScoped) {
    refusals.push("a synthetic or fixture-scoped package may never be filed as production evidence");
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  if (false) {
    refusals.push("a synthetic or fixture-scoped package may never be filed as production evidence");
  }"""))
PY

mutate "M30 make the state depend on the order the records arrive in" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """  const state = codes.length === 0 ? "EVIDENCE_D_COMPLETE" : worstState(codes);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const state = codes.length === 0 ? "EVIDENCE_D_COMPLETE" : stateOf(codes[0]);"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M31 stop naming what counts and what does not" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """export const REJECTED_EVIDENCE_CATEGORIES: readonly string[] = ["""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """export const REJECTED_EVIDENCE_CATEGORIES: readonly string[] = [
  // emptied for the mutation
];
const UNUSED_REJECTED: readonly string[] = ["""
open(p, "w").write(s.replace(old, new))
PY

mutate "M32 stop stating the package schema an operator must write" catch <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """  lines.push(`package schema: ${handoff.recordContract.schema}`);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, """  lines.push("package schema: <see the module>");"""))
PY

# ── the operator command and the reader ──────────────────────────────────────

mutate "M33 make the command open the network" catch <<'PY'
import sys
p = "scripts/evidence-d-verify.mjs"
s = open(p).read()
old = """import { existsSync, readFileSync } from "node:fs";"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """import { existsSync, readFileSync } from "node:fs";
import https from "node:https";"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M34 make the command read a credential from the environment" catch <<'PY'
import sys
p = "scripts/evidence-d-verify.mjs"
s = open(p).read()
old = """const filingPath = PROOF_PATHS.evidenceD;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """const filingPath = PROOF_PATHS.evidenceD;
const leaked = process.env.TWELVE_DATA_API_KEY;"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M35 make the command deploy" catch <<'PY'
import sys
p = "scripts/evidence-d-verify.mjs"
s = open(p).read()
old = """import { existsSync, readFileSync } from "node:fs";"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M36 make the command write (persist) the package" catch <<'PY'
import sys
p = "scripts/evidence-d-verify.mjs"
s = open(p).read()
old = """import { existsSync, readFileSync } from "node:fs";"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """import { existsSync, readFileSync, writeFileSync } from "node:fs";"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M37 let the command decide a release verdict of its own" catch <<'PY'
import sys
p = "scripts/evidence-d-verify.mjs"
s = open(p).read()
old = """    verdictIssuedHere: false,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    verdictIssuedHere: true,"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M38 let the reader file an inadmissible package as VERIFIED" catch <<'PY'
import sys
p = "src/lib/deployment/release-current-state.ts"
s = open(p).read()
old = """  return projection.record ?? blocked(assessment);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  return (
    projection.record ?? {
      prerequisite: EVIDENCE_D_PREREQUISITE,
      status: "VERIFIED" as const,
      source: "external-verification" as const,
      environment: "production" as const,
      observedAt: now,
      detail: "filed anyway",
    }
  );"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M39 swallow the reader's parse failure into a pass" catch <<'PY'
import sys
p = "src/lib/deployment/release-current-state.ts"
s = open(p).read()
old = """      prerequisite: EVIDENCE_D_PREREQUISITE,
      status: "UNVERIFIED",
      source: "documentation",
      environment: "local",
      observedAt: Number.NaN,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      prerequisite: EVIDENCE_D_PREREQUISITE,
      status: "VERIFIED",
      source: "external-verification",
      environment: "production",
      observedAt: now,"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M40 stop carrying the declared observation into the refusal record" catch <<'PY'
import sys
p = "src/lib/deployment/release-current-state.ts"
s = open(p).read()
old = """    observedAt: Math.min(assessment.oldestDeclaredObservation ?? now, now),"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    observedAt: now,"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M41 let the reader accept a package the validator refused" catch <<'PY'
import sys
p = "src/lib/deployment/release-current-state.ts"
s = open(p).read()
old = """  const assessment = evaluateEvidenceDPackage(parsed, { now, candidate });"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const assessment = evaluateEvidenceDPackage(parsed, { now, candidate });
  if (!assessment.complete && assessment.problems.length >= 0) {
    /* the mutation: pretend a refused package is fine */
    const forged = { ...assessment, complete: true, syntheticScoped: false, problems: [] };
    Object.assign(assessment, forged);
  }"""
open(p, "w").write(s.replace(old, new))
PY

# ── the canonical gate, untouched by this phase ──────────────────────────────

mutate "M42 stop checking provider coverage at the gate (provider-set binding)" catch <<'PY'
import sys
p = "src/lib/deployment/release-gate.ts"
s = open(p).read()
old = """      const missing = input.requiredProviders.filter((p) => !covered.includes(p));"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      const missing: string[] = [];"""
open(p, "w").write(s.replace(old, new))
PY

# ── documented equivalent ───────────────────────────────────────────────────

mutate "M43 reorder the human-readable sections inside the gate-projection block" survive <<'PY'
import sys
p = "src/lib/deployment/evidence-d-verification.ts"
s = open(p).read()
old = """  lines.push("── gate projection ─────────────────────────────────────────────────────");"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  lines.push("── gate projection (layout note) ───────────────────────────────────────");"""
open(p, "w").write(s.replace(old, new))
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
echo
echo "── tree ─────────────────────────────────────────────────────────────────"
restore
for f in "${TARGETS[@]}"; do
  if cmp -s "$f" "$f.p247bak"; then echo "byte-exact: $f"; else echo "FATAL: $f is NOT restored"; exit 3; fi
done

if [ "$GAPS" -ne 0 ]; then
  printf 'FAILED: %s\n' "${FAILED_LABELS[@]}"
  exit 1
fi
exit 0
