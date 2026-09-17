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
| A2 | History rewrite across **all eight** refs | Security | rehearsed (Phase 221, 5 of 8 refs, see below) | n/a | — | A1 recorded, then §3 of the runbook, then verifier `--expect-clean` exit 0 |
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
A1 revoke ──► A2 rewrite (8 refs) ──► A3 zero occurrences ──┐
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
| Source secret scan clean at HEAD | the leaked credential is dead — only the issuer's 401/403 proves that; history still carries it in 8 refs |
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
unexecuted** and gated on A1.

**Phase 233 correction.** The rehearsal above covered the five refs known at
the time. The remote now advertises **seven**: `01a0a92b` and `01a0ad26` were
created afterwards, are absent from the rehearsal, and — until Phase 233 —
were absent from both of the runbook's ref tables. Both carry 269 carrier
commits, so each would have survived a rewrite as a live path back to the
credential, defeating A3 entirely. The runbook's ref tables and this gate now
read seven; a rehearsal covering all seven is still required before A2 runs.
Per-ref evidence: `docs/secret-remediation-refs.json`.

**Phase 238 addition.** The remote now advertises **eight**: Phase 238 pushed
`arena/01a0adfb-trade-intel-bot` and added it to both runbook tables and to the
inventory in the same phase — the CI test job failed on the first push of that
branch precisely because the guard reads the live ref set from the remote and
the tables did not yet name it. Its row is derived rather than re-measured
end-to-end (the generator refuses to run in a shallow clone): `exposedAtTip:
false` was measured against that tip's own copy of `src/convex/auth/emailOtp.ts`
using the same fingerprint rule, and its 269 occurrences are the parent ref's
measurement, whose history it shares and whose single extra commit does not
touch that path. Re-run `node scripts/secret-ref-inventory.mjs` in a full clone
before executing §3.

### Release order — deterministic, not reorderable

1. Revoke the old Freebuff OTP key at the issuer (A1).
2. Capture the 401/403 rejection with the old key; record date/operator (A1).
3. Run the rehearsed rewrite across **all eight** refs; force-push mirror (A2).
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

## Phase 229 — Multi-leg provider failure semantics: Alpha Vantage + TickAtlas

Base `6afe7b8`. Commits: `6a66ad2` (Part A, Alpha Vantage + shared `lib/legOutcome.ts`), `46f9442` (Part B, TickAtlas), plus this docs commit. The Phase 228 CoinGlass taxonomy was extracted to `src/convex/lib/legOutcome.ts` and is now shared by all three multi-leg actions; each keeps its own envelope contract.

### A. Alpha Vantage — before / after
| Condition | Before | After |
|---|---|---|
| HTTP 429 | generic error → news leg swallowed → `success:true`, neutral zero-score sentiment stamped `Date.now()` | `RATE_LIMIT`, uncached |
| HTTP 401/403 | same as above (`success:true`) | `AUTH_ERROR`, uncached |
| `Note`/`Information` body | `RATE_LIMIT` (Phase 167/178b) | unchanged — verified intact |
| `"Error Message"` body (HTTP 200) | treated as a valid empty payload → `success:true` | `provider_error` per leg; `AUTH_ERROR` when it names the api key |
| timeout / network / 5xx on one leg | swallowed into neutral/placeholder block, `success:true`, no metadata | partial: leg `undefined`, `dataAvailable.x=false`, `error:"news: timeout (…)"` |
| both legs failing (transport/provider) | `success:true` with empty blocks | `API_UNAVAILABLE`, no acquisition claim |
| answered-but-empty (no feed / no Symbol) | `success:true`, confidence `unavailable` | unchanged (§227 contract) |
| malformed non-JSON | swallowed | `malformed` class |
| outer catch on `AUTH_ERROR` | `API_UNAVAILABLE` | `AUTH_ERROR` |

### B. TickAtlas — before / after
| Condition | Before | After |
|---|---|---|
| 429 / 401 / 403 on UPCOMING leg | `RATE_LIMIT`/`AUTH_ERROR` (178b) | unchanged |
| 429 / 401 / 403 on PAST leg | **discarded by `catch {}`** → `success:true` | `RATE_LIMIT`/`AUTH_ERROR`, uncached |
| timeout / network / 5xx / malformed on UPCOMING leg | swallowed → empty events → **cached `success:true`, macroRisk LOW, freshness `unavailable`** | `API_UNAVAILABLE` with leg class; nothing cached |
| same on PAST leg | silently dropped | partial: upcoming kept, `recentReleased=false`, `error:"recentReleased: timeout (…)"` (survives cache hit) |
| both legs answer zero events | `success:true`, confidence/freshness `unavailable`, LOW | unchanged (existing contract; a valid empty calendar is genuinely LOW event risk) |
| undated / unparseable event | dropped (Phase 219) | unchanged; mutant re-introducing `Date.now()` killed |

### C. Swallowed-error defects found (verified)
1. AV `avFetch` classified only the JSON `Note` path; HTTP 429/401/403 were generic and swallowed by the news leg into a fabricated neutral `SentimentData` (`averageScore:0`, `timestamp: Date.now()`).
2. AV fundamentals leg swallowed every non-`RATE_LIMIT` error into an `available:false` placeholder stamped `Date.now()` — indistinguishable from "no fundamentals for this symbol".
3. AV `"Error Message"` bodies (invalid symbol / invalid key) passed through as valid empty payloads.
4. AV outer catch mapped `AUTH_ERROR` to `API_UNAVAILABLE`.
5. TA past-leg `catch {}` discarded `RATE_LIMIT`/`AUTH_ERROR`.
6. TA upcoming-leg non-fatal failure produced an empty event list that was **cached** and served as a LOW-risk calendar.
7. Phase 178d test "dead transport does not report observed-now" encoded defect (1): single-leg transport death was `success:true`. Updated to `API_UNAVAILABLE` + no acquisition claim.

### D. Cache behaviour
Fatal classes never cached (unchanged 178b). New: a leg that failed for transport/provider reasons is never stored — ProviderCache only stores what the fetcher returns, and the fetcher now throws/returns `undefined` for that leg. Partial payloads (one leg ok) ARE cached with their `error` metadata intact; the failed AV dataset key stays empty and is re-fetched on the next call (asserted: 2 news calls, 1 OVERVIEW call). A news leg that succeeded before a fundamentals 429 remains cached — distinct datasets, real evidence.

### E. Partial-result semantics (option B, existing contracts only)
AV: `sentiment`/`macro`/`fundamentals` absent for a failed leg; `dataAvailable` reflects only surviving legs; `IntelligenceResult.error` (pre-existing field) carries `leg: class (reason)`. TA: `EconomicCalendarData.error` (pre-existing field) carries the past-leg failure; `availability.recentReleased=false`. Neither emits zeros, `{}`, or placeholder blocks.

### F. Timestamp / provenance
No new `Date.now()` as provider observation. Removed two fabricated `Date.now()` stamps (AV failed-news/failed-fundamentals placeholders). `acquisition`/`observedAt` derive only from completed cache reads; outage envelopes carry neither. TA payload `timestamp` = cache-reported acquisition time, preserved verbatim across hits (asserted).

### G. Mutation tests
AV 17/17 killed (catch→undefined, 429→generic, 401/403→generic, fatal→continue, AUTH→API_UNAVAILABLE, neutral zero block + Date.now, `{}` placeholder, metadata omitted, success despite all failed, macro from failed leg, Error Message ignored, apikey→provider_error, timeout→unavailable, malformed→provider_error, Note removed, failure cached as `{feed:[]}`; the shared-module "unavailable treated as failure" mutant is killed by the Phase 228 CoinGlass suite). TA 13/15 killed; 2 equivalent mutants documented (M6 mutates dead code after the throw; M9 `unavailable` class is unreachable because `extractEvents` always returns an array). No-op harness check performed in Phase 228.

### H. Regression tests
`alphavantage-legs.phase229.test.ts` 35 tests (items 1–12 of the brief). `tickatlas-legs.phase229.test.ts` 20 tests (valid; 429 both legs; 401/403 both legs; timeout/network/5xx/malformed upcoming = outage; past-leg partial + cached metadata; empty-valid contract; Phase 219; timestamp survival; credential absent). Guard updates: `provenance-wiring.phase178d` (defect 7), `cache-keys.phase178` (pins `runLeg` wiring + `isFatalLegError` rethrow).

### I. Gates
`tsc -b` 0 · vitest 281 files / 9837 pass / 18 skipped (6 extra skips vs §228 are env-gated bundle/native-shell assertions that need `dist/`+`cap sync` outputs; workspace was re-materialised from remote this phase) · `vite build` ok · eslint runtime `any` 0, unused 0, suppressions 0, `as any` 0 · mobile:verify PASS · `_generated` untouched · diff secret scan clean.

### J. Security / provenance
178/178b/178d/178e/176/167/219/220/226/228 suites green; preflight `no-freebuff-otp-dependency` PASS (email/sender/prod-vars FAIL unchanged).

### K. Remaining concrete defects (not deferred silently)
1. Single-leg providers `treasury.ts`, `cot.ts`, `eia.ts`, `okx.ts` have no 429/401/403 classification at all (0 matches) and `treasury.ts:38`, `eia.ts:51` use bare `catch {}` — out of this phase's scope (brief: AV + TA only).
2. `marketData.ts:439/513` bare `catch {}` — unaudited this phase.
3. Pre-existing eslint errors in `src/convex/liveProtection.ts:388` (`no-useless-escape` ×2) exist on base `6afe7b8`; not touched.
4. `protectedAnalysis.ts` intelligence leg passes `r.error` through `classifyFailure` text patterns; the new `leg: class (reason)` strings on a `success:true` partial are not consulted there (partial is still `success`, so behaviour is unchanged, but the fan-out cannot distinguish "partial" from "complete").

### L. Release blockers (unchanged)
A1 issuer credential not revocable by us; Phase 184 history rewrite BLOCKED on A1; production email transport/sender/required vars absent; Evidence D INCOMPLETE.

## Phase 230 — Single-leg provider failure semantics: Treasury + COT + EIA + OKX + marketData secondary paths

Base `2a98578`. Commits: `d700761` (Part A, Treasury), `2405e11` (Part B, COT), `1b00419` (Part C, EIA), `e187cef` (Part D, OKX), `1526566` (Part E, marketData secondary legs), `b966b55` (Part F, mutation suite), plus this docs commit. Scope is exactly the §229-K remainder: the four single-leg-ish providers and the two identified `marketData.ts` bare `catch {}` paths. The shared taxonomy (`src/convex/lib/legOutcome.ts`, Phase 229) governs every leg below; each provider keeps its own envelope contract.

### A. Treasury — before / after
| Condition | Before | After |
|---|---|---|
| HTTP 429 on any of 4 XML legs | silent absent leg; all-429 wave read as "no yield curve" miss | `RATE_LIMIT`, uncached, provider recovers |
| HTTP 401/403 | same as above | `AUTH_ERROR`, uncached |
| timeout/network/5xx on SOME legs | silent absent leg, indistinguishable from "not published yet" | partial: surviving legs cached, `error:"nominalPrevious: provider_error (HTTP 500 …)"` on the payload, replayed verbatim on a hit |
| ALL legs failing (transport/provider) | null fetch → ordinary NO_DATA-looking miss | `API_UNAVAILABLE` naming the classes, uncached |
| all feeds answer 200 with no `<entry>` | NO_DATA miss, uncached | unchanged (legitimate empty month) |

### B. COT — before / after
| Condition | Before | After |
|---|---|---|
| HTTP 429 | generic `HTTP 429` text (cached-safe by throw, but no class) | `RATE_LIMIT` envelope, uncached |
| HTTP 401/403 | generic text | `AUTH_ERROR` envelope, uncached |
| 5xx | generic text, downstream read as `network` (the `/fetch failed/i` heuristic) | `API_UNAVAILABLE` with `provider_error` in text |
| non-JSON / non-array body | generic error | `malformed` class |
| timeout / connection failure | generic error | `timeout` / `network` class |
| empty row set `[]` | `no usable reports` (§227 contract) | unchanged |

### C. EIA — before / after
| Condition | Before | After |
|---|---|---|
| 429 / 401 / 403 on ANY product leg | folded into a per-leg reason string; **the all-failed payload was CACHED for 6h** (an invalid key poisoned the dataset) | fatal from any leg → `RATE_LIMIT`/`AUTH_ERROR`, nothing cached; the api key never appears in any envelope |
| ALL legs failing (timeout/network/5xx/malformed) | all-failed payload **cached 6h**, replayed as an acquisition record | `API_UNAVAILABLE` ("every leg failed (…)"), uncached — the 6h poison is closed |
| SOME legs failing | per-leg reason string | `${class}: ${reason}` per failed leg on the cached payload; replays through `failedLegs` verbatim on a hit |
| EIA error body / answered-empty | per-leg answered contract | unchanged (a real answer is not an outage) |

### D. OKX — before / after (D10 contract preserved)
| Condition | Before | After |
|---|---|---|
| spec fetch 429/401/403 | generic `OKX endpoint returned HTTP <s>` | named classes thrown (`RATE_LIMIT`/`AUTH_ERROR` in envelope text); still nothing cached |
| spec 5xx / malformed / network | generic error | `ProviderHttpError` / `ProviderMalformedError` / transport class |
| order book literals | `OKX order book returned HTTP <s>.`, `network failure: …` | **unchanged, byte-pinned by Phase 211 D10**; free-text envelopes, NO `errorCode` — asserted |
| native error codes (`code != "0"`) | `parseWarnings` / `provider error code …` reason | unchanged (audited; no classification added where the wire contract doesn't expose one) |

### E. marketData secondary paths — before / after
| Condition | Before | After |
|---|---|---|
| 429/transport failure during DXY candidate probing | laundered into "all candidates verified invalid" → **24h negative-cache poison** (`dxyAllCandidatesFailedAt`) | INCONCLUSIVE: nothing armed, nothing resolved; probing resumes next analysis; reason names the class |
| verified-invalid DXY wave (all 404/empty) | 24h negative cache | unchanged (Phase 7C contract; asserted no probes on the next analysis) |
| comparator fetch failure (e.g. NDX 429/timeout) | `no comparable series returned by the provider` | `comparator series for X could not be fetched: RATE_LIMIT/timeout (…) — primary data unaffected`; a definitive series answer (4xx/empty) keeps the old wording |
| outer cross-asset catch | bare `catch {}`, unattributed reason | classified reason in `unavailableReason` |
| outer action catch | everything → `API_UNAVAILABLE` | defensive pass-through of `[429]`/`[401]`/`[403]` as `RATE_LIMIT`/`AUTH_ERROR` (§229 AV fix, generalised) |
| FX leg 429/401/403 (HTTP **or** JSON `code`) | `catch { return null }` → "no FX quote available" | THROWN from the fetcher (one shared API key) → `RATE_LIMIT`/`AUTH_ERROR` envelope, uncached |
| BOTH FX legs failing (transport/provider) | "no FX quote available" | `API_UNAVAILABLE` naming both leg classes, uncached |
| FX partial (one leg ok), both-empty | cached partial / "no FX quote available" miss | unchanged contracts |
| live-quote `.catch(() => null)` (line ~257) | silently falls back to last-candle close | **audited, unchanged**: the fallback price is provider-observed (candle `datetime` via Phase 220), nothing is cached for a failed quote fetch, and no claim is made — the catch cannot launder a failure into evidence |

### F. Downstream classification repair (`"fetch failed"` heuristic)
`classifyFailure` (Phase 177) matches `/fetch failed/i` as NETWORK, so every non-fatal envelope wrapped as `X fetch failed: <class>` was relabeled "network" regardless of the real class. The five non-fatal envelope prefixes introduced/kept by this phase use `X request failed:` (treasury, COT, EIA, FX, OKX-spec), so class text survives downstream: `RATE_LIMIT`/`429` → rate-limit (breaks the retry loop), `network (fetch failed)` → network, `malformed` → invalid-response, `provider_error`/timeout text → conservative `unavailable`. Known limitation (pre-existing, out of scope): envelope *text* "timeout" still classifies as `unavailable`, not `timeout`, because envelope-path classification only breaks retries on `rateLimited`; no behavioural change on the envelope path.

### G. Cache behaviour
Fatal classes never cached (178b, re-asserted per provider). EIA/Treasury outage waves are never stored (closed poisons). Partial waves ARE cached with failure metadata (per-leg `error` string / `failedLegs` `${class}: ${reason}`), replayed verbatim with original `observedAt` (asserted). Answered-but-empty keeps each provider's existing miss contract, uncached. The DXY negative cache is armed ONLY by verified-invalid waves (7C contract re-asserted both ways). OKX order book remains uncached by design.

### H. Timestamp / provenance
No new `Date.now()` as provider observation. FX success `observedAt` still derives from the real quote time (`direct?.timestamp ?? inverse?.timestamp`). Treasury/EIA/OKX-spec action-level `observedAt`/`acquisition` untouched. The marketData primary path (Phase 220 provider-observed price time) untouched.

### I. Mutation tests (Part F) — 18/18 CAUGHT, 0 gaps
treasury 429 unclassified; treasury outage-not-thrown; treasury metadata dropped; treasury outer RATE_LIMIT→generic; cot 429 unclassified; cot class hardcoded; EIA outage cached again; EIA 401/403 not AUTH; EIA failed-leg class stripped; okx spec 429 unclassified; okx book literal rewritten (D10 pin); DXY poison armed by transport; DXY inconclusive-guard removed; FX HTTP 429 unclassified; FX JSON `code:429` unclassified; FX outage reported as no-quote; outer defensive map removed; EIA outer AUTH_ERROR→generic. `scripts/mutation-suite-phase230.sh`, byte-exact restore via `cmp`.

### J. Regression tests
72 new tests across 6 suites: `treasury-legs.phase230.test.ts` (12), `cot-legs.phase230.test.ts` (10), `eia-legs.phase230.test.ts` (14, incl. api-key credential absence), `okx-legs.phase230.test.ts` (13, incl. downstream `classifyFailure` on envelopes + D10 pins), `fx-rate-legs.phase230.test.ts` (12), `marketdata-secondary-legs.phase230.test.ts` (11, incl. helper units and the defensive-map source pin). All §178/178b/178c/178d/176/177/167/219/220/226/227/228/229/211 (D10)/7C guard suites green — including the pins this phase consciously preserved (`okx.ts` free-text/no-`errorCode`, order-book literals, DXY memo wiring, cache raw-payload shapes).

### K. Gates
`tsc -b` 0 · vitest 287 files / **9915 pass** / 12 skipped (229 baseline: 281 files / 9837 pass / 18 skipped; the 6 env-gated bundle/native-shell assertions are active again because `dist/` now exists in this workspace — 9843 + 72 new = 9915) · `vite build` ok · eslint: changed files 0 errors, runtime `no-explicit-any` 0, unused 0 (tests/scripts `any` untouched and out of scope, per phase brief) · mutation suite 18/18 · mobile:verify PASS (placeholder deep-link values unchanged) · preflight `no-freebuff-otp-dependency` PASS; 3 FAIL on absent prod email vars — unchanged · `_generated` untouched · diff secret scan clean.

### L. Security / provenance
Credentials asserted absent from every new envelope (EIA `SECRET-VALUE-XYZ` 403 test; Twelve Data FX 401 test). EIA surfaces only the provider's own error text, never the `api_key` query value (error strings are built from `res.status`/`res.statusText`/provider `error` field, never the URL). OKX order-book native-code path audited and left unchanged.

### M. Remaining concrete defects (not deferred silently)
1. `classifyFailure` envelope-path has no timeout-text pattern (see §F); a global fix touches the Phase 177 shared module used by every provider and is out of this phase's scope.
2. The live-quote leg `.catch(() => null)` cannot distinguish "no quote" from a quote-leg 429; the consequence is benign by construction (uncached, provider-observed fallback price, no claim) but a 429 there is invisible. OKX order book 401/403 likewise stay free-text `unavailable` downstream (no credential exists to classify).
3. `protectedAnalysis.ts` slow-group wrapper (`budgeted`) maps a failed optional-slow leg to `{success:false}` and drops the error text before `fetchOptionalSlowData`; Phase 230 classes travel correctly through `runProviderLeg` for the named legs, but the group-level diagnostics still cannot see per-leg class text from failed optional legs.
4. Pre-existing: `liveProtection.ts:388` eslint `no-useless-escape` ×2 (exists on base, untouched); tests/scripts `no-explicit-any` untouched per phase brief.

### N. Release blockers (unchanged)
A1 issuer credential not revocable by us; Phase 184 history rewrite BLOCKED on A1; production email transport/sender/required vars absent; Evidence D INCOMPLETE.

## Phase 232 — market-data envelope `acquisition` / `observedAt` passthrough

Base `3f63690` (the Phase 230 merge tree). Scope is one defect on the protected
fan-out: the market-data leg was the only leg that did not forward the
acquisition metadata its own action already produces.

**Session provenance (material to this record).** Phase 231 was authored in a
different session's sandbox as commit `f1bfbb4` and was **never pushed**. That
commit is absent from this repository's history and from every remote ref
(verified: `git cat-file`, `rev-list --all --objects`, `git log --all
--grep=f1bfbb4`, `git ls-remote`). It could not be fetched, bundled, or
reconstructed here. Phase 232 was therefore implemented **directly on the Phase
230 base**, not on top of Phase 231. The brief's "Phase 231 complete/partial/
fatal semantics must remain unchanged" is satisfied vacuously: no such taxonomy
exists in this tree (no `complete`/`partial`/`fatal` leg state anywhere in
`src/`, and `marketData.ts` imports only `classifyLegError` from
`lib/legOutcome`). **If `f1bfbb4` is later recovered it will conflict with this
phase and must be reconciled deliberately.**

### A. The defect — before / after
| Condition | Before | After |
|---|---|---|
| cold acquisition, all sub-legs healthy | `market-data/ohlcv = unavailable` (acquisition had completed; the fan-out summary on the same run said `market-data=success`) | `market-data/ohlcv = observed-now(age Nms, used)` |
| warm acquisition (candle cache hit, 60s TTL) | `unavailable` — the reuse was invisible | `market-data/ohlcv = cache-reused(age Nms, used)`, age carrying the ORIGINAL observation |
| `unavailableCount` in the totals line | `1 unavailable` on a fully healthy run | `0 unavailable` |
| `used` marker on the engine's most important leg | suppressed (`legFromFailure` reports `acquired:false`) | present |

Root cause, exactly one omission. `fetchMarketData` has always emitted
`acquisition: envelopeAcquisition(candleAcquisitions)` and
`observedAt: oldestObservation(candleObservations)`; `runProviderLeg` has always
forwarded both verbatim and never invents one; the provenance builder has always
honoured them. Only the `acquiredLeg` call site in `protectedAnalysis.ts`
dropped them — every other leg (alpha-vantage, tickatlas, coinglass, okx,
treasury, eia) forwarded both. Because `ohlcv` is a cached dataset, the builder
received a successful leg with neither a mode nor an observation time, which is
indistinguishable from "the action degraded internally but still reported
success", and took its no-completed-cache-read branch.

Fix is 19 added lines, **purely additive** (0 deletions): forward both fields
verbatim, with no fallback of any kind.

### B. Envelope contract
Unchanged. `fetchMarketData` still returns `{success, data, technical, …}` plus
the two provenance fields; the passthrough is the only edit. Asserted against
the real handler.

### C. Cache behaviour
`ohlcv` (60s) and `quote` (20s) behave exactly as before. A cache hit still
returns the entry's ORIGINAL `observedAt` (`provider-cache.ts` never rewrites
it); the leg now surfaces that value instead of discarding it, so age grows
across reuse rather than resetting. Nothing was added to or removed from any
cache path.

### D. Timestamp / provenance
No new `Date.now()`. `observedAt` is forwarded verbatim; a `?? Date.now()`
fallback and a `mode ?? "observed-now"` default are both explicitly forbidden by
pinned assertions and by four of the seven mutants. The degraded case is
preserved: an envelope carrying NEITHER field still reports `unavailable` with
no age, no `used` marker and an incremented `unavailableCount` — the Phase 178d
integrity property, re-asserted for market-data. No historical-as-live, no zero
fallback, no symbol substitution (the leg identity stays `market-data`/`ohlcv`
and never collapses to the underlying vendor, and the requested instrument
reaches the action unchanged).

### E. Mutation tests (7/7 CAUGHT, 0 gaps)
`scripts/mutation-suite-phase232.sh`, byte-exact restore via `cmp`, INVALID on a
no-op. Both failure directions are covered, because they are opposites:
dropping the acquisition mode (M1), dropping the observedAt (M2), dropping both
— the exact pre-phase defect (M3); and fabricating — `observedAt ?? Date.now()`
(M4), acquisition defaulted to `observed-now` (M5), observedAt re-stamped with
the request clock (M6), acquisition hardcoded to `observed-now` (M7). Each
mutation targets the FIRST occurrence of its pattern, which is the market-data
leg; later occurrences belong to other legs and are left untouched.

### F. Regression tests
`src/convex/marketdata-envelope.phase232.test.ts` — **22 tests**, all green, run
against the real `runProtectedAnalysis` wired to the real provider handlers.
Covers a source-level wire pin that every `runProviderLeg` forwarding a provider
envelope carries both fields (so a future leg cannot reintroduce the omission),
the defect regression, the pre-fix signature asserted absent verbatim, the
`used` marker, the totals count, fan-out/provenance agreement, cache-hit
behaviour, growing age across reuse, verbatim passthrough against a pinned old
observation, age tracking the envelope rather than the clock, the degraded-envelope
guard in both its leg-state and count forms, identity, and a hard-failure leg.

**Non-vacuity is measured, not asserted:** with the 19-line fix reverted the
suite fails **14 of 22**. The 8 that still pass are exactly the negative guards
(no-fabrication, identity, degraded-envelope, hard failure) plus the
block-located precondition — i.e. the ones that must hold with or without the
fix.

### G. Gates
`tsc -b` 0 · vitest **288 files / 9930 pass / 1 fail / 18 skipped** (Phase 230
baseline 287 files / 9915 pass / 12 skipped; the 18-vs-12 skip delta is the
env-gated `dist/` assertions, absent in this workspace) · eslint on changed
files 0 · mutation suite 7/7 · `_generated` untouched · diff secret scan clean.
The single failure is **pre-existing and unrelated** — see §H.

### H. The one failing test (pre-existing, not introduced by this phase)
`src/lib/deployment/release-gate-consistency.phase221.test.ts` › "every
branch/tag known to the local remote-tracking set appears in the runbook" fails
in this workspace with `runbook missing ref heads/arena/01a0a92b-trade-intel-bot`.
The test enumerates `refs/remotes/origin` + `refs/tags` and demands each name
appear in `docs/SECRET-REMEDIATION-RUNBOOK.md`. It reads no source file this
phase touches.

Isolated by experiment, with the Phase 232 fix left in place throughout:
removing that tracking ref → 15/15 pass; restoring it → fails on that ref and no
other. The cause is a real remote branch (`arena/01a0a92b-trade-intel-bot`, the
PR #1 source) that the runbook does not enumerate; the runbook drifted when that
branch was pushed. Any workspace that fetches all remote branches sees it, which
is why the Phase 230 baseline did not. Deliberately NOT fixed here: the runbook
is a security document whose per-ref rows state credential-exposure facts that
must come from the history-fingerprint tooling, not from inference, and the
phase brief forbids unrelated commits. Also noted while investigating: the
runbook's per-ref status table listed only four refs and omitted the three
branches created since Phase 198 (`01a0a5f5`, `01a0a92b`, `01a0ad26`); the
rewrite map listed five and omitted the last two.

*Correction (Phase 233):* this paragraph also originally claimed
`refs/heads/arena/01a08e67-trade-intel-bot` appeared **twice** in the per-ref
table. Re-reading the file at HEAD shows four rows, each distinct, with no
duplicate. That claim was wrong and is withdrawn. The duplicate-row detection
added in Phase 233 is therefore a forward-looking guard against a hazard that
has not yet occurred, not a fix for one that had.

### I. Remaining concrete defects (not deferred silently)
1. The Phase 221 runbook-coverage test is sensitive to which branches the local
   clone has fetched, so it is green or red depending on the developer's fetch
   behaviour. Deriving the ref set from `git ls-remote` (or scoping it to refs
   the runbook claims to cover) would make it deterministic. Out of scope here.
   **FIXED in Phase 233** — the ref set now comes from `git ls-remote`, an
   unreachable remote fails closed rather than passing, and the check is split
   into inventory / exposure / coverage. See the Phase 233 section below.
2. `f1bfbb4` (Phase 231) remains unrecovered and unpushed. Its content is
   unknown to this repository; see the session-provenance note above.

### J. Release blockers (unchanged)
A1 issuer credential not revocable by us; Phase 184 history rewrite BLOCKED on
A1; production email transport/sender/required vars absent; Evidence D
INCOMPLETE.

---

## Phase 233 — deterministic ref source, runbook reconciliation, CI root cause

### A. Why the Phase 221 check was not trustworthy
`release-gate-consistency.phase221.test.ts` derived its subject set from
`git for-each-ref refs/remotes/origin refs/tags` — the LOCAL remote-tracking
set — and wrapped the call in `catch { return; }`. Its verdict was therefore a
function of the clone, not the repository:

| Clone state | Local refs seen | Old verdict |
|---|---|---|
| Full clone | all | fails on any ref the runbook omits |
| `fetch-depth: 1` (CI) | 1 | fails on that one ref (the CI failure at `:137`) |
| No origin refs | 0 | **passes without checking anything** |

The empty case is the serious one: a security check that goes green because it
did not run is worse than no check, and the bare `catch` made that state
indistinguishable from a genuine pass.

### B. What replaced it
Three concerns are now separate, because collapsing them is what made the old
failure unreadable:

1. **Inventory** — which refs exist. `git ls-remote origin`
   (`src/lib/deployment/live-refs.ts`). Depth-independent, never hardcoded.
2. **Exposure facts** — which refs reach the credential, and which serve it
   from the tip. `scripts/secret-ref-inventory.mjs`, by SHA-256 fingerprint
   reachability of the blob — blob identity, never lineage inference.
3. **Rewrite coverage** — what the runbook claims it will rewrite
   (`src/lib/deployment/runbook-ref-facts.ts`), checked against 1 and 2.

`listLiveRefs()` **fails closed**: an unreachable remote, or an empty/usable-less
reply, throws `LiveRefSourceUnavailableError` naming the failure as
infrastructure and explicitly NOT a clean result. Peaked tag objects (`^{}`)
are dropped so one tag cannot demand two rows.

### C. Verified inventory — all seven refs are affected
Re-measured at 397 commits (Phase 198 measured 339). Fingerprint, blob OID,
blob count and path are byte-identical to the Phase 198 record; the affected
commit count is **unchanged at 270** — the exposure neither grew nor was
silently remediated. Machine-readable: `docs/secret-remediation-refs.json`.

| Ref | Affected | Carriers | Exposed at tip |
|---|---|---|---|
| `heads/arena/01a08e67-trade-intel-bot` | yes | 269 | no |
| `heads/arena/01a0a5f5-trade-intel-bot` | yes | 269 | no |
| `heads/arena/01a0a92b-trade-intel-bot` | **yes** | 269 | no |
| `heads/arena/01a0ad26-trade-intel-bot` | **yes** | 269 | no |
| `heads/main` | yes | 261 | **YES** |
| `heads/phase-157-live-discovery-lifecycle` | yes | 262 | **YES** |
| `tags/rc-181` | yes | 269 | no |

`01a0a92b` and `01a0ad26` are affected and were in **neither** of the runbook's
tables. Both would have survived the rewrite as live paths back to the
credential, defeating A3. "Clean at tip" is not remediation — the blob stays
reachable in history — which is the distinction the old single-column table
blurred.

### D. Runbook reconciliation
Both tables now list all seven refs; the summary reads "All seven"; §3 states
that the Phase 221 rehearsal covered five of them and that `01a0a92b` /
`01a0ad26` have never been rehearsed; §4 carries the same scope caveat. §1's
heading records both measurements. Every value comes from the fingerprint scan.

### E. CI `Test suite` root cause — proven, not inferred
Actions log BLOBs are still unreachable from this sandbox
(`results-receiver.actions.githubusercontent.com`, `productionresultssa16.blob.core.windows.net`
→ HTTP 000). **Check-run annotations work** and supplied the failures:

| Location | Assertion |
|---|---|
| `handoff-readiness.phase200.test.ts:96` | `expected 'CREDENTIALS_REJECTED' to be 'NOT_REACHABLE'` |
| `handoff-readiness.phase200.test.ts:84` | `expected ['dns','tcp','tls','http'] to include 'auth'` |
| `release-gate-consistency.phase221.test.ts:137` | `runbook missing ref heads/arena/01a0ad26-trade-intel-bot` |

The two phase200 failures are **pre-existing and environment-dependent**: that
test shells out to `scripts/verify-convex-access.mjs`, which probes
`api.convex.dev`. Locally egress is blocked (`NOT_REACHABLE` / `blockedAt: tls`);
on a networked runner the probe reaches the service and is rejected
(`CREDENTIALS_REJECTED` / `blockedAt: auth`). The test asserts the first outcome,
so a networked CI fails it — the same class as the phase75 failure, where a
green local suite proved nothing because sandboxed egress was load-bearing. A
plain `npm test` replay at `3f63690` passes 287/287 both with and without
`CI=true`: the discriminator is network state, not clone depth or env.

The phase221 failure is cured by this phase — verified in a real `--depth 1`
clone of the GitHub remote, where the old oracle saw exactly one ref and the
new one sees all seven. The `history-secret-scan` job fails **by design**
(`continue-on-error: true`, exits 1 while the credential is reachable).

*Not changed here:* the phase200 assertions are a pre-existing defect and were
left untouched deliberately — re-calibrating a security probe's expectations is
its own decision, not a side effect of this phase.

### F. CI behaviour of the new checks (measured, not assumed)
Verified in both environments:

| Environment | phase221 `:137` | phase233 |
|---|---|---|
| Full clone (local) | passes | passes — all 7 tips re-verified |
| `--depth 1` branch clone | passes | passes — 1 tip re-verified |
| `--depth 1` `refs/pull/2/merge` (what CI checks out) | passes | passes — tip re-verification **explicitly reported as skipped**, nothing silently green |

The merge-ref checkout holds no advertised branch tip at all, so tip-exposure
re-verification has nothing to compare against there (measured: 0 of 7 tips
present). It reports that fact rather than accepting it quietly, and in a full
clone it asserts that every tip is verified. The `:137` ref-drift failure is
cured in all three.

Confirmed against real CI on `f5880f0` — the `Test · typecheck · build · lint`
job's only remaining test failures are the two pre-existing
`handoff-readiness.phase200` assertions; the `release-gate-consistency.phase221`
`:137` failure is gone. Job profile is **identical to the `3f63690` baseline**:
`Android debug APK` fails (pre-existing), `Reachable-history secret scan` fails
by design, `Test · typecheck · build · lint` fails on the phase200 defect alone,
and `Windows desktop package` + `iOS project build` pass. Phase 233 introduced
no new CI failure and removed one.

### G. Mutation results
`scripts/mutation-suite-phase233.sh` — **18/18 CAUGHT, 0 gaps**. Every mutant is
a defect that has really occurred (the missing rewrite-map rows, the "All five"
drift, the swallowed `catch`) or the exact regression the new rules prevent
(hardcoded ref list, empty list accepted, peeled tags counted, each rule
deleted, the section parser regressing to swallow a sibling section). Mutants
are applied with perl programs in quoted heredocs, so no shell escaping can
silently no-op them, and each is byte-verified as applied or reported INVALID.

### H. Standing blockers (unchanged)
A1 issuer credential not revocable by us; Phase 184 history rewrite BLOCKED on
A1 and now known to require **seven** refs and a fresh rehearsal; production
email transport/sender/required vars absent; Evidence D INCOMPLETE.

---

## Phase 234 — the Convex access verdict contract

### A. The defect
`handoff-readiness.phase200.test.ts` ran the live `verify-convex-access.mjs`
probe and asserted ONE machine's outcome: exit 2, `NOT_REACHABLE`, and a
`blockedAt` in dns/tcp/tls/http. That is a statement about the runner, not the
program. In the sandbox egress is blocked so it held; on a networked CI runner
the same probe legitimately reaches `api.convex.dev` and reports
`CREDENTIALS_REJECTED` / `blockedAt: auth` (or `UNAUTHENTICATED` when no key is
set), and the test failed:

| Line | CI failure |
|---|---|
| `handoff-readiness.phase200.test.ts:96` | `expected 'CREDENTIALS_REJECTED' to be 'NOT_REACHABLE'` |
| `handoff-readiness.phase200.test.ts:84` | `expected ['dns','tcp','tls','http'] to include 'auth'` |

Same shape as the phase75 failure: a green local suite proved nothing, because
sandboxed egress was load-bearing.

### B. The property, stated once
> Network reachability must never be reported as authentication evidence, and no
> authentication verdict may be emitted unless the control plane was actually
> reached and answered.

Both directions matter. A blocked network claimed as auth evidence makes a dead
sandbox look like a rejected (or revoked) key. The reverse — a refused
credential reported as merely unreachable — sends an operator hunting for an
allowlist entry that was never the problem.

### C. What changed
The classification moved out of the probe into
`scripts/lib/convex-access-verdict.mjs` (typed via `.d.mts`), leaving
`verify-convex-access.mjs` to do the I/O and delegate. The probe's observable
output is unchanged; its inline verdict chain is gone (37 insertions, 84
deletions).

`isAuthEvidence` is now DERIVED from the state, so it cannot be set by a
branch. `validateVerdict()` checks every invariant, and `primaryHost` is
exposed in the JSON so consumers can check per-layer invariants without
hardcoding which host is probed first.

**One state was added: `AUTH_INDETERMINATE`.** Previously a transport failure or
a 5xx on the authenticated request fell into `UNAUTHENTICATED`, whose text reads
"no usable credential was presented" — a claim about the credential that the
observation did not support. `AUTH_INDETERMINATE` says the plane was reached
but no verdict came back, and explicitly draws no conclusion. This is a
fail-closed addition, not a weakening: exit 1, `isAuthEvidence: false`.

### D. Verdict contract
| State | Reached? | blockedAt | isAuthEvidence | Exit |
|---|---|---|---|---|
| `NOT_REACHABLE` | no | dns/tcp/tls/http/unknown | false | 2 |
| `AUTH_INDETERMINATE` | yes | auth | false | 1 |
| `UNAUTHENTICATED` | yes | auth | false | 1 |
| `CREDENTIALS_REJECTED` | **yes** | auth | **true** | 1 |
| `CONTROL_PLANE_ONLY` | yes | deployment-plane | true | 1 |
| `AUTHENTICATED` | yes | null | true | 0 |

`isRevocationEvidence` is always false — this probe cannot observe revocation.

### E. Proof
`convex-access-verdict.phase234.test.ts` drives all eight required outcomes
from fixtures — DNS/TCP/TLS/HTTP blocked, reached+rejected, reached+auth
failure, transport error, 5xx, and malformed input — because four of them
cannot be produced on a given machine and which one appears is an accident of
egress policy. It asserts the properties over the whole input space
(`reachable` × every auth state × deployment-plane), not on samples.

**Environment-independence was verified empirically, not assumed.** Two
coherent simulations of a networked runner were applied to the probe and the
phase200 suite run against each:

| Simulated outcome | phase200 |
|---|---|
| reached, auth request dies in transport (`UNAUTHENTICATED` / `blockedAt: auth`) | **passes** |
| reached, key refused (`CREDENTIALS_REJECTED` / `blockedAt: auth`) — the exact CI state | **passes** |
| real sandbox (`NOT_REACHABLE` / `blockedAt: tls`) | **passes** |

A first, incoherent simulation (forced `reachable` while TLS genuinely failed)
was *rejected by the new assertions* — the suite detects a report that could
not physically have happened.

`scripts/mutation-suite-phase234.sh`: **15/15 CAUGHT, 0 gaps**, including both
directions of the central mistake, omitted auth/network stages, a swallowed
probe exception, hardcoded success and failure, an unknown result falling
through to success, neutered validation, and the contract being forked back
into the probe. An unapplied mutant now counts as a failure, so the suite
cannot silently under-report.

### F. CI behaviour — measured
The first Phase 234 commit (`f435b36`) cleared the two assertion failures and
exposed a second, subtler form of the same defect: the suite spawned the probe
once per assertion (~10 runs). In the sandbox every layer fails in
milliseconds; on a networked runner the probes actually complete, and a hanging
host costs its full timeout, so per-assertion spawns blew vitest's 10s default:

| Run | phase200 failures |
|---|---|
| before Phase 234 (`f5880f0`) | `:74`, `:84`, `:96` — wrong assertions |
| after (`f435b36`) | `:118`/`:246` and `:126`/`:136`/`:180` — **timeouts**, at different lines each run |

Fixed by spawning the probe **twice for the whole file** (anonymous and keyed,
the keyed run using the sentinel so the credential-redaction check shares it)
with `--timeout 5` bounding each internal probe, and an explicit `beforeAll`
timeout. Cost is now paid once and no longer scales with the network.

### G. Remaining CI failures, classified
*Correction to the Phase 233 section above:* it said the only remaining test
failures were the two phase200 assertions. That list was truncated — GitHub
returns annotations in batches and the earlier read stopped early. The full set,
identical before and after Phase 234, is:

| Location | Failure | Classification |
|---|---|---|
| `evidence-d-execution.phase203.test.ts:334` | `expected 1 to be 2` (harness exit code) | **pre-existing**, unrelated to Phase 233/234 |
| `evidence-d-execution.phase203.test.ts:347` | `report.reason` is `undefined` | **pre-existing**, same class as phase200 |
| `handoff-readiness.phase200.test.ts:*` | environment-pinned assertions | **FIXED here** |
| `Reachable-history secret scan` job | exit 1 | by design (A1 blocker) |
| `Android debug APK` job | failure | pre-existing, present at `3f63690` |

The phase203 pair is the SAME defect class as the phase200 one: those tests run
`evidence-d-harness.mjs` against `https://unreachable-example.convex.cloud`,
which **resolves** (Cloudflare, `104.18.14.131`) — so on a networked runner the
handshake completes and the host answers, the harness takes a different exit
path (1, no `reason`), and the tests that assert a *transport refusal*
(exit 2, `reason: "The deployment did not answer (ECONNRESET)…"`) fail. Locally
egress is severed at TLS, so they pass. Deliberately NOT fixed here — it is a
separate test file and the phase brief scopes the change to phase200.

## Phase 235 — the Evidence D probe outcome is classified, not assumed

### A. The defect, measured
Phases 200, 203 and 234 all found the same class of defect in the same place: a
guard that asserted what the **machine's** network did with
`https://unreachable-example.convex.cloud`, and read that as a property of the
harness. The host sits behind a wildcard DNS record, so the same code produces
two different observations:

| Environment | What the probe actually does | What the guard asserted |
|---|---|---|
| sandbox (egress severed) | throws at the TLS layer (`ECONNRESET`) | exit 2, plus a transport `reason` |
| CI runner (networked) | DNS resolves, TLS completes, the host answers | the same two things — and failed |

Measured on `b49b1b6` (both test-job check-runs, `105067472902` and
`105067466167`): `evidence-d-execution.phase203.test.ts:334`
`AssertionError: expected 1 to be 2`, and `:347` `TypeError: .toMatch() expects
to receive a string, but got undefined`. Neither was a harness fault: exit 1 is
the harness working as designed (the checks ran and failed), and a top-level
`reason` exists only on a refusal — `refuse()` is its only writer, and the run
never refused because the host answered.

### B. What a probe can and cannot prove
`fetch` collapses DNS, TCP and TLS failures into one thrown error, so the layer
is inferred from the error code and is a reporting aid only. The separation
that matters is between an infrastructure condition and a statement about
credentials:

| Observation | Meaning | May it support an auth conclusion? |
|---|---|---|
| thrown `ENOTFOUND` / `EAI_AGAIN` | DNS did not resolve | no |
| thrown `ECONNREFUSED` / `EHOSTUNREACH` / `ENETUNREACH` | TCP did not connect | no |
| thrown `ECONNRESET` / `EPIPE` / TLS or certificate error | the connection was severed | no |
| thrown `ETIMEDOUT` / `AbortError` | no answer within the bound | no |
| any other thrown code | unattributable — reported as `unknown`, never guessed | no |
| HTTP 5xx, or a 4xx that is not a refusal | the service answered but is not serving this request | no |
| HTTP 2xx with no interpretable application status | not readable — fails closed | no |
| HTTP 401, or an application status of `UNAUTHENTICATED` | the service refused the caller | **yes** |
| HTTP 2xx with a real application status | the service processed the request | **yes** |

### C. The contract
`scripts/lib/evidence-d-probe.mjs` (typed by `evidence-d-probe.d.mts`) is a pure,
total function of a probe result. It produces exactly one of five states —
`TRANSPORT_BLOCKED`, `SERVICE_UNAVAILABLE`, `MALFORMED`, `UNAUTHENTICATED`,
`AUTHENTICATED` — for every input, with these invariants, all enforced by
`validateProbeClassification`:

* a recorded transport error is decided **first and unconditionally**, so no
  status or payload can pull a verdict out of a request that never arrived;
* `isAuthEvidence` is derived from the state, never set by hand, and always
  implies the service was reached;
* `isRevocationEvidence` is always false — this probe cannot observe revocation,
  and a network failure is emphatically not evidence of it;
* a refusal is the only outcome for a transport failure, and its wording states
  that the result is a transport fact rather than an authentication one;
* an unrecognised error code becomes `unknown` rather than a more precise-looking
  layer, and a missing refusal reason is never treated as safe;
* the classifier does not read the environment, so no machine's configuration or
  network state can change the meaning of a given probe result.

`evidence-d-harness.mjs` now routes its D3 reachability refusal through that
contract (`classifyProbeResult` + `probeRefusalReason`); the flow, the exit codes
and the emitted message are unchanged. It also accepts `--timeout <seconds>`
(default 60, unchanged) so a probe can be bounded.

### D. How the guard proves it now
`evidence-d-execution.phase203.test.ts` keeps exactly **one** real-socket probe
per file, memoised and bounded, asserting only what holds in every environment
(never `ACHIEVED`; a refusal is coherent and phrased as transport; a top-level
`reason` exists only on a refusal; no check claims evidence it did not observe).
Everything else is fixture-driven:

* `scripts/lib/fixtures/evidence-d-fetch-stub.mjs` is loaded into the guard's
  child process only (`NODE_OPTIONS=--import …`), so the harness is unmodified
  and unaware, and `EVIDENCE_D_STUB_MODE` selects the answer: DNS blocked, TCP
  blocked, TLS severed, certificate failure, timeout, unattributable error,
  hanging (never answers), 503, 404, 401, an application-level
  `UNAUTHENTICATED`, a malformed 2xx and non-JSON;
* the stub is faithful where it matters: errnos live on `error.cause.code`, and
  the hanging mode observes the abort signal and rejects with an `AbortError`,
  which is how a timed-out fetch really surfaces;
* every layer and every answered shape is therefore exercised on any machine, in
  milliseconds, and the suite was verified to pass in all eight network shapes
  (TLS-broken and DNS-broken, unavailable, refusing, malformed) rather than only
  in the one this sandbox can produce.

### E. Mutation results
`scripts/mutation-suite-phase235.sh` — 21 mutants, **20 killed, 1 documented
equivalent, 0 gaps, 0 SKIP/INVALID**, byte-exact restore under a `trap`:

| Mutant class | Result |
|---|---|
| blocked transport reported as authenticated / unauthenticated | killed (M1, M2) |
| refusal blames a rejected credential | killed (M3) |
| transport failure carries `isAuthEvidence` | killed (M4) |
| network-only result reported as revocation evidence | killed (M5) |
| malformed or unavailable answer read as success | killed (M6, M7) |
| validator neutered / missing reason treated as safe | killed (M8, M12) |
| blocked transport no longer classified as blocked (ordering lost) | killed (M9) |
| classifier consults the environment / guesses a layer | killed (M10, M11) |
| exit state hardcoded; hardcoded PASS in D3 or on refusal | killed (M13, M15, M16, M17) |
| swallowed transport exception reshaped into an HTTP 401 | killed (M14b) |
| `--timeout` ignored (a hanging probe stalls for the default) | killed (M18) |
| the contract forked back into the harness | killed (M19, M20) |
| transport error kept alongside a forged 401 | **equivalent** — correctly not flagged (M14) |

M14 is documented rather than counted as a gap: keeping `transportError` while
forging a 401 cannot change any outcome, because the classifier decides the
transport fact first. That inertness is itself asserted — a fixture test proves
a recorded transport error outranks any status, application status or payload —
and M14 confirms it end to end.

### F. CI on `e981f3c` (measured, both check-runs)
| Job | `b49b1b6` | `e981f3c` |
|---|---|---|
| `Test · typecheck · build · lint` | failure (phase203 `:334`, `:347`) | **success**, 126s / 125s, zero failure annotations |
| `Windows desktop package (Tauri)` | success | success |
| `iOS project build (compile only)` | success | success |
| `Android debug APK` | failure | failure — unchanged, pre-existing |
| `Reachable-history secret scan` | failure (by design, A1) | failure — unchanged, exit 1 |

Both test-job check-runs — push and pull-request merge ref, `105075214022` and
`105075204186` — concluded success. Their annotation sets contain **no test
failure**: the ten failure-level entries each run carries are the advisory eslint
step's pre-existing findings (`Unexpected any` in `crypto-intelligence.phase41`
and `analytical-context.phase55/56`, unnecessary escapes in
`liveProtection.ts:388`, and a conditional-hook rule in
`IntelligenceDashboard.tsx:467`), which `continue-on-error` has always tolerated
and which this phase did not touch. `npm test` is the CI test command, so a green
job means all 290 files — including the phase203 suite that used to fail — ran to
completion on a networked runner. (A first read of the `e981f3c` annotations
returned an empty body because the API had not yet propagated them; the numbers
quoted here are from the branch tip, `07f29da`.)

### G. Effect on the release gate
The environment-dependent probe pair is closed: phase200 in Phase 234, phase203
here. The remaining red jobs are exactly the two that were already classified —
the pre-existing Android failure (present at `3f63690`) and the deliberate A1
history-scan red. Nothing here changes the security position: A1 still blocks,
the Phase 184 rewrite stays gated on it, Evidence D stays **INCOMPLETE** until
real deployment evidence exists, and no dev value is promoted.

## Phase 236 — the Android packaging job's root cause: a package Google retired

### A. The exact failure
The `Android debug APK` job never reached Gradle. On the canonical base
`3f63690` (run `35113072471`, job `104851475031`) the step map is:

| Step | Result |
|---|---|
| 5. `Run android-actions/setup-android@v3` | **failure, after 9 seconds** |
| 6. Install dependencies | skipped |
| 7. Build web assets and sync into the native project | skipped |
| 8. Assemble debug APK | skipped |
| 9. Verify packaged artifacts contain no secrets | skipped |
| 10. Upload APK | skipped |

That profile is identical for all 38 consecutive Android failures. The job dies
in the Android SDK setup, before anything built by this repository runs.

### B. Root cause, and how it was established
The action's own default input is `packages: 'tools platform-tools'`. Google
stopped serving the legacy `tools` package on 2026-09-15, so `sdkmanager tools`
exits 1 and the action throws. Four independent pieces of evidence converge:

* **A green-to-red boundary with no code change between.** The Android job was
  last green at `06d8bce` (2026-09-14T14:01Z: setup-android succeeded in 26s and
  the APK built in 89s) and first red at `e3ea951` (2026-09-15T12:37Z). The only
  commit between them touches neither this workflow, nor `android/`, nor
  `package.json`.
* **The timing matches the upstream report.** `android-actions/setup-android`
  issue #537 was opened 2026-09-15T01:26Z — the same morning — reporting
  `Failed to find package 'tools'` and `sdkmanager` exit code 1 against
  `9fc6c4e`, which is exactly the commit the `v3` tag resolves to. `v4` carries
  the same default, so a major-version bump would not have helped.
* **Local reproduction with the action's real code.** Its bundled
  `dist/index.js` at that commit, run against a stub `sdkmanager` mirroring
  today's repository, exits 1 with the issue's trace verbatim
  (`Warning: Failed to find package 'tools'` → `The process … sdkmanager failed
  with exit code 1`), while the same run with `packages: platform-tools` exits 0.
* **The runner image already has what the job needs.** `ubuntu-latest` ships
  `platform-tools`, `build-tools 35.0.0/35.0.1` and `platforms;android-35`,
  which is what this project's `compileSdk 35` compiles against.

Full job logs are not retrievable from the development sandbox: GitHub serves
them from blob storage that is unreachable here (HTTP 000) while `api.github.com`
answers normally. Everything above is therefore built from step-level
conclusions, check-run metadata, workflow-run history and the action's own
source at the pinned commit — not from log text.

### C. The fix
The Android job now passes `packages: "platform-tools"` explicitly instead of
inheriting a default that names a package the SDK no longer serves. Nothing about
failure handling was relaxed: `set -euo pipefail`, the fatal Gradle invocation,
the "an APK was produced", "the web assets are inside it" and "the asset base is
absolute" assertions, the packaged-artifact secret scan and the artifact upload
all remain, and the action still accepts SDK licences so Gradle can fetch
anything else it needs.

Security posture is unchanged and re-verified: no credential is injected into the
job (`${{ secrets.* }}` appears nowhere in the workflow), the debug variant uses
the standard debug keystore because `keystore.properties` is absent, no
live-provider I/O is involved in the APK path, no web assets are committed into
the native project, and the job re-syncs them from the build before assembling.

### D. Regression coverage
`src/lib/hosting/mobile-android-ci.phase236.test.ts` reads the workflow as text
(no YAML dependency, following Phase 181) and fails if the job stops being fatal,
stops proving it produced a real APK, drops the sync or artifact-scan steps, or
returns to the action's default package set. Its package check compares tokens,
not substrings — `platform-tools` contains "tools".

`scripts/mutation-suite-phase236.sh`: **21 mutants, 21 caught, 0 gaps**, with
byte-exact restore and INVALID/SKIP counted as failures. The suite earned its
keep during development by catching two real defects in the work itself: a
quote-stripping bug in the guard's tokeniser that would have hidden the very
regression it exists to catch, and an assertion that matched a path which also
appears in a second command, letting a weakened check pass.

### E. CI result on `4819124` (measured)
| Job | `3f63690` (base) | `4819124` |
|---|---|---|
| `Android debug APK` | failure — setup step red, steps 6-10 skipped | **success**, all 13 steps green |
| — step 5 `android-actions/setup-android@v3` | failure (9s) | success (7s) |
| — step 8 `Assemble debug APK` | skipped | success (99s) |
| — step 10 `Upload APK` | skipped | success |
| `Test · typecheck · build · lint` | failure | success |
| `iOS project build (compile only)` | success | success |
| `Reachable-history secret scan` | failure (by design, A1) | failure (unchanged) |

The uploaded artifact is real, not merely a green step:
`android-debug-apk-48191244de9636e59fc97fefbf888937b0684b1e`, **3,807,050 bytes**.
Android is green on both the push run and the pull-request run.

### F. Effect on the release gate
The Android packaging job is no longer a red CI item; it was the last
unidentified failure. The remaining red is the deliberate A1 history-scan signal,
plus the Windows package job which was still building when this was recorded and
has passed on every recent run of this branch. Nothing here moves the security
position: A1 still blocks, the Phase 184 rewrite remains gated on it, and
Evidence D stays **INCOMPLETE** until real deployment evidence exists.

## Phase 237 — the default suite is fail-closed against the external network

### A. The defect, measured rather than asserted

Phase 181 claimed the default suite was hermetic. It was not. Instrumenting a
real `npm test` run — wrapping `fetch`, `net.connect` and the socket APIs and
logging every attempt with its call site — recorded **45 outbound requests to
third-party providers per run**, from three files:

| File | Attempts | Why Phase 181 missed it |
|---|---|---|
| `live-provider-verification.phase54.test.ts` | 29 | calls `verifyProvider()`; the `fetch()` lives in `market-radar/verification.ts`, so no hostname literal ever appears in the test |
| `live-provider-validation.phase39.test.ts` | 13 | allowlisted on the grounds that its assertions sit inside `if (res && res.ok)` — true of the assertions, irrelevant to the I/O |
| `market-radar/derivatives-bridge.phase226.test.ts` | 1 | host not in the hardcoded `LIVE_HOSTS` list |
| (attributed to production frames) | 2 | phase52/53's `acquireBatchLiveData()` reaches providers through a helper |

The detector's three structural blind spots: it could only recognise hostnames
somebody had already listed; it required the call and the URL literal to sit
next to each other in the test file; and `vi.mock(` anywhere in a file excused
every call in that file. `live-provider-fabric.phase52/53` were leaking too and
nothing reported them.

Two further findings came out of the runtime audit rather than the reading:
`npm test` never failed for any of this locally, because this sandbox has no
provider access — the same illusion that produced the original Phase 181 CI
failure. And phase226 plus phase52/53 are *legitimate* default-suite tests: their
subject is behaviour under provider failure, which they only ever got by
accident.

### B. What enforces the boundary now

**Runtime, authoritative.** `src/test-network-guard.ts` replaces every outbound
entry point — `fetch`, `http`/`https` `request`/`get`, `net.connect`,
`net.createConnection`, `tls.connect`, `dns.lookup`, `dns.promises.lookup`,
`WebSocket` — with one that refuses anything that is not loopback, before any
I/O happens. The refusal is a named `ExternalNetworkBlockedError`, not a bare
failure, because "it failed" is worthless as evidence: an unguarded call in an
offline environment also fails, which is exactly how the previous blind spot
survived. It is wired into both vitest projects by
`src/test-setup-network-guard.ts`.

**Structural.** `suite-hermeticity.phase181.test.ts` was rewritten. It no longer
scans for provider hostnames: it derives the boundary from the loopback rule,
reads the exclude expressions the config actually computes (they are
`LIVE_ONLY.map(...)`, not literal arrays — a version that only understood
literal arrays would have concluded "nothing is excluded" and passed), and
proves the scanner itself has teeth by requiring it to still flag the known
offender while ignoring a host named only in a constant.

**File-level.** Live tests moved to `*.live.test.ts` files that the default
config does not collect: sections I–M of phase54 and the five endpoint suites of
phase39, assertions unchanged.

### C. The live boundary

```bash
LIVE_PROVIDER_VERIFICATION=1 npm run test:live
```

Three independent layers keep live verification out of the default path: the
default config does not collect the files; `vitest.live.config.ts` refuses to
start without the opt-in; and the runtime guard stays installed everywhere else,
so a live test that was somehow collected would fail loudly instead of quietly
making requests. The opt-in is matched exactly (`=== "1"`), so
`=true`, `=1 ` and `=0` all leave the boundary closed. No CI workflow contains
the variable at all.

### D. Result, after

Re-running the same instrumentation on the fixed tree: **0 external requests
reached the network stack** (the only I/O was three loopback probes from the new
tests themselves), while **32 attempts were refused** — 20 from phase54's batch
verification, one each from phase226, phase52, phase53 and phase54's validation
block, plus the guard's own deliberate probes. The leak is closed at the socket,
not at the filenames.

The two suites are provably disjoint: the live config collects exactly 6 files,
the default config 293, intersection empty — so nothing is both run twice and
lost.

### E. Coverage

New: `hermetic-network-guard.phase237.test.ts` (23 tests — the guard is
installed, every network API is refused with the named error, the refusal
reaches through `verifyProvider()`, loopback still works against a real local
server, lookalike hostnames are refused, the live path refuses without opt-in,
`package.json` and the workflows keep the contract, no application code imports
the guard) and `hermetic-guard-jsdom.phase237.test.tsx` (3 tests — the same
demands inside the jsdom project, since a fix applied to one project only would
leave `npm test` non-hermetic).

`scripts/mutation-suite-phase237.sh`: **22 mutants, 22 caught, 0 gaps, 0
INVALID, 0 SKIP**, byte-exact restore. It gates itself on a green baseline first
— during development the guard's own test was failing while mutant verdicts
still read "caught", which is precisely the false confidence this phase exists
to remove, so the suite now refuses to run mutants unless the boundary's tests
pass.

### F. What Phase 237 does not do

It does not close A1 (the leaked credential is still unrevoked at the issuer),
does not unblock A2 (the history rewrite still waits on A1), does not add
production email transport, and does not produce Evidence D — that needs a real
deployment with real credentials, and a hermetic test suite is no substitute for
it. Evidence D remains **INCOMPLETE**.

## Phase 238 — one acquisition, one instant

### A. The defect, measured rather than asserted

`alphavantage-legs.phase229.test.ts` asserted `r.observedAt === r.fundamentals.timestamp`
and passed for a whole phase on this sandbox, then failed on CI: the failure
annotation on `alphavantage-legs.phase229.test.ts:321` reads
**`expected 1789624822122 to be 1789624822121`**. That single millisecond
is the whole defect: `normalizeFundamentalsFromAV` stamped the block with its own
`Date.now()` and the cache fetcher stamped `observedAt: Date.now()` afterwards, so
ONE acquisition carried TWO instants. It only ever disagreed when the machine was
slow enough for the millisecond to tick between them — a race, which is why a
local green said nothing.

The same shape sat in every other provider, in two forms:

* **Derived blocks dated at derivation time.** Alpha Vantage's sentiment and macro
  blocks were stamped with a fresh read taken while *building* the envelope, so a
  block derived from the news articles claimed to have been observed later than
  the articles it was derived from.
* **Read-time re-stamping.** `eia.ts`, `cot.ts`, `treasury.ts` rebuilt
  `fetchedAt` from the clock at read time, so a cache hit reported a fetch that
  never happened while the envelope itself said `acquisition: "cache-reused"`.
  `okx.ts` passed `Date.now(), Date.now()` into `buildExecutionData` as two
  separate provenance parameters.

The market-radar registry had it per record. Measured with the counting clock
(same probe, same workspace, baseline = the Phase 237 tip `7564f13`):

| One acquisition | Reads before | Reads after |
|---|---|---|
| OKX candles adapter fetch | 5 | **3** |
| DeFiLlama adapter fetch | 5 | **3** |
| CoinGecko adapter fetch | 5 | **3** |
| `acquireLiveData` (crypto, adapter selected) | 10 | **7** |
| `acquireLiveData` (forex, no credentials → no provider) | 3 | **2** |
| `acquireProviderNativeLiveData` | 8 | **7** |
| Health record: average latency vs the instants it reports | avg `2` vs reported `4` — inconsistent | avg `2` vs reported `2` — **consistent** |

`Date.now()` call sites in `provider-registry.ts` fell 36 → 24 (the remainder are
per-path reads and comments); `alphaVantage.ts` fell 7 → 2, which are the two
acquisition instants it legitimately owns (news, fundamentals).

### B. What makes it deterministic instead of lucky

`src/test-counting-clock.ts` installs a clock in which **read #n returns
`base + n`**. Consequences the suite relies on:

* two reads can never produce the same value, so "these two fields describe one
  event" is falsifiable in both directions — it passes because the code reads
  once, never because the millisecond happened not to tick;
* every value the clock returned is in `clock.reads`, so membership proves a
  recorded instant is a real read rather than a back-filled or plausible number;
* the number of consultations is an exact small integer, which is what turns
  "one read per record" from a code-reading claim into a measurement.

The sharpest observable is a **boundary placed on an instant**: stamp a candle
(or a provider payload) `299_999` ms before the read that carried the record.
Judged *at that read* the age is 299 999 → `FRESH`; judged one read later it is
exactly 300 000 → `DELAYED`. So the label alone reveals whether the verdict used
the instant the record carries. Where a boundary cannot be constructed, the count
is pinned **relatively** (two arms of the same adapter, or a cross-adapter
control) so it stays meaningful when unrelated bookkeeping changes.

The invariants the phase now enforces:

1. one acquisition = one instant; a cache hit replays the *acquired* instant
   verbatim (`provider-cache`), never a fresh one;
2. derived blocks receive that instant as a parameter instead of reading a clock;
3. builders take explicit `(…, fetchedAt, nowMs)` — no builder may invent either;
4. an adapter's `observedAt` fallback and its freshness verdict are **the same
   read**, and that read is carried out on the record as `acquiredAt`;
5. `acquireLiveData`'s `fetchedAt` is the snapshot's own `acquiredAt`, so the
   result cannot be dated at a different instant than the verdict it carries;
6. a health record reads the clock twice per request (open, close) and every
   field it publishes — `lastRequestAt`, `lastSuccessAt`/`lastFailureAt`,
   `cooldownUntil`, `avgLatencyMs` — is derived from those two;
7. a provider-native record's `fetchedAt` is the **last** read of its
   acquisition: nothing consults the clock after the record is dated.

### C. The sweep, file by file

| File | Change |
|---|---|
| `src/convex/alphaVantage.ts` | news acquisition returns `{ articles, observedAt }` (`NewsAcquisition`); fundamentals producer receives `observedAt`; sentiment/macro/unavailable blocks take the acquisition instant; non-stock unavailable keeps `timestamp: 0` |
| `src/convex/eia.ts`, `cot.ts`, `treasury.ts`, `okx.ts` | one read per action, passed into the builders; `okx` no longer passes two |
| `src/lib/data/cot.ts`, `treasury.ts` | builders are `(…, fetchedAt, nowMs)` and stamp `fetchedAt` from the parameter |
| `src/lib/market-radar/types.ts` | `MarketSnapshot.acquiredAt?` — when we acquired the record, i.e. the instant its freshness was judged at (distinct from the provider's `observedAt`) |
| `src/lib/market-radar/provider-registry.ts` | nine adapters take one read and carry it; the health wrapper reads once to open and once to close a request; `acquireLiveData` dates its result from the snapshot and takes one completion read on every other path; the provider-native path's completion read is shared by `fetchedAt` and `latencyMs` (and only taken when the transport did not report one) |
| test call sites | 45 three-argument call sites of the changed builders updated (`tsc -b` enumerated them); 8 `buildCotContext` + 10 `buildTreasuryContext` calls now pass `(rows, instrument, fetchedAt, nowMs)` |
| `src/convex/remaining-providers.phase178c.test.ts` | two **source-text pins** replaced by runtime property tests: the pins asserted `buildEiaContext(evidence.data, Date.now(), Date.now())` — they *required* two clock reads for one acquisition, so they guarded the defect. The replacements assert that a cache hit keeps `fetchedAt` and reports `cache-reused`. The EIA section's stub rows were also missing the `product` facet, so `parseEiaResponse` rejected them and every assertion in that block ran against an outage envelope: fixed |

### D. Coverage

* `src/convex/one-instant.phase238.test.ts` — **17 tests**: clock self-tests;
  Alpha Vantage partial/full/ordering; every recorded instant ∈ `clock.reads`;
  cache-reuse stability; EIA/COT/Treasury `data.fetchedAt === observedAt` and
  cache-hit stability; OKX book straddling the staleness boundary; structural
  complements (no line reads the clock twice; no application module imports the
  test clock).
* `src/lib/market-radar/one-instant.phase238.test.ts` — **19 tests**: the six
  original OKX/registry assertions plus the sweep — every adapter that receives
  no observation time (`coingecko`, `defillama`, `tokenomist`, `alpha-vantage`,
  `cftc`, `treasury`, `eia`), twelve-data's verdict placed on the FRESH/DELAYED
  boundary, the result/snapshot coupling, the no-provider result, the health
  record's two instants, the native record's last-read instant, and the
  no-transport-report latency.

### E. Mutation results

`scripts/mutation-suite-phase238.sh`: **27 mutants, 27 as declared, 0 gaps,
0 INVALID**, byte-exact restore, green-baseline gate. Classes: two reads where
one is required (M1, M2, M8, M19, M22, M23, M24), a block dated at derivation
time (M3–M6), `fetchedAt` rebuilt at read time (M7, M9, M10), a verdict judged at
a second read (M11, M12, M12b, M20), a fallback that reads again (M13), the
result dated by its own read rather than the snapshot's (M21), a read taken after
the record was dated (M25), the clock's own teeth (M14), a single statement
reading the clock twice (M17), the test clock leaking into the application (M18),
and defence in depth (M15, M16 — each weakens a pre-existing guard *and*
reintroduces the defect that guard covered, proving the new suite carries the
property alone).

**One declared limit.** `M24b` — the provider-native *success* path's latency
fallback — is recorded as unobservable rather than kept silent: every `LIVE_*`
record `executeLiveRequest` returns already carries a latency, so that branch
cannot be reached from the public API. Its failure-path twin is `M24` and is
caught.

### F. Verification on this tree

`tsc -b` 0 · `vitest run` **295 files / 10 082 passed / 18 skipped** (125 s, no
`dist/` — the order CI uses, `npm test` before the build; the skips are the
env-gated bundle/native-shell assertions) · with `dist/` present from
`npm run build` the six env-gated ones become active and pass:
**10 088 passed / 12 skipped** (133 s) · `npm run build` ok (`vite build`
5.82 s) · eslint on every changed file **0 errors**.

Pre-existing and **not touched** (verified against `HEAD`'s own copy of each
file): `no-prototype-builtins` ×3 in `src/lib/data/crypto/symbols.ts:125-127` and
`prefer-const` ×1 in `src/lib/market-radar/candidate-builder.ts:109`. The CI lint
step is advisory (`continue-on-error: true`), so these do not fail a run.

### G. What Phase 238 does not do

* It does not sweep `src/lib/data/universal/live/client.ts`. That file records,
  per response, a measurement pair: `latencyMs` (from `t0` to a read) and
  `receivedAt: Date.now()` — a second read taken alongside the first. Measured
  with the counting clock, one `executeLiveRequest` consumed six reads and
  returned `receivedAt` = the 6th while `latencyMs = 1` measures to the 5th. It
  is a measurement pair rather than a claim about *when the market data was
  observed*, which is why it is out of this phase's statement — and it is 21
  sites. Recorded here as an open item instead of being left silent.
* It does not produce live-provider evidence: no deployment, no provider
  credential, no A2 history rewrite. **Evidence D remains INCOMPLETE**, A1 (the
  unrevoked credential) and A2 are unchanged, and the release verdict is
  unchanged: **NOT READY**.

### H. CI on `8b397fb` — measured, both check-runs

| Job | Phase 237 tip `7564f13` | `bbf73ee` (first push) | `8b397fb` |
|---|---|---|---|
| `Test · typecheck · build · lint` | failure (phase229 `:321` race) | failure (ref inventory, see below) | **success**, 2 m 11 s |
| `Windows desktop package (Tauri)` | failure | success | **success** |
| `Android debug APK` | success | success | **success**, 1 m 44 s |
| `iOS project build (compile only)` | success | success | **success**, 1 m 24 s |
| `Reachable-history secret scan` | failure (by design, A1) | failure — unchanged | failure — unchanged |

This is the run that counts. The defect is a race: a fast sandbox hides it and a
loaded runner exposes it, so a local green is not evidence. The same suite that
failed `alphavantage-legs.phase229.test.ts:321` on the Phase 237 tip now runs
green there, and the job carries **no test failure** — its 21 annotations are
the advisory eslint step's pre-existing findings (`Unexpected any` in
`crypto-intelligence.phase41`, `analytical-context.phase55/56`, unnecessary
escapes in `liveProtection.ts`, the conditional hook in
`IntelligenceDashboard.tsx`), the same set the Phase 235 record lists, plus the
Node 20 deprecation warning. Both check-runs — push and pull-request merge ref —
concluded success.

The first push, `bbf73ee`, was red — not on anything the phase changed but on
the ref-inventory guard, which reads the live ref set from the remote: pushing
`arena/01a0adfb-trade-intel-bot` made it an unaccounted-for ref
(`exposure table is missing live ref …`, `the rewrite section says it covers 7
ref(s) but the remote advertises 8`). That is the guard doing its job — a ref
absent from the rewrite map survives the A2 rewrite — so the branch head was
added to both runbook tables and to `docs/secret-remediation-refs.json`, with
the derivation of its row stated in the docs rather than assumed.

**Windows, recorded honestly.** That job failed on the Phase 237 tip and
succeeded on both commits of this branch. This phase touches no packaging input,
so the change is **not attributable to it**; it is either a flake or a runner
cache state. It is written down as an observation, not as a fix.

## Phase 239 — the blank screen: reproduced, root-caused, made impossible

The user's report was "the web app often crashes". This phase does not treat
that as a flake to be retried; it reproduces it, names the first failing layer,
fixes the class, and proves the fix with tests and mutants. **Nothing about the
fail-closed behaviour of the release gate changes**: A1, A2 and Evidence-D are
untouched, and no unavailable provider value is turned into a market claim.

### A. The failure map

| | |
|---|---|
| **Trigger** | One persisted `analyses` row that the UI projection cannot interpret — measured with `breakdown` absent (a row written before the field existed). The same class with `keyLevels` absent is worse: the row projected into an `AnalysisResult` whose type *promised* `keyLevels`, so the crash happened later, away from the cause. |
| **First failing layer** | Render. `Dashboard` → `dbHistory.map(fromDbRecord)` → `fromDbRecord` read `record.breakdown.trend` unguarded (and consumers read `result.keyLevels.support`), throwing `TypeError: Cannot read properties of undefined (reading 'trend')` **inside the render pass**. |
| **Why such a row exists at all** | Convex validates a document when it is **written**, not when it is read. `analyses.list` returns raw documents (`ctx.db.query("analyses")`), so a legacy row is served happily. |
| **Symptom** | Not a partial failure — the **whole application**. The only boundary sat *above* `BrowserRouter` (inside the old `main.tsx`), so the fallback replaced the router, the providers and every route. Probe on the real tree: `crashPanel=true appShell=false interactiveNodes=0`. |
| **Recovery** | None in-app. A route change did nothing (`afterRouteChange="Preview runtime error…"`, the same panel), and a reload re-crashed on the same persisted row. Only a data change or a cleared history would have brought it back. |

The amplifier is the part that made it feel like "often": a single row, on one
route, took down `interactiveNodes=0` of the application and left no way out but
the browser's reload button.

### B. What was ruled out, by measurement

Recorded so nobody re-chases them: provider-unavailable flows (**all** legs
null, `success:false`, `data:undefined`, empty candles) boot clean; all eight
routes boot clean with an empty history; the conditional hook at
`IntelligenceDashboard.tsx:465` is **not** the crash (React 19 renders a 0→1
hook increase; only the classic state-flip throws); the protection-tab sweep was
abandoned on cost (>130 s), not on a failure.

### C. The fix

| File | Change |
|---|---|
| `src/lib/analysis/from-db-record.ts` | Returns `AnalysisResult \| null`. `uninterpretableRowReason(row)` names the refusal: `"row is not an object"`, `"row has no usable breakdown"`, `"row has no usable key levels"`. **No zero-substitution**: a fabricated `support: "0"` would be a market claim, which is the same rule the rest of the code follows for unavailable data. |
| `src/pages/Dashboard.tsx` | The history projection drops uninterpretable rows and records each drop as a `data-integrity` diagnostic naming the row id and the reason — so a shorter history is *explainable*, not silent. |
| `src/components/AnalysisResult.tsx` | `result.keyLevels?.…` — a partial result can no longer take out a consumer. |
| `src/main.tsx` | The boundary moved to where the failure happens (see D). |

### D. Boundary placement: one screen cannot blank the application

Two boundaries, two scopes, both extracted out of `main.tsx`:

- **`RouteErrorBoundaryScope`** (new, `src/components/route-error-boundary.tsx`) —
  rendered **inside** `BrowserRouter`, around the route table. A failing screen
  shows a fallback *in place*, the shell and navigation stay interactive, and
  navigating to another route **recovers without a reload** (the keyed reset
  fires on `pathname` change; retry remounts the failed subtree).
- **`RootErrorBoundary`** (extracted, `src/components/root-error-boundary.tsx`) —
  the terminal boundary above the router and above `I18nProvider` /
  `ConvexAuthProvider`, for failures that genuinely leave no app to continue
  with. It offers a reload and nothing that could re-enter the failed tree.

Neither fallback takes i18n or router context — `useI18n()` throws without
`I18nProvider`, and a fallback that depends on the layer that just failed is a
fallback that can fail itself (the exact blank screen this phase removes). That
is a deliberate, reviewable exemption in the localization guard, recorded below.

### E. Instrumentation (`src/lib/runtime/diagnostics.ts`)

Observe-only, test-first, and off in production unless asked for.
Every record carries **`kind` / `route` / `message` / `name` / `stack` /
`timestamp` / `phase`**, with `kind ∈ runtime-error | unhandled-rejection |
render-error | data-integrity` and `phase ∈ boot | running`:

- installed by the real entry point **before** mount (`installRuntimeDiagnostics()`
  at the top of `main.tsx`), then `markRuntimeBootComplete()` — so a failure
  during boot is attributable to `boot` and every later one to `running`;
- **never swallows**: no `preventDefault()`, no `stopPropagation()`, asserted by
  test with a second listener that must still be reached;
- **redacted**: credential-shaped text (auth headers, `api_key=`, JWTs, provider
  key prefixes, query-string values, long blob runs) is masked before it reaches
  a record; `route` is a pathname only, never query or hash;
- **bounded and ordered**: max 20 records, the *first* failure is retained and
  eviction drops the second-oldest; immediate duplicates collapse (React 19
  StrictMode double-invokes render, and a doubled record is a false signal);
- **disableable**: `VITE_RUNTIME_DIAGNOSTICS=0` forces it off, `=1` opts in, and
  an unset flag means development/test only — a production bundle records
  nothing by default.

The fallbacks keep the same rule the previous crash panel broke: production
shows the message and the disclosure, **never a stack, a build path or a module
name**; development shows the stack inside a collapsed `<details>`.

### F. Provider-unavailable and partial states — measured, unchanged

Every arm of the provider matrix already behaved correctly and was left alone
(no fabricated data, no `LIVE` label on a persisted row, UNAVAILABLE and
NO_TRADE semantics intact): all legs null, `success:false`, `data:undefined`,
empty candles, no credentials, no backend reachable. The phase's contract is
that weakness here would have been *fixed*, not papered over — it was not needed.

### G. Regression coverage: the 14-point list

Each point is a deterministic synthetic failure, never a timing bet.

| # | Property | Owner |
|---|---|---|
| 1 | A row without `breakdown` is dropped and recorded; the app stays interactive | `app-runtime.phase239` |
| 2 | A row without `keyLevels` is refused at the projection, not later at a consumer | `app-runtime.phase239`, `from-db-record.phase239` |
| 3 | A `null`/non-object history entry is survivable | `app-runtime.phase239` |
| 4 | A hard refresh is deterministic: both boots behave identically | `app-runtime.phase239` |
| 5 | A good record still reaches the UI (the fix drops nothing it should keep) | `app-runtime.phase239`, `from-db-record.phase228` |
| 6 | A failing route keeps the shell and navigation alive | `error-boundary.phase239` |
| 7 | Navigating away from a failed route recovers with no reload | `error-boundary.phase239`, `app-runtime.phase239` |
| 8 | A second failing route is isolated from the first route's recovery | `error-boundary.phase239` |
| 9 | Retry remounts the subtree and succeeds once the failure stops | `error-boundary.phase239` |
| 10 | A reset key (pathname) change clears the latched failure | `error-boundary.phase239` |
| 11 | The root boundary still renders an operable fallback above the router | `error-boundary.phase239` |
| 12 | Production hides stacks/frames in **both** fallbacks; development shows them collapsed | `error-boundary.phase239` |
| 13 | The real entry point installs the observers before mount and reports `kind`/`route`/`phase` | `app-runtime.phase239`, `diagnostics.phase239` |
| 14 | Unavailable/partial provider data keeps UNAVAILABLE / NO_TRADE and invents nothing | `app-runtime.phase239`, `from-db-record.phase239` |

Plus the instrumentation contract itself (redaction, ordering, the retained
first failure, duplicate collapse, prod-off, uninstall idempotence, no
`preventDefault`) in `diagnostics.phase239`.

**A gap this phase found and closed while measuring:** the route fallback's
production behaviour had no test — the mutation pass removed its
`diagnosticsEnabled` guard and every test stayed green. Two route-scope tests
(production hides the stack, development shows it collapsed) now cover it, and
the observer test was added because nothing verified that the *real* entry point
turns the instrumentation on.

### H. Mutation results (`scripts/mutation-suite-phase239.sh`)

Self-gated: it refuses to run any mutant unless the 5 focused suites are green
first, so a "CAUGHT" can never be a false positive, and it restores byte-exactly
(`.p239bak`, verified with `cmp`, under `trap`).

**21 CAUGHT / 1 documented equivalent / 0 gaps / 0 INVALID.** The equivalent
(`M19`, the null filter alone) is inert *by construction* — the other half of the
drop makes it unreachable — and is labelled as such rather than counted as a
guard. Mutants include the pre-239 wiring (no route boundary), a boundary that
renders nothing (the blank screen), a caught-but-unrecorded render error, the
removed global observers, eviction of the first failure, a lost route, disabled
redaction, a fabrication of missing key levels, a silent row drop, a production
route fallback printing the stack, and an entry point that never installs the
inspectors.

Two repairs to older suites, reported rather than hidden: `M20` in
`mutation-suite-phase197.sh` had been a **dead mutant since Phase 227** (its
anchor still matched `err?.message ?? …`, renamed to `errorMessage(err) || …`) —
it now runs again and the suite reports **23/23**. The localization guard grew a
narrow policy exemption: `src/components/error-fallbacks.tsx` is *mounted* and
carries English, which the Phase 191 ratchet forbids; it is exempt because a
fallback **must not** depend on i18n, and the exemption is enforced executably
(the file may not reference `useI18n`/`useNavigate`/`useLocation`/`useTranslation`,
it must be reachable from the entry point, and the list may not grow). Suites
190 (10/10), 191 (19/19) and 195 (11/11) were re-run after that edit: no anchor
rotted.

### I. Verification on this tree

`tsc -b` 0 · `vitest run` **299 files / 10 147 passed / 18 skipped** (0 failed) ·
`npm run build` 0 · hermeticity trio 34/34 · mutation suites: 239 → 21 caught /
1 equivalent / 0 gaps, 197 → 23/23, 190/191/195 → 40/40 · `eslint` on every
changed file: **the same 13 problems that exist on `1e67f25`, byte-for-byte**
(rule + offending line compared programmatically: 13 before, 13 after, none new,
none resolved) and **zero** in the new files.

Sandbox boot: `vite` bound to `0.0.0.0:5173`, HTTP 200 on `/`, on the
transformed `/src/main.tsx` (carrying the Phase 239 wiring) and on both new
modules, with no host/origin rejection. The real-entry-point render proof is the
`app-runtime` suite, which boots `main.tsx` itself against a stubbed Convex
boundary.

New files: `src/lib/runtime/diagnostics.ts`,
`src/components/{root-error-boundary,route-error-boundary,error-fallbacks}.tsx`,
`scripts/mutation-suite-phase239.sh`, and three test files (21 + 14 + 15 cases);
`src/lib/analysis/from-db-record.phase239.test.ts` adds 13.

### J. What Phase 239 does not do

- It does **not** claim the reported crash was the only crash. It reproduced
  *a* fatal, deterministic, user-visible path and removed the class: an
  unreadable persisted row can no longer blank the app, and a render error can
  no longer take the router with it. If a different failure appears, the
  instrumentation now captures the first one with its route, kind and phase
  instead of leaving a blank screen and a guess.
- It does **not** re-verify anything older: no earlier section is rewritten.
- Release blockers are unchanged: **A1** (OTP secret unrevoked), **A2** (history
  rewrite unexecuted, now covering 8 refs), Convex never deployed, no production
  provider verification — **NOT READY**.

### K. CI on `519dc8a` — measured, both check-runs

| Job | Push ref | Pull-request merge ref |
|---|---|---|
| `Test · typecheck · build · lint` | **success**, 2 m 15 s | **success**, 2 m 12 s |
| `Windows desktop package (Tauri)` | **success**, 5 m 12 s | **success**, 6 m 9 s |
| `Android debug APK` | **success**, 2 m 3 s | success |
| `iOS project build (compile only)` | **success**, 59 s | success |
| `Reachable-history secret scan` | failure — **by design** (A1) | failure — unchanged |

The Test job carries the same 21 eslint-advisory annotations as the Phase 235/238
records and **no test failure**. The Windows job — the one observed failing on
the Phase 237 tip and recorded there as an unattributed observation — is green on
both refs of this commit, so that observation stays an observation: this phase
changes no packaging input, and one green run does not promote a flake into a
diagnosis.

## Phase 240 — one completion instant per live acquisition

The residual Phase 238-G recorded, closed. `src/lib/data/universal/live/client.ts`
emitted a `latencyMs` measured from one clock reading and a `receivedAt` taken
from another; the semantic meanings (`receivedAt` = client receipt, `latencyMs` =
client duration, provider observation times = provider-owned) are unchanged.

### A. The two-read pattern, measured before the change

| | |
|---|---|
| **Explicit `receivedAt: Date.now()` sites** | **21** — 10 provider-native, 11 canonical |
| **Envelope-builder fallback** | 1 (`receivedAt: extra.receivedAt ?? Date.now()`) |
| **Duration measurements** | 2 inline (`latencyMs: Date.now() - t0`) + 2 locals (`const latencyMs = Date.now() - t0`) |
| **Clock consultations for ONE completion** | 25 |
| **`Date.now()` in the file, before → after** | 29 → **5** |
| **Branches supplying `latencyMs` but NOT `receivedAt`** | 6 (LIVE_VERIFIED ×4, LIVE_PARTIAL ×2) — the strongest form of the defect: the duration came from an early read, the receipt from a later one, and the two could disagree by however long the parse took |

### B. The invariant, now enforced structurally

For one completed live acquisition: **one** completion clock reading is taken;
that reading *is* `receivedAt`; `latencyMs` is derived from it
(`receivedAt - requestStart`); no second read is consulted to populate either
field.

```ts
interface LiveCompletion { readonly receivedAt: number; readonly latencyMs: number | null }
function completionAt(startedAt: number) { const receivedAt = Date.now();
  return { receivedAt, latencyMs: receivedAt - startedAt }; }
function completionWithoutRequest() { return { receivedAt: Date.now(), latencyMs: null }; }
const finish = (status, completion: LiveCompletion, extra) => { const { receivedAt, latencyMs } = completion; … }
```

`completion` is a **required argument** of the envelope builder, so a branch
cannot emit one field without the other and cannot take a reading of its own —
`tsc` refuses it. The `?? Date.now()` fallback is gone. Branches that execute no
HTTP exchange (pre-flight refusals, credential/route/unsupported outcomes) pass
`completionWithoutRequest()`: one reading, `latencyMs: null` — no fabricated
zero, and the receipt is a real clock value rather than the caller's `now`.
Provider health now reports `completion.latencyMs`, so the third copy of the same
measurement cannot drift either.

### C. The 21-site sweep (Phase D)

- All 21 explicit sites are gone; the sweep guard asserts the exact remaining set
  of clock reads (**5**: the caller instant, two request starts, two receipt
  helpers) and rejects any new one.
- All **39** envelope branches pass a completion — counted by argument, not by
  matching status literals, because one branch passes an expression
  (`credMissing ? "CREDENTIAL_MISSING" : "UNAVAILABLE"`); a literal-based guard
  would have missed exactly the enumeration gap that let the defect survive.
- Measured statuses (`LIVE_VERIFIED`, `LIVE_PARTIAL`, `PROVIDER_ERROR`,
  `NETWORK_UNAVAILABLE`, `MALFORMED_RESPONSE`) never pass the null completion.
  `RATE_LIMITED` appears on **both** sets and that is correct: a routing refusal
  ("all candidates rate-limited") opened no socket, while a provider's HTTP 429
  did and must report a measured duration.
- **No sibling pattern remains elsewhere.** The only other file carrying both
  concepts is `src/lib/market-radar/provider-registry.ts`, which takes one
  completion read per outcome (Phase 238) and *consumes* the client's reading.
  `src/lib/market-radar/acquisition.ts` has five `latencyMs: Date.now() - startTime`
  sites and **no paired completion instant** in its result shape — a single
  duration with nothing to disagree with, so it was deliberately left alone
  rather than mechanically rewritten.

### D. Counting-clock evidence (Phase E)

`createCountingClock` (Phase 238) advances 1 ms per **read**, so a hidden second
reading is a visibly different instant instead of a coincidence of speed. The
start reading is identified without guessing: `t0` is the last read before the
transport is invoked, so the transport captures it on entry. For every branch:

`clock.reads` contains `receivedAt` · `receivedAt > start` ·
`latencyMs === receivedAt - start` · `diagnostic.latencyMs === latencyMs` ·
`getProviderHealth(provider)?.avgResponseTimeMs === latencyMs`.

Exact consultation counts are pinned where the path is short and fully
attributed (3–5 reads with the breakdown in the comment), so a read that changes
no value still fails — the Phase 238 lesson applied to this pair.

Covered: 2xx success (candles **and** the quote branch that used to omit the
receipt), HTTP 429, HTTP 503, transport rejection, **timeout/abort** (this helper
has no timer, no `AbortController` and no retry — an abort surfaces as a
transport rejection and lands on the network envelope, pair intact, reason
preserved), empty body, extractor throw, all-records-rejected, identity
mismatch, the provider-native path (success **and its two failure branches**),
and the two pre-flight outcomes.

**A hole the mutation pass found and closed:** the provider-native
network-failure branch could pass the *null* completion (fresh receipt read, no
duration) with every test still green — only the canonical branch was covered.
Measured coverage first, exactly like the Phase 239 boundary gap.

### E. Semantics regression (Phase F)

`receivedAt` is still client receipt/completion time (a real clock reading,
strictly after the request start, not the provider's instant). Provider
observation timestamps are untouched: OKX candle times are carried through
byte-exact, and the market-radar acquisition keeps `snapshot.observedAt` as the
**provider's** time while `fetchedAt` is the **client's** completion reading —
verified as the read immediately after the request start, i.e. the single
completion read travelled through unchanged. A stale observation is still graded
not-`FRESH` when re-dated would have looked fresh. `latencyMs` is a duration
(`> 0`, `< 1000`, `!== receivedAt`, `!== requestedAt`).

### F. Mutation results (`scripts/mutation-suite-phase240.sh`)

Self-gated (no mutant runs unless the three focused suites are green first), byte-exact
restore via `cmp` under `trap`. **15 CAUGHT / 0 gaps / 0 INVALID / 0 equivalents.**
Mutants: a second read for `receivedAt` · duration from a later read · receipt
from an earlier read · a success branch dropping the completion (native candles
**and** quote) · an error branch dropping it · a different clock source
(`Number(new Date())`) · inverted arithmetic · off-by-one · an extra
consultation that changes no value · a diagnostic reporting a different duration
· provider health re-measuring · a pre-flight branch borrowing the caller's
`now` · and two defence-in-depth pairs that neuter the pair (resp. sweep)
assertions *and* reintroduce the defect — the surviving suites still catch it.

### G. Verification on this tree

`tsc -b` 0 · `vitest run` **302 files / 10 183 passed / 12 skipped / 0 failed** ·
`npm run build` 0 · `eslint` clean on every changed file (including the
pre-existing suite that was re-anchored, whose baseline is clean too) ·
Phase 240 mutation 15/15 · **Phase 238 one-instant suites 36/36** and its
mutation suite re-run: **27 caught / 0 gaps** (M24b still the documented
equivalent) · Phase 239 runtime + hermeticity suites 162/162 · existing live
suites (`live-provider.phase46`, `provider-native-live`) 173/173. Sandbox: the
dev server serves the new module (`completionAt`/`completionWithoutRequest`
present, exactly one sanctioned `receivedAt: Date.now()`), `/` and `/src/main.tsx`
HTTP 200.

**One Phase 238 assertion was re-anchored, not weakened.** It pinned the record's
instant to the acquisition's *last* clock read — true while the receipt was read
at the very end of the request, which is precisely what made the pair disagree.
Phase 240 captures the receipt at transport completion, so provider-health and
cache bookkeeping legitimately read the clock afterwards. The replacement keeps
the property Phase 238 cared about and states it directly: `fetchedAt` must be the
reading immediately after the client's request start, `latencyMs` must span
exactly those two instants, and — measured relatively, so it survives unrelated
bookkeeping changes — the acquisition must add **exactly one** read of its own
(the start). Mutation M25 ("the native path reads the clock after the transport
returned") is caught again, and the suite reports 27/27.

### H. Effect on the release gate

Nothing here changes the gate's semantics. Release blockers are **unchanged**:
**A1** the exposed OTP secret is not revoked, **A2** the history rewrite is not
executed (now covering 8 refs), Convex has never been deployed, and no production
provider verification has been performed — **NOT READY**. No provider credential
was added, no live external call was introduced into a test, and no provider
payload timestamp was altered.

### I. CI on `3685982` — measured, both check-runs

| Job | Push ref | Pull-request merge ref |
|---|---|---|
| `Test · typecheck · build · lint` | **success**, 2 m 07 s | **success**, 2 m 22 s |
| `Windows desktop package (Tauri)` | **success** | success |
| `Android debug APK` | **success** | success |
| `iOS project build (compile only)` | **success** | success |
| `Reachable-history secret scan` | failure — **by design** (A1) | failure — unchanged |

Both Test runs carry the same 21 eslint-advisory annotations as the Phase
235/238/239 records and **no test failure**: the suite that is green locally
(302 files / 10 183 passed) is green on the runner too.

## Phase 241 — release gate integrity: fail-closed readiness

This phase does **not** declare the release shippable and does not attempt to. It makes
the opposite mistake impossible: the software must not be able to declare READY
while any mandatory prerequisite is still outstanding. The five blockers below
were true before this phase and they are true after it — what changed is that a
release verdict is now a *computed* value with an auditable reason trail, instead
of a claim a human makes in prose.

<!-- release-verdict: NOT READY -->
<!-- The marker above is read by src/lib/deployment/release-current-state.phase241.test.ts.
     It is compared against the verdict derived from this tree, so this document
     cannot drift from the gate it describes. Flipping it to READY fails the suite. -->

### A. What existed before (measured, not assumed)

The audit that opened the phase looked for a runtime helper that decides whether
the release may ship, and found none. What existed was:

| Layer | Mechanism | Can it say READY wrongly? |
|---|---|---|
| `docs/RELEASE-GATE.md` | hand-written phase sections | yes — prose has no semantics |
| `src/lib/deployment/*.phase*.test.ts` | one guard per phase, per concern | no, but nothing aggregates them |
| CI | green workflow on the branch | yes — a green CI run says nothing about A1/A2 at all |
| `docs/UAT-MATRIX.md` | `DEV_VERIFIED — NOT PRODUCTION EVIDENCE` labels | no, but only for the rows it lists |

So every individual guard was honest and the *aggregate* was not: a reader could
take "the suite is green, CI is green, the docs are complete" and conclude READY.
This phase closes that reading. `evaluateRelease()` in
`src/lib/deployment/release-gate.ts` is now the only thing that issues a verdict,
and it can only issue one by finding explicit, admissible, bound evidence.

### B. The invariant

> **READY if and only if every mandatory prerequisite is explicitly `VERIFIED`.**

Five states exist, and exactly one of them satisfies a mandatory prerequisite:

| State | Meaning | Satisfies a mandatory prerequisite? |
|---|---|---|
| `VERIFIED` | explicit, admissible, fresh, correctly bound evidence | **yes, and this is the only one** |
| `UNVERIFIED` | no usable evidence, or evidence that was refused | no |
| `BLOCKED` | a refusal, a conflict, or an unrecognised claim | no |
| `STALE` | evidence exists but is outside its freshness window | no |
| `CONTRADICTORY` | valid evidence *and* a blocker for the same prerequisite | no |

`BLOCKED` is not `SKIPPED`, not `UNKNOWN`, not `DOCUMENTED`, not `CI-GREEN`, not
`LOCAL-SUCCESS`, and not `PASS`. There is no code path that maps any of those to
`VERIFIED`; the mutation suite exists to prove that.

### C. The decision graph

Implemented order inside `evaluateRelease(input, { prerequisites, now })`. The
order is part of the contract, because the *first* applicable rule decides what an
operator is told to fix:

1. **Manifest validity** — an empty or malformed manifest is refused outright
   (`evaluationError`), never treated as "nothing to check".
2. **Record admission**, per record, in this order:
   malformed status or non-finite `observedAt` → future-dated `observedAt` →
   outside `maxAgeMs` (stale) → non-verifying `source` (`fixture`,
   `documentation`, `ci-run`, `local-run` wording is refused) → wrong
   `environment` → subject binding (wrong commit/ref/deployment/provider set) →
   the binding itself.
3. **Unrecognised claims** — a `VERIFIED` record for a prerequisite that is not in
   the manifest becomes a blocker; it is never silently dropped.
4. **Exemptions** — an exemption for a mandatory prerequisite, for an unrecognised
   id, or without a stated reason is refused, and the refusal itself blocks.
5. **Contradiction** — a prerequisite with both usable evidence and a blocker is
   `CONTRADICTORY`. This check runs *before* any preference is applied, so a pass
   can never out-vote a conflict.
6. **Aggregate** — READY iff all mandatory prerequisites are `VERIFIED`. Anything
   else is NOT READY, with a per-prerequisite reason list.

`evaluateRelease` never throws. An internal failure is caught and returned as
`evaluationError` with verdict NOT READY — the failure mode is "cannot conclude",
never "conclude fine".

### D. The manifest — five mandatory prerequisites

| Id | Freshness | Binding | Exemptible |
|---|---|---|---|
| `A1_OTP_ISSUER_REVOCATION` | none (attestation is permanent) | — | no |
| `A2_HISTORY_REWRITE` | 30 days | affected-ref set | no |
| `CONVEX_PRODUCTION_DEPLOYMENT` | 7 days | deployment id | no |
| `PRODUCTION_EMAIL_TRANSPORT` | 7 days | — | no |
| `EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION` | 7 days | provider set | no |

Only `source: "external-verification"` with `environment: "production"` can
verify. A local run, a fixture, a CI run, and a document each have their own
admissible purpose, and that purpose is never "prove a production fact".

### E. A1 and A2 specifically

- A1 (OTP issuer revocation): a missing, stale, or self-contradictory revocation
  attestation is NOT READY. The phase does not contact the issuer.
- A2 (history rewrite): the check is bound to the **affected-ref set** read from
  `docs/secret-remediation-refs.json`. If that inventory cannot be read, the set
  is *unknown*, and "unknown" is refused — it is never treated as an empty set
  that vacuously passes. A map that is present but not evidenced is not proof. A
  rewrite that covered one ref when eight are affected is not proof. A partially
  rewritten history is not proof.
- Number of refs is read from the tree at evaluation time; it is not hardcoded.
- No Git history was mutated, and no ref was rewritten, to produce any result in
  this section.

### F. Convex, email, and Evidence D

- **Convex**: configuration present is not deployment. Deployment is bound to a
  deployment id; "the config exists", "it built locally", and "it works in dev"
  are each refused as substitutes.
- **Email**: a configured sender is not a verified sender. The env being
  documented is not the env being present at runtime; a console transport and a
  non-production issuer are refused. `readEmailDeliveryConfig()` already forbids
  the console transport in production; the gate refuses it as *evidence* as well.
- **Evidence D**: the provider set is bound to the required set from
  `getAllProviders()`. One provider's green run cannot stand for the required set,
  and a timeout is not a pass. Fixture-vs-production and historical-vs-live are
  both refusals, not judgement calls.

### G. Contradiction, freshness, and determinism

- Contradiction is checked before preference (step 5 above) and covered by test.
- Freshness uses an injected `now`; every test supplies a synthetic instant
  (`NOW = 1_800_000_000_000`). There is no wall-clock race anywhere in this
  phase, and no test becomes flaky as the clock advances.
- A future-dated `observedAt` is refused rather than trusted: clock skew on the
  proving side must not extend a window.
- Duplicate conflicting records for one prerequisite produce `CONTRADICTORY`, not
  last-writer-wins.
- Malformed JSON is reported at both layers: the reader says the file exists but
  is not valid JSON, and the gate says the observation time is not usable. Both
  are asserted, because "present" and "usable" are different facts.

### H. Regression coverage — 45 tests

| Suite | Tests | Covers |
|---|---|---|
| `release-gate-failclosed.phase241.test.ts` | 35 | Phase G points 1–19: every state, refusal, binding, exemption, contradiction, freshness, and exception path |
| `release-current-state.phase241.test.ts` | 10 | the reader: real proof paths, refused promotions, and the derived current verdict |

Two tests carry unusual weight:

- **#20** derives the expected blocker list from the facts rather than hardcoding
  it: it asserts that every mandatory prerequisite without a filed proof appears as
  a blocker, so the assertion stays true when the tree changes in either
  direction.
- **#20b2** reads the `release-verdict` marker from this document and compares it
  with the verdict computed from the tree. The documented verdict cannot drift
  from the computed one — flipping the marker to READY was measured to fail the
  suite.

### I. Mutation results (`scripts/mutation-suite-phase241.sh`)

29 mutants, each anchored to a unique code site with a byte-exact
`.p241bak`/`cmp`/trap restore. Baseline must be green before any verdict counts.

| Result | Count | Detail |
|---|---|---|
| CAUGHT | **29** | every mutant changed observable behaviour and the suites noticed |
| gaps | 0 | — |
| INVALID anchors | 0 (after repair) | M9/M10 anchors were stale on the first run and were repaired to unique single-line anchors; no test was changed to make them apply |
| equivalent mutants | 0 | — |

The first run found two real gaps, and both were closed by **adding tests**, never
by softening a mutant:

- **M21 — an unknown provider set treated as an empty set** survived, because every
  existing test supplied a provider set. Closed by test 10a, which passes an empty
  required set and asserts the gate refuses it with "required provider set is
  unknown".
- **M28 — the reader ignoring a proof file's own `verified` flag** survived,
  because every other fixture declared `verified: true`. Closed by a reader test
  using A1 (which carries no subject binding, so only the claim itself stands
  between the file and a pass) with `verified: false`; the mutant was then
  re-applied alone and measured to fail the suite.

Mutants cover: deleting the A1/A2 blockers; ANY-pass aggregation; inverting the
VERIFIED test; mandatory-flag flips; unbound deployment and provider set;
BLOCKED/UNKNOWN/STALE/CONTRADICTORY mapped to VERIFIED; missing evidence defaulting
to VERIFIED; fixture, documentation, and CI accepted as production proof;
wrong-commit evidence accepted; freshness and future-dating disabled; unknown
ref-set bypass; unrecognised VERIFIED accepted; exemption waiving a mandatory
prerequisite; exception returning READY; empty manifest accepted; the reader
accepting any source or environment or ignoring `verified`; and the current verdict
bypassing the real evaluation.

### J. Verification on this tree and the current verdict

| Gate | Result |
|---|---|
| `npx tsc -b` | exit 0 |
| `npx vitest run` (full) | **304 files / 10 228 passed / 12 skipped / 0 failed** |
| `npm run build` | exit 0 |
| `npx eslint` on the four changed files | clean |
| `src/lib/deployment` | 16 files / **497 passed** |
| Phase 238 one-instant (lib + convex) | 2 files / 37 passed |
| Phase 238 mutation suite | 27 caught / 0 gaps |
| Phase 239 runtime + error boundary | 4 files / 63 passed |
| Hermeticity suites | 3 files / 34 passed |
| Phase 241 mutation suite | 29 caught / 0 gaps |

No existing security or release assertion was weakened to obtain any of these
results.

**Computed verdict, from the tree as it stands:**

```
VERDICT: NOT READY
  A1_OTP_ISSUER_REVOCATION                     UNVERIFIED  mandatory  "no evidence was supplied"
  A2_HISTORY_REWRITE                           UNVERIFIED  mandatory  "no evidence was supplied"
  CONVEX_PRODUCTION_DEPLOYMENT                 UNVERIFIED  mandatory  "no evidence was supplied"
  EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION  UNVERIFIED  mandatory  "no evidence was supplied"
  PRODUCTION_EMAIL_TRANSPORT                   UNVERIFIED  mandatory  "no evidence was supplied"
```

The four listed blockers plus the ordering are produced by evaluating
`docs/remediation/*.json` (none of which exist yet) plus the ref inventory. No
blocker was hardcoded; the list is the *absence* of admissible evidence, and it
will shorten by itself the moment real evidence is filed.

**Confirmed: no A1/A2 remediation was executed.** The OTP issuer was not
contacted, the eight affected Git refs were not rewritten, Convex was not
deployed, no production email transport was provisioned, and no production
provider credential was added or changed. Phase 241 changed code, tests, a
mutation script, and this document — nothing external.

### What Phase 241 does not do

- It does not declare the release shippable, and it does not shorten the blocker list.
- It does not remediate A1 or A2, and it does not make remediation easier to fake:
  the proof file format is deliberately narrow.
- It does not replace the per-phase guards; it aggregates them and refuses to
  accept their greenness as a verdict.
- It does not police the wording of this document beyond the verdict marker.

### K. CI — measured, both check-runs

The first CI run on this phase (`a1b4b5e`) failed, and the reason is worth
recording because it is the phase's own thesis in action. The Phase 221 guard
scans this document from `## Phase 221` to the end of the file and refuses the one
construction that pairs the word "release" with the word for being fit to ship.
The new section had opened by *denying* that claim — in that very construction.
The ban cannot tell a denial from an assertion, and it should not have to: it is a
grep, and the sentence that argues "not shippable" still reads as the forbidden
pair. The local suite was green only because the full-document run happened
before the section existed; the runner, which lints and tests the pushed tree,
caught it.

The fix was to reword the two sentences (`975daf2`); **the guard was not
touched.** A guard that cannot tell an assertion from its denial in prose is still
a better guard than no guard, and a phase arguing that the release must not ship
has no business writing the forbidden construction even in the negative.

| Check | PR merge ref | Branch push |
|---|---|---|
| `Test · typecheck · build · lint` | **success**, 2 m 14 s | **success**, 2 m 20 s |
| `Windows desktop package (Tauri)` | **success** | success |
| `Android debug APK` | **success** | success |
| `iOS project build (compile only)` | **success** | success |
| `Reachable-history secret scan` | failure — **by design** (A1) | failure — unchanged |

Both Test runs carry 21 annotations, the same advisory set as the Phase
235/238/239/240 records (`Unexpected any` in three pre-existing suites, escape
characters in `src/convex/liveProtection.ts`, fast-refresh and hook-dependency
warnings, one conditional-hook finding in `IntelligenceDashboard.tsx`) and **none
of them is in a file this phase touched**. There is no test failure: the tree that
is green locally (304 files / 10 228 passed) is green on the runner too.

The secret scan still fails on the reachable history, which is A1 — unrevoked and
deliberately not remediated here. A green pipeline was never going to make a
blocked release shippable, and that is precisely the confusion this phase exists
to remove.

## Phase 242 — canonical release-gate enforcement

Phase 241 built a verdict. This phase is about who is allowed to *use* it: before
it, the canonical evaluator existed and nothing in the repository called it, so a
release decision was still a sentence a human wrote. Every release-shaped path was
audited, the one enforcement point was built, and the paths that could disagree
with the verdict are now either driven by it or pinned as provably unrelated.

The verdict itself is unchanged, and so is the answer: **NOT READY**, for the same
five externally-blocked reasons. Nothing in this phase attempts to clear them.

### A. The entry-point map (Phase A)

Every path that could admit, package, publish, promote, display or gate a release:

| Entry point | What it does today | Canonical gate used? | Bypass possible? |
|---|---|---|---|
| `.github/workflows/ci.yml` — `Test` job | tests, typecheck, build, advisory lint, artifact secret scan | no, and deliberately not — it is a quality gate | n/a: it never decides a release, and the file says so |
| `.github/workflows/mobile.yml` — Android / iOS / Windows jobs | builds unsigned debug/installer artifacts; uploads them | no | no release path exists here; the iOS job prints that its output "does NOT constitute release or store readiness" |
| `.github/workflows/release-admission.yml` | **the release boundary** (this phase) | **yes** — `npm run release:admission` | no: the job fails closed and is not advisory |
| `scripts/verify-deployment-config.mjs` (`npm run convex:preflight`) | operator-facing configuration gate before a manual `npx convex deploy` | no — configuration shape, not release state | it cannot admit a release: it decides `configuration ACCEPTED/REJECTED` |
| `scripts/verify-history-clean.mjs` | proves the reachable history carries no secret (A3) | no | produces A2/A3 evidence, not a verdict |
| `scripts/verify-mobile-artifacts.mjs` | packaged-artifact secret scan | no | refuses an artifact, never admits a release |
| `package.json` scripts | build, mobile sync, desktop build, preflight, evidence harness | `release:gate-verify`, `release:admission`, `release:report` | no deployment/publish command exists to attach to |
| `docs/RELEASE-GATE.md` and the other gate documents | the record and the procedures | **the verdict marker is compared against the computed verdict** (Phase 241 test #20b2) | a document cannot change the computed verdict, only disagree with it — and disagreeing fails the suite |
| `src/lib/deployment/release-gate.ts` | the evaluator | it **is** the gate | not a bypass: hand-written records must still pass source, environment, freshness and binding rules (proven in the Phase 242 suite) |
| `src/lib/deployment/release-current-state.ts` | reads what this checkout can prove | it **is** the evidence reader | no path promotes a document to evidence |
| `src/lib/deployment/release-admission.ts` | **the one admission operation** (this phase) | it **is** the admission | its export surface is enumerated and asserted |
| UI | **none exists** | n/a | nothing to bypass; a future surface must call the admission module, and `src/lib` contains no second admission producer (asserted) |

**There is still no production deployment entry point.** Phase 186/234 stopped at
"configuration present, deployment not performed": the repository has no deploy
command, no publish step and no promotion job. That fact is now recorded in the
code (the task asked for it to be documented rather than papered over with an
invented deploy step), and the boundary is enforced at the nearest layer that
exists — the release workflow, on a tag or a manual dispatch.

### B. Shadow gates (Phase B)

The scan for readiness vocabulary classified every hit. Nothing was renamed:
unrelated domain statuses are named as such, and the classification is now a test,
so a new readiness-shaped surface fails the suite until somebody classifies it.

| Finding | Classification | Disposition |
|---|---|---|
| `release-gate.ts`, `release-current-state.ts`, `release-admission.ts` | canonical | the only files allowed to assign a verdict; asserted |
| `coverage.ts` (`ready: boolean` per instrument dataset) | unrelated domain status | left verbatim, listed as classified |
| `runtime/diagnostics.ts` (`state.ready` = boot phase) | unrelated domain status | left verbatim, listed |
| `discovery/pipeline.ts` ("scanner-ready live sources") | comment | listed |
| `i18n/*` (`terminalReady` copy, locale completeness comment) | UI copy | listed |
| `docs/RELEASE-CANDIDATE.md`, `docs/CONVEX-DEPLOYMENT-READINESS.md`, `docs/DESKTOP-DISTRIBUTION.md`, `docs/UAT-MATRIX.md`, `docs/SECURITY-REMEDIATION.md`, `docs/DEPLOYMENT*.md`, `docs/PRODUCTION-VERIFICATION.md` | historical documentation / procedures | no script and no workflow reads them for a verdict (asserted); their recorded verdicts agree with the computed one |
| `scripts/verify-convex-access.mjs` (`READY` in a probe state name) | unrelated domain status | left verbatim |
| `.github/workflows/*` | no readiness literal at all | asserted |
| **`src/lib/deployment/handoff-readiness.phase200.test.ts`** | ordinary test assertion | it checks that the handoff document keeps its steps in order; it cannot admit anything |

No shadow gate was found that could disagree with the canonical verdict; the one
aggregation that exists is the canonical one.

### C. One admission operation (Phase C)

`src/lib/deployment/release-admission.ts` — `evaluateReleaseAdmission(request)`:

* returns the Phase 241 verdict plus the canonical per-prerequisite outcomes;
* projects the blockers (`mandatory && state !== "VERIFIED"`) instead of
  aggregating anything itself — a second aggregation is how two release checks
  start disagreeing, and a mutant that reintroduces one is caught;
* identifies the candidate: commit, ref, environment, and the declared production
  deployment (or `null`);
* is a conjunction that fails closed — canonical `READY`, no evaluation error, at
  least one mandatory prerequisite, every mandatory prerequisite `VERIFIED`, empty
  blocker projection. An internal failure returns a refusal carrying
  `evaluationError` and exit code 2;
* reads **no environment** — it is handed its candidate. The client-hygiene guard
  in `production.phase12.test.ts` is the reason: the module sits in `src/lib`, and
  a release decision that silently changes with the machine it runs on is not a
  decision. The entry point resolves the identity and passes it in. That guard
  failed this phase's first draft, and the draft was changed rather than the
  guard;
* deploys nothing. `releaseAdmissionExitCode` is 0 admitted, 1 refused, 2 the
  evaluation itself failed — and the report says, in its own words, that this
  decision admits or refuses a release and deploys nothing.

### D. CI integration (Phase D)

`.github/workflows/release-admission.yml`, triggered by a version tag (`v*`,
`rc-*`) or a manual dispatch — never by a branch push or a pull request:

| Job | Command | Meaning | Today |
|---|---|---|---|
| `gate-logic` | `npm run release:gate-verify` | "the gate refuses what it must and admits what it may" — fixtures, determinism, fail-closed paths | **green** |
| | `npm run release:report` | the current verdict, for a human | green, display only |
| `release-admission` | `npm run release:admission` | "the gate admits THIS release" — `RELEASE_ADMISSION=require`, the tagged commit as the candidate | **red, by design** |

Three properties are asserted rather than hoped for: the admission job is not
`continue-on-error` (an advisory gate is a report, which is the defect this phase
removes); the boundary job runs the admission command and not the logic check; and
the trigger block contains no `branches:` — a red job meaning "the product is not
shippable yet" must not sit on every ordinary commit, or red stops meaning
anything. `ci.yml` runs neither command, so ordinary development CI is unaffected.

Exercised locally, with the exact commands CI runs:

| Command | Exit | Output |
|---|---|---|
| `npm run release:gate-verify` | **0** | 4 tests: the machinery refuses this release and derives the refusal |
| `npm run release:report` | **0** | the full report, ending in `NOT ADMITTED: 5 mandatory prerequisite(s) are not VERIFIED` |
| `npm run release:admission` | **1** | the same report inside the failure message: the release is refused |

The two distinctions the workflow exists to keep separate are therefore
observable: *the gate works* (green) is not *this release is admitted* (refused).
The workflow also needs no secret, no provider call and no deployment — it is
hermetic, and every admission test runs under the repository's network guard,
which fails any non-loopback connection.

One honest limitation: a `workflow_dispatch` trigger becomes dispatchable only
once the file is on the default branch, so until this reaches `main` the manual
path is inert. The **tag** path is not — a tag push runs the workflow file at the
tagged commit — and the same three commands are runnable locally, which is how
they were measured above. Nothing was pushed to `main`, and no tag was created to
force a run: both are release acts this phase does not perform.

### E. Display and documentation (Phase E)

* No UI surface displays release status, so none could disagree. The report is the
  display surface, and it is generated from the admission object: the report and
  the JSON are asserted line-exactly against the verdict the gate computed, so a
  hardcoded label cannot survive.
* The document marker stays single and pinned: `docs/RELEASE-GATE.md` carries
  exactly one `release-verdict` marker (Phase 241 test #20b2 compares it with the
  computed verdict). Phase 242 deliberately adds no second marker — a second
  marker would be a second place to drift.
* The Phase 221 guard, which scans this document from `## Phase 221` to the end,
  caught the first draft of this section for containing the forbidden naming pair
  inside a quotation of the sentence it was discussing. The wording was changed;
  the guard was not.

### F. Bypass resistance (Phase F)

Each attempt is a test, and each is refused:

| Attempt | Result |
|---|---|
| an empty evidence object | refused; all five mandatory prerequisites are blockers |
| omitting a mandatory prerequisite | refused; that prerequisite is the only blocker |
| documentation-only proof | refused ("documentation is not verification") |
| a truthy non-boolean `verified` flag (`"VERIFIED"`) | refused — the reader compares `=== true` |
| CI-green as the deciding fact | refused when a proof declares a CI source, **and** the decision cannot be based on CI status (mutant caught) |
| local run as the deciding fact | refused when a proof declares a local source; a local-success decision is a caught mutant |
| only a deployment/email/provider subset | refused — the unverified prerequisite stays a blocker |
| a different candidate commit | refused ("wrong commit"), including when the request asks about another candidate |
| stale evidence | refused (`STALE`), and refreshing it into freshness is a caught mutant |
| catching an evaluation error and continuing | impossible: the error is a refusal with its own exit code, and swallowing it into an admission is a caught mutant |
| importing the lower-level evaluator and passing hand-written VERIFIED records | still refused: source, environment, freshness and binding rules apply, and the candidate declares no production deployment |
| exporting a bypass helper from the admission module | the module's export surface is enumerated in a test; adding anything fails it (caught mutant) |
| swapping the display for a hardcoded verdict | line-exact report assertions (caught mutant) |

### G. Regression coverage — 50 tests

| Suite | Tests | Covers |
|---|---|---|
| `release-admission.phase242.test.ts` | 28 | admission semantics, the one admissible shape, evidence that cannot admit, bypass resistance, module surface |
| `release-entrypoints.phase242.test.ts` | 16 | the entry-point map, shadow-gate classification, workflow wiring and triggers, package scripts, docs-as-proof |
| `release-admission.boundary.phase242.test.ts` | 6 (4 run in the default suite; 2 are mode-specific) | the release boundary in `verify`, `require` and `report` modes, plus the unknown-mode failure |

48 of them run in `npm test`; the suite total moved from 10 228 to 10 276 passed
with no failures, and the boundary spec is green there *while refusing the
release* — which is the whole distinction this phase enforces.

### H. Mutation results (`scripts/mutation-suite-phase242.sh`)

28 mutants over the evaluator, the reader, the admission module, the boundary
spec, the release workflow, `ci.yml` and `package.json`. Byte-exact restore via
`.p242bak`/`cmp` under `trap`, and the baseline gate now runs *before* the backups
are armed — the first version left scratch copies of source files on disk while
the suites ran, and the classification guard flagged them as unclassified
readiness surfaces. That was a real defect in the harness, found by the harness.

| Result | Count |
|---|---|
| CAUGHT | **26** |
| equivalent (documented) | 2 |
| gaps | 0 |
| INVALID anchors | 0 |

Two observables decide a verdict: the focused suites, and a **boundary probe** —
`RELEASE_ADMISSION=require` must keep refusing while the release is blocked. The
probe caught M27, where the `require` assertion is weakened so every suite stays
green while the release boundary exits 0: that is "the gate made advisory" in its
purest form, and no assertion inside the suites can see it.

Documented equivalents, both refused before and after:

* **M16** — the reader accepting `documentation` as a verifying flag is inert
  because the evaluator refuses non-external sources on its own; the end-to-end
  version of that defect (**M16b**, removing the evaluator's source rule) is
  caught, which is what makes M16's inertness a defence in depth rather than a gap.
* **M22** — reporting an unreadable inventory as present-with-no-affected-refs is
  inert because the gate refuses an empty affected-ref set independently.

Three gaps surfaced on the first runs and were closed **by strengthening tests**,
never by softening a mutant: M6's mutation only neutralised one conjunct of a
conjunction whose first term already implied it (rewritten to replace the whole
decision), and the display-verdict mutants survived a substring assertion that the
report's own diagnostic line satisfied (assertions made line-exact).

### I. Quality gates

| Gate | Result |
|---|---|
| `npx tsc -b` | exit 0 |
| `npx vitest run` (full) | **307 files / 10 276 passed / 12 skipped / 0 failed** |
| `npm run build` | exit 0 |
| `npx eslint` on the five changed files | clean |
| Phase 242 mutation suite | 26 caught / 2 documented equivalent / 0 gaps |
| Phase 241 release-gate suites | 60 passed (fail-closed, current-state, consistency) |
| Phase 241 mutation suite | 29 caught / 0 gaps — after its M29 anchor was updated to the reader's new signature, which this phase changed |
| Phase 238 one-instant (lib + convex) | 37 passed |
| Phase 238 mutation suite | 27 caught / 0 gaps |
| Phase 239 runtime + error boundary | 63 passed |
| Hermeticity suites | 34 passed |
| Release path itself | `release:gate-verify` 0, `release:report` 0, `release:admission` 1 (refused) |

No existing security or release assertion was weakened. Two were *hit* by this
phase's first drafts and both were honoured: the client-hygiene scan (the
admission module was made environment-free instead of adding it to the scan's
exclusions) and the Phase 221 naming guard (the prose was changed, not the rule).

### J. The current verdict, and what was not done

```
admitted: no
verdict: NOT READY
candidate: WORKTREE @ heads/arena/01a0adfb-trade-intel-bot (production, deployment none declared)
A1_OTP_ISSUER_REVOCATION: UNVERIFIED — no evidence was supplied
A2_HISTORY_REWRITE: UNVERIFIED — no evidence was supplied
CONVEX_PRODUCTION_DEPLOYMENT: UNVERIFIED — no evidence was supplied
EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION: UNVERIFIED — no evidence was supplied
PRODUCTION_EMAIL_TRANSPORT: UNVERIFIED — no evidence was supplied
NOT ADMITTED: 5 mandatory prerequisite(s) are not VERIFIED
```

The same five blockers as Phase 241, now enforced at the boundary instead of
merely computed. **Confirmed: no external remediation was executed** — the OTP
issuer was not contacted, the eight affected refs were not rewritten, Convex was
not deployed, no production email transport was provisioned, no production
provider credential was added or changed, nothing was pushed to `main`, and no tag
was created. This phase changed code, tests, one workflow, `package.json`, a
mutation script and this document.

### What Phase 242 does not do

* It does not clear a blocker, and it does not shorten the blocker list.
* It does not add a deployment step, a publish step or a promotion job — there is
  no production deployment to attach one to, and inventing one would be the
  behaviour this phase exists to prevent.
* It does not make the ordinary pipeline red for an external blocker, and does not
  make the release boundary advisory.
* It does not police the wording of this document beyond the one pinned marker and
  the Phase 221 naming rule.
