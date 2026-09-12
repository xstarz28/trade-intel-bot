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
| Present in `isolate/` (stale committed build)? | **No** |
| Hardened branch reads it from the environment only? | **Yes** — `process.env.OTP_EMAIL_API_KEY`, and it throws if unset rather than silently failing to send |
| Present in `main`'s current tree? | **Yes** — `src/convex/auth/emailOtp.ts:29` |
| Commits containing it | **9** |

### The 9 commits

Eight are ancestors of the release-candidate branch; the ninth is `main`'s tip.

```
3a82789  c8dae1a  7ab7c80  7bd5880  4573d2f
02048b4  4e9000f  cf96570  51c9dde  <- main tip, publicly reachable
```

**Two consequences that must not be understated:**

1. `51c9dde` is the tip of `origin/main`. Anyone who can read the repository
   can read the credential right now. Removing it from the current tree did
   **not** neutralise it.
2. The credential is also in the **release-candidate branch's history**. The RC
   *artifact* is clean — no build output contains the value — but the branch
   history is not. Cleaning only `main` would be insufficient.

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
# On a MIRROR clone, never the working repository.
git clone --mirror git@github.com:xstarz28/trade-intel-bot.git repo-mirror
cd repo-mirror

# Put the retired literal in a file; git-filter-repo replaces it everywhere.
printf 'literal:<OLD_KEY>==><REMOVED>\n' > /tmp/replacements.txt

git filter-repo --replace-text /tmp/replacements.txt

# Verify BEFORE pushing: expect zero matches.
git grep -F '<OLD_KEY>' $(git rev-list --all) | wc -l

git push --force --all
git push --force --tags
```

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
