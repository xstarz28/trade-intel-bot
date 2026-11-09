import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { createAppServer } from "../src/app.mjs";
import { createRateLimiter, upsertGoogleUser, verifyGoogleIdToken } from "../src/auth.mjs";
import { createUserRateLimiter } from "../src/market-data.mjs";
import { openDatabase } from "../src/database.mjs";
import { createDatabaseBackup } from "../backup.mjs";
import { restoreDatabase } from "../restore.mjs";

const temporaryDirectories = [];

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "trade-intel-backend-"));
  temporaryDirectories.push(directory);
  return openDatabase(join(directory, "test.sqlite"), fileURLToPath(new URL("../migrations/", import.meta.url)));
}


function createGoogleIdToken({ clientId, nonce, subject = "google-subject-e2e", email = "verified@example.test", issuedAt = Math.floor(Date.now() / 1000), expiresAt = Math.floor(Date.now() / 1000) + 3600 }) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "trade-intel-test-key",
    alg: "RS256",
    use: "sig",
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid: jwk.kid, typ: "JWT" });
  const claims = encode({
    iss: "https://accounts.google.com",
    aud: clientId,
    exp: expiresAt,
    iat: issuedAt,
    nonce,
    sub: subject,
    email,
    email_verified: true,
    name: "Verified Trader",
    picture: "https://example.test/avatar.png",
  });
  const signingInput = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return { jwk, idToken: `${signingInput}.${signature}` };
}

function yahooChartPayload(now) {
  const timestamp=Array.from({length:220},(_,i)=>Math.floor((now-(220-i)*60*60*1000)/1000));
  const open=timestamp.map((_,i)=>150+i*0.08);
  return {chart:{result:[{timestamp,indicators:{quote:[{open,high:open.map(x=>x+0.4),low:open.map(x=>x-0.3),close:open.map(x=>x+0.1),volume:open.map(()=>100000)}]}}]}};
}

async function withServer(database, callback, options = {}) {
  const server = createAppServer({ database, ...options });
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

describe("authentication rate limiter", () => {
  it("bounds client buckets without evicting active clients and reclaims expired buckets", () => {
    let now = 1_000;
    const limit = createRateLimiter(2, 100, 2, () => now);
    const request = (address) => ({
      headers: { "x-forwarded-for": address },
      socket: { remoteAddress: "127.0.0.1" },
    });

    assert.equal(limit(request("198.51.100.1")), true);
    assert.equal(limit(request("198.51.100.1")), true);
    assert.equal(limit(request("198.51.100.1")), false);
    assert.equal(limit(request("198.51.100.2")), true);

    // A third unique client cannot grow memory or evict the first client's
    // active bucket, so the first client's limit cannot be bypassed.
    assert.equal(limit(request("198.51.100.3")), false);
    assert.equal(limit(request("198.51.100.1")), false);

    now += 101;
    assert.equal(limit(request("198.51.100.3")), true);
    assert.equal(limit(request("198.51.100.1")), true);
  });

  it("rejects invalid limiter configuration", () => {
    assert.throws(() => createRateLimiter(0, 100), /Invalid rate limiter configuration/);
    assert.throws(() => createRateLimiter(1, 0), /Invalid rate limiter configuration/);
    assert.throws(() => createRateLimiter(1, 100, 0), /Invalid rate limiter configuration/);
  });
});

describe("SQLite backup utility", () => {
  it("creates a private, integrity-checked snapshot and refuses to overwrite an existing backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "trade-intel-backup-"));
    temporaryDirectories.push(directory);
    const migrations = fileURLToPath(new URL("../migrations/", import.meta.url));
    const source = join(directory, "live.sqlite");
    const target = join(directory, "backups", "snapshot.sqlite");
    const database = openDatabase(source, migrations);
    const now = Date.now();
    database.raw.prepare(
      "INSERT INTO users (id, name, is_anonymous, role, created_at, updated_at) VALUES (?, ?, 1, 'user', ?, ?)",
    ).run("backup-user", "Backup Test", now, now);
    database.close();

    const backup = createDatabaseBackup(source, target);
    assert.equal(backup.target, target);
    assert.ok(backup.bytes > 0);
    assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.throws(() => createDatabaseBackup(source, target), /already exists/);

    const restored = openDatabase(target, migrations);
    assert.equal(
      restored.raw.prepare("SELECT name FROM users WHERE id = ?").get("backup-user").name,
      "Backup Test",
    );
    restored.close();
  });
});

describe("SQLite restore utility", () => {
  it("validates a backup and atomically restores it without overwriting an active WAL database", () => {
    const directory = mkdtempSync(join(tmpdir(), "trade-intel-restore-"));
    temporaryDirectories.push(directory);
    const migrations = fileURLToPath(new URL("../migrations/", import.meta.url));
    const source = join(directory, "backup.sqlite");
    const target = join(directory, "live.sqlite");
    const sourceDatabase = openDatabase(source, migrations);
    const now = Date.now();
    sourceDatabase.raw.prepare(
      "INSERT INTO users (id, name, is_anonymous, role, created_at, updated_at) VALUES (?, ?, 1, 'user', ?, ?)",
    ).run("restore-user", "Restore Test", now, now);
    sourceDatabase.close();

    const restored = restoreDatabase(source, target);
    assert.equal(restored.target, target);
    assert.ok(restored.bytes > 0);
    assert.equal(statSync(target).mode & 0o777, 0o600);

    const nestedTarget = join(directory, "recovered", "nested", "live.sqlite");
    const nestedRestore = restoreDatabase(source, nestedTarget);
    assert.equal(nestedRestore.target, nestedTarget);
    assert.ok(statSync(nestedTarget).size > 0, "restore creates missing parent directories");

    const restoredDatabase = openDatabase(target, migrations);
    assert.equal(
      restoredDatabase.raw.prepare("SELECT name FROM users WHERE id = ?").get("restore-user").name,
      "Restore Test",
    );
    restoredDatabase.close();

    writeFileSync(target + "-wal", "active");
    assert.throws(() => restoreDatabase(source, target), /sidecar files exist/);
    rmSync(target + "-wal");

    // A source database with a WAL sidecar is not a standalone snapshot.
    // Copying only its main file could silently omit committed WAL pages.
    writeFileSync(source + "-wal", "uncheckpointed source WAL");
    assert.throws(() => restoreDatabase(source, join(directory, "wal-source-target.sqlite")), /uncheckpointed SQLite WAL/);
    rmSync(source + "-wal");

    const invalidRelations = join(directory, "foreign-key-invalid.sqlite");
    const invalidDatabase = openDatabase(invalidRelations, migrations);
    invalidDatabase.raw.exec("PRAGMA foreign_keys = OFF");
    invalidDatabase.raw.prepare(
      "INSERT INTO notification_preferences (id,user_id,updated_at) VALUES (?,?,?)",
    ).run("orphan-preference", "missing-user", Date.now());
    invalidDatabase.close();
    assert.throws(
      () => createDatabaseBackup(invalidRelations, join(directory, "invalid-relations-backup.sqlite")),
      /foreign_key_check/,
      "backup must reject a snapshot containing broken foreign-key relationships",
    );
    assert.throws(
      () => restoreDatabase(invalidRelations, join(directory, "invalid-relations-target.sqlite")),
      /foreign_key_check/,
    );

    const corrupt = join(directory, "corrupt.sqlite");
    writeFileSync(corrupt, "not a SQLite database");
    const before = readFileSync(target);
    assert.throws(() => restoreDatabase(corrupt, target));
    assert.deepEqual(readFileSync(target), before, "invalid restore input must leave the live database untouched");
  });
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
          release: {
            commit: "test-commit",
            ref: "test-ref",
            worktreeClean: true,
          },
        });
      }, {
        env: {
          XSTARZ_BUILD_COMMIT: "test-commit",
          XSTARZ_BUILD_REF: "test-ref",
          XSTARZ_BUILD_WORKTREE_CLEAN: "true",
        },
      });
    } finally {
      database.close();
    }
  });

  it("allows CORS preflight for PUT, PATCH, and DELETE API operations", async () => {
    const env = {
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:5173",
    };
    await withServer(null, async (baseUrl) => {
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const response = await fetch(`${baseUrl}/api/v1/journal/example`, {
          method: "OPTIONS",
          headers: {
            Origin: env.APP_ORIGIN,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type",
          },
        });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get("access-control-allow-origin"), env.APP_ORIGIN);
        assert.match(response.headers.get("access-control-allow-methods") ?? "", new RegExp(method));
        assert.equal(response.headers.get("access-control-allow-credentials"), "true");
      }
    }, { env });
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
      assert.equal(rows.length, 5);
      assert.equal(database.raw.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
      assert.equal(database.raw.prepare("PRAGMA synchronous").get().synchronous, 2);
      assert.deepEqual(rows.map((row) => row.version), [
        "0001_app_metadata.sql",
        "0002_trade_intel_domain.sql",
        "0003_market_radar.sql",
        "0004_market_radar_ranking.sql",
        "0005_market_radar_lease_owner.sql",
      ]);
      for (const row of rows) assert.match(row.checksum, /^[a-f0-9]{64}$/);
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


  it("creates a durable anonymous session, resolves it, and revokes it on logout", async () => {
    const database = createTemporaryDatabase();
    const env = {
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:5173",
    };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN },
        });
        assert.equal(signIn.status, 201);
        const signedIn = await signIn.json();
        assert.equal(signedIn.user.isAnonymous, true);
        assert.equal(signedIn.user.role, "user");

        const setCookie = signIn.headers.get("set-cookie");
        assert.ok(setCookie);
        const cookiePair = setCookie.split(";")[0];

        const repeatedSignIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookiePair },
        });
        assert.equal(repeatedSignIn.status, 200);
        assert.equal((await repeatedSignIn.json()).user.id, signedIn.user.id);
        assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);

        const session = await fetch(`${baseUrl}/api/v1/auth/session`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookiePair },
        });
        assert.equal(session.status, 200);
        const current = await session.json();
        assert.equal(current.user.id, signedIn.user.id);
        assert.equal(current.user.isAnonymous, true);

        const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookiePair },
        });
        assert.equal(logout.status, 200);

        const afterLogout = await fetch(`${baseUrl}/api/v1/auth/session`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookiePair },
        });
        assert.equal((await afterLogout.json()).user, null);
      }, { env });
    } finally {
      database.close();
    }
  });

  it("issues production sessions with host-only secure cookies and stores only token hashes", async () => {
    const database = createTemporaryDatabase();
    const env = {
      NODE_ENV: "production",
      APP_ORIGIN: "https://xstarzganalys.com",
    };
    try {
      await withServer(database, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN },
        });
        assert.equal(response.status, 201);
        const cookie = response.headers.get("set-cookie");
        assert.ok(cookie);
        assert.match(cookie, /^__Host-xstarz_session=/);
        assert.match(cookie, /; Path=\//);
        assert.match(cookie, /; HttpOnly/);
        assert.match(cookie, /; SameSite=Lax/);
        assert.match(cookie, /; Secure/);
        assert.doesNotMatch(cookie, /; Domain=/i);

        const token = cookie.split(";")[0].split("=").slice(1).join("=");
        const stored = database.raw.prepare("SELECT token_hash FROM auth_sessions").get();
        assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
        assert.notEqual(stored.token_hash, token);
      }, { env });
    } finally {
      database.close();
    }
  });

  it("rejects production authentication mutations without an Origin header", async () => {
    const database = createTemporaryDatabase();
    const env = {
      NODE_ENV: "production",
      APP_ORIGIN: "https://xstarzganalys.com",
    };
    try {
      await withServer(database, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST",
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: "origin_required" });
      }, { env });
    } finally {
      database.close();
    }
  });

  it("rate-limits anonymous session creation per client and returns a retry hint", async () => {
    const database = createTemporaryDatabase();
    const env = {
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:5173",
    };
    try {
      await withServer(database, async (baseUrl) => {
        const responses = [];
        for (let attempt = 0; attempt < 11; attempt += 1) {
          responses.push(await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
            method: "POST",
            headers: { Origin: env.APP_ORIGIN },
          }));
        }

        assert.deepEqual(responses.slice(0, 10).map((response) => response.status), Array(10).fill(201));
        assert.equal(responses[10].status, 429);
        assert.equal(responses[10].headers.get("retry-after"), "600");
        assert.deepEqual(await responses[10].json(), { error: "anonymous_sign_in_rate_limited" });
        assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM users").get().count, 10);
      }, { env });
    } finally {
      database.close();
    }
  });

  it("rate-limits Google OAuth initiation without making an upstream request", async () => {
    const database = createTemporaryDatabase();
    const env = {
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:8787",
      GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-secret",
    };
    try {
      await withServer(database, async (baseUrl) => {
        const responses = [];
        for (let attempt = 0; attempt < 21; attempt += 1) {
          responses.push(await fetch(`${baseUrl}/api/v1/auth/google`, {
            headers: { Accept: "application/json" },
            redirect: "manual",
          }));
        }

        assert.deepEqual(responses.slice(0, 20).map((response) => response.status), Array(20).fill(302));
        assert.equal(responses[20].status, 429);
        assert.equal(responses[20].headers.get("retry-after"), "600");
        assert.deepEqual(await responses[20].json(), { error: "google_sign_in_rate_limited" });
        assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM oauth_flows").get().count, 20);
      }, { env });
    } finally {
      database.close();
    }
  });

  it("links a guest account to Google without changing its user ID or private data", () => {
    const database = createTemporaryDatabase();
    try {
      const now = Date.now();
      database.raw.prepare(
        "INSERT INTO users (id, name, is_anonymous, role, created_at, updated_at) VALUES (?, ?, 1, 'user', ?, ?)",
      ).run("guest-1", "Guest Trader", now, now);
      database.raw.prepare(
        "INSERT INTO analyses (id,user_id,instrument,instrument_type,timeframe,bias,confidence,technical_summary,fundamental_summary,breakdown,key_levels,risk_note,data_completeness,data_flags,timestamp,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "analysis-guest-1","guest-1","BTC-USDT","crypto","H4","BULLISH",70,
        "Trend aligned","No catalyst",JSON.stringify({trend:1,indicator:1,fundamental:0,sentiment:0}),
        JSON.stringify({support:"1",resistance:"2",invalidation:"0"}),"Defined risk","partial","[]",now,now,
      );

      const userId = upsertGoogleUser(database, {
        subject: "google-subject-1",
        email: "trader@example.test",
        name: "Trader",
        image: null,
      }, { id: "guest-1", isAnonymous: true });

      assert.equal(userId, "guest-1");
      const user = database.raw.prepare("SELECT email, google_subject, is_anonymous FROM users WHERE id = ?").get(userId);
      assert.equal(user.email, "trader@example.test");
      assert.equal(user.google_subject, "google-subject-1");
      assert.equal(user.is_anonymous, 0);
      assert.equal(
        database.raw.prepare("SELECT user_id FROM analyses WHERE id = ?").get("analysis-guest-1").user_id,
        "guest-1",
      );
    } finally {
      database.close();
    }
  });

  it("rolls back Google account linking when persisted identity verification fails", () => {
    const database = createTemporaryDatabase();
    try {
      const now = Date.now();
      database.raw.prepare(
        "INSERT INTO users (id, name, is_anonymous, role, created_at, updated_at) VALUES (?, ?, 1, 'user', ?, ?)",
      ).run("guest-rollback", "Guest Trader", now, now);
      database.raw.exec(`
        CREATE TRIGGER alter_google_identity_after_link
        AFTER UPDATE OF google_subject ON users
        WHEN NEW.google_subject IS NOT NULL AND OLD.google_subject IS NULL
        BEGIN
          UPDATE users SET email = 'unexpected@example.test' WHERE id = NEW.id;
        END;
      `);

      assert.throws(() => upsertGoogleUser(database, {
        subject: "google-subject-rollback",
        email: "verified@example.test",
        name: "Verified Trader",
        image: null,
      }, { id: "guest-rollback", isAnonymous: true }), /identity failed persistence verification/);

      const user = database.raw.prepare(
        "SELECT email, google_subject, is_anonymous FROM users WHERE id = ?",
      ).get("guest-rollback");
      assert.equal(user.email, null);
      assert.equal(user.google_subject, null);
      assert.equal(user.is_anonymous, 1);
    } finally {
      database.close();
    }
  });

  it("does not switch away from a guest account when Google identity belongs to another account", () => {
    const database = createTemporaryDatabase();
    try {
      const now = Date.now();
      database.raw.prepare(
        "INSERT INTO users (id, name, email, email_verified_at, is_anonymous, role, google_subject, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'user', ?, ?, ?)",
      ).run("google-user-1", "Existing", "trader@example.test", now, "google-subject-1", now, now);
      database.raw.prepare(
        "INSERT INTO users (id, name, is_anonymous, role, created_at, updated_at) VALUES (?, ?, 1, 'user', ?, ?)",
      ).run("guest-2", "Guest Trader", now, now);

      assert.throws(
        () => upsertGoogleUser(database, {
          subject: "google-subject-1",
          email: "trader@example.test",
          name: "Trader",
          image: null,
        }, { id: "guest-2", isAnonymous: true }),
        (error) => error.code === "anonymous_account_link_conflict",
      );
      assert.equal(
        database.raw.prepare("SELECT is_anonymous FROM users WHERE id = ?").get("guest-2").is_anonymous,
        1,
      );
      assert.equal(
        database.raw.prepare("SELECT id FROM users WHERE google_subject = ?").get("google-subject-1").id,
        "google-user-1",
      );
    } finally {
      database.close();
    }
  });

  it("exports only the authenticated user's portable data without session secrets", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN },
        });
        assert.equal(signIn.status, 201);
        const { user } = await signIn.json();
        const cookiePair = signIn.headers.get("set-cookie").split(";")[0];
        const now = Date.now();

        database.raw.prepare(
          "INSERT INTO notification_preferences (id,user_id,updated_at) VALUES (?,?,?)",
        ).run("pref-export-1", user.id, now);
        database.raw.prepare(
          "INSERT INTO users (id,name,created_at,updated_at) VALUES (?,?,?,?)",
        ).run("another-user", "Other Trader", now, now);
        database.raw.prepare(
          "INSERT INTO notification_preferences (id,user_id,updated_at) VALUES (?,?,?)",
        ).run("pref-export-2", "another-user", now);

        const response = await fetch(`${baseUrl}/api/v1/account/export`, {
          headers: { Cookie: cookiePair },
        });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-disposition"), /trade-intel-account-export/);
        const exported = await response.json();
        assert.equal(exported.format, "trade-intel-account-export");
        assert.equal(exported.version, 1);
        assert.equal(exported.account.id, user.id);
        assert.equal(exported.account.isAnonymous, true);
        assert.equal(exported.counts.notification_preferences, 1);
        assert.equal(exported.data.notification_preferences[0].id, "pref-export-1");
        assert.equal("auth_sessions" in exported.data, false);
        assert.equal("oauth_flows" in exported.data, false);
        assert.equal(JSON.stringify(exported).includes(cookiePair), false);

        const unauthorized = await fetch(`${baseUrl}/api/v1/account/export`);
        assert.equal(unauthorized.status, 401);
      }, { env });
    } finally {
      database.close();
    }
  });

  it("rejects account exports that exceed the matching import row or byte limits", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const { user } = await signIn.json();
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const insert = database.raw.prepare(`
          INSERT INTO notifications (
            id,user_id,notification_id,alert_identity,rule_id,rule_name,timestamp,
            severity,title,message,category,impact,source,condition
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);
        for (let index = 0; index <= 10_000; index++) {
          insert.run(
            `export-limit-${index}`, user.id, `export-limit-${index}`,
            `identity-${index}`, "rule", "Rule", index, "INFO",
            "Bounded export", "", "SYSTEM", "LOW", "test", "test",
          );
        }
        const rowLimited = await fetch(`${baseUrl}/api/v1/account/export`, {
          headers: { Cookie: cookie },
        });
        assert.equal(rowLimited.status, 413);
        assert.equal((await rowLimited.json()).error, "account_export_row_limit_exceeded");
        database.raw.prepare("DELETE FROM notifications WHERE user_id = ?").run(user.id);
        insert.run(
          "export-large-payload", user.id, "export-large-payload",
          "identity-large", "rule", "Rule", Date.now(), "INFO",
          "Large export", "x".repeat(5 * 1024 * 1024), "SYSTEM", "LOW", "test", "test",
        );
        const byteLimited = await fetch(`${baseUrl}/api/v1/account/export`, {
          headers: { Cookie: cookie },
        });
        assert.equal(byteLimited.status, 413);
        assert.equal((await byteLimited.json()).error, "account_export_size_limit_exceeded");
      }, { env });
    } finally {
      database.close();
    }
  });
  it("restores a portable export and overwrites untrusted imported ownership", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const user = (await signIn.json()).user;
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const now = Date.now();
        database.raw.prepare(
          "INSERT INTO notification_preferences (id,user_id,updated_at) VALUES (?,?,?)",
        ).run("pref-import-1", user.id, now);

        const exportedResponse = await fetch(`${baseUrl}/api/v1/account/export`, {
          headers: { Cookie: cookie },
        });
        assert.equal(exportedResponse.status, 200);
        const exported = await exportedResponse.json();

        database.raw.prepare("DELETE FROM notification_preferences WHERE id = ?").run("pref-import-1");
        exported.data.notification_preferences[0].user_id = "forged-other-user";
        const response = await fetch(`${baseUrl}/api/v1/account/import`, {
          method: "POST",
          headers: {
            Origin: env.APP_ORIGIN,
            Cookie: cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify(exported),
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.totalInserted, 1);
        assert.equal(
          database.raw.prepare("SELECT user_id FROM notification_preferences WHERE id = ?").get("pref-import-1").user_id,
          user.id,
        );
      }, { env });
    } finally {
      database.close();
    }
  });

  it("rejects cross-origin authentication mutations", async () => {
    const database = createTemporaryDatabase();
    try {
      await withServer(database, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST",
          headers: { Origin: "https://attacker.invalid" },
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: "origin_not_allowed" });
      }, {
        env: {
          NODE_ENV: "production",
          APP_ORIGIN: "https://xstarzganalys.com",
        },
      });
    } finally {
      database.close();
    }
  });

  it("uses persisted SEC observations in the authenticated self-hosted stock analysis route", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    const now = Date.now();
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        database.raw.prepare(`INSERT INTO sec_edgar_observations (
          id,ticker,cik,accession_number,form,filing_date,acceptance_date_time,
          fiscal_period_start,fiscal_period_end,fiscal_year,fiscal_period,eps,revenue,
          eps_tag,revenue_tag,source_url,first_observed_at,last_retrieved_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          "sec-observation-1","AAPL","0000320193","0000320193-26-000001","10-Q",
          "2026-10-30",null,"2026-07-01","2026-09-30",2026,"Q3",6.4,100000000000,
          "EarningsPerShareDiluted","RevenueFromContractWithCustomerExcludingAssessedTax",
          "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/",now-1000,now,
        );

        const response = await fetch(`${baseUrl}/api/v1/market-data/analyze`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ instrument: "AAPL", instrumentType: "stock", timeframe: "H1" }),
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.success, true);
        assert.equal(result.analysis.fundamentalData.provider, "sec-edgar");
        assert.equal(result.analysis.fundamentalData.earningsPerShare, 6.4);
        assert.equal(result.analysis.fundamentalData.latestEarnings.date, "2026-09-30");
      }, { env, fetchImpl: async () => new Response(JSON.stringify(yahooChartPayload(now)), {
        status: 200, headers: { "content-type": "application/json" },
      }) });
    } finally {
      database.close();
    }
  });

  it("protects self-hosted macro intelligence endpoints behind authenticated sessions", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        for (const path of ["/api/v1/intelligence/cot", "/api/v1/intelligence/eia", "/api/v1/intelligence/treasury", "/api/v1/intelligence/fx-rate", "/api/v1/intelligence/okx-spec", "/api/v1/intelligence/okx-orderbook", "/api/v1/intelligence/okx-futures-open-interest", "/api/v1/intelligence/alpha-vantage", "/api/v1/intelligence/derivatives", "/api/v1/intelligence/defi-fundamentals", "/api/v1/market-data/candles"]) {
          const response = await fetch(baseUrl + path, {
            method: "POST",
            headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
            body: JSON.stringify({ instrument: "EURUSD" }),
          });
          assert.equal(response.status, 401, path);
          assert.deepEqual(await response.json(), { error: "authentication_required" });
        }
      }, { env, fetchImpl: async () => { throw new Error("provider must not be called without authentication"); } });
    } finally {
      database.close();
    }
  });

  it("validates COT instrument input before contacting the provider", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(baseUrl + "/api/v1/auth/anonymous", {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const response = await fetch(baseUrl + "/api/v1/intelligence/cot", {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ instrument: "!!!" }),
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { success: false, error: "invalid_instrument" });
      }, { env, fetchImpl: async () => { throw new Error("provider must not be called for invalid input"); } });
    } finally {
      database.close();
    }
  });

  it("serves validated dated FX references only to authenticated backend sessions", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    const date = new Date().toISOString().slice(0, 10);
    let providerCalls = 0;
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(baseUrl + "/api/v1/auth/anonymous", {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];

        const invalid = await fetch(baseUrl + "/api/v1/intelligence/fx-rate", {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ from: "EURO", to: "USD" }),
        });
        assert.equal(invalid.status, 400);
        assert.deepEqual(await invalid.json(), { success: false, error: "invalid_fx_currency_pair" });
        assert.equal(providerCalls, 0);

        const response = await fetch(baseUrl + "/api/v1/intelligence/fx-rate", {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ from: "CAD", to: "SGD" }),
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.success, true);
        assert.equal(result.direct.pair, "CAD/SGD");
        assert.equal(result.direct.rate, 0.98);
        assert.match(result.direct.source, /Frankfurter daily reference/);
        assert.equal(providerCalls, 1);
      }, {
        env,
        fetchImpl: async (input) => {
          providerCalls += 1;
          assert.equal(String(input), "https://api.frankfurter.dev/v2/rate/cad/sgd");
          return new Response(JSON.stringify({ base: "CAD", quote: "SGD", date, rate: 0.98 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });
    } finally {
      database.close();
    }
  });

  it("returns an explicit unavailable state when the upstream FX reference provider times out", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    let providerCalls = 0;
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(baseUrl + "/api/v1/auth/anonymous", {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];

        const response = await fetch(baseUrl + "/api/v1/intelligence/fx-rate", {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ from: "AUD", to: "SEK" }),
        });
        assert.equal(response.status, 503);
        const result = await response.json();
        assert.equal(result.success, false);
        assert.match(result.error, /Frankfurter daily FX reference failed/);
        assert.equal(providerCalls, 1);
      }, {
        env,
        fetchImpl: async () => {
          providerCalls += 1;
          throw new Error("simulated upstream timeout");
        },
      });
    } finally {
      database.close();
    }
  });

  it("rejects empty OKX instrument requests before contacting public endpoints", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(baseUrl + "/api/v1/auth/anonymous", {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        for (const path of [
          "/api/v1/intelligence/okx-spec",
          "/api/v1/intelligence/okx-orderbook",
          "/api/v1/intelligence/okx-futures-open-interest",
        ]) {
          const response = await fetch(baseUrl + path, {
            method: "POST",
            headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ instrument: "" }),
          });
          assert.equal(response.status, 400, path);
          assert.deepEqual(await response.json(), { success: false, error: "invalid_instrument" });
        }
      }, { env, fetchImpl: async () => { throw new Error("provider must not be called for invalid input"); } });
    } finally {
      database.close();
    }
  });

  it("does not pretend Google OAuth is configured when credentials are absent", async () => {
    const database = createTemporaryDatabase();
    try {
      await withServer(database, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/auth/google`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "google_auth_not_configured" });

        const browserResponse = await fetch(`${baseUrl}/api/v1/auth/google`, {
          headers: { Accept: "text/html" },
          redirect: "manual",
        });
        assert.equal(browserResponse.status, 302);
        assert.equal(
          browserResponse.headers.get("location"),
          "http://localhost:5173/auth?error=google_auth_not_configured",
        );
      });
    } finally {
      database.close();
    }
  });


  it("persists analysis history per user and enforces the analysis contract", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const analysis = {
          instrument: "BTC-USDT", instrumentType: "crypto", timeframe: "H4",
          bias: "BULLISH", confidence: 72, recommendation: "LONG",
          technicalSummary: "Higher-timeframe structure is constructive.",
          fundamentalSummary: "No material negative catalyst identified.",
          breakdown: { trend: 70, indicator: 68, fundamental: 60, sentiment: 55 },
          keyLevels: { support: "65000", resistance: "70000", invalidation: "63000" },
          riskNote: "Wait for confirmation.", dataCompleteness: "COMPLETE", dataFlags: [],
          price: 67000, dataSource: "OKX",
        };
        const saved = await fetch(`${baseUrl}/api/v1/analyses`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(analysis),
        });
        assert.equal(saved.status, 201);
        const savedItem = (await saved.json()).item;
        assert.equal(savedItem.instrument, "BTC-USDT");
        assert.equal(savedItem.breakdown.trend, 70);

        const history = await fetch(`${baseUrl}/api/v1/analyses`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal((await history.json()).items.length, 1);

        const otherSignIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const otherCookie = otherSignIn.headers.get("set-cookie").split(";")[0];
        const otherHistory = await fetch(`${baseUrl}/api/v1/analyses`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: otherCookie },
        });
        assert.equal((await otherHistory.json()).items.length, 0);

        const invalid = await fetch(`${baseUrl}/api/v1/analyses`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ ...analysis, breakdown: { trend: "bad" } }),
        });
        assert.equal(invalid.status, 400);
      }, { env });
    } finally {
      database.close();
    }
  });

  it("preserves journal ownership and validates lifecycle transitions", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const created = await fetch(`${baseUrl}/api/v1/journal`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            instrument: "ETH-USDT", instrumentType: "crypto", timeframe: "H1",
            style: "SWING", status: "PLANNED",
            analysisSnapshot: {
              analysisId: "analysis-1", decision: "WAIT", bias: "BULLISH", confidence: 65,
              technicalSummary: "Structure pending confirmation.",
              fundamentalSummary: "No strong catalyst.", dataCompleteness: "PARTIAL",
            },
            entry: 3500, stopLoss: 3400, takeProfit: 3800, riskReward: 3,
          }),
        });
        assert.equal(created.status, 201);
        const entry = (await created.json()).item;
        assert.equal(entry.status, "PLANNED");

        const opened = await fetch(`${baseUrl}/api/v1/journal/${entry._id}/transition`, {
          method: "PATCH",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ newStatus: "OPEN" }),
        });
        assert.equal(opened.status, 200);
        assert.equal((await opened.json()).item.status, "OPEN");

        const invalidTransition = await fetch(`${baseUrl}/api/v1/journal/${entry._id}/transition`, {
          method: "PATCH",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ newStatus: "PLANNED" }),
        });
        assert.equal(invalidTransition.status, 409);

        const closed = await fetch(`${baseUrl}/api/v1/journal/${entry._id}/transition`, {
          method: "PATCH",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ newStatus: "CLOSED", pnl: 12.5 }),
        });
        assert.equal(closed.status, 200);
        const closedEntry = (await closed.json()).item;
        assert.equal(closedEntry.status, "CLOSED");
        assert.equal(closedEntry.pnl, 12.5);
        assert.equal(closedEntry.exitPrice, null);

        const combinedFilter = await fetch(
          `${baseUrl}/api/v1/journal?instrument=ETH-USDT&status=OPEN`,
          { headers: { Origin: env.APP_ORIGIN, Cookie: cookie } },
        );
        assert.equal(combinedFilter.status, 200);
        assert.deepEqual((await combinedFilter.json()).items, [],
          "instrument and status filters must both apply when supplied together");

        const matchingFilter = await fetch(
          `${baseUrl}/api/v1/journal?instrument=ETH-USDT&status=CLOSED`,
          { headers: { Origin: env.APP_ORIGIN, Cookie: cookie } },
        );
        assert.equal((await matchingFilter.json()).items.length, 1);

        const otherSignIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const otherCookie = otherSignIn.headers.get("set-cookie").split(";")[0];
        const crossUser = await fetch(`${baseUrl}/api/v1/journal/${entry._id}`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: otherCookie },
        });
        assert.equal(crossUser.status, 404);
      }, { env });
    } finally {
      database.close();
    }
  });


  it("persists monitored positions, alerts, and stream cursors per user", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const position = {
          positionId: "position-btc-1", instrument: "BTC-USDT", side: "LONG",
          entryPrice: 65000, stopLoss: 63000, takeProfit: 70000, leverage: 2,
          horizon: "SWING", openedAt: Date.now(), peakPrice: 67000, peakProfit: 0.03,
          currentSeverity: "WATCH", lifecycleState: "WATCH",
          monitoringLifecycle: "MONITORING", lastUpdateAt: Date.now(),
          lastAlertAt: 0, consecutiveSameSeverity: 1,
        };
        const saved = await fetch(`${baseUrl}/api/v1/positions`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(position),
        });
        assert.equal(saved.status, 200);
        assert.equal((await saved.json()).item.positionId, position.positionId);

        const active = await fetch(`${baseUrl}/api/v1/positions`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal((await active.json()).items.length, 1);

        const alert = await fetch(`${baseUrl}/api/v1/positions/${position.positionId}/alerts`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            alertId: "alert-btc-1", instrument: "BTC-USDT", severity: "HIGH_RISK",
            notificationPriority: "URGENT", reason: "Structure invalidation approaching.",
            action: "Review stop placement.", timestamp: Date.now(),
          }),
        });
        assert.equal(alert.status, 201);
        assert.equal((await alert.json()).item.acknowledged, false);

        const acknowledge = await fetch(`${baseUrl}/api/v1/alerts/alert-btc-1/acknowledge`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal(acknowledge.status, 200);

        const cursor = await fetch(`${baseUrl}/api/v1/stream-cursors`, {
          method: "PUT",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "okx", instrument: "BTC-USDT", lastEventId: "event-1",
            lastTimestamp: Date.now(), lastSequence: 7,
          }),
        });
        assert.equal(cursor.status, 200);

        const loadedCursor = await fetch(`${baseUrl}/api/v1/stream-cursors?provider=okx&instrument=BTC-USDT`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal((await loadedCursor.json()).item.lastSequence, 7);

        const otherSignIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const otherCookie = otherSignIn.headers.get("set-cookie").split(";")[0];
        const isolated = await fetch(`${baseUrl}/api/v1/positions/${position.positionId}`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: otherCookie },
        });
        assert.equal(isolated.status, 404);
      }, { env });
    } finally {
      database.close();
    }
  });


  it("persists custom alert rules, notifications, and notification preferences per user", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];

        const rule = await fetch(`${baseUrl}/api/v1/alert-rules`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            ruleId: "rule-btc-breakout", name: "BTC breakout confirmation",
            enabled: true, scope: "INSTRUMENT", instrument: "BTC-USDT",
            condition: "BREAKOUT_CONFIRMED", severity: "HIGH", cooldownMs: 60000,
          }),
        });
        assert.equal(rule.status, 201);
        assert.equal((await rule.json()).item.enabled, true);

        const history = await fetch(`${baseUrl}/api/v1/alert-rules/history`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            alertId: "rule-alert-1", ruleId: "rule-btc-breakout",
            ruleName: "BTC breakout confirmation", instrument: "BTC-USDT",
            condition: "BREAKOUT_CONFIRMED", severity: "HIGH",
            description: "Price confirmed above the range.", timestamp: Date.now(),
          }),
        });
        assert.equal(history.status, 201);

        const notificationBody = {
          notificationId: "notification-1", alertIdentity: "rule-alert-1",
          ruleId: "rule-btc-breakout", ruleName: "BTC breakout confirmation",
          timestamp: Date.now(), instrument: "BTC-USDT", severity: "HIGH",
          title: "BTC breakout confirmed", message: "The configured breakout condition fired.",
          category: "STRUCTURE", impact: "HIGH", source: "custom-rule",
          condition: "BREAKOUT_CONFIRMED",
        };
        const notification = await fetch(`${baseUrl}/api/v1/notifications`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(notificationBody),
        });
        assert.equal(notification.status, 201);

        const duplicate = await fetch(`${baseUrl}/api/v1/notifications`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(notificationBody),
        });
        assert.equal(duplicate.status, 200);
        assert.equal((await duplicate.json()).deduplicated, true);

        const unread = await fetch(`${baseUrl}/api/v1/notifications/unread-count`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal((await unread.json()).count, 1);

        const marked = await fetch(`${baseUrl}/api/v1/notifications/notification-1/read`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal(marked.status, 200);

        const preferences = await fetch(`${baseUrl}/api/v1/notification-preferences`, {
          method: "PUT",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            minimumSeverity: "MEDIUM", enabledCategories: ["STRUCTURE", "NEWS"],
            enabledScopes: ["POSITION", "INSTRUMENT"], mutedRuleIds: [],
            enabledInstruments: ["BTC-USDT"], mutedInstruments: [],
            showReadNotifications: true, showDismissedNotifications: false,
          }),
        });
        assert.equal(preferences.status, 200);
        assert.equal((await preferences.json()).preferences.minimumSeverity, "MEDIUM");

        const reset = await fetch(`${baseUrl}/api/v1/notification-preferences`, {
          method: "DELETE", headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal(reset.status, 200);
        assert.equal((await reset.json()).preferences.minimumSeverity, "INFO");
      }, { env });
    } finally {
      database.close();
    }
  });


  it("serves the built SPA, immutable assets, and blocks path traversal", async () => {
    const database = createTemporaryDatabase();
    const directory = mkdtempSync(join(tmpdir(), "trade-intel-static-"));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, "assets"), { recursive: true });
    writeFileSync(join(directory, "index.html"), "<main>Trade Intel SPA</main>");
    writeFileSync(join(directory, "assets", "app.a1b2c3d4.js"), "console.log('app');");
    try {
      await withServer(database, async (baseUrl) => {
        const route = await fetch(`${baseUrl}/dashboard`);
        assert.equal(route.status, 200);
        assert.match(route.headers.get("content-type"), /text\/html/);
        assert.equal(route.headers.get("cache-control"), "no-cache");
        assert.equal(await route.text(), "<main>Trade Intel SPA</main>");

        const asset = await fetch(`${baseUrl}/assets/app.a1b2c3d4.js`);
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get("content-type"), /javascript/);
        assert.match(asset.headers.get("cache-control"), /immutable/);

        const missing = await fetch(`${baseUrl}/assets/missing.js`);
        assert.equal(missing.status, 404);

        const traversal = await fetch(`${baseUrl}/..%2F..%2Fetc%2Fpasswd`);
        assert.equal(traversal.status, 403);
      }, { staticDirectory: directory });
    } finally {
      database.close();
    }
  });



  it("completes Google OAuth with state, nonce, PKCE, signature verification and a backend session", async () => {
    const database = createTemporaryDatabase();
    const clientId = "123456789-example.apps.googleusercontent.com";
    const env = {
      NODE_ENV: "production",
      APP_ORIGIN: "https://xstarzganalys.com",
      PUBLIC_BASE_URL: "https://xstarzganalys.com",
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: "gocspx-production-test-secret",
    };
    let oauthFlow;
    let signingKey;
    let idToken;
    const fetchImpl = async (input, options = {}) => {
      const target = String(input);
      if (target === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(options.body);
        assert.equal(form.get("code"), "google-auth-code");
        assert.equal(form.get("client_id"), clientId);
        assert.equal(form.get("client_secret"), env.GOOGLE_CLIENT_SECRET);
        assert.equal(form.get("code_verifier"), oauthFlow.code_verifier);
        assert.equal(form.get("redirect_uri"), "https://xstarzganalys.com/api/v1/auth/google/callback");
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (target === "https://www.googleapis.com/oauth2/v3/certs") {
        return new Response(JSON.stringify({ keys: [signingKey] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected OAuth provider request: ${target}`);
    };

    try {
      await withServer(database, async (baseUrl) => {
        const startResponse = await fetch(`${baseUrl}/api/v1/auth/google`, {
          redirect: "manual",
          headers: { Accept: "text/html" },
        });
        assert.equal(startResponse.status, 302);

        const authorization = new URL(startResponse.headers.get("location"));
        assert.equal(authorization.origin, "https://accounts.google.com");
        assert.equal(authorization.pathname, "/o/oauth2/v2/auth");
        assert.equal(authorization.searchParams.get("client_id"), clientId);
        assert.equal(authorization.searchParams.get("redirect_uri"), "https://xstarzganalys.com/api/v1/auth/google/callback");
        assert.equal(authorization.searchParams.get("response_type"), "code");
        assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
        assert.equal(authorization.searchParams.get("scope"), "openid email profile");

        const state = authorization.searchParams.get("state");
        const nonce = authorization.searchParams.get("nonce");
        const challenge = authorization.searchParams.get("code_challenge");
        assert.ok(state && state.length >= 40);
        assert.ok(nonce && nonce.length >= 40);
        assert.ok(challenge && challenge.length >= 40);

        const stateCookie = startResponse.headers.get("set-cookie");
        assert.ok(stateCookie);
        assert.match(stateCookie, /^__Host-xstarz_oauth_state=/);
        assert.match(stateCookie, /; HttpOnly/);
        assert.match(stateCookie, /; Secure/);

        const stateHash = createHash("sha256").update(state).digest("hex");
        oauthFlow = database.raw.prepare(
          "SELECT nonce, code_verifier, expires_at FROM oauth_flows WHERE state_hash = ?",
        ).get(stateHash);
        assert.ok(oauthFlow);
        assert.equal(oauthFlow.nonce, nonce);
        assert.equal(
          createHash("sha256").update(oauthFlow.code_verifier).digest("base64url"),
          challenge,
        );

        const fixture = createGoogleIdToken({ clientId, nonce });
        signingKey = fixture.jwk;
        idToken = fixture.idToken;

        const callback = await fetch(
          `${baseUrl}/api/v1/auth/google/callback?state=${encodeURIComponent(state)}&code=google-auth-code`,
          {
            redirect: "manual",
            headers: { Cookie: stateCookie.split(";")[0] },
          },
        );
        assert.equal(callback.status, 302);
        assert.equal(callback.headers.get("location"), "https://xstarzganalys.com/dashboard");

        const callbackCookies = callback.headers.get("set-cookie") ?? "";
        const sessionCookie = callbackCookies.match(/__Host-xstarz_session=[^;,]+/)?.[0];
        assert.ok(sessionCookie, "Google callback must issue the backend session cookie");

        const session = await fetch(`${baseUrl}/api/v1/auth/session`, {
          headers: { Cookie: sessionCookie },
        });
        assert.equal(session.status, 200);
        const payload = await session.json();
        assert.equal(payload.user.email, "verified@example.test");
        assert.equal(payload.user.name, "Verified Trader");
        assert.equal(payload.user.isAnonymous, false);

        const persisted = database.raw.prepare(
          "SELECT google_subject FROM users WHERE id = ?",
        ).get(payload.user.id);
        assert.equal(persisted.google_subject, "google-subject-e2e");
        assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM oauth_flows").get().count, 0);
      }, { env, fetchImpl });
    } finally {
      database.close();
    }
  });

  it("rejects Google ID tokens with an invalid nonce, expired claims, or a future issue time", async () => {
    const clientId = "123456789-example.apps.googleusercontent.com";
    const fetchKeys = (jwk) => async () => new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const nonceFixture = createGoogleIdToken({ clientId, nonce: "expected-nonce" });
    await assert.rejects(
      verifyGoogleIdToken(nonceFixture.idToken, {
        clientId,
        nonce: "different-nonce",
        fetchImpl: fetchKeys(nonceFixture.jwk),
      }),
      /claims failed validation/,
    );

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiredFixture = createGoogleIdToken({
      clientId,
      nonce: "expected-nonce",
      expiresAt: nowSeconds - 10,
    });
    await assert.rejects(
      verifyGoogleIdToken(expiredFixture.idToken, {
        clientId,
        nonce: "expected-nonce",
        fetchImpl: fetchKeys(expiredFixture.jwk),
      }),
      /claims failed validation/,
    );

    const futureFixture = createGoogleIdToken({
      clientId,
      nonce: "expected-nonce",
      issuedAt: nowSeconds + 120,
    });
    await assert.rejects(
      verifyGoogleIdToken(futureFixture.idToken, {
        clientId,
        nonce: "expected-nonce",
        fetchImpl: fetchKeys(futureFixture.jwk),
      }),
      /claims failed validation/,
    );
  });

  it("bounds per-user market-analysis rate-limit buckets without evicting active users", () => {
    let now=10_000;
    const allow=createUserRateLimiter(2,1_000,2,()=>now);
    assert.equal(allow("user-a"),true);
    assert.equal(allow("user-a"),true);
    assert.equal(allow("user-a"),false);
    assert.equal(allow("user-b"),true);
    assert.equal(allow("user-c"),false,"a full active bucket table must fail closed");
    assert.equal(allow("user-a"),false,"admitting another identity must not reset an active user's quota");
    now+=1_001;
    assert.equal(allow("user-c"),true,"expired buckets are reclaimed before rejecting new identities");
    assert.equal(allow("user-c"),true);
    assert.equal(allow("user-c"),false);
  });

  it("rate-limits repeated anonymous account creation from one client", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const statuses = [];
        for (let index = 0; index < 11; index += 1) {
          const response = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
            method: "POST", headers: { Origin: env.APP_ORIGIN },
          });
          statuses.push(response.status);
        }
        assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
        assert.equal(statuses[10], 429);
      }, { env });
    } finally {
      database.close();
    }
  });


  it("persists position-owned historical intelligence with deduplication and retention", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const positionId = "history-position-1";
        const position = {
          positionId, instrument: "BTC-USDT", side: "LONG", entryPrice: 65000,
          horizon: "SWING", openedAt: Date.now(), currentSeverity: "WATCH",
          lifecycleState: "WATCH", monitoringLifecycle: "MONITORING",
          lastUpdateAt: Date.now(), lastAlertAt: 0, consecutiveSameSeverity: 0,
        };
        const savedPosition = await fetch(`${baseUrl}/api/v1/positions`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(position),
        });
        assert.equal(savedPosition.status, 200);

        const snapshot = {
          positionId, instrument: "BTC-USDT", side: "LONG", timestamp: Date.now(),
          thesisState: "VALID", evidenceQuality: "HIGH", marketRegime: "TRENDING",
          h1Trend: "BULLISH", m15Trend: "BULLISH", m5Trend: "NEUTRAL",
          mtfAlignment: "PARTIAL", momentum: "POSITIVE", volatility: "NORMAL",
          structure: "HIGHER_HIGH", supportingCount: 4, conflictingCount: 1,
          invalidationCondition: "H1 close below 64000", watchNext: "Retest 66000",
          dataAvailability: "COMPLETE",
        };
        const savedSnapshot = await fetch(`${baseUrl}/api/v1/history/snapshots`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
        });
        assert.equal(savedSnapshot.status, 201);

        const event = {
          timestamp: Date.now(), eventType: "THESIS_CONFIRMED",
          description: "H1 structure confirmed higher high.",
          previousState: "NEUTRAL", currentState: "BULLISH",
          category: "STRUCTURE", strength: "HIGH",
        };
        const events = await fetch(`${baseUrl}/api/v1/history/events`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ positionId, instrument: "BTC-USDT", side: "LONG", events: [event] }),
        });
        assert.equal((await events.json()).inserted, 1);
        const duplicateEvents = await fetch(`${baseUrl}/api/v1/history/events`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ positionId, instrument: "BTC-USDT", side: "LONG", events: [event] }),
        });
        assert.equal((await duplicateEvents.json()).inserted, 0);

        const timeline = await fetch(`${baseUrl}/api/v1/history/timeline?positionId=${positionId}`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        const timelineData = await timeline.json();
        assert.equal(timelineData.latestSnapshot.thesisState, "VALID");
        assert.equal(timelineData.events.length, 1);

        const deleted = await fetch(`${baseUrl}/api/v1/history/positions/${positionId}`, {
          method: "DELETE", headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal((await deleted.json()).deleted, 2);
      }, { env });
    } finally {
      database.close();
    }
  });

  it("deduplicates and bounds user-scoped runtime health snapshots", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const health = {
          timestamp: Date.now(), overallStatus: "HEALTHY",
          components: [{
            component: "market-data", status: "HEALTHY", consecutiveFailures: 0,
            message: "Provider responding.", freshness: "FRESH",
          }],
          intelligenceCycleStatus: "HEALTHY", alertPipelineStatus: "HEALTHY",
          persistenceStatus: "HEALTHY", providerAvailability: { okx: "AVAILABLE" },
          staleComponents: [], unavailableComponents: [],
        };
        const saved = await fetch(`${baseUrl}/api/v1/runtime-health`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(health),
        });
        assert.equal(saved.status, 201);
        const duplicate = await fetch(`${baseUrl}/api/v1/runtime-health`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(health),
        });
        assert.equal((await duplicate.json()).deduplicated, true);

        const latest = await fetch(`${baseUrl}/api/v1/runtime-health/latest`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal((await latest.json()).item.overallStatus, "HEALTHY");
        const history = await fetch(`${baseUrl}/api/v1/runtime-health/history?limit=10`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal((await history.json()).items.length, 1);
      }, { env });
    } finally {
      database.close();
    }
  });


  it("serves SEC filing history and fails closed when the compliant User-Agent is missing", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const history = await fetch(`${baseUrl}/api/v1/fundamentals/sec/AAPL`, {
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal(history.status, 200);
        assert.deepEqual((await history.json()).items, []);

        const refresh = await fetch(`${baseUrl}/api/v1/fundamentals/sec/AAPL`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
        });
        assert.equal(refresh.status, 503);
        assert.equal((await refresh.json()).requiredEnvVar, "SEC_USER_AGENT");
      }, { env });
    } finally {
      database.close();
    }
  });

});