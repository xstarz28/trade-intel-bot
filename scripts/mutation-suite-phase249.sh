#!/usr/bin/env bash
#
# Phase 249 mutation suite — "A2 live-ref rollover and inventory reconciliation".
#
#   bash scripts/mutation-suite-phase249.sh
#
# Method
#   1. confirm the baseline: the focused suites pass, and the reconciliation probe
#      reports the measured nine-ref scope (state, counts, digest, and the three
#      "nothing was remediated" flags), with the measurement tooling touching no
#      remote ref and writing no file
#   2. for each mutant: apply it, re-run the focused suites; if they still pass,
#      run the probe again and compare its observable output with the baseline
#   3. restore every mutated file byte-exact (verified with `cmp`) via `trap`
#
# The focused suites are five: the Phase 249 suite (this phase's decisions and the
# artefacts it wrote), the Phase 233 ref-inventory guard and the Phase 221 release
# consistency guard (the two that went red when the ninth ref appeared, and which
# must stay red for any drift), the Phase 244 manifest suite (the canonical scope
# and its reconciliation) and the Phase 245 rehearsal suite (the machinery that
# consumes the scope). A mutant none of them notices, and the probe does not
# either, is a gap.
#
# SAFETY
#   No mutant is ever EXECUTED as a program that could write to the remote. The
#   "permit git writes / force-push / history rewrite" mutants insert inert
#   tokens into the generator's source, which the focused suites scan rather than
#   run; nothing in the suite spawns `git push`, and no test executes
#   scripts/secret-ref-inventory.mjs at all. The generator probe below runs in
#   DRY-RUN mode behind a recording git shim, so the only git it performs is the
#   read-only `ls-remote`/`rev-list`/`cat-file` it already does, and the worktree
#   fingerprint is compared before and after to prove it wrote nothing.
set -uo pipefail
cd "$(dirname "$0")/.."

MODULE="src/lib/deployment/ref-rollover-reconciliation.ts"
FACTS="src/lib/deployment/runbook-ref-facts.ts"
LIVEREFS="src/lib/deployment/live-refs.ts"
MANIFEST="src/lib/deployment/remediation-manifest.ts"
RUNBOOK="docs/SECRET-REMEDIATION-RUNBOOK.md"
ARTIFACT="docs/secret-remediation-refs.json"
GENERATOR="scripts/secret-ref-inventory.mjs"

TARGETS=("$MODULE" "$FACTS" "$LIVEREFS" "$MANIFEST" "$RUNBOOK" "$ARTIFACT" "$GENERATOR")
FOCUS=(
  "src/lib/deployment/ref-rollover.phase249.test.ts"
  "src/lib/deployment/ref-inventory.phase233.test.ts"
  "src/lib/deployment/release-gate-consistency.phase221.test.ts"
  "src/lib/deployment/remediation-manifest.phase244.test.ts"
  "src/lib/deployment/a2-rehearsal.phase245.test.ts"
)

WORK=/tmp/p249-mutation
rm -rf "$WORK"; mkdir -p "$WORK"
GITLOG="$WORK/git.log"
NETLOG="$WORK/net.log"
: >"$GITLOG"; : >"$NETLOG"
PROBE_PATH="$PATH"

PASSED=0; GAPS=0; N=0; INFRA=0
BLOCKED_LABELS=()
FAILED_LABELS=()
BASELINE_PROBE=""
BASELINE_GEN=""

for f in "${TARGETS[@]}"; do cp "$f" "$f.p249bak"; done
restore() { for f in "${TARGETS[@]}"; do cp "$f.p249bak" "$f"; done; }
cleanup() { restore; for f in "${TARGETS[@]}"; do rm -f "$f.p249bak"; done; rm -rf "$WORK"; }
trap cleanup EXIT

# ── instruments ──────────────────────────────────────────────────────────────

REAL_GIT=$(command -v git)
mkdir -p "$WORK/shim"
cat >"$WORK/shim/git" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$GITLOG"
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$WORK/shim/git"

# A guard that RECORDS and REFUSES outbound Node-level network use. The generator
# reaches the remote through `git ls-remote` (a subprocess, not Node sockets), so
# this guard proves it opens no HTTP/socket of its own.
cat >"$WORK/netguard.mjs" <<'EOF'
import { appendFileSync } from "node:fs";
import net from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
const LOG = process.env.P249_NET_LOG;
const record = (what) => {
  appendFileSync(LOG, `${what}\n`);
  throw new Error(`phase249-net-guard: refused outbound network use (${what})`);
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

# The probe: evaluate the rollover against the REAL artefacts and summarise what a
# reader would observe. It imports the decision module, the manifest, the runbook
# parsers and the live-ref source, so a mutant in any of them moves the summary.
cat >"$WORK/probe.mjs" <<'EOF'
import { registerHooks } from "node:module";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
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
const importTs = (p) => import(pathToFileURL(resolvePath(root, p)).href);
const R = await importTs("src/lib/deployment/ref-rollover-reconciliation.ts");
const F = await importTs("src/lib/deployment/runbook-ref-facts.ts");
const L = await importTs("src/lib/deployment/live-refs.ts");
const M = await importTs("src/lib/deployment/remediation-manifest.ts");

const out = (label, value) => process.stdout.write(`${label}=${value}\n`);
try {
  const runbook = readFileSync(resolvePath(root, "docs/SECRET-REMEDIATION-RUNBOOK.md"), "utf8");
  const raw = readFileSync(resolvePath(root, "docs/secret-remediation-refs.json"), "utf8");
  const artifact = F.parseVerifiedInventory(raw);
  let live;
  try {
    live = L.listLiveRefs();
  } catch (error) {
    out("state", "LIVE_REF_SOURCE_UNAVAILABLE");
    process.exit(0);
  }
  const assessment = R.evaluateRefRollover({
    liveRefs: live,
    measurement: {
      shallow: false,
      present: true,
      fingerprint: artifact.fingerprint,
      blobPaths: artifact.blobPaths,
      historyCommits: artifact.historyCommits,
      carrierCommits: artifact.carrierCommits,
      refs: artifact.refs,
    },
    manifest: {
      fingerprint: M.REMEDIATION_MANIFEST.credential.fingerprint,
      requiredBlobPaths: M.REMEDIATION_MANIFEST.inventory.requiredBlobPaths,
      carrierCommits: M.REMEDIATION_MANIFEST.credential.carrierCommits,
      refs: M.AFFECTED_REF_EXPECTATIONS,
    },
    runbook: {
      exposure: F.parseExposureFacts(runbook),
      coverage: F.parseRewriteCoverage(runbook),
      declaredCount: F.parseDeclaredRefCount(runbook),
    },
  });
  out("state", assessment.state);
  out("reconciled", assessment.reconciled ? "yes" : "no");
  out("live", assessment.liveRefCount);
  out("affected", assessment.affectedRefCount);
  out("exposedAtTip", assessment.exposedAtTipRefs.length);
  out("unaccounted", assessment.unaccountedRefs.length);
  out("carrier", assessment.carrierCommits);
  out("history", assessment.historyCommits);
  out("digest", R.rolloverDigest(assessment.affectedRefs, assessment.carrierCommits));
  out("remediated", assessment.remediationPerformed ? "yes" : "no");
  out("rewritten", assessment.rewriteExecuted ? "yes" : "no");
  out("a2Verified", assessment.a2Verified ? "yes" : "no");
  out("trustworthy", assessment.measurementTrustworthy ? "yes" : "no");
  out("problems", assessment.problems.length);
  out("firstProblem", (assessment.problems[0] ?? "none").split(" — ")[0]);
  // What this rollover added: the live refs absent from the scope that predates it.
  const prior = M.AFFECTED_REF_EXPECTATIONS.map((e) => e.ref).filter(
    (ref) => ref !== "heads/arena/01a0b293-trade-intel-bot",
  );
  out("added", R.rolloverAddedRefs(live, prior).join(",") || "none");
} catch (error) {
  out("state", "PROBE_THREW");
  out("detail", String(error && error.message ? error.message : error).split("\n")[0]);
}
EOF

summarise_probe() {
  python3 - "$1" <<'PY'
import sys
keys = ["state","reconciled","live","affected","exposedAtTip","unaccounted","carrier",
        "history","digest","remediated","rewritten","a2Verified","trustworthy",
        "problems","firstProblem","added"]
vals = {}
try:
    for line in open(sys.argv[1], encoding="utf-8"):
        if "=" in line:
            k, v = line.rstrip("\n").split("=", 1)
            vals[k] = v
except Exception:
    pass
print("|".join(vals.get(k, "?") for k in keys))
PY
}

# Is the remote readable at this moment, independent of any mutant?
#
# This is what separates an infrastructure failure from a catch. Several mutants
# deliberately break the live-ref source itself (M11 makes it fail open, M12 makes
# it count a peeled tag object as a ref), and they surface as the very same
# LiveRefSourceUnavailableError a dead token produces. Grepping the log alone
# cannot tell those apart, and crediting them as BLOCKED would under-report real
# catches — so the remote is probed directly instead.
remote_readable() {
  env PATH="$PROBE_PATH" git ls-remote --heads origin >/dev/null 2>&1
}

tree_state() {
  local porcelain gitcalls
  porcelain=$(env PATH="$PROBE_PATH" git status --porcelain | sha256sum | cut -c1-12)
  gitcalls=$(wc -l <"$GITLOG" 2>/dev/null | tr -d ' \n')
  echo "${porcelain}:${gitcalls:-0}"
}

probe() {
  # `git ls-remote` can fail transiently. Retry, and if the remote stays
  # unreadable report that identity rather than a summary that looks like a
  # result: "could not look" must never be recorded as "nothing to see".
  local attempt summary
  summary=""
  for attempt in 1 2 3; do
    node --experimental-strip-types --no-warnings "$WORK/probe.mjs" >"$WORK/probe.out" 2>/dev/null
    summary=$(summarise_probe "$WORK/probe.out")
    case "$summary" in
      LIVE_REF_SOURCE_UNAVAILABLE*) [ "$attempt" -lt 3 ] && sleep 5 && continue ;;
    esac
    break
  done
  printf '%s' "$summary"
}

# Run the generator in DRY-RUN behind the recording shim and the network guard, and
# report what it touched. Read-only subcommands only, no Node-level network, and an
# unchanged worktree.
gen_probe() {
  local before after rc subcommands forbidden net tree
  before=$(tree_state)
  : >"$GITLOG"; : >"$NETLOG"
  env PATH="$WORK/shim:$PATH" P249_NET_LOG="$NETLOG" \
    node --import "$WORK/netguard.mjs" scripts/secret-ref-inventory.mjs \
    >"$WORK/gen.out" 2>"$WORK/gen.err"
  rc=$?
  subcommands=$(awk '{print $1}' "$GITLOG" 2>/dev/null | sort -u | tr '\n' ',' )
  forbidden=$(grep -cE '^(push|update-ref|branch|tag|reset|rebase|filter-branch|filter-repo|commit|checkout|merge|remote)( |$)' "$GITLOG" 2>/dev/null || true)
  net=$(wc -l <"$NETLOG" 2>/dev/null | tr -d ' \n')
  after=$(tree_state)
  tree="same"
  [ "$(printf '%s' "$before" | cut -d: -f1)" = "$(printf '%s' "$after" | cut -d: -f1)" ] || tree="changed"
  echo "rc=${rc}|writes=${tree}|net=${net}|forbiddenGit=${forbidden:-0}|subcommands=${subcommands}|carrier=$(grep -o 'carrier commits: [0-9]*' "$WORK/gen.out" | head -1 | grep -o '[0-9]*$')"
}

# ── baseline ─────────────────────────────────────────────────────────────────

echo "baseline: focused suites must be green before any mutant is measured"
if ! npx vitest run "${FOCUS[@]}" >"$WORK/baseline.log" 2>&1; then
  if grep -qE "LiveRefSourceUnavailableError|could not read refs from remote|could not read Username for" "$WORK/baseline.log" && ! remote_readable; then
    echo "FATAL: the remote is unreadable (git ls-remote failed), so three of the five"
    echo "       focused suites cannot run. Every mutant would then look 'caught' by an"
    echo "       infrastructure failure, which proves nothing. Refusing to start."
    echo "       Restore GitHub access and re-run."
    exit 2
  fi
  echo "FATAL: baseline focused suites are red; the harness would measure nothing"
  tail -20 "$WORK/baseline.log"
  exit 2
fi

# The network guard must be able to see a leak, or its silence proves nothing.
: >"$NETLOG"
P249_NET_LOG="$NETLOG" node --import "$WORK/netguard.mjs" -e "fetch('https://example.com').catch(() => {})" >/dev/null 2>&1
if [ "$(wc -l <"$NETLOG" 2>/dev/null | tr -d ' \n')" -eq 0 ]; then
  echo "FATAL: the network guard did not observe a deliberate fetch, so it cannot prove anything"
  exit 2
fi
: >"$NETLOG"

BASELINE_PROBE=$(probe)
echo "baseline probe: $BASELINE_PROBE"
# Values only, in summarise_probe's key order:
#   state reconciled live affected exposedAtTip unaccounted carrier history digest
#   remediated rewritten a2Verified trustworthy problems firstProblem added
EXPECTED_PROBE="ROLLOVER_RECONCILED|yes|9|0|0|0|269|840|463f2d78|no|no|no|yes|0|none|heads/arena/01a0b293-trade-intel-bot"
if [ "$BASELINE_PROBE" != "$EXPECTED_PROBE" ]; then
  echo "FATAL: the baseline probe is not the expected reconciled nine-ref scope"
  echo "       expected: $EXPECTED_PROBE"
  exit 2
fi

echo "baseline generator probe: dry-run behind the recording shim (this reads the remote)"
BASELINE_GEN=$(gen_probe)
echo "  $BASELINE_GEN"
EXPECTED_GEN="rc=0|writes=same|net=0|forbiddenGit=0|subcommands=cat-file,ls-remote,rev-list,rev-parse,|carrier=269"
if [ "$BASELINE_GEN" != "$EXPECTED_GEN" ]; then
  echo "FATAL: the generator probe is not the expected read-only one"
  echo "       expected: $EXPECTED_GEN"
  exit 2
fi
echo
echo "── mutants ──────────────────────────────────────────────────────────────"

# $1 label, $2 expectation (catch); the python mutation program arrives on stdin.
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
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p249bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID   $label (no byte changed: the mutation is inert by construction)"
    GAPS=$((GAPS + 1)); FAILED_LABELS+=("INVALID: $label"); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"$WORK/mut_${N}.log" 2>&1; then
    local observed; observed=$(probe)
    if [ "$observed" != "$BASELINE_PROBE" ]; then
      echo "CAUGHT    $label (probe: observed $observed)"
      PASSED=$((PASSED + 1))
    else
      echo "SURVIVED  $label   <-- GUARD GAP"
      GAPS=$((GAPS + 1)); FAILED_LABELS+=("SURVIVED: $label")
    fi
  else
    # A suite failure is only a catch if it is the MUTATION that broke it. When the
    # remote cannot be read, three of the five focused suites fail on infrastructure
    # alone, and counting that as a catch would hide a real gap behind a dead token.
    # So the failure is classified before it is credited.
    if grep -qE "LiveRefSourceUnavailableError|could not read refs from remote|could not read Username for" "$WORK/mut_${N}.log"; then
      if remote_readable; then
        # The remote is fine, so the mutant itself broke the ref source: a catch.
        echo "CAUGHT    $label (a focused suite failed: the mutation broke the live-ref source, while the remote itself is readable)"
        PASSED=$((PASSED + 1))
      else
        echo "BLOCKED   $label   <-- UNVERIFIED: the remote was unreadable, so this is not a catch"
        INFRA=$((INFRA + 1)); BLOCKED_LABELS+=("$label")
      fi
    else
      echo "CAUGHT    $label (a focused suite failed)"
      PASSED=$((PASSED + 1))
    fi
  fi
  restore
}

# ════════════════════════════════════════════════════════════════════════════
# A — the measurement must be trusted before it is used
# ════════════════════════════════════════════════════════════════════════════

mutate "M01 accept a shallow measurement as if it could answer reachability" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  if (measurement.shallow) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M02 accept an absent inventory as an empty ref set" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  if (!measurement.present) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M03 accept an empty inventory as a clean result" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  if (measurement.refs.length === 0) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M04 skip the fingerprint identity check" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  if (measurement.fingerprint !== manifest.fingerprint) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M05 skip the required-blob-path check" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  for (const path of manifest.requiredBlobPaths) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  for (const path of []) {"))
PY

mutate "M06 report an untrustworthy measurement as trustworthy" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    measurement.present && !measurement.shallow && measurement.refs.length > 0,"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    true,"))
PY

mutate "M07 let the generator measure in a shallow clone" catch <<'PY'
import sys
p = "scripts/secret-ref-inventory.mjs"
s = open(p).read()
old = '    console.error("REFUSING — shallow clone. A per-ref scan needs real history.");\n    process.exit(2);'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = '    console.error("note: shallow clone, results may be incomplete.");'
open(p, "w").write(s.replace(old, new))
PY

# ════════════════════════════════════════════════════════════════════════════
# B — the ignore-new-ref family: a live ref nobody accounts for
# ════════════════════════════════════════════════════════════════════════════

mutate "M08 ignore a live ref the measurement never looked at" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  for (const ref of sorted(liveRefs)) {\n    if (!measuredByRef.has(ref)) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = "  for (const ref of sorted(liveRefs)) {\n    if (false) {"
open(p, "w").write(s.replace(old, new))
PY

mutate "M09 ignore a measured ref the remote no longer advertises" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (!live.has(entry.ref)) {\n      refuse(\n        \"MEASURED_REF_NOT_LIVE\","
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = "    if (false) {\n      refuse(\n        \"MEASURED_REF_NOT_LIVE\","
open(p, "w").write(s.replace(old, new))
PY

mutate "M10 hide the unaccounted refs instead of naming them" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = """  const unaccounted = liveRefs.filter(
    (ref) => !measuredByRef.has(ref) || !exposureByRef.has(ref) || !coverageRefs.has(ref),
  );"""
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  const unaccounted: string[] = [];"))
PY

mutate "M11 let the live-ref source fail open, reporting nothing to see" catch <<'PY'
import sys
p = "src/lib/deployment/live-refs.ts"
s = open(p).read()
old = "  throw new LiveRefSourceUnavailableError("
if s.count(old) < 1: sys.exit("anchor not found")
# Fail open at the first refusal site: an unreadable remote becomes an empty set.
s2 = s.replace(old, "  return [] as unknown as never; void new LiveRefSourceUnavailableError(", 1)
if s2 == s: sys.exit("mutation produced no change")
open(p, "w").write(s2)
PY

mutate "M12 count a peeled tag object as its own ref" catch <<'PY'
import sys
p = "src/lib/deployment/live-refs.ts"
s = open(p).read()
# Drop the peeled-object filter so rc-181^{} inflates the live-ref count.
old = '    if (ref.endsWith("^{}")) continue;'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, '    if (false) continue;'))
PY

mutate "M13 weaken branch-name normalization so refs/heads/x != heads/x" catch <<'PY'
import sys
p = "src/lib/deployment/runbook-ref-facts.ts"
s = open(p).read()
old = """    .replace(/^refs\\/heads\\//, "heads/")
    .replace(/^refs\\/tags\\//, "tags/");"""
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    ;"))
PY

# ════════════════════════════════════════════════════════════════════════════
# C — the canonical manifest: hardcode the old count, drop or invent a ref
# ════════════════════════════════════════════════════════════════════════════

mutate "M14 hardcode the old eight-ref scope by dropping the ninth row" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = '  { ref: "heads/arena/01a0b293-trade-intel-bot", carrierCommits: 0, exposedAtTip: false },\n'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, ""))
PY

mutate "M15 remove an existing affected ref from the canonical scope" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = '  { ref: "heads/arena/01a0a92b-trade-intel-bot", carrierCommits: 0, exposedAtTip: false },\n'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, ""))
PY

mutate "M16 add an unrelated ref to the canonical scope" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = '  { ref: "heads/main", carrierCommits: 0, exposedAtTip: false },'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = '  { ref: "heads/some-unrelated-branch", carrierCommits: 1, exposedAtTip: false },\n' + old
open(p, "w").write(s.replace(old, new))
PY

mutate "M17 declare the ninth ref unaffected while the measurement says otherwise" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = '  { ref: "heads/arena/01a0b293-trade-intel-bot", carrierCommits: 0, exposedAtTip: false },'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = '  { ref: "heads/arena/01a0b293-trade-intel-bot", carrierCommits: 269, exposedAtTip: false },'
open(p, "w").write(s.replace(old, new))
PY

mutate "M18 declare the ninth ref exposed at its tip when it is not" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = '  { ref: "heads/arena/01a0b293-trade-intel-bot", carrierCommits: 0, exposedAtTip: false },'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = '  { ref: "heads/arena/01a0b293-trade-intel-bot", carrierCommits: 0, exposedAtTip: true },'
open(p, "w").write(s.replace(old, new))
PY

mutate "M19 ignore a per-ref carrier disagreement with the manifest" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (measured.carrierCommits !== entry.carrierCommits) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M20 ignore a per-ref tip disagreement with the manifest" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (measured.exposedAtTip !== entry.exposedAtTip) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M21 ignore a changed carrier TOTAL, hiding that the exposure moved" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  if (manifest.carrierCommits !== measurement.carrierCommits) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M22 accept an unaffected ref listed for rewriting" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (!entry.affected && coverageRefs.has(entry.ref) && measuredAffected.length > 0) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M23 accept a manifest row for a ref the measurement never found" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = """    if (!measured) {
      refuse(
        "MANIFEST_EXTRA_REF","""
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = """    if (!measured) {
      continue;
      refuse(
        "MANIFEST_EXTRA_REF","""
open(p, "w").write(s.replace(old, new))
PY

mutate "M24 accept a manifest that omits a measured affected ref" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (!manifestRefs.has(ref)) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M25 accept a manifest that classifies an unaffected ref as affected" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (!measured.affected) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M26 move the canonical carrier total off the recorded exposure" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = "carrierCommits: 269,"
if s.count(old) < 1: sys.exit("anchor not found")
open(p, "w").write(s.replace(old, "carrierCommits: 271,", 1))
PY

mutate "M27 rewrite the reconciliation back to the superseded eight-ref count" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = '    authoritative: "9 (docs/secret-remediation-refs.json)",'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, '    authoritative: "8 (docs/secret-remediation-refs.json)",'))
PY

mutate "M28 rewrite the reachable-commit count back to the superseded 398" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = '    authoritative: "840 (docs/secret-remediation-refs.json, generator-produced on a full github.com mirror after the writable rewrite)",'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, '    authoritative: "398 (docs/secret-remediation-refs.json, generator-produced)",'))
PY

mutate "M29 repoint the canonical rewrite branch at main" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = 'expectedBranch: "arena/01a0adfb-trade-intel-bot"'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, 'expectedBranch: "main"'))
PY

mutate "M30 permit main as a rewrite target" catch <<'PY'
import sys
p = "src/lib/deployment/remediation-manifest.ts"
s = open(p).read()
old = 'forbiddenBranches: ["main"]'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, 'forbiddenBranches: []'))
PY

# ════════════════════════════════════════════════════════════════════════════
# D — the runbook's claims
# ════════════════════════════════════════════════════════════════════════════

mutate "M31 drop the ninth ref from the runbook's exposure table" catch <<'PY'
import sys
p = "docs/SECRET-REMEDIATION-RUNBOOK.md"
s = open(p).read()
old = "| `refs/heads/arena/01a0b293-trade-intel-bot` | **clean** | 0 |\n"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, ""))
PY

mutate "M32 drop the ninth ref from the rewrite coverage table" catch <<'PY'
import sys
p = "docs/SECRET-REMEDIATION-RUNBOOK.md"
s = open(p).read()
old = "| `heads/arena/01a0b293-trade-intel-bot` | *added Phase 249* | *not rehearsed* |\n"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, ""))
PY

mutate "M33 hardcode the old declared count: All nine -> All eight" catch <<'PY'
import sys
p = "docs/SECRET-REMEDIATION-RUNBOOK.md"
s = open(p).read()
old = "**All nine** — every ref the remote advertises"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "**All eight** — every ref the remote advertises"))
PY

mutate "M34 stop stating a count the summary can be checked against" catch <<'PY'
import sys
p = "docs/SECRET-REMEDIATION-RUNBOOK.md"
s = open(p).read()
old = "**All nine** — every ref"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "Every ref"))
PY

mutate "M35 record the ninth ref as unaffected in the exposure table" catch <<'PY'
import sys
p = "docs/SECRET-REMEDIATION-RUNBOOK.md"
s = open(p).read()
old = "| `refs/heads/arena/01a0b293-trade-intel-bot` | **clean** | 0 |"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "| `refs/heads/arena/01a0b293-trade-intel-bot` | **clean** | 269 |"))
PY

mutate "M36 treat tip-cleanliness as sufficient by relabeling main as clean" catch <<'PY'
import sys
p = "docs/SECRET-REMEDIATION-RUNBOOK.md"
s = open(p).read()
old = "| `refs/heads/main` | **clean** | 0 |"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "| `refs/heads/main` | **EXPOSED AT TIP** | 0 |"))
PY

mutate "M37 let one ref satisfy two rows of the exposure table" catch <<'PY'
import sys
p = "docs/SECRET-REMEDIATION-RUNBOOK.md"
s = open(p).read()
old = "| `refs/heads/arena/01a0b293-trade-intel-bot` | **clean** | 0 |\n"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, old + old))
PY

mutate "M38 weaken the declared-count parser so any number passes" catch <<'PY'
import sys
p = "src/lib/deployment/runbook-ref-facts.ts"
s = open(p).read()
old = """  const match = block.match(/\\*\\*All ([a-z]+)\\*\\*/i);
  if (!match) return null;
  const idx = NUMBER_WORDS.indexOf(match[1].toLowerCase());
  return idx === -1 ? null : idx;"""
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = """  const match = block.match(/\\*\\*All ([a-z]+)\\*\\*/i);
  if (!match) return null;
  return NUMBER_WORDS.length;"""
open(p, "w").write(s.replace(old, new))
PY

mutate "M39 let the tip-status rule never see an exposed tip" catch <<'PY'
import sys
p = "src/lib/deployment/runbook-ref-facts.ts"
s = open(p).read()
old = "  return /EXPOSED AT TIP/i.test(row.tipStatus);"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  return false;"))
PY

mutate "M40 let a duplicated row pass as one ref" catch <<'PY'
import sys
p = "src/lib/deployment/runbook-ref-facts.ts"
s = open(p).read()
old = "  return [...seen.entries()].filter(([, n]) => n > 1).map(([r]) => r);"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  return [];"))
PY

mutate "M41 bypass the Phase 221/233 consistency guard entirely" catch <<'PY'
import sys
p = "src/lib/deployment/runbook-ref-facts.ts"
s = open(p).read()
import re
m = re.search(r"export function refConsistencyProblems\(", s)
if not m: sys.exit("refConsistencyProblems not found")
# Return no problems before any check runs: the guard would report agreement always.
tail = s[m.end():]
brace = tail.index("{")
open(p, "w").write(s[: m.end() + brace + 1] + "\n  return [];\n  // eslint-disable-next-line no-unreachable" + tail[brace + 1:])
PY

mutate "M42 ignore a runbook row naming a ref the remote no longer has" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  for (const row of runbook.exposure) {\n    if (!live.has(row.ref)) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  for (const row of runbook.exposure) {\n    if (false) {"))
PY

mutate "M73 ignore a dead ref named only in the rewrite coverage table" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  for (const row of runbook.coverage) {\n    if (!live.has(row.ref)) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  for (const row of runbook.coverage) {\n    if (false) {"))
PY

mutate "M43 ignore a missing exposure row for a live ref" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (!exposureByRef.has(ref)) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M44 ignore a missing rewrite-coverage row for an affected ref" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (mustCover && !coverageRefs.has(ref)) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M45 ignore a runbook tip status that contradicts the measurement" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (entry.exposedAtTip !== tipStatusSaysExposed(row.tipStatus)) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M46 ignore a runbook occurrence count that contradicts the measurement" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    if (entry.affected !== claimsAffected) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    if (false) {"))
PY

mutate "M47 ignore a duplicated runbook row" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  for (const dup of duplicates(runbook.exposure.map((row) => row.ref))) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  for (const dup of []) {"))
PY

mutate "M48 ignore a declared count that no longer matches the remote" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  } else if (runbook.declaredCount !== liveRefs.length) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  } else if (false) {"))
PY

mutate "M49 accept a runbook that stopped stating its count" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  if (runbook.declaredCount === null) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  if (false) {"))
PY

# ════════════════════════════════════════════════════════════════════════════
# E — the measured artefact itself
# ════════════════════════════════════════════════════════════════════════════

mutate "M50 delete the ninth ref from the measured inventory" catch <<'PY'
import sys, json
p = "docs/secret-remediation-refs.json"
d = json.load(open(p, encoding="utf-8"))
before = len(d["refs"])
d["refs"] = [r for r in d["refs"] if r["ref"] != "heads/arena/01a0b293-trade-intel-bot"]
if len(d["refs"]) == before: sys.exit("the ninth ref was not in the artefact")
open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2) + "\n")
PY

mutate "M51 record the ninth ref as unaffected in the measured inventory" catch <<'PY'
import sys, json
p = "docs/secret-remediation-refs.json"
d = json.load(open(p, encoding="utf-8"))
hit = False
for r in d["refs"]:
    if r["ref"] == "heads/arena/01a0b293-trade-intel-bot":
        r["affected"] = True; r["carrierCommits"] = 269; hit = True
if not hit: sys.exit("the ninth ref was not in the artefact")
open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2) + "\n")
PY

mutate "M52 accept an incomplete inventory: empty the measured refs" catch <<'PY'
import sys, json
p = "docs/secret-remediation-refs.json"
d = json.load(open(p, encoding="utf-8"))
if not d["refs"]: sys.exit("already empty")
d["refs"] = []
open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2) + "\n")
PY

mutate "M53 move the carrier total in the artefact off the recorded exposure" catch <<'PY'
import sys, json
p = "docs/secret-remediation-refs.json"
d = json.load(open(p, encoding="utf-8"))
if d.get("carrierCommits") != 269: sys.exit("unexpected carrier total")
d["carrierCommits"] = 271
open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2) + "\n")
PY

mutate "M54 attribute the artefact to something other than the generator" catch <<'PY'
import sys, json
p = "docs/secret-remediation-refs.json"
d = json.load(open(p, encoding="utf-8"))
d["generatedBy"] = "hand-edited"
open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2) + "\n")
PY

mutate "M55 change the artefact fingerprint to a different exposure" catch <<'PY'
import sys, json
p = "docs/secret-remediation-refs.json"
d = json.load(open(p, encoding="utf-8"))
d["fingerprint"] = "deadbeefdeadbeef"
open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2) + "\n")
PY

# ════════════════════════════════════════════════════════════════════════════
# F — reconciliation must never become remediation
# ════════════════════════════════════════════════════════════════════════════

mutate "M56 mark A2 VERIFIED because the inventory is now complete" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    a2Verified: false,\n    measurementTrustworthy,"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    a2Verified: true as unknown as false,\n    measurementTrustworthy,"))
PY

mutate "M57 report remediation performed after a reconciliation" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    remediationPerformed: false,\n    rewriteExecuted: false,"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    remediationPerformed: true as unknown as false,\n    rewriteExecuted: false,"))
PY

mutate "M58 report the rewrite as executed when only the scope was agreed" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "    remediationPerformed: false,\n    rewriteExecuted: false,"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    remediationPerformed: false,\n    rewriteExecuted: true as unknown as false,"))
PY

mutate "M59 call any reconciliation successful regardless of refusals" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = '    reconciled: state === "ROLLOVER_RECONCILED",'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "    reconciled: true,"))
PY

mutate "M60 drop the 'not a finished one' wording from the operator report" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = '    "  A reconciled inventory is a correctly scoped job, not a finished one: every ref " +'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = '    "  A reconciled inventory is a correctly scoped job. every ref " +'
open(p, "w").write(s.replace(old, new))
PY

# ════════════════════════════════════════════════════════════════════════════
# G — worst-state ordering, closed code map, determinism
# ════════════════════════════════════════════════════════════════════════════

mutate "M61 report the best state instead of the worst when layers drift" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  for (const state of ROLLOVER_STATE_PRECEDENCE) {"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = "  for (const state of [...ROLLOVER_STATE_PRECEDENCE].reverse()) {"
open(p, "w").write(s.replace(old, new))
PY

mutate "M62 rank a stale ref worse than an unmeasured live ref" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = '  "INVENTORY_INCOMPLETE",\n  "INVENTORY_STALE",'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, '  "INVENTORY_STALE",\n  "INVENTORY_INCOMPLETE",'))
PY

mutate "M63 let an unmapped refusal code summarise as reconciled" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
# The fallback lives in the exported seam, so the seam is what gets inverted.
old = 'return ROLLOVER_CODE_STATES[code as RolloverRefusalCode] ?? "MEASUREMENT_UNUSABLE";'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, 'return ROLLOVER_CODE_STATES[code as RolloverRefusalCode] ?? "ROLLOVER_RECONCILED";'))
PY

mutate "M64 hide the growth: report no refs added by the rollover" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  return sorted(liveRefs.filter((ref) => !prior.has(ref)));"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, "  return [];"))
PY

mutate "M65 make the scope digest insensitive to the refs it summarises" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = '  const text = JSON.stringify({ refs: sorted(affectedRefs), carrierCommits });'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
open(p, "w").write(s.replace(old, '  const text = JSON.stringify({ refs: [], carrierCommits });'))
PY

mutate "M66 report the affected set as the manifest's list rather than the measurement" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "  const measuredAffected = measurement.refs.filter((entry) => entry.affected).map((e) => e.ref);"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = "  const measuredAffected = manifest.refs.map((entry) => entry.ref);"
open(p, "w").write(s.replace(old, new))
PY

# ════════════════════════════════════════════════════════════════════════════
# H — the measurement path must stay read-only
#    (inert source tokens: the suites SCAN the generator, they never run it, so
#     no mutant here can reach the remote)
# ════════════════════════════════════════════════════════════════════════════

mutate "M67 permit a Git write in the measurement tooling" catch <<'PY'
import sys
p = "scripts/secret-ref-inventory.mjs"
s = open(p).read()
old = "import { existsSync, writeFileSync } from \"node:fs\";"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = old + "\n// allowed write subcommands: \"push\", \"update-ref\""
open(p, "w").write(s.replace(old, new))
PY

mutate "M68 permit a force-push from the measurement tooling" catch <<'PY'
import sys
p = "scripts/secret-ref-inventory.mjs"
s = open(p).read()
old = "import { existsSync, writeFileSync } from \"node:fs\";"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = old + "\nconst REMOTE_UPDATE = [\"push\", \"--force-with-lease\"];"
open(p, "w").write(s.replace(old, new))
PY

mutate "M69 permit a history rewrite from the measurement tooling" catch <<'PY'
import sys
p = "scripts/secret-ref-inventory.mjs"
s = open(p).read()
old = "import { existsSync, writeFileSync } from \"node:fs\";"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = old + "\nconst REWRITE_TOOL = \"filter-repo\";"
open(p, "w").write(s.replace(old, new))
PY

mutate "M70 let the tooling write a second file besides the inventory" catch <<'PY'
import sys
p = "scripts/secret-ref-inventory.mjs"
s = open(p).read()
old = "writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\\n`);"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = old + "\nwriteFileSync(`${OUT}.bak`, \"\");"
open(p, "w").write(s.replace(old, new))
PY

mutate "M71 let the decision module spawn a process" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = 'import { duplicateRefs, isMarkedExposedAtTip } from "./runbook-ref-facts";'
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = 'import { execSync } from "node:child_process";\n' + old + "\nvoid execSync;"
open(p, "w").write(s.replace(old, new))
PY

mutate "M72 let the decision module read the clock" catch <<'PY'
import sys
p = "src/lib/deployment/ref-rollover-reconciliation.ts"
s = open(p).read()
old = "const sorted = (values: readonly string[]): string[] => [...values].sort();"
if s.count(old) != 1: sys.exit("anchor not found exactly once")
new = "const sorted = (values: readonly string[]): string[] => [...values].sort();\nvoid Date.now;"
open(p, "w").write(s.replace(old, new))
PY

echo
echo "mutants CAUGHT: $PASSED; gaps: $GAPS; unverified (infrastructure): $INFRA"
echo
echo "── restore ──────────────────────────────────────────────────────────────"
restore
for f in "${TARGETS[@]}"; do
  if cmp -s "$f" "$f.p249bak"; then echo "byte-exact: $f"; else echo "FATAL: $f is NOT restored"; exit 3; fi
done

echo
echo "── post-restore re-measurement ──────────────────────────────────────────"
AFTER_PROBE=$(probe)
if [ "$AFTER_PROBE" = "$BASELINE_PROBE" ]; then
  echo "probe unchanged after restore: $AFTER_PROBE"
elif [ "${AFTER_PROBE%%|*}" = "LIVE_REF_SOURCE_UNAVAILABLE" ]; then
  INFRA=1
  echo "INFRASTRUCTURE: the remote could not be read after restore, so the probe could"
  echo "  not re-measure. This is NOT a restore defect: byte-exact restore was already"
  echo "  verified with cmp for every target above, and the probe reported the failure"
  echo "  identity instead of substituting an empty ref set. Re-run to confirm."
else
  echo "FATAL: the probe moved after restore"
  echo "  baseline: $BASELINE_PROBE"
  echo "  after:    $AFTER_PROBE"
  exit 3
fi
AFTER_GEN=$(gen_probe)
echo "generator probe after restore: $AFTER_GEN"
if [ "$AFTER_GEN" = "$BASELINE_GEN" ]; then
  echo "generator probe unchanged after restore"
elif printf '%s' "$AFTER_GEN" | grep -q "subcommands=|carrier=$"; then
  INFRA=1
  echo "INFRASTRUCTURE: the generator could not read the remote after restore, so it"
  echo "  produced no measurement. Not a restore defect; re-run to confirm."
else
  echo "FATAL: the generator probe moved after restore"
  echo "  baseline: $BASELINE_GEN"
  exit 3
fi

if [ "$GAPS" -ne 0 ]; then
  printf 'FAILED: %s\n' "${FAILED_LABELS[@]}"
  exit 1
fi
if [ "$INFRA" -ne 0 ]; then
  echo
  echo "INCOMPLETE: $INFRA mutant(s) could not be measured because the remote was"
  echo "unreadable, and $PASSED were caught. A catch credited to a dead token is not a"
  echo "catch, so this run does NOT establish that every mutant is observable."
  if [ "${#BLOCKED_LABELS[@]}" -gt 0 ]; then
    printf 'UNVERIFIED: %s\n' "${BLOCKED_LABELS[@]}"
  fi
  echo "Re-run once \`git ls-remote origin\` works; the tree was restored byte-exact."
  exit 4
fi
echo
echo "ALL MUTANTS OBSERVABLE — 0 gaps, 0 invalid, tree restored byte-exact, re-measured"
exit 0
