import { randomUUID } from "node:crypto";
import { getAuthenticatedUser, isAllowedOrigin } from "./auth.mjs";

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
    if (size > 256_000) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error("Invalid JSON object"), { status: 400 });
  }
}

function text(value, name) {
  if (typeof value !== "string" || !value.trim()) throw Object.assign(new Error(`${name} is required`), { status: 400 });
  return value;
}
function number(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw Object.assign(new Error(`${name} must be finite`), { status: 400 });
  return value;
}
function optionalNumber(value, name) {
  return value === undefined ? null : number(value, name);
}
function optionalBoolean(value, name) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw Object.assign(new Error(`${name} must be boolean`), { status: 400 });
  return value;
}

function positionView(row) {
  return {
    _id: row.id, userId: row.user_id, positionId: row.position_id,
    instrument: row.instrument, side: row.side, entryPrice: row.entry_price,
    stopLoss: row.stop_loss, takeProfit: row.take_profit, leverage: row.leverage,
    horizon: row.horizon, openedAt: row.opened_at, peakPrice: row.peak_price,
    peakProfit: row.peak_profit, currentSeverity: row.current_severity,
    lifecycleState: row.lifecycle_state, monitoringLifecycle: row.monitoring_lifecycle,
    lastUpdateAt: row.last_update_at, lastAlertAt: row.last_alert_at,
    consecutiveSameSeverity: row.consecutive_same_severity,
  };
}

function alertView(row) {
  return {
    _id: row.id, alertId: row.alert_id, positionId: row.position_id,
    instrument: row.instrument, severity: row.severity,
    notificationPriority: row.notification_priority, reason: row.reason,
    action: row.action, timestamp: row.timestamp, acknowledged: Boolean(row.acknowledged),
  };
}

export function createPositionHandler({ database, env = process.env }) {
  return async (request, response, url) => {
    const path = url.pathname;
    const method = request.method ?? "GET";
    if (!path.startsWith("/api/v1/positions") &&
        !path.startsWith("/api/v1/alerts/") &&
        path !== "/api/v1/stream-cursors") return false;

    if (method !== "GET" && !isAllowedOrigin(request, env)) {
      json(response, 403, { error: "origin_not_allowed" });
      return true;
    }
    const user = getAuthenticatedUser(database, request, env);
    if (!user) {
      json(response, 401, { error: "authentication_required" });
      return true;
    }

    try {
      if (path === "/api/v1/positions" && method === "GET") {
        const rows = database.raw.prepare(
          "SELECT * FROM monitored_positions WHERE user_id = ? AND monitoring_lifecycle = 'MONITORING' ORDER BY opened_at DESC",
        ).all(user.id);
        json(response, 200, { items: rows.map(positionView) });
        return true;
      }

      if (path === "/api/v1/positions" && method === "POST") {
        const input = await readBody(request);
        const value = {
          positionId: text(input.positionId, "positionId"),
          instrument: text(input.instrument, "instrument"),
          side: text(input.side, "side"),
          entryPrice: number(input.entryPrice, "entryPrice"),
          stopLoss: optionalNumber(input.stopLoss, "stopLoss"),
          takeProfit: optionalNumber(input.takeProfit, "takeProfit"),
          leverage: optionalNumber(input.leverage, "leverage"),
          horizon: text(input.horizon, "horizon"),
          openedAt: number(input.openedAt, "openedAt"),
          peakPrice: optionalNumber(input.peakPrice, "peakPrice"),
          peakProfit: optionalNumber(input.peakProfit, "peakProfit"),
          currentSeverity: text(input.currentSeverity, "currentSeverity"),
          lifecycleState: text(input.lifecycleState, "lifecycleState"),
          monitoringLifecycle: text(input.monitoringLifecycle, "monitoringLifecycle"),
          lastUpdateAt: number(input.lastUpdateAt, "lastUpdateAt"),
          lastAlertAt: number(input.lastAlertAt, "lastAlertAt"),
          consecutiveSameSeverity: number(input.consecutiveSameSeverity, "consecutiveSameSeverity"),
        };
        const id = randomUUID();
        database.raw.prepare(`
          INSERT INTO monitored_positions (
            id,user_id,position_id,instrument,side,entry_price,stop_loss,take_profit,leverage,
            horizon,opened_at,peak_price,peak_profit,current_severity,lifecycle_state,
            monitoring_lifecycle,last_update_at,last_alert_at,consecutive_same_severity
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(user_id,position_id) DO UPDATE SET
            instrument=excluded.instrument,side=excluded.side,entry_price=excluded.entry_price,
            stop_loss=excluded.stop_loss,take_profit=excluded.take_profit,leverage=excluded.leverage,
            horizon=excluded.horizon,opened_at=excluded.opened_at,peak_price=excluded.peak_price,
            peak_profit=excluded.peak_profit,current_severity=excluded.current_severity,
            lifecycle_state=excluded.lifecycle_state,monitoring_lifecycle=excluded.monitoring_lifecycle,
            last_update_at=excluded.last_update_at,last_alert_at=excluded.last_alert_at,
            consecutive_same_severity=excluded.consecutive_same_severity
        `).run(
          id,user.id,value.positionId,value.instrument,value.side,value.entryPrice,value.stopLoss,
          value.takeProfit,value.leverage,value.horizon,value.openedAt,value.peakPrice,value.peakProfit,
          value.currentSeverity,value.lifecycleState,value.monitoringLifecycle,value.lastUpdateAt,
          value.lastAlertAt,value.consecutiveSameSeverity,
        );
        const row = database.raw.prepare(
          "SELECT * FROM monitored_positions WHERE user_id = ? AND position_id = ?",
        ).get(user.id,value.positionId);
        json(response, 200, { item: positionView(row) });
        return true;
      }

      const position = path.match(/^\/api\/v1\/positions\/([a-zA-Z0-9_-]+)$/);
      const positionAlerts = path.match(/^\/api\/v1\/positions\/([a-zA-Z0-9_-]+)\/alerts$/);
      if (position && method === "GET") {
        const row = database.raw.prepare(
          "SELECT * FROM monitored_positions WHERE user_id = ? AND position_id = ?",
        ).get(user.id,position[1]);
        json(response,row ? 200 : 404,row ? {item:positionView(row)} : {error:"position_not_found"});
        return true;
      }
      if (position && method === "DELETE") {
        const result = database.raw.prepare(
          "DELETE FROM monitored_positions WHERE user_id = ? AND position_id = ?",
        ).run(user.id,position[1]);
        json(response,result.changes ? 200 : 404,result.changes ? {success:true} : {error:"position_not_found"});
        return true;
      }

      if (positionAlerts && method === "GET") {
        const limit = Math.max(1,Math.min(200,Number(url.searchParams.get("limit") ?? 50) || 50));
        const rows = database.raw.prepare(
          "SELECT * FROM alert_history WHERE user_id = ? AND position_id = ? ORDER BY timestamp DESC LIMIT ?",
        ).all(user.id,positionAlerts[1],limit);
        json(response,200,{items:rows.map(alertView)});
        return true;
      }
      if (positionAlerts && method === "POST") {
        const input = await readBody(request);
        const id = randomUUID();
        const value = {
          alertId:text(input.alertId,"alertId"), positionId:positionAlerts[1],
          instrument:text(input.instrument,"instrument"), severity:text(input.severity,"severity"),
          notificationPriority:text(input.notificationPriority,"notificationPriority"),
          reason:text(input.reason,"reason"), action:text(input.action,"action"),
          timestamp:number(input.timestamp,"timestamp"),
          acknowledged:optionalBoolean(input.acknowledged,"acknowledged"),
        };
        database.raw.prepare(`
          INSERT INTO alert_history (
            id,user_id,alert_id,position_id,instrument,severity,notification_priority,
            reason,action,timestamp,acknowledged
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(user_id,alert_id) DO UPDATE SET
            severity=excluded.severity,notification_priority=excluded.notification_priority,
            reason=excluded.reason,action=excluded.action,timestamp=excluded.timestamp,
            acknowledged=excluded.acknowledged
        `).run(id,user.id,value.alertId,value.positionId,value.instrument,value.severity,
          value.notificationPriority,value.reason,value.action,value.timestamp,value.acknowledged ? 1 : 0);
        const row = database.raw.prepare(
          "SELECT * FROM alert_history WHERE user_id = ? AND alert_id = ?",
        ).get(user.id,value.alertId);
        json(response,201,{item:alertView(row)});
        return true;
      }

      const ack = path.match(/^\/api\/v1\/alerts\/([a-zA-Z0-9_-]+)\/acknowledge$/);
      if (ack && method === "POST") {
        const result = database.raw.prepare(
          "UPDATE alert_history SET acknowledged = 1 WHERE user_id = ? AND alert_id = ?",
        ).run(user.id,ack[1]);
        json(response,result.changes ? 200 : 404,result.changes ? {success:true} : {error:"alert_not_found"});
        return true;
      }

      if (path === "/api/v1/stream-cursors" && method === "GET") {
        const provider = url.searchParams.get("provider");
        const instrument = url.searchParams.get("instrument");
        if (!provider || !instrument) { json(response,400,{error:"provider_and_instrument_required"}); return true; }
        const row = database.raw.prepare(
          "SELECT * FROM stream_cursors WHERE user_id = ? AND provider = ? AND instrument = ?",
        ).get(user.id,provider,instrument);
        json(response,200,{item:row ? {
          _id:row.id,provider:row.provider,instrument:row.instrument,lastEventId:row.last_event_id,
          lastTimestamp:row.last_timestamp,lastSequence:row.last_sequence,
        } : null});
        return true;
      }
      if (path === "/api/v1/stream-cursors" && method === "PUT") {
        const input = await readBody(request);
        const provider = text(input.provider,"provider");
        const instrument = text(input.instrument,"instrument");
        const id = randomUUID();
        database.raw.prepare(`
          INSERT INTO stream_cursors (id,user_id,provider,instrument,last_event_id,last_timestamp,last_sequence)
          VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(user_id,provider,instrument) DO UPDATE SET
            last_event_id=excluded.last_event_id,last_timestamp=excluded.last_timestamp,
            last_sequence=excluded.last_sequence
        `).run(id,user.id,provider,instrument,text(input.lastEventId,"lastEventId"),
          number(input.lastTimestamp,"lastTimestamp"),optionalNumber(input.lastSequence,"lastSequence"));
        json(response,200,{success:true});
        return true;
      }

      json(response,404,{error:"route_not_found"});
      return true;
    } catch (error) {
      json(response,Number.isInteger(error?.status) ? error.status : 400,{error:error.message || "invalid_request"});
      return true;
    }
  };
}
