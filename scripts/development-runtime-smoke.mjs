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
 *     [--max-attempts 2] [--allow-host <host>] [--quiet]
 *
 * Exit codes:
 *   0  no domain FAILED (PASS and UNAVAILABLE are both non-failures)
 *   1  at least one domain FAILED
 *   2  the run could not look — the deployment was unreachable, so nothing
 *      about the runtime may be concluded from it ("could not look" is never
 *      reported as "nothing to see")
 */

import { writeFileSync } from "node:fs";
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

  async function call(kind, path, args, token = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    action: (path, args, token) => call("action", path, args, token),
    query: (path, args, token) => call("query", path, args, token),
  };
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
export function selectCandidates(domainSpec, discovery, maxAttempts) {
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
  return ordered.slice(0, Math.max(1, Math.min(maxAttempts, 3)));
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

/** Twelve Data reference catalogs — metadata only, needs the server-side key. */
export async function discoverTwelveData(transport, token) {
  const r = await transport.action("marketData:discoverTwelveDataInstruments", {}, token);
  if (!r.ok) return { success: false, instruments: [], error: r.appError ?? r.transportError ?? "discovery failed" };
  const value = r.value ?? {};
  return {
    success: value.success === true,
    provider: value.provider ?? "twelve-data",
    instruments: Array.isArray(value.instruments) ? value.instruments : [],
    error: value.error ?? null,
    warnings: Array.isArray(value.warnings) ? value.warnings.map(sanitize) : [],
  };
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
    evidenceProviders: Array.isArray(fa?.dimensions)
      ? [
          ...new Set(
            fa.dimensions
              .flatMap((d) => (Array.isArray(d?.evidence) ? d.evidence : []))
              .map((e) => e?.provider)
              .filter((p) => typeof p === "string"),
          ),
        ]
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

  return {
    market,
    technical,
    fundamental,
    unified,
    provenance,
    dataCompleteness: typeof r.dataCompleteness === "string" ? r.dataCompleteness : null,
    recommendation: typeof r.recommendation === "string" ? r.recommendation : null,
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
      reason: `no provider market evidence with a provider observation instant — runtime said: ${reason}`,
      status,
      evidence,
    };
  }

  if (!evidence.technical.available || !evidence.unified.present) {
    const reason = firstReason(evidence.unified.limitations, evidence.technical.summary);
    return {
      headline: "UNAVAILABLE",
      reason: `market evidence is real but technical/unified evidence is not available — ${reason ?? "no reason given"}`,
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
      reason: `market + technical + unified are real; the domain-native FUNDAMENTAL assessment is unavailable — ${reason ?? "no reason given"}`,
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

/* ------------------------------------------------------------------ *
 * Rate-limit discipline — a rate limit stops REPEATS, not the run
 * ------------------------------------------------------------------ */

const RATE_LIMIT_RE = /\b429\b|rate.?limit|RATE_LIMITED|too many requests/i;
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
    classify(provider, text) {
      if (!provider) return null;
      if (RATE_LIMIT_RE.test(text ?? "")) {
        this.trip(provider, `rate limited: ${sanitize(text)}`, "RATE_LIMITED");
        return "RATE_LIMITED";
      }
      if (CREDENTIAL_RE.test(text ?? "")) {
        this.trip(provider, `credentials: ${sanitize(text)}`, "CREDENTIAL_REQUIRED");
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
  lines.push(`deployed build: ${report.target.version ?? "unknown (no /version answer)"}`);
  lines.push(`source commit : ${report.source.commit ?? "unknown"}`);
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
    lines.push("");
  }
  lines.push("──────────────────────────────────────────────────────────────────");
  for (const record of report.domains) lines.push(`${record.label} = ${record.headline}`);
  lines.push("──────────────────────────────────────────────────────────────────");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

function flag(name, argv) {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? "") : null;
}

async function run() {
  const argv = process.argv.slice(2);
  const targetUrl = flag("--url", argv) ?? `https://${EXPECTED_DEV_HOST}`;
  const allowedHost = flag("--allow-host", argv);
  const outPath = flag("--out", argv) ?? "development-runtime-smoke.json";
  const domainsArg = flag("--domains", argv);
  const maxAttempts = Number.parseInt(flag("--max-attempts", argv) ?? "1", 10) || 1;
  const quiet = argv.includes("--quiet");

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

  const transport = createTransport(origin);
  const circuit = createProviderCircuit();

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

  // One discovery per provider per run: the reference catalogs are shared by
  // three domains and re-asking would be a repeated request for nothing.
  const okxDiscovery = specs.some((s) => s.discovery === "okx") ? await discoverOkx(transport) : null;
  let twelveDiscovery = null;
  let twelveDiscoveryError = null;

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
        const found = await discoverTwelveData(transport, session.token);
        twelveDiscovery = found;
        if (found.success !== true) {
          twelveDiscoveryError = found.error ?? "discovery returned no instruments";
          circuit.classify("twelve-data", twelveDiscoveryError);
        }
      }
      discovery = twelveDiscovery;
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

    const candidates = selectCandidates(spec, discovery, maxAttempts);
    if (candidates.length === 0) {
      record.reason = `discovery succeeded but listed no live ${spec.assetClass} instrument`;
      record.headline = "UNAVAILABLE";
      record.legs.market = "not attempted (no discovered instrument)";
      record.attempts.push({ step: "discovery", outcome: "empty", reason: record.reason });
      annotate("warning", `${spec.label} UNAVAILABLE`, record.reason);
      domains.push(record);
      continue;
    }

    // ── one request per candidate, bounded, no repeats after a rate limit
    for (const [index, candidate] of candidates.entries()) {
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

      const request = buildAnalysisInput(spec, candidate);
      const started = Date.now();
      const response = await transport.action("protectedAnalysis:runProtectedAnalysis", request, session.token);
      const elapsedMs = Date.now() - started;

      const verdict = classifyDomain({
        response: response.ok ? response.value : null,
        transportError: response.ok ? null : (response.appError ?? response.transportError ?? "request failed"),
      });

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
      });

      if (verdict.evidence) {
        const e = verdict.evidence;
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
        };
      } else {
        record.legs = {
          market: "not delivered",
          technical: "not delivered",
          fundamental: "not delivered",
          unified: "not delivered",
        };
      }

      record.headline = verdict.headline;
      record.reason = verdict.reason;

      // A provider that just refused on capacity/credentials earns no retry.
      circuit.classify(
        provider,
        `${verdict.reason ?? ""} ${response.appError ?? ""} ${record.evidence?.unified?.limitations?.join(" ") ?? ""}`,
      );

      const after = await transport.query("entitlements:getMyEntitlement", {}, session.token);
      record.entitlement = {
        ...record.entitlement,
        charged: response.value?.entitlement?.charged ?? null,
        remainingAfter: after.value?.remaining ?? response.value?.entitlement?.remaining ?? null,
      };

      if (verdict.headline === "PASS" || verdict.evidence?.market?.observedAt) break;
    }

    const level = record.headline === "PASS" ? "notice" : record.headline === "UNAVAILABLE" ? "warning" : "error";
    annotate(
      level,
      `${record.label} ${record.headline}`,
      `${record.provider ?? "?"} · ${record.providerInstrumentId ?? "?"} · observedAt=${record.observedAt ?? "none"} · ${record.reason ?? ""}`,
    );
    domains.push(record);
  }

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
      productionTouched: false,
    },
    source: {
      ref: process.env.GITHUB_REF ?? null,
      commit: process.env.GITHUB_SHA ?? null,
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
    domains,
    summary: Object.fromEntries(domains.map((d) => [d.label, d.headline])),
  };

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
