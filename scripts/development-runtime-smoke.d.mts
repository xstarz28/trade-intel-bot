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

/** Provider-native candidates, provider order preserved, bounded by maxAttempts. */
export function selectCandidates(
  domainSpec: DomainSpec,
  discovery: unknown,
  maxAttempts: number,
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

/** Phase 289B — probe bounds. */
export const ENERGY_PROBE_CANDIDATE_LIMIT: number;
export const ENERGY_PROBE_PAUSE_MS: number;

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
