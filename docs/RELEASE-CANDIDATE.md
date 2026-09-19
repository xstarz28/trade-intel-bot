# Release Candidate — Xstarz Analysis

Phase 181 audit. **Verdict: NOT READY for public release.**

This is an audit record, not an approval. Several items below are green; the
ones that are not are the ones that decide the verdict.

---

## 1. Release-candidate identity

| Field | Value |
| --- | --- |
| Branch | `arena/01a08e67-trade-intel-bot` |
| Commit | `155b59e` |
| Tag | `rc-181` |
| **Not deployable** | `main` (`51c9dde`) |

`main` is 25+ commits behind and its tip still contains the leaked OTP
credential. Do not merge to it, do not deploy from it.

### Traceability

Every build embeds its own commit, branch and commit timestamp. Read it from
the browser console:

```
[Xstarz Analysis] build 155b59e (arena/01a08e67-trade-intel-bot) built 2026-09-12T…
```

Builds are **reproducible**: the embedded timestamp is the commit time, not
wall-clock time, so rebuilding a commit reproduces the artifact byte-for-byte.
Verified by building the same source twice and comparing SHA-256. (Before this
phase the build used `new Date()`, which made provenance unverifiable — an
artifact could claim a commit without any way to check it.)

`SOURCE_DATE_EPOCH` is honoured for tarball builds; `GITHUB_REF_NAME` supplies
the branch in CI's detached checkout.

---

## 2. Stage-by-stage status

No stage is marked PASS unless it was actually executed and observed.

| # | Stage | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Source commit identified | **PASS** | `155b59e`, tag `rc-181` |
| 2 | Web build | **PASS** | `npm run build` exit 0; reproducible |
| 3 | Convex codegen | **BLOCKED** | `No CONVEX_DEPLOYMENT set`; control plane TLS-blocked |
| 4 | Convex deployment | **BLOCKED** | never deployed |
| 5 | Provider configuration | **BLOCKED** | all six provider hosts unreachable |
| 6 | Web deployment contract | **PASS (local host)** | routes 200+HTML; JS `text/javascript`; CSS `text/css`; `.well-known` `application/json` |
| 7 | Web deployment (real host) | **NOT EXECUTED** | needs an operator deploy |
| 8 | Android debug APK | **PASS (CI)** | built on `ubuntu-latest`; APK contains `assets/public/index.html` with absolute base |
| 9 | iOS compile | **PASS (CI, simulator)** | `macos-14`; Pods installed; `App.app` with executable + web assets |
| 9a | Windows desktop package | **NOT YET RUN** | Tauri 2 job added; no Rust toolchain or Windows in the sandbox |
| 10 | Artifact secret scans | **PASS** | `mobile:verify` across dist/, android/, ios/ |
| 11 | Deep links | **CONFIGURED, NOT VERIFIED** | placeholders present by design |
| 12 | Auth | **BLOCKED** | requires a deployed backend |
| 13 | Entitlement | **PASS (unit)** / **BLOCKED (deployed)** | Phase 174 suites green; no deployed run |
| 14 | UAT | **PARTIAL** | 12 automated executed; 9 human, 10 blocked |
| 15 | Security | **FAIL — BLOCKER** | OTP credential unrotated |

---

## 2a. Cross-platform distribution matrix (Phase 182)

Four surfaces, one codebase. Statuses are kept separate on purpose — collapsing
them into a single PASS is how "it builds" becomes mistaken for "it ships".

| Surface | Build | Runtime | Distribution | code-ready | CI-verified | deployed | human-tested | production-ready |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Web | Vite | Browser | Official website | ✅ | ✅ | ❌ | ❌ | ❌ |
| Android | Capacitor | Android WebView | APK / Play Store | ✅ | ✅ debug APK | ❌ | ❌ | ❌ |
| iOS | Capacitor | WKWebView | App Store | ✅ | ✅ simulator compile | ❌ | ❌ | ❌ |
| Windows | Tauri 2 | WebView2 | Microsoft Store + direct download | ✅ | ⏳ job added, not yet run | ❌ | ❌ | ❌ |

Definitions, so the columns cannot be read charitably:

- **code-ready** — the surface builds from this repository and its artifact
  passes the secret/permission scans.
- **CI-verified** — a hosted runner produced the artifact and asserted on its
  contents. Android yields a *debug* APK; iOS is an *unsigned simulator*
  compile. Neither is a release build.
- **deployed** — reachable by a real user. Nothing is: Convex has never been
  deployed and no store or download page exists.
- **human-tested** — exercised on real hardware by a person. Nothing is.
- **production-ready** — all of the above plus the credential rotation.

**Every surface consumes the same protected decision pipeline.** The desktop
shell has no HTTP client, no provider hostnames and no analysis code; the
mobile shells wrap the same `dist/`. There is one UI and one backend.

---

## 3. Evidence levels

| Level | Meaning | Status |
| --- | --- | --- |
| A | Static analysis / source review | ✅ |
| B | Unit and integration tests | ✅ 233 files, 8,474 tests |
| C | Handler-level tests against real handlers | ✅ |
| **D** | **Deployed-runtime verification** | ❌ **BLOCKED** |

Evidence D requires a live Convex deployment. It is unreachable from this
environment, and **mocked tests are never a substitute** — a mock proves the
code does what we told it to, not that a deployment behaves that way.

---

## 4. Network reality

Re-probed during this audit, not assumed:

| Host | Result |
| --- | --- |
| `registry.npmjs.org`, `api.github.com` | 200 |
| `provision.convex.dev`, `api.convex.dev`, `dashboard.convex.dev` | 000 |
| All six provider hosts | 000 |

TCP 443 opens but TLS is terminated — a **domain allowlist**, not an outage.
GitHub Actions artifact and log blob storage is on the same blocked list, so
CI artifacts cannot be downloaded here for local inspection; artifact scanning
therefore runs **inside** CI, where it passed.

---

## 5. CI: what green does and does not guarantee

| Workflow | Result | Guarantees | Does NOT guarantee |
| --- | --- | --- | --- |
| `ci.yml` | ✅ | Tests, typecheck, build, secret scan on a clean checkout | Anything about a deployment |
| `mobile.yml` → android | ✅ | Debug APK compiles; web assets inside; absolute base; no secrets | A release build, or device behaviour |
| `mobile.yml` → ios | ✅ | Pods install; `App.app` with executable; assets inside | **Physical iPhone behaviour** |

Three false-green conditions were found and fixed during this audit:

1. **Mobile trigger gap.** The workflow ran only on "mobile-looking" paths,
   but both apps embed the same `dist/` built from the whole app. Proven by
   measurement: editing `src/pages/Dashboard.tsx` changed the artifact's
   SHA-256 while matching no trigger path. Now an exclude-list, which fails
   safe by running a redundant build instead of silently skipping.
2. **Non-hermetic suite.** `phase75` called CoinGecko for real; it always
   "passed" locally only because the sandbox blocks the network. CI failed.
   Moved to the live-only config alongside phase72/73/74.
3. **iOS false green.** The job reported success with `pod install` finishing
   in one second and no `Pods/` committed. Both jobs now assert on their
   outputs rather than trusting an exit code.

`continue-on-error` is present on exactly one step — advisory lint, whose
backlog (1517, unchanged from baseline) predates this work. A test asserts it
can never spread to a correctness gate.

---

## 6. Security — the decisive blocker

See `docs/SECURITY-REMEDIATION.md`.

| Question | Finding |
| --- | --- |
| Credential in current tree? | No |
| In `dist/`, APK, or iOS bundle? | No |
| Hardened branch uses env var only? | Yes, and throws if unset |
| In `main`'s tree? | **Yes** — `src/convex/auth/emailOtp.ts:29` |
| Commits containing it | **9** (8 on the RC branch's history, 1 is `main`'s tip) |
| Rotated? | **No** |

The artifact is clean; the **history is not**, on both branches. Because
`51c9dde` is `origin/main`'s tip, the credential is readable by anyone with
repository access right now. Removing it from the working tree did not
neutralise it.

Rotation must happen **before** any history rewrite: rewriting does not
invalidate a key that still works, and it destroys every commit SHA this
audit depends on.

---

## 7. F3 — light mode classification

**Classification: B — post-RC product gap. Not a release blocker.**

This follows the existing documented decision rather than a new one:
`docs/PRODUCTION-VERIFICATION.md` records F3 as *Medium* severity and
`docs/UAT-MATRIX.md` row 12.1 records it as *"Open — documented, not fixed…
a design decision, not a bug fix."*

Current state is unchanged and openly stated: `index.html` hardcodes
`class="dark"`, `.dark {}` is empty, and `--primary` is teal rather than the
specified blue. **Not silently marked fixed.** No palette was authored during
this audit, because the release requirement does not demand one.

---

## 8. Remaining blockers

| # | Blocker | Severity | Cleared by |
| --- | --- | --- | --- |
| 1 | OTP credential unrotated, live in `main` | **Critical** | Human rotation at `auth.freebuff.app` |
| 2 | Convex never deployed (Evidence D absent) | **Critical** | Operator on an unrestricted network |
| 3 | No live provider verification | **High** | Same |
| 4 | Auth/entitlement unverified on a deployment | **High** | Follows 2 |
| 5 | Deep links unverified (placeholders) | **Medium** | Release keystore + Apple Team ID |
| 6 | No physical device testing | **Medium** | Human with an Android device and an iPhone |
| 7 | F3 light mode | **Low** | Product decision, post-RC |

---

## 9. Honest limitations

- **A debug APK is not a release artifact.** No signing material exists in
  this repository, by design.
- **A simulator compile is not iPhone verification.** No one on this project
  has an iPhone; no CI runner substitutes for one.
- **CI green is not production readiness.** It says the code builds and
  packages, nothing about a deployment that has never existed.
- **`isolate/`** was a stale committed build output from `main` (Phase 156),
  carrying old Convex deployment URLs and the pre-fix relative asset base.
  **Removed in Phase 184** after confirming it had no build, deploy, test or
  packaging dependency. It was deleted outright rather than git-ignored,
  because ignoring a tracked file leaves it in the repository and in history.

---

## RC identity after history remediation

`rc-181` (and the current RC commit `be98364`) point at objects that a history
rewrite will destroy. Both become unusable the moment remediation runs.

Sequence once the operator confirms the old credential is revoked:

1. Rewrite history on a full mirror (`docs/SECURITY-REMEDIATION.md`).
2. Verify zero reachable occurrences — `node scripts/verify-history-clean.mjs`
   must exit 0.
3. Force-push all branches and tags.
4. Re-run every gate against the rewritten history.
5. Rebuild, and confirm the embedded provenance matches the **new** commit.
6. Tag the result **`rc-184`** and record the new SHA here.

Until step 6 completes there is no valid release-candidate identity. Any
artifact built before the rewrite references a commit that no longer exists,
so its provenance cannot be validated — it must not be treated as a release
candidate regardless of how it was produced.

## 10. Verdict

**NOT READY.**

The engineering pipeline is in good shape: reproducible builds, both mobile
platforms compiling in CI with output assertions, clean artifact scans, and
8,474 passing tests. None of that resolves an unrotated live credential or a
backend that has never been deployed.

**Recommended next phase: 182 — Operator-Gated External Verification.** Every
remaining blocker needs an action outside this environment (rotate the
credential, deploy Convex, configure providers, supply signing identities,
test on real devices). The correct next step is an operator runbook plus the
automation to verify each item the moment access exists — not more code.
