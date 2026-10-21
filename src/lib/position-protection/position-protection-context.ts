import { createContext } from "react";
import type { UsePositionProtectionResult } from "./use-position-protection";

export const PositionProtectionContext =
  createContext<UsePositionProtectionResult | null>(null);
