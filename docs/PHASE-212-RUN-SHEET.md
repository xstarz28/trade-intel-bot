# Phase 212 — real DEV D10 re-run sheet

**Purpose: measurement, not repair.** This run answers one question — *what is
the true provider failure class behind the `API_UNAVAILABLE` seen in the Phase
210 run?* Nothing in this sheet changes provider behaviour, thresholds or
recommendations.

Run this from the Windows operator machine. The agent sandbox cannot perform it:
it has no egress to Convex or OKX (every outbound request returns HTTP 000), so
any result produced there would be a sandbox artefact, not evidence.

---

## 0. Before you start

Do **not** provide secrets to the agent, paste `.env.local` into chat, or share
any API key, deploy key, OTP or bearer token. The run sheet never asks for one.
`--auth anonymous` deliberately requires no mailbox and no OTP.

---

## 1. Verify the checkout is current

```powershell
cd <repo>
git fetch origin
git checkout arena/01a08e67-trade-intel-bot
git pull --ff-only origin arena/01a08e67-trade-intel-bot
git log --oneline -1
```

The commit must be **`56eb2f1` or later**. An older checkout still contains the
Phase 211 defects and will reproduce the misleading `API_UNAVAILABLE` message.

```powershell
git status --porcelain
```

Expect empty output. A dirty tree means the run is not reproducible.

---

### 1b. If the checkout came from a ZIP (no `.git` directory)

A directory named like `trade-intel-bot-arena-01a08e67-trade-intel-bot` is the
shape GitHub's "Download ZIP" produces, and it contains **no `.git`**, so
`git log` cannot confirm anything. Verify the content directly instead — this is
equally conclusive:

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('scripts/evidence-d-harness.mjs','utf8');const n=t=>s.split(t).length-1;console.log('classifyFailureBoundary',n('classifyFailureBoundary'));console.log('failureBoundary-wired',n('failureBoundary: classifyFailureBoundary'));console.log('harness-to-deployment',n('harness->deployment'));console.log('deployment-to-provider',n('deployment->provider'));console.log('deployment-function',n('deployment-function'));console.log('runsheet',fs.existsSync('docs/PHASE-212-RUN-SHEET.md'))"
```

Expected exactly:

```
classifyFailureBoundary 3
failureBoundary-wired 1
harness-to-deployment 1
deployment-to-provider 2
deployment-function 1
runsheet true
```

These counts are line-ending independent, so a CRLF checkout still matches. If
any count is `0`, the tree predates Phase 212 — re-extract the branch at
`bd75aa1` or later. No source edits are needed or permitted to make them match.

## 2. Confirm the deployment

Use the **existing DEV deployment already provisioned for this project**. Do not
create another one and do not point at production.

```powershell
npm.cmd run convex:preflight
```

Confirm it reports the development deployment and
`XSTARZ_DEPLOYMENT_ENV=development`. The harness refuses to run
`--production-evidence` outside production, and refuses anonymous auth against
production, so a misconfigured target fails closed rather than producing a
misleading PASS.

---

## 3. The run

```powershell
npm.cmd run --silent evidence:d -- --auth anonymous --sweep 25 --json | Out-File -Encoding utf8 phase212.json
echo "EXIT=$LASTEXITCODE"
```

Two details in that line are load-bearing, both verified by execution:

- **`--silent`** — without it `npm run` prints a three-line banner to *stdout*,
  so the redirected file starts with `> vite-template@0.0.0 evidence:d` and does
  not parse as JSON. This was a real defect in the first version of this sheet.
- **`Out-File -Encoding utf8`** — Windows PowerShell 5.1's `>` operator writes
  UTF-16LE, which also fails to parse. `Out-File -Encoding utf8` is explicit and
  correct on both PowerShell 5.1 and 7.

The exit code is preserved through the pipe in PowerShell (`$LASTEXITCODE`
reflects the native command).

Also capture the human-readable form — it renders the D10 detail line in full:

```powershell
npm.cmd run --silent evidence:d -- --auth anonymous --sweep 25 | Out-File -Encoding utf8 phase212.txt
echo "EXIT=$LASTEXITCODE"
```

Exit codes: `0` complete · `1` at least one FAIL · `2` incomplete. **Exit 2 is
the expected outcome** while D1/D5/D7/D8 remain unevidenced; it is not an error
in the run itself.

---

## 4. What to send back

Send `phase212.json` and `phase212.txt`. They contain **no** credentials: the
harness never serialises keys, tokens or OTPs. If you prefer to extract the
decisive fields only:

```powershell
node -e "const j=require('./phase212.json');const d=j.checks.find(c=>c.id==='D10');console.log(JSON.stringify({status:d.status,detail:d.detail,attempts:d.evidence.providerAttempts},null,2))"
```

### Field map — where each requested item lives

| requested | JSON path |
| --- | --- |
| D10 status | `checks[id=D10].status` |
| D10 exact failure class | `checks[id=D10].evidence.providerAttempts[].failureClass` |
| failure boundary (Phase 212) | `checks[id=D10].evidence.providerAttempts[].failureBoundary` |
| `providerAttempts[]` | `checks[id=D10].evidence.providerAttempts` |
| requested instrument | `…providerAttempts[].instrument` |
| observed instrument | `…providerAttempts[].observedInstrument` |
| chargeable find | `sweep.chargeableFind` (`null` when the market offered none) |
| D1–D10 summary | `checks[]` + `summary` |
| E1–E7 summary | `entitlementStateMachine` |
| timestamp | `capturedAt` |
| environment / deployment | `environment`, `deployment`, `evidenceClass`, `productionEvidence` |
| exit code | shell `$LASTEXITCODE` (not serialised into the report) |

---

## 5. How to read the D10 answer

The BLOCKED detail now reads `provider[CLASS@boundary]:reason` for every
provider tried, so the *layer* is explicit:

| `failureBoundary` | meaning | who can fix it |
| --- | --- | --- |
| `harness->deployment` | your machine could not reach Convex | operator network/config |
| `deployment-function` | the Convex function itself threw | code |
| `deployment->provider` | Convex reached, provider did not answer usably | Convex egress or the provider |

Combined with `failureClass`, the likely readings are:

| observed | interpretation |
| --- | --- |
| `TRANSPORT@deployment->provider` | Convex cannot reach OKX — **egress**, matches the known sandbox symptom |
| `PROVIDER_HTTP@deployment->provider` | OKX answered with a non-2xx (possibly geo/IP restriction) |
| `PROVIDER_NO_TIMESTAMP@deployment->provider` | OKX returned a book with no usable exchange `ts` |
| `PROVIDER_SCHEMA@deployment->provider` | OKX contract drift |
| `PROVIDER_CREDENTIAL` on `twelve-data` | the fallback key is absent/rejected (OKX needs none) |
| `TRANSPORT@harness->deployment` | the run never reached Convex — re-check step 2 before reading anything else |

**Do not collapse any of these to a generic `unavailable`.** That collapse is
precisely the Phase 211 defect.

---

## 6. D10 PASS gate (unchanged)

D10 may be recorded PASS **only** when all four hold:

1. the OKX public acquisition actually succeeds,
2. the response carries a valid exchange-supplied `ts`,
3. acquisition preserves that timestamp (no re-stamping at read time),
4. the report exposes it as provider-derived `observedAt`.

Anything else stays **BLOCKED** or **NOT VERIFIED**. A clearer error message is
not evidence, and a fabricated or cache-read timestamp is never acceptable.

---

## 7. Instrument identity

The probe names `BTC-USDT-SWAP` — the provider-native contract id, passed
through `mapInstrumentToOkx` unchanged. Report `instrument` (requested) and
`observedInstrument` (what OKX says it answered with) **separately**. If they
ever differ, the request was silently remapped and the observation describes a
different contract. Do not describe the run as `BTC-USDT`.

---

## 8. Scope boundaries for this run

- `--sweep 25` only widens the set of **naturally discovered** candidates. It
  cannot manufacture a chargeable signal. If the market yields NO_TRADE again,
  D5/D7/D8 stay NOT VERIFIED — that is a correct result, not a failure.
- No thresholds, no recommendation injection, no symbol substitution.
- E1–E7 remain an independent axis and are not folded into Evidence D.
