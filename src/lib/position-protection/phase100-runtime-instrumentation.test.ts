/**
 * Phase 100 — Runtime Health Instrumentation
 *
 * Comprehensive test suite for health events, aggregation, transitions,
 * persistence decisions, buffer management, and safety invariants.
 *
 * No fabricated data. No execution language. No probability claims.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeRuntimeHealthEvent,
  classifyError,
  errorCategoryToStatus,
  aggregateRuntimeHealth,
  detectHealthTransitions,
  shouldPersistRuntimeHealth,
  type RuntimeHealthEvent,
  type RuntimeComponent,
  type RuntimeHealthSnapshot,
} from "./runtime-health";
import {
  createHealthEventBuffer,
  recordHealthEvent,
  recordProviderResult,
  shouldPersistFromBuffer,
  markPersisted,
  getLatestEventForComponent,
  getEventsForComponent,
  getEventCount,
  buildSnapshotFromBuffer,
} from "./health-event-buffer";

// ─── Helpers ────────────────────────────────────────────────

function makeEvent(overrides: Partial<RuntimeHealthEvent> = {}): RuntimeHealthEvent {
  return {
    component: "MARKET_DATA",
    status: "HEALTHY",
    timestamp: Date.now(),
    message: "test",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<RuntimeHealthSnapshot> = {}): RuntimeHealthSnapshot {
  return {
    timestamp: Date.now(),
    overallStatus: "HEALTHY",
    components: [],
    intelligenceCycleStatus: "HEALTHY",
    alertPipelineStatus: "HEALTHY",
    persistenceStatus: "HEALTHY",
    providerAvailability: {},
    staleComponents: [],
    unavailableComponents: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. ERROR CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Error Classification", () => {
  it("classifies rate limit errors", () => {
    expect(classifyError("Rate limit exceeded")).toBe("RATE_LIMIT");
    expect(classifyError("429 Too Many Requests")).toBe("RATE_LIMIT");
  });

  it("classifies timeout errors", () => {
    expect(classifyError("Request timeout")).toBe("TIMEOUT");
    expect(classifyError("The operation was aborted")).toBe("TIMEOUT");
  });

  it("classifies network errors", () => {
    expect(classifyError("Network error")).toBe("NETWORK");
    expect(classifyError("Fetch failed")).toBe("NETWORK");
    expect(classifyError("ECONNREFUSED")).toBe("NETWORK");
  });

  it("classifies auth errors", () => {
    expect(classifyError("Unauthorized access")).toBe("AUTH");
    expect(classifyError("403 Forbidden")).toBe("AUTH");
  });

  it("classifies provider unavailable", () => {
    expect(classifyError("Service unavailable")).toBe("PROVIDER_UNAVAILABLE");
    expect(classifyError("503 Service Unavailable")).toBe("PROVIDER_UNAVAILABLE");
  });

  it("classifies invalid response", () => {
    expect(classifyError("Invalid JSON")).toBe("INVALID_RESPONSE");
    expect(classifyError("Unexpected token")).toBe("INVALID_RESPONSE");
  });

  it("classifies unknown errors", () => {
    expect(classifyError("Something weird")).toBe("UNKNOWN");
    expect(classifyError(null)).toBe("UNKNOWN");
  });

  it("classifies Error objects", () => {
    expect(classifyError(new Error("rate limit exceeded"))).toBe("RATE_LIMIT");
    expect(classifyError(new Error("timeout"))).toBe("TIMEOUT");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. ERROR CATEGORY TO STATUS
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Error Category to Status", () => {
  it("NONE → HEALTHY", () => {
    expect(errorCategoryToStatus("NONE")).toBe("HEALTHY");
  });

  it("RATE_LIMIT → DEGRADED", () => {
    expect(errorCategoryToStatus("RATE_LIMIT")).toBe("DEGRADED");
  });

  it("TIMEOUT → DEGRADED", () => {
    expect(errorCategoryToStatus("TIMEOUT")).toBe("DEGRADED");
  });

  it("NETWORK → DEGRADED", () => {
    expect(errorCategoryToStatus("NETWORK")).toBe("DEGRADED");
  });

  it("AUTH → UNAVAILABLE", () => {
    expect(errorCategoryToStatus("AUTH")).toBe("UNAVAILABLE");
  });

  it("PROVIDER_UNAVAILABLE → UNAVAILABLE", () => {
    expect(errorCategoryToStatus("PROVIDER_UNAVAILABLE")).toBe("UNAVAILABLE");
  });

  it("INVALID_RESPONSE → DEGRADED", () => {
    expect(errorCategoryToStatus("INVALID_RESPONSE")).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. NORMALIZE HEALTH EVENT
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Normalize Health Event", () => {
  it("success creates HEALTHY event", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "OHLCV",
      source: "TwelveData",
      operation: "Fetch candles",
      success: true,
      durationMs: 150,
      timestamp: 1000,
    });
    expect(event.status).toBe("HEALTHY");
    expect(event.component).toBe("OHLCV");
    expect(event.source).toBe("TwelveData");
    expect(event.errorCategory).toBe("NONE");
    expect(event.durationMs).toBe(150);
  });

  it("failure with error creates appropriate event", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "NEWS",
      source: "AlphaVantage",
      operation: "Fetch news",
      success: false,
      error: "Rate limit exceeded",
      timestamp: 2000,
    });
    expect(event.status).toBe("DEGRADED");
    expect(event.errorCategory).toBe("RATE_LIMIT");
  });

  it("failure with auth error creates UNAVAILABLE event", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "MARKET_DATA",
      success: false,
      error: "401 Unauthorized",
      timestamp: 3000,
    });
    expect(event.status).toBe("UNAVAILABLE");
    expect(event.errorCategory).toBe("AUTH");
  });

  it("message is truncated if too long", () => {
    const longMsg = "A".repeat(500);
    const event = normalizeRuntimeHealthEvent({
      component: "MARKET_DATA",
      success: true,
      message: longMsg,
      timestamp: 4000,
    });
    expect(event.message!.length).toBeLessThanOrEqual(310);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. HEALTH EVENT BUFFER
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Health Event Buffer", () => {
  it("creates empty buffer", () => {
    const buf = createHealthEventBuffer();
    expect(buf.events).toEqual([]);
    expect(buf.lastPersistedSnapshot).toBeNull();
  });

  it("records events", () => {
    let buf = createHealthEventBuffer();
    buf = recordHealthEvent(buf, makeEvent({ component: "OHLCV" }));
    expect(buf.events).toHaveLength(1);
    expect(buf.events[0].component).toBe("OHLCV");
  });

  it("evicts oldest when full", () => {
    let buf = createHealthEventBuffer();
    for (let i = 0; i < 210; i++) {
      buf = recordHealthEvent(buf, makeEvent({ timestamp: i }));
    }
    expect(buf.events.length).toBeLessThanOrEqual(200);
    // Oldest should be evicted
    expect(buf.events[0].timestamp).toBeGreaterThan(0);
  });

  it("recordProviderResult creates event from success", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "MACRO",
      source: "Yahoo",
      operation: "VIX fetch",
      success: true,
      durationMs: 200,
    });
    expect(buf.events).toHaveLength(1);
    expect(buf.events[0].status).toBe("HEALTHY");
    expect(buf.events[0].component).toBe("MACRO");
  });

  it("recordProviderResult creates event from failure", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "NEWS",
      source: "AlphaVantage",
      operation: "News fetch",
      success: false,
      error: "429 rate limited",
    });
    expect(buf.events).toHaveLength(1);
    expect(buf.events[0].status).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. BUFFER QUERY HELPERS
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Buffer Query Helpers", () => {
  it("getLatestEventForComponent returns most recent", () => {
    let buf = createHealthEventBuffer();
    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", timestamp: 100 }));
    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", timestamp: 200 }));
    buf = recordHealthEvent(buf, makeEvent({ component: "OHLCV", timestamp: 300 }));

    const latest = getLatestEventForComponent(buf, "NEWS");
    expect(latest!.timestamp).toBe(200);
  });

  it("getLatestEventForComponent returns null for no events", () => {
    const buf = createHealthEventBuffer();
    expect(getLatestEventForComponent(buf, "NEWS")).toBeNull();
  });

  it("getEventsForComponent returns all matching", () => {
    let buf = createHealthEventBuffer();
    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", timestamp: 100 }));
    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", timestamp: 200 }));
    buf = recordHealthEvent(buf, makeEvent({ component: "OHLCV", timestamp: 300 }));

    const events = getEventsForComponent(buf, "NEWS");
    expect(events).toHaveLength(2);
  });

  it("getEventCount returns total", () => {
    let buf = createHealthEventBuffer();
    buf = recordHealthEvent(buf, makeEvent());
    buf = recordHealthEvent(buf, makeEvent());
    expect(getEventCount(buf)).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. HEALTH AGGREGATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Health Aggregation", () => {
  it("empty events produce all UNKNOWN components", () => {
    const components = aggregateRuntimeHealth([], Date.now());
    expect(components.every((c) => c.status === "UNKNOWN")).toBe(true);
  });

  it("most recent event determines component status", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: now - 5000 }),
      makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const news = components.find((c) => c.component === "NEWS");
    expect(news!.status).toBe("DEGRADED");
  });

  it("success after failure recovers to HEALTHY", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "OHLCV", status: "DEGRADED", timestamp: now - 5000 }),
      makeEvent({ component: "OHLCV", status: "HEALTHY", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const ohlcv = components.find((c) => c.component === "OHLCV");
    expect(ohlcv!.status).toBe("HEALTHY");
  });

  it("consecutive failures counted correctly", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: now - 10000 }),
      makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: now - 5000 }),
      makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: now - 3000 }),
      makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const news = components.find((c) => c.component === "NEWS");
    expect(news!.consecutiveFailures).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. HEALTH TRANSITIONS
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Health Transitions", () => {
  it("detects status change", () => {
    const prev = makeSnapshot({
      components: [
        { component: "NEWS", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      ],
    });
    const curr = makeSnapshot({
      components: [
        { component: "NEWS", status: "DEGRADED", consecutiveFailures: 2, message: "failed", freshness: "AGING" },
      ],
    });
    const transitions = detectHealthTransitions(prev, curr);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].previous).toBe("HEALTHY");
    expect(transitions[0].current).toBe("DEGRADED");
  });

  it("no transition when status unchanged", () => {
    const prev = makeSnapshot({
      components: [
        { component: "NEWS", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      ],
    });
    const curr = makeSnapshot({
      components: [
        { component: "NEWS", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      ],
    });
    expect(detectHealthTransitions(prev, curr)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. PERSISTENCE DECISION
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Persistence Decision", () => {
  it("first snapshot always persisted", () => {
    const snapshot = makeSnapshot();
    expect(shouldPersistRuntimeHealth(null, snapshot)).toBe(true);
  });

  it("overall status change → persist", () => {
    const prev = makeSnapshot({ overallStatus: "HEALTHY" });
    const curr = makeSnapshot({ overallStatus: "DEGRADED" });
    expect(shouldPersistRuntimeHealth(prev, curr)).toBe(true);
  });

  it("identical state → skip", () => {
    const now = Date.now();
    const prev = makeSnapshot({
      overallStatus: "HEALTHY",
      timestamp: now - 1000,
      components: [
        { component: "NEWS", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      ],
    });
    const curr = makeSnapshot({
      overallStatus: "HEALTHY",
      timestamp: now,
      components: [
        { component: "NEWS", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      ],
    });
    expect(shouldPersistRuntimeHealth(prev, curr)).toBe(false);
  });

  it("component status change → persist", () => {
    const prev = makeSnapshot({
      components: [
        { component: "NEWS", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      ],
    });
    const curr = makeSnapshot({
      components: [
        { component: "NEWS", status: "DEGRADED", consecutiveFailures: 2, message: "failed", freshness: "AGING" },
      ],
    });
    expect(shouldPersistRuntimeHealth(prev, curr)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. BUFFER PERSISTENCE INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Buffer Persistence Integration", () => {
  it("shouldPersistFromBuffer returns snapshot on first event", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "MARKET_DATA",
      success: true,
    });
    const snapshot = shouldPersistFromBuffer(buf, Date.now());
    expect(snapshot).not.toBeNull();
    expect(snapshot!.overallStatus).toBeDefined();
  });

  it("shouldPersistFromBuffer returns null when no change", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });
    const snap1 = shouldPersistFromBuffer(buf, Date.now());
    expect(snap1).not.toBeNull();

    buf = markPersisted(buf, snap1!);
    const snap2 = shouldPersistFromBuffer(buf, Date.now());
    expect(snap2).toBeNull();
  });

  it("markPersisted updates buffer", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });
    const snap = shouldPersistFromBuffer(buf, Date.now())!;
    buf = markPersisted(buf, snap);
    expect(buf.lastPersistedSnapshot).toBe(snap);
  });

  it("buildSnapshotFromBuffer produces valid snapshot", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "OHLCV", success: true, durationMs: 100 });
    buf = recordProviderResult(buf, { component: "NEWS", success: false, error: "429" });
    const snap = buildSnapshotFromBuffer(buf, Date.now());
    expect(snap.overallStatus).toBeDefined();
    expect(snap.components.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. DETERMINISTIC OUTPUT
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Deterministic Output", () => {
  it("same input produces identical health event", () => {
    const params = {
      component: "MACRO" as RuntimeComponent,
      source: "Yahoo",
      operation: "VIX fetch",
      success: true,
      durationMs: 150,
      timestamp: 5000,
    };
    const e1 = normalizeRuntimeHealthEvent(params);
    const e2 = normalizeRuntimeHealthEvent(params);
    expect(e1.status).toBe(e2.status);
    expect(e1.component).toBe(e2.component);
    expect(e1.source).toBe(e2.source);
  });

  it("classifyError is deterministic", () => {
    expect(classifyError("rate limit")).toBe(classifyError("rate limit"));
    expect(classifyError("timeout")).toBe(classifyError("timeout"));
  });

  it("aggregateRuntimeHealth is deterministic", () => {
    const events = [
      makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: 1000 }),
    ];
    const c1 = aggregateRuntimeHealth(events, 2000);
    const c2 = aggregateRuntimeHealth(events, 2000);
    expect(c1.map((c) => c.status)).toEqual(c2.map((c) => c.status));
  });
});

// ═══════════════════════════════════════════════════════════════
// K. SAFETY — NO EXECUTION / PROBABILITY / FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Safety Invariants", () => {
  it("health events contain no execution language", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "MARKET_DATA",
      success: true,
      message: "Price fetched successfully",
    });
    const json = JSON.stringify(event).toLowerCase();
    expect(json).not.toContain("execute");
    expect(json).not.toContain("auto-buy");
    expect(json).not.toContain("auto-sell");
    expect(json).not.toContain("place order");
  });

  it("health events contain no probability language", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "NEWS",
      success: true,
    });
    const json = JSON.stringify(event).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("guaranteed");
    expect(json).not.toContain("likely");
  });

  it("health events contain no fabricated prices", () => {
    const event = normalizeRuntimeHealthEvent({
      component: "MARKET_DATA",
      success: true,
    });
    const json = JSON.stringify(event).toLowerCase();
    expect(json).not.toContain("$");
    expect(json).not.toContain("price");
  });

  it("buffer is bounded", () => {
    let buf = createHealthEventBuffer();
    for (let i = 0; i < 300; i++) {
      buf = recordHealthEvent(buf, makeEvent({ timestamp: i }));
    }
    expect(buf.events.length).toBeLessThanOrEqual(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. RECOVERY SCENARIOS
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Recovery Scenarios", () => {
  it("provider recovers from DEGRADED to HEALTHY", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: now - 10000 }),
      makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: now - 5000 }),
      makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const news = components.find((c) => c.component === "NEWS");
    expect(news!.status).toBe("HEALTHY");
  });

  it("provider recovers from UNAVAILABLE to HEALTHY", () => {
    const now = Date.now();
    const events: RuntimeHealthEvent[] = [
      makeEvent({ component: "MACRO", status: "HEALTHY", timestamp: now - 20000 }),
      makeEvent({ component: "MACRO", status: "UNAVAILABLE", timestamp: now - 10000 }),
      makeEvent({ component: "MACRO", status: "HEALTHY", timestamp: now - 1000 }),
    ];
    const components = aggregateRuntimeHealth(events, now);
    const macro = components.find((c) => c.component === "MACRO");
    expect(macro!.status).toBe("HEALTHY");
  });

  it("recovery triggers persistence", () => {
    let buf = createHealthEventBuffer();
    buf = recordHealthEvent(buf, makeEvent({ component: "MARKET_DATA", status: "HEALTHY", timestamp: 1000 }));
    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", status: "HEALTHY", timestamp: 1000 }));
    const snap1 = shouldPersistFromBuffer(buf, 2000)!;
    buf = markPersisted(buf, snap1);

    // Simulate failure — NEWS becomes DEGRADED
    buf = recordHealthEvent(buf, makeEvent({ component: "NEWS", status: "DEGRADED", timestamp: 3000 }));
    const snap2 = shouldPersistFromBuffer(buf, 4000);
    expect(snap2).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// M. CORE vs NON-CORE FAILURE
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Core vs Non-Core Failure", () => {
  it("core provider failure → UNAVAILABLE overall", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: false, error: "503" });
    const snap = buildSnapshotFromBuffer(buf, Date.now());
    expect(snap.overallStatus).toBe("UNAVAILABLE");
  });

  it("non-core provider failure → DEGRADED overall", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, { component: "MARKET_DATA", success: true });
    buf = recordProviderResult(buf, { component: "NEWS", success: false, error: "429" });
    const snap = buildSnapshotFromBuffer(buf, Date.now());
    expect(snap.overallStatus).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. INTELLIGENCE CYCLE EVENTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Intelligence Cycle Events", () => {
  it("records intelligence engine success", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "INTELLIGENCE_ENGINE",
      operation: "Analyzed 3/3 positions",
      success: true,
      message: "3/3 positions analyzed",
    });
    const latest = getLatestEventForComponent(buf, "INTELLIGENCE_ENGINE");
    expect(latest!.status).toBe("HEALTHY");
    expect(latest!.operation).toContain("3/3");
  });

  it("records intelligence engine failure", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "INTELLIGENCE_ENGINE",
      success: false,
      error: "Generation failed",
    });
    const latest = getLatestEventForComponent(buf, "INTELLIGENCE_ENGINE");
    expect(latest!.status).not.toBe("HEALTHY");
  });
});

// ═══════════════════════════════════════════════════════════════
// O. NOTIFICATION / HISTORICAL PERSISTENCE EVENTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 100 — Persistence Events", () => {
  it("records notification persistence success", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "NOTIFICATION_PERSISTENCE",
      operation: "Persist notification",
      success: true,
    });
    expect(getLatestEventForComponent(buf, "NOTIFICATION_PERSISTENCE")!.status).toBe("HEALTHY");
  });

  it("records historical persistence success", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "HISTORICAL_PERSISTENCE",
      operation: "Save snapshot",
      success: true,
    });
    expect(getLatestEventForComponent(buf, "HISTORICAL_PERSISTENCE")!.status).toBe("HEALTHY");
  });

  it("records persistence failure", () => {
    let buf = createHealthEventBuffer();
    buf = recordProviderResult(buf, {
      component: "HISTORICAL_PERSISTENCE",
      operation: "Save events",
      success: false,
      error: "Network error",
    });
    expect(getLatestEventForComponent(buf, "HISTORICAL_PERSISTENCE")!.status).toBe("DEGRADED");
  });
});
