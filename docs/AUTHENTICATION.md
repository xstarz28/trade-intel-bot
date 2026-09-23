# Authentication and OTP delivery

## Migration state

Four states, tracked separately. Conflating them is how a project convinces
itself it has shipped something it has not.

| State | Status | Meaning |
| --- | --- | --- |
| **Code-ready** | **YES** | The runtime no longer calls `auth.freebuff.app`. |
| **Configured** | **NO** | Needs a provider account and an Xstarz domain. |
| **Deployed** | **NO** | Convex has never been deployed from this environment. |
| **Verified** | **NO** | No real email has been delivered. |

Only the first is achievable without external accounts, and only the first is
claimed.

## Before and after

```
Before:  user -> Convex Auth -> auth.freebuff.app/send_otp -> inbox
After:   user -> Convex Auth -> Xstarz delivery module -> provider -> inbox
```

Convex Auth is unchanged. It remains the authentication and session layer; only
the mail transport moved. Swapping a framework to change an email vendor would
have been a rewrite in search of a problem.

## Architecture

```
src/convex/auth.ts                    providers + failed-attempt limit
src/convex/auth.config.ts             trusted token issuers
src/convex/auth/emailOtp.ts           code generation, throttle, delivery call
src/convex/lib/emailDelivery.ts       provider-neutral transport
src/convex/lib/otpResendThrottle.ts   per-address send throttling
```

`emailDelivery.ts` and `otpResendThrottle.ts` live in `src/convex/lib/` because
they export no Convex functions. That is the existing convention for pure
helpers (`lib/requireIdentity.ts`) and it keeps them out of the generated API
surface.

### Why the abstraction exists

The auth layer calls `sendXstarzVerificationEmail({ recipient, otp, expiryMinutes })`.
It does not know which vendor sends the mail. A transport is a descriptor — URL,
headers, body shape — so adding a vendor means adding a descriptor, not editing
the auth flow.

**The decisive test:** changing provider requires changing
`XSTARZ_EMAIL_TRANSPORT` and `XSTARZ_EMAIL_API_KEY`. No code change, no
redeploy of auth logic.

## Configuration

All server-side. None of these may ever be `VITE_`-prefixed, written to
browser storage, Android resources, an iOS plist, the Tauri config, or the JS
bundle.

| Variable | Required | Purpose |
| --- | --- | --- |
| `XSTARZ_EMAIL_TRANSPORT` | No (default `resend`) | `resend`, `smtp2go` or `console` |
| `XSTARZ_EMAIL_API_KEY` | Yes, unless `console` | Provider credential |
| `XSTARZ_EMAIL_SENDER_ADDRESS` | Yes, unless `console` | Must be an Xstarz-owned, verified domain |
| `XSTARZ_EMAIL_SENDER_NAME` | No | Defaults to `Xstarz Analysis` |
| `XSTARZ_EMAIL_TIMEOUT_MS` | No | Default 10,000; capped at 30,000 |
| `XSTARZ_OWNER_PRINCIPALS` | No | Server-only OWNER overlay. Comma-separated `email:` / `user:` principals. Unset or malformed matches nobody. Never `VITE_`-prefix. |

There is **no fallback sender**. Missing configuration throws before any
network call. A silent fallback would send production mail from an identity the
project does not own, which is the exact failure this phase exists to remove.

### Removed

| Variable | Why |
| --- | --- |
| `OTP_EMAIL_API_KEY` | Credential for the retired third-party OTP service |
| `VLY_APP_NAME` | Existed only to label that service's email |

Removing them from the runtime does **not** revoke the leaked credential.
Rotation and history remediation are Phase 184 and remain open.

### Retained, with reasons

Each was traced to a real consumer before being kept.

| Variable | Used by | Runtime-required | Planned removal |
| --- | --- | --- | --- |
| `VLY_CONVEX_AUTH_ISSUER` | `auth.config.ts` | No — now opt-in | When the preview platform is no longer used |
| `VLY_INTEGRATION_KEY` | — (removed Phase 224: `src/lib/vly-integrations.ts` and `@vly-ai/integrations` deleted) | No | Gone |
| `VITE_VLY_APP_ID` / `VITE_VLY_MONITORING_URL` | — (removed Phase 224: `src/instrumentation.tsx` deleted) | No | Gone |

## Provider selection: Resend (default), SMTP2GO (alternate)

Chosen on fit, not on price.

| Criterion | Resend | Why it matters |
| --- | --- | --- |
| Transactional OTP suitability | Purpose-built | Marketing platforms deprioritise transactional mail |
| API | HTTPS JSON | Works from a Convex action; no SMTP socket needed |
| Domain authentication | SPF/DKIM/DMARC guided | Required for inbox placement |
| Free tier | 3,000/month, 100/day | Enough to validate without a billing commitment |
| Account ownership | Xstarz-owned account and billing | Non-negotiable |

**Postmark** measures better on raw transactional deliverability and is the
upgrade path if inbox placement disappoints — its free allowance (100/month) is
too small for testing, which is the only reason it is not the default.
**SendGrid** was excluded: it retired its free tier in May 2025.

Because `XSTARZ_EMAIL_TRANSPORT` is configuration, this decision is reversible.
The abstraction is the durable part; the default is not.

## Sender identity

**No domain is invented.** The repository has no confirmed Xstarz domain, so
`XSTARZ_EMAIL_SENDER_ADDRESS` ships empty and production refuses to send
without it.

A sender on a retired third-party domain is rejected outright, even if set
deliberately — owning the sending identity is the point.

### DNS steps required once a domain is purchased

1. Add the domain in the provider dashboard.
2. Publish the **SPF** record (`v=spf1 include:...`).
3. Publish the **DKIM** records the provider generates.
4. Publish a **DMARC** policy — start `p=none`, tighten to `p=quarantine`.
5. Wait for the provider to report the domain verified.
6. Set `XSTARZ_EMAIL_SENDER_ADDRESS=no-reply@<domain>`.
7. Send a real test and confirm inbox placement, not just a 200 response.

Also pending on the same domain: the website origin, the auth callback origin,
Android App Links and iOS Universal Links.

## OTP security

Convex Auth already provides most of this. It was verified in the library
source rather than assumed, and deliberately **not** reimplemented — a second
source of truth for authentication state is worse than the problem it solves.

| Control | Provided by | Detail |
| --- | --- | --- |
| CSPRNG generation | This project | `crypto.getRandomValues`, rejection-sampled digits |
| Hashed at rest | Convex Auth | `code: await sha256(code)` |
| One-time use | Convex Auth | Row deleted on successful verification |
| Replay rejected | Convex Auth | Deleted code cannot match again |
| Expiry | This project + Convex Auth | 10 minutes, enforced server-side |
| Supersession | Convex Auth | Issuing a new code deletes the previous one |
| Failed-attempt limit | This project | 5/hour per identifier (default is 10) |
| **Resend throttling** | **This project** | **60s cooldown, 5 per hour, per address** |
| No OTP in logs | This project | Console transport logs a masked recipient only |
| No OTP in errors | This project | Errors carry a category and HTTP status only |
| No credential in errors | This project | Provider response body is never interpolated |

### Why resend throttling had to be built

Convex Auth rate-limits *failed verification attempts*. It does not limit how
often a code can be **requested**. Those are different abuses:

- Unlimited attempts = brute-forcing a code.
- Unlimited *sends* = mail-bombing a third party through this deployment, and
  burning the Xstarz domain's sending reputation while doing it.

Only the second was unaddressed, so only the second was implemented.

**Honest limitation:** the throttle is in-memory, so it bounds abuse per action
instance rather than globally. It raises the cost of casual abuse and protects
sender reputation. It is not a complete anti-abuse system — that is Phase 187,
which can move it to a durable store without changing the call sites.

## Deployment environment: `XSTARZ_DEPLOYMENT_ENV`

Two Phase 185b guards must behave differently in production than in
development, so the backend needs to know which one it is running on.

**Why not detect it automatically?** Convex exposes only `CONVEX_CLOUD_URL` and
`CONVEX_SITE_URL` to functions. Both are `https://<name>.convex.cloud` for dev
and production alike, the names are not distinguishable by pattern, and there
is no `deploymentType` at runtime. `NODE_ENV` describes how the bundle was
built, not which deployment it was pushed to, so a production deployment built
from a dev machine would report the wrong thing. Guessing from either one would
mean a production deployment could silently classify itself as development —
exactly the failure this phase exists to prevent.

The mechanism is therefore an explicit Convex environment variable set once per
deployment:

| Value | Console transport | Federated issuer |
| --- | --- | --- |
| `production` | rejected | self-issuer only; any configured issuer is refused |
| `preview` | allowed | explicit https issuer permitted |
| `development` | allowed | explicit https issuer permitted |

Two deliberate properties:

- **Absent or empty means `production`.** Forgetting the variable on a
  production deployment keeps every restriction on. Forgetting it locally fails
  immediately and visibly, which is the cheap direction to fail in.
- **An unrecognised value throws.** `prod`, `staging` or a typo raises
  `DeploymentPolicyError` rather than quietly downgrading to a permissive mode.

## Federated issuer hardening

`auth.config.ts` previously trusted `https://freebuff.com` as a JWT issuer by
default. Anyone controlling that issuer's JWKS could mint a token this
deployment accepts as a signed-in user. Phase 185 made it opt-in; Phase 185b
makes it impossible in production.

The decision now lives in `src/convex/lib/issuerPolicy.ts`, and `auth.config.ts`
holds no inline environment read:

- **Production** trusts exactly one issuer: itself (`CONVEX_SITE_URL`). Any
  value in `VLY_CONVEX_AUTH_ISSUER` is a configuration error and throws. The
  retired hosts (`freebuff.com`, `freebuff.app`, `vly.ai`, including
  subdomains) are named explicitly in the error; any other external issuer is
  refused generically, because there is no approved federation mechanism.
  Production cannot fall back to federation by any code path.
- **Preview and development** may still federate, because the preview platform
  requires it. The issuer must be explicitly configured and must be `https`.
- **Empty or whitespace-only** is treated as absent everywhere, never as a
  malformed issuer, so a blank variable degrades to self-issuer only.
- **Malformed or non-https** values throw rather than being ignored.

## Sessions

One backend identity model across web, Android, iOS and Windows, because all
four load the same web application against the same Convex deployment.

```
OTP sign-in -> session issued -> JWT refreshed hourly -> expiry -> OTP again
```

The project sets no session overrides, so the `@convex-dev/auth` defaults
apply. Read from the installed library source rather than assumed:

| Setting | Value | Source |
| --- | --- | --- |
| Total session duration | 30 days | `DEFAULT_SESSION_TOTAL_DURATION_MS`, `implementation/sessions.ts` |
| Inactive session duration | 30 days | `DEFAULT_SESSION_INACTIVE_DURATION_MS`, `implementation/refreshTokens.ts` |
| JWT duration | 1 hour | `DEFAULT_JWT_DURATION_MS`, `implementation/tokens.ts` |

**Refresh behaviour.** The short-lived JWT is refreshed roughly hourly using a
refresh token, and refresh tokens rotate on use. A signed-in user is therefore
not prompted for an OTP on page load; they re-authenticate when the session
reaches 30 days total, or after 30 days of inactivity.

This is **not** "forever login", and the phrase should not appear in product
copy. Sessions expire and re-authentication is required. The intended UX — OTP
once, then a persistent secure session — is already what this policy delivers,
so there is no reason to weaken it to reduce OTP frequency.

## OTP resend throttling: scope (superseded by Phase 187)

> **Updated in Phase 187.** The limiter below has been replaced by durable,
> distributed state in the `otpResendBuckets` table, written by a single
> atomic mutation. See `docs/ABUSE-PROTECTION.md`. The text that follows
> describes the retired per-process design and is kept for history.

### Retired design

`src/convex/lib/otpResendThrottle.ts` is **in-memory and per-process**. Convex
action instances are not singletons, so throttle state is not shared between
them.

It bounds repeated sends per instance, which stops casual abuse from a single
caller and protects the sending domain's reputation. It does **not prevent
distributed abuse**: an attacker whose requests land on different instances, or
who spreads them across many addresses, is not stopped. It is not a complete
anti-abuse system.

Durable, shared-state rate limiting is Phase 187. The call sites will not
change when it lands — only the storage behind `checkResendAllowed` and
`recordResend`.
