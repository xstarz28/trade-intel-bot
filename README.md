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
- Convex + Convex Auth
- Framer Motion
- Vitest

The production frontend is deployed as a prebuilt Vercel Build Output artifact. The deployment workflow verifies the exact Git commit, release provenance, branding, authentication surface, routing, and published JavaScript assets before promotion.

## Local development

Install dependencies:

```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

## Production

Production deployments are triggered from `main` through GitHub Actions. The frontend uses the production Convex deployment configured by the repository's deployment environment.

Sensitive provider credentials and deployment credentials are supplied through environment secrets; they are not committed to the repository.

## Data integrity

XSTARZG is designed not to invent market prices or represent stale evidence as live data. Provider failures are isolated where possible so one unavailable source does not unnecessarily disable the broader intelligence layer.

Trading analysis is informational and does not execute trades automatically. Users remain responsible for their own decisions and risk management.
