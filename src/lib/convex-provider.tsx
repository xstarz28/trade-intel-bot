import React, { useMemo } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { isAllowedConvexCloudUrl } from "@/lib/convex-url";

/**
 * Optional legacy-data migration provider.
 *
 * Normal application routes never mount this component. It exists only for
 * the explicit one-time Convex account export panel while old account data is
 * being transferred to the self-hosted backend. It never owns application
 * login, session restoration, or route authorization.
 */
export function LegacyConvexMigrationProvider({ children }: { children: React.ReactNode }) {
  const rawUrl = import.meta.env.VITE_LEGACY_CONVEX_URL;
  const convexUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
  const configured = isAllowedConvexCloudUrl(convexUrl);

  const legacyClient = useMemo(() => {
    if (!configured) return null;
    try {
      return new ConvexReactClient(convexUrl);
    } catch {
      return null;
    }
  }, [configured, convexUrl]);

  if (!legacyClient) return <>{children}</>;
  return <ConvexAuthProvider client={legacyClient}>{children}</ConvexAuthProvider>;
}
