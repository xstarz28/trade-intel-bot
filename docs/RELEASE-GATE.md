# Final Release Gate — Xstarz Analysis

Phase 183. **Verdict: NOT READY for production release.**

Status vocabulary is restricted to **PASS**, **FAIL**, **BLOCKED**,
**NOT VERIFIED**, **NOT APPLICABLE**. There is no partial green.

- **PASS** — executed, and the result was observed in the stated environment.
- **BLOCKED** — cannot be executed from any environment available to this
  project; needs an external account, credential, host or device.
- **NOT VERIFIED** — could be executed by someone with access, but has not
  been.

RC commit `dea46ef` on `arena/01a08e67-trade-intel-bot`. All timestamps UTC.

---

## The matrix

| Gate | Status | Evidence | Environment | Timestamp |
| --- | --- | --- | --- | --- |
| Source/RC identity | **PASS** | `dea46ef`; build provenance embedded in the artifact matches `HEAD` | Local build | 2026-09-12T04:40Z |
| Secret rotation | **BLOCKED** | Re-verified Phase 198 on **full** history (339 commits, unshallowed): credential live in **270/339** commits, 1 blob, 1 path, `main` + `phase-157` **exposed at tip**. Issuer `auth.freebuff.app` HTTP **000** (DNS resolves; GitHub/npm 200 ⇒ egress block, not outage). No revocation evidence obtainable, no issuer credential in env ⇒ **rotation cannot be performed or verified here** | External vendor | 2026-09-14T00:00Z |
| History remediation | **BLOCKED** | Gated behind rotation. Re-rehearsed Phase 198 on a fresh disposable mirror: **0** occurrences across all 4 refs (2 independent methods + positive control), **339/339** commits preserved, author/date/subject and parent topology byte-identical, working-branch tree **0 files changed**, exactly 1 line of `emailOtp.ts` redacted. Production and remote untouched; no force-push. Runbook: `docs/SECRET-REMEDIATION-RUNBOOK.md`; verifier: `scripts/secret-rehearsal-verify.mjs` | Sandbox rehearsal | 2026-09-14T00:00Z |
| Convex codegen | **BLOCKED** | Re-verified Phase 199: `npx convex codegen` → "No CONVEX_DEPLOYMENT set". **No generated file hand-edited.** Drift check: 23 source modules ↔ `api.d.ts`, **zero drift**; Phase 187 `otpLimiter` entry consistent but **pending official regeneration** | Sandbox | 2026-09-14T00:00Z |
| Convex deployment | **BLOCKED** | Phase 199 classified the failure precisely: DNS resolves, **TCP :443 OPEN**, TLS severed (`SSL_ERROR_SYSCALL`) in ~40ms; GitHub/npm 200 on the same network ⇒ **unavailable egress, NOT a credential failure**. `CONVEX_DEPLOYMENT`/`CONVEX_DEPLOY_KEY` unset. See `docs/CONVEX-DEPLOYMENT-READINESS.md` | Sandbox | 2026-09-14T00:00Z |
| Evidence D | **PARTIAL (DEV only)** | Phase 213: real run against `tough-goose-455` (development, `productionEvidence:false`, exit 2). **D2/D3/D4/D6/D9/D10 PASS in DEV**; D10 via live OKX order book (`BTC-USDT-SWAP`, exchange `ts`, FRESH). D1 NOT VERIFIED (anonymous); D5/D7/D8 `NOT_VERIFIED — MARKET_CONDITION` (25-candidate sweep, no natural chargeable signal). **DEV evidence is not production evidence** — see `docs/UAT-MATRIX.md` §35o | DEV deployment | 2026-09-15T00:00Z |
| Live providers | **BLOCKED** | All 7 provider hosts HTTP 000; npm/GitHub 200 (proves allowlist, not outage) | Sandbox | 2026-09-12T04:15Z |
| Web production deploy | **NOT VERIFIED** | Contract verified against the real build locally; never deployed to a public host | Local SPA host | 2026-09-12T04:33Z |
| Android CI artifact | **PASS** | Debug APK 3,809,003 bytes; asset + secret scans passed | `ubuntu-latest` | 2026-09-12T04:43Z |
| Android release signing | **BLOCKED** | No keystore; config reads git-ignored `keystore.properties`, absent ⇒ unsigned | — | 2026-09-12T04:28Z |
| iOS CI artifact | **PASS** | Pods installed; `App.app` with executable and absolute-base assets | `macos-14` | 2026-09-12T04:38Z |
| iOS release signing | **BLOCKED** | No Apple Developer account, no certificate, no profile | — | 2026-09-12T04:29Z |
| Windows CI artifact | **PASS** | MSI + NSIS, 2,677,090 bytes; installer, asset-base, artifact and **binary** scans all passed | `windows-latest` | 2026-09-12T04:45Z |
| Windows release signing | **BLOCKED** | No code-signing certificate chaining to a Microsoft-trusted root | — | 2026-09-12T04:45Z |
| Android App Links | **BLOCKED** | `assetlinks.json` holds `REPLACE_WITH_RELEASE_CERT_SHA256`; needs the real keystore | — | 2026-09-12T04:29Z |
| iOS Universal Links | **BLOCKED** | `apple-app-site-association` holds `REPLACE_WITH_APPLE_TEAM_ID` | — | 2026-09-12T04:29Z |
| Auth | **BLOCKED** | Phase 217: DEV deployment confirmed to have **no** email transport, API key or sender address. Delivery fails closed (`not_configured`), so OTP sign-in cannot send a code. Blocked on external domain + provider provisioning, not on code | DEV deployment | 2026-09-15T00:00Z |
| Entitlement | **BLOCKED** (deployed) / PASS (unit) | Phase 174 suites green; no deployed run has occurred | Sandbox | 2026-09-12T04:35Z |
| Web UAT | **PARTIAL** | 22 automated rows executed; deployment-dependent rows blocked | Local | 2026-09-12T04:33Z |
| Android UAT | **BLOCKED** | No physical Android device available to this project | — | — |
| iOS UAT | **BLOCKED** | **User has no iPhone.** Simulator compile is not device verification | — | — |
| Windows UAT | **BLOCKED** | CI packaging is not install verification. (An operator Windows machine now exists and ran the Evidence D harness in Phase 212/213, but no installer install/launch UAT has been performed) | — | — |
| F3 (light mode) | **NOT APPLICABLE** | Classified post-RC product gap, not a release blocker. Unchanged | — | — |

---

## Evidence levels

| Level | Meaning | Status |
| --- | --- | --- |
| A | Static analysis / source review | **PASS** |
| B | Unit and integration tests | **PASS** — 234 files, 8,505 tests |
| C | Handler-level tests against real handlers | **PASS** |
| **D** | **Deployed-runtime verification** | **PARTIAL — DEV only** (6/10 observed; production unverified) |

Evidence D cannot be inferred from A–C. A green suite says the code does what
it was told to do; it says nothing about a deployment that has never existed.

---

## CI false-green audit (Phase 181 rule, still enforced)

Exit code 0 is never sufficient. Every critical job asserts on its output.

That rule earned its keep this phase: the Windows job **failed three times in
a row on three genuinely different defects**, each of which an exit-code-only
check would have reported as success.

| # | Defect | How it surfaced |
| --- | --- | --- |
| 1 | `cargo test --locked` with no committed `Cargo.lock` | Step failed outright |
| 2 | Scanner walked `src-tauri/target` and `gen` — vendored crate sources, not shipped output | Scan reported a meaningless violation |
| 3 | Scanner was POSIX-path-dependent and had never run on Windows | Backslash paths silently disabled the `.env` check — **a scan that cannot match its own pattern reports PASS** |
| 4 | `localhost:5173` embedded in the compiled `.exe` | Binary scan caught it; `generate_context!` bakes the whole config into the binary |

Defect 4 is the one worth dwelling on. A release build never *uses* `devUrl`,
so reasoning alone would have dismissed it — but the string was demonstrably
inside the shipped executable. The fix moved it to a dev-only overlay, which
also let the Phase 182 scanner exemption be deleted, making the rule strictly
stronger than before.

---

## Release decision

**NOT READY.**

Four gates are PASS and hard-won: RC identity with verified provenance, and
CI-verified artifacts on all three packaged platforms with real content
assertions.

That is not sufficient, and the arithmetic is not close. A live credential
sits in a public branch tip, the backend has never been deployed, Evidence D
is absent, and no artifact has ever run on real hardware. Under §18, critical
security, backend and runtime gates may not be BLOCKED — three of them are.

### Mandatory gates still blocking

1. **OTP credential rotation** — the credential remains live and publicly
   reachable at `origin/main`'s tip. Everything else is secondary to this.
2. **History remediation** — after rotation, for **all four** refs: `main`,
   the working branch, `phase-157-live-discovery-lifecycle` **and** tag
   `rc-181`. Each reaches an affected commit, so none may be skipped — one
   surviving ref keeps the blob reachable. The rewrite is rehearsed and
   ready (`docs/SECRET-REMEDIATION-RUNBOOK.md`); it stays unexecuted until
   gate 1 is cleared, because rewriting first destroys the audit trail while
   leaving a live credential in every existing clone.
3. **Convex deployment + codegen** — nothing runs without it.
4. **Evidence D** — follows from 3.
5. **Live provider verification** — follows from 3.
6. **Auth and deployed entitlement** — follows from 3.

### Phase 200 — blocker categorization

The single most common way this project gets misreported is by treating "the
code is ready" as "the item is ready". They are separated here permanently.
Nothing in the first table becomes READY because something in the second one is.

#### BLOCKED BY USER / EXTERNAL ACCESS

None of these can be performed, simulated or verified from the build
environment. Each needs a human with an account, a domain, or network authority.

| # | Item | Owner | Cleared by |
| --- | --- | --- | --- |
| 1 | OTP credential revocation | issuer account holder | old key presented and refused (401/403) |
| 2 | Convex egress — **`*.convex.dev` + `*.convex.cloud` + `*.convex.site`** (three separate allowlist entries; Phase 201 verified all three are blocked at TLS) | platform/network | `npm run convex:access` exits 0 |
| 3 | Convex deployment credential | Convex account holder | `CONVEX_DEPLOY_KEY` accepted by the control plane |
| 4 | Email account + registered domain | product owner | verified sender at the provider |
| 5 | SPF / DKIM / DMARC | domain owner | DNS records published |
| 6 | Live provider API keys | product owner | `scripts/verify-live.mjs` with real keys |
| 7 | Android / iOS signing material | product owner | signed artifact produced |

#### CODE-READY (not deployed, not verified)

Implemented, tested and mutation-proven in this repository. **"Code-ready" is a
statement about source, never about a running system.**

| Item | Evidence | What it is NOT |
| --- | --- | --- |
| Auth architecture | self-only issuer policy, fails closed in production | not a working sign-in |
| Entitlement enforcement | `FREE_PROFIT_SIGNAL_LIMIT=2`, OCC-safe consume path | not verified against a deployment |
| Provenance controls | server-side reacquisition, 19-field allowlist | not verified with live providers |
| Deployment preflight | 11 checks, fail-closed, mutation-tested | not a deployment |
| Control-plane diagnostic | `scripts/verify-convex-access.mjs`, layer-accurate | not proof the network works |
| Evidence D harness | `scripts/evidence-d-harness.mjs`, D1–D10, refuses substitutes | not Evidence D |
| Codegen recovery contract | `codegen-authority.phase200.test.ts` | not official codegen |
| History rewrite procedure | rehearsed byte-exact on a mirror | not a rotation, not a rewrite |

### Non-blocking, explicitly accepted

- **F3 light mode** — post-RC product gap, per the existing documented
  classification. Not changed in this phase.
- **ARM64 Windows** — documented, not built, not claimed.

## Phase 213 — DEV runtime evidence recorded (still NOT READY)

### What is now verified, and where

| axis | DEV | production |
| --- | --- | --- |
| D2/D3/D4/D6/D9 | **VERIFIED** | not verified |
| D10 provider-derived observation | **VERIFIED** (live OKX public order book) | not verified |
| E1–E7 entitlement state machine | **VERIFIED 7/7** | not verified |
| D1 mailbox-delivered OTP session | not verified | not verified |
| D5/D7/D8 chargeable decision | `NOT_VERIFIED — MARKET_CONDITION` | not verified |

### Provider status — three separate things

D10 being VERIFIED in DEV must not be read as provider readiness. These are
distinct and only the first is closed:

1. **OKX public market data reachable from the DEV deployment** — **VERIFIED**.
   No credential is involved; OKX order book is a public endpoint. This proves
   the deployment has working egress to OKX and that the parser preserves the
   exchange timestamp.
2. **Production live-provider credentials** — **BLOCKED**. Coinglass,
   AlphaVantage, EIA, TickAtlas and TwelveData all require keys that do not
   exist in any environment the project controls. The Phase 211 run showed the
   TwelveData fallback answering `API_UNAVAILABLE`, which is a provider-side
   failure, not a missing key (a missing key returns `AUTH_ERROR`).
3. **Production Convex deployment** — **BLOCKED**. No production deployment
   exists. Every observation above was taken against a development deployment
   with `productionEvidence:false`.

### What D1 still needs

D1 is the only D-row that is neither market-limited nor environment-limited —
it is credential-limited. Closing it requires **all four**, and no part may be
simulated:

1. **A real OTP transport.** `emailDelivery.ts` supports `resend`, `smtp2go` or
   `console`. `console` is not evidence.
2. **A verified sender domain** with SPF, DKIM and DMARC aligned. Without this
   the message may send and still not arrive, and a send receipt is not proof
   of delivery.
3. **Actual mailbox delivery** — a human opening a real inbox and reading the
   code. Provider dashboards showing "delivered" are corroborating, not
   sufficient.
4. **An authenticated OTP session** driven end-to-end through the harness with
   `--auth otp`, so the session that performs D2–D10 is the one the OTP created.

Until then D1 stays NOT VERIFIED. The Phase 213 run used `--auth anonymous`
precisely so that no part of D1 could be implied by a run that never sent mail.

### Remaining external blockers (unchanged by this phase)

1. OTP credential rotation — still outstanding; `main` remains exposed at tip.
2. Production Convex deployment — still outstanding.
3. Deploy credential — absent.
4. Email account + verified domain — absent.
5. SPF/DKIM/DMARC alignment — unverified.
6. Live provider keys (production) — absent.
7. Mobile signing material — absent.
8. D5/D7/D8 — `MARKET_CONDITION`, see the stopping rule in `docs/UAT-MATRIX.md` §35p.

**Release decision: NOT READY.** DEV runtime evidence raises confidence in the
code path; it does not close a single production gate.

## Phase 214 — production email / OTP readiness

**Verdict: prepared, not closed.** The code path is ready; the external account
and domain are not, and nothing here invents them.

### Defect found and fixed

`FORBIDDEN_DELIVERY_HOSTS` was a hand-maintained copy that listed only the
Freebuff hosts, while `RETIRED_ISSUER_HOSTS` also retires `vly.ai`. Production
therefore **accepted `noreply@vly.ai` and `noreply@mail.vly.ai` as OTP
senders** — the auth issuer was retired but the sending identity was not.
Proven by executing the real config reader, not by inspection. The list now
derives from `RETIRED_ISSUER_HOSTS`, so the two cannot drift apart again.

### Required external prerequisites (none obtainable from this repository)

1. A domain the project controls.
2. A Resend or SMTP2GO account with that domain **verified**.
3. SPF, DKIM and DMARC records published and confirmed by the provider.
4. A real mailbox that a human can open.

### Required configuration names

`XSTARZ_EMAIL_TRANSPORT`, `XSTARZ_EMAIL_API_KEY`,
`XSTARZ_EMAIL_SENDER_ADDRESS`, `XSTARZ_EMAIL_SENDER_NAME` (optional),
`XSTARZ_EMAIL_TIMEOUT_MS` (optional), `XSTARZ_DEPLOYMENT_ENV`, `SITE_URL`,
plus the standard Convex deployment identity. Values are never recorded here.
Full runbook: `docs/PRODUCTION-EMAIL-SETUP.md`.

### Provider preference

None in code. Both transports are implemented and selected by environment
variable; the choice follows whichever account the operator can obtain.

### OTP security audit — all invariants hold, no policy changed

10-minute lifetime · CSPRNG rejection-sampled 6-digit codes · 5 failed sign-ins
per hour · 60 s resend cooldown · 5 resends per rolling hour · SHA-256 hashed
identity with no raw address stored · a rejected request does not extend the
cooldown (it returns before any write) · a failed send does not refund the
allowance · errors surface a category only, never the provider payload.

### D1 status

**BLOCKED.** D1 requires an actually-received email, a human attestation of
receipt, and an OTP session created through the application. Provider HTTP 200,
a dashboard "delivered" row, and console transport output are explicitly not
evidence.

Whether the DEV deployment already has a real transport is **unknown from the
repository** — the sandbox cannot read deployment environment variables. The
operator can check with `npx convex env list --names-only`. The flag is
required: plain `env list` prints `NAME=VALUE` and would disclose the key.

### Credential separation (restated, binding)

The new Xstarz email credential is **not** the leaked Freebuff OTP credential.
Configuring production email does not revoke the leaked key, does not close
Phase 184, and does not unblock the history rewrite. That remains gated on
rotating the old credential and observing a **401/403** from an authenticated
request using it. Deploy the hardened RC, never `main`.

## Phase 215 — DEV email configuration gate (unresolved, one operator answer away)

**D1: BLOCKED. No mailbox received an OTP. No OTP-authenticated session was
created.** Nothing in this phase changes that, and no evidence was manufactured.

### A defect in the inspection procedure, found before it was run

Phase 214 told the operator to run `npx convex env list`, claiming it shows
names only. The Convex CLI prints `NAME=VALUE` unless `--names-only` is passed.
Following the documented step would have disclosed the live email API key in
plain text. Corrected in all three documents that carried it, with a guard
(`env-inspection-safety.phase215.test.ts`) that fails if the value-printing
form is reintroduced. If the unsafe form was already run, the key must be
treated as exposed and rotated.

### Gate state

| variable | presence |
| --- | --- |
| `XSTARZ_EMAIL_TRANSPORT` | **unknown** — not reported yet |
| `XSTARZ_EMAIL_API_KEY` | **unknown** |
| `XSTARZ_EMAIL_SENDER_ADDRESS` | **unknown** |
| `XSTARZ_DEPLOYMENT_ENV` | known present in DEV (Evidence D ran against it) |
| `SITE_URL` | **unknown** |

The sandbox cannot read another deployment's environment, so this is not
something the repository can settle. See `docs/UAT-MATRIX.md` §35r for the
Case A / Case B decision tree and the exact command.

### D1 remains gated on runtime facts, not configuration

Even in Case A, configuration presence is not D1. D1 requires an email
**actually received** in a real mailbox, a **human attestation** of that
receipt, and an **authenticated session created through the application**.
Provider HTTP 200, a dashboard "delivered" row, console transport output and
server logs are explicitly not evidence.

### Credential distinction (unchanged)

A present `XSTARZ_EMAIL_API_KEY` is a new Xstarz credential, unrelated to the
leaked Freebuff key. It does not revoke it, and the Phase 184 history-rewrite
blocker stays open pending an observed 401/403 after rotation.

## Phase 217 — Evidence-D closed at the external provisioning boundary

**Repository-side Evidence-D work stops here.** The remaining gap is not a code
defect and cannot be closed from this repository.

### Operator-confirmed DEV state

`XSTARZ_EMAIL_TRANSPORT`, `XSTARZ_EMAIL_API_KEY` and
`XSTARZ_EMAIL_SENDER_ADDRESS` are **absent** from the DEV deployment.
`XSTARZ_DEPLOYMENT_ENV` and `SITE_URL` are present — which identifies the
environment but does not send mail. Inspected with the Phase 216 safe
sequence; no value was printed.

**DEV OTP SMOKE TEST NOT POSSIBLE. D1 = BLOCKED.** No mailbox delivery, no
OTP-authenticated session.

### Verified behaviour in that exact state

`readEmailDeliveryConfig` refuses with `not_configured`, naming
`XSTARZ_EMAIL_API_KEY` and `XSTARZ_EMAIL_SENDER_ADDRESS`. An absent transport
defaults to `resend` — a real transport, never `console` — so there is no path
on which sign-in appears to work while delivering nothing.

### External dependency blocking D1

1. A domain controlled by Xstarz.
2. A verified Resend or SMTP2GO sender/domain on it.
3. SPF/DKIM/DMARC as required by the chosen provider.
4. A real mailbox for the smoke test.

Procedure once provisioned: `docs/PRODUCTION-EMAIL-SETUP.md` §3, §4b, §4c.

### Evidence-D final state: INCOMPLETE

D2/D3/D4/D6/D9/D10 **PASS in DEV** · D1 **BLOCKED** · D5/D7/D8
**NOT_VERIFIED — MARKET_CONDITION** · E1–E7 **VERIFIED in DEV**.
6/10 observed, DEV only, `productionEvidence:false`. No NOT_VERIFIED row may
become PASS without its required runtime evidence.

### Unchanged

Phase 184 is **not** resolved. The leaked Freebuff credential remains live in
history and exposed at the tip of `main`; the history rewrite stays blocked
pending rotation and an observed 401/403. Provisioning Xstarz email has no
bearing on it.

## Phase 186 — deployment pipeline status

The deployment pipeline is prepared and validated. No deployment exists.

| Item | Status |
| --- | --- |
| Convex control plane reachable from the build environment | NO — DNS+TCP OK, **TLS severed (ECONNRESET)**; targeted egress block, not an outage |
| Convex deployment plane (`*.convex.cloud`, `*.convex.site`) reachable | NO — TLS severed; **separate allowlist entry**, verified Phase 201 |
| Phase 201 real deployment attempt | **BLOCKED at the external gate** — see `docs/PHASE-201-DEPLOYMENT-ATTEMPT.md` |
| `CONVEX_DEPLOYMENT` configured | NO |
| `npx convex codegen` executed against a real deployment | BLOCKED |
| Staging/preview deployment | BLOCKED |
| Production deployment | BLOCKED — and gated on Phase 184 regardless |
| Configuration preflight (`npm run convex:preflight`) | READY — 11 checks, mutation-tested |
| Control-plane diagnostic (`npm run convex:access`) | READY — separates DNS/TCP/TLS/HTTP/auth |
| Evidence D harness (`npm run evidence:d`) | READY — refuses localhost/http/non-Convex/unreachable |
| Deployment handoff runbook | READY — `docs/DEPLOYMENT-HANDOFF.md`, steps A–H |
| Evidence Level D | NOT ACHIEVED |

Two independent reasons block a production deployment. Clearing one does not
clear the other:

1. **Environment** — no Convex credentials and no network egress to the
   control plane from this environment.
2. **Security (Phase 184)** — the compromised OTP credential is still live and
   still reachable in Git history. This gate holds even if a deployment
   becomes technically possible.

A successful deployment would be evidence that the backend runs. It would not
be permission to release.

## Phase 221 — Canonical release blocker graph (authoritative from here)

**Verdict: NOT READY. No production verification exists.** This section is the
single canonical dependency graph for release blockers. Earlier sections stay
as history; where they differ, this section governs. No other gate document
may be created — `UAT-MATRIX.md`, `DEPLOYMENT-HANDOFF.md`, `EVIDENCE-D.md`,
`SECRET-REMEDIATION-RUNBOOK.md` and `PRODUCTION-EMAIL-SETUP.md` are
*procedures* that feed this graph; they do not hold a competing verdict.

Baseline: RC commit `920486c` on `arena/01a0a5f5-trade-intel-bot`; `main`
still at `51c9ddeb` (untouched, still exposed at tip).

### Evidence tiers — the four columns that must never be merged

| Tier | Meaning | Proven by |
| --- | --- | --- |
| **CODE-READY** | Source implements, tests and mutation-proofs the behaviour | tsc, build, suite, handler tests |
| **DEV-VERIFIED** | Observed on the development deployment `tough-goose-455`, `productionEvidence:false` | Phase 213/216/217 harness runs |
| **EXTERNAL PREREQ** | Requires an account, domain, credential, device or network authority no environment of this project holds | operator action |
| **PRODUCTION-VERIFIED** | Observed on a production deployment with `--production-evidence` | **none exists** |

### Blocker matrix

| ID | Blocker | Group | CODE-READY | DEV-VERIFIED | PROD-VERIFIED | Cleared only by |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Leaked Freebuff OTP credential revoked at issuer | Security | n/a | n/a | — | authenticated request with the **old** key → explicit **401/403** (000/timeout/200-elsewhere is not evidence) |
| A2 | History rewrite across **all five** refs | Security | rehearsed (Phase 221, see below) | n/a | — | A1 recorded, then §3 of the runbook, then verifier `--expect-clean` exit 0 |
| A3 | Zero secret occurrences after rewrite | Security | verifier + positive control | n/a | — | A2 |
| B1 | Production Convex project + `CONVEX_DEPLOYMENT` / `CONVEX_DEPLOY_KEY` | Convex | preflight + access diag ready | dev project exists | **absent** | Convex account holder provisions a **separate prod deployment** (dev is never promoted) |
| B2 | `CONVEX_SITE_URL` / `VITE_CONVEX_URL` (prod values) | Convex | URL checks in preflight | dev values only | absent | B1 |
| B3 | Official `npx convex codegen` against prod | Convex | drift check zero | run against dev | not run | B1 |
| B4 | `XSTARZ_DEPLOYMENT_ENV=production` on prod | Convex | unset ⇒ production (fail-closed) | dev is `development` | not set | B1 |
| B5 | Self-only issuer in production | Convex | `federated-issuer` PASS, auth-hardening suite | Phase 204 fix verified on dev | not verified | B6 + production sign-in |
| B6 | Production deploy + `npm run convex:preflight` exit 0 | Convex | preflight 11 checks; today **REJECTED (3 FAIL)** with no inputs | n/a | not deployed | B1–B4, C1–C3 present |
| C1 | Resend **or** SMTP2GO account | Email | both transports implemented | **absent on dev** (Phase 217) | absent | product owner |
| C2 | Xstarz-owned domain, verified sender | Email | forbidden-host list derives from retired issuers | absent | absent | domain owner |
| C3 | SPF / DKIM / DMARC published | Email | not checkable from code | absent | absent | domain owner |
| C4 | Production OTP delivered to a real mailbox (**D1**) | Email | OTP invariants audited | **NOT VERIFIED** | not verified | C1–C3 + B6 + harness `--auth otp --production-evidence` + human attestation |
| D1 | Twelve Data key | Providers | client + `AUTH_ERROR`/`API_UNAVAILABLE` taxonomy | free-tier fallback answered `API_UNAVAILABLE` | absent | product owner |
| D2 | Alpha Vantage key | Providers | client ready | not verified | absent | product owner |
| D3 | CoinGlass key | Providers | client ready | not verified | absent | product owner |
| D4 | TickAtlas access | Providers | client ready | not verified | absent | product owner |
| D5 | OKX public endpoints (no key) | Providers | provider-derived `observedAt` | **D10 PASS on dev** (live order book, exchange `ts`) | not verified | egress from prod deployment |
| D6 | D10 on production | Providers | — | — | not verified | B6 + D5 on prod |
| E1 | Android release keystore + `assetlinks.json` SHA-256 | Release | debug APK CI PASS | n/a | placeholder `REPLACE_WITH_RELEASE_CERT_SHA256` | product owner |
| E2 | iOS cert/profile + AASA team id | Release | simulator build CI PASS | n/a | placeholder `REPLACE_WITH_APPLE_TEAM_ID` | Apple Developer account |
| E3 | Windows code-signing cert / store packaging | Release | MSI+NSIS CI PASS, binary scan PASS | n/a | unsigned | product owner |
| E4 | Real App-Links / Universal-Links domain | Release | well-known files in place | n/a | placeholder | C2 (same domain) + E1/E2 |
| E5 | Installer / download URL | Release | artifacts built | n/a | none hosted | web host + E3 |

### Dependency graph

```
A1 revoke ──► A2 rewrite (5 refs) ──► A3 zero occurrences ──┐
                                                            ├──► release
B1 prod Convex ─► B2 URLs ─► B3 codegen ─► B4 env ─► B6 deploy ─► B5 prod auth ─┤
C1 account ─► C2 domain ─► C3 DNS ────────────────────────────► C4 D1 (prod) ──┤
D1–D4 keys ─┐                                                                   │
D5 OKX ─────┴─► D6 D10 (prod) ◄── B6 ──────────────────────────────────────────┤
C2 domain ─► E4 links ◄─ E1 / E2 signing;  E3 Windows signing ─► E5 download ──┘
```

A-chain and B-chain are **independent**: a production deployment does not
clear A, and A does not create a deployment. Neither may be inferred from the
other. Nothing in D or E clears anything in A–C.

### What can be verified from the operator's Windows machine now

| Check | Verifiable now? | How (no values printed) | What it proves |
| --- | --- | --- | --- |
| Convex account access | yes | `npx convex dashboard` / `npx convex deployments` | account exists; **not** that a prod deployment exists |
| Prod deployment credential presence | yes | `npx convex env list --names-only` on the **prod** deployment | name presence only; never value |
| Provider access (keys) | only if the operator holds keys | `npm run convex:preflight` with keys in the shell env | plausibility; not provider validity |
| OKX public D10 | yes, dev only | `npm run evidence:d` (already PASS on dev, Phase 213) | dev egress; not production |
| Email provider account status | only if the operator has an account | provider dashboard | account; not delivery, not D1 |

From the sandbox **none** of the above is verifiable: Convex control and
deployment planes are TLS-severed, OKX and the issuer return HTTP 000, and all
14 relevant variables are absent (checked by name only, Phase 221).

### Production preflight — current result

`npm run convex:preflight` with no production inputs: **REJECTED — 3 FAIL**
(`email-delivery`, `sender-identity`, `required-production-vars`:
`CONVEX_SITE_URL`, `XSTARZ_EMAIL_TRANSPORT`, `XSTARZ_EMAIL_API_KEY`,
`XSTARZ_EMAIL_SENDER_ADDRESS`). `deployment-env` resolved to `production` by
fail-closed default. **Production deploy is BLOCKED.** Dev values are not to
be substituted; the dev deployment is not to be promoted.

### DEV ⇏ PROD — what dev verification does not prove

| DEV fact | Does NOT prove |
| --- | --- |
| Phase 204 auth identity fix verified on dev | production sign-in works — prod has a different issuer URL, `SITE_URL`, and no email transport yet |
| E1–E7 entitlement machine 7/7 on dev | a production deployment enforces it — prod has never been deployed |
| D2/D3/D4/D6/D9/D10 PASS on dev | production Evidence D — every row was recorded `productionEvidence:false` |
| Source secret scan clean at HEAD | the leaked credential is dead — only the issuer's 401/403 proves that; history still carries it in 5 refs |
| CI build/package PASS on 3 platforms | release signing — every artifact is unsigned |
| preflight passing on dev | production configuration — prod inputs are absent today |

### Evidence D — exact conditions to change a row (semantics unchanged)

| Row | Today | Becomes PASS only when |
| --- | --- | --- |
| D1 | NOT VERIFIED / BLOCKED | C1–C3 provisioned on **prod**, harness `--auth otp --production-evidence`, a human reads the code from a real mailbox, and D2–D10 run in that OTP session |
| D5 / D7 / D8 | NOT_VERIFIED — MARKET_CONDITION | a **naturally** chargeable recommendation occurs during a production run; the stopping rule (UAT §35p) forbids forcing one |
| D10 | PASS (dev) / not verified (prod) | the production deployment returns an OKX exchange timestamp that is finite, not future, not local — same rule as dev, on prod |

### Phase 184 readiness — re-rehearsed against current HEAD (Phase 221)

Executed on a fresh disposable `--mirror` in `/tmp`; **real repository and
remote untouched** (all six remote ref hashes re-read after the run and
unchanged; no force-push).

| Property | Phase 198 | Phase 221 |
| --- | --- | --- |
| Refs carrying the blob | 4 | **5** — `arena/01a0a5f5-trade-intel-bot` was created after Phase 198 and inherits it |
| Commits (all refs) | 339 | 365 |
| Leaked blobs / paths | 1 / 1 | 1 / 1 (`e490ffda…`, `src/convex/auth/emailOtp.ts`) |
| Tips exposed | `main`, `phase-157` | `main`, `phase-157` (both working branches and `rc-181` tip-clean) |
| Post-rewrite verifier | CLEAN, control PASS | **CLEAN, control PASS, exit 0** |
| Commit count preserved | 339/339 | **365/365** |
| Author/email/date/subject | identical | **identical** (md5 `e3a6833f`) |
| Parent-count topology | identical | **identical** (`e6468c29`) |
| Working-branch tree | 0 files changed | **byte-identical** (`499481eb`) |
| `emailOtp.ts` delta | 1 line, 37→37 | 1 line, 37→37 |

Rewritten tips in the rehearsal: `main → b1a9e91`, `phase-157 → 6bf6f58`,
`rc-181 → 23d25ff`, `arena/01a08e67 → bd233a8`, `arena/01a0a5f5 → a2243f0`.
The procedure remains applicable after Phases 204 and 220. **It remains
unexecuted** and gated on A1. The runbook's ref table is updated to five refs.

### Release order — deterministic, not reorderable

1. Revoke the old Freebuff OTP key at the issuer (A1).
2. Capture the 401/403 rejection with the old key; record date/operator (A1).
3. Run the rehearsed rewrite across **all five** refs; force-push mirror (A2).
4. `node scripts/secret-rehearsal-verify.mjs --expect-clean` → exit 0; re-tag RC (A3).
5. Provision a production Convex deployment; set deploy key, URLs (B1, B2).
6. `npx convex codegen` against production; commit only if drift (B3).
7. `npm run convex:preflight` with production inputs → exit 0 (B4, B6-pre).
8. `npx convex deploy` to production (B6).
9. Production auth: self-only issuer, real sign-in (B5).
10. Production email/OTP: C1–C3, then D1 mailbox receipt (C4).
11. Live provider verification with production keys; D10 on prod (D1–D6).
12. Production Evidence D run `--production-evidence`; D5/D7/D8 only if natural.
13. Mobile/desktop signing, App/Universal Links with the real domain (E1–E5).
14. Final UAT and sign-off.

Steps 1–4 precede everything: a release built before step 2 ships while a
live credential remains valid in every clone. Step 3 before step 2 destroys
the audit trail without killing the key.

### Phase 221 result

No source code changed. Documentation and one consistency test only.
Evidence D: **INCOMPLETE** (unchanged). Phase 184: **BLOCKED** (unchanged).
`main`: untouched. **Release decision: NOT READY.**

## Phase 222 — Agent-side revocation attempt of the leaked Freebuff OTP key

**Result: agent could NOT revoke. A1 remains BLOCKED. Nothing was simulated.**
Executed 2026-09-16 from the build sandbox with every tool and credential
available to the agent. No source code changed; no Evidence-D row changed;
no history rewrite executed; `main` untouched.

### 1. Credential identified (value never printed)

| Property | Value |
| --- | --- |
| Fingerprint | `sha256(value+"\n")[0:16] = b1ce18a1e85ba121`, length 33 |
| Blob | `e490ffda66bb5d8fcd63df8d49f5f8822126cc7f` → `src/convex/auth/emailOtp.ts` |
| Mechanism | hardcoded `x-api-key` header on `POST https://auth.freebuff.app/send_otp` (vly.ai-provisioned scaffold; `VLY_APP_NAME`) |
| Storage | Git history only — not in any env var, `.env*`, GitHub secret, or Convex env reachable by the agent |
| Still accessible to agent | yes, as a Git blob (that is the exposure); confirmed by fingerprint match on the local object |
| Newest carrier commits | `2158077` (Phase 185, removed it from HEAD), `51c9dde` (`main` tip) |

### 2. Legitimate revocation surfaces probed — all absent or unauthorised

| Surface | Probe | Observed | Conclusion |
| --- | --- | --- | --- |
| Issuer credential / admin key in agent env | `env` names matching freebuff/vly/otp/convex/resend/smtp | none | no issuer identity to authenticate a revoke call |
| Issuer control plane | `https://auth.freebuff.app/`, `/send_otp`, `freebuff.app`, `vly.ai`, `api.vly.ai` | all `SSL_ERROR_SYSCALL`, HTTP 000; DNS resolves (Railway/Vercel); `api.github.com` 200 same network | egress-blocked; **no request can reach the issuer, so neither revoke nor the 401/403 proof is obtainable here** |
| Issuer public revoke/rotation API | vendor documentation search | none published; keys are project-scoped `sk_*` issued at project creation | no self-service API known |
| GitHub repo secrets / Dependabot / environment secrets | `gh secret list` (3 forms) | HTTP 403 `Resource not accessible by integration` / 404 | token is `arena-ai-coding-agent[bot]`; repo permissions `admin:false maintain:false push:false` — cannot read, let alone delete |
| GitHub deploy keys | `GET /repos/…/keys` | 403 | same |
| GitHub secret-scanning partner revocation | `GET /repos/…/secret-scanning/alerts` | 403 | not accessible; and Freebuff is not a scanning partner |
| Convex deployment env (where a *new* key would live) | `npx convex env list --names-only` | `No CONVEX_DEPLOYMENT set`; no `~/.convex` login | no Convex identity; also irrelevant to revoking the *old* key |
| Convex control plane | `api.convex.dev` | TLS severed (Phase 199/221) | — |

### 3. Capability boundary (why this is not a workaround problem)

Revocation is an action **at the issuer**. It requires (a) network reach to the
issuer and (b) an identity the issuer trusts to manage that project's keys.
The agent has neither: (a) is severed at TLS for every issuer host, and (b)
no vly/Freebuff account, token, or console exists in any environment the
agent controls. GitHub access is a bot integration without repository
administration. Deleting the file, rewriting history, or scanning source
would not touch the key's validity and are explicitly not substitutes.

### 4. Status after this phase

| Item | Status |
| --- | --- |
| A. Agent revoked the credential | **NO** |
| C. Old-credential 401/403 | **BLOCKED** — issuer unreachable; no request was made that could produce it |
| Phase 184 rewrite (5 refs) | rehearsed (Phase 221), **not executed** — gated on C |
| Evidence D | INCOMPLETE (unchanged) |
| Release decision | **NOT READY** (unchanged) |

The one action that clears this is human: whoever holds the vly.ai / Freebuff
project (the account that created this scaffold) revokes the key and records
an authenticated `send_otp` attempt with the **old** key returning 401/403.

## Phase 223 — Vendor-evidence audit: scope of the leaked Freebuff OTP credential

**Read-only. No project deleted/disabled, no endpoint probed with the key, no
credential printed, no rewrite, `main` untouched. A1 remains BLOCKED.**

### Finding: the credential is a SHARED PLATFORM KEY, not a project-scoped key

GitHub code search for `"auth.freebuff.app/send_otp"` (2026-09-16):

| Measure | Value |
| --- | --- |
| Files matched / distinct public repos | 101 / 94 |
| Files with a literal `x-api-key` | 83 |
| …of which fingerprint `b1ce18a1e85ba121` (ours) | **83 (100 %)** |
| …with a different literal key | **0** |
| Distinct owners carrying our fingerprint | **73** unrelated GitHub accounts |
| Files reading the key from env (`VLY_EMAIL_API_KEY`, `FB_EMAIL_API_KEY`, `FREEBUFF_EMAIL_API_KEY`, `RESEND_API_KEY`) | 12 — 2 of them still fall back to a literal with **the same fingerprint** |
| Non-code hits (docs, `.env.example`, phone OTP) | 6 |
| First / last commit dates carrying the key (83 sampled) | 2026-08-03 → **2026-09-15** (48 in Aug, 35 in Sep) |

One key, 73 unrelated owners, zero variants, still being emitted by the
scaffold in the last 24 h. **It is not ours to revoke.** Revoking it is a
platform-wide event that would break OTP sign-in for every Freebuff Web
project still on the scaffold default; only the issuer can do it, and only the
issuer can decide to.

### Evidence table

| CLAIM | SOURCE | EXACT EVIDENCE | CONSEQUENCE FOR OLD KEY | Status |
| --- | --- | --- | --- | --- |
| Vly → Freebuff Web migration is automatic; projects, URLs, dashboards persist | `vly.ai` notice; `freebuff.com/blog/vly-becomes-freebuff-web` | "vly.ai has been acquired by Freebuff… transfer projects in Settings if your GitHub email is different"; "Existing projects migrate automatically… nothing breaks" | the Vly-era project still exists under a Freebuff Web account owned by whoever scaffolded it | VERIFIED |
| Scaffold OTP host moved `auth.vly.ai`→`auth.freebuff.app`; same key retained | 83 public repos, all Aug–Sep 2026 | identical file, identical fingerprint across 73 owners | issuer change did **not** retire the key | VERIFIED |
| Key is embedded by the generator, not issued per project | distribution above; scaffold `.env.example` placeholders differ per repo while the literal does not | 0 variants in 83 | project settings cannot carry a per-project revoke for it | VERIFIED (by distribution) — INFERRED as design |
| Newer scaffold reads env var and a third-party repo says "old key… now revoked/rotated" | `Alot1z/packwise` `emailOtp.ts` comment, 2026-08-09 | comment text only | **not evidence** — a user comment; key still appears in scaffolds 5 weeks later | UNKNOWN / contradicted |
| Direct revoke/rotate API or console for this key | freebuff.com docs (404), ToS, blog, `@vly-ai/integrations` README, code search (`openapi`/`api-keys`/`revoke` + host) | none published; README only says "get your deployment token from the dashboard" (that is `VLY_INTEGRATION_KEY`, a different credential) | no documented self-service path | VERIFIED absent |
| Deleting/disabling a project invalidates the key | ToS "Delete project… do not by themselves delete data already collected"; no doc ties the OTP key to a project | key is shared across projects, so a per-project action cannot invalidate it | **NO** | VERIFIED NO (follows from shared scope) |
| `auth.freebuff.app` has a public spec/repo/admin surface | code search: only CSP allow-lists and `auth.config.ts` issuer defaults reference it; `CodebuffAI/codebuff` 0 hits | server is closed-source; no OpenAPI, no error-semantics doc, no key-management endpoint | only the issuer backend can revoke | VERIFIED (absence) |
| ToS forbids self-help against the service | ToS "Prohibited Uses" | "Access, extract, expose… access credentials"; "Gain unauthorized access to… connected systems" | no lawful non-support technical path | VERIFIED |

### Consequences for this repository

1. **Xstarz never depended on the key's validity** (Phase 185 removed the
   Freebuff path; `no-freebuff-otp-dependency` preflight PASS). Our exposure
   is contributory — one of ≥83 public copies — not unique.
2. **A1 cannot be satisfied by the operator either.** The gate text "old key
   presented and refused (401/403)" presumes a key the project owns. It does
   not. The only actor who can produce that evidence is Freebuff, Inc.
3. **Phase 184 rewrite remains gated**, but the gate condition is restated
   truthfully: *issuer-confirmed revocation (401/403) **or** a documented
   issuer decision that the scaffold key is public-by-design and not a
   secret*. Either must come from the issuer; neither is available today.
4. Non-destructive actions still open to the project without vendor support:
   **none that change the key's validity.** Reporting the exposure to the
   issuer (`support@codebuff.com`) is the sole lawful lever.

| Item | Status |
| --- | --- |
| Agent/operator can revoke | **NO** (shared platform key) |
| Old-credential 401/403 | **BLOCKED** — issuer-only |
| Direct revoke API documented | **NO** |
| Delete/disable project guarantees invalidation | **NO** |
| Phase 184 rewrite | still gated; not executed |
| Evidence D / `main` | unchanged |

## Phase 224 — Work completed while Phase 184 stays gated

**Nothing in this phase changes a blocker status.** A1/A2/A3 BLOCKED (issuer),
B–E as in Phase 221, Evidence D INCOMPLETE, `main` untouched. This phase
removed build-platform residue that was a real product defect, and refreshed
docs to the current architecture.

### Actionable-now audit

| Candidate | Status | Outcome |
| --- | --- | --- |
| Production Convex config / codegen / required vars | BLOCKED_EXTERNAL | no prod deployment or deploy key exists; preflight ready (REJECTED 3 FAIL without inputs) |
| Production email transport / DNS | BLOCKED_EXTERNAL | account + domain absent |
| Provider keys / D10 prod | BLOCKED_EXTERNAL | keys absent; OKX dev PASS stands |
| Evidence-D prod prerequisites | BLOCKED_EXTERNAL | all downstream of B6 |
| Signing / Links / installer URL | BLOCKED_EXTERNAL | no signing material, no domain |
| UAT on devices | BLOCKED_EXTERNAL | no device / installer verification possible here |
| Legacy OTP runtime dependency | ALREADY_COMPLETE | `no-freebuff-otp-dependency` PASS (33 server modules); `emailOtp.ts` uses Xstarz transport only |
| **Platform plugin leaking runtime errors from production** | **ACTIONABLE_NOW → DONE** | `vlyPlugin()` injected `error`/`unhandledrejection` listeners into production `index.html` that `postMessage`d message/stack/file/line to `window.parent` with origin `"*"`. Removed from `vite.config.ts`. Before: 1 injected handler set in the bundle; after: 0 `parent.postMessage` in `dist/`. |
| **Global error swallowing + `Location.href` override in `main.tsx`** | **ACTIONABLE_NOW → DONE** | capture-phase handlers suppressed every uncaught error in production; an iframe-detect branch overrode `Location.prototype.href` so all hard navigations (incl. Convex Auth redirects) were discarded when embedded. Removed; `RootErrorBoundary` is the error surface. |
| Dev-only editor toolbar, unused AI-gateway client, unused platform error reporter | ACTIONABLE_NOW → DONE | deleted `vly-toolbar-readonly.tsx`, `src/lib/vly-integrations.ts`, `src/instrumentation.tsx`, `integrations.md` |
| Unused dependencies | ACTIONABLE_NOW → DONE | `@vly-ai/integrations`, `axios` removed (−41 packages); `bun.lock` deleted (CI and README use npm; `package-lock.json` is the lockfile) |
| README described the scaffold, not the product | ACTIONABLE_NOW → DONE | rewritten setup/auth sections to current architecture |
| `docs/AUTHENTICATION.md` env table pointed at deleted files | ACTIONABLE_NOW → DONE | updated |
| Generated `docs/i18n-key-usage.json` | ACTIONABLE_NOW → DONE | regenerated; zero stale paths |
| `VLY_CONVEX_AUTH_ISSUER` | ALREADY_COMPLETE (kept) | still the opt-in preview/dev federated issuer var; production refuses it (`issuerPolicy.ts`) |
| Lint backlog (`no-unused-vars` 867, `no-explicit-any` 540) | deferred | large mechanical sweep; not release-gating; baseline now **1510** (was 1517; delta is the deleted files) |

### Validation
tsc ✓ · `vite build` ✓ · full suite ✓ · eslint **1510** (new baseline) ·
`npm run mobile:verify` PASS · `convex:preflight` `no-freebuff-otp-dependency`
PASS · secret scan (diff) none · generated drift none.
Guard: `src/lib/platform-residue.phase224.test.ts`.

## Phase 225 — `no-unused-vars` backlog 867 → 5 (no behavior change)

**Nothing in this phase changes a blocker status.** A1/A2/A3 BLOCKED (issuer),
B–E as in Phase 221, Evidence D INCOMPLETE, `main` untouched, no deployment,
no history rewrite. Pure lint-debt reduction, done in reviewed batches; no
`eslint-disable`, no `@ts-ignore`, no dummy reads, rule stays `error`.

### Batches

| Batch | Category | Method | Count after |
| --- | --- | --- | --- |
| 1 | audit + AST classification (a–h) | typescript AST classifier over `eslint -f json` | 866 baseline (867 in Phase 224 minus one deleted file) |
| 2 `c0cf191` | (a) unused import specifiers | specifier-level removal only; side-effect / whole-statement imports untouched; 166 files | 170 |
| 3 `ce47f31` | (b/e) dead locals, module constants, one dead `interface` | statement removed only when initializer proven side-effect-free by AST (literal, identifier, member access, object/array literal, JSX, function expression) | 110 |
| 4 `446196a` | (c/d) parameters + destructured bindings | 38 trailing non-contract params removed and 18 call sites narrowed (tsc-driven); 14 contract params (`_ctx` Convex handlers, callback / interface / positional API signatures) renamed with the existing `_` convention — arity unchanged; object destructures pruned, positional array destructures use `_` | 86 |
| 5 `d4f3b0d` | manual residue review | each item read in context; test locals keep the invocation and drop only the binding; dead counters/flags removed; five never-called private helpers deleted (`evidence.ts` ×2, `forward-market-path.ts` ×2, `investor-portfolio-summary.ts`) | **5** |

`eslint.config.js` now states the rule explicitly: `argsIgnorePattern: "^_"`
(parameters only, the convention the repo already used 19 times),
`varsIgnorePattern: "^(?!)"` (locals/imports/types can **never** opt out),
`caughtErrors: "all"`, `ignoreRestSiblings: true`.

### Intentionally left (5) — latent logic, not dead code

| File | Symbol | Why not removed |
| --- | --- | --- |
| `src/components/Journal.tsx:103,115` | `handleClose`, `handleUpdateNotes` | Fully-formed close-trade / notes handlers that were never wired to the UI. Deleting them hides a missing feature; wiring them is a product change. |
| `src/lib/market-radar/provider-registry.ts:300,305` | `openInterest`, `fundingRate` | Coinglass adapter parses both but the returned snapshot omits them, while `candidate-builder.ts` / `radar.ts` read `source.derivatives.*`. This is a probable data-flow bug, not dead code; fixing it changes radar output and needs its own phase + tests. |
| `src/lib/position-protection/phase69-runtime-hardening.ts:540` | `hasSecret` | `NO_SECRETS_IN_ALERT` stage computes the check and then hard-codes `passed: true`. Removing the variable would cement the no-op; using it would change gate behavior. Needs a decision, recorded here. |

### Reviewed and kept (not flagged after batch 4)

Contract parameters renamed rather than removed: `src/convex/okx.ts` /
`treasury.ts` `_ctx`; `decision-support.ts` `_side`;
`alert-observability.ts`, `continuous-protection-controller.ts`,
`live-polling-service.ts`, `reconnection-engine.ts`,
`user-intelligence-feed.ts` `_now`; `provider-routing.ts` `_provider`;
`journal.ts` `_result`; `trader-intelligence.ts` `_confluence`;
`phase69-runtime-hardening.ts` `_instrument`; `market-radar/acquisition.ts`
`_now` (public `acquire()` signature, forwarded by `acquireBatch`).

### Validation

`tsc -b` ✓ · `vite build` ✓ · vitest 269 files / 9532 pass (12 skipped, as
before) after **every** batch · eslint total 1510 → **647**
(`no-unused-vars` 867 → 5; every other rule count unchanged) ·
`npm run mobile:verify` PASS · `verify-deployment-config`
`no-freebuff-otp-dependency` PASS (still REJECTED 3 FAIL on absent prod
inputs, as in Phase 224) · `docs/i18n-key-usage.json` regenerated, no diff ·
diff secret scan none · `src/convex/` touched only by two import-specifier
removals (`eia.ts`, `treasury.ts`), no handler/auth/schema change.

### Next
Phase 226: decide the three latent-logic items above (wire or delete
`Journal` handlers; return `derivatives` from the Coinglass adapter; make
`NO_SECRETS_IN_ALERT` real or drop the stage), each with tests. Lint
backlog after that is `no-explicit-any` (540), `prefer-const` (28).

## Phase 226 — Three latent-logic findings from Phase 225 resolved

**Nothing in this phase changes a blocker status.** A1/A2/A3 BLOCKED (issuer),
B–E as in Phase 221, Evidence D INCOMPLETE, `main` untouched, no deployment,
no history rewrite, `src/convex/` untouched.

| # | Finding | Decision | Commit |
| --- | --- | --- | --- |
| 1 | `Journal.tsx` `handleClose` / `handleUpdateNotes` unwired | **Wired close-trade flow; removed notes duplicate.** "→ Closed" now opens an exit-price prompt (`t.global.exit` / `confirm` / `cancel`). Confirm derives `pnl`, `pnlPercent`, `outcome` through the existing `computePnl` + `classifyOutcome`, direction from the immutable analysis snapshot. Missing inputs ⇒ `pnl` undefined / outcome `UNKNOWN`, never 0 (§196 §4). Cancel is a no-op. Lifecycle buttons remain exactly `VALID_TRANSITIONS[status]` — the same table `convex/journal.transition` enforces server-side with ownership; the component still holds local state only and calls no mutation. `handleUpdateNotes` deleted: `handleUpdateReview` already covers `notes`. | `a894f55` |
| 2 | CoinGlass OI / funding parsed but never delivered to the radar | **Real data-flow via a provenance bridge.** Audit: the only authenticated acquisition is `convex/coinglass.fetchDerivatives` (server key, provider `timestamp`, per-dataset `availability`); the Dashboard kept it on `LiveCandidateSource.derivativesData` but the radar mapping dropped it, so `RadarCandidateSource.derivatives` — read by `radar.ts` scoring and `candidate-builder.ts` — was always undefined. The registry adapter additionally could never authenticate (no `cg_api_key` header), was never selected by `acquireLiveData` (quote/ohlcv only), and stamped `lastPrice` `observedAt: Date.now()` / `FRESH` (non-realtime provider labelled live). New `market-radar/derivatives-bridge.ts` forwards only when provider = coinglass, payload `symbol` = instrument base asset, provider timestamp finite / not future / inside `assessFreshness` window, provider did not mark `unavailable`, and each dataset is flagged available with a finite value. Nothing defaults to 0; nothing surviving ⇒ `undefined` (MISSING). Registry adapter now returns `null` (still registered for capability/health). | `977ac6b` |
| 3 | `NO_SECRETS_IN_ALERT` computed `hasSecret` then `passed: true` | **Real check.** New `position-protection/secret-detector.ts`: credential-*shaped* patterns (AWS/Stripe/GitHub/Slack/Google keys, JWT, Bearer, PEM block, `key=value` assignments, URL key params, `process.env.*`) instead of the bare words `token`/`secret` that appear in market prose. Result names the pattern class only, never the value. Uninspectable input (circular / BigInt / throwing `toJSON` / `undefined`) is a FAIL. Both the pipeline stage and `runSecurityAudit.NO_EMBEDDED_SECRETS` use it: `passed = inspectable && !found`. | `2b14ee1` |

### Mutation tests (all killed)

| Item | Mutants | Killed by |
| --- | --- | --- |
| 1 | CLOSED via plain transition (old wiring); `pnl ?? 0`; direction forced `long` | `journal-close.phase226.test.tsx` (7/10, 2/10, 2/10 fail) |
| 2 | symbol check removed; OI defaulted to 0; timestamp back-filled with `now`; availability flags ignored; provider `unavailable` ignored; empty object instead of `undefined`; Dashboard bypasses bridge; registry adapter fabricates FRESH price again | `derivatives-bridge.phase226.test.ts` (1–3 fail each) |
| 3 | stage hard-coded `true`; uninspectable ⇒ pass; audit ignores inspectability; reason echoes value; word-based regex restored; stage reason dumps alert JSON | `secret-detector.phase226.test.ts` (1–3 fail each) |

### Validation

`tsc -b` ✓ · `vite build` ✓ · vitest **272 files / 9587 pass** (12 skipped) ·
eslint 647 → **643** (`no-unused-vars` **0**; no suppressions added) ·
`npm run mobile:verify` PASS · `no-freebuff-otp-dependency` PASS (preflight
still REJECTED 3 FAIL on absent prod inputs, as before) · i18n usage report
regenerated (referenced 979 → 981: `global.cancel/confirm/exit` now consumed;
`global.cancel` removed from the Phase 193 allowlist because the guard
correctly flagged it) · diff secret scan: only the detector regex and a
split-string PEM header in tests · provenance suites (market-radar, live
realism, provider resilience, provenance-fabrication 220, platform residue
224) all green · Evidence-D / Phase 184 text untouched.

### Next
Phase 227: `no-explicit-any` (540) — start with `src/convex/*` handler
signatures and provider JSON parsers, where `any` hides schema drift.

## Phase 227 — `no-explicit-any` 540 → 376, typed provider boundaries

**Nothing in this phase changes a blocker status.** A1/A2/A3 BLOCKED (issuer),
B–E as in Phase 221, Evidence D INCOMPLETE, `main` untouched, no deployment,
no history rewrite. Runtime `src/convex/` **was** changed (see defects below);
it is not deployed by this phase.

### Counts

| Scope | Before | After |
| --- | --- | --- |
| Total `@typescript-eslint/no-explicit-any` | 540 | **376** |
| `src/convex/**` | 100 | **0** |
| `src/lib/**` (non-test) | 47 | **0** |
| UI (`src/components`, `src/pages`) | 34 | **17** |
| Tests / scripts | 359 | 359 (untouched by design) |
| `no-unused-vars` | 0 | 0 |
| Suppressions (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`) added | — | **0** |
| `unknown` + unchecked `as` casts introduced | — | **0** |

By category (of the 164 removed): **D** framework ctx / index-callback types
≈ 70 · **C** provider JSON → `unknown` + guards ≈ 55 · **B** `catch (err:
any)` → `unknown` + `errorMessage()` 22 · **A** trusted internal types (Doc,
DependencyGroup, CapabilityQuality, union validators) ≈ 15 · **E** dynamic
payloads → `Record<string, unknown>` 2.

### Verified defects surfaced by the casts (behavioural changes)

| # | Where | Defect | Fix | Commit |
| --- | --- | --- | --- | --- |
| 1 | `alertRules`, `notifications`, `notificationPreferences`, `runtimeHealth` | `userId` column was `identity.subject` cast `as any`. Convex Auth mints subject `userId\|sessionId`, so these tables were keyed **per session** — every re-login orphaned the user's rules/notifications/preferences (schema validation off let it through). | `lib/authUser.authUserId()` = library `getAuthUserId` → `Id<"users">`. Existing rows written with the composite key are not migrated (they were never readable across sessions anyway); documented, no data deleted. | `d30ac8c` |
| 2 | `journal.transition` / `updateFields` | `{"timestamps.updatedAt": now}` behind `Record<string, any>`; `db.patch` has no dotted-path semantics → wrote a literal top-level key, never updated `timestamps.updatedAt`. | Typed nested patch `timestamps: {...entry.timestamps, updatedAt}`. | `d30ac8c` |
| 3 | `convex/coinglass` fetchers | `parseFloat(x \|\| "0")` turned an **absent** funding rate / OI / L-S ratio / liquidation into a **0 reading marked available**. | Absent/non-numeric → `undefined` → leg unavailable (feeds Phase 226 bridge correctly). | `6a61226` |
| 4 | `convex/alphaVantage` | non-numeric sentiment/relevance → `NaN` in evidence. | `undefined`. | `6a61226` |
| 5 | `convex/tradingEconomics` | object cells stringified to `"[object Object]"`; object datetime passed to `new Date`. | Dropped / `undefined`. | `6a61226` |
| 6 | `lib/data/providers/twelve-data.fetchPrice` | quote stamped `timestamp: Date.now()` (Phase 220 E2 class). | Provider `timestamp` (s→ms, 1e9–1e11 window, same as `resolveProviderPriceTimestamp`); no provider time ⇒ throws (unavailable). NaN candles dropped. | `bbf3436` |
| 7 | `lib/data/crypto/defillama-adapter` | latest TVL point without numeric `tvl` ⇒ `current: 0`. | Invalid points filtered; no TVL dataset. | `bbf3436` |
| 8 | `lib/data/universal/engines` | provenance rows were `IntelligenceMeta` pushed `as any` → lacked `fetchedAt`/`instrument`/`instrumentVerified`. | `toProvenance()` projection (`fetchedAt` = ctx `assembledAt`, `instrumentVerified: false`). | `03d0643` |
| 9 | `NotificationCenter` | eight per-field `as any` reads of stored prefs. | `validatePreferences()` guard; invalid record ⇒ defaults. | `6fefd54` |

All other conversions are type-only (verified by the pre-existing suites:
277 files / 9745 pass).

### New helpers

`src/convex/lib/json.ts` and its lib-side twin `src/lib/data/json/narrow.ts`
(`isRecord`, `field`, `asString`, `asNonEmptyString`, `asFiniteNumber`,
`asRecordArray`, `errorMessage`) — return `undefined` on shape mismatch,
never `0`/`""`/`Date.now()`. `src/convex/lib/authUser.ts` (`authUserId`,
shared typed `resolveUser`).

### Mutation tests (all killed)

| Batch | Mutants | Killed by |
| --- | --- | --- |
| 1a | authUserId returns raw subject; resolveUser looks up raw subject; module bypasses helper; journal dotted key restored (4) | `auth-user.phase227.test.ts` |
| 1b | asFiniteNumber unchecked number / zero fallback; asRecordArray bypass; cg missing rate → 0; cg wrong symbol; cg unchecked cast; AV NaN score; AV title/url bypass; AV Symbol bypass; TE Date.now fallback; TE object cell; TE unchecked array; TD missing close accepted; TD Date.now; TD values unchecked (15) | `provider-json.phase227.test.ts` (3 survivors on first run → tests strengthened, re-run killed) |
| 2 | narrow.ts ×3; DeFiLlama zero points / always-reliable / unchecked cast; Tokenomist coercible object date / NaN amount; CoinGlass errorCode cast / dominantSide cast / reliable bypass; twelve-data ts unchecked / Date.now / price unchecked / partial OHLC check / bad datetime (16) | `adapters.phase227.test.ts`, `twelve-data.phase227.test.ts` (3 survivors → strengthened, killed) |

### Remaining `any` (376) and why

* **359 in tests/scripts** — out of scope for this phase (test doubles,
  i18n fixtures). Safe to address later; no runtime exposure.
* **17 runtime, UI**: `Dashboard.tsx` ×7 (`fromDbRecord(record: any)`,
  `intelligenceResult/derivativesResult/calendarResult: any`,
  `Promise<any>[]`, two `(e: any)` on calendar events) — the page's fetch
  orchestration types flow from four Convex action return types; retyping is
  a page-pipeline refactor, not a boundary fix. `PositionProtectionDashboard`
  ×4, `TraderWorkspace` ×4, `Journal.tsx` ×2 (`(entry as any)[field]` dynamic
  review-field access) — each needs a small discriminated-union or keyof
  refactor of component props; deferred as not clearly-safe in this phase.
* Pre-existing, out of scope, noted: `convex/coinglass` leg fetchers swallow
  every error (`catch { return undefined }`), so the RATE_LIMIT/AUTH_ERROR
  classification in `cgFetch` never reaches the Phase 178b rejection check
  (test documents this; not changed here).

### Validation

`tsc -b` ✓ · `vite build` ✓ · vitest **277 files / 9745 pass** (12 skipped) ·
eslint errors 515 → 451 (`no-explicit-any` **376**, `no-unused-vars` **0**) ·
`npm run mobile:verify` PASS · `no-freebuff-otp-dependency` PASS (preflight
still REJECTED 3 FAIL on absent prod inputs, as before) · generated drift none
(`src/convex/_generated` untouched) · diff secret scan: only `"k"`/`test-key`
test stubs · provenance suites (market-radar, live realism, provider
resilience, provenance-fabrication 219/220, platform residue 224) green ·
Phase 204 identity test extended to accept the shared `lib/authUser` import ·
Phase 197 structural regex updated to the typed `errorMessage(err) || t…`
form (same intent: backend reason preferred) · Evidence-D / Phase 184 text
untouched.

### Release blockers (unchanged)

A1 issuer credential not revocable by us (Phase 223) · Phase 184 history
rewrite blocked on A1 · production email transport / sender / required vars
absent (preflight 3 FAIL) · Evidence D INCOMPLETE.

### Next
Phase 228: the 17 UI `any`s (Dashboard fetch pipeline typed from the Convex
action return types; `Journal.tsx` review fields via `keyof`), then the
CoinGlass leg-fetcher error swallowing noted above.

## Phase 228 — UI `no-explicit-any` 17 → 0; CoinGlass leg-failure propagation

Base `257ebb3`. Commits: `681f341` (Part A), `7218ddd` (Part B), plus this docs commit.

### A. UI `no-explicit-any` — baseline → final (by file)
| File | Baseline | Final |
|---|---|---|
| `src/pages/Dashboard.tsx` | 7 | 0 |
| `src/components/PositionProtectionDashboard.tsx` | 4 | 0 |
| `src/components/TraderWorkspace.tsx` | 4 | 0 |
| `src/components/Journal.tsx` | 2 | 0 |
| **Runtime total (src minus tests/scripts)** | **17** | **0** |

Framework exceptions: none needed. Repo-wide `no-explicit-any` = 360, all in `*.test.*` / `scripts/` (out of scope by instruction). `no-unused-vars` = 0. Suppressions added (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`) = 0. `as any` added = 0.

### D. Dashboard typing approach
- `fromDbRecord` moved to `src/lib/analysis/from-db-record.ts`, parameter typed as `Doc<"analyses">`. The schema stores enum-like columns as strings; each is checked against the domain union. Drift maps to the **conservative** member: recommendation → `NO_TRADE`, bias → `Neutral`, conviction → dropped, `dataCompleteness` → `partial`, factor scores outside −2..2 → 0. Bias-derived recommendation for legacy rows without the column is preserved verbatim. `priceSnapshot` uses the row timestamp (no `Date.now`).
- Fetch legs typed as `Awaited<ReturnType<typeof useAction(api.…)>>` — the Convex action return type is the canonical contract; no duplicate interfaces. `Promise.allSettled` now a typed tuple (derivatives leg is `Promise.resolve(null)` for non-crypto).
- Verified defect exposed by typing: `fundamentals.revenueGrowth` was read on `FundamentalData`, which has no such field — always `undefined` at runtime. Read removed with a comment; equity context field stays optional/absent (no behavior change).
- Regression suite `from-db-record.phase228.test.ts` (10 tests): well-formed row, legacy bias-derived recommendation, drifted recommendation/bias/conviction/style/completeness, factor clamp, price-only snapshot, summary-only intelligence blocks, missing sentiment score.

### PositionProtectionDashboard / TraderWorkspace
- `UserPosition.assetClass` is a free string → `toNewsAssetClass()` narrows to `NewsItem["assetClass"]`; unknown → `"other"` (never a guess). `instrumentType` literal now type-checks against the action arg union. Article mapping typed from the action return; Convex timeline map typed as `NonNullable<query return>`.
- TraderWorkspace: `PortfolioConflict/Alignment/WatchItem` fields used directly (`description`, `reason`); previous `?? fallback` chains read fields (`positions`, `w.description`) that do not exist on those types. `techDir` typed `EvidenceDirection`. BUY/SELL/LONG/SHORT/WAIT/NO_TRADE typing, LOCKED redaction and mutation semantics untouched.

### E. Journal `keyof` approach
`JournalReviewField` / `JournalTradeField` unions in `src/lib/journal.ts` (used by `updateReview` / `updateTradeInfo` signatures); Journal handlers typed to them; review-field array uses `satisfies [JournalReviewField, string][]`; `entry[field]` accessed directly. Phase 226 close/PnL tests green.

### F. CoinGlass leg taxonomy + propagation (Part B)
Defect (from §227 follow-up): every leg fetcher ended in `catch { return undefined }`, so `cgFetch`'s RATE_LIMIT/AUTH_ERROR throw never reached the Phase 178b rejection check. Confirmed by the pre-fix Phase 227 test: a code-429 body on all legs returned `success: true, confidence: "unavailable"` **and was cached** — indistinguishable from "no derivatives market data". Additionally HTTP-level 429/401/403 were a generic error (only the JSON `code` path classified).

Fix (`src/convex/coinglass.ts`):
- Per-leg `LegOutcome<T>` = `ok | unavailable | malformed | timeout | network | provider_error`; fatal classes `RATE_LIMIT` / `AUTH_ERROR` are **rethrown** by `runLeg()` so the existing Phase 178b loop throws out of the cache fetcher (nothing cached) and the action returns the existing `RATE_LIMIT` / `AUTH_ERROR` envelope. HTTP 429 → RATE_LIMIT, HTTP 401/403 → AUTH_ERROR (same as JSON codes). Non-JSON body → `malformed`; `TimeoutError`/`AbortError` → `timeout`; undici `TypeError` → `network`; non-2xx / non-zero code → `provider_error`.
- Partial acquisition: **option B**, using the existing contract only — surviving legs kept; failed legs stay `undefined` with `availability.x=false`; per-leg `class (reason)` string on the pre-existing `CryptoDerivativesData.error` field. A leg that answered with nothing usable stays `unavailable` and is *not* reported as an error (Phase 227 contract preserved).
- If **every** leg failed for transport/provider reasons (nothing parsed), the fetcher throws → `API_UNAVAILABLE`, not cached. All-legs-answered-empty remains `success + confidence: unavailable` (§227).
- Downstream: `coinglass-adapter.toErrorCode` passes RATE_LIMIT/AUTH_ERROR through unchanged; `derivatives-bridge` (Phase 226) forwards only surviving legs; a fatal envelope has no `data`, so the radar sees "no derivatives payload", never a market condition. No zero/`Date.now` fallbacks added; credential asserted absent from error envelopes.

### G. Mutation tests (Part B) — 17/17 killed
catch→undefined in `runLeg`; 178b check → `continue`; HTTP 429 → generic; HTTP 401/403 → generic; failed leg → `{}`; failed leg → zero rate; error metadata omitted; aggregate available despite total outage; timeout→unavailable; network unclassified; malformed→provider_error; `unavailable` counted as outage; action RATE_LIMIT→API_UNAVAILABLE; fabricated timestamp 0; summary includes unavailable legs; fatal check inspects first leg only; `rate` msg heuristic removed. No-op mutant survived (harness valid).

### H. Regression tests
`coinglass-legs.phase228.test.ts` — 33 tests: valid; RATE_LIMIT ×4 legs + HTTP + all-legs + heuristic + cache not poisoned; AUTH HTTP 401/403 + JSON + secret absent; timeout/network/malformed/500 partials; missing leg; mixed; mixed-with-fatal; no zeros; outage (all timeout / all 500); all-empty §227 contract; provenance (`observed-now`, finite timestamp, partial cached with metadata, single round of 4 calls); radar bridge on partial and fatal; classifier units. `from-db-record.phase228.test.ts` — 10 tests. `provider-json.phase227` code-429 test updated to the fixed behaviour.

### I. Gates
`tsc -b` 0 · vitest 279 files / 9788 pass / 12 skipped · `vite build` ok · eslint runtime `any` 0, unused 0 · mobile:verify PASS · `_generated` untouched · diff secret scan clean.

### J. Provenance / security
All Phase 178/178b/178d/178e/176/167/219/220/226 guard suites green; convex:preflight `no-freebuff-otp-dependency` PASS (3 FAIL on absent prod email vars — unchanged, see below).

### L. Release blockers (unchanged)
A1 issuer credential not revocable by us; Phase 184 history rewrite BLOCKED on A1; production email transport/sender/required vars absent; Evidence D INCOMPLETE (D1 BLOCKED, D5/D7/D8 NOT_VERIFIED).
