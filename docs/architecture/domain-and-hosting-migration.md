# Domain and hosting migration

## Target

- Public frontend: `https://xstarzganaliys.com`
- Static frontend hosting: GitHub Pages (no Vercel runtime dependency).
- Backend: self-hosted Node.js service with local persistent database; a separate API hostname such as `api.xstarzganaliys.com` is reserved for the later backend cutover.
- Source and CI: GitHub repository and GitHub Actions.

The exact apex domain above is copied from the user's instruction. Confirm its spelling and ownership before changing registrar DNS.

## What this change prepares

- `public/CNAME` declares the intended GitHub Pages custom domain.
- `.github/workflows/github-pages-deploy.yml` builds the existing Vite frontend, creates a `404.html` fallback for React Router deep links, uploads the static artifact, and deploys it from GitHub Actions.
- Pull requests build and validate the Pages artifact without publishing it.
- The deploy job only publishes from `main` or an explicit workflow dispatch.

## DNS required at the domain registrar

After GitHub Pages is enabled for this repository, point the apex domain to GitHub Pages using the four A records published in GitHub's current documentation:

- `185.199.108.153`
- `185.199.109.153`
- `185.199.110.153`
- `185.199.111.153`

Optional IPv6 AAAA records may be added from GitHub's current documentation. Do not delete existing MX, TXT, or other records needed for email or domain verification.

If using `www`, add a CNAME record from `www` to `xstarz28.github.io` and configure the redirect in Pages. The apex domain remains the canonical target in this first pass.

DNS changes are not made by this repository workflow. They require access to the registrar/DNS account and should only be made after the Pages deployment is ready.

## Cutover safety

This is only the static frontend hosting lane. It does not yet replace Convex, provide the public API, or complete production cutover.

Keep the existing Vercel deployment available as a rollback until all of the following pass:

1. GitHub Pages serves the exact intended frontend build on the custom domain with HTTPS.
2. The independent backend has authentication, per-user authorization, data migrations, backups, and feature parity.
3. The frontend has been switched from Convex to the independent API.
4. Analysis, journal, positions, alerts, notifications, history, and OAuth/session flows pass end-to-end tests.
5. Existing Convex data has been exported, imported, and verified without deleting the source.

Only then remove the Vercel deployment workflows, Vercel-specific configuration, and Convex deployment workflow/secrets from the active production path. No production services or data are removed by this preparation change.
