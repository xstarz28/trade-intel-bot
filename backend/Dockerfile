FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm run backend:build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/backend/server.mjs ./backend/server.mjs
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
CMD ["node", "backend/server.mjs"]
