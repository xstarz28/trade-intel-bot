# XSTARZG

XSTARZG is a multi-market trading intelligence platform for structured analysis across crypto, forex, stocks, commodities, and other liquid instruments.

## What it does

- Multi-provider market discovery across exchanges, DEXs, indices, and market-data providers.
- Live-evidence tracking with source identity and freshness controls.
- Cross-provider opportunity aggregation and instrument ranking.
- BTC and XAU analysis with resilient provider fallbacks.
- Dashboard recommendations gated by evidence quality and market eligibility.
- Tokenomics and supply intelligence with graceful degradation when optional providers are unavailable.
- Google authentication plus guest access.
- Risk-aware analysis with confidence and invalidation context.
- No automatic real-money order execution.

## Architecture

- React 19 + TypeScript
- Vite
- React Router
- Tailwind CSS
- Self-hosted Node.js API + SQLite persistence
- Backend-owned sessions and Google OAuth
- Docker Compose + Caddy HTTPS reverse proxy
- Optional legacy Convex account export only
- Framer Motion
- Vitest

The production target is a single-origin self-hosted Docker/Caddy deployment at `https://xstarzganaliys.com`. The Node.js service serves the frontend and API; SQLite stores application data. GitHub Actions provides CI and a guarded SSH deployment workflow. Vercel is not part of the target runtime.

## Local development

Install the locked dependencies:

```bash
npm ci --legacy-peer-deps
```

Build the frontend and shared backend engine:

```bash
npm run build
npm run backend:build
```

For a local full-stack run, set the same-origin development URLs and start the self-hosted Node service:

```bash
NODE_ENV=development APP_ORIGIN=http://localhost:8787 PUBLIC_BASE_URL=http://localhost:8787 node backend/server.mjs
```

Open http://localhost:8787. Guest login works without Google credentials. Run the automated tests with:

```bash
npm test
```

## Production

The self-hosted deployment workflow is manual and requires a prepared Linux host, pinned SSH credentials, a protected GitHub `production` environment, and a host-side `backend.env`. The requested domain is `xstarzganaliys.com`. No production DNS/TLS cutover is claimed until the host and domain are configured and the public health checks pass.

Normal login, session restoration, market analysis, journal, position protection, alerts, notifications, and persistence use the self-hosted backend. Convex is isolated to the optional one-time legacy account-export panel; disabling Convex does not disable application login or normal runtime features.

Sensitive provider credentials and deployment credentials are supplied through host/GitHub environment secrets; they are not committed to the repository.

## Data integrity

XSTARZG is designed not to invent market prices or represent stale evidence as live data. Provider failures are isolated where possible so one unavailable source does not unnecessarily disable the broader intelligence layer.

Trading analysis is informational and does not execute trades automatically. Users remain responsible for their own decisions and risk management.
