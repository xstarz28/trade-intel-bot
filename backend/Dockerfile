FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund
COPY backend ./backend
COPY src ./src
COPY scripts/build-backend.mjs ./scripts/build-backend.mjs
RUN npm run backend:build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY backend/server.mjs ./backend/server.mjs
COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
COPY --from=build /app/backend/dist ./backend/dist
RUN mkdir -p /data
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DB_PATH=/data/trade-intel.sqlite
EXPOSE 8787
CMD ["node", "backend/server.mjs"]
