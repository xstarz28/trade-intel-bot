/**
 * Shared in-memory request budget for the configured Twelve Data Free tier.
 *
 * Production returned HTTP/API 429 with an explicit limit of 8 credits/minute.
 * Preserve capacity for primary market snapshots; higher-timeframe and optional
 * context requests are best-effort and never block a primary analysis.
 *
 * This is a per-warm-worker guard, not a substitute for provider-side/global
 * quotas. The provider can still rate-limit requests from other workers/users;
 * those responses activate the global cooldown below.
 */
export type TwelveDataRequestClass = "primary" | "higher-timeframe" | "optional";

export interface TwelveDataBudgetConfig {
  windowMs: number;
  cooldownMs: number;
  maxTotal: number;
  maxPrimary: number;
  maxHigherTimeframe: number;
  maxOptional: number;
}

export type TwelveDataReservation =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string; retryAt: number };

const DEFAULT_CONFIG: TwelveDataBudgetConfig = {
  windowMs: 60_000,
  cooldownMs: 60_000,
  // Leave one of the observed eight credits uncommitted as a safety margin.
  maxTotal: 7,
  maxPrimary: 5,
  maxHigherTimeframe: 2,
  maxOptional: 0,
};

export class TwelveDataRequestBudget {
  private readonly config: TwelveDataBudgetConfig;
  private reservations: Array<{ at: number; requestClass: TwelveDataRequestClass }> = [];
  private cooldownUntil = 0;

  constructor(config: Partial<TwelveDataBudgetConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  reserve(requestClass: TwelveDataRequestClass, now = Date.now()): TwelveDataReservation {
    this.reservations = this.reservations.filter(
      (item) => now - item.at < this.config.windowMs,
    );

    if (now < this.cooldownUntil) {
      return {
        allowed: false,
        reason: "provider cooldown active after a real rate-limit response",
        retryAt: this.cooldownUntil,
      };
    }

    if (this.reservations.length >= this.config.maxTotal) {
      return {
        allowed: false,
        reason: "safe per-minute request budget is exhausted",
        retryAt: this.reservations[0].at + this.config.windowMs,
      };
    }

    const classCount = this.reservations.filter(
      (item) => item.requestClass === requestClass,
    ).length;
    const classLimit =
      requestClass === "primary"
        ? this.config.maxPrimary
        : requestClass === "higher-timeframe"
          ? this.config.maxHigherTimeframe
          : this.config.maxOptional;

    if (classCount >= classLimit) {
      return {
        allowed: false,
        reason:
          requestClass === "primary"
            ? "primary market-data request budget is exhausted"
            : requestClass === "higher-timeframe"
              ? "higher-timeframe request budget is exhausted; primary analyses are prioritized"
              : "optional provider request skipped to protect primary market analyses",
        retryAt: this.reservations[0]?.at + this.config.windowMs || now + this.config.windowMs,
      };
    }

    this.reservations.push({ at: now, requestClass });
    return { allowed: true, remaining: this.config.maxTotal - this.reservations.length };
  }

  markRateLimited(now = Date.now(), cooldownMs = this.config.cooldownMs): number {
    this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldownMs);
    return this.cooldownUntil;
  }

  getSnapshot(now = Date.now()): {
    requestsInWindow: number;
    primaryRequests: number;
    higherTimeframeRequests: number;
    optionalRequests: number;
    cooldownUntil: number;
  } {
    this.reservations = this.reservations.filter(
      (item) => now - item.at < this.config.windowMs,
    );
    return {
      requestsInWindow: this.reservations.length,
      primaryRequests: this.reservations.filter((item) => item.requestClass === "primary").length,
      higherTimeframeRequests: this.reservations.filter((item) => item.requestClass === "higher-timeframe").length,
      optionalRequests: this.reservations.filter((item) => item.requestClass === "optional").length,
      cooldownUntil: this.cooldownUntil,
    };
  }
}
