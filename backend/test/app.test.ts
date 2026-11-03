import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

describe("self-hosted backend health endpoints", () => {
  it("reports liveness without depending on the database", async () => {
    const response = await createApp().request("/health/live");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "trade-intel-backend",
    });
  });

  it("does not report readiness when the database is not configured", async () => {
    const response = await createApp().request("/health/ready");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      checks: { database: "not_configured" },
    });
  });

  it("reports readiness only after a successful database probe", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const response = await createApp({ database: { query } }).request("/health/ready");

    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith("SELECT 1");
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      checks: { database: "ok" },
    });
  });

  it("fails readiness when the database probe fails", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database offline"));
    const response = await createApp({ database: { query } }).request("/health/ready");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      checks: { database: "unavailable" },
    });
  });
});
