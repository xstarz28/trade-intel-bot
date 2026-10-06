# Phase 321 — Convex Development Escape / Local Backend Continuity

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Base: phase 320 tip `12123cf`.
Development-only quota isolation. No provider logic, schema, product UI or production configuration changed.

## Why

The Convex Cloud **Free deployment is disabled** whenever the monthly limits bind (observed for real
in Phase 320: write refusals on the deployment). Development, Arena test workflows and the acceptance
harness must not depend on that quota. The officially supported escape is **Convex Local
Deployment**: a real Convex backend binary run on the developer machine, selected by the convex CLI
through its first-class **self-hosted deployment-selection** variables (`CONVEX_SELF_HOSTED_URL` +
`CONVEX_SELF_HOSTED_ADMIN_KEY`) — no cloud login, no cloud quota, no project registration.

## The local workflow (exact)

```bash
npm run convex:backend:local        # download (pinned) + start local backend + write .env.local-backend
npm run convex:push:local           # one-shot push of THIS REPO's schema+functions to the local backend
                                    #   = `convex dev --env-file .env.local-backend --once --typecheck=disable`
npm run convex:backend:local:status # is it running?
npm run convex:backend:local:stop   # stop
node scripts/dev/local-backend.mjs clean   # wipe local storage (fresh DB)
```

- `scripts/dev/local-backend.mjs` pins the backend to a **GitHub release tag**
  (`get-convex/convex-backend` `precompiled-2026-09-28-5c7cb5b`) — deliberately NOT resolved through
  `version.convex.dev`, so the flow has exactly one network dependency (github release assets).
- The instance secret is generated per data directory; the admin key is derived by the backend's own
  `keygen admin-key`. Both are local-only values for a local-only database and are never printed —
  they live in `.env.local-backend` (gitignored), storage in `.convex-local/` (gitignored).
- The push step exercises the REAL schema and functions (Convex validates the schema on push) —
  zero cloud calls.

## Local vs production selection (explicit, never implicit)

| Surface | Convex target | Mechanism | Changed in 321? |
|---|---|---|---|
| Vercel production build | **Convex Cloud (unchanged)** | `VITE_CONVEX_URL` baked at build time from the hosting env | **NO** |
| CI deploy / auth-verify / smoke | **Convex Cloud dev deployment (unchanged)** | `CONVEX_DEPLOY_KEY` secret in the workflows | **NO** |
| Local development / local integration | **Local backend** | `.env.local-backend` via `--env-file` (opt-in only) | **ADDED** |
| `npm test` (vitest) | **no deployment at all** | the suite is deterministic/unit + artifact-level; no cloud URL or client in any test config | verified unchanged |

There is no "always local" default anywhere: every cloud path keeps its existing configuration, and
local only engages when the developer passes the env file explicitly.

## Validation results

| Check | Result |
|---|---|
| `node --check scripts/dev/local-backend.mjs` | OK |
| `npm run convex:backend:local:status` (offline path) | OK — reports port/binary/env-file state |
| artifact suite `convex-local-development.phase321.test.ts` | 7/7 PASS (pinned version, explicit selection, no cloud coupling in code, gitignore, test-script purity, production untouched) |
| full local startup + push in THIS sandbox | **NOT EXECUTABLE — external network block**: `version.convex.dev` and `release-assets.githubusercontent.com` are TLS-intercepted in the Arena sandbox (recorded live), and the backend binary is not an npm package. The workflow is designed for a dev machine / CI where those hosts are reachable; the runner states the exact missing dependency when the download fails. |
| `tsc -b` / full vitest / build | run at commit time (see RUN-321) |

## Production safety proof (§8)

- `git diff` for this phase touches ONLY: `scripts/dev/local-backend.mjs` (new),
  `src/lib/deployment/convex-local-development.phase321.test.ts` (new), `package.json`
  (4 additive scripts; `dev`/`test`/`build` untouched), `.gitignore` (2 additive lines), and docs.
- No production environment variable read, replaced or removed; no production data touched; no
  cloud deployment selected anywhere in new code (suite-pinned).
- Vercel production remains cloud-backed (`VITE_CONVEX_URL` flow untouched); CI keeps
  `CONVEX_DEPLOY_KEY` flows untouched.
- Phase 319/320 resource intent intact: the local path adds zero cloud calls; nothing writes the
  cloud dev deployment.

## Limitations that genuinely remain

1. The Arena sandbox cannot download or run the local backend binary (blocked hosts above) — full
   local validation (`start` → `convex:push:local` → integration) must run on a dev machine or CI.
2. The local backend starts EMPTY: for representative local integration work, seed data or mocks are
   the developer's choice (out of scope for 321).
3. The Convex Cloud Free deployment remains quota-bound until the owner resolves usage/plan
   (Phase 320's retention work + this isolation reduce future pressure but do not lift a disabled
   deployment).
