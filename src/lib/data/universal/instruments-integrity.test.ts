import { describe, expect, it } from "vitest";
import { computeInstrumentCoverage, computeProviderSummaries } from "./coverage";
import { getAllProviders } from "./providers";
import { checkCredentials } from "./live/credentials";
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
  it("keeps provider coverage aligned with the canonical provider registry", () => {
    const providers = getAllProviders();
    const summaries = computeProviderSummaries();

    expect(summaries.map((provider) => provider.providerId).sort()).toEqual(
      providers.map((provider) => provider.id).sort(),
    );

    for (const provider of providers) {
      const summary = summaries.find((item) => item.providerId === provider.id);
      expect(summary?.credentialsAvailable).toBe(provider.credentialsAvailable);
      expect(summary?.assetClasses).toEqual(provider.assetClasses);
      expect(summary?.capabilities).toEqual(
        provider.capabilities.map((capability) => capability.capability),
      );
    }
  });

  it("marks a capability unavailable only when no mapped provider has usable credentials", () => {
    const coverage = computeInstrumentCoverage("BTC/USD", () => undefined);
    expect(coverage).not.toBeNull();

    expect(coverage?.supportedCapabilities).toContain("quote");
    expect(coverage?.unsupportedCapabilities).not.toContain("quote");

    // CoinGlass has an instrument mapping, but its provider credentials are
    // intentionally unavailable; this must not be presented as usable data.
    expect(coverage?.unsupportedCapabilities).toContain("open_interest");
    expect(coverage?.supportedCapabilities).not.toContain("open_interest");
  });

  it("resolves authenticated provider availability from the injected runtime environment", () => {
    const env: Record<string, string | undefined> = {
      TWELVE_DATA_API_KEY: "configured",
      COINGLASS_API_KEY: "configured",
    };
    const readEnv = (name: string) => env[name];

    const twelveData = checkCredentials("twelve-data", readEnv);
    expect(twelveData?.available).toBe(true);
    expect(twelveData?.missingEnvVarNames).toEqual([]);
    expect(twelveData).not.toHaveProperty("credentialValue");

    const alphaVantage = checkCredentials("alpha-vantage", readEnv);
    expect(alphaVantage?.available).toBe(false);
    expect(alphaVantage?.missingEnvVarNames).toEqual(["ALPHA_VANTAGE_API_KEY"]);

    expect(checkCredentials("coingecko", readEnv)?.available).toBe(true);
    expect(checkCredentials("unknown-provider", readEnv)).toBeNull();

    const providers = getAllProviders(readEnv);
    expect(providers.find((provider) => provider.id === "twelve-data")?.credentialsAvailable).toBe(true);
    expect(providers.find((provider) => provider.id === "coinglass")?.credentialsAvailable).toBe(true);
    expect(providers.find((provider) => provider.id === "alpha-vantage")?.credentialsAvailable).toBe(false);

    const coverage = computeInstrumentCoverage("BTC/USD", readEnv);
    expect(coverage?.supportedCapabilities).toContain("open_interest");
    expect(coverage?.supportedCapabilities).toContain("funding_rate");
  });

  it("treats blank credential values as missing without returning secret values", () => {
    const status = checkCredentials("eia", (name) =>
      name === "EIA_API_KEY" ? "   " : undefined,
    );

    expect(status?.available).toBe(false);
    expect(status?.missingEnvVarNames).toEqual(["EIA_API_KEY"]);
    expect(JSON.stringify(status)).not.toContain("EIA_API_KEY_VALUE");
  });

});
