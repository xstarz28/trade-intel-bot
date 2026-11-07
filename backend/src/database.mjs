import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export function openDatabase(databasePath, migrationsDirectory) {
  const database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  applyMigrations(database, migrationsDirectory);

  return {
    raw: database,
    check() {
      database.prepare("SELECT 1").get();
    },
    close() {
      database.close();
    },
  };
}

function applyMigrations(database, migrationsDirectory) {
  const files = readdirSync(migrationsDirectory)
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();

  const findMigration = database.prepare(
    "SELECT checksum FROM schema_migrations WHERE version = ?",
  );
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)",
  );

  for (const file of files) {
    const sql = readFileSync(join(migrationsDirectory, file), "utf8");
    const version = basename(file);
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = findMigration.get(version);

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Applied migration was modified: ${version}`);
      }
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      recordMigration.run(version, checksum, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
