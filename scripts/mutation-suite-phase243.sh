#!/usr/bin/env bash
#
# Phase 243 — mutation suite: can production configuration be ACCEPTED wrongly?
#
# WHAT IT ANSWERS
# Phase 241's suite asked whether the release verdict can be made to say READY
# wrongly; Phase 242's asked whether a release can be ADMITTED without being
# verified. This one asks the configuration question: can the boundary be made to
# accept a configuration it must refuse — a missing variable, a malformed value, a
# development deployment, a wrong identity, a fixture credential, a console or mock
# email transport, a retired issuer, a cross-provider key, a presence-as-proof
# claim — and can the operator checker be turned into something that deploys,
# connects, exits 0 regardless or prints a credential.
#
# TWO OBSERVABLES
#   * the focused suites (`FOCUS`) — behaviour of the boundary and its guards;
#   * the OPERATOR PROBE — the real script, run as an operator runs it, against a
#     fixture that must be refused. A mutant that makes the checker accept a
#     refusing configuration has changed the one thing a suite could have been
#     written to expect: exit 1 becomes exit 0.
#
# METHOD
# Mutations are python3 heredocs (quoted, so the shell expands nothing); each one
# asserts that its anchor occurs exactly once, so a mutation that matches nothing
# is reported INVALID rather than silently counted as caught.
#
# SAFETY
# Baseline first, probe included: with a failing suite — or a probe that already
# accepts — every mutant would read as CAUGHT, which is the false confidence this
# suite exists to remove. Restore is byte-exact via `cmp`, under `trap`. Fixtures
# live in /tmp and contain synthetic values only: no credential in this repository
# or on this machine is read, and no mutant deploys anything or contacts anything.
# The one mutant that adds a network call points at a loopback discard port, and
# the one that adds a process runner executes a local no-op `node -e 0`.
set -uo pipefail
cd "$(dirname "$0")/.."

MODULE="src/lib/deployment/production-config.ts"
CHECKER="scripts/verify-production-config.mjs"
SUITE="src/lib/deployment/production-config.phase243.test.ts"
CHECKER_SUITE="src/lib/deployment/operator-checker.phase243.test.ts"
HYGIENE_SUITE="src/lib/deployment/production-config-hygiene.phase243.test.ts"
ENV_POLICY="src/convex/lib/deploymentEnvironment.ts"
EMAIL_POLICY="src/convex/lib/emailDelivery.ts"
GATE="src/lib/deployment/release-gate.ts"
ADMISSION="src/lib/deployment/release-admission.ts"

TARGETS=(
  "$MODULE"
  "$CHECKER"
  "$SUITE"
  "$CHECKER_SUITE"
  "$ENV_POLICY"
  "$EMAIL_POLICY"
  "$GATE"
  "$ADMISSION"
)

# Backups are taken by `arm_backups`, AFTER the baseline gate: a suite that fails
# before any mutation must not leave scratch copies of source files lying around.
arm_backups() {
  for f in "${TARGETS[@]}"; do cp "$f" "$f.p243bak"; done
}

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p243bak" "$f"
    cmp -s "$f" "$f.p243bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}

cleanup() {
  for f in "${TARGETS[@]}"; do
    if [ -f "$f.p243bak" ]; then cp "$f.p243bak" "$f"; rm -f "$f.p243bak"; fi
  done
}
trap cleanup EXIT

FOCUS=(
  "$SUITE"
  "$CHECKER_SUITE"
  "$HYGIENE_SUITE"
)

FIXDIR=/tmp/p243-fixtures

# Synthetic configuration fixtures. Every credential value is short and fake.
build_fixtures() {
  rm -rf "$FIXDIR"; mkdir -p "$FIXDIR"
  python3 - <<'PY'
import json, os
d = "/tmp/p243-fixtures"
base = {
    "XSTARZ_DEPLOYMENT_ENV": "production",
    "CONVEX_SITE_URL": "https://xstarz-prod.convex.site",
    "VITE_CONVEX_URL": "https://xstarz-prod.convex.cloud",
    "CONVEX_DEPLOYMENT": "prod:xstarz-team:xstarz-prod",
    "XSTARZ_EMAIL_TRANSPORT": "resend",
    "XSTARZ_EMAIL_API_KEY": "e243-5a7c9e1b3d5f7a9c",
    "XSTARZ_EMAIL_SENDER_ADDRESS": "no-reply@xstarz.example",
    "TWELVE_DATA_API_KEY": "td-243",
    "ALPHA_VANTAGE_API_KEY": "av-243",
    "COINGLASS_API_KEY": "cg-243",
    "TICKATLAS_API_KEY": "ta-243",
    "EIA_API_KEY": "eia-243",
}
def write(name, config):
    open(os.path.join(d, name + ".json"), "w").write(json.dumps(config, indent=2) + "\n")

write("complete", base)
missing = {k: v for k, v in base.items() if k != "CONVEX_DEPLOYMENT"}
write("missing", missing)
write("urlbad", {**base, "CONVEX_SITE_URL": "not-a-url"})
write("dev", {**base, "XSTARZ_DEPLOYMENT_ENV": "development"})
write("identity", {**base, "CONVEX_DEPLOYMENT": "anonymous:xstarz-team:local-dev"})
write("fixturekey", {**base, "XSTARZ_EMAIL_API_KEY": "test-243"})
write("console", {**base, "XSTARZ_EMAIL_TRANSPORT": "console"})
write("mock", {**base, "XSTARZ_EMAIL_TRANSPORT": "mock"})
write("freebuff", {**base, "VLY_CONVEX_AUTH_ISSUER": "https://auth.freebuff.app/api/auth"})
write("sender", {**base, "XSTARZ_EMAIL_SENDER_ADDRESS": "no-reply@auth.freebuff.app"})
write("shared", {**base, "ALPHA_VANTAGE_API_KEY": "td-243"})
write("verified", base)
open(os.path.join(d, "broken.json"), "w").write("{ this is not json\n")
PY
}

# Fixture -> the exit code the checker must produce for it. `verified` is the
# complete configuration run with `--require-verified`, which must never verify.
expected_exit() {
  case "$1" in
    complete) echo 0 ;;
    *) echo 1 ;;
  esac
}

# $1 fixture name; prints the observed exit code, leaves the outcome in PROBE_OUTCOME.
run_probe() {
  local fixture="$1"
  local -a extra=()
  [ "$fixture" = "verified" ] && extra=(--require-verified)
  node --experimental-strip-types --no-warnings "$CHECKER" \
    --config "$FIXDIR/$fixture.json" ${extra[@]+"${extra[@]}"} >/tmp/p243_probe.out 2>&1
  local code=$?
  PROBE_OUTCOME=$(sed -n 's/^outcome: //p' /tmp/p243_probe.out | head -1)
  echo "$code"
}

PASSED=0; EQUIV=0; GAPS=0; N=0

# $1 label, $2 expectation (catch|survive), $3 probe fixture; the python program
# arrives on stdin.
mutate() {
  local label="$1"; shift
  local expect="$1"; shift
  local fixture="$1"; shift
  local program
  program=$(cat)

  N=$((N+1))
  printf '%s' "$program" > "/tmp/p243_${N}.py"

  if ! python3 "/tmp/p243_${N}.py"; then
    echo "INVALID  $label (mutation failed to apply — proves nothing)"
    GAPS=$((GAPS+1)); restore; return
  fi

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p243bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    GAPS=$((GAPS+1)); restore; return
  fi

  if npx vitest run "${FOCUS[@]}" >"/tmp/p243_${N}.log" 2>&1; then
    # The suites are happy. Ask the operator tool itself: is the configuration it
    # must refuse still refused?
    local want; want=$(expected_exit "$fixture")
    local got; got=$(run_probe "$fixture")
    if [ "$got" != "$want" ]; then
      echo "CAUGHT   $label (probe: $fixture expected exit $want, observed $got ${PROBE_OUTCOME:+[$PROBE_OUTCOME]})"
      PASSED=$((PASSED+1))
    elif [ "$expect" = "survive" ]; then
      echo "EQUIVALENT  $label (documented as unobservable: refused before and after)"
      EQUIV=$((EQUIV+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP (probe still exits $got)"
      GAPS=$((GAPS+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- the guards flag a change documented as unobservable"
      GAPS=$((GAPS+1))
    else
      echo "CAUGHT   $label"
      PASSED=$((PASSED+1))
    fi
  fi

  restore
}

echo "── baseline ─────────────────────────────────────────────────────────────"
build_fixtures
if ! npx vitest run "${FOCUS[@]}" >/tmp/p243_baseline.log 2>&1; then
  echo "BASELINE FAILED: a focused suite is red before any mutation — fix that first."
  tail -20 /tmp/p243_baseline.log
  exit 2
fi
echo "focused suites: green"

for fixture in complete missing urlbad broken dev identity fixturekey console mock freebuff sender shared verified; do
  want=$(expected_exit "$fixture")
  got=$(run_probe "$fixture")
  if [ "$got" != "$want" ]; then
    echo "BASELINE FAILED: probe $fixture expected exit $want, observed $got ${PROBE_OUTCOME:+[$PROBE_OUTCOME]}"
    exit 2
  fi
done
echo "operator probe: refuses every refusing fixture, accepts the complete one"
echo
echo "── mutants ──────────────────────────────────────────────────────────────"

arm_backups

# ── missing and malformed ──────────────────────────────────────────────────
mutate "M1 a missing required variable is not recorded" catch missing <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = "      if (entry.requiredInProduction) missing.push(entry.name);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      if (false && entry.requiredInProduction) missing.push(entry.name);"))
PY

mutate "M2 a malformed https URL is accepted" catch urlbad <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """    if (entry.shape === "https-url") {
      const problem = urlProblem(value);
      if (problem) problems.push({ name: entry.name, problem });"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """    if (entry.shape === "https-url") {
      const problem = urlProblem(value);
      if (false && problem) problems.push({ name: entry.name, problem });"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M3 zero-length values count as present" catch missing <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """const present = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """const present = (value: string | undefined): boolean =>
  typeof value === "string";"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M4 a file that is not valid JSON is evaluated as an empty configuration" catch broken <<'PY'
import sys
P = "scripts/verify-production-config.mjs"
s = open(P).read()
old = "const finalReport = parseFailure"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "const finalReport = false"))
PY

# ── environment and identity ───────────────────────────────────────────────
mutate "M5 a development deployment is evaluated as production" catch dev <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = '  } else if (environmentFailure !== null || (resolved !== null && resolved !== "production")) {'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  } else if (false) {"))
PY

mutate "M6 the environment policy resolves every known value to production" catch dev <<'PY'
import sys
P = "src/convex/lib/deploymentEnvironment.ts"
s = open(P).read()
old = """  if (value === "production" || value === "preview" || value === "development") {
    return value;
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  if (value === "production" || value === "preview" || value === "development") {
    return "production";
  }"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M7 a non-production deployment identity is reported as production-shaped" catch identity <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """    productionShaped:
      declaredDeployment !== null && deploymentIdentityProblem(declaredDeployment) === null,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "    productionShaped: declaredDeployment !== null,"))
PY

mutate "M8 an identity problem is downgraded to a generic invalid value" catch identity <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = '    outcome = identityOnly ? "WRONG_IDENTITY" : "INVALID_CONFIG";'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '    outcome = "INVALID_CONFIG";'))
PY

# ── fixtures, placeholders and unexpected variables ────────────────────────
mutate "M9 fixture and placeholder values are accepted" catch fixturekey <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """  for (const { pattern, problem } of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) return problem;
  }"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  for (const { pattern, problem } of PLACEHOLDER_PATTERNS) {
    if (false && pattern.test(trimmed)) return problem;
  }"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M10 an unexpected production-shaped variable is silently dropped" catch complete <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = "    if (PRODUCTION_SHAPED.test(name)) unexpected.push(name);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "    void name;"))
PY

mutate "M11 a placeholder provider key still enables the provider" catch missing <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = '      return placeholderProblem((raw ?? "").trim()) !== null;'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      return false;"))
PY

# ── the email boundary ─────────────────────────────────────────────────────
mutate "M12 the console transport is accepted for production" catch console <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = "  if (nonDelivering || locallyScoped) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M13 the console transport is treated as a delivering transport by the policy" survive console <<'PY'
import sys
P = "src/convex/lib/emailDelivery.ts"
s = open(P).read()
old = """  if (transport === "console") {
    if (isProductionDeployment(env)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  if (transport === "console") {
    if (false && isProductionDeployment(env)) {"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M14 the console transport is accepted by BOTH layers (one rule removed twice)" catch console <<'PY'
import sys
P = "src/convex/lib/emailDelivery.ts"
s = open(P).read()
old = """  if (transport === "console") {
    if (isProductionDeployment(env)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """  if (transport === "console") {
    if (false && isProductionDeployment(env)) {"""))

P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = "  if (nonDelivering || locallyScoped) {"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  if (false) {"))
PY

mutate "M15 a mock transport is accepted end-to-end" catch mock <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """      const known = ["resend", "smtp2go", ...NON_DELIVERING_TRANSPORTS];
      if (!known.includes(value as never)) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      const known = ["resend", "smtp2go", "console", "mock"];
      if (false) {"""
open(P, "w").write(s.replace(old, new))

P = "src/convex/lib/emailDelivery.ts"
s = open(P).read()
old = '  return value === "resend" || value === "smtp2go" || value === "console";'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, '  return value === "resend" || value === "smtp2go" || value === "console" || value === "mock";'))
PY

mutate "M16 a retired Freebuff/VLY issuer is accepted" catch freebuff <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
for old, new in [
    ("    if (entry.forbiddenInProduction) {", "    if (false) {"),
    ("  return retired ? `uses a retired issuer host (${RETIRED_ISSUER_HOSTS.join(\", \")})` : null;", "  return null;"),
]:
    if s.count(old) != 1:
        sys.exit("anchor not found exactly once: " + old)
    s = s.replace(old, new)
old = """    const decision = resolveFederatedIssuer(readEnv);
    if (decision.federated) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, """    const decision = resolveFederatedIssuer(readEnv);
    if (false && decision.federated) {""")
open(P, "w").write(s)
PY

mutate "M17 a sender on a retired third-party domain is accepted by BOTH layers" catch sender <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """  const senderHostForbidden =
    declaredSenderHost !== null &&
    FORBIDDEN_DELIVERY_HOSTS.some(
      (host) => declaredSenderHost === host || declaredSenderHost.endsWith(`.${host}`),
    );"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, "  const senderHostForbidden = false;")
open(P, "w").write(s)

P = "src/convex/lib/emailDelivery.ts"
s = open(P).read()
old = """  const senderHost = senderAddress.split("@")[1]?.toLowerCase() ?? "";
  if (FORBIDDEN_DELIVERY_HOSTS.some((host) => senderHost === host || senderHost.endsWith(`.${host}`))) {"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """  const senderHost = senderAddress.split("@")[1]?.toLowerCase() ?? "";
  if (false) {"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M18 a retired sender host loses its attribution" catch sender <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = "      senderHost: senderHostForbidden ? declaredSenderHost : null,"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "      senderHost: null,"))
PY

mutate "M19 the checker ignores --require-verified" catch verified <<'PY'
import sys
P = "scripts/verify-production-config.mjs"
s = open(P).read()
old = "const evaluated = evaluateProductionConfiguration({ env, target, requireVerified });"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "const evaluated = evaluateProductionConfiguration({ env, target, requireVerified: false });"))
PY

# ── the provider boundary ──────────────────────────────────────────────────
mutate "M20 one provider's key may satisfy another provider" catch shared <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """    problems.push({
      name: provider.requiredEnvVarNames.join(", "),
      problem: `uses the same credential value as provider "${other}"; provider keys are provider-specific`,
    });"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "    void other;"))
PY

mutate "M21 a shared credential is attributed to one provider only" catch shared <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """      sharedGroups.set(requirement.providerId, sharedCredentialWith);
      if (!sharedGroups.has(sharedCredentialWith)) sharedGroups.set(sharedCredentialWith, requirement.providerId);"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      sharedGroups.set(requirement.providerId, sharedCredentialWith);"""
open(P, "w").write(s.replace(old, new))
PY

# ── presence, verification and the release gate ────────────────────────────
mutate "M22 configuration presence is reported as production verification" catch complete <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = """    productionVerified: false,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, """    productionVerified: true as unknown as false,"""))
PY

mutate "M23 credential material enters the diagnostics" catch complete <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = "  const say = (line: string) => diagnostics.push(redactSecrets(line, secretValues));"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, "  const say = (line: string) => diagnostics.push(line);")
old = '''    say(`email transport: ${config.transport}${nonDelivering ? " (delivers nothing)" : ""}`);'''
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, '''    say(`email transport: ${config.transport} key ${config.apiKey}`);''')
open(P, "w").write(s)
PY

mutate "M24 the JSON report carries the raw configuration" catch complete <<'PY'
import sys
P = "scripts/verify-production-config.mjs"
s = open(P).read()
old = "  process.stdout.write(productionConfigJson(finalReport));"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  process.stdout.write(JSON.stringify({ ...finalReport, config: env }, null, 2));"))
PY

mutate "M25 the release verdict counts documentation as verification" catch complete <<'PY'
import sys
P = "src/lib/deployment/release-gate.ts"
s = open(P).read()
old = 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification"];'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, 'const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification", "documentation"];'))
PY

mutate "M26 release admission is forced to admit" catch complete <<'PY'
import sys
P = "src/lib/deployment/release-admission.ts"
s = open(P).read()
old = """      admitted,
      verdict: state.verdict.verdict,"""
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """      admitted: true,
      verdict: state.verdict.verdict,"""
open(P, "w").write(s.replace(old, new))
PY

# ── the checker as a tool: exit codes, network, process ────────────────────
mutate "M27 the checker exits 0 whatever it found" catch console <<'PY'
import sys
P = "scripts/verify-production-config.mjs"
s = open(P).read()
old = "process.exit(finalReport.configurationAccepted ? 0 : 1);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "process.exit(0);"))
PY

mutate "M28 the checker opens a network connection" catch complete <<'PY'
import sys
P = "scripts/verify-production-config.mjs"
s = open(P).read()
old = 'const requireVerified = argv.includes("--require-verified");'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = """try { await fetch("http://127.0.0.1:9/"); } catch { /* discard port, loopback only */ }
const requireVerified = argv.includes("--require-verified");"""
open(P, "w").write(s.replace(old, new))
PY

mutate "M29 the checker can run a process (the capability a deploy needs)" catch complete <<'PY'
import sys
P = "scripts/verify-production-config.mjs"
s = open(P).read()
old = 'import { readFileSync } from "node:fs";'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, 'import { readFileSync } from "node:fs";\nimport { execFileSync as runStep } from "node:child_process";')
old = "const argv = process.argv.slice(2);"
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
s = s.replace(old, 'runStep(process.execPath, ["-e", "0"]); // local no-op, never a deploy\nconst argv = process.argv.slice(2);')
open(P, "w").write(s)
PY

# ── documented equivalents: changes with no decision to observe ────────────
mutate "E1 a diagnostic sentence is reworded (prose, no decision)" survive complete <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = '      ? `${DEPLOYMENT_ENV_VAR} resolves to production (absent means production)`'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
new = '      ? `${DEPLOYMENT_ENV_VAR} resolves to production`'
open(P, "w").write(s.replace(old, new))
PY

mutate "E2 the no-transport diagnostic loses its production guard (prose only)" survive complete <<'PY'
import sys
P = "src/lib/deployment/production-config.ts"
s = open(P).read()
old = '  if (email.transport === null && resolved === "production") {'
if s.count(old) != 1:
    sys.exit("anchor not found exactly once")
open(P, "w").write(s.replace(old, "  if (email.transport === null) {"))
PY

echo
echo "mutants CAUGHT: $PASSED; equivalent (documented): $EQUIV; gaps: $GAPS"
echo
echo "── tree ─────────────────────────────────────────────────────────────────"
for f in "${TARGETS[@]}"; do
  cmp -s "$f" "$f.p243bak" || echo "DIRTY: $f differs from its snapshot"
done
echo "restored byte-exact: ${#TARGETS[@]} files"
