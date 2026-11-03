# Trade Intel self-hosted backend foundation

This directory starts an independently runnable TypeScript API backed by self-hosted PostgreSQL. It does not call Convex or any managed database service.

## Current scope

This is the first infrastructure slice, not the completed Convex replacement:
- Node.js + Hono HTTP server;
- PostgreSQL connection pool;
- separate liveness and database-readiness endpoints;
- graceful shutdown;
- isolated tests for health behavior;
- Docker Compose for a persistent local PostgreSQL volume.

No existing frontend routes, Convex functions, auth flows, schemas, or production deployment have been changed. No user data is migrated yet.

## Run locally

Requirements: Node.js 22+, npm, and Docker Compose.

```sh
cp .env.example .env
# Set POSTGRES_PASSWORD to a long random value in .env
npm install
npm test
npm run build
docker compose up --build -d
```

The API binds to localhost by default through Compose:
- liveness: http://127.0.0.1:8787/health/live
- readiness: http://127.0.0.1:8787/health/ready

The PostgreSQL data directory is stored in the named Docker volume `trade_intel_postgres`, not in the container's writable layer.

## Security and production status

The API currently exposes health endpoints only. Do not expose it to the public internet yet. Authentication, authorization, migrations, backups, rate limiting, CORS policy, and domain feature routes must be implemented and tested before public deployment.

Do not use this foundation as a replacement for the existing Convex production deployment yet. The old system remains the source of truth until a verified export/import and feature-parity cutover is complete.
