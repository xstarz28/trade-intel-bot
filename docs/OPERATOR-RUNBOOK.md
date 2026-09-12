# Operator Runbook — External Verification

Phase 183. Every step here requires access this repository's build environment
does not have: an unrestricted network, a Convex deployment, signing
identities, real hardware, or a vendor account.

Nothing in this document has been executed. Each step states its exact command
and its **acceptance criterion**, so the result is a fact rather than an
impression.

**Order matters in §1. Do not reorder it.**

---

## 1. OTP credential rotation — do this before anything else

The credential is identified by fingerprint only: `sha256[0:16] =
b1ce18a1e85ba121` (computed over the value plus a trailing newline, as
produced by `echo -n`-less shell hashing). **Never print or paste the value.**

Independently re-verified during Phase 183: **9 commits** contain it, and
`51c9dde` is the tip of `origin/main`, so it is readable by anyone with
repository access right now.

### Step order — rotation before history rewrite

Rewriting history first is not containment: it does not invalidate a key that
still works, and it destroys every commit SHA this audit refers to.

| # | Action | Acceptance criterion |
| --- | --- | --- |
| 1.1 | Issue a replacement credential at `auth.freebuff.app` | New credential exists |
| 1.2 | Set it as `OTP_EMAIL_API_KEY` in the Convex deployment | `npx convex env list` shows the name (never the value) |
| 1.3 | Revoke the old credential at the provider | Provider console shows it revoked |
| 1.4 | **Verify the old credential is rejected** | A request carrying it returns **401 or 403** |
| 1.5 | Verify OTP delivery with the replacement | A sign-in code actually arrives |

Step 1.4 is the gate. Until a rejection is observed, the credential is live
regardless of what the source tree looks like.

### History remediation — only after 1.4 passes

Affected refs, confirmed by walking every commit in the repository:

| Ref | Reaches the credential |
| --- | --- |
| `main` (`51c9dde`) | **Yes — tip itself** |
| `arena/01a08e67-trade-intel-bot` | **Yes** — descends from `51c9dde` |
| tag `rc-181` | **Yes** — same ancestry |

All three must be remediated. Rewriting only `main` leaves the credential
reachable from the working branch and the release tag.

```bash
# After 1.4 has passed, and with a full (non-shallow) clone:
git clone --mirror git@github.com:xstarz28/trade-intel-bot.git
cd trade-intel-bot.git
git filter-repo --replace-text <(echo 'literal:<THE-OLD-VALUE>==>REDACTED')
git push --force --all
git push --force --tags
```

> This checkout is **shallow/grafted**, so `filter-repo` cannot run here. It
> must be done from a full mirror clone.

**After the rewrite every SHA changes.** Therefore:

1. Record the new commit topology (old → new SHA mapping) in
   `docs/SECURITY-REMEDIATION.md`.
2. Re-tag the release candidate; `rc-181` will point at a dead object.
3. Rebuild — build provenance embeds the commit, so every prior artifact
   becomes unverifiable.
4. Redeploy anything already deployed from an old SHA.
5. Tell every collaborator to re-clone. A stale local clone can silently push
   the credential back.

---

## 2. Convex deployment and codegen

Blocked here: `provision.convex.dev`, `api.convex.dev` and
`dashboard.convex.dev` all return HTTP 000 (TLS terminated by a domain
allowlist — re-probed in Phase 183, not assumed).

```bash
npx convex dev            # first run: creates/links the deployment
npx convex codegen        # regenerates src/convex/_generated/
git diff src/convex/_generated/
npx convex deploy
```

| Criterion | Requirement |
| --- | --- |
| Codegen | `npx convex codegen` exits 0 |
| Diff reviewed | The `_generated/` diff is inspected, **never hand-edited** |
| Deploy | `npx convex deploy` exits 0 and lists the functions |
| Env vars | Class B and C set via `npx convex env set` — **never committed** |

The current `src/convex/_generated/` is tracked and stale. It was maintained by
hand because codegen cannot run here; the first successful codegen will
produce a real diff, which must be reviewed rather than rubber-stamped.

### Functions to confirm deployed

`runProtectedAnalysis`, the entitlement query/mutation paths, the provider
actions, the auth module, and the schema.

---

## 3. Evidence Level D — authenticated calls against the deployment

Evidence D may be marked PASS **only** after real calls succeed against a real
deployment. Mocks do not count, and a test-only pass is not evidence.

### Auth
OTP send · sign in · session created · refresh · protected route · logout ·
re-login.

### Entitlement
- A chargeable BUY/SELL/LONG/SHORT consumes exactly one signal.
- WAIT/NO_TRADE consumes **zero**.
- An exhausted user receives an explicit **LOCKED**, never a substituted WAIT.
- The locked payload carries **no** directional field.
- Premium is not charged.
- Client-side bypass attempts fail server-side.

### Provenance
- Client-supplied evidence cannot alter provider-backed evidence.
- `marketData` / `technicalData` are reacquired server-side.
- Acquisition mode is reported honestly.
- `observedAt` is provider-derived.
- Cached evidence preserves the original observation time.
- Stale data never becomes live.

### Fan-out and cache
Timeout · partial failure · rate-limit · overall deadline · cold acquisition ·
warm reuse · concurrent single-flight · expiry · failure recovery.

### OKX
Discovery · exact native `instId` · native OHLCV · order book
(uncached-by-design) · exchange-timestamp freshness.

---

## 4. Live providers

All seven hosts return HTTP 000 here. For each of Twelve Data, Alpha Vantage,
CoinGlass, TickAtlas/calendar, Treasury, CFTC/COT, EIA, OKX and FX
conversion, record: reachability, response success, provider identity,
acquisition mode, `observedAt`, evidence age, freshness, timeout/rate-limit
category, and whether the evidence was actually attached.

---

## 5. Production web deployment

Deploy **only** the hardened RC branch. **Never deploy `main`** — its tip
contains the credential.

Verified locally against the real production build; must be repeated against
the real host:

| Check | Local result |
| --- | --- |
| `/`, `/auth`, `/dashboard`, `/journal`, `/download`, `/privacy`, `/terms` | 200 + `text/html` |
| Entry JS | `text/javascript` |
| Entry CSS | `text/css` |
| `.well-known/*` | `application/json` |
| `/dashboard/assets/*` masquerade | Not requested — every asset ref is absolute |
| Build provenance | Embedded commit matches `HEAD` |

HTTP 200 alone is not proof. Check the content type, and confirm the embedded
commit matches the intended release.

---

## 6–7. Android and iOS release readiness

| Item | Android | iOS |
| --- | --- | --- |
| Application identity | `app.xstarz.analysis` ✅ | `app.xstarz.analysis` ✅ |
| Version | `versionCode 1`, `versionName "1.0"` ✅ | `CURRENT_PROJECT_VERSION 1`, `MARKETING_VERSION 1.0` ✅ |
| Signing configuration | Reads git-ignored `keystore.properties`; absent ⇒ unsigned ✅ | `CODE_SIGN_STYLE = Automatic` ✅ |
| Signing material committed | **None** ✅ | **None** ✅ |
| Release artifact | **BLOCKED** — no keystore | **BLOCKED** — no Apple Developer account |

Bumping `versionCode` is required before any store upload; it is intentionally
left at 1 because no release has ever been published.

---

## 8–9. Deep links

Both association files currently hold placeholders, which is correct — a
fabricated fingerprint would be worse than an absent one.

| File | Placeholder | Replace when |
| --- | --- | --- |
| `assetlinks.json` | `REPLACE_WITH_RELEASE_CERT_SHA256` | A real release keystore exists |
| `apple-app-site-association` | `REPLACE_WITH_APPLE_TEAM_ID` | A real Apple Team ID exists |

Get the Android fingerprint from the real keystore:

```bash
keytool -list -v -keystore <release.jks> -alias <alias> | grep 'SHA256:'
```

Then verify on-device that a link opens in the app, not the browser.

---

## 10. Windows desktop

| Item | Status |
| --- | --- |
| CI build | See §17 matrix |
| MSI + NSIS produced | Asserted in CI |
| Artifact scan | Runs in CI on installers and the compiled `.exe` |
| Identity / version | `app.xstarz.analysis.desktop`, `0.1.0`, publisher `Xstarz` |
| Release signing | **BLOCKED** — no certificate |
| Microsoft Store | **BLOCKED** — no Partner Center account; also needs MSIX repackaging and `offlineInstaller` WebView2 |
| Direct download | **BLOCKED** — no download host, no certificate |
| Auto-update | Documented, deliberately not implemented; an unsigned updater is an RCE channel |

---

## 11. Official website

No custom domain exists and none is invented. `/`, `/download`, `/privacy` and
`/terms` are production routes today under the existing SPA rewrite, so
attaching a domain is a DNS/hosting action rather than a code change.

`/download` must not advertise an installer URL until a real download host
exists. It currently renders both channels as explicitly unavailable.

When a domain exists, verify: HTTPS, SPA routing, artifact hosting,
checksums/signatures, App Links and Universal Links.

---

## 12–13. Physical device verification

Never convert a simulator or CI result into a physical-device PASS.

- **Android** — install, launch, login, dashboard, journal, analysis,
  entitlement lock, background/foreground, offline and recovery, deep links,
  logout.
- **iOS** — the same matrix. **The user has no iPhone**, so these rows remain
  BLOCKED and must not be reported any other way.
- **Windows** — install MSI/EXE, launch, auth, dashboard, journal, network
  loss and recovery, deep links, uninstall and reinstall.

If offline mode ever shows a fabricated price, confidence or freshness value,
**stop and report** — that breaks a standing product invariant.
