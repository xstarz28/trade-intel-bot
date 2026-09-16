/**
 * Phase 165 — Provider discovery capability classification.
 *
 * The rule: "provider returned nothing" must never be conflated with
 * "provider has no discovery API", "credentials missing", "auth rejected",
 * or "rate limited". Each is a different fact about the world, and only one
 * of them ever justifies saying we enumerated the provider's market.
 */

import { describe, expect, it } from "vitest";
import {
  classifyAllProviders,
  classifyFromDiscoveryResult,
  classifyProviderDiscovery,
  getDiscoveryProfile,
  isDiscoveryFault,
  isDiscoveryProven,
  provenDiscoveryCoverage,
  PROVIDER_DISCOVERY_PROFILES,
} from "./provider-capability";

const KEYED = (name: string) =>
  name === "TWELVE_DATA_API_KEY" ? "key" : undefined;
const UNKEYED = () => undefined;

describe("A — static classification never overstates", () => {
  it("never returns SUPPORTED_DISCOVERY without a real call", () => {
    for (const status of classifyAllProviders(KEYED)) {
      expect(status.status).not.toBe("SUPPORTED_DISCOVERY");
    }
  });

  it("reports an implemented+configured provider as RUNTIME_UNVERIFIED", () => {
    // OKX discovery is keyless.
    expect(classifyProviderDiscovery("okx", UNKEYED).status).toBe(
      "RUNTIME_UNVERIFIED",
    );
  });

  it("distinguishes missing credentials from no discovery API", () => {
    expect(classifyProviderDiscovery("twelve-data", UNKEYED).status).toBe(
      "NOT_CONFIGURED",
    );
    expect(classifyProviderDiscovery("cftc", KEYED).status).toBe(
      "NO_DISCOVERY_API",
    );
  });

  it("names the missing env var without exposing any value", () => {
    const status = classifyProviderDiscovery("twelve-data", UNKEYED);
    expect(status.missingEnvVarNames).toEqual(["TWELVE_DATA_API_KEY"]);
    expect(JSON.stringify(status)).not.toContain("key");
  });

  it("treats an unknown provider as having no discovery API", () => {
    expect(classifyProviderDiscovery("nonexistent").status).toBe(
      "NO_DISCOVERY_API",
    );
  });
});

describe("B — enrichment providers are not discovery sources", () => {
  const enrichment = ["coinglass", "defillama", "tokenomist", "tickatlas", "treasury", "cftc", "eia"];

  it("marks analytics providers as NO_DISCOVERY_API with a reason", () => {
    for (const provider of enrichment) {
      const profile = getDiscoveryProfile(provider);
      expect(profile?.providerHasDiscoveryApi).toBe(false);
      expect(profile?.note).toBeTruthy();
      expect(profile?.discoverableAssetClasses).toEqual([]);
    }
  });

  it("does not treat NO_DISCOVERY_API as a fault", () => {
    expect(isDiscoveryFault("NO_DISCOVERY_API")).toBe(false);
    expect(isDiscoveryFault("RATE_LIMITED")).toBe(true);
    expect(isDiscoveryFault("AUTH_FAILED")).toBe(true);
    expect(isDiscoveryFault("CONFIGURED_BUT_UNAVAILABLE")).toBe(true);
  });

  it("cannot be upgraded to SUPPORTED_DISCOVERY by any result", () => {
    const upgraded = classifyFromDiscoveryResult("cftc", {
      success: true,
      instrumentCount: 500,
    });
    expect(upgraded.status).toBe("NO_DISCOVERY_API");
  });
});

describe("C — runtime classification from real outcomes", () => {
  it("promotes to SUPPORTED_DISCOVERY only with instruments returned", () => {
    const ok = classifyFromDiscoveryResult("okx", {
      success: true,
      instrumentCount: 742,
    });
    expect(ok.status).toBe("SUPPORTED_DISCOVERY");
    expect(isDiscoveryProven(ok.status)).toBe(true);
  });

  it("does NOT promote on a successful but empty response", () => {
    const empty = classifyFromDiscoveryResult("okx", {
      success: true,
      instrumentCount: 0,
    });
    expect(empty.status).toBe("CONFIGURED_BUT_UNAVAILABLE");
    expect(isDiscoveryProven(empty.status)).toBe(false);
  });

  it("detects auth failure distinctly", () => {
    expect(
      classifyFromDiscoveryResult(
        "twelve-data",
        { success: false, instrumentCount: 0, httpStatus: 401 },
        KEYED,
      ).status,
    ).toBe("AUTH_FAILED");
  });

  it("detects rate limiting distinctly", () => {
    expect(
      classifyFromDiscoveryResult(
        "twelve-data",
        { success: false, instrumentCount: 0, httpStatus: 429 },
        KEYED,
      ).status,
    ).toBe("RATE_LIMITED");
  });

  it("keeps NOT_CONFIGURED when the key is genuinely absent", () => {
    expect(
      classifyFromDiscoveryResult(
        "twelve-data",
        { success: false, instrumentCount: 0 },
        UNKEYED,
      ).status,
    ).toBe("NOT_CONFIGURED");
  });

  it("falls back to CONFIGURED_BUT_UNAVAILABLE for generic failures", () => {
    expect(
      classifyFromDiscoveryResult(
        "okx",
        { success: false, instrumentCount: 0, error: "socket hang up" },
      ).status,
    ).toBe("CONFIGURED_BUT_UNAVAILABLE");
  });
});

describe("D — proven coverage is only what was enumerated", () => {
  it("counts nothing before any live call", () => {
    expect(provenDiscoveryCoverage(classifyAllProviders(KEYED))).toEqual({});
  });

  it("counts an asset class only when a provider really enumerated it", () => {
    const statuses = [
      classifyFromDiscoveryResult("okx", { success: true, instrumentCount: 10 }),
      // Rate limited: must NOT contribute coverage.
      classifyFromDiscoveryResult(
        "twelve-data",
        { success: false, instrumentCount: 0, httpStatus: 429 },
        KEYED,
      ),
    ];

    const coverage = provenDiscoveryCoverage(statuses);
    expect(coverage.crypto).toEqual(["okx"]);
    expect(coverage.forex).toBeUndefined();
    expect(coverage.equity).toBeUndefined();
  });

  it("registers every provider exactly once", () => {
    const ids = PROVIDER_DISCOVERY_PROFILES.map((p) => p.provider);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
