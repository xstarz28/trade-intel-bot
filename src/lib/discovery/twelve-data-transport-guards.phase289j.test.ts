/**
 * Phase 289J — THE CATALOG TRANSPORT'S GUARDS, TESTED BY WHAT THEY PROTECT.
 *
 * The deployed 289G run failed on `/stocks` BEFORE ANY BYTE, and the deeper audit
 * that followed found two semantic holes in the same transport:
 *
 *   1. the no-byte guard was armed only AFTER the first body chunk had arrived,
 *      so a provider that sent headers and then went silent was never guarded;
 *   2. the guard stayed armed while the CONSUMER processed a chunk, so local
 *      parsing/staging time could be reported as provider silence.
 *
 * These tests pin the corrected semantics:
 *
 *   A. headers, then no body byte at all            -> stall failure (no hang)
 *   B. consumer slower than the stall interval      -> NOT a stall
 *   C. gaps between chunks                          -> the guard fires only while
 *                                                      the next chunk is awaited
 *   D. total deadline, consumed during local work    -> still fires, honestly
 *   E. body ends normally                            -> no timer survives
 *   F. truncated / failing body                      -> explicit failure, and the
 *                                                      raw row count is stated
 *
 * Every test drives the SHIPPED transport with a fake `fetchImpl`; no live
 * provider is contacted and no credential is used.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTwelveDataCatalogTransport } from "./twelve-data-transport";
import { scanTwelveDataCatalogRows } from "./twelve-data-stream";

type Body = AsyncIterable<Uint8Array | string>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A transport-level response that only exposes the streaming body. */
function streamingResponse(body: Body): Response {
  return { ok: true, status: 200, body, headers: new Headers() } as unknown as Response;
}

function fetchThatReturns(body: Body): typeof fetch {
  return (async () => streamingResponse(body)) as unknown as typeof fetch;
}

/** Consume a guarded body, keeping every chunk verbatim. */
async function consume(body: Body): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
  }
  return chunks;
}

/** A body that never produces a byte and never ends. */
const neverBody: Body = {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}) };
  },
};

const transportFor = (
  body: Body,
  overrides: { stallMs?: number; timeoutMs?: number; headersMs?: number } = {},
) =>
  createTwelveDataCatalogTransport({
    apiKey: "test-key",
    headersMs: overrides.headersMs ?? 5_000,
    stallMs: overrides.stallMs ?? 60_000,
    timeoutMs: overrides.timeoutMs ?? 60_000,
    fetchImpl: fetchThatReturns(body),
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("289J — the no-byte guard covers the FIRST chunk, not just the ones after it", () => {
  it("A. headers arrive and the body never produces a byte: the stall guard fires", async () => {
    const transport = transportFor(neverBody, { stallMs: 40, timeoutMs: 5_000 });
    const result = await transport("https://api.twelvedata.com/stocks");
    expect(result.ok).toBe(true);
    await expect(consume(result.body!)).rejects.toThrow(/no catalog bytes for 40 ms/);
  }, 5_000);

  it("A2. the header guard still reports its own reason (and is not the body guard)", async () => {
    const refusing: typeof fetch = ((_url: string, init: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal;
        signal?.addEventListener("abort", () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        });
      })) as unknown as typeof fetch;
    const transport = createTwelveDataCatalogTransport({
      apiKey: "test-key",
      headersMs: 30,
      stallMs: 5_000,
      timeoutMs: 5_000,
      fetchImpl: refusing,
    });
    await expect(transport("https://api.twelvedata.com/stocks")).rejects.toThrow(
      /no response headers within 30 ms/,
    );
  }, 5_000);
});

describe("289J — provider silence is measured against waiting, never against local work", () => {
  it("B. a consumer that works longer than the stall interval is not a provider stall", async () => {
    let openSecondChunk: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      openSecondChunk = resolve;
    });
    const body: Body = {
      async *[Symbol.asyncIterator]() {
        yield '{"status":"ok","count":2,"data":[{"symbol":"A"}';
        // Waits only for the consumer to come back; the gate was already opened,
        // so the next chunk is available the instant it is asked for.
        await gate;
        yield ',{"symbol":"B"}]}';
      },
    };
    // stallMs is far below the consumer's own work below.
    const transport = transportFor(body, { stallMs: 40, timeoutMs: 5_000 });
    const result = await transport("https://api.twelvedata.com/stocks");

    const chunks: string[] = [];
    for await (const chunk of result.body!) {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      if (chunks.length === 1) {
        openSecondChunk!();
        // Local work: parsing + persistence in the real pipeline. This must not
        // be attributed to the provider.
        await sleep(160);
      }
    }

    expect(chunks).toHaveLength(2);
    expect(chunks.join("")).toBe('{"status":"ok","count":2,"data":[{"symbol":"A"},{"symbol":"B"}]}');
  }, 5_000);

  it("C. gaps between chunks: the guard is armed only while the next chunk is awaited", async () => {
    const body: Body = {
      async *[Symbol.asyncIterator]() {
        yield "a";
        await sleep(15); // well inside the guard: must NOT fire
        yield "b";
        await new Promise<void>(() => {}); // silence: must fire here
      },
    };
    const transport = transportFor(body, { stallMs: 60, timeoutMs: 5_000 });
    const result = await transport("https://api.twelvedata.com/stocks");

    const delivered: string[] = [];
    let failure: unknown = null;
    try {
      for await (const chunk of result.body!) {
        delivered.push(String(chunk));
        // The consumer is quick here; the silence is entirely the provider's.
      }
    } catch (error) {
      failure = error;
    }

    expect(delivered).toEqual(["a", "b"]);
    expect(String((failure as Error).message)).toMatch(/^no catalog bytes for 60 ms$/);
  }, 5_000);
});

describe("289J — the total deadline is a real, whole-body budget", () => {
  it("D. a total deadline consumed by local work still fires, and says so", async () => {
    const body: Body = {
      async *[Symbol.asyncIterator]() {
        yield "a";
        yield "b";
        await sleep(5_000);
      },
    };
    // The stall guard cannot fire (nothing is being awaited); only the TOTAL can.
    const transport = transportFor(body, { stallMs: 5_000, timeoutMs: 60 });
    const result = await transport("https://api.twelvedata.com/stocks");

    const delivered: string[] = [];
    let failure: unknown = null;
    try {
      for await (const chunk of result.body!) {
        delivered.push(String(chunk));
        if (delivered.length === 1) await sleep(200);
      }
    } catch (error) {
      failure = error;
    }

    expect(delivered).toEqual(["a"]);
    expect(String((failure as Error).message)).toMatch(/catalog read exceeded 60 ms/);
  }, 10_000);

  it("E. a body that ends normally leaves no timer behind", async () => {
    vi.useFakeTimers();
    const body: Body = {
      async *[Symbol.asyncIterator]() {
        yield "a";
        yield "b";
      },
    };
    const transport = createTwelveDataCatalogTransport({
      apiKey: "test-key",
      headersMs: 20_000,
      stallMs: 30_000,
      timeoutMs: 180_000,
      fetchImpl: fetchThatReturns(body),
    });
    const result = await transport("https://api.twelvedata.com/stocks");
    expect(await consume(result.body!)).toEqual(["a", "b"]);
    // Header, stall and total guards are all disarmed once the body is over.
    expect(vi.getTimerCount()).toBe(0);
  }, 5_000);
});

describe("289J — a broken body is an explicit failure with the rows it did parse", () => {
  it("F. a truncated body fails explicitly and reports how many rows arrived", async () => {
    const body: Body = {
      async *[Symbol.asyncIterator]() {
        yield '{"status":"ok","count":3,"data":[{"symbol":"A"},{"symbol":"B"}';
      },
    };
    const transport = transportFor(body, { stallMs: 5_000 });
    const result = await transport("https://api.twelvedata.com/stocks");
    const rows: unknown[] = [];
    const scan = await scanTwelveDataCatalogRows(result.body!, (row) => rows.push(row));

    expect(scan.ok).toBe(false);
    if (!scan.ok) {
      expect(scan.error).toMatch(/ended inside the data array/);
      // Two complete elements were parsed before the body ran out; the third is
      // NOT invented.
      expect(scan.rowsSeen).toBe(2);
      expect(scan.totalCount).toBe(3);
    }
    expect(rows).toHaveLength(2);
  }, 5_000);

  it("F2. a real transport error keeps its own message instead of a stall", async () => {
    const body: Body = {
      async *[Symbol.asyncIterator]() {
        yield '{"data":[';
        throw new Error("socket hang up");
      },
    };
    const transport = transportFor(body, { stallMs: 5_000 });
    const result = await transport("https://api.twelvedata.com/stocks");
    const scan = await scanTwelveDataCatalogRows(result.body!, () => {});

    expect(scan.ok).toBe(false);
    if (!scan.ok) {
      expect(scan.error).toBe("catalog stream failed: socket hang up");
      expect(scan.rowsSeen).toBe(0);
    }
  }, 5_000);
});
