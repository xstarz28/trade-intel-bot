#!/usr/bin/env node
/**
 * Phase 287 — REAL deployed-runtime four-asset smoke.
 *
 * WHAT THIS PROVES, AND WHAT IT REFUSES TO CLAIM
 * ----------------------------------------------
 * This script talks to a DEPLOYED Convex runtime over HTTPS and asks it, four
 * times, one per asset class, to run the application's own protected analysis.
 * Every instrument is chosen from the deployment's OWN discovery actions at
 * run time; nothing is hardcoded here, no symbol is substituted, and no
 * client-supplied market/technical/fundamental evidence is ever sent.
 *
 * It is deliberately not a test. A test can be satisfied by a fixture; this
 * cannot, because the only inputs it can fabricate are routing fields, and the
 * server discards even those as evidence:
 *
 *   - the request body carries ONLY the discovered identity plus timeframe and
 *     trading style (`InstrumentInput.handleSubmit` sends the same shape);
 *   - no price, candle, technical or fundamental field is ever sent, so the
 *     engine has nothing to echo back (`stripClientEvidence` on the server);
 *   - no `fetch` is stubbed: this process has no fetch override at all, and
 *     every call goes to the deployed origin;
 *   - no fixture file is read: there is no fixture path in this script;
 *   - no local clock value is ever written into a provider field. `Date.now()`
 *     appears only for the run's own bookkeeping (`generatedAt`,
 *     `capturedAtLocal`), which is labelled as local and kept OUT of the
 *     evidence fields, which are copied verbatim from the runtime.
 *
 * PASS is never inferred from HTTP 200. A domain is PASS only when the
 * deployed runtime returned provider market evidence with a provider
 * observation instant, available technical evidence, an available domain-native
 * fundamental assessment, and unified intelligence. Anything else is reported
 * as UNAVAILABLE (the runtime honestly reported missing evidence, with the
 * reason it gave) or FAIL (a transport/contract defect, or a silent absence
 * with no reason at all).
 *
 * Usage:
 *   node scripts/development-runtime-smoke.mjs \
 *     [--url https://tough-goose-455.convex.cloud] \
 *     [--out development-runtime-smoke.json] \
 *     [--domains crypto,forex,stock,commodity] \
 *     [--max-attempts 2] [--allow-host <host>] [--quiet] \
 *     [--exact provider:assetClass:nativeId,...]   (phase 302 exact live-verification)
 *
 * Phase 303 — deterministic provider budget orchestration: exact verification
 * runs FIRST on its own fresh Twelve Data minute-windows; the catalog walk and
 * every generic analysis attempt reserve their worst-case credits BEFORE they
 * issue (see scripts/lib/provider-budget.mjs); a real 429 is classified and
 * reported, never retried.
 *
 * Exit codes:
 *   0  no domain FAILED (PASS and UNAVAILABLE are both non-failures)
 *   1  at least one domain FAILED
 *   2  the run could not look — the deployment was unreachable, so nothing
 *      about the runtime may be concluded from it ("could not look" is never
 *      reported as "nothing to see")
 */

import { writeFileSync } from "node:fs";
import {
  classifyInstrumentEligibility,
  parseExactInstrumentSpecs,
  observeAttemptOutcome,
  rankByAnalysisEligibility,
} from "./lib/analysis-eligibility.mjs";
import {
  PROVIDER_BLOCK_CLASSES,
  TWELVE_DATA_DISCOVERY_CREDITS,
  buildProviderBudgetPlan,
  classifyProviderBlock,
} from "./lib/provider-budget.mjs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/* ------------------------------------------------------------------ *
 * Target policy — fail closed
 * ------------------------------------------------------------------ */

/** The development deployment this smoke exists to exercise. */
export const EXPECTED_DEV_HOST = "tough-goose-455.convex.cloud";

/**
 * The production deployment. Named explicitly so it can be REFUSED: this smoke
 * must never be pointed at production, and a smoke that accidentally measured
 * production would be worse than no smoke at all.
 */
export const PRODUCTION_HOST = "pleasant-curlew-264.convex.cloud";

const TIMEOUT_MS = 60_000;

/**
 * Phase 289F — the discovery call gets its own, longer budget.
 *
 * A catalog above Convex's return boundary is now PERSISTED in bounded batches
 * instead of being returned, so the discovery action does real write work (a
 * 143300-row catalog is hundreds of stage writes) on top of the provider read.
 * That work is the fix, not a fault: aborting the call at the ordinary 60 s
 * would fail the run for succeeding. Every other call keeps the normal budget.
 */
// Phase 305 — 300 s: the /stocks read may now spend up to 45 s to first byte
// (its own larger header budget) plus the 180 s body/staging ceiling, and the
// action must not abort a walk the runtime is still making progress on.
const DISCOVERY_CALL_TIMEOUT_MS = 300_000;

/**
 * Refuse anything that is not the development deployment.
 *
 * - https only (a plaintext smoke would send a session bearer over the wire);
 * - `.convex.cloud` hosts only (no localhost, no IP literals, no tunnels);
 * - production is refused by name;
 * - unless `--allow-host` names it, the host must be `EXPECTED_DEV_HOST`.
 */
export function validateTarget(rawUrl, allowedHost = null) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return { ok: false, origin: null, host: null, reason: "target is not a valid URL" };
  }
  const host = parsed.hostname.toLowerCase();
  const fail = (reason) => ({ ok: false, origin: parsed.origin, host, reason });

  if (parsed.protocol !== "https:") return fail("target must be https");
  if (host === PRODUCTION_HOST) return fail("target is the PRODUCTION deployment — refused");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return fail("target must not be localhost or an IP literal");
  }
  if (!host.endsWith(".convex.cloud")) return fail("target must be a *.convex.cloud deployment host");
  if (host !== EXPECTED_DEV_HOST && host !== (allowedHost ?? "").toLowerCase()) {
    return fail(
      `target is not the development deployment (${EXPECTED_DEV_HOST}); pass --allow-host to override deliberately`,
    );
  }
  return { ok: true, origin: parsed.origin, host, reason: null };
}

/* ------------------------------------------------------------------ *
 * Redaction — no credential ever reaches a log or an artifact
 * ------------------------------------------------------------------ */

const SESSION_TOKEN_RE = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;

/** Bounded text for digests/annotations (one place, so bounds stay honest). */
function clipText(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
}

export function sanitize(text) {
  return String(text ?? "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(SESSION_TOKEN_RE, "<redacted-token>")
    .replace(/(dev|prod|preview|local|anonymous):[A-Za-z0-9|_.:-]+/g, "<redacted-identity>")
    .replace(/([?&](apikey|api_key|key|token|access_token)=)[^&\s"']+/gi, "$1<redacted>")
    .replace(/(^|[\s,;])(apikey|api_key|access_token|apiSecret|secret|token)=[^\s"';,]+/gi, "$1$2=<redacted>")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<redacted>")
    .slice(0, 900);
}

/* ------------------------------------------------------------------ *
 * Convex HTTP client — the /api/* contract the app itself speaks
 *
 * Same shape `scripts/evidence-d-harness.mjs` uses: POST /api/{action|query}
 * with `{path, args, format:"json"}`, Bearer only when a session exists.
 * ------------------------------------------------------------------ */

export function createTransport(origin, { timeoutMs = TIMEOUT_MS } = {}) {
  const state = { calls: 0, lastError: null, blocked: false };

  async function call(kind, path, args, token = null, options = {}) {
    const controller = new AbortController();
    const callTimeoutMs = isNumber(options.timeoutMs) ? options.timeoutMs : timeoutMs;
    const timer = setTimeout(() => controller.abort(), callTimeoutMs);
    try {
      const response = await fetch(`${origin}/api/${kind}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
        signal: controller.signal,
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: sanitize(text) };
      }
      state.calls += 1;
      // Convex answers 200 with {status:"error"} for a thrown function error.
      const appError = body?.status === "error" ? sanitize(body.errorMessage ?? "error") : null;
      return { ok: response.ok && !appError, httpStatus: response.status, appError, value: body?.value };
    } catch (error) {
      const code = error?.cause?.code ?? error?.name ?? "unknown";
      state.lastError = code;
      state.blocked = true;
      return { ok: false, httpStatus: 0, transportError: code, appError: null, value: undefined };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    state,
    action: (path, args, token, options) => call("action", path, args, token, options),
    query: (path, args, token, options) => call("query", path, args, token, options),
  };
}

/**
 * Phase 289C — WHICH COMMIT IS THIS HARNESS RUNNING FROM?
 *
 * A GitHub workflow can be dispatched from one ref while checking out another
 * (`ref` input), and the workflow FILE that runs is the one at the dispatch ref.
 * That is exactly how a run checked out the intended commit
 * (`7cec9f7…`) while the smoke — whose workflow definition came from `main`
 * and therefore had no checkout-SHA plumbing at all — reported
 * `harnessCommit=unknown`. Provenance must not depend on which revision of the
 * workflow file happened to execute.
 *
 * So the harness resolves it itself, in this order:
 *   1. `XSTARZ_SMOKE_SOURCE_COMMIT` — an explicit override (the current workflow
 *      resolves `git rev-parse HEAD` and passes it in; tests use it too).
 *   2. `git rev-parse HEAD` inside the checkout the harness is running from.
 *   3. "unknown", with the reason — never a guess, and never derived from
 *      `/version` (that is the running Convex BACKEND version, not a git SHA).
 */
export function resolveCheckoutSha({
  env = process.env,
  cwd = process.cwd(),
  runGit,
} = {}) {
  const override = env?.XSTARZ_SMOKE_SOURCE_COMMIT;
  if (typeof override === "string" && override.trim() !== "") {
    return { sha: override.trim(), source: "XSTARZ_SMOKE_SOURCE_COMMIT (supplied to the harness)" };
  }
  const git = runGit ?? ((dir) => execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "ignore"],
  }));
  try {
    const sha = String(git(cwd) ?? "").trim();
    if (/^[0-9a-f]{7,40}$/i.test(sha)) {
      return { sha, source: "git rev-parse HEAD in the checkout the harness runs from" };
    }
    return { sha: null, source: "unknown — the checkout's HEAD is not a commit SHA" };
  } catch {
    return {
      sha: null,
      source: "unknown — no override and no readable git checkout (the harness is not running from a checkout)",
    };
  }
}

/** The deployment's own build/version endpoint (proves WHICH build answered). */
export async function probeVersion(origin, { timeoutMs = 20_000 } = {}) {
  try {
    const response = await fetch(`${origin}/version`, { signal: AbortSignal.timeout(timeoutMs) });
    const text = sanitize(await response.text());
    return { ok: response.ok, httpStatus: response.status, version: response.ok ? text.slice(0, 120) : null };
  } catch (error) {
    return { ok: false, httpStatus: 0, version: null, transportError: error?.cause?.code ?? error?.name ?? "unknown" };
  }
}

/**
 * A harmless API-plane liveness probe: an entitlement query with no session.
 *
 * It reads and spends nothing. It exists so "unreachable" is decided by the
 * API plane the smoke actually uses, not by `/version` alone — a deployment
 * that serves the API but not the version route must not be written off.
 */
export async function probeApiLiveness(transport) {
  const r = await transport.query("entitlements:getMyEntitlement", {});
  return { ok: r.ok, httpStatus: r.httpStatus, transportError: r.transportError ?? null };
}

/**
 * A NEW anonymous session, per asset class.
 *
 * The guest allowance is small and chargeable, so one session per domain keeps
 * a rate-limited or expensive domain from spending another domain's quota.
 * The token is returned but never logged and never written to the artifact.
 */
export async function signInAnonymous(transport) {
  const r = await transport.action("auth:signIn", { provider: "anonymous" });
  const token = r.value?.tokens?.token ?? r.value?.token ?? null;
  return { ok: Boolean(token), token, httpStatus: r.httpStatus, appError: r.appError };
}

/* ------------------------------------------------------------------ *
 * Discovery — the deployment decides which instruments exist
 * ------------------------------------------------------------------ */

/**
 * The discovery asset class each domain needs. This is a TAXONOMY, not a
 * whitelist: no ticker, symbol or pair appears anywhere in this file.
 */
export const DOMAIN_SPECS = [
  { domain: "crypto", label: "CRYPTO", discovery: "okx", assetClass: "crypto" },
  { domain: "forex", label: "FOREX", discovery: "twelve-data", assetClass: "forex" },
  { domain: "stock", label: "STOCK", discovery: "twelve-data", assetClass: "equity" },
  { domain: "commodity", label: "COMMODITY", discovery: "twelve-data", assetClass: "commodity" },
];

/**
 * The app's own discovery→analysis mapping (`assetClassToInstrumentType`), so
 * the smoke classifies equity the way the product does: as `stock`.
 */
export function assetClassToInstrumentType(assetClass) {
  if (assetClass === "equity") return "stock";
  if (assetClass === "macro") return "indices";
  return assetClass;
}

/** Subtypes that price a spot pair/asset. Preferred, never required. */
const SPOT_LIKE = new Set([
  "crypto_spot",
  "forex_spot",
  "commodity_spot",
  "equity_common",
  "index_cash",
]);

/**
 * Candidates for one domain, in the provider's OWN order, filtered only by the
 * discovery metadata the provider returned. No curation, no substitution: the
 * instrument that is tried is the instrument the provider named.
 */
/**
 * Default number of discovery-ranked instruments tried per domain.
 *
 * Phase 288 — raised from 1 after the live four-asset run. The provider's
 * catalog advertises instruments the OHLCV leg cannot price (COMMODITY was
 * pinned to the provider-native `GAU/EUR` and produced no market evidence at
 * all), so a one-candidate cap lets ONE arbitrary catalog row decide a whole
 * domain's verdict. The bound stays small and the existing discipline is
 * untouched: the loop stops the moment real market evidence arrives (so a
 * domain that works is never re-requested), it never repeats a provider after a
 * rate-limit or credential circuit trips, and it never substitutes a symbol —
 * every candidate comes from the provider's own discovery, in provider order.
 */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Hard ceiling on candidates per domain — the bounded policy, never exceeded. */
export const MAX_CANDIDATE_ATTEMPTS = 3;

/**
 * Phase 303/306 — how deep the learning PICKS may reach into the ranked
 * discovery pool. This is NOT the attempt budget: requests stay bounded by
 * `maxAttempts`. It only lets observed evidence (macro gaps, strikes) move
 * the next pick to a less-struck candidate, without re-requesting anything.
 *
 * Phase 306 — 12 → 96, live evidence (run 36960231581): the OKX catalog's
 * 1898-row head is a CONTIGUOUS block of thin-quote instruments (BTC-PLN,
 * ETH-PLN, USDC-PLN, USDT-SGD, USDC-SGD, USDG-SGD, ...) — all three attempts
 * burned inside it because the learning pool never saw a deep-quote row. A
 * wider ranked pool is free (client-side ranking over already-discovered
 * rows; the attempt budget is untouched) and is what makes "a less-struck,
 * technically analyzable candidate in the same tier" actually reachable.
 */
export const CANDIDATE_POOL_WINDOW = 96;

/**
 * Phase 306 — the staged-catalog scan windows a plan-restricted head block
 * may advance through (workstream B). Bounded: a domain reads at most this
 * many 960-row windows of the stage, ALWAYS in provider order, and only when
 * the provider itself proved the current block plan-restricted.
 */
export const STAGED_MAX_WINDOWS = 3;

/** Stable identity of a candidate within one domain's learning loop. */
function candidateKey(domainSpec, candidate) {
  const id = domainSpec.discovery === "okx" ? candidate?.instId : candidate?.providerInstrumentId;
  return `${candidate?.provider ?? domainSpec.discovery}:${String(id ?? "")}`;
}

/**
 * Phase 304 — bounded staged-catalog candidate selection (workstream A).
 *
 * THE SEAM (live evidence, run 36957205385): `marketData:discoverTwelveDataInstruments`
 * reports `/stocks COMPLETE 143212 kept` while `discovery.instruments` carries NO
 * equity row — a catalog larger than the runtime's inline limit is written to the
 * server-side stage in provider order, so the client-visible instrument array is
 * empty exactly where the catalog is COMPLETEST. Selecting from the inline array
 * alone reported "no live equity instrument" behind a COMPLETE catalog.
 *
 * This reads the stage the way the phase-289F proof already does —
 * `marketData:readTwelveDataCatalogStage` with the `afterSeq` cursor, one bounded
 * page at a time, in PROVIDER ORDER — filters by the SAME identity/trading-state
 * rules as `selectCandidates`, and ranks the window with the SAME
 * capability-aware ranker (learning observations included). It NEVER loads the
 * catalog wholesale: the window is `STAGED_SELECTION_MAX_ROWS` rows of the
 * provider's own head order, and the provenance (stageId, pagesRead, rowsRead,
 * lastAfterSeq, usableRows, selected identities) travels with the record so the
 * run can PROVE the candidate came from the staged catalog.
 */
export const STAGED_SELECTION_PAGE_ROWS = 480;
export const STAGED_SELECTION_MAX_ROWS = 960;

export function stagedCatalogFor(discovery, assetClass) {
  const catalogs = Array.isArray(discovery?.catalogs) ? discovery.catalogs : [];
  return (
    catalogs.find(
      (c) =>
        c?.assetClass === assetClass &&
        c?.transport?.mode === "staged" &&
        typeof c.transport.stageId === "string" &&
        c.transport.stageId.length > 0,
    ) ?? null
  );
}

export async function selectCandidatesFromStagedCatalog(
  domainSpec,
  discovery,
  transport,
  token,
  {
    maxAttempts = 3,
    observations = undefined,
    pageRows = STAGED_SELECTION_PAGE_ROWS,
    maxRows = STAGED_SELECTION_MAX_ROWS,
    // Phase 306 — 0-based scan window over the SAME provider order: window 1
    // starts after the first `maxRows` rows. Advancing is driven only by the
    // provider's own plan-restriction refusals (see the domain loop) and is
    // bounded by STAGED_MAX_WINDOWS.
    windowIndex = 0,
  } = {},
) {
  const catalog = stagedCatalogFor(discovery, domainSpec.assetClass);
  if (!catalog) {
    return { ok: false, reason: "no staged catalog for this asset class", ranked: [], candidates: [], provenance: null };
  }
  const stageRef = catalog.transport;
  const provenance = {
    source: "staged-catalog",
    catalogPath: catalog.path ?? null,
    stageId: stageRef.stageId,
    stagedRows: isNumber(stageRef.stagedRows) ? stageRef.stagedRows : null,
    pagesRead: 0,
    rowsRead: 0,
    lastAfterSeq: -1,
    usableRows: 0,
    selected: [],
    windowIndex,
    window: `provider-order scan window ${windowIndex + 1} (rows ${windowIndex * maxRows + 1}..${(windowIndex + 1) * maxRows}, ${Math.ceil(maxRows / pageRows)} pages of ${pageRows})`,
  };
  const rows = [];
  let afterSeq = windowIndex * maxRows - 1;
  while (provenance.rowsRead < maxRows) {
    const page = await transport.action(
      "marketData:readTwelveDataCatalogStage",
      { stageId: stageRef.stageId, afterSeq, limit: pageRows },
      token,
    );
    if (!page.ok) {
      provenance.readError = sanitize(page.appError ?? page.transportError ?? "stage read failed");
      break;
    }
    const value = page.value ?? {};
    const batch = Array.isArray(value.rows) ? value.rows : [];
    rows.push(...batch);
    provenance.pagesRead += 1;
    provenance.rowsRead += batch.length;
    afterSeq = isNumber(value.nextAfterSeq) ? value.nextAfterSeq : afterSeq;
    provenance.lastAfterSeq = afterSeq;
    if (value.hasMore !== true || batch.length === 0) break;
  }
  const usable = rows
    .filter((row) => row.assetClass === domainSpec.assetClass)
    .filter((row) => row.tradingState !== "disabled")
    .filter((row) => typeof row.providerInstrumentId === "string" && row.providerInstrumentId.length > 0)
    // identity completeness, the discovery walk's own rule: a row without its
    // base/quote identity is the row the walk itself would have skipped.
    .filter((row) => typeof row.baseAsset === "string" && row.baseAsset.length > 0)
    .filter((row) => typeof row.quoteAsset === "string" && row.quoteAsset.length > 0);
  provenance.usableRows = usable.length;
  const ranked = rankByAnalysisEligibility(usable, {
    provider: domainSpec.discovery,
    assetClass: domainSpec.assetClass,
  }, observations);
  const candidates = ranked.slice(0, Math.max(1, Math.min(maxAttempts, MAX_CANDIDATE_ATTEMPTS)));
  provenance.selected = candidates.map((c) => c.providerInstrumentId);
  return {
    ok: candidates.length > 0,
    reason: candidates.length > 0 ? null : "no identity-complete live row in the bounded provider-order stage window",
    ranked,
    candidates,
    provenance,
  };
}

/**
 * Phase 304 — the OKX discovery digest, mirroring the Twelve Data one: the
 * crypto domain's attempts were previously reported without ANY visibility of
 * the pool they came from (runs 36954328849 and 36957205385 both picked
 * USDC-PLN and the run could not show whether alternatives existed).
 */
export function okxDiscoveryDigest(discovery) {
  if (!discovery || typeof discovery !== "object") return "no okx discovery result";
  const rows = Array.isArray(discovery.instruments) ? discovery.instruments : [];
  const sample = rows.slice(0, 6).map((r) => r?.instId ?? "?").join(",");
  const warnings = Array.isArray(discovery.warnings) ? discovery.warnings : [];
  return [
    `success=${discovery.success === true}`,
    `completeness=${discovery.completeness ?? "?"}`,
    `total=${rows.length}`,
    `identities=${sample || "none"}`,
    warnings.length > 0 ? `warning=${clipText(String(warnings[0]), 130)}` : null,
  ]
    .filter((piece) => piece !== null)
    .join(" · ");
}

export function selectCandidates(domainSpec, discovery, maxAttempts, ceiling = MAX_CANDIDATE_ATTEMPTS, observations = undefined) {
  if (!discovery || discovery.success !== true) return [];
  const rows = Array.isArray(discovery.instruments) ? discovery.instruments : [];
  const forClass =
    domainSpec.discovery === "okx"
      ? rows.filter((row) => (row.state ?? "live") === "live")
      : rows.filter((row) => row.assetClass === domainSpec.assetClass && row.tradingState !== "disabled");
  // Each provider names its instruments differently — OKX discovery returns
  // `instId` and no `providerInstrumentId`, Twelve Data returns
  // `providerInstrumentId`. Requiring the wrong one silently empties the
  // candidate list, which would look like "provider has no instruments" and
  // could hide a working provider behind an UNAVAILABLE.
  const usable = forClass.filter((row) =>
    domainSpec.discovery === "okx"
      ? typeof row.instId === "string" && row.instId.length > 0
      : typeof row.providerInstrumentId === "string" && row.providerInstrumentId.length > 0,
  );
  // Provider order preserved; spot-like instruments first so the first try is
  // the kind of instrument the market-data leg actually prices.
  const ordered = [
    ...usable.filter((row) => SPOT_LIKE.has(row.subType)),
    ...usable.filter((row) => !SPOT_LIKE.has(row.subType)),
  ];
  // Phase 289C-audit — the ceiling is a PARAMETER, not a constant.
  //
  // It used to be `Math.min(maxAttempts, MAX_CANDIDATE_ATTEMPTS)` unconditionally,
  // which silently clamped the commodity energy-gate probe's declared bound of 6
  // down to 3: the probe reported `classified=3/3` and never looked at candidates
  // 4..N, so the fact that it could not reach an energy instrument was
  // indistinguishable from the provider not offering one. The domain loop keeps
  // its own policy ceiling by default (unchanged behaviour); a caller that has its
  // own disclosed bound passes it. Provider order is preserved either way, and no
  // instrument is ever added, ranked or substituted here.
  // Phase 302 — capability-aware eligibility BEFORE selection: candidates the
  // provider cannot actually analyse (known plan restrictions, unmapped
  // calendar currencies, unsupported downstream formats) rank BEHIND those it
  // can, within the SAME provider order. Discovery truth is untouched — every
  // candidate stays listed with its named reasons, and the bounded budget
  // below simply stops being spent on candidates that were never analysable.
  const ranked = rankByAnalysisEligibility(
    ordered,
    {
      provider: domainSpec.discovery,
      assetClass: domainSpec.assetClass,
    },
    // Phase 303 — within-run macro-measurement learning (see the ranker).
    observations,
  );
  return ranked.slice(0, Math.max(1, Math.min(maxAttempts, ceiling)));
}

/** OKX discovery is public metadata (no key, no prices, no direction). */
export async function discoverOkx(transport) {
  const r = await transport.action("okx:discoverOkxInstruments", {});
  if (!r.ok) return { success: false, instruments: [], error: r.appError ?? r.transportError ?? "discovery failed" };
  const value = r.value ?? {};
  return {
    success: value.success === true,
    provider: "okx",
    instruments: Array.isArray(value.instruments) ? value.instruments : [],
    error: value.error ?? null,
  };
}

/**
 * Twelve Data reference catalogs — metadata only, needs the server-side key.
 *
 * Phase 288 — the adapter publishes its OWN per-catalog report (which path was
 * fetched, how many pages answered, whether a page failed, what the provider
 * said). Discarding it made "discovered nothing" unactionable: a zero-row
 * catalog, a plan/credit rejection, a parser that skipped rows and a transport
 * failure all produced the same sentence. The report is carried through
 * verbatim (sanitized), so the verdict names the actual cause.
 */
export async function discoverTwelveData(transport, token) {
  // A staged catalog is written server-side during this call; the ordinary
  // client budget would abort that work. The bound is still a bound.
  const r = await transport.action("marketData:discoverTwelveDataInstruments", {}, token, {
    timeoutMs: DISCOVERY_CALL_TIMEOUT_MS,
  });
  if (!r.ok) return { success: false, instruments: [], error: r.appError ?? r.transportError ?? "discovery failed" };
  const value = r.value ?? {};
  return {
    success: value.success === true,
    provider: value.provider ?? "twelve-data",
    instruments: Array.isArray(value.instruments) ? value.instruments : [],
    error: value.error ?? null,
    warnings: Array.isArray(value.warnings) ? value.warnings.map(sanitize) : [],
    completeness: typeof value.completeness === "string" ? value.completeness : null,
    pagesFetched: isNumber(value.pagesFetched) ? value.pagesFetched : null,
    totalDiscovered: isNumber(value.totalDiscovered) ? value.totalDiscovered : null,
    catalogs: Array.isArray(value.catalogs)
      ? value.catalogs.map((c) => ({
          path: typeof c?.path === "string" ? c.path : null,
          assetClass: typeof c?.assetClass === "string" ? c.assetClass : null,
          completeness: typeof c?.completeness === "string" ? c.completeness : null,
          pagesFetched: isNumber(c?.pagesFetched) ? c.pagesFetched : null,
          totalDiscovered: isNumber(c?.totalDiscovered) ? c.totalDiscovered : null,
          // Phase 289G — the provider's OWN row count, verbatim, beside the rows
          // this walk kept. Identity dedupe inside a catalog legitimately makes
          // them differ, and hiding either number would make the completeness
          // claim unverifiable.
          providerCount: isNumber(c?.providerCount) ? c.providerCount : null,
          // Phase 289J — the RAW side of the same walk: provider `data`
          // elements parsed, rows skipped for missing identity, rows dropped as
          // duplicates. Reported verbatim so the run's own numbers state the
          // provider-count reconciliation instead of a reader having to trust
          // "unique rows == provider count", which normalization legitimately
          // breaks (the deployed `/commodities` reads 31 kept of 32).
          rawRowsSeen: isNumber(c?.rawRowsSeen) ? c.rawRowsSeen : null,
          skippedIdentityRows: isNumber(c?.skippedIdentityRows) ? c.skippedIdentityRows : null,
          duplicateRows: isNumber(c?.duplicateRows) ? c.duplicateRows : null,
          failedPage: isNumber(c?.failedPage) ? c.failedPage : null,
          // Phase 289F — how this catalog crossed the function boundary. A
          // catalog above Convex's return boundary is staged (persisted in
          // provider order, read back in chunks) and its kept count stays the
          // provider's real number; the transport state is the READABILITY
          // truth, distinct from the catalog's own completeness.
          transport: c?.transport
            ? {
                mode: typeof c.transport.mode === "string" ? c.transport.mode : null,
                state: typeof c.transport.state === "string" ? c.transport.state : null,
                inlineRows: isNumber(c.transport.inlineRows) ? c.transport.inlineRows : null,
                stagedRows: isNumber(c.transport.stagedRows) ? c.transport.stagedRows : null,
                totalKept: isNumber(c.transport.totalKept) ? c.transport.totalKept : null,
                chunkRows: isNumber(c.transport.chunkRows) ? c.transport.chunkRows : null,
                // Phase 289G — rows per stored stage document (the write-side
                // chunk). Reported so the write path can be described from the
                // run's own artifact instead of from memory.
                writeChunkRows: isNumber(c.transport.writeChunkRows)
                  ? c.transport.writeChunkRows
                  : null,
                stageId: typeof c.transport.stageId === "string" ? c.transport.stageId : null,
                detail: typeof c.transport.detail === "string" ? sanitize(c.transport.detail) : null,
              }
            : null,
        }))
      : [],
  };
}

/**
 * Phase 289E — WHAT THE DISCOVERY ACTUALLY RETURNED, in one bounded line.
 *
 * The deployment killed the discovery action with an out-of-memory error and the
 * annotation could only say that the run had no candidate. Now that each catalog
 * is fetched in its own execution, the run has to report the result as a whole:
 * the verdict, the catalog completeness, the pages fetched, the real total, and
 * per catalog which one was read, how many rows it kept and whether a page
 * failed. Values come from the runtime's own response — nothing is inferred
 * here, and the identity sample is bounded and credential-redacted.
 */
export function discoveryDigest(discovery) {
  if (!discovery) return null;
  const bits = [
    `success=${discovery.success === true}`,
    `completeness=${discovery.completeness ?? "unknown"}`,
    `pages=${isNumber(discovery.pagesFetched) ? discovery.pagesFetched : "unknown"}`,
    `total=${isNumber(discovery.totalDiscovered) ? discovery.totalDiscovered : "unknown"}`,
  ];
  const catalogs = Array.isArray(discovery.catalogs) ? discovery.catalogs : [];
  if (catalogs.length > 0) {
    bits.push(
      catalogs
        .map((c) => {
          const parts = [
            c.path ?? "?",
            c.completeness ?? "?",
            `${isNumber(c.pagesFetched) ? c.pagesFetched : "?"}p`,
            `${isNumber(c.totalDiscovered) ? c.totalDiscovered : "?"}kept`,
          ];
          // Phase 289G — the provider's own count, so a reader can compare what
          // the provider published with what this walk kept without opening the
          // artifact.
          if (isNumber(c.providerCount)) parts.push(`of:${c.providerCount}`);
          // Phase 289J — the raw row count this walk really parsed, next to the
          // provider's own count and the unique rows kept. `raw==of` is the raw
          // completeness proof; `skipped`/`dupes` explain any difference between
          // the raw rows and the unique instruments, and are never hidden.
          if (isNumber(c.rawRowsSeen)) parts.push(`raw:${c.rawRowsSeen}`);
          if (isNumber(c.skippedIdentityRows)) parts.push(`skipped:${c.skippedIdentityRows}`);
          if (isNumber(c.duplicateRows)) parts.push(`dupes:${c.duplicateRows}`);
          if (isNumber(c.failedPage)) parts.push(`failedPage=${c.failedPage}`);
          // Phase 289F/289G — a catalog above the return boundary is staged, not
          // truncated: its kept count stays the provider's real number and the
          // marker names the transport that carries it, the rows it really
          // holds, the chunk it pages with and the chunk it was WRITTEN in.
          if (c.transport?.mode === "staged") {
            parts.push(
              `staged:${isNumber(c.transport.stagedRows) ? c.transport.stagedRows : "?"}:${
                c.transport.state ?? "?"
              }`,
            );
            if (isNumber(c.transport.chunkRows)) parts.push(`chunk=${c.transport.chunkRows}`);
            if (isNumber(c.transport.writeChunkRows)) {
              parts.push(`writeChunk=${c.transport.writeChunkRows}`);
            }
          }
          return parts.join("/");
        })
        .join(" · "),
    );
  } else {
    bits.push("no per-catalog report");
  }
  const stageReads = stageReadDigest(discovery.stageReads);
  if (stageReads !== null) bits.push(`stageRead=${stageReads}`);
  const instruments = Array.isArray(discovery.instruments) ? discovery.instruments : [];
  if (instruments.length > 0) {
    bits.push(
      `identities=${instruments
        .slice(0, DISCOVERY_IDENTITY_SAMPLE)
        .map((i) => String(i?.providerInstrumentId ?? "?"))
        .join(",")}`,
    );
  }
  const warnings = Array.isArray(discovery.warnings) ? discovery.warnings : [];
  if (warnings.length > 0) bits.push(`warnings=${warnings.slice(0, 3).join(" | ")}`);
  if (typeof discovery.error === "string" && discovery.error.length > 0) {
    bits.push(`error=${discovery.error}`);
  }
  return sanitize(bits.join(" · "));
}

/** How many discovered identities are named in the digest. */
export const DISCOVERY_IDENTITY_SAMPLE = 6;

/**
 * Phase 289F — HOW MANY ROWS ONE STAGE READ MOVES.
 *
 * The proof only has to show that a staged catalog is READABLE in provider
 * order — it must never transfer the universe it is proving. The bound belongs
 * to the harness (the deployment's own chunk size is reported separately by the
 * catalog's transport record), and it is small enough that the probe cannot
 * become a second, accidental copy of the catalog.
 */
export const STAGE_READ_PROOF_ROWS = 2;

/**
 * Phase 289F — READ ONE BOUNDED PAGE OF EVERY STAGED CATALOG.
 *
 * The deployment cannot return a catalog above Convex's array boundary
 * (`Array length is too long (143300 > maximum length 8192)`), so such a catalog
 * is persisted server-side in provider order and the response carries only its
 * transport record. This reads one small page back through the deployment's own
 * read action — twice, to show the same page comes back identically — and
 * records the provider-native identities it contains.
 *
 * NOTHING IS ASSUMED: `ok` requires rows to have arrived, the stage's own
 * transport state to be `complete`, the page to fit what the stage says it
 * holds, and the repeat read to agree. A failed read is reported with its
 * reason; the probe never falls back to an inline slice, and it never treats a
 * catalog's completeness as proof that its rows are readable.
 */
export async function probeDiscoveryStages(discovery, transport, token, limit = STAGE_READ_PROOF_ROWS) {
  const catalogs = Array.isArray(discovery?.catalogs) ? discovery.catalogs : [];
  const staged = catalogs.filter(
    (c) => c?.transport && c.transport.mode === "staged" && typeof c.transport.stageId === "string",
  );
  if (staged.length === 0) return [];
  const pageRows = Math.max(1, Math.min(isNumber(limit) ? Math.floor(limit) : STAGE_READ_PROOF_ROWS, 8));

  const reads = [];
  for (const catalog of staged) {
    const record = catalog.transport;
    const stagedRows = isNumber(record.stagedRows) ? record.stagedRows : null;
    const path = typeof catalog.path === "string" ? catalog.path : null;
    const args = { stageId: record.stageId, afterSeq: -1, limit: pageRows };

    const first = await transport.action("marketData:readTwelveDataCatalogStage", args, token);
    if (!first.ok) {
      reads.push({
        path,
        ok: false,
        rows: 0,
        stagedRows,
        state: null,
        hasMore: false,
        nextAfterSeq: null,
        catalogCompleteness: null,
        catalogRows: null,
        providerCount: null,
        rawRowsSeen: null,
        skippedIdentityRows: null,
        duplicateRows: null,
        identitySample: [],
        reason: sanitize(first.appError ?? first.transportError ?? "stage read failed"),
      });
      continue;
    }

    const value = first.value ?? {};
    const rows = Array.isArray(value.rows) ? value.rows : [];
    // Phase 289G — the stage's OWN record of the catalog it holds: the walk's
    // completeness, the rows it kept and the count the PROVIDER reported. They
    // are reported next to the read proof, so the run states the catalog's
    // completeness and its staged total independently of how much of it the
    // proof transferred.
    const catalogCompleteness =
      typeof value.completeness === "string" ? value.completeness : null;
    const catalogRows = isNumber(value.totalDiscovered) ? value.totalDiscovered : null;
    const providerCount = isNumber(value.providerCount) ? value.providerCount : null;
    // Phase 289J — the stage document also carries the walk's raw accounting,
    // so the read proof states the provider-count reconciliation without the
    // discovery response.
    const rawRowsSeen = isNumber(value.rawRowsSeen) ? value.rawRowsSeen : null;
    const skippedIdentityRows = isNumber(value.skippedIdentityRows)
      ? value.skippedIdentityRows
      : null;
    const duplicateRows = isNumber(value.duplicateRows) ? value.duplicateRows : null;
    const identities = rows.map((row) =>
      typeof row?.providerInstrumentId === "string" ? row.providerInstrumentId : "?",
    );
    const nativeIdentity = rows.every(
      (row) =>
        typeof row?.providerInstrumentId === "string" &&
        row.providerInstrumentId.length > 0 &&
        typeof row?.provider === "string" &&
        typeof row?.assetClass === "string",
    );
    const state = typeof value.transportState === "string" ? value.transportState : null;
    const hasMore = value.hasMore === true;
    const nextAfterSeq = isNumber(value.nextAfterSeq) ? value.nextAfterSeq : null;
    const withinStage = stagedRows === null || rows.length <= stagedRows;
    const moreConsistent = stagedRows === null || stagedRows <= rows.length || hasMore;

    // Re-reading the same page must return the same provider rows: a stable read
    // is a pure read — no duplicate, no reorder, no side effect.
    let stable = false;
    const again = await transport.action("marketData:readTwelveDataCatalogStage", args, token);
    if (again.ok) {
      const againRows = Array.isArray(again.value?.rows) ? again.value.rows : [];
      stable =
        againRows.length === rows.length &&
        againRows.every((row, i) => row?.providerInstrumentId === rows[i]?.providerInstrumentId);
    }

    const ok = nativeIdentity && rows.length > 0 && state === "complete" && withinStage && moreConsistent && stable;
    const reason = ok
      ? null
      : rows.length === 0
        ? "the stage returned no rows"
        : state !== "complete"
          ? `the stage's own transport state is ${state ?? "unknown"}`
          : !stable
            ? "re-reading the same page returned different rows"
            : !nativeIdentity
              ? "a staged row lost its provider-native identity"
              : "the read is inconsistent with what the stage says it holds";
    reads.push({
      path,
      ok,
      rows: rows.length,
      stagedRows,
      state,
      hasMore,
      nextAfterSeq,
      catalogCompleteness,
      catalogRows,
      providerCount,
      rawRowsSeen,
      skippedIdentityRows,
      duplicateRows,
      identitySample: identities.slice(0, DISCOVERY_IDENTITY_SAMPLE),
      reason,
    });
  }
  return reads;
}

/** The stage reads as ONE bounded, credential-redacted line. */
export function stageReadDigest(reads) {
  if (!Array.isArray(reads) || reads.length === 0) return null;
  const parts = reads.slice(0, 5).map((read) => {
    const bits = [
      read.path ?? "?",
      read.ok === true ? "ok" : "FAILED",
      `${isNumber(read.rows) ? read.rows : "?"}of${isNumber(read.stagedRows) ? read.stagedRows : "?"}`,
    ];
    if (typeof read.state === "string") bits.push(`state=${read.state}`);
    // Phase 289G — the catalog's own completeness and total, read from the
    // stage: a bounded page proves readability, never completeness.
    if (typeof read.catalogCompleteness === "string") {
      bits.push(`catalog=${read.catalogCompleteness}`);
    }
    if (isNumber(read.catalogRows)) bits.push(`total=${read.catalogRows}`);
    if (isNumber(read.providerCount)) bits.push(`of:${read.providerCount}`);
    // Phase 289J — the raw reconciliation, verbatim from the stage document.
    if (isNumber(read.rawRowsSeen)) bits.push(`raw:${read.rawRowsSeen}`);
    if (isNumber(read.skippedIdentityRows)) bits.push(`skipped:${read.skippedIdentityRows}`);
    if (isNumber(read.duplicateRows)) bits.push(`dupes:${read.duplicateRows}`);
    if (Array.isArray(read.identitySample) && read.identitySample.length > 0) {
      bits.push(read.identitySample.slice(0, 2).join(","));
    }
    if (read.ok !== true && typeof read.reason === "string" && read.reason.length > 0) {
      bits.push(sanitize(read.reason).slice(0, 80));
    }
    return bits.join(":");
  });
  const text = sanitize(parts.join(" · "));
  return text.length > 300 ? text.slice(0, 300) : text;
}

/** How many of the assessment's evidence items are carried into the report. */
export const EVIDENCE_ITEM_SAMPLE = 24;

/**
 * One line naming why a discovery produced no candidate for this asset class —
 * built only from the provider's own report. `null` when nothing is known.
 */
export function discoveryDiagnosis(discovery, assetClass) {
  if (!discovery) return null;
  const parts = [];
  if (typeof discovery.error === "string" && discovery.error.length > 0) {
    parts.push(sanitize(discovery.error));
  }
  if (typeof discovery.completeness === "string") {
    parts.push(`catalog completeness ${discovery.completeness}`);
  }
  const catalogs = Array.isArray(discovery.catalogs) ? discovery.catalogs : [];
  if (catalogs.length > 0) {
    parts.push(
      `catalogs ${catalogs
        .map((c) => {
          const bits = [c.path ?? "?", c.completeness ?? "?"];
          if (c.failedPage !== null) bits.push(`failed page ${c.failedPage}`);
          if (c.totalDiscovered !== null) bits.push(`${c.totalDiscovered} kept`);
          return bits.join(" ");
        })
        .join("; ")}`,
    );
  }
  const warnings = Array.isArray(discovery.warnings) ? discovery.warnings : [];
  if (warnings.length > 0) {
    parts.push(`provider warnings: ${warnings.slice(0, 3).join(" | ")}`);
  }
  if (parts.length === 0) return null;
  return `${assetClass}: ${parts.join(" — ")}`;
}

/* ------------------------------------------------------------------ *
 * The request — only routing fields, never evidence
 * ------------------------------------------------------------------ */

/**
 * Mirrors `InstrumentInput.handleSubmit`: the analysis input is the discovered
 * identity, the form's timeframe/trading style, and nothing else.
 *
 * The key set is asserted by the test suite, because "no client-supplied
 * evidence" is a load-bearing property of this smoke.
 */
export function buildAnalysisInput(domainSpec, candidate, { timeframe = "D1", tradingStyle = "intraday" } = {}) {
  const nativeId =
    domainSpec.discovery === "okx" ? candidate.instId : candidate.providerInstrumentId;
  return {
    input: {
      instrument: nativeId,
      instrumentType: assetClassToInstrumentType(domainSpec.assetClass),
      provider: candidate.provider ?? domainSpec.discovery,
      providerInstrumentId: nativeId,
      timeframe,
      tradingStyle,
      requestedTimeframe: timeframe,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Classification — the honest verdict
 * ------------------------------------------------------------------ */

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

function firstReason(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return sanitize(candidate);
    if (Array.isArray(candidate) && candidate.length > 0) {
      const found = candidate.find((x) => typeof x === "string" && x.trim().length > 0);
      if (found) return sanitize(found);
    }
  }
  return null;
}

/**
 * Read the deployed runtime's own result. Every value is copied verbatim; a
 * missing value becomes null with a reason, never a substitute.
 */
export function readResultEvidence(result) {
  const r = result ?? {};
  const price = r.priceSnapshot ?? null;
  const fa = r.fundamentalAssessment ?? null;
  const ui = r.unifiedIntelligence ?? null;
  const at = r.advancedTechnicalEvidence ?? null;

  const market = {
    present: Boolean(price),
    price: isNumber(price?.price) ? price.price : null,
    // Provider observation instant, verbatim. Never re-stamped locally.
    observedAt: isNumber(price?.timestamp) && price.timestamp > 0 ? price.timestamp : null,
    source: typeof price?.source === "string" ? price.source : null,
    provider: typeof r.provider === "string" ? r.provider : null,
    providerInstrumentId: typeof r.providerInstrumentId === "string" ? r.providerInstrumentId : null,
    // How many candles the technical engine actually consumed (`dataPoints`),
    // so a thin series is visible in the evidence instead of implied.
    dataPoints: isNumber(r.technicalData?.dataPoints) ? r.technicalData.dataPoints : null,
  };

  const technical = {
    present: Boolean(r.technicalData),
    available: ui?.technical?.available === true,
    bias: ui?.technical?.bias ?? null,
    confidence: ui?.technical?.confidence ?? null,
    summary: typeof r.technicalSummary === "string" ? sanitize(r.technicalSummary) : null,
    advanced: at
      ? {
          evidenceClasses: Array.isArray(at.evidenceClasses) ? at.evidenceClasses : [],
          confluence: Array.isArray(at.confluence) ? at.confluence.length : 0,
          conflicts: Array.isArray(at.conflicts) ? at.conflicts.length : 0,
          unavailableMetrics: Array.isArray(at.unavailableMetrics) ? at.unavailableMetrics : [],
        }
      : null,
  };

  const fundamental = {
    present: Boolean(fa),
    available: fa?.available === true,
    domain: fa?.domain ?? null,
    provider: fa?.provider ?? null,
    instrumentId: fa?.instrumentId ?? null,
    observedAt: isNumber(fa?.observedAt) && fa.observedAt > 0 ? fa.observedAt : null,
    reportingPeriod: fa?.reportingPeriod ?? null,
    state: fa?.state ?? null,
    confidence: fa?.confidence ?? null,
    directionalBias: fa?.directionalBias ?? null,
    periodsCount: isNumber(fa?.periodsCount) ? fa.periodsCount : null,
    // Phase 289B — the deployed runtime's OWN market classification for the
    // instrument (the field the commodity physical-feed gate reads) and whether
    // petroleum-derived metrics were actually consumed for it.
    commodityProfile: fa?.commodityProfile
      ? {
          group: typeof fa.commodityProfile.group === "string" ? fa.commodityProfile.group : null,
          classificationSource:
            typeof fa.commodityProfile.classificationSource === "string"
              ? sanitize(fa.commodityProfile.classificationSource)
              : null,
        }
      : null,
    commodityMetrics: fa?.commodityMetrics
      ? {
          inventoryLatest: isNumber(fa.commodityMetrics.inventoryLatest)
            ? fa.commodityMetrics.inventoryLatest
            : null,
          keys: Object.keys(fa.commodityMetrics).slice(0, 12),
        }
      : null,
    limitations: Array.isArray(fa?.limitations) ? fa.limitations.slice(0, 12).map(sanitize) : [],
    // Phase 289 — the delivered domain dimensions with their OWN status. This is
    // the surface that answers "did this instrument receive evidence that belongs
    // to its market?" (e.g. petroleum inventories on a bullion instrument), and
    // it was previously unreadable outside the artifact.
    dimensions: Array.isArray(fa?.dimensions)
      ? fa.dimensions
          .slice(0, 10)
          .map((d) => ({
            name: typeof d?.name === "string" ? d.name : null,
            status: typeof d?.status === "string" ? d.status : null,
            role: typeof d?.role === "string" ? d.role : null,
          }))
      : [],
    // Phase 289F — THE CANONICAL EVIDENCE ITEMS.
    //
    // The assessment carries per-item provenance on its own `evidence` array
    // (metric, provider, source, observedAt, period, value…). The per-DIMENSION
    // `evidence` field is PROSE. The previous derivation read the prose, so the
    // provider list came back empty on every instrument and `eiaEvidence=0` sat
    // next to a consumed EIA leg and a real inventory reading. The items are read
    // here, bounded and sanitized, and every provider list is derived FROM THEM.
    evidenceItemCount: Array.isArray(fa?.evidence) ? fa.evidence.length : 0,
    // Phase 289F — the EIA slice of the canonical items, counted over the WHOLE
    // array. The report below is deliberately bounded; the METRIC must not be,
    // or a real EIA item past the sample would read as zero evidence while the
    // leg that consumed it says otherwise.
    eiaEvidenceItemCount: Array.isArray(fa?.evidence)
      ? fa.evidence.filter((e) => isEiaProviderIdentity(e?.provider)).length
      : 0,
    eiaEvidenceMetrics: Array.isArray(fa?.evidence)
      ? [
          ...new Set(
            fa.evidence
              .filter((e) => isEiaProviderIdentity(e?.provider))
              .map((e) => e?.metric)
              .filter((m) => typeof m === "string"),
          ),
        ].slice(0, 6)
      : [],
    evidenceProviders: Array.isArray(fa?.evidence)
      ? [
          ...new Set(
            fa.evidence.map((e) => e?.provider).filter((p) => typeof p === "string"),
          ),
        ]
      : [],
    evidenceItems: Array.isArray(fa?.evidence)
      ? fa.evidence.slice(0, EVIDENCE_ITEM_SAMPLE).map((e) => ({
          metric: typeof e?.metric === "string" ? e.metric : null,
          provider: typeof e?.provider === "string" ? sanitize(e.provider) : null,
          source: typeof e?.source === "string" ? sanitize(e.source) : null,
          unit: typeof e?.unit === "string" ? sanitize(e.unit) : null,
          value:
            isNumber(e?.value) ? e.value : typeof e?.value === "string" ? sanitize(e.value) : null,
          observedAt: isNumber(e?.observedAt) && e.observedAt > 0 ? e.observedAt : null,
          period: typeof e?.period === "string" ? sanitize(e.period) : null,
          derived: e?.derived === true,
          evidenceClass: typeof e?.evidenceClass === "string" ? e.evidenceClass : null,
          consumedElsewhere:
            typeof e?.consumedElsewhere === "string" ? sanitize(e.consumedElsewhere) : null,
        }))
      : [],
    summary: typeof r.fundamentalSummary === "string" ? sanitize(r.fundamentalSummary) : null,
  };

  const unified = {
    present: Boolean(ui),
    available: ui?.available === true,
    state: ui?.state ?? null,
    agreement: ui?.confluence?.agreement ?? null,
    confluenceReason: ui?.confluence?.reason ? sanitize(ui.confluence.reason) : null,
    confidence: ui?.confidence ?? null,
    actionable: ui?.actionable === true,
    actionabilityReason: ui?.actionabilityReason ? sanitize(ui.actionabilityReason) : null,
    limitations: Array.isArray(ui?.limitations) ? ui.limitations.map(sanitize) : [],
  };

  // Provenance, in the shape this codebase actually carries it: every evidence
  // item names its provider and its own observation instant, and each attached
  // domain context states its source, when it was fetched and how fresh it is.
  // Nothing here is inferred — a context that is absent stays null.
  const contextOf = (context) =>
    context && typeof context === "object"
      ? {
          available: context.available === true,
          source: typeof context.source === "string" ? context.source : null,
          // When the deployment fetched it (its own clock), distinct from the
          // period the data covers.
          fetchedAt: isNumber(context.fetchedAt) && context.fetchedAt > 0 ? context.fetchedAt : null,
          freshness: typeof context.freshness === "string" ? context.freshness : null,
        }
      : null;

  const provenance = {
    market: {
      provider: market.provider,
      providerInstrumentId: market.providerInstrumentId,
      source: market.source,
      observedAt: market.observedAt,
    },
    fundamental: {
      provider: fundamental.provider,
      instrumentId: fundamental.instrumentId,
      observedAt: fundamental.observedAt,
      reportingPeriod: fundamental.reportingPeriod,
      evidenceProviders: fundamental.evidenceProviders,
    },
    contexts: {
      treasury: contextOf(r.treasuryContext),
      cot: contextOf(r.cotContext),
      eia: contextOf(r.eiaContext),
      derivatives: r.derivativesData
        ? {
            available: true,
            observedAt:
              isNumber(r.derivativesData.timestamp) && r.derivativesData.timestamp > 0
                ? r.derivativesData.timestamp
                : null,
          }
        : null,
    },
  };

  // Phase 288 — the runtime's own per-leg records. Each acquisition leg reports
  // what it tried and, when it produced nothing, WHY (its classified failure
  // text). Without this the smoke could only repeat a summary sentence, and a
  // rate limit, a missing credential, an unmapped provider identity and an
  // empty provider series were indistinguishable in the verdict.
  const diagnostics = Array.isArray(r.providerDiagnostics)
    ? r.providerDiagnostics
        .map((d) => ({
          provider: typeof d?.provider === "string" ? d.provider : null,
          dataset: typeof d?.dataset === "string" ? d.dataset : null,
          mode: typeof d?.mode === "string" ? d.mode : null,
          acquired: d?.acquired === true,
          attached: d?.attached === true,
          usedByEngine: d?.usedByEngine === true,
          // Phase 289D — the provider's OWN acquisition instant, copied only
          // when the runtime recorded a finite number. Never derived here, and
          // never re-timed: an absent instant stays null.
          observedAt: isNumber(d?.observedAt) ? d.observedAt : null,
          reason: typeof d?.reason === "string" ? sanitize(d.reason) : null,
        }))
        .filter((d) => d.provider !== null)
    : [];

  return {
    market,
    technical,
    fundamental,
    unified,
    provenance,
    diagnostics,
    dataCompleteness: typeof r.dataCompleteness === "string" ? r.dataCompleteness : null,
    recommendation: typeof r.recommendation === "string" ? r.recommendation : null,
  };
}

/**
 * The failing legs of one analysis, as one bounded line.
 *
 * Only legs that produced no evidence AND carried their own reason appear, so
 * the text is the leg's diagnosis — never a restatement of the headline.
 */
/** Headline reason plus the failing legs' own diagnoses (bounded). */
export function withFailingLegs(headline, evidence) {
  const legs = failingLegText(evidence);
  return legs === null ? headline : `${headline} — failing legs: ${legs}`;
}

export function failingLegText(evidence, limit = 3) {
  const legs = Array.isArray(evidence?.diagnostics) ? evidence.diagnostics : [];
  const named = legs
    .filter((d) => d.acquired !== true && typeof d.reason === "string" && d.reason.length > 0)
    .slice(0, Math.max(1, limit))
    .map((d) => `${d.provider}/${d.dataset ?? "?"}: ${d.reason}`);
  return named.length > 0 ? named.join("; ") : null;
}

/**
 * Phase 289 — ONE bounded line carrying the runtime's OWN evidence shape for a
 * domain.
 *
 * Why this exists: the smoke's artifact and the runner log are the primary
 * evidence, but neither is always reachable (artifact download and job logs can
 * both be egress-restricted in a given environment, while check-run annotations
 * are not). Without a digest, a run that PASSed left nothing readable, and the
 * Phase-288 diagnostics — which dimension the deployment actually delivered,
 * what the engine's domain-native text said, and whether a leg was acquired and
 * then deliberately not consumed — could only be seen in the artifact.
 *
 * Everything here is copied from the runtime's own result: dimension names with
 * their status, the engine's fundamental text, each leg's own flags with its
 * classified reason, and the provider's discovery report. Nothing is inferred,
 * nothing is repaired, and an absent section is absent rather than summarised.
 * Returns null when the record carries nothing to report.
 */
export function evidenceDigest(record) {
  const clip = (text, max) => {
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
  };
  if (!record || typeof record !== "object") return null;
  const parts = [];

  const fundamental = record.evidence?.fundamental;
  // Phase 306 — the forex released-measurement pipeline travels with the
  // digest when the fundamental is NOT available: the run PROVES where the
  // chain stopped (provider rows -> released+actual -> side matches -> reads).
  const pipeline =
    fundamental && fundamental.available !== true ? fundamental.measurementPipeline : null;
  if (pipeline && typeof pipeline === "object") {
    const a = pipeline.acquisition ?? {};
    parts.push(
      clip(
        `pipeline[events=${pipeline.eventsReceived} releasedWithActual=${pipeline.releasedWithActual} ` +
          `base=${pipeline.baseReleasedMatched} quote=${pipeline.quoteReleasedMatched} ` +
          `policy=${pipeline.policyRatesBase ? "base" : "-"}/${pipeline.policyRatesQuote ? "quote" : "-"} ` +
          `inflation=${pipeline.inflationBase ? "base" : "-"}/${pipeline.inflationQuote ? "quote" : "-"} ` +
          `acq=[lookback=${a.lookbackDays ?? "?"}d upcoming=${a.upcomingFetched ?? "?"} past=${a.pastFetched ?? "?"} withActual=${a.pastWithActual ?? "?"} merged=${a.merged ?? "?"} leg=${a.pastLeg ?? "?"}] ` +
          `-> available=${pipeline.availability}]`,
        320,
      ),
    );
  }
  if (fundamental && (fundamental.present === true || fundamental.available === true)) {
    const dims = (Array.isArray(fundamental.dimensions) ? fundamental.dimensions : [])
      .filter((d) => d && (d.name !== null || d.status !== null))
      .map((d) => `${d.name ?? "?"}=${d.status ?? "?"}`)
      .join(",");
    parts.push(
      clip(
        `fundamental[domain=${fundamental.domain ?? "?"} state=${fundamental.state ?? "?"} provider=${
          fundamental.provider ?? "?"
        }${dims ? ` dims=${dims}` : ""}]`,
        240,
      ),
    );
    if (typeof fundamental.summary === "string" && fundamental.summary.length > 0) {
      parts.push(clip(`engine[${fundamental.summary}]`, 200));
    }
  }

  const diagnostics = Array.isArray(record.evidence?.diagnostics)
    ? record.evidence.diagnostics
    : [];
  const legs = diagnostics
    .filter((d) => d && typeof d.reason === "string" && d.reason.length > 0)
    .slice(0, 2)
    .map(
      (d) =>
        `${d.provider ?? "?"}/${d.dataset ?? "?"} acquired=${d.acquired === true} attached=${
          d.attached === true
        } used=${d.usedByEngine === true}: ${clip(d.reason, 120)}`,
    );
  if (legs.length > 0) parts.push(clip(`legs[${legs.join(" | ")}]`, 300));

  const discovery = record.discovery;
  if (discovery && typeof discovery === "object") {
    const catalogs = Array.isArray(discovery.catalogs) ? discovery.catalogs : [];
    const incomplete = catalogs.filter(
      (c) => c && typeof c.completeness === "string" && c.completeness !== "COMPLETE",
    );
    const detail = [
      `completeness=${discovery.completeness ?? "?"}`,
      `pages=${discovery.pagesFetched ?? "?"}`,
      `kept=${discovery.totalDiscovered ?? "?"}`,
      `catalogs=${catalogs.length}`,
      `incomplete=${incomplete.length}`,
      incomplete.length > 0
        ? `first=${incomplete[0].path ?? "?"}:${incomplete[0].completeness}`
        : null,
      Array.isArray(discovery.warnings) && discovery.warnings.length > 0
        ? `warning=${clip(discovery.warnings[0], 130)}`
        : null,
    ]
      .filter((piece) => piece !== null)
      .join(" ");
    parts.push(clip(`discovery[${detail}]`, 260));
  }

  if (parts.length === 0) return null;
  return clip(parts.join(" · "), 900);
}

/**
 * Phase 289B — the deployed runtime's own market classification for a commodity
 * instrument, plus whether it consumed petroleum physical evidence for it.
 *
 * Every field is copied from the runtime's answer. `group` and
 * `classificationSource` are the resolution the Phase-288 feed-scope gate reads
 * BEFORE any EIA/WPSR series may back the `inventories` dimension;
 * `inventoryLatest` and `eiaEvidenceItems` are the observable result of that
 * decision — evidence present means the feed was consumed for THIS instrument.
 */
export function commodityMarketOf(evidence) {
  const fundamental = evidence?.fundamental ?? null;
  const dimensions = Array.isArray(fundamental?.dimensions) ? fundamental.dimensions : [];
  const inventories = dimensions.find((d) => d && d.name === "inventories") ?? null;
  const providers = Array.isArray(fundamental?.evidenceProviders) ? fundamental.evidenceProviders : [];
  const diagnostics = Array.isArray(evidence?.diagnostics) ? evidence.diagnostics : [];
  const texts = [
    ...(Array.isArray(fundamental?.limitations) ? fundamental.limitations : []),
    fundamental?.summary,
    ...diagnostics.map((d) => d?.reason),
  ].filter((t) => typeof t === "string");

  const eia = eiaLegRecord(evidence);
  const eiaEvidence = eiaEvidenceRecord(evidence);

  return {
    group: fundamental?.commodityProfile?.group ?? null,
    classificationSource: fundamental?.commodityProfile?.classificationSource ?? null,
    inventories: inventories?.status ?? null,
    inventoryLatest:
      fundamental?.commodityMetrics && typeof fundamental.commodityMetrics.inventoryLatest === "number"
        ? fundamental.commodityMetrics.inventoryLatest
        : null,
    // Phase 289F — the metric counts CANONICAL EIA evidence items and nothing
    // else; `eiaEvidenceState` says whether it agrees with the leg's own state.
    eiaEvidenceItems: eiaEvidence.items,
    eiaEvidenceState: eiaEvidence.state,
    eiaEvidenceDetail: eiaEvidence.detail,
    eiaEvidenceMetrics: eiaEvidence.metrics,
    // The gate's own sentence. Only the Phase-288 revision produces it, so its
    // presence (or absence) is also part of the code-path fingerprint.
    petroleumFeedScopeText: texts.some((t) => /out of scope for this/i.test(t)),
    // Phase 289D — the EIA leg's own state and its own classified reason, so a
    // sample can never leave the decisive question unanswered again.
    eiaLegState: eia.state,
    eiaLeg: eiaLegDigest(evidence),
  };
}

/**
 * Phase 289D — the EIA leg's own record, as the runtime reported it.
 *
 * WHY: the energy gate could only say `eiaEvidence=0`. The per-leg diagnostics
 * existed on the result, but the failing-leg line is bounded to three legs, so
 * the EIA leg was hidden behind the market-data / news / derivatives failures
 * that always precede it — a missing credential, a rejected credential, a rate
 * limit, a provider/transport fault and an empty dataset all looked identical
 * from outside. This reads the leg's OWN flags and its OWN classified reason.
 *
 * It asserts NOTHING about HTTP status: a leg is only "consumed" when the
 * runtime itself attached the payload AND the engine recorded that it used it.
 * A 200 that produced no observation is `no-evidence` with its reason, never a
 * success. No timestamp is derived: `observedAt` is passed through verbatim.
 */
export function eiaLegRecord(evidence) {
  const diagnostics = Array.isArray(evidence?.diagnostics) ? evidence.diagnostics : null;
  if (diagnostics === null) return { present: false, state: "not-reported", leg: null };
  const leg = diagnostics.find((d) => d && d.provider === "eia") ?? null;
  if (leg === null) return { present: false, state: "not-scheduled", leg: null };
  const state =
    leg.attached === true && leg.usedByEngine === true
      ? "consumed"
      : leg.attached === true
        ? "attached-not-used"
        : leg.acquired === true
          ? "acquired-not-attached"
          : "no-evidence";
  return { present: true, state, leg };
}

/**
 * Phase 289F — WHAT `eiaEvidence` IS SUPPOSED TO MEAN.
 *
 * The canonical EIA provider identity, exactly as the runtime writes it on the
 * evidence items it derived from the EIA/ WPSR payload (`provider`) and exactly
 * as `providerDiagnostics` names the leg (`provider: "eia"`). Identity is
 * matched, never a loose keyword: a provider that merely MENTIONS the agency in
 * its source text is not EIA evidence.
 */
export const EIA_PROVIDER_ID = "eia";
export const EIA_PROVIDER_SOURCE_NAME = "U.S. Energy Information Administration";

export function isEiaProviderIdentity(provider) {
  if (typeof provider !== "string") return false;
  const text = provider.trim();
  if (text === "") return false;
  if (text.toLowerCase() === EIA_PROVIDER_ID) return true;
  // The canonical provider name EXACTLY as the commodity adapter writes it on
  // the evidence items it derived from the EIA payload. A provider that merely
  // resembles the agency (a mirror, an aggregator, the name with a suffix bolted
  // onto it) is not EIA evidence and can never raise the metric.
  return text === EIA_PROVIDER_SOURCE_NAME;
}

/**
 * The EIA evidence metric and its agreement with the leg's own state.
 *
 * `items` counts the CANONICAL evidence items of the assessment whose provider
 * identity is EIA — nothing else can raise it: not an HTTP 200, not the leg
 * record, not a provider list, not a string that mentions the agency. The leg
 * state (from `providerDiagnostics`) must AGREE with it:
 *
 *   consistent-consumed     the leg was consumed AND its evidence items are attached
 *   consistent-not-consumed the leg produced nothing AND no item is attached
 *   inconsistent            the two surfaces disagree — named explicitly, so a
 *                           consumed leg with no evidence (or evidence with no
 *                           consumption) is a visible contradiction rather than
 *                           a silent zero or a silent pass.
 */
export function eiaEvidenceRecord(evidence) {
  const fundamental = evidence?.fundamental ?? null;
  // The raw assessment carries its canonical items on `evidence`; the smoke's
  // bounded projection carries the same items (sampled) as `evidenceItems`.
  const rawItems = Array.isArray(fundamental?.evidence) ? fundamental.evidence : [];
  const items = Array.isArray(fundamental?.evidenceItems) ? fundamental.evidenceItems : rawItems;
  const eiaItems = items.filter((item) => isEiaProviderIdentity(item?.provider));
  // The normalizer counts the EIA items over the whole canonical array; the
  // sample above is only for display. Fall back to the sample for a caller that
  // hands over a raw assessment (e.g. a unit test).
  const eiaCount = isNumber(fundamental?.eiaEvidenceItemCount)
    ? fundamental.eiaEvidenceItemCount
    : eiaItems.length;
  const eiaMetrics =
    Array.isArray(fundamental?.eiaEvidenceMetrics) && fundamental.eiaEvidenceMetrics.length > 0
      ? fundamental.eiaEvidenceMetrics
      : eiaItems.map((item) => item?.metric);
  const totalItems = isNumber(fundamental?.evidenceItemCount)
    ? fundamental.evidenceItemCount
    : rawItems.length > 0
      ? rawItems.length
      : items.length;
  const leg = eiaLegRecord(evidence);
  const consumed = leg.state === "consumed";
  const present = eiaCount > 0;
  const state = present === consumed ? (consumed ? "consistent-consumed" : "consistent-not-consumed") : "inconsistent";
  let detail = null;
  if (state === "inconsistent" && consumed) {
    detail = `the eia leg was consumed but the assessment carries no eia evidence item (evidenceItems=${totalItems})`;
  } else if (state === "inconsistent") {
    detail = `the assessment carries ${eiaCount} eia evidence item(s) while the eia leg is ${leg.state}`;
  }
  return {
    items: eiaCount,
    metrics: [...new Set(eiaMetrics.filter((m) => typeof m === "string"))].slice(0, 6),
    providers: [...new Set(items.map((item) => item?.provider).filter((p) => typeof p === "string"))].slice(0, 8),
    legState: leg.state,
    state,
    detail,
  };
}

/** The same record as ONE bounded, credential-redacted line. */
export function eiaLegDigest(evidence) {
  const { present, state, leg } = eiaLegRecord(evidence);
  const bits = [`eia-leg: ${state}`];
  if (present && leg) {
    if (typeof leg.dataset === "string" && leg.dataset.length > 0) bits.push(`dataset=${leg.dataset}`);
    if (typeof leg.mode === "string" && leg.mode.length > 0) bits.push(`mode=${leg.mode}`);
    bits.push(`observedAt=${isNumber(leg.observedAt) ? leg.observedAt : "none"}`);
    bits.push(
      `reason=${
        typeof leg.reason === "string" && leg.reason.length > 0 ? sanitize(leg.reason) : "none"
      }`,
    );
  } else if (state === "not-scheduled") {
    bits.push("reason=no eia leg in providerDiagnostics (the eligibility predicate did not fire)");
  } else {
    bits.push("reason=the result carried no provider-diagnostics array");
  }
  return sanitize(bits.join(" \u00b7 "));
}

/**
 * Phase 289D — the deployed `eia:fetchEiaInventory` action's OWN envelope.
 *
 * A direct, read-only probe of the runtime branch (missing key / AUTH_ERROR /
 * RATE_LIMIT / provider fault / empty dataset / success) that does not depend on
 * the analysis pipeline reaching the leg. Values are copied from the envelope:
 * `success` is the action's own flag — never an HTTP status — and an observation
 * period is reported only verbatim from the provider's series. Credential-free.
 */
export function eiaActionEnvelope(response) {
  if (!response || response.ok !== true) {
    return {
      answered: false,
      reason: sanitize(response?.appError ?? response?.transportError ?? "request failed"),
      success: null,
      errorCode: null,
      error: null,
      acquisition: null,
      observedAt: null,
      seriesCount: null,
      observationDates: [],
    };
  }
  const value = response.value ?? {};
  const data = value?.data ?? null;
  const series = Array.isArray(data?.series) ? data.series : [];
  return {
    answered: true,
    reason: null,
    success: value.success === true,
    errorCode: typeof value.errorCode === "string" ? value.errorCode : null,
    error: typeof value.error === "string" ? sanitize(value.error) : null,
    acquisition: typeof value.acquisition === "string" ? value.acquisition : null,
    observedAt: isNumber(value.observedAt) ? value.observedAt : null,
    seriesCount: Array.isArray(data?.series) ? series.length : null,
    observationDates: series
      .map((s) => (typeof s?.observationDate === "string" ? s.observationDate : null))
      .filter((d) => typeof d === "string"),
  };
}

/** One bounded line for the envelope above. */
export function eiaActionProbeDigest(probe) {
  if (!probe) return null;
  if (probe.answered !== true) return sanitize(`eia-action: unanswered · reason=${probe.reason}`);
  const bits = [`eia-action: ${probe.success === true ? "success" : "no-evidence"}`];
  if (probe.errorCode) bits.push(`errorCode=${probe.errorCode}`);
  if (probe.acquisition) bits.push(`acquisition=${probe.acquisition}`);
  bits.push(`observedAt=${isNumber(probe.observedAt) ? probe.observedAt : "none"}`);
  bits.push(`seriesCount=${probe.seriesCount ?? "none"}`);
  if (probe.observationDates.length > 0) bits.push(`periods=${probe.observationDates.join(",")}`);
  bits.push(`error=${probe.error ?? "none"}`);
  return sanitize(bits.join(" \u00b7 "));
}

/**
 * Phase 289B — which backend code paths answered, read from the response itself.
 *
 * `/version` cannot answer this (it is the running Convex backend version, a
 * deployment health signal, not this application's bundle), so the fingerprint
 * is behavioural: the result-level `providerDiagnostics` with per-leg reasons,
 * the calendar mapping-gap honesty text, and the commodity feed-scope text all
 * exist ONLY in the Phase-288 revisions of the deployed functions. Absent is
 * reported absent — the smoke never assumes a revision answered.
 */
export function runtimeMarkers(evidence) {
  const diagnostics = Array.isArray(evidence?.diagnostics) ? evidence.diagnostics : [];
  const withReason = diagnostics.filter((d) => d && typeof d.reason === "string" && d.reason.length > 0);
  const market = commodityMarketOf(evidence);
  const limitations = Array.isArray(evidence?.fundamental?.limitations)
    ? evidence.fundamental.limitations
    : [];
  const calendarGap =
    withReason.some((d) => /no calendar request was made/i.test(d.reason)) ||
    limitations.some((t) => typeof t === "string" && /no calendar request was made/i.test(t));
  return {
    diagnostics: diagnostics.length,
    diagnosticsWithReason: withReason.length,
    commodityGroup: market.group,
    commodityInventories: market.inventories,
    commodityInventoryLatest: market.inventoryLatest,
    eiaEvidenceItems: market.eiaEvidenceItems,
    eiaLegState: market.eiaLegState,
    petroleumFeedScopeObserved: market.petroleumFeedScopeText,
    calendarMappingGapObserved: calendarGap,
  };
}

/**
 * Phase 289C-audit — how many provider-native commodity candidates the probe may
 * classify, in the provider's own order.
 *
 * Raised from 6 to 12 after the audit established WHY the probe could not reach an
 * energy instrument: the provider's commodity catalog carries ~31 identities whose
 * first three are gold-gram pairs (GAU/*), while its energy instruments (WTI,
 * Brent, Urals crude) sit further down. 12 is a scan DEPTH, not a whitelist: the
 * order is whatever the provider returned, nothing is added or substituted, and a
 * caller may raise it (to ENERGY_PROBE_MAX_CANDIDATE_LIMIT) when the previous
 * run's discovered-identity list shows where the energy instruments sit.
 */
export const ENERGY_PROBE_CANDIDATE_LIMIT = 12;

/** Phase 289C-audit — the hard bound on that scan depth. */
export const ENERGY_PROBE_MAX_CANDIDATE_LIMIT = 40;

/** Phase 289C-audit — how many discovered identities the annotation lists. */
export const ENERGY_PROBE_REPORT_IDENTITIES = 10;

/**
 * Phase 289B — pause between probe analyses. The probe must not be the reason a
 * provider hits its per-minute ceiling; the wait keeps the classifications inside
 * the same rate-limit window the four-asset run already lives in. The value is set
 * from the provider's OWN refusal, observed on the deployment: "10 API credits were
 * used, with the current limit being 8" per minute — so a deeper scan without a
 * pause would spend its budget on 429s instead of classifications, and a 429 opens
 * the circuit, which would end the scan before it reached an energy instrument.
 */
export const ENERGY_PROBE_PAUSE_MS = 8_000;

/**
 * Phase 289B — the verdict for the commodity energy-gate probe.
 *
 * Two opposite failures are possible and both are contradictions rather than
 * missing data: a non-energy instrument carrying petroleum evidence (the
 * cross-domain read the gate exists to prevent), and an energy instrument being
 * denied its own petroleum feed (the false negative the base-leg market
 * resolution exists to prevent). Either is FAIL, named with the instrument.
 *
 * PASS requires BOTH directions proven with real readings: an energy-classified
 * instrument that consumed petroleum evidence, and a non-energy-classified
 * instrument that received none. Anything less is UNAVAILABLE with the exact
 * reason — never a pass, and never a claim about an instrument that was not
 * actually classified by the deployment.
 */
export function energyGateVerdict(samples) {
  const list = Array.isArray(samples) ? samples.filter((s) => s && typeof s === "object") : [];
  const classified = list.filter((s) => typeof s.group === "string");
  const energy = classified.filter((s) => s.group === "energy");
  const other = classified.filter((s) => s.group !== "energy");
  const consumed = (s) =>
    (typeof s.inventories === "string" && s.inventories !== "unavailable") ||
    (typeof s.inventoryLatest === "number" && s.inventoryLatest > 0);
  const describe = (s) =>
    `${s.instrument ?? "?"}[group=${s.group ?? "?"} inventories=${s.inventories ?? "?"} inventoryLatest=${
      s.inventoryLatest ?? "none"
    } eiaEvidence=${s.eiaEvidenceItems ?? 0}${
      typeof s.eiaEvidenceState === "string" ? `/${s.eiaEvidenceState}` : ""
    } eiaLeg=${s.eiaLegState ?? "not-reported"}]`;

  const failures = [];
  for (const s of other) {
    const carriesPetroleum =
      s.inventoryLatest !== null ||
      (typeof s.eiaEvidenceItems === "number" && s.eiaEvidenceItems > 0) ||
      (typeof s.inventories === "string" && s.inventories !== "unavailable") ||
      s.eiaEvidenceState === "inconsistent";
    if (carriesPetroleum) {
      failures.push(
        `${describe(s)} resolves to the ${s.group} market yet carries petroleum physical evidence — another market's inventory was attributed to it`,
      );
    }
  }
  for (const s of energy) {
    if (s.petroleumFeedScopeText === true) {
      failures.push(
        `${s.instrument ?? "?"} resolves to the energy market yet its own petroleum feed was withheld as out of scope`,
      );
    }
  }
  if (failures.length > 0) {
    return {
      verdict: "FAIL",
      summary: `contradiction: ${failures.join("; ")}`,
      control: other[0] ?? null,
      energy: energy[0] ?? null,
      failures,
    };
  }
  if (energy.length === 0) {
    // If nothing could be classified at all, say WHY from the runtime's own
    // reason rather than leaving "no energy candidate" to stand alone.
    const unexplained = list.find(
      (s) => typeof s.group !== "string" && typeof s.reason === "string" && s.reason.length > 0,
    );
    return {
      verdict: "UNAVAILABLE",
      summary: `no provider-native candidate resolved to the energy market among the ${classified.length} instrument(s) the deployed runtime classified${
        unexplained
          ? `; ${unexplained.instrument ?? "an instrument"} could not be classified — ${unexplained.reason}`
          : ""
      } — the feed-scope rule could not be exercised in either direction`,
      control: other[0] ?? null,
      energy: null,
      failures,
    };
  }
  const energySample = energy.find(consumed) ?? energy[0];
  if (!consumed(energySample)) {
    return {
      verdict: "UNAVAILABLE",
      summary: `the energy market resolved (${describe(energySample)}) but the deployment delivered no petroleum inventory reading — ${
        energySample.reason ?? "no reason returned"
      }`,
      control: other[0] ?? null,
      energy: energySample,
      failures,
    };
  }
  if (energySample.eiaEvidenceState === "inconsistent") {
    // Phase 289F — the EIA leg says it was consumed and the assessment's own
    // canonical evidence says otherwise (or the reverse). That disagreement is a
    // defect in the telemetry both surfaces exist to prove, so it FAILS the
    // probe: a consumed leg may never be reported while the evidence metric
    // stays at zero, and no metric may claim evidence the leg never consumed.
    const reason = `${describe(energySample)} — the EIA leg and the assessment's own evidence disagree: ${
      energySample.eiaEvidenceDetail ?? "no detail"
    }`;
    failures.push(reason);
    return {
      verdict: "FAIL",
      summary: `contradiction: ${reason}`,
      control: other[0] ?? null,
      energy: energySample,
      failures,
    };
  }
  if (other.length === 0) {
    return {
      verdict: "UNAVAILABLE",
      summary: `petroleum evidence was consumed by ${describe(energySample)}, but no non-energy instrument was classified in the same run, so the withholding direction is unproven`,
      control: null,
      energy: energySample,
      failures,
    };
  }
  return {
    verdict: "PASS",
    summary: `energy ${describe(energySample)} consumed its own petroleum feed, while ${describe(other[0])} received none (scope rule stated: ${
      other[0].petroleumFeedScopeText === true
    })`,
    control: other[0],
    energy: energySample,
    failures,
  };
}

/**
 * The verdict for one domain.
 *
 * PASS        real provider market evidence (with its own observation instant),
 *             available technical evidence, an available domain-native
 *             fundamental assessment, and unified intelligence. HTTP 200 is
 *             never sufficient on its own.
 * UNAVAILABLE the runtime honestly reported that evidence is missing, and said
 *             why (credential, rate limit, unsupported instrument, no data).
 *             The legs that WERE real are still reported, so a partial success
 *             is never hidden behind the headline.
 * FAIL        transport/contract defect — the runtime did not accept the
 *             request, refused to deliver, or returned an absence with no
 *             reason at all.
 */
export function classifyDomain({ response, transportError = null }) {
  const status = response?.status ?? null;
  const entitlement = response?.entitlement ?? null;

  if (transportError || response === null) {
    return {
      headline: "FAIL",
      reason: sanitize(`transport error: ${transportError ?? "no response from the deployment"}`),
      status,
    };
  }
  if (response.httpStatus && response.httpStatus !== 200) {
    return { headline: "FAIL", reason: sanitize(`HTTP ${response.httpStatus}`), status };
  }
  if (status === "UNAUTHENTICATED" || status === "INVALID_INPUT") {
    return {
      headline: "FAIL",
      reason: `runtime rejected the request: ${status} (the smoke sent the app's own request shape)`,
      status,
    };
  }
  if (status === "LOCKED") {
    return {
      headline: "FAIL",
      reason: sanitize(`runtime withheld the decision (LOCKED): ${entitlement?.reason ?? "no reason given"}`),
      status,
    };
  }
  if (status !== "DELIVERED") {
    return { headline: "FAIL", reason: sanitize(`unexpected runtime status: ${status ?? "none"}`), status };
  }

  const evidence = readResultEvidence(response.result);

  if (!evidence.market.present || evidence.market.observedAt === null) {
    const reason = firstReason(
      evidence.unified.limitations,
      evidence.unified.actionabilityReason,
      evidence.technical.summary,
      evidence.fundamental.summary,
    );
    if (!reason) {
      return {
        headline: "FAIL",
        reason: "no provider market evidence and the runtime gave no reason (silent absence)",
        status,
      };
    }
    return {
      headline: "UNAVAILABLE",
      reason: withFailingLegs(
        `no provider market evidence with a provider observation instant — runtime said: ${reason}`,
        evidence,
      ),
      status,
      evidence,
    };
  }

  if (!evidence.technical.available || !evidence.unified.present) {
    const reason = firstReason(evidence.unified.limitations, evidence.technical.summary);
    return {
      headline: "UNAVAILABLE",
      reason: withFailingLegs(
        `market evidence is real but technical/unified evidence is not available — ${reason ?? "no reason given"}`,
        evidence,
      ),
      status,
      evidence,
    };
  }

  if (!evidence.fundamental.available) {
    const reason = firstReason(
      evidence.fundamental.summary,
      evidence.unified.limitations,
      evidence.fundamental.state ? `fundamental state: ${evidence.fundamental.state}` : null,
    );
    return {
      headline: "UNAVAILABLE",
      reason: withFailingLegs(
        `market + technical + unified are real; the domain-native FUNDAMENTAL assessment is unavailable — ${reason ?? "no reason given"}`,
        evidence,
      ),
      status,
      evidence,
    };
  }

  return {
    headline: "PASS",
    reason: "provider market evidence with a provider observation instant, technical, domain-native fundamental and unified intelligence all present",
    status,
    evidence,
  };
}

/**
 * Phase 288 — verdict severity, so a domain's verdict cannot be laundered.
 *
 * With more than one candidate per domain, the loop's LAST attempt used to be
 * the recorded verdict. A deployment FAIL (transport error, rejected request)
 * on the first candidate and a milder UNAVAILABLE on the second therefore
 * reported "provider unavailable" for what was actually a runtime failure.
 * The most severe outcome of the domain's attempts is reported; evidence still
 * wins because the loop stops the moment a candidate produces market evidence.
 */
const VERDICT_SEVERITY = { PASS: 0, UNAVAILABLE: 1, FAIL: 2 };

export function mostSevereVerdict(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  return (VERDICT_SEVERITY[candidate.headline] ?? 2) > (VERDICT_SEVERITY[current.headline] ?? 2)
    ? candidate
    : current;
}

/* ------------------------------------------------------------------ *
 * Rate-limit discipline — a rate limit stops REPEATS, not the run
 * ------------------------------------------------------------------ */

const RATE_LIMIT_RE = /\b429\b|rate.?limit|RATE_LIMITED|too many requests/i;
/**
 * Phase 289B — the leg that carries a MARKET PROVIDER's own transport answer
 * (its 429, its credential rejection). Named by dataset/provider rather than by
 * a ticker or an exchange, so any provider routed through the same transport is
 * covered.
 */
const MARKET_TRANSPORT_LEG_RE = /market-data|ohlcv|fx-rate|instrument-spec/i;
const CREDENTIAL_RE = /credential|api[_ -]?key|not configured|unauthoriz|forbidden|\b401\b|\b403\b/i;

/**
 * Phase 285 STEP 4: on a rate limit, stop making REPEATED requests to that
 * provider. Every domain still receives exactly one analysis request of its
 * own (each is a distinct user-equivalent request, which is the point of the
 * smoke); what a tripped provider loses is any retry, any second candidate and
 * any probe.
 */
export function createProviderCircuit() {
  const tripped = new Map();
  return {
    trip(provider, reason, kind) {
      if (provider && !tripped.has(provider)) tripped.set(provider, { reason: sanitize(reason), kind });
    },
    isTripped(provider) {
      return tripped.get(provider) ?? null;
    },
    snapshot() {
      return Object.fromEntries([...tripped.entries()]);
    },
    classify(provider, text, legs = []) {
      if (!provider) return null;
      // Phase 289B — attribute the failure to the provider that reported it.
      //
      // The circuit exists to stop REPEATED requests to a provider that refused
      // on capacity or credentials, and the text it used to receive was the
      // verdict's own aggregated reason — which quotes EVERY failing leg. That
      // mis-attributed one provider's refusal to another and suppressed requests
      // to providers that had refused nothing: a crypto verdict quoting
      // "CoinGlass not configured: COINGLASS_API_KEY is missing" opened the okx
      // circuit, and a twelve-data verdict quoting "Tokenomist ... HTTP 401"
      // opened the twelve-data circuit (reproduced against the stubbed runtime in
      // the CLI test). A failure now trips only when either
      //   · `text` is the transport's own error for this call, or
      //   · a leg that is THIS provider's (or the market-data transport leg, which
      //     carries the market provider's own capacity response) reported it.
      const own = (Array.isArray(legs) ? legs : [])
        .filter((leg) => leg && leg.acquired !== true)
        .filter(
          (leg) =>
            leg.provider === provider ||
            MARKET_TRANSPORT_LEG_RE.test(`${leg.provider ?? ""} ${leg.dataset ?? ""}`),
        )
        .map((leg) => leg.reason ?? "")
        .join(" ");
      const attributable = `${text ?? ""} ${own}`;
      if (RATE_LIMIT_RE.test(attributable)) {
        this.trip(provider, `rate limited: ${sanitize(attributable)}`, "RATE_LIMITED");
        return "RATE_LIMITED";
      }
      if (CREDENTIAL_RE.test(attributable)) {
        this.trip(provider, `credentials: ${sanitize(attributable)}`, "CREDENTIAL_REQUIRED");
        return "CREDENTIAL_REQUIRED";
      }
      return null;
    },
  };
}

/* ------------------------------------------------------------------ *
 * GitHub Actions reporting — one line per domain, escaped
 * ------------------------------------------------------------------ */

export function escapeAnnotation(text) {
  return String(text ?? "")
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .slice(0, 900);
}

function annotate(level, title, message) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const clean = String(message ?? "").replace(/[\r\n]+/g, " ");
  console.log(`::${level} title=${escapeAnnotation(title)}::${escapeAnnotation(clean)}`);
}

/* ------------------------------------------------------------------ *
 * Summary rendering
 * ------------------------------------------------------------------ */

export function renderSummary(report) {
  const lines = [];
  lines.push("──────────────────────────────────────────────────────────────────");
  lines.push("DEVELOPMENT RUNTIME SMOKE — real deployed runtime, real providers");
  lines.push(`target        : ${report.target.origin}`);
  lines.push(
    `deployed build: ${report.target.version ?? "unknown (no /version answer)"} (running Convex backend version — NOT the function-bundle revision)`,
  );
  lines.push(
    `harness commit: ${report.source.harnessCommit ?? "unknown"} (${report.source.harnessCommitSource})`,
  );
  lines.push(`dispatch ref  : ${report.source.dispatchRefSha ?? "unknown"}`);
  lines.push(
    `policy        : no stubs · no fixtures · no localhost · client evidence sent: ${report.policy.clientEvidenceSent} · one session per domain`,
  );
  lines.push("──────────────────────────────────────────────────────────────────");
  for (const record of report.domains) {
    lines.push(`${record.label.padEnd(10)} = ${record.headline}`);
    lines.push(`  provider         : ${record.provider ?? "—"}`);
    lines.push(`  native instrument: ${record.providerInstrumentId ?? "—"}`);
    lines.push(`  observation      : ${record.observedAt ? `${record.observedAt} (provider)` : "— none returned"}`);
    lines.push(`  completeness     : ${record.dataCompleteness ?? "—"}`);
    lines.push(`  market data      : ${record.legs.market}`);
    lines.push(`  technical        : ${record.legs.technical}`);
    lines.push(`  fundamental      : ${record.legs.fundamental}`);
    lines.push(`  unified          : ${record.legs.unified}`);
    if (record.reason) lines.push(`  reason           : ${record.reason}`);
    if (record.discovery) {
      const c = record.discovery;
      lines.push(
        `  discovery        : completeness=${c.completeness ?? "—"} pages=${c.pagesFetched ?? "—"} kept=${c.totalDiscovered ?? "—"}`,
      );
      for (const cat of c.catalogs ?? []) {
        lines.push(
          `                     ${cat.path ?? "?"} [${cat.assetClass ?? "?"}] ${cat.completeness ?? "?"}${
            cat.failedPage !== null ? ` failed page ${cat.failedPage}` : ""
          }`,
        );
      }
      for (const w of (c.warnings ?? []).slice(0, 3)) lines.push(`                     warning: ${w}`);
    }
    if (Array.isArray(record.failingLegs) && record.failingLegs.length > 0) {
      for (const leg of record.failingLegs.slice(0, 5)) lines.push(`  failing leg      : ${leg}`);
    }
    lines.push("");
  }
  if (report.energyGateProbe) {
    lines.push(
      `energy gate   : ${report.energyGateProbe.verdict} — ${report.energyGateProbe.summary}`,
    );
    for (const sample of report.energyGateProbe.samples) {
      lines.push(
        `                classified #${sample.position ?? "?"} ${sample.instrument ?? "?"} · group=${
          sample.group ?? "?"
        } · inventories=${sample.inventories ?? "?"} · inventoryLatest=${
          sample.inventoryLatest ?? "none"
        } · eiaEvidence=${sample.eiaEvidenceItems ?? 0}${
          typeof sample.eiaEvidenceState === "string" ? ` (${sample.eiaEvidenceState})` : ""
        }`,
      );
    }
    if (report.energyGateProbe.candidatesConsidered?.length > 0) {
      lines.push(
        `                scanned ${report.energyGateProbe.candidatesConsidered.length} of the provider's own order: ${report.energyGateProbe.candidatesConsidered.join(", ")}`,
      );
    }
    if (report.energyGateProbe.stopReason) lines.push(`                stopped: ${report.energyGateProbe.stopReason}`);
    // Phase 289D — the decisive line, printed even when the annotation is long.
    if (report.energyGateProbe.eiaLeg) {
      lines.push(`  eia leg       : ${report.energyGateProbe.eiaLeg}`);
    }
    if (report.discovery) {
      lines.push(`  discovery     : ${discoveryDigest(report.discovery) ?? "none"}`);
    }
    if (report.energyGateProbe.eiaActionProbe) {
      lines.push(
        `  eia action    : ${eiaActionProbeDigest(report.energyGateProbe.eiaActionProbe)}`,
      );
    }
  }
  if (report.pacing) {
    // Phase 289 quota-audit — the run's own pacing, stated as what it is: a LOCAL
    // schedule over the provider's minute windows, never the provider's counter.
    lines.push(
      `td pacing     : ${pacingSummary(report.pacing)}${
        report.pacing.enabled === true
          ? ` · provider minute window ${report.pacing.windowMs} ms · local model limit ${report.pacing.limit} credits`
          : ""
      }`,
    );
    for (const w of (report.pacing.waits ?? []).slice(0, 8)) {
      lines.push(`                waited ${w.waitedMs} ms before ${w.label ?? "a request"}`);
    }
    if (report.pacing.exhaustedReason) lines.push(`                ${report.pacing.exhaustedReason}`);
  }
  if (report.runtimeFingerprint) {
    lines.push(
      `code paths    : providerDiagnostics legs=${report.runtimeFingerprint.providerDiagnosticsLegs} (with reason: ${report.runtimeFingerprint.providerDiagnosticsWithReason}) · calendarMappingGap=${
        report.runtimeFingerprint.calendarMappingGapObserved ? "observed" : "not-observed"
      } · petroleumFeedScopeText=${
        report.runtimeFingerprint.petroleumFeedScopeObserved ? "observed" : "not-observed"
      }`,
    );
  }
  lines.push("──────────────────────────────────────────────────────────────────");
  for (const record of report.domains) lines.push(`${record.label} = ${record.headline}`);
  lines.push("──────────────────────────────────────────────────────────────────");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Phase 289 quota-audit - Twelve Data minute-window pacing
 * ------------------------------------------------------------------ */

/**
 * WHY (audited, not assumed - /home/user/phase289/RUN-289-QUOTA-AUDIT.md):
 *
 * `runProtectedAnalysis` issues NO catalog requests: discovery is the HARNESS's
 * own call (`marketData:discoverTwelveDataInstruments`), and because neither
 * production call site scopes the adapter (`options.assetClasses` exists but is
 * unused there) that call walks ALL FIVE catalogs. Every catalog request costs
 * 1 API credit, so a run spends ~6 credits before its first analysis. One Twelve
 * Data analysis can then fan out to 8 more (primary time_series + quote + the
 * MTF chain + the defensive DXY probe wave), while the plan the deployment's own
 * 429 names allows 8 credits per WALL-CLOCK MINUTE ("10 API credits were used,
 * with the current limit being 8"). The consequence: the request that follows
 * the run's own discovery can already be inside an exhausted minute, and the
 * provider's 429 then opens the circuit and stops the energy-gate probe BEFORE
 * it reaches the provider-native energy instrument (run 36164289791: `WTI/USD`
 * sat at provider position #7 and the scan died at #1).
 *
 * WHAT THIS IS: a SCHEDULING device. Identity, provider order, selection,
 * completeness, classification and the petroleum feed gate are untouched - the
 * pacer only decides WHEN a request may leave, and it waits for the provider's
 * next minute window when the local model says this one cannot serve it.
 *
 * WHAT THIS IS NOT: a claim about the provider's counter. The transports keep
 * `{ok, status, json}` only, so `api-credits-used`/`api-credits-left` are
 * discarded and the remaining count is NOT observable. The model is therefore
 * deliberately CONSERVATIVE: every analysis is charged the FULL worst-case
 * fan-out, so it can only over-estimate this run's spend. Over-estimating costs
 * wall-clock time; it never invents evidence and never claims a credit count to
 * a reader.
 *
 * THE CIRCUIT STAYS THE AUTHORITY: every caller checks `circuit.isTripped`
 * BEFORE the pacing gate, so a provider that really answered 429 is never waited
 * out, never retried, and the scan still ends with the provider's own reason.
 * Pacing only defers requests the provider has not refused, and only until the
 * next wall-clock minute.
 */

/** Twelve Data's documented data weight for catalogs, /time_series and /quote. */
export const TWELVE_DATA_CREDIT_PER_REQUEST = 1;

/**
 * The per-minute API-credit allowance of the plan this deployment's OWN 429 named
 * (`with the current limit being 8`) - the documented Basic plan. The provider
 * restores the full quota at each wall-clock minute boundary.
 */
export const TWELVE_DATA_MINUTE_CREDITS = 8;

/** One provider minute. Twelve Data resets on the wall-clock minute, not on a rolling 60s. */
export const TWELVE_DATA_WINDOW_MS = 60_000;

/**
 * Conservative worst-case credit fan-out of ONE Twelve Data analysis:
 *   /time_series primary              1   (src/convex/marketData.ts:457 -> :135)
 *   /quote (short TTL, one per attempt) 1  (:479-500)
 *   MTF chain for D1 (W1 + H4)         2   (src/lib/data/mtf.ts:26, :43-51)
 *   defensive DXY probe wave         <= 4  (:613-670; src/lib/market-context.ts:305)
 *                                     --
 *                                      8
 * A plan-restricted or invalid instrument returns after the FIRST request and
 * costs 1, so this over-charges those; that is the safe direction, because
 * under-charging is exactly what produces the 429 this exists to avoid.
 */
export const TWELVE_DATA_ANALYSIS_MAX_CREDITS = 8;

/** Default TOTAL pacing budget for one run (bounded; see PACING_MAX_WAIT_MS_CAP). */
export const PACING_DEFAULT_MAX_WAIT_MS = 15 * 60_000;
/** Hard cap on the configurable pacing budget. */
export const PACING_MAX_WAIT_MS_CAP = 25 * 60_000;
/** Hard cap on the configurable modelled per-minute allowance. */
export const PACING_LIMIT_CAP = 1_000;
/** Hard cap on the configurable window length. */
export const PACING_WINDOW_MS_CAP = 3_600_000;

/** A gate that applies to nothing (a provider other than Twelve Data, or pacing off). */
export const PACING_NOT_APPLIED = Object.freeze({
  waitedMs: 0,
  deferred: false,
  exhausted: false,
  windowStartAt: null,
});

/** The next wall-clock window boundary strictly after `nowMs`. */
export function nextTwelveDataWindowStart(nowMs, windowMs = TWELVE_DATA_WINDOW_MS) {
  const width = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : TWELVE_DATA_WINDOW_MS;
  return (Math.floor(nowMs / width) + 1) * width;
}

function boundedInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

/**
 * Pacing knobs: the CLI flag first, the environment second (the shape
 * `--probe-limit` already uses). Every value is bounded, and `windowMs 0` means
 * "pacing disabled" - used by spawned-process tests, and available to an operator
 * who deliberately wants the provider's own 429 to be the only governor. Nothing
 * here can raise the provider's allowance: the pacer never claims a credit count.
 */
export function resolvePacingConfig({ argv = [], env = {} } = {}) {
  const read = (flagName, envName) => flag(flagName, argv) ?? env[envName] ?? "";
  return {
    windowMs: boundedInt(
      read("--pacing-window-ms", "XSTARZ_SMOKE_PACING_WINDOW_MS"),
      TWELVE_DATA_WINDOW_MS,
      0,
      PACING_WINDOW_MS_CAP,
    ),
    limit: boundedInt(
      read("--pacing-limit", "XSTARZ_SMOKE_PACING_LIMIT"),
      TWELVE_DATA_MINUTE_CREDITS,
      1,
      PACING_LIMIT_CAP,
    ),
    maxTotalWaitMs: boundedInt(
      read("--pacing-max-wait-ms", "XSTARZ_SMOKE_PACING_MAX_WAIT_MS"),
      PACING_DEFAULT_MAX_WAIT_MS,
      0,
      PACING_MAX_WAIT_MS_CAP,
    ),
  };
}

/**
 * The run's OWN discovery spend, read from the provider's own catalog report -
 * not an assumption. It charges
 *   · every page that ANSWERED (`pagesFetched`), and
 *   · every attempted page the report does NOT count: a catalog whose first page
 *     never answered (a transport failure or a refusal - run 36164289791's
 *     `/stocks`), and a page whose failure sits beyond the answered count.
 * The provider counts attempted requests, so this can only be >= what happened.
 * Nothing reaches into the provider: it is arithmetic over the report the adapter
 * already publishes.
 */
export function discoveryCreditSpend(discovery) {
  const catalogs = Array.isArray(discovery?.catalogs) ? discovery.catalogs : [];
  const answeredTotal = isNumber(discovery?.pagesFetched) ? Math.max(0, Math.trunc(discovery.pagesFetched)) : 0;
  const uncounted = catalogs.filter((c) => {
    const answered = isNumber(c?.pagesFetched) ? Math.max(0, Math.trunc(c.pagesFetched)) : 0;
    if (answered <= 0) return true;
    return isNumber(c?.failedPage) && c.failedPage > answered;
  }).length;
  const requests = answeredTotal + uncounted;
  return requests > 0 ? requests * TWELVE_DATA_CREDIT_PER_REQUEST : TWELVE_DATA_CREDIT_PER_REQUEST;
}

/**
 * The local, conservative model of THIS RUN's Twelve Data spend over wall-clock
 * minute windows. It is a scheduler, not a meter: `modelledCredits` is what the
 * run cost as modelled HERE, and is never presented as the provider's counter.
 */
export function createTwelveDataQuotaPacer({
  limit = TWELVE_DATA_MINUTE_CREDITS,
  windowMs = TWELVE_DATA_WINDOW_MS,
  maxTotalWaitMs = PACING_DEFAULT_MAX_WAIT_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const enabled = windowMs > 0 && limit > 0 && maxTotalWaitMs > 0;
  const charges = [];
  const waits = [];
  let windowStartAt = enabled ? Math.floor(now() / windowMs) * windowMs : null;
  let modelledCredits = 0;
  let totalWaitMs = 0;
  let exhaustedReason = null;

  const advance = (at) => {
    if (!enabled) return;
    const current = Math.floor(at / windowMs) * windowMs;
    if (current !== windowStartAt) {
      windowStartAt = current;
      modelledCredits = 0;
    }
  };

  return {
    enabled,
    limit,
    windowMs,
    maxTotalWaitMs,

    /** Record spend the run has ALREADY incurred (the catalog walk, each analysis issued). */
    charge(credits, label = null) {
      if (!enabled) return 0;
      const modelled = Number.isFinite(credits) && credits > 0 ? Math.ceil(credits) : 0;
      if (modelled === 0) return 0;
      advance(now());
      modelledCredits += modelled;
      charges.push({ label, credits: modelled, windowStartAt });
      return modelled;
    },

    /**
     * Reserve room for the NEXT request. Waits for the provider's next window when
     * the current one cannot serve it; returns `exhausted` (and the caller issues
     * NOTHING) when the run's pacing budget cannot cover that wait. A single
     * request is never modelled as more than one whole window, so at most one
     * happens per window and no loop can spin.
     */
    async reserve({ cost = TWELVE_DATA_ANALYSIS_MAX_CREDITS, label = null } = {}) {
      if (!enabled) return { ...PACING_NOT_APPLIED };
      const modelled = Math.min(limit, Math.max(TWELVE_DATA_CREDIT_PER_REQUEST, Math.ceil(cost)));
      advance(now());
      if (modelledCredits + modelled <= limit) {
        modelledCredits += modelled;
        return { waitedMs: 0, deferred: false, exhausted: false, windowStartAt, modelledCredits: modelled };
      }
      if (exhaustedReason !== null) {
        return { waitedMs: 0, deferred: false, exhausted: true, reason: exhaustedReason, windowStartAt };
      }
      const at = now();
      const waitMs = Math.max(0, nextTwelveDataWindowStart(at, windowMs) - at);
      if (totalWaitMs + waitMs > maxTotalWaitMs) {
        exhaustedReason =
          `local pacing refused to wait ${waitMs} ms for the provider's next ${windowMs} ms window: ` +
          `the ${maxTotalWaitMs} ms pacing budget for this run is spent - no request was issued`;
        return { waitedMs: 0, deferred: false, exhausted: true, reason: exhaustedReason, windowStartAt };
      }
      await sleep(waitMs);
      advance(now());
      totalWaitMs += waitMs;
      waits.push({ label, waitedMs: waitMs, windowStartAt });
      modelledCredits = modelled;
      return { waitedMs: waitMs, deferred: true, exhausted: false, windowStartAt, modelledCredits: modelled };
    },

    snapshot() {
      return {
        enabled,
        windowMs,
        limit,
        maxTotalWaitMs,
        modelledCredits,
        windowStartAt,
        charges: [...charges],
        waits: [...waits],
        waitsCount: waits.length,
        totalWaitMs,
        exhaustedReason,
        model:
          "LOCAL, conservative scheduling model of this run's Twelve Data spend (a catalog page is 1 credit; every analysis is charged its worst-case fan-out). It is NOT the provider's counter: the transports keep {ok,status,json} only, so api-credits-used/api-credits-left are not observable.",
      };
    },
  };
}

/** Reserve a slot, or do nothing when there is no pacer (another provider, or pacing off). */
export async function reserveAnalysisSlot(pacer, { cost = TWELVE_DATA_ANALYSIS_MAX_CREDITS, label = null } = {}) {
  if (!pacer || typeof pacer.reserve !== "function") return { ...PACING_NOT_APPLIED };
  return pacer.reserve({ cost, label });
}

/**
 * What one caller's own bookkeeping shows for the pacing it did, as a delta over
 * the shared pacer. `null` when no pacer was supplied: "no pacing" is reported as
 * absent, never as "waited 0".
 */
export function pacingDelta(before, after) {
  if (!before || !after) return null;
  const waits = (Array.isArray(after.waits) ? after.waits : []).slice(before.waitsCount ?? 0);
  return {
    enabled: after.enabled === true,
    waits: Math.max(0, (after.waitsCount ?? 0) - (before.waitsCount ?? 0)),
    waitedMs: Math.max(0, (after.totalWaitMs ?? 0) - (before.totalWaitMs ?? 0)),
    deferred: waits.map((w) => w.label).filter((l) => typeof l === "string"),
  };
}

/** One bounded, honest sentence about the run's pacing, for the annotation and the summary. */
export function pacingSummary(pacing) {
  if (!pacing) return "not-configured";
  if (pacing.enabled !== true) {
    return `disabled (window ${pacing.windowMs ?? 0} ms, budget ${pacing.maxTotalWaitMs ?? 0} ms) - no wait was computed`;
  }
  return `waits:${pacing.waitsCount ?? 0},waited:~${Math.round((pacing.totalWaitMs ?? 0) / 1000)}s,modelled-credits:${
    pacing.modelledCredits ?? 0
  }`;
}

/* ------------------------------------------------------------------ *
 * The commodity energy-gate probe
 * ------------------------------------------------------------------ */

/**
 * Exercise the Phase-288 physical-feed gate against the DEPLOYED runtime, in
 * both directions, without naming a single instrument.
 *
 * The gate decides whether the U.S. EIA Weekly Petroleum Status Report may back
 * a commodity's `inventories` dimension, and it decides that from the MARKET the
 * instrument resolves to — for a quoted provider-native pair, from its base leg.
 * It can be wrong in two opposite ways, and neither is observable from a single
 * commodity: a bullion instrument can inherit petroleum inventory (the
 * cross-domain read the gate exists to prevent), or a petroleum instrument can
 * be denied its own feed (the false negative the base-leg resolution exists to
 * prevent).
 *
 * So the probe needs one instrument of each kind and may name neither. Candidates
 * arrive from the deployment's own discovery in the provider's own order; each is
 * analysed under its own native id (no substitution) and classified by the
 * DEPLOYED runtime's answer (`commodityProfile.group`, the very field the gate
 * reads). The scan is bounded, stops as soon as both directions are represented,
 * gives every candidate its own anonymous session (quota isolation), and honours
 * the provider circuit — a provider that just refused on capacity or credentials
 * receives no repeat request. A case that cannot be reached is reported
 * UNAVAILABLE with the count actually classified, never assumed.
 *
 * Phase 289 quota-audit: when a `pacer` is supplied, it also governs WHEN each
 * candidate's analysis may leave (the provider's per-minute credit window). The
 * circuit check stays FIRST, so a real 429 is never waited out or retried, and the
 * pacing it did is reported as a delta — "waited for the next minute" and "the
 * provider refused" must never read the same.
 */
export async function probeEnergyGate({
  spec,
  candidates,
  transport,
  circuit,
  sessionFor,
  seeds = [],
  candidateLimit = ENERGY_PROBE_CANDIDATE_LIMIT,
  pacer = null,
  pauseMs = ENERGY_PROBE_PAUSE_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const pacingBefore = typeof pacer?.snapshot === "function" ? pacer.snapshot() : null;
  const list = Array.isArray(candidates) ? candidates : [];
  // Provider order, exactly as discovered — recorded so a reader can see WHERE in
  // the catalog each classified instrument sat, and therefore whether an energy
  // instrument exists at all (as opposed to being out of scan range).
  const positions = new Map();
  list.forEach((candidate, index) => {
    const id = candidate?.instId ?? candidate?.providerInstrumentId ?? null;
    if (typeof id === "string" && id.length > 0 && !positions.has(id)) positions.set(id, index + 1);
  });
  const samples = (Array.isArray(seeds) ? seeds : []).map((seed) => ({
    ...seed,
    position: positions.get(seed?.instrument) ?? null,
  }));
  const sampled = new Set(samples.map((x) => x?.instrument).filter((id) => typeof id === "string"));
  let stopReason = null;

  const bothDirections = () =>
    samples.some((x) => x.group === "energy") &&
    samples.some((x) => typeof x.group === "string" && x.group !== "energy");

  for (const candidate of list) {
    if (bothDirections()) break;
    const nativeId = candidate?.instId ?? candidate?.providerInstrumentId ?? null;
    if (typeof nativeId !== "string" || nativeId.length === 0) continue;
    if (sampled.has(nativeId)) continue;
    const provider = candidate.provider ?? "twelve-data";

    const tripped = circuit.isTripped(provider);
    if (tripped) {
      stopReason = `provider circuit open (${tripped.kind}) — no repeat request to ${provider}`;
      break;
    }

    // Phase 289 quota-audit — the minute-window gate, deliberately AFTER the
    // circuit check above: a provider that actually answered 429 must never be
    // waited out or retried. This only defers a request the provider has NOT
    // refused, and only until its next wall-clock minute. WHO is asked, and in
    // which order, is decided entirely above this line.
    const gate = await reserveAnalysisSlot(pacer, {
      cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS,
      label: `COMMODITY probe ${nativeId}`,
    });
    if (gate.exhausted) {
      stopReason = `${gate.reason} — candidate ${nativeId} was not requested`;
      break;
    }

    const session = await sessionFor(`COMMODITY probe ${nativeId}`);
    if (!session.ok) {
      stopReason = `could not create an anonymous session for ${nativeId}: ${session.reason}`;
      break;
    }

    const response = await transport.action(
      "protectedAnalysis:runProtectedAnalysis",
      buildAnalysisInput(spec, candidate),
      session.token,
    );
    const verdict = classifyDomain({
      response: response.ok ? response.value : null,
      transportError: response.ok ? null : (response.appError ?? response.transportError ?? "request failed"),
    });
    circuit.classify(provider, response.appError ?? "", verdict?.evidence?.diagnostics ?? []);

    sampled.add(nativeId);
    const instrument = verdict?.evidence?.market?.providerInstrumentId ?? nativeId;
    samples.push({
      instrument,
      position: positions.get(nativeId) ?? positions.get(instrument) ?? null,
      provider,
      runtimeStatus: verdict?.status ?? null,
      verdict: verdict?.headline ?? null,
      reason: verdict?.reason ?? null,
      ...commodityMarketOf(verdict?.evidence ?? null),
    });

    if (!bothDirections() && pauseMs > 0) await sleep(pauseMs);
  }

  const pacingAfter = typeof pacer?.snapshot === "function" ? pacer.snapshot() : null;
  const outcome = energyGateVerdict(samples);
  return {
    candidateLimit,
    candidatesConsidered: list
      .map((c) => c?.instId ?? c?.providerInstrumentId ?? null)
      .filter((id) => typeof id === "string"),
    classified: samples.filter((x) => typeof x.group === "string").length,
    stopReason,
    samples,
    verdict: outcome.verdict,
    summary: outcome.summary,
    failures: outcome.failures,
    // Phase 289 quota-audit — the pacing THIS probe did, as a delta over the
    // shared pacer (so the run's discovery/domain waits are not claimed here).
    pacing: pacingDelta(pacingBefore, pacingAfter),
  };
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

function flag(name, argv) {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? "") : null;
}


/**
 * Phase 306 — apply ONE attempt's verdict to the domain record: the legs, the
 * observedAt, the failing legs and the structured evidence all come from the
 * SAME attempt, so the printed detail can never describe a different candidate
 * than the reported headline/reason (run 36960231581 printed a GBP/JPY record
 * whose reason quoted AUD/CAD's measurement gap — the worst verdict's reason
 * met the last attempt's evidence).
 */
function applyVerdictEvidence(record, verdict, provider, nativeId) {
  if (verdict.evidence) {
    const e = verdict.evidence;
    record.failingLegs = (Array.isArray(e.diagnostics) ? e.diagnostics : [])
      .filter((d) => d.acquired !== true && typeof d.reason === "string" && d.reason.length > 0)
      .map((d) => `${d.provider}/${d.dataset ?? "?"}: ${d.reason}`);
    record.observedAt = e.market.observedAt;
    record.dataCompleteness = e.dataCompleteness;
    record.provider = e.market.provider ?? provider;
    record.providerInstrumentId = e.market.providerInstrumentId ?? nativeId;
    record.legs = {
      market: e.market.present
        ? `real (${e.market.source ?? "provider"}) price=${e.market.price} observedAt=${e.market.observedAt}`
        : "none returned",
      technical: e.technical.available
        ? `available (${e.technical.bias ?? "?"} ${e.technical.confidence ?? "?"})`
        : `unavailable (${e.technical.summary ?? "no technical evidence"})`,
      fundamental: e.fundamental.available
        ? `available (${e.fundamental.domain ?? "?"} ${e.fundamental.state ?? "?"} via ${e.fundamental.provider ?? "?"})`
        : `unavailable (state=${e.fundamental.state ?? "none"}, providers=${e.fundamental.evidenceProviders.join(",") || "none"})`,
      unified: e.unified.present
        ? `available (state=${e.unified.state ?? "?"}, agreement=${e.unified.agreement ?? "?"}, actionable=${e.unified.actionable})`
        : "unavailable",
    };
    record.evidence = {
      completeness: e.dataCompleteness,
      recommendation: e.recommendation,
      provenance: e.provenance,
      market: e.market,
      technical: {
        available: e.technical.available,
        bias: e.technical.bias,
        confidence: e.technical.confidence,
        advanced: e.technical.advanced,
      },
      fundamental: e.fundamental,
      unified: e.unified,
      // Phase 289 — the per-leg flags travel with the record so the digest
      // (and therefore a reader without the artifact) can see a leg that was
      // acquired and then deliberately not consumed.
      diagnostics: e.diagnostics,
    };
  } else {
    // No evidence structure was delivered for this attempt: the record must
    // not keep a previous attempt's identity or evidence — everything the
    // record prints describes THE attempt it reports.
    record.provider = provider;
    record.providerInstrumentId = nativeId;
    record.observedAt = null;
    record.dataCompleteness = null;
    delete record.evidence;
    record.legs = {
      market: "not delivered",
      technical: "not delivered",
      fundamental: "not delivered",
      unified: "not delivered",
    };
  }
}

async function run() {
  const argv = process.argv.slice(2);
  const targetUrl = flag("--url", argv) ?? `https://${EXPECTED_DEV_HOST}`;
  const allowedHost = flag("--allow-host", argv);
  const outPath = flag("--out", argv) ?? "development-runtime-smoke.json";
  const domainsArg = flag("--domains", argv);
  const maxAttempts =
    Number.parseInt(flag("--max-attempts", argv) ?? String(DEFAULT_MAX_ATTEMPTS), 10) ||
    DEFAULT_MAX_ATTEMPTS;
  const quiet = argv.includes("--quiet");
  // The probe's scan depth, disclosed and bounded. A higher value is for the case
  // the previous run's discovered-identity list shows the energy instruments sit
  // deeper than the default; it is never a whitelist and never reorders anything.
  const probeLimit = (() => {
    const raw = flag("--probe-limit", argv) ?? process.env.XSTARZ_SMOKE_PROBE_LIMIT ?? "";
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return ENERGY_PROBE_CANDIDATE_LIMIT;
    return Math.min(parsed, ENERGY_PROBE_MAX_CANDIDATE_LIMIT);
  })();

  const target = validateTarget(targetUrl, allowedHost);
  if (!target.ok) {
    console.error(`REFUSED: ${target.reason} (target: ${targetUrl})`);
    process.exit(2);
  }
  const origin = target.origin;

  const specs = domainsArg
    ? DOMAIN_SPECS.filter((s) => domainsArg.split(",").map((d) => d.trim()).includes(s.domain))
    : DOMAIN_SPECS;
  if (specs.length === 0) {
    console.error("REFUSED: no known domain selected (crypto|forex|stock|commodity)");
    process.exit(2);
  }

  // Phase 302 — the EXACT live-verification mode (opt-in). Identities come from
  // the operator/workflow as provider:assetClass:nativeId — the repository's
  // established exact paths (BTC = okx BTC-USDT, XAU = twelve-data XAU/USD,
  // plus a calendar-mapped major) — and are NEVER substituted for discovery.
  // Invalid specs refuse the whole run before anything is requested.
  const exactArg = flag("--exact", argv) ?? process.env.XSTARZ_SMOKE_EXACT ?? "";
  const exactParsed = parseExactInstrumentSpecs(exactArg);
  if (!exactParsed.ok && exactArg.trim() !== "") {
    console.error(`REFUSED: ${exactParsed.problem}`);
    process.exit(2);
  }

  const transport = createTransport(origin);
  const circuit = createProviderCircuit();
  // Phase 289 quota-audit — ONE pacer for every Twelve Data request this run
  // issues: the catalog walk, the domain loop and the energy-gate probe all draw
  // on the same provider minute, so they must share one model of it.
  const pacing = resolvePacingConfig({ argv, env: process.env });
  const pacer = createTwelveDataQuotaPacer(pacing);

  const version = await probeVersion(origin);
  const reachability = version.ok ? { ok: true } : await probeApiLiveness(transport);
  if (!reachability.ok) {
    // Could not look. Say so, conclude nothing about the runtime, and still
    // leave an auditable trace: an absence of evidence is not evidence, but a
    // silent exit is not an audit trail either.
    const why = `deployment unreachable (/version -> ${version.transportError ?? version.httpStatus}, /api -> ${
      reachability.transportError ?? reachability.httpStatus
    })`;
    const blockedReport = {
      schema: "xstarz.development-runtime-smoke/1",
      generatedAt: new Date().toISOString(),
      generatedBy: "scripts/development-runtime-smoke.mjs",
      runOutcome: "COULD_NOT_LOOK",
      conclusion: "Nothing about the deployed runtime may be concluded from this run.",
      target: { origin, host: target.host, deployment: process.env.XSTARZ_SMOKE_DEPLOYMENT ?? null, productionTouched: false },
      source: { ref: process.env.GITHUB_REF ?? null, commit: process.env.GITHUB_SHA ?? null },
      policy: { stubsUsed: "none", fixturesUsed: "none", localhostUsed: false, clientEvidenceSent: false },
      transport: { calls: transport.state.calls, blocked: transport.state.blocked, lastError: transport.state.lastError },
      domains: specs.map((spec) => ({
        domain: spec.domain,
        label: spec.label,
        headline: "NOT_ATTEMPTED",
        reason: sanitize(why),
      })),
      summary: Object.fromEntries(specs.map((spec) => [spec.label, "NOT_ATTEMPTED"])),
    };
    writeFileSync(outPath, `${JSON.stringify(blockedReport, null, 2)}\n`);
    console.error(`COULD NOT LOOK: ${why}. Nothing about the deployed runtime may be concluded from this run.`);
    process.exit(2);
  }

  const domains = [];

  // Phase 303 — deterministic provider budget plan: computed BEFORE anything is
  // issued, reported verbatim in the run, and driven by the reservations below
  // (exact buckets first, then the catalog walk, then per-domain worst cases).
  const providerBudgetPlan = buildProviderBudgetPlan({
    exactSpecs: exactParsed.ok ? exactParsed.specs : [],
    domainLabels: specs.filter((s) => s.discovery === "twelve-data").map((s) => s.label),
    maxAttempts,
  });

  // Phase 303/304 — within-run learning (workstreams C/B/D): sides whose macro
  // leg reported no released measurement (303), provider-proven plan-restricted
  // families and technically-insufficient families (304). All three live for
  // THIS RUN only; they re-rank later picks via the ranker's observations; they
  // are never persisted, never a whitelist, and never drop a candidate.
  const observedMacroGaps = new Set();
  const observedPlanRestrictedFamilies = new Set();
  const observedTechnicallyInsufficientFamilies = new Set();
  const observedTechnicallyInsufficientQuotes = new Set();
  // Phase 305 — COUNTED technical strikes (`base:<family>` / `quote:<currency>`):
  // the run-36960231581 crypto window burned all three attempts on three
  // DIFFERENT base families sharing one thin quote (BTC-PLN, ETH-PLN,
  // USDC-PLN), so a set keyed by family alone cannot accumulate the pattern.
  // Counts let the ranker prefer candidates with no strikes on either side.
  const observedTechnicalStrikes = new Map();
  const addStrike = (key) => observedTechnicalStrikes.set(key, (observedTechnicalStrikes.get(key) ?? 0) + 1);

  // One discovery per provider per run: the reference catalogs are shared by
  // three domains and re-asking would be a repeated request for nothing.
  const okxDiscovery = specs.some((s) => s.discovery === "okx") ? await discoverOkx(transport) : null;
  // Phase 304 — the crypto pool is now VISIBLE (runs 36954328849/36957205385
  // picked USDC-PLN with no way to see whether the pool held alternatives).
  if (okxDiscovery) {
    annotate(
      okxDiscovery.success === true ? "notice" : "warning",
      `OKX discovery ${okxDiscovery.success === true ? "OK" : "UNAVAILABLE"}`,
      `informational — ${okxDiscoveryDigest(okxDiscovery)}`,
    );
  }
  let twelveDiscovery = null;
  let twelveDiscoveryError = null;
  // Phase 289E — the discovery result is annotated once per run.
  let discoveryReported = false;
  let discoveryReport = null;

  /** Each domain gets its OWN session, so one domain cannot spend another's quota. */
  async function sessionFor(label) {
    const session = await signInAnonymous(transport);
    if (!session.ok) {
      return { ok: false, reason: sanitize(session.appError ?? "anonymous sign-in failed") };
    }
    const entitlement = await transport.query("entitlements:getMyEntitlement", {}, session.token);
    return {
      ok: true,
      token: session.token,
      before: entitlement.value ?? null,
    };
  }

  // ── Phase 302/303 — EXACT live verification (runs FIRST, on reserved windows) ──
  // One request per declared identity, through the SAME protected analysis
  // action, the SAME anonymous-session discipline and the SAME honest verdict
  // classifier as the generic domains. CoinGlass/order-book/calendar absences
  // are reported through the runtime's own failing-leg reasons — OPTIONAL
  // dependencies degrade honestly; a REQUIRED dependency that cannot be
  // produced is a genuine blocker, never faked.
  for (const exact of exactParsed.ok ? exactParsed.specs : []) {
    const label = `EXACT ${exact.label}`;
    const record = {
      domain: `exact-${exact.label}`,
      label,
      provider: exact.provider,
      providerInstrumentId: exact.providerInstrumentId,
      assetClass: exact.assetClass,
      attempts: [],
    };
    const eligibility = classifyInstrumentEligibility({
      provider: exact.provider,
      providerInstrumentId: exact.providerInstrumentId,
      assetClass: exact.assetClass,
    });
    record.eligibility = { tier: eligibility.tier, reasons: eligibility.reasons, degradedLegs: eligibility.degradedLegs };
    const session = await sessionFor(label);
    if (!session.ok) {
      record.headline = "UNAVAILABLE";
      record.reason = `no anonymous session: ${sanitize(session.appError ?? "sign-in failed")}`;
      record.attempts.push({ step: "session", outcome: "unavailable", reason: record.reason });
      annotate("warning", `${label} UNAVAILABLE`, record.reason);
      domains.push(record);
      continue;
    }
    const domainSpec = { domain: `exact-${exact.label}`, label, discovery: exact.provider, assetClass: exact.assetClass };
    const candidate = {
      provider: exact.provider,
      providerInstrumentId: exact.providerInstrumentId,
      ...(exact.provider === "okx" ? { instId: exact.providerInstrumentId } : {}),
    };
    // Phase 303 — the exact identity RESERVES its full worst-case window before
    // it issues (run 36954328849: the unreserved exact analysis shared the
    // generic domains' minute and drew the provider's 11-vs-8 429). The exact
    // block also runs FIRST in the run, so no generic spend can precede it.
    if (exact.provider === "twelve-data") {
      const gate = await reserveAnalysisSlot(pacer, { cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label });
      if (gate.exhausted) {
        record.headline = "UNAVAILABLE";
        record.reason = gate.reason;
        record.block = "RATE_LIMITED";
        record.attempts.push({ step: "pacing", outcome: "skipped", reason: gate.reason });
        annotate("warning", `${label} UNAVAILABLE`, `${exact.provider} · ${exact.providerInstrumentId} · observedAt=none · ${gate.reason} · block=RATE_LIMITED`);
        domains.push(record);
        continue;
      }
    }
    const request = buildAnalysisInput(domainSpec, candidate);
    const response = await transport.action("protectedAnalysis:runProtectedAnalysis", request, session.token);
    const verdict = classifyDomain({
      response: response.ok ? response.value : null,
      transportError: response.ok ? null : (response.appError ?? response.transportError ?? "request failed"),
    });
    record.headline = verdict.headline;
    record.reason = verdict.reason;
    record.attempts.push({
      step: "analysis",
      function: "protectedAnalysis:runProtectedAnalysis",
      instrument: exact.providerInstrumentId,
      provider: exact.provider,
      httpStatus: response.httpStatus,
      verdict: verdict.headline,
      reason: verdict.reason,
    });
    if (verdict.evidence) {
      const e = verdict.evidence;
      record.observedAt = e.market.observedAt;
      record.failingLegs = (Array.isArray(e.diagnostics) ? e.diagnostics : [])
        .filter((d) => d.acquired !== true && typeof d.reason === "string" && d.reason.length > 0)
        .map((d) => `${d.provider}/${d.dataset ?? "?"}: ${d.reason}`);
      record.legs = {
        market: e.market.present
          ? `real (${e.market.source ?? "provider"}) price=${e.market.price} observedAt=${e.market.observedAt}`
          : "none returned",
        technical: e.technical.available
          ? `available (${e.technical.bias ?? "?"} ${e.technical.confidence ?? "?"})`
          : `unavailable (${e.technical.summary ?? "no technical evidence"})`,
        fundamental: e.fundamental.available
          ? `available (${e.fundamental.domain ?? "?"} ${e.fundamental.state ?? "?"} via ${e.fundamental.provider ?? "?"})`
          : `unavailable (state=${e.fundamental.state ?? "none"}, providers=${e.fundamental.evidenceProviders.join(",") || "none"})`,
        unified: e.unified.present
          ? `available (state=${e.unified.state ?? "?"}, agreement=${e.unified.agreement ?? "?"}, actionable=${e.unified.actionable})`
          : "unavailable",
      };
      record.evidence = {
        market: e.market,
        technical: { available: e.technical.available, bias: e.technical.bias, confidence: e.technical.confidence },
        fundamental: e.fundamental,
        unified: e.unified,
        diagnostics: e.diagnostics,
      };
    } else {
      record.legs = { market: "not delivered", technical: "not delivered", fundamental: "not delivered", unified: "not delivered" };
    }
    circuit.classify(exact.provider, response.appError ?? "", record.evidence?.diagnostics ?? "");
    // Phase 303 — name the provider-block class explicitly (workstream B.4):
    // RATE_LIMITED is a minute-window budget fact, PLAN_RESTRICTED a plan-tier
    // fact, NO_DATA an absence — never blurred, never retried on 429.
    const marketBlockLeg = (record.failingLegs ?? []).find(
      (leg) => leg.startsWith("market-data") || leg.startsWith(`${exact.provider}/`),
    );
    const marketBlock = classifyProviderBlock(
      marketBlockLeg ?? (verdict.headline === "UNAVAILABLE" || verdict.headline === "FAIL" ? record.reason : ""),
    );
    record.block = verdict.headline === "PASS" ? null : (marketBlock?.class ?? null);
    // The annotations API returns warnings/errors — the harness's established
    // informational-warning convention carries every verdict to the run log.
    annotate(
      verdict.headline === "FAIL" ? "error" : "warning",
      `${label} ${verdict.headline}`,
      `${exact.provider} · ${exact.providerInstrumentId} · observedAt=${record.observedAt ?? "none"} · ${record.reason ?? ""}${
        record.failingLegs?.length ? ` · failing legs: ${record.failingLegs.join(" | ")}` : ""
      } · eligibility=${eligibility.tier}${record.block ? ` · block=${record.block}` : ""}`,
    );
    domains.push(record);
  }


  for (const spec of specs) {
    const record = {
      domain: spec.domain,
      label: spec.label,
      headline: "FAIL",
      provider: null,
      providerInstrumentId: null,
      assetClass: spec.assetClass,
      observedAt: null,
      dataCompleteness: null,
      legs: { market: "not attempted", technical: "not attempted", fundamental: "not attempted", unified: "not attempted" },
      reason: null,
      // Phase 288 — the provider's own catalog report and the runtime's own
      // per-leg diagnoses, so a verdict names its cause instead of restating a
      // generic sentence.
      discovery: null,
      failingLegs: [],
      attempts: [],
      entitlement: null,
    };

    const session = await sessionFor(spec.label);
    if (!session.ok) {
      record.reason = `could not create an anonymous session: ${session.reason}`;
      record.attempts.push({ step: "auth:signIn", outcome: "failed", reason: session.reason });
      domains.push(record);
      continue;
    }
    record.entitlement = {
      plan: session.before?.plan ?? null,
      limit: session.before?.limit ?? null,
      remainingBefore: session.before?.remaining ?? null,
    };

    // ── discovery: the deployment names the instrument, this script never does
    let discovery;
    if (spec.discovery === "okx") {
      discovery = okxDiscovery;
    } else {
      if (twelveDiscovery === null && twelveDiscoveryError === null) {
        // Phase 303 — the walk RESERVES its worst-case spend BEFORE it issues
        // (run 36954328849: unreserved catalog credits shared a minute with an
        // analysis fan-out and produced the provider's 11-vs-8 429). The
        // post-hoc charge then bills only the delta above the reservation, so
        // the ledger stays conservative without double-counting.
        const discoveryGate = await reserveAnalysisSlot(pacer, {
          cost: TWELVE_DATA_DISCOVERY_CREDITS,
          label: "discovery",
        });
        if (discoveryGate.exhausted) {
          twelveDiscovery = { success: false, instruments: [], error: discoveryGate.reason };
          twelveDiscoveryError = discoveryGate.reason;
        } else {
        const found = await discoverTwelveData(transport, session.token);
        twelveDiscovery = found;
        // The catalog walk is the run's FIRST Twelve Data spend and the only part
        // of it the provider itself reports a count for (`pagesFetched` plus every
        // catalog that was attempted without an answered page). Charged here so
        // the domain loop and the probe see the minute as it really is.
        const actualDiscoverySpend = discoveryCreditSpend(found);
        if (actualDiscoverySpend > TWELVE_DATA_DISCOVERY_CREDITS) {
          pacer.charge(actualDiscoverySpend - TWELVE_DATA_DISCOVERY_CREDITS, "discovery (delta above reservation)");
        }
        }
        if (twelveDiscovery.success !== true && twelveDiscoveryError === null && twelveDiscovery.error) {
          twelveDiscoveryError = twelveDiscovery.error;
          if (!discoveryGate.exhausted) circuit.classify("twelve-data", twelveDiscoveryError);
        }
      }
      discovery = twelveDiscovery;

      // Phase 289E — the discovery result is reported ONCE, before any domain
      // verdict, so a failed or partial catalog walk is readable from the run's
      // annotations alone (the artifact is not always downloadable).
      if (!discoveryReported && discovery !== null) {
        discoveryReported = true;
        discoveryReport = discovery;
        // Phase 289F — prove the staged rows are really readable WITHOUT moving
        // the universe: one bounded page per staged catalog, in the provider
        // order the stage was written in. A read that fails is reported as
        // failed; nothing is assumed from the catalog's own completeness.
        try {
          discovery.stageReads = await probeDiscoveryStages(discovery, transport, session.token);
        } catch (error) {
          discovery.stageReads = [
            {
              path: "(stage probe)",
              ok: false,
              rows: 0,
              stagedRows: null,
              state: null,
              hasMore: false,
              nextAfterSeq: null,
              catalogCompleteness: null,
              catalogRows: null,
              providerCount: null,
              identitySample: [],
              reason: sanitize(error instanceof Error ? error.message : "stage probe failed"),
            },
          ];
        }
        const text = discoveryDigest(discovery);
        annotate(
          discovery.success === true ? "notice" : "warning",
          `Twelve Data discovery ${discovery.success === true ? "OK" : "UNAVAILABLE"}`,
          `informational — ${text ?? "no discovery result"}`,
        );
      }
    }

    if (!discovery || discovery.success !== true) {
      const reason = sanitize(
        discovery?.error ?? twelveDiscoveryError ?? "discovery returned no instruments for this asset class",
      );
      record.reason = `provider discovery did not produce instruments: ${reason}`;
      record.headline = "UNAVAILABLE";
      record.legs.market = "not attempted (no discovered instrument)";
      record.attempts.push({ step: "discovery", outcome: "unavailable", reason });
      annotate("warning", `${spec.label} UNAVAILABLE`, record.reason);
      domains.push(record);
      continue;
    }

    let candidates = selectCandidates(spec, discovery, maxAttempts);
    let candidateSource = "discovery-instruments";
    let stagedPool = null;
    let stagedProvenance = null;
    // Phase 304 — the staged-catalog seam (workstream A): a catalog the walk
    // STAGED (live: /stocks, run 36957205385 — COMPLETE, 143212 kept, zero
    // inline rows) never reaches `discovery.instruments`, so inline-only
    // selection reported "no live equity instrument" behind a COMPLETE
    // catalog. When the inline pool is empty and a staged catalog exists for
    // this asset class, read a BOUNDED provider-order window from the stage
    // (cursor/afterSeq, never a wholesale load) and select from it with the
    // SAME capability-aware ranker.
    if (candidates.length === 0 && spec.discovery === "twelve-data") {
      const staged = await selectCandidatesFromStagedCatalog(spec, discovery, transport, session.token, {
        maxAttempts,
        observations: {
          macroGapCurrencies: observedMacroGaps,
          planRestrictedFamilies: observedPlanRestrictedFamilies,
          technicallyInsufficientFamilies: observedTechnicallyInsufficientFamilies,
        },
      });
      stagedProvenance = staged.provenance;
      if (staged.ok) {
        candidates = staged.candidates;
        stagedPool = staged.ranked;
        candidateSource = "staged-catalog";
        record.discovery = {
          completeness: discovery.completeness ?? null,
          pagesFetched: discovery.pagesFetched ?? null,
          totalDiscovered: discovery.totalDiscovered ?? null,
          catalogs: discovery.catalogs ?? [],
          warnings: discovery.warnings ?? [],
          stagedSelection: staged.provenance,
        };
        annotate(
          "notice",
          `${spec.label} staged-catalog selection`,
          `informational — candidates read from the staged catalog: stageId=${staged.provenance.stageId} · stagedRows=${staged.provenance.stagedRows} · pagesRead=${staged.provenance.pagesRead} · rowsRead=${staged.provenance.rowsRead} (bounded window) · usable=${staged.provenance.usableRows} · selected=${staged.provenance.selected.join(",") || "none"}`,
        );
      }
    }
    if (candidates.length === 0) {
      // Phase 288 — name the cause from the provider's own catalog report
      // instead of asserting a bare "no live instrument". A zero-row catalog,
      // a rejected page and a parser that skipped rows are different facts
      // with different fixes. Phase 304: catalog COMPLETE no longer implies
      // candidate available — the staged seam was attempted and its outcome
      // (or the reason there was nothing to read) is part of the verdict.
      const diagnosis = discoveryDiagnosis(discovery, spec.assetClass);
      record.discovery = {
        completeness: discovery.completeness ?? null,
        pagesFetched: discovery.pagesFetched ?? null,
        totalDiscovered: discovery.totalDiscovered ?? null,
        catalogs: discovery.catalogs ?? [],
        warnings: discovery.warnings ?? [],
        stagedSelection: stagedProvenance,
      };
      const stagedNote = stagedProvenance
        ? ` — staged-catalog seam attempted: ${stagedProvenance.readError ?? stagedProvenance.reason ?? `rowsRead=${stagedProvenance.rowsRead}, usable=${stagedProvenance.usableRows}`}`
        : "";
      record.reason = diagnosis
        ? `discovery returned no live ${spec.assetClass} instrument — ${diagnosis}${stagedNote}`
        : `discovery succeeded but listed no live ${spec.assetClass} instrument (the provider reported no failed catalog and no skipped rows)${stagedNote}`;
      record.headline = "UNAVAILABLE";
      record.legs.market = "not attempted (no discovered instrument)";
      record.attempts.push({ step: "discovery", outcome: "empty", reason: record.reason });
      annotate("warning", `${spec.label} UNAVAILABLE`, record.reason);
      domains.push(record);
      continue;
    }

    // ── one request per candidate, bounded, no repeats after a rate limit.
    //
    // Phase 303 — the pick is RE-DERIVED before every attempt from the SAME
    // discovery truth plus this run's own macro-measurement observations
    // (workstream C): mapping is provider capability, a RELEASED measurement is
    // provider DATA — observable only by attempting. Once a pair's macro leg
    // reports no released measurement for a side currency, later picks prefer
    // pairs whose sides carry no such observation, within the SAME bounded
    // attempt budget, pacing and circuit discipline. Nothing is whitelisted:
    // any discovered pair can still be picked first when nothing was observed.
    let domainVerdict = null;
    const learningQueueCeiling = Math.max(maxAttempts, CANDIDATE_POOL_WINDOW);
    const learningObservations = () => ({
      macroGapCurrencies: observedMacroGaps,
      planRestrictedFamilies: observedPlanRestrictedFamilies,
      technicallyInsufficientFamilies: observedTechnicallyInsufficientFamilies,
      technicallyInsufficientQuotes: observedTechnicallyInsufficientQuotes,
      technicalStrikes: observedTechnicalStrikes,
    });
    const triedInstruments = new Set();
    // Phase 306 — every attempt is remembered WITH its identity, so the
    // reported verdict's OWN evidence is what the record prints (workstream D:
    // the reported headline/reason and the printed legs/detail must describe
    // the SAME attempt — run 36960231581 printed a GBP/JPY record whose reason
    // quoted AUD/CAD's measurement gap, because the worst verdict's reason met
    // the last attempt's evidence).
    const attemptMeta = [];
    // Phase 306 — plan-restriction strikes across THIS domain's attempts: the
    // trigger for the bounded window advance (workstream B).
    let attemptedPlanRestricted = 0;
    let stagedWindowIndex = 0;
    for (let index = 0; triedInstruments.size < maxAttempts; index += 1) {
      // Phase 306 — when EVERY attempt so far proved plan-restricted, the
      // current scan window is exhausted AS EVIDENCE: the bounded selector
      // continues the SAME provider-order scan in the NEXT window (≤
      // STAGED_MAX_WINDOWS) instead of re-hitting the same block. Driven only
      // by the provider's own 404-that-names-a-plan observations; window
      // reads are server-side stage queries (no provider credits).
      if (
        candidateSource === "staged-catalog" &&
        stagedWindowIndex + 1 < STAGED_MAX_WINDOWS &&
        attemptedPlanRestricted >= triedInstruments.size &&
        triedInstruments.size > 0
      ) {
        stagedWindowIndex += 1;
        const deeper = await selectCandidatesFromStagedCatalog(spec, discovery, transport, session.token, {
          maxAttempts,
          observations: learningObservations(),
          windowIndex: stagedWindowIndex,
        });
        if (deeper.ok) {
          stagedPool = deeper.ranked;
          stagedProvenance = deeper.provenance;
          record.discovery = {
            ...(record.discovery ?? {}),
            stagedSelection: stagedProvenance,
          };
          record.attempts.push({
            step: "selection",
            outcome: "window-advanced",
            reason: `every attempt in scan window ${stagedWindowIndex} proved plan-restricted; continuing the provider-order scan: ${stagedProvenance.window}`,
          });
          annotate(
            "notice",
            `${spec.label} scan window advanced`,
            `informational — ${stagedProvenance.window} · stageId=${stagedProvenance.stageId} · rowsRead=${stagedProvenance.rowsRead} · usable=${stagedProvenance.usableRows} · selected=${stagedProvenance.selected.join(",") || "none"}`,
          );
        } else {
          record.attempts.push({
            step: "selection",
            outcome: "window-exhausted",
            reason: sanitize(deeper.reason ?? "deeper scan window unusable"),
          });
          stagedWindowIndex = STAGED_MAX_WINDOWS; // no further advance attempts
        }
      }
      // Phase 304 — the pick is re-derived before EVERY attempt: inline pools
      // via selectCandidates, staged-catalog pools by re-ranking the SAME
      // bounded window with the run's learning sets. Either way the source of
      // truth is the provider's own discovery, the budget stays maxAttempts,
      // and a demoted candidate sinks without ever being dropped.
      const queue =
        candidateSource === "staged-catalog"
          ? rankByAnalysisEligibility(stagedPool, {
              provider: spec.discovery,
              assetClass: spec.assetClass,
            }, learningObservations())
          : selectCandidates(spec, discovery, learningQueueCeiling, learningQueueCeiling, learningObservations());
      const candidate = queue.find((row) => !triedInstruments.has(candidateKey(spec, row)));
      if (!candidate) break;
      triedInstruments.add(candidateKey(spec, candidate));
      const provider = candidate.provider ?? spec.discovery;
      const nativeId = spec.discovery === "okx" ? candidate.instId : candidate.providerInstrumentId;
      const tripped = circuit.isTripped(provider);
      if (tripped && index > 0) {
        record.attempts.push({
          step: "analysis",
          instrument: nativeId,
          outcome: "skipped",
          reason: `provider circuit open (${tripped.kind}); no repeated requests to ${provider}`,
        });
        continue;
      }

      // Phase 289 quota-audit — the minute-window gate. It decides WHEN, never
      // WHICH: candidate, provider order and the bounded attempts above are
      // untouched, and an okx candidate spends another provider's quota, so it is
      // never paced by the Twelve Data model.
      const gate =
        spec.discovery === "twelve-data"
          ? await reserveAnalysisSlot(pacer, {
              cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS,
              label: `${spec.label} ${nativeId}`,
            })
          : { ...PACING_NOT_APPLIED };
      if (gate.exhausted) {
        record.attempts.push({
          step: "analysis",
          instrument: nativeId,
          outcome: "skipped",
          reason: gate.reason,
        });
        break;
      }

      const request = buildAnalysisInput(spec, candidate);
      const startedAt = Date.now();
      const response = await transport.action("protectedAnalysis:runProtectedAnalysis", request, session.token);
      const elapsedMs = Date.now() - startedAt;

      const verdict = classifyDomain({
        response: response.ok ? response.value : null,
        transportError: response.ok ? null : (response.appError ?? response.transportError ?? "request failed"),
      });

      // Phase 303/304 — observe this attempt's outcome from the runtime's OWN
      // sentences: released-measurement gaps (macro sides), provider-proven
      // plan-restricted families, technically-insufficient families. The
      // observations re-rank the NEXT pick within the same bounded budget.
      const observed = observeAttemptOutcome({
        providerInstrumentId: nativeId,
        assetClass: spec.assetClass,
        verdictReason: verdict.reason,
      });
      for (const side of observed.macroGapSides) observedMacroGaps.add(side);
      if (observed.planRestrictedFamily) {
        observedPlanRestrictedFamilies.add(observed.planRestrictedFamily);
        attemptedPlanRestricted += 1;
      }
      if (observed.technicallyInsufficientFamily) {
        observedTechnicallyInsufficientFamilies.add(observed.technicallyInsufficientFamily);
        addStrike(`base:${observed.technicallyInsufficientFamily}`);
      }
      if (observed.technicallyInsufficientQuote) {
        observedTechnicallyInsufficientQuotes.add(observed.technicallyInsufficientQuote);
        addStrike(`quote:${observed.technicallyInsufficientQuote}`);
      }
      const macroGapSides = observed.macroGapSides;

      domainVerdict = mostSevereVerdict(domainVerdict, verdict);

      record.provider = provider;
      record.providerInstrumentId = nativeId;
      record.assetClass = spec.assetClass;
      record.attempts.push({
        step: "analysis",
        function: "protectedAnalysis:runProtectedAnalysis",
        instrument: nativeId,
        provider,
        httpStatus: response.httpStatus,
        runtimeStatus: verdict.status,
        verdict: verdict.headline,
        elapsedMs,
        reason: verdict.reason,
        // Phase 306 — technical/OHLCV readiness is first-class: the candle
        // depth the engine actually consumed travels with every attempt.
        ...(Number.isFinite(verdict.evidence?.market?.dataPoints)
          ? { technicalDepth: verdict.evidence.market.dataPoints }
          : {}),
        ...(macroGapSides.length > 0 ? { macroGapObserved: macroGapSides } : {}),
      });
      attemptMeta.push({ verdict, provider, nativeId });

      if (spec.discovery !== "okx") {
        record.discovery = {
          completeness: discovery.completeness ?? null,
          pagesFetched: discovery.pagesFetched ?? null,
          totalDiscovered: discovery.totalDiscovered ?? null,
          catalogs: discovery.catalogs ?? [],
          warnings: discovery.warnings ?? [],
          // Phase 304 — a staged-catalog selection keeps its provenance on
          // every refresh of this record (the candidate CAME from the stage).
          ...(stagedProvenance ? { stagedSelection: stagedProvenance } : {}),
        };
      }

      applyVerdictEvidence(record, verdict, provider, nativeId);

      record.headline = verdict.headline;
      record.reason = verdict.reason;

      // A provider that just refused on capacity/credentials earns no retry —
      // but only for the provider that actually refused: `classify` reads the
      // transport's own error plus the legs attributable to this provider, never
      // another leg's reason.
      circuit.classify(provider, response.appError ?? "", record.evidence?.diagnostics ?? []);

      const after = await transport.query("entitlements:getMyEntitlement", {}, session.token);
      record.entitlement = {
        ...record.entitlement,
        charged: response.value?.entitlement?.charged ?? null,
        remainingAfter: after.value?.remaining ?? response.value?.entitlement?.remaining ?? null,
      };

      // Phase 302 — a domain that WORKS is never re-requested; but market bytes
      // alone are not "works": run 36951359320 stopped on BTC-PLN's real price
      // while its MTF chain was unusable (D1=3/W1=1/H4=12 candles). The loop
      // now stops on a genuine full-evidence verdict (or PASS), and otherwise
      // lets the NEXT discovery-ranked candidate be tried within the same
      // bounded budget, pacing and circuit discipline as before.
      const evidenceComplete =
        Boolean(verdict.evidence?.market?.observedAt) &&
        verdict.evidence?.technical?.available === true &&
        verdict.evidence?.unified?.present === true &&
        // Phase 303 — for forex the domain-defining leg is the macro
        // fundamental: market+technical+unified alone is exactly the AUD/CAD
        // outcome run 36954328849 reported. A pair with no released
        // measurement is not a complete forex evidence set, so the next
        // learned-rank candidate is tried within the same bounded budget.
        // Phase 304 — BUG FIX (run 36957205385): the check read
        // `fundamental.present`, but the runtime DELIVERS a fundamental
        // assessment object even when it carries `available: false` (the
        // honest "we looked and found nothing" assessment), so
        // `present === true` held for an UNAVAILABLE fundamental and ended
        // the forex loop after ONE attempt (AUD/CAD was the only try). The
        // gate is `available` — the same field the PASS verdict itself uses.
        (spec.assetClass !== "forex" || verdict.evidence?.fundamental?.available === true);
      if (verdict.headline === "PASS" || evidenceComplete) break;
    }

    // The attempts keep every outcome; the headline reports the worst of them.
    if (domainVerdict && record.headline !== "PASS") {
      record.headline = domainVerdict.headline;
      record.reason = domainVerdict.reason;
    }
    // Phase 306 — the record's printed evidence is re-bound to the attempt
    // that EARNED the reported verdict, so headline/reason/legs/detail always
    // describe the same candidate (workstream D).
    if (domainVerdict) {
      const reported = attemptMeta.find((m) => m.verdict === domainVerdict);
      if (reported) applyVerdictEvidence(record, reported.verdict, reported.provider, reported.nativeId);
    }

    // Phase 304 — every generic verdict names its provider-block class from
    // the provider's/runtime's own sentence (workstream E): a plan-restricted
    // commodity reads PLAN_RESTRICTED (never "discovery failure"), a missing
    // released measurement reads EXTERNAL_DATA_GAP (never a capability bug).
    const genericBlock =
      record.headline === "PASS"
        ? null
        : classifyProviderBlock(
            (record.failingLegs ?? []).find((leg) => /^(market-data|ohlcv|fx-rate)/.test(leg)) ??
              record.reason ??
              "",
          );
    record.block = genericBlock?.class ?? null;
    record.candidateSource = candidateSource;

    // Phase 304 — the ATTEMPT TRAVEL IS VISIBLE (workstream D): each attempt
    // and its outcome, in order, so a reader can see a candidate switch and
    // the reason the next candidate was tried.
    const attemptTrail = record.attempts
      .map((a) => `${a.instrument ?? a.step ?? "?"}=${a.outcome ?? a.verdict ?? "skipped"}`)
      .join(">");

    const digest = evidenceDigest(record);
    const level = record.headline === "FAIL" ? "error" : "warning";
    annotate(
      level,
      `${record.label} ${record.headline}`,
      `${record.provider ?? "?"} · ${record.providerInstrumentId ?? "?"} · observedAt=${
        record.observedAt ?? "none"
      } · ${record.reason ?? ""}${digest === null ? "" : ` · informational — ${digest}`}${
        record.block ? ` · block=${record.block}` : ""
      }${attemptTrail ? ` · attempts=[${attemptTrail}]` : ""}`,
    );

    domains.push(record);
  }

  // ── The commodity energy-gate probe ────────────────────────────────────────
  //
  // Bounded, provider-disciplined, and never naming an instrument: see
  // `probeEnergyGate`, which receives the deployment's own discovery and reads
  // the classification back from the deployed runtime.
  let energyGateProbe = null;
  const commoditySpec = specs.find((s) => s.domain === "commodity");
  if (commoditySpec && twelveDiscovery) {
    // The scan depth the PROBE is entitled to, passed as its own ceiling: the
    // domain loop's policy ceiling (3) is smaller, and letting it clamp this
    // silently is what made "no energy instrument in range" look like "the
    // provider has no energy instrument".
    const candidates = selectCandidates(
      commoditySpec,
      twelveDiscovery,
      probeLimit,
      probeLimit,
    );
    const commodityRecord = domains.find((d) => d.domain === "commodity");
    // The commodity domain already analysed the provider's first-ranked
    // instrument: that delivered answer is the first sample and costs nothing.
    const seeds =
      commodityRecord?.evidence?.fundamental && typeof commodityRecord.providerInstrumentId === "string"
        ? [
            {
              instrument: commodityRecord.providerInstrumentId,
              provider: commodityRecord.provider ?? "twelve-data",
              runtimeStatus: commodityRecord.headline,
              verdict: commodityRecord.headline,
              reason: commodityRecord.reason ?? null,
              ...commodityMarketOf(commodityRecord.evidence),
            },
          ]
        : [];

    energyGateProbe = await probeEnergyGate({
      spec: commoditySpec,
      candidates,
      transport,
      circuit,
      sessionFor,
      seeds,
      candidateLimit: probeLimit,
      pacer,
    });

    // Phase 289D — THE ENERGY SAMPLE'S EIA LEG, read from the probe's own
    // result. The gate could only say `eiaEvidence=0`; the per-leg diagnostics
    // existed but the failing-leg line is bounded to three legs, so a missing
    // credential, a rejected credential, a rate limit, a provider fault, an
    // empty dataset and a leg that was never scheduled all looked identical
    // from outside. The leg's own state and its own classified reason are read
    // here and reported before anything that can be truncated.
    const energySample = energyGateProbe.samples.find((x) => x.group === "energy") ?? null;
    const eiaLegText = energySample?.eiaLeg ?? null;
    energyGateProbe.eiaLeg = eiaLegText;
    energyGateProbe.eiaLegState = energySample?.eiaLegState ?? null;

    // A direct, read-only probe of the deployed action's OWN envelope — the only
    // surface that separates "the analysis never scheduled the leg" from "the leg
    // ran and the provider/credential said no". It reports the action's own
    // `success` flag (NEVER an HTTP status), its classified error code and text,
    // and the provider's own observation periods verbatim. Nothing is derived,
    // nothing is fabricated, and no credential is read, printed or inferred.
    const eiaSession = await sessionFor("EIA inventory probe");
    const eiaProbe = eiaSession.ok
      ? eiaActionEnvelope(await transport.action("eia:fetchEiaInventory", {}, eiaSession.token))
      : { answered: false, reason: sanitize(`no session: ${eiaSession.reason}`) };
    energyGateProbe.eiaActionProbe = eiaProbe;

    // The discovered identity list is reported because the audit could not answer
    // the decisive question without it: is there NO energy instrument in the
    // provider's commodity catalog, or is it simply beyond the scan? The list is
    // the provider's own order, verbatim, with no ranking, filtering or curation.
    const identities = energyGateProbe.candidatesConsidered;
    const identitySample = identities.slice(0, ENERGY_PROBE_REPORT_IDENTITIES);
    const classifiedText = energyGateProbe.samples
      .filter((x) => typeof x.group === "string")
      .slice(0, 4)
      .map((x) => `${x.instrument}@${x.position ?? "?"}=${x.group}`)
      .join(",");
    // Phase 289 quota-audit — the probe's own pacing, said out loud: waiting for
    // the provider's next minute window is NOT a refusal, and a reader must be
    // able to tell the two apart. (A refusal lands in `stopped:` above.)
    const pacingText =
      energyGateProbe.pacing && energyGateProbe.pacing.waits > 0
        ? ` · pacing: waited ${energyGateProbe.pacing.waits}× (~${Math.round(
            energyGateProbe.pacing.waitedMs / 1000,
          )} s) for the provider's next minute window`
        : "";

    annotate(
      energyGateProbe.verdict === "FAIL" ? "error" : "warning",
      `COMMODITY energy-gate probe ${energyGateProbe.verdict}`,
      `informational — classified=${energyGateProbe.classified}/${candidates.length}${
        eiaLegText === null ? "" : ` · ${eiaLegText}`
      } of the deployment's own commodity discovery${
        energyGateProbe.stopReason === null ? "" : ` · stopped: ${energyGateProbe.stopReason}`
      } · ${energyGateProbe.summary}${
        classifiedText === "" ? "" : ` · groups: ${classifiedText}`
      }${identities.length === 0 ? "" : ` · discovered(${identities.length}): ${identitySample.join(",")}${
        identities.length > identitySample.length ? ",…" : ""
      }`}${pacingText}`,
    );

    annotate(
      energySample?.eiaLegState === "consumed" ? "notice" : "warning",
      `COMMODITY energy-gate EIA leg ${energySample?.eiaLegState ?? "not-reported"}`,
      `informational — ${
        energySample?.instrument ?? "no energy-classified instrument in the probe"
      }${
        energySample?.position === null || energySample?.position === undefined
          ? ""
          : ` (provider position #${energySample.position})`
      } · ${eiaLegText ?? "the energy sample carried no eia leg record"} · ${
        eiaActionProbeDigest(eiaProbe) ?? "the deployed EIA action was not probed"
      }`,
    );
  }

  // The run-level code-path fingerprint, aggregated over the domains that
  // actually returned a result. (Reinstated after the probe extraction removed
  // it: the annotation below reads these values, so a missing definition here is
  // a ReferenceError at the very end of a long run.)
  const markerSets = domains.map((d) => runtimeMarkers(d.evidence ?? null));
  const runtimeFingerprintOfRun = {
    providerDiagnosticsLegs: markerSets.reduce((n, m) => n + m.diagnostics, 0),
    providerDiagnosticsWithReason: markerSets.reduce((n, m) => n + m.diagnosticsWithReason, 0),
    calendarMappingGapObserved: markerSets.some((m) => m.calendarMappingGapObserved),
    petroleumFeedScopeObserved: markerSets.some((m) => m.petroleumFeedScopeObserved),
    commodityGroups: [
      ...new Set(markerSets.map((m) => m.commodityGroup).filter((g) => typeof g === "string")),
    ],
  };
  // The conclusion, stated as the deduction it is: these markers exist ONLY in
  // the Phase-288 revisions of the deployed functions, so seeing any of them
  // proves those code paths answered. `not-observed` is never silently rounded up
  // into a version claim — /version cannot supply one.
  const phase288CodePathsObserved =
    runtimeFingerprintOfRun.providerDiagnosticsWithReason > 0 ||
    runtimeFingerprintOfRun.calendarMappingGapObserved ||
    runtimeFingerprintOfRun.petroleumFeedScopeObserved;
  const runtimeFingerprint = {
    ...runtimeFingerprintOfRun,
    phase288CodePathsObserved,
    perDomain: Object.fromEntries(domains.map((d, i) => [d.label, markerSets[i]])),
    semantics:
      "behavioural fingerprint of the deployed backend (result-level providerDiagnostics with per-leg reasons; calendar mapping-gap text; commodity feed-scope text). These exist only in the Phase-288 revisions of the deployed functions; /version is not a revision surface.",
  };

  const checkout = resolveCheckoutSha();

  const report = {
    schema: "xstarz.development-runtime-smoke/1",
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/development-runtime-smoke.mjs",
    target: {
      origin,
      host: target.host,
      isExpectedDevelopmentDeployment: target.host === EXPECTED_DEV_HOST,
      deployment: process.env.XSTARZ_SMOKE_DEPLOYMENT ?? null,
      version: version.version,
      // A deployment that serves the API but not `/version` is reported as
      // exactly that, never as a version.
      versionProbe: { ok: version.ok, httpStatus: version.httpStatus, apiPlaneReachable: true },
      // What `/version` IS, so no reader turns it into a source revision: it is
      // served by the Convex backend and reports the RUNNING CONVEX BACKEND
      // VERSION (the deployment health signal the Convex dashboard calls the
      // running Convex version, and which self-hosted backends may answer as
      // "unknown"). It was unchanged across the 2026-09-25 development deploys,
      // so it does not track this application's function bundle.
      versionSemantics:
        "running Convex backend version (deployment health signal) — NOT the application function-bundle revision and NOT a git SHA",
      productionTouched: false,
    },
    source: {
      ref: process.env.GITHUB_REF ?? null,
      // Phase 289B — the CHECKOUT is the only thing the harness can vouch for.
      // GITHUB_SHA is the SHA of the ref the workflow file was dispatched from,
      // which is a different commit whenever the smoke is dispatched from one
      // ref while checking out another; conflating them (as an earlier revision
      // of this line did) misreports provenance. Both are reported, labelled.
      harnessCommit: checkout.sha,
      harnessCommitSource: checkout.source,
      dispatchRefSha: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runUrl:
        process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
          ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
    },
    policy: {
      stubsUsed: "none",
      fixturesUsed: "none",
      localhostUsed: false,
      clientEvidenceSent: false,
      localClockUsedForProviderEvidence: false,
      freshSessionPerDomain: true,
      discoveryIsRuntimeTruth: true,
      instrumentSubstitution: "none — every attempt recorded verbatim",
      malformedRequestAttempted: false,
    },
    transport: { calls: transport.state.calls, blocked: transport.state.blocked, lastError: transport.state.lastError },
    providerCircuit: circuit.snapshot(),
    // Phase 289 quota-audit — the run's LOCAL pacing model of its own Twelve Data
    // spend (never the provider's counter, which is not observable) plus every
    // wait it performed, labelled with the request it deferred.
    pacing: pacer.snapshot(),
    // Phase 289B — which backend code paths answered (read from the responses).
    runtimeFingerprint: runtimeFingerprint,
    // Phase 289B — the commodity physical-feed gate, exercised in both directions.
    // Phase 289C-audit — with the scan depth used and the provider-order identity
    // list the depth was applied to.
    energyGateProbe: energyGateProbe,
    // Phase 289E — what the Twelve Data catalog walk returned, as the runtime
    // reported it (verdict, per-catalog completeness/pages/kept, totals).
    discovery: discoveryReport,
    energyGateProbeScanLimit: probeLimit,
    // Phase 303 — the deterministic provider budget plan (computed before any
    // request: exact buckets, then discovery, then domain worst cases) and the
    // macro-measurement gaps this run observed and learned from.
    providerBudgetPlan,
    // Phase 303/304 — everything this run LEARNED from its own attempts (all
    // within-run, none persisted): released-measurement gaps, provider-proven
    // plan-restricted families, technically-insufficient families.
    learnedObservations: {
      macroGapCurrencies: [...observedMacroGaps],
      planRestrictedFamilies: [...observedPlanRestrictedFamilies],
      technicallyInsufficientFamilies: [...observedTechnicallyInsufficientFamilies],
      technicallyInsufficientQuotes: [...observedTechnicallyInsufficientQuotes],
      technicalStrikes: Object.fromEntries(observedTechnicalStrikes),
    },
    domains,
    exactInstruments: exactParsed.ok
      ? exactParsed.specs.map((spec) => ({ provider: spec.provider, assetClass: spec.assetClass, providerInstrumentId: spec.providerInstrumentId }))
      : [],
    summary: Object.fromEntries(domains.map((d) => [d.label, d.headline])),
  };

  // Which build answered, and which code paths are running — one line, because
  // GitHub does not return `notice` annotations through the check-run
  // annotations API and it caps warning/error annotations per step.
  //
  // Provenance is stated for what each value actually is: `/version` is the
  // running Convex backend version (NOT this application's function bundle), the
  // harness commit comes from the CHECKOUT the workflow resolved, and GITHUB_SHA
  // is reported separately as the dispatch ref. The runtime-side fingerprint is
  // behavioural, because no runtime surface answers with our git revision: it
  // reports the fields and sentences that exist only in the Phase-288 revisions
  // of the deployed functions, and says "not-observed" when it did not see them.
  annotate(
    "warning",
    "Smoke target and runtime code paths",
    `informational — target=${origin} · apiPlaneReachable=${version.ok} · /version=${
      version.version ?? "unknown (no answer)"
    } (running Convex backend version, NOT the function-bundle revision) · harnessCommit=${
      checkout.sha ?? `unknown (${checkout.source})`
    } · dispatchRefSha=${process.env.GITHUB_SHA ?? "unknown"} · backendMarkers=providerDiagnostics-legs:${
      runtimeFingerprintOfRun.providerDiagnosticsLegs
    },legs-with-reason:${runtimeFingerprintOfRun.providerDiagnosticsWithReason},calendarMappingGap:${
      runtimeFingerprintOfRun.calendarMappingGapObserved ? "observed" : "not-observed"
    },petroleumFeedScopeText:${
      runtimeFingerprintOfRun.petroleumFeedScopeObserved ? "observed" : "not-observed"
    }${
      runtimeFingerprintOfRun.commodityGroups.length > 0
        ? `,commodityGroups:${runtimeFingerprintOfRun.commodityGroups.join("|")}`
        : ""
    },phase288CodePaths:${phase288CodePathsObserved ? "observed" : "not-observed"},eiaLeg:${
      energyGateProbe?.eiaLegState ?? "not-observed"
    } · pacing=${pacingSummary(pacer.snapshot())} · budget=windows~${
      providerBudgetPlan.estimatedWindows
    },order:${providerBudgetPlan.order.join(">")}`,
  );

  if (report.transport.calls === 0) {
    console.error("COULD NOT LOOK: not one call completed against the deployment. Concluding nothing.");
    process.exit(2);
  }

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const summary = renderSummary(report);
  writeFileSync(outPath.replace(/\.json$/, "") + "-summary.txt", `${summary}\n`);
  if (!quiet) console.log(summary);

  const failed = domains.filter((d) => d.headline === "FAIL");
  if (failed.length > 0) {
    console.error(`FAILED domains: ${failed.map((d) => d.label).join(", ")}`);
    process.exit(1);
  }
  process.exit(0);
}

// Only run when executed directly, so the test suite can import the pure parts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(`smoke crashed: ${sanitize(error?.stack ?? error)}`);
    process.exit(2);
  });
}
