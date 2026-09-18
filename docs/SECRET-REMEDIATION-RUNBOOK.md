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
| `refs/heads/arena/01a0adfb-trade-intel-bot` | **clean** | 269 |
| `refs/heads/arena/01a0b293-trade-intel-bot` | **clean** | 269 |
| `refs/heads/main` | **EXPOSED AT TIP** | 261 |
| `refs/heads/phase-157-live-discovery-lifecycle` | **EXPOSED AT TIP** | 262 |
| `refs/tags/rc-181` | **clean** | 269 |

Phase 238 note: the eighth ref (`01a0adfb`) was pushed during that phase and
added to this table in the same phase. Its row is **derived, not re-measured
end-to-end**: `scripts/secret-ref-inventory.mjs` refuses to run in a shallow
clone, so `exposedAtTip: false` was measured directly against that tip's own
copy of `src/convex/auth/emailOtp.ts` with the same fingerprint rule, and its
269 occurrences are the parent ref's measurement — the phase's single commit
does not touch that path. Re-run the generator in a full clone before executing
§3, and treat its output as authoritative over any hand-edited row.

Phase 249 note: the ninth ref (`01a0b293`) became live when PR #4 pushed that
session branch, and it is added here on a **full end-to-end measurement**, not a
derived one. The working clone was unshallowed (`git fetch --unshallow`, a
read-only fetch that writes no remote ref), all nine remote tips were confirmed
present locally, and `scripts/secret-ref-inventory.mjs` was run twice with
byte-identical output: `01a0b293` is `affected: true` with **269 carrier
commits** and **`exposedAtTip: false`** — the same figures the other session
branches carry, because the branch descends from the same exposed history and
its own commits do not touch `src/convex/auth/emailOtp.ts`. That run also
re-measured the other eight refs, so the Phase 238 row above is no longer the
one derived row: every row in this table now rests on the same measurement.
Total carrier commits remain **270** and reachable commits rose 398 → **429**
(the repository grows; the exposure does not). **A nine-ref inventory is a
larger remediation scope, not progress** — nothing has been rewritten, and §2
still blocks §3.

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
   remediation.** All nine refs still carry it in reachable history.
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

**All nine** — every ref the remote advertises, per
`docs/secret-remediation-refs.json`. Phase 233 corrected this table twice
over: Phase 198 listed four refs, Phase 221 added a fifth, and three branches
created since then (`01a0a5f5`, `01a0a92b`, `01a0ad26`) were never added at
all despite each carrying 269 carrier commits. Phase 238 added the eighth
(`01a0adfb`) in the phase that pushed it, and Phase 249 added the ninth
(`01a0b293`) in the phase that pushed it — each measured, not assumed. None may
be skipped — a single surviving ref keeps the blob reachable and undoes the
entire exercise.

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
| `heads/arena/01a0adfb-trade-intel-bot` | *added Phase 238* | *not rehearsed* |
| `heads/arena/01a0b293-trade-intel-bot` | *added Phase 249* | *not rehearsed* |
| `heads/main` | `51c9ddeb` | `b1a9e91` |
| `heads/phase-157-live-discovery-lifecycle` | `244e9cc7` | `6bf6f58` |
| `tags/rc-181` | `66323a38` | `23d25ff` |

Phase 221 re-rehearsal on a fresh mirror: 365/365 commits preserved,
author/date/subject and parent topology identical, working-branch tree
byte-identical, verifier `--expect-clean` exit 0 with positive control. That
rehearsal covered only the five refs known at the time. The four refs added
above since (`01a0a92b`, `01a0ad26`, `01a0adfb`, `01a0b293`) were **not** part
of it, so their post-rewrite SHAs are deliberately left
blank rather than guessed — a re-rehearsal covering all nine is required
before execution.

That re-rehearsal has now been run. §3.1 records a nine-ref rehearsal on a
disposable mirror, with the simulated post-rewrite tip of every one of the nine
measured instead of left blank. This table is kept unchanged as the Phase 221
record and remains what the note below calls it: a rehearsal record, not an
execution input.

Tips also move: `heads/arena/01a0a5f5-trade-intel-bot` has advanced from
`920486c5` to `3f63690` since the rehearsal (PR #1 merged into it), so the
"Before" column is a rehearsal record, not an execution input. Re-read tips
from the inventory immediately before executing.

Real repository and remote untouched. Status remains **BLOCKED on §2**.

### 3.1 The nine-ref re-rehearsal — run on a disposable mirror, and the gap it found

§3 required a re-rehearsal covering every affected ref before it may run. It has
been run. All nine refs were rehearsed, and nothing outside the disposable mirror
was modified: no push, no force-push, no remote ref written, `main` untouched at
`51c9ddeb`, the project checkout untouched, no credential value printed, and A2
still UNVERIFIED.

**How.** `scripts/a2-rehearsal.mjs` — the Phase 245 driver — run twice with a
pinned `--now` against a `git clone --mirror` of the real remote, plus an
independent replication of the driver's rewrite step on a second mirror so that a
second scanner (`scripts/secret-rehearsal-verify.mjs`, Phase 198) could confirm the
outcome rather than take the driver's word for it. Both driver runs returned
`REHEARSAL_VERIFIED` with byte-identical reports, and all ten
`REHEARSAL_EXECUTION_STAGES` completed. `EXPLICIT_OPERATOR_APPROVAL` and
`RELEASE_GATE_REEVALUATION` were not performed: they are not rehearsal stages, they
belong to the real remediation, and no tool may perform the first of them.

| Ref | Before (remote tip) | After (simulated) | Commits | Parent topology | Author/date/subject | Tip tree |
|---|---|---|---|---|---|---|
| `heads/arena/01a08e67-trade-intel-bot` | `f8939130` | `821a68ee` | 362 = 362 | isomorphic | preserved | byte-identical |
| `heads/arena/01a0a5f5-trade-intel-bot` | `3f636903` | `e053da3f` | 393 = 393 | isomorphic | preserved | byte-identical |
| `heads/arena/01a0a92b-trade-intel-bot` | `b321e507` | `e94d14fc` | 392 = 392 | isomorphic | preserved | byte-identical |
| `heads/arena/01a0ad26-trade-intel-bot` | `7564f138` | `cac0b043` | 407 = 407 | isomorphic | preserved | byte-identical |
| `heads/arena/01a0adfb-trade-intel-bot` | `27edd4a2` | `0579c8a2` | 427 = 427 | isomorphic | preserved | byte-identical |
| `heads/arena/01a0b293-trade-intel-bot` | `6bb75868` | `81370d3b` | 430 = 430 | isomorphic | preserved | byte-identical |
| `heads/main` | `51c9ddeb` | `d2d4770b` | 261 = 261 | isomorphic | preserved | 1 path rewritten |
| `heads/phase-157-live-discovery-lifecycle` | `244e9cc7` | `9381bfeb` | 262 = 262 | isomorphic | preserved | 1 path rewritten |
| `tags/rc-181` | `66323a38` | `7cb31eaa` | 299 = 299 | isomorphic | preserved | byte-identical |

| Check | Result |
|---|---|
| fingerprint reachable from any of the nine | **0 of 9** — re-measured independently, carriers 0 for every ref |
| positive control: the same scanner on an *unmodified* mirror | **EXPOSED — 1 blob**, `e490ffda…` at `src/convex/auth/emailOtp.ts`, `TIP-EXPOSED` on `main` and `phase-157` only. The clean result is therefore credible and not a broken scanner |
| commit-count topology | identical per ref; parent map isomorphic under the old→new commit mapping, merge and root counts equal |
| author / email / date / subject | digests identical before and after, per ref |
| working-tree byte identity | the candidate `heads/arena/01a0adfb-trade-intel-bot`: **870 of 870 paths byte-identical**. The seven refs already clean at their tip changed in **zero** paths; `main` and `phase-157` changed in exactly one — the credential path |
| a post-rewrite result for each of the nine | present for all nine, none missing |
| refs lost / refs added | 0 / 0 — the mirror's ref set is identical (16 = 16), and no `refs/original/*` was left behind |
| credential value in any log or artefact | none — 20 evidence files scanned, 537 candidate tokens tested against the fingerprint, 0 matches. Identity is carried by fingerprint and blob OID only |
| determinism | two independent driver runs produced byte-identical JSON (same sha256); pre-digest `d013598f`, post-digest `8969eed2` in both |
| rollback evidence | 9 backup refs created under `refs/p245-backup`, then restored: all nine tips returned byte-exactly to the remote's real tips, with 0 backup refs and 0 `refs/original/*` remaining |

**The gap this rehearsal found, and it is a new §3 precondition.**

The mirror advertises 16 refs, not 9. Besides the nine scoped refs, GitHub serves
seven `refs/pull/*` refs — `pull/1/head`, `pull/2/head`, `pull/2/merge`,
`pull/3/head`, `pull/3/merge`, `pull/4/head`, `pull/4/merge` — pointing at the
*pre-rewrite* commits. The procedure rewrites only `refs/heads/*` and
`refs/tags/*`, and it must: those pull refs belong to GitHub, and a user can
neither delete nor force-push them.

Measured on the mirror, after a rewrite that had already succeeded for all nine:

* the independent scanner still reported **EXPOSED — 1 blob**, because the old
  history was still reachable;
* `git rev-list --count --all` went from 434 to **864** — the old commits were not
  replaced, they were joined by the rewritten ones;
* **433** credential-carrying commits stayed reachable through `refs/pull/*` alone.

Clearing those seven refs in the disposable mirror and re-scanning gave **CLEAN —
zero occurrences across all refs**, `--expect-clean` exit 0, the leaked blob object
gone from the database, 864 → 431 commits and 16 → 9 refs. The rewrite procedure is
therefore correct and complete *for the refs it is permitted to touch*, and
incomplete for the repository as GitHub actually serves it.

**So §3 gains a precondition.** The force-push by itself does not remediate this
repository. Before §3 may run, the operator must also arrange for GitHub's
`refs/pull/*` to be cleared — a GitHub Support action, not a git command — and §4's
post-rewrite scan must be run against the remote *after* that clearing, not after
the push. Until then a passing `--expect-clean` on a mirror is evidence about the
mirror, not about github.com.

**A second discrepancy, recorded rather than papered over.** §3 step 3 documents
`git filter-repo --replace-text`. `git-filter-repo` is not installed here, and it is
not what the rehearsed driver uses: both the Phase 245 driver and this replication
rewrite with `git filter-branch --index-filter`, swapping only the fingerprinted
blob at its recorded path. What has been rehearsed is therefore the `filter-branch`
mechanism. Either step 3 is corrected to the rehearsed mechanism, or `filter-repo`
is installed and the procedure re-rehearsed against it, before §3 runs on the
strength of this evidence.

**What this does not change.** A2 remains **UNVERIFIED** and unexecuted. §2 still
blocks §3: A1 is unrevoked at the issuer. The rehearsal is evidence about a
procedure, not a remediation, and a nine-ref rehearsal does not shrink the nine-ref
exposure. The release verdict is unchanged: **NOT READY**.

---

## 4. Assertions

**Scope caveat (Phase 233, extended Phase 238 and Phase 249).** Every assertion
below records the Phase 198 and Phase 221 rehearsals, which covered the four and
five refs known at those times. They remain an accurate record of what was
rehearsed, but they are **not** evidence about the four branches added since
(`01a0a92b`, `01a0ad26`, `01a0adfb`, `01a0b293`), which have never been through
a rehearsal. Re-run the procedure on a mirror against all nine refs before
executing for real.

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
