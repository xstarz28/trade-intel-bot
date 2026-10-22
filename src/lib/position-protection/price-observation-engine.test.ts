import { describe, expect, it } from "vitest";
import {
  addObservation,
  createObservationState,
  isFinitePositivePrice,
} from "./price-observation-engine";

describe("isFinitePositivePrice", () => {
  it.each([1, 0.000001, 42.5])("accepts finite positive price %s", (price) => {
    expect(isFinitePositivePrice(price)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid price %s",
    (price) => {
      expect(isFinitePositivePrice(price)).toBe(false);
    },
  );
});

describe("addObservation", () => {
  it("does not append invalid or non-finite prices", () => {
    const initial = createObservationState("BTC/USDT");
    const withValidPrice = addObservation(initial, 65_000, 1_000);

    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(addObservation(withValidPrice, price, 2_000)).toBe(withValidPrice);
    }

    expect(withValidPrice.observations).toEqual([{ price: 65_000, timestamp: 1_000 }]);
    expect(withValidPrice.lastUpdateAt).toBe(1_000);
  });
});
