import { afterEach, describe, it } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../src/database.mjs";
import { createOpportunityHandler, createOpportunityService } from "../src/opportunities.mjs";

const directories = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "trade-intel-opportunities-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "test.sqlite"), resolve("migrations"));
  return { directory, database };
}
function responseCapture() {
  return {
    status: 0, headers: {}, body: "",
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body = "") { this.body = body; },
  };
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("self-hosted opportunity scanner persistence", () => {
  it("creates durable radar state, source, and opportunity tables through migrations", () => {
    const { database } = fixture();
    const tables = database.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'market_radar_%' ORDER BY name",
    ).all().map(row => row.name);
    assert.deepEqual(tables, [
      "market_radar_opportunities",
      "market_radar_sources",
      "market_radar_state",
    ]);
    const state = database.raw.prepare("SELECT cursor, lease_until, lease_owner, last_scan_at FROM market_radar_state WHERE id=1").get();
    assert.equal(state.cursor, 0);
    assert.equal(state.lease_until, 0);
    assert.equal(state.lease_owner, "");
    assert.equal(state.last_scan_at, 0);
    database.close();
  });

  it("does not start a second scan while a durable lease is held", async () => {
    const { database } = fixture();
    database.raw.prepare("UPDATE market_radar_state SET lease_until=? WHERE id=1").run(Date.now() + 60_000);
    const service = createOpportunityService({ database });
    assert.deepEqual(await service.runOneBatch(), { skipped: true, reason: "scan lease held" });
    database.close();
  });



  it("does not let a stale scanner overwrite results after another worker takes the lease", async () => {
    const { database } = fixture();
    let takeover = false;
    const service = createOpportunityService({
      database,
      env: {},
      fetchImpl: async () => {
        if (!takeover) {
          takeover = true;
          database.raw.prepare(
            "UPDATE market_radar_state SET lease_owner=?, lease_until=? WHERE id=1",
          ).run("replacement-worker", Date.now() + 120_000);
        }
        return new Response("{}", { status: 503 });
      },
    });
    try {
      await assert.rejects(service.runOneBatch(), /lease was lost/);
      const state = database.raw.prepare(
        "SELECT lease_owner, lease_until, last_scan_at FROM market_radar_state WHERE id=1",
      ).get();
      assert.equal(state.lease_owner, "replacement-worker");
      assert.ok(state.lease_until > Date.now());
      assert.equal(state.last_scan_at, 0);
    } finally {
      database.close();
    }
  });

  it("persists failed acquisition attempts so an unavailable instrument is not retried forever", async () => {
    const { database } = fixture();
    const service = createOpportunityService({
      database,
      env: {},
      fetchImpl: async () => new Response("{}", { status: 503 }),
    });
    try {
      const result = await service.runOneBatch();
      assert.equal(result.skipped, false);
      assert.equal(result.savedSources, 0);
      const state = database.raw.prepare("SELECT metrics_json FROM market_radar_state WHERE id=1").get();
      const metrics = JSON.parse(state.metrics_json);
      assert.equal(metrics.scanAttemptTimestamps["BTC/USD"], result.lastScanAt);
    } finally {
      database.close();
    }
  });

  it("recovers the scanner after a transient durable-lease acquisition failure", async () => {
    const { database } = fixture();
    const originalPrepare = database.raw.prepare.bind(database.raw);
    let failFirstClaim = true;
    const raw = new Proxy(database.raw, {
      get(target, property) {
        if (property === "prepare") {
          return (sql) => {
            if (failFirstClaim && sql.includes("UPDATE market_radar_state SET lease_owner=")) {
              failFirstClaim = false;
              throw new Error("temporary sqlite busy");
            }
            return originalPrepare(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const service = createOpportunityService({
      database: { raw },
      env: {},
      fetchImpl: async () => new Response("{}", { status: 503 }),
    });
    try {
      await assert.rejects(service.runOneBatch(), /temporary sqlite busy/);
      const recovered = await service.runOneBatch();
      assert.equal(recovered.skipped, false);
      assert.equal(recovered.savedSources, 0);
    } finally {
      database.close();
    }
  });

  it("builds a persisted multi-horizon candidate from exact provider candles", async () => {
    const { database } = fixture();
    const { runOpportunityBatch } = await import("../dist/opportunity-engine.mjs");
    const fetchImpl = async (input) => {
      const url = new URL(String(input));
      const interval = url.searchParams.get("bar") === "1D" ? 86_400_000 : 3_600_000;
      const now = Date.now();
      const data = Array.from({ length: 80 }, (_, index) => {
        const timestamp = now - (79 - index) * interval;
        const open = 100 + index * 0.25;
        return [String(timestamp), String(open), String(open + 1), String(open - 1), String(open + 0.5), "1200"];
      });
      return new Response(JSON.stringify({ code: "0", data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const result = await runOpportunityBatch({
        cursor: 0,
        sources: [],
        previousResults: [],
        fetchImpl,
        env: {},
      });
      assert.equal(result.cursor, 1);
      assert.equal(result.updates.length, 2);
      assert.ok(result.updates.every(source => source.marketData?.candles.length === 80));
      assert.ok(result.updates.every(source => source.technicalData));
      assert.equal(result.results.length, 9);
      assert.ok(result.metrics.totalScanned >= 1);
    } finally {
      database.close();
    }
  });


  it("rate-limits manual radar scans per authenticated user without blocking other users", async () => {
    const { database } = fixture();
    const now = Date.now();
    const createSession = (userId, token) => {
      database.raw.prepare(
        "INSERT INTO users (id, name, is_anonymous, role, created_at, updated_at) VALUES (?, ?, 1, 'user', ?, ?)",
      ).run(userId, userId, now, now);
      database.raw.prepare(
        "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(randomUUID(), userId, createHash("sha256").update(token).digest("hex"), now + 60_000, now, now);
    };
    createSession("radar-user-a", "a".repeat(48));
    createSession("radar-user-b", "b".repeat(48));
    let scans = 0;
    const handler = createOpportunityHandler({
      database,
      env: { NODE_ENV: "development" },
      service: { async runOneBatch() { scans += 1; return { skipped: false }; } },
    });
    const invoke = async (token) => {
      const response = responseCapture();
      await handler(
        { method: "POST", headers: { cookie: `xstarz_session=${token}` } },
        response,
        new URL("http://localhost/api/v1/opportunities"),
      );
      return response;
    };
    try {
      const first = await invoke("a".repeat(48));
      assert.equal(first.status, 200);
      const second = await invoke("a".repeat(48));
      assert.equal(second.status, 429);
      assert.equal(second.headers["retry-after"], "30");
      assert.deepEqual(JSON.parse(second.body), {
        error: "manual_opportunity_scan_rate_limited",
        retryAfterSeconds: 30,
      });
      const otherUser = await invoke("b".repeat(48));
      assert.equal(otherUser.status, 200);
      assert.equal(scans, 2);
    } finally {
      database.close();
    }
  });

  it("requires an authenticated backend session before exposing opportunities", async () => {
    const { database } = fixture();
    const handler = createOpportunityHandler({ database });
    const response = responseCapture();
    const handled = await handler({ method: "GET", headers: {} }, response, new URL("http://localhost/api/v1/opportunities"));
    assert.equal(handled, true);
    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(response.body), { error: "authentication_required" });
    database.close();
  });
});
