import { describe, expect, it } from "vitest";
import { checkCredentials } from "./live/credentials";
import { findProviderRoutes } from "./providers";
import { getProviderSymbol } from "./instruments";

describe("SEC EDGAR provider registration", () => {
  const configuredEnv = (name: string) =>
    name === "SEC_USER_AGENT" ? "TradeIntelBot/1.0 (Contact: owner@example.com)" : undefined;

  it("requires an explicit SEC User-Agent contact identity", () => {
    expect(checkCredentials("sec-edgar", () => undefined)).toMatchObject({
      available: false,
      missingEnvVarNames: ["SEC_USER_AGENT"],
    });
    expect(checkCredentials("sec-edgar", configuredEnv)).toMatchObject({
      available: true,
      missingEnvVarNames: [],
    });
  });

  it("routes US-listed equity filings only when the SEC identity is configured", () => {
    expect(getProviderSymbol("AAPL", "sec-edgar")).toBe("AAPL");
    expect(getProviderSymbol("BBCA", "sec-edgar")).toBeNull();

    const unavailable = findProviderRoutes("AAPL", "financial_statements");
    expect(unavailable.routes.find((route) => route.providerId === "sec-edgar")).toMatchObject({
      quality: "PARTIAL",
      credentialsAvailable: false,
    });
    expect(unavailable.available).toBe(false);

    const configured = findProviderRoutes("AAPL", "financial_statements", configuredEnv);
    expect(configured.routes.find((route) => route.providerId === "sec-edgar")).toMatchObject({
      quality: "PARTIAL",
      credentialsAvailable: true,
    });
    expect(configured.available).toBe(true);
  });

  it("does not claim SEC coverage for IDX instruments", () => {
    const result = findProviderRoutes("BBCA", "earnings", configuredEnv);
    expect(result.routes.find((route) => route.providerId === "sec-edgar")).toBeUndefined();
  });
});
