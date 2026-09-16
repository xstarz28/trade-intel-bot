# DEV Evidence D — operator runbook (Windows)

**Audience:** the person with access to the DEV Convex deployment and a Windows
machine.
**Goal:** run the verified Evidence D tooling against the **real DEV
deployment** and send back the result.
**Time:** about 10 minutes, most of it waiting on `--sweep 25`.

This is the run the build environment cannot do. It has no network path to
`*.convex.cloud`, `www.okx.com` or any provider — every attempt returns HTTP
000 — so D1–D10 and E1–E7 have never executed against a real backend. The
tooling itself is verified (Phases 203–209: 9291 tests, 15/15 negative-control
mutations killed, full CLI proven end to end against a loopback fixture). What
is missing is a real deployment to point it at.

> **You will not be asked for any secret.** Not an API key, not a deploy key,
> not an OTP, not a token, not the contents of `.env.local`. If any instruction
> below appears to ask for one, stop — it is wrong and should be reported.

---

## 0. Prerequisites

| # | Requirement | How to confirm |
| --- | --- | --- |
| 0.1 | A checkout at commit `e3ea951` or later, on branch `arena/01a08e67-trade-intel-bot` | `git log --oneline -1` |
| 0.2 | Node.js and npm available | `node --version` then `npm.cmd --version` |
| 0.3 | `.env.local` exists in the repo root and points at the DEV deployment | see step 1.3 — **do not open or paste its contents** |
| 0.4 | The DEV deployment is already provisioned (`tough-goose-455` or whatever your dev deployment is called) | step 3 confirms it |
| 0.5 | Internet access to `*.convex.cloud` and `*.convex.dev` | step 3 confirms it |

No production credentials are needed. The anonymous DEV run does not send
email, does not require `EVIDENCE_D_EMAIL`, and cannot produce a production
claim.

---

## 1. Open PowerShell in the project folder

Use **PowerShell**, not CMD. In PowerShell always call `npm.cmd` and `npx.cmd`
(with the `.cmd` suffix) — the bare `npm` / `npx` names resolve to PowerShell
shim scripts that can be blocked by the execution policy. See troubleshooting
T3 if you hit that.

### 1.1 Go to the project folder

```powershell
cd C:\path\to\trade-intel-bot
```

### 1.2 Confirm you are in the right place

```powershell
Get-Content package.json | Select-String '"evidence:d"'
```

Expected — one line containing:

```
"evidence:d": "node scripts/evidence-d-harness.mjs --auto-env"
```

If nothing prints, you are in the wrong folder.

### 1.3 Confirm `.env.local` exists — without reading it

```powershell
Test-Path .env.local
```

Expected: `True`. **Do not open it, do not print it, do not paste it.** The
harness reads it itself (`--auto-env`). If this prints `False`, see
troubleshooting T1.

---

## 2. Install dependencies — only if missing

```powershell
if (-not (Test-Path node_modules)) { npm.cmd install --legacy-peer-deps }
```

If `node_modules` already exists, this does nothing and that is correct. The
`--legacy-peer-deps` flag is required by this project's dependency graph.

**Do not run `npm audit fix`.** It rewrites the dependency tree and would
invalidate the verified build.

---

## 3. Confirm the DEV deployment is reachable

```powershell
npx.cmd convex dev --once
```

This pushes the current functions to your DEV deployment and exits. It is the
step that proves the deployment exists, that you are authenticated to it, and
that the functions Evidence D calls are actually deployed.

Expected: it completes and returns you to the prompt without an error. If it
fails, **stop here** and see troubleshooting T4/T5 — running Evidence D against
a deployment that failed to update would attribute the result to the wrong code.

---

## 4. Run Evidence D against the real DEV deployment

Two runs. The first is for you to read, the second is the one you send back.

### 4.1 Readable run

```powershell
npm.cmd run evidence:d -- --auth anonymous --sweep 25
```

### 4.2 Machine-readable run, saved to a file

```powershell
npm.cmd run evidence:d -- --auth anonymous --sweep 25 --json > evidence-d-dev.json
echo "EXIT CODE: $LASTEXITCODE"
```

`$LASTEXITCODE` must be read on the line **immediately after** the command —
any other command in between overwrites it.

> `evidence-d-dev.json` is written to the repo root. `.gitignore` already
> covers `.env*` but **not** this file — delete it when you are done, or move it
> outside the repo, so it is never committed.

### What the flags mean

| Flag | Why |
| --- | --- |
| `--auth anonymous` | Uses the app's existing anonymous provider. No mailbox, no OTP, no email sending. D1 will be `NOT_VERIFIED` as a result — that is expected and honest. |
| `--sweep 25` | Asks the analysis engine about up to 25 instruments **discovered from the deployment itself**, stopping at the first naturally chargeable answer. Gives D5/D7/D8 a fair chance in a quiet market. |
| `--json` | Emits the full canonical report. |

---

## 5. What to send back

Exactly three things:

1. **The complete contents of `evidence-d-dev.json`.** All of it — truncating
   it removes the provider attempts and sweep log, which are the parts that
   make the run auditable.
2. **The exit code** printed by `echo "EXIT CODE: $LASTEXITCODE"`.
3. **The timestamp** of the run:
   ```powershell
   Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
   ```

### Before you paste — a 10-second safety check

```powershell
Select-String -Path evidence-d-dev.json -Pattern 'Bearer |eyJ|TWELVE_DATA|CONVEX_DEPLOY_KEY'
```

Expected: **no matches**. The report is built to contain no token, OTP or key
(machine-enforced by the Phase 208 test suite), so this should always come back
empty. If it ever prints anything, do **not** paste the file — report that the
check matched and stop.

### Never send

`.env.local` · API keys · the Convex deploy key · an OTP code · an access or
session token · anything from `npx convex dashboard`.

---

## 6. Exit codes

| Code | Meaning | What it implies |
| --- | --- | --- |
| **0** | `ACHIEVED` — all ten observations genuinely passed | Best case. Still DEV, still not production evidence. |
| **1** | `FAILED` — at least one observation actually failed | A real defect was found. This is valuable; send it. |
| **2** | `INCOMPLETE`, refused, or `NOT EXECUTED` | The most likely outcome. Nothing is wrong with your run. |

Exit 2 is expected on a quiet market. It is not a failure of the run.

---

## 7. Reading the result

### Overall verdicts (`evidenceD`)

| Value | Meaning |
| --- | --- |
| `ACHIEVED` | Every one of D1–D10 was recorded and passed. Requires positive evidence for all ten; absence of a result never counts. |
| `INCOMPLETE` | Nothing failed, but at least one observation is unresolved (`NOT_VERIFIED`, `BLOCKED`, or an unrecognised status). |
| `FAILED` | At least one observation actively failed. A real contract violation. |
| `NOT EXECUTED` | The harness refused to run at all, or could not reach the deployment. No check was marked PASS. |

### Classification (`evidenceClass`)

| Value | Meaning |
| --- | --- |
| `DEV_VERIFIED — NOT PRODUCTION EVIDENCE` | What a successful run here produces. The code paths work on a dev deployment. **This does not make the product release-ready.** |
| `PRODUCTION_EVIDENCE` | Only from a genuine `prod:` deployment, with `--production-evidence`, OTP auth, and all ten passing. You will not see this. |
| `FIXTURE — NOT EVIDENCE` | A local stub run. Proves the tooling only. **If you ever see this in a run you believe was against DEV, the run is invalid — tell me.** |

### Per-check statuses

| Status | Meaning |
| --- | --- |
| `PASS` | Real positive evidence was observed. |
| `NOT_VERIFIED` | The condition could not be produced this run — usually market conditions. **Not a failure, and never silently upgraded to PASS.** |
| `BLOCKED` | A prerequisite was missing, so the observation could not be attempted. |
| `FAIL` | The contract was actually violated. |

### Three things that are easy to get wrong

1. **E1–E7 `VERIFIED` does not make D verified.** The entitlement state machine
   is a separate track, reported beside D1–D10 and contributing nothing to the
   D verdict. It is entirely normal for E to be `VERIFIED` while D is
   `INCOMPLETE`.
2. **`DEV_VERIFIED` does not mean release-ready.** A dev deployment can hold
   seeded data, a permissive email transport and non-production keys.
3. **`D5`/`D7`/`D8` may legitimately stay `NOT_VERIFIED`.** See §8.

---

## 8. What `--sweep 25` will realistically do

The sweep asks the real engine about real instruments. Any of these is a valid
outcome:

- **It finds a natural BUY/SELL/LONG/SHORT.** D5 can then measure that exactly
  one signal was consumed, and D7/D8 may reach the LOCKED ceiling.
- **It finds only WAIT/NO_TRADE.** This is the engine working correctly in a
  quiet market. D5/D7/D8 stay `NOT_VERIFIED`.
- **A provider fails or rate-limits.** Recorded as a failure reason in the
  sweep log, not hidden.
- **Discovery returns nothing live.** Recorded as a note in the sweep log.

**None of these may ever be converted into a PASS.** The engine is never forced
to produce a directional signal — doing so would destroy the very thing D5 is
trying to observe. If the market is quiet, the honest answer is
`NOT_VERIFIED`, and that is what you should send back.

Sweep safety properties, all machine-enforced:

- candidates come **only** from the deployment's own
  `okx:discoverOkxInstruments`, filtered to `state === "live"` — there is no
  hardcoded instrument list;
- each instrument keeps its **provider-native id** (`instId`) verbatim — no
  symbol substitution, ever;
- nothing about thresholds, bias or confidence is altered — the sweep changes
  only *which* instrument is asked;
- `25` is the only ceiling, and it comes from your command line.

---

## 9. D10 specifically

D10 asks: **is `observedAt` the provider's own observation, or just the moment
we made the request?**

It is OKX-first and **credential-free** — `okx:fetchOkxOrderBook` needs no API
key, so it should work on your machine. `parseOkxOrderBook` rejects a snapshot
whose exchange `ts` is missing or invalid, so the timestamp is provider-derived
by construction.

A valid D10 `PASS` requires all of:

- an actual provider response (not a cache read, not a stub);
- a provider-supplied exchange timestamp;
- no local `Date.now()` substitution — a value within 2 ms of the local clock
  is recorded as `FAIL`;
- no `cachedAt`/`readAt` relabelled as an observation;
- no historical data presented as live; a future-dated stamp is `FAIL`.

If only the credentialed fallback (TwelveData) answers, D10 is reported
`NOT_VERIFIED` with its basis recorded — never `PASS`, because an
acquisition-time stamp is not a provider observation.

---

## 10. What NOT to do

| Do not | Why |
| --- | --- |
| Use `--production-evidence` | This is a dev deployment. The harness refuses, exit 2. |
| Use `--fixture` | Fixture mode is a local stub for testing the tooling. It produces `FIXTURE — NOT EVIDENCE` and proves nothing about the product. |
| Edit source to make D5/D7 pass | That fabricates the result. A forced BUY is not evidence of anything. |
| Point the harness at `localhost`, `127.0.0.1`, or any mock/replay endpoint | Refused by design. A substitute backend cannot produce Evidence D. |
| Substitute a different instrument for one that failed | Provider-native identity must be exact. Swapping A for B and calling it success is a false result. |
| Delete or edit `.env.local` | It is the deployment configuration. |
| Paste secrets into chat | Never needed. See §5. |
| Run `npm audit fix` | Rewrites the dependency tree and invalidates the verified build. |

---

## 11. Troubleshooting

### T1 — `Test-Path .env.local` returns `False`
The harness will refuse with *"No deployment is configured"* (exit 2). You need
a `.env.local` in the repo root containing at least `VITE_CONVEX_URL` or
`CONVEX_DEPLOYMENT` for your dev deployment. `npx.cmd convex dev --once`
normally creates/updates this. Do not paste the file back.

### T2 — `node_modules` missing / `Cannot find module`
```powershell
npm.cmd install --legacy-peer-deps
```
The `--legacy-peer-deps` flag is required; a plain `npm install` fails on this
dependency graph.

### T3 — `npx.ps1 cannot be loaded because running scripts is disabled`
PowerShell execution policy is blocking the shim. Use the `.cmd` entry points,
which are not affected:
```powershell
npx.cmd convex dev --once
npm.cmd run evidence:d -- --auth anonymous --sweep 25
```
If you prefer to change the policy instead, this is the least-privilege option
and applies only to your user:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### T4 — Convex TLS / network failure (`ECONNRESET`, timeout, `fetch failed`)
The harness reports this as a **transport failure**, explicitly not an
authentication or authorisation result, and refuses rather than blaming the
application. Check that a corporate proxy, VPN or firewall is not intercepting
TLS to `*.convex.cloud` and `*.convex.dev`. Both domain families must be
reachable: `*.convex.dev` for the CLI, `*.convex.cloud` for Evidence D.

### T5 — `npx.cmd convex dev --once` says you are not logged in / no deployment
```powershell
npx.cmd convex login
npx.cmd convex dev --once
```
Do not paste the login output.

### T6 — Deployment mismatch refusal
The harness refuses when `CONVEX_DEPLOYMENT` names one deployment but
`VITE_CONVEX_URL` points at another, rather than silently attributing evidence
to the wrong backend. Make the two agree in `.env.local`, then re-run step 3.

### T7 — Rate limited
A provider or the deployment may rate-limit during a 25-instrument sweep. This
is recorded honestly in the sweep log. Wait a few minutes and re-run, or use a
smaller sweep (`--sweep 10`). Do not retry in a tight loop.

### T8 — "No chargeable signal found"
Not an error. The market was quiet. D5/D7/D8 stay `NOT_VERIFIED`, exit 2. Send
the result as-is. If you want a second sample, re-run at a different time of
day — but never force a signal.

### T9 — Expired or stale dev deployment configuration
If the deployment was deleted or rotated, `npx.cmd convex dev --once` will fail
or provision a new one. Re-run step 3 and confirm the deployment name it prints
matches what you expect before running Evidence D.

---

## 12. Checklist

- [ ] In the project folder; `package.json` shows `evidence:d`
- [ ] `Test-Path .env.local` → `True` (not opened, not pasted)
- [ ] `node_modules` present (installed with `--legacy-peer-deps` if it was missing)
- [ ] `npx.cmd convex dev --once` completed without error
- [ ] `npm.cmd run evidence:d -- --auth anonymous --sweep 25` ran
- [ ] `... --json > evidence-d-dev.json` ran; exit code captured
- [ ] Safety check over the JSON returned no matches
- [ ] Sending: full JSON + exit code + timestamp
- [ ] Sending no secrets of any kind
- [ ] `evidence-d-dev.json` deleted or moved out of the repo afterwards

---

## 13. What happens next

The returned JSON converts the `BLOCKED` rows in `docs/UAT-MATRIX.md` §35j/§35k
into real verdicts, and produces the first genuine
`DEV_VERIFIED — NOT PRODUCTION EVIDENCE` record for this product.

It does **not** make the product release-ready. The blockers in
`docs/RELEASE-GATE.md` — OTP credential rotation, production deployment
credentials, email domain and SPF/DKIM/DMARC, live provider keys, mobile
signing — are unaffected by this run.
