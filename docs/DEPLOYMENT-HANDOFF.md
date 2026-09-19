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

```ts
// src/convex/auth/emailOtp.ts — replace the string-addressed workaround
- const consumeResendAllowanceRef = makeFunctionReference<...>("otpLimiter:consumeResendAllowance");
+ import { internal } from "../_generated/api";
+ // use internal.otpLimiter.consumeResendAllowance directly
```

`codegen-authority.phase200.test.ts` enforces this: the moment
`internal.otpLimiter.consumeResendAllowance` appears in code, the test requires
the `makeFunctionReference` workaround to be **gone**. A half-migration fails
the suite — verified by mutation, not assumed.

### F. Deploy the backend

```bash
npx convex env set XSTARZ_DEPLOYMENT_ENV production
npx convex env set XSTARZ_EMAIL_TRANSPORT resend        # or smtp2go
npx convex env set XSTARZ_EMAIL_API_KEY "<provider key>"
npx convex env set XSTARZ_EMAIL_SENDER_ADDRESS "otp@<your-domain>"
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
| Transport choice | `XSTARZ_EMAIL_TRANSPORT` = `resend` \| `smtp2go` | both implemented; **unset** |
| Provider credential | `XSTARZ_EMAIL_API_KEY` | **unset** — requires an account |
| Sender address | `XSTARZ_EMAIL_SENDER_ADDRESS` | **unset** — requires a domain |
| Sender display name | `XSTARZ_EMAIL_SENDER_NAME` | optional, defaults to the product name |
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
