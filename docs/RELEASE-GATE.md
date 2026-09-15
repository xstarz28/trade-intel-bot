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
