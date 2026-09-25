# Deployment handoff — Xstarz Analysis

**Deployment baseline: `5b3f0c4` on `arena/01a08e67-trade-intel-bot`.**
Phase 200 prepared everything that can be prepared without credentials. This
document is the ordered procedure for an operator who has them.

Nothing here has been executed. Every step that needs credentials or network
access this environment does not have is marked and left for you.

---

## 0. Before you start

Two independent blockers exist. They are unrelated and can be worked in
parallel, but **neither is cleared by the other**:

| Blocker | Owner | Cleared by |
| --- | --- | --- |
| Leaked OTP credential (Phase 184/198) | issuer account holder | revoking the key, proven by a 401/403 |
| `*.convex.dev` egress | platform/network | a successful TLS handshake |

Run this first — it tells you which of the two you are looking at:

```bash
node scripts/verify-convex-access.mjs
```

Current result from the agent sandbox:

```
VERDICT: NOT_REACHABLE
  egress to api.convex.dev is blocked at the tls layer, while same-network
  controls succeed — a targeted allowlist, not an outage
  first failing layer: tls
```

DNS resolves and TCP :443 is accepted; the TLS handshake is severed with
`ECONNRESET` in ~5 ms. **That is a transport failure and nothing else.** It is
not an authentication result and not revocation evidence for any credential.

### Allowlist all THREE domain families, not just the control plane

| Family | Used by | Currently |
| --- | --- | --- |
| `*.convex.dev` | `convex deploy`, `convex codegen`, dashboard | **blocked** |
| `*.convex.cloud` | the deployment itself — **Evidence D talks to this** | **blocked** |
| `*.convex.site` | HTTP actions and the **auth issuer identity** (`CONVEX_SITE_URL`) | **blocked** |

Opening only `*.convex.dev` is the trap: steps A–G would succeed and step H
would fail for reasons that look unrelated. The diagnostic now probes all three
and reports `CONTROL_PLANE_ONLY` (exit 1) for exactly that half-open state.

---

## 1. Ordered procedure

Dependency-safe: each step's prerequisites are produced by the steps above it.
Do not reorder. Stop at the first failure — a later step cannot fix an earlier
one.

### A. Set deployment configuration

```bash
export CONVEX_DEPLOY_KEY="<from the Convex dashboard>"   # never commit
npx convex dev --once        # creates the project, writes CONVEX_DEPLOYMENT
node scripts/verify-convex-access.mjs     # expect VERDICT: AUTHENTICATED
```

**Gate:** `verify-convex-access.mjs` must exit 0. The verdict names which of the
failure modes you are in — do not guess:

| Verdict | Means | Action |
| --- | --- | --- |
| `NOT_REACHABLE` (exit 2) | transport stopped before an HTTP answer; the `blockedAt` layer says where (dns/tcp/tls/http) | fix egress; **no conclusion about the key is possible** |
| `AUTH_INDETERMINATE` (exit 1) | the plane was reached, but the authenticated request got no verdict — transport failure or 5xx | re-run; **this says nothing about whether the key is valid** |
| `UNAUTHENTICATED` (exit 1) | reached, and no credential was presented | set `CONVEX_DEPLOY_KEY` |
| `CREDENTIALS_REJECTED` (exit 1) | reached; the key was delivered and refused | the key is wrong or revoked |
| `CONTROL_PLANE_ONLY` (exit 1) | authenticated, but `*.convex.cloud` / `*.convex.site` are still blocked | allowlist the deployment families (step H will fail otherwise) |
| `AUTHENTICATED` (exit 0) | reached, key accepted, deployment family reachable | proceed |

`isAuthEvidence` is true only for the three states that required a real answer
from the service. Only `CREDENTIALS_REJECTED` is evidence that a key was
refused — and a transport failure is never evidence about a credential in
either direction.

### B. Set the production Convex URL and site URL

Both come from the deployment created in step A.

```bash
npx convex env set CONVEX_SITE_URL "https://<deployment>.convex.site"
export VITE_CONVEX_URL="https://<deployment>.convex.cloud"
```

`CONVEX_SITE_URL` is the issuer identity for self-issued JWTs. Getting it wrong
does not fail loudly — sign-in simply never confirms — so verify it in step C
rather than assuming.

### C. Verify the production self-only issuer policy

```bash
XSTARZ_DEPLOYMENT_ENV=production npm run convex:preflight
```

**Gate:** `federated-issuer` must report PASS with "self-issuer only". If
`VLY_CONVEX_AUTH_ISSUER` is set in production the preflight **refuses to build a
config at all** — that is deliberate. A trusted issuer can mint a token for any
account, so it fails closed rather than warning.

Also confirm in the same output:

- `production-endpoints` — https, not localhost, not a placeholder host;
- `credential-plausibility` — no placeholder-shaped key;
- `no-freebuff-otp-dependency` — the retired OTP path has not returned;
- `runtime-modules-wired` — auth, entitlement, provenance, limiter present.

### D. Run official Convex codegen

```bash
npx convex codegen
```

**This is now the only authority for `src/convex/_generated/*`.** Never
hand-edit those files.

### E. Verify `_generated` changes are generated-only

```bash
git diff --stat src/convex/_generated/
npx vitest run src/lib/deployment/codegen-authority.phase200.test.ts
npx vitest run src/convex/generated-api-integrity.phase175.test.ts
```

**Gate:** the diff must contain only `_generated` files. If codegen changes
anything else, stop and read it — that is a schema or API change, not codegen.

Then complete the Phase 187 migration, which codegen unblocks:

**RETIRED (Phase 270):** the migration no longer exists to complete —
`src/convex/auth/emailOtp.ts` was removed with the email-OTP provider, and
nothing string-addresses `otpLimiter:consumeResendAllowance` anymore. The
limiter tables remain, retained-frozen; the historical snippet below is kept
only to explain why no code like this survives:

```ts
// (historical — superseded by the Phase 270 retirement)
- const consumeResendAllowanceRef = makeFunctionReference<...>("otpLimiter:consumeResendAllowance");
+ import { internal } from "../_generated/api";
+ // use internal.otpLimiter.consumeResendAllowance directly
```

`codegen-authority.phase200.test.ts` enforces the supersession: nothing in
the tree may reach the limiter by string address, and once official codegen
has produced a surface without the retired `auth/emailOtp` module, the stale
declaration must be gone. A half-retirement fails the suite — verified by
mutation, not assumed.

### F. Deploy the backend

```bash
npx convex env set XSTARZ_DEPLOYMENT_ENV production
# RETIRED (Phase 270): do NOT set XSTARZ_EMAIL_TRANSPORT / XSTARZ_EMAIL_API_KEY /
# XSTARZ_EMAIL_SENDER_ADDRESS — the email-OTP provider and its delivery stack
# were removed. A still-set value is inert (reports as an unexpected variable
# in the production-config inventory, nothing reads it).
npx convex deploy
```

**Gate:** re-run the preflight against the deployment's environment. All eleven
checks must PASS before you continue. A deploy that succeeds with a broken email
configuration fails later, at a user's first sign-in.

### G. Verify deployed functions

```bash
npx convex run entitlements:getMyEntitlement '{}'     # expect an auth error, not a 404
npx convex function-spec | grep -E "runProtectedAnalysis|consumeProfitSignal|consumeResendAllowance"
```

**Gate:** every function the runtime calls must exist on the deployment. A 404
here means step F did not publish what you think it did.

### H. Run Evidence D (D1–D10)

```bash
export VITE_CONVEX_URL="https://<deployment>.convex.cloud"
export EVIDENCE_D_EMAIL="you@your-domain"
node scripts/evidence-d-harness.mjs            # sends the OTP, then blocks on D1
node scripts/evidence-d-harness.mjs --otp 123456 --json > evidence-d.json
```

The harness refuses to run against localhost, http, a non-Convex host, or an
unreachable deployment, and reports every unexecuted check as BLOCKED. **It
cannot produce a false PASS from a substitute backend** — that refusal is the
point.

D1 is HUMAN-attested: a script cannot watch a mailbox, and a 200 from the email
provider is *not* delivery. Supply the code you actually received.

**Gate:** `evidenceD: ACHIEVED` with 10/10 PASS. Anything else means Evidence D
remains BLOCKED.

---

## 2. Live provider inventory (§7)

**Code supports these providers. None is live-verified.** Those are different
claims and this table keeps them apart. Presence requirements only — never
commit a value.

| Provider | Variable | Required | Code status | Live status |
| --- | --- | --- | --- | --- |
| Twelve Data | `TWELVE_DATA_API_KEY` | yes — primary quotes/OHLCV | implemented | **NOT VERIFIED** |
| Alpha Vantage | `ALPHA_VANTAGE_API_KEY` | fallback for Twelve Data | implemented | **NOT VERIFIED** |
| CoinGlass | `COINGLASS_API_KEY` | derivatives/funding only | implemented | **NOT VERIFIED** |
| TickAtlas | `TICKATLAS_API_KEY` | economic calendar | implemented | **NOT VERIFIED** |
| EIA | `EIA_API_KEY` | energy macro | implemented | **NOT VERIFIED** |
| OKX | *(none)* | public endpoints only | implemented | **NOT VERIFIED** |
| Treasury / CFTC (COT) | *(none)* | public endpoints | implemented | **NOT VERIFIED** |

Notes that matter:

- **OKX needs no credential** for the endpoints in use. Its instrument identity
  must stay provider-native (`instId`), and SPOT/SWAP/FUTURES must be
  distinguished by provider-reported fields only — never inferred.
- FX conversion is served by Twelve Data / Alpha Vantage. There is no separate
  FX credential; a variable for one would be a fiction.
- Absent keys degrade acquisition honestly rather than fabricating data. That
  behaviour is tested, but tested is not live-verified.

Verify with real keys and real network using the existing harness:

```bash
TWELVE_DATA_API_KEY=... node scripts/verify-live.mjs
```

---

## 3. Email inventory (§8)

**Code is ready. The account, the domain and DNS are not.**

| Item | Variable / artifact | State |
| --- | --- | --- |
| ~~Transport choice~~ | **RETIRED (Phase 270)** | no email transport: D1 is terminally NOT_VERIFIED |
| ~~Provider credential~~ | **RETIRED (Phase 270)** | `XSTARZ_EMAIL_API_KEY` is inert if still set |
| ~~Sender address~~ | **RETIRED (Phase 270)** | `XSTARZ_EMAIL_SENDER_ADDRESS` is inert |
| ~~Sender display name~~ | **RETIRED (Phase 270)** | `XSTARZ_EMAIL_SENDER_NAME` is inert |
| Registered domain | — | **not owned**; none invented |
| Sender/domain verification | provider dashboard | **not done** |
| SPF | DNS TXT | **not done** |
| DKIM | DNS CNAME/TXT from the provider | **not done** |
| DMARC | DNS TXT | **not done** |

Enforced in code today:

- `console` transport is a **hard error in production** — a transport that
  reports success while delivering nothing is the most dangerous default
  available;
- there is **no Freebuff fallback**: missing configuration throws before any
  network call rather than sending from a domain the project does not own;
- the OTP, the API key and raw provider responses never appear in errors;
- the sender domain must not be a retired third-party domain.

Deliverability is mostly SPF/DKIM/DMARC and sending practice, not vendor
choice. Resend and SMTP2GO are both wired; Postmark is the documented upgrade
path if OTP inbox placement ever becomes the binding constraint.

---

## 4. What "done" looks like

| Step | Gate | Evidence |
| --- | --- | --- |
| A | `verify-convex-access.mjs` exit 0 | `VERDICT: AUTHENTICATED` |
| B | site URL set | preflight `required-production-vars` PASS |
| C | issuer self-only | preflight `federated-issuer` PASS |
| D | codegen ran | command exits 0 |
| E | generated-only diff | `git diff --stat` shows `_generated` only; codegen-authority suite green |
| F | backend deployed | all 11 preflight checks PASS against deployment env |
| G | functions exist | `convex function-spec` lists them |
| H | Evidence D | `evidence-d.json` with `evidenceD: ACHIEVED`, 10/10 |

Until H produces that artifact, the correct description of this backend is
**not verified** — not "should work", not "code complete".

---

## 5. Development deployment (Phase 286) — manual GitHub Actions workflow

The **development** deployment (`dev:<team>:<project>`, e.g. `tough-goose-455`)
is the environment a person can actually open and exercise. It is separate from
production in every respect: separate deployment, separate URL, separate deploy
key, separate GitHub Environment. Refreshing it is a deliberate manual action,
never a side effect of a merge.

### The workflow

`.github/workflows/development-deploy.yml`

| Property | Value |
| --- | --- |
| Trigger | `workflow_dispatch` only — no `push`, no `pull_request`, no `tags`, no `schedule` |
| GitHub Environment | `development` (both jobs) |
| Confirmation input | `confirm` must be exactly `DEPLOY_DEV` |
| Checkout input | `ref` (branch, tag or SHA; defaults to the dispatched ref) |
| Commands | `npm run development:deploy:guard -- --json`, then `npm run build`, then `npx convex dev --once` |
| Safe metadata printed | deployment target, source ref, commit SHA and subject, and the deployment's `/version` when `VITE_CONVEX_URL` is set |

### Configuration the `development` environment must hold

| Name | Kind | Contents |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | secret | a **dev-scoped** key from that deployment's dashboard page |
| `CONVEX_DEPLOYMENT` | variable | `dev:<team>:<project>` — never a `prod:` value |
| `VITE_CONVEX_URL` | variable (optional) | `https://<deployment>.convex.cloud`; enables the post-deploy version probe |
| `CONVEX_SITE_URL` | variable (optional) | `https://<deployment>.convex.site` |

No value of any secret belongs in this document, in `.env.example`, or in a
workflow file. Read deployment variables for verification with
`npx convex env list --names-only` — never the plain form, which prints
`NAME=VALUE`.

### The guard, and why development gets its own

`npm run development:deploy:guard` evaluates
`src/lib/deployment/development-deploy-guard.ts` — pure, no network, no clock,
no ambient environment — and exits non-zero unless the inputs are
development-shaped. It shares its placeholder-key, endpoint-host and
forbidden-source-ref rules with `src/lib/deployment/production-deploy-guard.ts`
rather than restating them.

| State | Means |
| --- | --- |
| `READY_TO_INVOKE_DEV_DEPLOY` | development identity + a real-looking key; permission to *attempt* a deploy |
| `MISSING_DEPLOY_KEY` / `PLACEHOLDER_DEPLOY_KEY` | no usable key |
| `PRODUCTION_IDENTITY` | `CONVEX_DEPLOYMENT` is `prod:…` — refused loudly |
| `WRONG_IDENTITY` | `preview:` / `local:` / `anonymous:` / unshaped — refused, not silently accepted as "not production" |
| `FORBIDDEN_SOURCE_REF` | `main` is not a deployable ref for any deployment |
| `WRONG_ENVIRONMENT` | `XSTARZ_DEPLOYMENT_ENV` is set to something other than `development` |
| `WRONG_CONVEX_URL` / `WRONG_SITE_URL` | a declared URL is not an https Convex host |

The production guard refuses development and this one refuses production: the
two are exact inverses on the identity axis, and neither can be satisfied by the
other's inputs. A green guard is permission to attempt a deploy. It is **not** a
deployment, not production verification, and not release admission.

### Why `protobufjs` is a declared dependency

Every workflow in this repository installs with
`npm install --legacy-peer-deps`, and that mode does **not** install peer
dependencies. `protobufjs` is an *optional peer* of `ccxt`, yet it is required at
bundle time: ccxt's dydx-v4 static dependencies import `protobufjs/minimal.js`.
Left implicit, it is never installed and the Convex bundler stops with
`Could not resolve "protobufjs/minimal.js"` — a failure with no source-level
symptom, since `npm run build` and the test suite both pass without it. It is
declared in `dependencies` on purpose. Nothing under `src/` imports it directly;
removing it because it *looks* unused breaks `convex dev` bundling.

### Reading a failed deploy

The workflow republishes the Convex output as `::error::` annotations (error-
shaped lines, then the tail, single-line and redacted), plus `::notice::`
annotations for the source ref/commit and the deployment's `/version`. Read them
with `gh api repos/<owner>/<repo>/commits/<sha>/check-runs --jq '.check_runs[]
| select(.conclusion=="failure") | .id'` and then
`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`: the raw runner log is
served from a URL that is not always reachable, and an unreadable failure is not
a diagnosis. Annotations carry no credential — the deploy key is never echoed,
and identity-shaped and key-shaped text is redacted before publication.

### After a deploy

Confirm the deployed build actually carries the current result contract before
calling the environment current — a deployment can exist, answer, and still be
stale. The five-minute check is one analysis through the deployment and a look
at which fields come back; a deployed runtime that predates an integration
returns a result without it, and that absence is the finding.

### Proving the deployed runtime works (Phase 287)

`.github/workflows/development-runtime-smoke.yml` — **manual dispatch only**,
GitHub Environment `development`, no secret of any kind. It runs
`scripts/development-runtime-smoke.mjs` on a runner, which asks the LIVE
development deployment to analyse one instrument per asset class
(crypto, forex, stock, commodity) and reports what actually came back.

Run it:

```
gh workflow run development-runtime-smoke.yml --ref <branch-or-sha>   # workflow must exist on that ref
gh run watch $(gh run list --workflow=development-runtime-smoke.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Optional inputs: `ref` (branch/tag/SHA to run from), `domains`
(e.g. `crypto,forex`), `max_attempts` (1-3).

| Property | How it is guaranteed |
| --- | --- |
| Instruments | The deployment's OWN discovery actions (`okx:discoverOkxInstruments`, `marketData:discoverTwelveDataInstruments`) — no ticker is hardcoded in the workflow or the script |
| No substitution | Every attempt records the provider-native id it used, verbatim |
| No client evidence | The request carries only routing fields (identity, timeframe, trading style); a test asserts the exact key set |
| No stubs or fixtures | The script has no fetch override and reads no fixture file; a test asserts the absence |
| Not localhost, not production | The target validator refuses both; the workflow refuses the production host by name |
| `observedAt` | Copied verbatim from the runtime; a missing instant stays `null` and the verdict drops to UNAVAILABLE/FAIL |
| Guest allowance | One fresh anonymous session per asset class, so no domain spends another's quota |
| Rate limits | A 429 or a credential error trips a per-provider circuit: no retry, no second candidate, other domains continue |
| PASS | Only with real market evidence + provider observation instant + available technical + available domain-native fundamental + unified intelligence. HTTP 200 alone is never a pass |

Exit codes: `0` = nothing FAILED (PASS and UNAVAILABLE are both honest),
`1` = at least one domain FAILED, `2` = the deployment could not be reached and
**nothing** about the runtime may be concluded. The run uploads
`development-runtime-smoke.json`, a plain-text summary and the console log as an
artifact; a could-not-look run still writes a report, with every domain marked
`NOT_ATTEMPTED`.
