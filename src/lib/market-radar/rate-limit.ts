/**
 * Phase 51 — Provider Rate-Limit Controller
 *
 * Central rate-limit-aware request scheduler with provider-specific
 * budgets, cooldown, exponential backoff, and priority queuing.
 */

import type { ProviderRateLimitState, RefreshPriority } from "./types";

// ═══════════════════════════════════════════════════════════════
// DEFAULT PROVIDER BUDGETS
// ═══════════════════════════════════════════════════════════════

interface ProviderBudget {
  maxRequestsPerMinute: number;
  windowMs: number;
}

const DEFAULT_BUDGET: ProviderBudget = { maxRequestsPerMinute: 30, windowMs: 60_000 };

const PROVIDER_BUDGETS: Record<string, ProviderBudget> = {
  "twelve-data": { maxRequestsPerMinute: 8, windowMs: 60_000 },
  "alpha-vantage": { maxRequestsPerMinute: 5, windowMs: 60_000 },
  "coingecko": { maxRequestsPerMinute: 10, windowMs: 60_000 },
  "coinglass": { maxRequestsPerMinute: 10, windowMs: 60_000 },
  "cftc": { maxRequestsPerMinute: 2, windowMs: 60_000 },
  "treasury": { maxRequestsPerMinute: 5, windowMs: 60_000 },
  "eia": { maxRequestsPerMinute: 2, windowMs: 60_000 },
  "tickatlas": { maxRequestsPerMinute: 10, windowMs: 60_000 },
  "okx": { maxRequestsPerMinute: 20, windowMs: 60_000 },
  "defillama": { maxRequestsPerMinute: 15, windowMs: 60_000 },
  "tokenomist": { maxRequestsPerMinute: 10, windowMs: 60_000 },
};

// ═══════════════════════════════════════════════════════════════
// RATE LIMIT CONTROLLER
// ═══════════════════════════════════════════════════════════════

export class RateLimitController {
  private states = new Map<string, ProviderRateLimitState>();

  private getState(provider: string): ProviderRateLimitState {
    let state = this.states.get(provider);
    if (!state) {
      const budget = PROVIDER_BUDGETS[provider] ?? DEFAULT_BUDGET;
      state = {
        provider,
        requestCount: 0,
        maxRequests: budget.maxRequestsPerMinute,
        windowStart: Date.now(),
        cooldownUntil: 0,
        backoffFactor: 1,
        totalRequests: 0,
        totalFailures: 0,
      };
      this.states.set(provider, state);
    }
    return state;
  }

  /**
   * Check whether a request to this provider is allowed right now.
   */
  canRequest(provider: string): boolean {
    const state = this.getState(provider);
    const now = Date.now();

    // Cooldown check (after 429)
    if (now < state.cooldownUntil) return false;

    // Window reset
    const budget = PROVIDER_BUDGETS[provider] ?? DEFAULT_BUDGET;
    if (now - state.windowStart > budget.windowMs) {
      state.requestCount = 0;
      state.windowStart = now;
    }

    return state.requestCount < state.maxRequests;
  }

  /**
   * Record that a request was made.
   */
  recordRequest(provider: string): void {
    const state = this.getState(provider);
    state.requestCount++;
    state.totalRequests++;
  }

  /**
   * Record a failure (HTTP 429 or other rate-limit response).
   */
  recordFailure(provider: string, is429: boolean): void {
    const state = this.getState(provider);
    state.totalFailures++;
    if (is429) {
      const backoffMs = 60_000 * state.backoffFactor;
      state.cooldownUntil = Date.now() + backoffMs;
      state.backoffFactor = Math.min(state.backoffFactor * 2, 8);
    }
  }

  /**
   * Record a success (resets backoff).
   */
  recordSuccess(provider: string): void {
    const state = this.getState(provider);
    state.backoffFactor = 1;
  }

  /**
   * Get the priority for refreshing a provider (lower = refresh first).
   */
  getRefreshPriority(provider: string): number {
    const state = this.getState(provider);
    if (!this.canRequest(provider)) return 100; // deprioritize unavailable
    return state.totalFailures > 0 ? 50 : state.totalRequests;
  }

  /**
   * Get all provider states.
   */
  getAllStates(): Map<string, ProviderRateLimitState> {
    return new Map(this.states);
  }

  /**
   * Get state for a specific provider.
   */
  getStateFor(provider: string): ProviderRateLimitState | undefined {
    return this.states.get(provider);
  }

  /**
   * Reset a provider's state (e.g. after manual cooldown).
   */
  reset(provider: string): void {
    this.states.delete(provider);
  }

  /**
   * Check if provider is in cooldown.
   */
  isInCooldown(provider: string): boolean {
    const state = this.states.get(provider);
    if (!state) return false;
    return Date.now() < state.cooldownUntil;
  }

  /**
   * Get remaining requests in current window.
   */
  getRemainingRequests(provider: string): number {
    const state = this.getState(provider);
    const budget = PROVIDER_BUDGETS[provider] ?? DEFAULT_BUDGET;
    const now = Date.now();
    if (now - state.windowStart > budget.windowMs) return state.maxRequests;
    return Math.max(0, state.maxRequests - state.requestCount);
  }
}
