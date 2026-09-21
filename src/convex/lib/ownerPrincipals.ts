/**
 * Server-only OWNER principal lookup.
 *
 * Reads `process.env.XSTARZ_OWNER_PRINCIPALS` with a *static* property access
 * so the Convex bundler includes the deployment variable. The client bundle
 * must never import this module.
 */

import { isConfiguredOwner as matchConfiguredOwner } from "@/lib/entitlement/owner-principals";

export function isConfiguredOwner(identity: {
  userId?: string | null;
  email?: string | null;
}): boolean {
  return matchConfiguredOwner(identity, process.env.XSTARZ_OWNER_PRINCIPALS);
}
