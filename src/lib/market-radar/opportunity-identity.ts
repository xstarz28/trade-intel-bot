/**
 * Phase 241 — Canonical Opportunity Identity
 *
 * Single source of truth for opportunity identity.
 * Both radar engine and UI must consume this, not duplicate logic.
 *
 * Precedence (Phase240 proven, preserved):
 * 1. provider + providerInstrumentId (full provider-native)
 * 2. providerInstrumentId + instrument + assetClass (partial id)
 * 3. provider + instrument + assetClass + region (partial provider)
 * 4. provider + instrument + assetClass
 * 5. collision-safe legacy using assetClass/instrument/candidate/region
 *
 * Never invents provider IDs, never mutates native IDs, deterministic, no random/Date.now.
 */

export interface OpportunityIdentityInput {
  instrument: string;
  providerNative?: {
    provider?: string;
    providerInstrumentId?: string;
  };
  provider?: string;
  assetClass?: string;
  region?: string;
  candidateInstrument?: string;
}

function sanitize(s: string): string {
  return s.trim();
}

/**
 * Canonical opportunity identity — collision-safe, deterministic.
 * Used by radar state, diff detection, and UI display keys.
 */
export function canonicalOpportunityKey(input: OpportunityIdentityInput): string {
  const pn = input.providerNative as { provider?: string; providerInstrumentId?: string } | undefined;
  const asset = (input as any).assetClass ?? "unknown";
  const region = (input as any).region ?? "";
  const provider = (input as any).provider ?? "";
  const candidate = (input as any).candidateInstrument ?? "";
  const instrument = sanitize(input.instrument);

  if (!instrument) {
    // No instrument at all — deterministic fallback using whatever we have
    const fallbackParts = [asset, provider, pn?.provider, pn?.providerInstrumentId, region, candidate]
      .filter(Boolean)
      .map((s) => sanitize(s as string))
      .filter(Boolean);
    return fallbackParts.length > 0 ? fallbackParts.join("::") : "unknown::unknown::global";
  }

  // 1. Full provider-native identity
  if (pn?.provider && pn?.providerInstrumentId) {
    const p = sanitize(pn.provider);
    const id = sanitize(pn.providerInstrumentId);
    if (p && id) return `${p}::${id}`;
  }
  // 2. Partial: has native id but no provider
  if (pn?.providerInstrumentId) {
    const id = sanitize(pn.providerInstrumentId);
    if (id) return `${id}::${instrument}::${asset}`;
  }
  // 3. Partial: has provider but no native id
  if (pn?.provider) {
    const p = sanitize(pn.provider);
    if (p) {
      const base = `${p}::${instrument}::${asset}`;
      return region ? `${base}::${sanitize(region)}` : base;
    }
  }
  // 4. Fallback: top-level provider + instrument + assetClass
  if (provider) {
    const p = sanitize(provider);
    if (p) return `${p}::${instrument}::${asset}`;
  }
  // 5. Legacy fallback: assetClass::instrument::candidate::region or assetClass::instrument::region
  // Phase 241: include candidate if distinct to distinguish legacy entries with same symbol/region
  if (candidate && sanitize(candidate) !== instrument) {
    return `${asset}::${instrument}::${sanitize(candidate)}::${sanitize(region || "global")}`;
  }
  return `${asset}::${instrument}::${sanitize(region || "global")}`;
}

/**
 * Legacy identity quality assessment — does this identity have sufficient distinguishing info?
 * Returns true if identity is fully qualified (provider-native), false if legacy fallback.
 */
export function isLegacyIdentity(input: OpportunityIdentityInput): boolean {
  const pn = input.providerNative;
  return !(pn?.provider && pn?.providerInstrumentId);
}

/**
 * Deterministic identity check — same input → same output, no random/time.
 */
export function isDeterministicIdentity(input: OpportunityIdentityInput): boolean {
  const k1 = canonicalOpportunityKey(input);
  const k2 = canonicalOpportunityKey(input);
  return k1 === k2;
}
