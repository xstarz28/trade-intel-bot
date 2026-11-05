import { getAuthenticatedUser, isAllowedOrigin } from "./auth.mjs";
import { normalizeConvexAccountExport } from "./convex-account-import.mjs";

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
  const tableMetadata = new Map(IMPORT_TABLES.map((table) => {
    const columns = database.raw.prepare(`PRAGMA table_info(${table})`).all();
    return [table, {
      allowed: new Set(columns.map((column) => column.name)),
      required: new Set(columns
        .filter((column) => column.notnull && column.dflt_value === null)
        .map((column) => column.name)
        .filter((column) => column !== "id" && column !== "user_id")),
    }];
  }));

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
      const rawInput = await readBody(request);
      const input = rawInput.format === "trade-intel-convex-account-export"
        ? normalizeConvexAccountExport(rawInput, user)
        : rawInput;
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
        const metadata = tableMetadata.get(table);
        for (const row of rows) {
          if (!row || typeof row !== "object" || Array.isArray(row) ||
              Object.keys(row).some((key) => !metadata.allowed.has(key)) ||
              typeof row.id !== "string" || !row.id) {
            json(response, 400, { error: "invalid_export_row", table });
            return true;
          }
          const missing = [...metadata.required].filter((column) => !(column in row));
          if (missing.length) {
            json(response, 400, { error: "incomplete_export_row", table, missing });
            return true;
          }
        }
      }

      const sourceCounts = Object.fromEntries(
        IMPORT_TABLES.map((table) => [table, (input.data[table] ?? []).length]),
      );
      if (input.counts !== undefined) {
        if (!input.counts || typeof input.counts !== "object" || Array.isArray(input.counts) ||
            IMPORT_TABLES.some((table) => input.counts[table] !== sourceCounts[table])) {
          json(response, 400, { error: "account_export_count_mismatch" });
          return true;
        }
      }

      const inserted = {};
      const skipped = {};
      const raw = database.raw;
      raw.exec("BEGIN IMMEDIATE");
      try {
        for (const table of IMPORT_TABLES) {
          const rows = input.data[table] ?? [];
          const columns = tableMetadata.get(table).allowed;
          const statementCache = new Map();
          inserted[table] = 0;
          skipped[table] = 0;
          const findById = raw.prepare(`SELECT * FROM ${table} WHERE id = ?`);
          for (const row of rows) {
            const names = [...Object.keys(row), "user_id"];
            const uniqueNames = [...new Set(names)];
            const safeColumns = uniqueNames.filter((name) => columns.has(name));
            const values = safeColumns.map((name) => name === "user_id" ? user.id : row[name]);
            const existing = findById.get(row.id);
            if (existing) {
              const sameOwner = existing.user_id === user.id;
              const samePayload = safeColumns.every((name, index) => existing[name] === values[index]);
              if (!sameOwner || !samePayload) {
                throw Object.assign(new Error(`Conflicting imported record in ${table}`), {
                  status: 409,
                  code: "account_import_record_conflict",
                });
              }
              skipped[table] += 1;
              continue;
            }
            let statement = statementCache.get(safeColumns.join(","));
            if (!statement) {
              const sql = `INSERT OR IGNORE INTO ${table} (${safeColumns.join(",")}) VALUES (${safeColumns.map(() => "?").join(",")})`;
              statement = raw.prepare(sql);
              statementCache.set(safeColumns.join(","), statement);
            }
            const result = statement.run(...values);
            if (result.changes === 1) inserted[table] += 1;
            else {
              throw Object.assign(new Error(`Conflicting unique key in ${table}`), {
                status: 409,
                code: "account_import_record_conflict",
              });
            }
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
        sourceCounts,
        inserted,
        skipped,
        reconciled: IMPORT_TABLES.every((table) =>
          sourceCounts[table] === inserted[table] + skipped[table]),
        totalSource: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
        totalInserted: Object.values(inserted).reduce((sum, count) => sum + count, 0),
        totalSkipped: Object.values(skipped).reduce((sum, count) => sum + count, 0),
      });
      return true;
    } catch (error) {
      json(response, error.status ?? 400, {
        error: error.code ?? (error.status === 413 ? "request_too_large" : "account_import_failed"),
      });
      return true;
    }
  };
}
