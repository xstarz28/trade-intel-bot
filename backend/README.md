# Trade Intel self-hosted backend foundation

This backend uses the Node.js standard library and SQLite. It has no runtime npm dependencies and does not call Convex, a managed database, or another paid backend service.

## Current scope

- Node.js HTTP server;
- built-in SQLite persistence using `node:sqlite`;
- WAL mode, foreign-key enforcement, and a bounded busy timeout;
- checksummed, transactional SQL migrations;
- liveness and database-readiness endpoints;
- graceful shutdown;
- Docker Compose with a persistent named data volume;
- automated tests using Node's built-in test runner.

This is the first infrastructure slice, not the completed Convex replacement. Domain routes, authentication, authorization, the complete application schema, data export/import, and frontend integration are not implemented yet. The existing production app remains unchanged.

## Requirements

- Node.js 22.13+ (uses the built-in `node:sqlite` module);
- Docker Engine + Docker Compose for containerized local operation (optional).

## Run without Docker

From the repository root:

```sh
node backend/server.mjs
```

The service binds to `127.0.0.1:8787` by default and stores its database at `backend/data/trade-intel.sqlite`.

Run tests:

```sh
node --test backend/test/*.test.mjs
node --check backend/server.mjs
node --check backend/src/app.mjs
node --check backend/src/database.mjs
```

## Run with Docker Compose

From this directory:

```sh
docker compose up --build -d
```

The database file is stored in the persistent `trade_intel_data` volume. The published port is bound to localhost by default; do not expose the service publicly until authentication, authorization, request limits, and TLS/reverse-proxy configuration are implemented.

Endpoints:
- liveness: http://127.0.0.1:8787/health/live
- readiness: http://127.0.0.1:8787/health/ready

## Storage decision

SQLite is intentional for the first self-hosted deployment: the current product is on-demand instrument analysis rather than a high-write global scanner. It removes the need to operate a separate database server and keeps the data in a portable file with standard backup tooling.

The data-access boundary must remain replaceable. If measured concurrent-write or multi-node requirements outgrow SQLite, PostgreSQL can be introduced as another self-hosted adapter—not as a mandatory managed SaaS purchase.

## Production safety

The API currently exposes health endpoints only. It is not yet a public production backend. Do not use it as a replacement for Convex until domain migrations, secure sessions, per-user authorization, backups/restore rehearsal, parity tests, and a verified data import have passed.
