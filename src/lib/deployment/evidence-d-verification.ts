/**
 * Phase 247 — Evidence D: production live provider verification.
 *
 * ── What this file decides, and what it refuses to decide ────────────────────
 *
 * The release gate has one prerequisite whose truth lives entirely outside this
 * repository: `EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION` — "every required
 * provider answered in production, observed live". Until this phase, the gate
 * read a filed JSON file and accepted it on four fields (`verified`, `source`,
 * `environment`, `observedAt`) plus a provider list. That is enough to REFUSE a
 * claim written in prose and not enough to distinguish a real production
 * observation from a well-shaped fixture, which is the only distinction the
 * prerequisite is about. This module is that distinction, as a decision.
 *
 * The central contract, in the operator's words:
 *
 *   PRODUCTION LIVE EVIDENCE
 *     != FIXTURE DATA
 *     != HISTORICAL DATA
 *     != LOCAL SUCCESS
 *     != PROVIDER CONFIGURATION PRESENCE
 *
 * ── The rules, and who owns each one ─────────────────────────────────────────
 *
 *   - The required provider set comes from `getAllProviders()` — the same
 *     registry `release-current-state.ts` binds `requiredProviders` to. There is
 *     no second list here, and a provider added to the product is covered the
 *     moment it is registered.
 *   - The observation instant is PROVIDER-owned (`observedAt`) and the receipt
 *     instant is CLIENT-owned (`receivedAt`). Freshness is computed from the
 *     observation, never from the receipt: a late local timestamp cannot make an
 *     old observation current, and a missing observation is never back-filled
 *     from a receipt.
 *   - Acquisition mode is explicit and only a genuine new observation counts
 *     (`isNewObservation` from Phase 178c — not a second copy of that rule).
 *   - Provider identity is the canonical id, and the provider-native instrument
 *     id must be the one the instrument registry documents for that pair. A
 *     different provider's documented native id is provider substitution, and a
 *     returned symbol that is not the requested one is symbol substitution.
 *   - Provenance must record an external live call: transport, host and status.
 *     Loopback, mock, fixture, stub, fake, `example.*` and reserved test hosts are
 *     refused by name — a passing run against a stub is worse than no run.
 *   - The package carries no credential: any field whose name could hold one
 *     refuses the whole package before it is read further.
 *   - This module performs NO observation of its own. It never contacts a
 *     provider, never reads a credential, never writes, and never imports a
 *     network or process module. It is pure: same input, same decision.
 *
 * ── The states an operator is shown ─────────────────────────────────────────
 *
 * Every refusal carries a code and a sentence; the STATE is a deterministic
 * summary chosen by `EVIDENCE_D_STATE_PRECEDENCE` so that reordering records
 * cannot change it. `EVIDENCE_D_COMPLETE` means the package is admissible for
 * evaluation by the release gate — it does not mean the release is admitted,
 * and nothing here can produce that.
 */
import { getAllProviders } from "@/lib/data/universal/providers";
import { getAllInstrumentIds, getProviderSymbol, resolveInstrument } from "@/lib/data/universal/instruments";
import { DATASET_FRESH_MS, DATASET_TTL_MS } from "@/lib/data/provider-cache";
import { isNewObservation, type AcquisitionMode } from "@/lib/data/acquisition-provenance";
import { evidenceDigest } from "./a2-rehearsal";
import { RELEASE_PREREQUISITES } from "./release-gate";
import type { EvidenceEnvironment, EvidenceRecord } from "./release-gate";

/* ── the prerequisite, read from the canonical manifest ─────────────────────── */

/**
 * The prerequisite this module is about, found by its binding rather than named
 * twice. If the manifest ever carries zero or two provider-set prerequisites the
 * contract is broken and evaluation refuses: a harness that silently guessed
 * which one it was checking would be checking whichever one it liked.
 */
const PROVIDER_BOUND = RELEASE_PREREQUISITES.filter((entry) => entry.binding === "provider-set");

export const EVIDENCE_D_CONTRACT_PROBLEMS: readonly string[] = (() => {
  const problems: string[] = [];
  if (PROVIDER_BOUND.length !== 1) {
    problems.push(
      `expected exactly one provider-set prerequisite in the release manifest, found ${PROVIDER_BOUND.length}`,
    );
  }
  return problems;
})();

export const EVIDENCE_D_PREREQUISITE = PROVIDER_BOUND[0]?.id ?? "";
/** The environment the prerequisite requires — read, not restated. */
export const EVIDENCE_D_ENVIRONMENT: EvidenceEnvironment =
  PROVIDER_BOUND[0]?.requiredEnvironment ?? "production";
/** The freshness window the gate applies — read, not restated. */
export const EVIDENCE_D_MAX_AGE_MS: number | null = PROVIDER_BOUND[0]?.maxAgeMs ?? null;

/** The tag a filed package must carry. */
export const EVIDENCE_D_SCHEMA = "phase247.evidence-d/v1";
export const EVIDENCE_D_HANDOFF_SCHEMA = "phase247.evidence-d-handoff/v1";

/* ── the canonical provider set ─────────────────────────────────────────────── */

/** Every registered provider id, in registry order, duplicates preserved. */
export function registryProviderIds(): string[] {
  return getAllProviders().map((provider) => provider.id);
}

/** The canonical required set: sorted, de-duplicated, derived from the registry. */
export function canonicalProviderSet(): string[] {
  return [...new Set(registryProviderIds())].sort();
}

/**
 * The required providers, as an operator reads them. Derived at module load and
 * asserted unique in the suite: the registry is the only source.
 */
export const REQUIRED_PROVIDER_IDS: readonly string[] = canonicalProviderSet();

export interface ProviderSetReport {
  /** The set as it was submitted (order preserved). */
  submitted: readonly string[];
  /** The canonical order an operator should read. */
  canonical: readonly string[];
  duplicates: readonly string[];
  unknown: readonly string[];
  missing: readonly string[];
  /** True when nothing was submitted at all — never coverage. */
  empty: boolean;
  ok: boolean;
}

/**
 * Does this submitted set cover the required providers exactly?
 *
 * An empty set is not coverage, a duplicate is not extra coverage, and an id the
 * registry does not carry is not a provider. The canonical registry is the
 * parameter so a test can exercise the same rules against a different registry.
 */
export function checkProviderSet(
  submitted: readonly string[],
  canonical: readonly string[] = REQUIRED_PROVIDER_IDS,
): ProviderSetReport {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  const known = new Set(canonical);
  for (const id of submitted) {
    if (typeof id !== "string" || !known.has(id)) unknown.push(String(id));
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  const missing = canonical.filter((id) => !seen.has(id));
  return {
    submitted: [...submitted],
    canonical: [...canonical],
    duplicates: [...new Set(duplicates)].sort(),
    unknown: [...new Set(unknown)].sort(),
    missing: [...missing].sort(),
    empty: submitted.length === 0,
    ok:
      submitted.length > 0 &&
      duplicates.length === 0 &&
      unknown.length === 0 &&
      missing.length === 0,
  };
}

/* ── the dataset vocabulary ─────────────────────────────────────────────────── */

/**
 * The datasets this repository names, taken from the cache that owns their
 * cadences. There is no second vocabulary: a package naming a dataset outside
 * this set is refused rather than mapped onto a similar-looking one.
 *
 * The repository declares no provider→dataset map, and this module does not
 * invent one. What it can check is that the dataset is a real dataset, that it is
 * the same dataset across the package, and that a provider is covered by exactly
 * one record — the operator's own submission is the claim about which dataset was
 * requested, and the completeness rule below is at provider granularity.
 */
export const EVIDENCE_D_DATASETS: readonly string[] = Object.keys(DATASET_TTL_MS).sort();

/** The provider that a dataset's cadence is known for — informational only. */
export function datasetCadence(dataset: string): { ttlMs: number; freshMs: number } | null {
  const ttl = (DATASET_TTL_MS as Record<string, number>)[dataset];
  const fresh = (DATASET_FRESH_MS as Record<string, number>)[dataset];
  if (typeof ttl !== "number" || typeof fresh !== "number") return null;
  return { ttlMs: ttl, freshMs: fresh };
}

/* ── documented provider hosts ──────────────────────────────────────────────── */

/**
 * The hosts this repository documents for the providers it calls.
 *
 * These are NOT invented here: each one is the host of the URL builder in
 * `src/lib/data/universal/live/client.ts`, and the suite extracts that file's
 * hosts and asserts equality — so a drifted constant fails a test instead of
 * silently accepting another provider's host. Providers without a documented host
 * are listed as such and are not given one.
 */
export const DOCUMENTED_PROVIDER_HOSTS: Readonly<Record<string, string>> = {
  "twelve-data": "api.twelvedata.com",
  "alpha-vantage": "www.alphavantage.co",
  coingecko: "api.coingecko.com",
  okx: "www.okx.com",
};

/**
 * Providers this repository's instrument registry actually maps: for these, a
 * record without an instrument cannot be matched to anything, because the
 * registry knows which native id belongs to the pair. The rest carry global
 * series (a published report) or native ids the registry does not map, and a
 * missing instrument there is reported rather than invented.
 */
export const INSTRUMENT_SCOPED_PROVIDERS: readonly string[] = REQUIRED_PROVIDER_IDS.filter((id) =>
  getAllInstrumentIds().some((instrument) => getProviderSymbol(instrument, id) !== null),
);

/** Providers whose host this repository does not document. */
export const HOST_NOT_DOCUMENTED: readonly string[] = REQUIRED_PROVIDER_IDS.filter(
  (id) => !(id in DOCUMENTED_PROVIDER_HOSTS),
);

/**
 * Hosts that cannot be a production provider: loopback, private ranges, and the
 * reserved names a mock, stub or fixture transport uses. A status code from any
 * of these is a statement about a test double.
 */
const NON_PRODUCTION_HOSTS: readonly RegExp[] = [
  /^localhost$/,
  /\.localhost$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^::1$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/,
  /\.internal$/,
  /\.test$/,
  /\.invalid$/,
  /\.example$/,
  /^example\.(com|org|net)$/,
  /^mock/,
  /^fixture/,
  /^stub/,
  /^fake/,
  /^test[-.]/,
];

export function isNonProductionHost(host: string): boolean {
  const normalised = host.trim().toLowerCase();
  if (normalised.length === 0) return true;
  return NON_PRODUCTION_HOSTS.some((pattern) => pattern.test(normalised));
}

/* ── the record contract ────────────────────────────────────────────────────── */

export interface EvidenceDProvenance {
  /** The transport the provider call actually used. Only `https` is external. */
  transport: string;
  /** The host that answered. Loopback and mock hosts are refused. */
  host: string;
  /** The HTTP status the provider returned. A non-2xx answer is not an answer. */
  status: number;
  /** Opaque correlation id, when the provider returned one. Never a credential. */
  requestId?: string;
}

export interface EvidenceDCandidateBinding {
  commit?: string;
  ref?: string;
}

export interface EvidenceDRecord {
  /** Canonical provider id — exactly one of the registry's ids. */
  provider: string;
  /** Provider dataset id from the canonical vocabulary. */
  dataset: string;
  /** Canonical instrument the observation is about, or null for a global series. */
  instrument: string | null;
  /** The provider-native id the request used (never a credential). */
  providerInstrumentId: string | null;
  /** The symbol the provider itself returned, when its payload named one. */
  returnedSymbol?: string | null;
  /** How the value came to exist (`observed-now`, `cache-reused`, …). */
  mode: string;
  environment: string;
  source: string;
  /** PROVIDER-owned instant: when the provider observed the value. */
  observedAt: number;
  /** CLIENT-owned instant: when this side received the answer. */
  receivedAt: number;
  /** How the answer arrived. Required: an unprovenanced answer proves nothing. */
  provenance?: EvidenceDProvenance;
  /** A record that declares itself historical is historical, whatever it asserts. */
  historical?: boolean;
  /** A record that declares itself a fixture is a fixture. */
  fixture?: boolean;
  /** Same, for the synthetic marker the other phases use. */
  synthetic?: boolean;
  candidate?: EvidenceDCandidateBinding;
  [key: string]: unknown;
}

export interface EvidenceDPackage {
  schema: string;
  environment: string;
  source: string;
  verified: boolean;
  candidate?: EvidenceDCandidateBinding;
  /** When the operator assembled the package (client-owned, never the observation). */
  verifiedAt?: number;
  records: readonly EvidenceDRecord[];
  fixture?: boolean;
  synthetic?: boolean;
  /** Deterministic digest over this package's own content, minus the digest. */
  digest?: string;
  [key: string]: unknown;
}

/** The fields a record must carry to be considered at all. */
export const REQUIRED_RECORD_FIELDS: readonly string[] = [
  "provider",
  "dataset",
  "instrument",
  "providerInstrumentId",
  "mode",
  "environment",
  "source",
  "observedAt",
  "receivedAt",
  "provenance",
];

/**
 * Field names that could hold a credential value. A package carrying one is
 * refused whole: the harness will not read, compare, print or store a secret,
 * and it will not accept a package that asked it to.
 */
const FORBIDDEN_KEY_TOKENS: readonly string[] = [
  "apikey",
  "api_key",
  "xapikey",
  "token",
  "bearer",
  "authorization",
  "password",
  "secret",
  "privatekey",
  "credential",
  "value",
];

function normaliseKey(key: string): string {
  return key.trim().toLowerCase().replace(/[-_\s]/g, "");
}

/** Deep scan for a field that could carry a credential, anywhere in the package. */
export function credentialBearingKeys(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => found.push(...credentialBearingKeys(entry, `${path}[${index}]`)));
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalised = normaliseKey(key);
    if (FORBIDDEN_KEY_TOKENS.some((token) => normalised === normaliseKey(token) || normalised.endsWith(token))) {
      found.push(`${path}.${key}`);
      continue;
    }
    found.push(...credentialBearingKeys(entry, `${path}.${key}`));
  }
  return found;
}

/* ── the states ─────────────────────────────────────────────────────────────── */

export type EvidenceDState =
  | "EVIDENCE_D_COMPLETE"
  | "MISSING_PROVIDER"
  | "STALE_PROVIDER_EVIDENCE"
  | "INVALID_PROVIDER_IDENTITY"
  | "HISTORICAL_NOT_LIVE"
  | "FIXTURE_NOT_LIVE"
  | "WRONG_ENVIRONMENT"
  | "MISSING_PROVENANCE"
  | "FUTURE_OBSERVATION"
  | "CONTRADICTORY_EVIDENCE"
  | "INVALID_EVIDENCE";

/**
 * The state an operator sees, chosen by this order rather than by which record
 * happened to be evaluated first. Reordering the records cannot change it, and a
 * record that fails two rules reports both while the state stays deterministic.
 */
export const EVIDENCE_D_STATE_PRECEDENCE: readonly EvidenceDState[] = [
  "INVALID_EVIDENCE",
  "FIXTURE_NOT_LIVE",
  "HISTORICAL_NOT_LIVE",
  "WRONG_ENVIRONMENT",
  "MISSING_PROVENANCE",
  "FUTURE_OBSERVATION",
  "STALE_PROVIDER_EVIDENCE",
  "CONTRADICTORY_EVIDENCE",
  "INVALID_PROVIDER_IDENTITY",
  "MISSING_PROVIDER",
  "EVIDENCE_D_COMPLETE",
];

/**
 * Refusal code → the state it reports. Exported and asserted (in this phase's
 * suite) to cover every code the validator can emit: an unmapped code would
 * silently degrade to `INVALID_EVIDENCE`, which is how a specific refusal turns
 * into a vague one.
 */
export const EVIDENCE_D_CODE_STATES: Readonly<Record<string, EvidenceDState>> = {
  NOT_AN_OBJECT: "INVALID_EVIDENCE",
  WRONG_SCHEMA: "INVALID_EVIDENCE",
  NOT_VERIFIED: "INVALID_EVIDENCE",
  WRONG_SOURCE: "INVALID_EVIDENCE",
  NO_RECORDS: "INVALID_EVIDENCE",
  NO_RECORD_ARRAY: "INVALID_EVIDENCE",
  RECORD_NOT_AN_OBJECT: "INVALID_EVIDENCE",
  NO_DIGEST: "INVALID_EVIDENCE",
  DIGEST_MISMATCH: "INVALID_EVIDENCE",
  CARRIES_CREDENTIAL_VALUE: "INVALID_EVIDENCE",
  UNKNOWN_DATASET: "INVALID_EVIDENCE",
  MISSING_OBSERVATION: "INVALID_EVIDENCE",
  OBSERVATION_NOT_A_NUMBER: "INVALID_EVIDENCE",
  RECEIPT_NOT_A_NUMBER: "INVALID_EVIDENCE",
  CANDIDATE_MISMATCH: "INVALID_EVIDENCE",
  NOT_AN_ACQUISITION: "INVALID_EVIDENCE",
  NO_EVALUATION_INSTANT: "INVALID_EVIDENCE",
  CONTRACT_BROKEN: "INVALID_EVIDENCE",
  UNKNOWN_PROVIDER: "INVALID_PROVIDER_IDENTITY",
  PROVIDER_NOT_A_STRING: "INVALID_PROVIDER_IDENTITY",
  DUPLICATE_PROVIDER: "INVALID_PROVIDER_IDENTITY",
  EMPTY_PROVIDER_SET: "INVALID_PROVIDER_IDENTITY",
  HOST_BELONGS_TO_ANOTHER_PROVIDER: "INVALID_PROVIDER_IDENTITY",
  HOST_NOT_THE_DOCUMENTED_ONE: "INVALID_PROVIDER_IDENTITY",
  WRONG_PROVIDER_INSTRUMENT_ID: "INVALID_PROVIDER_IDENTITY",
  RETURNED_SYMBOL_MISMATCH: "INVALID_PROVIDER_IDENTITY",
  MISSING_INSTRUMENT: "INVALID_PROVIDER_IDENTITY",
  UNKNOWN_INSTRUMENT: "INVALID_PROVIDER_IDENTITY",
  INSTRUMENT_NOT_MAPPED: "INVALID_PROVIDER_IDENTITY",
  FIXTURE_MARKED: "FIXTURE_NOT_LIVE",
  SYNTHETIC_MARKED: "FIXTURE_NOT_LIVE",
  MOCK_HOST: "FIXTURE_NOT_LIVE",
  MOCK_TRANSPORT: "FIXTURE_NOT_LIVE",
  CACHE_REUSED: "HISTORICAL_NOT_LIVE",
  DECLARED_HISTORICAL: "HISTORICAL_NOT_LIVE",
  WRONG_ENVIRONMENT: "WRONG_ENVIRONMENT",
  MISSING_PROVENANCE: "MISSING_PROVENANCE",
  NO_QUALIFYING_PROVENANCE: "MISSING_PROVENANCE",
  FUTURE_OBSERVATION: "FUTURE_OBSERVATION",
  FUTURE_RECEIPT: "FUTURE_OBSERVATION",
  FUTURE_VERIFICATION: "FUTURE_OBSERVATION",
  RECEIPT_BEFORE_OBSERVATION: "CONTRADICTORY_EVIDENCE",
  CLAIMS_LIVE_BUT_NOT_LIVE: "CONTRADICTORY_EVIDENCE",
  CONTRADICTORY_EVIDENCE: "CONTRADICTORY_EVIDENCE",
  UNMAPPED_REFUSAL_CODE: "INVALID_EVIDENCE",
  STALE_OBSERVATION: "STALE_PROVIDER_EVIDENCE",
  MISSING_PROVIDER: "MISSING_PROVIDER",
};

export interface EvidenceDRefusal {
  /** The provider the refusal is about, or null for the package itself. */
  provider: string | null;
  code: string;
  state: EvidenceDState;
  reason: string;
}

export interface EvidenceDProviderAssessment {
  provider: string;
  state: EvidenceDState;
  verified: boolean;
  dataset: string | null;
  observedAt: number | null;
  receivedAt: number | null;
  reasons: readonly string[];
}

export interface EvidenceDAssessment {
  schema: string;
  state: EvidenceDState;
  /** True only when every required provider is independently verified. */
  complete: boolean;
  /** True when the package declares itself a fixture: it can never be filed. */
  syntheticScoped: boolean;
  requiredProviders: readonly string[];
  verifiedProviders: readonly string[];
  missingProviders: readonly string[];
  providers: readonly EvidenceDProviderAssessment[];
  refusals: readonly EvidenceDRefusal[];
  /** Flat, deterministic lines an operator can act on. */
  problems: readonly string[];
  /** The accepted observations, oldest first — the gate's freshness input. */
  observations: readonly number[];
  oldestObservation: number | null;
  /**
   * The oldest observation the package declares, whether or not it was accepted.
   * A refusal record carries this so the gate's OWN freshness rule applies to it:
   * a package whose oldest observation is stale is reported stale, not merely
   * refused.
   */
  oldestDeclaredObservation: number | null;
  /** Dataset cadences of the accepted records, for the operator's information. */
  cadence: readonly { provider: string; dataset: string; ttlMs: number; freshMs: number }[];
  evaluatedAt: number;
  environment: string;
  maxAgeMs: number | null;
}

export interface EvidenceDEvaluationOptions {
  /** The evaluation instant. Required: this module has no clock. */
  now: number;
  /** The release candidate the package claims to be about, when one is declared. */
  candidate?: EvidenceDCandidateBinding;
  /** The required provider set. Defaults to the canonical registry set. */
  requiredProviders?: readonly string[];
}

function stateOf(code: string): EvidenceDState {
  return EVIDENCE_D_CODE_STATES[code] ?? "INVALID_EVIDENCE";
}

function refuse(
  refusals: EvidenceDRefusal[],
  provider: string | null,
  code: string,
  reason: string,
): void {
  refusals.push({ provider, code, state: stateOf(code), reason });
}

function worstState(codes: readonly string[]): EvidenceDState {
  for (const state of EVIDENCE_D_STATE_PRECEDENCE) {
    if (codes.some((code) => stateOf(code) === state)) return state;
  }
  return "INVALID_EVIDENCE";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/* ── the evaluation ─────────────────────────────────────────────────────────── */

/**
 * Verify a filed Evidence D package.
 *
 * Pure and deterministic: the same package, the same instant and the same
 * candidate produce the same assessment, and no branch reads a clock, an
 * environment variable, a file or a socket.
 */
export function evaluateEvidenceDPackage(
  pkg: unknown,
  options: EvidenceDEvaluationOptions,
): EvidenceDAssessment {
  const requiredProviders = [...(options.requiredProviders ?? REQUIRED_PROVIDER_IDS)];
  const refusals: EvidenceDRefusal[] = [];
  const now = finite(options?.now) ? options.now : Number.NaN;

  if (!finite(now)) refuse(refusals, null, "NO_EVALUATION_INSTANT", "no evaluation instant was supplied");
  for (const problem of EVIDENCE_D_CONTRACT_PROBLEMS) refuse(refusals, null, "CONTRACT_BROKEN", problem);

  if (!isObject(pkg)) {
    refuse(refusals, null, "NOT_AN_OBJECT", "the package is not a JSON object");
    return finish(refusals, requiredProviders, [], now);
  }

  const syntheticScoped = pkg.fixture === true || pkg.synthetic === true;

  if (pkg.schema !== EVIDENCE_D_SCHEMA) {
    refuse(
      refusals,
      null,
      "WRONG_SCHEMA",
      `the package schema is ${JSON.stringify(pkg.schema ?? null)}, expected ${EVIDENCE_D_SCHEMA}`,
    );
  }
  if (pkg.verified !== true) {
    refuse(refusals, null, "NOT_VERIFIED", "the package does not assert that its observations were verified");
  }
  if (pkg.source !== "external-verification") {
    refuse(
      refusals,
      null,
      "WRONG_SOURCE",
      `the package source is ${JSON.stringify(pkg.source ?? null)}; only external verification answers this prerequisite`,
    );
  }
  if (pkg.environment !== EVIDENCE_D_ENVIRONMENT) {
    refuse(
      refusals,
      null,
      "WRONG_ENVIRONMENT",
      `the package is ${JSON.stringify(pkg.environment ?? null)}, the prerequisite requires ${EVIDENCE_D_ENVIRONMENT}`,
    );
  }

  const credentialKeys = credentialBearingKeys(pkg);
  if (credentialKeys.length > 0) {
    refuse(
      refusals,
      null,
      "CARRIES_CREDENTIAL_VALUE",
      `the package carries field(s) that could hold a credential: ${credentialKeys.slice(0, 3).join(", ")}`,
    );
  }

  /* The digest is over the package's own content, minus the digest: a package
     whose numbers were edited after it was assembled fails here. */
  if (typeof pkg.digest !== "string" || pkg.digest.length === 0) {
    refuse(refusals, null, "NO_DIGEST", "the package carries no digest, so its content cannot be pinned");
  } else {
    const { digest, ...payload } = pkg;
    const expected = evidenceDigest(payload);
    if (expected !== digest) {
      refuse(refusals, null, "DIGEST_MISMATCH", `the package digest is ${digest}, its content hashes to ${expected}`);
    }
  }

  const rawRecords = pkg.records;
  if (!Array.isArray(rawRecords)) {
    refuse(refusals, null, "NO_RECORD_ARRAY", "the package carries no records array");
    return finish(refusals, requiredProviders, [], now);
  }
  if (rawRecords.length === 0) {
    refuse(refusals, null, "NO_RECORDS", "the package carries no records, so nothing was observed");
  }

  const candidate = options.candidate ?? {};
  const packageCandidate = isObject(pkg.candidate) ? (pkg.candidate as EvidenceDCandidateBinding) : undefined;
  if (typeof candidate.commit === "string" && candidate.commit.length > 0) {
    const claimed = packageCandidate?.commit;
    if (claimed !== candidate.commit) {
      refuse(
        refusals,
        null,
        "CANDIDATE_MISMATCH",
        `the package is bound to candidate ${JSON.stringify(claimed ?? null)}, this evaluation is about ${candidate.commit}`,
      );
    }
  }
  if (finite(pkg.verifiedAt)) {
    if (pkg.verifiedAt > now) {
      refuse(refusals, null, "FUTURE_VERIFICATION", `the package was verified ${pkg.verifiedAt - now}ms ahead of the evaluation`);
    }
  }

  /* ── per provider ───────────────────────────────────────────────────────── */

  const assessments: EvidenceDProviderAssessment[] = [];
  const declaredObservations: number[] = [];
  const seenProviders: string[] = [];
  const datasetByProvider = new Map<string, string>();
  const cadence: { provider: string; dataset: string; ttlMs: number; freshMs: number }[] = [];

  for (const [index, raw] of rawRecords.entries()) {
    if (!isObject(raw)) {
      refuse(refusals, null, "RECORD_NOT_AN_OBJECT", `record ${index} is not a JSON object`);
      continue;
    }
    const record = raw as unknown as EvidenceDRecord;
    const label = typeof record.provider === "string" && record.provider ? record.provider : `record ${index}`;
    const codes: string[] = [];
    const note = (code: string, reason: string) => {
      codes.push(code);
      refuse(refusals, typeof record.provider === "string" ? record.provider : null, code, reason);
    };

    if (typeof record.provider !== "string" || record.provider.length === 0) {
      note("PROVIDER_NOT_A_STRING", `record ${index} names no provider`);
    } else if (!requiredProviders.includes(record.provider)) {
      note(
        "UNKNOWN_PROVIDER",
        `${record.provider} is not a canonical provider id; the registry carries ${requiredProviders.length} and the id must match exactly`,
      );
    } else if (seenProviders.includes(record.provider)) {
      note(
        "DUPLICATE_PROVIDER",
        `${record.provider} appears more than once; a second record is refused rather than merged, because that is how a healthy record hides a broken one`,
      );
    } else {
      seenProviders.push(record.provider);
    }

    if (typeof record.dataset !== "string" || !EVIDENCE_D_DATASETS.includes(record.dataset)) {
      note(
        "UNKNOWN_DATASET",
        `${label} names dataset ${JSON.stringify(record.dataset ?? null)}, which is not one of this repository's datasets`,
      );
    } else {
      const previous = datasetByProvider.get(record.provider);
      if (previous !== undefined && previous !== record.dataset) {
        note(
          "CONTRADICTORY_EVIDENCE",
          `${label} claims dataset ${record.dataset} while another record for it claims ${previous}`,
        );
      }
      datasetByProvider.set(record.provider, record.dataset);
    }

    /* Identity: the provider-native instrument id this repository documents for
       the pair, and the symbol the provider itself returned. */
    const instrument = record.instrument ?? null;
    if (instrument === null) {
      /* A global series (a published report) has no instrument. That is allowed
         only for a provider this repository does not map to instruments at all:
         an instrument-scoped provider's record without an instrument cannot be
         matched to the pair it claims to be about. */
      if (typeof record.provider === "string" && INSTRUMENT_SCOPED_PROVIDERS.includes(record.provider)) {
        note(
          "MISSING_INSTRUMENT",
          `${label} names no instrument, but this repository maps ${record.provider} to instruments; a record without one cannot be matched to the pair it claims`,
        );
      }
    } else if (typeof instrument !== "string" || resolveInstrument(instrument) === undefined) {
      note("UNKNOWN_INSTRUMENT", `${label} names instrument ${JSON.stringify(instrument)}, which is not canonical`);
    } else if (typeof record.provider === "string" && requiredProviders.includes(record.provider)) {
      const documented = getProviderSymbol(instrument, record.provider);
      const requested = record.providerInstrumentId ?? null;
      if (documented !== null) {
        if (requested !== documented) {
          note(
            "WRONG_PROVIDER_INSTRUMENT_ID",
            `${label} requested native id ${JSON.stringify(requested)} for ${instrument}; this repository documents ${documented} for ${record.provider}`,
          );
        }
      } else if (typeof requested !== "string" || requested.length === 0) {
        note(
          "INSTRUMENT_NOT_MAPPED",
          `${label} names no provider-native id for ${instrument}, and the instrument registry documents none for ${record.provider}`,
        );
      }
      if (record.returnedSymbol !== undefined && record.returnedSymbol !== null) {
        if (requested !== null && record.returnedSymbol !== requested) {
          note(
            "RETURNED_SYMBOL_MISMATCH",
            `${label} requested ${JSON.stringify(requested)} but the provider returned ${JSON.stringify(record.returnedSymbol)}`,
          );
        }
      }
    }

    /* Live versus historical versus fixture. The mode is read as a plain string
       and handed to the canonical Phase 178c predicate — this module does not
       keep its own copy of which modes are new observations. */
    const mode: string = typeof record.mode === "string" ? record.mode : "";
    const live = isNewObservation({
      provider: String(record.provider ?? ""),
      dataset: String(record.dataset ?? ""),
      mode: mode as AcquisitionMode,
      observedAt: finite(record.observedAt) ? record.observedAt : undefined,
      usedAt: finite(record.receivedAt) ? record.receivedAt : 0,
    });
    if (record.fixture === true) note("FIXTURE_MARKED", `${label} declares itself a fixture`);
    if (record.synthetic === true) note("SYNTHETIC_MARKED", `${label} declares itself synthetic`);
    if (record.historical === true) note("DECLARED_HISTORICAL", `${label} declares itself historical`);
    if (mode === "cache-reused") {
      note("CACHE_REUSED", `${label} was served from cache; the provider was not contacted during the observation`);
    } else if (!live && !record.fixture && !record.synthetic && !record.historical && mode !== "") {
      note(
        "NOT_AN_ACQUISITION",
        `${label} records mode ${JSON.stringify(mode)}, which is not a completed provider observation`,
      );
    } else if (mode === "" && !record.fixture && !record.synthetic && !record.historical) {
      note("NOT_AN_ACQUISITION", `${label} records no acquisition mode`);
    }
    if ((record.fixture === true || record.synthetic === true) && live) {
      /* Both markers at once is exactly "data claiming live while it is not". */
      note("CLAIMS_LIVE_BUT_NOT_LIVE", `${label} claims a live acquisition and a fixture/synthetic origin at once`);
    }

    if (record.environment !== EVIDENCE_D_ENVIRONMENT) {
      note(
        "WRONG_ENVIRONMENT",
        `${label} is ${JSON.stringify(record.environment ?? null)}, the prerequisite requires ${EVIDENCE_D_ENVIRONMENT}`,
      );
    }
    if (record.source !== "external-verification") {
      note("WRONG_SOURCE", `${label} source is ${JSON.stringify(record.source ?? null)}`);
    }

    /* Provenance: what proves an external call happened. */
    const provenance = isObject(record.provenance) ? (record.provenance as unknown as EvidenceDProvenance) : null;
    if (!provenance) {
      note("MISSING_PROVENANCE", `${label} carries no provenance, so nothing establishes how the value arrived`);
    } else {
      const transport = typeof provenance.transport === "string" ? provenance.transport.toLowerCase() : "";
      const host = typeof provenance.host === "string" ? provenance.host.trim().toLowerCase() : "";
      if (transport !== "https") {
        if (/mock|fixture|stub|fake|test|memory|in-process/.test(transport)) {
          note("MOCK_TRANSPORT", `${label} arrived over transport ${JSON.stringify(provenance.transport)}, which is a test transport`);
        } else {
          note(
            "NO_QUALIFYING_PROVENANCE",
            `${label} arrived over transport ${JSON.stringify(provenance.transport ?? null)}; only an external https call is a production observation`,
          );
        }
      }
      if (isNonProductionHost(host)) {
        note("MOCK_HOST", `${label} answered from host ${JSON.stringify(provenance.host ?? null)}, which is not a production provider host`);
      } else {
        const documented = DOCUMENTED_PROVIDER_HOSTS[String(record.provider)] ?? null;
        const owners = Object.entries(DOCUMENTED_PROVIDER_HOSTS)
          .filter(([id, knownHost]) => knownHost === host && id !== record.provider)
          .map(([id]) => id);
        if (owners.length > 0) {
          note(
            "HOST_BELONGS_TO_ANOTHER_PROVIDER",
            `${label} answered from ${host}, which this repository documents for ${owners.join(", ")} — provider substitution`,
          );
        } else if (documented !== null && documented !== host) {
          note(
            "HOST_NOT_THE_DOCUMENTED_ONE",
            `${label} answered from ${host}; this repository documents ${documented} for ${record.provider}`,
          );
        }
      }
      if (!finite(provenance.status)) {
        note("NO_QUALIFYING_PROVENANCE", `${label} records no HTTP status`);
      } else if (provenance.status < 200 || provenance.status > 299) {
        note(
          "NO_QUALIFYING_PROVENANCE",
          `${label} records HTTP ${provenance.status}; a provider that did not answer with a success is not an observation`,
        );
      }
    }

    /* Timestamps: provider-owned observation, client-owned receipt. */
    const observedAt = record.observedAt;
    const receivedAt = record.receivedAt;
    if (observedAt === undefined || observedAt === null) {
      note(
        "MISSING_OBSERVATION",
        `${label} carries no observation time; a receipt time is not an observation and cannot stand in for one`,
      );
    } else if (!finite(observedAt)) {
      note("OBSERVATION_NOT_A_NUMBER", `${label} observation time is not a finite instant`);
    } else if (finite(now) && observedAt > now) {
      note("FUTURE_OBSERVATION", `${label} was observed ${observedAt - now}ms ahead of the evaluation`);
    } else if (finite(now) && EVIDENCE_D_MAX_AGE_MS !== null && now - observedAt > EVIDENCE_D_MAX_AGE_MS) {
      note(
        "STALE_OBSERVATION",
        `${label} was observed ${now - observedAt}ms ago, beyond the ${EVIDENCE_D_MAX_AGE_MS}ms freshness window; a later local timestamp cannot make it current`,
      );
    }

    if (receivedAt === undefined || receivedAt === null) {
      note("RECEIPT_NOT_A_NUMBER", `${label} carries no receipt time`);
    } else if (!finite(receivedAt)) {
      note("RECEIPT_NOT_A_NUMBER", `${label} receipt time is not a finite instant`);
    } else if (finite(now) && receivedAt > now) {
      note("FUTURE_RECEIPT", `${label} was received ${receivedAt - now}ms ahead of the evaluation`);
    } else if (finite(observedAt) && receivedAt < observedAt) {
      note("RECEIPT_BEFORE_OBSERVATION", `${label} was received before it was observed`);
    }

    if (finite(record.observedAt)) declaredObservations.push(record.observedAt);

    const recordCodes = [...new Set(codes)];
    assessments.push({
      provider: typeof record.provider === "string" ? record.provider : `record ${index}`,
      state: recordCodes.length === 0 ? "EVIDENCE_D_COMPLETE" : worstState(recordCodes),
      verified: recordCodes.length === 0,
      dataset: typeof record.dataset === "string" ? record.dataset : null,
      observedAt: finite(observedAt) ? observedAt : null,
      receivedAt: finite(receivedAt) ? receivedAt : null,
      reasons: refusals.filter((entry) => entry.provider === record.provider).map((entry) => entry.reason),
    });

    if (recordCodes.length === 0 && typeof record.provider === "string" && typeof record.dataset === "string") {
      const info = datasetCadence(record.dataset);
      if (info) cadence.push({ provider: record.provider, dataset: record.dataset, ttlMs: info.ttlMs, freshMs: info.freshMs });
    }
  }

  /* One record per required provider, or the set is incomplete. This is the rule
     that stops one healthy provider standing in for another. */
  const verifiedProviders = assessments.filter((entry) => entry.verified).map((entry) => entry.provider);
  const missing = requiredProviders.filter((id) => !verifiedProviders.includes(id));
  for (const id of missing) {
    if (seenProviders.includes(id)) continue; // already refused above, with its own reason
    refuse(
      refusals,
      id,
      "MISSING_PROVIDER",
      `incomplete provider set: ${id} has no verified production observation`,
    );
  }
  if (requiredProviders.length === 0) {
    refuse(refusals, null, "EMPTY_PROVIDER_SET", "the required provider set is empty, so coverage cannot be established");
  }

  return finish(
    refusals,
    requiredProviders,
    assessments,
    now,
    syntheticScoped,
    cadence,
    declaredObservations.sort((a, b) => a - b),
  );
}

function finish(
  refusals: EvidenceDRefusal[],
  requiredProviders: readonly string[],
  assessments: readonly EvidenceDProviderAssessment[],
  now: number,
  syntheticScoped = false,
  cadence: readonly { provider: string; dataset: string; ttlMs: number; freshMs: number }[] = [],
  declaredObservations: readonly number[] = [],
): EvidenceDAssessment {
  const unmapped = refusals.map((entry) => entry.code).filter((code) => !(code in EVIDENCE_D_CODE_STATES));
  if (unmapped.length > 0) {
    /* Fail closed and say so: an unmapped code means this module emitted a
       refusal nobody declared a state for, and guessing one would hide it. */
    refuse(
      refusals,
      null,
      "UNMAPPED_REFUSAL_CODE",
      `refusal code(s) with no declared state: ${[...new Set(unmapped)].sort().join(", ")}`,
    );
  }
  const codes = refusals.map((entry) => entry.code);
  const state = codes.length === 0 ? "EVIDENCE_D_COMPLETE" : worstState(codes);
  const verifiedProviders = assessments.filter((entry) => entry.verified).map((entry) => entry.provider);
  const missingProviders = requiredProviders.filter((id) => !verifiedProviders.includes(id)).sort();
  const observations = assessments
    .filter((entry) => entry.verified && entry.observedAt !== null)
    .map((entry) => entry.observedAt as number)
    .sort((a, b) => a - b);
  const problems = refusals
    .map((entry) => `${entry.provider ?? "<package>"}: ${entry.code} — ${entry.reason}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    schema: EVIDENCE_D_SCHEMA,
    state,
    complete: state === "EVIDENCE_D_COMPLETE",
    syntheticScoped,
    requiredProviders: [...requiredProviders],
    verifiedProviders: [...verifiedProviders].sort(),
    missingProviders,
    providers: assessments,
    refusals,
    problems,
    observations,
    oldestObservation: observations.length > 0 ? observations[0] : null,
    oldestDeclaredObservation: declaredObservations.length > 0 ? declaredObservations[0] : null,
    cadence: [...cadence].sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0)),
    evaluatedAt: now,
    environment: EVIDENCE_D_ENVIRONMENT,
    maxAgeMs: EVIDENCE_D_MAX_AGE_MS,
  };
}

/* ── the gate projection ────────────────────────────────────────────────────── */

export interface EvidenceDGateProjection {
  record: EvidenceRecord | null;
  refusals: readonly string[];
}

/**
 * Project an accepted package onto the canonical gate record.
 *
 * The freshness input is the OLDEST accepted observation, not the newest and not
 * the moment the package was assembled: a package is only as current as its
 * weakest provider, and a freshly written attestation may not refresh an old
 * observation. A refused package projects to `null` with its reasons, which is
 * what makes an inadmissible package unable to satisfy the prerequisite.
 */
export function toGateEvidenceRecord(
  assessment: EvidenceDAssessment,
  options: { candidateCommit?: string; candidateRef?: string },
): EvidenceDGateProjection {
  const refusals: string[] = [];
  if (assessment.syntheticScoped) {
    refusals.push("a synthetic or fixture-scoped package may never be filed as production evidence");
  }
  if (!assessment.complete) {
    refusals.push(...assessment.problems);
    if (assessment.problems.length === 0) refusals.push(`the package is ${assessment.state}`);
  }
  if (refusals.length > 0) return { record: null, refusals };
  if (assessment.oldestObservation === null) {
    return { record: null, refusals: ["the package carries no accepted observation instant"] };
  }
  return {
    record: {
      prerequisite: EVIDENCE_D_PREREQUISITE,
      status: "VERIFIED",
      source: "external-verification",
      environment: EVIDENCE_D_ENVIRONMENT,
      observedAt: assessment.oldestObservation,
      subject: {
        providers: [...assessment.requiredProviders].sort(),
        ...(options.candidateCommit ? { commit: options.candidateCommit } : {}),
      },
      detail: `${assessment.verifiedProviders.length}/${assessment.requiredProviders.length} required providers verified in production`,
    },
    refusals: [],
  };
}

/* ── the operator handoff ───────────────────────────────────────────────────── */

/** What counts, and what only looks like it counts. Printed, never inferred. */
export const ACCEPTED_EVIDENCE_CATEGORIES: readonly string[] = [
  "an explicit production live acquisition (mode observed-now, observed-shared or uncached-by-design)",
  "a provider-native identity matching the id this repository documents for the instrument",
  "an observation instant inside the prerequisite's freshness window",
  "provenance recording the external https call: transport, host and a 2xx status",
  "a production environment binding on the record and on the package",
  "every required provider covered by exactly one verified record",
];

export const REJECTED_EVIDENCE_CATEGORIES: readonly string[] = [
  "a historical fixture",
  "backtest or back-filled data",
  "cached data whose observation is outside the freshness window",
  "a synthetic fixture",
  "a manually pasted price",
  "a local mock provider",
  "a test transport (mock, stub, fake, in-process)",
  "an undocumented provider substitution",
  "provider A's evidence presented as provider B's",
  "data with a missing observation time",
  "data with a future observation time",
  "data claiming live while its acquisition mode is not",
];

export interface EvidenceDOperatorHandoff {
  schema: string;
  mode: string;
  /** The Evidence D state of the submitted package. */
  state: EvidenceDState;
  /** True when the package is admissible for evaluation. Never an admission. */
  complete: boolean;
  packagePath: string | null;
  filingPath: string;
  evaluatedAt: number;
  prerequisite: {
    id: string;
    requirement: string;
    environment: string;
    maxAgeMs: number | null;
    binding: string;
  };
  requiredProviders: readonly string[];
  verifiedProviders: readonly string[];
  missingProviders: readonly string[];
  recordContract: {
    schema: string;
    requiredFields: readonly string[];
    datasets: readonly string[];
    documentedHosts: Readonly<Record<string, string>>;
    hostNotDocumented: readonly string[];
    liveModes: readonly string[];
    datasetOwnership: string;
  };
  accepted: readonly string[];
  rejected: readonly string[];
  /** One entry per submitted record, with the state it reached and why. */
  providerRecords: readonly EvidenceDProviderAssessment[];
  refusals: readonly EvidenceDRefusal[];
  problems: readonly string[];
  gateProjection: { filed: boolean; prerequisite: string; refusals: readonly string[] };
  simulated: {
    performed: boolean;
    verdict: string | null;
    blockers: readonly string[];
    evidenceDState: string | null;
  };
  statement: string;
  operatorSequence: readonly string[];
  guarantees: Readonly<Record<string, boolean>>;
  /** This tool never issues a release verdict; the canonical gate does. */
  verdictIssuedHere: false;
  /** The handoff never contacts a provider. */
  providerContacted: false;
}

export interface EvidenceDOperatorOptions {
  packagePath?: string | null;
  filingPath: string;
  releaseVerdict?: string | null;
  simulated?: { verdict: string | null; blockers: readonly string[]; evidenceDState: string | null };
}

const ZERO_GUARANTEES: Readonly<Record<string, boolean>> = {
  providerContacted: false,
  networkOpened: false,
  credentialRead: false,
  credentialPrinted: false,
  credentialMutated: false,
  deploymentPerformed: false,
  emailSent: false,
  gitMutated: false,
  productionStateMutated: false,
  packagePersisted: false,
};

export function buildEvidenceDOperatorHandoff(
  assessment: EvidenceDAssessment,
  options: EvidenceDOperatorOptions,
): EvidenceDOperatorHandoff {
  const prerequisite = PROVIDER_BOUND[0];
  const projection = toGateEvidenceRecord(assessment, {});
  const simulated = options.simulated ?? { verdict: null, blockers: [], evidenceDState: null };
  return {
    schema: EVIDENCE_D_HANDOFF_SCHEMA,
    mode: "EVIDENCE_D_OPERATOR_VERIFICATION (read-only; no provider contact, no credential access, no git, no deployment)",
    state: assessment.state,
    complete: assessment.complete,
    packagePath: options.packagePath ?? null,
    filingPath: options.filingPath,
    evaluatedAt: assessment.evaluatedAt,
    prerequisite: {
      id: prerequisite?.id ?? EVIDENCE_D_PREREQUISITE,
      requirement: prerequisite?.requirement ?? "",
      environment: EVIDENCE_D_ENVIRONMENT,
      maxAgeMs: EVIDENCE_D_MAX_AGE_MS,
      binding: prerequisite?.binding ?? "provider-set",
    },
    requiredProviders: [...assessment.requiredProviders],
    verifiedProviders: [...assessment.verifiedProviders],
    missingProviders: [...assessment.missingProviders],
    recordContract: {
      schema: EVIDENCE_D_SCHEMA,
      requiredFields: [...REQUIRED_RECORD_FIELDS],
      datasets: [...EVIDENCE_D_DATASETS],
      documentedHosts: { ...DOCUMENTED_PROVIDER_HOSTS },
      hostNotDocumented: [...HOST_NOT_DOCUMENTED],
      liveModes: ["observed-now", "observed-shared", "uncached-by-design"],
      datasetOwnership:
        "this repository declares no provider→dataset map; the harness checks the dataset vocabulary and refuses contradictions instead of inventing one",
    },
    accepted: [...ACCEPTED_EVIDENCE_CATEGORIES],
    rejected: [...REJECTED_EVIDENCE_CATEGORIES],
    providerRecords: assessment.providers,
    refusals: assessment.refusals,
    problems: assessment.problems,
    gateProjection: {
      filed: projection.record !== null,
      prerequisite: EVIDENCE_D_PREREQUISITE,
      refusals: projection.refusals,
    },
    simulated: {
      performed: simulated.verdict !== null,
      verdict: simulated.verdict,
      blockers: [...simulated.blockers],
      evidenceDState: simulated.evidenceDState,
    },
    statement: assessment.complete
      ? "The package is admissible for evaluation by the release gate. This is not a release decision: the gate still decides, and this tool has filed nothing."
      : "The package is not admissible. This is a blocker with a name, not a negative finding about the providers.",
    operatorSequence: [
      `observe every required provider in production (${assessment.requiredProviders.length} of them) and record what actually answered`,
      "assemble one record per provider with the provider-owned observation instant and the client-owned receipt instant",
      `write the package to ${options.filingPath}`,
      "run this command again with --package pointing at that file",
      "let the canonical release gate decide; this tool never decides",
    ],
    guarantees: { ...ZERO_GUARANTEES },
    verdictIssuedHere: false,
    providerContacted: false,
  };
}

export function formatEvidenceDOperatorHandoff(handoff: EvidenceDOperatorHandoff): string {
  const lines: string[] = [];
  lines.push(`mode: ${handoff.mode}`);
  lines.push(`schema: ${handoff.schema}`);
  lines.push(`evaluatedAt: ${handoff.evaluatedAt}`);
  lines.push(`package: ${handoff.packagePath ?? "<none supplied>"}`);
  lines.push("");
  lines.push("── decision ─────────────────────────────────────────────────────────────");
  lines.push(`state: ${handoff.state}`);
  lines.push(
    handoff.complete
      ? "admissible for evaluation: yes (the gate still decides; nothing was filed)"
      : "admissible for evaluation: no — a blocker remains",
  );
  lines.push(`prerequisite: ${handoff.prerequisite.id} (${handoff.prerequisite.binding}, ${handoff.prerequisite.environment}, window ${String(handoff.prerequisite.maxAgeMs)}ms)`);
  lines.push("");
  lines.push("── providers ────────────────────────────────────────────────────────────");
  lines.push(`required: ${handoff.requiredProviders.join(", ")}`);
  lines.push(`verified: ${handoff.verifiedProviders.length ? handoff.verifiedProviders.join(", ") : "none"}`);
  lines.push(`missing:  ${handoff.missingProviders.length ? handoff.missingProviders.join(", ") : "none"}`);
  lines.push("");
  lines.push("── what counts ─────────────────────────────────────────────────────────");
  for (const category of handoff.accepted) lines.push(`  + ${category}`);
  lines.push("");
  lines.push("── what does not count ─────────────────────────────────────────────────");
  for (const category of handoff.rejected) lines.push(`  - ${category}`);
  lines.push("");
  lines.push("── record contract ─────────────────────────────────────────────────────");
  lines.push(`package schema: ${handoff.recordContract.schema}`);
  lines.push(`required fields: ${handoff.recordContract.requiredFields.join(", ")}`);
  lines.push(`datasets: ${handoff.recordContract.datasets.join(", ")}`);
  const hosts = Object.entries(handoff.recordContract.documentedHosts).map(([id, host]) => `${id} → ${host}`);
  lines.push(`documented hosts: ${hosts.join(", ") || "none"}`);
  lines.push(`hosts not documented (not invented): ${handoff.recordContract.hostNotDocumented.join(", ") || "none"}`);
  lines.push(`dataset ownership: ${handoff.recordContract.datasetOwnership}`);
  lines.push("");
  if (handoff.problems.length > 0) {
    lines.push("── refusals ─────────────────────────────────────────────────────────────");
    for (const problem of handoff.problems) lines.push(`  ! ${problem}`);
    lines.push("");
  }
  lines.push("── gate projection ─────────────────────────────────────────────────────");
  lines.push(
    handoff.gateProjection.filed
      ? `a record for ${handoff.gateProjection.prerequisite} would be readable by the gate`
      : `no record would be filed (${handoff.gateProjection.refusals.length} refusal(s), named above)`,
  );
  if (handoff.simulated.performed) {
    lines.push(
      `if the package were filed: verdict ${handoff.simulated.verdict}, Evidence D ${handoff.simulated.evidenceDState}, remaining blockers ${handoff.simulated.blockers.length ? handoff.simulated.blockers.join(", ") : "none"} — simulated in memory, nothing written`,
    );
  }
  lines.push("");
  lines.push("── operator sequence ───────────────────────────────────────────────────");
  handoff.operatorSequence.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  lines.push("");
  lines.push("── guarantees ──────────────────────────────────────────────────────────");
  for (const [key, value] of Object.entries(handoff.guarantees)) lines.push(`  ${key}: ${String(value)}`);
  lines.push("");
  lines.push(`statement: ${handoff.statement}`);
  lines.push("This tool does not issue a release verdict and did not contact a provider.");
  return lines.join("\n");
}

export function evidenceDOperatorJson(handoff: EvidenceDOperatorHandoff): string {
  return JSON.stringify(handoff, null, 2);
}

/** 0 when the package is admissible, 1 when a blocker remains. Never 2 here. */
export function evidenceDHandoffExitCode(handoff: EvidenceDOperatorHandoff): 0 | 1 {
  return handoff.complete ? 0 : 1;
}

/* ── assembling a package (tests, fixtures and the operator's own tooling) ──── */

export interface EvidenceDPackageInput {
  candidate?: EvidenceDCandidateBinding;
  verifiedAt: number;
  records: readonly EvidenceDRecord[];
  fixture?: boolean;
  synthetic?: boolean;
}

/**
 * Assemble a package from facts that were ALREADY observed.
 *
 * This is a formatter, not an observer: it cannot produce an observation, and it
 * computes the digest over exactly the payload a validator will re-hash. Tests
 * use it to build well-formed packages without hand-computing digests, and the
 * operator's own tooling can use it once the records exist.
 */
export function buildEvidenceDPackage(input: EvidenceDPackageInput): EvidenceDPackage {
  const payload = {
    schema: EVIDENCE_D_SCHEMA,
    environment: EVIDENCE_D_ENVIRONMENT,
    source: "external-verification",
    verified: true,
    verifiedAt: input.verifiedAt,
    ...(input.candidate ? { candidate: input.candidate } : {}),
    ...(input.fixture ? { fixture: true } : {}),
    ...(input.synthetic ? { synthetic: true } : {}),
    records: input.records,
  };
  return { ...payload, digest: evidenceDigest(payload) };
}

/**
 * A record shaped like a real observation, for tests and for the operator's own
 * tooling.
 *
 * It fills in the canonical field names and the identity this repository
 * documents; it does NOT invent a host. For a provider whose host is not
 * documented here the caller must supply one — the default is an empty host,
 * which the validator refuses, so the helper can never paper over the gap.
 */
export function evidenceDRecord(input: Partial<EvidenceDRecord> & { provider: string }): EvidenceDRecord {
  const dataset = input.dataset ?? "ohlcv";
  const instrument = input.instrument ?? null;
  const documented = instrument ? getProviderSymbol(instrument, input.provider) : null;
  const record: EvidenceDRecord = {
    provider: input.provider,
    dataset,
    instrument,
    providerInstrumentId: documented ?? input.providerInstrumentId ?? instrument,
    mode: "observed-now",
    environment: EVIDENCE_D_ENVIRONMENT,
    source: "external-verification",
    observedAt: input.observedAt ?? 0,
    receivedAt: input.receivedAt ?? 0,
    provenance:
      input.provenance ??
      ({
        transport: "https",
        host: DOCUMENTED_PROVIDER_HOSTS[input.provider] ?? "",
        status: 200,
      } satisfies EvidenceDProvenance),
  };
  return { ...record, ...input, provenance: input.provenance ?? record.provenance };
}
