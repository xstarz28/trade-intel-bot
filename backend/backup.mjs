import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

export function createDatabaseBackup(sourcePath, destinationPath) {
  const source = resolve(sourcePath);
  const target = resolve(destinationPath);
  if (target === source) throw new Error("Backup destination must differ from the live database.");
  if (!existsSync(source)) throw new Error("Source SQLite database does not exist: " + source);
  if (existsSync(target)) throw new Error("Backup destination already exists: " + target);

  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(source);
  try {
    const escaped = target.replace(/'/g, "''");
    database.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    database.close();
  }

  try {
    chmodSync(target, 0o600);
    const validation = new DatabaseSync(target, { readOnly: true });
    try {
      const result = validation.prepare("PRAGMA quick_check").get();
      if (result?.quick_check !== "ok") {
        throw new Error("Created backup failed SQLite quick_check.");
      }
    } finally {
      validation.close();
    }

    const descriptor = openSync(target, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    return { target, bytes: statSync(target).size };
  } catch (error) {
    if (existsSync(target)) rmSync(target);
    throw error;
  }
}

function main() {
  const source = resolve(process.env.DB_PATH ?? "backend/data/trade-intel.sqlite");
  const destination = process.argv[2];
  if (!destination) {
    throw new Error("Usage: node backend/backup.mjs /absolute/path/to/backup.sqlite [--if-exists]");
  }
  if (!existsSync(source) && process.argv.includes("--if-exists")) {
    console.info("No existing SQLite database to back up; fresh deployment.");
    return;
  }
  const result = createDatabaseBackup(source, destination);
  console.info(`SQLite backup created and verified: ${result.target} (${result.bytes} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
