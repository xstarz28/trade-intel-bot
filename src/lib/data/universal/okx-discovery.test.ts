import { describe, expect, it } from "vitest";
import {
  discoverOkxInstruments,
  type OkxDiscoveredInstrument,
} from "./okx-discovery";

function okxRow(overrides: Record<string, unknown> = {}) {
  return {
    instId: "BTC-USDT-SWAP",
    instType: "SWAP",
    state: "live",
    baseCcy: "BTC",
    quoteCcy: "USDT",
    settleCcy: "USDT",
    lotSz: "0.01",
    minSz: "0.01",
    tickSz: "0.1",
    ...overrides,
  };
}

function response(data: unknown[], code = "0", msg = ""): Response {
  return new Response(
    JSON.stringify({ code, data, msg }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("Phase 150 — OKX universal instrument discovery", () => {
  it("discovers SPOT, SWAP, and FUTURES without a hardcoded instrument whitelist", async () => {
    const calls: string[] = [];

    const transport = async (url: string): Promise<Response> => {
      calls.push(url);

      if (url.includes("instType=SPOT")) {
        return response([
          okxRow({
            instId: "BTC-USDT",
            instType: "SPOT",
            settleCcy: undefined,
            lotSz: "0.0001",
            minSz: "0.0001",
            tickSz: "0.1",
          }),
        ]);
      }

      if (url.includes("instType=SWAP")) {
        return response([
          okxRow({
            instId: "BTC-USDT-SWAP",
            instType: "SWAP",
          }),
        ]);
      }

      if (url.includes("instType=FUTURES")) {
        return response([
          okxRow({
            instId: "BTC-USDT-260925",
            instType: "FUTURES",
          }),
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await discoverOkxInstruments(transport, 123456);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("okx");
    expect(result.discoveredAt).toBe(123456);
    expect(calls).toHaveLength(3);

    expect(result.instruments.map((x) => x.instId)).toEqual([
      "BTC-USDT",
      "BTC-USDT-SWAP",
      "BTC-USDT-260925",
    ]);

    expect(result.instruments.map((x) => x.subType)).toEqual([
      "crypto_spot",
      "crypto_perpetual",
      "crypto_futures",
    ]);
  });

  it("keeps the exact provider instrument id and never substitutes symbols", async () => {
    const transport = async (url: string): Promise<Response> =>
      url.includes("instType=SWAP")
        ? response([
            okxRow({
              instId: "ETH-USDT-SWAP",
              instType: "SWAP",
              baseCcy: "ETH",
            }),
          ])
        : response([]);

    const result = await discoverOkxInstruments(transport);

    expect(result.instruments).toHaveLength(1);
    expect(result.instruments[0].instId).toBe("ETH-USDT-SWAP");
    expect(result.instruments[0].baseAsset).toBe("ETH");
  });

  it("filters non-live instruments", async () => {
    const transport = async (url: string): Promise<Response> =>
      url.includes("instType=SWAP")
        ? response([
            okxRow({ instId: "BTC-USDT-SWAP", state: "live" }),
            okxRow({ instId: "ETH-USDT-SWAP", state: "suspend", baseCcy: "ETH" }),
          ])
        : response([]);

    const result = await discoverOkxInstruments(transport);

    expect(result.instruments.map((x) => x.instId)).toEqual([
      "BTC-USDT-SWAP",
    ]);
  });

  it("deduplicates by exact OKX instId", async () => {
    const transport = async (): Promise<Response> =>
      response([
        okxRow({ instId: "BTC-USDT-SWAP" }),
        okxRow({ instId: "BTC-USDT-SWAP" }),
      ]);

    const result = await discoverOkxInstruments(transport);

    expect(result.instruments).toHaveLength(1);
    expect(result.instruments[0].instId).toBe("BTC-USDT-SWAP");
  });

  it("degrades honestly when one instrument-type endpoint fails", async () => {
    const transport = async (url: string): Promise<Response> => {
      if (url.includes("instType=SPOT")) {
        return new Response("upstream failure", { status: 503 });
      }

      return response([
        okxRow({
          instId: url.includes("instType=FUTURES")
            ? "BTC-USDT-260925"
            : "BTC-USDT-SWAP",
          instType: url.includes("instType=FUTURES")
            ? "FUTURES"
            : "SWAP",
        }),
      ]);
    };

    const result = await discoverOkxInstruments(transport);

    expect(result.success).toBe(true);
    expect(result.instruments.length).toBeGreaterThan(0);
    expect(result.warnings.join(" ")).toMatch(/SPOT.*503/i);
  });

  it("fails honestly when every endpoint fails", async () => {
    const transport = async (): Promise<Response> =>
      new Response("failure", { status: 503 });

    const result = await discoverOkxInstruments(transport);

    expect(result.success).toBe(false);
    expect(result.instruments).toHaveLength(0);
    expect(result.error).toMatch(/all instrument types/i);
  });

  it("rejects malformed responses without fabricating instruments", async () => {
    const transport = async (url: string): Promise<Response> => {
      if (url.includes("instType=SPOT")) {
        return new Response("not-json", { status: 200 });
      }

      return response([]);
    };

    const result = await discoverOkxInstruments(transport);

    expect(result.instruments).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/malformed JSON/i);
  });

  it("preserves sizing metadata when OKX provides it", async () => {
    const transport = async (url: string): Promise<Response> =>
      url.includes("instType=SWAP")
        ? response([
            okxRow({
              instId: "SOL-USDT-SWAP",
              baseCcy: "SOL",
              lotSz: "0.1",
              minSz: "0.1",
              tickSz: "0.01",
            }),
          ])
        : response([]);

    const result = await discoverOkxInstruments(transport);
    const instrument = result.instruments[0] as OkxDiscoveredInstrument;

    expect(instrument.lotSize).toBe(0.1);
    expect(instrument.minSize).toBe(0.1);
    expect(instrument.tickSize).toBe(0.01);
  });
});
