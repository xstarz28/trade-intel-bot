/**
 * Phase 7B-3 — OKX instruments mapping/parsing/merge tests.
 * Fixtures mirror the LIVE-verified endpoint responses:
 *   BTC-USDT-SWAP linear (ctVal 0.01 BTC, settle USDT)
 *   BTC-USD-SWAP inverse (ctVal 100 USD) — rejected for linear sizing.
 */
import { describe, it, expect } from "vitest";
import {
  mapInstrumentToOkx,
  parseOkxResponse,
  resolveWithOkx,
} from "./okx-spec";
import type { InstrumentSpec } from "../risk";

function okxRow(over?: Record<string, unknown>): Record<string, unknown> {
  return {
    instId: "BTC-USDT-SWAP",
    instType: "SWAP",
    state: "live",
    ctType: "linear",
    ctVal: "0.01",
    ctValCcy: "BTC",
    settleCcy: "USDT",
    lotSz: "0.01",
    minSz: "0.01",
    tickSz: "0.1",
    lever: "100",
    ...over,
  };
}

const LINEAR_BTC = { code: "0", data: [okxRow()], msg: "" };
const INVERSE_BTC = {
  code: "0",
  data: [okxRow({ instId: "BTC-USD-SWAP", ctType: "inverse", ctVal: "100", ctValCcy: "USD", settleCcy: undefined as unknown as string })],
  msg: "",
};

// ── Mapping ────────────────────────────────────────────────────────

describe("mapInstrumentToOkx (literal-symbol candidates only)", () => {
  it("maps BASE/QUOTE to the SWAP candidate id", () => {
    expect(mapInstrumentToOkx("BTC/USDT")).toBe("BTC-USDT-SWAP");
    expect(mapInstrumentToOkx("btc-usdt")).toBe("BTC-USDT-SWAP");
    expect(mapInstrumentToOkx("ETH / USDT")).toBe("ETH-USDT-SWAP");
  });

  it("passes through explicit exchange ids", () => {
    expect(mapInstrumentToOkx("BTC-USDT-SWAP")).toBe("BTC-USDT-SWAP");
  });

  it("unmappable shapes return undefined (no guessing)", () => {
    expect(mapInstrumentToOkx("BTC")).toBeUndefined();
    expect(mapInstrumentToOkx("EUR/USD")).toBe("EUR-USD-SWAP"); // shaped pair → verified against live rows later
    expect(mapInstrumentToOkx("GOLD")).toBeUndefined();
  });
});

// ── Response parsing ───────────────────────────────────────────────

describe("parseOkxResponse", () => {
  it("parses valid metadata into typed instruments", () => {
    const r = parseOkxResponse(LINEAR_BTC);
    expect(r.instruments).toHaveLength(1);
    expect(r.instruments[0].ctVal).toBeCloseTo(0.01);
    expect(r.instruments[0].ctValCcy).toBe("BTC");
    expect(r.instruments[0].settleCcy).toBe("USDT");
    expect(r.parseWarnings).toHaveLength(0);
  });

  it("malformed JSON body → warnings, never throws", () => {
    for (const bad of [null, "garbage", 42, {}, { code: "50001", msg: "boom" }, { code: "0", data: "not-array" }]) {
      const r = parseOkxResponse(bad);
      expect(r.instruments).toHaveLength(0);
      expect(r.parseWarnings.length).toBeGreaterThan(0);
    }
  });

  it("rows missing instId are skipped with warnings", () => {
    const r = parseOkxResponse({ code: "0", data: [{ instType: "SWAP" }, okxRow()] });
    expect(r.instruments).toHaveLength(1);
    expect(r.parseWarnings.join(" ")).toMatch(/missing instId/);
  });

  it("invalid numeric fields (zero/negative/garbage) become undefined, not fabricated", () => {
    const r = parseOkxResponse({ code: "0", data: [okxRow({ ctVal: "-5", lotSz: "abc" })] });
    expect(r.instruments[0].ctVal).toBeUndefined();
    expect(r.instruments[0].lotSz).toBeUndefined();
  });
});

// ── Contract semantics & resolution ───────────────────────────────

describe("resolveWithOkx — contract semantics", () => {
  it("linear swap maps ctVal→contractSize, settleCcy→quoteCurrency, lotSz→step, minSz→min, tickSz→tick", () => {
    const r = resolveWithOkx({ instrument: "BTC/USDT", okx: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: parseOkxResponse(LINEAR_BTC).instruments, parseWarnings: [] } });
    expect(r.status).toBe("available");
    expect(r.spec?.contractSize).toBeCloseTo(0.01); // units of BASE ccy per contract
    expect(r.spec?.quoteCurrency).toBe("USDT"); // settlement currency
    expect(r.spec?.quantityStep).toBeCloseTo(0.01);
    expect(r.spec?.minQuantity).toBeCloseTo(0.01);
    expect(r.spec?.tickSize).toBeCloseTo(0.1);
    expect(r.okxFields.join(" ")).toMatch(/ctVal/);
    expect(r.spec?.source).toMatch(/OKX/);
  });

  it("INVERSE contracts are rejected for auto-sizing with an explicit reason", () => {
    const r = resolveWithOkx({ instrument: "BTC/USD", okx: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: parseOkxResponse(INVERSE_BTC).instruments, parseWarnings: [] } });
    expect(r.status).toBe("unavailable");
    expect(r.unavailableReason).toMatch(/inverse.*linear.*formula/i);
  });

  it("instrument not found on OKX → unavailable, no assumptions", () => {
    const r = resolveWithOkx({ instrument: "XYZ/ABC", okx: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: [], parseWarnings: [] } });
    expect(r.status).toBe("unavailable");
    expect(r.unavailableReason).toMatch(/not found on OKX/);
  });

  it("non-live instrument state is unavailable", () => {
    const r = resolveWithOkx({
      instrument: "BTC/USDT",
      okx: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: parseOkxResponse({ code: "0", data: [okxRow({ state: "suspend" })] }).instruments, parseWarnings: [] },
    });
    expect(r.status).toBe("unavailable");
    expect(r.unavailableReason).toMatch(/state is "suspend"/);
  });

  it("partial metadata (missing lotSz/minSz/tickSz) → partial with explicit gaps", () => {
    const partial = parseOkxResponse({ code: "0", data: [okxRow({ lotSz: undefined, minSz: undefined, tickSz: undefined })] });
    const r = resolveWithOkx({ instrument: "BTC/USDT", okx: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: partial.instruments, parseWarnings: [] } });
    expect(r.status).toBe("partial");
    expect(r.missingForSizing).toContain("lotSz");
  });
});

// ── Merge hierarchy & conflicts ───────────────────────────────────

describe("explicit-vs-OKX merge hierarchy", () => {
  it("explicit input wins field-by-field when consistent with OKX values", () => {
    const explicit: InstrumentSpec = {
      assetClass: "crypto",
      contractSize: 0.01,
      quantityStep: 0.01,
      quoteCurrency: "usdt", // case-insensitive agreement
    };
    const r = resolveWithOkx({
      instrument: "BTC/USDT",
      explicitSpec: explicit,
      okx: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: parseOkxResponse(LINEAR_BTC).instruments, parseWarnings: [] },
    });
    expect(r.status).toBe("available");
    expect(r.conflicts).toHaveLength(0);
  });

  it("conflicting contractSize BLOCKS sizing instead of picking a side", () => {
    const explicit: InstrumentSpec = { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, quoteCurrency: "USDT" };
    const r = resolveWithOkx({
      instrument: "BTC/USDT",
      explicitSpec: explicit,
      okx: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: parseOkxResponse(LINEAR_BTC).instruments, parseWarnings: [] },
    });
    expect(r.status).toBe("conflict");
    expect(r.conflicts.join(" ")).toMatch(/contractSize conflict/);
    expect(r.unavailableReason).toMatch(/sizing blocked/);
  });

  it("conflicting settlement currency blocks sizing", () => {
    const explicit: InstrumentSpec = { assetClass: "crypto", contractSize: 0.01, quantityStep: 0.01, quoteCurrency: "USD" };
    const r = resolveWithOkx({
      instrument: "BTC/USDT",
      explicitSpec: explicit,
      okx: { fetchedAt: 1, source: "OKX public instruments", freshness: "static", instruments: parseOkxResponse(LINEAR_BTC).instruments, parseWarnings: [] },
    });
    expect(r.status).toBe("conflict");
    expect(r.conflicts.join(" ")).toMatch(/settlement currency conflict/);
  });
});
