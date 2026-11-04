import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConvexAccountExport } from "../src/convex-account-import.mjs";

const targetUser = { id: "backend-user-1", email: "trader@example.test" };

describe("native Convex account export mapping", () => {
  it("maps private records into the backend SQL shape and reassigns account ownership later", () => {
    const exported = normalizeConvexAccountExport({
      format: "trade-intel-convex-account-export",
      version: 1,
      account: { id: "convex-user-1", email: "TRADER@example.test" },
      data: {
        analyses: [{
          _id: "analysis-1",
          _creationTime: 100,
          userId: "convex-user-1",
          instrument: "BTC-USDT",
          instrumentType: "crypto",
          timeframe: "H4",
          bias: "BULLISH",
          confidence: 80,
          breakdown: { trend: 1, indicator: 1, fundamental: 0, sentiment: 0 },
          keyLevels: { support: "1", resistance: "2", invalidation: "0" },
          riskNote: "Defined risk",
          dataCompleteness: "complete",
          dataFlags: [],
          timestamp: 99,
        }],
        journal: [{
          _id: "journal-1",
          userId: "convex-user-1",
          instrument: "BTC-USDT",
          instrumentType: "crypto",
          timeframe: "H4",
          style: "SWING",
          analysisSnapshot: { analysisId: "analysis-1", confidence: 80 },
          status: "PLANNED",
          timestamps: { createdAt: 200, updatedAt: 201 },
        }],
        monitoredPositions: [{
          _id: "position-1",
          userId: "convex-user-1",
          positionId: "position-key",
          instrument: "BTC-USDT",
          side: "LONG",
          entryPrice: 100,
          horizon: "SWING",
          openedAt: 300,
          currentSeverity: "NONE",
          lifecycleState: "MONITORING",
          monitoringLifecycle: "MONITORING",
          lastUpdateAt: 301,
          lastAlertAt: 0,
          consecutiveSameSeverity: 0,
        }],
        notificationPreferences: [{
          _id: "preferences-1",
          userId: "convex-user-1",
          minimumSeverity: "INFO",
          enabledCategories: ["NEWS"],
          enabledScopes: [],
          mutedRuleIds: [],
          enabledInstruments: ["BTC-USDT"],
          mutedInstruments: [],
          showReadNotifications: true,
          showDismissedNotifications: false,
          updatedAt: 400,
        }],
      },
    }, targetUser);

    assert.equal(exported.format, "trade-intel-account-export");
    assert.equal(exported.data.analyses[0].id, "analysis-1");
    assert.equal(exported.data.analyses[0].user_id, "convex-user-1");
    assert.equal(exported.data.analyses[0].created_at, 100);
    assert.equal(exported.data.analyses[0].breakdown,
      JSON.stringify({ trend: 1, indicator: 1, fundamental: 0, sentiment: 0 }));
    assert.equal(exported.data.journal[0].analysis_snapshot,
      JSON.stringify({ analysisId: "analysis-1", confidence: 80 }));
    assert.equal(exported.data.journal[0].created_at, 200);
    assert.equal(exported.data.journal[0].updated_at, 201);
    assert.equal(exported.data.monitored_positions[0].entry_price, 100);
    assert.equal(exported.data.notification_preferences[0].show_read_notifications, 1);
    assert.equal(exported.data.notification_preferences[0].show_dismissed_notifications, 0);
  });

  it("rejects a Convex export whose email does not match the backend account", () => {
    assert.throws(
      () => normalizeConvexAccountExport({
        format: "trade-intel-convex-account-export",
        version: 1,
        account: { id: "convex-user-1", email: "someone-else@example.test" },
        data: {},
      }, targetUser),
      (error) => error.status === 409 && error.code === "convex_account_identity_mismatch",
    );
  });

  it("requires explicit source-account confirmation for email-less guest exports", () => {
    const base = {
      format: "trade-intel-convex-account-export",
      version: 1,
      account: { id: "convex-guest-1", email: null, isAnonymous: true },
      data: {},
    };
    assert.throws(
      () => normalizeConvexAccountExport(base, targetUser),
      (error) => error.code === "convex_source_account_confirmation_required",
    );
    assert.equal(
      normalizeConvexAccountExport({ ...base, confirmSourceAccountId: "convex-guest-1" }, targetUser).format,
      "trade-intel-account-export",
    );
  });

  it("rejects unknown tables and malformed row collections", () => {
    const base = {
      format: "trade-intel-convex-account-export",
      version: 1,
      account: { id: "convex-user-1", email: "trader@example.test" },
    };
    assert.throws(
      () => normalizeConvexAccountExport({ ...base, data: { users: [] } }, targetUser),
      (error) => error.status === 400,
    );
    assert.throws(
      () => normalizeConvexAccountExport({ ...base, data: { analyses: {} } }, targetUser),
      (error) => error.status === 400,
    );
  });
});
