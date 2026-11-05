import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * Atomically restores a previously created SQLite snapshot.
 * The application must be stopped before this function is called.
 */
export function restoreDatabase(sourcePath, targetPath) {
  const source = resolve(sourcePath);
  const target = resolve(targetPath);
  if (source === target) throw new Error("Restore source and target must differ.");
  if (!existsSync(source) || !statSync(source).isFile() || statSync(source).size === 0) {
    throw new Error("Restore source is missing or empty: " + source);
  }
  if (existsSync(target + "-wal") || existsSync(target + "-shm")) {
    throw new Error("Target SQLite sidecar files exist; stop the backend before restore.");
  }

  const validation = new DatabaseSync(source, { readOnly: true });
  try {
    const result = validation.prepare("PRAGMA quick_check").get();
    if (result?.quick_check !== "ok") throw new Error("Restore source failed SQLite quick_check.");
  } finally {
    validation.close();
  }

  const temporary = target + ".restore-" + process.pid;
  if (existsSync(temporary)) rmSync(temporary);
  try {
    copyFileSync(source, temporary);
    const descriptor = openSync(temporary, "r+");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, target);
    return { source, target, bytes: statSync(target).size };
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary);
    throw error;
  }
}

function main() {
  const source = process.argv[2];
  const target = resolve(process.env.DB_PATH ?? "backend/data/trade-intel.sqlite");
  if (!source) throw new Error("Usage: node backend/restore.mjs /data/backups/backup.sqlite");
  const result = restoreDatabase(source, target);
  console.info("SQLite database restored:", result.target, "(" + result.bytes + " bytes)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
