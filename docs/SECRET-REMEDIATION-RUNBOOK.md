# Secret Remediation Runbook — leaked OTP credential

**Status: BLOCKED on credential rotation. No history rewrite has been performed.**

This document is the rehearsal-verified procedure for removing the leaked
third-party OTP credential from Git history. Every command below was executed
against a disposable mirror in Phase 198 and produced the recorded results. It
has **not** been executed against the real repository, and must not be until
§2 (the rotation gate) is satisfied.

The credential value is never written in this document, never printed by any
command here, and never committed. It is identified only by fingerprint.

---

## 1. Exposure — measured, Phase 198

Measured against the **full** history (339 commits, unshallowed), not a
shallow clone.

| Property | Value |
|---|---|
| Identification | `sha256(value + "\n")[0:16]` = `b1ce18a1e85ba121`, length 33 |
| Kind | Hardcoded `x-api-key` header for the third-party OTP service `auth.freebuff.app` |
| Path | `src/convex/auth/emailOtp.ts` |
| Distinct leaked blobs | **1** (`e490ffda66bb5d8fcd63df8d49f5f8822126cc7f`) |
| Affected commits | **270 of 339** |
| Oldest affected | `a71ea7f` (2026-08-20, initial import) |
| Newest affected | `3a82789` (2026-09-11) |

These figures reproduce the Phase 184 measurement exactly (fingerprint, length,
270 commits, 1 blob, 1 path), which is itself evidence that the exposure has
neither grown nor been silently remediated since.

### Per-ref status

| Ref | Tip today | Occurrences in that ref's history |
|---|---|---|
| `refs/heads/arena/01a08e67-trade-intel-bot` | **clean** | 269 |
| `refs/heads/main` | **EXPOSED AT TIP** | 261 |
| `refs/heads/phase-157-live-discovery-lifecycle` | **EXPOSED AT TIP** | 262 |
| `refs/tags/rc-181` | **clean** | 269 |

Two consequences follow, and they matter more than the history question:

1. **`main` still serves the credential from its tip.** Anyone cloning the
   default branch right now receives it in working-tree source. This is why
   `main` must never be deployed and why the release gate lists this as a hard
   blocker.
2. The working branch is clean at HEAD — the credential was removed from
   current source in an earlier phase — but **removal from HEAD is not
   remediation.** All four refs still carry it in reachable history.

---

## 2. Rotation gate — **BLOCKED**

**The rewrite must not run before the credential is revoked at the issuer.**

Rewriting first would be actively harmful: it destroys the audit trail and
signals "resolved" while a live credential remains valid in every clone, fork,
CI cache and GitHub API view that already has it. A Git rewrite cannot
un-leak a secret; only the issuer can.

Evidence gathered in this environment:

| Check | Result |
|---|---|
| `https://auth.freebuff.app` | HTTP **000** (no response) |
| `https://freebuff.app` | HTTP **000** |
| DNS for `auth.freebuff.app` | resolves (`69.46.46.68`, Railway) — so this is egress blocking, not a dead host |
| Control: `https://api.github.com` | HTTP **200** |
| Control: `https://registry.npmjs.org` | HTTP **200** |
| Issuer credential in environment | none set (`FREEBUFF_API_KEY`, `AUTH_FREEBUFF_KEY`, `OTP_API_KEY` all unset) |
| Issuer console / dashboard access | not available |

**Conclusion: there is no evidence the old credential has been revoked, and no
means in this environment to revoke it or to verify its status.** The gate is
therefore BLOCKED, and no revocation claim may be made.

Re-attempted in Phase 222 with every agent capability (env, GitHub bot token,
Convex CLI, issuer hosts, vendor docs): no issuer identity exists, all issuer
hosts are TLS-severed, GitHub secrets/deploy-keys/secret-scanning return 403
for the bot. See `docs/RELEASE-GATE.md` Phase 222. **Still BLOCKED.**

### What satisfies the gate

A human with issuer access must, **in this order**:

1. Provision a **new** credential at the OTP provider.
2. Configure it as a Convex environment variable (never in source).
3. **Revoke** the old credential.
4. Prove revocation: an authenticated call presenting the old credential
   returns an explicit auth failure (401/403). A timeout, a 000, or a 200 from
   an unrelated endpoint is **not** proof.
5. Record the date, the operator, and the observed rejection response.

Only then may §3 run against the real repository.

---

## 3. Rewrite procedure — rehearsed, not executed

Verified in Phase 198 against a fresh `--mirror` clone in `/tmp`. The
production repository and `main` were never touched.

```bash
# 0. Preconditions: §2 satisfied and recorded. Never run otherwise.

# 1. Disposable full mirror — never rewrite a working clone.
git clone --mirror https://github.com/xstarz28/trade-intel-bot.git rehearsal.git
cd rehearsal.git
git rev-parse --is-shallow-repository   # MUST print false
git rev-list --count --all              # expect 339 (at time of writing)

# 2. Build the replacement spec WITHOUT printing the secret.
#    Extract it from the known leaked blob and write it straight to a file.
#    Format: <secret>==>***REMOVED-ROTATED-CREDENTIAL***
#    (see scripts/secret-rehearsal-verify.mjs for the scripted form)

# 3. Rewrite every ref.
git filter-repo --replace-text /path/to/replacements.txt --force

# 4. Verify — see §4. Do not skip; do not accept "no output" as proof
#    without the positive control.

# 5. Push only after §4 passes, and only with explicit human authorization.
#    This rewrites published history for every collaborator.
git push --force --mirror https://github.com/xstarz28/trade-intel-bot.git

# 6. Re-tag and rebuild the release candidate from the rewritten history;
#    the old rc-181 object no longer exists.
```

### Refs the force-push will rewrite

**All five** (Phase 221 correction — a fifth ref, the current working branch,
was created after Phase 198 and inherits the blob). None may be skipped — a
single surviving ref keeps the blob reachable and undoes the entire exercise.
Re-run `git for-each-ref` on the mirror before executing; any ref added since
this table must be included.

| Ref | Before (Phase 221) | After (Phase 221 rehearsal) |
|---|---|---|
| `heads/arena/01a08e67-trade-intel-bot` | `f8939130` | `bd233a8` |
| `heads/arena/01a0a5f5-trade-intel-bot` | `920486c5` | `a2243f0` |
| `heads/main` | `51c9ddeb` | `b1a9e91` |
| `heads/phase-157-live-discovery-lifecycle` | `244e9cc7` | `6bf6f58` |
| `tags/rc-181` | `66323a38` | `23d25ff` |

Phase 221 re-rehearsal on a fresh mirror: 365/365 commits preserved,
author/date/subject and parent topology identical, working-branch tree
byte-identical, verifier `--expect-clean` exit 0 with positive control.
Real repository and remote untouched. Status remains **BLOCKED on §2**.

---

## 4. Assertions

### Pre-rewrite

| # | Assertion | Observed |
|---|---|---|
| P1 | Mirror is not shallow | `false` |
| P2 | Commit count | 339 |
| P3 | Object count | 4,214 |
| P4 | Fingerprint matches the Phase 184 record | `b1ce18a1e85ba121`, len 33 ✓ |
| P5 | Leaked blob is reachable | 1 blob, 1 path, 270 commits |

### Post-rewrite (all verified in the rehearsal)

| # | Assertion | Result |
|---|---|---|
| A1 | Zero fingerprint hits across **every blob in every ref** | **PASS** — 0 hits |
| A2 | Independent `git grep -F` across all 4 refs | **PASS** — 0 matches |
| A3 | Positive control: same method finds 1 match on unmodified `main` | **PASS** — method proven sensitive, not vacuous |
| A4 | Commit count unchanged | 339 → **339** |
| A5 | Per-ref commit counts unchanged | 338/261/262 → **338/261/262** |
| A6 | Author, email, timestamp, subject of every commit unchanged | md5 `b9b2dd5c…` → **identical** |
| A7 | Parent topology (graph shape) unchanged | md5 `5af69801…` → **identical** |
| A8 | Working-branch tip tree byte-identical | **0 files changed** |
| A9 | Only `src/convex/auth/emailOtp.ts` differs, on the 2 contaminated refs | **PASS** |
| A10 | That file's delta is exactly 1 line; line count 37 → 37 | **PASS** |
| A11 | Production repo untouched (`HEAD`, `main`, clean tree) | **PASS** |
| A12 | Remote refs unchanged — no force-push occurred | **PASS** |

A3 is the assertion that makes A1/A2 meaningful. A scan that reports "no
occurrences" is worthless unless the same scan is shown to find the secret when
it *is* present — otherwise a broken matcher reads as success.

A8 is the assertion that makes this safe: the branch carrying all current work
comes through the rewrite with a byte-identical tree.

---

## 5. Residual risk after the rewrite

Rewriting history does **not** retract the credential. Assume it is compromised
and treat rotation, not rewriting, as the fix. Still-exposed surfaces after a
successful rewrite:

- every existing clone and fork;
- GitHub's dangling-object and API caches, until GC;
- CI caches and build artifacts;
- any third-party mirror or code-scanning index.

The old credential must be **dead at the issuer** for any of this to be
resolved.
