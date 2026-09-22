/**
 * Phase 46 — Provider Credential Awareness
 *
 * Detects whether provider credentials are configured, WITHOUT ever
 * exposing the credential values. Only env-var NAMES and boolean
 * availability leave this module.
 *
 * The environment reader is injectable so tests never touch real secrets.
 */

export interface ProviderCredentialSpec {
  providerId: string;
  /** Env var names required to call this provider. Empty = public endpoint. */
  requiredEnvVars: string[];
}

/** Credential requirements per provider (public endpoints have none). */
const CREDENTIAL_SPECS: Record<string, ProviderCredentialSpec> = {
  "twelve-data": { providerId: "twelve-data", requiredEnvVars: ["TWELVE_DATA_API_KEY"] },
  "alpha-vantage": { providerId: "alpha-vantage", requiredEnvVars: ["ALPHA_VANTAGE_API_KEY"] },
  coinglass: { providerId: "coinglass", requiredEnvVars: ["COINGLASS_API_KEY"] },
  tickatlas: { providerId: "tickatlas", requiredEnvVars: ["TICKATLAS_API_KEY"] },
  eia: { providerId: "eia", requiredEnvVars: ["EIA_API_KEY"] },
  // Public / keyless endpoints
  okx: { providerId: "okx", requiredEnvVars: [] },
  coingecko: { providerId: "coingecko", requiredEnvVars: [] },
  defillama: { providerId: "defillama", requiredEnvVars: [] },
  tokenomist: { providerId: "tokenomist", requiredEnvVars: [] },
  cftc: { providerId: "cftc", requiredEnvVars: [] },
  treasury: { providerId: "treasury", requiredEnvVars: [] },
  // Phase 235 — universal expansion
  ccxt: { providerId: "ccxt", requiredEnvVars: [] },
  dexscreener: { providerId: "dexscreener", requiredEnvVars: [] },
  geckoterminal: { providerId: "geckoterminal", requiredEnvVars: [] },
  idx: { providerId: "idx", requiredEnvVars: [] },
  stockbit: { providerId: "stockbit", requiredEnvVars: [] },
  ajaib: { providerId: "ajaib", requiredEnvVars: [] },
};

export type EnvReader = (name: string) => string | undefined;

/** Default env reader — reads names only, values are never returned. */
const defaultEnvReader: EnvReader = (name) => {
  try {
    return typeof process !== "undefined" ? process.env?.[name] : undefined;
  } catch {
    return undefined;
  }
};

export interface CredentialStatus {
  providerId: string;
  /** Whether the provider requires authentication at all. */
  authRequired: boolean;
  /** Names of required env vars (never their values). */
  requiredEnvVarNames: string[];
  /** Whether all required credentials appear configured. */
  available: boolean;
  /** Which required vars appear missing (names only). */
  missingEnvVarNames: string[];
}

/**
 * Check credential availability for a provider.
 * Returns NAMES and booleans only — credential VALUES never leave this function.
 * Phase 235: supports ccxt:<exchange> family via prefix fallback to ccxt spec.
 */
export function checkCredentials(
  providerId: string,
  readEnv: EnvReader = defaultEnvReader,
): CredentialStatus | null {
  let spec = CREDENTIAL_SPECS[providerId];
  if (!spec && providerId.startsWith("ccxt:")) {
    spec = CREDENTIAL_SPECS["ccxt"];
  }
  if (!spec) return null;

  const missing = spec.requiredEnvVars.filter((name) => {
    const v = readEnv(name);
    return !v || typeof v !== "string" || v.trim().length === 0;
  });

  return {
    providerId,
    authRequired: spec.requiredEnvVars.length > 0,
    requiredEnvVarNames: spec.requiredEnvVars,
    available: missing.length === 0,
    missingEnvVarNames: missing,
  };
}

/** List all registered credential specs (names only). */
export function getAllCredentialSpecs(): ProviderCredentialSpec[] {
  return Object.values(CREDENTIAL_SPECS).map((s) => ({ ...s }));
}
