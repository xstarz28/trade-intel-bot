/**
 * Types for `development-runtime-smoke.mjs`.
 *
 * The smoke is plain JavaScript because it must run under `node` on a GitHub
 * runner with no build step, but its contract should still be checkable at the
 * call site. This declaration mirrors the script's exports exactly; the test
 * suite `src/lib/deployment/development-runtime-smoke.phase287.test.ts` is what
 * pins the behaviour, and it fails loudly if the two ever disagree about what
 * the smoke does with real evidence.
 */

/** The development deployment this smoke exists to exercise. */
export const EXPECTED_DEV_HOST: string;
/** The production deployment, named only so the smoke can refuse it. */
export const PRODUCTION_HOST: string;

export type TargetVerdict = {
  ok: boolean;
  origin: string | null;
  host: string | null;
  reason: string | null;
};

/** https + *.convex.cloud + not production + the expected host, or a refusal. */
export function validateTarget(rawUrl: string, allowedHost?: string | null): TargetVerdict;

/** Redact tokens, identities and key-shaped text from anything about to be logged. */
export function sanitize(text: unknown): string;

export type TransportResult = {
  ok: boolean;
  httpStatus: number;
  appError?: string | null;
  transportError?: string;
  value?: unknown;
};

export type Transport = {
  state: { calls: number; lastError: string | null; blocked: boolean };
  action(path: string, args?: unknown, token?: string | null): Promise<TransportResult>;
  query(path: string, args?: unknown, token?: string | null): Promise<TransportResult>;
};

export function createTransport(origin: string, options?: { timeoutMs?: number }): Transport;

/**
 * Phase 289C — where the harness's own commit comes from: an explicit override,
 * then `git rev-parse HEAD` in the checkout, then "unknown" with the reason.
 * Never derived from `/version` (that is the running Convex backend version).
 */
export function resolveCheckoutSha(options?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  runGit?: (cwd: string) => string;
}): { sha: string | null; source: string };

/** The deployment's own build/version endpoint (proves WHICH build answered). */
export function probeVersion(
  origin: string,
  options?: { timeoutMs?: number },
): Promise<{ ok: boolean; httpStatus: number; version: string | null; transportError?: string }>;

/** Harmless API-plane liveness probe (reads and spends nothing). */
export function probeApiLiveness(
  transport: Transport,
): Promise<{ ok: boolean; httpStatus: number; transportError: string | null }>;

/** A new anonymous session. The token is never logged and never written to the artifact. */
export function signInAnonymous(
  transport: Transport,
): Promise<{ ok: boolean; token: string | null; httpStatus: number; appError: string | null }>;

export type DomainSpec = {
  domain: string;
  label: string;
  discovery: "okx" | "twelve-data";
  assetClass: string;
};

/** The asset classes the smoke covers. Taxonomy only — no instrument is named. */
export const DOMAIN_SPECS: readonly DomainSpec[];

/** The app's own discovery→analysis mapping (`assetClassToInstrumentType`). */
export function assetClassToInstrumentType(assetClass: string): string;

export type Candidate = {
  instId?: string;
  providerInstrumentId?: string;
  subType?: string;
  assetClass?: string;
  provider?: string;
  state?: string;
  tradingState?: string;
};

/** Phase 288 — candidates per domain: default and hard ceiling. */
export const DEFAULT_MAX_ATTEMPTS: number;
export const MAX_CANDIDATE_ATTEMPTS: number;

/**
 * Provider-native candidates, provider order preserved, bounded by
 * `min(maxAttempts, ceiling)`. The ceiling defaults to the domain loop's policy
 * bound; a caller with its own disclosed bound (the commodity energy-gate probe)
 * passes it, so the bound it reports is the bound that applied.
 */
export function selectCandidates(
  domainSpec: DomainSpec,
  discovery: unknown,
  maxAttempts: number,
  ceiling?: number,
): Candidate[];

/** One catalog's own fetch report, exactly as the provider adapter published it. */
export type CatalogReport = {
  path: string | null;
  assetClass: string | null;
  completeness: string | null;
  pagesFetched: number | null;
  totalDiscovered: number | null;
  failedPage: number | null;
};

export type Discovery = {
  success: boolean;
  provider?: string;
  instruments: Candidate[];
  error: string | null;
  warnings?: string[];
  /** Phase 288 — the adapter's per-catalog report; absent on OKX discovery. */
  completeness?: string | null;
  pagesFetched?: number | null;
  totalDiscovered?: number | null;
  catalogs?: CatalogReport[];
};

export function discoverOkx(transport: Transport): Promise<Discovery>;
export function discoverTwelveData(transport: Transport, token: string | null): Promise<Discovery>;

/** Why a discovery produced no candidate — built only from the provider's report. */
export function discoveryDiagnosis(discovery: Discovery | null, assetClass: string): string | null;

/** Routing fields only — the request can carry no client-supplied evidence. */
export function buildAnalysisInput(
  domainSpec: DomainSpec,
  candidate: Candidate,
  options?: { timeframe?: string; tradingStyle?: string },
): { input: Record<string, unknown> };

export type Evidence = {
  market: {
    present: boolean;
    price: number | null;
    observedAt: number | null;
    source: string | null;
    provider: string | null;
    providerInstrumentId: string | null;
    dataPoints: number | null;
  };
  technical: {
    present: boolean;
    available: boolean;
    bias: string | null;
    confidence: string | null;
    summary: string | null;
    advanced: {
      evidenceClasses: string[];
      confluence: number;
      conflicts: number;
      unavailableMetrics: unknown[];
    } | null;
  };
  fundamental: {
    present: boolean;
    available: boolean;
    domain: string | null;
    provider: string | null;
    instrumentId: string | null;
    observedAt: number | null;
    reportingPeriod: string | null;
    state: string | null;
    confidence: string | null;
    directionalBias: string | null;
    periodsCount: number | null;
    /**
     * Phase 289B — the runtime's own market classification for a commodity
     * instrument (the field the physical-feed gate reads) and whether
     * petroleum-derived metrics were consumed for it.
     */
    commodityProfile: { group: string | null; classificationSource: string | null } | null;
    commodityMetrics: { inventoryLatest: number | null; keys: string[] } | null;
    limitations: string[];
    /** Phase 289 — the delivered domain dimensions with their OWN status. */
    dimensions: { name: string | null; status: string | null; role: string | null }[];
    evidenceProviders: string[];
    summary: string | null;
  };
  unified: {
    present: boolean;
    available: boolean;
    state: string | null;
    agreement: string | null;
    confluenceReason: string | null;
    confidence: string | null;
    actionable: boolean;
    actionabilityReason: string | null;
    limitations: string[];
  };
  provenance: {
    market: { provider: string | null; providerInstrumentId: string | null; source: string | null; observedAt: number | null };
    fundamental: {
      provider: string | null;
      instrumentId: string | null;
      observedAt: number | null;
      reportingPeriod: string | null;
      evidenceProviders: string[];
    };
    contexts: {
      treasury: ContextProvenance | null;
      cot: ContextProvenance | null;
      eia: ContextProvenance | null;
      derivatives: { available: boolean; observedAt: number | null } | null;
    };
  };
  diagnostics: {
    provider: string | null;
    dataset: string | null;
    mode: string | null;
    acquired: boolean;
    attached: boolean;
    usedByEngine: boolean;
    reason: string | null;
  }[];
  dataCompleteness: string | null;
  recommendation: string | null;
};

/** A domain context's own provenance, as the runtime reports it. */
export type ContextProvenance = {
  available: boolean;
  source: string | null;
  fetchedAt: number | null;
  freshness: string | null;
};

/** Verbatim read of the deployed runtime's own result. Absent stays null. */
export function readResultEvidence(result: unknown): Evidence;

/**
 * Only the diagnostics are read, so a caller that has just those (a test, or a
 * record reconstructed from the artifact) can use these helpers too.
 */
export type LegDiagnosticSource = { diagnostics?: Evidence["diagnostics"] } | null | undefined;

/**
 * Phase 289 — one bounded line carrying a domain record's own evidence shape
 * (dimension statuses, the engine's fundamental text, per-leg flags with their
 * classified reasons, the discovery report), so a run stays readable without the
 * artifact. Returns null when there is nothing to report.
 */
export function evidenceDigest(record: unknown): string | null;

/** Phase 289B — the runtime's own market + petroleum-evidence read for one instrument. */
export type CommodityMarket = {
  group: string | null;
  classificationSource: string | null;
  inventories: string | null;
  inventoryLatest: number | null;
  eiaEvidenceItems: number;
  petroleumFeedScopeText: boolean;
};
export function commodityMarketOf(evidence: unknown): CommodityMarket;

/** Phase 289B — which backend code paths answered, read from the response. */
export type RuntimeMarkers = {
  diagnostics: number;
  diagnosticsWithReason: number;
  commodityGroup: string | null;
  commodityInventories: string | null;
  commodityInventoryLatest: number | null;
  eiaEvidenceItems: number;
  petroleumFeedScopeObserved: boolean;
  calendarMappingGapObserved: boolean;
};
export function runtimeMarkers(evidence: unknown): RuntimeMarkers;

/** Phase 289C-audit — probe scan depth (bounded, provider order, no whitelist). */
export const ENERGY_PROBE_CANDIDATE_LIMIT: number;
export const ENERGY_PROBE_MAX_CANDIDATE_LIMIT: number;
export const ENERGY_PROBE_REPORT_IDENTITIES: number;
export const ENERGY_PROBE_PAUSE_MS: number;

/* ------------------------------------------------------------------ *
 * Phase 289 quota-audit — Twelve Data minute-window pacing
 *
 * A SCHEDULING device only: identity, provider order, selection, completeness,
 * classification and the petroleum feed gate are untouched. It waits for the
 * provider's next wall-clock minute when the LOCAL (conservative) model of this
 * run's own spend says the current one cannot serve the next request. It never
 * claims a credit count: the transports keep `{ok,status,json}` only, so the
 * provider's `api-credits-*` headers are not observable.
 * ------------------------------------------------------------------ */

/** Twelve Data's documented weight for catalogs, /time_series and /quote. */
export const TWELVE_DATA_CREDIT_PER_REQUEST: number;
/** The per-minute allowance of the plan the deployment's own 429 named. */
export const TWELVE_DATA_MINUTE_CREDITS: number;
/** One provider minute (Twelve Data resets on the wall-clock minute). */
export const TWELVE_DATA_WINDOW_MS: number;
/** Conservative worst-case credit fan-out of ONE Twelve Data analysis. */
export const TWELVE_DATA_ANALYSIS_MAX_CREDITS: number;
export const PACING_DEFAULT_MAX_WAIT_MS: number;
export const PACING_MAX_WAIT_MS_CAP: number;
export const PACING_LIMIT_CAP: number;
export const PACING_WINDOW_MS_CAP: number;

export type PacingGate = {
  waitedMs: number;
  deferred: boolean;
  exhausted: boolean;
  windowStartAt: number | null;
  modelledCredits?: number;
  reason?: string;
};

/** A gate that applies to nothing (another provider, or pacing switched off). */
export const PACING_NOT_APPLIED: PacingGate;

/** The next wall-clock window boundary strictly after `nowMs`. */
export function nextTwelveDataWindowStart(nowMs: number, windowMs?: number): number;

/** Bounded pacing knobs: CLI flag first, environment second, `windowMs 0` = off. */
export function resolvePacingConfig(options?: {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
}): { windowMs: number; limit: number; maxTotalWaitMs: number };

/** A catalog report's own counts, every field optional (only counts are read). */
export type CatalogCounts = {
  path?: string | null;
  assetClass?: string | null;
  completeness?: string | null;
  pagesFetched?: number | null;
  totalDiscovered?: number | null;
  failedPage?: number | null;
};

/**
 * The run's OWN discovery spend, from the provider's own catalog report. Only the
 * counts are read, so the input is the structural subset it consumes.
 */
export function discoveryCreditSpend(
  discovery: { pagesFetched?: number | null; catalogs?: CatalogCounts[] | null } | null | undefined,
): number;

export type TwelveDataQuotaPacer = {
  enabled: boolean;
  limit: number;
  windowMs: number;
  maxTotalWaitMs: number;
  charge(credits: number, label?: string | null): number;
  reserve(options?: { cost?: number; label?: string | null }): Promise<PacingGate>;
  snapshot(): {
    enabled: boolean;
    windowMs: number;
    limit: number;
    maxTotalWaitMs: number;
    modelledCredits: number;
    windowStartAt: number | null;
    charges: { label: string | null; credits: number; windowStartAt: number | null }[];
    waits: { label: string | null; waitedMs: number; windowStartAt: number | null }[];
    waitsCount: number;
    totalWaitMs: number;
    exhaustedReason: string | null;
    model: string;
  };
};

/**
 * The local, conservative model of this run's Twelve Data spend over wall-clock
 * minute windows. `now`/`sleep` are injectable so the policy is unit-testable
 * with a fake clock.
 */
export function createTwelveDataQuotaPacer(options?: {
  limit?: number;
  windowMs?: number;
  maxTotalWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}): TwelveDataQuotaPacer;

/** Reserve a slot, or do nothing when there is no pacer. */
export function reserveAnalysisSlot(
  pacer: TwelveDataQuotaPacer | null | undefined,
  options?: { cost?: number; label?: string | null },
): Promise<PacingGate>;

export type PacingDelta = {
  enabled: boolean;
  waits: number;
  waitedMs: number;
  deferred: string[];
} | null;

/** One caller's own pacing, as a delta over the shared pacer. */
export function pacingDelta(
  before: { waitsCount?: number; waits?: unknown[] } | null,
  after: { waitsCount?: number; waits?: unknown[]; enabled?: boolean; totalWaitMs?: number } | null,
): PacingDelta;

/** One bounded sentence about the run's pacing. */
export function pacingSummary(pacing: unknown): string;

/**
 * Phase 289B — exercise the commodity physical-feed gate against the deployed
 * runtime, in both directions, naming no instrument: candidates come from the
 * deployment's discovery, each is analysed under its own native id, and the
 * classification is read back from the deployed runtime's own answer.
 */
export function probeEnergyGate(deps: {
  spec: DomainSpec;
  candidates: Candidate[];
  transport: Transport;
  circuit: ProviderCircuit;
  sessionFor(label: string): Promise<{ ok: boolean; token?: string | null; reason?: string | null }>;
  seeds?: Record<string, unknown>[];
  candidateLimit?: number;
  /**
   * Phase 289 quota-audit — the shared minute-window pacer. When supplied it
   * governs WHEN each candidate's analysis may leave; the circuit check stays
   * first, so a real 429 is never waited out or retried.
   */
  pacer?: TwelveDataQuotaPacer | null;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
}): Promise<{
  candidateLimit: number;
  candidatesConsidered: string[];
  classified: number;
  stopReason: string | null;
  samples: Record<string, unknown>[];
  verdict: "PASS" | "UNAVAILABLE" | "FAIL";
  summary: string;
  failures: string[];
  /** The pacing THIS probe did (a delta over the shared pacer), or null. */
  pacing: PacingDelta;
}>;

/** Phase 289B — the commodity energy-gate probe's verdict over the samples collected. */
export function energyGateVerdict(samples: unknown): {
  verdict: "PASS" | "UNAVAILABLE" | "FAIL";
  summary: string;
  control: Record<string, unknown> | null;
  energy: Record<string, unknown> | null;
  failures: string[];
};

/** The failing legs' own diagnoses as one bounded line, or null. */
export function failingLegText(evidence: LegDiagnosticSource, limit?: number): string | null;
/** Headline reason plus the failing legs' own diagnoses (bounded). */
export function withFailingLegs(headline: string, evidence: LegDiagnosticSource): string;

/** Most severe verdict of a domain's attempts (FAIL > UNAVAILABLE > PASS). */
export function mostSevereVerdict(
  current: { headline: "PASS" | "UNAVAILABLE" | "FAIL"; reason: string | null } | null,
  candidate: { headline: "PASS" | "UNAVAILABLE" | "FAIL"; reason: string | null },
): { headline: "PASS" | "UNAVAILABLE" | "FAIL"; reason: string | null };

export type DomainVerdict = {
  headline: "PASS" | "UNAVAILABLE" | "FAIL";
  reason: string | null;
  status: string | null;
  evidence?: Evidence;
};

/** PASS only with real market + technical + domain-native fundamental + unified evidence. */
export function classifyDomain(args: {
  response: unknown;
  transportError?: string | null;
}): DomainVerdict;

export type ProviderCircuit = {
  trip(provider: string | null, reason: string, kind: string): void;
  isTripped(provider: string | null): { reason: string; kind: string } | null;
  snapshot(): Record<string, { reason: string; kind: string }>;
  /**
   * Classify a failure, attributing it to the provider that reported it: the
   * transport's own error text plus only the legs belonging to this provider.
   */
  classify(
    provider: string | null,
    text: string | null,
    legs?: { provider?: string | null; dataset?: string | null; acquired?: boolean; reason?: string | null }[],
  ): string | null;
};

/** A rate limit or a missing credential stops REPEATED requests for that provider. */
export function createProviderCircuit(): ProviderCircuit;

/** Escape the Actions command protocol's separators and cap the length. */
export function escapeAnnotation(text: unknown): string;

export function renderSummary(report: unknown): string;
