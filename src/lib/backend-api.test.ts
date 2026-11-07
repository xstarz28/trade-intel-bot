import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackendApiError,
  createAnonymousBackendSession,
  exportBackendAccount,
  importBackendAccount,
  listBackendJournal,
  createBackendJournalEntry,
  updateBackendJournalEntry,
  transitionBackendJournalEntry,
  deleteBackendJournalEntry,
  getBackendSession,
  listBackendAnalyses,
  logoutBackendSession,
  saveBackendAnalysis,
  fetchBackendCotPositioning,
  fetchBackendEiaInventory,
  fetchBackendTreasuryYields,
  fetchBackendFxRate,
  fetchBackendOkxInstrumentSpec,
  fetchBackendOkxOrderBook,
  fetchBackendOkxFuturesOpenInterest,
  fetchBackendLiveProtectionQuotes,
} from "./backend-api";

afterEach(() => vi.restoreAllMocks());

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("self-hosted backend API client", () => {
  it("reads the session with cookie credentials and no-store caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { user: null }));
    await expect(getBackendSession(fetcher)).resolves.toEqual({ user: null });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("creates an anonymous session using the backend endpoint", async () => {
    const user = {
      id: "user-1",
      name: "Guest Trader",
      email: null,
      isAnonymous: true,
      role: "user",
    };
    const fetcher = vi.fn().mockResolvedValue(response(201, { user }));
    await expect(createAnonymousBackendSession(fetcher)).resolves.toEqual({ user });
    const [, init] = fetcher.mock.calls[0];
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/auth/anonymous");
    expect(init).toEqual(expect.objectContaining({
      method: "POST",
      credentials: "include",
    }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("lists and persists analyses through the authenticated API", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { items: [] }))
      .mockResolvedValueOnce(response(201, { item: { _id: "analysis-1" } }));
    await expect(listBackendAnalyses(fetcher)).resolves.toEqual({ items: [] });
    await expect(
      saveBackendAnalysis({
        instrument: "BTC/USDT",
        instrumentType: "crypto",
        timeframe: "4h",
        bias: "BULLISH",
        confidence: 72,
        technicalSummary: "Trend aligned",
        fundamentalSummary: "No fundamental feed",
        breakdown: { trend: 80, indicator: 70, fundamental: 50, sentiment: 50 },
        keyLevels: { support: "64000", resistance: "68000", invalidation: "63000" },
        riskNote: "Defined risk",
        dataCompleteness: "PARTIAL",
        dataFlags: [],
      }, fetcher),
    ).resolves.toEqual({ item: { _id: "analysis-1" } });
    expect(fetcher.mock.calls[1][0]).toBe("/api/v1/analyses");
    expect(fetcher.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  it("fetches COT, EIA, and Treasury intelligence through self-hosted provider routes", async () => {
    const cot = { success: true, data: { available: true, netNonCommercial: 1200 } };
    const eia = { success: true, data: { available: true, crude: { change: -2.1 } } };
    const treasury = { success: true, data: { available: true, twoYear: 4.1, tenYear: 4.3 } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, cot))
      .mockResolvedValueOnce(response(200, eia))
      .mockResolvedValueOnce(response(200, treasury));

    await expect(fetchBackendCotPositioning("EUR/USD", fetcher)).resolves.toEqual(cot);
    await expect(fetchBackendEiaInventory(fetcher)).resolves.toEqual(eia);
    await expect(fetchBackendTreasuryYields(fetcher)).resolves.toEqual(treasury);

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["/api/v1/intelligence/cot", "POST", JSON.stringify({ instrument: "EUR/USD" })],
      ["/api/v1/intelligence/eia", "POST", "{}"],
      ["/api/v1/intelligence/treasury", "POST", "{}"],
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === "include")).toBe(true);
  });

  it("fetches live position quotes through the authenticated backend without browser provider access", async () => {
    const results = [{
      instrument: "BTC-USDT-SWAP",
      assetClass: "crypto",
      price: 101250,
      timestamp: Date.now(),
      provider: "OKX",
      primaryProvider: "OKX",
      fallbackUsed: false,
      sourceMode: "LIVE" as const,
      success: true,
    }];
    const fetcher = vi.fn().mockResolvedValue(response(200, { results }));
    await expect(fetchBackendLiveProtectionQuotes(["BTC-USDT-SWAP"], fetcher)).resolves.toEqual(results);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/market-data/quotes", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ instruments: ["BTC-USDT-SWAP"] }),
    }));
  });

  it("fetches dated FX reference snapshots through the authenticated backend", async () => {
    const result = {
      success: true,
      direct: {
        pair: "EUR/USD",
        rate: 1.08,
        timestamp: 1,
        source: "Frankfurter daily reference (2026-11-04)",
        maxAgeMs: 345600000,
      },
      inverse: null,
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, result));
    await expect(fetchBackendFxRate("EUR", "USD", fetcher)).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/intelligence/fx-rate", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ from: "EUR", to: "USD" }),
    }));
  });

  it("fetches exact-contract OKX metadata, order book, and dated futures OI through the backend", async () => {
    const spec = { success: true, data: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: [{ instId: "BTC-USDT-SWAP", instType: "SWAP", ctType: "linear", ctVal: 0.01, ctValCcy: "BTC", settleCcy: "USDT", lotSz: 0.01, minSz: 0.01, tickSz: 0.1 }], parseWarnings: [] } };
    const book = { success: true, data: { available: false, reason: "stale snapshot" } };
    const openInterest = { success: true, data: { provider: "okx-public-futures-open-interest", symbol: "BTC-USDT-261225", timestamp: 1, freshness: "realtime", openInterest: { current: 1200000 }, availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false }, confidence: "low", interpretation: "Exact-contract USD OI only" } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, spec))
      .mockResolvedValueOnce(response(200, book))
      .mockResolvedValueOnce(response(200, openInterest));

    await expect(fetchBackendOkxInstrumentSpec("BTC-USDT-SWAP", fetcher)).resolves.toEqual(spec);
    await expect(fetchBackendOkxOrderBook("BTC-USDT-SWAP", fetcher)).resolves.toEqual(book);
    await expect(fetchBackendOkxFuturesOpenInterest("BTC-USDT-261225", fetcher)).resolves.toEqual(openInterest);

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["/api/v1/intelligence/okx-spec", "POST", JSON.stringify({ instrument: "BTC-USDT-SWAP" })],
      ["/api/v1/intelligence/okx-orderbook", "POST", JSON.stringify({ instrument: "BTC-USDT-SWAP" })],
      ["/api/v1/intelligence/okx-futures-open-interest", "POST", JSON.stringify({ instrument: "BTC-USDT-261225" })],
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === "include")).toBe(true);
  });

  it("fetches OKX instrument, order-book and dated-futures intelligence through the backend", async () => {
    const spec = { success: true, data: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: [{ instId: "BTC-USDT-SWAP", instType: "SWAP" }], parseWarnings: [] } };
    const book = { success: true, data: { available: false, reason: "stale exchange snapshot" } };
    const futures = { success: true, data: { provider: "okx-public-futures-open-interest", symbol: "BTC-USDT-261225", timestamp: 1, freshness: "realtime", openInterest: { current: 1250000 }, availability: { openInterest: true, fundingRate: false, longShort: false, liquidations: false }, confidence: "low", interpretation: "Exact-contract USD open interest only" } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, spec))
      .mockResolvedValueOnce(response(200, book))
      .mockResolvedValueOnce(response(200, futures));

    await expect(fetchBackendOkxInstrumentSpec("BTC-USDT-SWAP", fetcher)).resolves.toEqual(spec);
    await expect(fetchBackendOkxOrderBook("BTC-USDT-SWAP", fetcher)).resolves.toEqual(book);
    await expect(fetchBackendOkxFuturesOpenInterest("BTC-USDT-261225", fetcher)).resolves.toEqual(futures);

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["/api/v1/intelligence/okx-spec", "POST", JSON.stringify({ instrument: "BTC-USDT-SWAP" })],
      ["/api/v1/intelligence/okx-orderbook", "POST", JSON.stringify({ instrument: "BTC-USDT-SWAP" })],
      ["/api/v1/intelligence/okx-futures-open-interest", "POST", JSON.stringify({ instrument: "BTC-USDT-261225" })],
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === "include")).toBe(true);
  });

  it("exports account data through the authenticated backend endpoint", async () => {
    const payload = {
      format: "trade-intel-account-export" as const,
      version: 1 as const,
      exportedAt: "2026-11-04T00:00:00.000Z",
      account: { id: "user-1", name: "Trader", email: null, isAnonymous: true, role: "user" },
      data: { journal: [] },
      counts: { journal: 0 },
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, payload));
    await expect(exportBackendAccount(fetcher)).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/account/export",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("restores a typed account export through the authenticated backend endpoint", async () => {
    const payload = {
      format: "trade-intel-account-export" as const,
      version: 1 as const,
      exportedAt: "2026-11-04T00:00:00.000Z",
      account: { id: "old-user", name: "Trader", email: null, isAnonymous: true, role: "user" },
      data: { journal: [] },
      counts: { journal: 0 },
    };
    const result = {
      success: true,
      accountId: "current-user",
      inserted: { journal: 0 },
      skipped: { journal: 0 },
      totalInserted: 0,
      totalSkipped: 0,
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, result));
    await expect(importBackendAccount(payload, fetcher)).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/account/import",
      expect.objectContaining({ method: "POST", credentials: "include", cache: "no-store" }),
    );
  });

  it("supports authenticated journal listing, creation, review, transitions, and deletion", async () => {
    const item = {
      _id: "journal-1",
      _creationTime: 1,
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "H4",
      style: "SWING",
      analysisSnapshot: { analysisId: "analysis-1", decision: "LONG" },
      status: "PLANNED",
      timestamps: { createdAt: 1, updatedAt: 1 },
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { items: [item] }))
      .mockResolvedValueOnce(response(201, { item }))
      .mockResolvedValueOnce(response(200, { item }))
      .mockResolvedValueOnce(response(200, { item: { ...item, status: "OPEN" } }))
      .mockResolvedValueOnce(response(200, { success: true }));

    await expect(listBackendJournal({ instrument: "BTC-USDT" }, fetcher))
      .resolves.toEqual({ items: [item] });
    await expect(createBackendJournalEntry({
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "H4",
      style: "SWING",
      analysisSnapshot: item.analysisSnapshot,
    }, fetcher)).resolves.toEqual({ item });
    await expect(updateBackendJournalEntry("journal-1", { notes: "Review" }, fetcher))
      .resolves.toEqual({ item });
    await expect(transitionBackendJournalEntry("journal-1", { newStatus: "OPEN" }, fetcher))
      .resolves.toMatchObject({ item: { status: "OPEN" } });
    await expect(deleteBackendJournalEntry("journal-1", fetcher))
      .resolves.toEqual({ success: true });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/journal?instrument=BTC-USDT",
      "/api/v1/journal",
      "/api/v1/journal/journal-1",
      "/api/v1/journal/journal-1/transition",
      "/api/v1/journal/journal-1",
    ]);
    expect(fetcher.mock.calls.slice(1).every(([, init]) => init?.credentials === "include")).toBe(true);
  });

  it("logs out through the backend session endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true }));
    await expect(logoutBackendSession(fetcher)).resolves.toEqual({ success: true });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("surfaces backend errors without converting them to mock success", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(401, { error: "authentication_required" }));
    await expect(getBackendSession(fetcher)).rejects.toMatchObject({
      name: "BackendApiError",
      status: 401,
      code: "authentication_required",
    } satisfies Partial<BackendApiError>);
  });

  it("uses authenticated endpoints for monitored positions and their alerts", async () => {
    const position = {
      _id: "db-1", positionId: "pos-1", instrument: "BTC-USDT", side: "LONG",
      entryPrice: 65000, stopLoss: 63000, takeProfit: 70000, leverage: 1,
      horizon: "SWING", openedAt: 1, peakPrice: null, peakProfit: null,
      currentSeverity: "INFO", lifecycleState: "ACTIVE", monitoringLifecycle: "MONITORING",
      lastUpdateAt: 1, lastAlertAt: 1, consecutiveSameSeverity: 0,
    };
    const alert = {
      _id: "alert-db-1", alertId: "alert-1", positionId: "pos-1", instrument: "BTC-USDT",
      severity: "HIGH", notificationPriority: "HIGH", reason: "Stop approaching",
      action: "Review risk", timestamp: 2, acknowledged: false,
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { items: [position] }))
      .mockResolvedValueOnce(response(200, { item: position }))
      .mockResolvedValueOnce(response(200, { item: position }))
      .mockResolvedValueOnce(response(200, { success: true }))
      .mockResolvedValueOnce(response(200, { items: [alert] }))
      .mockResolvedValueOnce(response(201, { item: alert }))
      .mockResolvedValueOnce(response(200, { success: true }));

    const { listBackendPositions, saveBackendPosition, getBackendPosition,
      deleteBackendPosition, listBackendPositionAlerts, saveBackendPositionAlert,
      acknowledgeBackendAlert } = await import("./backend-api");
    await expect(listBackendPositions(fetcher)).resolves.toEqual({ items: [position] });
    await expect(saveBackendPosition(position, fetcher)).resolves.toEqual({ item: position });
    await expect(getBackendPosition("pos-1", fetcher)).resolves.toEqual({ item: position });
    await expect(deleteBackendPosition("pos-1", fetcher)).resolves.toEqual({ success: true });
    await expect(listBackendPositionAlerts("pos-1", 25, fetcher)).resolves.toEqual({ items: [alert] });
    const { _id: alertRecordId, ...alertInput } = alert;
    expect(alertRecordId).toBe("alert-db-1");
    await expect(saveBackendPositionAlert("pos-1", alertInput, fetcher))
      .resolves.toEqual({ item: alert });
    await expect(acknowledgeBackendAlert("alert-1", fetcher)).resolves.toEqual({ success: true });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/positions", "/api/v1/positions", "/api/v1/positions/pos-1",
      "/api/v1/positions/pos-1", "/api/v1/positions/pos-1/alerts?limit=25",
      "/api/v1/positions/pos-1/alerts", "/api/v1/alerts/alert-1/acknowledge",
    ]);
  });

  it("uses authenticated endpoints for alert rules, notifications, and preferences", async () => {
    const rule = {
      _id: "db-rule-1", ruleId: "rule-1", name: "Risk trigger", enabled: true,
      scope: "POSITION", instrument: "BTC-USDT", positionId: null, condition: "drawdown > 3%",
      severity: "HIGH", cooldownMs: 60000, createdAt: 1, updatedAt: 1,
    };
    const notification = {
      _id: "db-notification-1", notificationId: "notification-1", alertIdentity: "alert-1",
      ruleId: "rule-1", ruleName: "Risk trigger", timestamp: 1, instrument: "BTC-USDT",
      positionId: "pos-1", side: "LONG", severity: "HIGH", title: "Risk alert",
      message: "Review position", category: "PORTFOLIO", impact: "HIGH", read: false,
      dismissed: false, source: "engine", condition: "drawdown > 3%",
    };
    const preferences = {
      minimumSeverity: "INFO", enabledCategories: ["PORTFOLIO"], enabledScopes: ["POSITION"],
      mutedRuleIds: [], enabledInstruments: [], mutedInstruments: [],
      showReadNotifications: true, showDismissedNotifications: false,
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { items: [rule] }))
      .mockResolvedValueOnce(response(201, { item: rule }))
      .mockResolvedValueOnce(response(200, { item: rule }))
      .mockResolvedValueOnce(response(200, { success: true }))
      .mockResolvedValueOnce(response(200, { items: [notification] }))
      .mockResolvedValueOnce(response(200, { items: [notification] }))
      .mockResolvedValueOnce(response(200, { count: 1 }))
      .mockResolvedValueOnce(response(200, { success: true }))
      .mockResolvedValueOnce(response(200, { success: true }))
      .mockResolvedValueOnce(response(200, { updated: 1 }))
      .mockResolvedValueOnce(response(200, { preferences }))
      .mockResolvedValueOnce(response(200, { preferences }))
      .mockResolvedValueOnce(response(200, { preferences }));

    const { listBackendAlertRules, createBackendAlertRule, updateBackendAlertRule,
      deleteBackendAlertRule, listBackendNotifications, listBackendUnreadNotifications,
      getBackendUnreadNotificationCount, markBackendNotificationRead,
      dismissBackendNotification, markAllBackendNotificationsRead,
      getBackendNotificationPreferences, saveBackendNotificationPreferences,
      resetBackendNotificationPreferences } = await import("./backend-api");
    await expect(listBackendAlertRules(fetcher)).resolves.toEqual({ items: [rule] });
    await expect(createBackendAlertRule({
      ruleId: "rule-1", name: "Risk trigger", enabled: true, scope: "POSITION",
      condition: "drawdown > 3%", severity: "HIGH", cooldownMs: 60000,
    }, fetcher)).resolves.toEqual({ item: rule });
    await expect(updateBackendAlertRule("rule-1", { enabled: false }, fetcher)).resolves.toEqual({ item: rule });
    await expect(deleteBackendAlertRule("rule-1", fetcher)).resolves.toEqual({ success: true });
    await expect(listBackendNotifications(20, fetcher)).resolves.toEqual({ items: [notification] });
    await expect(listBackendUnreadNotifications(fetcher)).resolves.toEqual({ items: [notification] });
    await expect(getBackendUnreadNotificationCount(fetcher)).resolves.toEqual({ count: 1 });
    await expect(markBackendNotificationRead("notification-1", fetcher)).resolves.toEqual({ success: true });
    await expect(dismissBackendNotification("notification-1", fetcher)).resolves.toEqual({ success: true });
    await expect(markAllBackendNotificationsRead(fetcher)).resolves.toEqual({ updated: 1 });
    await expect(getBackendNotificationPreferences(fetcher)).resolves.toEqual({ preferences });
    await expect(saveBackendNotificationPreferences(preferences, fetcher)).resolves.toEqual({ preferences });
    await expect(resetBackendNotificationPreferences(fetcher)).resolves.toEqual({ preferences });
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === "include")).toBe(true);
  });


  it("persists and reads per-position history and runtime health", async () => {
    const snapshot = {
      _id: "snapshot-1", positionId: "pos-1", instrument: "BTC-USDT", side: "LONG",
      timestamp: 10, thesisState: "VALID", evidenceQuality: "HIGH", marketRegime: "TRENDING",
      h1Trend: "BULLISH", m15Trend: "BULLISH", m5Trend: "NEUTRAL", mtfAlignment: "ALIGNED",
      momentum: "POSITIVE", volatility: "NORMAL", structure: "HH_HL",
      supportingCount: 4, conflictingCount: 1, invalidationCondition: "Below 63000",
      watchNext: "Retest", dataAvailability: "COMPLETE",
    };
    const timeline = {
      positionId: "pos-1", latestSnapshot: snapshot, previousSnapshot: null, events: [],
    };
    const health = {
      _id: "health-1", timestamp: 11, overallStatus: "HEALTHY",
      components: [{ component: "market-data", status: "OK", consecutiveFailures: 0, message: "ok", freshness: "FRESH" }],
      intelligenceCycleStatus: "OK", alertPipelineStatus: "OK", persistenceStatus: "OK",
      providerAvailability: { okx: "AVAILABLE" }, staleComponents: [], unavailableComponents: [],
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(201, { id: "snapshot-1", pruned: 0 }))
      .mockResolvedValueOnce(response(201, { ids: ["event-1"], inserted: 1, pruned: 0 }))
      .mockResolvedValueOnce(response(200, timeline))
      .mockResolvedValueOnce(response(200, { deleted: 1 }))
      .mockResolvedValueOnce(response(200, { pruned: 0 }))
      .mockResolvedValueOnce(response(200, { item: health }))
      .mockResolvedValueOnce(response(200, { items: [health] }))
      .mockResolvedValueOnce(response(201, { id: "health-1" }));

    const { saveBackendHistorySnapshot, saveBackendHistoryEvents, getBackendHistoryTimeline,
      deleteBackendPositionHistory, pruneBackendPositionHistory, getLatestBackendRuntimeHealth,
      listBackendRuntimeHealth, saveBackendRuntimeHealth } = await import("./backend-api");
    const { _id: snapshotRecordId, ...snapshotInput } = snapshot;
    expect(snapshotRecordId).toBe("snapshot-1");
    await expect(saveBackendHistorySnapshot(snapshotInput, fetcher)).resolves.toEqual({ id: "snapshot-1", pruned: 0 });
    await expect(saveBackendHistoryEvents({
      positionId: "pos-1", instrument: "BTC-USDT", side: "LONG",
      events: [{ timestamp: 12, eventType: "THESIS_UPDATE", description: "Retest", previousState: "WATCH", currentState: "VALID", category: "STRUCTURE", strength: "MEDIUM" }],
    }, fetcher)).resolves.toMatchObject({ inserted: 1 });
    await expect(getBackendHistoryTimeline("pos-1", fetcher)).resolves.toEqual(timeline);
    await expect(deleteBackendPositionHistory("pos-1", fetcher)).resolves.toEqual({ deleted: 1 });
    await expect(pruneBackendPositionHistory("pos-1", fetcher)).resolves.toEqual({ pruned: 0 });
    await expect(getLatestBackendRuntimeHealth(fetcher)).resolves.toEqual({ item: health });
    await expect(listBackendRuntimeHealth(10, fetcher)).resolves.toEqual({ items: [health] });
    const { _id: healthRecordId, ...healthInput } = health;
    expect(healthRecordId).toBe("health-1");
    await expect(saveBackendRuntimeHealth(healthInput, fetcher)).resolves.toEqual({ id: "health-1" });
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === "include")).toBe(true);
  });


  it("persists rule alert history and per-instrument stream cursors", async () => {
    const history = {
      _id: "rule-alert-db-1", alertId: "rule-alert-1", ruleId: "rule-1",
      ruleName: "Risk trigger", positionId: "pos-1", instrument: "BTC-USDT",
      condition: "drawdown > 3%", severity: "HIGH", description: "Drawdown threshold reached",
      previousState: "NORMAL", currentState: "HIGH", timestamp: 20,
    };
    const cursor = {
      _id: "cursor-db-1", provider: "okx", instrument: "BTC-USDT",
      lastEventId: "event-123", lastTimestamp: 21, lastSequence: 4,
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { items: [history] }))
      .mockResolvedValueOnce(response(201, { item: history }))
      .mockResolvedValueOnce(response(200, { deleted: 1 }))
      .mockResolvedValueOnce(response(200, { item: cursor }))
      .mockResolvedValueOnce(response(200, { item: null }))
      .mockResolvedValueOnce(response(200, { success: true }));

    const { listBackendRuleAlertHistory, saveBackendRuleAlertHistory,
      clearBackendRuleAlertHistory, getBackendStreamCursor, saveBackendStreamCursor } =
      await import("./backend-api");
    await expect(listBackendRuleAlertHistory(25, fetcher)).resolves.toEqual({ items: [history] });
    const { _id: historyRecordId, ...historyInput } = history;
    expect(historyRecordId).toBe("rule-alert-db-1");
    await expect(saveBackendRuleAlertHistory(historyInput, fetcher)).resolves.toEqual({ item: history });
    await expect(clearBackendRuleAlertHistory(fetcher)).resolves.toEqual({ deleted: 1 });
    await expect(getBackendStreamCursor("okx", "BTC-USDT", fetcher)).resolves.toEqual({ item: cursor });
    await expect(getBackendStreamCursor("okx", "ETH-USDT", fetcher)).resolves.toEqual({ item: null });
    const { _id: cursorRecordId, ...cursorInput } = cursor;
    expect(cursorRecordId).toBe("cursor-db-1");
    await expect(saveBackendStreamCursor(cursorInput, fetcher)).resolves.toEqual({ success: true });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/alert-rules/history?limit=25", "/api/v1/alert-rules/history",
      "/api/v1/alert-rules/history", "/api/v1/stream-cursors?provider=okx&instrument=BTC-USDT",
      "/api/v1/stream-cursors?provider=okx&instrument=ETH-USDT", "/api/v1/stream-cursors",
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === "include")).toBe(true);
  });


  it("returns market data, technical context, and the decision from the self-hosted analysis engine", async () => {
    const result = {
      success: true,
      data: {
        instrument: "BTC-USDT",
        instrumentType: "crypto",
        provider: "okx-spot",
        fetchTimestamp: 1,
        price: { price: 65000, timestamp: 1, source: "okx-spot" },
        candles: [],
        timeframe: "H4",
        dataFreshness: "realtime",
      },
      technical: { structure: "HH/HL", swingHighs: [], swingLows: [], supportLevels: [], resistanceLevels: [], volumeTrend: "stable", dataPoints: 0 },
      analysis: {
        id: "analysis-1", instrument: "BTC-USDT", instrumentType: "crypto",
        timeframe: "H4", tradingStyle: "SWING", bias: "BULLISH", confidence: 78,
        recommendation: "LONG", technicalSummary: "Trend aligned",
        fundamentalSummary: "No external fundamental feed",
        breakdown: { trend: 80, indicator: 70, fundamental: 50, sentiment: 50 },
        keyLevels: { support: "64000", resistance: "68000", invalidation: "63000" },
        riskNote: "Defined risk", dataCompleteness: "PARTIAL", dataFlags: [], timestamp: 1,
      },
    };
    const fetcher = vi.fn().mockResolvedValueOnce(response(200, result));
    const { analyzeBackendMarket } = await import("./backend-api");
    await expect(analyzeBackendMarket({
      instrument: "BTC-USDT", instrumentType: "crypto",
      timeframe: "H4", tradingStyle: "SWING",
    }, fetcher)).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/market-data/analyze", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        instrument: "BTC-USDT", instrumentType: "crypto",
        timeframe: "H4", tradingStyle: "SWING",
      }),
    }));
  });


  it("reads and refreshes SEC filing observations through the authenticated backend", async () => {
    const observation = {
      ticker: "MSFT", cik: "0000789019", accessionNumber: "0000789019-26-000001",
      form: "10-Q", filingDate: "2026-10-28", acceptanceDateTime: null,
      fiscalPeriodStart: "2026-07-01", fiscalPeriodEnd: "2026-09-30",
      fiscalYear: 2027, fiscalPeriod: "Q1", eps: 4.2, revenue: 70000000000,
      epsTag: "EarningsPerShareDiluted", revenueTag: "RevenueFromContractWithCustomerExcludingAssessedTax",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/789019/filing", firstObservedAt: 1,
      lastRetrievedAt: 2, filingDateSemantics: "SEC filing date; not an exact public-availability timestamp",
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { ticker: "MSFT", items: [observation] }))
      .mockResolvedValueOnce(response(200, {
        success: true, status: "UPDATED", ticker: "MSFT", cik: "0000789019",
        observationCount: 1, newlyPersistedCount: 1, items: [observation],
      }));
    const { getBackendSecFundamentals, refreshBackendSecFundamentals } = await import("./backend-api");
    await expect(getBackendSecFundamentals(" msft ", fetcher))
      .resolves.toEqual({ ticker: "MSFT", items: [observation] });
    await expect(refreshBackendSecFundamentals("msft", fetcher))
      .resolves.toMatchObject({ success: true, newlyPersistedCount: 1 });
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      ["/api/v1/fundamentals/sec/MSFT", "GET"],
      ["/api/v1/fundamentals/sec/MSFT", "POST"],
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === "include")).toBe(true);
  });

});
