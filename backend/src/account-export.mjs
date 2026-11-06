import { getAuthenticatedUser } from "./auth.mjs";

const MAX_EXPORT_ROWS = 10_000;
const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

const EXPORT_TABLES = [
  "analyses",
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
];

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": 'attachment; filename="trade-intel-account-export.json"',
  });
  response.end(body);
}

/**
 * Provides a portable, user-scoped export of self-hosted Trade Intel records.
 * Authentication sessions, OAuth secrets, and global provider observations are
 * intentionally excluded. The fixed table allowlist prevents arbitrary SQL.
 */
export function createAccountExportHandler({ database, env = process.env }) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/v1/account/export") return false;
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return true;
    }

    const user = getAuthenticatedUser(database, request, env);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const raw = database.raw;
    const exportData = {
      format: "trade-intel-account-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
        isAnonymous: Boolean(user.isAnonymous),
        role: user.role,
      },
      data: {},
      counts: {},
    };

    for (const table of EXPORT_TABLES) {
      exportData.data[table] = [];
      exportData.counts[table] = 0;
    }

    raw.exec("BEGIN");
    try {
      let totalRows = 0;
      let projectedBytes = Buffer.byteLength(JSON.stringify(exportData), "utf8");
      for (const table of EXPORT_TABLES) {
        const rows = raw.prepare(
          `SELECT * FROM ${table} WHERE user_id = ? LIMIT ?`,
        ).iterate(user.id, MAX_EXPORT_ROWS + 1);
        for (const row of rows) {
          if (totalRows >= MAX_EXPORT_ROWS) {
            raw.exec("ROLLBACK");
            sendJson(response, 413, {
              error: "account_export_row_limit_exceeded",
              maximum: MAX_EXPORT_ROWS,
              observedRows: totalRows + 1,
            });
            return true;
          }

          const previousCount = exportData.counts[table];
          const nextCount = previousCount + 1;
          const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
          projectedBytes += rowBytes + (previousCount > 0 ? 1 : 0) +
            String(nextCount).length - String(previousCount).length;
          if (projectedBytes > MAX_EXPORT_BYTES) {
            raw.exec("ROLLBACK");
            sendJson(response, 413, {
              error: "account_export_size_limit_exceeded",
              maximumBytes: MAX_EXPORT_BYTES,
            });
            return true;
          }

          exportData.data[table].push(row);
          exportData.counts[table] = nextCount;
          totalRows += 1;
        }
      }
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }

    const serialized = JSON.stringify(exportData);
    if (Buffer.byteLength(serialized, "utf8") > MAX_EXPORT_BYTES) {
      sendJson(response, 413, {
        error: "account_export_size_limit_exceeded",
        maximumBytes: MAX_EXPORT_BYTES,
      });
      return true;
    }

    sendJson(response, 200, exportData);
    return true;
  };
}
