/**
 * Phase 48 — Provider Coverage Matrix & Instrument Discovery
 *
 * Machine-readable coverage report answering:
 *   "For this exact instrument and capability, which provider can supply data?"
 *
 * CRITICAL RULES:
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing mapping = unavailable.
 *   - Missing provider = unavailable.
 *   - No fabricated provider symbols, exchanges, or capabilities.
 *   - Coverage matrix is informational infrastructure only.
 */

import type {
  AssetClass,
  CanonicalInstrument,
  DataCapability,
} from "./types";
import {
  resolveInstrument,
  resolveInstrumentWithAliases,
  getAllInstruments,
  getProviderSymbol,
  getAllInstrumentIds,
} from "./instruments";
import { getAllProviders } from "./providers";
import type { EnvReader } from "./live/credentials";

// ═══════════════════════════════════════════════════════════════
// COVERAGE MATRIX TYPES
// ═══════════════════════════════════════════════════════════════

export interface ProviderCoverageEntry {
  /** Provider ID. */
  providerId: string;
  /** Provider display name. */
  providerName: string;
  /** Capability this provider supports. */
  capability: DataCapability;
  /** Provider-specific symbol for this instrument. */
  providerSymbol: string | null;
  /** Whether the provider has credentials configured. */
  credentialsAvailable: boolean;
  /** Whether this specific provider+instrument+capability is mapped. */
  mapped: boolean;
  /** Quality level if mapped. */
  quality: "FULL" | "PARTIAL" | "UNAVAILABLE";
}

export interface InstrumentCoverageReport {
  /** Canonical instrument ID. */
  instrument: string;
  /** Instrument identity. */
  identity: CanonicalInstrument;
  /** All provider coverage entries for this instrument. */
  coverage: ProviderCoverageEntry[];
  /** Capabilities that have at least one available provider. */
  supportedCapabilities: DataCapability[];
  /** Capabilities with no available provider. */
  unsupportedCapabilities: DataCapability[];
  /** Number of providers available. */
  availableProviderCount: number;
  /** Number of capabilities available. */
  availableCapabilityCount: number;
  /** Overall coverage assessment. */
  coverageLevel: "FULL" | "PARTIAL" | "MINIMAL" | "NONE";
}

export interface ProviderCoverageSummary {
  /** Provider ID. */
  providerId: string;
  /** Provider display name. */
  providerName: string;
  /** Number of instruments this provider covers. */
  instrumentCount: number;
  /** Asset classes covered. */
  assetClasses: AssetClass[];
  /** Capabilities declared. */
  capabilities: DataCapability[];
  /** Whether credentials are available. */
  credentialsAvailable: boolean;
}

export interface CoverageMatrix {
  /** When this matrix was assembled. */
  assembledAt: number;
  /** Total known instruments. */
  totalInstruments: number;
  /** Total registered aliases. */
  totalAliases: number;
  /** Instrument count by asset class. */
  instrumentCountByClass: Record<string, number>;
  /** Per-instrument coverage reports. */
  instruments: InstrumentCoverageReport[];
  /** Per-provider summaries. */
  providers: ProviderCoverageSummary[];
  /** Total provider coverage entries. */
  totalCoverageEntries: number;
  /** Capabilities available per asset class. */
  capabilitiesByAssetClass: Record<string, DataCapability[]>;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER PROFILES (duplicated for coverage computation)
// ═══════════════════════════════════════════════════════════════

// Use the canonical provider registry so routing and coverage cannot drift.


// ═══════════════════════════════════════════════════════════════
// COVERAGE MATRIX ASSEMBLY
// ═══════════════════════════════════════════════════════════════

/**
 * Compute provider coverage for a single instrument.
 */
export function computeInstrumentCoverage(instrument: string, readEnv?: EnvReader): InstrumentCoverageReport | null {
  const canonical = resolveInstrument(instrument);
  if (!canonical) return null;

  const providerSpecs = getAllProviders(readEnv);
  const coverage: ProviderCoverageEntry[] = [];
  const supportedCapabilities = new Set<DataCapability>();
  const unsupportedCapabilities = new Set<DataCapability>();
  const allCapabilities = new Set<DataCapability>();

  for (const spec of providerSpecs) {
    if (!spec.assetClasses.includes(canonical.assetClass)) continue;

    for (const cap of spec.capabilities) {
      if (!cap.assetClasses.includes(canonical.assetClass)) continue;

      const providerSymbol = getProviderSymbol(instrument, spec.id);
      allCapabilities.add(cap.capability);

      coverage.push({
        providerId: spec.id,
        providerName: spec.name,
        capability: cap.capability,
        providerSymbol,
        credentialsAvailable: spec.credentialsAvailable,
        mapped: !!providerSymbol,
        quality: providerSymbol ? (cap.quality as "FULL" | "PARTIAL") : "UNAVAILABLE",
      });

      if (providerSymbol && spec.credentialsAvailable) {
        supportedCapabilities.add(cap.capability);
      }
    }
  }

  for (const capability of allCapabilities) {
    if (!supportedCapabilities.has(capability)) unsupportedCapabilities.add(capability);
  }

  const availableCapabilityCount = supportedCapabilities.size;
  const availableProviderCount = new Set(
    coverage.filter((c) => c.mapped && c.credentialsAvailable).map((c) => c.providerId),
  ).size;

  let coverageLevel: InstrumentCoverageReport["coverageLevel"] = "NONE";
  if (availableCapabilityCount >= 5) coverageLevel = "FULL";
  else if (availableCapabilityCount >= 3) coverageLevel = "PARTIAL";
  else if (availableCapabilityCount >= 1) coverageLevel = "MINIMAL";

  return {
    instrument: canonical.canonical,
    identity: canonical,
    coverage,
    supportedCapabilities: Array.from(supportedCapabilities),
    unsupportedCapabilities: Array.from(unsupportedCapabilities),
    availableProviderCount,
    availableCapabilityCount,
    coverageLevel,
  };
}

/**
 * Compute provider summary across all instruments.
 */
export function computeProviderSummaries(readEnv?: EnvReader): ProviderCoverageSummary[] {
  const providerSpecs = getAllProviders(readEnv);
  return providerSpecs.map((spec) => {
    const instrumentCount = getAllInstruments().filter((inst) =>
      spec.assetClasses.includes(inst.assetClass) &&
      getProviderSymbol(inst.canonical, spec.id) !== null,
    ).length;

    return {
      providerId: spec.id,
      providerName: spec.name,
      instrumentCount,
      assetClasses: [...spec.assetClasses],
      capabilities: spec.capabilities.map((c) => c.capability),
      credentialsAvailable: spec.credentialsAvailable,
    };
  });
}

/**
 * Assemble the full coverage matrix.
 */
export function assembleCoverageMatrix(readEnv?: EnvReader): CoverageMatrix {
  const providerSpecs = getAllProviders(readEnv);
  const instruments = getAllInstrumentIds();
  const instrumentReports = instruments
    .map((id) => computeInstrumentCoverage(id, readEnv))
    .filter((r): r is InstrumentCoverageReport => r !== null);

  const capabilitiesByAssetClass: Record<string, DataCapability[]> = {};
  const assetClasses: AssetClass[] = ["crypto", "forex", "equity", "commodity", "indices", "macro"];
  for (const ac of assetClasses) {
    const caps = new Set<DataCapability>();
    for (const spec of providerSpecs) {
      if (!spec.assetClasses.includes(ac)) continue;
      for (const cap of spec.capabilities) {
        if (cap.assetClasses.includes(ac)) caps.add(cap.capability);
      }
    }
    capabilitiesByAssetClass[ac] = Array.from(caps);
  }

  return {
    assembledAt: Date.now(),
    totalInstruments: instruments.length,
    totalAliases: 0, // placeholder — set by caller using getAliasCount()
    instrumentCountByClass: instrumentReports.reduce(
      (acc, r) => {
        const ac = r.identity.assetClass;
        acc[ac] = (acc[ac] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    instruments: instrumentReports,
    providers: computeProviderSummaries(readEnv),
    totalCoverageEntries: instrumentReports.reduce((sum, r) => sum + r.coverage.length, 0),
    capabilitiesByAssetClass,
  };
}

// ═══════════════════════════════════════════════════════════════
// DISCOVERY: "Why can't this instrument be analyzed?"
// ═══════════════════════════════════════════════════════════════

export interface InstrumentAnalysisReadiness {
  /** Whether the instrument can be analyzed. */
  ready: boolean;
  /** Resolution result. */
  resolution: ReturnType<typeof resolveInstrumentWithAliases>;
  /** Coverage report if resolved. */
  coverage: InstrumentCoverageReport | null;
  /** Reasons the instrument cannot be analyzed. */
  blockers: string[];
  /** Suggestions for the user. */
  suggestions: string[];
}

/**
 * Determine whether a user-requested instrument can be analyzed
 * and provide actionable feedback if not.
 */
export function assessAnalysisReadiness(input: string, readEnv?: EnvReader): InstrumentAnalysisReadiness {
  const resolution = resolveInstrumentWithAliases(input);

  if (resolution.status === "UNKNOWN") {
    return {
      ready: false,
      resolution,
      coverage: null,
      blockers: [`Instrument "${input}" is not recognized.`],
      suggestions: [
        "Try a canonical symbol like BTC/USD, EUR/USD, AAPL, XAU/USD",
        "Use common aliases like GOLD, BITCOIN, NVIDIA",
      ],
    };
  }

  if (resolution.status === "AMBIGUOUS") {
    return {
      ready: false,
      resolution,
      coverage: null,
      blockers: [`Ambiguous input "${input}" — multiple matches found: ${resolution.candidates?.join(", ")}`],
      suggestions: resolution.candidates?.slice(0, 3).map((c) => `Try "${c}"`) ?? [],
    };
  }

  if (!resolution.instrument) {
    return {
      ready: false,
      resolution,
      coverage: null,
      blockers: [`Could not resolve "${input}" to a canonical instrument.`],
      suggestions: [],
    };
  }

  const coverage = computeInstrumentCoverage(resolution.instrument.canonical, readEnv);

  if (!coverage) {
    return {
      ready: false,
      resolution,
      coverage: null,
      blockers: [`Instrument "${resolution.instrument.canonical}" has no coverage data.`],
      suggestions: [],
    };
  }

  if (coverage.supportedCapabilities.length === 0) {
    return {
      ready: false,
      resolution,
      coverage,
      blockers: [
        `No provider with available credentials supports "${resolution.instrument.canonical}".`,
        `Asset class: ${resolution.instrument.assetClass}`,
      ],
      suggestions: [
        "Check that API keys are configured in the Keys tab",
        "This instrument's asset class may require additional provider credentials",
      ],
    };
  }

  return {
    ready: true,
    resolution,
    coverage,
    blockers: [],
    suggestions: [],
  };
}

/**
 * Get a compact human-readable explanation of provider coverage for an instrument.
 */
export function explainCoverage(instrument: string, readEnv?: EnvReader): string {
  const report = computeInstrumentCoverage(instrument, readEnv);
  if (!report) return `No coverage data for "${instrument}".`;

  const parts: string[] = [];
  parts.push(`${report.instrument}: ${report.coverageLevel} coverage`);
  parts.push(`${report.availableProviderCount} providers, ${report.availableCapabilityCount} capabilities`);

  if (report.supportedCapabilities.length > 0) {
    parts.push(`Available: ${report.supportedCapabilities.join(", ")}`);
  }
  if (report.unsupportedCapabilities.length > 0) {
    parts.push(`Unavailable: ${report.unsupportedCapabilities.join(", ")}`);
  }

  return parts.join(" · ");
}
