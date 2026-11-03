# Trade Intel self-hosted backend

This backend uses Node.js built-in modules and SQLite. It does not call Convex, a managed database, or another paid backend service.

## Implemented foundation

- Node.js HTTP server with liveness and database-readiness endpoints;
- built-in SQLite persistence using `node:sqlite`, WAL mode, foreign-key enforcement, and a bounded busy timeout;
- checksummed, transactional SQL migrations;
- core Trade Intel persistence tables for users, sessions, analyses, fundamentals, SEC filings, journal, monitored positions, alert history, stream cursors, historical intelligence, alert rules, notifications, preferences, and runtime health;
- opaque random session tokens stored only as SHA-256 hashes;
- HTTP-only session cookies, origin checks for authentication mutations, anonymous sign-in, sign-out, and session inspection;
- Google OAuth authorization-code flow with state, nonce, PKCE, and server-side RS256 ID-token signature/claim validation;
- user-scoped analysis history endpoints with schema validation and bounded 100-record retention;
- user-scoped journal create/list/get/update/delete endpoints with the existing lifecycle transition rules;
- Docker Compose with a persistent named SQLite data volume;
- automated tests using Node's built-in test runner.

## Still not a complete Convex replacement

The frontend still uses Convex. Positions, alert history/rules, notifications/preferences, stream cursors, historical intelligence, runtime-health routes, and fundamental/SEC observation repositories are not yet wired. Existing Convex data export/import, Google OAuth credential cutover, frontend adapter replacement, end-to-end parity tests, and production deployment remain outstanding. Do not switch the production frontend yet.

## Requirements

- Node.js 22.13+ (uses the built-in `node:sqlite` module);
- Docker Engine + Docker Compose for containerized local operation (optional).

## Run without Docker

From the repository root:

```sh
node backend/server.mjs
```

The service binds to `127.0.0.1:8787` by default and stores its database at `backend/data/trade-intel.sqlite`.

Run tests and syntax checks:

```sh
node --test backend/test/*.test.mjs
npm --prefix backend run check
```

## Run with Docker Compose

From this directory:

```sh
cp .env.example .env
docker compose up --build -d
```

Set `APP_ORIGIN` to the exact frontend origin. For the eventual public domain this will be `https://xstarzganaliys.com`. Set `PUBLIC_BASE_URL` to the public API origin, planned as `https://api.xstarzganaliys.com`.

Google OAuth remains disabled until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured and the exact callback URL `/api/v1/auth/google/callback` is registered in the Google OAuth client. No credentials belong in this repository.

The database file is stored in the persistent `trade_intel_data` volume. The published port is bound to localhost by default. Do not expose the service publicly until rate limiting, reverse-proxy TLS, backup/restore, and full feature routes are implemented.

Endpoints:
- liveness: http://127.0.0.1:8787/health/live
- readiness: http://127.0.0.1:8787/health/ready
- session: GET http://127.0.0.1:8787/api/v1/auth/session
- anonymous sign-in: POST http://127.0.0.1:8787/api/v1/auth/anonymous
- sign-out: POST http://127.0.0.1:8787/api/v1/auth/logout
- Google sign-in start: GET http://127.0.0.1:8787/api/v1/auth/google
- analysis history: GET/POST/DELETE http://127.0.0.1:8787/api/v1/analyses
- journal: GET/POST http://127.0.0.1:8787/api/v1/journal
- journal entry: GET/PATCH/DELETE http://127.0.0.1:8787/api/v1/journal/{id}
- journal lifecycle: PATCH http://127.0.0.1:8787/api/v1/journal/{id}/transition

## Storage decision

SQLite is intentional for the first single-node, on-demand workload. It removes the need to operate a separate database server and keeps application data in a portable file with standard backup tooling. If measured concurrent-write or multi-node requirements outgrow SQLite, PostgreSQL can be self-hosted later behind the same repository boundary.

## Production safety

The API currently implements health and authentication endpoints only. It is not yet a public production backend. Do not use it as a replacement for Convex until all domain routes, authorization checks, backup/restore rehearsal, data export/import, parity tests, and frontend integration have passed.
