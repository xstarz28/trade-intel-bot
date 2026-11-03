import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((row) => row.version), [
        "0001_app_metadata.sql",
        "0002_trade_intel_domain.sql",
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
          APP_ORIGIN: "https://xstarzganaliys.com",
        },
      });
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

});