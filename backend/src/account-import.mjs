import { getAuthenticatedUser, isAllowedOrigin } from "./auth.mjs";

const IMPORT_TABLES = [
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
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error("Invalid JSON object"), { status: 400 });
  }
}

/**
 * Restores a prior Trade Intel account export into the currently authenticated
 * account. Ownership is always reassigned to the active session; imported
 * ownership fields and account/session credentials are never trusted.
 */
export function createAccountImportHandler({ database, env = process.env }) {
  const tableColumns = new Map(IMPORT_TABLES.map((table) => [
    table,
    new Set(database.raw.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)),
  ]));

  return async (request, response, url) => {
    if (url.pathname !== "/api/v1/account/import") return false;
    if (request.method !== "POST") {
      json(response, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!isAllowedOrigin(request, env)) {
      json(response, 403, { error: "origin_not_allowed" });
      return true;
    }
    const user = getAuthenticatedUser(database, request, env);
    if (!user) {
      json(response, 401, { error: "authentication_required" });
      return true;
    }

    try {
      const input = await readBody(request);
      if (input.format !== "trade-intel-account-export" || input.version !== 1 ||
          !input.data || typeof input.data !== "object" || Array.isArray(input.data)) {
        json(response, 400, { error: "unsupported_account_export" });
        return true;
      }
      const unknownTables = Object.keys(input.data).filter((table) => !IMPORT_TABLES.includes(table));
      if (unknownTables.length) {
        json(response, 400, { error: "unsupported_export_tables", tables: unknownTables });
        return true;
      }

      let totalRows = 0;
      for (const [table, rows] of Object.entries(input.data)) {
        if (!Array.isArray(rows)) {
          json(response, 400, { error: "invalid_export_table", table });
          return true;
        }
        totalRows += rows.length;
        if (totalRows > MAX_ROWS) {
          json(response, 413, { error: "account_export_row_limit_exceeded", maximum: MAX_ROWS });
          return true;
        }
        const columns = tableColumns.get(table);
        for (const row of rows) {
          if (!row || typeof row !== "object" || Array.isArray(row) ||
              Object.keys(row).some((key) => !columns.has(key)) ||
              typeof row.id !== "string" || !row.id) {
            json(response, 400, { error: "invalid_export_row", table });
            return true;
          }
        }
      }

      const inserted = {};
      const skipped = {};
      const raw = database.raw;
      raw.exec("BEGIN IMMEDIATE");
      try {
        for (const table of IMPORT_TABLES) {
          const rows = input.data[table] ?? [];
          const columns = tableColumns.get(table);
          const statementCache = new Map();
          inserted[table] = 0;
          skipped[table] = 0;
          for (const row of rows) {
            const names = [...Object.keys(row), "user_id"];
            const uniqueNames = [...new Set(names)];
            const safeColumns = uniqueNames.filter((name) => columns.has(name));
            let statement = statementCache.get(safeColumns.join(","));
            if (!statement) {
              const sql = `INSERT OR IGNORE INTO ${table} (${safeColumns.join(",")}) VALUES (${safeColumns.map(() => "?").join(",")})`;
              statement = raw.prepare(sql);
              statementCache.set(safeColumns.join(","), statement);
            }
            const values = safeColumns.map((name) => name === "user_id" ? user.id : row[name]);
            const result = statement.run(...values);
            if (result.changes === 1) inserted[table] += 1;
            else skipped[table] += 1;
          }
        }
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }

      json(response, 200, {
        success: true,
        accountId: user.id,
        inserted,
        skipped,
        totalInserted: Object.values(inserted).reduce((sum, count) => sum + count, 0),
        totalSkipped: Object.values(skipped).reduce((sum, count) => sum + count, 0),
      });
      return true;
    } catch (error) {
      json(response, error.status ?? 400, {
        error: error.status === 413 ? "request_too_large" : "account_import_failed",
      });
      return true;
    }
  };
}
