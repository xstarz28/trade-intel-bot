const TABLES = [
  "analyses",
  "journal",
  "monitoredPositions",
  "alertHistory",
  "streamCursors",
  "historicalSnapshots",
  "alertRules",
  "ruleAlertHistory",
  "notifications",
  "notificationPreferences",
  "historicalEvents",
  "runtimeHealthSnapshots",
];

const JSON_COLUMNS = new Set([
  "no_trade_reasons",
  "breakdown",
  "key_levels",
  "data_flags",
  "analysis_snapshot",
  "components",
  "provider_availability",
  "stale_components",
  "unavailable_components",
  "enabled_categories",
  "enabled_scopes",
  "muted_rule_ids",
  "enabled_instruments",
  "muted_instruments",
]);

const BOOLEAN_COLUMNS = new Set([
  "enabled",
  "acknowledged",
  "read",
  "dismissed",
  "show_read_notifications",
  "show_dismissed_notifications",
]);

function snakeCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function mapRow(table, row, sourceAccountId) {
  if (!row || typeof row !== "object" || Array.isArray(row) ||
      typeof row._id !== "string" || !row._id) {
    throw Object.assign(new Error(`Invalid Convex export row in ${table}`), { status: 400 });
  }

  if (row.userId !== sourceAccountId) {
    throw Object.assign(new Error(`Convex export row in ${table} does not belong to its declared source account`), {
      status: 409,
      code: "convex_export_row_owner_mismatch",
    });
  }

  const mapped = { id: row._id };
  for (const [key, rawValue] of Object.entries(row)) {
    if (key === "_id" || key === "_creationTime" || key === "timestamps") continue;
    const column = snakeCase(key);
    let value = rawValue;
    if (value === undefined) continue;
    if (JSON_COLUMNS.has(column)) value = JSON.stringify(value);
    else if (BOOLEAN_COLUMNS.has(column)) value = value ? 1 : 0;
    mapped[column] = value;
  }

  if (table === "journal") {
    const timestamps = row.timestamps;
    if (!timestamps || typeof timestamps.createdAt !== "number" ||
        typeof timestamps.updatedAt !== "number") {
      throw Object.assign(new Error("Invalid Convex journal timestamps"), { status: 400 });
    }
    mapped.created_at = timestamps.createdAt;
    mapped.updated_at = timestamps.updatedAt;
  } else if (table === "analyses") {
    mapped.created_at = typeof row._creationTime === "number"
      ? row._creationTime
      : row.timestamp;
  }

  return mapped;
}

/**
 * Converts the explicit, authenticated Convex export format into the existing
 * backend export format. The target account must match by email, or the caller
 * must explicitly confirm the source Convex account ID for an email-less guest.
 */
export function normalizeConvexAccountExport(input, targetUser) {
  if (!input || input.format !== "trade-intel-convex-account-export" ||
      input.version !== 1 || !input.account ||
      typeof input.account !== "object" || Array.isArray(input.account) ||
      !input.data || typeof input.data !== "object" || Array.isArray(input.data)) {
    throw Object.assign(new Error("Unsupported Convex account export"), { status: 400 });
  }
  if (typeof input.account.id !== "string" || !input.account.id.trim()) {
    throw Object.assign(new Error("Convex account export is missing its source account ID"), {
      status: 400,
      code: "invalid_convex_source_account",
    });
  }
  if (input.account.email !== null && input.account.email !== undefined &&
      typeof input.account.email !== "string") {
    throw Object.assign(new Error("Convex account export has an invalid source email"), {
      status: 400,
      code: "invalid_convex_source_account",
    });
  }

  const sourceEmail = typeof input.account.email === "string"
    ? input.account.email.trim().toLowerCase()
    : "";
  const targetEmail = typeof targetUser.email === "string"
    ? targetUser.email.trim().toLowerCase()
    : "";

  if (sourceEmail) {
    if (!targetEmail || sourceEmail !== targetEmail) {
      throw Object.assign(new Error("Convex export email does not match the signed-in backend account"), {
        status: 409,
        code: "convex_account_identity_mismatch",
      });
    }
  } else if (input.confirmSourceAccountId !== input.account.id) {
    throw Object.assign(new Error("Explicit confirmation of the email-less Convex account is required"), {
      status: 409,
      code: "convex_source_account_confirmation_required",
    });
  }

  const unknownTables = Object.keys(input.data).filter((table) => !TABLES.includes(table));
  if (unknownTables.length) {
    throw Object.assign(new Error("Unsupported Convex export tables"), { status: 400 });
  }

  const data = {};
  const counts = {};
  let totalRows = 0;
  for (const table of TABLES) {
    const rows = input.data[table] ?? [];
    if (!Array.isArray(rows)) {
      throw Object.assign(new Error(`Invalid Convex export table: ${table}`), { status: 400 });
    }
    totalRows += rows.length;
    if (totalRows > 10_000) {
      throw Object.assign(new Error("Convex account export row limit exceeded"), { status: 413 });
    }
    data[snakeCase(table)] = rows.map((row) => mapRow(table, row, input.account.id));
    counts[snakeCase(table)] = rows.length;
    if (input.counts !== undefined &&
        (!input.counts || typeof input.counts !== "object" ||
         Array.isArray(input.counts) || input.counts[table] !== rows.length)) {
      throw Object.assign(new Error(`Convex export count mismatch for ${table}`), {
        status: 400,
        code: "convex_export_count_mismatch",
      });
    }
  }

  return {
    format: "trade-intel-account-export",
    version: 1,
    data,
    counts,
  };
}
