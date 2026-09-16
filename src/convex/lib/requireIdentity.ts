/**
 * Phase 167 — Authorization guard for credentialed provider proxy actions.
 *
 * Several Convex actions proxy third-party market-data APIs using server-side
 * keys (Alpha Vantage, CoinGlass, EIA, Trading Economics, Twelve Data). Convex
 * actions are publicly callable by anyone who knows the deployment URL, so
 * without a guard an anonymous caller could invoke them in a loop and burn
 * through a paid quota, or use the deployment as a free proxy for an API the
 * project pays for.
 *
 * These endpoints serve market data, not user data, so the requirement is
 * deliberately minimal: the caller must be *some* authenticated identity. The
 * app supports anonymous/guest sign-in, so this does not break the guest
 * experience — it only rejects callers with no session at all.
 *
 * This is not a substitute for per-user authorization on user-scoped data;
 * those functions resolve and compare the owning user individually.
 */

export interface IdentityCtx {
  auth: { getUserIdentity: () => Promise<unknown | null> };
}

/**
 * Throw unless the caller presents a valid identity.
 *
 * The error message is deliberately generic and never echoes arguments,
 * headers or credentials.
 */
export async function requireIdentity(ctx: IdentityCtx): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated: sign in to request market data.");
  }
}
