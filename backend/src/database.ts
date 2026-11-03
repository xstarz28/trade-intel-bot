import { Pool } from "pg";

export function createDatabasePool(connectionString: string | undefined) {
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required for the self-hosted backend.");
  }

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "trade-intel-backend",
  });
}
