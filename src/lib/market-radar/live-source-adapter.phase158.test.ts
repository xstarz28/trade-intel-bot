import { describe, expect, it } from "vitest";
import { buildRadarSourcesFromLiveSources } from "./live-source-adapter";
import type { LiveCandidateSource } from "../liveCandidateBuilder";

describe("Phase 158 — live source to radar adapter", () => {
  const source: LiveCandidateSource = {
    instrument: "XYZ-NEW-NATIVE",
    assetClass: "equity",
    providerNative: {
      provider: "example-provider",
      providerInstrumentId: "XYZ-NEW-NATIVE",
    },
    marketData: {
      instrument: "XYZ-NEW-NATIVE",
      instrumentType: "stock",
      provider: "example-provider",
      fetchTimestamp: 1000,
      price: {
        price: 123.45,
        timestamp: 999,
        source: "example-provider",
      },
      candles: [
        {
          timestamp: 999,
          open: 120,
          high: 125,
          low: 119,
          close: 123.45,
          volume: 1000,
        },
      ],
      timeframe: "1h",
      dataFreshness: "realtime",
    },
  };

  it("accepts an instrument outside the legacy static universe", () => {
    const [radar] = buildRadarSourcesFromLiveSources([source]);

    expect(radar.universe.instrument).toBe("XYZ-NEW-NATIVE");
    expect(radar.universe.region).toBe("global");
  });

  it("does not classify region from ticker whitelists", () => {
    const [radar] = buildRadarSourcesFromLiveSources([
      { ...source, instrument: "BBCA-NEW-SERIES" },
    ]);

    expect(radar.universe.region).toBe("global");
  });

  it("preserves live price/provider evidence", () => {
    const [radar] = buildRadarSourcesFromLiveSources([source]);

    expect(radar.snapshot?.price).toBe(123.45);
    expect(radar.snapshot?.provider).toBe("example-provider");
    expect(radar.snapshot?.freshness).toBe("FRESH");
    expect(radar.snapshot?.quality).toBe("VERIFIED");
  });

  it("returns no sources for an empty live set", () => {
    expect(buildRadarSourcesFromLiveSources([])).toEqual([]);
  });
});
