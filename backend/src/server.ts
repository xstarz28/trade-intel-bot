import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDatabasePool } from "./database.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const database = createDatabasePool(process.env.DATABASE_URL);
const app = createApp({ database });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.info(`Trade Intel self-hosted backend listening on port ${info.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; shutting down backend.`);
  server.close(async () => {
    await database.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
