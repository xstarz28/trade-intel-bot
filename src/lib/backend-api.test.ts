import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackendApiError,
  createAnonymousBackendSession,
  exportBackendAccount,
  importBackendAccount,
  getBackendSession,
  listBackendAnalyses,
  logoutBackendSession,
  saveBackendAnalysis,
} from "./backend-api";

afterEach(() => vi.restoreAllMocks());

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("self-hosted backend API client", () => {
  it("reads the session with cookie credentials and no-store caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { user: null }));
    await expect(getBackendSession(fetcher)).resolves.toEqual({ user: null });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("creates an anonymous session using the backend endpoint", async () => {
    const user = {
      id: "user-1",
      name: "Guest Trader",
      email: null,
      isAnonymous: true,
      role: "user",
    };
    const fetcher = vi.fn().mockResolvedValue(response(201, { user }));
    await expect(createAnonymousBackendSession(fetcher)).resolves.toEqual({ user });
    const [, init] = fetcher.mock.calls[0];
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/auth/anonymous");
    expect(init).toEqual(expect.objectContaining({
      method: "POST",
      credentials: "include",
    }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("lists and persists analyses through the authenticated API", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { items: [] }))
      .mockResolvedValueOnce(response(201, { item: { _id: "analysis-1" } }));
    await expect(listBackendAnalyses(fetcher)).resolves.toEqual({ items: [] });
    await expect(
      saveBackendAnalysis({
        instrument: "BTC/USDT",
        instrumentType: "crypto",
        timeframe: "4h",
        bias: "BULLISH",
        confidence: 72,
        technicalSummary: "Trend aligned",
        fundamentalSummary: "No fundamental feed",
        breakdown: { trend: 80, indicator: 70, fundamental: 50, sentiment: 50 },
        keyLevels: { support: "64000", resistance: "68000", invalidation: "63000" },
        riskNote: "Defined risk",
        dataCompleteness: "PARTIAL",
        dataFlags: [],
      }, fetcher),
    ).resolves.toEqual({ item: { _id: "analysis-1" } });
    expect(fetcher.mock.calls[1][0]).toBe("/api/v1/analyses");
    expect(fetcher.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  it("exports account data through the authenticated backend endpoint", async () => {
    const payload = {
      format: "trade-intel-account-export" as const,
      version: 1 as const,
      exportedAt: "2026-11-04T00:00:00.000Z",
      account: { id: "user-1", name: "Trader", email: null, isAnonymous: true, role: "user" },
      data: { journal: [] },
      counts: { journal: 0 },
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, payload));
    await expect(exportBackendAccount(fetcher)).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/account/export",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("restores a typed account export through the authenticated backend endpoint", async () => {
    const payload = {
      format: "trade-intel-account-export" as const,
      version: 1 as const,
      exportedAt: "2026-11-04T00:00:00.000Z",
      account: { id: "old-user", name: "Trader", email: null, isAnonymous: true, role: "user" },
      data: { journal: [] },
      counts: { journal: 0 },
    };
    const result = {
      success: true,
      accountId: "current-user",
      inserted: { journal: 0 },
      skipped: { journal: 0 },
      totalInserted: 0,
      totalSkipped: 0,
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, result));
    await expect(importBackendAccount(payload, fetcher)).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/account/import",
      expect.objectContaining({ method: "POST", credentials: "include", cache: "no-store" }),
    );
  });

  it("logs out through the backend session endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true }));
    await expect(logoutBackendSession(fetcher)).resolves.toEqual({ success: true });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("surfaces backend errors without converting them to mock success", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(401, { error: "authentication_required" }));
    await expect(getBackendSession(fetcher)).rejects.toMatchObject({
      name: "BackendApiError",
      status: 401,
      code: "authentication_required",
    } satisfies Partial<BackendApiError>);
  });
});
