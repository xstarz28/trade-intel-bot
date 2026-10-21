/**
 * Phase 60 — Position Protection Provider
 *
 * React context that provides position protection state and actions
 * to the component tree. Wraps usePositionProtection hook.
 *
 * INFORMATIONAL_ONLY — never executes trades.
 */

import React, { createContext, useContext } from "react";
import { usePositionProtection, type UsePositionProtectionResult } from "./use-position-protection";

// ═══════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════

const PositionProtectionContext = createContext<UsePositionProtectionResult | null>(null);

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

// ═══════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════

/**
 * Access position protection state and actions.
 * Must be used within a <PositionProtectionProvider>.
 */
export function usePositionProtectionContext(): UsePositionProtectionResult {
  const context = useContext(PositionProtectionContext);
  if (!context) {
    throw new Error(
      "usePositionProtectionContext must be used within a PositionProtectionProvider.",
    );
  }
  return context;
}
