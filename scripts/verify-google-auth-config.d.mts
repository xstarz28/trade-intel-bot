/**
 * Type surface of scripts/verify-google-auth-config.mjs (Phase 311) for the
 * TypeScript test suite. The implementation stays plain JavaScript so the
 * operator can run it with bare `node` on any machine.
 */

export declare const GOOGLE_AUTH_VARS: string[];

export declare function plausibleGoogleClientId(
  value: unknown,
): { ok: boolean; reason?: string };

export declare function plausibleGoogleSecret(
  value: unknown,
): { ok: boolean; reason?: string };

export declare function plausibleSiteUrl(
  value: unknown,
): { ok: boolean; reason?: string };

export declare function derivedCallbackUrl(convexSiteUrl: unknown): string;

export interface GoogleAuthVerdict {
  state: "GOOGLE_AUTH_CONFIGURED" | "GOOGLE_AUTH_NOT_CONFIGURED" | "GOOGLE_AUTH_INVALID";
  exitCode: 0 | 1 | 2;
  missing: string[];
  invalid: string[];
  callbackUrl: string | null;
  remediation: string[];
  /** Always false by construction — no secret value ever enters the result. */
  secretMaterialPresent: false;
}

export declare function classifyGoogleAuthConfig(
  env: Record<string, string | undefined>,
): GoogleAuthVerdict;

export declare function scanFrontendForSecretReads(srcDir: string): string[];
