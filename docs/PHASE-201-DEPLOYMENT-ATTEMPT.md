# Phase 201 — deployment attempt record

**Attempted: 2026-09-14. Result: BLOCKED at the external gate. No deployment was
performed, and no credential was entered anywhere.**

This file exists so the attempt is auditable. A blocked phase that leaves no
trace is indistinguishable from a phase nobody ran.

Baseline commit: `4014a3f` — unchanged by this phase.

---

## 1. The external gate

Phase 201 instructions require `npm run convex:access` to pass *before* any
deployment step. It did not.

```
VERDICT: NOT_REACHABLE
first failing layer: tls
egress to api.convex.dev is blocked at the tls layer, while same-network controls succeed — a targeted allowlist, not an outage
```

### Layer-by-layer evidence

| Layer | Host | Status | Detail |
| --- | --- | --- | --- |
| `dns` | `api.convex.dev` | PASS | resolved to 104.18.30.21 (IPv4) |
| `tcp` | `api.convex.dev` | PASS | TCP 443 accepted the connection (6ms) |
| `tls` | `api.convex.dev` | FAIL | TLS handshake severed mid-negotiation (ECONNRESET) — consistent with an egress allowlist (7ms) |
| `dns` | `provision.convex.dev` | PASS | resolved to 104.18.30.21 (IPv4) |
| `tcp` | `provision.convex.dev` | PASS | TCP 443 accepted the connection (29ms) |
| `tls` | `provision.convex.dev` | FAIL | TLS handshake severed mid-negotiation (ECONNRESET) — consistent with an egress allowlist (4ms) |
| `dns` | `dashboard.convex.dev` | PASS | resolved to 76.76.21.22 (IPv4) |
| `tcp` | `dashboard.convex.dev` | PASS | TCP 443 accepted the connection (2ms) |
| `tls` | `dashboard.convex.dev` | FAIL | TLS handshake severed mid-negotiation (ECONNRESET) — consistent with an egress allowlist (4ms) |
| `control` | `api.github.com` | PASS | no HTTP response: UNABLE_TO_VERIFY_LEAF_SIGNATURE — reached the host; certificate signed by a local interception CA (network path works) [same-network control] |
| `control` | `registry.npmjs.org` | PASS | HTTP 200 in 53ms [same-network control] |
| `credentials` | `environment` | ABSENT | CONVEX_DEPLOY_KEY not set |
| `credentials` | `deployment` | ABSENT | CONVEX_DEPLOYMENT not set |
| `auth` | `api.convex.dev` | BLOCKED | control plane is not reachable — an authenticated probe would be meaningless |

### Corroboration

The failure is neither transient nor a quirk of one TLS implementation:

- three consecutive gate runs → exit 2 every time;
- **Node** (`ECONNRESET`), **curl** (`SSL_ERROR_SYSCALL`) and **openssl**
  (`unexpected eof while reading`) all fail identically at the same point;
- the deployment domains themselves are blocked too: `demo.convex.cloud` and
  `demo.convex.site` both return HTTP 000;
- same-network controls succeed (`registry.npmjs.org` HTTP 200), so this is a
  targeted egress allowlist, not an outage.

**Classification: transport failure at the TLS layer.** Not a credential
problem, not an authentication result, and not revocation evidence for
anything.

---

## 2. What was deliberately NOT done

Per the gate, and worth stating explicitly because each was an available
shortcut that would have produced a falsely green report:

| Not done | Why |
| --- | --- |
| `npx convex deploy` | no deployment context; would fail or, worse, half-succeed |
| Entering credentials into the probe | the instructions forbid sending credentials to an unreachable endpoint |
| `npx convex codegen` beyond confirming it refuses | no deployment to generate against |
| Hand-editing `_generated` | forbidden, and would defeat the codegen authority contract |
| Pointing Evidence D at a local substitute | the harness refuses; a stub cannot produce Evidence D |
| Relaxing a preflight check to make it pass | the failing checks are correct — the values really are missing |
| Marking source-level security tests as Evidence D | they are Evidence A/B/C; the distinction is the whole point |

---

## 3. Status of each Phase 201 section

| § | Section | Status | Evidence |
| --- | --- | --- | --- |
| 0 | External gate | **BLOCKED** | `NOT_REACHABLE`, TLS layer |
| 1 | Deployment credentials | **BLOCKED** | all four unset (presence checked, no values read) |
| 2 | Official codegen | **BLOCKED** | "No CONVEX_DEPLOYMENT set"; `_generated` untouched |
| 3 | Pre-deploy preflight | **PARTIAL** | 8/11 PASS; 3 FAIL purely on missing values |
| 4 | Deploy real backend | **BLOCKED** | not attempted — gate failed |
| 5 | Post-deploy auth | **BLOCKED** | nothing deployed to check |
| 6 | Live email / OTP | **BLOCKED** | no provider account, no verified sender, no domain |
| 7 | Evidence D D1–D10 | **BLOCKED** | harness refused; 10/10 BLOCKED, 0 PASS |
| 8 | Live providers | **BLOCKED** | no provider credential present |
| 9 | Security cross-check | **PARTIAL** | 151 source-level tests pass — Evidence A/B/C, **not D** |
| 10 | Validation | **PASS** | see below |

### Change made in this phase

One defect was found and fixed, in the diagnostic rather than the product: it
probed only `*.convex.dev`, so an operator who allowlisted the control plane
alone would have seen a green gate and still been unable to run Evidence D. It
now probes `*.convex.cloud` and `*.convex.site` as a distinct
`deployment-plane` layer and reports `CONTROL_PLANE_ONLY` for the half-open
state. No product code was touched.

### Preflight detail (§3)

Eight checks pass on source and policy alone:
`deployment-env`, `retired-vars`, `federated-issuer` (production self-only),
`no-freebuff-otp-dependency`, `runtime-modules-wired`, `server-only-secrets`,
`production-endpoints`, `credential-plausibility`.

Three fail, and they fail *correctly* — every one is a missing value, not a
defect: `email-delivery`, `sender-identity`, `required-production-vars`.

---

## 4. Validation (§10)

| Gate | Result |
| --- | --- |
| Full suite | **9131 passed / 3 skipped / 254 files** |
| `tsc -b` | 0 |
| Production build | 0 |
| Lint | **1517** = baseline |
| Secret scan | clean |
| Generated drift | 0 — `_generated` untouched |
| Deployment preflight | exit 1 (fails closed, correctly) |
| `evidence:d` | exit 2 (refuses, correctly) |

---

## 5. The single unblocking action

**Allow TLS egress to `*.convex.dev`, `*.convex.cloud` and `*.convex.site`, then
re-run `npm run convex:access` and confirm it exits 0.**

Allowing only `*.convex.dev` is insufficient, and this phase proved it is a real
trap rather than a theoretical one. The three families are separate allowlist
entries and all three are currently blocked:

| Family | Used by | Status |
| --- | --- | --- |
| `*.convex.dev` | `convex deploy`, `convex codegen`, dashboard | blocked (TLS) |
| `*.convex.cloud` | the deployment — **Evidence D talks to this** | blocked (TLS) |
| `*.convex.site` | HTTP actions, **auth issuer** (`CONVEX_SITE_URL`) | blocked (TLS) |

With only the control plane open, steps A–G succeed and step H fails for a
reason that looks unrelated to the network. The diagnostic was extended in this
phase to probe the deployment plane and to report that half-open state as
`CONTROL_PLANE_ONLY` (exit 1) rather than success.

Once the gate exits 0, `docs/DEPLOYMENT-HANDOFF.md` steps A–H run end to end
without further discovery.
