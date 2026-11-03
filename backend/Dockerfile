FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY backend ./backend
RUN mkdir -p /data
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DB_PATH=/data/trade-intel.sqlite
EXPOSE 8787
CMD ["node", "backend/server.mjs"]
