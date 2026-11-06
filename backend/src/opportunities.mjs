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
function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function createOpportunityService({ database, intervalMs = 60_000, fetchImpl = fetch, env = process.env }) {
  let timer;
  let running = false;
  async function runOneBatch() {
    if (running) return { skipped: true, reason: "scan already running" };
    running = true;
    const now = Date.now();
    const claim = database.raw.prepare(
      "UPDATE market_radar_state SET lease_until=? WHERE id=1 AND lease_until<=?",
    ).run(now + 120_000, now);
    if (Number(claim.changes) !== 1) {
      running = false;
      return { skipped: true, reason: "scan lease held" };
    }
    try {
      const state = database.raw.prepare("SELECT * FROM market_radar_state WHERE id=1").get();
      const sources = database.raw.prepare(
        "SELECT payload_json FROM market_radar_sources ORDER BY updated_at DESC LIMIT 300",
      ).all().map(row => safeJson(row.payload_json, null)).filter(Boolean);
      const previousResults = database.raw.prepare(
        "SELECT payload_json FROM market_radar_opportunities ORDER BY updated_at DESC LIMIT 300",
      ).all().map(row => safeJson(row.payload_json, null)).filter(Boolean);
      const engine = await import("../dist/opportunity-engine.mjs");
      const result = await engine.runOpportunityBatch({
        cursor: state.cursor,
        sources,
        previousResults,
        now,
        fetchImpl,
        env,
      });
      database.raw.exec("BEGIN IMMEDIATE");
      try {
        const upsertSource = database.raw.prepare(`
          INSERT INTO market_radar_sources
            (source_key,instrument,timeframe,asset_class,payload_json,observed_at,updated_at)
          VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(source_key) DO UPDATE SET
            payload_json=excluded.payload_json, observed_at=excluded.observed_at,
            updated_at=excluded.updated_at
        `);
        for (const source of result.updates) {
          const market = source.marketData;
          if (!market || !market.price || !Array.isArray(market.candles)) continue;
          const key = source.instrument.toUpperCase() + "|" + market.timeframe.toUpperCase();
          upsertSource.run(key, source.instrument, market.timeframe, source.assetClass,
            JSON.stringify(source), market.price.timestamp, now);
        }
        database.raw.exec("DELETE FROM market_radar_opportunities");
        const insertOpportunity = database.raw.prepare(
          "INSERT INTO market_radar_opportunities (horizon,instrument,payload_json,updated_at,asset_class,score) VALUES (?,?,?,?,?,?)",
        );
        for (const [horizon, items] of result.results) {
          for (const item of items) {
            insertOpportunity.run(horizon, item.instrument, JSON.stringify(item), now, item.assetClass ?? "unknown", Number.isFinite(item.score) ? item.score : 0);
          }
        }
        database.raw.prepare(`
          UPDATE market_radar_state SET cursor=?, lease_until=0, last_scan_at=?,
            metrics_json=?, errors_json=? WHERE id=1
        `).run(result.cursor, result.scannedAt, JSON.stringify(result.metrics),
          JSON.stringify(result.errors));
      database.raw.exec("COMMIT");
      } catch (error) {
        database.raw.exec("ROLLBACK");
        throw error;
      }
      return {
        skipped: false,
        instrument: result.instrument,
        timeframes: result.timeframes,
        savedSources: result.updates.length,
        rankedHorizons: result.results.length,
        metrics: result.metrics,
        errors: result.errors,
        lastScanAt: result.scannedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      database.raw.prepare(
        "UPDATE market_radar_state SET lease_until=0, errors_json=? WHERE id=1",
      ).run(JSON.stringify([message.slice(0, 500)]));
      throw error;
    } finally {
      running = false;
    }
  }
  function start() {
    if (timer) return;
    void runOneBatch().catch(error => console.error("[opportunities] initial scan failed:", error));
    timer = setInterval(() => {
      void runOneBatch().catch(error => console.error("[opportunities] scheduled scan failed:", error));
    }, intervalMs);
    timer.unref?.();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  return { runOneBatch, start, stop };
}

export function createOpportunityHandler({ database, env = process.env, service }) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/v1/opportunities") return false;
    if (request.method !== "GET" && request.method !== "POST") {
      json(response, 405, { error: "method_not_allowed" });
      return true;
    }
    if (request.method === "POST" && !isAllowedOrigin(request, env)) {
      json(response, 403, { error: "origin_not_allowed" });
      return true;
    }
    const user = getAuthenticatedUser(database, request, env);
    if (!user) {
      json(response, 401, { error: "authentication_required" });
      return true;
    }
    if (request.method === "POST") {
      if (!service) {
        json(response, 503, { error: "opportunity_scanner_unavailable" });
        return true;
      }
      try {
        json(response, 200, await service.runOneBatch());
      } catch {
        json(response, 502, { error: "opportunity_scan_failed" });
      }
      return true;
    }
    const state = database.raw.prepare("SELECT * FROM market_radar_state WHERE id=1").get();
    const horizon = url.searchParams.get("horizon");
    const assetClass = url.searchParams.get("assetClass");
    const limitInput = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isInteger(limitInput) ? Math.min(100, Math.max(1, limitInput)) : 50;
    const rows = database.raw.prepare(`
      SELECT payload_json FROM market_radar_opportunities
      WHERE (? IS NULL OR horizon=?) AND (? IS NULL OR asset_class=?)
      ORDER BY score DESC, updated_at DESC, instrument ASC LIMIT ?
    `).all(horizon, horizon, assetClass, assetClass, limit);
    const items = rows.map(row => safeJson(row.payload_json, null)).filter(Boolean);
    json(response, 200, {
      lastScanAt: state.last_scan_at,
      cursor: state.cursor,
      metrics: safeJson(state.metrics_json, {}),
      errors: safeJson(state.errors_json, []),
      items,
      status: state.last_scan_at > 0 ? "available" : "warming_up",
    });
    return true;
  };
}
