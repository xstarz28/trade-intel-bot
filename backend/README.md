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

The self-hosted backend is now the normal application runtime and authentication source. Browser login, guest accounts, Google OAuth, session restoration and logout use backend-owned sessions. Dashboard market analysis, exact OKX perpetual/dated-futures OHLCV, Alpha Vantage stock intelligence, CoinGlass/public derivatives, Tokenomist/PatternPlus/CoinGecko tokenomics fallbacks, DeFiLlama fundamentals, economic calendar, COT/EIA/Treasury, FX reference, OKX order-book/specification/open-interest, protection OHLCV, historical timelines, alert rules, notifications and runtime health are routed through authenticated backend APIs. Dashboard, Journal and position-protection consumers no longer mount the Convex provider. The only remaining active Convex UI path is the explicitly optional legacy account-export panel, shown only when a valid old Convex deployment is configured. The source tree and packages remain until the legacy account export/import is verified and the repository-wide dependency cleanup is complete. The migration is not a production cutover: no live account export/import reconciliation, DNS/TLS activation or production acceptance has been performed. Do not delete the old Convex data before reconciliation.

The market-data lane supports public OKX Spot candles/ticker, exact OKX perpetual and dated-futures candles, and exact Yahoo Finance mappings for supported stocks, forex, commodities, and indices. Unsupported contracts or unmapped symbols fail closed; no spot/proxy substitution is allowed. Provider source and freshness remain explicit.

## Provider environment variables

All provider credentials are optional unless a feature specifically requires them. Keep them in `backend/.env`, never in frontend variables or source control:

- `ALPHA_VANTAGE_API_KEY`: stock news, sentiment, overview and earnings;
- `COINGLASS_API_KEY`: paid aggregated crypto derivatives; public exchange adapters are the fallback;
- `TOKENOMIST_API_KEY`: verified token unlock calendar; PatternPlus/CoinGecko fallbacks remain available;
- `TICKATLAS_API_KEY`: economic calendar;
- `EIA_API_KEY`: EIA inventory data; public FRED series are used when absent;
- `SEC_USER_AGENT`: identifying SEC EDGAR application name and monitored contact email.

## Automated self-hosted production deployment

The repository includes `.github/workflows/self-hosted-deploy.yml`. It is manual-only, requires the exact confirmation phrase `DEPLOY_SELF_HOSTED`, uploads the selected source revision over pinned SSH, creates a SQLite backup before replacing an existing release, deploys with a stable Docker Compose project name, and rolls back the release symlink if the backend health check fails.

Configure the GitHub `production` environment with these secrets:

- `SELF_HOSTED_SSH_HOST`: public IPv4/hostname of the Linux host;
- `SELF_HOSTED_SSH_USER`: dedicated deploy user with Docker Compose permissions;
- `SELF_HOSTED_SSH_PRIVATE_KEY`: private key for that deploy user;
- `SELF_HOSTED_SSH_KNOWN_HOSTS`: verified host-key line(s), checked out-of-band and pinned (the workflow does not trust an unverified `ssh-keyscan` result).

Optional environment variables:

- `SELF_HOSTED_SSH_PORT`: SSH port, default `22`;
- `SELF_HOSTED_APP_DIR`: absolute release directory, default `/opt/trade-intel`.

One-time host preparation:

1. Install Docker Engine and the Docker Compose plugin.
2. Create the deploy user, grant Docker permissions, and create `/opt/trade-intel/shared` owned by that user.
3. Create `/opt/trade-intel/shared/backend.env` with the production values from `backend/.env.example`; restrict it to mode `0600`. Do not commit this file.
4. Point `xstarzganaliys.com` to the host and allow inbound TCP ports 80 and 443.
5. Dispatch the workflow with the intended commit and the confirmation phrase.

The deploy workflow cannot provision a host, create DNS records, or manufacture SSH credentials. It will refuse to run if the required production secrets or host-side environment file are absent. A successful CI build is not evidence that public DNS/TLS or production deployment is live.

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
docker compose -p trade-intel up --build -d
```

The Node service listens only inside the Docker network. Caddy obtains and renews the HTTPS certificate and forwards requests to the application. The same hostname serves both the frontend and `/api/v1/*`; no separate API subdomain or cross-origin cookie configuration is needed.

Google OAuth remains disabled until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured and the exact callback URL `https://xstarzganaliys.com/api/v1/auth/google/callback` is registered in the Google OAuth client. Credentials must be supplied through the host's environment file, never committed to Git.

## Local development

Requirements: Node.js 22.13+.

From the repository root:

```sh
npm ci --legacy-peer-deps
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

The Dashboard's **Migrasi ke backend mandiri** panel is an optional one-time data-transfer tool: it invokes the authenticated legacy Convex export query and posts the snapshot to this importer under the active backend account. Before using it, ensure the read-only Convex export function is deployed and backend Google OAuth is configured. This panel does not route normal application login, analysis, journal, position protection, alerts, or notifications through Convex. After account reconciliation is complete, the legacy panel and Convex packages can be retired.
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
