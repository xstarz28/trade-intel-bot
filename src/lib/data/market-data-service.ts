/**
 * Market Data Service — imports removed for Convex compatibility.
 * The actual implementation lives in src/convex/marketData.ts as a self-contained
 * Convex action. This file serves as the type-only interface for frontend use.
 */

import type { MarketData, MarketDataResult, TechnicalData } from "./market-types";

// Re-export for frontend convenience
export type { MarketData, MarketDataResult, TechnicalData };
