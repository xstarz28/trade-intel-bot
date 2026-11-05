const LEGACY_MIGRATION_ORIGINS = new Set(["https://xstarzganaliys.com"]);

export function resolveLegacyMigrationRedirect(redirectTo: string, configuredSiteUrl?: string): string {
  const allowedOrigins = new Set(LEGACY_MIGRATION_ORIGINS);
  let baseUrl = "https://xstarzganaliys.com";

  if (configuredSiteUrl) {
    try {
      const configured = new URL(configuredSiteUrl);
      allowedOrigins.add(configured.origin);
      baseUrl = configured.toString();
    } catch {
      // Invalid legacy SITE_URL must not expand the redirect allowlist.
    }
  }

  const target = new URL(redirectTo, baseUrl);
  if (!allowedOrigins.has(target.origin)) {
    throw new Error("Legacy account migration redirect origin is not allowed.");
  }
  return target.toString();
}
