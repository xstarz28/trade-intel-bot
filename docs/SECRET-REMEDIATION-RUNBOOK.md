# Secret Remediation Runbook — leaked OTP credential

**Status: Path C recorded (A1 VERIFIED without revocation). Path R unrecorded. Writable nine-ref rewrite executed on github.com. A2 UNVERIFIED — `refs/pull/1/head` still reaches the credential. GitHub Support ticket #4773405 pending. Issue #5 OPEN. Do not run another history rewrite or force-push.**

This document is the rehearsal-verified procedure for removing the leaked
third-party OTP credential from Git history. Every command below was executed
against a disposable mirror in Phase 198 and produced the recorded results.

The writable nine-ref rewrite (`refs/heads/*` and `refs/tags/*`) **has been
executed** against github.com, with a heads/tags force-push. A2 remains
**UNVERIFIED** because GitHub-managed `refs/pull/1/head` still reaches the
credential. Do **not** run another `git filter-repo`, do **not** force-push
again, do **not** rewrite hidden refs, and do **not** duplicate GitHub Support
ticket **#4773405**. Issue **#5** stays OPEN until A2 can be verified.

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
| `refs/heads/arena/01a08e67-trade-intel-bot` | **clean** | 0 |
| `refs/heads/arena/01a0a5f5-trade-intel-bot` | **clean** | 0 |
| `refs/heads/arena/01a0a92b-trade-intel-bot` | **clean** | 0 |
| `refs/heads/arena/01a0ad26-trade-intel-bot` | **clean** | 0 |
| `refs/heads/arena/01a0adfb-trade-intel-bot` | **clean** | 0 |
| `refs/heads/arena/01a0b293-trade-intel-bot` | **clean** | 0 |
| `refs/heads/main` | **clean** | 0 |
| `refs/heads/phase-157-live-discovery-lifecycle` | **clean** | 0 |
| `refs/tags/rc-181` | **clean** | 0 |

### Current remote measurement (writable rewrite landed)

Measured 2026-09-21T01:30:21.319Z against a full `git clone --mirror` of
`https://github.com/xstarz28/trade-intel-bot.git` (push disabled on the audit
mirror). Generator: `scripts/secret-ref-inventory.mjs`. Artifact:
`docs/secret-remediation-refs.json`. Fingerprint `b1ce18a1e85ba121`, leaked
blob `e490ffda…` at `src/convex/auth/emailOtp.ts`.

| Surface | Result |
|---|---|
| Writable heads/tags (9) | **0 carriers**, every tip **clean** |
| `refs/pull/1/head` (`b321e507`, PR #1 MERGED) | **269 carriers**, tip clean |
| `refs/pull/2/head` (`dc2dc113`) | 0 carriers, tip clean, still exists |
| `refs/pull/2/merge` (`eaa9f993`) | 0 carriers, tip clean, still exists |
| `refs/pull/3/head` (`bcc3f34d`) | 0 carriers, tip clean, still exists |
| `refs/pull/3/merge` (`f09244e8`) | 0 carriers, tip clean, still exists |
| `refs/pull/4/head` (`c42c734e`) | 0 carriers, tip clean, still exists |
| `refs/pull/4/merge` (`bbc1e4d1`) | 0 carriers, tip clean, still exists |
| `--all` reachable commits | **840** |
| `--all` carrier commits | **269** (the pull/1 history; not a writable-ref sum) |
| Leaked blob still in the object database | yes |
| `rewrite-verification.json` | **absent** — A2 is not verified |
| GitHub Support | ticket **#4773405** pending; do not duplicate |
| Issue #5 | **OPEN** |

Live writable tips (github.com, 0 carriers): `01a08e67`=`bd233a87`,
`01a0a5f5`=`0fbab31a`, `01a0a92b`=`50dcdfa5`, `01a0ad26`=`dc2dc113`,
`01a0adfb`=`bcc3f34d`, `01a0b293`=`c42c734e`, `main`=`b1a9e915`,
`phase-157`=`6bf6f580`, `rc-181`=`23d25ffa` (`^{}` `4626c5ca`).

The inventory generator reads heads and tags only. `carrierCommits: 269` on
the artifact is `--all` reachability, including GitHub-managed pull refs.
A2 cannot be considered verified while any affected PR ref still reaches the
credential. `deny updating a hidden ref` still applies. GitHub Support must
clear the remaining hidden refs; this project cannot.

Do **not** run another filter-repo. Do **not** force-push. Do **not** amend,
rebase, or reset this history. Do **not** merge or delete the PRs as a
cleanup shortcut. Do **not** close Issue #5.

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
larger remediation scope, not progress** — nothing had been rewritten at that
measurement. That Phase 249 record is historical. Current heads/tags are in
**Current remote measurement** above.

Phase 233 correction: this table listed only four refs. The three branches
created since Phase 198 (`01a0a5f5`, `01a0a92b`, `01a0ad26`) were absent, as
was the Phase 221 rewrite-map row for `01a0a5f5` from this table. Each of the
three carries 269 carrier commits, so all three were affected while going
unlisted — the omission was security-relevant, not cosmetic. The rewrite map in
§3 named five refs and was missing `01a0a92b` and `01a0ad26`, so those two
branches appeared in **neither** table and would have survived the rewrite.

Three consequences follow from the **current** measurement (the Phase 249
note above is the pre-rewrite record of that phase):

1. **`main` no longer serves the credential from its tip.** The nine writable
   refs measure **0** carriers and **clean** tips. That is not A2 verification.
   `main` is still never the rewrite working context
   (`forbiddenBranches: ["main"]`).
2. **Removal from HEAD was never remediation.** The writable rewrite removed
   the blob from rewriteable history; GitHub-managed `refs/pull/1/head` still
   reaches **269** carrier commits. A surviving hidden ref keeps the blob
   reachable.
3. **A2 stays UNVERIFIED** while any affected PR ref still reaches the
   credential. The pending GitHub-side action is Support ticket **#4773405**.
   Do not duplicate it. Issue **#5** stays OPEN.

---

## 2. Rotation gate — Path C recorded; Path R **BLOCKED**

**The rewrite must not run before §2 is satisfied.**

§2 is satisfied by exactly one recorded path. Path R claims issuer revocation.
Path C does not. Treating Path C as a 401/403, or treating an unfiled file as
either path, is refused.

Rewriting with **neither** path recorded would be actively harmful: it destroys
the audit trail and can be misread as "resolved" while a live credential remains
valid in every clone, fork, CI cache and GitHub API view that already has it. A
Git rewrite cannot un-leak a secret; only the issuer can. Path C does not change
that fact — it records that the owner accepted residual risk without claiming
the issuer revoked the key.

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

**Path R — issuer revocation** (use this when a party with issuer-side access
exists). A human with that access must, **in this order**:

1. Provision a **new** credential at the OTP provider.
2. Configure it as a Convex environment variable (never in source).
3. **Revoke** the old credential.
4. Prove revocation: an authenticated call presenting the old credential
   returns an explicit auth failure (401/403). A timeout, a 000, or a 200 from
   an unrelated endpoint is **not** proof.
5. Record the date, the operator, and the observed rejection response at
   `docs/remediation/a1-revocation-attestation.json`.

**Path C — owner compensating-controls** (does **not** claim revocation). The
release gate reads a valid owner-filed
`docs/remediation/a1-compensating-controls.json` (`schema:
a1.compensating-controls/v1`, `source: owner-risk-acceptance`,
`revocationClaimed: false`) as VERIFIED for A1 after independently observed
runtime controls. That file is **filed** on this tree
(`docs/remediation/a1-compensating-controls.json`, `revocationClaimed: false`).
Path C is not a
401/403, not an exemption, and not self-certification by this tooling.

Path C is **recorded**. Path R is **unrecorded**. A1 is **VERIFIED** via
`owner-risk-acceptance`. The writable nine-ref rewrite **has been executed**
on github.com. A2 remains **UNVERIFIED** because `refs/pull/1/head` still
reaches the credential.

Path C does not mark `A2_HISTORY_REWRITE` verified and did not clear
`refs/pull/*`. This tooling does not start another §3, does not force-push,
and does not touch `main`. GitHub Support ticket **#4773405** is the pending
hidden-ref cleanup; do not duplicate it.

### 2.1 Phase 251 — A1 issuer access re-measured, still BLOCKED

Phase 251 re-measured whether this environment has a legitimate, authorised path
to revoke the leaked credential at `auth.freebuff.app`. It does not. No
revocation was attempted, no credential value was printed or presented, no
issuer host was probed with the leaked key, and no 401/403 was fabricated. A2
stays gated on §2.

Measured 2026-09-18T13:25:56Z from this sandbox, HEAD `113cd44`, without sending
a credential:

| Probe | Result |
|---|---|
| DNS `auth.freebuff.app` | resolves `69.46.46.68` |
| TCP `:443` `auth.freebuff.app` / `freebuff.app` / `freebuff.com` / `vly.ai` | **open** (1–20 ms) |
| TLS `https://auth.freebuff.app/` and `/send_otp` | **EOF** in 21–101 ms — HTTP **000**, no response |
| TLS `https://freebuff.app/`, `https://freebuff.com/`, `https://vly.ai/`, `https://api.vly.ai/` | **EOF**, HTTP **000** |
| Control `https://api.github.com/` | HTTP **200** (252 ms) |
| Control `https://registry.npmjs.org/` | HTTP **200** (81 ms) |
| Issuer-shaped names in the process environment | **none** (`FREEBUFF_*`, `VLY_*`, `OTP_*`, `AUTH_FREEBUFF_*`, `*_EMAIL_API*`, `RESEND_*`, `SMTP*` all unset) |
| `.env` / `.env.local` / `.env.production` | **absent** |
| `docs/remediation/a1-revocation-attestation.json` | **absent** (the directory does not exist) |
| `npm run remediation:a1:report -- --json` | exit **1**, `outcome: MISSING_EXTERNAL_ACCESS`, `attestation: null`, `remediationPerformed: false`, `releaseVerdict: NOT READY` (echoed, not issued here) |
| GitHub Actions secrets / deploy keys / secret-scanning | HTTP **403** `Resource not accessible by integration` |
| Convex | `CONVEX_DEPLOYMENT` unset, `CONVEX_DEPLOY_KEY` unset, no `~/.convex` |
| GitHub App permissions on this repo (API) | `admin/maintain/push/pull: false` |

DNS + open TCP + TLS EOF, while GitHub and npm answer 200 on the same network,
is **egress blocking**, not a dead issuer. A timeout, a 000, or a 200 from an
unrelated endpoint is still not revocation evidence.

`A1_REQUIREMENTS` still unsatisfied, every one:

| id | phase | Why it is missing |
|---|---|---|
| `a1-pre-credential-identity` | pre | identity is known by fingerprint in the manifest; no *record* has been filed because the issuer has not been observed |
| `a1-pre-live-status` | pre | requires `external-issuer`; this environment cannot complete a TLS handshake to the issuer |
| `a1-pre-replacement-provisioned` | pre | no replacement credential exists here, and none may be invented |
| `a1-post-issuer-confirmation` | post | no issuer confirmation exists |
| `a1-post-credential-rejected` | post | no 401/403 was observed; none was simulated |
| `a1-post-correct-credential` | post | there is no rejection to bind to the fingerprint |
| `a1-post-bound-and-fresh` | post | there is no production evidence to bind |

**Authorised access: no.** There is no issuer account, no admin key, no documented
self-service revocation API (Phase 222/246: `selfServiceRevocation` is absent),
and the TLS path to every issuer host is severed. The leaked key is also a
**shared platform key** (Phase 223: the same fingerprint in ≥83 public scaffold
copies across 73 owners) — this project cannot lawfully revoke it even with a
Freebuff *project* login. Only the issuer backend can.

**Safe legitimate path** (runbook §2 order, unchanged): a party with issuer-side
authority (Freebuff, Inc. / the scaffold issuer, not this repository) provisions
a replacement, the operator configures it outside source control, the issuer
revokes the leaked key, an authenticated call presenting the **old** key returns
an explicit **401 or 403**, and that observation is filed at
`docs/remediation/a1-revocation-attestation.json` under schema
`phase246.a1-evidence/v1` (no credential value in the file). Until that file
exists and the gate accepts it as `external-verification` in `production`, A1 is
**BLOCKED / UNVERIFIED**.

Repository cleanup, a history rewrite, a green scanner on a mirror, and the
absence of the key from `HEAD` are **not** A1. A2 must not run.

### 2.2 Compensating-controls path — does **not** claim revocation

A1 has a second, owner-filed path when the issuer is unavailable. It is **not**
revocation evidence, **not** an exemption, and **is now filed** on this tree.

| Item | Value |
|---|---|
| Schema | `a1.compensating-controls/v1` |
| Path | `docs/remediation/a1-compensating-controls.json` |
| Source the gate will accept | `owner-risk-acceptance` (A1 only) |
| `revocationClaimed` | **must be `false`** |
| Who may file | an authorized project owner, explicitly |
| Who may not file | this tooling, a fixture, a document, a CI run |

Required contents (no credential value): `accepted: true`, `acceptedBy`,
`acceptedAt`, a rationale of at least 40 characters, and `residualRisk` naming
that the leaked key is **not** revoked at the issuer. The reader observes
`emailOtp.ts`, `emailDelivery.ts` and `issuerPolicy.ts` independently; if any
required control is missing, the file cannot satisfy A1.

The owner has filed Path C and the A1 gate reads it as VERIFIED. §2 was
satisfied **without claiming revocation**, and the writable nine-ref rewrite
then landed on github.com. This tooling still does not start another §3.
A2 remains **UNVERIFIED**. `refs/pull/1/head` still requires GitHub Support
(ticket **#4773405**; do not duplicate). Residual risk in §5 still applies:
the shared key is not dead at the issuer.

Path C is **recorded**. Path R is **unrecorded**. A2 remains **UNVERIFIED**.
The writable §3 **has been executed**; GitHub-managed pull refs have not been
cleared.

---

## 3. Rewrite procedure — writable refs executed on github.com; A2 unverified

Verified in Phase 198 against a fresh `--mirror` clone in `/tmp`. The
production repository and `main` were never touched.

```bash
# 0. Preconditions: §2 satisfied and recorded (Path R or Path C). Never run otherwise.
#    Path C is not issuer revocation. Residual risk in §5 still applies.

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

The Phase 221 table above is a **rehearsal record**, including `heads/main`
before `51c9ddeb`. The later writable rewrite landed on github.com; current
tips are in **Current remote measurement**. A2 remains **UNVERIFIED** while
`refs/pull/1/head` still reaches the credential.

Phase 250 re-ran step 3 with the documented tool (`git filter-repo --replace-text`)
on a disposable full mirror. §3.2 records that rehearsal and states the GitHub
ref surface the force-push cannot clear: `refs/pull/*` are read-only, require a
GitHub Support cleanup after the repository refs are rewritten, and keep A2
UNVERIFIED for as long as they still reach the credential.

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

**What this does not change.** The rehearsal is evidence about a procedure, not
a remediation. Path C is **recorded** and A1 is VERIFIED without claiming
revocation. Path R is **unrecorded**. The writable nine-ref rewrite later
landed on github.com; A2 remains **UNVERIFIED** while `refs/pull/1/head` still
reaches the credential. The release verdict is unchanged: **NOT READY**.

### 3.2 Exact-tool rehearsal — `git filter-repo --replace-text` (Phase 250)

§3.1 recorded that the documented tool and the rehearsed driver were not the same
tool. Phase 250 installed `git-filter-repo` in a disposable venv (not as a
repository dependency) and re-ran the rewrite with the command §3 actually writes,
on a fresh full mirror of the real remote. Rehearsal only: no real rewrite, no
force-push of heads or tags, `main` untouched at `51c9ddeb`.

**Tool.** `git-filter-repo` 2.47.0 (PyPI); `git filter-repo --version` prints
`a40bce548d2c`. Command, as documented:

```
git filter-repo --replace-text replacements.txt --force
```

Replacement file format (value never printed, file mode 0600, shredded after):
`<secret>==>***REMOVED-ROTATED-CREDENTIAL***`. Two independent runs on two fresh
mirrors produced identical tips for every original ref.

**The GitHub ref surface, stated as procedure rather than as a finding.**

1. `refs/heads/*` and `refs/tags/*` are rewriteable through the controlled rewrite
   procedure and are the only refs a collaborator can force-push.
2. `refs/pull/*` are GitHub-managed, read-only pull-request references. GitHub
   rejects a normal (non-force) push to them with `deny updating a hidden ref`.
   They are not an operator permission problem and must not be bypassed.
3. After the repository refs are rewritten, GitHub Support must clear the
   affected pull-request references. No git command available to this project
   does that.
4. The post-rewrite remote scan (§4) must cover both the rewritten heads/tags
   *and* every `refs/pull/*` GitHub still advertises. A clean scan of heads only
   is the tip-only-clean failure mode.
5. A2 cannot be considered verified while any affected PR ref still reaches the
   credential.

`--force --mirror` as written in step 5 will attempt to update hidden refs and
GitHub will refuse those updates. Push only `refs/heads/*` and `refs/tags/*`,
then open the Support request, then scan the *remote*.

**Nine repository refs — before / after the `filter-repo` simulation** (remote
tips as of `71dd13f`; after-tips identical on both runs):

| Ref | Before | After | Commits | Topology | Author/date/subject | Tip tree |
|---|---|---|---|---|---|---|
| `heads/arena/01a08e67-trade-intel-bot` | `f8939130` | `bd233a87` | 362 = 362 | isomorphic | preserved | byte-identical (763 paths) |
| `heads/arena/01a0a5f5-trade-intel-bot` | `3f636903` | `0fbab31a` | 393 = 393 | isomorphic | preserved | byte-identical (788 paths) |
| `heads/arena/01a0a92b-trade-intel-bot` | `b321e507` | `50dcdfa5` | 392 = 392 | isomorphic | preserved | byte-identical (788 paths) |
| `heads/arena/01a0ad26-trade-intel-bot` | `7564f138` | `dc2dc113` | 407 = 407 | isomorphic | preserved | byte-identical (814 paths) |
| `heads/arena/01a0adfb-trade-intel-bot` | `27edd4a2` | `bcc3f34d` | 427 = 427 | isomorphic | preserved | byte-identical (870 paths) |
| `heads/arena/01a0b293-trade-intel-bot` | `71dd13f5` | `897c7215` | 431 = 431 | isomorphic | preserved | byte-identical (878 paths) |
| `heads/main` | `51c9ddeb` | `b1a9e915` | 261 = 261 | isomorphic | preserved | 1 path rewritten |
| `heads/phase-157-live-discovery-lifecycle` | `244e9cc7` | `6bf6f580` | 262 = 262 | isomorphic | preserved | 1 path rewritten |
| `tags/rc-181` | `66323a38` | `23d25ffa` | 299 = 299 | isomorphic | preserved | byte-identical (681 paths) |

The four after-tips that Phase 221 already recorded (`bd233a8`, `b1a9e91`,
`6bf6f58`, `23d25ff`) match this run exactly. Phase 221 was this tool; the
Phase 245 driver later diverged to `filter-branch --index-filter` and produced
different SHAs. The replacement blob is `f5d58896` (marker
`***REMOVED-ROTATED-CREDENTIAL***`), not the driver's `f05a221a`.

| Check | Result |
|---|---|
| fingerprint on the nine repository refs | **0 of 9** |
| independent scanner on the rewritten mirror (all 16 original refs) | **CLEAN**, `--expect-clean` exit 0, leaked blob `e490ffda` **ABSENT** |
| positive control on an unmodified mirror | **EXPOSED — 1 blob** `e490ffda…` at `src/convex/auth/emailOtp.ts`; `--expect-clean` exit 1 |
| parent-arity / commit-count / merge / root | identical per ref |
| author / email / date / subject | identical on every head, tag, and `pull/*/head`; `pull/*/merge` subjects remap the embedded SHAs (GitHub synthetic merge commits), dates/authors unchanged |
| candidate tree | `heads/arena/01a0b293-trade-intel-bot`: **878 / 878 byte-identical**. Every tip-clean ref: 0 paths changed. `main` and `phase-157`: exactly the credential path |
| determinism | two fresh mirrors, identical 16 tips |
| rollback | in-repo backup refs are **rewritten** by `filter-repo` (they are not a restore). An external pre-image of the mirror restores every tip byte-exactly. `filter-repo` also strips `origin` and gc-prunes original objects |
| extra / lost refs (documented command, no extra backups) | 0 / 0 — 16 = 16 |
| credential value printed | none |

**`refs/pull/*` — seven refs, four pull requests, all still reach the credential
on the real remote.**

| Ref | PR | Remote tip (unchanged) | Carriers on the real remote |
|---|---|---|---|
| `refs/pull/1/head` | 1 | `b321e507` | 269 |
| `refs/pull/2/head` | 2 | `7564f138` | 269 |
| `refs/pull/2/merge` | 2 | `f5d3cacc` | 269 |
| `refs/pull/3/head` | 3 | `27edd4a2` | 269 |
| `refs/pull/3/merge` | 3 | `74196da6` | 269 |
| `refs/pull/4/head` | 4 | `71dd13f5` | 269 |
| `refs/pull/4/merge` | 4 | `e0d9ef40` | 269 |

`git-filter-repo` rewrites these refs **locally** (the full-mirror scan is CLEAN
because of that). They cannot be pushed. Measured, without `--force`, against the
real remote:

```
! [remote rejected] refs/pull/4/head -> refs/pull/4/head (deny updating a hidden ref)
! [remote rejected] refs/pull/4/merge -> refs/pull/4/merge (deny updating a hidden ref)
! [remote rejected] refs/pull/1/head -> refs/pull/1/head (deny updating a hidden ref)
```

`ls-remote` after those rejected pushes: every pull ref, `arena/01a0b293` and
`main` unchanged. Dry-run is not proof — it reported `[new reference]` for refs
GitHub then refused.

**What GitHub would serve after a heads/tags-only force-push** (local simulation:
update only `refs/heads/*` and `refs/tags/*` on a copy of the control mirror,
leave `refs/pull/*` at the pre-rewrite tips):

* independent scanner **EXPOSED — 1 blob**;
* `rev-list --count --all` **435 → 866**;
* every one of the nine repository refs: 0 carriers;
* every one of the seven PR refs: **269 carriers**;
* every *tip* looks clean, including the PR refs — which is why the tip is not
  the proof.

A2 remains **UNVERIFIED** / **NOT READY**. The Phase 250 rows above are the
pre-push GitHub surface. After the writable force-push, only
`refs/pull/1/head` still carries 269; Support ticket **#4773405** is pending.
Do not run §3 again.

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
- GitHub's `refs/pull/*` (PR head and merge refs) until GitHub Support clears them — a collaborator cannot;
- CI caches and build artifacts;
- any third-party mirror or code-scanning index.

The old credential must be **dead at the issuer** for any of this to be
resolved. Path C does not make it dead. A rewrite under Path C removes the blob
from rewriteable refs; it does not retract the key from clones, forks, CI
caches, GitHub `refs/pull/*`, or the issuer.
