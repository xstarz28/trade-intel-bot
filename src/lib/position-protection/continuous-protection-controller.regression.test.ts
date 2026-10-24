import { describe, expect, it } from "vitest";
import {
  createControllerState,
  processEventForController,
  registerPosition,
} from "./continuous-protection-controller";
import type { RealTimeEvent } from "./realtime-types";

function makeEvent(price: number): RealTimeEvent {
  return {
    eventId: `price-${String(price)}`,
    instrument: "BTC/USD",
    timestamp: 100_000,
    source: "test-provider",
    freshness: "FRESH",
    eventType: "PRICE_UPDATE",
    priority: "CRITICAL",
    dependencyGroup: "price-feed",
    payload: { price },
  };
}

function initialState() {
  return registerPosition(createControllerState(), {
    positionId: "position-1",
    instrument: "BTC/USD",
    side: "LONG",
    entryPrice: 100,
    currentPrice: 100,
    stopLoss: 95,
    horizon: "INTRADAY",
    assetClass: "crypto",
    openedAt: 1_000,
  }, 1_000);
}

describe("continuous protection controller price observations", () => {
  it("evaluates and records the validated event price in the same cycle", () => {
    const result = processEventForController(initialState(), makeEvent(90), 100_000);
    const position = result.state.positions.get("position-1");

    expect(position?.currentPrice).toBe(90);
    expect(position?.accelerationState.priceObservations[position.accelerationState.priceObservations.length - 1]).toMatchObject({
      timestamp: 100_000,
      value: 90,
      source: "position-controller",
    });
  });

  it("does not let a non-finite event price poison the position state", () => {
    const result = processEventForController(initialState(), makeEvent(Number.NaN), 100_000);
    const position = result.state.positions.get("position-1");

    expect(position?.currentPrice).toBe(100);
    expect(position?.accelerationState.priceObservations[position.accelerationState.priceObservations.length - 1]?.value).toBe(100);
  });

  it("records successive price and giveback observations for acceleration checks", () => {
    const first = processEventForController(initialState(), makeEvent(100), 100_000);
    const second = processEventForController(first.state, makeEvent(96), 200_000);
    const position = second.state.positions.get("position-1");

    expect(position?.accelerationState.priceObservations).toHaveLength(2);
    expect(position?.accelerationState.givebackObservations).toHaveLength(2);
  });
});
