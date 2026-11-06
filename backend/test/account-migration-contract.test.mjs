import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function declaredStringList(source, declaration) {
  const match = source.match(new RegExp(`const ${declaration} = \\[([\\s\\S]*?)\\]`));
  assert.ok(match, `Missing ${declaration} declaration`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

describe("account migration contract", () => {
  it("keeps every user-owned SQLite table in both portable export and import", () => {
    const schema = read("../../backend/migrations/0002_trade_intel_domain.sql");
    const exportSource = read("../src/account-export.mjs");
    const importSource = read("../src/account-import.mjs");
    const exported = declaredStringList(exportSource, "EXPORT_TABLES");
    const imported = declaredStringList(importSource, "IMPORT_TABLES");
    const userOwned = [...schema.matchAll(/CREATE TABLE ([a-z_]+) \(([\s\S]*?)\n\);/g)]
      .filter((match) => /user_id TEXT NOT NULL/.test(match[2]))
      .map((match) => match[1]);

    assert.deepEqual([...exported].sort(), [...imported].sort());
    assert.deepEqual([...userOwned].sort(), [...exported].sort());
  });

  it("keeps native Convex export tables aligned with the backend importer", () => {
    const convexSource = read("../../src/convex/accountMigration.ts");
    const converter = read("../src/convex-account-import.mjs");
    const backendTables = declaredStringList(read("../src/account-import.mjs"), "IMPORT_TABLES");
    const convexTables = [...convexSource.matchAll(/ctx\.db\.query\("([A-Za-z]+)"\)/g)]
      .map((match) => camelToSnake(match[1]));
    const normalizedTables = declaredStringList(converter, "TABLES").map(camelToSnake);

    assert.deepEqual([...new Set(convexTables)].sort(), [...backendTables].sort());
    assert.deepEqual([...normalizedTables].sort(), [...backendTables].sort());
  });

  it("keeps export, import, and native migration row and byte limits compatible", () => {
    const exportSource = read("../src/account-export.mjs");
    const importSource = read("../src/account-import.mjs");
    const convexSource = read("../../src/convex/accountMigration.ts");
    const exportRows = Number(exportSource.match(/MAX_EXPORT_ROWS = (\d+)/)?.[1]);
    const importRows = Number(importSource.match(/MAX_ROWS = (\d+)/)?.[1]);
    const importBytes = Number(importSource.match(/MAX_BODY_BYTES = (\d+) \* 1024 \* 1024/)?.[1]) * 1024 * 1024;
    const exportBytes = Number(exportSource.match(/MAX_EXPORT_BYTES = (\d+) \* 1024 \* 1024/)?.[1]) * 1024 * 1024;
    const convexRows = Number(convexSource.match(/MAX_ROWS_PER_TABLE = (\d+)/)?.[1]);

    assert.equal(exportRows, importRows);
    assert.equal(exportRows, convexRows);
    assert.equal(exportBytes, importBytes);
    assert.ok(Number.isFinite(exportRows) && exportRows > 0);
    assert.ok(Number.isFinite(exportBytes) && exportBytes > 0);
  });
});
