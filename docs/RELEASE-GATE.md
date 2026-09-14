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
| Evidence D | **BLOCKED** | Requires a deployed backend; mocks explicitly do not count. Phase 199 defines the **minimum 10-observation checklist (D1–D10)** that closes it — `docs/CONVEX-DEPLOYMENT-READINESS.md` §6. Partial capture = NOT VERIFIED, never PASS | — | 2026-09-14T00:00Z |
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
| Auth | **BLOCKED** | Needs a deployed Convex backend and a working OTP credential | — | 2026-09-12T04:22Z |
| Entitlement | **BLOCKED** (deployed) / PASS (unit) | Phase 174 suites green; no deployed run has occurred | Sandbox | 2026-09-12T04:35Z |
| Web UAT | **PARTIAL** | 22 automated rows executed; deployment-dependent rows blocked | Local | 2026-09-12T04:33Z |
| Android UAT | **BLOCKED** | No physical Android device available to this project | — | — |
| iOS UAT | **BLOCKED** | **User has no iPhone.** Simulator compile is not device verification | — | — |
| Windows UAT | **BLOCKED** | No physical Windows machine; CI packaging is not install verification | — | — |
| F3 (light mode) | **NOT APPLICABLE** | Classified post-RC product gap, not a release blocker. Unchanged | — | — |

---

## Evidence levels

| Level | Meaning | Status |
| --- | --- | --- |
| A | Static analysis / source review | **PASS** |
| B | Unit and integration tests | **PASS** — 234 files, 8,505 tests |
| C | Handler-level tests against real handlers | **PASS** |
| **D** | **Deployed-runtime verification** | **BLOCKED** |

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

### Non-blocking, explicitly accepted

- **F3 light mode** — post-RC product gap, per the existing documented
  classification. Not changed in this phase.
- **ARM64 Windows** — documented, not built, not claimed.

## Phase 186 — deployment pipeline status

The deployment pipeline is prepared and validated. No deployment exists.

| Item | Status |
| --- | --- |
| Convex control plane reachable from the build environment | NO (HTTP 000) |
| `CONVEX_DEPLOYMENT` configured | NO |
| `npx convex codegen` executed against a real deployment | BLOCKED |
| Staging/preview deployment | BLOCKED |
| Production deployment | BLOCKED — and gated on Phase 184 regardless |
| Configuration preflight (`npm run convex:preflight`) | READY, mutation-tested |
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
