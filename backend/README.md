# Trade Intel self-hosted application

This deployment runs the Vite frontend, Node.js API, and SQLite database on infrastructure we control. It does not require Convex, Vercel, a managed database, or a paid backend SDK.

## Implemented self-hosted runtime

- Node.js HTTP server serves both the built frontend and API from one origin;
- Caddy reverse proxy provides automatic HTTPS and serves as the only public network entry point;
- built-in SQLite persistence with WAL mode, foreign keys, and checksummed transactional migrations;
- SQL tables for users/sessions, analyses, fundamentals, SEC filings, journal, positions, alerts, stream cursors, historical intelligence, notifications, preferences, and runtime health;
- anonymous sessions, HTTP-only cookies, logout, origin validation, sign-in/market-analysis rate limits, and Google OAuth with PKCE/state/nonce plus server-side Google JWKS signature and claim verification;
- user-scoped analysis history and journal CRUD/lifecycle routes;
- position-owned historical snapshots/events with deterministic event deduplication and bounded retention;
- user-scoped runtime-health snapshots with timestamp deduplication and bounded history;
- in-memory rate limits for anonymous/Google sign-in attempts and per-user market-analysis requests;
- monitored-position persistence, bounded position-alert history/acknowledgement, stream cursors, custom alert rules/history, deduplicated notifications, read/dismiss lifecycle, and notification preferences;
- authenticated on-demand OHLCV retrieval for mapped instruments through public OKX Spot and Yahoo Finance sources, reusing the existing technical-indicator, SMC, MTF, freshness, and cross-asset modules;
- optional Alpha Vantage stock news/sentiment, news-derived macro context, overview and earnings integration through the existing shared normalizers (disabled unless `ALPHA_VANTAGE_API_KEY` is configured);
- consistent SQLite snapshot backup command.

## Important migration status

This backend is an active migration target, not yet a complete Convex replacement. Browser login, session restoration, guest account creation, Google OAuth, and logout now use the self-hosted API; the `/auth` route and route guard no longer depend on Convex Auth and are mounted outside the legacy Convex provider. Dashboard analysis history, COT/EIA/Treasury provider legs, and primary market data for spot crypto, forex, stocks, commodities, and indices now use this API. Legacy Convex calls remain for exact-contract derivative OHLCV, Alpha Vantage fallback, economic calendar, CoinGlass/DeFiLlama intelligence, FX conversion, OKX execution/specification, and position-protection historical intelligence/alert-rule surfaces, so the full application is not yet independent of Convex. An authenticated SEC EDGAR filing-history refresh/read API persists filing-matched observations in SQLite, and the self-hosted stock-analysis route passes the latest persisted SEC earnings/revenue evidence into the existing shared decision engine. When `ALPHA_VANTAGE_API_KEY` is configured, the stock-analysis route also uses the shared Alpha Vantage normalizers for stock news/sentiment, news-derived macro context, company overview, and earnings. A user-scoped Convex export query and a backend importer for that native export format are now present; the remaining migration gate is end-to-end execution against the live Convex account and verification of imported row counts/ownership. This is not yet frontend parity or production cutover. Broader asset-class news/macro coverage, COT, EIA, Treasury, economic-calendar, crypto-derivatives provider parity, and end-to-end frontend parity tests remain outstanding. Do not disable the existing production deployment or delete Convex data before those gates pass.

The market-data lane currently supports public OKX Spot candles/ticker for spot crypto and exact Yahoo Finance mappings for supported stocks, forex, commodities, and indices. It does not silently replace unsupported derivative contracts or unmapped symbols with a proxy. Perpetual/futures data, full Twelve Data credential support, and other provider-specific actions remain to be extracted.

## Requirements

- Docker Engine + Docker Compose;
- a host that can remain online and accept inbound TCP ports 80 and 443 (UDP 443 is optional for HTTP/3);
- control of DNS records for the chosen domain.

No managed cloud database or application-hosting subscription is required. Public availability still requires a machine, electricity, network connectivity, and DNS.

## Deploy on a host

1. Copy `backend/.env.example` to `backend/.env`.
2. Confirm the domain spelling and set `DOMAIN`, `APP_ORIGIN`, and `PUBLIC_BASE_URL` to the exact registered hostname. The current requested target is `xstarzganaliys.com`.
3. Point the domain's A record to the host's public IPv4 address. If using IPv6, add the correct AAAA record. Do not change mail-related MX/TXT records.
4. Allow inbound TCP 80 and 443 (and optionally UDP 443) through the host firewall/router.
5. From `backend/`, run:

```sh
docker compose up --build -d
```

The Node service listens only inside the Docker network. Caddy obtains and renews the HTTPS certificate and forwards requests to the application. The same hostname serves both the frontend and `/api/v1/*`; no separate API subdomain or cross-origin cookie configuration is needed.

Google OAuth remains disabled until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured and the exact callback URL `https://xstarzganaliys.com/api/v1/auth/google/callback` is registered in the Google OAuth client. Credentials must be supplied through the host's environment file, never committed to Git.

## Local development

Requirements: Node.js 22.13+.

From the repository root:

```sh
npm install --legacy-peer-deps
npm run build
npm run backend:build
node backend/server.mjs
```

Set `APP_ORIGIN=http://localhost:8787` and `PUBLIC_BASE_URL=http://localhost:8787` when testing same-origin auth locally. The service serves the frontend from `dist/` and listens on `127.0.0.1:8787` by default.

Run automated checks:

```sh
npx tsc -p backend/tsconfig.market.json --noEmit
node --test backend/test/*.test.mjs
npm --prefix backend run check
```

## Backup

Create a consistent SQLite snapshot inside the running container:

```sh
docker compose exec -T api node backend/backup.mjs /tmp/trade-intel-backup.sqlite
mkdir -p backups
docker cp "$(docker compose ps -q api):/tmp/trade-intel-backup.sqlite" ./backups/trade-intel-$(date +%F-%H%M%S).sqlite
```

Store backups outside the host and periodically test restoring one. The live database is stored in the persistent `trade_intel_data` Docker volume.

## API endpoints currently implemented

- `GET /health/live`, `GET /health/ready`
- `GET /api/v1/auth/session`, `POST /api/v1/auth/anonymous`, `POST /api/v1/auth/logout`
- `GET /api/v1/auth/google` and `GET /api/v1/auth/google/callback`
- `GET /api/v1/account/export` (authenticated, user-scoped JSON export; excludes sessions/OAuth secrets and global provider observations)
- `POST /api/v1/account/import` (authenticated restore from a versioned self-hosted export or native Convex export; ownership is reassigned to the active backend account, with duplicate rows skipped). Native Convex exports must come from the authenticated `accountMigration:exportMyAccount` query and must match the backend account email; email-less guest exports require explicit source-account ID confirmation.

The Dashboard's **Migrasi ke backend mandiri** panel starts the backend Google session, invokes the authenticated Convex export query, and posts the resulting snapshot to this importer. Before using it in production, deploy the read-only Convex export function and configure backend Google OAuth. The transfer does not switch the remaining frontend features away from Convex.
- `GET/POST/DELETE /api/v1/analyses`
- `GET/POST /api/v1/journal`, `GET/PATCH/DELETE /api/v1/journal/{id}`, `PATCH /api/v1/journal/{id}/transition`
- `GET/POST /api/v1/positions`, `GET/DELETE /api/v1/positions/{positionId}`
- `GET/POST /api/v1/positions/{positionId}/alerts`, `POST /api/v1/alerts/{alertId}/acknowledge`
- `GET/PUT /api/v1/stream-cursors`
- `GET/POST /api/v1/alert-rules`, `PATCH/DELETE /api/v1/alert-rules/{ruleId}`
- `GET/POST/DELETE /api/v1/alert-rules/history`
- `GET/POST /api/v1/notifications`, unread/read/dismiss endpoints, and `GET/PUT/DELETE /api/v1/notification-preferences`
- `POST /api/v1/market-data/analyze`
- `GET /api/v1/fundamentals/sec/{ticker}`, `POST /api/v1/fundamentals/sec/{ticker}` (SEC refresh requires a compliant `SEC_USER_AGENT`)
- `POST /api/v1/history/snapshots`, `POST /api/v1/history/events`, `GET /api/v1/history/timeline`, `DELETE /api/v1/history/positions/{positionId}`, `POST /api/v1/history/prune`
- `GET /api/v1/runtime-health/latest`, `GET /api/v1/runtime-health/history`, `POST /api/v1/runtime-health`

The production image builds the frontend and shared market-data engine at image-build time. The runtime image does not install the frontend's npm dependency tree.
