#!/usr/bin/env node
/**
 * Phase 164 — Live provider verification harness.
 *
 * Performs REAL network calls against provider endpoints and reports what
 * genuinely works. Nothing here is mocked: if a provider is unreachable or
 * a credential is missing, that is reported as a failure, never smoothed
 * over.
 *
 * Run:
 *   node scripts/verify-live.mjs
 *   TWELVE_DATA_API_KEY=... node scripts/verify-live.mjs
 *
 * Exit code is 0 when every REQUIRED check passes, 1 otherwise, so this can
 * gate a deploy.
 *
 * WHY THIS EXISTS AS A SCRIPT: the agent sandbox blocks outbound calls to
 * market-data hosts, so live provider verification cannot be executed — or
 * claimed — from CI inside that sandbox. This harness lets a human run the
 * same checks from an environment with real network access and real keys.
 */

const TIMEOUT_MS = 15_000;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const results = [];

function record(name, status, detail, required) {
  results.push({ name, status, detail, required });
  const colour =
    status === "PASS" ? GREEN : status === "SKIP" ? YELLOW : RED;
  const tag = status.padEnd(4);
  console.log(`${colour}${tag}${RESET} ${name} ${DIM}${detail}${RESET}`);
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** A check that must genuinely prove live data, not merely a 200 response. */
async function check({ name, required = true, needsEnv, run }) {
  if (needsEnv && !process.env[needsEnv]) {
    record(name, "SKIP", `${needsEnv} not set`, required);
    return;
  }
  try {
    const detail = await run();
    record(name, "PASS", detail, required);
  } catch (err) {
    record(name, "FAIL", err instanceof Error ? err.message : String(err), required);
  }
}

console.log("\nPhase 164 — live provider verification\n");

// ── OKX: discovery ────────────────────────────────────────────────
await check({
  name: "okx / discovery (SPOT)",
  run: async () => {
    const json = await getJson(
      "https://www.okx.com/api/v5/public/instruments?instType=SPOT",
    );
    if (json.code !== "0") throw new Error(`API code ${json.code}`);
    const rows = json.data ?? [];
    if (rows.length === 0) throw new Error("empty instrument list");
    const live = rows.filter((r) => r.state === "live");
    if (live.length === 0) throw new Error("no instruments in live state");
    return `${rows.length} instruments, ${live.length} live, e.g. ${live[0].instId}`;
  },
});

// ── OKX: acquisition of an instrument that discovery actually returned ──
await check({
  name: "okx / acquisition matches discovered id",
  run: async () => {
    const disc = await getJson(
      "https://www.okx.com/api/v5/public/instruments?instType=SPOT",
    );
    const target = (disc.data ?? []).find((r) => r.state === "live");
    if (!target) throw new Error("no live instrument to acquire");

    const candles = await getJson(
      `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(
        target.instId,
      )}&bar=1H&limit=5`,
    );
    if (candles.code !== "0") throw new Error(`candles code ${candles.code}`);
    const rows = candles.data ?? [];
    if (rows.length === 0) throw new Error(`no candles for ${target.instId}`);

    // Prove the data is actually recent, not a historical replay.
    const newest = Number(rows[0][0]);
    const ageMin = (Date.now() - newest) / 60_000;
    if (!Number.isFinite(newest)) throw new Error("unparseable candle timestamp");
    if (ageMin > 180) {
      throw new Error(
        `newest candle is ${ageMin.toFixed(0)}min old — not live`,
      );
    }
    return `${target.instId}: ${rows.length} candles, newest ${ageMin.toFixed(0)}min old`;
  },
});

// ── OKX: the no-substitution rule, verified against the real API ──
await check({
  name: "okx / rejects a non-existent instrument",
  run: async () => {
    const json = await getJson(
      "https://www.okx.com/api/v5/market/candles?instId=NOTREAL-XYZ&bar=1H&limit=5",
    );
    const rows = json.data ?? [];
    if (json.code === "0" && rows.length > 0) {
      throw new Error("provider returned data for a fake instrument");
    }
    return "no data returned for a fake id (correct)";
  },
});

// ── CoinGecko (public, quote only) ────────────────────────────────
await check({
  name: "coingecko / quote",
  required: false,
  run: async () => {
    const json = await getJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    );
    const price = json?.bitcoin?.usd;
    if (typeof price !== "number") throw new Error("no usd price returned");
    return `bitcoin = ${price} USD`;
  },
});

// ── Twelve Data: catalogs per asset class ─────────────────────────
const TD_CATALOGS = [
  ["forex", "forex_pairs"],
  ["equity", "stocks"],
  ["commodity", "commodities"],
  ["indices", "indices"],
  ["crypto", "cryptocurrencies"],
];

for (const [assetClass, path] of TD_CATALOGS) {
  await check({
    name: `twelve-data / ${assetClass} catalog`,
    required: false,
    needsEnv: "TWELVE_DATA_API_KEY",
    run: async () => {
      const json = await getJson(
        `https://api.twelvedata.com/${path}?apikey=${process.env.TWELVE_DATA_API_KEY}`,
      );
      const rows = json?.data;
      if (!Array.isArray(rows)) {
        throw new Error(json?.message ?? "unexpected payload shape");
      }
      if (rows.length === 0) throw new Error("empty catalog");
      return `${rows.length} instruments, e.g. ${rows[0].symbol}`;
    },
  });
}

// ── Convex deployment ─────────────────────────────────────────────
await check({
  name: "convex / deployment reachable",
  required: false,
  needsEnv: "VITE_CONVEX_URL",
  run: async () => {
    const url = process.env.VITE_CONVEX_URL.replace(/\/$/, "");
    const res = await fetch(`${url}/version`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `${url} responded ${res.status}`;
  },
});

// ── Summary ───────────────────────────────────────────────────────
const failed = results.filter((r) => r.status === "FAIL");
const requiredFailed = failed.filter((r) => r.required);
const skipped = results.filter((r) => r.status === "SKIP");
const passed = results.filter((r) => r.status === "PASS");

console.log(
  `\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
);

if (skipped.length > 0) {
  console.log(
    `${YELLOW}Skipped checks are NOT passes.${RESET} Set the listed env vars to verify them.`,
  );
}

if (requiredFailed.length > 0) {
  console.log(`\n${RED}Required checks failed:${RESET}`);
  for (const r of requiredFailed) console.log(`  - ${r.name}: ${r.detail}`);
  process.exit(1);
}

console.log(`\n${GREEN}All required checks passed.${RESET}`);
