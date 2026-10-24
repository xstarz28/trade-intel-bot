import assert from "node:assert/strict";
import test from "node:test";
import { retryDelayMs, verifyCoinGeckoLive } from "./verify-coingecko-live.mjs";

function response({ status = 200, body = {}, headers = {}, text = "" } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
    text: async () => text,
  };
}

const validPrices = () => {
  const timestamp = Math.floor(Date.now() / 1_000);
  return {
    bitcoin: { usd: 67_000, last_updated_at: timestamp },
    ethereum: { usd: 3_500, last_updated_at: timestamp },
  };
};

test("supports public API verification without requiring an API key", async () => {
  const result = await verifyCoinGeckoLive({
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers["x-cg-demo-api-key"], undefined);
      return response({ body: validPrices() });
    },
    log: () => {},
    warn: () => assert.fail("did not expect a retry"),
  });
  assert.deepEqual(result.verifiedCoins, ["bitcoin", "ethereum"]);
});

test("verifies positive finite BTC and ETH prices from a real response", async () => {
  const logs = [];
  const result = await verifyCoinGeckoLive({
    apiKey: "demo-key",
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, "api.coingecko.com");
      assert.equal(url.searchParams.get("ids"), "bitcoin,ethereum");
      assert.equal(url.searchParams.get("include_last_updated_at"), "true");
      assert.equal(options.headers["x-cg-demo-api-key"], "demo-key");
      return response({ body: validPrices() });
    },
    log: (message) => logs.push(message),
    warn: () => assert.fail("did not expect a retry"),
  });
  assert.deepEqual(result.verifiedCoins, ["bitcoin", "ethereum"]);
  assert.match(logs.at(-1), /verification passed/);
});

test("retries a 429 using Retry-After before accepting a live response", async () => {
  let calls = 0;
  const waits = [];
  const result = await verifyCoinGeckoLive({
    apiKey: "demo-key",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response({ status: 429, headers: { "retry-after": "0" } })
        : response({ body: validPrices() });
    },
    sleepImpl: async (ms) => waits.push(ms),
    random: () => 0.5,
    log: () => {},
    warn: () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [0]);
  assert.deepEqual(result.verifiedCoins, ["bitcoin", "ethereum"]);
});

test("uses bounded exponential backoff with jitter when 429 omits Retry-After", async () => {
  let calls = 0;
  const waits = [];
  await verifyCoinGeckoLive({
    apiKey: "demo-key",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response({ status: 429 })
        : response({ body: validPrices() });
    },
    sleepImpl: async (ms) => waits.push(ms),
    random: () => 0.5,
    log: () => {},
    warn: () => {},
  });
  assert.deepEqual(waits, [1_000]);
});

test("retries transient network/timeout failures and fails closed after the retry budget", async (t) => {
  await t.test("recovers after a transient network error", async () => {
    let calls = 0;
    const waits = [];
    await verifyCoinGeckoLive({
      apiKey: "demo-key",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error("socket timeout");
        return response({ body: validPrices() });
      },
      sleepImpl: async (ms) => waits.push(ms),
      random: () => 0.5,
      log: () => {},
      warn: () => {},
    });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [1_000]);
  });
  await t.test("does not report success after repeated network errors", async () => {
    let calls = 0;
    await assert.rejects(
      verifyCoinGeckoLive({
        apiKey: "demo-key",
        fetchImpl: async () => { calls += 1; throw new Error("network down"); },
        sleepImpl: async () => {},
        random: () => 0.5,
        log: () => {},
        warn: () => {},
      }),
      /request failed after 3 attempts.*network down/,
    );
    assert.equal(calls, 3);
  });
});

test("fails after repeated 429 responses instead of reporting a pass", async () => {
  let calls = 0;
  await assert.rejects(
    verifyCoinGeckoLive({
      apiKey: "demo-key",
      fetchImpl: async () => { calls += 1; return response({ status: 429 }); },
      sleepImpl: async () => {},
      random: () => 0.5,
      log: () => {},
      warn: () => {},
    }),
    /still returned HTTP 429 after 3 attempts/,
  );
  assert.equal(calls, 3);
});

test("refuses Retry-After delays above the bounded wait", async () => {
  let calls = 0;
  await assert.rejects(
    verifyCoinGeckoLive({
      apiKey: "demo-key",
      fetchImpl: async () => { calls += 1; return response({ status: 429, headers: { "retry-after": "60" } }); },
      sleepImpl: async () => assert.fail("must not sleep beyond the safe limit"),
      log: () => {},
      warn: () => {},
    }),
    /exceeding the safe 10s limit/,
  );
  assert.equal(calls, 1);
});

test("rejects HTTP errors, malformed JSON, and missing or invalid prices", async (t) => {
  await t.test("HTTP error", async () => {
    await assert.rejects(
      verifyCoinGeckoLive({ apiKey: "demo-key", fetchImpl: async () => response({ status: 403, text: "forbidden" }) }),
      /CoinGecko HTTP 403: forbidden/,
    );
  });
  await t.test("malformed JSON", async () => {
    await assert.rejects(
      verifyCoinGeckoLive({ apiKey: "demo-key", fetchImpl: async () => response({ body: new Error("bad json") }) }),
      /invalid JSON/,
    );
  });
  for (const [name, body] of [
    ["non-object", null],
    ["missing ETH", { bitcoin: { usd: 67_000 } }],
    ["zero BTC", { bitcoin: { usd: 0 }, ethereum: { usd: 3_500 } }],
    ["non-finite ETH", { bitcoin: { usd: 67_000 }, ethereum: { usd: Infinity } }],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyCoinGeckoLive({ apiKey: "demo-key", fetchImpl: async () => response({ body }) }),
        /malformed response object|invalid USD price|missing or invalid provider timestamp/,
      );
    });
  }
});

test("rejects stale and future-dated CoinGecko quotes", async (t) => {
  const nowMs = 1_800_000_000_000;
  const fresh = Math.floor(nowMs / 1_000);
  await t.test("stale quote", async () => {
    await assert.rejects(
      verifyCoinGeckoLive({ now: () => nowMs, fetchImpl: async () => response({ body: {
        bitcoin: { usd: 67_000, last_updated_at: fresh - 301 },
        ethereum: { usd: 3_500, last_updated_at: fresh },
      } }), log: () => {} }),
      /stale or future-dated quote for bitcoin/,
    );
  });
  await t.test("future-dated quote", async () => {
    await assert.rejects(
      verifyCoinGeckoLive({ now: () => nowMs, fetchImpl: async () => response({ body: {
        bitcoin: { usd: 67_000, last_updated_at: fresh + 61 },
        ethereum: { usd: 3_500, last_updated_at: fresh },
      } }), log: () => {} }),
      /stale or future-dated quote for bitcoin/,
    );
  });
});

test("parses Retry-After seconds and HTTP dates with a deterministic clock", () => {
  assert.equal(retryDelayMs(response({ headers: { "retry-after": "3" } }), 1_000), 3_000);
  assert.equal(retryDelayMs(response({ headers: { "retry-after": new Date(6_000).toUTCString() } }), 1_000), 5_000);
  assert.equal(retryDelayMs(response(), 1_000, 2_000, () => 0.5), 2_000);
});
