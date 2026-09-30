# Frontend publication — how the browser-facing site is updated, and how that is proven

Phase 300. This document is about **where the web app is published from** and how
a publication is verified. It changes no analysis, no provider and no UI.

---

## 1. What actually served the browser before this phase

Established from repository metadata, the GitHub API and the commit contents —
not from inference:

| Question | Finding |
| --- | --- |
| Which workflow publishes the frontend? | **None.** `.github/workflows/` has `ci`, `development-deploy`, `development-runtime-smoke`, `mobile`, `production-deploy`, `release-admission`. `development-deploy` runs `npx convex dev --once`, which pushes **functions**; `production-deploy` is the only `convex deploy --cmd` (which uploads static files) and it is production-only. |
| Which ref were the deployments built from? | All **25** historical `development` deployments in the API: `ref: main`, sha `01951c64…`. |
| Then who published the site? | A GitHub App check suite — **`freebuff-web`** (owner `CodebuffAI`) — is queued on every commit. That external host rebuilt `main`, whose tip still carries the retired scaffold: `Auth.tsx:278 "secured by freebuff.com"`, the vly instrumentation, `auth.config.ts` issuer `https://freebuff.com`, `emailOtp.ts` → `auth.freebuff.app/send_otp`, and `--primary: oklch(0.6 0.16 170)` (teal-green). |
| Where does `trade-intel-bot.freebuff.app` point? | A Vercel deployment that no longer exists (`404 DEPLOYMENT_NOT_FOUND`). |
| Can the Convex **development** deployment host the frontend? | No. The installed CLI's own description says `convex deploy` targets a "production or preview deployment", and with `CONVEX_DEPLOYMENT` set it targets *the project's default production deployment*. Static upload is part of that command, so the dev deployment (which `convex dev` refreshes) cannot receive static files. |
| Can this repo enable GitHub Pages? | No. `has_pages: false`, and the token available to the agent has `admin: false`. Enabling Pages is a repository-settings action. |
| Is there any other hosting config in the repo? | `vercel.json` (SPA rewrite) and `public/_redirects` (Netlify-style) — build-time assets that tell a **static host** how to route. `sst-env.d.ts` is an auto-generated leftover with no `sst.config.*`. |

**Conclusion:** the browser-facing site was owned by a host outside this
repository, configured to build `main`. Nothing in the repository could change
that, which is why the site kept showing the retired UI while every workflow was
green.

---

## 2. What Phase 300 adds

Two things, both deterministic:

1. **`scripts/frontend-publication-guard.mjs`** (`npm run frontend:publish:guard`)
   — refuses a publication unless the ref is the pinned branch, a browser-facing
   https origin is configured, and the host credential is present. `main` is
   refused by the repository-wide rule; every other ref is refused by name. It
   never contacts a host, never prints a credential, and never reports a
   publication.
2. **`.github/workflows/publish-development-frontend.yml`** — the manual
   publication path:
   `guard → build → verify:frontend → upload the exact bytes → alias the
   browser-facing host → verify:published (fetch the public URL)`.

It uploads the directory that already passed `verify:frontend`
(`vercel deploy dist` uploads static files as-is; it does not rebuild them), so
"verified" and "published" are the same bytes rather than two similar builds.

**`scripts/verify-published-frontend.mjs`** (`npm run verify:published`) is the
acceptance check. It fetches the public URL and refuses acceptance, by name,
when:

- `/build-info.json` is missing, unparseable, or answers non-200;
- the branch is not the pinned branch (`main` included);
- the commit is not the commit that was checked out;
- the served provenance file is not byte-identical to the one that passed
  `verify:frontend` (`--expect-build-info-sha256`);
- the page does not load the same content-hashed bundles
  (`--expect-asset-names`);
- `/build` does not answer (a provenance route nobody can open proves nothing);
- a referenced asset is not served;
- any retired platform marker (`freebuff.com`, `freebuff.app`, `secured by`,
  `vly.ai`, `vly-toolbar`, `VLY_APP_NAME`, `VLY_CONVEX_AUTH_ISSUER`) or retired
  OTP marker (`send_otp`, `email-otp`, `emailOtp`, `Sign in with email`,
  `One-time code`) appears;
- the Xstarz blue primary (`oklch(0.52 0.18 255)`) is absent or the retired
  teal-green primary is present;
- the current sign-in copy (`Continue with Google` / `Continue as guest`) is
  missing.

Exit codes: `0` accepted, `1` refused (the report names the check), `2` nothing
could be inspected (transport, which is not a result about the site).

**A green workflow is not a publication.** The only acceptance evidence is a
fetch of the public URL. The workflow's last step is that fetch, and it fails the
run when it fails.

---

## 3. One-time setup (operator) — required before a real publication can happen

The publication path is complete and tested, but it is **credential-gated**: with
no credential the run fails with `HOST_CREDENTIAL_ABSENT` instead of skipping the
upload. Configure, in the GitHub **`development`** environment:

| Kind | Name | What it is |
| --- | --- | --- |
| secret | `VERCEL_TOKEN` | a token scoped to the **existing** project that serves the development site |
| variable | `VERCEL_ORG_ID` | the team/user that owns that project |
| variable | `VERCEL_PROJECT_ID` | that project's id (this workflow never creates a project) |
| variable | `FRONTEND_HOST_URL` | the browser-facing https origin, e.g. `https://<dev-host>` |
| variable | `VITE_CONVEX_URL` | already set for the development deploy; baked into the build |

Alternatively, if the `freebuff-web` project (or any other host) is to remain the
publisher, point **it** at `arena/01a0d195-trade-intel-bot` instead of the default
branch. That is a host-side project setting; this repository cannot reach it, and
the publication workflow above is not needed in that case — but
`npm run verify:published` still is, because it is what proves the site serves
the branch.

No new hosting platform is created by this phase, deliberately: `vercel.json`
and the dead `*.freebuff.app` FQDN identify the intended host family, and the
workflow deploys into the project it is given.

---

## 4. Running it

```bash
# 1. Publish (GitHub UI → Actions → "Publish development frontend" → Run workflow)
#    ref:    arena/01a0d195-trade-intel-bot   (required, defaulted)
#    confirm: PUBLISH_FRONTEND
#    mode:   publish

# 2. Judge a URL without publishing anything (no credential needed)
mode: verify-only

# 3. Or from a machine, against any host:
npm run verify:published -- --url https://<host> \
  --expect-branch arena/01a0d195-trade-intel-bot \
  --expect-commit "$(git rev-parse HEAD)"

# 4. Or judge the bytes CI built, before publishing:
npm run verify:frontend -- --expect-branch arena/01a0d195-trade-intel-bot \
  --expect-commit "$(git rev-parse HEAD)" --require-clean
```

`npm run frontend:publish:guard` can be run locally to see the decision the
workflow will make — it prints the projected source ref, the pinned branch, the
browser-facing origin, and credential **presence** (never values).
