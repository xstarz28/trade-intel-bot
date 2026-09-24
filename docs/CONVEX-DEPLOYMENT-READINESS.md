# Convex deployment readiness — Phase 199 audit

**Verdict: BLOCKED.** Everything that can be prepared without deployment
credentials is now prepared and enforced. What remains requires a human with a
Convex account and a registered domain; none of it can be simulated here.

Audited at commit `7ae8eed`, branch `arena/01a08e67-trade-intel-bot`, clean tree.

---

## 1. What "ready" means here

Three different things get confused under the word *ready*, so this document
keeps them apart:

| Level | Meaning | Status |
| --- | --- | --- |
| **Code readiness** | The source can run against a deployment if one exists | **READY** |
| **Configuration readiness** | Required variables are declared, validated, fail-closed | **READY** (validation), **BLOCKED** (values) |
| **Deployment readiness** | A real deployment exists and answers authenticated calls | **BLOCKED** |

A passing local preflight is level 2 only. It is **not** a deployment, and the
preflight says so in its own output.

---

## 2. Prerequisite audit

Presence only — no value is ever printed.

| Prerequisite | State | Evidence |
| --- | --- | --- |
| `CONVEX_DEPLOYMENT` | **unset** | `npx convex codegen` → "No CONVEX_DEPLOYMENT set" |
| `CONVEX_DEPLOY_KEY` | **unset** | environment inspection |
| `CONVEX_SITE_URL` | **unset** | preflight `required-production-vars` FAIL |
| `VITE_CONVEX_URL` | **unset** | preflight; build requires it to be injected |
| ~~`XSTARZ_EMAIL_*`~~ | **RETIRED (Phase 270)** | the email-OTP provider is removed; preflight no longer evaluates any email variable |
| Provider keys (Twelve Data, etc.) | **unset** | preflight (optional classes) |
| `convex.json` | **present, valid** | `functions: "src/convex/"` |
| Auth issuer policy | **correct** | production self-only; retired hosts rejected by name |
| Generated artifacts | **present, no drift** | 23 source modules ↔ 24 api.d.ts entries (`http` has no standalone module) |

### Auth issuer policy — verified correct

`src/convex/lib/issuerPolicy.ts` fails **closed**:

- production trusts only its own issuer;
- a configured external issuer in production is a hard error, not a warning;
- retired hosts (`freebuff.com`, `freebuff.app`, `vly.ai`) are rejected by name
  before the generic rule, giving a clearer error;
- non-https issuers are refused in every environment.

This is the correct posture and needs no change. It is worth stating plainly
why: a trusted issuer can mint a token for *any* account, so "ignore it with a
warning" would leave an operator believing federation is off while it is on.

---

## 3. Official codegen — BLOCKED, and no file was hand-edited

```
$ npx convex codegen
✖ No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project
```

Codegen cannot run without a deployment. **No generated file was modified**, in
this phase or any other.

### The Phase 187 `otpLimiter` entry

Recorded status: `src/convex/otpLimiter.ts` is a **real source module** (5,796
bytes, exporting `consumeResendAllowance` as an `internalMutation`), and
`_generated/api.d.ts` carries the matching entries at lines 28 and 60.

A drift check comparing source modules against generated entries finds:

- **in source but missing from `api.d.ts`: none**
- **in `api.d.ts` without a source file: none** (`http` is a false positive of
  the comparison script's exclusion list, not real drift)

So the generated output is *consistent with* what official codegen would
produce. That is not the same as *being* official output, and the distinction
matters: consistency was verified by comparison, not by running the tool.

**Pending action:** re-run `npx convex codegen` once a deployment exists and
confirm the diff is empty. If it is non-empty, the official output wins —
never patch `_generated` by hand.

**(Superseded by Phase 270.)** The runtime no longer depends on any generated
entry resolving: `emailOtp.ts` is retired and removed, so nothing string-
addresses the limiter through `"otpLimiter:consumeResendAllowance"` anymore.
The limiter tables stay retained-frozen; the historical note below is kept for
provenance only. Originally: `emailOtp.ts` reached the limiter through a
string-addressed function reference precisely because the generated `internal.*`
path was unavailable when the limiter was written. That workaround would have
been replaced with `internal.otpLimiter.consumeResendAllowance` after official
codegen runs.

---

## 4. Control-plane connectivity — egress blocked, not a credential failure

This distinction is the whole point of §4, so the failure mode was measured
rather than assumed.

| Host | DNS | TCP :443 | TLS | HTTP |
| --- | --- | --- | --- | --- |
| `api.convex.dev` | resolves | **OPEN** | **`SSL_ERROR_SYSCALL`** | 000 |
| `provision.convex.dev` | resolves | — | fails | 000 |
| `dashboard.convex.dev` | resolves | — | fails | 000 |
| `api.github.com` (control) | resolves | OPEN | ok | **200** |
| `registry.npmjs.org` (control) | resolves | OPEN | ok | **200** |

**Classification: unavailable egress.** DNS resolves, the TCP handshake on 443
completes, and the connection is then severed during the TLS handshake in
~40 ms — far too fast to be a timeout, and not a refusal either. Controls on the
same network succeed, so this is a TLS-layer egress allowlist, not an outage.

What this evidence does **not** establish:

- it is **not** evidence about credentials — none are configured, so none were
  presented;
- it is **not** evidence that a credential is invalid;
- it is **not** revocation evidence for anything (see Phase 198);
- HTTP 000 means "no answer", and an absence of answer proves nothing about the
  far end.

---

## 5. Production email readiness

**Code: READY. Account and domain: BLOCKED.** These are separate and must not
be reported together.

### Code readiness — verified

`src/convex/lib/emailDelivery.ts` is provider-neutral by construction:

- transports `resend` and `smtp2go` are both implemented as descriptors
  (endpoint + headers + body shape), so swapping vendors is a variable change,
  not a code change;
- **`console` is rejected in production** — a transport that delivers nothing
  while reporting success is the most dangerous possible default;
- **no Freebuff fallback**: absent Xstarz configuration throws before any
  network call, rather than silently sending from a domain the project does not
  own. Now enforced by the preflight's `no-freebuff-otp-dependency` check;
- the OTP, the API key and raw provider responses never appear in errors —
  callers get a category and an HTTP status;
- the sender address must be a valid address on a non-retired domain.

### What still requires a human

| Item | Why it cannot be done here |
| --- | --- |
| ~~Resend **or** SMTP2GO account~~ | **RETIRED (Phase 270)** — email delivery no longer exists |
| ~~`XSTARZ_EMAIL_API_KEY`~~ | **RETIRED (Phase 270)** — inventory entry removed; the variable is inert |
| ~~Registered domain~~ | **RETIRED (Phase 270)** — needed only for the retired sender verification |
| ~~Sender verification~~ | **RETIRED (Phase 270)** |
| ~~SPF / DKIM / DMARC~~ | **RETIRED (Phase 270)** — no mail is sent by this codebase at all |
| `CONVEX_SITE_URL` | Only exists once a deployment exists |
| ~~Actual inbox delivery~~ | **RETIRED (Phase 270)** |

No placeholder credential, no invented domain and no fake DNS record was
created. The test fixtures use `example.invalid`, which is reserved by RFC 2606
and can never resolve.

---

## 6. Evidence D — the smallest checklist that closes it

Evidence D is *authenticated calls succeeding against a real deployment*. It
cannot be inferred from a green suite, a clean build, or a passing preflight.

### Prerequisites (all external)

1. Convex account + project created.
2. `npx convex deploy` run successfully → `CONVEX_DEPLOYMENT` and
   `CONVEX_SITE_URL` exist.
3. ~~Email transport configured with a real key and verified sender~~
   **RETIRED (Phase 270)** — D1 (mailbox delivery) is terminally NOT_VERIFIED;
   the harness runs D2–D10 on anonymous sign-in.
4. Frontend built with the real `VITE_CONVEX_URL`.

### Minimum evidence set — 10 observations

Deliberately the smallest set that still distinguishes "deployed" from
"working". Each must be captured against the deployment, with a timestamp.

| # | Observation | Proves |
| --- | --- | --- |
| D1 | OTP email received at a real mailbox | transport + sender + DNS all real |
| D2 | Sign-in with that code creates a session | auth end-to-end |
| D3 | A protected route rejects an unauthenticated call | isolation is server-side |
| D4 | `getMyEntitlement` returns `GUEST` with `remaining: 2` | entitlement reads work deployed |
| D5 | A BUY/SELL analysis consumes **exactly one** signal | charging is correct |
| D6 | A WAIT/NO_TRADE analysis consumes **zero** | non-chargeable path preserved |
| D7 | The 3rd chargeable request returns **LOCKED**, with no directional field | fail-closed gating, no substituted WAIT |
| D8 | A client-forged entitlement payload does not raise the limit | bypass fails server-side |
| D9 | Provider-backed evidence survives a client-supplied override | provenance integrity |
| D10 | `observedAt` is provider-derived, and cached evidence keeps its original time | no stale-as-live |

D5–D7 are the commercial core; D8–D10 are the integrity core. Anything less and
"deployed" would be claimed on the strength of a login screen rendering.

**Until all ten are captured, Evidence D stays BLOCKED.** Partial capture is
recorded as NOT VERIFIED, never as PASS.

---

## 7. Exact external prerequisites still required

| # | Prerequisite | Owner | Blocks |
| --- | --- | --- | --- |
| 1 | OTP credential rotation at the issuer | Human w/ issuer access | Phase 184, release |
| 2 | Network egress to `*.convex.dev` | Platform | codegen, deploy, Evidence D |
| 3 | Convex account + `CONVEX_DEPLOY_KEY` | Human | deployment |
| 4 | Registered domain | Human | sender identity, canonical URL |
| 5 | Resend/SMTP2GO account + verified sender | Human | OTP delivery, D1 |
| 6 | SPF/DKIM/DMARC on that domain | Human | inbox placement |
| 7 | Live provider API keys | Human | live-data matrix |
| 8 | Android/iOS signing material | Human | mobile release |

Items 2–8 are independent of Phase 184; item 1 gates the release regardless of
the rest.
