# Evidence D — authenticated behaviour against a real deployment

Evidence D is the set of ten observations that prove the backend behaves
correctly for a real, signed-in user against a real deployment. It is the one
gate that cannot be satisfied by unit tests: every other suite in this
repository runs against the code, and Evidence D runs against the deployment.

Run it with:

```
npm run evidence:d
```

No source edit is required between runs.

---

## What the command does

`scripts/evidence-d-harness.mjs` derives its target from your environment,
refuses to run against anything that is not a real Convex deployment, performs
the ten observations over HTTP, and prints a machine-readable report.

It has no fixture path, no mock mode, no replay flag, and no result cache.
Every status it prints comes from an HTTP response received during that run.

### One-time operator setup

The harness reads configuration; it never contains it. Nothing below is a
secret that belongs in this document — set these in your shell or in a local
env file that is already git-ignored.

| Variable | Purpose | Required |
| --- | --- | --- |
| `CONVEX_DEPLOYMENT` | Written by `npx convex dev`. Form `dev:<name>` / `prod:<name>`. Supplies the deployment identity **and** the environment label. | Recommended |
| `VITE_CONVEX_URL` | Deployment URL. Derived from `CONVEX_DEPLOYMENT` when absent. | Either this or the above |
| `EVIDENCE_D_EMAIL` | A real mailbox you can open, for the OTP. | For `--auth otp` |
| `XSTARZ_EMAIL_TRANSPORT` | Read only to detect the non-delivering `console` transport. | No |

`npm run evidence:d` passes `--auto-env`, so a git-ignored `.env.local` in the
repository root is picked up automatically. The real process environment always
wins over the file.

### Flags

| Flag | Effect |
| --- | --- |
| `--json` | Machine-readable report on stdout. |
| `--auth otp` | Default. Exercises the real email OTP flow. |
| `--auth anonymous` | Uses the application's existing anonymous provider. Development only; mints a fresh identity per run. |
| `--otp <code>` | Supply the code non-interactively. Without it, an interactive run prompts. |
| `--env-file <path>` | Read configuration from a specific file. |
| `--production-evidence` | Assert that this run is production release evidence. Refused unless the deployment really is `prod:`. |
| `--sweep <N>` | Analyse up to N discovered live instruments, stopping at the first chargeable signal, to give D5/D7/D8 a fair chance in a quiet market. Default 1. |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | All ten observations captured and passing. |
| 1 | At least one observation FAILED — a real defect. |
| 2 | Could not execute, or the run was incomplete. |

---

## The ten observations

| # | Observation |
| --- | --- |
| D1 | OTP email received at a real mailbox |
| D2 | Sign-in creates an authenticated session |
| D3 | Unauthenticated call to a protected route is rejected |
| D4 | `getMyEntitlement` returns GUEST with `remaining = 2` |
| D5 | A chargeable BUY/SELL consumes exactly one signal |
| D6 | A WAIT/NO_TRADE consumes zero signals |
| D7 | The third chargeable request returns LOCKED |
| D8 | The LOCKED payload carries no directional/actionable field |
| D9 | A forged provider payload is rejected server-side |
| D10 | Provenance `observedAt` is provider-derived, not local |

### D1 is human-attested, always

No script can observe that mail arrived in a mailbox. A 200 from an email
provider means the provider accepted the request — not that anything was
delivered. The harness requests the code, then waits for a human to supply it;
supplying the code *is* the attestation that it arrived.

If `XSTARZ_EMAIL_TRANSPORT=console`, D1 is reported BLOCKED and the run stops
before claiming a session. That transport returns `delivered: true` and sends
nothing, so a code read out of a server log would otherwise masquerade as
mailbox delivery.

### D5, D6 and the engine

The engine is never forced to produce a particular recommendation. If live
conditions do not yield a directional signal, D5 is reported `NOT_VERIFIED`
rather than FAIL, and the same applies to D6 when no WAIT/NO_TRADE occurs.
Forcing either would invalidate the observation it claims to make.

### D10 — provider-derived observation (rewritten in Phase 207)

D10 asks one question: **is `observedAt` the provider's own observation, or just
the moment we made the request?** Before Phase 207 the probe could not answer it.

| provider | module | credential | `observedAt` basis | can evidence D10? |
| --- | --- | --- | --- | --- |
| OKX order book | `src/convex/okx.ts` | **none** | exchange `ts` field | **yes** |
| TwelveData | `src/convex/marketData.ts` | `TWELVE_DATA_API_KEY` | `Date.now()` at acquisition | **no** |

The old probe used TwelveData only. That was unpassable in two independent ways:
the operator has no key, and even with one the timestamp is stamped locally at
acquisition (`src/convex/marketData.ts` ~L100, L512). A PASS from that path would
have relabelled acquisition time as provider observation — invalid evidence.

D10 now probes **OKX first**. `fetchOkxOrderBook` sets `observedAt` only when the
exchange supplied `ts`, and `parseOkxOrderBook` (`src/lib/execution-quality.ts`
L147-157) *rejects* a snapshot whose `ts` is missing or invalid. The timestamp is
therefore provider-derived by construction, and OKX needs no credential — so the
operator can run this today.

Verdicts:

- **PASS** — OKX returned an exchange timestamp that is not future-dated, not a
  cache stamped at request time, and not within 2 ms of the local clock.
- **FAIL** — any of those three violations.
- **NOT_VERIFIED** — only the acquisition-stamped fallback answered. Its basis is
  recorded so the limitation stays visible; it is never upgraded to PASS.
- **BLOCKED** — no provider returned a timestamp at all.

Every attempt is recorded in `providerAttempts[]` (provider, dataset, instrument,
access, basis, acquired, observedAt, acquisition, failure, timings) so a run can
be audited without being rerun.

### The natural chargeable-signal sweep (`--sweep N`, Phase 207)

D5/D7/D8 need a **chargeable** recommendation (BUY/SELL). A quiet market yields
`WAIT`/`NO_TRADE`, which is correct engine behaviour — not a defect. Those checks
have stayed NOT_VERIFIED because a single instrument was probed once.

`--sweep N` widens the search **without touching the engine**:

- candidates come from `okx:discoverOkxInstruments` on the live deployment,
  filtered to `state === "live"` — there is no hardcoded instrument list;
- each candidate is analysed under its **provider-native `instId`**, verbatim
  (no symbol substitution);
- nothing about thresholds, bias, confidence or engine input is altered — the
  sweep changes only *which* instrument is asked;
- it stops at the first chargeable result and hands it to D5;
- finding none is **NOT_VERIFIED, never FAIL**.

Default is `--sweep 1`, so `npm run evidence:d` behaves exactly as in Phase 206.

**Sandbox status: BLOCKED.** `www.okx.com`, `home.treasury.gov`, `www.cftc.gov`
and the deployment host all return HTTP 000 from the build environment, so D10
and the sweep are operator-only:

```
npm run evidence:d -- --sweep 25
```

---

## The report surface (Phase 208)

Both output modes render **one** object, built by
`scripts/lib/evidence-report.mjs` (`buildReport`). `--json` serialises it;
the terminal view is `renderHumanReport` over the same object. They cannot
drift, because there is only one report.

The operator should never have to read the harness source to understand a run,
so the human view carries the same decision-critical facts as the JSON:
deployment identity, every D1-D10 row with its reason, each provider attempt
and how `observedAt` was derived, every sweep candidate and its outcome,
whether a chargeable signal was found naturally, the E1-E7 verdict, and an
explicit **REMAINING BLOCKERS** list.

### Status vocabulary is fail-closed

`canonicalStatus()` returns PASS for the exact token `PASS` and nothing else.
Anything unrecognised becomes `UNKNOWN`, never PASS. This closed two real
false-green holes found while auditing Phase 207:

| hole | old behaviour | now |
| --- | --- | --- |
| unrecognised status (`SKIPPED`, `OK`, a typo) | matched none of the failed/blocked/not-verified filters, so `complete` was true and the run reported **ACHIEVED** with zero passes | counted as `UNKNOWN`; verdict INCOMPLETE and the row is listed |
| zero recorded checks | same — nothing bad happened, so **ACHIEVED** | every declared observation missing is rendered BLOCKED |

`ACHIEVED` now requires **positive evidence**: every declared observation
present and every one of them an actual PASS. Absence of a result is not
evidence.

Related invariants, all enforced on the structured report rather than by string
matching:

- a check recorded twice keeps its **worst** status — a later PASS can never
  overwrite an earlier FAIL;
- `productionEvidence` is true only when the run is complete **and** the
  environment is production **and** the class is `PRODUCTION_EVIDENCE` **and**
  `--production-evidence` was passed **and** auth was not anonymous;
- the E-track is summarised beside the D-track and contributes nothing to it,
  in either direction;
- no token, OTP or API key is ever placed in the report.

### Schema

`schemaVersion: "evidence-d/2"`. Top-level keys: `evidenceD`, `evidenceClass`,
`notExecutedReason`, `environment`, `deployment{host,name,declared}`,
`productionEvidence`, `configSource`, `authMechanism`, `capturedAt`,
`durationMs`, `transportCalls`, `summary`, `integrity`, `checks[]`,
`providerEvidence{attempts[],note}`,
`sweep{limit,attempted,candidates[],chargeableFind,marketLimitation}`,
`entitlementStateMachine{verdict,note,summary,checks[]}`, `safetyProbes`,
`blockers[]`.

## Operator workflow (Phase 209)

Three invocations, in the order an operator should use them.

### 1. Fixture dry-run — FIXTURE — NOT EVIDENCE

Proves the tooling works before it touches a real deployment. Nothing it
produces is evidence of anything.

```
# terminal 1 — start the local stub (loopback only)
node scripts/evidence-d-fixture.mjs --scenario incomplete --port 7311

# terminal 2 — run the real CLI against it
npm run evidence:d -- --fixture http://127.0.0.1:7311 --auth anonymous --sweep 5
```

Scenarios: `complete`, `exhausted`, `incomplete`, `blocked`, `malformed`,
`silent`. Use `complete` with `--auth otp --otp 123456` to see a full ten-check
run; use `incomplete` for the realistic quiet-market shape.

A fixture run is stamped at every layer — `fixture: true`,
`fixtureNotice: "FIXTURE — NOT EVIDENCE"`, `environment: "fixture"`,
`evidenceClass: "FIXTURE — NOT EVIDENCE"`, deployment name
`FIXTURE-NOT-EVIDENCE` — and `productionEvidence` is hard-wired to `false` even
when all ten observations pass. `--fixture` is refused for any non-loopback URL
and cannot be combined with `--production-evidence`.

**A fixture run must never be reported as Evidence D.** It proves the harness,
the report schema and the exit codes. It proves nothing about the product.

### 2. Real DEV run

```
npm run evidence:d -- --auth anonymous --json
```

Anonymous auth leaves D1 `NOT_VERIFIED` (no mailbox is exercised). Use
`--auth otp` with `EVIDENCE_D_EMAIL` set to a real mailbox to resolve D1.

### 3. Real sweep

```
npm run evidence:d -- --sweep 25
```

Widens the search for a natural chargeable signal so D5/D7/D8 have a fair
chance. Candidates come from the deployment's own discovery action; nothing
about the engine is altered.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | every observation passed (`ACHIEVED`) |
| 1 | at least one observation FAILED |
| 2 | incomplete, refused, or not executed |

Observed against the fixture: `complete` + OTP → 0 · `incomplete` → 2 ·
`blocked` → 1 · `malformed` → 2 (UNKNOWN, never PASS) · `silent` → 2
(`NOT EXECUTED`, ten BLOCKED rows).

### Refusals that still apply

Fixture mode is a separate branch and does not relax anything for a real run.
The harness still refuses: a local host without `--fixture`, a non-https URL, a
host outside `*.convex.cloud`/`*.convex.site`, a deployment-name mismatch, an
unreachable deployment, `--production-evidence` against a non-production
deployment, and anonymous auth for a production claim.

## Development verification is not production evidence

A green run against a development deployment is labelled:

```
DEV_VERIFIED — NOT PRODUCTION EVIDENCE
```

This is not a formality. A dev deployment can hold seeded data, a permissive
email transport and non-production provider keys. It establishes that the
code paths work; it does not establish that the product a customer touches
works.

`productionEvidence: true` appears only when the deployment identity is
genuinely `prod:` **and** `--production-evidence` was requested **and** every
observation passed. An unlabelled deployment is reported as `unknown` and can
never carry a production claim — refusing to guess is the point.

Anonymous sign-in is rejected outright for production evidence: production must
exercise the real OTP flow.

---

## What the harness refuses

| Condition | Result |
| --- | --- |
| No deployment configured | NOT EXECUTED |
| `localhost` / `127.0.0.1` / `*.local` | NOT EXECUTED |
| Plain `http` | NOT EXECUTED |
| A non-Convex host | NOT EXECUTED |
| `CONVEX_DEPLOYMENT` and the URL naming different deployments | NOT EXECUTED |
| Deployment unreachable | NOT EXECUTED, reported as **transport**, never as an auth result |
| `--production-evidence` on a non-production deployment | NOT EXECUTED |
| Any check unresolved | INCOMPLETE, exit 2 |

A refusal marks all ten observations BLOCKED and none PASS.

---

## The entitlement state machine (E1–E6) — Phase 205

D5–D8 measure the **market-analysis guarantee**: that the *engine's own*
output decides what is charged. They are market-dependent by nature. On a quiet
market the engine returns `NO_TRADE`, nothing is chargeable, and `LOCKED` is
unreachable — `gateDecision` delivers non-actionable results in full regardless
of allowance.

That is reported `NOT_VERIFIED — no real chargeable signal occurred`, never
FAIL. **A green D7 produced by forcing BUY/SELL would be invalid evidence** and
the harness has no code path that can do it.

The **entitlement guarantee** is a separate claim — given a chargeable event,
the counter goes 2 → 1 → 0 and then refuses — and it does not need a live BUY.
E1–E6 verify it against the same real deployment:

| # | Observation |
| --- | --- |
| E1 | A fresh authenticated GUEST starts with `remaining = 2` |
| E2 | A non-chargeable event consumes nothing |
| E3 | First chargeable consumption: remaining 2 → 1 |
| E4 | Second chargeable consumption: remaining 1 → 0 |
| E5 | Third chargeable attempt refused, nothing charged |
| E6 | Refusal is redacted; non-chargeable stays free after exhaustion |

### Why this is not a backdoor

E1–E6 run through `entitlements:consumeProfitSignal`, a mutation that is
already deployed and already client-callable. Nothing was added to production
for testing. It is strictly **less** privileged than the analysis path:

- it is authenticated and rejects anonymous callers;
- it returns accounting only (`allowed`, `charged`, `plan`, `remaining`,
  `reason`) and never a recommendation, entry, stop or target — so it cannot
  be used to obtain a signal without paying;
- it can only ever debit: `nextUsageCount` is `min(used + 1, LIMIT)`, with no
  path that grants allowance or Premium;
- it is deliberately not wired into any delivery path (Phase 174).

**What it cannot prove:** that the engine's own output decides chargeability —
it takes the recommendation as an argument. That is exactly why it does not
replace D5–D8, and why the report keeps the two verdicts apart:
`evidenceD` is computed only from D1–D10, and a verified state machine never
turns an incomplete Evidence D into an achieved one.

The E-track mints its own fresh identity, because the D-track has already spent
allowance on its session.

### E7 — authorization probes (Phase 206)

E7 asserts a set of **refusals** against the live deployment. Every probe must
be rejected; none of them weakens the server, and none is relied upon to
succeed:

| Probe | Required outcome |
| --- | --- |
| A 4th chargeable attempt after exhaustion | `used` stays 2, never 3 |
| `consumeProfitSignal` with no session | rejected |
| Plan after all consumption | still `GUEST` |
| `grantPremium` from a non-admin caller | refused, plan not `PREMIUM` |
| `protectedAnalysis:resolveAndConsume` from a client | **not callable**, state unchanged |

The internal-mutation probe is a negative control: the deployment must answer
with an error. Its success is recorded as a FAIL and can never produce
evidence — test-enforced.

### Running the E-track

The operator command is unchanged:

```
npm run evidence:d -- --auth anonymous --json
```

The E-track mints its own fresh identity per run, so `used` always starts at 0.
No user id is ever hardcoded.

---

## Phase 203 — why the execution half was rewritten

Phase 200 built the harness and proved its refusals. An audit in Phase 203
found that the execution half could not have produced correct results:

1. **Wrong argument shape.** It called `runProtectedAnalysis` with
   `{symbol, instrumentType, tradingStyle}`. The action declares a single
   `input` argument and reads `input.instrument` / `input.timeframe`, so every
   analysis call would have returned `INVALID_INPUT` — D4–D8 would have failed
   for a harness defect that reads as a product defect.
2. **D9 could not fail.** The forged payload was sent as a *sibling* of
   `input`, at a level the server never reads. `stripClientEvidence` would
   never have seen it, so D9 — the anti-spoofing check — would have reported
   PASS with the defence entirely unexercised. It now forges five fields drawn
   from the server's own `CLIENT_UNTRUSTED_EVIDENCE_FIELDS`, inside `input`,
   and runs **before** exhaustion so a LOCKED redaction cannot manufacture the
   pass.
3. **D10 probed a field that is never returned.** `observedAt` is server-side
   provenance. The probe now targets the acquisition action that really exposes
   it, and rejects request-time substitution.
4. **D8 checked six field names.** The server protects eighteen. It now checks
   all of them plus six aliases, pinned by test to the server's own list.

The refusals from Phase 200 were kept and extended.
