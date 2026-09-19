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

## 1. Exposure — measured Phase 198, re-measured Phase 233

Measured against the **full** history, not a shallow clone. Phase 198 measured
339 commits; Phase 233 re-measured 397 (the repository has grown). The affected
commit count is **unchanged at 270**, and the fingerprint, blob identity, blob
count and path are byte-identical to the Phase 198 record — direct evidence
that the exposure has neither grown nor been silently remediated since.

| Property | Value |
|---|---|
| Identification | `sha256(value + "\n")[0:16]` = `b1ce18a1e85ba121`, length 33 |
| Kind | Hardcoded `x-api-key` header for the third-party OTP service `auth.freebuff.app` |
| Path | `src/convex/auth/emailOtp.ts` |
| Distinct leaked blobs | **1** (`e490ffda66bb5d8fcd63df8d49f5f8822126cc7f`) |
| Affected commits | **270 of 397** (Phase 198: 270 of 339 — unchanged) |
| Oldest affected | `a71ea7f` (2026-08-20, initial import) |
| Newest affected | `3a82789` (2026-09-11) |

### Per-ref status

Measured per ref by Phase 233 (`scripts/secret-ref-inventory.mjs`) using
SHA-256 fingerprint reachability of the leaked blob from each ref's tip — blob
identity, not lineage inference. Machine-readable form:
`docs/secret-remediation-refs.json`.

Two facts per ref, and they are **not** interchangeable:

- **Occurrences** — commits in that ref's history whose tree holds the leaked
  blob. Any value above zero means the ref is **affected** and must be
  rewritten, because a surviving ref keeps the blob reachable.
- **Tip today** — whether the ref's *tip* serves the blob in its working tree.
  `clean` at the tip does **not** mean remediated.

| Ref | Tip today | Occurrences in that ref's history |
|---|---|---|
| `refs/heads/arena/01a08e67-trade-intel-bot` | **clean** | 269 |
| `refs/heads/arena/01a0a5f5-trade-intel-bot` | **clean** | 269 |
| `refs/heads/arena/01a0a92b-trade-intel-bot` | **clean** | 269 |
| `refs/heads/arena/01a0ad26-trade-intel-bot` | **clean** | 269 |
| `refs/heads/main` | **EXPOSED AT TIP** | 261 |
| `refs/heads/phase-157-live-discovery-lifecycle` | **EXPOSED AT TIP** | 262 |
| `refs/tags/rc-181` | **clean** | 269 |

Phase 233 correction: this table listed only four refs. The three branches
created since Phase 198 (`01a0a5f5`, `01a0a92b`, `01a0ad26`) were absent, as
was the Phase 221 rewrite-map row for `01a0a5f5` from this table. Each of the
three carries 269 carrier commits, so all three were affected while going
unlisted — the omission was security-relevant, not cosmetic. The rewrite map in
§3 named five refs and was missing `01a0a92b` and `01a0ad26`, so those two
branches appeared in **neither** table and would have survived the rewrite.

Three consequences follow, and they matter more than the history question:

1. **`main` still serves the credential from its tip.** Anyone cloning the
   default branch right now receives it in working-tree source. This is why
   `main` must never be deployed and why the release gate lists this as a hard
   blocker.
2. The working branches are clean at HEAD — the credential was removed from
   current source in an earlier phase — but **removal from HEAD is not
   remediation.** All seven refs still carry it in reachable history.
3. **Every ref is affected.** There is no unaffected ref to leave out of the
   rewrite, and no ref may be treated as safe because its tip is clean.

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

**All seven** — every ref the remote advertises, per
`docs/secret-remediation-refs.json`. Phase 233 corrected this table twice
over: Phase 198 listed four refs, Phase 221 added a fifth, and three branches
created since then (`01a0a5f5`, `01a0a92b`, `01a0ad26`) were never added at
all despite each carrying 269 carrier commits. None may be skipped — a single
surviving ref keeps the blob reachable and undoes the entire exercise.

Re-run `node scripts/secret-ref-inventory.mjs` before executing. That
inventory is derived from `git ls-remote`, so unlike the previous
`git for-each-ref` advice it cannot drift with clone depth or fetch state, and
any ref it reports that is absent from this table must be added first.

| Ref | Before (Phase 221 rehearsal) | After (Phase 221 rehearsal) |
|---|---|---|
| `heads/arena/01a08e67-trade-intel-bot` | `f8939130` | `bd233a8` |
| `heads/arena/01a0a5f5-trade-intel-bot` | `920486c5` | `a2243f0` |
| `heads/arena/01a0a92b-trade-intel-bot` | *added Phase 233* | *not rehearsed* |
| `heads/arena/01a0ad26-trade-intel-bot` | *added Phase 233* | *not rehearsed* |
| `heads/main` | `51c9ddeb` | `b1a9e91` |
| `heads/phase-157-live-discovery-lifecycle` | `244e9cc7` | `6bf6f58` |
| `tags/rc-181` | `66323a38` | `23d25ff` |

Phase 221 re-rehearsal on a fresh mirror: 365/365 commits preserved,
author/date/subject and parent topology identical, working-branch tree
byte-identical, verifier `--expect-clean` exit 0 with positive control. That
rehearsal covered only the five refs known at the time. The two branches added
above were **not** part of it, so their post-rewrite SHAs are deliberately left
blank rather than guessed — a re-rehearsal covering all seven is required
before execution.

Tips also move: `heads/arena/01a0a5f5-trade-intel-bot` has advanced from
`920486c5` to `3f63690` since the rehearsal (PR #1 merged into it), so the
"Before" column is a rehearsal record, not an execution input. Re-read tips
from the inventory immediately before executing.

Real repository and remote untouched. Status remains **BLOCKED on §2**.

---

## 4. Assertions

**Scope caveat (Phase 233).** Every assertion below records the Phase 198 and
Phase 221 rehearsals, which covered the four and five refs known at those
times. They remain an accurate record of what was rehearsed, but they are
**not** evidence about the two branches added in Phase 233
(`01a0a92b`, `01a0ad26`), which have never been through a rehearsal. Re-run the
procedure on a mirror against all seven refs before executing for real.

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
