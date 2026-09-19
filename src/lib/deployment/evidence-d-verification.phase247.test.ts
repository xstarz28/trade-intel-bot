/**
 * Phase 247 — Evidence D: the production live provider verification harness.
 *
 * The claim these tests defend, in one sentence: an operator can submit real
 * production provider evidence and have the canonical gate decide, while a
 * fixture, a cache, a mock, a document, a configuration file and a local run
 * cannot — and nothing in this phase can touch the real release state, a
 * provider, a credential, git or the network.
 *
 * Every instant is injected. No test sleeps, reads a wall clock or depends on
 * timing: the freshness boundary is asserted on both sides at an exact instant.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAllProviders } from "@/lib/data/universal/providers";
import { getAllInstrumentIds, getProviderSymbol } from "@/lib/data/universal/instruments";
import { PROVIDER_CREDENTIAL_REQUIREMENTS } from "./production-config";
import { evaluateReleaseAdmission } from "./release-admission";
import {
  currentReleaseVerdict,
  deriveCurrentReleaseState,
  PROOF_PATHS,
  type FactSource,
} from "./release-current-state";
import { evidenceDigest } from "./a2-rehearsal";
import { evaluateRelease, RELEASE_PREREQUISITES, type EvidenceRecord, type ReleaseInput } from "./release-gate";
import {
  ACCEPTED_EVIDENCE_CATEGORIES,
  DOCUMENTED_PROVIDER_HOSTS,
  EVIDENCE_D_CODE_STATES,
  EVIDENCE_D_DATASETS,
  EVIDENCE_D_ENVIRONMENT,
  EVIDENCE_D_MAX_AGE_MS,
  EVIDENCE_D_PREREQUISITE,
  EVIDENCE_D_SCHEMA,
  HOST_NOT_DOCUMENTED,
  INSTRUMENT_SCOPED_PROVIDERS,
  REJECTED_EVIDENCE_CATEGORIES,
  REQUIRED_PROVIDER_IDS,
  REQUIRED_RECORD_FIELDS,
  buildEvidenceDOperatorHandoff,
  buildEvidenceDPackage,
  canonicalProviderSet,
  checkProviderSet,
  datasetCadence,
  evaluateEvidenceDPackage,
  evidenceDHandoffExitCode,
  evidenceDRecord,
  formatEvidenceDOperatorHandoff,
  isNonProductionHost,
  registryProviderIds,
  toGateEvidenceRecord,
  type EvidenceDAssessment,
  type EvidenceDRecord,
} from "./evidence-d-verification";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
/** Prose about a forbidden operation is not the operation. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CANDIDATE_COMMIT = "b64ddc3";
const CANDIDATE_REF = "heads/arena/01a0adfb-trade-intel-bot";
const CANDIDATE = { commit: CANDIDATE_COMMIT, ref: CANDIDATE_REF };

/** The projection options, named once so no call site can pass the wrong shape. */
const GATE_OPTIONS = { candidateCommit: CANDIDATE_COMMIT, candidateRef: CANDIDATE_REF };

/* ── fixtures ───────────────────────────────────────────────────────────── */

/** The dataset each provider is asked for in these fixtures. */
const DATASET: Record<string, string> = {
  "twelve-data": "ohlcv",
  "alpha-vantage": "ohlcv",
  coingecko: "quote",
  coinglass: "derivatives",
  defillama: "ohlcv",
  tokenomist: "fundamentals",
  tickatlas: "calendar",
  treasury: "treasury",
  cftc: "cot",
  eia: "eia",
  okx: "ohlcv",
};

/** The instrument each fixture record is about; null where the series is global. */
const INSTRUMENT: Record<string, string | null> = {
  "twelve-data": "BTC/USD",
  "alpha-vantage": "EUR/USD",
  coingecko: "BTC/USD",
  coinglass: "BTC/USD",
  defillama: "BTC/USD",
  tokenomist: "BTC/USD",
  eia: "WTI",
  tickatlas: null,
  treasury: null,
  cftc: null,
  okx: null,
};

/**
 * Where the fixture says the answer came from. The documented hosts are the
 * real ones (a parity test below proves they match the URL builders); the rest
 * are hosts this repository does not document, which the contract accepts and
 * reports rather than inventing.
 */
const HOST: Record<string, string> = {
  ...DOCUMENTED_PROVIDER_HOSTS,
  coinglass: "live.coinglass.observed",
  defillama: "live.defillama.observed",
  tokenomist: "live.tokenomist.observed",
  tickatlas: "live.tickatlas.observed",
  treasury: "live.treasury.observed",
  cftc: "live.cftc.observed",
  eia: "live.eia.observed",
};

function rec(provider: string, overrides: Partial<EvidenceDRecord> = {}): EvidenceDRecord {
  return evidenceDRecord({
    provider,
    dataset: DATASET[provider] ?? "ohlcv",
    instrument: INSTRUMENT[provider] ?? null,
    observedAt: NOW - 60_000,
    receivedAt: NOW - 59_000,
    provenance: { transport: "https", host: HOST[provider] ?? "", status: 200 },
    ...overrides,
  });
}

function records(
  providers: readonly string[] = REQUIRED_PROVIDER_IDS,
  overrides: (provider: string, index: number) => Partial<EvidenceDRecord> = () => ({}),
): EvidenceDRecord[] {
  return providers.map((provider, index) => rec(provider, overrides(provider, index)));
}

function pkg(
  input: {
    records?: readonly EvidenceDRecord[];
    verifiedAt?: number;
    candidate?: { commit?: string; ref?: string };
    fixture?: boolean;
    synthetic?: boolean;
    overrides?: Record<string, unknown>;
  } = {},
): unknown {
  const built = buildEvidenceDPackage({
    candidate: input.candidate ?? CANDIDATE,
    verifiedAt: input.verifiedAt ?? NOW - 30_000,
    records: input.records ?? records(),
    fixture: input.fixture,
    synthetic: input.synthetic,
  });
  if (!input.overrides) return built;
  /* The digest is RE-COMPUTED over the modified payload, so a case that breaks
     one field is refused by that field's rule rather than by the digest. (Test 10
     is the one that keeps the stale digest, to prove the digest itself bites.) */
  const { digest: _ignored, ...payload } = built;
  const { digest: _dropped, ...merged } = { ...payload, ...input.overrides };
  return { ...merged, digest: evidenceDigest(merged) };
}

function assess(
  value: unknown,
  options: { now?: number; candidate?: { commit?: string; ref?: string }; requiredProviders?: readonly string[] } = {},
): EvidenceDAssessment {
  return evaluateEvidenceDPackage(value, {
    now: options.now ?? NOW,
    candidate: options.candidate ?? CANDIDATE,
    requiredProviders: options.requiredProviders,
  });
}

/** A memory tree, so the reader paths are reachable without touching disk. */
function memorySource(files: Record<string, string>): FactSource {
  return {
    exists: (path) => path in files,
    read: (path) => {
      const body = files[path];
      if (body === undefined) throw new Error(`no such file: ${path}`);
      return body;
    },
  };
}

const REF_INVENTORY = JSON.stringify({
  refs: [
    { ref: "main", affected: true, exposedAtTip: true },
    { ref: "phase-157", affected: true, exposedAtTip: false },
  ],
});

/** The subject each other prerequisite's proof must carry to bind. */
const subjectFor = (id: string) =>
  id === "A2_HISTORY_REWRITE"
    ? { refs: ["main", "phase-157"] }
    : id === "CONVEX_PRODUCTION_DEPLOYMENT"
      ? { deployment: "prod-1" }
      : undefined;

/** A gate record that would satisfy every other prerequisite, for gate tests. */
function otherProof(id: string): EvidenceRecord {
  return {
    prerequisite: id,
    status: "VERIFIED",
    source: "external-verification",
    environment: "production",
    observedAt: NOW - 60_000,
    subject: subjectFor(id),
  };
}

/** The same proof as the reader finds it: a file that declares itself external. */
function otherProofFile(id: string): string {
  return JSON.stringify({
    verified: true,
    source: "external-verification",
    environment: "production",
    observedAt: NOW - 60_000,
    subject: subjectFor(id),
  });
}

/* ── A. the canonical provider set ──────────────────────────────────────── */

describe("247 — the canonical provider set is the registry, not a second list", () => {
  it("1. every required provider comes from getAllProviders()", () => {
    const fromRegistry = getAllProviders().map((provider) => provider.id);
    expect([...REQUIRED_PROVIDER_IDS]).toEqual([...new Set(fromRegistry)].sort());
    expect(REQUIRED_PROVIDER_IDS.length).toBe(fromRegistry.length);
    expect(REQUIRED_PROVIDER_IDS.length).toBeGreaterThan(1);
    // And the ids are the registry's own, so a provider added to the product is
    // covered the moment it is registered.
    expect(canonicalProviderSet()).toEqual([...REQUIRED_PROVIDER_IDS]);
    expect(registryProviderIds().sort()).toEqual([...REQUIRED_PROVIDER_IDS]);
  });

  it("2. a duplicate provider is rejected, not merged with the first", () => {
    const duplicated = [REQUIRED_PROVIDER_IDS[0], ...REQUIRED_PROVIDER_IDS];
    const set = checkProviderSet(duplicated);
    expect(set.ok).toBe(false);
    expect(set.duplicates).toEqual([REQUIRED_PROVIDER_IDS[0]]);

    const assessment = assess(
      pkg({ records: [...records(), rec(REQUIRED_PROVIDER_IDS[0])] }),
    );
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("INVALID_PROVIDER_IDENTITY");
    expect(assessment.problems.join(" ")).toContain("appears more than once");
  });

  it("3. an unknown provider id is rejected — and a nearly-correct one is unknown", () => {
    const unknown = checkProviderSet([...REQUIRED_PROVIDER_IDS.slice(1), "OKX"]);
    expect(unknown.unknown).toEqual(["OKX"]);
    expect(unknown.ok).toBe(false);

    // The record is otherwise perfect: the only thing wrong is the id, so the
    // refusal can only be about identity.
    const swapped = records();
    swapped[swapped.length - 1] = rec("OKX", {
      provenance: { transport: "https", host: DOCUMENTED_PROVIDER_HOSTS.okx, status: 200 },
    });
    const assessment = assess(pkg({ records: swapped }));
    expect(assessment.state).toBe("INVALID_PROVIDER_IDENTITY");
    expect(assessment.problems.join(" ")).toContain("is not a canonical provider id");
  });

  it("4. a missing provider is rejected, and never silently treated as covered", () => {
    const dropped = REQUIRED_PROVIDER_IDS[REQUIRED_PROVIDER_IDS.length - 1];
    const assessment = assess(
      pkg({ records: records(REQUIRED_PROVIDER_IDS.filter((id) => id !== dropped)) }),
    );
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("MISSING_PROVIDER");
    expect(assessment.missingProviders).toEqual([dropped]);
    expect(assessment.problems.join(" ")).toContain("incomplete provider set");
  });

  it("5. an empty provider set never means success", () => {
    expect(checkProviderSet([]).ok).toBe(false);
    expect(checkProviderSet([]).empty).toBe(true);
    // Even when NOTHING is required, submitting nothing is not coverage: the
    // empty submission is the thing being refused, not the empty registry.
    expect(checkProviderSet([], []).ok).toBe(false);

    const assessment = assess(pkg({ records: [] }), { requiredProviders: [] });
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("INVALID_EVIDENCE");
    const problems = assessment.problems.join(" ");
    expect(problems).toContain("carries no records");
    expect(problems).toContain("required provider set is empty");
  });

  it("6. provider ordering cannot change the verdict", () => {
    const forward = assess(pkg({ records: records() }));
    const reversed = assess(pkg({ records: records().reverse() }));
    const shuffled = assess(
      pkg({ records: [...records()].sort((a, b) => (a.provider < b.provider ? 1 : -1)) }),
    );

    expect(reversed.state).toBe(forward.state);
    expect(shuffled.state).toBe(forward.state);
    expect(forward.complete).toBe(true);
    expect([...reversed.problems]).toEqual([...forward.problems]);
    expect([...shuffled.verifiedProviders]).toEqual([...forward.verifiedProviders]);

    /* The same property for a package that is refused for several different
       reasons at once: the state is chosen by the precedence, not by whichever
       record a hostile ordering puts first. */
    const refusing = records(REQUIRED_PROVIDER_IDS, (provider, index) => {
      if (index === 0) return { fixture: true };
      if (index === 2) return { observedAt: NOW - 30 * DAY, receivedAt: NOW - 1 };
      if (index === 4) return { environment: "development" };
      if (index === 6) return { mode: "cache-reused" };
      return {};
    });
    const forwardRefusal = assess(pkg({ records: refusing }));
    const reversedRefusal = assess(pkg({ records: [...refusing].reverse() }));
    const shuffledRefusal = assess(pkg({ records: [...refusing].sort((a, b) => (a.provider < b.provider ? 1 : -1)) }));

    expect(forwardRefusal.complete).toBe(false);
    expect(reversedRefusal.state).toBe(forwardRefusal.state);
    expect(shuffledRefusal.state).toBe(forwardRefusal.state);
    expect([...reversedRefusal.problems]).toEqual([...forwardRefusal.problems]);
    expect([...shuffledRefusal.problems]).toEqual([...forwardRefusal.problems]);
  });

  it("7. the verification logic keeps no second provider list", () => {
    const source = read("src/lib/deployment/evidence-d-verification.ts");
    const literals = REQUIRED_PROVIDER_IDS.filter((id) => source.includes(`"${id}"`) || source.includes(`'${id}'`));
    // An id may appear literally only where this repository documents its host;
    // the required set itself is derived, never spelled out.
    expect(literals.every((id) => id in DOCUMENTED_PROVIDER_HOSTS)).toBe(true);
    expect(Object.keys(DOCUMENTED_PROVIDER_HOSTS).length).toBe(4);
    expect(source).toContain("getAllProviders()");
    expect(source).toContain("canonicalProviderSet()");
  });
});

/* ── B. the record contract ─────────────────────────────────────────────── */

describe("247 — the record contract", () => {
  it("8. a complete conformant package is admissible for evaluation", () => {
    const assessment = assess(pkg());
    expect(assessment.state).toBe("EVIDENCE_D_COMPLETE");
    expect(assessment.complete).toBe(true);
    expect(assessment.problems).toEqual([]);
    expect(assessment.verifiedProviders).toEqual([...REQUIRED_PROVIDER_IDS]);
    expect(assessment.missingProviders).toEqual([]);
    expect(assessment.oldestObservation).toBe(NOW - 60_000);
  });

  it("9. the projection files the canonical set and the OLDEST observation", () => {
    const fresh = records(REQUIRED_PROVIDER_IDS, (provider, index) =>
      index === 3 ? { observedAt: NOW - 6 * DAY, receivedAt: NOW - 6 * DAY + 1_000 } : {},
    );
    const assessment = assess(pkg({ records: fresh }));
    const projection = toGateEvidenceRecord(assessment, GATE_OPTIONS);

    expect(projection.refusals).toEqual([]);
    expect(projection.record).not.toBeNull();
    expect(projection.record?.prerequisite).toBe(EVIDENCE_D_PREREQUISITE);
    expect(projection.record?.source).toBe("external-verification");
    expect(projection.record?.environment).toBe("production");
    // The weakest provider decides how current the package is.
    expect(projection.record?.observedAt).toBe(NOW - 6 * DAY);
    expect([...(projection.record?.subject?.providers ?? [])]).toEqual([...REQUIRED_PROVIDER_IDS]);
    expect(projection.record?.subject?.commit).toBe(CANDIDATE_COMMIT);
  });

  it("10. the digest pins the content: an edited number is refused", () => {
    const good = pkg();
    expect(assess(good).complete).toBe(true);

    const tampered = JSON.parse(JSON.stringify(good)) as { records: EvidenceDRecord[] };
    tampered.records[0] = { ...tampered.records[0], observedAt: NOW - 1_000 };
    const assessment = assess(tampered);
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("INVALID_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("digest is");
    expect(assessment.problems.join(" ")).toContain("hashes to");
  });

  it("11. a package carrying a credential-shaped field is refused whole", () => {
    const cases: Record<string, unknown>[] = [
      { apiKey: "x" },
      { token: "x" },
      { records: [{ ...rec("okx"), value: 42 }] },
      { records: [{ ...rec("okx"), authorization: "Bearer x" }] },
    ];
    for (const overrides of cases) {
      const assessment = assess(pkg({ overrides }));
      expect(assessment.complete).toBe(false);
      expect(assessment.problems.join(" "), JSON.stringify(overrides)).toContain(
        "could hold a credential",
      );
    }
    // The operator report never echoes the value it refused.
    const handoff = buildEvidenceDOperatorHandoff(assess(pkg({ overrides: { apiKey: "super-secret" } })), {
      filingPath: PROOF_PATHS.evidenceD,
    });
    expect(formatEvidenceDOperatorHandoff(handoff)).not.toContain("super-secret");
  });

  it("12. the package-level contract is enforced field by field", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["schema", { schema: "phase247.evidence-d/v2" }, "WRONG_SCHEMA"],
      ["verified", { verified: false }, "NOT_VERIFIED"],
      ["source", { source: "documentation" }, "WRONG_SOURCE"],
      ["environment", { environment: "development" }, "WRONG_ENVIRONMENT"],
      ["records", { records: "not an array" }, "NO_RECORD_ARRAY"],
      ["verifiedAt in the future", { verifiedAt: NOW + 60_000 }, "FUTURE_VERIFICATION"],
    ];
    for (const [field, overrides, code] of cases) {
      const assessment = assess(pkg({ overrides }));
      expect(assessment.complete, field).toBe(false);
      expect(assessment.refusals.map((entry) => entry.code), field).toContain(code);
    }
  });

  it("12a. a package with no digest at all is refused, not assumed intact", () => {
    const { digest: _dropped, ...bare } = pkg() as Record<string, unknown>;
    const assessment = assess(bare);
    expect(assessment.complete).toBe(false);
    expect(assessment.refusals.map((entry) => entry.code)).toContain("NO_DIGEST");
  });

  it("12b. a record without a receipt instant is refused, not assumed received", () => {
    const withoutReceipt = { ...rec(REQUIRED_PROVIDER_IDS[0]) } as Record<string, unknown>;
    delete withoutReceipt.receivedAt;
    const assessment = assess(
      pkg({ records: [withoutReceipt as EvidenceDRecord, ...records().slice(1)] }),
    );
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("INVALID_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("carries no receipt time");
  });

  it("13. the record contract is stated, and every field is required", () => {
    expect(REQUIRED_RECORD_FIELDS).toContain("observedAt");
    expect(REQUIRED_RECORD_FIELDS).toContain("receivedAt");
    expect(REQUIRED_RECORD_FIELDS).toContain("mode");
    expect(REQUIRED_RECORD_FIELDS).toContain("provenance");
    expect(REQUIRED_RECORD_FIELDS).toContain("providerInstrumentId");
    // No credential field is ever part of the contract.
    expect(REQUIRED_RECORD_FIELDS.join(" ")).not.toMatch(/key|token|secret|password/i);
  });

  it("13b. every refusal code the validator can emit has a declared state", () => {
    const source = stripComments(read("src/lib/deployment/evidence-d-verification.ts"));
    const codes = [
      ...[...source.matchAll(/refuse\(\s*refusals,\s*[^,]+,\s*"([A-Z_]+)"/g)].map((match) => match[1]),
      ...[...source.matchAll(/\bnote\("([A-Z_]+)"/g)].map((match) => match[1]),
    ];
    expect(codes.length).toBeGreaterThan(20);
    const unmapped = [...new Set(codes)].filter((code) => !(code in EVIDENCE_D_CODE_STATES));
    expect(unmapped).toEqual([]);
    // And the marker for an unmapped code is itself mapped, so it can never be
    // swallowed: an undeclared refusal stays visible instead of degrading.
    expect(EVIDENCE_D_CODE_STATES.UNMAPPED_REFUSAL_CODE).toBe("INVALID_EVIDENCE");
  });

  it("14. a package that is not an object is refused, not crashed on", () => {
    for (const value of [null, 42, "evidence", []]) {
      const assessment = assess(value);
      expect(assessment.complete).toBe(false);
      expect(assessment.state).toBe("INVALID_EVIDENCE");
      expect(assessment.problems.length).toBeGreaterThan(0);
    }
  });

  it("15. a record that is not an object is refused, not dropped", () => {
    const assessment = assess(pkg({ records: [...records().slice(1), "not a record" as never] }));
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("INVALID_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("record");
  });
});

/* ── C. live versus historical versus fixture ───────────────────────────── */

describe("247 — production live evidence is not a fixture, a cache or a mock", () => {
  const cases: [string, Partial<EvidenceDRecord>, string][] = [
    ["a record marked as a fixture", { fixture: true }, "FIXTURE_NOT_LIVE"],
    ["a record marked synthetic", { synthetic: true }, "FIXTURE_NOT_LIVE"],
    ["a record marked historical", { historical: true }, "HISTORICAL_NOT_LIVE"],
    ["a cache-reused acquisition", { mode: "cache-reused" }, "HISTORICAL_NOT_LIVE"],
    ["a mock transport", { provenance: { transport: "mock", host: HOST.okx, status: 200 } }, "FIXTURE_NOT_LIVE"],
    ["an in-process transport", { provenance: { transport: "in-process", host: HOST.okx, status: 200 } }, "FIXTURE_NOT_LIVE"],
    ["loopback", { provenance: { transport: "https", host: "localhost", status: 200 } }, "FIXTURE_NOT_LIVE"],
    ["a private address", { provenance: { transport: "https", host: "192.168.1.9", status: 200 } }, "FIXTURE_NOT_LIVE"],
    ["a reserved test domain", { provenance: { transport: "https", host: "provider.test", status: 200 } }, "FIXTURE_NOT_LIVE"],
    ["example.com", { provenance: { transport: "https", host: "example.com", status: 200 } }, "FIXTURE_NOT_LIVE"],
    ["a stub host", { provenance: { transport: "https", host: "stub.provider.io", status: 200 } }, "FIXTURE_NOT_LIVE"],
    ["a timeout", { mode: "timed-out" }, "INVALID_EVIDENCE"],
    ["an unavailable provider", { mode: "unavailable" }, "INVALID_EVIDENCE"],
    ["a skipped acquisition", { mode: "skipped" }, "INVALID_EVIDENCE"],
    ["no acquisition mode at all", { mode: "" }, "INVALID_EVIDENCE"],
    ["a record bound to another environment", { environment: "development" }, "WRONG_ENVIRONMENT"],
    ["a record from a local run", { source: "local-run" }, "INVALID_EVIDENCE"],
    ["a non-2xx status", { provenance: { transport: "https", host: HOST.okx, status: 503 } }, "MISSING_PROVENANCE"],
    ["a bare http transport", { provenance: { transport: "http", host: HOST.okx, status: 200 } }, "MISSING_PROVENANCE"],
  ];

  it.each(cases)("16. %s is refused as %s", (_label, override, expected) => {
    const assessment = assess(pkg({ records: records(REQUIRED_PROVIDER_IDS, (provider, index) => (index === 0 ? override : {})) }));
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe(expected);
    expect(assessment.problems.length).toBeGreaterThan(0);
  });

  it("16b. a record with no provenance at all is refused", () => {
    const bare = { ...rec(REQUIRED_PROVIDER_IDS[0]) } as Record<string, unknown>;
    delete bare.provenance;
    const assessment = assess(pkg({ records: [bare as EvidenceDRecord, ...records().slice(1)] }));
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("MISSING_PROVENANCE");
    expect(assessment.problems.join(" ")).toContain("carries no provenance");
    expect(toGateEvidenceRecord(assessment, GATE_OPTIONS).record).toBeNull();
  });

  it("17. a fixture that also claims a live acquisition is refused, and says both things", () => {
    const assessment = assess(
      pkg({ records: records(REQUIRED_PROVIDER_IDS, (provider, index) => (index === 0 ? { fixture: true } : {})) }),
    );
    expect(assessment.state).toBe("FIXTURE_NOT_LIVE");
    const joined = assessment.problems.join(" ");
    expect(joined).toContain("declares itself a fixture");
    expect(joined).toContain("fixture/synthetic origin at once");
  });

  it("18. a fixture-scoped package cannot project a gate record even when it is complete", () => {
    const assessment = assess(pkg({ fixture: true }));
    expect(assessment.complete).toBe(true);
    expect(assessment.syntheticScoped).toBe(true);
    const projection = toGateEvidenceRecord(assessment, GATE_OPTIONS);
    expect(projection.record).toBeNull();
    expect(projection.refusals.join(" ")).toContain("may never be filed as production evidence");
  });

  it("19. the accepted and rejected categories are stated, and the rejected list is the long one", () => {
    expect(ACCEPTED_EVIDENCE_CATEGORIES.length).toBeGreaterThanOrEqual(6);
    expect(REJECTED_EVIDENCE_CATEGORIES.length).toBeGreaterThanOrEqual(12);
    const rejected = REJECTED_EVIDENCE_CATEGORIES.join(" | ");
    for (const phrase of ["fixture", "historical", "mock", "transport", "future", "missing observation"]) {
      expect(rejected).toContain(phrase);
    }
    // The report carries both lists, so an operator reads the rule rather than guessing it.
    const handoff = buildEvidenceDOperatorHandoff(assess(pkg({ fixture: true })), {
      filingPath: PROOF_PATHS.evidenceD,
    });
    expect(handoff.rejected).toEqual([...REJECTED_EVIDENCE_CATEGORIES]);
  });
});

/* ── D. provider identity ───────────────────────────────────────────────── */

describe("247 — provider and instrument identity", () => {
  it("20. provider substitution is refused: another provider's documented host", () => {
    const assessment = assess(
      pkg({
        records: records(REQUIRED_PROVIDER_IDS, (provider) =>
          provider === "coingecko"
            ? { provenance: { transport: "https", host: DOCUMENTED_PROVIDER_HOSTS["twelve-data"], status: 200 } }
            : {},
        ),
      }),
    );
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("INVALID_PROVIDER_IDENTITY");
    expect(assessment.problems.join(" ")).toContain("provider substitution");
  });

  it("21. a documented provider answering from another host is refused", () => {
    const assessment = assess(
      pkg({
        records: records(REQUIRED_PROVIDER_IDS, (provider) =>
          provider === "okx" ? { provenance: { transport: "https", host: "api.not-okx.observed", status: 200 } } : {},
        ),
      }),
    );
    expect(assessment.state).toBe("INVALID_PROVIDER_IDENTITY");
    expect(assessment.problems.join(" ")).toContain("this repository documents");
  });

  it("22. symbol substitution is refused: the provider answered about something else", () => {
    const substitution = rec("coingecko", { returnedSymbol: "ethereum" });
    const assessment = assess(
      pkg({ records: records(REQUIRED_PROVIDER_IDS, (provider) => (provider === "coingecko" ? substitution : {})) }),
    );
    expect(assessment.state).toBe("INVALID_PROVIDER_IDENTITY");
    expect(assessment.problems.join(" ")).toContain("the provider returned");
  });

  it("23. the provider-native id must be the one this repository documents", () => {
    const wrongNative = rec("coingecko", { providerInstrumentId: "coinglass-BTC" });
    const assessment = assess(
      pkg({ records: records(REQUIRED_PROVIDER_IDS, (provider) => (provider === "coingecko" ? wrongNative : {})) }),
    );
    expect(assessment.state).toBe("INVALID_PROVIDER_IDENTITY");
    expect(assessment.problems.join(" ")).toContain("this repository documents bitcoin");
  });

  it("24. an unknown instrument is refused", () => {
    const assessment = assess(
      pkg({
        records: records(REQUIRED_PROVIDER_IDS, (provider) =>
          provider === "twelve-data" ? { instrument: "NOT/A-PAIR" } : {},
        ),
      }),
    );
    expect(assessment.state).toBe("INVALID_PROVIDER_IDENTITY");
    expect(assessment.problems.join(" ")).toContain("is not canonical");
  });

  it("25. an instrument-scoped provider without an instrument is refused", () => {
    expect(INSTRUMENT_SCOPED_PROVIDERS.length).toBeGreaterThan(0);
    const provider = INSTRUMENT_SCOPED_PROVIDERS[0];
    const assessment = assess(
      pkg({
        records: records(REQUIRED_PROVIDER_IDS, (id) =>
          id === provider ? { instrument: null, providerInstrumentId: null } : {},
        ),
      }),
    );
    expect(assessment.state).toBe("INVALID_PROVIDER_IDENTITY");
    expect(assessment.problems.join(" ")).toContain("names no instrument");
  });

  it("26. a dataset outside the canonical vocabulary is refused", () => {
    const assessment = assess(
      pkg({ records: records(REQUIRED_PROVIDER_IDS, (provider) => (provider === "okx" ? { dataset: "prices" } : {})) }),
    );
    expect(assessment.state).toBe("INVALID_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("is not one of this repository's datasets");
    // And the vocabulary is the cache's own, not a second list.
    expect(EVIDENCE_D_DATASETS).toContain("ohlcv");
    expect(datasetCadence("quote")?.ttlMs).toBeGreaterThan(0);
    expect(datasetCadence("not-a-dataset")).toBeNull();
  });

  it("27. two records for one provider that disagree about the dataset are contradictory", () => {
    const duplicated = [...records(), rec(REQUIRED_PROVIDER_IDS[0], { dataset: "quote" })];
    const assessment = assess(pkg({ records: duplicated }));
    expect(assessment.complete).toBe(false);
    expect(assessment.problems.join(" ")).toContain("appears more than once");
  });

  it("28. the documented hosts are the ones the URL builders use", () => {
    // Parity, not a second source of truth: the constant must agree with the
    // request builders in `client.ts`.
    const client = read("src/lib/data/universal/live/client.ts");
    for (const [provider, host] of Object.entries(DOCUMENTED_PROVIDER_HOSTS)) {
      expect(client, provider).toContain(`https://${host}/`);
    }
    const urls = [...client.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((match) => match[1]);
    const documented = [...new Set(urls)].sort();
    expect(documented).toEqual(
      Object.values(DOCUMENTED_PROVIDER_HOSTS).sort(),
    );
  });

  it("29. a host this repository does not document is reported, never invented", () => {
    expect(HOST_NOT_DOCUMENTED.length).toBeGreaterThan(0);
    for (const provider of HOST_NOT_DOCUMENTED) {
      expect(DOCUMENTED_PROVIDER_HOSTS[provider]).toBeUndefined();
    }
    const handoff = buildEvidenceDOperatorHandoff(assess(pkg()), { filingPath: PROOF_PATHS.evidenceD });
    expect(handoff.recordContract.hostNotDocumented).toEqual([...HOST_NOT_DOCUMENTED]);
    expect(handoff.recordContract.datasetOwnership).toContain("declares no provider→dataset map");
    // And the helper refuses to guess one.
    const guessed = evidenceDRecord({ provider: "defillama", instrument: "BTC/USD" });
    expect((guessed.provenance as { host: string }).host).toBe("");
    expect(isNonProductionHost("")).toBe(true);
  });

  it("30. the provider-native ids come from the instrument registry", () => {
    const mapped = getAllInstrumentIds().filter((instrument) => getProviderSymbol(instrument, "coingecko"));
    expect(mapped.length).toBeGreaterThan(0);
    for (const instrument of mapped) {
      const documented = getProviderSymbol(instrument, "coingecko");
      const accepted = rec("coingecko", { instrument, providerInstrumentId: documented });
      const assessment = assess(
        pkg({ records: records(REQUIRED_PROVIDER_IDS, (provider) => (provider === "coingecko" ? accepted : {})) }),
      );
      expect(assessment.complete, `${instrument} → ${documented}`).toBe(true);
    }
  });
});

/* ── E. timestamps and freshness ────────────────────────────────────────── */

describe("247 — timestamps are provider-owned, receipts are client-owned", () => {
  const oneBad = (override: Partial<EvidenceDRecord>) =>
    assess(pkg({ records: records(REQUIRED_PROVIDER_IDS, (provider, index) => (index === 0 ? override : {})) }));

  it("31. a stale observation is refused even with a fresh receipt", () => {
    const stale = rec(REQUIRED_PROVIDER_IDS[0], {
      observedAt: NOW - 8 * DAY,
      receivedAt: NOW - 1_000,
    });
    const assessment = oneBad(stale);
    expect(assessment.state).toBe("STALE_PROVIDER_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("a later local timestamp cannot make it current");
  });

  it("32. the freshness boundary is exact on both sides", () => {
    const window = EVIDENCE_D_MAX_AGE_MS as number;
    expect(window).toBe(7 * DAY);
    const atBoundary = oneBad(rec(REQUIRED_PROVIDER_IDS[0], { observedAt: NOW - window, receivedAt: NOW - 1 }));
    const justOver = oneBad(rec(REQUIRED_PROVIDER_IDS[0], { observedAt: NOW - window - 1, receivedAt: NOW - 1 }));
    expect(atBoundary.complete).toBe(true);
    expect(justOver.complete).toBe(false);
    expect(justOver.state).toBe("STALE_PROVIDER_EVIDENCE");
  });

  it("33. a future observation is refused, by the observation rule itself", () => {
    const assessment = oneBad({ observedAt: NOW + 60_000, receivedAt: NOW + 61_000 });
    expect(assessment.state).toBe("FUTURE_OBSERVATION");
    // The code, not just the aggregate: a future receipt must not be able to
    // stand in as the reason a future observation was refused.
    expect(assessment.refusals.map((entry) => entry.code)).toContain("FUTURE_OBSERVATION");
    expect(assessment.problems.join(" ")).toContain("ahead of the evaluation");
  });

  it("34. a future receipt is refused, by the receipt rule itself", () => {
    const assessment = oneBad({ observedAt: NOW - 60_000, receivedAt: NOW + 60_000 });
    expect(assessment.state).toBe("FUTURE_OBSERVATION");
    expect(assessment.refusals.map((entry) => entry.code)).toContain("FUTURE_RECEIPT");
  });

  it("35. a missing observation time is refused, and a receipt never stands in for it", () => {
    /* Built by deleting the field from a real record, rather than by overriding:
       the helper must not be able to re-add the instant it is proving absent. */
    const missing = { ...rec(REQUIRED_PROVIDER_IDS[0]), receivedAt: NOW - 1_000 } as Record<string, unknown>;
    delete missing.observedAt;
    const withMissing = [missing as EvidenceDRecord, ...records().slice(1)];
    const assessment = assess(pkg({ records: withMissing }));
    expect(assessment.state).toBe("INVALID_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("a receipt time is not an observation");
    // The record is not silently repaired: the assessment reports the same
    // package as inadmissible however many times it is evaluated.
    const again = assess(pkg({ records: withMissing }));
    expect(again.problems).toEqual(assessment.problems);
  });

  it("36. a receipt before the observation is contradictory", () => {
    const assessment = oneBad({ observedAt: NOW - 1_000, receivedAt: NOW - 9_000 });
    expect(assessment.state).toBe("CONTRADICTORY_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("received before it was observed");
  });

  it("37. a non-finite observation is refused rather than coerced", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "1800000000000" as never]) {
      const assessment = oneBad({ observedAt: value });
      expect(assessment.complete, String(value)).toBe(false);
    }
  });

  it("38. a future verification instant is refused", () => {
    const assessment = assess(pkg({ verifiedAt: NOW + 60_000 }));
    expect(assessment.state).toBe("FUTURE_OBSERVATION");
    expect(assessment.problems.join(" ")).toContain("verified");
  });

  it("39. the evaluation instant is injected: no clock is read anywhere in the decision", () => {
    const source = read("src/lib/deployment/evidence-d-verification.ts");
    expect(source).not.toMatch(/Date\.now|new Date\(|process\.env/);
    const later = assess(pkg(), { now: NOW + 8 * DAY });
    expect(later.state).toBe("STALE_PROVIDER_EVIDENCE");
    // Time passing makes the same package staler, never fresher.
    const earlier = assess(pkg(), { now: NOW - HOUR });
    expect(earlier.state).toBe("FUTURE_OBSERVATION");
  });

  it("40. a missing evaluation instant is refused instead of defaulting to a clock", () => {
    const assessment = evaluateEvidenceDPackage(pkg(), { now: Number.NaN });
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("INVALID_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("no evaluation instant");
  });
});

/* ── F. multi-provider completeness ─────────────────────────────────────── */

describe("247 — Evidence D is complete only when every required provider is verified", () => {
  it("41. one missing provider makes the package incomplete, and the rest stay verified", () => {
    const dropped = REQUIRED_PROVIDER_IDS[2];
    const assessment = assess(pkg({ records: records(REQUIRED_PROVIDER_IDS.filter((id) => id !== dropped)) }));
    expect(assessment.complete).toBe(false);
    expect(assessment.verifiedProviders).toEqual([...REQUIRED_PROVIDER_IDS].filter((id) => id !== dropped).sort());
    expect(assessment.missingProviders).toEqual([dropped]);
    // One healthy provider never stands in for another.
    expect(assessment.verifiedProviders).not.toContain(dropped);
  });

  it("42. one stale, one fixture and one malformed record each break the whole set", () => {
    const cases: [string, (provider: string, index: number) => Partial<EvidenceDRecord>][] = [
      ["stale", (provider, index) => (index === 4 ? { observedAt: NOW - 30 * DAY, receivedAt: NOW - 1 } : {})],
      ["fixture", (provider, index) => (index === 1 ? { fixture: true } : {})],
      ["historical", (provider, index) => (index === 6 ? { mode: "cache-reused" } : {})],
    ];
    for (const [label, overrides] of cases) {
      const assessment = assess(pkg({ records: records(REQUIRED_PROVIDER_IDS, overrides) }));
      expect(assessment.complete, label).toBe(false);
      expect(assessment.problems.length, label).toBeGreaterThan(0);
    }

    const malformed = assess(pkg({ records: [...records().slice(1), null as never] }));
    expect(malformed.complete).toBe(false);

    const contradictory = assess(
      pkg({
        records: [
          ...records().slice(1),
          rec(REQUIRED_PROVIDER_IDS[0]),
          rec(REQUIRED_PROVIDER_IDS[0], { dataset: "quote" }),
        ],
      }),
    );
    expect(contradictory.complete).toBe(false);
    // Two records that disagree are contradictory before they are duplicates:
    // the gate's own rule is that a contradiction is never resolved by preference.
    expect(contradictory.state).toBe("CONTRADICTORY_EVIDENCE");
    expect(contradictory.problems.join(" ")).toContain("claims dataset quote");
  });

  it("43. every required provider verified is the ONLY complete shape", () => {
    expect(assess(pkg()).complete).toBe(true);
    for (const provider of REQUIRED_PROVIDER_IDS) {
      const assessment = assess(pkg({ records: records(REQUIRED_PROVIDER_IDS.filter((id) => id !== provider)) }));
      expect(assessment.complete, provider).toBe(false);
      expect(assessment.missingProviders, provider).toEqual([provider]);
    }
  });

  it("44. a package bound to another candidate is refused here, where the gate cannot look", () => {
    const assessment = assess(pkg({ candidate: { commit: "deadbeef", ref: CANDIDATE_REF } }));
    expect(assessment.complete).toBe(false);
    expect(assessment.state).toBe("INVALID_EVIDENCE");
    expect(assessment.problems.join(" ")).toContain("bound to candidate");
  });
});

/* ── G. the gate and the canonical admission ────────────────────────────── */

describe("247 — the gate reads what the validator verified, and nothing else", () => {
  const releaseInput = (records_: readonly EvidenceRecord[]): ReleaseInput => ({
    candidate: { commit: CANDIDATE_COMMIT, ref: CANDIDATE_REF, productionDeployment: "prod-1" },
    affectedRefs: ["main", "phase-157"],
    requiredProviders: [...REQUIRED_PROVIDER_IDS],
    records: records_,
  });

  it("45. an admissible package produces a gate record the gate accepts", () => {
    const projection = toGateEvidenceRecord(assess(pkg()), GATE_OPTIONS);
    const others = RELEASE_PREREQUISITES.filter((entry) => entry.id !== EVIDENCE_D_PREREQUISITE).map((entry) =>
      otherProof(entry.id),
    );
    const verdict = evaluateRelease(releaseInput([...others, projection.record as EvidenceRecord]), {
      prerequisites: RELEASE_PREREQUISITES,
      now: NOW,
    });

    expect(verdict.verdict).toBe("READY");
    expect(verdict.blockers).toEqual([]);
  });

  it("46. an inadmissible package produces no record at all", () => {
    const assessment = assess(pkg({ records: records(REQUIRED_PROVIDER_IDS.slice(0, -1)) }));
    const projection = toGateEvidenceRecord(assessment, GATE_OPTIONS);
    expect(projection.record).toBeNull();
    expect(projection.refusals.length).toBeGreaterThan(0);

    const others = RELEASE_PREREQUISITES.filter((entry) => entry.id !== EVIDENCE_D_PREREQUISITE).map((entry) =>
      otherProof(entry.id),
    );
    const verdict = evaluateRelease(releaseInput(others), {
      prerequisites: RELEASE_PREREQUISITES,
      now: NOW,
    });
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toContain(EVIDENCE_D_PREREQUISITE);
  });

  it("46b. the gate's own provider-coverage rule still refuses a partial subject", () => {
    // The second line of defence, exercised on its own: a record that reaches the
    // gate claiming VERIFIED while covering eleven providers minus one must fail
    // the provider-set binding, not merely be reported.
    const others = RELEASE_PREREQUISITES.filter((entry) => entry.id !== EVIDENCE_D_PREREQUISITE).map((entry) =>
      otherProof(entry.id),
    );
    const partial: EvidenceRecord = {
      prerequisite: EVIDENCE_D_PREREQUISITE,
      status: "VERIFIED",
      source: "external-verification",
      environment: "production",
      observedAt: NOW - 60_000,
      subject: { providers: [...REQUIRED_PROVIDER_IDS.slice(0, -1)], commit: CANDIDATE_COMMIT },
    };
    const verdict = evaluateRelease(releaseInput([...others, partial]), {
      prerequisites: RELEASE_PREREQUISITES,
      now: NOW,
    });
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toContain(EVIDENCE_D_PREREQUISITE);
    expect(
      verdict.prerequisites.find((entry) => entry.id === EVIDENCE_D_PREREQUISITE)?.reasons.join(" "),
    ).toContain("incomplete provider set");

    // And with no subject at all: an unknown coverage is not coverage either.
    const silent = evaluateRelease(
      releaseInput([...others, { ...partial, subject: undefined }]),
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );
    expect(silent.verdict).toBe("NOT READY");
  });

  it("47. a filed package is judged by the validator, not by what it declares about itself", () => {
    const filed = memorySource({
      [PROOF_PATHS.refInventory]: REF_INVENTORY,
      [PROOF_PATHS.evidenceD]: JSON.stringify(pkg()),
    });
    const good = deriveCurrentReleaseState(filed, { now: NOW, ...CANDIDATE });
    const evidenceD = good.verdict.prerequisites.find((entry) => entry.id === EVIDENCE_D_PREREQUISITE);
    expect(evidenceD?.state).toBe("VERIFIED");

    // The pre-Phase-247 shape — a bare claim with a provider list — is refused.
    const claim = memorySource({
      [PROOF_PATHS.refInventory]: REF_INVENTORY,
      [PROOF_PATHS.evidenceD]: JSON.stringify({
        verified: true,
        source: "external-verification",
        environment: "production",
        observedAt: NOW - HOUR,
        subject: { commit: CANDIDATE_COMMIT, providers: [...REQUIRED_PROVIDER_IDS] },
      }),
    });
    const refused = deriveCurrentReleaseState(claim, { now: NOW, ...CANDIDATE });
    const outcome = refused.verdict.prerequisites.find((entry) => entry.id === EVIDENCE_D_PREREQUISITE);
    expect(outcome?.state).toBe("BLOCKED");
    expect(outcome?.reasons.join(" ")).toContain("refused by the Evidence D validator");
    expect(refused.verdict.verdict).toBe("NOT READY");
  });

  it("48. a partially covered filed package keeps exactly the providers it verified", () => {
    const dropped = REQUIRED_PROVIDER_IDS[1];
    const filed = memorySource({
      [PROOF_PATHS.refInventory]: REF_INVENTORY,
      [PROOF_PATHS.evidenceD]: JSON.stringify(
        pkg({ records: records(REQUIRED_PROVIDER_IDS.filter((id) => id !== dropped)) }),
      ),
    });
    const state = deriveCurrentReleaseState(filed, { now: NOW, ...CANDIDATE });
    const outcome = state.verdict.prerequisites.find((entry) => entry.id === EVIDENCE_D_PREREQUISITE);
    expect(outcome?.state).toBe("BLOCKED");
    expect(outcome?.reasons.join(" ")).toContain("incomplete provider set");
  });

  it("49. a filed package that has gone stale is refused, and the gate's own stale rule fires", () => {
    const stale = records(REQUIRED_PROVIDER_IDS, (provider, index) =>
      index === 0 ? { observedAt: NOW - 20 * DAY, receivedAt: NOW - 19 * DAY } : {},
    );
    const filed = memorySource({
      [PROOF_PATHS.refInventory]: REF_INVENTORY,
      [PROOF_PATHS.evidenceD]: JSON.stringify(pkg({ records: stale })),
    });
    const state = deriveCurrentReleaseState(filed, { now: NOW, ...CANDIDATE });
    const outcome = state.verdict.prerequisites.find((entry) => entry.id === EVIDENCE_D_PREREQUISITE);
    const reasons = outcome?.reasons.join(" ") ?? "";
    expect(outcome?.state).toBe("BLOCKED");
    // Two independent statements, from two layers: this phase's validator named
    // the state, and the gate applied its own freshness window to the same
    // instant because the refusal record carries the oldest DECLARED observation.
    expect(reasons).toContain("refused by the Evidence D validator (STALE_PROVIDER_EVIDENCE)");
    expect(reasons).toContain("stale: evidence is older than");
    expect(state.verdict.verdict).toBe("NOT READY");
  });

  it("49b. a filed package that cannot be parsed is unverified, never a pass", () => {
    const filed = memorySource({
      [PROOF_PATHS.refInventory]: REF_INVENTORY,
      [PROOF_PATHS.evidenceD]: "{ this is not json",
    });
    const state = deriveCurrentReleaseState(filed, { now: NOW, ...CANDIDATE });
    const outcome = state.verdict.prerequisites.find((entry) => entry.id === EVIDENCE_D_PREREQUISITE);
    // The reader names the parse failure on the record; the gate reports the
    // record as malformed, which is the same refusal one layer up.
    expect(outcome?.state).toBe("UNVERIFIED");
    expect(outcome?.reasons.join(" ")).toContain("malformed");
    expect(state.verdict.verdict).toBe("NOT READY");
  });

  it("50. a fixture package cannot satisfy the gate even when it is filed", () => {
    const filed = memorySource({
      [PROOF_PATHS.refInventory]: REF_INVENTORY,
      [PROOF_PATHS.evidenceD]: JSON.stringify(pkg({ fixture: true })),
    });
    const state = deriveCurrentReleaseState(filed, { now: NOW, ...CANDIDATE });
    const outcome = state.verdict.prerequisites.find((entry) => entry.id === EVIDENCE_D_PREREQUISITE);
    expect(outcome?.state).toBe("BLOCKED");
    expect(state.verdict.verdict).toBe("NOT READY");
  });

  it("51. the phase 242 admission stays authoritative and refuses without a real package", () => {
    const withoutPackage = evaluateReleaseAdmission({
      source: memorySource({ [PROOF_PATHS.refInventory]: REF_INVENTORY }),
      now: NOW,
      commit: CANDIDATE_COMMIT,
      ref: CANDIDATE_REF,
      productionDeployment: "prod-1",
    });
    expect(withoutPackage.admitted).toBe(false);
    expect(withoutPackage.blockers.map((blocker) => blocker.id)).toContain(EVIDENCE_D_PREREQUISITE);
    expect(
      withoutPackage.blockers
        .find((blocker) => blocker.id === EVIDENCE_D_PREREQUISITE)
        ?.reasons.join(" "),
    ).toContain("no evidence was supplied");

    // With every other proof filed and the evidence conformant, the same
    // admission path accepts only inside this synthetic tree.
    const accepted = evaluateReleaseAdmission({
      source: memorySource({
        [PROOF_PATHS.refInventory]: REF_INVENTORY,
        [PROOF_PATHS.a1Revocation]: otherProofFile("A1_OTP_ISSUER_REVOCATION"),
        [PROOF_PATHS.rewriteVerification]: otherProofFile("A2_HISTORY_REWRITE"),
        [PROOF_PATHS.convexDeployment]: otherProofFile("CONVEX_PRODUCTION_DEPLOYMENT"),
        [PROOF_PATHS.emailDelivery]: otherProofFile("PRODUCTION_EMAIL_TRANSPORT"),
        [PROOF_PATHS.evidenceD]: JSON.stringify(pkg()),
      }),
      now: NOW,
      commit: CANDIDATE_COMMIT,
      ref: CANDIDATE_REF,
      productionDeployment: "prod-1",
    });
    expect(accepted.admitted).toBe(true);
    // And it is the canonical layers that produced that, not this phase.
    expect(currentReleaseVerdict(memorySource({}), { now: NOW })).not.toBe(accepted.verdict);
  });

  it("52. local success, configuration presence and documentation are not Evidence D", () => {
    // Configuration presence: the requirements are declared...
    expect(PROVIDER_CREDENTIAL_REQUIREMENTS.length).toBeGreaterThan(0);
    expect(PROVIDER_CREDENTIAL_REQUIREMENTS.every((entry) => entry.requiredEnvVars.length >= 0)).toBe(true);
    // ...and the real tree still has no Evidence D.
    const real = deriveCurrentReleaseState(
      { exists: (path) => path === PROOF_PATHS.refInventory, read: () => REF_INVENTORY },
      { now: NOW, ...CANDIDATE },
    );
    expect(
      real.verdict.prerequisites.find((entry) => entry.id === EVIDENCE_D_PREREQUISITE)?.state,
    ).toBe("UNVERIFIED");

    // Documentation and a local run: refused by the gate itself, whatever they say.
    for (const source of ["documentation", "local-run", "fixture", "ci-run"] as const) {
      const verdict = evaluateRelease(
        releaseInput([
          ...RELEASE_PREREQUISITES.filter((entry) => entry.id !== EVIDENCE_D_PREREQUISITE).map((entry) =>
            otherProof(entry.id),
          ),
          {
            prerequisite: EVIDENCE_D_PREREQUISITE,
            status: "VERIFIED",
            source,
            environment: "production",
            observedAt: NOW - 60_000,
            subject: { providers: [...REQUIRED_PROVIDER_IDS], commit: CANDIDATE_COMMIT },
          },
        ]),
        { prerequisites: RELEASE_PREREQUISITES, now: NOW },
      );
      expect(verdict.verdict, source).toBe("NOT READY");
      expect(verdict.blockers, source).toContain(EVIDENCE_D_PREREQUISITE);
    }
  });

  it("53. the real project is still NOT READY and the synthetic evaluations changed nothing", () => {
    const before = currentReleaseVerdict(undefined, { now: NOW });
    assess(pkg());
    assess(pkg({ fixture: true }));
    toGateEvidenceRecord(assess(pkg()), GATE_OPTIONS);
    evaluateReleaseAdmission({ now: NOW, commit: CANDIDATE_COMMIT, ref: CANDIDATE_REF });
    const after = currentReleaseVerdict(undefined, { now: NOW });

    expect(after).toEqual(before);
    expect(after.verdict).toBe("NOT READY");
    expect(after.blockers).toContain("A1_OTP_ISSUER_REVOCATION");
    expect(after.blockers).toContain("A2_HISTORY_REWRITE");
    expect(after.blockers).toContain(EVIDENCE_D_PREREQUISITE);
    // And nothing was filed by any of that.
    const state = deriveCurrentReleaseState(undefined, { now: NOW, ...CANDIDATE });
    expect(state.facts.proofFilesPresent).toEqual([]);
  });

  it("54. the A1 and A2 verdicts are untouched by this phase", () => {
    const verdict = currentReleaseVerdict(undefined, { now: NOW });
    for (const id of ["A1_OTP_ISSUER_REVOCATION", "A2_HISTORY_REWRITE"]) {
      const outcome = verdict.prerequisites.find((entry) => entry.id === id);
      expect(outcome?.mandatory).toBe(true);
      expect(outcome?.state).not.toBe("VERIFIED");
    }
  });
});

/* ── H. the operator command ────────────────────────────────────────────── */

describe("247 — the operator command cannot act", () => {
  const script = () => read("scripts/evidence-d-verify.mjs");

  it("55. the command imports no network module and opens no socket", () => {
    const source = stripComments(script());
    expect(source).not.toMatch(/node:(net|http|https|dns|tls|dgram)/);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    // Its node imports are exactly these.
    const imports = [...source.matchAll(/from "(node:[a-z/]+)"/g)].map((match) => match[1]).sort();
    expect(imports).toEqual(["node:fs", "node:module", "node:path", "node:url"]);
  });

  it("56. the command reads nothing but the package, and touches no credential", () => {
    const source = stripComments(script());
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/readFileSync\([^)]*KEY|credentials/i);
    // fs is used for reading and for presence only.
    const fsCalls = [...source.matchAll(/\b(readFileSync|existsSync|writeFileSync|mkdirSync|rmSync|appendFileSync|createWriteStream|unlinkSync|copyFileSync|renameSync)\b/g)].map(
      (match) => match[1],
    );
    expect([...new Set(fsCalls)].sort()).toEqual(["existsSync", "readFileSync"]);
  });

  it("57. the command runs no git, no deployment and no mail", () => {
    const source = stripComments(script());
    expect(source).not.toMatch(/node:child_process|execSync|spawnSync|\bspawn\s*\(|\bexec\s*\(/);
    expect(source).not.toMatch(/convex deploy|tauri build|gh release|npm publish|sendmail|nodemailer/);
    expect(source).not.toMatch(/PROOF_PATHS\.[a-zA-Z]+\s*\]?\s*=/);
  });

  it("58. the command calls the canonical admission instead of re-implementing it", () => {
    const source = stripComments(script());
    expect(source).toContain("evaluateReleaseAdmission");
    expect(source).toContain("deriveCurrentReleaseState");
    // It does not compute a verdict of its own.
    expect(source).not.toMatch(/verdict\s*[:=]\s*["'`](READY|NOT READY)["'`]/);
    expect(source).toContain("verdictIssuedHere: false");
    expect(source).toContain("packagePersisted: false");
  });

  it("59. the decision module is pure: no fs, no process, no clock, no socket", () => {
    const source = stripComments(read("src/lib/deployment/evidence-d-verification.ts"));
    expect(source).not.toMatch(/node:(fs|child_process|net|http|https|dns|tls|process)/);
    expect(source).not.toMatch(/\bfetch\s*\(|process\.env|Date\.now|new Date\(/);
    expect(source).not.toMatch(/writeFileSync|spawnSync|execSync|mkdirSync/);
  });

  it("60. the handoff states its guarantees, and every one of them is false", () => {
    const handoff = buildEvidenceDOperatorHandoff(assess(pkg()), { filingPath: PROOF_PATHS.evidenceD });
    for (const [key, value] of Object.entries(handoff.guarantees)) {
      expect(value, key).toBe(false);
    }
    expect(Object.keys(handoff.guarantees).length).toBeGreaterThanOrEqual(8);
    expect(handoff.providerContacted).toBe(false);
    expect(handoff.verdictIssuedHere).toBe(false);
    expect(handoff.prerequisite.id).toBe(EVIDENCE_D_PREREQUISITE);
    expect(handoff.prerequisite.environment).toBe(EVIDENCE_D_ENVIRONMENT);

    const rendered = formatEvidenceDOperatorHandoff(handoff);
    expect(rendered).toContain("did not contact a provider");
    expect(rendered).toContain("does not issue a release verdict");
    expect(rendered).toContain(EVIDENCE_D_SCHEMA);
    expect(rendered).toContain("documented hosts");
    expect(rendered).toContain("operator sequence");
  });

  it("61. the exit codes separate a blocker from a report that could not be produced", () => {
    expect(evidenceDHandoffExitCode(buildEvidenceDOperatorHandoff(assess(pkg()), { filingPath: "p" }))).toBe(0);
    expect(
      evidenceDHandoffExitCode(buildEvidenceDOperatorHandoff(assess(pkg({ records: [] })), { filingPath: "p" })),
    ).toBe(1);
    // The blocker wording is a blocker, not a favourable finding.
    const refusal = formatEvidenceDOperatorHandoff(
      buildEvidenceDOperatorHandoff(assess(pkg({ records: records(REQUIRED_PROVIDER_IDS.slice(0, 3)) })), {
        filingPath: "p",
      }),
    );
    expect(refusal).toContain("blocker");
    expect(refusal).toContain("not a negative finding about the providers");
  });

  it("62. the command is wired to the canonical filing path", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["evidence:d:verify"]).toContain("scripts/evidence-d-verify.mjs");
    expect(scripts["evidence:d:verify"]).toContain("--no-warnings");
    expect(PROOF_PATHS.evidenceD).toBe("docs/remediation/evidence-d-production.json");
    // No production evidence is filed by this phase.
    expect(read("scripts/evidence-d-verify.mjs")).toContain("PROOF_PATHS.evidenceD");
  });
});
