import { describe, expect, it } from "vitest";
import {
  formatInstrumentPrice,
  formatInstrumentPriceValue,
  getInstrumentPricePrecision,
} from "./price-format";

describe("instrument-aware price precision", () => {
  it("keeps standard and JPY forex precision", () => {
    expect(getInstrumentPricePrecision(1.08432, "forex", "EUR/USD")).toBe(5);
    expect(getInstrumentPricePrecision(149.876, "forex", "USD/JPY")).toBe(3);
    expect(formatInstrumentPriceValue(149.8764, "forex", "USD/JPY")).toBe("149.876");
  });

  it("preserves tiny crypto prices rather than truncating them to five decimals", () => {
    expect(getInstrumentPricePrecision(0.0000123456, "crypto", "SHIB/USD")).toBe(10);
    expect(formatInstrumentPriceValue(0.0000123456, "crypto", "SHIB/USD")).toBe("0.0000123456");
  });

  it("uses the same precision policy for normal and high-value assets", () => {
    expect(formatInstrumentPrice(12.34567, "stock", "XYZ")).toBe("12.35");
    expect(formatInstrumentPrice(65000, "crypto", "BTC/USD")).toBe("65,000");
    expect(formatInstrumentPriceValue(65000, "crypto", "BTC/USD")).toBe("65000.00");
  });

  it("returns a safe placeholder for non-finite display values", () => {
    expect(formatInstrumentPrice(Number.NaN, "stock", "XYZ")).toBe("—");
    expect(formatInstrumentPriceValue(Number.POSITIVE_INFINITY, "stock", "XYZ")).toBe("—");
  });
});
