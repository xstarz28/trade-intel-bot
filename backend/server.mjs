import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppServer } from "./src/app.mjs";
import { openDatabase } from "./src/database.mjs";
import { createOpportunityService } from "./src/opportunities.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const databasePath = resolve(process.env.DB_PATH ?? join(root, "data", "trade-intel.sqlite"));
const migrationsDirectory = resolve(root, "migrations");
const staticDirectory = resolve(process.env.STATIC_DIR ?? join(root, "..", "dist"));


if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

mkdirSync(dirname(databasePath), { recursive: true });
const database = openDatabase(databasePath, migrationsDirectory);
const opportunityService = createOpportunityService({
  database,
  intervalMs: Math.min(600_000, Math.max(30_000, Number.parseInt(process.env.OPPORTUNITY_SCAN_INTERVAL_MS ?? "60000", 10) || 60_000)),
});
const server = createAppServer({ database, staticDirectory, opportunityService });

server.listen(port, host, () => {
  console.info(`Trade Intel self-hosted app listening on http://${host}:${port}`);
  console.info(`Static frontend: ${staticDirectory}`);
  console.info(`SQLite database: ${databasePath}`);
  opportunityService.start();
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; shutting down backend.`);
  opportunityService.stop();
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
