import { afterEach, describe, expect, it } from "node:test";
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
    const state = database.raw.prepare("SELECT cursor, lease_until, last_scan_at FROM market_radar_state WHERE id=1").get();
    assert.deepEqual(state, { cursor: 0, lease_until: 0, last_scan_at: 0 });
    database.close();
  });

  it("does not start a second scan while a durable lease is held", async () => {
    const { database } = fixture();
    database.raw.prepare("UPDATE market_radar_state SET lease_until=? WHERE id=1").run(Date.now() + 60_000);
    const service = createOpportunityService({ database });
    assert.deepEqual(await service.runOneBatch(), { skipped: true, reason: "scan lease held" });
    database.close();
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
