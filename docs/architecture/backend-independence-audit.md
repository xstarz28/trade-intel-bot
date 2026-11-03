# Backend Independence Audit — Trade Intel Bot

**Status:** initial source audit; no production code has been switched or removed.  
**Base revision audited:** `230aece22581d73a8a353a4d9b1cf68e2e1590a3`  
**Working branch:** `architecture/self-hosted-backend-foundation`

## Objective

Make Trade Intel Bot operable without a mandatory Convex dependency while preserving the existing React application, analysis engine, market-data adapters, trading journal, position protection, alerts, notifications, and historical records.

This is an incremental extraction, not a rewrite. Convex remains untouched until the replacement has parity tests and a verified data migration.

## Confirmed source findings

### 1. Convex is a runtime dependency, not just a database

- `package.json` includes `convex` and `@convex-dev/auth`.
- `convex.json` points the Convex function directory at `src/convex/`.
- `src/main.tsx` wraps the application in `AppAuthProvider` from `src/lib/convex-provider.tsx`.
- `src/lib/convex-provider.tsx` constructs the real Convex client from `VITE_CONVEX_URL`, selects real Convex or a mock mode, and implements a local mock client.
- `src/lib/auth-provider-mode.ts` hardcodes the active production Convex origin (`https://hushed-seal-237.convex.cloud`), so the deployment identity is coupled to frontend source code as well as environment configuration.
- `src/hooks/use-auth.ts` uses `useConvexAuth`, `useQuery`, and `useAuthActions`; it directly depends on Convex Auth semantics.
- `src/convex/auth.ts` configures Google and anonymous providers through `@convex-dev/auth`.
- `src/convex/http.ts` registers Convex Auth HTTP routes.
- `src/convex/users.ts` resolves the authenticated user using `getAuthUserId`.

**Implication:** changing a database URL or adding a second database will not remove the dependency. The frontend auth provider, query/mutation/action call sites, server functions, generated references, and identity model must be migrated as one controlled boundary.

### 2. Existing mock mode is not a production backend

The mock client in `src/lib/convex-provider.tsx` stores a limited subset of data in browser `localStorage`. It returns hard-coded/default values for several query paths and has a small set of mock mutations/actions.

The mock sign-in implementation also manufactures a local user object for both the `google` and `anonymous` labels; it does not perform Google OAuth or verify a provider identity. The mode resolver selects mock mode only when no Convex client exists in development; production without a valid Convex client is explicitly misconfigured.

It is useful as a development fallback, but it is not a substitute for:
- durable shared persistence across devices;
- real Google identity verification;
- server-side authorization and per-user data isolation;
- complete CRUD coverage for the application's existing features;
- reliable concurrent writes, backups, and recovery.

Do not label mock mode as production-ready or silently fall back to it when a real backend fails.

### 3. Confirmed persisted domain areas

The inspected `src/convex/schema.ts` defines or includes these data areas:

- Convex Auth tables and users;
- analyses;
- fundamental observations;
- SEC EDGAR observations;
- journal;
- monitored positions;
- alert history;
- stream cursors;
- historical snapshots;
- alert rules and rule alert history;
- notifications and notification preferences;
- historical events;
- legacy market-radar state, sources, and candidates;
- runtime health snapshots.

The schema contains user ownership references and indexes. A replacement must preserve ownership boundaries, uniqueness/deduplication behavior, ordering, retention limits, and lifecycle transitions—not merely create similarly named tables.

### 4. Confirmed backend behavior examples

- `src/convex/analyses.ts` saves analysis snapshots per authenticated user and retains a bounded history.
- `src/convex/journal.ts` enforces user ownership and journal status transitions.
- `src/convex/notifications.ts` provides user-scoped reads/writes, deduplication, read/dismiss behavior, and bounded retention.
- The inspected market-data action in `src/convex/marketData.ts` contains provider selection, caching, request coalescing, timeout/backoff, request budgeting, and market-data normalization. This logic must be preserved or extracted—not replaced with a simplistic price-fetch endpoint.
- `src/convex/crons.ts` currently intentionally registers no market-wide discovery cron. The migration must not reintroduce automatic market-wide scanning.
- `src/convex/marketRadarScheduler.ts` and `src/convex/marketRadarInternal.ts` still contain legacy scanner/checkpoint logic. Their presence in source is not evidence that the cron is active; keep them out of the new runtime path unless a user-requested feature explicitly requires them.
- Other inspected server modules include `src/convex/alertRules.ts`, `src/convex/positionProtection.ts`, `src/convex/runtimeHealth.ts`, `src/convex/alphaVantage.ts`, `src/convex/tradingEconomics.ts`, `src/convex/okx.ts`, and `src/convex/secEdgar.ts`. These cover persistence and external data actions and need operation-by-operation extraction.

## Self-hosted foundation started on this branch

The isolated `backend/` directory now contains a dependency-free Node.js HTTP service using the built-in `node:sqlite` module, liveness/readiness endpoints, WAL-backed persistent storage, checksummed transactional SQL migrations, graceful shutdown, Docker Compose with a persistent SQLite volume, and five automated tests. A dedicated GitHub Actions run on PR #252 passed all five tests and JavaScript syntax checks on Node 22.23.4.

This first slice deliberately exposes health endpoints and a generic metadata table only. It does not yet implement domain routes, authentication, authorization, the full application schema, data export/import, or frontend integration. It has not been declared production-ready. No frontend, existing Convex function, production environment variable, or deployed service was changed.

## Proposed self-hosted target

Use open-source components that can run on a machine we control:

- **Application/API:** Node.js HTTP service using built-in runtime modules; no third-party runtime package is required for the initial API surface.
- **Database:** SQLite via Node's built-in `node:sqlite` module for the current single-node, on-demand workload. This avoids a separate database server and managed database subscription.
- **Migrations:** versioned, checksummed SQL migrations committed to this repository and applied transactionally. Keep the storage boundary replaceable; PostgreSQL can be self-hosted later if measured concurrency or multi-node requirements justify it.
- **Authentication:** server-verified sessions with secure, HTTP-only cookies; Google OAuth can remain an optional identity provider, while local development must have an explicit safe development-auth mode. Never trust a client-supplied user ID.
- **Background work:** explicit on-demand jobs first; a local process scheduler/worker only for user-configured monitoring. No global instrument scanner.
- **Market data:** preserve existing provider adapters and source/freshness provenance. Keep large historical OHLCV data separate from transactional user records where appropriate.
- **Deployment:** a documented self-hosted process/container with persistent database volume and backup/restore commands. No platform-specific lock-in.

Node.js and SQLite are software components, not a promise of free public hosting. A publicly reachable, always-on service still needs a machine and network. The application itself should not require a paid SaaS backend. Node currently emits an experimental-feature warning for `node:sqlite`; CI has verified the implementation on Node 22.23.4, and this runtime caveat must remain visible until Node marks the API stable.

## Migration sequence and safety gates

1. **Complete dependency inventory (read-only):** enumerate every Convex import, generated API reference, query/mutation/action call site, server function, schema table, auth assumption, and environment variable. Record exact files and call names.
2. **Define contracts:** introduce provider-neutral TypeScript interfaces for identity, user records, analysis history, journal, positions, alerts, notifications, and market-data actions. Do not change existing call sites until contract coverage is reviewed.
3. **Build replacement backend in isolation:** PostgreSQL schema + migrations, API routes, session security, validation, ownership checks, retention behavior, and integration tests. Keep Convex production code untouched.
4. **Parity tests:** compare old Convex behavior and new backend behavior for each operation, including authorization failures, empty states, ordering, retention, deduplication, and lifecycle transitions.
5. **Data migration tooling:** export and validate existing records, map IDs and ownership, import idempotently, and produce row counts/checksums. Never delete or mutate source records during initial import.
6. **Frontend adapter migration:** switch one bounded feature at a time behind an explicit backend adapter. Remove Convex packages/config only after all call sites and auth flows have moved and CI proves no Convex runtime imports remain.
7. **Cutover:** only after backup, restore rehearsal, parity tests, auth tests, and production smoke tests pass. Preserve a rollback path until the new backend has been verified.

## Non-negotiable safeguards

- No changes to `main` as part of this foundation work.
- No deletion of existing Convex functions, tables, or production data during extraction.
- No mock/localStorage fallback presented as real production persistence.
- No automatic market-wide scanner or recurring global data acquisition.
- No fabricated prices, signals, probability, targets, or risk/reward.
- No migration cutover while the new backend is untested.
- Every stage must have reproducible tests and a concrete pass/fail result.

## Known gaps in this initial audit

This document is not yet a complete dependency inventory. The full `src/convex/` tree, every frontend call site, all generated API references, all auth consumers, and every table's read/write behavior still need enumeration. No schema migration or production switch should begin until that inventory is complete.

## Immediate next engineering task

Finish the repository-wide dependency inventory, then define the smallest provider-neutral boundary that covers the real production features. The first implementation should be an isolated backend foundation with tests; it must not alter the deployed frontend or the existing Convex deployment.
