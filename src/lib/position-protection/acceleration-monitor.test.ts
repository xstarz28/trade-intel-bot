import { describe, it, expect } from "vitest";
import {
  createAccelerationState,
  recordPriceObservation,
  recordVolatilityObservation,
  recordGivebackObservation,
  detectPriceAcceleration,
  detectGivebackAcceleration,
  calculateAcceleration,
} from "./acceleration-monitor";

describe("createAccelerationState", () => {
  it("creates empty state with defaults", () => {
    const state = createAccelerationState();
    expect(state.priceObservations).toEqual([]);
    expect(state.volatilityObservations).toEqual([]);
    expect(state.givebackObservations).toEqual([]);
    expect(state.maxBufferSize).toBe(100);
    expect(state.windowMs).toBe(300_000);
  });

  it("accepts custom config", () => {
    const state = createAccelerationState({ maxBufferSize: 50, windowMs: 60_000 });
    expect(state.maxBufferSize).toBe(50);
    expect(state.windowMs).toBe(60_000);
  });
});

describe("recordPriceObservation", () => {
  it("adds observation to buffer", () => {
    let state = createAccelerationState();
    state = recordPriceObservation(state, Date.now(), 50000, "OKX");
    expect(state.priceObservations).toHaveLength(1);
    expect(state.priceObservations[0].value).toBe(50000);
    expect(state.priceObservations[0].source).toBe("OKX");
  });

  it("trims old observations outside window", () => {
    let state = createAccelerationState({ windowMs: 1000 });
    state = recordPriceObservation(state, Date.now() - 2000, 50000, "OKX");
    state = recordPriceObservation(state, Date.now(), 51000, "OKX");
    expect(state.priceObservations).toHaveLength(1);
    expect(state.priceObservations[0].value).toBe(51000);
  });

  it("respects max buffer size", () => {
    let state = createAccelerationState({ maxBufferSize: 3, windowMs: 600_000 });
    for (let i = 0; i < 5; i++) {
      state = recordPriceObservation(state, Date.now() + i * 100, 50000 + i * 100, "OKX");
    }
    expect(state.priceObservations).toHaveLength(3);
  });
});

describe("calculateAcceleration", () => {
  it("returns NORMAL with insufficient observations", () => {
    const result = calculateAcceleration([], Date.now());
    expect(result.level).toBe("NORMAL");
    expect(result.observationCount).toBe(0);
  });

  it("returns NORMAL with one observation", () => {
    const result = calculateAcceleration(
      [{ timestamp: Date.now(), value: 50000, source: "test" }],
      Date.now(),
    );
    expect(result.level).toBe("NORMAL");
    expect(result.observationCount).toBe(1);
  });

  it("detects ELEVATED acceleration with rapid price change", () => {
    const now = Date.now();
    const observations = [
      { timestamp: now - 2000, value: 50000, source: "test" },
      { timestamp: now - 1000, value: 53000, source: "test" },
      { timestamp: now, value: 56000, source: "test" },
    ];
    const result = calculateAcceleration(observations, now);
    expect(result.rate).toBeGreaterThan(0);
    expect(["ELEVATED", "HIGH"]).toContain(result.level);
  });

  it("detects HIGH acceleration with extreme rate", () => {
    const now = Date.now();
    const observations = [
      { timestamp: now - 1000, value: 50000, source: "test" },
      { timestamp: now - 500, value: 55000, source: "test" },
      { timestamp: now, value: 70000, source: "test" },
    ];
    const result = calculateAcceleration(observations, now);
    expect(result.level).toBe("HIGH");
  });
});

describe("detectPriceAcceleration", () => {
  it("returns NORMAL when price moves in favorable direction for LONG", () => {
    let state = createAccelerationState();
    const now = Date.now();
    state = recordPriceObservation(state, now - 2000, 50000, "test");
    state = recordPriceObservation(state, now - 1000, 52000, "test");
    state = recordPriceObservation(state, now, 54000, "test");
    const result = detectPriceAcceleration(state, "LONG", now);
    expect(result.level).toBe("NORMAL");
    expect(result.description).toContain("favorable");
  });

  it("detects adverse acceleration for LONG when price drops", () => {
    let state = createAccelerationState();
    const now = Date.now();
    state = recordPriceObservation(state, now - 2000, 52000, "test");
    state = recordPriceObservation(state, now - 1000, 50000, "test");
    state = recordPriceObservation(state, now, 48000, "test");
    const result = detectPriceAcceleration(state, "LONG", now);
    expect(result.rate).toBeLessThan(0);
  });

  it("detects adverse acceleration for SHORT when price rises", () => {
    let state = createAccelerationState();
    const now = Date.now();
    state = recordPriceObservation(state, now - 2000, 48000, "test");
    state = recordPriceObservation(state, now - 1000, 50000, "test");
    state = recordPriceObservation(state, now, 52000, "test");
    const result = detectPriceAcceleration(state, "SHORT", now);
    expect(result.rate).toBeGreaterThan(0);
  });
});

describe("detectGivebackAcceleration", () => {
  it("returns NORMAL with no observations", () => {
    const state = createAccelerationState();
    const result = detectGivebackAcceleration(state, Date.now());
    expect(result.level).toBe("NORMAL");
  });
});

describe("volatility observation", () => {
  it("records volatility observation", () => {
    let state = createAccelerationState();
    state = recordVolatilityObservation(state, Date.now(), 1500, "test");
    expect(state.volatilityObservations).toHaveLength(1);
  });
});

describe("giveback observation", () => {
  it("records giveback observation", () => {
    let state = createAccelerationState();
    state = recordGivebackObservation(state, Date.now(), 25, "test");
    expect(state.givebackObservations).toHaveLength(1);
  });
});
