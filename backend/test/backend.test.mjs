import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { createAppServer } from "../src/app.mjs";
import { openDatabase } from "../src/database.mjs";

const temporaryDirectories = [];

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "trade-intel-backend-"));
  temporaryDirectories.push(directory);
  return openDatabase(join(directory, "test.sqlite"), fileURLToPath(new URL("../migrations/", import.meta.url)));
}

async function withServer(database, callback) {
  const server = createAppServer({ database });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("self-hosted backend", () => {
  it("serves liveness without depending on persistence", async () => {
    await withServer(null, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/live`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: "ok",
        service: "trade-intel-backend",
      });
    });
  });

  it("reports readiness only when SQLite is available", async () => {
    const database = createTemporaryDatabase();
    try {
      await withServer(database, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health/ready`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          status: "ready",
          checks: { database: "ok" },
        });
      });
    } finally {
      database.close();
    }
  });

  it("fails readiness when persistence is not configured", async () => {
    await withServer(null, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/ready`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        status: "not_ready",
        checks: { database: "not_configured" },
      });
    });
  });

  it("applies versioned SQL migrations and records checksums", () => {
    const database = createTemporaryDatabase();
    try {
      const rows = database.raw
        .prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")
        .all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].version, "0001_app_metadata.sql");
      assert.match(rows[0].checksum, /^[a-f0-9]{64}$/);
      assert.equal(
        database.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_metadata'").get().name,
        "app_metadata",
      );
    } finally {
      database.close();
    }
  });

  it("returns JSON 404 for unknown routes", async () => {
    await withServer(null, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/not-a-route`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
    });
  });

  it("creates the complete user and Trade Intel persistence schema", () => {
    const database = createTemporaryDatabase();
    try {
      const tables = database.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name);
      for (const table of [
        "users",
        "auth_sessions",
        "oauth_flows",
        "analyses",
        "fundamental_observations",
        "sec_edgar_observations",
        "journal",
        "monitored_positions",
        "alert_history",
        "stream_cursors",
        "historical_snapshots",
        "alert_rules",
        "rule_alert_history",
        "notifications",
        "notification_preferences",
        "historical_events",
        "runtime_health_snapshots",
      ]) {
        assert.ok(tables.includes(table), `missing table: ${table}`);
      }
    } finally {
      database.close();
    }
  });

  it("enforces user ownership and cascades user deletion to private records", () => {
    const database = createTemporaryDatabase();
    try {
      database.raw.prepare(
        "INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)",
      ).run("user-1", "analyst@example.test", 1, 1);
      database.raw.prepare(
        "INSERT INTO notification_preferences (id, user_id, updated_at) VALUES (?, ?, ?)",
      ).run("pref-1", "user-1", 1);

      database.raw.prepare("DELETE FROM users WHERE id = ?").run("user-1");

      assert.equal(
        database.raw.prepare("SELECT COUNT(*) AS count FROM notification_preferences").get().count,
        0,
      );
    } finally {
      database.close();
    }
  });

  it("rejects malformed JSON in structured persistence columns", () => {
    const database = createTemporaryDatabase();
    try {
      database.raw.prepare(
        "INSERT INTO users (id, created_at, updated_at) VALUES (?, ?, ?)",
      ).run("user-2", 1, 1);
      assert.throws(() =>
        database.raw.prepare(
          "INSERT INTO notification_preferences (id, user_id, enabled_categories, updated_at) VALUES (?, ?, ?, ?)",
        ).run("pref-2", "user-2", "not-json", 1),
      );
    } finally {
      database.close();
    }
  });

});