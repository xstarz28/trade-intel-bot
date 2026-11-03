# Self-hosted domain and runtime

## Target architecture

The final target is a single self-hosted origin:

- `https://xstarzganaliys.com` serves the Vite frontend from the Node.js application.
- The same Node.js process serves `/api/v1/*`.
- SQLite stores user and application state in a persistent Docker volume.
- Caddy is a self-hosted reverse proxy that obtains and renews HTTPS certificates.
- GitHub remains the source repository and CI system only; it is not the application runtime.
- Convex and Vercel are not part of the target runtime.

GitHub Pages was considered as a no-cost static-hosting fallback but deliberately not selected: it would still make application hosting depend on a third-party service. The Pages preparation PR was closed as superseded.

## Domain

The hostname is written exactly as supplied by the user: `xstarzganaliys.com`. Confirm that this exact spelling matches the registered domain before changing DNS or registering the Google OAuth callback.

The domain registrar remains the authoritative DNS provider. The apex A record must point to the public IPv4 address of the machine running the self-hosted stack. Add an AAAA record only if that host has a stable public IPv6 address. Preserve unrelated MX/TXT records.

The host firewall/router must allow inbound TCP 80 and 443. UDP 443 is optional for HTTP/3. Caddy terminates TLS and reverse-proxies to the Node service on the private Docker network.

## Deployment boundary

The repository now contains:
- a production Dockerfile that builds the frontend and shared market-data engine, then creates a minimal Node runtime image;
- a Node static-file server with SPA route fallback and traversal protection;
- a Caddyfile and Docker Compose service with persistent SQLite/Caddy volumes;
- a backup utility using SQLite's consistent `VACUUM INTO` snapshot.

No public DNS change, domain verification, server provisioning, or production cutover has been performed. The application frontend still contains Convex hooks, so the self-hosted server is not yet a drop-in replacement for the current production site.

## Cutover gates

Do not point the public domain to the new host or disable the old deployment until:
1. every frontend Convex query/mutation/action has a replacement API route;
2. Google OAuth credentials and callback are configured securely;
3. Convex data can be exported, imported idempotently, and verified;
4. analysis, journal, positions, alerts, notifications, history, fundamental data, and derivative data pass end-to-end parity tests;
5. Docker image, backup, restore, TLS renewal, and reboot recovery are tested on the actual host.

A publicly reachable always-on host still requires physical or rented compute, electricity, and network connectivity. The software stack itself uses open-source components and does not require a paid application-hosting or database subscription.
