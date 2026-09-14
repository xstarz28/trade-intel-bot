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

### D10 and provider credentials

`runProtectedAnalysis` logs provenance server-side rather than returning it, so
D10 is probed where provenance is actually exposed — the acquisition action,
which reports `observedAt` and its acquisition mode. Without a live provider
credential that path cannot run, and D10 is reported BLOCKED. A fabricated
timestamp is never accepted in its place.

---

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
