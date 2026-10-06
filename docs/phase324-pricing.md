# Phase 324 — Pricing / Monetization

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Base: phase 323 tip `a026e42`.
No Convex rewrite, no provider logic, no analysis algorithms, no auth architecture changed.

## 1. Audited entitlement architecture (the only source of the pricing model)

| Layer | File | Reality |
|---|---|---|
| Pure rules | `src/lib/entitlement/entitlement.ts` | `Plan = GUEST \| PREMIUM (+ OWNER overlay)`; `FREE_PROFIT_SIGNAL_LIMIT = 2` (one-time, total); only BUY/SELL/LONG/SHORT are charged — WAIT/NO_TRADE/UNAVAILABLE always free; server-authoritative by design |
| Server shell | `src/convex/entitlements.ts` | `getMyEntitlement` query (unauthenticated → GUEST with `remaining = limit`); `consumeProfitSignal` mutation (fail-closed on exhaustion); `grantPremium` mutation — **admin-only**, explicitly NOT wired to any client button; expired `premiumUntil` degrades to GUEST |
| UI surfaces | `EntitlementBadge`, `LockedSignalNotice` | server-report-only rendering; UNKNOWN remaining ≠ zero (Phase 188); locked signal never restyled as WAIT (Phase 174) |
| Billing | — | **none exists** (no Stripe/checkout/subscription code anywhere; `grantPremium`'s docblock names the payment-webhook path as future work) |

## 2. Final pricing model (built only from enforced reality)

- **Free** — every signed-in account: the full analysis workspace (market analysis — bias,
  structure, key levels, trade plan; evidence; history; protection workspace) with a **one-time
  allowance of 2 actionable profit signals**, enforced on the server. WAIT and NO_TRADE verdicts
  are never charged (so the model can never push the engine to manufacture signals).
- **Professional** — the PREMIUM entitlement: unlimited actionable profit signals.
  **Status: planned — checkout is not available yet.** No payment provider exists, so the
  Professional CTA is a *disabled* control with a factual coming-soon note; nothing on the page
  can report success or grant a plan.
- No other tiers. OWNER is a server-side operator overlay and is deliberately NOT advertised.
- **No currency amounts are shown** — advertising a price nothing can charge would be marketing,
  not pricing. Amounts arrive together with real billing (post-325 decision).

## 3. What is actually enforced server-side

The 2-signal allowance: enforced by `consumeProfitSignal` from the `entitlements` row keyed by
userId (reload/storage-reset/private-window/second-client cannot resurrect it). Unlimited signals
for PREMIUM/OWNER: enforced by `isUnlimitedPlan` in the same decision path. Both facts are pinned
by `pricing-honesty.phase324.test.ts` reading the REAL modules.

## 4. Routes / UI added or changed

| Change | File |
|---|---|
| NEW public route `/pricing` (no auth required; prospective users can evaluate before signup) | `src/pages/Pricing.tsx`, `src/main.tsx` |
| Two-plan presentation in the 322 identity (metal-panel cards, chrome-text headings, steel-blue accents; single shared "included in every plan" list; the ONE differentiator — actionable signals — displayed per plan) | `src/pages/Pricing.tsx` |
| Free-allowance number interpolated from the SHARED `FREE_PROFIT_SIGNAL_LIMIT` constant — never a hard-coded marketing number | `src/pages/Pricing.tsx` |
| Dead upgrade CTAs fixed: `LockedSignalNotice` button now navigates to `/pricing` (was `disabled` — a journey dead end from 323's audit) | `src/pages/Dashboard.tsx` |
| Landing header gains a "Pricing" link — one pricing UI total, no duplicated plan grid | `src/pages/Landing.tsx` |
| NEW `pricing` i18n section (20 keys × 9 locales + types), professional and financially honest | `src/lib/i18n/*` |

## 5. Checkout / billing reality

None exists; none was fabricated. The page's checkout control is disabled and states: "Checkout is
not available yet. Nothing is charged and no plan is granted from this page." The server-side
`grantPremium` (admin-only) remains the sole grant path until a verified payment webhook exists.

## 6. Guest / free behavior

Unchanged by design: limit stays 2 (server constant untouched); UNKNOWN remaining still never
renders as zero; exhausted guests still see the honest "Free signals used" state.

## 7. Tests / validation

| Check | Result |
|---|---|
| NEW `pricing-honesty.phase324.test.ts` (11 tests: route, CTA wiring, enforced-constant interpolation, server-only grant, no success simulation, no currency marketing, no AI/scarcity/tier language, identity persistence, plan-symmetry) | 11/11 PASS |
| i18n (parity + truthfulness suites; canonical leaf pin 1393 → 1413 for the deliberate dictionary growth) | 441 PASS |
| Entitlement suites (169/174/188) | 157 PASS |
| `tsc -b` | 0 errors |
| `npm run build` WITH `VITE_CONVEX_URL` (CI-exact) | ✓ |
| Full suite against the real dist | **494 files / 15,336 PASS \| 0 FAIL \| 9 skipped** |
| CI (test+typecheck+build+lint, secret scan) | run at push — see RUN-324 |

## 8. Remaining limitations (honest)

1. No payment processing: Professional cannot be purchased yet — the locked-signal journey ends at
   an honest "coming soon" until a real billing integration (post-roadmap decision).
2. No prices shown (deliberate — nothing can be charged).
3. `grantPremium` remains admin-only; a verified payment webhook is future work.
4. Phase 325 must re-verify the deployed `/pricing` route on the production URL (this phase's live
   proof is CI + full-suite against a CI-exact dist, consistent with the Convex dev-deployment
   freeze documented in RUN-320).
