# Production email / OTP setup runbook

> **RETIRED — Phase 270 (2026-09-24).** The email-OTP sign-in path no longer
> exists: the provider was removed from `src/convex/auth.ts` and its delivery
> modules were deleted. There is no email sending identity to set up, **D1**
> (mailbox-delivered OTP session) is permanently unobservable, and no
> `XSTARZ_EMAIL_*` variable is required or read anywhere. This document is
> preserved for traceability of the Phase 185/214 work; it must not be used as
> an activation guide. The steps below describe a capability that has been
> removed, not a dormant one — there is no code path left for them to
> configure.

This was the operator procedure for giving Xstarz Analysis a real email sending
identity, back when email-OTP sign-in existed. It was written to be followed
*after* an email provider account and a domain exist. Nothing in this document
creates either.

**No secret appears in this repository, in chat, or in any report.** Every
value below is referred to by its configuration *name* only. Do not paste an
API key, a deploy key, an OTP or a mailbox password into the repo or into a
conversation with the agent.

---

## 1. Required configuration names

Set these in the **Convex deployment environment** (`npx convex env set NAME`),
never in a committed file.

| name | required | purpose |
| --- | --- | --- |
| `XSTARZ_EMAIL_TRANSPORT` | yes | `resend` \| `smtp2go` \| `console`. Defaults to `resend`. `console` is refused in production. |
| `XSTARZ_EMAIL_API_KEY` | yes (real transports) | Provider API key. Not required for `console`. |
| `XSTARZ_EMAIL_SENDER_ADDRESS` | yes (real transports) | The verified sending address, e.g. `no-reply@<your-domain>`. |
| `XSTARZ_EMAIL_SENDER_NAME` | no | Display name. Defaults to `Xstarz Analysis`. |
| `XSTARZ_EMAIL_TIMEOUT_MS` | no | Send timeout. Defaults to the built-in value, capped at 30000. |
| `XSTARZ_DEPLOYMENT_ENV` | yes | `production` \| `development` \| `preview`. **Unset resolves to production**, deliberately. |
| `SITE_URL` | yes | Public site origin used in auth flows. No invented domain. |
| `CONVEX_DEPLOYMENT` / deploy key | yes | Standard Convex deployment identity. |

There is no separate "SPF/DKIM/DMARC" variable — those are DNS records at the
domain registrar, not application configuration.

### Provider-specific notes

- **Resend** — key is account-scoped; the sending domain must be added and
  verified in the Resend dashboard before mail will leave. Free tier 3,000/mo
  (100/day) at time of writing.
- **SMTP2GO** — key is account-scoped; sending is throttled until the domain is
  verified (documented as 25/hr pre-verification). Free tier 1,000/mo.

The codebase has **no hard preference** between them: `buildProviderRequest`
supports both and the transport is selected purely by
`XSTARZ_EMAIL_TRANSPORT`. Choose based on the account you can actually obtain.
If OTP inbox placement later proves to be the binding constraint, Postmark is
the documented upgrade path — it would need a new transport branch.

---

## 2. Fail-closed behaviour (already enforced, do not weaken)

`readEmailDeliveryConfig` throws `not_configured` — and no mail is attempted —
when any of the following is true:

| condition | result |
| --- | --- |
| `XSTARZ_EMAIL_TRANSPORT` is not one of the three supported values | refused |
| transport is `console` **and** the deployment resolves to production | refused |
| `XSTARZ_EMAIL_API_KEY` missing on a real transport | refused |
| `XSTARZ_EMAIL_SENDER_ADDRESS` missing | refused |
| sender is not a plausible email address | refused |
| sender domain is a retired host (`auth.freebuff.app`, `freebuff.com`, `freebuff.app`, `vly.ai`, or any subdomain) | refused |
| sender domain is a provider shared test host (`resend.dev` or a subdomain) **and** the deployment is production (or `XSTARZ_DEPLOYMENT_ENV` is unset) | refused |

The retired-host list is derived from `RETIRED_ISSUER_HOSTS`, so a host retired
for auth is automatically retired for sending. Phase 214 fixed a real gap here:
`vly.ai` was blocked as an auth issuer but **accepted as an OTP sender**.

A provider shared test mailbox is a **separate** case from retired Freebuff/VLY
hosts. It is not Xstarz-owned and cannot deliver production OTP to arbitrary
recipients; see §7.

An unset `XSTARZ_DEPLOYMENT_ENV` resolves to *production*, so a
misconfigured deployment fails closed rather than silently using a transport
that delivers nothing.

---

## 3. Safe setup order

Do these in order. Steps 1–3 are external and cannot be performed from this
repository.

1. **Obtain a domain** you control. Do not reuse a retired domain.
2. **Create the provider account** (Resend or SMTP2GO) and add the domain.
3. **Publish DNS records** the provider specifies: SPF, DKIM, and a DMARC
   policy. Wait for the provider dashboard to show the domain **verified**.
4. **Set the Convex environment variables** from the table above. Use
   `npx convex env set`; never commit them.
5. **Deploy** the hardened RC (never `main` — see §5).
6. **Run the OTP flow** against a real mailbox you can open.
7. **Confirm receipt by eye**, then sign in with the received code.
8. **Capture the evidence** (§4).

---

## 4. The D1 execution contract

D1 is **PASS only when all three hold**:

1. the verification email was **actually received** in a real mailbox,
2. a **human attestation** of that receipt is recorded, and
3. an **OTP session was created through the application** using that code.

Then, and only then, run the harness so D2–D10 execute inside the session the
OTP created:

```powershell
npm.cmd run --silent evidence:d -- --auth otp --otp <code-from-your-mailbox> --sweep 25 --json | Out-File -Encoding utf8 phase-d1.json
```

### What is explicitly NOT D1

| not evidence | why |
| --- | --- |
| provider API returns HTTP 200 | an accepted request is not a delivered message |
| provider dashboard shows "delivered" | corroborating, but it is the provider attesting to itself |
| `console` transport output | delivers nothing; it would let any address be "verified" |
| a screenshot of the code in logs | the code never left the server |
| a passing unit or integration test | Evidence D cannot be inferred from Evidence A–C |

Until a real mailbox receives a code, **D1 stays BLOCKED**. Do not record it
otherwise.

---

## 4b. Can DEV OTP be exercised today?

Unknown from the repository, and deliberately not guessed. The agent sandbox
has no access to the DEV deployment's environment, so it cannot tell whether a
real transport is already configured there.

The operator can settle it in one command, which prints **names only** and
never a value:

```powershell
npx.cmd convex env list --names-only
```

**`--names-only` is mandatory here.** Plain `npx convex env list` prints
`NAME=VALUE` for every variable — verified in the Convex CLI source
(`envList` falls through to `logOutput(\`${name}=${formatted}\`)` unless
`namesOnly` is set). Running it without the flag would print the live API key
to the terminal and into any captured transcript. If you have already run it
without the flag, treat the key as exposed and rotate it.

Read the result as follows:

| what you see | meaning | next step |
| --- | --- | --- |
| `XSTARZ_EMAIL_TRANSPORT` = `resend`/`smtp2go` **and** `XSTARZ_EMAIL_API_KEY` present **and** `XSTARZ_EMAIL_SENDER_ADDRESS` present | a real transport is configured in DEV | a DEV OTP smoke test is possible — run the flow and confirm receipt in a real mailbox |
| `XSTARZ_EMAIL_TRANSPORT` = `console`, or the key/sender missing | no real transport | **D1 stays BLOCKED**; do not substitute console output for delivery |
| nothing set | defaults to `resend` with no key ⇒ sends are refused | **D1 stays BLOCKED** |

A DEV smoke test that really delivers to a real mailbox is useful: it exercises
transport, sender validation and the limiter end to end. But note what it does
**not** do — it is still a development deployment, so it cannot produce
production evidence, and `productionEvidence` will remain `false`.

## 4c. Safe configuration-gate sequence (Phase 216)

Run these in order against the DEV deployment. Every command below prints
either names only, or a value that is safe to disclose. **None of them prints
the API key.**

```powershell
# 1. Names only - never values.
npx.cmd convex env list --names-only

# 2. Transport value (non-secret: resend | smtp2go | console).
npx.cmd convex env get XSTARZ_EMAIL_TRANSPORT

# 3. Sender identity (non-secret: it appears in the headers of every message).
npx.cmd convex env get XSTARZ_EMAIL_SENDER_ADDRESS

# 4. Public origin.
npx.cmd convex env get SITE_URL
```

**Never run `npx convex env get XSTARZ_EMAIL_API_KEY`.** `env get` prints the
raw value with no masking. Step 1 already answers the only question that
matters about the key — whether the name is present.

Report back: the five names from step 1 (present/absent), plus the values from
steps 2–4. Do not paste anything else.

### Decision

`DEV OTP SMOKE TEST POSSIBLE` requires **all** of:

| condition | check |
| --- | --- |
| transport is `resend` or `smtp2go` | step 2 — `console` fails this gate |
| `XSTARZ_EMAIL_API_KEY` present | step 1 — presence only |
| sender present and on a permitted domain | step 3 — not a retired Freebuff/VLY host |
| `XSTARZ_DEPLOYMENT_ENV` is `development` | step 1 + known DEV deployment |
| `SITE_URL` present | step 4 |

Any failure ⇒ `DEV OTP SMOKE TEST NOT POSSIBLE`, D1 stays **BLOCKED**, and the
dependency is external provisioning — not further repository work.

Passing this gate still does **not** make D1 PASS. It only means the smoke test
can be attempted. D1 needs a real mailbox, a human attestation, and a session
created through the application.

### If the unsafe command was already run

If `npx convex env list` (without `--names-only`) was executed at any point in
the operator environment, the Xstarz email API key has been disclosed to the
terminal and possibly to shell history and scrollback. **Rotate that key**:
create a new one in the provider dashboard, `npx convex env set
XSTARZ_EMAIL_API_KEY` with the new value, then revoke the old one in the
dashboard. This is unrelated to the Phase 184 Freebuff credential and does not
affect that blocker in either direction.

## 5. This is NOT the leaked-credential rotation

These are two separate credentials and closing one does not close the other.

| | new Xstarz email credential | leaked Freebuff OTP credential |
| --- | --- | --- |
| what | `XSTARZ_EMAIL_API_KEY` for your own provider account | the third-party key committed to git history |
| status | to be created by the operator | **live in 270/339 commits; exposed at the tip of `main`** |
| closes D1? | yes, once mail is received | no |
| closes Phase 184? | **no** | only after revocation is *verified* |

**Configuring production email does not revoke the leaked key.** The Phase 184
history rewrite remains blocked until the old credential is rotated at the
issuer and an authenticated request using it is observed to return **401/403**.
Order is fixed: rotate → configure → revoke → verify REJECTED → rewrite history
→ re-tag → rebuild → re-verify. Never rewrite history first.

Also unchanged: deploy the hardened RC, never `main`. `main` still carries the
credential at its tip.

---

## 6. OTP security policy (audited Phase 214, unchanged)

| invariant | value | where |
| --- | --- | --- |
| OTP lifetime | 10 minutes | `emailOtp.ts` `maxAge: 60 * OTP_EXPIRY_MINUTES` |
| code generation | CSPRNG, rejection-sampled, 6 digits | `@oslojs/crypto` `generateRandomString` |
| failed sign-in attempts | 5 per hour | `auth.ts` `maxFailedAttempsPerHour` |
| resend cooldown | 60 s | `RESEND_COOLDOWN_MS` |
| resend limit | 5 per rolling hour | `MAX_SENDS_PER_WINDOW` / `RESEND_WINDOW_MS` |
| limiter identity | SHA-256 hash; **no raw address stored** | `otpLimiter.ts` `hashIdentifier` |
| rejected request | does **not** extend the cooldown | returns before any `patch`/`insert` |
| failed send | does **not** refund the allowance | deliberate: a refund path is an unlimited-retry oracle |
| error surface | category only, never the payload | the raw error can embed the OTP and the API key |

Do not change any of these to make setup easier.

---

## 7. Temporary provider test sender (not production)

Some providers ship a shared test sending identity (Resend documents
`resend.dev`) so an account can send a few messages before a domain is
verified. That identity is **not** an Xstarz-owned domain and is **not**
production-verified. Resend's test mailbox typically delivers only to the
Resend account owner, not to arbitrary production users.

| deployment | shared test sender (`resend.dev`) |
| --- | --- |
| production, or `XSTARZ_DEPLOYMENT_ENV` unset | refused (`not_configured`) before any network call |
| `development` or `preview` | permitted as a **temporary** test sender only |

Do **not**:

- treat a provider test mailbox as an Xstarz sending identity
- mark production email transport verified while the sender is a shared test identity
- bypass the production refuse by switching transport to `console`
- fall back to a retired Freebuff/VLY sender

When a privately owned Xstarz domain is verified at the provider, change
`XSTARZ_EMAIL_SENDER_ADDRESS` (and optionally `XSTARZ_EMAIL_SENDER_NAME`) in
the Convex deployment environment. The delivery module, OTP path
(`sendXstarzVerificationEmail`) and templates do not need an architecture
change.

The visible From header is always `XSTARZ_EMAIL_SENDER_NAME` (default
`Xstarz Analysis`) plus the configured mailbox, so users see Xstarz branding
even while the mailbox is still a temporary provider address in non-production.

### Templates

OTP mail and future security/account notices share the same delivery path:

- **Verification / login OTP** — product name, code, expiry, do-not-share,
  “if you did not request this”. The code is never in the subject line.
- **Security notice** — product name, a short non-secret event label, and
  “if this was not you”. No OTP, no tracking pixel, no market content.

Both are rendered by `src/convex/lib/emailTemplates.ts` and sent by
`src/convex/lib/emailDelivery.ts`. Auth continues to call
`sendXstarzVerificationEmail()` only.
