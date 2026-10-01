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
   `guard → build → verify:frontend → assemble the prebuilt Build Output API
   directory → upload it with --prebuilt → alias the browser-facing host →
   verify:published (fetch the public URL)`.

It uploads the directory that already passed `verify:frontend`, assembled into
the host's Build Output API layout and deployed with `--prebuilt`, so "verified"
and "published" are the same bytes rather than two similar builds — and the host
runs **no build at all**.

**Why prebuilt, and not `vercel deploy dist` (Phase 300 final hotfix).**
Uploading a directory makes the host treat it as *source*: it runs the project's
configured build command in its own builder, which has none of the checkout's
dependencies. The observed failure was

```
Running "vercel build"
sh: line 1: vite: command not found
Error: Command "vite build" exited with 127
```

Only that half is loud. The other half is that a *successful* remote build would
have served bytes from a build nobody verified, under the URL `verify:published`
then checks. `vercel deploy --prebuilt` uploads `.vercel/output` as-is and the
host builds nothing, so the published bytes are the verified bytes.

**`scripts/lib/vercel-prebuilt.mjs`** + **`scripts/prepare-vercel-output.mjs`**
(`npm run frontend:prebuilt`) do the assembly: they copy the artifact that passed
the contract into `.vercel/output/static`, write `.vercel/output/config.json`
(version 3) with routing derived from `vercel.json`, and then **prove** the
output is byte-identical to that artifact and records the expected commit/branch.
A `vercel.json` key the converter cannot carry over (redirects, headers,
cleanUrls, …) is a refusal, not a silent change of runtime behaviour.

`vercel.json`'s SPA rewrite is preserved with the same ordering the host applies
to it — the filesystem phase runs first, so `/assets/*` is served and unknown
paths fall back to `/index.html`:

```json
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/index.html" } ] }
```

`vercel build` is deliberately **not** used: it runs the project's build command
locally (a second `vite build`) and would replace the verified directory with a
fresh one, which is exactly the "derived from the same verified build" invariant
this step must not break.

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

## 2b. The three identifiers, and where they come from (Phase 300 continuation)

A publication needs three values. None of them is guessed, and none is a secret:

| Value | What it is | Where it comes from | Safe as a GitHub Environment VARIABLE? |
| --- | --- | --- | --- |
| `VERCEL_ORG_ID` | the account/team that owns the host project | `GET /v2/user` (id) or `GET /v2/teams` (team id), read with the token | **Yes** — an identifier, it authorises nothing on its own |
| `VERCEL_PROJECT_ID` | the project that serves the site | the project object that **links this repository** (`link.repo`), else the one project whose name is `trade-intel-bot`; several or none means the run stops and lists candidates | **Yes** — same reason |
| `FRONTEND_HOST_URL` | the https origin a browser opens | the project's own verified custom domain, else its production alias — never composed by hand | **Yes** — it is public by definition |

```bash
# Reads all three from the account the token authorises, and prints the evidence:
VERCEL_TOKEN=... npm run frontend:resolve
VERCEL_TOKEN=... npm run frontend:resolve -- --json

# Pin the results (identifiers only, never the token) in the `development`
# environment, or leave them unset — the workflow resolves them itself.
```

**Identity before evidence (Phase 300 fix).** A project can be returned by more
than one listing — the personal scope *and* a team scope. Those records are
collapsed to **one candidate** by the host's own `project.id`, because otherwise
one project seen twice looked like two projects sharing a name and the resolver
refused a publication it should have allowed. The merge is deliberately narrow:

- different ids are always different projects — two projects with the same name,
  or two linking the same repository, remain **ambiguous and refused**;
- a record with no `id` cannot be proven identical to anything, so it is never
  merged (an absent identity is not a shared identity);
- matches are still ranked with the Git link **stronger** than the name.

**Which scope becomes `VERCEL_ORG_ID`:** the project record's own `accountId`
when the API returns it (the host stating the owner); otherwise the single team
scope that listed it, else the personal scope. Two team scopes and no
`accountId` → `ORG_NOT_DETERMINABLE`, rather than a coin flip.

The resolver is **read-only** (`GET` only): it never creates, links, deploys or
renames anything. With no token it prints `NO_CREDENTIAL` and resolves nothing;
if the API cannot be reached it prints `API_UNREACHABLE`. Both exit `2`, because
"could not evaluate" is not a result about any site.

---

## 2c. One command that publishes and proves it (no dispatcher needed)

GitHub only offers a `workflow_dispatch` workflow once its **file exists on the
default branch**. This repository's default branch is `main`, which does not
carry `.github/workflows/publish-development-frontend.yml`, so until that file
reaches the default branch the workflow cannot be started from the Actions UI.
The same publication is therefore available as one command, run wherever the
token lives:

```bash
VERCEL_TOKEN=... npm run frontend:publish -- --host-url https://<dev-host>
VERCEL_TOKEN=... npm run frontend:publish -- --target production   # only if the host is the project's production domain
VERCEL_TOKEN=... npm run frontend:publish -- --skip-build          # reuse an existing dist/
```

It refuses unless the checkout is the pinned branch and the tree is clean, builds,
runs `verify:frontend`, fingerprints the artifact it just verified, resolves or
validates the host target, assembles that **same artifact** into
`.vercel/output` (Build Output API) and proves it is byte-identical, uploads it
with `vercel deploy --prebuilt` (the host runs no build), points the
browser-facing host at the deployment, and finishes by fetching the public URL
with `--expect-build-info-sha256` and `--expect-asset-names`. A failure in that
last step fails the command.

The GitHub workflow runs the same preparation as a named step
(`npm run frontend:prebuilt`), so the runner and the one-command path assemble the
identical bytes. Both leave `.vercel/` behind locally; it is ignored by git
(Phase 300 note in `.gitignore`).

The token is read from the environment only — never from `argv`, which is
visible in a process listing — and never printed. The default deploy target is
`preview` aliased to the host, so a project's production deployment can only be
replaced deliberately.

---

## 3. One-time setup (operator) — required before a real publication can happen

The publication path is complete and tested, but it is **credential-gated**: with
no credential the run fails with `HOST_CREDENTIAL_ABSENT` instead of skipping the
upload. Configure, in the GitHub **`development`** environment:

| Kind | Name | What it is | Required? |
| --- | --- | --- | --- |
| secret | `VERCEL_TOKEN` | a token scoped to the **existing** project that serves the development site | **Yes** for `publish`; not needed for `verify-only` |
| variable | `VERCEL_ORG_ID` | the team/user that owns that project | optional — resolved from the token when unset (see §2b) |
| variable | `VERCEL_PROJECT_ID` | that project's id (nothing here creates a project) | optional — resolved from the token when unset |
| variable | `FRONTEND_HOST_URL` | the browser-facing https origin, e.g. `https://<dev-host>` | optional for `publish`; **required** for `verify-only` |
| variable | `VITE_CONVEX_URL` | already set for the development deploy; baked into the build | yes for `publish` |

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
