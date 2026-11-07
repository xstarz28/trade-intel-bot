FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_LEGACY_CONVEX_URL=
ARG XSTARZ_BUILD_COMMIT=
ARG XSTARZ_BUILD_REF=
ARG XSTARZ_BUILD_WORKTREE_CLEAN=false
ARG SOURCE_DATE_EPOCH=
ENV VITE_LEGACY_CONVEX_URL=$VITE_LEGACY_CONVEX_URL
ENV XSTARZ_BUILD_COMMIT=$XSTARZ_BUILD_COMMIT
ENV XSTARZ_BUILD_REF=$XSTARZ_BUILD_REF
ENV XSTARZ_BUILD_WORKTREE_CLEAN=$XSTARZ_BUILD_WORKTREE_CLEAN
ENV SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm run backend:build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/backend/server.mjs ./backend/server.mjs
COPY --from=build /app/backend/backup.mjs ./backend/backup.mjs
COPY --from=build /app/backend/restore.mjs ./backend/restore.mjs
COPY --from=build /app/scripts/verify-google-auth-config.mjs ./scripts/verify-google-auth-config.mjs
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/backend/migrations ./backend/migrations
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/dist ./dist
RUN mkdir -p /data
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DB_PATH=/data/trade-intel.sqlite
ENV STATIC_DIR=/app/dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "backend/server.mjs"]
