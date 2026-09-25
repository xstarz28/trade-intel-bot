/**
 * Phase 288 — a rejected catalog page keeps the provider's own message.
 *
 * The catalog fetcher reported `${path} returned HTTP ${status}.` and dropped
 * the response body. Twelve Data answers a plan/credit rejection with an error
 * body, so the only surviving record of a failed catalog could not distinguish
 * "not on your plan" from a truncated dump — exactly the question the live
 * four-asset run left open for the STOCK domain. The status code stays
 * verbatim; the provider's message is added, credential-redacted and bounded.
 */
import { describe, it, expect } from "vitest";
import { catalogFailureDetail, fetchTwelveDataCatalogPages, type FetchJson } from "./twelve-data-pagination";

describe("phase 288 — catalog failure detail", () => {
  it("keeps the provider's message and code, with the HTTP status", () => {
    const detail = catalogFailureDetail(403, {
      status: "error",
      code: 403,
      message: "You have reached the API credits limit for the Grow plan.",
    });
    expect(detail).toContain("code 403");
    expect(detail).toContain("API credits limit");
  });

  it("falls back to the HTTP status when the body carries no message", () => {
    expect(catalogFailureDetail(500, undefined)).toBeUndefined();
    expect(catalogFailureDetail(500, { status: "error" })).toBeUndefined();
  });

  it("redacts credential-shaped text and bounds the length", () => {
    const detail = catalogFailureDetail(401, {
      message: `unauthorized: apikey=SUPERSECRETVALUE ${"z".repeat(500)}`,
    });
    expect(detail).not.toContain("SUPERSECRETVALUE");
    expect(detail!.length).toBeLessThanOrEqual(280);
  });

  it("prefers the provider code over the HTTP status when both exist", () => {
    expect(catalogFailureDetail(429, { code: 429, message: "rate limit" })).toBe("code 429 — rate limit");
  });
});

describe("phase 288 — the page fetch reports it", () => {
  it("a rejected first page fails with the provider's explanation", async () => {
    const fetchJson: FetchJson = async () => ({
      ok: false,
      status: 403,
      json: { status: "error", code: 403, message: "This endpoint is not available in your plan." },
    });
    const result = await fetchTwelveDataCatalogPages(fetchJson, { path: "/stocks", apiKey: "k" });
    expect(result.completeness).toBe("FAILED");
    expect(result.pagesFetched).toBe(0);
    expect(result.warnings.join(" ")).toContain("/stocks returned HTTP 403");
    expect(result.warnings.join(" ")).toContain("not available in your plan");
  });

  it("a rejected continuation page is still PARTIAL, never COMPLETE", async () => {
    let page = 0;
    const fetchJson: FetchJson = async () => {
      page += 1;
      if (page === 1) {
        return { ok: true, status: 200, json: { count: 5, data: [{ symbol: "A" }, { symbol: "B" }] } };
      }
      return { ok: false, status: 429, json: { code: 429, message: "too many requests" } };
    };
    const result = await fetchTwelveDataCatalogPages(fetchJson, { path: "/stocks", apiKey: "k" });
    expect(result.completeness).toBe("PARTIAL");
    expect(result.failedPage).toBe(2);
    expect(result.warnings.join(" ")).toContain("too many requests");
  });

  it("a healthy catalog is unchanged (no diagnostic noise)", async () => {
    const fetchJson: FetchJson = async () => ({
      ok: true,
      status: 200,
      json: { data: [{ symbol: "AAPL", currency: "USD", name: "Apple", exchange: "NASDAQ", type: "Common Stock" }] },
    });
    const result = await fetchTwelveDataCatalogPages(fetchJson, { path: "/stocks", apiKey: "k" });
    expect(result.completeness).toBe("COMPLETE");
    expect(result.warnings).toEqual([]);
  });
});
