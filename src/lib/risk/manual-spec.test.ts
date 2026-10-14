import { describe, expect, it } from "vitest";
import { buildManualInstrumentSpec, type ManualInstrumentSpecFields } from "./manual-spec";

const EMPTY: ManualInstrumentSpecFields = {
  quoteCurrency: "",
  contractSize: "",
  quantityStep: "",
  minQuantity: "",
};

describe("buildManualInstrumentSpec", () => {
  it("returns no spec when the user leaves all broker fields blank", () => {
    expect(buildManualInstrumentSpec({
      instrument: "EUR/USD",
      assetClass: "forex",
      fields: EMPTY,
    })).toBeUndefined();
  });

  it("keeps entered contract metadata explicit and records its instrument/source", () => {
    expect(buildManualInstrumentSpec({
      instrument: "XAU/USD",
      assetClass: "commodity",
      fields: {
        quoteCurrency: "usd",
        contractSize: "100",
        quantityStep: "0.01",
        minQuantity: "0.01",
      },
    })).toEqual({
      assetClass: "commodity",
      quoteCurrency: "USD",
      contractSize: 100,
      quantityStep: 0.01,
      minQuantity: 0.01,
      source: "user-provided broker specification (XAU/USD)",
    });
  });

  it("does not fill missing lot/contract values from the asset class", () => {
    expect(buildManualInstrumentSpec({
      instrument: "EUR/USD",
      assetClass: "forex",
      fields: { ...EMPTY, quoteCurrency: "USD" },
    })).toEqual({
      assetClass: "forex",
      quoteCurrency: "USD",
      source: "user-provided broker specification (EUR/USD)",
    });
  });

  it("ignores non-positive, non-finite, and malformed inputs instead of guessing", () => {
    expect(buildManualInstrumentSpec({
      instrument: "AAPL",
      assetClass: "stock",
      fields: {
        quoteCurrency: "US",
        contractSize: "0",
        quantityStep: "-1",
        minQuantity: "NaN",
      },
    })).toBeUndefined();
  });

  it("accepts explicit crypto quote assets such as USDT without inventing a conversion", () => {
    expect(buildManualInstrumentSpec({
      instrument: "BTC/USDT",
      assetClass: "crypto",
      fields: { ...EMPTY, quoteCurrency: "usdt", contractSize: "0.01", quantityStep: "1" },
    })).toMatchObject({
      quoteCurrency: "USDT",
      contractSize: 0.01,
      quantityStep: 1,
    });
  });

  it("keeps a valid partial spec partial when mandatory fields are not supplied", () => {
    expect(buildManualInstrumentSpec({
      instrument: "AAPL",
      assetClass: "stock",
      fields: {
        quoteCurrency: "USD",
        contractSize: "",
        quantityStep: "1",
        minQuantity: "",
      },
    })).toEqual({
      assetClass: "stock",
      quantityStep: 1,
      quoteCurrency: "USD",
      source: "user-provided broker specification (AAPL)",
    });
  });
});
