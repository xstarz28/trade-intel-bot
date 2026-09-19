/**
 * Phase 229 — TickAtlas calendar leg-failure propagation.
 *
 * Before this phase: (a) a timeout / 5xx / malformed body on the UPCOMING leg
 * was swallowed into an empty event list that was cached and served as
 * `success: true, macroRisk: low`; (b) the PAST leg's `catch {}` discarded a
 * 429 / 401 outright, so a quota/credential rejection on that leg was never
 * seen by the Phase 178b check. Phase 219 (undated events dropped, no local
 * clock as event time) must remain intact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderCache, getProviderCache } from "../lib/data/provider-cache-registry";
import { fetchCalendar } from "./tradingEconomics";
import type { CalendarResult } from "../lib/data/calendar-types";

type Args = { instrument: string; instrumentType: string };
type Handler = (ctx: unknown, args: Args) => Promise<CalendarResult>;
const te = (fetchCalendar as unknown as { _handler: Handler })._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "user_A|sess", issuer: "t" }) } };
const EURUSD: Args = { instrument: "EUR/USD", instrumentType: "forex" };
const KEY = { provider: "tickatlas", dataset: "calendar", instrument: "EUR/USD", instrumentType: "forex" } as const;

type Route = { status?: number; body?: unknown; throws?: unknown; badJson?: boolean };
/** The first request is the upcoming window (from=today); the second is the past window (to=today). */
let upcoming: Route = {};
let past: Route = {};
const calls: string[] = [];
const today = new Date().toISOString().split("T")[0];
function isUpcoming(url: string) { return url.includes(`from=${today}`); }

const H = 60 * 60 * 1000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();
const OK_UPCOMING = { success: true, data: { events: [
  { id: "u1", event: "ECB Rate Decision", currency: "EUR", country: "Euro Area", date: inHours(10), impact: "high", forecast: "4.0" },
  { id: "u2", event: "US CPI", currency: "USD", country: "United States", date: inHours(50), impact: "high", forecast: "3.1" },
  { id: "u3", event: "PMI", currency: "EUR", country: "Euro Area", date: inHours(30), impact: "medium" },
] } };
const OK_PAST = { success: true, data: { events: [
  { id: "p1", event: "NFP", currency: "USD", country: "United States", date: inHours(-30), impact: "high", actual: "250", forecast: "200" },
] } };
function timeoutError() { const e = new Error("aborted due to timeout"); e.name = "TimeoutError"; return e; }

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  upcoming = { body: OK_UPCOMING };
  past = { body: OK_PAST };
  process.env.TICKATLAS_API_KEY = "k";
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const r = isUpcoming(url) ? upcoming : past;
    if (r.throws) throw r.throws;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300, status, statusText: "x", text: async () => "body",
      json: async () => { if (r.badJson) throw new SyntaxError("Unexpected token <"); return r.body; },
    } as unknown as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); resetProviderCache(); });

describe("229 TA — valid", () => {
  it("both legs parse: upcoming + released events, HIGH risk from a real 10h-away event, cached", async () => {
    const r = await te(ctx, EURUSD);
    expect(r.success).toBe(true);
    expect(r.data!.events.map((e) => e.id).sort()).toEqual(["p1", "u1", "u2", "u3"]);
    expect(r.data!.macroRisk.level).toBe("high");
    expect(r.data!.availability.recentReleased).toBe(true);
    expect(r.data!.error).toBeUndefined();
    expect(r.acquisition).toBe("observed-now");
    expect(getProviderCache().peek(KEY)).not.toBeNull();
  });
});

describe("229 TA — 429 / rate limit on either leg", () => {
  it("HTTP 429 on the upcoming leg → RATE_LIMIT, nothing cached", async () => {
    upcoming = { status: 429, body: {} };
    const r = await te(ctx, EURUSD);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(r.data).toBeUndefined();
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
  it("HTTP 429 on the PAST leg (previously swallowed by `catch {}`) → RATE_LIMIT, nothing cached", async () => {
    past = { status: 429, body: {} };
    const r = await te(ctx, EURUSD);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
  it("after a 429 the next caller re-acquires and succeeds (no poisoned key)", async () => {
    past = { status: 429, body: {} };
    await te(ctx, EURUSD);
    past = { body: OK_PAST };
    const r2 = await te(ctx, EURUSD);
    expect(r2.success).toBe(true);
    expect(r2.acquisition).toBe("observed-now");
  });
});

describe("229 TA — 401/403", () => {
  it.each([401, 403])("HTTP %d on the upcoming leg → AUTH_ERROR", async (status) => {
    upcoming = { status, body: {} };
    const r = await te(ctx, EURUSD);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
  it.each([401, 403])("HTTP %d on the PAST leg → AUTH_ERROR (was silently dropped)", async (status) => {
    past = { status, body: {} };
    expect((await te(ctx, EURUSD)).errorCode).toBe("AUTH_ERROR");
  });
  it("the credential never appears in the envelope", async () => {
    process.env.TICKATLAS_API_KEY = "SECRET-VALUE-XYZ";
    upcoming = { status: 401, body: {} };
    expect(JSON.stringify(await te(ctx, EURUSD))).not.toContain("SECRET-VALUE-XYZ");
  });
});

describe("229 TA — timeout / network / 5xx / malformed on the UPCOMING leg is an outage", () => {
  it.each<[string, Route]>([
    ["timeout", { throws: timeoutError() }],
    ["network", { throws: new TypeError("fetch failed") }],
    ["provider_error", { status: 503, body: {} }],
    ["malformed", { badJson: true }],
  ])("%s → API_UNAVAILABLE with the class in the message, no LOW risk, nothing cached", async (kind, route) => {
    upcoming = route;
    const r = await te(ctx, EURUSD);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(new RegExp(`upcoming: ${kind}`));
    expect(r.data).toBeUndefined();
    expect(getProviderCache().peek(KEY)).toBeNull();
  });
  it("an outage is not served to the next caller as a cached success", async () => {
    upcoming = { throws: timeoutError() };
    await te(ctx, EURUSD);
    upcoming = { body: OK_UPCOMING };
    const r2 = await te(ctx, EURUSD);
    expect(r2.success).toBe(true);
    expect(r2.data!.macroRisk.level).toBe("high");
    expect(calls.filter(isUpcoming).length).toBe(2);
  });
});

describe("229 TA — PAST leg failure is partial with explicit metadata", () => {
  it("timeout on the past leg → success, upcoming kept, recentReleased=false, error names the leg", async () => {
    past = { throws: timeoutError() };
    const r = await te(ctx, EURUSD);
    expect(r.success).toBe(true);
    expect(r.data!.events.map((e) => e.id).sort()).toEqual(["u1", "u2", "u3"]);
    expect(r.data!.availability.recentReleased).toBe(false);
    expect(r.data!.macroRisk.level).toBe("high");
    expect(r.data!.error).toMatch(/^recentReleased: timeout/);
    expect(r.data!.error).not.toMatch(/upcoming/);
  });
  it("HTTP 500 on the past leg → provider_error class; partial payload IS cached with its metadata", async () => {
    past = { status: 500, body: {} };
    const r1 = await te(ctx, EURUSD);
    expect(r1.data!.error).toMatch(/recentReleased: provider_error \(TickAtlas HTTP 500/);
    const r2 = await te(ctx, EURUSD);
    expect(r2.acquisition).toBe("cache-reused");
    expect(r2.data!.error).toBe(r1.data!.error);
    expect(calls.length).toBe(2);
  });
});

describe("229 TA — empty-but-valid provider answers keep the existing contract", () => {
  it("both legs answer with zero events → success, confidence/freshness unavailable, LOW risk, no error", async () => {
    upcoming = { body: { success: true, data: { events: [] } } };
    past = { body: { success: true, data: { events: [] } } };
    const r = await te(ctx, EURUSD);
    expect(r.success).toBe(true);
    expect(r.data!.confidence).toBe("unavailable");
    expect(r.data!.freshness).toBe("unavailable");
    expect(r.data!.macroRisk.level).toBe("low");
    expect(r.data!.error).toBeUndefined();
  });
  it("wrong-container JSON on upcoming (Phase 227) is 'answered, nothing usable', not an outage", async () => {
    upcoming = { body: { weird: true } };
    const r = await te(ctx, EURUSD);
    expect(r.success).toBe(true);
    expect(r.data!.error).toBeUndefined();
  });
});

describe("229 TA — Phase 219 stays intact", () => {
  it("undated / unparseable events are dropped; no local clock; risk not raised by them", async () => {
    upcoming = { body: { success: true, data: { events: [
      { id: "x1", event: "Ghost", currency: "EUR", country: "Euro Area", impact: "high" },
      { id: "x2", event: "Ghost2", currency: "EUR", country: "Euro Area", date: "", impact: "high" },
      { id: "x3", event: "Ghost3", currency: "EUR", country: "Euro Area", date: "not-a-date", impact: "high" },
    ] } } };
    past = { body: { success: true, data: { events: [] } } };
    const r = await te(ctx, EURUSD);
    expect(r.success).toBe(true);
    expect(r.data!.events).toEqual([]);
    expect(r.data!.macroRisk.level).toBe("low");
  });
  it("payload timestamp is the acquisition time reported by the cache, and it survives a hit", async () => {
    const r1 = await te(ctx, EURUSD);
    expect(r1.data!.timestamp).toBe(r1.observedAt);
    const r2 = await te(ctx, EURUSD);
    expect(r2.observedAt).toBe(r1.observedAt);
    expect(r2.data!.timestamp).toBe(r1.data!.timestamp);
  });
});
