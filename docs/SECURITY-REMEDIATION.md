# Security Remediation — Leaked OTP Credential

Phase 181 audit. **This document does not contain the credential.** It is
identified throughout by fingerprint only.

| Field | Value |
| --- | --- |
| Credential | OTP email delivery API key (`x-api-key` for `auth.freebuff.app`) |
| Fingerprint | `sha256[0:16] = b1ce18a1e85ba121` |
| Status | **NOT ROTATED — live security blocker** |
| Rotation owner | Human operator with `auth.freebuff.app` access |

---

## 1. Audited state (measured, not assumed)

| Question | Finding |
| --- | --- |
| Present in current working tree? | **No** |
| Present in built `dist/`? | **No** |
| Present in Android/iOS projects? | **No** |
| Present in `isolate/` (stale committed build)? | **No** — and `isolate/` was removed entirely in Phase 184 |
| Hardened branch reads it from the environment only? | **Yes** — `process.env.OTP_EMAIL_API_KEY`, and it throws if unset rather than silently failing to send |
| Present in `main`'s current tree? | **Yes** — `src/convex/auth/emailOtp.ts:29` |
| Commits containing it | **270** (corrected in Phase 184) |

### Scope correction — Phase 184

An earlier audit reported **9** affected commits. That number was wrong, and
the reason matters more than the correction.

The audit ran inside a **shallow clone grafted at `51c9dde`**, so `git rev-list
--all` could only see a single commit of real history. The scan was accurate
about what it could reach; it simply could not reach most of the repository.

Phase 184 ran `git fetch --unshallow`, which restored the full history, and
re-ran the same fingerprint matcher:

| Measure | Shallow audit | Full-history audit |
| --- | --- | --- |
| Reachable commits | 1 | **306** |
| Affected commits | 9 | **270** |
| Affected branches | 2 | **3** |
| Distinct affected paths | 1 | 1 (`src/convex/auth/emailOtp.ts`) |

The third branch, `phase-157-live-discovery-lifecycle`, was **invisible** to the
shallow clone. Had remediation proceeded on the earlier figure, that branch
would have been left carrying the credential and the cleanup would have been
declared complete.

A blob-level scan of every reachable object (3,324 objects, 1,665 text blobs)
found the credential in exactly **one distinct blob**, reused across those 270
commits. Commit messages and tag objects are clean.

**Lesson: never scope a history rewrite from a shallow clone.** Verify
`git rev-list --all | wc -l` looks plausible before trusting any history audit.

**Two consequences that must not be understated:**

1. `51c9dde` is the tip of `origin/main`. Anyone who can read the repository
   can read the credential right now. Removing it from the current tree did
   **not** neutralise it.
2. The credential is also in the **release-candidate branch's history**, in
   tag `rc-181`, and in `phase-157-live-discovery-lifecycle`. The RC *artifact*
   is clean — no build output contains the value — but the history is not.
   Cleaning only `main` would be insufficient.

---

## 2. Why the credential must be rotated BEFORE history is rewritten

Rewriting history first is the intuitive order and it is wrong.

- Rewriting is **not** a containment measure. The old objects survive in
  every existing clone, in fork networks, and in GitHub's unreachable-object
  storage until garbage collection — which a third party does not control.
- A rewrite **invalidates every commit SHA**, which breaks the provenance
  built in Phase 180 and invalidates any artifact traceability produced
  before it.
- If the key is rotated first, the exposed value becomes worthless and the
  rewrite becomes routine hygiene rather than an emergency.

**Order is therefore fixed: rotate → verify the old key is rejected → then,
optionally, rewrite history.**

---

## 3. Procedure (prepared, deliberately NOT executed)

### Stage 1 — Rotation (human, external)

1. Sign in to `auth.freebuff.app`.
2. Issue a new OTP delivery API key.
3. Set `OTP_EMAIL_API_KEY` to the new value in the **Convex deployment
   environment** — not in any file in this repository.
4. **Revoke** the old key.
5. Verify the old key is rejected (expect an auth failure):
   ```bash
   # Uses the OLD key from your own secure store. Never paste it into the repo.
   curl -s -o /dev/null -w '%{http_code}\n' \
     -X POST https://auth.freebuff.app/send_otp \
     -H "x-api-key: $OLD_KEY" \
     -H 'content-type: application/json' \
     --data '{"to":"probe@example.invalid","otp":"000000","appName":"rotation-check"}'
   # 401/403 => revoked. 200 => STILL LIVE, rotation incomplete.
   ```
6. Confirm sign-in still works end-to-end with the new key.

Only after step 5 returns 401/403 may UAT row 17.31 move off BLOCKED.

### Stage 2 — History remediation (only after Stage 1 is confirmed)

Not to be run blindly. Requirements first:

- Written confirmation that the old key is revoked.
- A full backup: `git clone --mirror` stored off-platform.
- Agreement from every contributor — this rewrites shared history and forces
  everyone to re-clone.
- A maintenance window; CI, deployments, and open PRs will break.

```bash
# 1. Full mirror. NEVER run filter-repo against a shallow or grafted checkout.
git clone --mirror git@github.com:xstarz28/trade-intel-bot.git repo-mirror
cd repo-mirror
git rev-list --all | wc -l        # sanity: must look like real history, not 1

# 2. Off-platform backup BEFORE touching anything.
cp -r ../repo-mirror ../repo-mirror-backup.git

# 3. Replacement rule. Build this file from your secure store; do not echo it.
printf 'literal:<OLD_KEY>==>__OTP_EMAIL_API_KEY_REMOVED__\n' > /tmp/replacements.txt
chmod 600 /tmp/replacements.txt

# 4. Rewrite every ref.
git filter-repo --replace-text /tmp/replacements.txt --force

# 5. Verify ZERO reachable occurrences before pushing (see the verification
#    section below). Do not skip this.

# 6. Force-push only after verification passes.
git push --force --all
git push --force --tags
shred -u /tmp/replacements.txt
```

### Rehearsal result (Phase 184, on a disposable mirror copy)

This exact procedure was executed against a throwaway clone of the mirror to
prove it works before it is ever run for real. Nothing was pushed.

| Check | Result |
| --- | --- |
| Commits preserved | 306 -> **306** (none lost) |
| Refs rewritten | 4 (`main`, RC branch, `phase-157...`, `rc-181`) |
| Credential blobs after rewrite | **0** |
| Source blobs changed across all history | **exactly 1** |
| RC tip tree hash | **byte-for-byte identical** (`e410a76...`) |

The last two rows are the ones that matter: the rewrite is surgical. It changes
the single leaked blob and nothing else, and current release-candidate content
is entirely unaffected.

Indicative ref mapping from the rehearsal. The real run will produce **different**
SHAs, because it will start from whatever the tip is at that time:

| Ref | Before | After (rehearsal) |
| --- | --- | --- |
| `main` | `51c9dde` | `2286fc5` |
| `arena/01a08e67-trade-intel-bot` | `be98364` | `2ce565e` |
| `phase-157-live-discovery-lifecycle` | `244e9cc` | `7bbc9d1` |
| `rc-181` | `66323a3` | `1c52b99` |

Then: ask GitHub Support to garbage-collect unreachable objects, and have every
collaborator re-clone. Stale forks retain the old objects regardless.

### Stage 3 — Post-rewrite reconciliation

Because SHAs change, this Phase-180/181 work needs follow-up:

- Provenance in previously built artifacts points at commits that no longer
  exist. Rebuild and redeploy.
- `docs/DEPLOYMENT.md` and `docs/RELEASE-CANDIDATE.md` reference the RC SHA;
  update both.
- Re-run every validation gate against the rewritten history.

---

## 4. What this repository must NOT do

Recorded because each is tempting and each is wrong:

- **Do not rotate automatically.** Rotation requires credentials this
  repository does not and should not hold.
- **Do not rewrite history before external rotation is confirmed.**
- **Do not print the credential** into logs, test output, commit messages, or
  documentation — including this file.
- **Do not treat "absent from the working tree" as remediated.** It remains
  publicly readable at `origin/main`.
- **Do not merge the RC branch into `main`** while `main`'s tip carries the
  credential.

---

## 5. Release impact

Deployment stays **NOT READY** until Stage 1 is confirmed. This is the single
highest-severity open item in the release-candidate audit: it is a live,
externally reachable credential, not a theoretical exposure.
