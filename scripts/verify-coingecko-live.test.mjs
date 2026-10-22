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

const validPrices = {
  bitcoin: { usd: 67_000 },
  ethereum: { usd: 3_500 },
};

test("requires an API key and does not call the provider without one", async () => {
  let called = false;
  await assert.rejects(
    verifyCoinGeckoLive({ apiKey: " ", fetchImpl: async () => { called = true; } }),
    /COINGECKO_DEMO_API_KEY is required/,
  );
  assert.equal(called, false);
});

test("verifies positive finite BTC and ETH prices from a real response", async () => {
  const logs = [];
  const result = await verifyCoinGeckoLive({
    apiKey: "demo-key",
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, "api.coingecko.com");
      assert.equal(url.searchParams.get("ids"), "bitcoin,ethereum");
      assert.equal(options.headers["x-cg-demo-api-key"], "demo-key");
      return response({ body: validPrices });
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
        : response({ body: validPrices });
    },
    sleepImpl: async (ms) => waits.push(ms),
    log: () => {},
    warn: () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [0]);
  assert.deepEqual(result.verifiedCoins, ["bitcoin", "ethereum"]);
});

test("fails after repeated 429 responses instead of reporting a pass", async () => {
  let calls = 0;
  await assert.rejects(
    verifyCoinGeckoLive({
      apiKey: "demo-key",
      fetchImpl: async () => { calls += 1; return response({ status: 429 }); },
      sleepImpl: async () => {},
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
        /malformed response object|invalid USD price/,
      );
    });
  }
});

test("parses Retry-After seconds and HTTP dates with a deterministic clock", () => {
  assert.equal(retryDelayMs(response({ headers: { "retry-after": "3" } }), 1_000), 3_000);
  assert.equal(retryDelayMs(response({ headers: { "retry-after": new Date(6_000).toUTCString() } }), 1_000), 5_000);
  assert.equal(retryDelayMs(response(), 1_000), 2_000);
});
