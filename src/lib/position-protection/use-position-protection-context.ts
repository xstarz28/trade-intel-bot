import { useContext } from "react";
import { PositionProtectionContext } from "./position-protection-context";
import type { UsePositionProtectionResult } from "./use-position-protection";

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
