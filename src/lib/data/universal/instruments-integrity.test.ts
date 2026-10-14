import { describe, expect, it } from "vitest";
import { getAllInstrumentIds, getAllInstruments, getProviderSymbol, resolveInstrument } from "./instruments";

describe("universal instrument registry integrity", () => {
  it("has unique canonical identifiers that round-trip exactly", () => {
    const ids = getAllInstrumentIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      const instrument = resolveInstrument(id);
      expect(instrument, `missing registry entry for ${id}`).toBeDefined();
      expect(instrument?.canonical).toBe(id);
      expect(instrument?.displaySymbol.trim()).not.toBe("");
      expect(instrument?.assetClass).toBeTruthy();
      expect(instrument?.subType).toBeTruthy();
    }
  });

  it("returns exact declared provider mappings without substituting symbols", () => {
    for (const instrument of getAllInstruments()) {
      for (const mapping of instrument.providerMappings) {
        const actual = getProviderSymbol(instrument.canonical, mapping.provider);
        expect(actual, `${instrument.canonical} / ${mapping.provider}`).toBe(
          mapping.available ? mapping.symbol : null,
        );
        if (actual !== null) expect(actual.trim()).not.toBe("");
      }
    }
  });

  it("does not fabricate mappings for unknown or empty instruments", () => {
    expect(resolveInstrument("NOT-A-REAL-INSTRUMENT")).toBeUndefined();
    expect(getProviderSymbol("NOT-A-REAL-INSTRUMENT", "twelve-data")).toBeNull();
    expect(getProviderSymbol("", "twelve-data")).toBeNull();
  });
});
