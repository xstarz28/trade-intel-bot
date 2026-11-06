# Backend Independence Audit — Trade Intel Bot

**Status:** self-hosted application runtime and authentication implemented on this branch; production cutover and final legacy dependency retirement remain unverified.  
**Base revision audited:** `230aece22581d73a8a353a4d9b1cf68e2e1590a3`  
**Working branch:** `architecture/self-hosted-backend-foundation`

## Objective

Make Trade Intel Bot operable without a mandatory Convex dependency while preserving the existing React application, analysis engine, market-data adapters, trading journal, position protection, alerts, notifications, and historical records.

This is an incremental extraction, not a rewrite. Convex remains untouched until the replacement has parity tests and a verified data migration.

## Confirmed source findings

### 1. Legacy Convex surface and current isolation

- `package.json` includes `convex` and `@convex-dev/auth`.
- `convex.json` points the Convex function directory at `src/convex/`.
- `src/main.tsx` now mounts Dashboard and Journal without `AppAuthProvider`. Backend session auth gates protected routes; Convex is no longer a route-level runtime prerequisite.
- `src/hooks/use-auth.ts` now derives authentication exclusively from `useBackendSession` and the self-hosted `/api/v1/auth/*` API. It no longer imports `convex/react`, `@convex-dev/auth`, or generated Convex auth references.
- `src/components/RequireAuth.tsx` now restores and gates browser sessions through the self-hosted backend; backend outages are surfaced as retryable errors rather than being treated as signed-out users.
- `src/pages/Auth.tsx` now starts Google OAuth at the self-hosted backend and creates guest accounts through the backend API.
- `backend/src/auth.mjs` owns random opaque session tokens, SHA-256 token-hash persistence, HttpOnly/SameSite cookies, origin validation, Google OAuth state/nonce/PKCE, and Google ID-token signature/claim verification.
- `src/lib/convex-provider.tsx` remains only as an optional wrapper for the explicit legacy-account export panel. It is not mounted around normal app routes and is not the source of truth for browser login state.

**Implication:** changing a database URL or adding a second database will not remove the dependency. The frontend auth provider, query/mutation/action call sites, server functions, generated references, and identity model must be migrated as one controlled boundary.

### 2. Optional legacy account-export provider is not an application runtime

`src/lib/convex-provider.tsx` now mounts a real Convex client only inside the explicit legacy account-export panel and only when the configured URL matches the allow-listed legacy deployment. It is not mounted around Dashboard, Journal, the auth page, or protected routes. No mock Convex client or localStorage-backed mock auth is used as a production fallback.

This isolated path exists only to export a user's old Convex records into the self-hosted backend. If the legacy Convex deployment is disabled, normal backend login, session restoration, account creation, analysis, journal, position protection, and backend persistence continue to work. The export panel becomes unavailable until the legacy source is restored; that is a data-migration limitation, not an authentication dependency.

Do not reintroduce Convex as a fallback for backend outages. A backend failure must remain explicit and retryable.

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

## Browser authentication migration completed on this branch

The public login route and route guard now use the self-hosted backend session exclusively. Google sign-in redirects to the backend-owned OAuth flow; guest sign-in creates a durable backend user and HttpOnly session cookie. The session token is stored only as a SHA-256 hash in SQLite. Production cookies are host-only `__Host-` cookies with `Secure`, `HttpOnly`, `Path=/`, and `SameSite=Lax`. Backend session-check failures are distinct from an absent session and do not silently log the user out.

The auth page, Dashboard, and Journal are deliberately mounted outside `AppAuthProvider`. Disabling Convex no longer blocks login, session restoration, OAuth, or normal protected-route rendering. Dashboard analysis (including exact OKX perpetual/dated-futures OHLCV), stock Alpha Vantage intelligence, economic calendar, CoinGlass/public derivatives, DeFiLlama, COT/EIA/Treasury, FX reference conversion, OKX order-book/specification/open-interest, protection OHLCV, macro context, historical timelines, alert rules, runtime health, and notification persistence now use authenticated self-hosted API routes. The only active Convex call site is the explicitly optional legacy account-export panel, which is rendered only when a valid legacy Convex deployment is configured. Convex source/configuration and old migration utilities remain in the repository until account export is retired and the repository-wide reference audit is completed. Do not delete the old Convex deployment or data until account migration is verified.

## Self-hosted foundation started on this branch

The isolated `backend/` directory now contains a dependency-free Node.js HTTP service using the built-in `node:sqlite` module, liveness/readiness endpoints, WAL-backed persistent storage, checksummed transactional SQL migrations, graceful shutdown, a static Vite frontend server with SPA fallback/path-traversal protection, Caddy HTTPS reverse proxy, Docker Compose with persistent SQLite/Caddy volumes, and eighty-nine automated backend tests, including coverage for the hardened backup path. SQLite backup creation now writes private 0600 snapshots, runs an integrity check, and fsyncs the verified artifact before deployment proceeds. Migration `0002_trade_intel_domain.sql` now creates users/sessions/OAuth-flow storage plus the core Trade Intel tables: analyses, fundamentals, SEC filings, journal, monitored positions, alert history, stream cursors, historical snapshots/events, alert rules, rule-alert history, notifications/preferences, and runtime-health snapshots. The 2026-11-06 Backend Foundation CI run `42165299826` passed the preceding eighty-eight-test suite, frontend production build, shared market-data type-check, backend syntax checks, and a complete production Docker image build on Node 22.23.4. The expanded backup test suite is being re-run on the updated branch. The backend now has server-side anonymous sessions, HTTP-only cookie issuance/revocation, origin validation, and a Google OAuth authorization-code flow with PKCE, state/nonce checks, and Google JWKS RS256 ID-token validation. Google sign-in deliberately returns a configuration error until the existing OAuth credentials are moved to the new backend environment.

The self-hosted backend now serves authentication, user-scoped analysis/journal/position/alert persistence, historical intelligence, runtime-health snapshots, custom alert rules, notifications/preferences, account export/import, market analysis, batch OHLCV, Alpha Vantage, CoinGlass/public derivatives, DeFiLlama, economic calendar, COT/EIA/Treasury, FX reference, and OKX execution/specification/futures intelligence. Dashboard and position-protection consumers use the backend adapters. Backend routes enforce session ownership, bounded inputs, rate limits, provider timeouts, and explicit failure states; CI integration tests cover authentication and provider contracts. Remaining work is final repository-wide dependency/package cleanup, legacy account-data export verification, production environment validation, domain/DNS/TLS cutover, and full production acceptance. Do not claim production cutover or total repository cleanup until these checks pass.

## Self-hosted target

The selected deployment is a single-origin self-hosted stack: Node serves both the Vite frontend and `/api/v1/*`, SQLite stores state in a persistent Docker volume, and Caddy handles HTTPS. GitHub remains source control and CI only. A GitHub Pages alternative was closed as superseded because it would still be a third-party application host.

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

## Remaining migration gates

1. **Repository-wide dependency/reference audit:** enumerate every remaining Convex import, generated API reference, query/mutation/action call site, server function, schema table, auth assumption, and environment variable. Distinguish active optional export code from dead legacy modules and tests.
2. **Legacy account reconciliation:** run the native Convex export for each account, import into the matching backend identity, and verify per-table inserted/skipped counts, ownership, duplicates, and important record samples. Keep source data intact until reconciliation is signed off.
3. **Retire the optional export path:** only after account reconciliation, remove the legacy Convex panel, provider, generated client, Convex packages/configuration, and unused functions in a separate reviewed change. Normal login and application features must remain operational with Convex disabled.
4. **Production host and domain:** prepare the self-hosted Linux host, protected deployment secrets, host-side environment file, DNS A/AAAA records, firewall ports 80/443, and Caddy TLS. The deployment workflow is manual and refuses to claim success without the real host and public health checks.
5. **Production acceptance:** run the exact-commit runtime smoke against `https://xstarzganalys.com`, verify Google OAuth and guest sessions, market/provider coverage, database backup/recovery, restart persistence, and authenticated account flows.
6. **Release decision:** keep PR #252 Draft until CI is green, the migration gates are evidenced, and production acceptance is complete. Do not merge or claim production cutover prematurely.

The implemented backend uses Node.js built-in `node:sqlite`, checksummed transactional SQL migrations, authenticated HTTP APIs, and a single-origin Docker/Caddy deployment. PostgreSQL is not the current implementation or a prerequisite; it remains a possible future self-hosted option only if measured workload requires it.

## Non-negotiable safeguards

- No changes to `main` as part of this foundation work.
- No deletion of existing Convex functions, tables, or production data during extraction.
- No mock/localStorage fallback presented as real production persistence.
- No automatic market-wide scanner or recurring global data acquisition.
- No fabricated prices, signals, probability, targets, or risk/reward.
- No migration cutover while the new backend is untested.
- Every stage must have reproducible tests and a concrete pass/fail result.

## Known remaining gaps

- The repository-wide static reference audit is not yet complete; old Convex source/configuration and packages are intentionally retained for the optional export path and need a reviewed cleanup.
- No live Convex account export/import reconciliation has been executed in this environment.
- No production host credentials, server IP, DNS change, TLS issuance, or public production smoke result has been provided.
- CI must pass on the final PR head after the latest migration and deployment changes.

## Immediate engineering focus

Finish the final reference audit and production validation. Do not rebuild the already-migrated auth or application features, do not reintroduce Convex as a runtime fallback, and do not remove legacy account data before reconciliation.
