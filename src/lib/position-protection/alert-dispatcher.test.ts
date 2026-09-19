import { describe, it, expect } from "vitest";
import {
  severityToNotificationPriority,
  computeEventFingerprint,
  createDispatcherState,
  shouldDispatch,
  dispatch,
  acknowledgeAlert,
} from "./alert-dispatcher";
import type { ProtectionEvent } from "./realtime-types";

describe("severityToNotificationPriority", () => {
  it("maps NONE to INFO", () => expect(severityToNotificationPriority("NONE")).toBe("INFO"));
  it("maps WATCH to INFO", () => expect(severityToNotificationPriority("WATCH")).toBe("INFO"));
  it("maps CAUTION to WARNING", () => expect(severityToNotificationPriority("CAUTION")).toBe("WARNING"));
  it("maps HIGH_RISK to URGENT", () => expect(severityToNotificationPriority("HIGH_RISK")).toBe("URGENT"));
  it("maps INVALIDATED to CRITICAL", () => expect(severityToNotificationPriority("INVALIDATED")).toBe("CRITICAL"));
});

describe("computeEventFingerprint", () => {
  it("produces deterministic fingerprint", () => {
    const fp1 = computeEventFingerprint("pos-1", "CAUTION", 1000000);
    const fp2 = computeEventFingerprint("pos-1", "CAUTION", 1000000);
    expect(fp1).toBe(fp2);
  });

  it("buckets by time window", () => {
    const fp1 = computeEventFingerprint("pos-1", "CAUTION", 100000, 30_000);
    const fp2 = computeEventFingerprint("pos-1", "CAUTION", 110000, 30_000);
    expect(fp1).toBe(fp2); // Same 30s bucket
  });

  it("different positions produce different fingerprints", () => {
    const fp1 = computeEventFingerprint("pos-1", "CAUTION", 1000000);
    const fp2 = computeEventFingerprint("pos-2", "CAUTION", 1000000);
    expect(fp1).not.toBe(fp2);
  });
});

/**
 * Fixed clock aligned to a 30s dedup-bucket boundary.
 *
 * These tests previously used the wall clock. The dispatcher buckets
 * fingerprints as Math.floor(timestamp / 30_000), so whenever the wall
 * clock happened to land in the final second of a bucket, `now` and
 * `now + 1000` fell into DIFFERENT buckets and the dedup assertions
 * failed — a real ~3.3% flake unrelated to any code change.
 */
const FIXED_NOW = 1_800_000_000_000; // exactly divisible by 30_000

function makeEvent(overrides: Partial<ProtectionEvent> = {}): ProtectionEvent {
  return {
    eventId: "evt-1",
    positionId: "pos-1",
    instrument: "BTC/USDT",
    notificationPriority: "WARNING",
    severity: "CAUTION",
    action: "Consider protecting profit.",
    reason: "Thesis deteriorating.",
    timestamp: FIXED_NOW,
    stateTransition: true,
    acknowledged: false,
    ...overrides,
  };
}

describe("shouldDispatch", () => {
  it("always dispatches INVALIDATED", () => {
    const state = createDispatcherState();
    const result = shouldDispatch(state, "pos-1", "INVALIDATED", FIXED_NOW);
    expect(result.shouldDispatch).toBe(true);
  });

  it("dispatches first alert for position", () => {
    const state = createDispatcherState();
    const result = shouldDispatch(state, "pos-1", "CAUTION", FIXED_NOW);
    expect(result.shouldDispatch).toBe(true);
    expect(result.reason).toContain("First alert");
  });

  it("dispatches on escalation", () => {
    let state = createDispatcherState();
    const now = FIXED_NOW;
    state = shouldDispatch(state, "pos-1", "WATCH", now).shouldDispatch
      ? dispatch(state, makeEvent({ severity: "WATCH", timestamp: now }))
      : state;
    const result = shouldDispatch(state, "pos-1", "CAUTION", now + 1000);
    expect(result.shouldDispatch).toBe(true);
    expect(result.isEscalation).toBe(true);
  });

  it("dispatches on recovery", () => {
    let state = createDispatcherState();
    const now = FIXED_NOW;
    state = dispatch(state, makeEvent({ severity: "CAUTION", timestamp: now }));
    const result = shouldDispatch(state, "pos-1", "WATCH", now + 1000);
    expect(result.shouldDispatch).toBe(true);
    expect(result.isRecovery).toBe(true);
  });

  it("blocks duplicate within same fingerprint bucket", () => {
    let state = createDispatcherState();
    const now = FIXED_NOW;
    state = dispatch(state, makeEvent({ severity: "WATCH", timestamp: now }));
    const result = shouldDispatch(state, "pos-1", "WATCH", now + 1000);
    expect(result.shouldDispatch).toBe(false);
    expect(result.isDuplicate).toBe(true);
  });

  it("allows re-alert after cooldown", () => {
    let state = createDispatcherState();
    const now = FIXED_NOW;
    state = dispatch(state, makeEvent({ severity: "WATCH", timestamp: now }));
    const result = shouldDispatch(state, "pos-1", "WATCH", now + 31_000);
    expect(result.shouldDispatch).toBe(true);
    expect(result.reason).toContain("Periodic");
  });
});

describe("dispatch", () => {
  it("adds to history and active alerts", () => {
    const state = createDispatcherState();
    const event = makeEvent();
    const updated = dispatch(state, event);
    expect(updated.history).toHaveLength(1);
    expect(updated.activeAlerts.get("pos-1")).toBeDefined();
    expect(updated.unreadCount).toBe(1);
  });

  it("removes active alert on NONE severity", () => {
    let state = createDispatcherState();
    state = dispatch(state, makeEvent({ severity: "CAUTION" }));
    state = dispatch(state, makeEvent({ severity: "NONE" }));
    expect(state.activeAlerts.has("pos-1")).toBe(false);
  });

  it("records fingerprint for dedup", () => {
    const state = createDispatcherState();
    const now = FIXED_NOW;
    const updated = dispatch(state, makeEvent({ severity: "WATCH", timestamp: now }));
    const fp = computeEventFingerprint("pos-1", "WATCH", now);
    expect(updated.seenFingerprints.has(fp)).toBe(true);
  });
});

describe("acknowledgeAlert", () => {
  it("marks history entries as acknowledged", () => {
    let state = createDispatcherState();
    state = dispatch(state, makeEvent({ severity: "CAUTION" }));
    const updated = acknowledgeAlert(state, "pos-1");
    expect(updated.history[0].acknowledged).toBe(true);
    expect(updated.activeAlerts.has("pos-1")).toBe(false);
  });

  it("decrements unread count", () => {
    let state = createDispatcherState();
    state = dispatch(state, makeEvent());
    const updated = acknowledgeAlert(state, "pos-1");
    expect(updated.unreadCount).toBe(0);
  });
});
