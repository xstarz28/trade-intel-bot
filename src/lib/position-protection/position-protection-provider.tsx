/**
 * Phase 60 — Position Protection Provider
 *
 * React context provider for position protection state and actions.
 * Wraps usePositionProtection hook.
 *
 * INFORMATIONAL_ONLY — never executes trades.
 */

import React from "react";
import { PositionProtectionContext } from "./position-protection-context";
import { usePositionProtection } from "./use-position-protection";

// ═══════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════

export function PositionProtectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = usePositionProtection();

  return (
    <PositionProtectionContext.Provider value={value}>
      {children}
    </PositionProtectionContext.Provider>
  );
}
