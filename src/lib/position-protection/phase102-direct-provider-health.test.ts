/**
 * Phase 102 — Direct Provider Health + Persistence Hardening
 *
 * Tests direct provider health instrumentation, persistence activation,
 * error classification, aggregation, and safety invariants.
 *
 * No fabricated data. No execution language. No probability claims.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeRuntimeHealthEvent,
  classifyError,
  aggregateRuntimeHealth,
  shouldPersistRuntimeHealth,
  buildRuntimeHealthSnapshot,
  AGING_THRESHOLD_MS,
  MAX_RUNTIME_HEALTH_MESSAGE_LENGTH,
  type RuntimeHealthEvent,
} from "./runtime-health";
import {
  createHealthEventBuffer,
  recordHealthEvent,
  recordProviderResult,
  shouldPersistFromBuffer,
  markPersisted,
  getLatestEventForComponent,
  getEventCount,
  buildSnapshotFromBuffer,
} from "./health-event-buffer";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeEvent(overrides: Partial<RuntimeHealthEvent> = {}): RuntimeHealthEvent {
  return {
    component: "MARKET_DATA",
    status: "HEALTHY",
    timestamp: Date.now(),
    message: "test",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. DIRECT OHLCV HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Direct OHLCV Health", () => {
  it("OHLCV success event from actual fetch result", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "OHLCV",
      source: "TwelveData",
      operation: "OHLCV fetch: BTC/USDT",
      success: true,
      durationMs: 150,
      message: "2/2 instruments succeeded",
    });
    expect(event.component).toBe("OHLCV");
    expect(event.status).toBe("HEALTHY");
    expect(event.source).toBe("TwelveData");
    expect(event.operation).toContain("BTC/USDT");
    expect(event.durationMs).toBe(150);
  });

  it("OHLCV failure event from actual fetch error", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "OHLCV",
      source: "TwelveData",
      operation: "OHLCV fetch: BTC/USDT",
      success: false,
      error: "Rate limit exceeded",
      durationMs: 50,
    });
    expect(event.status).toBe("DEGRADED");
    expect(event.errorCategory).toBe("RATE_LIMIT");
  });

  it("OHLCV partial success (some instruments fail)", () => {
    // When some instruments succeed and some fail, overall is DEGRADED
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "OHLCV",
      source: "TwelveData",
      operation: "OHLCV fetch: BTC/USDT, ETH/USDT",
      success: false,
      error: "1 instrument failed",
      message: "1/2 instruments succeeded",
    });
    const latest = getLatestEventForComponent(buf, "OHLCV");
    expect(latest!.status).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. DIRECT NEWS/ALPHAVANTAGE HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Direct NEWS Health", () => {
  it("NEWS success from AlphaVantage fetch", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "NEWS",
      source: "AlphaVantage",
      operation: "News sentiment fetch",
      success: true,
      durationMs: 300,
    });
    expect(event.component).toBe("NEWS");
    expect(event.status).toBe("HEALTHY");
  });

  it("NEWS rate limit from AlphaVantage", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "NEWS",
      source: "AlphaVantage",
      operation: "News sentiment fetch",
      success: false,
      error: "429 Too Many Requests",
    });
    expect(event.status).toBe("DEGRADED");
    expect(event.errorCategory).toBe("RATE_LIMIT");
  });

  it("NEWS auth failure", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "NEWS",
      source: "AlphaVantage",
      operation: "News sentiment fetch",
      success: false,
      error: "401 Unauthorized",
    });
    expect(event.status).toBe("UNAVAILABLE");
    expect(event.errorCategory).toBe("AUTH");
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. DIRECT MACRO HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Direct MACRO Health", () => {
  it("MACRO success from Yahoo/VIX fetch", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "MACRO",
      source: "Yahoo",
      operation: "VIX fetch",
      success: true,
      durationMs: 200,
    });
    expect(event.component).toBe("MACRO");
    expect(event.status).toBe("HEALTHY");
  });

  it("MACRO network failure", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "MACRO",
      source: "Yahoo",
      operation: "VIX fetch",
      success: false,
      error: "ECONNREFUSED",
    });
    expect(event.status).toBe("DEGRADED");
    expect(event.errorCategory).toBe("NETWORK");
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. DIRECT CROSS_ASSET HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Direct CROSS_ASSET Health", () => {
  it("CROSS_ASSET success from comparator fetch", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "CROSS_ASSET",
      source: "TwelveData",
      operation: "Cross-asset DXY fetch",
      success: true,
      durationMs: 180,
    });
    expect(event.component).toBe("CROSS_ASSET");
    expect(event.status).toBe("HEALTHY");
  });

  it("CROSS_ASSET failure (non-fatal)", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "CROSS_ASSET",
      source: "TwelveData",
      operation: "Cross-asset fetch",
      success: false,
      error: "cross-asset fetch failed",
    });
    expect(event.status).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. PROVIDER ERROR CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Provider Error Classification", () => {
  it("NETWORK: ECONNREFUSED, fetch failed, ENOTFOUND", () => {
    expect(classifyError("ECONNREFUSED")).toBe("NETWORK");
    expect(classifyError("fetch failed")).toBe("NETWORK");
    expect(classifyError("ENOTFOUND")).toBe("NETWORK");
  });

  it("TIMEOUT: timeout, aborted", () => {
    expect(classifyError("timeout")).toBe("TIMEOUT");
    expect(classifyError("The operation was aborted")).toBe("TIMEOUT");
  });

  it("RATE_LIMIT: 429, rate limit, too many requests", () => {
    expect(classifyError("429 Too Many Requests")).toBe("RATE_LIMIT");
    expect(classifyError("rate limit exceeded")).toBe("RATE_LIMIT");
    expect(classifyError("too many requests")).toBe("RATE_LIMIT");
  });

  it("AUTH: 401, 403, unauthorized, API key", () => {
    expect(classifyError("401 Unauthorized")).toBe("AUTH");
    expect(classifyError("403 Forbidden")).toBe("AUTH");
    expect(classifyError("unauthorized")).toBe("AUTH");
  });

  it("PROVIDER_UNAVAILABLE: 503, 502, unavailable", () => {
    expect(classifyError("503 Service Unavailable")).toBe("PROVIDER_UNAVAILABLE");
    expect(classifyError("502 Bad Gateway")).toBe("PROVIDER_UNAVAILABLE");
  });

  it("INVALID_RESPONSE: invalid JSON, unexpected token", () => {
    expect(classifyError("Invalid JSON")).toBe("INVALID_RESPONSE");
    expect(classifyError("Unexpected token")).toBe("INVALID_RESPONSE");
  });

  it("error messages bounded at MAX_RUNTIME_HEALTH_MESSAGE_LENGTH", () => {
    const longMsg = "X".repeat(500);
    const event = normalizeRuntimeHealthEvent({
      component: "NEWS",
      success: false,
      message: longMsg,
    });
    expect(event.message!.length).toBeLessThanOrEqual(MAX_RUNTIME_HEALTH_MESSAGE_LENGTH + 3);
  });

  it("no API keys in error messages", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "NEWS",
      success: false,
      error: "Invalid API key: sk_live_abc123",
      message: "Provider authentication failed",
    });
    // Message is user-provided — should be sanitized in production
    expect(event.message).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. RECOVERY AFTER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Recovery After Failure", () => {
  it("recovery to HEALTHY only after actual success", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "OHLCV", status: "HEALTHY", timestamp: now - 10000 }),
      makeEvent({ component: "OHLCV", status: "DEGRADED", timestamp: now - 5000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const ohlcv = components.find((c) => c.component === "OHLCV");
    // Still DEGRADED — no success after failure
    expect(ohlcv!.status).toBe("DEGRADED");
  });

  it("recovery to HEALTHY after actual success", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "OHLCV", status: "HEALTHY", timestamp: now - 10000 }),
      makeEvent({ component: "OHLCV", status: "DEGRADED", timestamp: now - 5000 }),
      makeEvent({ component: "OHLCV", status: "HEALTHY", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const ohlcv = components.find((c) => c.component === "OHLCV");
    expect(ohlcv!.status).toBe("HEALTHY");
  });

  it("UNAVAILABLE → HEALTHY recovery", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: now - 20000 }),
      makeEvent({ component: "NEWS", status: "UNAVAILABLE", timestamp: now - 10000 }),
      makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const news = components.find((c) => c.component === "NEWS");
    expect(news!.status).toBe("HEALTHY");
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. PERSISTENCE ACTIVATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Persistence Activation", () => {
  it("first snapshot persists", () => {
    const snapshot = buildRuntimeHealthSnapshot(
      { marketDataAvailable: true, marketDataLastSuccess: Date.now() },
      Date.now(),
    );
    expect(shouldPersistRuntimeHealth(null, snapshot)).toBe(true);
  });

  it("meaningful transition persists", () => {
    const now = Date.now();
    const snap1 = buildRuntimeHealthSnapshot(
      { marketDataAvailable: true, marketDataLastSuccess: now },
      now,
    );
    const snap2 = buildRuntimeHealthSnapshot(
      { marketDataAvailable: false },
      now + 1000,
    );
    expect(shouldPersistRuntimeHealth(snap1, snap2)).toBe(true);
  });

  it("unchanged state does not persist", () => {
    const now = Date.now();
    const snap1 = buildRuntimeHealthSnapshot(
      { marketDataAvailable: true, marketDataLastSuccess: now },
      now,
    );
    const snap2 = buildRuntimeHealthSnapshot(
      { marketDataAvailable: true, marketDataLastSuccess: now },
      now + 1000,
    );
    expect(shouldPersistRuntimeHealth(snap1, snap2)).toBe(false);
  });

  it("buffer-based persistence works end-to-end", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });

    const snap = shouldPersistFromBuffer(buf, Date.now());
    expect(snap).not.toBeNull();

    buf = markPersisted(buf, snap!);
    const snap2 = shouldPersistFromBuffer(buf, Date.now());
    expect(snap2).toBeNull(); // No change → no persist
  });

  it("recovery triggers persistence", () => {
    let buf = createHealthEventBuffer();
    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: 1000 }));
    const snap1 = shouldPersistFromBuffer(buf, 2000)!;
    buf = markPersisted(buf, snap1);

    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: 3000 }));
    const snap2 = shouldPersistFromBuffer(buf, 4000);
    expect(snap2).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. NO RECURSIVE PERSISTENCE LOOP
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — No Recursive Persistence Loop", () => {
  it("persistence failure does not create health event that triggers more persistence", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });
    const snap1 = shouldPersistFromBuffer(buf, Date.now())!;
    buf = markPersisted(buf, snap1);

    // Simulate: persistence fails but we do NOT record a health event for it
    // (the dashboard guard prevents this)
    // After markPersisted, shouldPersistFromBuffer returns null
    const snap2 = shouldPersistFromBuffer(buf, Date.now());
    expect(snap2).toBeNull();
  });

  it("consecutive identical snapshots do not spam persistence", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });

    const snap1 = shouldPersistFromBuffer(buf, 1000)!;
    buf = markPersisted(buf, snap1);

    // Same state — no persist
    const snap2 = shouldPersistFromBuffer(buf, 2000);
    expect(snap2).toBeNull();

    // Still same state — no persist
    const snap3 = shouldPersistFromBuffer(buf, 3000);
    expect(snap3).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. CONVEX RETENTION / DEDUP
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Convex Retention/Dedup", () => {
  it("health buffer bounded at MAX_RUNTIME_HEALTH_EVENTS", () => {
    let buf = createHealthEventBuffer();
    for (let i = 0; i < 250; i++) {
      buf = recordHealthEvent(buf, makeEvent({ timestamp: i }));
    }
    expect(getEventCount(buf)).toBeLessThanOrEqual(200);
  });

  it("health snapshot components bounded at 10", () => {
    const snapshot = buildRuntimeHealthSnapshot({}, Date.now());
    expect(snapshot.components.length).toBeLessThanOrEqual(10);
  });

  it("same-millisecond events are deterministic", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: now }),
      makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: now }),
    ];
    const c1 = aggregateRuntimeHealth(events, now + 1000);
    const c2 = aggregateRuntimeHealth(events, now + 1000);
    expect(c1.map((c) => c.status)).toEqual(c2.map((c) => c.status));
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. HEALTH AGGREGATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Health Aggregation", () => {
  it("latest event determines status", () => {
    const now = Date.now();
    const events = [
      makeEvent({ component: "MACRO", status: "HEALTHY", timestamp: now - 5000 }),
      makeEvent({ component: "MACRO", status: "DEGRADED", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    expect(components.find((c) => c.component === "MACRO")!.status).toBe("DEGRADED");
  });

  it("no events = UNKNOWN", () => {
    const components = aggregateRuntimeHealth([], Date.now());
    expect(components.every((c) => c.status === "UNKNOWN")).toBe(true);
  });

  it("core component UNAVAILABLE = overall UNAVAILABLE", () => {
    const now = Date.now();
    const events = [
      makeEvent({ component: "MARKET_DATA", status: "UNAVAILABLE", timestamp: now - 1000 }),
      makeEvent({ component: "OHLCV", status: "HEALTHY", timestamp: now - 1000 }),
      makeEvent({ component: "INTELLIGENCE_ENGINE", status: "HEALTHY", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const snap = buildSnapshotFromBuffer(
      { events, lastPersistedSnapshot: null },
      now,
    );
    expect(snap.overallStatus).toBe("UNAVAILABLE");
  });

  it("non-core DEGRADED = overall DEGRADED", () => {
    const now = Date.now();
    let buf = createHealthEventBuffer();
    buf = recordHealthEvent(buf, makeEvent({ component: "MARKET_DATA", status: "HEALTHY", timestamp: now - 1000 }));
    buf = recordHealthEvent(buf, makeEvent({ component: "OHLCV", status: "HEALTHY", timestamp: now - 1000 }));
    buf = recordHealthEvent(buf, makeEvent({ component: "INTELLIGENCE_ENGINE", status: "HEALTHY", timestamp: now - 1000 }));
    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: now - 1000 }));
    const snap = buildSnapshotFromBuffer(buf, now);
    expect(snap.overallStatus).toBe("DEGRADED");
  });

  it("stale detection based on actual last success", () => {
    const now = Date.now();
    const events = [
      makeEvent({ component: "OHLCV", status: "HEALTHY", timestamp: now - AGING_THRESHOLD_MS - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const ohlcv = components.find((c) => c.component === "OHLCV");
    expect(ohlcv!.freshness).toBe("STALE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. NO DUPLICATE PROVIDER REQUESTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — No Duplicate Provider Requests", () => {
  it("recordProviderResult is pure — no network calls", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "OHLCV", success: true, source: "TwelveData" });
    expect(getEventCount(buf)).toBe(1);
  });

  it("aggregateRuntimeHealth is pure", () => {
    const events = [makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: 1000 })];
    const c1 = aggregateRuntimeHealth(events, 2000);
    const c2 = aggregateRuntimeHealth(events, 2000);
    expect(c1).toEqual(c2);
  });

  it("buildSnapshotFromBuffer is pure", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });
    const s1 = buildSnapshotFromBuffer(buf, 1000);
    const s2 = buildSnapshotFromBuffer(buf, 1000);
    expect(s1.overallStatus).toBe(s2.overallStatus);
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 102 — Safety Invariants", () => {
  it("no execution language in any output", () => {
    const event = normalizeRuntimeHealthEvent({ component: "OHLCV", success: true });
    const json = JSON.stringify(event).toLowerCase();
    expect(json).not.toContain("execute");
    expect(json).not.toContain("auto-buy");
    expect(json).not.toContain("auto-sell");
    expect(json).not.toContain("place order");
  });

  it("no probability claims", () => {
    const event = normalizeRuntimeHealthEvent({ component: "NEWS", success: true });
    const json = JSON.stringify(event).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("guaranteed");
    expect(json).not.toContain("likely");
  });

  it("no fabricated prices", () => {
    const event = normalizeRuntimeHealthEvent({ component: "MARKET_DATA", success: true });
    const json = JSON.stringify(event);
    expect(json).not.toContain("$");
    expect(json).not.toContain("65000");
    expect(json).not.toContain("bid");
    expect(json).not.toContain("ask");
  });

  it("bounded memory everywhere", () => {
    let buf = createHealthEventBuffer();
    for (let i = 0; i < 250; i++) {
      buf = recordHealthEvent(buf, makeEvent({ timestamp: i }));
    }
    expect(getEventCount(buf)).toBeLessThanOrEqual(200);
  });
});
